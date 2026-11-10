import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { AuthorizationError } from "./workflow";
import { createDraft, submitDraft } from "./proposals";
import { castVote, releaseToHogeraad, completeTask, markProcessed } from "./workflow";

export const REVIEW_ACCOUNTS = [
  { name: "Apple Review 1", email: "apple.review1@ringtools.invalid", role: "RINGPRESIDIUM", churchFunctionCode: "RINGPRESIDENT" },
  { name: "Apple Review 2", email: "apple.review2@ringtools.invalid", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID" },
  { name: "Apple Review 3", email: "apple.review3@ringtools.invalid", role: "RINGSECRETARIS", churchFunctionCode: "RINGSECRETARIS" },
] as const;
const DEMO_KEY = "apple-review"; // Beheermarker, geen tenant-ID en nooit onderdeel van de appautorisatie.
export class ReviewManagementError extends Error {}
export async function requireSystemAdmin(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  if (!actor?.active || actor.role !== "ADMIN" || actor.accountKind !== "NORMAL") throw new AuthorizationError();
  return actor;
}
function validatePassword(password: string) {
  if (password.length < 20 || Buffer.byteLength(password, "utf8") > 72) throw new ReviewManagementError("Gebruik per account een uniek wachtwoord van minimaal 20 tekens en maximaal 72 UTF-8-bytes.");
}
/** Alleen het afgeschermde webbeheer roept dit na recente beheerders-MFA aan. Wachtwoorden worden nooit teruggegeven. */
export async function provisionReviewDemo(actorId: string, passwords: string[]) {
  if (passwords.length !== 3) throw new ReviewManagementError("Er zijn drie wachtwoordvelden nodig.");
  for (const p of passwords) if (p) validatePassword(p);
  const hashes = await Promise.all(passwords.map(p => p ? bcrypt.hash(p, 12) : null));
  return prisma.$transaction(async tx => {
    await requireSystemAdmin(tx, actorId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ringtools:review-provision', 0))`;
    let ring = await tx.ring.findUnique({ where: { demoKey: DEMO_KEY } });
    if (!ring) {
      if (await tx.ring.findUnique({ where: { name: "Ringtools Demo" } })) throw new ReviewManagementError("Die ringnaam bestaat al. Een bestaande ring wordt nooit in een demo omgezet.");
      ring = await tx.ring.create({ data: { name: "Ringtools Demo", isDemo: true, demoKey: DEMO_KEY } });
    }
    if (!ring.isDemo) throw new ReviewManagementError("Ongeldige demo-inrichting; er is niets gewijzigd.");
    for (let i = 0; i < REVIEW_ACCOUNTS.length; i++) {
      const spec = REVIEW_ACCOUNTS[i]; const hash = hashes[i];
      let user = await tx.user.findUnique({ where: { email: spec.email }, include: { reviewCredential: true } });
      if (user && (user.accountKind !== "REVIEW" || user.reviewRingId !== ring.id)) throw new ReviewManagementError("Een bestaand gewoon account wordt nooit overgenomen.");
      if (!user && !hash) throw new ReviewManagementError("Vul voor elk nieuw reviewaccount een wachtwoord in.");
      if (!user) user = await tx.user.create({ data: { name: spec.name, email: spec.email, role: spec.role, accountKind: "REVIEW", reviewRingId: ring.id, emailNotificationsEnabled: false, activatedAt: new Date() }, include: { reviewCredential: true } });
      await tx.ringMembership.upsert({ where: { userId_ringId: { userId: user.id, ringId: ring.id } },
        create: { userId: user.id, ringId: ring.id, role: spec.role, churchFunction: spec.name, churchFunctionCode: spec.churchFunctionCode, isRingManager: false },
        update: { role: spec.role, churchFunctionCode: spec.churchFunctionCode, isRingManager: false, active: hash ? true : user.active } });
      if (hash) {
        await tx.user.update({ where: { id: user.id }, data: { active: true } });
        await tx.reviewCredential.upsert({ where: { userId: user.id }, create: { userId: user.id, passwordHash: hash }, update: { passwordHash: hash, failedAttempts: 0, lockedUntil: null } });
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.trustedDevice.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date(), loginEnabledAt: null } });
        await tx.securityEvent.create({ data: { userId: user.id, actorUserId: actorId, type: "REVIEW_PASSWORD_CHANGED" } });
      }
    }
    await tx.securityEvent.create({ data: { userId: actorId, type: "DEMO_PROVISIONED" } });
    return { ringId: ring.id };
  });
}
export async function setReviewAccountActive(actorId: string, userId: string, active: boolean) {
  await prisma.$transaction(async tx => {
    await requireSystemAdmin(tx, actorId);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (u?.accountKind !== "REVIEW") throw new ReviewManagementError("Dit is geen reviewaccount.");
    await tx.user.update({ where: { id: userId }, data: { active } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.securityEvent.create({ data: { userId, actorUserId: actorId, type: "REVIEW_DISABLED", detail: active ? "opnieuw beschikbaar" : "ingetrokken" } });
  });
}
/** Reset uitsluitend de gemarkeerde demo. De inhoud wordt via gewone domeintransities opgebouwd. */
export async function resetReviewDemo(actorId: string) {
  const state = await prisma.$transaction(async tx => {
    await requireSystemAdmin(tx, actorId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ringtools:review-provision', 0))`;
    const ring = await tx.ring.findUnique({ where: { demoKey: DEMO_KEY } });
    if (!ring?.isDemo || ring.name !== "Ringtools Demo") throw new ReviewManagementError("Geen geldige demoring. Provisioning is eerst nodig.");
    await tx.$queryRaw`SELECT id FROM "User" WHERE "reviewRingId"=${ring.id} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Ring" WHERE id=${ring.id} FOR UPDATE`;
    if (ring.demoResetting) throw new ReviewManagementError("Een demoherstel loopt al. Probeer het later opnieuw.");
    await tx.ring.update({ where: { id: ring.id }, data: { demoResetting: true, active: true } });
    const users = await tx.user.findMany({ where: { accountKind: "REVIEW", reviewRingId: ring.id }, orderBy: { email: "asc" } });
    if (users.length !== 3 || users.some((u,i) => u.email !== REVIEW_ACCOUNTS[i].email || !u.active)) throw new ReviewManagementError("Maak de drie reviewaccounts eerst beschikbaar via provisioning.");
    if (await tx.ringMembership.count({ where: { ringId: ring.id, user: { accountKind: { not: "REVIEW" } } } })) throw new ReviewManagementError("De demo bevat een onverwacht account; reset geweigerd.");
    await tx.session.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
    await tx.callingDraft.deleteMany({ where: { ringId: ring.id } });
    await tx.ontheffing.deleteMany({ where: { ringId: ring.id } });
    await tx.calling.deleteMany({ where: { ringId: ring.id } });
    await tx.notification.deleteMany({ where: { ringId: ring.id } });
    await tx.ringInvitation.deleteMany({ where: { ringId: ring.id } });
    await tx.accountDeletionRequest.deleteMany({ where: { userId: { in: users.map(u => u.id) } } });
    await tx.ringCustomCalling.deleteMany({ where: { ringId: ring.id } });
    await tx.ringUnit.deleteMany({ where: { ringId: ring.id } });
    const unit = await tx.ringUnit.create({ data: { ringId: ring.id, name: "Demowijk (fictief)", kind: "WIJK", responsibleUserId: users[1].id } });
    const fn = await tx.ringCustomCalling.create({ data: { ringId: ring.id, name: "Demo-roeping (fictief)", category: "Demonstratie" } });
    await tx.securityEvent.create({ data: { userId: actorId, type: "DEMO_RESET" } });
    return { ringId: ring.id, unitId: unit.id, functionId: fn.id, users };
  });
  try {
  const [presidium, council, secretary] = state.users;
  for (let step = 0; step < 8; step++) {
    const draft = await createDraft(presidium.id, state.ringId, { personName: `Fictieve Demopersoon ${step + 1}`, unitId: state.unitId, functionSource: "STANDAARD", functionCode: "ringadministrateur",
      roepenAssigneeId: presidium.id, ondersteunenAssigneeId: council.id, aanstellenAssigneeId: presidium.id, procedureConfirmed: true });
    if (step === 0) continue;
    const { calling } = await submitDraft(presidium.id, draft.id);
    if (step === 1) continue;
    await castVote({ callingId: calling.id, userId: presidium.id, support: true });
    if (step === 2) continue;
    await releaseToHogeraad({ callingId: calling.id, actorId: presidium.id });
    if (step === 3) continue;
    await castVote({ callingId: calling.id, userId: council.id, support: step !== 4 });
    if (step <= 5) continue;
    for (const task of ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as const) {
      await completeTask({ callingId: calling.id, task, doneById: task === "ONDERSTEUNEN" ? council.id : presidium.id, doneAt: new Date(), ondersteunenContext: "AVONDMAALSVERGADERING" });
    }
    if (step === 7) await markProcessed({ callingId: calling.id, processedById: secretary.id });
  }
  const o = await import("./ontheffingen");
  for (let step = 0; step < 7; step++) {
    const dossier = await o.createConcept(presidium.id, state.ringId, {
      unitId: state.unitId, functionSource: "STANDAARD", functionCode: "ringadministrateur",
      persons: [{ role: "HOOFD", name: `Fictieve Ontheffingspersoon ${step + 1}`, accountMode: "GEEN_ACCOUNT" }],
    });
    if (step === 0) continue;
    await o.submitOntheffing(presidium.id, dossier.id);
    if (step === 1) continue;
    await o.castOntheffingVote(presidium.id, dossier.id, true);
    if (step === 2) continue;
    await o.releaseOntheffingToHogeraad(presidium.id, dossier.id);
    if (step === 3) continue;
    await o.castOntheffingVote(council.id, dossier.id, step !== 4);
    if (step <= 5) continue;
    const person = await prisma.ontheffingPerson.findFirstOrThrow({ where: { ontheffingId: dossier.id, role: "HOOFD" } });
    await o.markInformed(secretary.id, person.id);
    await o.registerAnnouncement(secretary.id, person.id, { thanksOffered: true });
    await o.processPerson(secretary.id, person.id);
  }
  await prisma.ring.update({ where: { id: state.ringId }, data: { demoResetting: false } });
  return { ringId: state.ringId };
  } catch (err) {
    await prisma.ring.update({ where: { id: state.ringId }, data: { active: false, demoResetting: false } });
    throw err; // Een mislukte seed blijft afgeschermd. De beheerder kan veilig opnieuw proberen.
  }
}
