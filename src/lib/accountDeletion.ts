import { randomInt, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { generateRawToken, hashToken } from "./crypto";
import { rateLimit } from "./rateLimit";
import { loginCodeEmail, sendMail } from "./mailer";
import { requireSystemAdmin } from "./reviewDemo";

const DAY = 86400000;
export const DELETION_TARGET_DAYS = 14; // Operationele streeftermijn, geen verzonnen wettelijke bewaartermijn.
export class AccountDeletionError extends Error {}
const view = (r: { id: string; status: string; requestedAt: Date; dueAt: Date; completedAt: Date | null; blockerCount: number }) => ({
  id: r.id, status: r.status, requestedAt: r.requestedAt.toISOString(), dueAt: r.dueAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null, blockerCount: r.blockerCount,
});
async function requestInTx(tx: Prisma.TransactionClient, userId: string, verifiedEmail?: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user || user.accountKind === "AUDIT" || user.role === "ADMIN") throw new AccountDeletionError("Dit account kan niet via deze procedure worden verwijderd. Het laatste systeembeheeraccount blijft beschermd.");
  if (verifiedEmail && user.email.trim().toLowerCase() !== verifiedEmail) throw new AccountDeletionError("Het geverifieerde adres is gewijzigd. Vraag een nieuwe code aan.");
  const receipt = generateRawToken();
  const r = await tx.accountDeletionRequest.upsert({ where: { userId }, create: { userId, receiptHash: hashToken(receipt), dueAt: new Date(Date.now() + DELETION_TARGET_DAYS * DAY) }, update: { receiptHash: hashToken(receipt) } });
  await tx.securityEvent.create({ data: { userId, type: "ACCOUNT_DELETION_REQUESTED" } });
  return { request: view(r), receipt };
}
/** Verzoek betreft het volledige account, dus alle ringen, niet slechts het gekozen lidmaatschap. */
export async function requestAccountDeletion(userId: string) {
  return prisma.$transaction(tx => requestInTx(tx, userId));
}
export async function getAccountDeletionStatus(userId: string) {
  const row = await prisma.accountDeletionRequest.findUnique({ where: { userId } });
  return row ? view(row) : null;
}
export async function getDeletionReceiptStatus(receipt: string) {
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(receipt)) return null;
  const row = await prisma.accountDeletionRequest.findUnique({ where: { receiptHash: hashToken(receipt) } });
  return row ? view(row) : null; // Geen naam, adres, ring of dossiergegevens op het ontvangstbewijs.
}
/** Ook gedeactiveerde gebruikers kunnen hun verzoek in de app/website starten; dit geeft GEEN sessie of toegang. */
export async function sendDeletionCode(email: string, clientKey: string) {
  email = email.trim().toLowerCase();
  if (!rateLimit(`deletion-mail:${email}`, 5, 15 * 60000).allowed || !rateLimit(`deletion-ip:${clientKey}`, 20, 15 * 60000).allowed) throw new AccountDeletionError("Te veel aanvragen. Probeer het later opnieuw.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.role === "ADMIN" || user.accountKind !== "NORMAL") return;
  const id = randomUUID(); const code = String(randomInt(0, 100000000)).padStart(8, "0");
  await prisma.accountDeletionChallenge.create({ data: { id, userId: user.id, emailSnapshot: email, codeHash: hashToken(`deletion:${id}:${code}`), expiresAt: new Date(Date.now() + 15 * 60000) } });
  try { const mail = loginCodeEmail(user.name, code); await sendMail({ to: user.email, subject: "Ringtools – bevestig je verwijderverzoek", text: mail.text.replace("inlogcode", "bevestigingscode voor accountverwijdering") }); }
  catch { await prisma.accountDeletionChallenge.deleteMany({ where: { id } }); }
}
export async function confirmDeletionCode(email: string, code: string, clientKey: string) {
  email = email.trim().toLowerCase();
  if (!/^\d{8}$/.test(code) || !rateLimit(`deletion-confirm:${clientKey}:${email}`, 10, 15 * 60000).allowed) return null;
  const candidates = await prisma.accountDeletionChallenge.findMany({ where: { emailSnapshot: email, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, orderBy: { createdAt: "desc" }, take: 3 });
  const match = candidates.find(c => c.codeHash === hashToken(`deletion:${c.id}:${code}`));
  if (!match) { await prisma.accountDeletionChallenge.updateMany({ where: { id: { in: candidates.map(c => c.id) } }, data: { attempts: { increment: 1 } } }); return null; }
  return prisma.$transaction(async tx => {
    const u = await tx.user.findUnique({ where: { id: match.userId } });
    if (!u || u.email.trim().toLowerCase() !== email || u.accountKind !== "NORMAL" || u.role === "ADMIN") return null;
    const claimed = await tx.accountDeletionChallenge.updateMany({ where: { id: match.id, usedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) return null;
    return requestInTx(tx, u.id, email);
  });
}
export type DeletionBlocker = { kind: string; count: number };
async function blockersFor(tx: Prisma.TransactionClient, userId: string): Promise<DeletionBlocker[]> {
  const issues: DeletionBlocker[] = [];
  const managed = await tx.ringMembership.findMany({ where: { userId, active: true, isRingManager: true, ring: { isDemo: false } } });
  for (const m of managed) {
    await tx.$queryRaw`SELECT id FROM "Ring" WHERE id=${m.ringId} FOR UPDATE`;
    if (!(await tx.ringMembership.count({ where: { ringId: m.ringId, userId: { not: userId }, active: true, isRingManager: true, user: { active: true } } }))) issues.push({ kind: "LAST_RING_MANAGER", count: 1 });
  }
  const tasks = await tx.calling.count({ where: { status: { not: "PROCESSED" }, OR: [
    { roepenAssigneeId: userId, roepenDoneAt: null }, { ondersteunenAssigneeId: userId, ondersteunenDoneAt: null }, { aanstellenAssigneeId: userId, aanstellenDoneAt: null },
  ] } });
  if (tasks) issues.push({ kind: "OPEN_TASKS", count: tasks });
  const voting = ["PRESIDIUM_VOTING", "PRESIDIUM_PAUSED", "HOGERAAD_VOTING", "HOGERAAD_PAUSED"] as const;
  const rounds = await tx.eligibleVoter.count({ where: { userId, calling: { status: { in: [...voting] } } } });
  if (rounds) issues.push({ kind: "ACTIVE_ROUNDS", count: rounds });
  const confidential = await tx.ontheffing.count({ where: { status: { not: "PROCESSED" }, OR: [{ persons: { some: { userId } } }, { voters: { some: { userId } } }] } });
  if (confidential) issues.push({ kind: "ACTIVE_CONFIDENTIAL_PROCESSES", count: confidential });
  return issues;
}
/** Compleet account wissen. Open verantwoordelijkheid moet eerst via de bestaande workflow worden overgedragen. */
export async function completeAccountDeletion(actorId: string, requestId: string, opts: { identityChecked: boolean; retentionReason?: string }) {
  return prisma.$transaction(async tx => {
    await requireSystemAdmin(tx, actorId);
    const request = await tx.accountDeletionRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AccountDeletionError("Verzoek niet gevonden.");
    if (request.status === "COMPLETED") return { completed: true, blockers: [] as DeletionBlocker[] };
    if (!request.userId || !opts.identityChecked) throw new AccountDeletionError("Controleer eerst het verzoek en de identiteit.");
    const userId = request.userId;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    if ((await tx.accountDeletionRequest.findUnique({ where: { id: requestId } }))?.status === "COMPLETED") return { completed: true, blockers: [] as DeletionBlocker[] };
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === "ADMIN" || user.accountKind === "AUDIT") throw new AccountDeletionError("Systeembeheeraccounts worden niet via deze procedure verwijderd.");
    const blockers = await blockersFor(tx, userId);
    if (blockers.length) {
      await tx.accountDeletionRequest.update({ where: { id: requestId }, data: { status: "BLOCKED", blockerCount: blockers.reduce((n,b) => n+b.count, 0), reviewedAt: new Date(), handledById: actorId } });
      return { completed: false, blockers };
    }
    const references = await Promise.all([
      tx.calling.count({ where: { createdById: userId } }), tx.vote.count({ where: { userId } }), tx.eligibleVoter.count({ where: { userId } }),
      tx.groupDecision.count({ where: { registeredById: userId } }), tx.callingAudit.count({ where: { actorId: userId } }),
      tx.ontheffing.count({ where: { createdById: userId } }), tx.ontheffingDecision.count({ where: { registeredById: userId } }), tx.ontheffingAudit.count({ where: { actorId: userId } }),
      tx.ontheffingVoter.count({ where: { userId } }), tx.ontheffingVote.count({ where: { userId } }),
      tx.groupDecision.count({ where: { OR: [{ presentUserIds: { has: userId } }, { absentUserIds: { has: userId } }] } }),
      tx.ontheffingDecision.count({ where: { OR: [{ presentUserIds: { has: userId } }, { absentUserIds: { has: userId } }] } }),
    ]);
    const hasHistory = references.some(Boolean);
    const retentionReason = opts.retentionReason?.trim() ?? "";
    if (hasHistory && retentionReason.length < 30) throw new AccountDeletionError("Historische procesregistraties vereisen een daadwerkelijk vastgestelde grondslag en een concrete motivering; verzin geen bewaarplicht. Los dit eerst op met de verwerkingsverantwoordelijke.");
    // Een nieuw, niet-authenticeerbaar auditobject vervangt de identiteit; het oorspronkelijke account wordt echt verwijderd.
    const audit = hasHistory ? await tx.user.create({ data: { accountKind: "AUDIT", name: "Verwijderde gebruiker", email: `audit-${randomUUID()}@accounts.invalid`, role: "HOGERAAD", active: false, emailNotificationsEnabled: false } }) : null;
    if (audit) {
      await tx.calling.updateMany({ where: { createdById: userId }, data: { createdById: audit.id } });
      await tx.vote.updateMany({ where: { userId }, data: { userId: audit.id } });
      await tx.eligibleVoter.updateMany({ where: { userId }, data: { userId: audit.id } });
      await tx.groupDecision.updateMany({ where: { registeredById: userId }, data: { registeredById: audit.id, note: null, resolutionNote: null } });
      await tx.callingAudit.updateMany({ where: { actorId: userId }, data: { actorId: audit.id, detail: null } });
      await tx.ontheffing.updateMany({ where: { createdById: userId }, data: { createdById: audit.id } });
      await tx.ontheffingDecision.updateMany({ where: { registeredById: userId }, data: { registeredById: audit.id, note: null, resolutionNote: null } });
      await tx.ontheffingAudit.updateMany({ where: { actorId: userId }, data: { actorId: audit.id, detail: null } });
      await tx.ontheffingVoter.updateMany({ where: { userId }, data: { userId: audit.id } });
      await tx.ontheffingVote.updateMany({ where: { userId }, data: { userId: audit.id } });
      // Tabel- en kolomnamen zijn vaste broncode, nooit afkomstig uit een verzoek.
      for (const table of ["GroupDecision", "OntheffingDecision"]) for (const column of ["presentUserIds", "absentUserIds"]) {
        await tx.$executeRawUnsafe(`UPDATE "${table}" SET "${column}"=array_replace("${column}", $1, $2) WHERE $1=ANY("${column}")`, userId, audit.id);
      }
    }
    await tx.callingDraft.deleteMany({ where: { createdById: userId } });
    for (const field of ["roepenAssigneeId", "ondersteunenAssigneeId", "aanstellenAssigneeId", "roepenDoneById", "ondersteunenDoneById", "aanstellenDoneById", "processedById", "hogeraadReleasedById", "procedureConfirmedById"] as const) {
      await tx.calling.updateMany({ where: { [field]: userId }, data: { [field]: null } });
    }
    for (const field of ["roepenAssigneeId", "ondersteunenAssigneeId", "aanstellenAssigneeId"] as const) await tx.callingDraft.updateMany({ where: { [field]: userId }, data: { [field]: null } });
    await tx.groupDecision.updateMany({ where: { presidingUserId: userId }, data: { presidingUserId: null } });
    await tx.ontheffingDecision.updateMany({ where: { presidingUserId: userId }, data: { presidingUserId: null } });
    await tx.ontheffing.updateMany({ where: { hogeraadReleasedById: userId }, data: { hogeraadReleasedById: null } });
    await tx.ontheffingPerson.updateMany({ where: { userId }, data: { userId: null, name: null, accountMode: "GEEN_ACCOUNT" } });
    for (const field of ["informedById", "announcedById", "processedById"] as const) await tx.ontheffingPerson.updateMany({ where: { [field]: userId }, data: { [field]: null } });
    await tx.ringInvitation.deleteMany({ where: { email: { equals: user.email.trim(), mode: "insensitive" } } });
    await tx.ringInvitation.updateMany({ where: { createdById: userId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.ringInvitationAudit.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null, detail: null } });
    await tx.securityEvent.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null, detail: null } });
    await tx.trustedDevice.updateMany({ where: { revokedById: userId }, data: { revokedById: null } });
    // Cascade verwijdert sessies, credentials, pushregistraties, lidmaatschappen en eigen meldingen.
    await tx.user.delete({ where: { id: userId } });
    await tx.accountDeletionRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", completedAt: new Date(), handledById: actorId, reviewedAt: new Date(), blockerCount: 0, retentionReason: hasHistory ? retentionReason : null } });
    await tx.securityEvent.create({ data: { userId: actorId, type: "ACCOUNT_DELETION_COMPLETED", detail: requestId } });
    return { completed: true, blockers: [] as DeletionBlocker[] };
  }, { timeout: 20000 });
}

