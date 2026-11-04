import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { castVote, releaseToHogeraad, registerGroupDecision } from "@/lib/workflow";
import { createUnit, createCustomCalling, updateUnit } from "@/lib/ringSetup";
import { updateMember } from "@/lib/rings";
import { deleteStaleDrafts } from "@/lib/proposals";
import { createTestRing, createTestUser, resetDatabase } from "./setup";

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
async function setup() {
  const k = ++n;
  const ring = await createTestRing(`Ring ${k}`);
  const r = { ringId: ring.id };
  const manager = await createTestUser("RINGSECRETARIS", `Beheerder ${k}`, { ...r, isRingManager: true });
  const president = await createTestUser("RINGPRESIDIUM", `President ${k}`, r);
  const counselor = await createTestUser("RINGPRESIDIUM", `Raadgever ${k}`, r);
  const ha1 = await createTestUser("HOGERAAD", `Hogeraad A ${k}`, r);
  const ha2 = await createTestUser("HOGERAAD", `Hogeraad B ${k}`, r);
  const unit = await createUnit(manager.id, ring.id, { kind: "WIJK", name: `Wijk ${k}`, responsibleUserId: ha1.id });
  const token = await login(manager.id);
  return { ring, manager, president, counselor, ha1, ha2, unit, token };
}
type S = Awaited<ReturnType<typeof setup>>;

/** Legt functie + (waar vereist) machtiging vast zoals de ringbeheerder dat doet. De ringpresident heeft geen aparte machtiging nodig; raadgever en hogeraadslid wel. */
async function authorize(s: S, userId: string, role: "RINGPRESIDENT" | "AANGEWEZEN_RAADGEVER" | "AANGEWEZEN_HOGERAADSLID", fn = "Functie", tweede = false) {
  const m = await prisma.ringMembership.findFirstOrThrow({ where: { userId, ringId: s.ring.id } });
  const churchFunctionCode = role === "RINGPRESIDENT" ? "RINGPRESIDENT" : role === "AANGEWEZEN_RAADGEVER" ? (tweede ? "TWEEDE_RAADGEVER" : "EERSTE_RAADGEVER") : "HOGERAADSLID";
  await updateMember({
    actorId: s.manager.id, membershipId: m.id, churchFunction: fn, churchFunctionCode, role: m.role, isRingManager: m.isRingManager, active: true,
    appointAuthority: role === "RINGPRESIDENT" ? "NONE" : role,
  });
}

const base = (s: S, over: Record<string, unknown> = {}) => ({ personName: "Voorbeeld Persoon", unitId: s.unit.id, functionSource: "STANDAARD", functionCode: "ringadministrateur", ...over });
async function draft(s: S, body: Record<string, unknown>, token = s.token) {
  const r = await call("POST", `/drafts?ring=${s.ring.id}`, { token, body });
  return r;
}
const submit = (id: string, token: string) => call("POST", `/drafts/${id}/submit`, { token });

