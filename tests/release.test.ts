import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { castVote, registerGroupDecision, releaseToHogeraad, AuthorizationError, WorkflowError } from "@/lib/workflow";
import { createCalling, createTestRing, createTestUser, resetDatabase } from "./setup";

beforeEach(async () => {
  await resetDatabase();
});

const today = () => new Date().toISOString().slice(0, 10);

let seq = 0;
async function ringSetup(opts: { hogeraad?: number } = {}) {
  const n = ++seq;
  const ring = await createTestRing(`Ring ${Math.random().toString(36).slice(2, 7)}`);
  const inRing = { ringId: ring.id };
  const president = await createTestUser("RINGPRESIDIUM", `President ${n}`, inRing);
  const counselor1 = await createTestUser("RINGPRESIDIUM", `Eerste raadgever ${n}`, inRing);
  const counselor2 = await createTestUser("RINGPRESIDIUM", `Tweede raadgever ${n}`, inRing);
  const secretary = await createTestUser("RINGSECRETARIS", `Secretaris ${n}`, inRing);
  const administrator = await createTestUser("RINGADMINISTRATEUR", `Administrateur ${n}`, inRing);
  const hogeraad = [];
  for (let i = 0; i < (opts.hogeraad ?? 3); i++) hogeraad.push(await createTestUser("HOGERAAD", `Hogeraadslid ${n}-${i + 1}`, inRing));
  const calling = await createCalling({ ringId: ring.id, personName: "Voorbeeld Persoon", functionTitle: "Leraar", createdById: secretary.id });
  return { ring, president, counselor1, counselor2, secretary, administrator, hogeraad, calling };
}

async function presidiumApproves(s: Awaited<ReturnType<typeof ringSetup>>) {
  for (const u of [s.president, s.counselor1, s.counselor2]) await castVote({ callingId: s.calling.id, userId: u.id, support: true });
  return prisma.calling.findUniqueOrThrow({ where: { id: s.calling.id } });
}
const status = async (id: string) => (await prisma.calling.findUniqueOrThrow({ where: { id } })).status;

