import { randomInt } from "node:crypto";
import type { ChurchFunctionCode, InvitationAuditAction, Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";
import { env } from "./env";
import { generateRawToken, hashToken } from "./crypto";
import { SESSION_TTL_MS } from "./auth";
import { functionFitsRole } from "./churchFunctions";
import { sendMail, invitationEmail, SmtpDeadlineError } from "./mailer";
import { rateLimit } from "./rateLimit";
import { ROLE_LABELS } from "./format";
import { AuthorizationError, RingError, assertCanManageRing, assertMembershipRole, lockRing, resolveFunctionAndAuthority } from "./rings";
import { addParticipantToRunningRounds } from "./workflow";

/**
 * C5.1 – Uitnodigen en activeren.
 *
 * Uitgangspunten:
 * - Er is één accountsysteem: een uitnodiging maakt bij activatie een gewoon `User` + `RingMembership` aan (of koppelt een bestaand account aan een extra ring).
 * - Een uitnodiging verleent nooit méér dan een bevoegde beheerder vooraf vastlegde (rol, functie, ringbeheerder). Een machtiging (`appointAuthority`) is
 *   nooit onderdeel van een uitnodiging en een Ringtools-rol of functie is nooit een machtiging.
 * - Token en code worden alleen als hash bewaard. Activeren geeft nooit een sessie: inloggen (en daarmee MFA) verloopt altijd via de bestaande routes.
 * - Het activeren verbruikt de uitnodiging atomair (`updateMany` met voorwaarden binnen één transactie).
 */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_RESEND_COOLDOWN_MS = 5 * 60 * 1000;
export const INVITATION_MAX_SENDS = 10;
export const INVITATION_CODE_MAX_ATTEMPTS = 5;
export const INVITATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // zonder verwarrende tekens (0/O, 1/I)

export type InvitationStatus = "NIET_VERSTUURD" | "VERSTUURD" | "VERLOPEN" | "INGETROKKEN" | "GEACTIVEERD";

export class InvitationError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid" | "expired" | "rate-limited" | "unavailable" | "validation" | "conflict"
  ) {
    super(message);
  }
}

const GENERIC_INVALID = "Deze uitnodiging is niet (meer) geldig. Vraag de ringbeheerder om een nieuwe uitnodiging.";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateInvitationCode(): string {
  let code = "";
  for (let i = 0; i < 12; i++) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return code;
}

export function formatInvitationCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/** Normaliseert handmatig ingevoerde code: hoofdletters, zonder spaties of streepjes. */
export function normalizeInvitationCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashCode(invitationId: string, code: string): string {
  return hashToken(`invite:${invitationId}:${code}`);
}

export function invitationStatus(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date; sentAt: Date | null }, now = new Date()): InvitationStatus {
  if (i.acceptedAt) return "GEACTIVEERD";
  if (i.revokedAt) return "INGETROKKEN";
  if (i.expiresAt.getTime() <= now.getTime()) return "VERLOPEN";
  if (!i.sentAt) return "NIET_VERSTUURD";
  return "VERSTUURD";
}

async function audit(db: Prisma.TransactionClient | typeof prisma, invitationId: string, action: InvitationAuditAction, actorUserId?: string | null, detail?: string) {
  await db.ringInvitationAudit.create({ data: { invitationId, action, actorUserId: actorUserId ?? null, detail: detail ?? null } });
}

export type InvitationInput = {
  actorId: string;
  ringId: string;
  name: string;
  email: string;
  role: Role;
  churchFunction?: string;
  churchFunctionCode?: ChurchFunctionCode;
  isRingManager?: boolean;
};

function validateContent(i: { name: string; email?: string; role: Role; churchFunctionCode?: ChurchFunctionCode }) {
  assertMembershipRole(i.role);
  if (i.name.trim().length < 2) throw new RingError("Vul een naam in.");
  if (i.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email)) throw new RingError("Vul een geldig e-mailadres in.");
  if (i.churchFunctionCode && !functionFitsRole(i.churchFunctionCode, i.role)) {
    throw new RingError("De gekozen kerkelijke functie past niet bij de gekozen rol binnen Ringtools.");
  }
}

