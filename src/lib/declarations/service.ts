import { randomUUID } from "node:crypto";
import type { Declaration, DeclarationStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { env } from "../env";
import { rateLimit } from "../rateLimit";
import { activationFor, canAdminister, canReadAsPresident, loadScopes, NOT_ACTIVATED_MESSAGE, type Scope } from "./finance";
import { FileValidationError, validateFiles } from "./files";
import { open, openJson, seal, sealJson } from "./crypto";

export class DeclarationError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export const STATUS_LABELS: Record<DeclarationStatus, string> = {
  SUBMITTED: "Ingediend",
  SEEN: "Gezien door administrateur",
  IN_PROGRESS: "In behandeling",
  NEEDS_INFO: "Aanvulling nodig",
  PROCESSED: "Administratief verwerkt",
  REJECTED: "Afgewezen",
};

export function assertDeclarationsEnabled() {
  if (!env.declarationsEnabled) throw new DeclarationError(404, "Niet gevonden.", "not-found");
}

const MAX_AMOUNT_CENTS = 5_000_000; // € 50.000 per declaratie (de database staat maximaal € 1.000.000 toe)

type Sealed = { organization: string; approverName: string; forWhom: string; payeeName: string; description: string; notes: string };
const sealAad = (id: string) => `declaration:${id}`;
const bytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
const attachmentAad = (id: string) => `attachment:${id}`;

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max + 1) : "");

function req(value: unknown, label: string, max: number): string {
  const v = text(value, max);
  if (!v) throw new DeclarationError(400, `Vul ${label} in.`, "validation");
  if (v.length > max) throw new DeclarationError(400, `${label[0].toUpperCase()}${label.slice(1)} is te lang (maximaal ${max} tekens).`, "validation");
  return v;
}

/** "12,50", "12.50", "12" of een getal → eurocenten. Geen negatieve of gebroken centen. */
export function parseAmountCents(value: unknown): number {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/^€\s*/, "") : "";
  const m = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(raw);
  if (!m) throw new DeclarationError(400, "Vul een geldig bedrag in, bijvoorbeeld 12,50.", "validation");
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  if (cents <= 0) throw new DeclarationError(400, "Het bedrag moet groter zijn dan nul.", "validation");
  if (cents > MAX_AMOUNT_CENTS) throw new DeclarationError(400, "Dit bedrag is te hoog voor een declaratie in Ringtools (maximaal € 50.000).", "validation");
  return cents;
}

export type DeclarationInput = {
  clientRequestId: unknown;
  ringId: unknown;
  unitId?: unknown;
  ringDirectConfirmed?: unknown;
  organization: unknown;
  approverName: unknown;
  approvalConfirmed: unknown;
  forWhom: unknown;
  payeeName: unknown;
  amount: unknown;
  description: unknown;
  notes?: unknown;
  files: unknown;
};