describe("Concepten", () => {
  it("een concept mag onvolledig zijn, is bewerkbaar en verwijderbaar en veroorzaakt geen ronde, geen melding en geen e-mail", async () => {
    const s = await setup();
    const d = await draft(s, { personName: "Alleen een naam" });
    expect(d.status).toBe(200);
    expect((await call("POST", `/drafts/${d.body.id}`, { token: s.token, body: { unitId: s.unit.id } })).status).toBe(200);
    expect((await call("POST", `/drafts/${d.body.id}`, { token: s.token, body: { functionSource: "STANDAARD", functionCode: "ringadministrateur" } })).status).toBe(200);
    const view = await call("GET", `/drafts/${d.body.id}`, { token: s.token });
    expect(view.body.draft).toMatchObject({ personName: "Alleen een naam", unitId: s.unit.id, functionCode: "ringadministrateur" });
    expect(view.body.procedure).toMatchObject({ ruleStatus: "GEVERIFIEERD", requiresConfirmation: false });
    // nog geen voorstel, geen deelnemers, geen meldingen, geen e-mail
    expect(await prisma.calling.count()).toBe(0);
    expect(await prisma.eligibleVoter.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect((await call("GET", `/drafts?ring=${s.ring.id}`, { token: s.token })).body.drafts).toHaveLength(1);
    expect((await call("POST", `/drafts/${d.body.id}/delete`, { token: s.token })).status).toBe(200);
    expect(await prisma.callingDraft.count()).toBe(0);
  });

  it("concepten zijn alleen zichtbaar voor ringstaf van de eigen ring (geen IDOR, geen tenantoverschrijding)", async () => {
    const a = await setup();
    const b = await setup();
    const d = await draft(a, base(a));
    const bToken = b.token;
    const plain = await login(a.ha1.id);
    for (const [method, path, body] of [
      ["GET", `/drafts/${d.body.id}`, undefined], ["POST", `/drafts/${d.body.id}`, { personName: "Gekaapt" }],
      ["POST", `/drafts/${d.body.id}/delete`, undefined], ["POST", `/drafts/${d.body.id}/submit`, undefined],
    ] as const) {
      expect((await call(method, path, { token: bToken, body })).status, `${method} ${path} andere ring`).toBe(403);
      expect((await call(method, path, { token: plain, body })).status, `${method} ${path} niet-staf`).toBe(403);
      expect((await call(method, path, { body })).status).toBe(401);
    }
    expect((await call("GET", `/drafts?ring=${a.ring.id}`, { token: bToken })).status).toBe(403);
    expect((await call("GET", `/drafts?ring=${a.ring.id}`, { token: plain })).status).toBe(403);
    expect((await prisma.callingDraft.findUniqueOrThrow({ where: { id: d.body.id } })).personName).toBe("Voorbeeld Persoon");
    // collega-staf van dezelfde ring ziet het concept wel
    expect((await call("GET", `/drafts/${d.body.id}`, { token: await login(a.president.id) })).status).toBe(200);
  });

  it("verwijzingen in een concept moeten bij de gekozen actieve ring horen (unit, eigen roeping, verantwoordelijken)", async () => {
    const a = await setup();
    const b = await setup();
    const ownB = await createCustomCalling(b.manager.id, b.ring.id, { name: "Koorleider", category: "Muziek" });
    expect((await draft(a, { unitId: b.unit.id })).status).toBe(400);
    expect((await draft(a, { functionSource: "EIGEN", functionCode: ownB.id })).status).toBe(400); // eigen roeping van een andere ring
    expect((await draft(a, { ondersteunenAssigneeId: b.ha1.id })).status).toBe(400);
    expect((await draft(a, { functionSource: "STANDAARD", functionCode: "bestaat-niet" })).status).toBe(400);
    expect((await draft(a, { functionSource: "STANDAARD", functionCode: "ringpresident" })).status).toBe(400); // procedure buiten Ringtools
    await updateUnit(a.manager.id, a.unit.id, { active: false });
    expect((await draft(a, { unitId: a.unit.id })).status).toBe(400); // gedeactiveerde unit
    await prisma.ring.update({ where: { id: a.ring.id }, data: { active: false } });
    expect((await draft(a, base(a))).status).toBe(403); // gedeactiveerde ring
  });
});

describe("Indienen", () => {
  it("dient het concept in: vastlegging server-side, voorstel naar het ringpresidium, concept wordt gewist", async () => {
    const s = await setup();
    const d = await draft(s, base(s, { ondersteunenAssigneeId: s.counselor.id }));
    const res = await submit(d.body.id, s.token);
    expect(res.status).toBe(200);
    const c = await prisma.calling.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(c).toMatchObject({
      status: "PRESIDIUM_VOTING", personName: "Voorbeeld Persoon", functionTitle: "Ringadministrateur", functionSource: "STANDAARD", functionCode: "ringadministrateur",
      unitId: s.unit.id, unitNameSnapshot: s.unit.name, unitKindSnapshot: "WIJK", catalogVersion: expect.stringMatching(/^\d{4}\.\d{2}-\d+$/), ondersteunenAssigneeId: s.counselor.id,
    });
    expect(c.procedureSnapshot).toMatchObject({ ruleStatus: "GEVERIFIEERD", appointedBy: "RINGPRESIDENT_OF_RAADGEVER", name: "Ringadministrateur" });
    expect(c.procedureConfirmedAt).toBeNull(); // geverifieerde standaardroeping: geen extra bevestiging nodig
    expect(await prisma.eligibleVoter.count({ where: { callingId: c.id, stage: "PRESIDIUM" } })).toBe(2); // alleen het ringpresidium
    expect(await prisma.notification.count({ where: { callingId: c.id, type: "NEW_PROPOSAL" } })).toBe(2);
    // persoonsgegevens verdwijnen uit het concept
    const row = await prisma.callingDraft.findUniqueOrThrow({ where: { id: d.body.id } });
    expect(row).toMatchObject({ personName: null, unitId: null, functionCode: null, submittedCallingId: c.id });
    // ingediend concept kan niet meer worden aangepast
    expect((await call("POST", `/drafts/${d.body.id}`, { token: s.token, body: { personName: "Anders" } })).status).toBe(400);
  });

  it("dubbel indienen (dubbel tikken, netwerkherhaling, gelijktijdig) maakt exact één voorstel en één set meldingen", async () => {
    const s = await setup();
    const d = await draft(s, base(s));
    const tokens = [s.token, await login(s.president.id), s.token, s.token, await login(s.counselor.id)];
    const results = await Promise.all(tokens.map((t) => submit(d.body.id, t)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => !r.body.alreadySubmitted)).toHaveLength(1);
    expect(await prisma.calling.count()).toBe(1);
    expect(await prisma.eligibleVoter.count()).toBe(2);
    expect(await prisma.notification.count({ where: { type: "NEW_PROPOSAL" } })).toBe(2);
    expect((await submit(d.body.id, s.token)).body.alreadySubmitted).toBe(true);
    expect(await prisma.calling.count()).toBe(1);
  });

  it("valideert bij indienen alles opnieuw: naam, unit, functie, actieve ring en verantwoordelijken", async () => {
    const s = await setup();
    const check = async (body: Record<string, unknown>, expected: RegExp) => {
      const d = await draft(s, body);
      const r = await submit(d.body.id, s.token);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(expected);
    };
    await check(base(s, { personName: "X" }), /naam van de persoon/);
    await check(base(s, { unitId: null }), /wijk of gemeente/);
    await check(base(s, { functionSource: null, functionCode: null }), /Kies een roeping/);
    // een concept dat eerst geldig was, maar waarvan de situatie intussen is gewijzigd, wordt bij indienen opnieuw getoetst
    const d = await draft(s, base(s));
    await updateUnit(s.manager.id, s.unit.id, { active: false });
    expect((await submit(d.body.id, s.token)).status).toBe(400);
    await updateUnit(s.manager.id, s.unit.id, { active: true });
    await prisma.ring.update({ where: { id: s.ring.id }, data: { active: false } });
    expect((await submit(d.body.id, s.token)).status).toBe(403);
    expect(await prisma.calling.count()).toBe(0);
  });

  it("indienen is geblokkeerd zolang de ringinrichting geen wijken of gemeenten kent; het concept blijft bewaard", async () => {
    const s = await setup();
    await prisma.ringUnit.deleteMany();
    const d = await draft(s, base(s, { unitId: null }));
    expect(d.status).toBe(200); // opslaan als concept mag altijd
    const blocked = await submit(d.body.id, s.token);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/ringinrichting is nog niet compleet/);
    expect(await prisma.calling.count()).toBe(0);
    expect(await prisma.callingDraft.count({ where: { id: d.body.id, submittedAt: null } })).toBe(1);
    // na het invoeren van een wijk: een unit is verplicht, daarna lukt indienen met dezelfde conceptsleutel
    const unit = await createUnit(s.manager.id, s.ring.id, { kind: "GEMEENTE", name: "Gemeente Nieuw" });
    expect((await submit(d.body.id, s.token)).status).toBe(400); // nog steeds geen wijk/gemeente van herkomst gekozen
    expect((await call("POST", `/drafts/${d.body.id}`, { token: s.token, body: { unitId: unit.id } })).status).toBe(200);
    const ok = await submit(d.body.id, s.token);
    expect(ok.status).toBe(200);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: ok.body.id } })).unitNameSnapshot).toBe("Gemeente Nieuw");
  });

  it("oude voorstellen blijven geldig (zonder C3-velden) en een latere unit- of cataloguswijziging verandert een bestaand voorstel niet", async () => {
    const s = await setup();
    const { createCalling } = await import("@/lib/workflow");
    const old = await createCalling({ ringId: s.ring.id, personName: "Oud Voorstel", functionTitle: "Vrije functie", createdById: s.manager.id });
    expect(old).toMatchObject({ functionSource: null, unitNameSnapshot: null, procedureSnapshot: null });
    const detail = await call("GET", `/callings/${old.id}`, { token: s.token });
    expect(detail.status).toBe(200);
    expect(detail.body.function).toMatchObject({ source: null, needsReview: false });
    expect(detail.body.eligibleAssignees).toEqual({ ROEPEN: null, AANSTELLEN: null }); // geen beperking op oude voorstellen

    const d = await draft(s, base(s));
    const r = await submit(d.body.id, s.token);
    await updateUnit(s.manager.id, s.unit.id, { name: "Hernoemde wijk" });
    const after = await call("GET", `/callings/${r.body.id}`, { token: s.token });
    expect(after.body.unit).toMatchObject({ name: s.unit.name }); // snapshot, niet de nieuwe naam
    expect(after.body.function).toMatchObject({ source: "STANDAARD", code: "ringadministrateur", ruleStatus: "GEVERIFIEERD", needsReview: false });
    expect(after.body.functionTitle).toBe("Ringadministrateur");
  });
});