type IssuedSecrets = { rawToken: string; code: string };

function issueSecrets(): IssuedSecrets {
  return { rawToken: generateRawToken(), code: generateInvitationCode() };
}

/** Maakt een uitnodiging aan en verstuurt de e-mail. Slaagt het versturen niet, dan blijft de uitnodiging "niet verstuurd" en kan zij opnieuw worden verstuurd. */
export async function createInvitation(input: InvitationInput) {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  validateContent({ name, email, role: input.role, churchFunctionCode: input.churchFunctionCode });

  const secrets = issueSecrets();
  const created = await prisma.$transaction(async (tx) => {
    const actor = await assertCanManageRing(tx, input.actorId, input.ringId);
    const ring = await tx.ring.findUnique({ where: { id: input.ringId } });
    if (!ring || !ring.active) throw new RingError("Deze ring bestaat niet of is niet actief.");
    await lockRing(tx, input.ringId); // serialiseert aanmaken per ring: geen dubbele actieve uitnodigingen

    // Hoofdletterongevoelig zoeken: een oud account met afwijkende schrijfwijze mag nooit een dubbel account opleveren.
    const existingUser = await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, include: { memberships: { where: { ringId: input.ringId } } } });
    if (existingUser?.role === "ADMIN") throw new RingError("Dit e-mailadres kan niet worden uitgenodigd.");
    if (existingUser?.memberships.some((m) => m.active)) throw new RingError("Deze persoon is al lid van deze ring.");

    const now = new Date();
    const open = await tx.ringInvitation.findFirst({ where: { ringId: input.ringId, email, acceptedAt: null, revokedAt: null } });
    if (open) {
      throw new RingError(
        invitationStatus(open, now) === "VERLOPEN"
          ? "Er staat al een verlopen uitnodiging voor dit e-mailadres. Verstuur die opnieuw."
          : "Er staat al een uitnodiging open voor dit e-mailadres. Verstuur die zo nodig opnieuw."
      );
    }

    const id = (await tx.ringInvitation.create({
      data: {
        ringId: input.ringId,
        email,
        name,
        role: input.role,
        churchFunction: (input.churchFunction ?? "").trim().slice(0, 200),
        churchFunctionCode: input.churchFunctionCode ?? "ONBEKEND",
        isRingManager: !!input.isRingManager,
        createdById: actor.id,
        tokenHash: hashToken(secrets.rawToken),
        codeHash: "pending",
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        sendClaimedAt: now, // de eerste verzending is al geclaimd: een gelijktijdige 'opnieuw versturen' stuurt niet nogmaals
      },
    })).id;
    const invitation = await tx.ringInvitation.update({ where: { id }, data: { codeHash: hashCode(id, secrets.code) } });
    await audit(tx, id, "CREATED", actor.id, `rol ${input.role}`);
    return { invitation, ringName: ring.name };
  });

  const sent = await deliver(created.invitation.id, created.ringName, secrets, input.actorId, null);
  return { id: created.invitation.id, sent };
}

/**
 * Een verzending die langer dan dit geclaimd staat (bijv. na een crash) mag opnieuw worden gestart. Moet ruim boven de harde SMTP-totaaltijd liggen
 * (`SMTP_SEND_DEADLINE_MAX_MS`, 60 s): een lopende verzending is dan altijd afgerond (geslaagd of mislukt, claim vrijgegeven) vóór de lease verloopt.
 */
export const INVITATION_SEND_LEASE_MS = 2 * 60 * 1000;

type PreviousSecrets = { tokenHash: string; codeHash: string; codeAttempts: number; expiresAt: Date; sentAt: Date | null };

/**
 * Verstuurt de mail voor een reeds GECLAIMDE uitnodiging (`sendClaimedAt` gezet in dezelfde transactie als het aanmaken/roteren van token en code).
 * - Succes: `sentAt` gezet, claim vrijgegeven.
 * - SMTP-storing: claim vrijgegeven en vastgelegd (zonder foutdetails). Was er al eerder een mail bezorgd, dan worden de vorige token/code/geldigheid
 *   hersteld (compare-and-set op het nieuwe token), zodat de eerder verstuurde link blijft werken; anders blijft de status "niet verstuurd".
 */
