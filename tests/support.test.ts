import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createTestRing, createCalling } from "./setup";
import { castVote, reinviteVoter, remindParticipants, deleteCalling, markProcessed, completeTask, WorkflowError, AuthorizationError } from "@/lib/workflow";

beforeEach(async () => {
  await resetDatabase();
});

async function ringWithPresidium(n = 3) {
  const ring = await createTestRing("Ring A");
  const members = [];
  for (let i = 0; i < n; i++) members.push(await createTestUser("RINGPRESIDIUM", `President ${i + 1}`, { ringId: ring.id }));
  const secretary = await createTestUser("RINGSECRETARIS", "Secretaris", { ringId: ring.id });
  const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "Leraar", createdById: members[0].id });
  return { ring, members, secretary, calling };
}

async function backdateInvites(callingId: string) {
  await prisma.eligibleVoter.updateMany({ where: { callingId }, data: { lastInvitedAt: new Date(Date.now() - 2 * 3600_000) } });
}

describe("Handmatige herinneringen", () => {
  it("herinnert alleen deelnemers die nog niet hebben gereageerd", async () => {
    const { members, calling, secretary } = await ringWithPresidium();
    await castVote({ callingId: calling.id, userId: members[0].id, support: true });
    await backdateInvites(calling.id);
    await prisma.notification.deleteMany();

    const res = await remindParticipants({ callingId: calling.id, actorId: secretary.id });
    expect(res.sent).toBe(2);
    const notified = await prisma.notification.findMany({ where: { type: "SUPPORT_REMINDER" } });
    expect(notified.map((n) => n.userId).sort()).toEqual([members[1].id, members[2].id].sort());
  });

  it("herinnert één persoon en respecteert de wachttijd (geen dubbele verzending)", async () => {
    const { members, calling, secretary } = await ringWithPresidium();
    await backdateInvites(calling.id);

    const first = await remindParticipants({ callingId: calling.id, actorId: secretary.id, userId: members[1].id });
    expect(first.sent).toBe(1);
    const second = await remindParticipants({ callingId: calling.id, actorId: secretary.id, userId: members[1].id });
    expect(second).toEqual({ sent: 0, skippedRecent: 1 });
    expect(await prisma.notification.count({ where: { type: "SUPPORT_REMINDER", userId: members[1].id } })).toBe(1);
  });

  it("is niet beschikbaar voor niet-staf of voor andere ringen", async () => {
    const { calling, members } = await ringWithPresidium();
    const hogeraad = await createTestUser("HOGERAAD", "Hogeraad", { ringId: calling.ringId });
    const otherRing = await createTestRing("Ring B");
    const foreignSecretary = await createTestUser("RINGSECRETARIS", "Elders", { ringId: otherRing.id });
    await expect(remindParticipants({ callingId: calling.id, actorId: hogeraad.id })).rejects.toThrow(AuthorizationError);
    await expect(remindParticipants({ callingId: calling.id, actorId: foreignSecretary.id })).rejects.toThrow(AuthorizationError);
    expect(members.length).toBe(3);
  });
});

describe("Ondersteunt niet → pauze → opnieuw ondersteuning vragen", () => {
  it("pauzeert, laat opnieuw vragen toe en behoudt de andere reacties", async () => {
    const { members, calling, secretary } = await ringWithPresidium();
    await castVote({ callingId: calling.id, userId: members[0].id, support: true });
    const paused = await castVote({ callingId: calling.id, userId: members[1].id, support: false });
    expect(paused.status).toBe("PRESIDIUM_PAUSED");

    await reinviteVoter({ callingId: calling.id, userId: members[1].id, actorId: secretary.id });
    // Nieuwe persoonlijke uitnodiging; de ronde blijft gepauzeerd tot die persoon zijn reactie wijzigt.
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("PRESIDIUM_PAUSED");
    // De persoon kan zijn reactie wijzigen; de reactie van de ander blijft staan.
    const resumed = await castVote({ callingId: calling.id, userId: members[1].id, support: true });
    expect(resumed.status).toBe("PRESIDIUM_VOTING");
    expect(await prisma.vote.count({ where: { callingId: calling.id, userId: members[0].id, support: true } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: members[1].id, type: "REINVITE" } })).toBe(1);
  });
});