export async function submitDeclaration(userId: string, input: DeclarationInput): Promise<{ id: string; created: boolean }> {
  assertDeclarationsEnabled();
  const owner = await prisma.user.findUnique({ where: { id: userId } });
  if (!owner || !owner.active || owner.accountKind !== "NORMAL" || owner.role === "ADMIN") throw new DeclarationError(403, "Dit account kan geen declaraties indienen.", "forbidden");
  if (!rateLimit(`declaration-submit:${userId}`, 20, 60 * 60 * 1000).allowed) throw new DeclarationError(429, "Je hebt zojuist veel declaraties ingediend. Probeer het later opnieuw.", "rate-limited");

  const clientRequestId = typeof input.clientRequestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input.clientRequestId) ? input.clientRequestId : null;
  if (!clientRequestId) throw new DeclarationError(400, "Ongeldig verzoek.", "validation");
  const ringId = text(input.ringId, 64);
  const unitId = input.unitId ? text(input.unitId, 64) : null;
  if (!ringId) throw new DeclarationError(400, "Kies voor welke ring, wijk of gemeente je declareert.", "validation");
  if (input.approvalConfirmed !== true) throw new DeclarationError(400, "Bevestig dat de uitgave vooraf is goedgekeurd.", "validation");
  if (!unitId && input.ringDirectConfirmed !== true) throw new DeclarationError(400, "Bevestig dat deze declaratie voor de ring is en niet voor je wijk of gemeente.", "ring-confirmation-required");

  const sealedPayload: Sealed = {
    organization: req(input.organization, "de organisatie", 120),
    approverName: req(input.approverName, "wie vooraf toestemming heeft gegeven", 120),
    forWhom: req(input.forWhom, "voor wie de declaratie is", 120),
    payeeName: req(input.payeeName, "aan wie het geld moet worden overgemaakt", 120),
    description: req(input.description, "een korte omschrijving", 500),
    notes: text(input.notes, 2000),
  };
  if (sealedPayload.notes.length > 2000) throw new DeclarationError(400, "De notities zijn te lang (maximaal 2000 tekens).", "validation");
  const amountCents = parseAmountCents(input.amount);
  let files;
  try {
    files = validateFiles(input.files);
  } catch (err) {
    if (err instanceof FileValidationError) throw new DeclarationError(400, err.message, "attachment");
    throw err;
  }

  // Idempotent: een herhaald verzoek (bv. na een netwerkfout) geeft dezelfde declaratie terug.
  const existing = await prisma.declaration.findUnique({ where: { ownerId_clientRequestId: { ownerId: userId, clientRequestId } }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };

  const ring = await prisma.ring.findFirst({ where: { id: ringId, active: true, isDemo: false }, select: { id: true, name: true } });
  if (!ring) throw new DeclarationError(404, "Deze ring bestaat niet.", "not-found");
  let unitName: string | null = null;
  if (unitId) {
    const unit = await prisma.ringUnit.findFirst({ where: { id: unitId, ringId, active: true }, select: { name: true } });
    if (!unit) throw new DeclarationError(404, "Deze wijk of gemeente bestaat niet in deze ring.", "not-found");
    unitName = unit.name;
  }
  const activation = await activationFor(ringId, unitId);
  if (!activation.activated) throw new DeclarationError(409, NOT_ACTIVATED_MESSAGE, "not-activated");

  const id = randomUUID();
  try {
    await prisma.$transaction(async (tx) => {
      // Activering opnieuw controleren binnen de transactie (een functionaris kan gelijktijdig zijn ingetrokken).
      if (!(await activationFor(ringId, unitId, tx)).activated) throw new DeclarationError(409, NOT_ACTIVATED_MESSAGE, "not-activated");
      await tx.declaration.create({
        data: { id, clientRequestId, ownerId: userId, ownerName: owner.name, ringId, unitId, ringName: ring.name, unitName, amountCents, sealed: bytes(sealJson(sealedPayload, sealAad(id))) },
      });
      for (const [position, f] of files.entries()) {
        const attId = randomUUID();
        await tx.declarationAttachment.create({ data: { id: attId, declarationId: id, position, fileName: f.fileName, mimeType: f.mime, sizeBytes: f.bytes.length, sha256: f.sha256, data: bytes(seal(f.bytes, attachmentAad(attId))) } });
      }
      await tx.declarationStatusEvent.create({ data: { declarationId: id, toStatus: "SUBMITTED", actorId: userId } });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const again = await prisma.declaration.findUnique({ where: { ownerId_clientRequestId: { ownerId: userId, clientRequestId } }, select: { id: true } });
      if (again) return { id: again.id, created: false };
    }
    throw err;
  }
  return { id, created: true };
}

// ---- Weergave ----

type Row = Pick<Declaration, "id" | "ownerName" | "ringId" | "unitId" | "ringName" | "unitName" | "amountCents" | "status" | "sealed" | "submittedAt" | "seenAt" | "processedAt">;

export type DeclarationListItem = import("@shared/api-types").DeclarationListItem;

function toItem(r: Row): DeclarationListItem {
  const s = openJson<Sealed>(r.sealed, sealAad(r.id));
  return { id: r.id, status: r.status, statusLabel: STATUS_LABELS[r.status], amountCents: r.amountCents, ringName: r.ringName, unitName: r.unitName, ownerName: r.ownerName, organization: s.organization, description: s.description, submittedAt: r.submittedAt.toISOString(), seenAt: r.seenAt?.toISOString() ?? null, processedAt: r.processedAt?.toISOString() ?? null };
}

const listSelect = { id: true, ownerName: true, ringId: true, unitId: true, ringName: true, unitName: true, amountCents: true, status: true, sealed: true, submittedAt: true, seenAt: true, processedAt: true } as const;

export async function listMine(userId: string): Promise<DeclarationListItem[]> {
  assertDeclarationsEnabled();
  const rows = await prisma.declaration.findMany({ where: { ownerId: userId }, orderBy: { submittedAt: "desc" }, take: 200, select: listSelect });
  return rows.map(toItem);
}

/** Wat een gebruiker als functionaris mag zien: alleen declaraties binnen de eigen scope (nooit zijn eigen declaraties als administrateur). */
function scopeWhere(userId: string, scopes: Scope[]): Prisma.DeclarationWhereInput | null {
  const or: Prisma.DeclarationWhereInput[] = [];
  for (const s of scopes) {
    if (s.role === "ADMIN" || s.role === "SUBADMIN") or.push({ ringId: s.ringId, unitId: s.unitId });
    else if (s.role === "RING_PRESIDENT_READ" && s.unitId === null) or.push({ ringId: s.ringId });
  }
  if (!or.length) return null;
  return { OR: or, NOT: { ownerId: userId } };
}

export async function listForOfficial(userId: string, filter: { status?: unknown } = {}): Promise<{ items: DeclarationListItem[]; roles: { administer: boolean; president: boolean } }> {
  assertDeclarationsEnabled();
  const scopes = await loadScopes(userId);
  const where = scopeWhere(userId, scopes);
  const roles = { administer: scopes.some((s) => s.role === "ADMIN" || s.role === "SUBADMIN"), president: scopes.some((s) => s.role === "RING_PRESIDENT_READ") };
  if (!where) return { items: [], roles };
  const status = typeof filter.status === "string" && filter.status in STATUS_LABELS ? (filter.status as DeclarationStatus) : undefined;
  const rows = await prisma.declaration.findMany({ where: { AND: [where, status ? { status } : {}] }, orderBy: { submittedAt: "desc" }, take: 300, select: listSelect });
  return { items: rows.map(toItem), roles };
}

export type DeclarationDetail = import("@shared/api-types").DeclarationDetail;

async function resolveAccess(userId: string, d: { ownerId: string | null; ringId: string; unitId: string | null }): Promise<"owner" | "administrator" | "president" | null> {
  if (d.ownerId === userId) return "owner";
  const scopes = await loadScopes(userId);
  if (canAdminister(scopes, d)) return "administrator";
  if (canReadAsPresident(scopes, d)) return "president";
  return null;
}

/**
 * Opent een declaratie. Voor de eigenaar is dit gewone inzage. Een bevoegde administrateur die de declaratie opent legt daarmee "gezien" vast (status +
 * tijdstempel, één keer). De ringpresident leest alleen: dat verandert de status nooit en wordt in een apart toegangslog vastgelegd.
 * Onbevoegden krijgen "niet gevonden" (geen bestaansinformatie).
 */
export async function openDeclaration(userId: string, id: string): Promise<DeclarationDetail> {
  assertDeclarationsEnabled();
  const base = await prisma.declaration.findUnique({ where: { id }, select: { ownerId: true, ringId: true, unitId: true } });
  const role = base ? await resolveAccess(userId, base) : null;
  if (!base || !role) throw new DeclarationError(404, "Deze declaratie bestaat niet.", "not-found");

  if (role === "administrator") {
    await prisma.$transaction(async (tx) => {
      const seen = await tx.declaration.updateMany({ where: { id, status: "SUBMITTED" }, data: { status: "SEEN", seenAt: new Date(), seenById: userId } });
      if (seen.count === 1) await tx.declarationStatusEvent.create({ data: { declarationId: id, fromStatus: "SUBMITTED", toStatus: "SEEN", actorId: userId } });
      await tx.declarationAccessLog.create({ data: { declarationId: id, userId, kind: "VIEW_ADMIN" } });
    });
  } else if (role === "president") {
    await prisma.declarationAccessLog.create({ data: { declarationId: id, userId, kind: "VIEW_PRESIDENT" } });
  }
  const d = await prisma.declaration.findUniqueOrThrow({ where: { id }, include: { attachments: { orderBy: { position: "asc" }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } }, events: { orderBy: { createdAt: "asc" } } } });
  const s = openJson<Sealed>(d.sealed, sealAad(d.id));
  return {
    ...toItem(d),
    viewerRole: role,
    approverName: s.approverName, forWhom: s.forWhom, payeeName: s.payeeName, notes: s.notes,
    attachments: d.attachments,
    history: d.events.map((e) => ({ fromStatus: e.fromStatus, toStatus: e.toStatus, toLabel: STATUS_LABELS[e.toStatus], at: e.createdAt.toISOString(), note: role === "president" ? null : e.note, byOwner: e.actorId === d.ownerId })),
    canProcess: role === "administrator" && d.status !== "PROCESSED" && d.status !== "REJECTED",
  };
}

