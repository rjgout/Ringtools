import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createTestRing, createCalling } from "./setup";
import { createRing, addMember, updateMember, renameRing, listRingMembers, RingError, AuthorizationError } from "@/lib/rings";
import { castVote, removeParticipantFromRound, WorkflowError } from "@/lib/workflow";

beforeEach(async () => {
  await resetDatabase();
});

async function admin() {
  return createTestUser("ADMIN", "Webmin");
}

describe("Ringen aanmaken (alleen webmin)", () => {
  it("webmin maakt een ring met direct een nieuwe eerste gebruiker als ringbeheerder", async () => {
    const webmin = await admin();
    const { ring, user, membership, isNew } = await createRing({
      actorId: webmin.id,
      ringName: "Ring Voorbeeld",
      name: "Eerste Beheerder",
      email: "Eerste@Test.ringapeldoorn.nl",
      churchFunction: "Ringsecretaris",
      role: "RINGSECRETARIS",
    });

    expect(isNew).toBe(true);
    expect(ring.name).toBe("Ring Voorbeeld");
    expect(user.email).toBe("eerste@test.ringapeldoorn.nl");
    expect(membership).toMatchObject({
      ringId: ring.id,
      userId: user.id,
      role: "RINGSECRETARIS",
      churchFunction: "Ringsecretaris",
      isRingManager: true,
      active: true,
    });
  });

  it("webmin kan een bestaande gebruiker selecteren als eerste ringbeheerder", async () => {
    const webmin = await admin();
    const existing = await createTestUser("HOGERAAD", "Bestaand Lid");
    const other = await createTestRing("Andere ring");

    const { membership, isNew } = await createRing({
      actorId: webmin.id,
      ringName: "Tweede ring",
      existingUserId: existing.id,
      churchFunction: "Hogeraadslid",
      role: "HOGERAAD",
    });
    expect(isNew).toBe(false);
    expect(membership.isRingManager).toBe(true);
    // Hetzelfde account is nu in twee ringen lid, met een eigen functie per ring.
    expect(await prisma.ringMembership.count({ where: { userId: existing.id } })).toBe(2);
    expect(other.id).not.toBe(membership.ringId);
  });

  it("alleen webmin kan een ring aanmaken of hernoemen", async () => {
    const manager = await createTestUser("RINGSECRETARIS", "Beheerder", { isRingManager: true });
    await expect(
      createRing({ actorId: manager.id, ringName: "Nieuwe ring", name: "X Y", email: "x@y.nl", churchFunction: "Functie", role: "HOGERAAD" })
    ).rejects.toThrow(AuthorizationError);

    const ring = await createTestRing("Ring Een");
    await expect(renameRing({ actorId: manager.id, ringId: ring.id, name: "Anders" })).rejects.toThrow(AuthorizationError);
    expect(await prisma.ring.count()).toBe(2); // testring van de beheerder + "Ring Een"
  });

  it("weigert een dubbele ringnaam en een ongeldige rol", async () => {
    const webmin = await admin();
    await createTestRing("Ring Dubbel");
    await expect(
      createRing({ actorId: webmin.id, ringName: "ring dubbel", name: "A B", email: "a@b.nl", churchFunction: "F", role: "HOGERAAD" })
    ).rejects.toThrow(RingError);
    await expect(
      createRing({ actorId: webmin.id, ringName: "Ring Nieuw", name: "A B", email: "a@b.nl", churchFunction: "F", role: "ADMIN" })
    ).rejects.toThrow(RingError);
    expect(await prisma.user.count({ where: { email: "a@b.nl" } })).toBe(0); // transactioneel teruggedraaid
  });
});