describe("Voorstel verwijderen", () => {
  it("vereist bevestiging", async () => {
    const { calling, secretary } = await ringWithPresidium();
    await expect(deleteCalling({ callingId: calling.id, actorId: secretary.id, confirmed: false })).rejects.toThrow(WorkflowError);
    expect(await prisma.calling.count()).toBe(1);
  });

  it("verwijdert voorstel, reacties, deelnemers en meldingen; accounts en ring blijven", async () => {
    const { ring, members, calling, secretary } = await ringWithPresidium();
    await castVote({ callingId: calling.id, userId: members[0].id, support: true });
    await castVote({ callingId: calling.id, userId: members[1].id, support: false });
    expect(await prisma.notification.count({ where: { callingId: calling.id } })).toBeGreaterThan(0);

    await deleteCalling({ callingId: calling.id, actorId: secretary.id, confirmed: true });

    expect(await prisma.calling.count()).toBe(0);
    expect(await prisma.vote.count()).toBe(0);
    expect(await prisma.eligibleVoter.count()).toBe(0);
    expect(await prisma.notification.count({ where: { callingId: calling.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: members.map((m) => m.id) } } })).toBe(3);
    expect(await prisma.ring.count({ where: { id: ring.id } })).toBe(1);
  });

  it("wordt ook uitgevoerd als er al reacties en taken zijn, maar niet voor een andere ring of niet-staf", async () => {
    const { calling, members } = await ringWithPresidium();
    const hogeraad = await createTestUser("HOGERAAD", "Hogeraad", { ringId: calling.ringId });
    const otherRing = await createTestRing("Ring B");
    const foreign = await createTestUser("RINGSECRETARIS", "Elders", { ringId: otherRing.id });
    await expect(deleteCalling({ callingId: calling.id, actorId: hogeraad.id, confirmed: true })).rejects.toThrow(AuthorizationError);
    await expect(deleteCalling({ callingId: calling.id, actorId: foreign.id, confirmed: true })).rejects.toThrow(AuthorizationError);
    expect(await prisma.calling.count()).toBe(1);
    await deleteCalling({ callingId: calling.id, actorId: members[0].id, confirmed: true });
    expect(await prisma.calling.count()).toBe(0);
  });

  it("webmin mag verwijderen; verwerkte voorstellen niet", async () => {
    const { calling, members, secretary } = await ringWithPresidium(1);
    await castVote({ callingId: calling.id, userId: members[0].id, support: true });
    for (const task of ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as const) {
      await completeTask({ callingId: calling.id, task, doneById: secretary.id, doneAt: new Date(), ...(task === "ONDERSTEUNEN" ? { ondersteunenContext: "RINGCONFERENTIE" as const } : {}) });
    }
    await markProcessed({ callingId: calling.id, processedById: secretary.id });
    await expect(deleteCalling({ callingId: calling.id, actorId: secretary.id, confirmed: true })).rejects.toThrow(WorkflowError);

    const webmin = await createTestUser("ADMIN", "Webmin");
    const other = await createCalling({ ringId: calling.ringId, personName: "Piet", functionTitle: "F", createdById: members[0].id });
    await deleteCalling({ callingId: other.id, actorId: webmin.id, confirmed: true });
    expect(await prisma.calling.count({ where: { id: other.id } })).toBe(0);
  });

  it("na verwijderen volgen er geen herinneringen of ondersteuningsverzoeken meer", async () => {
    const { calling, members, secretary } = await ringWithPresidium();
    await deleteCalling({ callingId: calling.id, actorId: secretary.id, confirmed: true });
    await expect(remindParticipants({ callingId: calling.id, actorId: secretary.id })).rejects.toThrow();
    await expect(castVote({ callingId: calling.id, userId: members[0].id, support: true })).rejects.toThrow();
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe("Volledige ondersteuningsprocedure", () => {
  it("presidium → hoge raad → goedgekeurd → uitvoering → verwerkt", async () => {
    const { ring, members, calling, secretary } = await ringWithPresidium(2);
    const ha = await createTestUser("HOGERAAD", "Hogeraad 1", { ringId: ring.id });
    for (const m of members) await castVote({ callingId: calling.id, userId: m.id, support: true });
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("HOGERAAD_VOTING");
    const done = await castVote({ callingId: calling.id, userId: ha.id, support: true });
    expect(done.status).toBe("APPROVED");
    for (const task of ["ROEPEN", "ONDERSTEUNEN", "AANSTELLEN"] as const) {
      await completeTask({ callingId: calling.id, task, doneById: secretary.id, doneAt: new Date(), ...(task === "ONDERSTEUNEN" ? { ondersteunenContext: "RINGCONFERENTIE" as const } : {}) });
    }
    const processed = await markProcessed({ callingId: calling.id, processedById: secretary.id });
    expect(processed.status).toBe("PROCESSED");
  });
});