export async function downloadAttachment(userId: string, declarationId: string, attachmentId: string): Promise<{ fileName: string; mimeType: string; bytes: Buffer }> {
  assertDeclarationsEnabled();
  const att = await prisma.declarationAttachment.findFirst({ where: { id: attachmentId, declarationId }, include: { declaration: { select: { ownerId: true, ringId: true, unitId: true } } } });
  const role = att ? await resolveAccess(userId, att.declaration) : null;
  if (!att || !role) throw new DeclarationError(404, "Deze bijlage bestaat niet.", "not-found");
  if (role !== "owner") await prisma.declarationAccessLog.create({ data: { declarationId, userId, kind: "DOWNLOAD", detail: role } });
  let bytes: Buffer;
  try {
    bytes = open(att.data, attachmentAad(att.id));
  } catch {
    throw new DeclarationError(500, "Deze bijlage kan niet worden gelezen.", "server");
  }
  return { fileName: att.fileName, mimeType: att.mimeType, bytes };
}

// ---- Statusverwerking (alleen bevoegde administrateurs) ----

const TRANSITIONS: Record<DeclarationStatus, DeclarationStatus[]> = {
  SUBMITTED: ["IN_PROGRESS", "NEEDS_INFO", "PROCESSED", "REJECTED"],
  SEEN: ["IN_PROGRESS", "NEEDS_INFO", "PROCESSED", "REJECTED"],
  IN_PROGRESS: ["NEEDS_INFO", "PROCESSED", "REJECTED"],
  NEEDS_INFO: ["IN_PROGRESS", "PROCESSED", "REJECTED"],
  PROCESSED: [],
  REJECTED: [],
};

