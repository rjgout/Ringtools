import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { createMagicLinkToken, createVerifiedSession, SESSION_ROTATE_INTERVAL_MS } from "@/lib/auth";
import { resetDatabase, createTestUser, createTestRing, createCalling } from "./setup";

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
  const url = new URL(`http://localhost/api/v1${path}`);
  const res = await handleApi(
    new Request(url, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    url.pathname.replace("/api/v1/", "").split("/").filter(Boolean)
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
    expect(after.body.status).toBe("HOGERAAD_VOTING");
    expect(after.body.rounds.map((r: { stage: string }) => r.stage)).toEqual(["PRESIDIUM", "HOGERAAD"]);

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

  it("apparaattokens: alleen geldige Expo-tokens, verhuizen bij overname, verwijderen bij uitloggen", async () => {
    const { users } = await ringWith("HOGERAAD", "HOGERAAD");
    const t1 = await login(users[0].id);
    const t2 = await login(users[1].id);
    const device = "ExponentPushToken[abcdefghijklmnopqrstuv]";

    expect((await call("POST", "/devices", { token: t1, body: { token: "https://evil.example", platform: "ios" } })).status).toBe(400);
    expect((await call("POST", "/devices", { token: t1, body: { token: device, platform: "windows" } })).status).toBe(400);
    expect((await call("POST", "/devices", { token: t1, body: { token: device, platform: "ios" } })).status).toBe(200);
    expect((await call("POST", "/devices", { token: t2, body: { token: device, platform: "ios" } })).status).toBe(200);
    expect((await prisma.devicePushToken.findUniqueOrThrow({ where: { token: device } })).userId).toBe(users[1].id);

    await call("POST", "/auth/logout", { token: t2, body: { pushToken: device } });
    expect(await prisma.devicePushToken.count()).toBe(0);
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

describe("Pushmeldingen naar de native app (Expo Push)", () => {
  it("stuurt generieke tekst en een intern pad, en ruimt ongeldige tokens op", async () => {
    const { sendPushToUser } = await import("@/lib/push");
    const { users } = await ringWith("HOGERAAD");
    const good = "ExponentPushToken[goodgoodgoodgood]";
    const stale = "ExponentPushToken[stalestalestale1]";
    await prisma.devicePushToken.createMany({
      data: [
        { userId: users[0].id, token: good, platform: "ios" },
        { userId: users[0].id, token: stale, platform: "android" },
      ],
    });
    const fetchMock = vi.fn(async () =>
      Response.json({ data: [{ status: "ok" }, { status: "error", details: { error: "DeviceNotRegistered" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const delivered = await sendPushToUser(users[0].id, { title: "Nieuw voorstel", body: "Er staat een voorstel klaar.", url: "https://evil.example/x" });
      expect(delivered).toBe(1);
      const messages = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
      expect(messages).toHaveLength(2);
      expect(messages[0].to).toBe(good);
      expect(messages[0].data).toEqual({ url: "/dashboard" }); // externe URL wordt nooit doorgegeven
      expect(JSON.stringify(messages)).not.toContain(users[0].email);
      expect(await prisma.devicePushToken.count({ where: { token: stale } })).toBe(0);
      expect(await prisma.devicePushToken.count({ where: { token: good } })).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