describe("Eigen roepingen en niet-geverifieerde functies: servercontrole", () => {
  it("een eigen roeping zonder bevestiging wordt server-side geweigerd; met bevestiging vastgelegd en zonder bevoegdheden", async () => {
    const s = await setup();
    const own = await createCustomCalling(s.manager.id, s.ring.id, { name: "Koorleider", category: "Muziek" });
    const d = await draft(s, base(s, { functionSource: "EIGEN", functionCode: own.id }));
    const denied = await submit(d.body.id, s.token); // directe API-aanroep zonder bevestiging
    expect(denied.status).toBe(400);
    expect(denied.body.error).toMatch(/bevestig/i);
    expect(await prisma.calling.count()).toBe(0);
    await call("POST", `/drafts/${d.body.id}`, { token: s.token, body: { procedureConfirmed: true } });
    const ok = await submit(d.body.id, s.token);
    expect(ok.status).toBe(200);
    const c = await prisma.calling.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(c).toMatchObject({ functionSource: "EIGEN", functionCode: own.id, functionTitle: "Koorleider", procedureConfirmedById: s.manager.id });
    expect(c.procedureConfirmedAt).not.toBeNull();
    expect(c.procedureSnapshot).toMatchObject({ ruleStatus: "EIGEN", grantedBy: null, appointedBy: null });
    const detail = (await call("GET", `/callings/${c.id}`, { token: s.token })).body;
    expect(detail.function).toMatchObject({ source: "EIGEN", needsReview: true, procedureConfirmed: true });
    expect(detail.eligibleAssignees).toEqual({ ROEPEN: [], AANSTELLEN: [] }); // geen fictieve automatische bevoegdheid
  });

  it("een eigen roeping van een andere ring kan niet worden gebruikt, ook niet door het concept te manipuleren", async () => {
    const a = await setup();
    const b = await setup();
    const ownB = await createCustomCalling(b.manager.id, b.ring.id, { name: "Geheime functie", category: "Muziek" });
    const d = await draft(a, base(a));
    await prisma.callingDraft.update({ where: { id: d.body.id }, data: { functionSource: "EIGEN", functionCode: ownB.id, procedureConfirmed: true } });
    expect((await submit(d.body.id, a.token)).status).toBe(400);
    expect(await prisma.calling.count()).toBe(0);
  });

  it("een niet-geverifieerde standaardroeping vereist dezelfde bevestiging en kent geen interne uitvoerders toe", async () => {
    const s = await setup();
    await authorize(s, s.president.id, "RINGPRESIDENT", "Ringpresident");
    const d = await draft(s, base(s, { functionCode: "muziekdeskundige" }));
    const view = (await call("GET", `/drafts/${d.body.id}`, { token: s.token })).body;
    expect(view.procedure).toMatchObject({ ruleStatus: "TE_BEOORDELEN", requiresConfirmation: true });
    expect(view.procedure.warning).toMatch(/Menselijke controle nodig/);
    expect(view.suggestions.eligible).toEqual({ roepen: [], aanstellen: [] }); // ook niet met een aangewezen ringpresident
    expect((await submit(d.body.id, s.token)).status).toBe(400);
    // zelfs met bevestiging kan geen interne persoon als roepende/aanstellende worden gekozen
    const withAppointer = await draft(s, base(s, { functionCode: "muziekdeskundige", procedureConfirmed: true, aanstellenAssigneeId: s.president.id }));
    const res = await submit(withAppointer.body.id, s.token);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geen aangewezen bevoegdheid/);
    // een bevoegde externe persoon kan handmatig worden geregistreerd
    const external = await draft(s, base(s, { functionCode: "muziekdeskundige", procedureConfirmed: true, aanstellenExternalName: "Gebiedszeventiger Extern" }));
    const ok = await submit(external.body.id, s.token);
    expect(ok.status).toBe(200);
    const c = await prisma.calling.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(c).toMatchObject({ aanstellenAssigneeId: null, aanstellenExternalName: "Gebiedszeventiger Extern" });
  });

  it("een roeping met een procedure buiten Ringtools kan niet worden ingediend (ook niet door het concept te manipuleren)", async () => {
    const s = await setup();
    const d = await draft(s, base(s));
    await prisma.callingDraft.update({ where: { id: d.body.id }, data: { functionCode: "ringpatriarch" } });
    const r = await submit(d.body.id, s.token);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/buiten Ringtools/);
  });
});

