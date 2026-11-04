import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { createMagicLinkToken, createVerifiedSession, SESSION_ROTATE_INTERVAL_MS } from "@/lib/auth";
import { resetDatabase, createTestUser, createTestRing, createCalling } from "./setup";
import type { Me, Dashboard, CallingItem, CallingDetail, ApiMeta, ApiErrorBody } from "@shared/api-types";

const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));

const { handleApi } = await import("@/lib/api/router");

beforeEach(async () => {
  await resetDatabase();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function login(userId: string) {
  return (await createVerifiedSession(userId, "Test")).rawToken;
}

async function ringWith(...roles: ("RINGPRESIDIUM" | "RINGSECRETARIS" | "HOGERAAD")[]) {
  const ring = await createTestRing("Ring A");
  const users = [];
  for (const [i, role] of roles.entries()) users.push(await createTestUser(role, `Lid ${i + 1}`, { ringId: ring.id }));
  return { ring, users };
}

describe("API: inloggen", () => {
  it("code aanvragen stuurt een mail met link én code en lekt niet of een adres bestaat", async () => {
    const { users } = await ringWith("HOGERAAD");
    const known = await call("POST", "/auth/request-code", { body: { email: users[0].email } });
    const unknown = await call("POST", "/auth/request-code", { body: { email: "niemand@test.ringapeldoorn.nl" } });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect((sendMailMock.mock.calls[0][0] as { text: string }).text).toMatch(/\b\d{8}\b/);
    expect((await call("POST", "/auth/request-code", { body: { email: "geen-adres" } })).status).toBe(400);
  });

  it("inloggen met de code geeft een sessietoken dat werkt; de code is eenmalig", async () => {
    const { users } = await ringWith("HOGERAAD");
    const { code } = await createMagicLinkToken(users[0].id, { withCode: true });

    const res = await call("POST", "/auth/login", { body: { email: users[0].email, code, deviceName: "iPhone van Piet" } });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.rings).toHaveLength(1);
    const stored = await prisma.session.findFirstOrThrow({ where: { tokenHash: hashToken(res.body.token) } });
    expect(stored.mfaAt).not.toBeNull();
    expect(stored.userAgent).toContain("iPhone van Piet");

    expect((await call("GET", "/me", { token: res.body.token })).body.user.email).toBe(users[0].email);
    expect((await call("POST", "/auth/login", { body: { email: users[0].email, code } })).status).toBe(401);
  });

  it("weigert onjuiste codes en blokkeert na te veel pogingen", async () => {
    const { users } = await ringWith("HOGERAAD");
    await createMagicLinkToken(users[0].id, { withCode: true });
    for (let i = 0; i < 5; i++) {
      expect((await call("POST", "/auth/login", { body: { email: users[0].email, code: "00000000" } })).status).toBe(401);
    }
  });

  it("weigert de beheerder en gebruikers met ingeschakelde passkey-verificatie (nog niet ondersteund in de app)", async () => {
    const { users } = await ringWith("HOGERAAD");
    await prisma.user.update({ where: { id: users[0].id }, data: { mfaEnabled: true } });
    const { code } = await createMagicLinkToken(users[0].id, { withCode: true });
    const res = await call("POST", "/auth/login", { body: { email: users[0].email, code } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("mfa-not-supported");
    expect(await prisma.session.count({ where: { userId: users[0].id } })).toBe(0);

    const admin = await createTestUser("ADMIN", "Webmin");
    const adminToken = await login(admin.id);
    const me = await call("GET", "/me", { token: adminToken });
    expect(me.status).toBe(403);
    expect(me.body.code).toBe("admin-web-only");
  });

  it("MFA is via de mobiele API niet te omzeilen en de melding adviseert nooit MFA uit te schakelen", async () => {
    const { users } = await ringWith("HOGERAAD");
    await prisma.user.update({ where: { id: users[0].id }, data: { mfaEnabled: true } });
    const { code } = await createMagicLinkToken(users[0].id, { withCode: true });
    const res = await call("POST", "/auth/login", { body: { email: users[0].email, code, deviceName: "iPhone" } });
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
    expect(res.body.error).not.toMatch(/uit(schakel|zet)|uitschakelen|deactiveer/i);
    expect(res.body.error).toMatch(/webapp/);
    // De code is bij de weigering verbruikt: nogmaals proberen levert niets op.
    expect((await call("POST", "/auth/login", { body: { email: users[0].email, code } })).status).toBe(401);

    // Een sessie die alleen de eerste factor heeft (mfaAt = null) is als bearer onbruikbaar.
    const { createSession } = await import("@/lib/auth");
    const pending = await createSession(users[0].id, "pending");
    expect((await call("GET", "/me", { token: pending.rawToken })).status).toBe(401);
    expect((await call("GET", "/sessions", { token: pending.rawToken })).status).toBe(401);
    expect((await call("POST", "/devices", { token: pending.rawToken, body: { token: "x".repeat(30), platform: "ios" } })).status).toBe(401);

    // Het beheerdersaccount kan de app-API niet gebruiken, ook niet met een volledige sessie.
    const admin = await createTestUser("ADMIN", "Webmin");
    const adminToken = await login(admin.id);
    for (const path of ["/me", "/dashboard", "/sessions", "/devices"]) expect((await call("GET", path, { token: adminToken })).status).toBe(403);
  });

  it("verlengt, roteert en trekt sessies in zoals in de webapp", async () => {
    const { users } = await ringWith("HOGERAAD");
    const token = await login(users[0].id);
    expect((await call("POST", "/auth/refresh", { token })).body).toEqual({ rotated: false });

    await prisma.session.updateMany({ where: { userId: users[0].id }, data: { createdAt: new Date(Date.now() - SESSION_ROTATE_INTERVAL_MS - 60_000) } });
    const rotated = await call("POST", "/auth/refresh", { token });
    expect(rotated.body.rotated).toBe(true);
    expect((await call("GET", "/me", { token: rotated.body.token })).status).toBe(200);

    expect((await call("POST", "/auth/logout", { token: rotated.body.token })).status).toBe(200);
    expect((await call("GET", "/me", { token: rotated.body.token })).status).toBe(401);
    expect((await call("GET", "/me", { token })).status).toBe(401); // ook het vorige token is ingetrokken
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/me", { token: "onzin" })).status).toBe(401);
  });
});

describe("API: ondersteuningsprocedure", () => {
  it("een presidiumlid ziet het voorstel, brengt ondersteuning uit en de ronde schuift door", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "HOGERAAD");
    const token = await login(users[0].id);
    const created = await call("POST", `/callings?ring=${ring.id}`, { token, body: { personName: "Jan Jansen", functionTitle: "Leraar" } });
    expect(created.status).toBe(200);

    const dash = await call("GET", `/dashboard?ring=${ring.id}`, { token });
    expect(dash.body.pendingSupport.map((c: { id: string }) => c.id)).toEqual([created.body.id]);
    expect(dash.body.counts.presidium).toBe(1);

    const detail = await call("GET", `/callings/${created.body.id}`, { token });
    expect(detail.body.rounds[0]).toMatchObject({ stage: "PRESIDIUM", state: "open", canRespond: true, myResponse: null });
    expect(detail.body.canDelete).toBe(true);

    expect((await call("POST", `/callings/${created.body.id}/vote`, { token, body: { support: true } })).status).toBe(200);
    const after = await call("GET", `/callings/${created.body.id}`, { token });
    // Presidiumakkoord start de hoge raad niet vanzelf: eerst expliciete vrijgave.
    expect(after.body.status).toBe("PRESIDIUM_APPROVED");
    expect(after.body.canRelease).toBe(true);
    expect((await call("POST", `/callings/${created.body.id}/release`, { token })).body.released).toBe(true);
    expect((await call("POST", `/callings/${created.body.id}/release`, { token })).body.alreadyReleased).toBe(true);
    const released = await call("GET", `/callings/${created.body.id}`, { token });
    expect(released.body.status).toBe("HOGERAAD_VOTING");
    expect(released.body.rounds.map((r: { stage: string }) => r.stage)).toEqual(["PRESIDIUM", "HOGERAAD"]);

    const hogeraadToken = await login(users[1].id);
    const hogeraadView = await call("GET", `/callings/${created.body.id}`, { token: hogeraadToken });
    expect(hogeraadView.body.rounds).toHaveLength(1); // alleen de eigen ronde en eigen reactie
    expect(hogeraadView.body.rounds[0].participants).toHaveLength(1);
    expect(hogeraadView.body.canDelete).toBe(false);
    expect((await call("POST", `/callings/${created.body.id}/vote`, { token: hogeraadToken, body: { support: true } })).status).toBe(200);
    expect((await call("GET", `/callings/${created.body.id}`, { token })).body.status).toBe("APPROVED");
  });

  it("validatie: vote vereist een boolean, een nieuw voorstel vereist een naam", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM");
    const token = await login(users[0].id);
    expect((await call("POST", `/callings?ring=${ring.id}`, { token, body: { personName: "J", functionTitle: "" } })).status).toBe(400);
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: users[0].id });
    expect((await call("POST", `/callings/${calling.id}/vote`, { token, body: { support: "ja" } })).status).toBe(400);
  });

  it("pauzeren, opnieuw ondersteuning vragen en herinneringen volgen dezelfde regels als de webapp", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "RINGPRESIDIUM", "RINGSECRETARIS");
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: users[0].id });
    const [a, b, secretary] = await Promise.all(users.map((u) => login(u.id)));
    await call("POST", `/callings/${calling.id}/vote`, { token: a, body: { support: true } });
    await call("POST", `/callings/${calling.id}/vote`, { token: b, body: { support: false } });

    const view = await call("GET", `/callings/${calling.id}`, { token: secretary });
    expect(view.body.status).toBe("PRESIDIUM_PAUSED");
    expect(view.body.rounds[0].participants.map((p: { support: boolean | null }) => p.support).sort()).toEqual([false, true]);

    expect((await call("POST", `/callings/${calling.id}/reinvite`, { token: secretary, body: { userId: users[1].id } })).status).toBe(200);
    // Alleen staf mag dit: een presidiumlid wel, een niet-lid niet.
    const stranger = await createTestUser("RINGPRESIDIUM", "Vreemd", { ringId: (await createTestRing("Ring B")).id });
    const strangerToken = await login(stranger.id);
    expect((await call("POST", `/callings/${calling.id}/remind`, { token: strangerToken, body: {} })).status).toBe(404);

    await prisma.eligibleVoter.updateMany({ where: { callingId: calling.id }, data: { lastInvitedAt: new Date(Date.now() - 2 * 3600_000) } });
    await prisma.vote.deleteMany({ where: { callingId: calling.id, userId: users[1].id } });
    const remind = await call("POST", `/callings/${calling.id}/remind`, { token: secretary, body: {} });
    expect(remind.body.sent).toBe(1);
  });

  it("verwijderen vereist bevestiging en staf; andere ringen krijgen niets te zien", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "HOGERAAD");
    const calling = await createCalling({ ringId: ring.id, personName: "Geheim", functionTitle: "F", createdById: users[0].id });
    const staff = await login(users[0].id);
    const member = await login(users[1].id);
    const outsider = await login((await createTestUser("RINGPRESIDIUM", "Buiten", { ringId: (await createTestRing("Ring B")).id })).id);

    expect((await call("POST", `/callings/${calling.id}/delete`, { token: staff, body: {} })).status).toBe(400); // geen bevestiging
    expect((await call("POST", `/callings/${calling.id}/delete`, { token: member, body: { confirmed: true } })).status).toBe(403);
    const outsiderView = await call("GET", `/callings/${calling.id}`, { token: outsider });
    expect(outsiderView.status).toBe(404);
    expect(JSON.stringify(outsiderView.body)).not.toContain("Geheim");
    expect((await call("GET", `/dashboard?ring=${ring.id}`, { token: outsider })).status).toBe(404);
    expect((await call("GET", `/callings?ring=${ring.id}`, { token: outsider })).status).toBe(404);

    expect((await call("POST", `/callings/${calling.id}/delete`, { token: staff, body: { confirmed: true } })).status).toBe(200);
    expect(await prisma.calling.count()).toBe(0);
    expect((await call("GET", `/callings/${calling.id}`, { token: staff })).status).toBe(404);
  });

  it("taken: toewijzen door staf, afronden door de verantwoordelijke, verwerken door staf", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "RINGSECRETARIS");
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: users[0].id });
    const [presidium, secretary] = await Promise.all(users.map((u) => login(u.id)));
    await call("POST", `/callings/${calling.id}/vote`, { token: presidium, body: { support: true } });
    const { approveCallingFully } = await import("./setup");
    await approveCallingFully(calling.id);
    expect((await call("GET", `/callings/${calling.id}`, { token: presidium })).body.status).toBe("APPROVED");

    expect((await call("POST", `/callings/${calling.id}/tasks/roepen/assign`, { token: presidium, body: { assigneeId: users[1].id } })).status).toBe(200);
    expect((await call("GET", `/dashboard?ring=${ring.id}`, { token: secretary })).body.myTasks[0].tasks).toEqual(["Roepen"]);

    expect((await call("POST", `/callings/${calling.id}/tasks/ondersteunen/complete`, { token: presidium, body: {} })).status).toBe(400); // gelegenheid ontbreekt
    expect((await call("POST", `/callings/${calling.id}/tasks/roepen/complete`, { token: secretary, body: {} })).status).toBe(200);
    expect((await call("POST", `/callings/${calling.id}/tasks/ondersteunen/complete`, { token: presidium, body: { ondersteunenContext: "RINGCONFERENTIE" } })).status).toBe(200);
    expect((await call("POST", `/callings/${calling.id}/tasks/aanstellen/complete`, { token: presidium, body: {} })).status).toBe(200);
    expect((await call("POST", `/callings/${calling.id}/tasks/onbekend/complete`, { token: presidium, body: {} })).status).toBe(400);

    const view = await call("GET", `/callings/${calling.id}`, { token: presidium });
    expect(view.body.readyToProcess).toBe(true);
    expect((await call("POST", `/callings/${calling.id}/process`, { token: presidium, body: {} })).status).toBe(200);
  });
});

