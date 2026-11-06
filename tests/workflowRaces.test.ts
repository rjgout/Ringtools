import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createCalling, approveCallingFully } from "./setup";
import { castVote, completeTask, markProcessed, sendDue30DayReminders } from "@/lib/workflow";

// E2.6 fase B: gelijktijdige of herhaalde acties mogen nooit een ongeldige of dubbele overgang veroorzaken.
beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => vi.restoreAllMocks());

describe("Ondersteuning: gelijktijdige reacties", () => {
  it("een tegenstem die gelijktijdig met het laatste akkoord binnenkomt, laat nooit een goedgekeurde ronde mét tegenstem achter", async () => {
    const p1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const p2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: p1.id });
    await castVote({ callingId: calling.id, userId: p1.id, support: true });

    // P1 wijzigt zijn reactie in een tegenstem; precies tussen zijn statuscontrole en het opslaan geeft P2 het laatste akkoord.
    let p2Done = false;
    const original = prisma.calling.findUniqueOrThrow.bind(prisma.calling);
    let armed = true;
    vi.spyOn(prisma.calling, "findUniqueOrThrow").mockImplementation(((args: unknown) => {
      const res = original(args as never);
      if (!armed) return res;
      armed = false;
      return (res as Promise<unknown>).then(async (stale) => {
        await castVote({ callingId: calling.id, userId: p2.id, support: true });
        p2Done = true;
        return stale;
      });
    }) as never);
    const outcome = await castVote({ callingId: calling.id, userId: p1.id, support: false }).then(() => "ok", () => "geweigerd");
    vi.restoreAllMocks();
    if (!p2Done) await castVote({ callingId: calling.id, userId: p2.id, support: true });

    const final = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
    const negatives = await prisma.vote.count({ where: { callingId: calling.id, stage: "PRESIDIUM", support: false } });
    // Invariant: een opgeslagen tegenstem en een presidiumakkoord sluiten elkaar uit.
    expect(final.status === "PRESIDIUM_APPROVED" && negatives > 0, `status=${final.status}, tegenstemmen=${negatives}, tweede poging=${outcome}`).toBe(false);
  });

  it("twee gelijktijdige tegenstemmen pauzeren één keer en melden één keer", async () => {
    const p1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const p2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    const sec = await createTestUser("RINGSECRETARIS", "Secretaris");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: sec.id });
    await Promise.all([castVote({ callingId: calling.id, userId: p1.id, support: false }), castVote({ callingId: calling.id, userId: p2.id, support: false })]);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("PRESIDIUM_PAUSED");
    const paused = await prisma.notification.findMany({ where: { callingId: calling.id, type: "PAUSED" } });
    expect(paused.length).toBeGreaterThan(0);
    const perUser = new Map<string, number>();
    for (const n of paused) perUser.set(n.userId, (perUser.get(n.userId) ?? 0) + 1);
    expect([...perUser.values()].every((c) => c === 1), JSON.stringify([...perUser.values()])).toBe(true);
  });

  it("de laatste twee akkoorden tegelijk geven één presidiumakkoord en één set vrijgavemeldingen", async () => {
    const p1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const p2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    const sec = await createTestUser("RINGSECRETARIS", "Secretaris");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: sec.id });
    await Promise.all([castVote({ callingId: calling.id, userId: p1.id, support: true }), castVote({ callingId: calling.id, userId: p2.id, support: true })]);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("PRESIDIUM_APPROVED");
    const rows = await prisma.notification.findMany({ where: { callingId: calling.id, type: "AWAITING_RELEASE" } });
    const perUser = new Map<string, number>();
    for (const n of rows) perUser.set(n.userId, (perUser.get(n.userId) ?? 0) + 1);
    expect(perUser.size).toBeGreaterThan(0);
    expect([...perUser.values()].every((c) => c === 1)).toBe(true);
  });
});

describe("Uitvoering: gelijktijdig afronden en verwerken", () => {
  async function approved() {
    const p = await createTestUser("RINGPRESIDIUM", "President Een");
    const sec = await createTestUser("RINGSECRETARIS", "Secretaris");
    const c = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: sec.id });
    await castVote({ callingId: c.id, userId: p.id, support: true });
    return { p, sec, calling: await approveCallingFully(c.id) };
  }
  const allTasks = async (id: string, by: string) => {
    await completeTask({ callingId: id, task: "ROEPEN", doneById: by, doneAt: new Date() });
    await completeTask({ callingId: id, task: "ONDERSTEUNEN", doneById: by, doneAt: new Date(), ondersteunenContext: "RINGCONFERENTIE" });
    await completeTask({ callingId: id, task: "AANSTELLEN", doneById: by, doneAt: new Date() });
  };

  it("dezelfde taak tegelijk afronden geeft één 'taak afgerond'-melding", async () => {
    const { p, sec, calling } = await approved();
    await Promise.all([1, 2, 3].map(() => completeTask({ callingId: calling.id, task: "ROEPEN", doneById: p.id, doneAt: new Date() })));
    expect(await prisma.notification.count({ where: { callingId: calling.id, userId: sec.id, type: "TASK_COMPLETED" } })).toBe(1);
  });

  it("tegelijk verwerken door twee gebruikers: precies één slaagt en de verwerker wordt niet overschreven", async () => {
    const { p, sec, calling } = await approved();
    await allTasks(calling.id, p.id);
    const res = await Promise.allSettled([markProcessed({ callingId: calling.id, processedById: p.id }), markProcessed({ callingId: calling.id, processedById: sec.id })]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const final = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
    const winner = res[0].status === "fulfilled" ? p.id : sec.id;
    expect(final.status).toBe("PROCESSED");
    expect(final.processedById).toBe(winner);
  });

  it("een tweede verwerking van een al verwerkte roeping wijzigt niets", async () => {
    const { p, sec, calling } = await approved();
    await allTasks(calling.id, p.id);
    const first = await markProcessed({ callingId: calling.id, processedById: p.id });
    await expect(markProcessed({ callingId: calling.id, processedById: sec.id })).rejects.toThrow();
    const after = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
    expect(after.processedAt?.getTime()).toBe(first.processedAt?.getTime());
    expect(after.processedById).toBe(p.id);
  });

  it("gelijktijdige 30-dagenherinneringen (twee cron-runs) geven één herinnering per presidiumlid", async () => {
    const p1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const p2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    const c = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: p1.id });
    await prisma.calling.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - 31 * 86400_000) } });
    await Promise.all([sendDue30DayReminders(), sendDue30DayReminders()]);
    const rows = await prisma.notification.findMany({ where: { callingId: c.id, type: "REMINDER_30_DAYS" } });
    expect(rows.map((r) => r.userId).sort()).toEqual([p1.id, p2.id].sort());
  });
});
