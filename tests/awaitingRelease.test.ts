import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCalling, createTestRing, createTestUser, resetDatabase } from "./setup";

const pushState = vi.hoisted(() => ({ fail: false, calls: 0 }));
vi.mock("@/lib/push", () => ({
  sendPushToUsers: async () => {
    pushState.calls++;
    if (pushState.fail) throw new Error("tijdelijke pushstoring");
  },
}));

const { castVote, registerGroupDecision, releaseToHogeraad, deliverReleaseNotifications, retryPendingReleaseNotifications, RELEASE_NOTIFY_LEASE_MS } = await import("@/lib/workflow");

beforeEach(async () => {
  await resetDatabase();
  pushState.fail = false;
  pushState.calls = 0;
});

const today = () => new Date().toISOString().slice(0, 10);

let seq = 0;
async function setup() {
  const n = ++seq;
  const ring = await createTestRing(`Ring ${Math.random().toString(36).slice(2, 7)}`);
  const inRing = { ringId: ring.id };
  const president = await createTestUser("RINGPRESIDIUM", `President ${n}`, inRing);
  const counselor = await createTestUser("RINGPRESIDIUM", `Raadgever ${n}`, inRing);
  const secretary = await createTestUser("RINGSECRETARIS", `Secretaris ${n}`, inRing);
  const administrator = await createTestUser("RINGADMINISTRATEUR", `Administrateur ${n}`, inRing);
  const hogeraad = await createTestUser("HOGERAAD", `Hogeraadslid ${n}`, inRing);
  const inactiveStaff = await createTestUser("RINGSECRETARIS", `Inactief ${n}`, inRing);
  await prisma.ringMembership.updateMany({ where: { userId: inactiveStaff.id }, data: { active: false } });
  const calling = await createCalling({ ringId: ring.id, personName: "Voorbeeld Persoon", functionTitle: "Leraar", createdById: secretary.id });
  return { ring, president, counselor, secretary, administrator, hogeraad, inactiveStaff, calling };
}
type S = Awaited<ReturnType<typeof setup>>;

const rows = (callingId: string) => prisma.notification.findMany({ where: { callingId, type: "AWAITING_RELEASE" } });
const approveIndividually = async (s: S) => {
  for (const u of [s.president, s.counselor]) await castVote({ callingId: s.calling.id, userId: u.id, support: true });
};

