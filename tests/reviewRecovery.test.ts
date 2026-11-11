import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createTestRing, createTestUser, resetDatabase } from "./setup";
import { addMember, createRing, updateMember, RingError } from "@/lib/rings";
import { provisionReviewDemo, resetReviewDemo, setReviewAccountActive, ReviewManagementError } from "@/lib/reviewDemo";
import { createVerifiedSession, getSessionUser } from "@/lib/auth";
import { loginReviewAccount } from "@/lib/reviewAuth";
import { handleApi } from "@/lib/api/router";
import * as proposals from "@/lib/proposals";
const mail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mailer", async original => ({ ...(await original<typeof import("@/lib/mailer")>()), sendMail: mail }));
beforeEach(async () => { await resetDatabase(); vi.clearAllMocks(); });
afterEach(() => vi.restoreAllMocks());
const passwords = () => [1,2,3].map(() => randomBytes(24).toString("base64url"));
async function world() {
  const admin = await createTestUser("ADMIN", "Fictief systeembeheer"); const secrets = passwords();
  const { ringId } = await provisionReviewDemo(admin.id, secrets);
  const users = await prisma.user.findMany({ where: { accountKind: "REVIEW" }, orderBy: { email: "asc" } });
  return { admin, secrets, ringId, users };
}
const fields = { role: "HOGERAAD" as const, churchFunction: "Fictieve functie", isRingManager: false };
async function api(path: string, token: string, body?: object) {
  const res = await handleApi(new Request(`http://localhost/api/mobile/v1${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), path.split("?")[0].split("/").filter(Boolean));
  return { status: res.status, body: await res.json() };
}
it("normale gebruikers en ringbeheerders blijven bewerkbaar via dezelfde domeinregels", async () => {
  const admin = await createTestUser("ADMIN", "Fictief beheer");
  const ring = await createTestRing("Fictieve gewone ring");
  const first = await addMember({ actorId: admin.id, ringId: ring.id, ...fields, name: "Fictieve beheerder", email: "beheer@test.ringapeldoorn.nl", isRingManager: true });
  const second = await addMember({ actorId: admin.id, ringId: ring.id, ...fields, name: "Fictief lid", email: "lid@test.ringapeldoorn.nl" });
  await updateMember({ actorId: first.user.id, membershipId: second.membership.id, ...fields, active: true, isRingManager: true });
  const token = (await createVerifiedSession(first.user.id)).rawToken;
  expect((await api(`/memberships/${second.membership.id}`, token, { ...fields, active: true, isRingManager: true, name: "Fictief gewijzigd lid" })).status).toBe(200);
  expect((await prisma.ringMembership.findUniqueOrThrow({ where: { id: second.membership.id } })).isRingManager).toBe(true);
});
it.each(["id", "email"])("reviewaccount koppelen via %s aan gewone of nieuwe ring faalt als domeinfout vóór lidmaatschapsschrijfwerk", async method => {
  const w = await world(); const ring = await createTestRing("Fictieve gewone ring");
  const identity = method === "id" ? { existingUserId: w.users[0].id } : { name: "Fictief", email: w.users[0].email };
  await expect(addMember({ actorId: w.admin.id, ringId: ring.id, ...fields, ...identity })).rejects.toBeInstanceOf(RingError);
  await expect(createRing({ actorId: w.admin.id, ringName: "Fictieve nieuwe ring", ...fields, ...identity })).rejects.toBeInstanceOf(RingError);
  expect(await prisma.ringMembership.count({ where: { userId: w.users[0].id, ringId: { not: w.ringId } } })).toBe(0);
  expect(await prisma.ring.count({ where: { name: "Fictieve nieuwe ring" } })).toBe(0);
});
it("eerste inrichting met ontbrekend wachtwoord laat geen gedeeltelijke demo of accounts achter", async () => {
  const admin = await createTestUser("ADMIN", "Fictief beheer"); const secret = passwords(); secret[2] = "";
  await expect(provisionReviewDemo(admin.id, secret)).rejects.toBeInstanceOf(ReviewManagementError);
  expect(await prisma.user.count({ where: { accountKind: "REVIEW" } })).toBe(0);
  expect(await prisma.ring.count({ where: { demoKey: "apple-review" } })).toBe(0);
});
it("een ontbrekende credential wordt niet stilzwijgend als ingerichte demo gepresenteerd", async () => {
  const w = await world(); await prisma.reviewCredential.delete({ where: { userId: w.users[0].id } });
  await expect(provisionReviewDemo(w.admin.id, ["", "", ""])).rejects.toBeInstanceOf(ReviewManagementError);
  await provisionReviewDemo(w.admin.id, [w.secrets[0], "", ""]);
  expect(await prisma.reviewCredential.count()).toBe(3);
});
it("individuele wachtwoordrotatie herstelt vaste identiteit en trekt uitsluitend betrokken sessies in", async () => {
  const w = await world(); const sessions = await Promise.all(w.users.map(u => createVerifiedSession(u.id)));
  const replacement = passwords()[0];
  await prisma.user.update({ where: { id: w.users[0].id }, data: { name: "Fictieve oude naam" } });
  await provisionReviewDemo(w.admin.id, [replacement, "", ""]);
  expect(await getSessionUser(sessions[0].rawToken)).toBeNull();
  expect((await getSessionUser(sessions[1].rawToken))?.id).toBe(w.users[1].id);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: w.users[0].id } })).name).toBe("Apple Review 1");
  const login = await loginReviewAccount(w.users[0].email, replacement, "pr4-rotation"); expect((await getSessionUser(login.token))?.id).toBe(w.users[0].id);
});
it("achtergebleven resetvlag wordt veilig hersteld en herhalen levert dezelfde fictieve uitgangstoestand", async () => {
  const w = await world(); await prisma.ring.update({ where: { id: w.ringId }, data: { active: false, demoResetting: true } });
  await resetReviewDemo(w.admin.id); await resetReviewDemo(w.admin.id);
  expect(await prisma.calling.count({ where: { ringId: w.ringId } })).toBe(7);
  expect(await prisma.ontheffing.count({ where: { ringId: w.ringId } })).toBe(7);
  expect((await prisma.ring.findUniqueOrThrow({ where: { id: w.ringId } })).active).toBe(true);
  expect(mail).not.toHaveBeenCalled();
});
it("mislukte seed blijft zichtbaar geblokkeerd, geeft geen technische fout door en is opnieuw te herstellen", async () => {
  const w = await world();
  vi.spyOn(proposals, "createDraft").mockRejectedValueOnce(new Error("Fictieve technische storing met geheime inhoud"));
  await expect(resetReviewDemo(w.admin.id)).rejects.toThrow("Demoherstel is niet afgerond");
  expect((await prisma.ring.findUniqueOrThrow({ where: { id: w.ringId } })).active).toBe(false);
  await resetReviewDemo(w.admin.id);
  expect((await prisma.ring.findUniqueOrThrow({ where: { id: w.ringId } })).demoResetting).toBe(false);
});
it("lopende reset blokkeert provisioning, deactiveren en een tweede reset zonder overlap", async () => {
  const w = await world(); let enter!: () => void; let resume!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { resume = resolve; });
  const real = proposals.createDraft;
  vi.spyOn(proposals, "createDraft").mockImplementationOnce(async (...args) => { enter(); await gate; return real(...args); });
  const resetting = resetReviewDemo(w.admin.id); await entered;
  try {
    await expect(provisionReviewDemo(w.admin.id, ["", "", ""])).rejects.toThrow(/herstel is bezig/);
    await expect(setReviewAccountActive(w.admin.id, w.users[0].id, false)).rejects.toThrow(/herstel is bezig/);
    await expect(resetReviewDemo(w.admin.id)).rejects.toThrow(/herstel is bezig/);
  } finally { resume(); await resetting; }
});
it("alleen Review 3 leest de demobeheerdemonstratie; dit geeft geen mutatie- of cross-tenantrechten", async () => {
  const w = await world(); const ring = await createTestRing("Fictieve vreemde ring");
  const ordinary = await createTestUser("RINGSECRETARIS", "Fictieve gewone beheerder", { ringId: ring.id, isRingManager: true });
  const t3 = (await createVerifiedSession(w.users[2].id)).rawToken;
  const result = await api(`/rings/${w.ringId}/review-management`, t3);
  expect(result.status).toBe(200); expect(result.body.readOnly).toBe(true); expect(result.body.users).toHaveLength(3);
  expect(JSON.stringify(result.body)).not.toMatch(/password|token|credential|Fictieve vreemde ring/);
  expect((await api(`/rings/${ring.id}/review-management`, t3)).status).toBe(404);
  expect((await api(`/rings/${w.ringId}/review-management`, (await createVerifiedSession(ordinary.id)).rawToken)).status).toBe(404);
  expect((await api(`/rings/${w.ringId}/review-management`, (await createVerifiedSession(w.users[0].id)).rawToken)).status).toBe(403);
  const m = await prisma.ringMembership.findFirstOrThrow({ where: { userId: w.users[2].id } });
  const denied = await api(`/memberships/${m.id}`, t3, { ...fields, active: true, isRingManager: true });
  expect(denied.status).toBe(404); expect(JSON.stringify(denied.body)).not.toMatch(/Prisma|23514|digest|constraint/);
  expect((await prisma.ringMembership.findUniqueOrThrow({ where: { id: m.id } })).isRingManager).toBe(false);
});