/** Alleen verlopen tijdelijke gegevens en auditobjecten zonder enige procesreferentie. Lopende verzoeken blijven zichtbaar. */
export async function cleanupDeletionData(now = new Date()) {
  await prisma.accountDeletionChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } });
  await prisma.accountDeletionRequest.deleteMany({ where: { status: "COMPLETED", completedAt: { lt: new Date(now.getTime() - 90 * DAY) } } });
  await prisma.user.deleteMany({ where: { accountKind: "AUDIT", active: false,
    createdCallings: { none: {} }, votes: { none: {} }, eligibleVotes: { none: {} },
    groupDecisionsRegistered: { none: {} }, callingAudits: { none: {} },
    ontheffingenCreated: { none: {} }, ontheffingVoterRows: { none: {} }, ontheffingVotes: { none: {} },
    ontheffingDecisionsBy: { none: {} }, ontheffingAudits: { none: {} },
    // Aanwezigheidsarrays behoren altijd bij een van de bovenstaande dossiers. Controleer ze eveneens expliciet.
    id: { notIn: [...new Set((await prisma.groupDecision.findMany({ select: { presentUserIds: true, absentUserIds: true } })).flatMap(d => [...d.presentUserIds, ...d.absentUserIds]).concat((await prisma.ontheffingDecision.findMany({ select: { presentUserIds: true, absentUserIds: true } })).flatMap(d => [...d.presentUserIds, ...d.absentUserIds])))] },
  } });
}