describe("C1: melding 'Voorstel wacht op vrijgave'", () => {
  it("individueel presidiumakkoord: actieve ringstaf krijgt één generieke melding, de hoge raad niet", async () => {
    const s = await setup();
    await approveIndividually(s);
    const n = await rows(s.calling.id);
    expect(n.map((r) => r.userId).sort()).toEqual([s.president.id, s.counselor.id, s.secretary.id, s.administrator.id].sort());
    for (const r of n) {
      expect(r).toMatchObject({ title: "Voorstel wacht op vrijgave", targetUrl: `/roepingen/${s.calling.id}`, ringId: s.ring.id });
      expect(`${r.title} ${r.message} ${r.targetUrl}`).not.toMatch(/Voorbeeld|Persoon|Leraar/);
    }
    expect(n.map((r) => r.userId)).not.toContain(s.hogeraad.id);
    expect(n.map((r) => r.userId)).not.toContain(s.inactiveStaff.id);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: s.calling.id } })).releaseNotifiedAt).not.toBeNull();
  });

  it("gezamenlijk presidiumbesluit (door de secretaris): dezelfde melding, de secretaris wordt geen ondersteuner", async () => {
    const s = await setup();
    await registerGroupDecision({ callingId: s.calling.id, actorId: s.secretary.id, stage: "PRESIDIUM", decidedOn: today(), agreed: true, presentUserIds: [s.president.id] });
    expect((await rows(s.calling.id)).length).toBe(4);
    expect(await prisma.vote.count({ where: { callingId: s.calling.id } })).toBe(0);
    expect(await prisma.eligibleVoter.count({ where: { callingId: s.calling.id, userId: s.secretary.id } })).toBe(0);
  });

  it("geen dubbele meldingen bij herhaalde en gelijktijdige verzoeken", async () => {
    const s = await setup();
    await approveIndividually(s);
    await Promise.all([1, 2, 3, 4].map(() => deliverReleaseNotifications(s.calling.id)));
    await deliverReleaseNotifications(s.calling.id);
    await retryPendingReleaseNotifications(new Date(Date.now() + 10 * RELEASE_NOTIFY_LEASE_MS));
    expect((await rows(s.calling.id)).length).toBe(4);
    // herhaald gezamenlijk besluit (idempotent) verstuurt niets extra's
    const s2 = await setup();
    const input = { callingId: s2.calling.id, actorId: s2.secretary.id, stage: "PRESIDIUM" as const, decidedOn: today(), agreed: true, presentUserIds: [s2.president.id] };
    await Promise.all([registerGroupDecision(input), registerGroupDecision(input), registerGroupDecision(input)]);
    expect((await rows(s2.calling.id)).length).toBe(4);
  });

  it("alleen de ring van het voorstel wordt gemeld", async () => {
    const s = await setup();
    const other = await setup();
    await approveIndividually(s);
    expect(await prisma.notification.count({ where: { userId: { in: [other.president.id, other.secretary.id] }, type: "AWAITING_RELEASE" } })).toBe(0);
    expect((await rows(s.calling.id)).every((r) => r.ringId === s.ring.id)).toBe(true);
  });

  it("geen melding zolang het voorstel niet tot PRESIDIUM_APPROVED heeft geleid (gedeeltelijk akkoord, negatieve reactie)", async () => {
    const s = await setup();
    await castVote({ callingId: s.calling.id, userId: s.president.id, support: true });
    expect((await rows(s.calling.id)).length).toBe(0);
    await castVote({ callingId: s.calling.id, userId: s.counselor.id, support: false });
    expect((await rows(s.calling.id)).length).toBe(0);
    expect(await deliverReleaseNotifications(s.calling.id)).toBe("sent"); // status niet PRESIDIUM_APPROVED: niets te melden
    expect((await rows(s.calling.id)).length).toBe(0);
  });

  it("de melding leidt nooit tot vrijgave; vrijgeven blijft een aparte, expliciete handeling", async () => {
    const s = await setup();
    await approveIndividually(s);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: s.calling.id } })).status).toBe("PRESIDIUM_APPROVED");
    expect(await prisma.eligibleVoter.count({ where: { callingId: s.calling.id, stage: "HOGERAAD" } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: s.hogeraad.id } })).toBe(0);
    await releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id });
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: s.calling.id } })).status).toBe("HOGERAAD_VOTING");
    expect((await rows(s.calling.id)).length).toBe(4); // vrijgave veroorzaakt geen tweede melding
  });

  it("tijdelijke fout: het akkoord blijft bestaan, de levering wordt hersteld zonder dubbele meldingen", async () => {
    const s = await setup();
    pushState.fail = true;
    await approveIndividually(s); // push faalt na het opslaan van de interne meldingen
    let c = await prisma.calling.findUniqueOrThrow({ where: { id: s.calling.id } });
    expect(c.status).toBe("PRESIDIUM_APPROVED");
    expect(c.releaseNotifiedAt).toBeNull();
    expect((await rows(s.calling.id)).length).toBe(4); // interne melding is de betrouwbare registratie

    pushState.fail = false;
    // binnen de lease: nog bezig, geen nieuwe poging
    expect(await deliverReleaseNotifications(s.calling.id)).toBe("busy");
    // de achtergrondtaak maakt het na de lease af
    expect(await retryPendingReleaseNotifications(new Date(Date.now() + 2 * RELEASE_NOTIFY_LEASE_MS))).toBe(1);
    c = await prisma.calling.findUniqueOrThrow({ where: { id: s.calling.id } });
    expect(c.releaseNotifiedAt).not.toBeNull();
    expect((await rows(s.calling.id)).length).toBe(4);
  });

  it("is het voorstel intussen vrijgegeven, dan stuurt een late herhaling niets meer", async () => {
    const s = await setup();
    pushState.fail = true;
    await approveIndividually(s);
    pushState.fail = false;
    await prisma.notification.deleteMany({ where: { callingId: s.calling.id } });
    await releaseToHogeraad({ callingId: s.calling.id, actorId: s.president.id });
    await prisma.notification.deleteMany({ where: { callingId: s.calling.id } });
    await retryPendingReleaseNotifications(new Date(Date.now() + 2 * RELEASE_NOTIFY_LEASE_MS));
    expect(await prisma.notification.count({ where: { callingId: s.calling.id, type: "AWAITING_RELEASE" } })).toBe(0);
  });
});
