import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { addMember, updateMember } from "@/lib/rings";
import { createUnit } from "@/lib/ringSetup";
import { eligibleAppointers, explainAuthorityGap } from "@/lib/ringSetup";
import { buildSuggestions } from "@/lib/proposals";
import { authorityClassOf, functionFitsRole } from "@/lib/churchFunctions";
import { createTestRing, createTestUser, resetDatabase } from "./setup";

const { handleApi } = await import("@/lib/api/router");

beforeEach(async () => {
  await resetDatabase();
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
const today = () => new Date().toISOString().slice(0, 10);

let n = 0;
async function setup() {
  const k = ++n;
  const ring = await createTestRing(`Ring ${k}`);
  const r = { ringId: ring.id };
  const manager = await createTestUser("RINGSECRETARIS", `Beheerder ${k}`, { ...r, isRingManager: true });
  const president = await createTestUser("RINGPRESIDIUM", `President ${k}`, r);
  const first = await createTestUser("RINGPRESIDIUM", `Eerste ${k}`, r);
  const second = await createTestUser("RINGPRESIDIUM", `Tweede ${k}`, r);
  const ha1 = await createTestUser("HOGERAAD", `Hogeraad A ${k}`, r);
  const ha2 = await createTestUser("HOGERAAD", `Hogeraad B ${k}`, r);
  const unit = await createUnit(manager.id, ring.id, { kind: "WIJK", name: `Wijk ${k}`, responsibleUserId: ha1.id });
  const mem = async (userId: string) => prisma.ringMembership.findFirstOrThrow({ where: { userId, ringId: ring.id } });
  const set = async (userId: string, data: Record<string, unknown>) => prisma.ringMembership.update({ where: { id: (await mem(userId)).id }, data });
  return { ring, manager, president, first, second, ha1, ha2, unit, mem, set, token: await login(manager.id) };
}
type S = Awaited<ReturnType<typeof setup>>;
const ids = async (s: S, code: string, which: "grantedBy" | "appointedBy" = "appointedBy") => (await eligibleAppointers(s.ring.id, code, which)).appointers.map((a) => a.id).sort();

describe("Gestructureerde kerkelijke functies: rol ≠ bevoegdheid, fail-closed", () => {
  it("de functie-rol-regels van de module zelf", () => {
    expect(functionFitsRole("RINGPRESIDENT", "RINGPRESIDIUM")).toBe(true);
    expect(functionFitsRole("RINGPRESIDENT", "HOGERAAD")).toBe(false);
    expect(functionFitsRole("HOGERAADSLID", "HOGERAAD")).toBe(true);
    expect(functionFitsRole("HOGERAADSLID", "RINGPRESIDIUM")).toBe(false);
    expect(functionFitsRole("ONBEKEND", "HOGERAAD")).toBe(true);
    expect(authorityClassOf({ role: "RINGPRESIDIUM", churchFunctionCode: "ONBEKEND", appointAuthority: "AANGEWEZEN_RAADGEVER" })).toBeNull();
    expect(authorityClassOf({ role: "RINGPRESIDIUM", churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "NONE" })).toBeNull();
    expect(authorityClassOf({ role: "RINGPRESIDIUM", churchFunctionCode: "RINGPRESIDENT", appointAuthority: "NONE" })).toBe("RINGPRESIDENT");
  });

  it("een Ringtools-rol alleen (ringpresidium, hoge raad, secretaris) geeft nooit bevoegdheid, ook niet met vrije omschrijving of oude waarden", async () => {
    const s = await setup();
    await s.set(s.president.id, { churchFunction: "Ringpresident" }); // vrije tekst
    await s.set(s.first.id, { appointAuthority: "AANGEWEZEN_RAADGEVER" }); // machtiging zonder functie
    await s.set(s.second.id, { appointAuthority: "RINGPRESIDENT" }); // verouderde waarde zonder functie
    await s.set(s.ha1.id, { appointAuthority: "AANGEWEZEN_HOGERAADSLID", churchFunctionCode: "ONBEKEND" });
    for (const code of ["ringadministrateur", "seminarieleerkracht", "zhv-presidente"]) {
      expect(await ids(s, code), code).toEqual([]);
      expect(await ids(s, code, "grantedBy"), code).toEqual([]);
    }
  });

  it("fail-closed: functie die niet (meer) bij de rol past, ontbrekende machtiging, inactieve leden en leden van een andere ring tellen niet", async () => {
    const s = await setup();
    await s.set(s.president.id, { churchFunctionCode: "RINGPRESIDENT" });
    await s.set(s.first.id, { churchFunctionCode: "EERSTE_RAADGEVER" }); // zonder machtiging
    await s.set(s.ha1.id, { churchFunctionCode: "HOGERAADSLID", appointAuthority: "AANGEWEZEN_HOGERAADSLID" });
    expect(await ids(s, "seminarieleerkracht")).toEqual([s.president.id, s.ha1.id].sort());

    await s.set(s.president.id, { role: "HOGERAAD" }); // rechtstreeks aangepast: functie past niet meer bij de rol
    expect(await ids(s, "seminarieleerkracht")).toEqual([s.ha1.id]);
    await s.set(s.president.id, { role: "RINGPRESIDIUM" });
    await s.set(s.ha1.id, { active: false });
    expect(await ids(s, "seminarieleerkracht")).toEqual([s.president.id]);
    await prisma.user.update({ where: { id: s.president.id }, data: { active: false } });
    expect(await ids(s, "seminarieleerkracht")).toEqual([]);
    await prisma.user.update({ where: { id: s.president.id }, data: { active: true } });
    await prisma.ring.update({ where: { id: s.ring.id }, data: { active: false } });
    expect(await ids(s, "seminarieleerkracht")).toEqual([]);
  });

  it("tenantisolatie: de ringpresident van een andere ring is hier niet bevoegd en kan hier niets wijzigen", async () => {
    const a = await setup();
    const b = await setup();
    await a.set(a.president.id, { churchFunctionCode: "RINGPRESIDENT" });
    await b.set(b.president.id, { churchFunctionCode: "RINGPRESIDENT" }); // zelfde functie in een andere ring is toegestaan (uniek per ring)
    expect(await ids(a, "ringadministrateur")).toEqual([a.president.id]);
    expect(await ids(b, "ringadministrateur")).toEqual([b.president.id]);
    // een ringbeheerder van ring A kan de functie van een lid van ring B niet wijzigen
    const mB = await b.mem(b.first.id);
    const r = await call("POST", `/memberships/${mB.id}`, { token: a.token, body: { churchFunction: "Functie", churchFunctionCode: "EERSTE_RAADGEVER", role: "RINGPRESIDIUM", isRingManager: false, active: true } });
    expect(r.status).toBe(404);
    expect((await b.mem(b.first.id)).churchFunctionCode).toBe("ONBEKEND");
    // en de catalogus/appointers-API van een andere ring is ontoegankelijk
    expect((await call("GET", `/catalog/callings/ringadministrateur/appointers?ring=${b.ring.id}`, { token: a.token })).status).toBe(404);
  });

  it("ringpresident, eerste en tweede raadgever zijn uniek per ring; gelijktijdig toewijzen levert precies één houder op", async () => {
    const s = await setup();
    const base = { actorId: s.manager.id, isRingManager: false, active: true, churchFunction: "Functie", role: "RINGPRESIDIUM" as const };
    // Eerst alle lidmaatschappen ophalen en daarna pas de gelijktijdige updates starten: met een `await` tussen de aanroepen kon een snel
    // afgewezen eerste update nog zonder afhandelaar zijn (niet-afgevangen rejection in de testuitvoer).
    const membershipIds = [(await s.mem(s.president.id)).id, (await s.mem(s.first.id)).id, (await s.mem(s.second.id)).id];
    const results = await Promise.allSettled(membershipIds.map((membershipId) => updateMember({ ...base, membershipId, churchFunctionCode: "RINGPRESIDENT" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.ringMembership.count({ where: { ringId: s.ring.id, churchFunctionCode: "RINGPRESIDENT" } })).toBe(1);
    // een gedeactiveerde houder blokkeert de functie niet; heractiveren naast een nieuwe houder wel
    const holder = await prisma.ringMembership.findFirstOrThrow({ where: { ringId: s.ring.id, churchFunctionCode: "RINGPRESIDENT" } });
    await updateMember({ ...base, membershipId: holder.id, active: false });
    const other = await prisma.ringMembership.findFirstOrThrow({ where: { ringId: s.ring.id, role: "RINGPRESIDIUM", NOT: { id: holder.id } } });
    await updateMember({ ...base, membershipId: other.id, churchFunctionCode: "RINGPRESIDENT" });
    await expect(updateMember({ ...base, membershipId: holder.id, active: true })).rejects.toThrow(/al een actieve ringpresident/);
  });

  it("wijzigen van rol of functie trekt een niet meer passende machtiging in; een machtiging wordt nooit automatisch toegekend", async () => {
    const s = await setup();
    const base = { actorId: s.manager.id, isRingManager: false, active: true, churchFunction: "Functie" };
    const m = await s.mem(s.first.id);
    await updateMember({ ...base, membershipId: m.id, role: "RINGPRESIDIUM", churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    expect(await ids(s, "ringadministrateur")).toEqual([s.first.id]);
    await updateMember({ ...base, membershipId: m.id, role: "RINGPRESIDIUM", churchFunctionCode: "TWEEDE_RAADGEVER" }); // andere raadgever: machtiging blijft (past nog)
    expect((await s.mem(s.first.id)).appointAuthority).toBe("AANGEWEZEN_RAADGEVER");
    await updateMember({ ...base, membershipId: m.id, role: "RINGPRESIDIUM", churchFunctionCode: "RINGPRESIDENT" }); // wordt ringpresident: machtiging vervalt, functie volstaat
    expect(await s.mem(s.first.id)).toMatchObject({ churchFunctionCode: "RINGPRESIDENT", appointAuthority: "NONE" });
    await updateMember({ ...base, membershipId: m.id, role: "RINGPRESIDIUM", churchFunctionCode: "ANDERS" });
    expect(await ids(s, "ringadministrateur")).toEqual([]);
    // herstellen van de functie geeft de machtiging NIET terug
    await updateMember({ ...base, membershipId: m.id, role: "RINGPRESIDIUM", churchFunctionCode: "EERSTE_RAADGEVER" });
    expect(await s.mem(s.first.id)).toMatchObject({ churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "NONE" });
    expect(await ids(s, "ringadministrateur")).toEqual([]);
  });

  it("de web-overgangsvorm (zonder functiecode) wijzigt een bestaande functie en machtiging niet onbedoeld", async () => {
    const s = await setup();
    const m = await s.mem(s.first.id);
    const base = { actorId: s.manager.id, isRingManager: false, active: true, role: "RINGPRESIDIUM" as const };
    await updateMember({ ...base, membershipId: m.id, churchFunction: "Eerste raadgever", churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    await updateMember({ ...base, membershipId: m.id, churchFunction: "Nieuwe omschrijving" }); // zoals de oude webformulieren
    expect(await s.mem(s.first.id)).toMatchObject({ churchFunction: "Nieuwe omschrijving", churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    const added = await addMember({ actorId: s.manager.id, ringId: s.ring.id, isRingManager: false, name: "Web Nieuw", email: "web.nieuw@test.ringapeldoorn.nl", churchFunction: "Raadgever", role: "RINGPRESIDIUM" });
    expect(added.membership).toMatchObject({ churchFunctionCode: "ONBEKEND", appointAuthority: "NONE" });
  });
});

describe("Beheer-API voor functies", () => {
  it("toont en bewaart de gestructureerde functie; ongeldige combinaties worden server-side geweigerd", async () => {
    const s = await setup();
    const list = (await call("GET", `/rings/${s.ring.id}/users`, { token: s.token })).body.users as { userId: string; churchFunctionCode: string }[];
    expect(list.find((u) => u.userId === s.ha1.id)?.churchFunctionCode).toBe("ONBEKEND"); // de helper maakt leden zonder migratie aan
    const mP = await s.mem(s.president.id);
    const ok = await call("POST", `/memberships/${mP.id}`, { token: s.token, body: { churchFunction: "Ringpresident", churchFunctionCode: "RINGPRESIDENT", role: "RINGPRESIDIUM", isRingManager: false, active: true } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await s.mem(s.president.id)).churchFunctionCode).toBe("RINGPRESIDENT");
    const bad = [
      { churchFunctionCode: "HOGERAADSLID", role: "RINGPRESIDIUM" }, // functie past niet bij de rol
      { churchFunctionCode: "RINGPRESIDENT", role: "RINGPRESIDIUM" }, // al een ringpresident? nee: dit is dezelfde persoon → toegestaan; zie hieronder
      { churchFunctionCode: "ONZIN", role: "RINGPRESIDIUM" },
    ];
    const mF = await s.mem(s.first.id);
    expect((await call("POST", `/memberships/${mF.id}`, { token: s.token, body: { churchFunction: "Functie", ...bad[0], isRingManager: false, active: true } })).status).toBe(400);
    expect((await call("POST", `/memberships/${mF.id}`, { token: s.token, body: { churchFunction: "Functie", ...bad[1], isRingManager: false, active: true } })).status).toBe(400); // tweede ringpresident
    expect((await call("POST", `/memberships/${mF.id}`, { token: s.token, body: { churchFunction: "Functie", ...bad[2], isRingManager: false, active: true } })).status).toBe(400);
    expect((await call("POST", `/memberships/${mF.id}`, { token: s.token, body: { churchFunction: "Functie", churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "RINGPRESIDENT", role: "RINGPRESIDIUM", isRingManager: false, active: true } })).status).toBe(400); // verouderde aanwijzing
    expect((await s.mem(s.first.id)).churchFunctionCode).toBe("ONBEKEND");
  });
});

describe("Migratie van bestaande leden (voorzichtige afleiding)", () => {
  // Voert uitsluitend het gegevensdeel van de migratie uit, op leden die als bestaande (pre-C4.5) data zijn aangemaakt.
  const sql = readFileSync("prisma/migrations/20261113100000_c45_kerkelijke_functies/migration.sql", "utf8");
  const dataPart = sql.slice(sql.indexOf("-- 1. Lid van de hoge raad"));
  const statements = dataPart.split(/;\s*\n/).map((x) => x.replace(/--.*$/gm, "").trim()).filter((x) => x.length > 0);
  const migrate = async () => { for (const st of statements) await prisma.$executeRawUnsafe(st); };
  const code = async (s: S, userId: string) => (await s.mem(userId)).churchFunctionCode;

  it("leidt alleen af wat ondubbelzinnig is en kent nooit een machtiging toe of wijzigt die", async () => {
    expect(statements.length).toBeGreaterThanOrEqual(5);
    const s = await setup();
    // bestaande toestand: ringpresident aangewezen via de oude aanwijzing; eerste raadgever met exacte omschrijving; tweede raadgever alleen met een oude aanwijzing
    await s.set(s.president.id, { appointAuthority: "RINGPRESIDENT", churchFunction: "Iets anders" });
    await s.set(s.first.id, { churchFunction: "  Eerste Raadgever " });
    await s.set(s.second.id, { appointAuthority: "AANGEWEZEN_RAADGEVER", churchFunction: "Raadgever" });
    await s.set(s.ha1.id, { appointAuthority: "AANGEWEZEN_HOGERAADSLID" });
    await migrate();
    expect(await code(s, s.president.id)).toBe("RINGPRESIDENT");
    expect(await code(s, s.first.id)).toBe("EERSTE_RAADGEVER");
    expect(await code(s, s.second.id)).toBe("ONBEKEND"); // raadgever zonder exacte omschrijving: niet raden
    expect(await code(s, s.ha1.id)).toBe("HOGERAADSLID"); // rol hoge raad
    expect(await code(s, s.ha2.id)).toBe("HOGERAADSLID");
    expect(await code(s, s.manager.id)).toBe("ONBEKEND"); // secretaris: een rol is geen functie
    // machtigingen zijn ongewijzigd
    expect((await s.mem(s.ha1.id)).appointAuthority).toBe("AANGEWEZEN_HOGERAADSLID");
    expect((await s.mem(s.second.id)).appointAuthority).toBe("AANGEWEZEN_RAADGEVER");
    expect((await s.mem(s.ha2.id)).appointAuthority).toBe("NONE");
    // gevolgen voor bevoegdheid: wat zeker is werkt, het onzekere blijft dicht (fail-closed) tot de ringbeheerder de functie vastlegt
    expect(await ids(s, "seminarieleerkracht")).toEqual([s.president.id, s.ha1.id].sort()); // president + aangewezen hogeraadslid; geen eerste (geen machtiging), geen tweede (functie onbekend)
    expect((await explainAuthorityGap(s.ring.id, "RINGPRESIDENT_OF_RAADGEVER")).join(" ")).toMatch(/nog geen kerkelijke functie/);
  });

  it("bij dubbelzinnigheid of afwijkende situatie wordt niets afgeleid", async () => {
    const s = await setup();
    // twee actieve leden met dezelfde omschrijving; ringpresident-aanwijzing bij twee leden; inactieve houder; verkeerde rol
    await s.set(s.president.id, { churchFunction: "Ringpresident", appointAuthority: "RINGPRESIDENT" });
    await s.set(s.first.id, { churchFunction: "Ringpresident", appointAuthority: "RINGPRESIDENT" });
    await s.set(s.second.id, { churchFunction: "Eerste raadgever", active: false });
    await s.set(s.ha1.id, { role: "RINGSECRETARIS", churchFunction: "Tweede raadgever" }); // omschrijving bij verkeerde rol
    const other = await createTestUser("RINGPRESIDIUM", "Extra Raadgever", { ringId: s.ring.id });
    await prisma.ringMembership.updateMany({ where: { userId: other.id }, data: { churchFunction: "eerste raadgever" } });
    await migrate();
    expect(await code(s, s.president.id)).toBe("ONBEKEND");
    expect(await code(s, s.first.id)).toBe("ONBEKEND");
    expect(await code(s, s.second.id)).toBe("ONBEKEND"); // inactief
    expect(await code(s, s.ha1.id)).toBe("ONBEKEND"); // geen rol hoge raad meer, verkeerde rol voor de omschrijving
    expect(await code(s, other.id)).toBe("EERSTE_RAADGEVER"); // enige actieve 'eerste raadgever' van de ring
    // nooit twee houders van dezelfde functie
    expect(await prisma.ringMembership.count({ where: { ringId: s.ring.id, churchFunctionCode: "EERSTE_RAADGEVER" } })).toBe(1);
    expect(await ids(s, "ringadministrateur")).toEqual([]); // niemand is bevoegd tot de functies zijn vastgelegd
  });

  it("is idempotent en laat reeds vastgelegde functies ongemoeid", async () => {
    const s = await setup();
    await s.set(s.president.id, { appointAuthority: "RINGPRESIDENT" });
    await s.set(s.first.id, { churchFunctionCode: "TWEEDE_RAADGEVER", churchFunction: "Eerste raadgever" }); // bewust vastgelegd, wijkt af van de omschrijving
    await migrate();
    await migrate();
    expect(await code(s, s.president.id)).toBe("RINGPRESIDENT");
    expect(await code(s, s.first.id)).toBe("TWEEDE_RAADGEVER");
  });
});

describe("Automatische voorstellen van verantwoordelijken", () => {
  async function ready(s: S, opts: { president?: boolean; raadgever?: boolean; hogeraadslid?: boolean } = {}) {
    if (opts.president) await s.set(s.president.id, { churchFunctionCode: "RINGPRESIDENT" });
    if (opts.raadgever) await s.set(s.first.id, { churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "AANGEWEZEN_RAADGEVER" });
    if (opts.hogeraadslid) await s.set(s.ha2.id, { churchFunctionCode: "HOGERAADSLID", appointAuthority: "AANGEWEZEN_HOGERAADSLID" });
  }
  const draft = (s: S, code: string, over: Record<string, unknown> = {}) => ({ unitId: s.unit.id, functionSource: "STANDAARD" as const, functionCode: code, ...over });

  it("stelt de ringpresident voor bij een regel die alleen hem toelaat, met de grond van de bevoegdheid", async () => {
    const s = await setup();
    await ready(s, { president: true, raadgever: true });
    const sug = await buildSuggestions(s.ring.id, draft(s, "zhv-presidente"));
    expect(sug.roepen).toMatchObject({ userId: s.president.id, source: "FUNCTIE_RINGPRESIDENT", basis: "Ringpresident (op grond van de functie)" });
    expect(sug.aanstellen).toMatchObject({ userId: s.president.id, source: "FUNCTIE_RINGPRESIDENT" });
    expect(sug.eligible.roepen.map((e) => e.id)).toEqual([s.president.id]);
  });

  it("stelt bij meerdere bevoegden de ringpresident voor, anders de enige bevoegde; zonder duidelijke keuze niets", async () => {
    const s = await setup();
    await ready(s, { president: true, raadgever: true });
    const both = await buildSuggestions(s.ring.id, draft(s, "ringadministrateur"));
    expect(both.roepen).toMatchObject({ userId: s.president.id, source: "FUNCTIE_RINGPRESIDENT" });
    expect(both.eligible.aanstellen.map((e) => e.id)).toEqual([s.president.id, s.first.id]); // ringpresident eerst
    expect(both.eligible.aanstellen[1].basis).toMatch(/Aangewezen raadgever/);

    const only = await setup();
    await ready(only, { raadgever: true });
    expect((await buildSuggestions(only.ring.id, draft(only, "ringadministrateur"))).aanstellen).toMatchObject({ userId: only.first.id, source: "FUNCTIE_ENIGE_BEVOEGDE" });

    const many = await setup();
    await ready(many, { raadgever: true, hogeraadslid: true });
    const none = await buildSuggestions(many.ring.id, draft(many, "seminarieleerkracht"));
    expect(none.aanstellen).toBeNull(); // twee bevoegden zonder wijkstandaard en zonder ringpresident: de gebruiker kiest
    expect(none.eligible.aanstellen).toHaveLength(2);
  });

  it("een wijkkoppeling van een hogeraadslid is geen machtiging: pas met functie én machtiging wordt hij voorgesteld", async () => {
    const s = await setup(); // ha1 is verantwoordelijk hogeraadslid van de wijk
    await ready(s, { president: true });
    let sug = await buildSuggestions(s.ring.id, draft(s, "seminarieleerkracht"));
    expect(sug.aanstellen).toMatchObject({ userId: s.president.id, source: "FUNCTIE_RINGPRESIDENT" }); // niet ha1
    await s.set(s.ha1.id, { churchFunctionCode: "HOGERAADSLID" }); // functie zonder machtiging
    sug = await buildSuggestions(s.ring.id, draft(s, "seminarieleerkracht"));
    expect(sug.aanstellen?.userId).toBe(s.president.id);
    expect(sug.eligible.aanstellen.map((e) => e.id)).not.toContain(s.ha1.id);
    await s.set(s.ha1.id, { appointAuthority: "AANGEWEZEN_HOGERAADSLID" }); // nu wel bevoegd → wijkkoppeling levert de voorkeur
    sug = await buildSuggestions(s.ring.id, draft(s, "seminarieleerkracht"));
    expect(sug.aanstellen).toMatchObject({ userId: s.ha1.id, source: "UNIT_VERANTWOORDELIJKE" });
  });

  it("niet-geverifieerde en bijzondere procedures en eigen roepingen: nooit een voorstel, wel menselijke controle; externe uitvoerder blijft handmatig", async () => {
    const s = await setup();
    await ready(s, { president: true, raadgever: true });
    for (const code of ["muziekdeskundige", "instituutshoofd", "eerste-raadgever-in-de-bisschap"]) {
      const sug = await buildSuggestions(s.ring.id, draft(s, code));
      expect(sug.roepen, code).toBeNull();
      expect(sug.aanstellen, code).toBeNull();
      expect(sug.eligible.roepen, code).toEqual([]);
      expect(sug.notes.aanstellen, code).toMatch(/Menselijke controle nodig/);
      expect(sug.notes.aanstellen, code).toMatch(/externe persoon \(zonder Ringtools-account\)/);
    }
  });

  it("legt uit waarom niemand bevoegd is (functie/machtiging ontbreekt) zonder namen te noemen", async () => {
    const s = await setup();
    const sug = await buildSuggestions(s.ring.id, draft(s, "ringadministrateur"));
    expect(sug.aanstellen).toBeNull();
    expect(sug.notes.aanstellen).toMatch(/geen ringpresident vastgelegd/);
    expect(sug.notes.aanstellen).toMatch(/machtiging 'aangewezen raadgever'/);
    expect(sug.notes.aanstellen).toMatch(/nog geen kerkelijke functie vastgelegd/);
    for (const u of [s.president, s.first, s.second, s.ha1, s.ha2, s.manager]) expect(sug.notes.aanstellen).not.toContain(u.name);
  });

  it("indienen vereist nog steeds server-side een bevoegd lid of een externe uitvoerder; een lid zonder functie wordt geweigerd", async () => {
    const s = await setup();
    await ready(s, { president: true });
    const body = (over: Record<string, unknown>) => ({ personName: "Jan Test", unitId: s.unit.id, functionSource: "STANDAARD", functionCode: "ringadministrateur", ...over });
    const create = (b: Record<string, unknown>) => call("POST", `/drafts?ring=${s.ring.id}`, { token: s.token, body: b });
    const submit = (id: string) => call("POST", `/drafts/${id}/submit`, { token: s.token });
    const noFn = await create(body({ aanstellenAssigneeId: s.second.id })); // ringpresidium-rol, geen functie
    expect((await submit(noFn.body.id)).status).toBe(400);
    const ok = await create(body({ aanstellenAssigneeId: s.president.id }));
    expect((await submit(ok.body.id)).status).toBe(200);
    const ext = await create(body({ roepenExternalName: "Gebiedszeventiger Extern" }));
    expect((await submit(ext.body.id)).status).toBe(200);
    expect(await prisma.calling.count({ where: { roepenExternalName: "Gebiedszeventiger Extern" } })).toBe(1);
  });
});

describe("Catalogus-API voor het overzicht onder Inrichting", () => {
  it("ringbeheerders en ringstaf van de eigen ring lezen de catalogus; anderen niet; de webmin via een apart pad", async () => {
    const s = await setup();
    const hrManager = await createTestUser("HOGERAAD", "Beheer HR", { ringId: s.ring.id, isRingManager: true });
    const plainHr = await login(s.ha2.id);
    const res = await call("GET", `/catalog/callings?ring=${s.ring.id}&q=ringadministrateur`, { token: await login(hrManager.id) });
    expect(res.status).toBe(200);
    expect(res.body.callings[0]).toMatchObject({ code: "ringadministrateur", ruleStatus: "GEVERIFIEERD", handbook: expect.any(Array), supportVenue: "RINGCONFERENTIE", appointment: "VERPLICHT" });
    expect((await call("GET", `/catalog/callings?ring=${s.ring.id}`, { token: plainHr })).status).toBe(403);
    expect((await call("GET", `/catalog/callings?ring=${s.ring.id}`, { token: s.token })).status).toBe(200);
    const other = await setup();
    expect((await call("GET", `/catalog/callings?ring=${other.ring.id}`, { token: s.token })).status).toBe(404);

    const admin = await createTestUser("ADMIN", "Webmin Catalogus");
    const adminToken = await login(admin.id);
    const viaAdmin = await call("GET", `/admin/catalog/callings?ring=${s.ring.id}`, { token: adminToken });
    expect(viaAdmin.status).toBe(200);
    expect(viaAdmin.body.callings.length).toBeGreaterThan(80);
    expect((await call("GET", `/admin/catalog/callings?ring=onbestaand`, { token: adminToken })).status).toBe(404);
    expect((await call("GET", `/admin/catalog/callings?ring=${s.ring.id}`, { token: s.token })).status).toBe(403); // webmin- en gebruikers-API blijven gescheiden
    expect((await call("GET", `/catalog/callings?ring=${s.ring.id}`, { token: adminToken })).status).toBe(403);
  });

  it("bevat de catalogus geen personen en markeert hij functies buiten Ringtools", async () => {
    const s = await setup();
    const res = await call("GET", `/catalog/callings?ring=${s.ring.id}`, { token: s.token });
    const all = res.body.callings as { code: string; ringtoolsProcess: boolean; ruleStatus: string; extraApproval: string | null }[];
    for (const code of ["ringpresident", "eerste-raadgever-ringpresidium", "tweede-raadgever-ringpresidium", "ringpatriarch"]) {
      expect(all.find((c) => c.code === code), code).toMatchObject({ ringtoolsProcess: false, ruleStatus: "BIJZONDER" });
    }
    expect(all.find((c) => c.code === "eerste-raadgever-in-de-bisschap")?.ringtoolsProcess).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/@|\b(19|20)\d{2}-\d{2}-\d{2}\b/); // geen e-mailadressen of datums van personen
  });
});

describe("Gezamenlijk presidiumbesluit bij roepingsvoorstellen: registreren en vrijgeven zijn aparte handelingen", () => {
  it("de API weigert 'direct vrijgeven' bij het presidiumbesluit; vrijgeven blijft een afzonderlijke, expliciete handeling", async () => {
    const s = await setup();
    const calling = await prisma.calling.create({ data: { ringId: s.ring.id, personName: "Voorbeeld", functionTitle: "Leraar", createdById: s.manager.id } });
    const input = { stage: "PRESIDIUM", decidedOn: today(), agreed: true, presentUserIds: [s.president.id, s.first.id] };
    // het voorstel moet in de presidiumronde staan
    await prisma.eligibleVoter.createMany({ data: [s.president, s.first, s.second].map((u) => ({ callingId: calling.id, stage: "PRESIDIUM" as const, userId: u.id })) });
    const refused = await call("POST", `/callings/${calling.id}/group-decision`, { token: s.token, body: { ...input, releaseNow: true } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/aparte handeling/);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("PRESIDIUM_VOTING");
    expect(await prisma.groupDecision.count({ where: { callingId: calling.id } })).toBe(0);

    const registered = await call("POST", `/callings/${calling.id}/group-decision`, { token: s.token, body: input });
    expect(registered.status).toBe(200);
    const after = await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } });
    expect(after.status).toBe("PRESIDIUM_APPROVED"); // wacht op vrijgave
    expect(after.hogeraadReleasedAt).toBeNull();
    expect(await prisma.eligibleVoter.count({ where: { callingId: calling.id, stage: "HOGERAAD" } })).toBe(0);
    expect(await prisma.callingAudit.count({ where: { callingId: calling.id, type: "HOGERAAD_RELEASED" } })).toBe(0);

    const released = await call("POST", `/callings/${calling.id}/release`, { token: s.token });
    expect(released.status).toBe(200);
    expect((await prisma.calling.findUniqueOrThrow({ where: { id: calling.id } })).status).toBe("HOGERAAD_VOTING");
    expect(await prisma.eligibleVoter.count({ where: { callingId: calling.id, stage: "HOGERAAD" } })).toBe(2);
  });
});