describe("Bisschop buiten Ringtools", () => {
  it("een eigen roeping 'Bisschop' kan niet worden ingediend; raadgevers in de bisschap wel herkenbaar anders", async () => {
    const s = await setup();
    const { isBishopFunctionName } = await import("@/lib/catalog/callings");
    expect(isBishopFunctionName("Bisschop")).toBe(true);
    expect(isBishopFunctionName("  Bisschóp van de wijk ")).toBe(true);
    expect(isBishopFunctionName("Eerste raadgever in de bisschap")).toBe(false);
    expect(isBishopFunctionName("Raadgever van de bisschop")).toBe(false);
    const own = await prisma.ringCustomCalling.create({ data: { ringId: s.ring.id, name: "Bisschop", category: "Overig" } }); // bestaande eigen roeping van vóór de controle
    const d = await draft(s, base(s, { functionSource: "EIGEN", functionCode: own.id, procedureConfirmed: true }));
    expect(d.status).toBe(400);
    expect(d.body.error).toMatch(/bisschop/i);
  });
});

describe("Aanstellingsbevoegdheid en voorgestelde verantwoordelijken", () => {
  it("een geverifieerde regel staat alleen expliciet aangewezen personen toe; anderen worden server-side geweigerd", async () => {
    const s = await setup();
    // niemand aangewezen: geen interne uitvoerder
    expect((await submit((await draft(s, base(s, { aanstellenAssigneeId: s.president.id }))).body.id, s.token)).status).toBe(400);
    expect((await submit((await draft(s, base(s, { roepenAssigneeId: s.counselor.id }))).body.id, s.token)).status).toBe(400);
    await authorize(s, s.president.id, "RINGPRESIDENT", "Ringpresident");
    await authorize(s, s.counselor.id, "AANGEWEZEN_RAADGEVER", "Eerste raadgever");
    // ringadministrateur: ringpresident of raadgever; een hogeraadslid (ook als aangewezen) niet
    await authorize(s, s.ha2.id, "AANGEWEZEN_HOGERAADSLID", "Hogeraadslid");
    const okBody = base(s, { roepenAssigneeId: s.president.id, aanstellenAssigneeId: s.counselor.id });
    expect((await submit((await draft(s, okBody)).body.id, s.token)).status).toBe(200);
    const denied = await submit((await draft(s, base(s, { aanstellenAssigneeId: s.ha2.id }))).body.id, s.token);
    expect(denied.status).toBe(400);
    // een Ringtools-rol of kerkelijke functie is op zichzelf geen machtiging
    expect((await submit((await draft(s, base(s, { aanstellenAssigneeId: s.manager.id }))).body.id, s.token)).status).toBe(400);
  });

  it("de ZHV-presidente mag alleen door de aangewezen ringpresident worden geroepen en aangesteld", async () => {
    const s = await setup();
    await authorize(s, s.president.id, "RINGPRESIDENT", "Ringpresident");
    await authorize(s, s.counselor.id, "AANGEWEZEN_RAADGEVER", "Eerste raadgever");
    const zhv = (assignee: string) => draft(s, base(s, { functionCode: "zhv-presidente", aanstellenAssigneeId: assignee }));
    expect((await submit((await zhv(s.counselor.id)).body.id, s.token)).status).toBe(400);
    expect((await submit((await zhv(s.president.id)).body.id, s.token)).status).toBe(200);
  });

  it("stelt het verantwoordelijke hogeraadslid alleen voor als dit past bij zijn bevoegdheid; een wijktoewijzing geeft nooit zelf bevoegdheid", async () => {
    const s = await setup(); // unit-verantwoordelijke = ha1 (hogeraadslid)
    const d = await draft(s, base(s, { functionCode: "seminarieleerkracht" })); // ringpresident, raadgever of hogeraadslid
    let sug = (await call("GET", `/drafts/${d.body.id}`, { token: s.token })).body.suggestions;
    expect(sug.unit).toMatchObject({ id: s.unit.id, responsibleStatus: "OK" });
    expect(sug.aanstellen).toBeNull(); // ha1 is wijkverantwoordelijke maar niet aangewezen: geen voorstel
    expect(sug.roepen).toBeNull();
    expect(sug.ondersteunen).toMatchObject({ userId: s.ha1.id, source: "UNIT_VERANTWOORDELIJKE" }); // ondersteunen kent geen bevoegdheidsregel
    await authorize(s, s.ha1.id, "AANGEWEZEN_HOGERAADSLID", "Hogeraadslid");
    sug = (await call("GET", `/drafts/${d.body.id}`, { token: s.token })).body.suggestions;
    expect(sug.aanstellen).toMatchObject({ userId: s.ha1.id, source: "UNIT_VERANTWOORDELIJKE" });
    expect(sug.roepen).toMatchObject({ userId: s.ha1.id });
    // voor een functie waar een hogeraadslid niet mag aanstellen (ringadministrateur) blijft het voorstel leeg
    const d2 = await draft(s, base(s));
    expect((await call("GET", `/drafts/${d2.body.id}`, { token: s.token })).body.suggestions.aanstellen).toBeNull();
    // standaard van de unit: alleen voorgesteld als bevoegd
    await updateUnit(s.manager.id, s.unit.id, { defaultAanstellenUserId: s.counselor.id });
    expect((await call("GET", `/drafts/${d.body.id}`, { token: s.token })).body.suggestions.aanstellen).toMatchObject({ userId: s.ha1.id }); // counselor niet aangewezen: terugval op bevoegde
    await authorize(s, s.counselor.id, "AANGEWEZEN_RAADGEVER", "Eerste raadgever");
    expect((await call("GET", `/drafts/${d.body.id}`, { token: s.token })).body.suggestions.aanstellen).toMatchObject({ userId: s.counselor.id, source: "UNIT_STANDAARD" });
  });

  it("bij een vacante unit of onbekende regel wordt niets voorgesteld en staat er een expliciete melding", async () => {
    const s = await setup();
    const vacant = await createUnit(s.manager.id, s.ring.id, { kind: "GEMEENTE", name: "Vacante gemeente" });
    const d = await draft(s, base(s, { unitId: vacant.id, functionCode: "muziekdeskundige" }));
    const sug = (await call("GET", `/drafts/${d.body.id}`, { token: s.token })).body.suggestions;
    expect(sug.unit.responsibleStatus).toBe("VACANT");
    expect(sug.roepen).toBeNull();
    expect(sug.aanstellen).toBeNull();
    expect(sug.notes.aanstellen).toMatch(/Menselijke controle nodig/);
  });

  it("achteraf wijzigen van een taakverantwoordelijke volgt dezelfde bevoegdheidsregel; een externe persoon kan handmatig worden geregistreerd", async () => {
    const s = await setup();
    await authorize(s, s.president.id, "RINGPRESIDENT", "Ringpresident");
    const created = await submit((await draft(s, base(s))).body.id, s.token);
    const id = created.body.id;
    const assign = (task: string, body: Record<string, unknown>) => call("POST", `/callings/${id}/tasks/${task}/assign`, { token: s.token, body });
    expect((await assign("aanstellen", { assigneeId: s.manager.id })).status).toBe(400); // niet aangewezen
    expect((await assign("aanstellen", { assigneeId: s.president.id })).status).toBe(200);
    expect((await assign("roepen", { externalName: "Extern Bevoegd" })).status).toBe(200);
    let detail = (await call("GET", `/callings/${id}`, { token: s.token })).body;
    expect(detail.tasks.find((t: { task: string }) => t.task === "ROEPEN")).toMatchObject({ assignee: null, assigneeExternalName: "Extern Bevoegd" });
    expect((await assign("roepen", { assigneeId: s.president.id, externalName: "Beide" })).status).toBe(400);
    expect((await assign("roepen", { assigneeId: s.president.id })).status).toBe(200); // interne keuze vervangt de externe naam
    detail = (await call("GET", `/callings/${id}`, { token: s.token })).body;
    expect(detail.tasks.find((t: { task: string }) => t.task === "ROEPEN")).toMatchObject({ assigneeExternalName: null });
    // ondersteunen (steunverlening) kent geen bevoegdheidsregel en geen externe registratie
    expect((await assign("ondersteunen", { assigneeId: s.ha1.id })).status).toBe(200);
    expect((await assign("ondersteunen", { externalName: "Extern" })).status).toBe(400);
  });
});

