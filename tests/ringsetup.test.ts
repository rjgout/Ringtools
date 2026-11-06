import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { releaseToHogeraad, castVote } from "@/lib/workflow";
import { createUnit, eligibleAppointers, getRingSetup, getUnitSuggestion, listUnits, updateUnit } from "@/lib/ringSetup";
import { addMember, updateMember } from "@/lib/rings";
import { createCalling, createTestRing, createTestUser, resetDatabase } from "./setup";

const { handleApi } = await import("@/lib/api/router");

beforeEach(async () => {
  await resetDatabase();
  await prisma.ringUnit.deleteMany();
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
async function ringSetup() {
  const k = ++n;
  const ring = await createTestRing(`Ring ${k}`);
  const r = { ringId: ring.id };
  const manager = await createTestUser("RINGSECRETARIS", `Beheerder ${k}`, { ...r, isRingManager: true });
  const president = await createTestUser("RINGPRESIDIUM", `President ${k}`, r);
  const counselor = await createTestUser("RINGPRESIDIUM", `Raadgever ${k}`, r);
  const ha1 = await createTestUser("HOGERAAD", `Hogeraad A ${k}`, r);
  const ha2 = await createTestUser("HOGERAAD", `Hogeraad B ${k}`, r);
  return { ring, manager, president, counselor, ha1, ha2 };
}

describe("Wijken en gemeenten", () => {
  it("de ringbeheerder voegt units toe, wijzigt, koppelt hogeraadsleden (ook meerdere units per lid) en deactiveert", async () => {
    const s = await ringSetup();
    const token = await login(s.manager.id);
    const a = await call("POST", `/rings/${s.ring.id}/units`, { token, body: { kind: "WIJK", name: "Wijk Voorbeeld", responsibleUserId: s.ha1.id } });
    const b = await call("POST", `/rings/${s.ring.id}/units`, { token, body: { kind: "GEMEENTE", name: "Gemeente Proef", responsibleUserId: s.ha1.id, defaultRoepenUserId: s.president.id } });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const list = (await call("GET", `/rings/${s.ring.id}/units`, { token })).body.units;
    expect(list.filter((u: { responsible: { id: string } | null }) => u.responsible?.id === s.ha1.id)).toHaveLength(2); // één hogeraadslid, meerdere units
    expect(list.find((u: { name: string }) => u.name === "Gemeente Proef").defaults.roepen.id).toBe(s.president.id);
    // andere hogeraadslid aanwijzen + naam wijzigen
    expect((await call("POST", `/units/${a.body.id}`, { token, body: { name: "Wijk Nieuw", responsibleUserId: s.ha2.id } })).status).toBe(200);
    // dubbele naam
    expect((await call("POST", `/rings/${s.ring.id}/units`, { token, body: { kind: "WIJK", name: "wijk nieuw" } })).status).toBe(400);
    // deactiveren
    expect((await call("POST", `/units/${b.body.id}`, { token, body: { active: false } })).status).toBe(200);
    expect((await listUnits(s.ring.id)).find((u) => u.id === b.body.id)?.active).toBe(false);
  });

  it("de verantwoordelijke moet een actief hogeraadslid van dezelfde ring zijn; standaardverantwoordelijken actieve leden", async () => {
    const s = await ringSetup();
    const other = await ringSetup();
    const token = await login(s.manager.id);
    const base = { kind: "WIJK", name: "Wijk X" };
    for (const bad of [s.president.id, other.ha1.id, "bestaat-niet"]) {
      expect((await call("POST", `/rings/${s.ring.id}/units`, { token, body: { ...base, responsibleUserId: bad } })).status).toBe(400);
    }
    expect((await call("POST", `/rings/${s.ring.id}/units`, { token, body: { ...base, defaultAanstellenUserId: other.president.id } })).status).toBe(400);
    await prisma.ringMembership.updateMany({ where: { userId: s.ha2.id }, data: { active: false } });
    expect((await call("POST", `/rings/${s.ring.id}/units`, { token, body: { ...base, responsibleUserId: s.ha2.id } })).status).toBe(400); // gedeactiveerd lid krijgt geen nieuwe bevoegdheid
  });

  it("een vacature of inactieve verantwoordelijke is zichtbaar en geeft geen voorstel of goedkeuring", async () => {
    const s = await ringSetup();
    const vacant = await createUnit(s.manager.id, s.ring.id, { kind: "WIJK", name: "Vacante wijk" });
    const linked = await createUnit(s.manager.id, s.ring.id, { kind: "WIJK", name: "Gekoppelde wijk", responsibleUserId: s.ha1.id });
    let units = await listUnits(s.ring.id);
    expect(units.find((u) => u.id === vacant.id)).toMatchObject({ responsibleStatus: "VACANT", responsible: null });
    expect(units.find((u) => u.id === linked.id)).toMatchObject({ responsibleStatus: "OK" });
    expect(await getUnitSuggestion(s.ring.id, vacant.id)).toMatchObject({ responsible: null, responsibleStatus: "VACANT" });
    await prisma.ringMembership.updateMany({ where: { userId: s.ha1.id }, data: { active: false } });
    units = await listUnits(s.ring.id);
    expect(units.find((u) => u.id === linked.id)).toMatchObject({ responsibleStatus: "INACTIEF", responsible: null });
    expect((await getUnitSuggestion(s.ring.id, linked.id))?.responsible).toBeNull();
  });

  it("een gedeactiveerde unit krijgt geen nieuwe toewijzing en geen voorstel; heractiveren kan wel", async () => {
    const s = await ringSetup();
    const u = await createUnit(s.manager.id, s.ring.id, { kind: "WIJK", name: "Oude wijk" });
    await updateUnit(s.manager.id, u.id, { active: false });
    await expect(updateUnit(s.manager.id, u.id, { responsibleUserId: s.ha1.id })).rejects.toThrow(/gedeactiveerd/);
    expect(await getUnitSuggestion(s.ring.id, u.id)).toBeNull();
    await updateUnit(s.manager.id, u.id, { active: true });
    await updateUnit(s.manager.id, u.id, { responsibleUserId: s.ha1.id });
    expect((await getUnitSuggestion(s.ring.id, u.id))?.responsible?.id).toBe(s.ha1.id);
  });

  it("de wijktoewijzing bepaalt nooit wie in de hoge raad mag ondersteunen: de volledige groep wordt uitgenodigd", async () => {
    const s = await ringSetup();
    await createUnit(s.manager.id, s.ring.id, { kind: "WIJK", name: "Wijk 1", responsibleUserId: s.ha1.id });
    const calling = await createCalling({ ringId: s.ring.id, personName: "Voorbeeld Persoon", functionTitle: "Leraar", createdById: s.manager.id });
    for (const u of [s.president, s.counselor]) await castVote({ callingId: calling.id, userId: u.id, support: true });
    await releaseToHogeraad({ callingId: calling.id, actorId: s.president.id });
    const eligible = await prisma.eligibleVoter.findMany({ where: { callingId: calling.id, stage: "HOGERAAD" } });
    expect(eligible.map((e) => e.userId).sort()).toEqual([s.ha1.id, s.ha2.id].sort());
    // een vacante unit leidt niet tot goedkeuring
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("HOGERAAD_VOTING");
  });

  it("ringisolatie en autorisatie: niet-beheerders en beheerders van andere ringen hebben geen toegang", async () => {
    const s = await ringSetup();
    const other = await ringSetup();
    const unit = await createUnit(s.manager.id, s.ring.id, { kind: "WIJK", name: "Wijk Privé" });
    const otherToken = await login(other.manager.id);
    const plainToken = await login(s.president.id);
    expect((await call("GET", `/rings/${s.ring.id}/units`, { token: otherToken })).status).toBe(404);
    expect((await call("POST", `/rings/${s.ring.id}/units`, { token: otherToken, body: { kind: "WIJK", name: "Binnendringer" } })).status).toBe(404);
    expect((await call("POST", `/units/${unit.id}`, { token: otherToken, body: { name: "Gekaapt" } })).status).toBe(404);
    expect((await call("GET", `/rings/${s.ring.id}/units`, { token: plainToken })).status).toBe(404);
    expect((await call("GET", `/rings/${s.ring.id}/setup`, { token: plainToken })).status).toBe(404);
    expect((await call("GET", `/rings/${s.ring.id}/units`)).status).toBe(401);
    expect((await prisma.ringUnit.findUniqueOrThrow({ where: { id: unit.id } })).name).toBe("Wijk Privé");
  });

  it("systeembeheer gebruikt de eenheden niet via de app (/admin gesloten); een gedeactiveerde ring blijft voor leden gesloten", async () => {
    const s = await ringSetup();
    const admin = await createTestUser("ADMIN", "Webmin");
    const token = await login(admin.id);
    expect((await call("POST", `/admin/rings/${s.ring.id}/units`, { token, body: { kind: "GEMEENTE", name: "Gemeente Beheer" } })).status).toBe(410);
    expect((await call("GET", `/admin/rings/${s.ring.id}/units`, { token })).status).toBe(410);
    expect(await prisma.ringUnit.count({ where: { ringId: s.ring.id } })).toBe(0);
    await prisma.ring.update({ where: { id: s.ring.id }, data: { active: false } });
    expect((await call("GET", `/rings/${s.ring.id}/units`, { token: await login(s.manager.id) })).status).toBe(404);
  });
});

describe("Ringinrichting: voortgangsoverzicht", () => {
  it("toont per stap wat is afgerond en wat nog ontbreekt (vacatures in de hoge raad zijn toegestaan)", async () => {
    const ring = await createTestRing("Nieuwe ring");
    let setup = await getRingSetup(ring.id);
    expect(setup.steps.find((x) => x.key === "manager")?.done).toBe(false);
    expect(setup.complete).toBe(false);

    const manager = await createTestUser("RINGSECRETARIS", "Eerste beheerder", { ringId: ring.id, isRingManager: true });
    setup = await getRingSetup(ring.id);
    expect(setup.steps.find((x) => x.key === "manager")?.done).toBe(true);
    expect(setup.steps.find((x) => x.key === "activated")?.done).toBe(false); // nog niet ingelogd
    await login(manager.id);
    expect((await getRingSetup(ring.id)).steps.find((x) => x.key === "activated")?.done).toBe(true);

    await createTestUser("RINGPRESIDIUM", "Pres", { ringId: ring.id });
    await createTestUser("RINGADMINISTRATEUR", "Adm", { ringId: ring.id });
    setup = await getRingSetup(ring.id);
    expect(setup.steps.find((x) => x.key === "presidium")?.done).toBe(true);
    expect(setup.steps.find((x) => x.key === "hogeraad")?.done).toBe(false);
    expect(setup.steps.find((x) => x.key === "hogeraad")?.detail).toMatch(/blijft elk voorstel/);

    // kerkelijke functies: pas klaar als ringpresident, eerste en tweede raadgever zijn vastgelegd en niemand in presidium/hoge raad een onbekende functie heeft
    expect(setup.steps.find((x) => x.key === "functions")).toMatchObject({ done: false, detail: expect.stringMatching(/Nog vast te leggen: .*ringpresident/) });
    const second = await createTestUser("RINGPRESIDIUM", "Eerste", { ringId: ring.id });
    const third = await createTestUser("RINGPRESIDIUM", "Tweede", { ringId: ring.id });
    const fn = (userId: string, code: "RINGPRESIDENT" | "EERSTE_RAADGEVER" | "TWEEDE_RAADGEVER" | "HOGERAADSLID") => prisma.ringMembership.updateMany({ where: { userId, ringId: ring.id }, data: { churchFunctionCode: code } });
    await fn((await prisma.user.findFirstOrThrow({ where: { name: "Pres" } })).id, "RINGPRESIDENT");
    await fn(second.id, "EERSTE_RAADGEVER");
    expect((await getRingSetup(ring.id)).steps.find((x) => x.key === "functions")?.done).toBe(false); // tweede raadgever ontbreekt
    await fn(third.id, "TWEEDE_RAADGEVER");
    expect((await getRingSetup(ring.id)).steps.find((x) => x.key === "functions")?.done).toBe(true);

    const ha = await createTestUser("HOGERAAD", "Lid", { ringId: ring.id });
    expect((await getRingSetup(ring.id)).steps.find((x) => x.key === "functions")).toMatchObject({ done: false, detail: expect.stringContaining("zonder kerkelijke functie") }); // hogeraadslid zonder functie
    await fn(ha.id, "HOGERAADSLID");
    expect((await getRingSetup(ring.id)).steps.find((x) => x.key === "hogeraad")).toMatchObject({ done: true, detail: expect.stringContaining("1 van 12") });
    const unit = await createUnit(manager.id, ring.id, { kind: "WIJK", name: "Wijk Een" });
    expect((await getRingSetup(ring.id)).steps.find((x) => x.key === "unit-links")?.done).toBe(false);
    await updateUnit(manager.id, unit.id, { responsibleUserId: ha.id });
    setup = await getRingSetup(ring.id);
    expect(setup.steps.find((x) => x.key === "unit-links")?.done).toBe(true);
    expect(setup.complete).toBe(true);
  });

  it("de status is alleen zichtbaar voor de beheerder van de eigen ring", async () => {
    const s = await ringSetup();
    const res = await call("GET", `/rings/${s.ring.id}/setup`, { token: await login(s.manager.id) });
    expect(res.status).toBe(200);
    expect(res.body.steps.length).toBe(9);
  });
});

describe("Aanstellingsbevoegdheid (expliciete aanwijzing)", () => {
  it("een Ringtools-rol of vrije omschrijving is geen machtiging; de functie bepaalt wat mogelijk is en een machtiging blijft waar vereist expliciet", async () => {
    const s = await ringSetup();
    await prisma.ringMembership.updateMany({ where: { userId: s.president.id }, data: { churchFunction: "Ringpresident" } }); // vrije tekst ≠ functie ≠ machtiging
    expect((await eligibleAppointers(s.ring.id, "ringadministrateur")).appointers).toEqual([]);

    const mPresident = await prisma.ringMembership.findFirstOrThrow({ where: { userId: s.president.id } });
    const mCounselor = await prisma.ringMembership.findFirstOrThrow({ where: { userId: s.counselor.id } });
    const mHa = await prisma.ringMembership.findFirstOrThrow({ where: { userId: s.ha1.id } });
    const base = { actorId: s.manager.id, isRingManager: false, active: true };
    const names = async (code: string) => (await eligibleAppointers(s.ring.id, code)).appointers.map((a) => a.id).sort();

    // functie zonder (vereiste) machtiging: raadgever en hogeraadslid zijn nog niet bevoegd; de ringpresident wel (functie volstaat)
    await updateMember({ ...base, membershipId: mPresident.id, churchFunction: "Ringpresident", churchFunctionCode: "RINGPRESIDENT", role: "RINGPRESIDIUM" });
    await updateMember({ ...base, membershipId: mCounselor.id, churchFunction: "Eerste raadgever", churchFunctionCode: "EERSTE_RAADGEVER", role: "RINGPRESIDIUM" });
    await updateMember({ ...base, membershipId: mHa.id, churchFunction: "Hogeraadslid", churchFunctionCode: "HOGERAADSLID", role: "HOGERAAD" });
    expect(await names("ringadministrateur")).toEqual([s.president.id]);
    expect(await names("seminarieleerkracht")).toEqual([s.president.id]);

    // met expliciete machtiging
    await updateMember({ ...base, membershipId: mCounselor.id, churchFunction: "Eerste raadgever", role: "RINGPRESIDIUM", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    await updateMember({ ...base, membershipId: mHa.id, churchFunction: "Hogeraadslid", role: "HOGERAAD", appointAuthority: "AANGEWEZEN_HOGERAADSLID" });
    expect(await names("zhv-presidente")).toEqual([s.president.id]); // alleen ringpresident
    expect(await names("ringadministrateur")).toEqual([s.president.id, s.counselor.id].sort()); // ringpresident of aangewezen raadgever
    expect(await names("seminarieleerkracht")).toEqual([s.president.id, s.counselor.id, s.ha1.id].sort()); // + aangewezen hogeraadslid
    expect(await names("ringpresident")).toEqual([]); // bijzondere procedure: handmatige registratie van een bevoegd persoon
    // Niet-geverifieerde regel: nooit een uitvoerder, ook niet als er een ringpresident is.
    for (const code of ["muziekdeskundige", "instituutshoofd", "ringtolk", "eerste-raadgever-in-de-bisschap", "kampleider-jongemannen"]) {
      expect(await names(code), code).toEqual([]);
      expect((await eligibleAppointers(s.ring.id, code, "grantedBy")).appointers, code).toEqual([]);
    }
    expect((await eligibleAppointers(s.ring.id, "ringadministrateur", "grantedBy")).appointers).toHaveLength(2);
    expect((await eligibleAppointers(s.ring.id, null)).appointers).toEqual([]); // eigen roeping: geen afgeleide bevoegdheden
    expect((await eligibleAppointers(s.ring.id, "id-van-een-eigen-roeping")).appointers).toEqual([]);
  });

  it("functie en machtiging passen bij rol en elkaar, er is maximaal één ringpresident/eerste/tweede raadgever en gedeactiveerde leden verliezen de machtiging", async () => {
    const s = await ringSetup();
    const mPresident = await prisma.ringMembership.findFirstOrThrow({ where: { userId: s.president.id } });
    const mCounselor = await prisma.ringMembership.findFirstOrThrow({ where: { userId: s.counselor.id } });
    const mHa = await prisma.ringMembership.findFirstOrThrow({ where: { userId: s.ha1.id } });
    const base = { actorId: s.manager.id, isRingManager: false, churchFunction: "Functie", active: true };
    // functie ↔ rol
    await expect(updateMember({ ...base, membershipId: mHa.id, role: "HOGERAAD", churchFunctionCode: "RINGPRESIDENT" })).rejects.toThrow(/past niet bij de gekozen rol/);
    await expect(updateMember({ ...base, membershipId: mPresident.id, role: "RINGPRESIDIUM", churchFunctionCode: "HOGERAADSLID" })).rejects.toThrow(/past niet bij de gekozen rol/);
    // machtiging ↔ functie
    await expect(updateMember({ ...base, membershipId: mPresident.id, role: "RINGPRESIDIUM", appointAuthority: "AANGEWEZEN_HOGERAADSLID" })).rejects.toThrow(/hogeraadslid/);
    await expect(updateMember({ ...base, membershipId: mCounselor.id, role: "RINGPRESIDIUM", appointAuthority: "AANGEWEZEN_RAADGEVER" })).rejects.toThrow(/eerste of tweede raadgever/); // functie nog onbekend
    await expect(updateMember({ ...base, membershipId: mCounselor.id, role: "RINGPRESIDIUM", churchFunctionCode: "RINGPRESIDENT", appointAuthority: "RINGPRESIDENT" })).rejects.toThrow(/bestaat niet meer/);
    // uniek
    await updateMember({ ...base, membershipId: mPresident.id, role: "RINGPRESIDIUM", churchFunctionCode: "RINGPRESIDENT" });
    await expect(updateMember({ ...base, membershipId: mCounselor.id, role: "RINGPRESIDIUM", churchFunctionCode: "RINGPRESIDENT" })).rejects.toThrow(/al een actieve ringpresident/);
    await updateMember({ ...base, membershipId: mCounselor.id, role: "RINGPRESIDIUM", churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    // gedeactiveerd of van rol veranderd: machtiging vervalt (geen nieuwe bevoegdheden); de functie wordt bij een rolwijziging niet geraden
    await updateMember({ ...base, membershipId: mPresident.id, role: "RINGPRESIDIUM", active: false });
    expect((await prisma.ringMembership.findUniqueOrThrow({ where: { id: mPresident.id } })).appointAuthority).toBe("NONE");
    await updateMember({ ...base, membershipId: mCounselor.id, role: "HOGERAAD" }); // rolwijziging
    const after = await prisma.ringMembership.findUniqueOrThrow({ where: { id: mCounselor.id } });
    expect(after).toMatchObject({ appointAuthority: "NONE", churchFunctionCode: "ONBEKEND" });
    // nieuwe gebruiker direct met functie en machtiging
    const added = await addMember({ actorId: s.manager.id, ringId: s.ring.id, isRingManager: false, name: "Nieuw Lid", email: "nieuw.lid@test.ringapeldoorn.nl", churchFunction: "Tweede raadgever", churchFunctionCode: "TWEEDE_RAADGEVER", role: "RINGPRESIDIUM", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    expect(added.membership).toMatchObject({ appointAuthority: "AANGEWEZEN_RAADGEVER", churchFunctionCode: "TWEEDE_RAADGEVER" });
    // zonder functie kan een machtiging niet worden toegekend (fail-closed)
    await expect(addMember({ actorId: s.manager.id, ringId: s.ring.id, isRingManager: false, name: "Nog Een", email: "nog.een@test.ringapeldoorn.nl", churchFunction: "Raadgever", role: "RINGPRESIDIUM", appointAuthority: "AANGEWEZEN_RAADGEVER" })).rejects.toThrow(/eerste of tweede raadgever/);
  });

  it("gedeactiveerde personen verschijnen niet als mogelijke uitvoerder", async () => {
    const s = await ringSetup();
    const m = await prisma.ringMembership.findFirstOrThrow({ where: { userId: s.president.id } });
    await updateMember({ actorId: s.manager.id, membershipId: m.id, churchFunction: "Ringpresident", churchFunctionCode: "RINGPRESIDENT", role: "RINGPRESIDIUM", isRingManager: false, active: true });
    expect((await eligibleAppointers(s.ring.id, "ringsecretaris")).appointers).toHaveLength(1);
    await prisma.user.update({ where: { id: s.president.id }, data: { active: false } });
    expect((await eligibleAppointers(s.ring.id, "ringsecretaris")).appointers).toEqual([]);
  });
});

describe("Eigen roepingen en catalogus via de API", () => {
  async function staff() {
    const s = await ringSetup();
    return { ...s, token: await login(s.manager.id), presidentToken: await login(s.president.id) };
  }

  it("een ringbeheerder voegt een eigen roeping toe; alleen zichtbaar binnen de eigen ring en zonder verzonnen bevoegdheden", async () => {
    const a = await staff();
    const b = await staff();
    const created = await call("POST", `/rings/${a.ring.id}/custom-callings`, { token: a.token, body: { name: "Koorcoördinator", category: "Muziek" } });
    expect(created.status).toBe(200);
    expect((await call("POST", `/rings/${a.ring.id}/custom-callings`, { token: a.token, body: { name: "koorcoördinator", category: "Muziek" } })).status).toBe(400); // dubbel

    const mine = (await call("GET", `/catalog/callings?ring=${a.ring.id}&q=koor`, { token: a.presidentToken })).body;
    const own = mine.callings.find((c: { source: string }) => c.source === "EIGEN");
    expect(own).toMatchObject({ name: "Koorcoördinator", category: "Muziek", grantedBy: null, appointedBy: null, approvalRoute: null, supportVenue: null });
    expect(own.warning).toMatch(/bevestig.*procedure/i);
    // andere ring ziet niets van deze eigen roeping
    const theirs = (await call("GET", `/catalog/callings?ring=${b.ring.id}&q=koor`, { token: b.presidentToken })).body;
    expect(theirs.callings.filter((c: { source: string }) => c.source === "EIGEN")).toEqual([]);
    expect((await call("GET", `/catalog/callings?ring=${a.ring.id}`, { token: b.presidentToken })).status).toBe(404); // geen toegang tot ring A
    // wijzigen: alleen de eigen beheerder; deactiveren verbergt hem uit de catalogus
    expect((await call("POST", `/custom-callings/${created.body.id}`, { token: b.token, body: { name: "Gekaapt" } })).status).toBe(404);
    expect((await call("POST", `/custom-callings/${created.body.id}`, { token: a.token, body: { name: "Koorleider" } })).status).toBe(200);
    expect((await call("POST", `/custom-callings/${created.body.id}`, { token: a.token, body: { active: false } })).status).toBe(200);
    expect((await call("GET", `/catalog/callings?ring=${a.ring.id}&q=koor`, { token: a.presidentToken })).body.callings.filter((c: { source: string }) => c.source === "EIGEN")).toEqual([]);
  });

  it("de catalogus is doorzoekbaar en toont de regels; alleen ringstaf heeft toegang", async () => {
    const a = await staff();
    const res = (await call("GET", `/catalog/callings?ring=${a.ring.id}&q=tolk`, { token: a.presidentToken })).body;
    expect(res.version).toMatch(/^\d{4}\.\d{2}-\d+$/);
    expect(res.callings.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(["Ringtolk", "Coördinator tolkendienst van de ring"]));
    expect(res.categories).toContain("Technologie");
    const hogeraad = await login(a.ha1.id);
    expect((await call("GET", `/catalog/callings?ring=${a.ring.id}`, { token: hogeraad })).status).toBe(403);
    expect((await call("GET", `/catalog/callings?ring=${a.ring.id}`)).status).toBe(401);
  });

  it("de lijst van mogelijke aanstellers volgt de regel van de standaardroeping", async () => {
    const a = await staff();
    const m = await prisma.ringMembership.findFirstOrThrow({ where: { userId: a.president.id } });
    await updateMember({ actorId: a.manager.id, membershipId: m.id, churchFunction: "Ringpresident", churchFunctionCode: "RINGPRESIDENT", role: "RINGPRESIDIUM", isRingManager: false, active: true });
    const res = await call("GET", `/catalog/callings/ringadministrateur/appointers?ring=${a.ring.id}`, { token: a.presidentToken });
    expect(res.body.rule).toBe("RINGPRESIDENT_OF_RAADGEVER");
    expect(res.body.appointers.map((x: { id: string }) => x.id)).toEqual([a.president.id]);
    expect((await call("GET", `/catalog/callings/een-eigen-id/appointers?ring=${a.ring.id}`, { token: a.presidentToken })).body.appointers).toEqual([]);
  });
});

describe("Migratie: bestaande gegevens blijven geldig", () => {
  it("de backfill markeert bestaande ingelogde gebruikers als geactiveerd en verwijdert niets", async () => {
    const ring = await createTestRing("Oude ring");
    const withSession = await createTestUser("RINGPRESIDIUM", "Met sessie", { ringId: ring.id });
    const without = await createTestUser("HOGERAAD", "Zonder sessie", { ringId: ring.id });
    await prisma.session.create({ data: { userId: withSession.id, tokenHash: "x".repeat(64), expiresAt: new Date(Date.now() + 1e6), mfaAt: new Date() } });
    await prisma.user.updateMany({ data: { activatedAt: null } });
    const before = await prisma.user.count();
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "activatedAt" = "createdAt" WHERE "role" = 'ADMIN' OR EXISTS (SELECT 1 FROM "Session" s WHERE s."userId" = "User"."id")`);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: withSession.id } })).activatedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: without.id } })).activatedAt).toBeNull();
    expect(await prisma.user.count()).toBe(before);
    expect(await prisma.session.count()).toBe(1);
  });
});
