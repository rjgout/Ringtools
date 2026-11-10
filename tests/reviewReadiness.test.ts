import { beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createTestRing } from "./setup";
import { provisionReviewDemo, resetReviewDemo, setReviewAccountActive } from "@/lib/reviewDemo";
import { loginReviewAccount } from "@/lib/reviewAuth";
import { createVerifiedSession, getSessionUser } from "@/lib/auth";
import { requestAccountDeletion, completeAccountDeletion, getDeletionReceiptStatus } from "@/lib/accountDeletion";
const mail = vi.fn(async () => {});
vi.mock("@/lib/mailer", async original => ({ ...(await original<typeof import("@/lib/mailer")>()), sendMail: (...args: unknown[]) => mail(...args as []) }));
beforeEach(async () => { await resetDatabase(); mail.mockClear(); });
let sequence = 0;
async function world() {
  const admin = await createTestUser("ADMIN", `Beheer ${++sequence}`);
  const passwords = [1,2,3].map(() => randomBytes(24).toString("base64url"));
  const { ringId } = await provisionReviewDemo(admin.id, passwords);
  const users = await prisma.user.findMany({ where: { accountKind: "REVIEW" }, orderBy: { email: "asc" } });
  return { admin, passwords, ringId, users };
}
it("drie expliciete reviewrollen leveren normale intrekbare sessies; gewone gebruikers en webmin kunnen deze wachtwoordroute niet gebruiken", async () => {
  const w = await world();
  expect(w.users.map(u => u.role)).toEqual(["RINGPRESIDIUM", "HOGERAAD", "RINGSECRETARIS"]);
  for (let i=0; i<3; i++) {
    const result = await loginReviewAccount(w.users[i].email, w.passwords[i], `roles-${sequence}-${i}`);
    expect((await getSessionUser(result.token))?.id).toBe(w.users[i].id);
  }
  const ordinary = await createTestUser("HOGERAAD", "Gewoon");
  await expect(loginReviewAccount(ordinary.email, w.passwords[0], "ordinary")).rejects.toMatchObject({ status: 401 });
  await expect(loginReviewAccount(w.admin.email, w.passwords[0], "admin")).rejects.toMatchObject({ status: 401 });
  await expect(loginReviewAccount(w.users[0].email, "onjuist", `bad-${sequence}`)).rejects.toMatchObject({ status: 401 });
});
it("database en API houden demo en gewone ringen gescheiden, ook bij gemanipuleerde verzoeken", async () => {
  const w = await world(); const ring = await createTestRing("Echte testtenant");
  const ordinary = await createTestUser("HOGERAAD", "Gewoon", { ringId: ring.id });
  await expect(prisma.ringMembership.create({ data: { userId: ordinary.id, ringId: w.ringId, role: "HOGERAAD" } })).rejects.toBeTruthy();
  await expect(prisma.ringMembership.create({ data: { userId: w.users[0].id, ringId: ring.id, role: "RINGPRESIDIUM" } })).rejects.toBeTruthy();
  await expect(prisma.user.update({ where: { id: w.users[0].id }, data: { role: "ADMIN" } })).rejects.toBeTruthy();
  const { handleApi } = await import("@/lib/api/router");
  const token = (await loginReviewAccount(w.users[0].email, w.passwords[0], `scope-${sequence}`)).token;
  const res = await handleApi(new Request(`http://localhost/api/mobile/v1/dashboard?ring=${ring.id}`, { headers: { Authorization: `Bearer ${token}` } }), ["dashboard"]);
  expect(res.status).toBe(404);
  const normalToken = (await createVerifiedSession(ordinary.id)).rawToken;
  const denied = await handleApi(new Request(`http://localhost/api/mobile/v1/dashboard?ring=${w.ringId}`, { headers: { Authorization: `Bearer ${normalToken}` } }), ["dashboard"]);
  expect(denied.status).toBe(404);
});
it("wachtwoordwijziging en intrekking beëindigen bestaande reviewsessies", async () => {
  const w = await world(); const result = await loginReviewAccount(w.users[0].email, w.passwords[0], `rotate-${sequence}`);
  const replacement = randomBytes(24).toString("base64url");
  await provisionReviewDemo(w.admin.id, [replacement, "", ""]);
  expect(await getSessionUser(result.token)).toBeNull();
  const next = await loginReviewAccount(w.users[0].email, replacement, `rotate-next-${sequence}`);
  await setReviewAccountActive(w.admin.id, w.users[0].id, false);
  expect(await getSessionUser(next.token)).toBeNull();
});
it("demo reset is herhaalbaar, gebruikt echte workflowtransities en raakt geen andere ring of externe aflevering", async () => {
  const w = await world(); const other = await createTestRing("Blijft bestaan");
  await resetReviewDemo(w.admin.id);
  const before = await prisma.calling.groupBy({ by: ["status"], where: { ringId: w.ringId }, _count: true, orderBy: { status: "asc" } });
  expect(before.map(b => b.status)).toContain("PROCESSED");
  expect(before.map(b => b.status)).toContain("HOGERAAD_PAUSED");
  await resetReviewDemo(w.admin.id);
  expect(await prisma.calling.groupBy({ by: ["status"], where: { ringId: w.ringId }, _count: true, orderBy: { status: "asc" } })).toEqual(before);
  expect(await prisma.ring.findUnique({ where: { id: other.id } })).not.toBeNull();
  expect(mail).not.toHaveBeenCalled();
  expect((await prisma.ring.findUniqueOrThrow({ where: { id: w.ringId } })).demoResetting).toBe(false);
});
it("accountverwijdering wist echt alle lidmaatschappen en sessies, bewaart een privacyarm ontvangstbewijs en beschermt het laatste beheer", async () => {
  const admin = await createTestUser("ADMIN", "Beheerder");
  const u = await createTestUser("HOGERAAD", "Verwijderbaar");
  const extra = await createTestRing("Tweede ring");
  await prisma.ringMembership.create({ data: { userId: u.id, ringId: extra.id, role: "HOGERAAD" } });
  const session = await createVerifiedSession(u.id);
  await prisma.devicePushToken.create({ data: { userId: u.id, token: randomBytes(32).toString("hex"), platform: "ios", provider: "apns" } });
  await prisma.trustedDevice.create({ data: { userId: u.id, label: "Fictief toestel", platform: "IOS", installationId: randomBytes(24).toString("hex"), publicKey: "uitsluitend-synthetische-testregistratie" } });
  await prisma.totpCredential.create({ data: { userId: u.id, secretEncrypted: "synthetische-geen-bruikbare-credential" } });
  const request = await requestAccountDeletion(u.id);
  const again = await requestAccountDeletion(u.id);
  expect(again.request.id).toBe(request.request.id);
  expect((await completeAccountDeletion(admin.id, request.request.id, { identityChecked: true })).completed).toBe(true);
  expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
  expect(await getSessionUser(session.rawToken)).toBeNull();
  expect(await prisma.ringMembership.count({ where: { userId: u.id } })).toBe(0);
  expect(await prisma.devicePushToken.count({ where: { userId: u.id } })).toBe(0);
  expect(await prisma.trustedDevice.count({ where: { userId: u.id } })).toBe(0);
  expect(await prisma.totpCredential.count({ where: { userId: u.id } })).toBe(0);
  expect((await getDeletionReceiptStatus(again.receipt))?.status).toBe("COMPLETED");
  await expect(requestAccountDeletion(admin.id)).rejects.toBeTruthy();
  const manager = await createTestUser("RINGSECRETARIS", "Laatste Beheerder", { isRingManager: true });
  const managed = await requestAccountDeletion(manager.id);
  expect((await completeAccountDeletion(admin.id, managed.request.id, { identityChecked: true })).blockers.map(b => b.kind)).toContain("LAST_RING_MANAGER");
});