describe("Vrijgave aan de hoge raad", () => {
  it("een lege hoge raad veroorzaakt nooit goedkeuring en blokkeert de vrijgave", async () => {
    const s = await ringSetup({ hogeraad: 0 });
    const approved = await presidiumApproves(s);
    expect(approved.status).toBe("PRESIDIUM_APPROVED");
    expect(approved.approvedAt).toBeNull();
    await expect(releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id })).rejects.toThrow(/geen actieve hogeraadsleden/);
    expect(await status(s.calling.id)).toBe("PRESIDIUM_APPROVED");
  });

  it("unaniem presidiumakkoord start de hogeraadronde niet en de hoge raad ontvangt niets", async () => {
    const s = await ringSetup();
    const approved = await presidiumApproves(s);
    expect(approved).toMatchObject({ status: "PRESIDIUM_APPROVED", presidiumApprovalMethod: "INDIVIDUAL" });
    expect(approved.presidiumApprovedAt).not.toBeNull();
    expect(await prisma.eligibleVoter.count({ where: { callingId: s.calling.id, stage: "HOGERAAD" } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: { in: s.hogeraad.map((h) => h.id) } } })).toBe(0);
  });

  it("vrijgave gebeurt exact eenmaal, ook bij gelijktijdige en herhaalde verzoeken, met auditregistratie", async () => {
    const s = await ringSetup();
    await presidiumApproves(s);
    const results = await Promise.all(
      [s.president, s.secretary, s.administrator, s.president, s.secretary].map((u) => releaseToHogeraad({ callingId: s.calling.id, actorId: u.id }))
    );
    expect(results.filter((r) => r.released)).toHaveLength(1);
    expect(await status(s.calling.id)).toBe("HOGERAAD_VOTING");
    expect(await prisma.eligibleVoter.count({ where: { callingId: s.calling.id, stage: "HOGERAAD" } })).toBe(3);
    expect(await prisma.notification.count({ where: { callingId: s.calling.id, type: "ADVANCED_TO_HOGERAAD" } })).toBe(3);
    expect(await prisma.callingAudit.count({ where: { callingId: s.calling.id, type: "HOGERAAD_RELEASED" } })).toBe(1);
    const c = await prisma.calling.findUniqueOrThrow({ where: { id: s.calling.id } });
    expect(c.hogeraadReleasedById).not.toBeNull();
    // opnieuw: geen tweede ronde en geen dubbele uitnodigingen
    expect((await releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id })).alreadyReleased).toBe(true);
    expect(await prisma.notification.count({ where: { callingId: s.calling.id, type: "ADVANCED_TO_HOGERAAD" } })).toBe(3);
  });

  it("alleen ringstaf van de eigen ring mag vrijgeven; niet vóór presidiumakkoord", async () => {
    const s = await ringSetup();
    await expect(releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id })).rejects.toThrow(WorkflowError); // nog geen akkoord
    await presidiumApproves(s);
    await expect(releaseToHogeraad({ callingId: s.calling.id, actorId: s.hogeraad[0].id })).rejects.toThrow(AuthorizationError);
    const other = await ringSetup();
    await expect(releaseToHogeraad({ callingId: s.calling.id, actorId: other.president.id })).rejects.toThrow(AuthorizationError);
    expect(await status(s.calling.id)).toBe("PRESIDIUM_APPROVED");
  });

  it("gedeactiveerde hogeraadsleden worden niet uitgenodigd", async () => {
    const s = await ringSetup();
    await presidiumApproves(s);
    await prisma.ringMembership.updateMany({ where: { userId: s.hogeraad[0].id }, data: { active: false } });
    await releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id });
    const eligible = await prisma.eligibleVoter.findMany({ where: { callingId: s.calling.id, stage: "HOGERAAD" } });
    expect(eligible.map((e) => e.userId)).not.toContain(s.hogeraad[0].id);
    expect(eligible).toHaveLength(2);
  });

  it("een gedeactiveerde ring staat geen vrijgave toe", async () => {
    const s = await ringSetup();
    await presidiumApproves(s);
    await prisma.ring.update({ where: { id: s.ring.id }, data: { active: false } });
    await expect(releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id })).rejects.toThrow(AuthorizationError);
  });
});

