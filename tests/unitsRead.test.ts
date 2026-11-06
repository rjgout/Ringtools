import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { createUnit, updateUnit } from "@/lib/ringSetup";
import { createTestRing, createTestUser, resetDatabase } from "./setup";

// iPhone-acceptatietest 16/18: een ringsecretaris zónder ringbeheerrechten kreeg bij 'Nieuw voorstel' 'Niet gevonden' op het ophalen
// van wijken en gemeenten (GET /rings/:id/units was voorbehouden aan ringbeheerders). Lezen van actieve eenheden is geen beheerrecht.
const { handleApi } = await import("@/lib/api/router");

beforeEach(async () => {
  await resetDatabase();
  await prisma.ringUnit.deleteMany();
});

async function call(method: string, path: string, token: string, body: unknown = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean)
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const login = async (id: string) => (await createVerifiedSession(id, "Test")).rawToken;

let n = 0;
async function world() {
  const k = ++n;
  const ring = await createTestRing(`Ring ${k}`);
  const r = { ringId: ring.id };
  const manager = await createTestUser("RINGSECRETARIS", `Beheerder ${k}`, { ...r, isRingManager: true });
  const secretaris = await createTestUser("RINGSECRETARIS", `Secretaris ${k}`, r);
  const administrateur = await createTestUser("RINGADMINISTRATEUR", `Administrateur ${k}`, r);
  const presidium = await createTestUser("RINGPRESIDIUM", `President ${k}`, r);
  const hogeraad = await createTestUser("HOGERAAD", `Hogeraad ${k}`, r);
  const wijk = await createUnit(manager.id, ring.id, { kind: "WIJK", name: `Wijk Noord ${k}` });
  const gemeente = await createUnit(manager.id, ring.id, { kind: "GEMEENTE", name: `Gemeente Zuid ${k}` });
  const oud = await createUnit(manager.id, ring.id, { kind: "WIJK", name: `Wijk Oud ${k}` });
  await updateUnit(manager.id, oud.id, { active: false });
  return { ring, manager, secretaris, administrateur, presidium, hogeraad, wijk, gemeente, oud };
}
const names = (b: Record<string, any>) => (b.units as { name: string }[]).map((u) => u.name).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Wijken en gemeenten ophalen voor een nieuw voorstel", () => {
  it("ringsecretaris zonder beheerrechten ziet de actieve wijken en gemeenten van de eigen ring (was: 404 'Niet gevonden')", async () => {
    const w = await world();
    const res = await call("GET", `/rings/${w.ring.id}/units`, await login(w.secretaris.id));
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([w.gemeente.name, w.wijk.name].sort()); // inactieve wijk niet zichtbaar
    expect(res.body.units.every((u: { active: boolean }) => u.active)).toBe(true);
  });

  it.each(["presidium", "administrateur"] as const)("%s (ringstaf) kan ze ook ophalen", async (who) => {
    const w = await world();
    const res = await call("GET", `/rings/${w.ring.id}/units`, await login(w[who].id));
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([w.gemeente.name, w.wijk.name].sort());
  });

  it("de ringbeheerder behoudt het volledige overzicht (ook inactieve eenheden, verantwoordelijken en standaarden)", async () => {
    const w = await world();
    const res = await call("GET", `/rings/${w.ring.id}/units`, await login(w.manager.id));
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([w.gemeente.name, w.oud.name, w.wijk.name].sort());
  });

  it("de secretaris krijgt geen verantwoordelijken of standaarduitvoerders te zien (alleen wat nodig is om te kiezen)", async () => {
    const w = await world();
    await updateUnit(w.manager.id, w.wijk.id, { responsibleUserId: w.hogeraad.id, defaultRoepenUserId: w.presidium.id });
    const res = await call("GET", `/rings/${w.ring.id}/units`, await login(w.secretaris.id));
    const u = res.body.units.find((x: { id: string }) => x.id === w.wijk.id);
    expect(u.responsible).toBeNull();
    expect(u.defaults).toEqual({ roepen: null, ondersteunen: null, aanstellen: null });
  });

  it("niet-ringstaf (hoge raad) en vreemden krijgen niets: andere ring, inactief lidmaatschap/account/ring", async () => {
    const w = await world();
    const other = await world();
    const inactiveMember = await createTestUser("RINGSECRETARIS", "Inactief Lid", { ringId: w.ring.id, active: false });
    const deactivated = await createTestUser("RINGSECRETARIS", "Gedeactiveerd Account", { ringId: w.ring.id });
    const tDeact = await login(deactivated.id);
    await prisma.user.update({ where: { id: deactivated.id }, data: { active: false } });
    const attempts: [string, string][] = [
      ["hoge raad", await login(w.hogeraad.id)],
      ["staf van een andere ring", await login(other.secretaris.id)],
      ["inactief lidmaatschap", await login(inactiveMember.id)],
      ["gedeactiveerd account", tDeact],
    ];
    for (const [who, token] of attempts) {
      const res = await call("GET", `/rings/${w.ring.id}/units`, token);
      expect(res.status, who).toBeGreaterThanOrEqual(400);
      expect(res.body.units, who).toBeUndefined();
    }
    await prisma.ring.update({ where: { id: w.ring.id }, data: { active: false } });
    expect((await call("GET", `/rings/${w.ring.id}/units`, await login(w.secretaris.id))).status).toBeGreaterThanOrEqual(400); // gedeactiveerde ring
  });

  it("ringen blijven gescheiden: de secretaris ziet alleen eenheden van de eigen ring en kan die van een andere ring niet opvragen", async () => {
    const a = await world();
    const b = await world();
    const t = await login(a.secretaris.id);
    const own = await call("GET", `/rings/${a.ring.id}/units`, t);
    expect(names(own.body).join()).not.toContain(b.wijk.name);
    expect((await call("GET", `/rings/${b.ring.id}/units`, t)).status).toBe(404);
  });

  it("beheerrechten blijven gescheiden: de secretaris kan geen eenheid aanmaken of wijzigen", async () => {
    const w = await world();
    const t = await login(w.secretaris.id);
    const create = await call("POST", `/rings/${w.ring.id}/units`, t, { kind: "WIJK", name: "Nieuwe wijk" });
    expect(create.status).toBeGreaterThanOrEqual(400);
    const edit = await call("POST", `/units/${w.wijk.id}`, t, { name: "Gewijzigd", active: false });
    expect(edit.status).toBeGreaterThanOrEqual(400);
    const unit = await prisma.ringUnit.findUniqueOrThrow({ where: { id: w.wijk.id } });
    expect(unit).toMatchObject({ name: w.wijk.name, active: true });
    expect(await prisma.ringUnit.count({ where: { ringId: w.ring.id } })).toBe(3);
  });

  it("de hele nieuwe-voorstelroute werkt voor de secretaris: eenheden → catalogus → concept → indienen", async () => {
    const w = await world();
    const t = await login(w.secretaris.id);
    const units = await call("GET", `/rings/${w.ring.id}/units`, t);
    const unitId = units.body.units[0].id;
    expect((await call("GET", `/catalog/callings?ring=${w.ring.id}&q=ringadministrateur`, t)).status).toBe(200);
    expect((await call("GET", `/rings/${w.ring.id}/members`, t)).status).toBe(200);
    const draft = await call("POST", `/drafts?ring=${w.ring.id}`, t, { personName: "Voorbeeld Persoon", unitId, functionSource: "STANDAARD", functionCode: "ringadministrateur" });
    expect(draft.status).toBe(200);
    expect((await call("POST", `/drafts/${draft.body.id}/submit`, t)).status).toBe(200);
  });
});