export async function setStatus(userId: string, id: string, to: unknown, noteInput?: unknown): Promise<DeclarationStatus> {
  assertDeclarationsEnabled();
  if (typeof to !== "string" || !(to in STATUS_LABELS) || to === "SUBMITTED" || to === "SEEN") throw new DeclarationError(400, "Deze status kan niet handmatig worden gezet.", "validation");
  const target = to as DeclarationStatus;
  const note = text(noteInput, 500);
  if (note.length > 500) throw new DeclarationError(400, "De toelichting is te lang (maximaal 500 tekens).", "validation");
  if ((target === "NEEDS_INFO" || target === "REJECTED") && note.length < 5) throw new DeclarationError(400, "Geef een korte toelichting (minstens 5 tekens) voor de declarant.", "note-required");

  const base = await prisma.declaration.findUnique({ where: { id }, select: { ownerId: true, ringId: true, unitId: true } });
  const role = base ? await resolveAccess(userId, base) : null;
  if (!base || !role) throw new DeclarationError(404, "Deze declaratie bestaat niet.", "not-found");
  if (role !== "administrator") throw new DeclarationError(403, "Alleen een bevoegde financieel administrateur kan de status wijzigen.", "forbidden");

  return prisma.$transaction(async (tx) => {
    const cur = await tx.declaration.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (!TRANSITIONS[cur.status].includes(target)) throw new DeclarationError(409, "Deze statuswijziging is niet mogelijk.", "invalid-transition");
    const done = await tx.declaration.updateMany({ where: { id, status: cur.status }, data: { status: target, processedAt: target === "PROCESSED" || target === "REJECTED" ? new Date() : null } });
    if (done.count !== 1) throw new DeclarationError(409, "De declaratie is zojuist gewijzigd. Vernieuw en probeer opnieuw.", "conflict");
    await tx.declarationStatusEvent.create({ data: { declarationId: id, fromStatus: cur.status, toStatus: target, actorId: userId, note: note || null } });
    return target;
  });
}
