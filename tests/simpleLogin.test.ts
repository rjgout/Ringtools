import { beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createTestRing } from "./setup";
import { sendLoginMail } from "@/lib/loginMail";
import { loginInvitedPerson } from "@/lib/invitationLogin";
import { createVerifiedSession, createSession, promoteSessionToMfaVerified } from "@/lib/auth";
import { createInvitation } from "@/lib/invitations";
const mail = vi.fn();
vi.mock("@/lib/mailer", async original => ({ ...(await original<typeof import("@/lib/mailer")>()), sendMail: (...args: unknown[]) => mail(...args) }));
beforeEach(async () => { await resetDatabase(); mail.mockReset().mockResolvedValue(undefined); });
async function invited(email = "new@example.test") {
  const ring = await createTestRing("Synthetische ring");
  const admin = await createTestUser("ADMIN", "Beheerder");
  const invitation = await createInvitation({ actorId: admin.id, ringId: ring.id, name: "Nieuw Lid", email, role: "HOGERAAD" });
  return { ring, admin, invitation };
}
async function requestCode(email: string) {
  await sendLoginMail(email, null);
  const text = mail.mock.calls.at(-1)?.[0].text as string;
  const code = text.match(/\b\d{8}\b/)?.[0];
  expect(code).toBeTruthy(); return code!;
}
it("welkomstmail bevat geen activatiegeheim; aanvragen maakt geen account; verificatie activeert atomair", async () => {
  const { invitation, ring } = await invited();
  expect(mail.mock.calls[0][0].subject).toBe("Welkom bij Ringtools");
  expect(mail.mock.calls[0][0].text).not.toContain("activeringscode");
  const code = await requestCode("new@example.test");
  expect(await prisma.user.findUnique({ where: { email: "new@example.test" } })).toBeNull();
  expect(await loginInvitedPerson("new@example.test", "000000000", "test")).toBeNull();
  const results = await Promise.all([1,2].map(() => loginInvitedPerson("new@example.test", code, "test")));
  expect(results.filter(Boolean)).toHaveLength(1);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@example.test" } });
  expect(await prisma.ringMembership.count({ where: { userId: user.id, ringId: ring.id, active: true } })).toBe(1);
  expect((await prisma.ringInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedById).toBe(user.id);
  expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
});
it.each(["revoked", "expired", "creator-inactive", "ring-inactive"])("ongeldige uitnodiging (%s) wordt na code-uitgifte niet geactiveerd", async reason => {
  const { invitation, ring, admin } = await invited(); const code = await requestCode("new@example.test");
  if (reason === "revoked") await prisma.ringInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
  if (reason === "expired") await prisma.ringInvitation.update({ where: { id: invitation.id }, data: { expiresAt: new Date(0) } });
  if (reason === "creator-inactive") await prisma.user.update({ where: { id: admin.id }, data: { active: false } });
  if (reason === "ring-inactive") await prisma.ring.update({ where: { id: ring.id }, data: { active: false } });
  expect(await loginInvitedPerson("new@example.test", code, "test")).toBeNull();
  expect(await prisma.user.findUnique({ where: { email: "new@example.test" } })).toBeNull();
});
it("bestaand MFA-account accepteert extra ring pas na voltooide MFA; bestaande rol blijft behouden", async () => {
  const user = await createTestUser("HOGERAAD", "Bestaand", { email: "existing@example.test" });
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  const { ring, invitation } = await invited(user.email);
  const pending = await createSession(user.id, "Ringtools-app (wacht op passkey)", user.email);
  expect((await prisma.ringInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).acceptedAt).toBeNull();
  const row = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  await promoteSessionToMfaVerified(row.id, user.id, "Ringtools-app");
  expect(pending.rawToken).toBeTruthy();
  expect(await prisma.ringMembership.count({ where: { userId: user.id, ringId: ring.id } })).toBe(1);
  expect(await prisma.ringMembership.count({ where: { userId: user.id } })).toBe(2);
});
it("gedeactiveerd lidmaatschap blijft gedeactiveerd bij opnieuw aanmelden", async () => {
  const user = await createTestUser("HOGERAAD", "Bestaand", { email: "existing@example.test" });
  const { ring } = await invited(user.email);
  await prisma.ringMembership.create({ data: { userId: user.id, ringId: ring.id, role: "HOGERAAD", active: false } });
  await createVerifiedSession(user.id, "test", user.email)
  expect((await prisma.ringMembership.findUniqueOrThrow({ where: { userId_ringId: { userId: user.id, ringId: ring.id } } })).active).toBe(false);
});

it("één geverifieerd adres accepteert meerdere ringen, zonder dubbele accounts", async () => {
  const email = "multiring@example.test";
  const { ring, admin } = await invited(email);
  const second = await createTestRing("Andere synthetische ring");
  await createInvitation({ actorId: admin.id, ringId: second.id, email, name: "Nieuw Lid", role: "RINGSECRETARIS" });
  const code = await requestCode(email);
  const result = await loginInvitedPerson(email, code, "test");
  expect(result).not.toBeNull();
  expect(await prisma.user.count({ where: { email } })).toBe(1);
  const memberships = await prisma.ringMembership.findMany({ where: { userId: result!.userId } });
  expect(memberships.map(m => m.ringId).sort()).toEqual([ring.id, second.id].sort());
  expect(memberships.find(m => m.ringId === second.id)?.role).toBe("RINGSECRETARIS");
});
it("verkeerd adres, vijf foute pogingen en verlopen code activeren niets", async () => {
  const email = "attempts@example.test";
  await invited(email); const code = await requestCode(email);
  expect(await loginInvitedPerson("other@example.test", code, "test")).toBeNull();
  const wrong = code === "00000000" ? "11111111" : "00000000";
  for (let i=0; i<5; i++) expect(await loginInvitedPerson(email, wrong, "test")).toBeNull();
  expect(await loginInvitedPerson(email, code, "test")).toBeNull();
  const fresh = await requestCode(email);
  await prisma.invitationLoginCode.updateMany({ where: { email }, data: { expiresAt: new Date(0) } });
  expect(await loginInvitedPerson(email, fresh, "test")).toBeNull();
  expect(await prisma.user.count({ where: { email } })).toBe(0);
});

it("een adreswijziging tijdens pending-MFA bewijst het nieuwe adres niet", async () => {
  const user = await createTestUser("HOGERAAD", "Gewijzigd", { email: "before@example.test" });
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await invited("after@example.test");
  await createSession(user.id, "Ringtools-app (wacht op passkey)", user.email);
  await prisma.user.update({ where: { id: user.id }, data: { email: "after@example.test" } });
  const pending = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
  await promoteSessionToMfaVerified(pending.id, user.id, "Ringtools-app");
  expect(await prisma.ringInvitation.count({ where: { email: "after@example.test", acceptedAt: { not: null } } })).toBe(0);
  expect(await prisma.ringMembership.count({ where: { userId: user.id } })).toBe(1);
});
it("normale mobiele codeaanmelding accepteert een extra ring en mailt uitsluitend een code", async () => {
  const user = await createTestUser("HOGERAAD", "Mobiel", { email: "mobile-code@example.test" });
  const { ring } = await invited(user.email);
  await sendLoginMail(user.email, null, { codeOnly: true });
  const sent = mail.mock.calls.at(-1)![0];
  expect(sent.subject).toContain("inlogcode");
  expect(sent.text).not.toContain("/auth/magic/");
  const code = sent.text.match(/\b\d{8}\b/)![0];
  const { handleApi } = await import("@/lib/api/router");
  const response = await handleApi(new Request("http://localhost/api/mobile/v1/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": "10.22.1.99" },
    body: JSON.stringify({ email: user.email, code }),
  }), ["auth", "login"]);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.user.id).toBe(user.id);
  expect(body.rings.map((r: { id: string }) => r.id)).toContain(ring.id);
  expect(await prisma.user.count({ where: { email: user.email } })).toBe(1);
});

it("een gelijktijdig verlaagde uitnodigingsrol wordt opnieuw gelezen onder rijvergrendeling", async () => {
  const email = "role-race@example.test";
  const { invitation } = await invited(email);
  const code = await requestCode(email);
  let release: () => void = () => {};
  let locked: () => void = () => {};
  const hold = new Promise<void>(resolve => { release = resolve; });
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const change = prisma.$transaction(async tx => {
    await tx.ringInvitation.update({ where: { id: invitation.id }, data: { role: "RINGSECRETARIS", churchFunctionCode: "ONBEKEND" } });
    locked(); await hold;
  });
  await ready;
  const login = loginInvitedPerson(email, code, "test");
  await new Promise(resolve => setTimeout(resolve, 50));
  release(); await change;
  const result = await login;
  expect(result).not.toBeNull();
  expect((await prisma.ringMembership.findFirstOrThrow({ where: { userId: result!.userId } })).role).toBe("RINGSECRETARIS");
});