describe("Gezamenlijk akkoord – presidium", () => {
  it.each([["president"], ["secretary"], ["administrator"]] as const)("kan door %s worden geregistreerd zonder individuele stemmen of vrijgave", async (who) => {
    const s = await ringSetup();
    const res = await registerGroupDecision({ callingId: s.calling.id, actorId: s[who].id, stage: "PRESIDIUM", decidedOn: today(), agreed: true, presentUserIds: [s.president.id, s.counselor1.id], note: "Besproken in de presidiumvergadering." });
    expect(res.calling.status).toBe("PRESIDIUM_APPROVED");
    expect(res.calling.presidiumApprovalMethod).toBe("MEETING");
    expect(await prisma.vote.count({ where: { callingId: s.calling.id } })).toBe(0); // geen fictieve reacties namens anderen
    expect(await prisma.eligibleVoter.count({ where: { callingId: s.calling.id, stage: "HOGERAAD" } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: { in: s.hogeraad.map((h) => h.id) } } })).toBe(0);
    const decision = await prisma.groupDecision.findFirstOrThrow({ where: { callingId: s.calling.id } });
    expect(decision).toMatchObject({ registeredById: s[who].id, agreed: true, stage: "PRESIDIUM" });
  });

  it("secretaris en administrateur krijgen daardoor geen individuele ondersteuningsstem", async () => {
    const s = await ringSetup();
    await registerGroupDecision({ callingId: s.calling.id, actorId: s.secretary.id, stage: "PRESIDIUM", decidedOn: today(), agreed: true, presentUserIds: [s.president.id] });
    const eligible = await prisma.eligibleVoter.findMany({ where: { callingId: s.calling.id, stage: "PRESIDIUM" } });
    expect(eligible.map((e) => e.userId)).not.toContain(s.secretary.id);
    expect(eligible.map((e) => e.userId)).not.toContain(s.administrator.id);
    await expect(castVote({ callingId: s.calling.id, userId: s.secretary.id, support: true })).rejects.toThrow(WorkflowError);
  });

  it("is alleen voor ringstaf, vereist een expliciete verklaring en een geldige datum", async () => {
    const s = await ringSetup();
    const base = { callingId: s.calling.id, stage: "PRESIDIUM" as const, decidedOn: today(), presentUserIds: [s.president.id] };
    await expect(registerGroupDecision({ ...base, actorId: s.hogeraad[0].id, agreed: true })).rejects.toThrow(AuthorizationError);
    await expect(registerGroupDecision({ ...base, actorId: s.president.id, agreed: false })).rejects.toThrow(/daadwerkelijk akkoord/);
    await expect(registerGroupDecision({ ...base, actorId: s.president.id, agreed: true, decidedOn: "2999-01-01" })).rejects.toThrow(/toekomst/);
    await expect(registerGroupDecision({ ...base, actorId: s.president.id, agreed: true, decidedOn: "geen-datum" })).rejects.toThrow(WorkflowError);
    expect(await status(s.calling.id)).toBe("PRESIDIUM_VOTING");
  });

  it("een negatieve reactie wordt nooit ongemerkt overschreven: expliciete afhandeling vereist, de reactie blijft bestaan", async () => {
    const s = await ringSetup();
    await castVote({ callingId: s.calling.id, userId: s.counselor1.id, support: false });
    const input = { callingId: s.calling.id, actorId: s.president.id, stage: "PRESIDIUM" as const, decidedOn: today(), agreed: true, presentUserIds: [s.president.id, s.counselor2.id] };
    await expect(registerGroupDecision(input)).rejects.toThrow(/negatieve reactie/);
    await expect(registerGroupDecision({ ...input, resolveNegative: true, resolutionNote: "kort" })).rejects.toThrow(/negatieve reactie/);
    expect(await status(s.calling.id)).toBe("PRESIDIUM_PAUSED");
    await registerGroupDecision({ ...input, resolveNegative: true, resolutionNote: "Zorg besproken en weggenomen in de vergadering." });
    expect(await status(s.calling.id)).toBe("PRESIDIUM_APPROVED");
    expect((await prisma.vote.findFirstOrThrow({ where: { callingId: s.calling.id, userId: s.counselor1.id } })).support).toBe(false); // niet overschreven
    expect((await prisma.groupDecision.findFirstOrThrow({ where: { callingId: s.calling.id } })).overrodeNegativeVotes).toBe(true);
    expect(await prisma.callingAudit.count({ where: { callingId: s.calling.id, type: "GROUP_DECISION_PRESIDIUM" } })).toBe(1);
  });

  it("is idempotent en veilig bij gelijktijdige verzoeken: exact één registratie", async () => {
    const s = await ringSetup();
    const input = { callingId: s.calling.id, stage: "PRESIDIUM" as const, decidedOn: today(), agreed: true, presentUserIds: [s.president.id] };
    const res = await Promise.all([s.president, s.secretary, s.administrator].map((u) => registerGroupDecision({ ...input, actorId: u.id })));
    expect(res.filter((r) => !r.alreadyRegistered)).toHaveLength(1);
    expect(await prisma.groupDecision.count({ where: { callingId: s.calling.id } })).toBe(1);
  });
});

