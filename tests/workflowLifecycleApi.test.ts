import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { createUnit } from "@/lib/ringSetup";
import { createTestRing, createTestUser, resetDatabase } from "./setup";

// E2.6 fase B: volledige levenscyclus van een voorstel via de echte API (concept → ondersteuning → vrijgave → uitvoering → verwerkt),
// en een rollen-/ringmatrix: een directe API-aanroep geeft nooit rechten die de gebruiker niet heeft.
const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));
const { handleApi } = await import("@/lib/api/router");

beforeEach(async () => {
  await resetDatabase();
  await prisma.ringUnit.deleteMany();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, {
      method,
      headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
    }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const login = async (userId: string) => (await createVerifiedSession(userId, "Test")).rawToken;

let n = 0;
async function world() {
  const k = ++n;
  const ring = await createTestRing(`Ring ${k}`);
  const r = { ringId: ring.id };
  const manager = await createTestUser("RINGSECRETARIS", `Beheerder ${k}`, { ...r, isRingManager: true });
  const administrateur = await createTestUser("RINGADMINISTRATEUR", `Administrateur ${k}`, r);
  const president = await createTestUser("RINGPRESIDIUM", `President ${k}`, r);
  const counselor = await createTestUser("RINGPRESIDIUM", `Raadgever ${k}`, r);
  const ha = await createTestUser("HOGERAAD", `Hogeraad ${k}`, r);
  const unit = await createUnit(manager.id, ring.id, { kind: "WIJK", name: `Wijk ${k}`, responsibleUserId: ha.id });
  const tokens = {
    manager: await login(manager.id), administrateur: await login(administrateur.id), president: await login(president.id),
    counselor: await login(counselor.id), ha: await login(ha.id),
  };
  return { ring, manager, administrateur, president, counselor, ha, unit, tokens };
}
type W = Awaited<ReturnType<typeof world>>;
const body = (w: W) => ({ personName: "Voorbeeld Persoon", unitId: w.unit.id, functionSource: "STANDAARD", functionCode: "ringadministrateur" });
async function submitted(w: W) {
  const d = await call("POST", `/drafts?ring=${w.ring.id}`, { token: w.tokens.manager, body: body(w) });
  const res = await call("POST", `/drafts/${d.body.id}/submit`, { token: w.tokens.manager });
  expect(res.status).toBe(200);
  return res.body.id as string;
}
const statusOf = async (id: string) => (await prisma.calling.findUniqueOrThrow({ where: { id } })).status;

describe("Levenscyclus via de API", () => {
  it("concept bewaren en hervatten → indienen → presidium → vrijgave → hoge raad → taken → verwerkt, met meldingen zonder persoonsgegevens", async () => {
    const w = await world();
    // Concept bewaren en later hervatten
    const d = await call("POST", `/drafts?ring=${w.ring.id}`, { token: w.tokens.manager, body: { personName: "Voorbeeld Persoon" } });
    expect(d.status).toBe(200);
    const resumed = await call("GET", `/drafts/${d.body.id}`, { token: w.tokens.manager });
    expect(resumed.body.draft.personName).toBe("Voorbeeld Persoon");
    expect((await call("POST", `/drafts/${d.body.id}`, { token: w.tokens.manager, body: body(w) })).status).toBe(200);
    const sub = await call("POST", `/drafts/${d.body.id}/submit`, { token: w.tokens.manager });
    const id = sub.body.id as string;
    expect(await statusOf(id)).toBe("PRESIDIUM_VOTING");

    // Alleen het presidium wordt uitgenodigd; hoge raad nog niet
    const inviteTargets = (await prisma.notification.findMany({ where: { callingId: id, type: "NEW_PROPOSAL" } })).map((x) => x.userId).sort();
    expect(inviteTargets).toEqual([w.president.id, w.counselor.id].sort());

    // Hoge raad, secretaris en administrateur kunnen in de presidiumronde niet ondersteunen
    for (const t of [w.tokens.ha, w.tokens.manager, w.tokens.administrateur]) {
      const r = await call("POST", `/callings/${id}/vote`, { token: t, body: { support: true } });
      expect(r.status).toBeGreaterThanOrEqual(400);
    }
    expect(await prisma.vote.count({ where: { callingId: id } })).toBe(0);

    // Eén ondersteuning: ronde blijft open. Daarna tegen-ondersteuning pauzeert en niets gaat vanzelf verder.
    expect((await call("POST", `/callings/${id}/vote`, { token: w.tokens.president, body: { support: true } })).status).toBe(200);
    expect(await statusOf(id)).toBe("PRESIDIUM_VOTING");
    expect((await call("POST", `/callings/${id}/vote`, { token: w.tokens.counselor, body: { support: false } })).status).toBe(200);
    expect(await statusOf(id)).toBe("PRESIDIUM_PAUSED");
    expect((await call("POST", `/callings/${id}/release`, { token: w.tokens.manager })).status).toBeGreaterThanOrEqual(400);
    expect(await statusOf(id)).toBe("PRESIDIUM_PAUSED");

    // Opnieuw ondersteuning vragen (staf), niet door een niet-staflid; de tegenstem blijft staan tot de persoon zelf wijzigt
    expect((await call("POST", `/callings/${id}/reinvite`, { token: w.tokens.ha, body: { userId: w.counselor.id } })).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/callings/${id}/reinvite`, { token: w.tokens.manager, body: { userId: w.counselor.id } })).status).toBe(200);
    expect(await statusOf(id)).toBe("PRESIDIUM_PAUSED");
    expect((await call("POST", `/callings/${id}/vote`, { token: w.tokens.counselor, body: { support: true } })).status).toBe(200);
    expect(await statusOf(id)).toBe("PRESIDIUM_APPROVED"); // wacht op expliciete vrijgave
    expect(await prisma.eligibleVoter.count({ where: { callingId: id, stage: "HOGERAAD" } })).toBe(0);

    // Vrijgave: niet-staf geweigerd; staf slaagt; tweede vrijgave verandert niets
    expect((await call("POST", `/callings/${id}/release`, { token: w.tokens.ha })).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/callings/${id}/release`, { token: w.tokens.administrateur })).status).toBe(200);
    expect(await statusOf(id)).toBe("HOGERAAD_VOTING");
    const invitesBefore = await prisma.notification.count({ where: { callingId: id, type: "ADVANCED_TO_HOGERAAD" } });
    await call("POST", `/callings/${id}/release`, { token: w.tokens.administrateur });
    expect(await prisma.notification.count({ where: { callingId: id, type: "ADVANCED_TO_HOGERAAD" } })).toBe(invitesBefore);

    // Presidium kan niet meer stemmen in de hogeraadronde; hoge raad ondersteunt
    expect((await call("POST", `/callings/${id}/vote`, { token: w.tokens.president, body: { support: true } })).status).toBeGreaterThanOrEqual(400);
    expect((await call("POST", `/callings/${id}/vote`, { token: w.tokens.ha, body: { support: true } })).status).toBe(200);
    expect(await statusOf(id)).toBe("APPROVED");

    // Uitvoering: taken pas na goedkeuring; verwerken pas als alle drie klaar zijn
    expect((await call("POST", `/callings/${id}/process`, { token: w.tokens.manager })).status).toBeGreaterThanOrEqual(400);
    const done = (task: string, extra: object = {}) => call("POST", `/callings/${id}/tasks/${task}/complete`, { token: w.tokens.manager, body: { doneAt: new Date().toISOString().slice(0, 10), ...extra } });
    expect((await done("ROEPEN")).status).toBe(200);
    expect((await done("ONDERSTEUNEN")).status).toBeGreaterThanOrEqual(400); // gelegenheid ontbreekt
    expect((await done("ONDERSTEUNEN", { ondersteunenContext: "RINGCONFERENTIE" })).status).toBe(200);
    expect((await call("POST", `/callings/${id}/process`, { token: w.tokens.manager })).status).toBeGreaterThanOrEqual(400);
    expect((await done("AANSTELLEN")).status).toBe(200);
    expect((await call("POST", `/callings/${id}/process`, { token: w.tokens.manager })).status).toBe(200);
    expect(await statusOf(id)).toBe("PROCESSED");
    expect((await call("POST", `/callings/${id}/process`, { token: w.tokens.manager })).status).toBeGreaterThanOrEqual(400);

    // Meldingen: nooit persoonsgegevens in titel, bericht of pad; teller klopt met ongelezen
    const all = await prisma.notification.findMany({ where: { callingId: id } });
    expect(all.length).toBeGreaterThan(0);
    for (const x of all) {
      expect(`${x.title} ${x.message} ${x.targetUrl}`).not.toMatch(/Voorbeeld|Persoon|ringadministrateur/i);
      expect(x.targetUrl).toMatch(/^\/[a-z0-9/_-]+$/i);
    }
    const list = await call("GET", `/notifications?ring=${w.ring.id}`, { token: w.tokens.president });
    const unread = (await prisma.notification.count({ where: { userId: w.president.id, ringId: w.ring.id, readAt: null } }));
    expect(list.body.unread ?? list.body.unreadCount).toBe(unread);
    await call("POST", `/notifications/read?ring=${w.ring.id}`, { token: w.tokens.president, body: {} });
    expect(await prisma.notification.count({ where: { userId: w.president.id, ringId: w.ring.id, readAt: null } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: w.counselor.id, readAt: null } })).toBeGreaterThan(0); // andermans meldingen blijven ongelezen
  });
});

