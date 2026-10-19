import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createCalling } from "./setup";
import {
  castVote,
  reinviteVoter,
  assignTask,
  completeTask,
  markProcessed,
  isReadyToProcess,
  sendDue30DayReminders,
  deleteDueProcessedCallings,
  WorkflowError,
} from "@/lib/workflow";

beforeEach(async () => {
  await resetDatabase();
});

describe("Presidiumstemming", () => {
  it("snapshot van stemgerechtigden wordt vastgelegd bij aanmaken", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const presidium2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    const secretaris = await createTestUser("RINGSECRETARIS", "Secretaris");

    const calling = await createCalling({
      personName: "Jan Jansen",
      functionTitle: "Hogeraadslid",
      createdById: secretaris.id,
    });

    const eligible = await prisma.eligibleVoter.findMany({ where: { callingId: calling.id, stage: "PRESIDIUM" } });
    expect(eligible.map((e) => e.userId).sort()).toEqual([presidium1.id, presidium2.id].sort());
    expect(calling.status).toBe("PRESIDIUM_VOTING");
  });

  it("blijft open totdat iedereen gestemd heeft", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    await createTestUser("RINGPRESIDIUM", "President Twee");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    const updated = await castVote({ callingId: calling.id, userId: presidium1.id, support: true });
    expect(updated.status).toBe("PRESIDIUM_VOTING");
  });

  it("een tegenstem pauzeert het voorstel direct", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    await createTestUser("RINGPRESIDIUM", "President Twee");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    const updated = await castVote({ callingId: calling.id, userId: presidium1.id, support: false });
    expect(updated.status).toBe("PRESIDIUM_PAUSED");
  });

  it("unanimiteit start automatisch de hogeraadstemming", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const presidium2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    await castVote({ callingId: calling.id, userId: presidium1.id, support: true });
    const updated = await castVote({ callingId: calling.id, userId: presidium2.id, support: true });

    expect(updated.status).toBe("HOGERAAD_VOTING");
    const hogeraadEligible = await prisma.eligibleVoter.findMany({ where: { callingId: calling.id, stage: "HOGERAAD" } });
    expect(hogeraadEligible).toHaveLength(1);
  });

  it("opnieuw uitnodigen laat de persoon zijn stem wijzigen zonder nieuwe stemming", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const presidium2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    await castVote({ callingId: calling.id, userId: presidium1.id, support: true });
    let updated = await castVote({ callingId: calling.id, userId: presidium2.id, support: false });
    expect(updated.status).toBe("PRESIDIUM_PAUSED");

    await expect(reinviteVoter({ callingId: calling.id, userId: presidium2.id, actorId: presidium1.id })).resolves.not.toThrow();

    // De persoon past zijn eigen stem aan (niet automatisch).
    updated = await castVote({ callingId: calling.id, userId: presidium2.id, support: true });
    expect(updated.status).toBe("HOGERAAD_VOTING");

    const votes = await prisma.vote.findMany({ where: { callingId: calling.id, stage: "PRESIDIUM" } });
    expect(votes).toHaveLength(2); // geen nieuwe stemronde, dezelfde twee records
  });

  it("opnieuw uitnodigen is alleen mogelijk als het voorstel gepauzeerd is", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    await expect(reinviteVoter({ callingId: calling.id, userId: presidium1.id, actorId: presidium1.id })).rejects.toThrow(WorkflowError);
  });

  it("een niet-stemgerechtigde kan niet stemmen", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const hogeraad = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    await expect(castVote({ callingId: calling.id, userId: hogeraad.id, support: true })).rejects.toThrow(WorkflowError);
  });

  it("latere wijzigingen in gebruikersbeheer manipuleren een lopende stemming niet", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const presidium2 = await createTestUser("RINGPRESIDIUM", "President Twee");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    // Een nieuw presidiumlid dat NA het aanmaken wordt toegevoegd, hoort niet
    // bij de bevroren stemgerechtigden van dit voorstel.
    const laterJoiner = await createTestUser("RINGPRESIDIUM", "President Drie");

    const eligible = await prisma.eligibleVoter.findMany({ where: { callingId: calling.id, stage: "PRESIDIUM" } });
    expect(eligible.map((e) => e.userId)).not.toContain(laterJoiner.id);

    await expect(castVote({ callingId: calling.id, userId: laterJoiner.id, support: true })).rejects.toThrow(WorkflowError);

    // Stemming kan nog steeds normaal afgerond worden met de oorspronkelijke twee.
    await castVote({ callingId: calling.id, userId: presidium1.id, support: true });
    const updated = await castVote({ callingId: calling.id, userId: presidium2.id, support: true });
    expect(updated.status).toBe("APPROVED"); // geen hogeraadsleden aanwezig -> direct goedgekeurd
  });
});

