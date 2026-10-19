import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createCalling, getTestRing } from "./setup";

const sendNotification = vi.fn();

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotification(...args),
  },
}));

const { notify } = await import("@/lib/notifications");
const { castVote, assignTask, completeTask, markProcessed, deleteDueProcessedCallings } = await import(
  "@/lib/workflow"
);

beforeEach(async () => {
  await resetDatabase();
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined);
});

describe("Interne meldingen (notificatiecentrum)", () => {
  it("een nieuwe melding wordt opgeslagen voor de juiste gebruiker", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await notify({ ringId: (await getTestRing()).id, userIds: [user.id], event: "TASK_ASSIGNED", url: "/roepingen/abc" });

    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("TASK_ASSIGNED");
    expect(rows[0].targetUrl).toBe("/roepingen/abc");
    expect(rows[0].readAt).toBeNull();
  });

  it("alleen de aangewezen gebruiker ontvangt de melding, niemand anders", async () => {
    const target = await createTestUser("HOGERAAD", "Doelgebruiker");
    const other = await createTestUser("HOGERAAD", "Andere Gebruiker");
    await notify({ ringId: (await getTestRing()).id, userIds: [target.id], event: "TASK_ASSIGNED", url: "/roepingen/abc" });

    expect(await prisma.notification.count({ where: { userId: target.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: other.id } })).toBe(0);
  });

  it("werkt zonder Web Push (geen VAPID geconfigureerd): de interne melding wordt alsnog opgeslagen", async () => {
    const original = { ...process.env };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;

    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await expect(notify({ ringId: (await getTestRing()).id, userIds: [user.id], event: "TASK_ASSIGNED", url: "/roepingen/abc" })).resolves.not.toThrow();
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(sendNotification).not.toHaveBeenCalled();

    process.env = original;
  });

  it("werkt zonder ingeschakelde e-mailmeldingen: de interne melding wordt alsnog opgeslagen, geen e-mail", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.user.update({ where: { id: user.id }, data: { emailNotificationsEnabled: false } });

    const buildEmail = vi.fn(() => ({ subject: "x", text: "y" }));
    await notify({ ringId: (await getTestRing()).id, userIds: [user.id], event: "TASK_ASSIGNED", url: "/roepingen/abc", buildEmail });

    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(buildEmail).not.toHaveBeenCalled();
  });

  it("nooit naar een gedeactiveerde gebruiker, ook niet intern", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    await notify({ ringId: (await getTestRing()).id, userIds: [user.id], event: "TASK_ASSIGNED", url: "/roepingen/abc" });
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("Gelezen status", () => {
  it("een melding markeren als gelezen slaat de status op", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await notify({ ringId: (await getTestRing()).id, userIds: [user.id], event: "TASK_ASSIGNED", url: "/roepingen/abc" });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.readAt).toBeNull();

    await prisma.notification.update({ where: { id: row.id }, data: { readAt: new Date() } });
    const updated = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.readAt).not.toBeNull();
  });

  it("alle meldingen als gelezen markeren werkt voor de hele lijst", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await notify({ ringId: (await getTestRing()).id, userIds: [user.id], event: "TASK_ASSIGNED", url: "/roepingen/a" });
    await notify({ ringId: (await getTestRing()).id, userIds: [user.id], event: "TASK_COMPLETED", url: "/roepingen/b" });
    expect(await prisma.notification.count({ where: { userId: user.id, readAt: null } })).toBe(2);

    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    expect(await prisma.notification.count({ where: { userId: user.id, readAt: null } })).toBe(0);
  });

  it("server-side autorisatie: een gebruiker kan nooit de melding van iemand anders als gelezen markeren", async () => {
    const owner = await createTestUser("HOGERAAD", "Eigenaar");
    const attacker = await createTestUser("HOGERAAD", "Aanvaller");
    await notify({ ringId: (await getTestRing()).id, userIds: [owner.id], event: "TASK_ASSIGNED", url: "/roepingen/abc" });
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: owner.id } });

    // Simuleert exact de where-clause uit markNotificationReadAction: alleen
    // bijwerken als zowel het id als het userId overeenkomen.
    const result = await prisma.notification.updateMany({
      where: { id: row.id, userId: attacker.id, readAt: null },
      data: { readAt: new Date() },
    });
    expect(result.count).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toBeNull();
  });
});