describe("Gezamenlijk akkoord – presidium: wie nam het besluit", () => {
  const input = (s: Awaited<ReturnType<typeof ringSetup>>, over: Record<string, unknown> = {}) =>
    ({ callingId: s.calling.id, actorId: s.secretary.id, stage: "PRESIDIUM" as const, decidedOn: today(), agreed: true, ...over });

  it("vereist minstens één actief presidiumlid dat aan het besluit deelnam; een secretaris of administrateur stelt het niet zelfstandig vast", async () => {
    const s = await ringSetup();
    await expect(registerGroupDecision(input(s))).rejects.toThrow(/Geef aan welke leden van het ringpresidium/);
    await expect(registerGroupDecision(input(s, { presentUserIds: [] }))).rejects.toThrow(/Geef aan welke leden/);
    for (const notPresidium of [s.secretary, s.administrator, s.hogeraad[0]]) {
      await expect(registerGroupDecision(input(s, { presentUserIds: [notPresidium.id] })), notPresidium.id).rejects.toThrow(/actieve leden van het ringpresidium/);
    }
    const other = await ringSetup(); // presidiumlid van een andere ring telt niet
    await expect(registerGroupDecision(input(s, { presentUserIds: [other.president.id] }))).rejects.toThrow(/actieve leden van het ringpresidium/);
    expect(await status(s.calling.id)).toBe("PRESIDIUM_VOTING");
    expect(await prisma.groupDecision.count({ where: { callingId: s.calling.id } })).toBe(0);
    expect(await prisma.callingAudit.count({ where: { callingId: s.calling.id } })).toBe(0);
  });

  it("registreert welke presidiumleden het besluit namen; de registrerende staf telt niet mee en er komen geen reacties", async () => {
    const s = await ringSetup();
    const res = await registerGroupDecision(input(s, { actorId: s.administrator.id, presentUserIds: [s.counselor1.id, s.president.id, s.president.id] }));
    expect(res.calling.status).toBe("PRESIDIUM_APPROVED");
    const d = await prisma.groupDecision.findFirstOrThrow({ where: { callingId: s.calling.id } });
    expect(d.registeredById).toBe(s.administrator.id);
    expect([...d.presentUserIds].sort()).toEqual([s.president.id, s.counselor1.id].sort());
    expect(d.presentUserIds).not.toContain(s.administrator.id);
    expect(await prisma.vote.count({ where: { callingId: s.calling.id } })).toBe(0);
  });

  it("is niet mogelijk zonder actief presidiumlid (bijv. alle leden gedeactiveerd)", async () => {
    const s = await ringSetup();
    await prisma.ringMembership.updateMany({ where: { ringId: s.ring.id, role: "RINGPRESIDIUM" }, data: { active: false } });
    await expect(registerGroupDecision(input(s, { presentUserIds: [s.president.id] }))).rejects.toThrow(/geen actief lid van het ringpresidium/);
    expect(await status(s.calling.id)).toBe("PRESIDIUM_VOTING");
    // een deelnemer die na het besluit inactief wordt, verandert het vastgelegde besluit niet; een inactief lid kan er wel niet in worden opgenomen
    await prisma.ringMembership.updateMany({ where: { userId: s.president.id }, data: { active: true } });
    await expect(registerGroupDecision(input(s, { presentUserIds: [s.counselor1.id] }))).rejects.toThrow(/actieve leden/);
    expect((await registerGroupDecision(input(s, { presentUserIds: [s.president.id] }))).calling.status).toBe("PRESIDIUM_APPROVED");
  });

  it("beide vormen van ondersteuning blijven bestaan: individuele reacties werken zonder gezamenlijk besluit", async () => {
    const s = await ringSetup();
    const approved = await presidiumApproves(s);
    expect(approved).toMatchObject({ status: "PRESIDIUM_APPROVED", presidiumApprovalMethod: "INDIVIDUAL" });
    expect(await prisma.groupDecision.count({ where: { callingId: s.calling.id } })).toBe(0);
    const t = await ringSetup();
    expect((await registerGroupDecision(input(t, { presentUserIds: [t.president.id] }))).calling.presidiumApprovalMethod).toBe("MEETING");
  });
});