describe("C3-correcties: vastgelegde procedure en herstelbare meldingen", () => {
  it("achteraf wijzigen van een verantwoordelijke volgt de bij indienen vastgelegde procedure, niet de actuele catalogus", async () => {
    const s = await setup();
    await authorize(s, s.president.id, "RINGPRESIDENT", "Ringpresident");
    const created = await submit((await draft(s, base(s))).body.id, s.token); // ringadministrateur: geverifieerde regel
    const id = created.body.id as string;
    const assign = () => call("POST", `/callings/${id}/tasks/aanstellen/assign`, { token: s.token, body: { assigneeId: s.president.id } });
    expect((await assign()).status).toBe(200); // volgens snapshot en catalogus toegestaan

    // De vastgelegde regel was strenger/anders dan de actuele catalogus: de snapshot telt. (De catalogus zelf is niet te wijzigen in een test;
    // daarom wordt de snapshot aangepast om aan te tonen dat de server de snapshot leest en niet de catalogus.)
    const row = await prisma.calling.findUniqueOrThrow({ where: { id } });
    const snap = row.procedureSnapshot as Record<string, unknown>;
    expect(snap.ruleStatus).toBe("GEVERIFIEERD");
    await prisma.calling.update({ where: { id }, data: { procedureSnapshot: { ...snap, ruleStatus: "TE_BEOORDELEN" } } });
    expect((await assign()).status).toBe(400); // catalogus zegt GEVERIFIEERD, snapshot niet → geweigerd

    await prisma.calling.update({ where: { id }, data: { procedureSnapshot: { ...snap, appointedBy: "BIJZONDER" } } });
    expect((await assign()).status).toBe(400); // andere vastgelegde regel

    await prisma.calling.update({ where: { id }, data: { procedureSnapshot: { ...snap, appointedBy: "RINGPRESIDENT", ruleStatus: "GEVERIFIEERD" } } });
    expect((await assign()).status).toBe(200);
    // een raadgever (aangewezen) valt buiten de vastgelegde regel RINGPRESIDENT
    await authorize(s, s.counselor.id, "AANGEWEZEN_RAADGEVER", "Raadgever");
    expect((await call("POST", `/callings/${id}/tasks/aanstellen/assign`, { token: s.token, body: { assigneeId: s.counselor.id } })).status).toBe(400);
  });

  it("een voorstel zonder snapshot (van vóór C3) valt terug op de catalogus; een eigen roeping kent nooit interne uitvoerders toe", async () => {
    const s = await setup();
    await authorize(s, s.president.id, "RINGPRESIDENT", "Ringpresident");
    const { createCalling } = await import("@/lib/workflow");
    const legacy = await createCalling({ ringId: s.ring.id, personName: "Oud", functionTitle: "Ringadministrateur", createdById: s.manager.id });
    await prisma.calling.update({ where: { id: legacy.id }, data: { functionSource: "STANDAARD", functionCode: "ringadministrateur" } });
    expect((await call("POST", `/callings/${legacy.id}/tasks/aanstellen/assign`, { token: s.token, body: { assigneeId: s.president.id } })).status).toBe(200);
    const own = await createCustomCalling(s.manager.id, s.ring.id, { name: "Eigen taak", category: "Overig" });
    const c = await submit((await draft(s, base(s, { functionSource: "EIGEN", functionCode: own.id, procedureConfirmed: true }))).body.id, s.token);
    expect((await call("POST", `/callings/${c.body.id}/tasks/aanstellen/assign`, { token: s.token, body: { assigneeId: s.president.id } })).status).toBe(400);
  });

  const countNotes = async (callingId: string) => {
    const rows = await prisma.notification.groupBy({ by: ["type", "userId"], where: { callingId }, _count: true });
    return rows.map((r) => `${r.type}:${r.userId}:${r._count}`).sort();
  };

  it("slaagt het indienen maar mislukt het versturen van meldingen, dan blijft het voorstel bestaan en herstelt een herhaling zonder dubbele meldingen", async () => {
    const s = await setup();
    const d = await draft(s, base(s, { ondersteunenAssigneeId: s.ha2.id }));
    const spy = vi.spyOn(prisma.notification, "createMany").mockRejectedValueOnce(new Error("tijdelijke storing"));
    const first = await submit(d.body.id, s.token);
    spy.mockRestore();
    expect(first.status).toBe(200); // het voorstel is aangemaakt
    expect(first.body.notificationsDelivered).toBe(false);
    const id = first.body.id as string;
    expect(await prisma.calling.count()).toBe(1);
    expect(await prisma.notification.count({ where: { callingId: id } })).toBe(0);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id } })).creationNotifiedAt).toBeNull();

    // direct herhalen binnen de lease: geen tweede verzender ("busy"), geen duplicaten
    const busy = await submit(d.body.id, s.token);
    expect(busy.body).toMatchObject({ id, alreadySubmitted: true, notificationsDelivered: false });
    expect(await prisma.notification.count({ where: { callingId: id } })).toBe(0);

    // na afloop van de lease levert een herhaling alsnog af
    await prisma.calling.update({ where: { id }, data: { creationNotifyClaimedAt: new Date(Date.now() - 5 * 60 * 1000) } });
    const retry = await submit(d.body.id, s.token);
    expect(retry.body).toMatchObject({ id, alreadySubmitted: true, notificationsDelivered: true });
    const after = await countNotes(id);
    expect(after).toEqual([
      `NEW_PROPOSAL:${s.president.id}:1`, `NEW_PROPOSAL:${s.counselor.id}:1`, `TASK_ASSIGNED:${s.ha2.id}:1`,
    ].sort());
    // en verder herhalen verandert niets meer
    expect((await submit(d.body.id, s.token)).body.notificationsDelivered).toBe(true);
    expect(await countNotes(id)).toEqual(after);
  });

  it("een gedeeltelijk gelukte levering wordt aangevuld zonder de al verstuurde meldingen te herhalen", async () => {
    const s = await setup();
    const d = await draft(s, base(s, { ondersteunenAssigneeId: s.ha2.id }));
    const real = prisma.notification.createMany.bind(prisma.notification);
    let calls = 0;
    const spy = vi.spyOn(prisma.notification, "createMany").mockImplementation(((args: Parameters<typeof real>[0]) => {
      calls++;
      return calls === 1 ? real(args) : Promise.reject(new Error("storing bij taakmelding"));
    }) as unknown as typeof prisma.notification.createMany);
    const first = await submit(d.body.id, s.token);
    spy.mockRestore();
    const id = first.body.id as string;
    expect(first.body.notificationsDelivered).toBe(false);
    expect(await prisma.notification.count({ where: { callingId: id, type: "NEW_PROPOSAL" } })).toBe(2); // presidium kreeg al bericht
    expect(await prisma.notification.count({ where: { callingId: id, type: "TASK_ASSIGNED" } })).toBe(0);

    await prisma.calling.update({ where: { id }, data: { creationNotifyClaimedAt: new Date(Date.now() - 5 * 60 * 1000) } });
    expect((await submit(d.body.id, s.token)).body.notificationsDelivered).toBe(true);
    expect(await prisma.notification.count({ where: { callingId: id, type: "NEW_PROPOSAL" } })).toBe(2); // niet opnieuw
    expect(await prisma.notification.count({ where: { callingId: id, type: "TASK_ASSIGNED" } })).toBe(1);
  });

  it("de achtergrondtaak levert meldingen af van een voorstel dat nooit is verstuurd (crash tussen opslaan en versturen)", async () => {
    const s = await setup();
    const { createCallingInTx, retryPendingCreationNotifications } = await import("@/lib/workflow");
    const { calling } = await prisma.$transaction((tx) => createCallingInTx(tx, { ringId: s.ring.id, personName: "Crash Test", functionTitle: "Ringadministrateur", createdById: s.manager.id }));
    expect(await retryPendingCreationNotifications()).toBe(0); // te vers: nog binnen de lease, de aanroeper kan nog bezig zijn
    await prisma.calling.update({ where: { id: calling.id }, data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } });
    expect(await retryPendingCreationNotifications()).toBe(1);
    expect(await prisma.notification.count({ where: { callingId: calling.id, type: "NEW_PROPOSAL" } })).toBe(2);
    expect(await retryPendingCreationNotifications()).toBe(0); // geen tweede keer
    expect(await prisma.notification.count({ where: { callingId: calling.id, type: "NEW_PROPOSAL" } })).toBe(2);
  });

  it("bestaande voorstellen van vóór deze migratie worden niet alsnog gemeld", async () => {
    const s = await setup();
    const { retryPendingCreationNotifications } = await import("@/lib/workflow");
    const c = await prisma.calling.create({ data: { ringId: s.ring.id, personName: "Oud", functionTitle: "X", createdById: s.manager.id, createdAt: new Date(Date.now() - 86_400_000), creationNotifiedAt: new Date() } });
    expect(await retryPendingCreationNotifications()).toBe(0);
    expect(await prisma.notification.count({ where: { callingId: c.id } })).toBe(0);
  });
});