describe("Gebruikersbeheer door de ringbeheerder", () => {
  it("een ringbeheerder kan gebruikers van de eigen ring toevoegen, wijzigen en deactiveren", async () => {
    const ring = await createTestRing("Eigen ring");
    const manager = await createTestUser("RINGSECRETARIS", "Beheerder", { ringId: ring.id, isRingManager: true });

    const added = await addMember({
      actorId: manager.id,
      ringId: ring.id,
      name: "Nieuw Lid",
      email: "nieuw.lid@test.ringapeldoorn.nl",
      churchFunction: "Hogeraadslid",
      role: "HOGERAAD",
      isRingManager: false,
    });
    expect(added.membership).toMatchObject({ ringId: ring.id, role: "HOGERAAD", churchFunction: "Hogeraadslid", active: true });

    await updateMember({
      actorId: manager.id,
      membershipId: added.membership.id,
      churchFunction: "Eerste counselor",
      role: "RINGPRESIDIUM",
      isRingManager: false,
      active: true,
    });
    let m = await prisma.ringMembership.findUniqueOrThrow({ where: { id: added.membership.id } });
    expect(m).toMatchObject({ role: "RINGPRESIDIUM", churchFunction: "Eerste counselor" });

    await updateMember({
      actorId: manager.id,
      membershipId: added.membership.id,
      churchFunction: "Eerste counselor",
      role: "RINGPRESIDIUM",
      isRingManager: false,
      active: false,
    });
    m = await prisma.ringMembership.findUniqueOrThrow({ where: { id: added.membership.id } });
    expect(m.active).toBe(false);
  });

  it("kerkelijke functie en administratieve rechten zijn gescheiden: een ringbeheerder hoeft niet deel te nemen aan rondes", async () => {
    const ring = await createTestRing("Eigen ring");
    const secretary = await createTestUser("RINGSECRETARIS", "Secretaris Beheerder", { ringId: ring.id, isRingManager: true });
    const president = await createTestUser("RINGPRESIDIUM", "President", { ringId: ring.id });

    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "Func", createdById: president.id });
    const eligible = await prisma.eligibleVoter.findMany({ where: { callingId: calling.id } });
    expect(eligible.map((e) => e.userId)).toEqual([president.id]);
    expect(eligible.map((e) => e.userId)).not.toContain(secretary.id);
  });

  it("een ringbeheerder kan geen gebruikers van een andere ring beheren", async () => {
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const managerA = await createTestUser("RINGSECRETARIS", "Beheerder A", { ringId: ringA.id, isRingManager: true });
    const victimB = await createTestUser("HOGERAAD", "Lid B", { ringId: ringB.id });
    const victimMembership = await prisma.ringMembership.findFirstOrThrow({ where: { userId: victimB.id } });

    await expect(
      updateMember({
        actorId: managerA.id,
        membershipId: victimMembership.id,
        churchFunction: "Gehackt",
        role: "RINGPRESIDIUM",
        isRingManager: true,
        active: false,
      })
    ).rejects.toThrow(AuthorizationError);

    await expect(
      addMember({
        actorId: managerA.id,
        ringId: ringB.id,
        name: "Indringer",
        email: "indringer@test.ringapeldoorn.nl",
        churchFunction: "F",
        role: "HOGERAAD",
        isRingManager: false,
      })
    ).rejects.toThrow(AuthorizationError);

    const unchanged = await prisma.ringMembership.findUniqueOrThrow({ where: { id: victimMembership.id } });
    expect(unchanged).toMatchObject({ role: "HOGERAAD", active: true, isRingManager: false });
    expect(await prisma.user.count({ where: { email: "indringer@test.ringapeldoorn.nl" } })).toBe(0);
  });

  it("alleen een ringbeheerder (niet zomaar een presidiumlid of secretaris) mag gebruikers beheren", async () => {
    const ring = await createTestRing("Eigen ring");
    const president = await createTestUser("RINGPRESIDIUM", "President", { ringId: ring.id }); // geen ringbeheerder
    await expect(
      addMember({
        actorId: president.id,
        ringId: ring.id,
        name: "X Y",
        email: "xy@test.ringapeldoorn.nl",
        churchFunction: "F",
        role: "HOGERAAD",
        isRingManager: false,
      })
    ).rejects.toThrow(AuthorizationError);
  });

  it("een ringbeheerder kan geen bestaand account van een andere ring overnemen of opzoeken", async () => {
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const managerA = await createTestUser("RINGSECRETARIS", "Beheerder A", { ringId: ringA.id, isRingManager: true });
    const memberB = await createTestUser("HOGERAAD", "Lid B", { ringId: ringB.id, email: "lid.b@test.ringapeldoorn.nl" });

    await expect(
      addMember({
        actorId: managerA.id,
        ringId: ringA.id,
        existingUserId: memberB.id,
        churchFunction: "F",
        role: "HOGERAAD",
        isRingManager: false,
      })
    ).rejects.toThrow(AuthorizationError);

    await expect(
      addMember({
        actorId: managerA.id,
        ringId: ringA.id,
        name: "Lid B",
        email: "lid.b@test.ringapeldoorn.nl",
        churchFunction: "F",
        role: "HOGERAAD",
        isRingManager: false,
      })
    ).rejects.toThrow(RingError);
    expect(await prisma.ringMembership.count({ where: { userId: memberB.id } })).toBe(1);
  });

  it("naam en e-mailadres van iemand in meerdere ringen kan alleen webmin wijzigen", async () => {
    const webmin = await admin();
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const managerA = await createTestUser("RINGSECRETARIS", "Beheerder A", { ringId: ringA.id, isRingManager: true });
    const shared = await createTestUser("HOGERAAD", "Gedeeld Lid", { ringId: ringA.id });
    await prisma.ringMembership.create({ data: { userId: shared.id, ringId: ringB.id, role: "HOGERAAD", churchFunction: "F" } });
    const mA = await prisma.ringMembership.findFirstOrThrow({ where: { userId: shared.id, ringId: ringA.id } });

    const base = { membershipId: mA.id, churchFunction: "F", role: "HOGERAAD" as const, isRingManager: false, active: true };
    await expect(updateMember({ actorId: managerA.id, ...base, name: "Nieuwe Naam" })).rejects.toThrow(RingError);
    await expect(updateMember({ actorId: webmin.id, ...base, name: "Nieuwe Naam" })).resolves.toBeTruthy();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: shared.id } })).name).toBe("Nieuwe Naam");
  });

  it("webmin kan een bestaande gebruiker aan een tweede ring koppelen, met een eigen functie en rol per ring", async () => {
    const webmin = await admin();
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const user = await createTestUser("HOGERAAD", "Meerdere Ringen", { ringId: ringA.id, churchFunction: "Hogeraadslid" });

    await addMember({
      actorId: webmin.id,
      ringId: ringB.id,
      existingUserId: user.id,
      churchFunction: "Ringsecretaris",
      role: "RINGSECRETARIS",
      isRingManager: false,
    });

    const memberships = await prisma.ringMembership.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(memberships.map((m) => [m.ringId, m.role, m.churchFunction])).toEqual([
      [ringA.id, "HOGERAAD", "Hogeraadslid"],
      [ringB.id, "RINGSECRETARIS", "Ringsecretaris"],
    ]);
    expect((await listRingMembers(ringB.id)).map((m) => m.userId)).toEqual([user.id]);
  });
});