describe("Gezamenlijk akkoord – hoge raad", () => {
  async function inHogeraad() {
    const s = await ringSetup();
    await presidiumApproves(s);
    await releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id });
    return s;
  }

  it("werkt zonder afwezige leden als ondersteuner te registreren", async () => {
    const s = await inHogeraad();
    const res = await registerGroupDecision({
      callingId: s.calling.id, actorId: s.secretary.id, stage: "HOGERAAD", decidedOn: today(), agreed: true,
      presidingUserId: s.president.id, presentUserIds: [s.hogeraad[0].id, s.hogeraad[1].id], absentUserIds: [s.hogeraad[2].id],
    });
    expect(res.calling.status).toBe("APPROVED");
    expect(res.calling.hogeraadApprovalMethod).toBe("MEETING");
    expect(await prisma.vote.count({ where: { callingId: s.calling.id, stage: "HOGERAAD" } })).toBe(0);
    const d = await prisma.groupDecision.findFirstOrThrow({ where: { callingId: s.calling.id, stage: "HOGERAAD" } });
    expect(d.absentUserIds).toEqual([s.hogeraad[2].id]);
    expect(d.presidingUserId).toBe(s.president.id);
  });

  it("kan niet zonder presiderend lid van het ringpresidium als gezamenlijk besluit worden geregistreerd", async () => {
    const s = await inHogeraad();
    const base = { callingId: s.calling.id, actorId: s.secretary.id, stage: "HOGERAAD" as const, decidedOn: today(), agreed: true, presentUserIds: [s.hogeraad[0].id] };
    await expect(registerGroupDecision(base)).rejects.toThrow(/presiderend|voorzat/);
    await expect(registerGroupDecision({ ...base, presidingUserId: s.secretary.id })).rejects.toThrow(/ringpresidium/); // secretaris presideert niet
    await expect(registerGroupDecision({ ...base, presidingUserId: s.hogeraad[0].id })).rejects.toThrow(/ringpresidium/);
    expect(await status(s.calling.id)).toBe("HOGERAAD_VOTING");
    expect(await prisma.groupDecision.count({ where: { callingId: s.calling.id } })).toBe(0);
  });

  it("valideert aanwezigheid: minstens één aanwezige, geen overlap, alleen deelnemers van deze ronde", async () => {
    const s = await inHogeraad();
    const base = { callingId: s.calling.id, actorId: s.president.id, stage: "HOGERAAD" as const, decidedOn: today(), agreed: true, presidingUserId: s.president.id };
    await expect(registerGroupDecision({ ...base, presentUserIds: [] })).rejects.toThrow(/aanwezig/);
    await expect(registerGroupDecision({ ...base, presentUserIds: [s.hogeraad[0].id], absentUserIds: [s.hogeraad[0].id] })).rejects.toThrow(/tegelijk/);
    const stranger = await ringSetup();
    await expect(registerGroupDecision({ ...base, presentUserIds: [stranger.hogeraad[0].id] })).rejects.toThrow(/deelnemers/);
    expect(await status(s.calling.id)).toBe("HOGERAAD_VOTING");
  });

  it("een negatieve hogeraadsreactie vereist expliciete afhandeling en blijft bewaard", async () => {
    const s = await inHogeraad();
    await castVote({ callingId: s.calling.id, userId: s.hogeraad[0].id, support: false });
    const input = { callingId: s.calling.id, actorId: s.president.id, stage: "HOGERAAD" as const, decidedOn: today(), agreed: true, presidingUserId: s.president.id, presentUserIds: [s.hogeraad[1].id] };
    await expect(registerGroupDecision(input)).rejects.toThrow(/negatieve reactie/);
    await registerGroupDecision({ ...input, resolveNegative: true, resolutionNote: "Bezwaar besproken en afgehandeld tijdens de vergadering." });
    expect((await prisma.vote.findFirstOrThrow({ where: { callingId: s.calling.id, userId: s.hogeraad[0].id } })).support).toBe(false);
  });

  it("alleen bevoegde ringstaf van de eigen ring en alleen in de juiste fase", async () => {
    const s = await inHogeraad();
    const base = { callingId: s.calling.id, decidedOn: today(), agreed: true, presidingUserId: s.president.id, presentUserIds: [s.hogeraad[0].id] };
    await expect(registerGroupDecision({ ...base, actorId: s.hogeraad[0].id, stage: "HOGERAAD" })).rejects.toThrow(AuthorizationError);
    const other = await ringSetup();
    await expect(registerGroupDecision({ ...base, actorId: other.president.id, stage: "HOGERAAD" })).rejects.toThrow(AuthorizationError);
    await expect(registerGroupDecision({ ...base, actorId: s.president.id, stage: "PRESIDIUM" })).rejects.toThrow(WorkflowError); // presidiumfase is al afgerond
  });
});