describe("Geen dubbele meldingen bij workflow-gebeurtenissen", () => {
  it("een tegenstem maakt precies één PAUSED-melding aan, niet opnieuw bij een volgende (ongewijzigde) tegenstem", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const presidium2 = await createTestUser("RINGPRESIDIUM", "President Twee");

    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });
    await castVote({ callingId: calling.id, userId: presidium1.id, support: false });
    // Eén melding per ontvanger (hier: de twee ringpresidiumleden).
    const afterFirstPause = await prisma.notification.count({ where: { type: "PAUSED", callingId: calling.id } });
    expect(afterFirstPause).toBe(2);

    await castVote({ callingId: calling.id, userId: presidium2.id, support: false });
    // Nog steeds gepauzeerd (was al gepauzeerd): geen extra PAUSED-meldingen.
    expect(await prisma.notification.count({ where: { type: "PAUSED", callingId: calling.id } })).toBe(afterFirstPause);
  });

  it("een taak corrigeren na afronding maakt geen tweede TASK_COMPLETED-melding aan", async () => {
    const presidium = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium.id });
    const approved = await castVote({ callingId: calling.id, userId: presidium.id, support: true });

    await completeTask({ callingId: approved.id, task: "ROEPEN", doneById: presidium.id, doneAt: new Date() });
    expect(await prisma.notification.count({ where: { type: "TASK_COMPLETED", callingId: calling.id } })).toBe(1);

    // Correctie van dezelfde taak (andere uitvoeringsdatum): geen nieuwe melding.
    await completeTask({ callingId: approved.id, task: "ROEPEN", doneById: presidium.id, doneAt: new Date() });
    expect(await prisma.notification.count({ where: { type: "TASK_COMPLETED", callingId: calling.id } })).toBe(1);
  });
});

describe("Opruimen bij verwijderde roepingen", () => {
  it("verwijderde roepingen laten geen gekoppelde meldingen (persoonsgegevens) achter", async () => {
    const presidium = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium.id });
    const approved = await castVote({ callingId: calling.id, userId: presidium.id, support: true });

    for (const task of ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as const) {
      await completeTask({
        callingId: approved.id,
        task,
        doneById: presidium.id,
        doneAt: new Date(),
        ondersteunenContext: task === "ONDERSTEUNEN" ? "RINGCONFERENTIE" : undefined,
      });
    }
    await markProcessed({ callingId: approved.id, processedById: presidium.id });
    expect(await prisma.notification.count({ where: { callingId: calling.id } })).toBeGreaterThan(0);

    await prisma.calling.update({
      where: { id: calling.id },
      data: { processedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });
    await deleteDueProcessedCallings();

    expect(await prisma.notification.count({ where: { callingId: calling.id } })).toBe(0);
  });
});

describe("Taaktoewijzing en openstaande acties", () => {
  it("een taaktoewijzing maakt zowel een interne melding als een pushmelding aan (één centraal proces)", async () => {
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    process.env.VAPID_SUBJECT = "mailto:test@ringapeldoorn.nl";

    const presidium = await createTestUser("RINGPRESIDIUM", "President Een");
    const assignee = await createTestUser("RINGSECRETARIS", "Secretaris Een");
    await prisma.pushSubscription.create({
      data: { userId: assignee.id, endpoint: "https://push.example/t1", p256dh: "a", auth: "b" },
    });

    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium.id });
    sendNotification.mockClear();
    await assignTask({ callingId: calling.id, task: "ROEPEN", assigneeId: assignee.id });

    expect(await prisma.notification.count({ where: { userId: assignee.id, type: "TASK_ASSIGNED" } })).toBe(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });
});