async function deliver(invitationId: string, ringName: string, secrets: IssuedSecrets, actorId: string, previous: PreviousSecrets | null): Promise<boolean> {
  const inv = await prisma.ringInvitation.findUniqueOrThrow({ where: { id: invitationId } });
  const link = `${env.appBaseUrl}/uitnodiging/${secrets.rawToken}`;
  const { subject, text } = invitationEmail({
    name: inv.name,
    ringName,
    link,
    code: formatInvitationCode(secrets.code),
    expiresAt: inv.expiresAt,
  });
  const currentHash = hashToken(secrets.rawToken);
  try {
    await sendMail({ to: inv.email, subject, text });
  } catch (err) {
    // Bij een time-out is de afleverstatus onbekend: de mail kan alsnog zijn aangenomen. We behandelen dit als mislukt en herstellen een eerder
    // bezorgde link (zodat de ontvanger zeker één geldige link heeft); zonder eerdere verzending blijft de nieuwe link geldig voor het geval de mail toch aankomt.
    const timedOut = err instanceof SmtpDeadlineError;
    console.error("[uitnodiging] Versturen mislukt:", err instanceof Error ? err.name : "fout");
    await prisma.ringInvitation.updateMany({
      where: { id: invitationId, tokenHash: currentHash },
      data: previous?.sentAt
        ? { tokenHash: previous.tokenHash, codeHash: previous.codeHash, codeAttempts: previous.codeAttempts, expiresAt: previous.expiresAt, sendClaimedAt: null }
        : { sendClaimedAt: null },
    });
    await audit(prisma, invitationId, "SEND_FAILED", actorId, timedOut ? "time-out; afleverstatus onbekend" : undefined);
    return false;
  }
  const marked = await prisma.ringInvitation.updateMany({ where: { id: invitationId, tokenHash: currentHash }, data: { sentAt: new Date(), sendCount: { increment: 1 }, sendClaimedAt: null } });
  if (marked.count !== 1) {
    // Intussen is het token vervangen (een latere verzending nam het over): deze mail bevat een verouderde link en mag de status niet beïnvloeden.
    await audit(prisma, invitationId, "SEND_FAILED", actorId, "verouderde verzending: token inmiddels vervangen");
    return false;
  }
  await audit(prisma, invitationId, "SENT", actorId);
  return true;
}

async function loadManaged(db: Prisma.TransactionClient | typeof prisma, actorId: string, invitationId: string) {
  const inv = await db.ringInvitation.findUnique({ where: { id: invitationId }, include: { ring: true } });
  // Zelfde antwoord voor "bestaat niet" en "andere ring": geen informatie over andere ringen.
  if (!inv) throw new AuthorizationError();
  await assertCanManageRing(db as Prisma.TransactionClient, actorId, inv.ringId);
  return inv;
}

/**
 * Opnieuw versturen/herinneren: nieuwe token en code (de oude link vervalt), nieuwe geldigheid. Werkt ook voor een verlopen of niet-verstuurde uitnodiging.
 * Betrouwbaar en idempotent bij gelijktijdige verzoeken: de rij wordt vergrendeld en het roteren van token en code gaat samen met een verzendclaim.
 * Een tweede verzoek terwijl de eerste nog verstuurt, krijgt `inProgress` en verstuurt niets (dus geen mail met een link die meteen ongeldig is);
 * een verzoek vlak ná een geslaagde verzending valt onder de wachttijd.
 */