describe("Een ring houdt altijd een actieve ringbeheerder", () => {
  it("de laatste actieve ringbeheerder kan niet worden gedeactiveerd of gedegradeerd", async () => {
    const ring = await createTestRing("Eigen ring");
    const manager = await createTestUser("RINGSECRETARIS", "Enige Beheerder", { ringId: ring.id, isRingManager: true });
    const mm = await prisma.ringMembership.findFirstOrThrow({ where: { userId: manager.id } });
    const base = { actorId: manager.id, membershipId: mm.id, churchFunction: "Ringsecretaris", role: "RINGSECRETARIS" as const };

    await expect(updateMember({ ...base, isRingManager: true, active: false })).rejects.toThrow(RingError);
    await expect(updateMember({ ...base, isRingManager: false, active: true })).rejects.toThrow(RingError);

    const unchanged = await prisma.ringMembership.findUniqueOrThrow({ where: { id: mm.id } });
    expect(unchanged).toMatchObject({ isRingManager: true, active: true });
  });

  it("met een tweede actieve ringbeheerder mag de eerste wel worden gedeactiveerd", async () => {
    const ring = await createTestRing("Eigen ring");
    const first = await createTestUser("RINGSECRETARIS", "Eerste", { ringId: ring.id, isRingManager: true });
    await createTestUser("RINGADMINISTRATEUR", "Tweede", { ringId: ring.id, isRingManager: true });
    const m1 = await prisma.ringMembership.findFirstOrThrow({ where: { userId: first.id } });

    await expect(
      updateMember({
        actorId: first.id,
        membershipId: m1.id,
        churchFunction: "F",
        role: "RINGSECRETARIS",
        isRingManager: true,
        active: false,
      })
    ).resolves.toBeTruthy();
  });

  it("een gedeactiveerde beheerder telt niet mee: de enige overgebleven actieve beheerder blijft beschermd", async () => {
    const ring = await createTestRing("Eigen ring");
    const active = await createTestUser("RINGSECRETARIS", "Actief", { ringId: ring.id, isRingManager: true });
    await createTestUser("RINGADMINISTRATEUR", "Inactief", { ringId: ring.id, isRingManager: true, active: false });
    const m = await prisma.ringMembership.findFirstOrThrow({ where: { userId: active.id } });

    await expect(
      updateMember({ actorId: active.id, membershipId: m.id, churchFunction: "F", role: "RINGSECRETARIS", isRingManager: false, active: true })
    ).rejects.toThrow(RingError);
  });

  it("deactiveren van het lidmaatschap trekt de sessies in als er geen andere actieve ring is", async () => {
    const webmin = await admin();
    const ring = await createTestRing("Eigen ring");
    await createTestUser("RINGSECRETARIS", "Beheerder", { ringId: ring.id, isRingManager: true });
    const member = await createTestUser("HOGERAAD", "Lid", { ringId: ring.id });
    const mm = await prisma.ringMembership.findFirstOrThrow({ where: { userId: member.id } });
    await prisma.session.create({ data: { userId: member.id, tokenHash: "x".repeat(8), expiresAt: new Date(Date.now() + 60_000), mfaAt: new Date() } });

    await updateMember({ actorId: webmin.id, membershipId: mm.id, churchFunction: "F", role: "HOGERAAD", isRingManager: false, active: false });
    expect(await prisma.session.count({ where: { userId: member.id } })).toBe(0);
  });
});