it("alleen systeembeheer mag provisioneren, resetten of toegang wijzigen; geen echte ring wordt geadopteerd", async () => {
  const u = await createTestUser("RINGSECRETARIS", "Ringbeheer", { isRingManager: true });
  await expect(provisionReviewDemo(u.id, ["", "", ""])).rejects.toBeTruthy();
  await expect(resetReviewDemo(u.id)).rejects.toBeTruthy();
  await createTestRing("Ringtools Demo");
  const admin = await createTestUser("ADMIN", "Systeembeheer");
  await expect(provisionReviewDemo(admin.id, ["", "", ""])).rejects.toThrow(/nooit/);
  expect(await prisma.user.count({ where: { accountKind: "REVIEW" } })).toBe(0);
});
it("persistente reviewvergrendeling, generieke fouten en audit zonder wachtwoord", async () => {
  const w = await world();
  // Uniek synthetisch reviewadres om onafhankelijke limitergevallen te testen.
  const email = `bruteforce-${sequence}@ringtools.invalid`;
  await prisma.user.update({ where: { id: w.users[2].id }, data: { email } });
  for (let i=0; i<5; i++) await expect(loginReviewAccount(email, "fout", `brute-${i}`)).rejects.toMatchObject({ status: 401 });
  expect((await prisma.reviewCredential.findUniqueOrThrow({ where: { userId: w.users[2].id } })).lockedUntil).not.toBeNull();
  await expect(loginReviewAccount(email, w.passwords[2], "brute-correct")).rejects.toMatchObject({ status: 429 });
  const events = await prisma.securityEvent.findMany({ where: { userId: w.users[2].id, type: "REVIEW_LOGIN_FAILED" } });
  expect(events).toHaveLength(5);
  expect(JSON.stringify(events)).not.toContain(w.passwords[2]);
});
it("reviewsessies verlopen normaal en sluiten tijdens reset of deactivering van de demoring", async () => {
  const w = await world();
  const s = await createVerifiedSession(w.users[0].id);
  await prisma.session.updateMany({ where: { userId: w.users[0].id }, data: { expiresAt: new Date(0) } });
  expect(await getSessionUser(s.rawToken)).toBeNull();
  const current = await createVerifiedSession(w.users[0].id);
  await prisma.ring.update({ where: { id: w.ringId }, data: { demoResetting: true } });
  expect(await getSessionUser(current.rawToken)).toBeNull();
});
it("reviewaccounts krijgen geen gewone codes, uitnodigingen, pushregistraties of ringbeheer", async () => {
  const w = await world();
  const { sendLoginMail } = await import("@/lib/loginMail");
  const { registerDevice } = await import("@/lib/api/service");
  const { assertCanManageRing } = await import("@/lib/rings");
  await sendLoginMail(w.users[0].email, null, { codeOnly: true });
  expect(mail).not.toHaveBeenCalled();
  expect(await prisma.magicLinkToken.count({ where: { userId: w.users[0].id } })).toBe(0);
  await expect(registerDevice(w.users[0].id, "a".repeat(64), "ios")).rejects.toMatchObject({ status: 403 });
  await expect(assertCanManageRing(prisma, w.users[2].id, w.ringId)).rejects.toBeTruthy();
  const { createInvitation } = await import("@/lib/invitations");
  await expect(createInvitation({ actorId: w.admin.id, ringId: w.ringId, name: "Fictief", email: "fictief@example.invalid", role: "HOGERAAD", churchFunctionCode: "HOGERAADSLID", churchFunction: "Demo", isRingManager: false })).rejects.toBeTruthy();
});
it("de drie rollen behouden hun echte workflowrechten en volledige demo-afhandeling is uitvoerbaar", async () => {
  const w = await world(); await resetReviewDemo(w.admin.id);
  const { castVote, markProcessed } = await import("@/lib/workflow");
  const voting = await prisma.calling.findFirstOrThrow({ where: { ringId: w.ringId, status: "PRESIDIUM_VOTING" } });
  await expect(castVote({ callingId: voting.id, userId: w.users[1].id, support: true })).rejects.toBeTruthy();
  await expect(castVote({ callingId: voting.id, userId: w.users[2].id, support: true })).rejects.toBeTruthy();
  const ready = await prisma.calling.findFirstOrThrow({ where: { ringId: w.ringId, status: "APPROVED", roepenDoneAt: { not: null }, ondersteunenDoneAt: { not: null }, aanstellenDoneAt: { not: null } } });
  await markProcessed({ callingId: ready.id, processedById: w.users[2].id });
  expect((await prisma.calling.findUniqueOrThrow({ where: { id: ready.id } })).status).toBe("PROCESSED");
  const stages = await prisma.ontheffing.findMany({ where: { ringId: w.ringId }, select: { status: true } });
  expect(stages.map(s => s.status)).toEqual(expect.arrayContaining(["CONCEPT", "PRESIDIUM_VOTING", "PRESIDIUM_APPROVED", "HOGERAAD_VOTING", "HOGERAAD_PAUSED", "APPROVED", "PROCESSED"]));
});
it("historische verwijdering vereist concrete grondslag en wist echte identiteit, credentials, push en proceskoppelingen", async () => {
  const w = await world(); await resetReviewDemo(w.admin.id);
  await prisma.callingDraft.deleteMany({ where: { ringId: w.ringId } });
  await prisma.calling.deleteMany({ where: { ringId: w.ringId, status: { not: "PROCESSED" } } });
  await prisma.ontheffing.deleteMany({ where: { ringId: w.ringId, status: { not: "PROCESSED" } } });
  const u = w.users[0]; const s = await createVerifiedSession(u.id);
  const r = await requestAccountDeletion(u.id);
  await expect(completeAccountDeletion(w.admin.id, r.request.id, { identityChecked: true })).rejects.toThrow(/grondslag/);
  // Uitsluitend testmotivering; geen gestelde juridische basis voor echte productiegegevens.
  await completeAccountDeletion(w.admin.id, r.request.id, { identityChecked: true, retentionReason: "Synthetische test: historische registraties blijven alleen tot de bestaande automatische dossieropruiming behouden." });
  expect(await prisma.user.findUnique({ where: { id: u.id } })).toBeNull();
  expect(await getSessionUser(s.rawToken)).toBeNull();
  expect(await prisma.reviewCredential.count({ where: { userId: u.id } })).toBe(0);
  const audit = await prisma.user.findFirstOrThrow({ where: { accountKind: "AUDIT" } });
  expect(audit.active).toBe(false); expect(audit.name).toBe("Verwijderde gebruiker");
  expect(await prisma.calling.count({ where: { createdById: audit.id } })).toBe(1);
  expect((await getDeletionReceiptStatus(r.receipt))?.status).toBe("COMPLETED");
});
it("actieve workflowverantwoordelijkheid blokkeert wissen zonder de procedure of stemmen te beschadigen", async () => {
  const w = await world(); await resetReviewDemo(w.admin.id);
  const r = await requestAccountDeletion(w.users[0].id);
  const result = await completeAccountDeletion(w.admin.id, r.request.id, { identityChecked: true });
  expect(result.completed).toBe(false);
  expect(result.blockers.map(b => b.kind)).toEqual(expect.arrayContaining(["OPEN_TASKS", "ACTIVE_ROUNDS", "ACTIVE_CONFIDENTIAL_PROCESSES"]));
  expect(await prisma.user.findUnique({ where: { id: w.users[0].id } })).not.toBeNull();
  expect((await getDeletionReceiptStatus(r.receipt))?.status).toBe("BLOCKED");
});
it("gedeactiveerd account kan verwijderen met eenmalige aparte code zonder sessie, activering of MFA-omzeiling", async () => {
  const { sendDeletionCode, confirmDeletionCode } = await import("@/lib/accountDeletion");
  const u = await createTestUser("HOGERAAD", "Inactief");
  await prisma.user.update({ where: { id: u.id }, data: { active: false, mfaEnabled: true } });
  await sendDeletionCode(u.email, "inactive");
  const sent = mail.mock.calls[0] as unknown as [{ text: string }];
  const code = sent[0].text.match(/\b\d{8}\b/)![0];
  expect(await confirmDeletionCode(u.email, "00000000" === code ? "11111111" : "00000000", "inactive")).toBeNull();
  const result = await confirmDeletionCode(u.email, code, "inactive");
  expect(result?.request.status).toBe("REQUESTED");
  expect(await confirmDeletionCode(u.email, code, "inactive")).toBeNull();
  expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).active).toBe(false);
});
it("verwijder-API vereist volledige sessie, recente verificatie en expliciete bevestiging; ontvangstbewijs lekt geen identiteit", async () => {
  const u = await createTestUser("HOGERAAD", "Verzoek API");
  const { handleApi } = await import("@/lib/api/router");
  const s = await createVerifiedSession(u.id);
  async function post(token?: string, confirm = true) {
    return handleApi(new Request("http://localhost/api/mobile/v1/privacy/deletion", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ confirm }) }), ["privacy", "deletion"]);
  }
  expect((await post()).status).toBe(401);
  expect((await post(s.rawToken, false)).status).toBe(400);
  await prisma.session.updateMany({ where: { userId: u.id }, data: { mfaAt: new Date(1000) } });
  expect((await post(s.rawToken)).status).toBe(403);
  const r = await requestAccountDeletion(u.id); const status = await getDeletionReceiptStatus(r.receipt);
  expect(JSON.stringify(status)).not.toContain(u.email);
  expect(JSON.stringify(status)).not.toContain(u.id);
  expect(await getDeletionReceiptStatus("ongeldig")).toBeNull();
});