describe("Uitvoering en verwerken", () => {
  async function approvedCalling() {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });
    const approved = await castVote({ callingId: calling.id, userId: presidium1.id, support: true });
    expect(approved.status).toBe("APPROVED");
    return { presidium1, calling: approved };
  }

  it("taken kunnen pas afgerond worden na goedkeuring", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    await expect(
      completeTask({ callingId: calling.id, task: "ROEPEN", doneById: presidium1.id, doneAt: new Date() })
    ).rejects.toThrow(WorkflowError);
  });

  it("ondersteunen vereist een gelegenheid (avondmaal/ringconferentie)", async () => {
    const { presidium1, calling } = await approvedCalling();
    await expect(
      completeTask({ callingId: calling.id, task: "ONDERSTEUNEN", doneById: presidium1.id, doneAt: new Date() })
    ).rejects.toThrow(WorkflowError);

    await expect(
      completeTask({
        callingId: calling.id,
        task: "ONDERSTEUNEN",
        doneById: presidium1.id,
        doneAt: new Date(),
        ondersteunenContext: "RINGCONFERENTIE",
      })
    ).resolves.toBeTruthy();
  });

  it("pas als alle drie de taken klaar zijn, is de roeping te verwerken", async () => {
    const { presidium1, calling } = await approvedCalling();
    let current = calling;
    expect(isReadyToProcess(current)).toBe(false);

    current = await completeTask({ callingId: current.id, task: "ROEPEN", doneById: presidium1.id, doneAt: new Date() });
    expect(isReadyToProcess(current)).toBe(false);

    current = await completeTask({
      callingId: current.id,
      task: "ONDERSTEUNEN",
      doneById: presidium1.id,
      doneAt: new Date(),
      ondersteunenContext: "AVONDMAALSVERGADERING",
    });
    expect(isReadyToProcess(current)).toBe(false);

    current = await completeTask({ callingId: current.id, task: "AANSTELLEN", doneById: presidium1.id, doneAt: new Date() });
    expect(isReadyToProcess(current)).toBe(true);
  });

  it("markeren als verwerkt mislukt als nog niet alle taken klaar zijn", async () => {
    const { calling } = await approvedCalling();
    await expect(markProcessed({ callingId: calling.id, processedById: "x" })).rejects.toThrow(WorkflowError);
  });

  it("markeren als verwerkt zet status en verwerkingsdatum", async () => {
    const { presidium1, calling } = await approvedCalling();
    let current = calling;
    for (const task of ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as const) {
      current = await completeTask({
        callingId: current.id,
        task,
        doneById: presidium1.id,
        doneAt: new Date(),
        ondersteunenContext: task === "ONDERSTEUNEN" ? "RINGCONFERENTIE" : undefined,
      });
    }
    const processed = await markProcessed({ callingId: current.id, processedById: presidium1.id });
    expect(processed.status).toBe("PROCESSED");
    expect(processed.processedAt).not.toBeNull();
  });

  it("taken toewijzen werkt onafhankelijk van elkaar aan verschillende personen", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const persoonA = await createTestUser("RINGPRESIDIUM", "Persoon A");
    const persoonB = await createTestUser("RINGSECRETARIS", "Persoon B");
    const persoonC = await createTestUser("RINGADMINISTRATEUR", "Persoon C");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    let current = await assignTask({ callingId: calling.id, task: "ROEPEN", assigneeId: persoonA.id });
    current = await assignTask({ callingId: current.id, task: "ONDERSTEUNEN", assigneeId: persoonB.id });
    current = await assignTask({ callingId: current.id, task: "AANSTELLEN", assigneeId: persoonC.id });

    expect(current.roepenAssigneeId).toBe(persoonA.id);
    expect(current.ondersteunenAssigneeId).toBe(persoonB.id);
    expect(current.aanstellenAssigneeId).toBe(persoonC.id);
  });
});

describe("Herinneringen en automatische opruiming", () => {
  it("stuurt een eenmalige herinnering 30 dagen na aanmaken, niet eerder en niet dubbel", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });

    // Nog geen 30 dagen oud: geen herinnering.
    expect(await sendDue30DayReminders()).toBe(0);

    await prisma.calling.update({
      where: { id: calling.id },
      data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    expect(await sendDue30DayReminders()).toBe(1);
    const afterFirst = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
    expect(afterFirst.reminder30SentAt).not.toBeNull();

    // Nogmaals uitvoeren mag niet dubbel versturen.
    expect(await sendDue30DayReminders()).toBe(0);
  });

  it("verwijdert een roeping pas 30 dagen na verwerking, niet na 30 dagen na aanmaken", async () => {
    const presidium1 = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium1.id });
    const approved = await castVote({ callingId: calling.id, userId: presidium1.id, support: true });

    for (const task of ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as const) {
      await completeTask({
        callingId: approved.id,
        task,
        doneById: presidium1.id,
        doneAt: new Date(),
        ondersteunenContext: task === "ONDERSTEUNEN" ? "RINGCONFERENTIE" : undefined,
      });
    }
    await markProcessed({ callingId: approved.id, processedById: presidium1.id });

    // Pas net verwerkt: nog niet verwijderen.
    expect(await deleteDueProcessedCallings()).toBe(0);

    await prisma.calling.update({
      where: { id: approved.id },
      data: { processedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    expect(await deleteDueProcessedCallings()).toBe(1);
    expect(await prisma.calling.findUnique({ where: { id: approved.id } })).toBeNull();
    // Cascade: ook de stemmen zijn weg.
    expect(await prisma.vote.count({ where: { callingId: approved.id } })).toBe(0);
  });
});
