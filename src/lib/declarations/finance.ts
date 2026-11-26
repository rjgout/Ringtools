import type { FinanceRole, Prisma, User } from "@prisma/client";
import { prisma } from "../prisma";
import { findUserByLoginEmail } from "../auth";
import { normalizeEmail } from "../invitations";
import { emailSchema } from "../validation";
import { rateLimit } from "../rateLimit";
import { sendMail } from "../mailer";
import { env } from "../env";

type Db = Prisma.TransactionClient | typeof prisma;

export class FinanceError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export const ADMIN_ROLES: FinanceRole[] = ["ADMIN", "SUBADMIN"];
export const FINANCE_ROLE_LABELS: Record<FinanceRole, string> = {
  ADMIN: "Financieel administrateur",
  SUBADMIN: "Financieel subadministrateur",
  RING_PRESIDENT_READ: "Ringpresident (alleen lezen)",
  UNIT_LEADER: "Bisschop/gemeentepresident (voor activering)",
};

export type Scope = { ringId: string; unitId: string | null; role: FinanceRole };

/** Actieve functies van een gebruiker. Een gedeactiveerde ring (Ring.active = false) is voor niemand toegankelijk. */
export async function loadScopes(userId: string, db: Db = prisma): Promise<Scope[]> {
  const rows = await db.financeAssignment.findMany({ where: { userId, active: true, ring: { active: true }, user: { active: true, accountKind: "NORMAL" } }, select: { ringId: true, unitId: true, role: true } });
  return rows;
}

/** Mag deze gebruiker (administrateur/subadministrateur) declaraties van deze bestemming verwerken? Ringniveau ≠ unitniveau: de scopes tellen niet door. */
export function canAdminister(scopes: Scope[], dest: { ringId: string; unitId: string | null }): boolean {
  return scopes.some((s) => ADMIN_ROLES.includes(s.role) && s.ringId === dest.ringId && s.unitId === dest.unitId);
}

/** Ringpresident: alleen lezen, voor de eigen ring én alle units daarvan. */
export function canReadAsPresident(scopes: Scope[], dest: { ringId: string }): boolean {
  return scopes.some((s) => s.role === "RING_PRESIDENT_READ" && s.unitId === null && s.ringId === dest.ringId);
}

export type Activation = { activated: boolean; missing: ("leader" | "administrator")[] };

/**
 * Een bestemming is pas beschikbaar voor declaraties als de vereiste functionarissen gekoppeld zijn:
 * ring = ringpresident + minimaal één financiële (sub)administrateur; wijk/gemeente = bisschop/gemeentepresident + minimaal één financiële
 * (sub)administrateur van die unit. De functionarissen moeten een actief account hebben.
 */
export async function activationFor(ringId: string, unitId: string | null, db: Db = prisma): Promise<Activation> {
  const ring = await db.ring.findUnique({ where: { id: ringId }, select: { active: true, isDemo: true } });
  if (!ring || !ring.active || ring.isDemo) return { activated: false, missing: ["leader", "administrator"] };
  if (unitId) {
    const unit = await db.ringUnit.findFirst({ where: { id: unitId, ringId, active: true }, select: { id: true } });
    if (!unit) return { activated: false, missing: ["leader", "administrator"] };
  }
  const rows = await db.financeAssignment.findMany({
    where: { ringId, unitId, active: true, user: { active: true, accountKind: "NORMAL" } },
    select: { role: true },
  });
  const leader = rows.some((r) => (unitId ? r.role === "UNIT_LEADER" : r.role === "RING_PRESIDENT_READ"));
  const administrator = rows.some((r) => ADMIN_ROLES.includes(r.role));
  const missing: Activation["missing"] = [];
  if (!leader) missing.push("leader");
  if (!administrator) missing.push("administrator");
  return { activated: missing.length === 0, missing };
}

export const NOT_ACTIVATED_MESSAGE = "Declareren is voor deze ring, wijk of gemeente nog niet geactiveerd. Neem contact op met je plaatselijke leiders om de declaratiemodule te laten activeren.";

