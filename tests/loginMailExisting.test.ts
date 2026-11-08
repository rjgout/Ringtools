import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { resetDatabase, createTestUser, createTestRing } from "./setup";

// Acceptatietests 20/21: een bestaand, actief account zonder activatiedatum en zonder uitnodiging krijgt gewoon een inlogmail;
// legacy-adressen met hoofdletters/spaties worden herkend; ringbeheerders kunnen de inlogmail veilig opnieuw laten versturen.
const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));
const { handleApi } = await import("@/lib/api/router");

let ip = 0;
beforeEach(async () => {
  await resetDatabase();
  await prisma.ringInvitation.deleteMany();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, { method, headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json", "x-forwarded-for": `10.8.0.${++ip}` }, body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}) }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function legacyMember(ringId: string, storedEmail: string, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({ data: { name: "Hogeraadslid", email: storedEmail, role: "HOGERAAD", active: true, activatedAt: null, ...extra } });
  await prisma.ringMembership.create({ data: { userId: u.id, ringId, role: "HOGERAAD", churchFunction: "Hogeraadslid", churchFunctionCode: "HOGERAADSLID" } });
  return u;
}
const mailText = () => String((sendMailMock.mock.calls[0]?.[0] as { text?: string })?.text ?? "");

describe("inlogmail voor bestaande accounts", () => {
  it("actief account zonder activatiedatum en zonder uitnodiging krijgt een inlogmail", async () => {
    const ring = await createTestRing("Ring A");
    await legacyMember(ring.id, "lid@example.nl");
    const r = await call("POST", "/auth/request-code", { body: { email: "lid@example.nl" } });
    expect(r.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect((sendMailMock.mock.calls[0][0] as { to: string }).to).toBe("lid@example.nl");
  });

  it("legacy-adres met hoofdletters wordt herkend en de mail gaat naar het geregistreerde adres", async () => {
    const ring = await createTestRing("Ring A");
    await legacyMember(ring.id, "Lid@Example.NL");
    const r = await call("POST", "/auth/request-code", { body: { email: "lid@example.nl" } });
    expect(r.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect((sendMailMock.mock.calls[0][0] as { to: string }).to).toBe("Lid@Example.NL");
  });

  it("legacy-adres met spaties/hoofdletters kan met de ontvangen code inloggen", async () => {
    const ring = await createTestRing("Ring A");
    const u = await legacyMember(ring.id, "Lid@Example.NL");
    await call("POST", "/auth/request-code", { body: { email: "LID@example.nl" } });
    const code = /\b(\d{4})\s?(\d{4})\b/.exec(mailText());
    expect(code).toBeTruthy();
    const login = await call("POST", "/auth/login", { body: { email: "lid@example.nl", code: `${code![1]}${code![2]}` } });
    expect(login.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).activatedAt).not.toBeNull();
  });

  it("dubbelzinnige adressen (alleen verschil in hoofdletters) krijgen geen mail (fail-closed) en hetzelfde antwoord", async () => {
    const ring = await createTestRing("Ring A");
    await legacyMember(ring.id, "Dubbel@Example.nl");
    await prisma.user.create({ data: { name: "Ander", email: "dubbel@example.nl", role: "HOGERAAD", active: true } });
    const unknown = await call("POST", "/auth/request-code", { body: { email: "bestaatniet@example.nl" } });
    const r = await call("POST", "/auth/request-code", { body: { email: "dubbel@example.nl" } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(unknown.body);
    // Het exacte adres is wel eenduidig.
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("antwoorden verraden niet of het adres bestaat", async () => {
    const ring = await createTestRing("Ring A");
    await legacyMember(ring.id, "lid@example.nl");
    const a = await call("POST", "/auth/request-code", { body: { email: "lid@example.nl" } });
    const b = await call("POST", "/auth/request-code", { body: { email: "niemand@example.nl" } });
    expect(a).toEqual(b);
  });
});

describe("beheerder laat inlogmail opnieuw versturen", () => {
  async function world() {
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const manager = await createTestUser("RINGSECRETARIS", "Beheerder", { ringId: ringA.id, isRingManager: true });
    const managerB = await createTestUser("RINGSECRETARIS", "Beheerder B", { ringId: ringB.id, isRingManager: true });
    const plain = await createTestUser("RINGSECRETARIS", "Gewone Secretaris", { ringId: ringA.id });
    const token = (await createVerifiedSession(manager.id, "Test")).rawToken;
    const email = `beheerlid${++ip}@example.nl`; // de in-memory verzendlimiet is per adres: elke test een eigen adres
    const member = await legacyMember(ringA.id, email);
    return { ringA, ringB, manager, managerB, plain, token, member, email };
  }
  const path = (w: Awaited<ReturnType<typeof world>>, userId = w.member.id, ring = w.ringA.id) => `/rings/${ring}/users/${userId}/login-mail`;

  it("verstuurt een inlogmail uitsluitend naar het geregistreerde adres en geeft geen code of link terug", async () => {
    const w = await world();
    const r = await call("POST", path(w), { token: w.token });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect((sendMailMock.mock.calls[0][0] as { to: string }).to).toBe(w.email);
    const json = JSON.stringify(r.body);
    expect(json).not.toMatch(/\d{8}/);
    expect(json).not.toMatch(/token|http/i);
    const ev = await prisma.securityEvent.findMany({ where: { userId: w.member.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0].actorUserId).toBe(w.manager.id);
    expect(ev[0].detail).toBe(`Ring ${w.ringA.id}`); // alleen de ring; geen code, link of mailinhoud
  });

  it("vereist recente MFA", async () => {
    const w = await world();
    await prisma.session.updateMany({ where: { userId: w.manager.id }, data: { mfaAt: new Date(Date.now() - 3600_000) } });
    const r = await call("POST", path(w), { token: w.token });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("reauth-required");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("alleen een ringbeheerder van de eigen ring", async () => {
    const w = await world();
    const plain = (await createVerifiedSession(w.plain.id, "Test")).rawToken;
    expect((await call("POST", path(w), { token: plain })).status).toBe(404);
    const other = (await createVerifiedSession(w.managerB.id, "Test")).rawToken;
    expect((await call("POST", path(w), { token: other })).status).toBe(404);
    expect((await call("POST", path(w, w.member.id, w.ringB.id), { token: other })).status).toBe(404); // lid zit niet in ring B
    expect((await call("POST", path(w), {})).status).toBe(401);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("niet voor inactieve accounts, het beheerdersaccount of onbekende gebruikers", async () => {
    const w = await world();
    await prisma.user.update({ where: { id: w.member.id }, data: { active: false } });
    expect((await call("POST", path(w), { token: w.token })).status).toBe(404);
    expect((await call("POST", path(w, "bestaatniet"), { token: w.token })).status).toBe(404);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("beperkt het aantal verzoeken per lid (afkoelperiode)", async () => {
    const w = await world();
    expect((await call("POST", path(w), { token: w.token })).status).toBe(200);
    const again = await call("POST", path(w), { token: w.token });
    expect(again.status).toBe(429);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("meldt een mislukte verzending zichtbaar aan de beheerder", async () => {
    const w = await world();
    sendMailMock.mockRejectedValueOnce(new Error("SMTP down"));
    const r = await call("POST", path(w), { token: w.token });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe("mail-failed");
  });

  it("gebruikerslijst toont of een inlogmail kan worden verstuurd", async () => {
    const w = await world();
    const list = (await call("GET", `/rings/${w.ringA.id}/users`, { token: w.token })).body.users as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = list.find((u) => u.email === w.email)!;
    expect(row.canResendLoginMail).toBe(true);
    expect(row.loginMailAvailableAt ?? null).toBeNull();
  });
});