export async function resendInvitation(input: { actorId: string; invitationId: string }) {
  const secrets = issueSecrets();
  const claim = await prisma.$transaction(async (tx) => {
    const inv = await loadManaged(tx, input.actorId, input.invitationId);
    if (!inv.ring.active) throw new RingError("Deze ring is niet actief.");
    await tx.$queryRaw`SELECT "id" FROM "RingInvitation" WHERE "id" = ${inv.id} FOR UPDATE`;
    const fresh = await tx.ringInvitation.findUniqueOrThrow({ where: { id: inv.id } });
    if (fresh.acceptedAt) throw new RingError("Deze uitnodiging is al geactiveerd.");
    if (fresh.revokedAt) throw new RingError("Deze uitnodiging is ingetrokken. Maak een nieuwe uitnodiging aan.");
    if (fresh.sendCount >= INVITATION_MAX_SENDS) throw new RingError("Deze uitnodiging is al vaak verstuurd. Maak zo nodig een nieuwe uitnodiging aan.");
    if (fresh.sentAt && Date.now() - fresh.sentAt.getTime() < INVITATION_RESEND_COOLDOWN_MS) {
      throw new RingError("Deze uitnodiging is net verstuurd. Wacht een paar minuten voordat je hem opnieuw verstuurt.");
    }
    if (fresh.sendClaimedAt && Date.now() - fresh.sendClaimedAt.getTime() < INVITATION_SEND_LEASE_MS) return { inProgress: true as const, id: fresh.id };
    const previous: PreviousSecrets = { tokenHash: fresh.tokenHash, codeHash: fresh.codeHash, codeAttempts: fresh.codeAttempts, expiresAt: fresh.expiresAt, sentAt: fresh.sentAt };
    await tx.ringInvitation.update({
      where: { id: fresh.id },
      data: {
        tokenHash: hashToken(secrets.rawToken),
        codeHash: hashCode(fresh.id, secrets.code),
        codeAttempts: 0,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        sendClaimedAt: new Date(),
      },
    });
    return { inProgress: false as const, id: fresh.id, ringName: inv.ring.name, previous };
  });
  if (claim.inProgress) return { id: claim.id, sent: false, inProgress: true };
  const sent = await deliver(claim.id, claim.ringName, secrets, input.actorId, claim.previous);
  return { id: claim.id, sent, inProgress: false };
}

export async function revokeInvitation(input: { actorId: string; invitationId: string }) {
  await prisma.$transaction(async (tx) => {
    const inv = await loadManaged(tx, input.actorId, input.invitationId);
    if (inv.acceptedAt) throw new RingError("Deze uitnodiging is al geactiveerd en kan niet meer worden ingetrokken.");
    if (inv.revokedAt) return; // idempotent
    const claimed = await tx.ringInvitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count === 1) await audit(tx, inv.id, "REVOKED", input.actorId);
  });
  return { ok: true };
}

/** Wijzigt rol/functie/ringbeheerder van een nog openstaande uitnodiging; geldt bij activatie. */
export async function updateInvitation(input: {
  actorId: string;
  invitationId: string;
  role: Role;
  churchFunction?: string;
  churchFunctionCode?: ChurchFunctionCode;
  isRingManager?: boolean;
}) {
  validateContent({ name: "xx", role: input.role, churchFunctionCode: input.churchFunctionCode });
  await prisma.$transaction(async (tx) => {
    const inv = await loadManaged(tx, input.actorId, input.invitationId);
    const changed = await tx.ringInvitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null },
      data: {
        role: input.role,
        churchFunction: (input.churchFunction ?? inv.churchFunction).trim().slice(0, 200),
        churchFunctionCode: input.churchFunctionCode ?? "ONBEKEND",
        isRingManager: !!input.isRingManager,
      },
    });
    if (changed.count !== 1) throw new RingError("Deze uitnodiging kan niet meer worden gewijzigd.");
    await audit(tx, inv.id, "UPDATED", input.actorId, `rol ${input.role}`);
  });
  return { ok: true };
}

export type InvitationView = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  churchFunction: string;
  churchFunctionCode: ChurchFunctionCode;
  isRingManager: boolean;
  status: InvitationStatus;
  sentAt: string | null;
  expiresAt: string;
  canResend: boolean;
  canRevoke: boolean;
};

/** Lijst voor de beheerder. Bevat nooit token of code. Alleen aanroepen na `assertCanManageRing`. */
export async function listInvitations(ringId: string): Promise<InvitationView[]> {
  const rows = await prisma.ringInvitation.findMany({ where: { ringId }, orderBy: { createdAt: "desc" }, take: 200 });
  const now = new Date();
  return rows.map((r) => {
    const status = invitationStatus(r, now);
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      roleLabel: ROLE_LABELS[r.role] ?? r.role,
      churchFunction: r.churchFunction,
      churchFunctionCode: r.churchFunctionCode,
      isRingManager: r.isRingManager,
      status,
      sentAt: r.sentAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
      canResend: status !== "GEACTIVEERD" && status !== "INGETROKKEN" && r.sendCount < INVITATION_MAX_SENDS,
      canRevoke: status !== "GEACTIVEERD" && status !== "INGETROKKEN",
    };
  });
}