/** Alleen een actieve ringbeheerder van deze ring mag financiële functies toekennen of intrekken (niet de systeembeheerder). */
async function requireRingManager(actorId: string, ringId: string, db: Db = prisma) {
  const m = await db.ringMembership.findFirst({ where: { userId: actorId, ringId, active: true, isRingManager: true, ring: { active: true }, user: { active: true, role: { not: "ADMIN" } } } });
  if (!m) throw new FinanceError(403, "Alleen een ringbeheerder van deze ring kan financiële functies beheren.", "forbidden");
  return m;
}

function shapeError(role: FinanceRole, unitId: string | null): string | null {
  if (role === "UNIT_LEADER" && !unitId) return "Een bisschop of gemeentepresident hoort bij een wijk of gemeente.";
  if (role === "RING_PRESIDENT_READ" && unitId) return "De ringpresident wordt voor de ring zelf aangewezen, niet voor een wijk of gemeente.";
  return null;
}

export type AssignResult = { status: "assigned" | "already" | "invited" };

/**
 * Kent een financiële functie toe op basis van het EXACTE e-mailadres. Er is geen zoeklijst met kerkleden: het antwoord verraadt niet of het adres
 * een account heeft (de ringbeheerder ziet alleen "toegekend" of "uitnodiging verstuurd" als de toekenning in afwachting is).
 * Onbekend adres = een openstaande toekenning, geclaimd bij de geverifieerde registratie op exact dat adres; er wordt nooit een tweede account aangemaakt.
 */
export async function assignFinanceRole(input: { actorId: string; ringId: string; unitId: string | null; email: string; role: FinanceRole }): Promise<AssignResult> {
  const { actorId, ringId, unitId, role } = input;
  await requireRingManager(actorId, ringId);
  if (!rateLimit(`finance-assign:${actorId}`, 40, 60 * 60 * 1000).allowed) throw new FinanceError(429, "Te veel toekenningen achter elkaar. Probeer het later opnieuw.", "rate-limited");
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) throw new FinanceError(400, "Vul een geldig e-mailadres in.", "validation");
  const email = normalizeEmail(parsed.data);
  const bad = shapeError(role, unitId);
  if (bad) throw new FinanceError(400, bad, "validation");
  if (unitId) {
    const unit = await prisma.ringUnit.findFirst({ where: { id: unitId, ringId, active: true }, select: { id: true } });
    if (!unit) throw new FinanceError(404, "Deze wijk of gemeente bestaat niet in deze ring.", "not-found");
  }

  const user = await findUserByLoginEmail(email);
  if (user && user.active && user.accountKind === "NORMAL" && user.role !== "ADMIN") {
    return prisma.$transaction(async (tx) => {
      const exists = await tx.financeAssignment.findFirst({ where: { userId: user.id, ringId, unitId, role, active: true } });
      if (exists) return { status: "already" as const };
      await tx.financeAssignment.create({ data: { userId: user.id, ringId, unitId, role, createdById: actorId } });
      return { status: "assigned" as const };
    });
  }
  if (user) throw new FinanceError(400, "Dit e-mailadres kan geen functie krijgen.", "not-allowed");

  const pendingCount = await prisma.pendingFinanceAssignment.count({ where: { ringId, claimedAt: null, expiresAt: { gt: new Date() } } });
  if (pendingCount >= 200) throw new FinanceError(429, "Er staan te veel openstaande uitnodigingen. Wacht tot ze zijn geaccepteerd of verlopen.", "limit");
  const open = await prisma.pendingFinanceAssignment.findFirst({ where: { email, ringId, unitId, role, claimedAt: null, expiresAt: { gt: new Date() } } });
  if (open) return { status: "invited" };
  await prisma.pendingFinanceAssignment.create({ data: { email, ringId, unitId, role, createdById: actorId, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) } });
  try {
    await sendMail({
      to: email,
      subject: "Ringtools – je bent aangewezen voor een functie",
      text: ["Hallo,", "", "Een ringbeheerder heeft dit e-mailadres aangewezen voor een functie in Ringtools.", `Meld je aan op ${env.appBaseUrl} met dit e-mailadres; je ontvangt dan een eenmalige inlogcode. Je hoeft geen wachtwoord in te stellen.`, "", "Heb je hier niet om gevraagd? Dan kun je deze e-mail negeren."].join("\n"),
    });
  } catch {
    // De toekenning blijft staan; de ringbeheerder kan het adres opnieuw laten aanmelden. Geen details loggen.
    console.error("[declaraties] Versturen van de uitnodiging mislukt.");
  }
  return { status: "invited" };
}