describe("Lopende ondersteuningsrondes bij nieuwe en gewijzigde leden", () => {
  async function setup() {
    const ring = await createTestRing("Ring A");
    const otherRing = await createTestRing("Ring B");
    const manager = await createTestUser("RINGSECRETARIS", "Beheerder", { ringId: ring.id, isRingManager: true });
    const president = await createTestUser("RINGPRESIDIUM", "President Een", { ringId: ring.id });
    const otherPresident = await createTestUser("RINGPRESIDIUM", "President Elders", { ringId: otherRing.id });
    return { ring, otherRing, manager, president, otherPresident };
  }

  it("een nieuw presidiumlid wordt toegevoegd aan lopende presidiumrondes van de eigen ring, niet aan die van een andere ring", async () => {
    const { ring, otherRing, manager, president, otherPresident } = await setup();
    const callingA = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: president.id });
    const callingB = await createCalling({ ringId: otherRing.id, personName: "Piet", functionTitle: "F", createdById: otherPresident.id });

    const { user, joinedRounds } = await addMember({
      actorId: manager.id,
      ringId: ring.id,
      name: "Nieuw Presidium",
      email: "nieuw.presidium@test.ringapeldoorn.nl",
      churchFunction: "Tweede counselor",
      role: "RINGPRESIDIUM",
      isRingManager: false,
    });

    expect(joinedRounds).toBe(1);
    expect(await prisma.eligibleVoter.count({ where: { callingId: callingA.id, stage: "PRESIDIUM", userId: user.id } })).toBe(1);
    expect(await prisma.eligibleVoter.count({ where: { callingId: callingB.id, userId: user.id } })).toBe(0);
  });

  it("de nieuwe deelnemer ontvangt een persoonlijk ondersteuningsverzoek en staat op 'nog niet gereageerd'", async () => {
    const { ring, manager, president } = await setup();
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: president.id });

    const { user } = await addMember({
      actorId: manager.id,
      ringId: ring.id,
      name: "Nieuw Presidium",
      email: "nieuw.presidium@test.ringapeldoorn.nl",
      churchFunction: "F",
      role: "RINGPRESIDIUM",
      isRingManager: false,
    });

    const notifications = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ type: "NEW_PROPOSAL", ringId: ring.id, callingId: calling.id });
    const eligible = await prisma.eligibleVoter.findFirstOrThrow({ where: { callingId: calling.id, userId: user.id } });
    expect(eligible.lastInvitedAt).not.toBeNull();
    expect(await prisma.vote.count({ where: { callingId: calling.id, userId: user.id } })).toBe(0);
  });

  it("bestaande reacties blijven behouden en de ronde kan pas afronden als ook de nieuwe deelnemer positief reageert", async () => {
    const { ring, manager, president } = await setup();
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: president.id });
    await castVote({ callingId: calling.id, userId: president.id, support: true });
    // Zonder hogeraadsleden is het voorstel nu al goedgekeurd; gebruik daarom een tweede presidiumlid
    // zodat de ronde open blijft.
    await prisma.calling.update({ where: { id: calling.id }, data: { status: "PRESIDIUM_VOTING" } });

    const { user } = await addMember({
      actorId: manager.id,
      ringId: ring.id,
      name: "Nieuw Presidium",
      email: "nieuw.presidium@test.ringapeldoorn.nl",
      churchFunction: "F",
      role: "RINGPRESIDIUM",
      isRingManager: false,
    });

    const existingVote = await prisma.vote.findFirstOrThrow({ where: { callingId: calling.id, userId: president.id } });
    expect(existingVote.support).toBe(true);

    // Eerste deelnemer heeft al positief gereageerd, de nieuwe nog niet: nog niet afgerond.
    const afterFirst = await castVote({ callingId: calling.id, userId: president.id, support: true });
    expect(afterFirst.status).toBe("PRESIDIUM_VOTING");

    const done = await castVote({ callingId: calling.id, userId: user.id, support: true });
    expect(done.status).toBe("APPROVED");
  });

  it("een nieuw hogeraadslid komt alleen in rondes van de hoge raad, niet in een lopende presidiumronde", async () => {
    const { ring, manager, president } = await setup();
    const hogeraad = await createTestUser("HOGERAAD", "Hogeraad Een", { ringId: ring.id });
    const inPresidium = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: president.id });
    const inHogeraad = await createCalling({ ringId: ring.id, personName: "Piet", functionTitle: "F", createdById: president.id });
    await castVote({ callingId: inHogeraad.id, userId: president.id, support: true });
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: inHogeraad.id } })).status).toBe("HOGERAAD_VOTING");
    // president heeft op "inPresidium" nog niet gereageerd
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: inPresidium.id } })).status).toBe("PRESIDIUM_VOTING");

    const { user } = await addMember({
      actorId: manager.id,
      ringId: ring.id,
      name: "Nieuw Hogeraad",
      email: "nieuw.hogeraad@test.ringapeldoorn.nl",
      churchFunction: "Hogeraadslid",
      role: "HOGERAAD",
      isRingManager: false,
    });

    expect(await prisma.eligibleVoter.count({ where: { callingId: inHogeraad.id, stage: "HOGERAAD", userId: user.id } })).toBe(1);
    expect(await prisma.eligibleVoter.count({ where: { callingId: inPresidium.id, userId: user.id } })).toBe(0);
    expect(hogeraad.id).toBeTruthy();
  });

  it("afgeronde rondes worden niet heropend of gewijzigd door een nieuw lid", async () => {
    const { ring, manager, president } = await setup();
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: president.id });
    const approved = await castVote({ callingId: calling.id, userId: president.id, support: true });
    expect(approved.status).toBe("APPROVED"); // geen hogeraadsleden: direct goedgekeurd

    const before = await prisma.eligibleVoter.findMany({ where: { callingId: calling.id } });
    const { user, joinedRounds } = await addMember({
      actorId: manager.id,
      ringId: ring.id,
      name: "Te Laat",
      email: "te.laat@test.ringapeldoorn.nl",
      churchFunction: "F",
      role: "RINGPRESIDIUM",
      isRingManager: false,
    });

    expect(joinedRounds).toBe(0);
    expect(await prisma.eligibleVoter.count({ where: { callingId: calling.id } })).toBe(before.length);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("APPROVED");
  });

  it("een gedeactiveerd lid kan niet meer reageren en leidt nooit tot automatische goedkeuring", async () => {
    const { ring, manager, president } = await setup();
    const second = await createTestUser("RINGPRESIDIUM", "President Twee", { ringId: ring.id });
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: president.id });
    await castVote({ callingId: calling.id, userId: president.id, support: true });

    const mm = await prisma.ringMembership.findFirstOrThrow({ where: { userId: second.id } });
    await updateMember({ actorId: manager.id, membershipId: mm.id, churchFunction: "F", role: "RINGPRESIDIUM", isRingManager: false, active: false });

    // Geen stilzwijgende wijziging: de ronde blijft open, de deelnemer blijft in de lijst.
    const state = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
    expect(state.status).toBe("PRESIDIUM_VOTING");
    expect(await prisma.eligibleVoter.count({ where: { callingId: calling.id, stage: "PRESIDIUM" } })).toBe(2);
    await expect(castVote({ callingId: calling.id, userId: second.id, support: true })).rejects.toThrow(WorkflowError);
  });

  it("een niet meer betrokken deelnemer wordt alleen expliciet door het ringpresidium uit de ronde verwijderd", async () => {
    const { ring, manager, president } = await setup();
    const second = await createTestUser("RINGPRESIDIUM", "President Twee", { ringId: ring.id });
    const calling = await createCalling({ ringId: ring.id, personName: "Jan", functionTitle: "F", createdById: president.id });
    await castVote({ callingId: calling.id, userId: president.id, support: true });

    // Zolang de deelnemer nog actief betrokken is, kan hij niet worden verwijderd.
    await expect(removeParticipantFromRound({ callingId: calling.id, userId: second.id, actorId: president.id })).rejects.toThrow(
      WorkflowError
    );

    const mm = await prisma.ringMembership.findFirstOrThrow({ where: { userId: second.id } });
    await updateMember({ actorId: manager.id, membershipId: mm.id, churchFunction: "F", role: "RINGPRESIDIUM", isRingManager: false, active: false });

    // Niet-staf (hogeraadslid) mag het niet.
    const outsider = await createTestUser("HOGERAAD", "Hogeraad", { ringId: ring.id });
    await expect(removeParticipantFromRound({ callingId: calling.id, userId: second.id, actorId: outsider.id })).rejects.toThrow(
      AuthorizationError
    );

    const result = await removeParticipantFromRound({ callingId: calling.id, userId: second.id, actorId: president.id });
    expect(await prisma.eligibleVoter.count({ where: { callingId: calling.id, userId: second.id } })).toBe(0);
    expect(result.status).toBe("HOGERAAD_VOTING"); // overige deelnemer had al ondersteund: ronde rondt expliciet af, volgende fase
  });
});