// ---- Ontvanger: voorvertoning en activatie (geen sessie nodig, wel token of e-mail + code) ----

export type InvitationPreview =
  | { valid: true; name: string; ringName: string; roleLabel: string; expiresAt: string }
  | { valid: false; reason: "expired" | "invalid" };

/** Controleert een uitnodiging zonder iets te verbruiken. Een ongeldig, ingetrokken of al gebruikt token geeft hetzelfde antwoord. */
export async function previewInvitation(rawToken: string): Promise<InvitationPreview> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(rawToken)) return { valid: false, reason: "invalid" };
  const inv = await prisma.ringInvitation.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { ring: true } });
  if (!inv || inv.acceptedAt || inv.revokedAt) return { valid: false, reason: "invalid" };
  if (inv.expiresAt.getTime() <= Date.now()) return { valid: false, reason: "expired" };
  if (!(await creatorStillAllowed(prisma, inv))) return { valid: false, reason: "invalid" };
  return { valid: true, name: inv.name, ringName: inv.ring.name, roleLabel: ROLE_LABELS[inv.role] ?? inv.role, expiresAt: inv.expiresAt.toISOString() };
}

/** De uitnodiging is alleen geldig zolang de ring actief is en de uitnodiger nog bevoegd is (anders zou een uitnodiging méér rechten geven dan de uitnodiger nu heeft). */
async function creatorStillAllowed(db: Prisma.TransactionClient | typeof prisma, inv: { ringId: string; createdById: string | null; ring: { active: boolean } }): Promise<boolean> {
  if (!inv.ring.active || !inv.createdById) return false;
  const creator = await db.user.findUnique({ where: { id: inv.createdById } });
  if (!creator || !creator.active) return false;
  if (creator.role === "ADMIN") return true;
  const m = await db.ringMembership.findUnique({ where: { userId_ringId: { userId: creator.id, ringId: inv.ringId } } });
  return !!m && m.active && m.isRingManager;
}

/**
 * `session` is alleen gevuld als de activatie én alle controles geslaagd zijn, het account geen verplichte MFA heeft en de aanroeper erom vroeg;
 * dit is een gewone volledige sessie (zelfde levensduur, `mfaAt` gezet, zelfde servercontroles) — het token verlaat de server alleen in de JSON-respons.
 */
export type ActivationResult = { email: string; ringName: string; mfaRequired: boolean; userId: string; session?: { rawToken: string; expiresAt: Date } };
export type ActivationOptions = { issueSession?: boolean; deviceName?: string };

type Credentials = { token: string } | { email: string; code: string };

/**
 * Activeert een uitnodiging met het token uit de link, of met e-mailadres + code (terugval als de link de app niet opent).
 * - Maakt een nieuw account aan, of koppelt een bestaand account aan de ring; wijzigt daarbij nooit naam, e-mail of beveiliging van een bestaand account.
 * - Sessie (zodat de gebruiker direct is ingelogd, zonder tweede e-mailcode): de geldige, eenmalige uitnodiging bewijst de controle over het e-mailadres, net als een inlogcode.
 *   De sessie wordt in DEZELFDE transactie als het verbruiken van de uitnodiging aangemaakt: gelijktijdige pogingen leveren hooguit één activatie en één sessie op, en een mislukte activatie
 *   (rollback) laat nooit een sessie achter. Nooit voor een account met verplichte MFA (passkey) of het beheerdersaccount: daar blijft de bestaande tweede factor noodzakelijk.
 * - Voorkomt enumeratie: elk ongeldig geval geeft hetzelfde antwoord; codepogingen worden per uitnodiging en per e-mailadres beperkt.
 */