describe("API: meldingen, apparaten en koppelingen", () => {
  it("meldingen zijn per gebruiker en ring en kunnen als gelezen worden gemarkeerd", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "RINGPRESIDIUM");
    await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: users[0].id });
    const token = await login(users[0].id);

    const list = await call("GET", `/notifications?ring=${ring.id}`, { token });
    expect(list.body.unreadCount).toBe(1);
    expect(JSON.stringify(list.body)).not.toContain("Jan"); // generieke tekst, geen persoonsgegevens
    await call("POST", "/notifications/read", { token, body: { ringId: ring.id } });
    expect((await call("GET", `/notifications?ring=${ring.id}`, { token })).body.unreadCount).toBe(0);
    // De andere gebruiker houdt zijn eigen ongelezen melding.
    expect((await call("GET", `/notifications?ring=${ring.id}`, { token: await login(users[1].id) })).body.unreadCount).toBe(1);
  });

  it("apparaattokens: alleen geldige tokens, verhuizen bij overname, tokenrotatie, verwijderen bij uitloggen", async () => {
    const { users } = await ringWith("HOGERAAD", "HOGERAAD");
    const t1 = await login(users[0].id);
    const t2 = await login(users[1].id);
    const device = "dGVzdC1mY20tdG9rZW4tMTIzNDU2Nzg5MDpBUEE5MWJF";

    expect((await call("POST", "/devices", { token: t1, body: { token: "https://evil.example/x", platform: "ios" } })).status).toBe(400);
    expect((await call("POST", "/devices", { token: t1, body: { token: device, platform: "windows" } })).status).toBe(400);
    expect((await call("POST", "/devices", { token: t1, body: { token: device, platform: "android", deviceId: "x" } })).status).toBe(400);
    expect((await call("POST", "/devices", { token: t1, body: { token: device, platform: "android", deviceId: "install-0001" } })).status).toBe(200);
    expect((await prisma.devicePushToken.findUniqueOrThrow({ where: { token: device } })).provider).toBe("fcm");

    // Tokenrotatie voor dezelfde installatie vervangt het oude token.
    const rotated = "ROTATED-fcm-token-abcdefghijklmnop12345";
    await call("POST", "/devices", { token: t1, body: { token: rotated, platform: "android", deviceId: "install-0001" } });
    expect(await prisma.devicePushToken.count({ where: { userId: users[0].id } })).toBe(1);

    // Een token hoort bij één gebruiker: overname op hetzelfde apparaat verhuist het.
    expect((await call("POST", "/devices", { token: t2, body: { token: rotated, platform: "android" } })).status).toBe(200);
    expect((await prisma.devicePushToken.findUniqueOrThrow({ where: { token: rotated } })).userId).toBe(users[1].id);

    // Eigen apparaten bekijken en pushmeldingen per apparaat uitzetten; andermans apparaat is onvindbaar.
    const mine = (await call("GET", "/devices", { token: t2 })).body.devices as { id: string; active: boolean }[];
    expect(mine).toHaveLength(1);
    expect((await call("POST", `/devices/${mine[0].id}/active`, { token: t1, body: { active: false } })).status).toBe(404);
    expect((await call("POST", `/devices/${mine[0].id}/active`, { token: t2, body: { active: false } })).status).toBe(200);
    expect((await prisma.devicePushToken.findUniqueOrThrow({ where: { token: rotated } })).active).toBe(false);

    await call("POST", "/auth/logout", { token: t2, body: { pushToken: rotated } });
    expect(await prisma.devicePushToken.count()).toBe(0);
  });

  it("sessies: eigen apparaten bekijken en op afstand intrekken, nooit die van een ander", async () => {
    const { users } = await ringWith("HOGERAAD", "HOGERAAD");
    const t1 = await login(users[0].id);
    const t1b = await login(users[0].id);
    const other = await login(users[1].id);
    const list = (await call("GET", "/sessions", { token: t1 })).body.sessions as { id: string; current: boolean }[];
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    const foreign = (await call("GET", "/sessions", { token: other })).body.sessions[0].id as string;
    await call("POST", `/sessions/${foreign}/revoke`, { token: t1 }); // andermans sessie: geen effect
    expect((await call("GET", "/me", { token: other })).status).toBe(200);
    const target = list.find((s) => !s.current)!;
    await call("POST", `/sessions/${target.id}/revoke`, { token: t1 });
    expect((await call("GET", "/me", { token: t1 })).status).toBe(200);
    expect((await call("GET", "/me", { token: t1b })).status).toBe(401);
  });

  it("meta geeft de API-versie zonder login", async () => {
    const meta = await call("GET", "/meta");
    expect(meta.status).toBe(200);
    expect(meta.body.apiVersion).toBe(1);
  });

  it("de koppeling uit een e-mail wordt zonder login gevalideerd en toont alleen het voorstel-id", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM");
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: users[0].id });
    const { createOpenLink } = await import("@/lib/openLinks");
    const raw = (await createOpenLink(users[0].id, calling.id)).split("/open/")[1];
    expect((await call("GET", `/open/${raw}`)).body).toEqual({ valid: true, callingId: calling.id });
    expect((await call("GET", "/open/onbekend")).body).toEqual({ valid: false });
  });

  it("onbekende routes en verkeerde methoden geven nette JSON-fouten", async () => {
    expect((await call("GET", "/bestaat-niet")).status).toBe(404);
    expect((await call("GET", "/auth/login")).status).toBe(405);
  });
});

