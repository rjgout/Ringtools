import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createTestRing, createCalling } from "./setup";

const sendNotification = vi.fn();
const sendMailMock = vi.fn();

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...args: unknown[]) => sendNotification(...args) },
}));
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));

process.env.VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.VAPID_SUBJECT = "mailto:test@ringapeldoorn.nl";

const { createOpenLink, resolveOpenLink, sendOpenLinkPush, sendOpenLinkLoginMail, OPEN_LINK_MAX_PUSHES } = await import("@/lib/openLinks");
const { magicLinkEmail, supportInviteEmail } = await import("@/lib/mailer");

beforeEach(async () => {
  await resetDatabase();
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined);
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
});

function tokenOf(url: string): string {
  return url.split("/open/")[1];
}

async function setup() {
  const ring = await createTestRing("Ring A");
  const user = await createTestUser("RINGPRESIDIUM", "Presidium", { ringId: ring.id });
  const calling = await createCalling({ ringId: ring.id, personName: "Jan Jansen", functionTitle: "Leraar", createdById: user.id });
  return { ring, user, calling };
}

async function addDevice(userId: string) {
  await prisma.pushSubscription.create({
    data: { userId, endpoint: `https://push.example/${userId}/${Math.random()}`, p256dh: "p", auth: "a" },
  });
}

describe("Persoonlijke koppeling uit een e-mail (/open/<token>)", () => {
  it("verwijst naar het juiste voorstel en geeft geen toegang of gegevens prijs", async () => {
    const { user, calling } = await setup();
    const url = await createOpenLink(user.id, calling.id);
    expect(url).toMatch(/\/open\/[A-Za-z0-9_-]{20,}$/);

    const info = await resolveOpenLink(tokenOf(url));
    expect(info).toEqual({ valid: true, callingId: calling.id, path: `/roepingen/${calling.id}` });
    // Alleen een hash wordt bewaard, nooit het token zelf.
    const stored = await prisma.openLinkToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toContain(tokenOf(url));
    // De koppeling logt niet in: er is geen sessie bijgekomen.
    expect(await prisma.session.count()).toBe(0);
  });

  it("is ongeldig na verloop, voor een gedeactiveerde gebruiker, na verwijderen van het voorstel en bij onbekend token", async () => {
    const { user, calling } = await setup();
    const token = tokenOf(await createOpenLink(user.id, calling.id));
    expect((await resolveOpenLink(token)).valid).toBe(true);

    await prisma.openLinkToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await resolveOpenLink(token)).valid).toBe(false);
    expect((await resolveOpenLink("onbekend")).valid).toBe(false);

    await prisma.openLinkToken.updateMany({ data: { expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await resolveOpenLink(token)).valid).toBe(false);
    await prisma.user.update({ where: { id: user.id }, data: { active: true } });

    const { deleteCalling } = await import("@/lib/workflow");
    await deleteCalling({ callingId: calling.id, actorId: user.id, confirmed: true });
    expect(await prisma.openLinkToken.count()).toBe(0); // cascade
    expect((await resolveOpenLink(token)).valid).toBe(false);
  });

  it("is ongeldig als de gebruiker geen actief lid meer is van de ring van het voorstel (ringautorisatie)", async () => {
    const { user, calling, ring } = await setup();
    const token = tokenOf(await createOpenLink(user.id, calling.id));
    await prisma.ringMembership.updateMany({ where: { userId: user.id, ringId: ring.id }, data: { active: false } });
    expect((await resolveOpenLink(token)).valid).toBe(false);
    expect(await sendOpenLinkPush(token)).toBe("invalid");
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("Melding naar de geïnstalleerde app", () => {
  it("stuurt een generieke pushmelding zonder persoonsgegevens of tokens, met alleen een intern pad", async () => {
    const { user, calling } = await setup();
    await addDevice(user.id);
    const token = tokenOf(await createOpenLink(user.id, calling.id));

    expect(await sendOpenLinkPush(token)).toBe("sent");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(sendNotification.mock.calls[0][1] as string);
    expect(payload.url).toBe(`/roepingen/${calling.id}`);
    const text = JSON.stringify(payload);
    expect(text).not.toContain(token);
    expect(text).not.toContain("Jan Jansen");
    expect(text).not.toContain("Leraar");
    expect(text).not.toContain(user.email);
    expect(text).not.toContain(user.name);
  });

  it("meldt dat er geen apparaten zijn en stuurt dan niets", async () => {
    const { user, calling } = await setup();
    const token = tokenOf(await createOpenLink(user.id, calling.id));
    expect(await sendOpenLinkPush(token)).toBe("no-devices");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("beperkt herhaald klikken en het totaal aantal meldingen per koppeling", async () => {
    const { user, calling } = await setup();
    await addDevice(user.id);
    const token = tokenOf(await createOpenLink(user.id, calling.id));

    const parallel = await Promise.all([1, 2, 3].map(() => sendOpenLinkPush(token)));
    expect(parallel.filter((r) => r === "sent").length).toBe(1);
    expect(parallel.filter((r) => r === "throttled").length).toBe(2);

    await prisma.openLinkToken.updateMany({ data: { pushCount: OPEN_LINK_MAX_PUSHES, lastPushAt: new Date(Date.now() - 3_600_000) } });
    expect(await sendOpenLinkPush(token)).toBe("throttled");
  });

  it("stuurt alleen naar de apparaten van de eigenaar van de koppeling", async () => {
    const { ring, user, calling } = await setup();
    const other = await createTestUser("RINGPRESIDIUM", "Ander", { ringId: ring.id });
    await addDevice(user.id);
    await addDevice(other.id);
    await sendOpenLinkPush(tokenOf(await createOpenLink(user.id, calling.id)));
    const endpoints = sendNotification.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint);
    expect(endpoints.length).toBe(1);
    expect(endpoints[0]).toContain(`/${user.id}/`);
  });

  it("zonder push-configuratie volgt een duidelijke fallback", async () => {
    const { user, calling } = await setup();
    await addDevice(user.id);
    const token = tokenOf(await createOpenLink(user.id, calling.id));
    const saved = process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    try {
      expect(await sendOpenLinkPush(token)).toBe("push-unavailable");
    } finally {
      process.env.VAPID_PUBLIC_KEY = saved;
    }
  });
});

describe("Inloglink vanaf de koppeling", () => {
  it("mailt een inloglink met het voorstel als bestemming naar de eigenaar, met beperking tegen herhaling", async () => {
    const { user, calling } = await setup();
    const token = tokenOf(await createOpenLink(user.id, calling.id));
    sendMailMock.mockClear();

    expect(await sendOpenLinkLoginMail(token)).toBe("mail-sent");
    expect(await sendOpenLinkLoginMail(token)).toBe("throttled");
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0] as { to: string; text: string };
    expect(mail.to).toBe(user.email);
    expect(mail.text).toContain(`/auth/magic/`);
    expect(mail.text).toContain(encodeURIComponent(`/roepingen/${calling.id}`));
  });
});

describe("Workflow-e-mails", () => {
  it("bevatten een persoonlijke /open/-koppeling en geen inloglink of onjuiste geldigheidstekst", async () => {
    const ring = await createTestRing("Ring B");
    const user = await createTestUser("RINGPRESIDIUM", "Eerste", { ringId: ring.id });
    const second = await createTestUser("RINGPRESIDIUM", "Tweede", { ringId: ring.id });
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "Leraar", createdById: user.id });
    await prisma.notification.deleteMany();
    sendMailMock.mockClear();
    const { reinviteVoter, castVote } = await import("@/lib/workflow");
    await castVote({ callingId: calling.id, userId: second.id, support: false });
    await reinviteVoter({ callingId: calling.id, userId: second.id, actorId: user.id });

    expect(sendMailMock).toHaveBeenCalled();
    for (const call of sendMailMock.mock.calls) {
      const { text } = call[0] as { text: string };
      if (text.includes("persoonlijke link")) {
        expect(text).toMatch(/\/open\/[A-Za-z0-9_-]+/);
        expect(text).not.toContain("/auth/magic/");
        expect(text).not.toContain("15 minuten");
      }
    }
  });

  it("de inlogmail zegt dat de geldigheid ingaat bij het versturen en noemt de code voor de app", () => {
    const { text } = magicLinkEmail("Piet", "https://x.example/auth/magic/abc", "12345678");
    expect(text).toContain("vanaf het moment dat deze e-mail is verstuurd");
    expect(text).toContain("12345678");
    expect(text).not.toMatch(/nadat je (hem|de link) opent/);
    expect(supportInviteEmail({ name: "P", personName: "J", functionTitle: "F", link: "l" }).text).not.toContain("15 minuten");
  });
});

// ---- Service worker: klik op een melding ----

type FakeClient = { url: string; focused?: boolean; visibilityState?: string; focus: () => Promise<FakeClient>; navigate?: (url: string) => Promise<unknown> };

function loadServiceWorker(clients: FakeClient[]) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const opened: string[] = [];
  const self = {
    location: { origin: "https://ringtools.example" },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      listeners[type] = fn;
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url);
      },
      claim: async () => {},
    },
    skipWaiting: async () => {},
    registration: { showNotification: async () => {} },
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, caches: {}, fetch: async () => ({}) });
  async function click(url: unknown) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({
      notification: { close: () => {}, data: url === undefined ? undefined : { url } },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  }
  return { click, opened };
}