export async function activateInvitation(credentials: Credentials, clientKey: string, options: ActivationOptions = {}): Promise<ActivationResult> {
  if (!rateLimit(`invite-activate-ip:${clientKey}`, 30, 15 * 60 * 1000).allowed) {
    throw new InvitationError("Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  }

  let tokenHash: string | null = null;
  let codeEmail: string | null = null;
  let code = "";
  if ("token" in credentials) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(credentials.token)) throw new InvitationError(GENERIC_INVALID, "invalid");
    tokenHash = hashToken(credentials.token);
  } else {
    codeEmail = normalizeEmail(credentials.email);
    code = normalizeInvitationCode(credentials.code);
    if (!/^[A-Z2-9]{12}$/.test(code) || !/^[^\s@]+@[^\s@]+$/.test(codeEmail)) throw new InvitationError(GENERIC_INVALID, "invalid");
    if (!rateLimit(`invite-activate-email:${codeEmail}`, 10, 15 * 60 * 1000).allowed) {
      throw new InvitationError("Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
    }
  }

  const device = (options.deviceName ?? "").slice(0, 60).replace(/[^\p{L}\p{N} ._-]/gu, "");
  const outcome = await prisma.$transaction(async (tx) => {
    // Volledige sessie, alleen voor een actief, niet-beheerders, niet-MFA-account; aangeroepen als laatste stap vóór het afronden van de transactie.
    const issueSession = async (u: { id: string; role: string; active: boolean; mfaEnabled: boolean }, ringActive: boolean) => {
      if (options.issueSession === false || !u.active || !ringActive || mfaApplies(u)) return undefined;
      const rawToken = generateRawToken();
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await tx.session.create({
        data: { userId: u.id, tokenHash: hashToken(rawToken), expiresAt, mfaAt: new Date(), userAgent: `Ringtools-app${device ? ` (${device})` : ""}` },
      });
      return { rawToken, expiresAt };
    };
    let inv;
    if (tokenHash) {
      inv = await tx.ringInvitation.findUnique({ where: { tokenHash }, include: { ring: true } });
    } else {
      const candidates = await tx.ringInvitation.findMany({
        where: { email: codeEmail!, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() }, codeAttempts: { lt: INVITATION_CODE_MAX_ATTEMPTS } },
        include: { ring: true },
        take: 5,
      });
      inv = candidates.find((c) => c.codeHash === hashCode(c.id, code)) ?? null;
      if (!inv && candidates.length > 0) {
        await tx.ringInvitation.updateMany({ where: { id: { in: candidates.map((c) => c.id) } }, data: { codeAttempts: { increment: 1 } } });
        await audit(tx, candidates[0].id, "CODE_FAILED");
        return { failed: "invalid" as const, commit: true };
      }
    }
    if (!inv || inv.acceptedAt || inv.revokedAt) return { failed: "invalid" as const };
    if (inv.expiresAt.getTime() <= Date.now()) return { failed: "expired" as const };
    if (!(await creatorStillAllowed(tx, inv))) {
      await audit(tx, inv.id, "ACCEPT_REFUSED", null, "uitnodiger niet meer bevoegd of ring niet actief");
      return { failed: "invalid" as const, commit: true };
    }

    await lockRing(tx, inv.ringId);
    // Atomisch verbruiken: bij gelijktijdige verzoeken slaagt er precies één.
    const claimed = await tx.ringInvitation.updateMany({
      where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count !== 1) return { failed: "invalid" as const };

    const existing = await tx.user.findFirst({ where: { email: { equals: inv.email, mode: "insensitive" } } });
    if (existing && (existing.role === "ADMIN" || !existing.active)) {
      // Geen overname van het beheerdersaccount of een gedeactiveerd account; de claim wordt teruggedraaid, het verzoek wordt wel vastgelegd.
      throw new RollbackWithAudit(inv.id);
    }
    const now = new Date();
    const user = existing
      ? existing.activatedAt
        ? existing
        : await tx.user.update({ where: { id: existing.id }, data: { activatedAt: now } })
      : await tx.user.create({ data: { name: inv.name, email: inv.email, role: inv.role, active: true, activatedAt: now } });

    const membership = await tx.ringMembership.findUnique({ where: { userId_ringId: { userId: user.id, ringId: inv.ringId } } });
    // Een lidmaatschap dat ná het aanmaken van de uitnodiging is gewijzigd en nu inactief is, is bewust door een beheerder gedeactiveerd:
    // een oude uitnodiging mag dat nooit ongedaan maken.
    if (membership && !membership.active && membership.updatedAt.getTime() > inv.createdAt.getTime()) throw new RollbackWithAudit(inv.id);
    if (membership?.active) {
      // Intussen al lid (bijvoorbeeld via de webmin): de uitnodiging verleent niets extra's.
      await tx.ringInvitation.update({ where: { id: inv.id }, data: { acceptedById: user.id } });
      await audit(tx, inv.id, "ACCEPTED", user.id, "was al lid; geen wijziging");
      return { done: { email: inv.email, ringName: inv.ring.name, mfaRequired: mfaApplies(user), userId: user.id, session: await issueSession(user, inv.ring.active) }, membershipId: null as string | null };
    }

    let fn: Awaited<ReturnType<typeof resolveFunctionAndAuthority>>;
    let note = "";
    try {
      fn = await resolveFunctionAndAuthority(tx, { ringId: inv.ringId, membershipId: membership?.id ?? null, role: inv.role, active: true, wantedFunction: inv.churchFunctionCode });
    } catch (err) {
      if (!(err instanceof RingError)) throw err;
      // Bijvoorbeeld: de functie is intussen aan een ander lid gegeven. Fail-closed: geen functie (en dus geen bevoegdheid) toekennen.
      fn = { churchFunctionCode: "ONBEKEND", appointAuthority: "NONE" };
      note = "functie niet toegekend (conflict)";
    }
    const data = {
      role: inv.role,
      churchFunction: inv.churchFunction,
      churchFunctionCode: fn.churchFunctionCode,
      isRingManager: inv.isRingManager,
      appointAuthority: fn.appointAuthority,
      active: true,
    };
    const saved = membership
      ? await tx.ringMembership.update({ where: { id: membership.id }, data })
      : await tx.ringMembership.create({ data: { userId: user.id, ringId: inv.ringId, ...data } });
    await tx.ringInvitation.update({ where: { id: inv.id }, data: { acceptedById: user.id } });
    await audit(tx, inv.id, "ACCEPTED", user.id, note || (existing ? "bestaand account gekoppeld" : "nieuw account"));
    return { done: { email: inv.email, ringName: inv.ring.name, mfaRequired: mfaApplies(user), userId: user.id, session: await issueSession(user, inv.ring.active) }, membershipId: saved.id };
  }).catch(async (err) => {
    if (err instanceof RollbackWithAudit) {
      await audit(prisma, err.invitationId, "ACCEPT_REFUSED", null, "account niet beschikbaar");
      return { failed: "invalid" as const };
    }
    throw err;
  });

  if ("failed" in outcome) {
    if (outcome.failed === "expired") throw new InvitationError("Deze uitnodiging is verlopen. Vraag de ringbeheerder om hem opnieuw te versturen.", "expired");
    throw new InvitationError(GENERIC_INVALID, "invalid");
  }
  if (outcome.membershipId) {
    const membership = await prisma.ringMembership.findUnique({ where: { id: outcome.membershipId } });
    if (membership) await addParticipantToRunningRounds(membership);
  }
  return outcome.done;
}

class RollbackWithAudit extends Error {
  constructor(public readonly invitationId: string) {
    super("rollback");
  }
}

function mfaApplies(user: { role: string; mfaEnabled: boolean }): boolean {
  return user.role === "ADMIN" || user.mfaEnabled;
}

/** Ruimt oude, niet langer relevante uitnodigingen op (gegevensminimalisatie). Open uitnodigingen blijven tot 90 dagen na verlopen. */
export async function deleteOldInvitations(): Promise<number> {
  const cutoff = new Date(Date.now() - INVITATION_RETENTION_MS);
  const res = await prisma.ringInvitation.deleteMany({
    where: { OR: [{ expiresAt: { lt: cutoff } }, { acceptedAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return res.count;
}