describe("Tenantisolatie", () => {
  it("voorstellen, verantwoordelijken en meldingen blijven binnen de eigen ring", async () => {
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const presA = await createTestUser("RINGPRESIDIUM", "President A", { ringId: ringA.id });
    const presB = await createTestUser("RINGPRESIDIUM", "President B", { ringId: ringB.id });

    const calling = await createCalling({ ringId: ringA.id, personName: "Jan", functionTitle: "F", createdById: presA.id });
    expect(await prisma.eligibleVoter.count({ where: { callingId: calling.id, userId: presB.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: presB.id } })).toBe(0);
    await expect(castVote({ callingId: calling.id, userId: presB.id, support: false })).rejects.toThrow(WorkflowError);

    // Verantwoordelijke uit een andere ring is niet toegestaan.
    await expect(
      createCalling({ ringId: ringA.id, personName: "Piet", functionTitle: "F", createdById: presA.id, roepenAssigneeId: presB.id })
    ).rejects.toThrow(WorkflowError);
    // Aanmaker moet zelf lid zijn van de ring.
    await expect(createCalling({ ringId: ringA.id, personName: "Piet", functionTitle: "F", createdById: presB.id })).rejects.toThrow(
      WorkflowError
    );
  });

  it("een gebruiker in twee ringen heeft per ring een eigen rol en eigen deelnemerslijsten", async () => {
    const ringA = await createTestRing("Ring A");
    const ringB = await createTestRing("Ring B");
    const user = await createTestUser("RINGPRESIDIUM", "Dubbel Lid", { ringId: ringA.id });
    await prisma.ringMembership.create({ data: { userId: user.id, ringId: ringB.id, role: "HOGERAAD", churchFunction: "Hogeraadslid" } });
    const creatorA = await createTestUser("RINGSECRETARIS", "Secretaris A", { ringId: ringA.id });
    const presB = await createTestUser("RINGPRESIDIUM", "President B", { ringId: ringB.id });

    const callingA = await createCalling({ ringId: ringA.id, personName: "Jan", functionTitle: "F", createdById: creatorA.id });
    const callingB = await createCalling({ ringId: ringB.id, personName: "Piet", functionTitle: "F", createdById: presB.id });

    // In ring A is hij presidiumlid (deelnemer van de presidiumronde), in ring B hogeraadslid (nog niet aan de beurt).
    expect(await prisma.eligibleVoter.count({ where: { callingId: callingA.id, userId: user.id, stage: "PRESIDIUM" } })).toBe(1);
    expect(await prisma.eligibleVoter.count({ where: { callingId: callingB.id, userId: user.id } })).toBe(0);
  });
});