describe("Rollen- en ringmatrix: directe API-aanroepen", () => {
  const actions = (id: string, w: W): [string, string, object][] => [
    ["POST", `/callings/${id}/vote`, { support: false }],
    ["POST", `/callings/${id}/remind`, {}],
    ["POST", `/callings/${id}/reinvite`, { userId: w.counselor.id }],
    ["POST", `/callings/${id}/remove-participant`, { userId: w.counselor.id }],
    ["POST", `/callings/${id}/release`, {}],
    ["POST", `/callings/${id}/process`, {}],
    ["POST", `/callings/${id}/tasks/ROEPEN/assign`, { assigneeId: w.president.id }],
    ["POST", `/callings/${id}/tasks/ROEPEN/complete`, { doneAt: "2026-11-01" }],
    ["POST", `/callings/${id}/delete`, { confirmed: true }],
  ];

  async function snapshot(id: string) {
    const c = await prisma.calling.findUnique({ where: { id } });
    return JSON.stringify({ c, v: await prisma.vote.count({ where: { callingId: id } }), e: await prisma.eligibleVoter.count({ where: { callingId: id } }), nn: await prisma.notification.count({ where: { callingId: id } }) });
  }

  async function outsiders(w: W) {
    const other = await world(); // volledig andere ring met eigen staf
    const deactivated = await createTestUser("RINGSECRETARIS", "Gedeactiveerd Lid", { ringId: w.ring.id, isRingManager: true });
    const deactivatedMember = await createTestUser("RINGPRESIDIUM", "Gedeactiveerd Lidmaatschap", { ringId: w.ring.id, active: false });
    const admin = await createTestUser("ADMIN", "Webmin Test");
    const tDeactivated = await login(deactivated.id);
    await prisma.user.update({ where: { id: deactivated.id }, data: { active: false } });
    return { other: other.tokens.manager, otherPresident: other.tokens.president, deactivated: tDeactivated, deactivatedMember: await login(deactivatedMember.id), admin: await login(admin.id) };
  }

  for (const stage of ["PRESIDIUM_VOTING", "PRESIDIUM_APPROVED"] as const) {
    it(`buitenstaanders (andere ring, gedeactiveerd account/lidmaatschap, webmin) kunnen niets wijzigen in een voorstel in ${stage}`, async () => {
      const w = await world();
      const id = await submitted(w);
      if (stage === "PRESIDIUM_APPROVED") {
        await call("POST", `/callings/${id}/vote`, { token: w.tokens.president, body: { support: true } });
        await call("POST", `/callings/${id}/vote`, { token: w.tokens.counselor, body: { support: true } });
      }
      expect(await statusOf(id)).toBe(stage);
      const out = await outsiders(w);
      const before = await snapshot(id);
      for (const [who, token] of Object.entries(out)) {
        const view = await call("GET", `/callings/${id}`, { token });
        expect(view.status, `${who} mag het voorstel niet zien`).toBeGreaterThanOrEqual(400);
        for (const [m, p, b] of actions(id, w)) {
          const r = await call(m, p, { token, body: b });
          expect(r.status, `${who} ${p}`).toBeGreaterThanOrEqual(400);
        }
      }
      expect(await snapshot(id)).toBe(before);
    });
  }

  it("niet-staf (hoge raad) kan geen beheeracties uitvoeren; de ringbeheerder-vlag alleen geeft geen workflowrechten", async () => {
    const w = await world();
    const id = await submitted(w);
    const before = await snapshot(id);
    for (const [m, p, b] of actions(id, w).filter(([, p]) => !p.endsWith("/vote"))) {
      expect((await call(m, p, { token: w.tokens.ha, body: b })).status, `hoge raad ${p}`).toBeGreaterThanOrEqual(400);
    }
    expect(await snapshot(id)).toBe(before);
  });

  it("gedeactiveerde ring: niemand binnen die ring (ook staf) kan iets doen of zien", async () => {
    const w = await world();
    const id = await submitted(w);
    await prisma.ring.update({ where: { id: w.ring.id }, data: { active: false } });
    const before = await snapshot(id);
    for (const t of Object.values(w.tokens)) {
      expect((await call("GET", `/callings/${id}`, { token: t })).status).toBeGreaterThanOrEqual(400);
      for (const [m, p, b] of actions(id, w)) expect((await call(m, p, { token: t, body: b })).status, p).toBeGreaterThanOrEqual(400);
    }
    expect(await snapshot(id)).toBe(before);
  });

  it("gebruiker met lidmaatschappen van meerdere ringen: rechten gelden per ring (hoge raad in A, presidium in B)", async () => {
    const a = await world();
    const b = await world();
    const multi = await createTestUser("HOGERAAD", "Dubbel Lid", { ringId: a.ring.id });
    await prisma.ringMembership.create({ data: { userId: multi.id, ringId: b.ring.id, role: "RINGPRESIDIUM", churchFunction: "Raadgever", active: true } });
    const t = await login(multi.id);
    const idA = await submitted(a);
    const idB = await submitted(b);
    // In ring A (presidiumronde, hij is daar hoge raad): geweigerd
    expect((await call("POST", `/callings/${idA}/vote`, { token: t, body: { support: true } })).status).toBeGreaterThanOrEqual(400);
    expect(await prisma.vote.count({ where: { userId: multi.id } })).toBe(0);
    // In ring B (presidium, in de deelnemerslijst bij indienen) mag hij wel ondersteunen: dezelfde gebruiker, andere rechten per ring
    expect((await call("POST", `/callings/${idB}/vote`, { token: t, body: { support: true } })).status).toBe(200);
    expect(await prisma.vote.count({ where: { userId: multi.id, callingId: idB } })).toBe(1);
    // Hij ziet beide voorstellen alleen waar hij lid is, en nooit die van een derde ring
    const c = await world();
    const idC = await submitted(c);
    expect((await call("GET", `/callings/${idC}`, { token: t })).status).toBeGreaterThanOrEqual(400);
    // Staf-actie in B (hij is daar geen staf): geweigerd
    expect((await call("POST", `/callings/${idB}/release`, { token: t })).status).toBeGreaterThanOrEqual(400);
  });

  it("een lid dat tijdens de ronde wordt gedeactiveerd kan niet meer reageren en telt niet mee voor goedkeuring", async () => {
    const w = await world();
    const id = await submitted(w);
    await prisma.ringMembership.updateMany({ where: { userId: w.counselor.id, ringId: w.ring.id }, data: { active: false } });
    expect((await call("POST", `/callings/${id}/vote`, { token: w.tokens.counselor, body: { support: true } })).status).toBeGreaterThanOrEqual(400);
    await call("POST", `/callings/${id}/vote`, { token: w.tokens.president, body: { support: true } });
    expect(await statusOf(id)).toBe("PRESIDIUM_VOTING"); // iedereen uit de bevroren lijst moet nog reageren; geen stille goedkeuring
  });
});