describe("C1-workflow blijft intact na indienen", () => {
  it("ingediend voorstel → ringpresidium → akkoord wacht op vrijgave → expliciete vrijgave; lege hoge raad keurt nooit goed; gezamenlijk akkoord werkt", async () => {
    const s = await setup();
    const submitted = async () => (await submit((await draft(s, base(s))).body.id, s.token)).body.id as string;

    // individuele ondersteuning → wacht op vrijgave (geen automatische doorstart)
    const a = await submitted();
    for (const u of [s.president, s.counselor]) await castVote({ callingId: a, userId: u.id, support: true });
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: a } })).status).toBe("PRESIDIUM_APPROVED");
    expect(await prisma.eligibleVoter.count({ where: { callingId: a, stage: "HOGERAAD" } })).toBe(0);
    await releaseToHogeraad({ callingId: a, actorId: s.president.id });
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: a } })).status).toBe("HOGERAAD_VOTING");

    // gezamenlijk presidiumakkoord blijft werken, ook zonder hogeraadsleden: nooit automatische goedkeuring
    const empty = await setup();
    await prisma.ringMembership.updateMany({ where: { ringId: empty.ring.id, role: "HOGERAAD" }, data: { active: false } });
    const b = (await submit((await draft(empty, base(empty))).body.id, empty.token)).body.id as string;
    await registerGroupDecision({ callingId: b, actorId: empty.manager.id, stage: "PRESIDIUM", decidedOn: new Date().toISOString().slice(0, 10), agreed: true, presentUserIds: [empty.president.id] });
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: b } })).status).toBe("PRESIDIUM_APPROVED");
    await expect(releaseToHogeraad({ callingId: b, actorId: empty.manager.id })).rejects.toThrow(/geen actieve hogeraadsleden/);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: b } })).status).toBe("PRESIDIUM_APPROVED");
  });
});