/** Claimt openstaande toekenningen voor een zojuist geverifieerd (nieuw) account op exact dat e-mailadres. Binnen de registratietransactie. */
export async function claimPendingAssignments(tx: Prisma.TransactionClient, user: Pick<User, "id" | "email">): Promise<number> {
  const email = normalizeEmail(user.email);
  const pending = await tx.pendingFinanceAssignment.findMany({ where: { email, claimedAt: null, expiresAt: { gt: new Date() }, ring: { active: true } } });
  let claimed = 0;
  for (const p of pending) {
    const done = await tx.pendingFinanceAssignment.updateMany({ where: { id: p.id, claimedAt: null }, data: { claimedAt: new Date() } });
    if (done.count !== 1) continue;
    const exists = await tx.financeAssignment.findFirst({ where: { userId: user.id, ringId: p.ringId, unitId: p.unitId, role: p.role, active: true } });
    if (!exists) await tx.financeAssignment.create({ data: { userId: user.id, ringId: p.ringId, unitId: p.unitId, role: p.role, createdById: p.createdById } });
    claimed += 1;
  }
  return claimed;
}

export async function revokeFinanceAssignment(input: { actorId: string; assignmentId: string }): Promise<void> {
  const a = await prisma.financeAssignment.findUnique({ where: { id: input.assignmentId } });
  if (!a) throw new FinanceError(404, "Deze functie bestaat niet.", "not-found");
  await requireRingManager(input.actorId, a.ringId);
  if (!a.active) return;
  await prisma.financeAssignment.updateMany({ where: { id: a.id, active: true }, data: { active: false, revokedAt: new Date(), revokedById: input.actorId } });
}

export async function revokePendingAssignment(input: { actorId: string; pendingId: string }): Promise<void> {
  const p = await prisma.pendingFinanceAssignment.findUnique({ where: { id: input.pendingId } });
  if (!p) throw new FinanceError(404, "Deze uitnodiging bestaat niet.", "not-found");
  await requireRingManager(input.actorId, p.ringId);
  await prisma.pendingFinanceAssignment.deleteMany({ where: { id: p.id, claimedAt: null } });
}

export type AssignmentView = {
  id: string; role: FinanceRole; roleLabel: string; unitId: string | null; unitName: string | null; name: string | null; email: string; pending: boolean;
};

/** Overzicht van de aangewezen functionarissen van een ring (alleen voor ringbeheerders; géén zoeklijst met kerkleden). */
export async function listAssignments(actorId: string, ringId: string): Promise<{ assignments: AssignmentView[]; activation: { ring: Activation; units: { unitId: string; name: string; activation: Activation }[] } }> {
  await requireRingManager(actorId, ringId);
  const [active, pending, units] = await Promise.all([
    prisma.financeAssignment.findMany({ where: { ringId, active: true }, include: { user: { select: { name: true, email: true } }, unit: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.pendingFinanceAssignment.findMany({ where: { ringId, claimedAt: null, expiresAt: { gt: new Date() } }, include: { unit: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.ringUnit.findMany({ where: { ringId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const assignments: AssignmentView[] = [
    ...active.map((a) => ({ id: a.id, role: a.role, roleLabel: FINANCE_ROLE_LABELS[a.role], unitId: a.unitId, unitName: a.unit?.name ?? null, name: a.user.name, email: a.user.email, pending: false })),
    ...pending.map((p) => ({ id: p.id, role: p.role, roleLabel: FINANCE_ROLE_LABELS[p.role], unitId: p.unitId, unitName: p.unit?.name ?? null, name: null, email: p.email, pending: true })),
  ];
  return { assignments, activation: { ring: await activationFor(ringId, null), units: await Promise.all(units.map(async (u) => ({ unitId: u.id, name: u.name, activation: await activationFor(ringId, u.id) }))) } };
}
