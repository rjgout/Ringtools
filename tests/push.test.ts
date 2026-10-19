import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser } from "./setup";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

// VAPID moet geconfigureerd zijn (anders slaat alle verzending bewust over).
process.env.VAPID_PUBLIC_KEY = "test-public-key";
process.env.VAPID_PRIVATE_KEY = "test-private-key";
process.env.VAPID_SUBJECT = "mailto:test@ringapeldoorn.nl";

const { sendPushToUser, sendPushToUsers, isPushConfigured } = await import("@/lib/push");
const { pushNotify } = await import("@/lib/notifications");

beforeEach(async () => {
  await resetDatabase();
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined);
});

describe("Web Push configuratie", () => {
  it("is geconfigureerd zodra alle drie VAPID-variabelen gezet zijn", () => {
    expect(isPushConfigured()).toBe(true);
  });
});

describe("sendPushToUser", () => {
  it("stuurt naar alle geregistreerde apparaten van een gebruiker (meerdere apparaten)", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.pushSubscription.createMany({
      data: [
        { userId: user.id, endpoint: "https://push.example/iphone", p256dh: "a", auth: "b", userAgent: "iPhone" },
        { userId: user.id, endpoint: "https://push.example/ipad", p256dh: "c", auth: "d", userAgent: "iPad" },
      ],
    });

    await sendPushToUser(user.id, { title: "Ringtools", body: "Testbericht" });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const endpoints = sendNotification.mock.calls.map((call) => (call[0] as { endpoint: string }).endpoint);
    expect(endpoints.sort()).toEqual(["https://push.example/iphone", "https://push.example/ipad"].sort());
  });

  it("stuurt niets naar een gebruiker zonder geregistreerde apparaten", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await sendPushToUser(user.id, { title: "Ringtools", body: "Testbericht" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("stuurt nooit naar een gedeactiveerde gebruiker, ook niet met geldige subscriptions", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example/x", p256dh: "a", auth: "b" },
    });
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    await sendPushToUser(user.id, { title: "Ringtools", body: "Testbericht" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("ruimt een verlopen/ongeldige subscription automatisch op (HTTP 410)", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const sub = await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example/verlopen", p256dh: "a", auth: "b" },
    });
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("Gone"), { statusCode: 410 }));

    await expect(sendPushToUser(user.id, { title: "Ringtools", body: "Testbericht" })).resolves.not.toThrow();

    expect(await prisma.pushSubscription.findUnique({ where: { id: sub.id } })).toBeNull();
  });

  it("een mislukte verzending (niet 404/410) gooit geen fout en laat de subscription staan", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const sub = await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example/tijdelijke-storing", p256dh: "a", auth: "b" },
    });
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("Server error"), { statusCode: 500 }));

    await expect(sendPushToUser(user.id, { title: "Ringtools", body: "Testbericht" })).resolves.not.toThrow();
    expect(await prisma.pushSubscription.findUnique({ where: { id: sub.id } })).not.toBeNull();
  });
});

describe("Geen vertrouwelijke gegevens in pushmeldingen", () => {
  it("de pushsjablonen bevatten nooit namen, functies of stemresultaten", async () => {
    const user = await createTestUser("RINGPRESIDIUM", "President Geheim");
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example/pres", p256dh: "a", auth: "b" },
    });

    const vertrouwelijkeTermen = ["President Geheim", "Hogeraadslid", "Bisschop", "ondersteunt", "steunt niet"];

    for (const event of [
      "NEW_PROPOSAL",
      "ADVANCED_TO_HOGERAAD",
      "REINVITE",
      "PAUSED",
      "TASK_ASSIGNED",
      "TASK_COMPLETED",
      "REMINDER_30_DAYS",
    ] as const) {
      sendNotification.mockClear();
      await pushNotify([user.id], event, "/roepingen/abc123");
      const body = JSON.parse(sendNotification.mock.calls[0][1] as string) as { title: string; body: string };
      for (const term of vertrouwelijkeTermen) {
        expect(body.title).not.toContain(term);
        expect(body.body).not.toContain(term);
      }
    }
  });
});

describe("Pushmeldingen in de workflow", () => {
  it("een nieuw voorstel stuurt een pushmelding naar het ringpresidium", async () => {
    const { createCalling } = await import("@/lib/workflow");
    const presidium = await createTestUser("RINGPRESIDIUM", "President Een");
    await prisma.pushSubscription.create({
      data: { userId: presidium.id, endpoint: "https://push.example/p1", p256dh: "a", auth: "b" },
    });

    await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium.id });

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("een taaktoewijzing stuurt een pushmelding naar de toegewezene", async () => {
    const { createCalling, assignTask } = await import("@/lib/workflow");
    const presidium = await createTestUser("RINGPRESIDIUM", "President Een");
    const assignee = await createTestUser("RINGSECRETARIS", "Secretaris Een");
    await prisma.pushSubscription.create({
      data: { userId: assignee.id, endpoint: "https://push.example/s1", p256dh: "a", auth: "b" },
    });

    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium.id });
    sendNotification.mockClear();
    await assignTask({ callingId: calling.id, task: "ROEPEN", assigneeId: assignee.id });

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("een tegenstem stuurt eenmalig een pushmelding naar het ringpresidium (niet opnieuw bij elke volgende stem)", async () => {
    const { createCalling, castVote } = await import("@/lib/workflow");
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const presidium2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    await prisma.pushSubscription.create({
      data: { userId: presidium1.id, endpoint: "https://push.example/p1b", p256dh: "a", auth: "b" },
    });

    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });
    sendNotification.mockClear();

    await castVote({ callingId: calling.id, userId: presidium1.id, support: false });
    expect(sendNotification).toHaveBeenCalledTimes(1); // PAUSED-melding

    sendNotification.mockClear();
    await castVote({ callingId: calling.id, userId: presidium2.id, support: false });
    // Nog steeds gepauzeerd (was al gepauzeerd): geen nieuwe PAUSED-melding.
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("sendPushToUsers", () => {
  it("stuurt geen dubbele meldingen bij hetzelfde aanroepmoment", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: "https://push.example/x", p256dh: "a", auth: "b" },
    });
    await sendPushToUsers([user.id], { title: "Ringtools", body: "Testbericht" });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