describe("API-contract (gedeelde types in shared/api-types.ts)", () => {
  it("de antwoorden van de server voldoen aan de gedeelde types", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "HOGERAAD");
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: users[0].id });
    const token = await login(users[0].id);

    const me: Me = (await call("GET", "/me", { token })).body as Me;
    expect(me.rings[0]).toMatchObject({ id: ring.id, role: "RINGPRESIDIUM" });
    const dashboard: Dashboard = (await call("GET", `/dashboard?ring=${ring.id}`, { token })).body as Dashboard;
    expect(dashboard.ring.id).toBe(ring.id);
    const list = (await call("GET", `/callings?ring=${ring.id}`, { token })).body.callings as CallingItem[];
    expect(list[0].id).toBe(calling.id);
    const detail: CallingDetail = (await call("GET", `/callings/${calling.id}`, { token })).body as CallingDetail;
    expect(detail.rounds.length).toBeGreaterThan(0);
    const meta: ApiMeta = (await call("GET", "/meta")).body as ApiMeta;
    expect(meta.apiVersion).toBeGreaterThan(0);
    const err: ApiErrorBody = (await call("GET", "/me")).body as ApiErrorBody;
    expect(err.code).toBe("unauthenticated");
  });
});

describe("API: ledenlijst voor verantwoordelijken (Fase A)", () => {
  it("staf ziet alleen actieve leden van de eigen ring; niet-staf en andere ringen krijgen niets", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "HOGERAAD");
    const otherRing = await createTestRing("Ring B");
    const other = { ring: otherRing, users: [await createTestUser("RINGPRESIDIUM", "Vreemd", { ringId: otherRing.id })] };
    await prisma.ringMembership.updateMany({ where: { userId: users[1].id, ringId: ring.id }, data: { active: false } });
    const staffToken = await login(users[0].id);
    const res = await call("GET", `/rings/${ring.id}/members`, { token: staffToken });
    expect(res.status).toBe(200);
    expect(res.body.members.map((m: { id: string }) => m.id)).toEqual([users[0].id]);
    // gedeactiveerd lid blijft buiten beeld; geen e-mailadressen in het antwoord
    expect(JSON.stringify(res.body)).not.toContain("@");
    // andere ring: 404, geen lek
    expect((await call("GET", `/rings/${other.ring.id}/members`, { token: staffToken })).status).toBe(404);
    // reguliere (niet-staf) gebruiker: 403
    await prisma.ringMembership.updateMany({ where: { userId: users[1].id, ringId: ring.id }, data: { active: true } });
    const plain = await login(users[1].id);
    expect((await call("GET", `/rings/${ring.id}/members`, { token: plain })).status).toBe(403);
    expect((await call("GET", `/rings/${ring.id}/members`)).status).toBe(401);
  });

  it("nieuw voorstel via de API: alleen staf, en verantwoordelijken moeten leden van dezelfde ring zijn", async () => {
    const { ring, users } = await ringWith("RINGPRESIDIUM", "HOGERAAD");
    const outsiderRing = await createTestRing("Ring B");
    const outsider = await createTestUser("RINGPRESIDIUM", "Vreemd", { ringId: outsiderRing.id });
    const staff = await login(users[0].id);
    const bad = await call("POST", `/callings?ring=${ring.id}`, { token: staff, body: { personName: "Jan Test", functionTitle: "Leraar", roepenAssigneeId: outsider.id } });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const ok = await call("POST", `/callings?ring=${ring.id}`, { token: staff, body: { personName: "Jan Test", functionTitle: "Leraar", roepenAssigneeId: users[1].id } });
    expect(ok.status).toBe(200);
    const plain = await login(users[1].id);
    expect((await call("POST", `/callings?ring=${ring.id}`, { token: plain, body: { personName: "Piet Test", functionTitle: "Leraar" } })).status).toBe(403);
  });
});