describe("Service worker: klik op een pushmelding", () => {
  function openClient(navigated: string[], extra: Partial<FakeClient> = {}): FakeClient {
    const client: FakeClient = {
      url: "https://ringtools.example/dashboard",
      focused: true,
      focus: async () => client,
      navigate: async (u: string) => {
        navigated.push(u);
      },
      ...extra,
    };
    return client;
  }

  it("focust een al geopende app en navigeert naar het voorstel", async () => {
    const navigated: string[] = [];
    const { click, opened } = loadServiceWorker([openClient(navigated)]);
    await click("/roepingen/abc123");
    expect(navigated).toEqual(["https://ringtools.example/roepingen/abc123"]);
    expect(opened).toEqual([]);
  });

  it("opent de app als die gesloten is (geen windows)", async () => {
    const { click, opened } = loadServiceWorker([]);
    await click("/roepingen/abc123");
    expect(opened).toEqual(["https://ringtools.example/roepingen/abc123"]);
  });

  it("valt terug op een nieuw window als navigeren niet wordt ondersteund of mislukt", async () => {
    const noNavigate = loadServiceWorker([{ url: "x", focus: async function () { return this as unknown as FakeClient; } }]);
    await noNavigate.click("/roepingen/abc123");
    expect(noNavigate.opened).toEqual(["https://ringtools.example/roepingen/abc123"]);

    const failing = loadServiceWorker([openClient([], { navigate: async () => { throw new Error("niet toegestaan"); } })]);
    await failing.click("/roepingen/abc123");
    expect(failing.opened).toEqual(["https://ringtools.example/roepingen/abc123"]);
  });

  it("negeert externe, protocol-relatieve en onleesbare doel-URL's", async () => {
    for (const bad of ["https://evil.example/phish", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", undefined, 42]) {
      const navigated: string[] = [];
      const { click } = loadServiceWorker([openClient(navigated)]);
      await click(bad);
      expect(navigated).toEqual(["https://ringtools.example/dashboard"]);
    }
  });
});