describe("Opruimregels voor concepten", () => {
  it("verwijdert verlaten concepten na 30 dagen en ingediende sleutels na 7 dagen; recente concepten blijven", async () => {
    const s = await setup();
    const day = 24 * 60 * 60 * 1000;
    const mk = async (data: Record<string, unknown>) => (await prisma.callingDraft.create({ data: { ringId: s.ring.id, createdById: s.manager.id, ...data } })).id;
    const fresh = await mk({ personName: "Recent" });
    const old = await mk({ personName: "Verlaten" });
    const submittedOld = await mk({ submittedAt: new Date(Date.now() - 8 * day), submittedCallingId: "x" });
    const submittedNew = await mk({ submittedAt: new Date(Date.now() - 1 * day), submittedCallingId: "y" });
    await prisma.$executeRaw`UPDATE "CallingDraft" SET "updatedAt" = ${new Date(Date.now() - 31 * day)} WHERE "id" = ${old}`;
    expect(await deleteStaleDrafts()).toBe(2);
    const left = (await prisma.callingDraft.findMany({ select: { id: true } })).map((d) => d.id).sort();
    expect(left).toEqual([fresh, submittedNew].sort());
    expect(submittedOld).toBeTruthy();
  });
});

describe("Catalogus-controleoverzicht via de API", () => {
  it("levert het overzicht van nog te controleren regels (alleen voor ingelogde gebruikers)", async () => {
    const s = await setup();
    const res = await call("GET", "/catalog/review", { token: s.token });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(40);
    expect(res.body.items.find((i: { name: string }) => i.name === "Instituutshoofd").status).toBe("TE_BEOORDELEN");
    expect((await call("GET", "/catalog/review")).status).toBe(401);
  });
});
