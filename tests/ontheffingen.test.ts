import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import type { AppNotification, Dashboard, OntheffingListItem, OntheffingView } from "@shared/api-types";
import { createUnit, createCustomCalling } from "@/lib/ringSetup";
import { notify } from "@/lib/notifications";
import { deleteDueOntheffingen, deliverOntheffingNotifications, ontheffingCounts, retryPendingOntheffingNotifications } from "@/lib/ontheffingen";
import { getPendingActionCount } from "@/lib/queries";
import { createTestRing, createTestUser, resetDatabase } from "./setup";

const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/mailer")>()),
  sendMail: (...args: unknown[]) => sendMailMock(...args),
}));
const { handleApi } = await import("@/lib/api/router");

beforeEach(async () => {
  await resetDatabase();
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
const today = () => new Date().toISOString().slice(0, 10);

let n = 0;
async function setup() {
  const k = ++n;
  const ring = await createTestRing(`Ring ${k}`);
  const r = { ringId: ring.id };
  const manager = await createTestUser("RINGSECRETARIS", `Secretaris ${k}`, { ...r, isRingManager: true });
  const president = await createTestUser("RINGPRESIDIUM", `President ${k}`, r);
  const counselor = await createTestUser("RINGPRESIDIUM", `Raadgever ${k}`, r);
  const ha1 = await createTestUser("HOGERAAD", `Hogeraad A ${k}`, r);
  const ha2 = await createTestUser("HOGERAAD", `Hogeraad B ${k}`, r);
  const ha3 = await createTestUser("HOGERAAD", `Hogeraad C ${k}`, r);
  const unit = await createUnit(manager.id, ring.id, { kind: "WIJK", name: `Wijk ${k}`, responsibleUserId: ha1.id });
  const tokens = {
    manager: await login(manager.id), president: await login(president.id), counselor: await login(counselor.id),
    ha1: await login(ha1.id), ha2: await login(ha2.id), ha3: await login(ha3.id),
  };
  return { ring, manager, president, counselor, ha1, ha2, ha3, unit, t: tokens };
}
type S = Awaited<ReturnType<typeof setup>>;

const main = (name: string, over: Record<string, unknown> = {}) => ({ role: "HOOFD", name, accountMode: "GEEN_ACCOUNT", ...over });
async function concept(s: S, body: Record<string, unknown>, token = s.t.manager) {
  return call("POST", `/ontheffingen?ring=${s.ring.id}`, { token, body });
}
const full = (s: S, over: Record<string, unknown> = {}) => ({
  unitId: s.unit.id, functionSource: "STANDAARD", functionCode: "ringadministrateur", persons: [main("Piet Voorbeeld")], ...over,
});
const view = (id: string, token: string) => call("GET", `/ontheffingen/${id}`, { token });
const submit = (id: string, token: string) => call("POST", `/ontheffingen/${id}/submit`, { token });
const vote = (id: string, token: string, support: boolean) => call("POST", `/ontheffingen/${id}/vote`, { token, body: { support } });
const release = (id: string, token: string) => call("POST", `/ontheffingen/${id}/release`, { token });
const step = (pid: string, st: string, token: string, body: Record<string, unknown> = {}) => call("POST", `/ontheffingen/persons/${pid}/${st}`, { token, body });

async function submitted(s: S, over: Record<string, unknown> = {}) {
  const c = await concept(s, full(s, over));
  expect(c.status).toBe(200);
  const r = await submit(c.body.id, s.t.manager);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return c.body.id as string;
}
/** Doorloopt presidium (alle presidiumleden steunen) + vrijgave + hoge raad (alle hogeraadsleden steunen). */
async function approveFully(s: S, id: string, hr: (keyof S["t"])[] = ["ha1", "ha2", "ha3"]) {
  for (const who of ["president", "counselor"] as const) {
    const v = await vote(id, s.t[who], true);
    if (v.status !== 200) expect(v.body.error).toMatch(/geen ondersteuning/); // betrokkene/uitgesloten
  }
  expect((await release(id, s.t.manager)).status).toBe(200);
  for (const who of hr) await vote(id, s.t[who], true);
}

describe("Concept", () => {
  it("is onvolledig toegestaan, alleen zichtbaar voor de aanmaker, start geen ronde en verstuurt niets", async () => {
    const s = await setup();
    const c = await concept(s, { persons: [{ role: "HOOFD", name: "Alleen een naam" }] });
    expect(c.status).toBe(200);
    expect((await view(c.body.id, s.t.manager)).body).toMatchObject({ status: "CONCEPT", persons: [{ name: "Alleen een naam" }] });
    // andere ringstaf (ook het presidium) ziet het concept niet: zelfde antwoord als bij een onbekend dossier
    const other = await view(c.body.id, s.t.president);
    const unknown = await view("onbestaand123456", s.t.president);
    expect(other.status).toBe(403);
    expect(other.body).toEqual(unknown.body);
    expect((await call("GET", `/ontheffingen?ring=${s.ring.id}`, { token: s.t.president })).body.ontheffingen).toEqual([]);
    expect((await call("GET", `/ontheffingen?ring=${s.ring.id}`, { token: s.t.manager })).body.ontheffingen).toHaveLength(1);
    expect(await prisma.ontheffingVoter.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();

    // later wijzigen
    expect((await call("POST", `/ontheffingen/${c.body.id}`, { token: s.t.manager, body: { unitId: s.unit.id, functionSource: "STANDAARD", functionCode: "ringadministrateur" } })).status).toBe(200);
    expect((await call("POST", `/ontheffingen/${c.body.id}`, { token: s.t.president, body: { unitId: s.unit.id } })).status).toBe(403);
    // verwijderen vereist bevestiging
    expect((await call("POST", `/ontheffingen/${c.body.id}/delete`, { token: s.t.manager, body: {} })).status).toBe(400);
    expect((await call("POST", `/ontheffingen/${c.body.id}/delete`, { token: s.t.manager, body: { confirmed: true } })).status).toBe(200);
    expect(await prisma.ontheffing.count()).toBe(0);
  });

  it("alleen ringstaf van een actieve ring kan een concept maken; webmin en hogeraadsleden niet", async () => {
    const s = await setup();
    expect((await concept(s, full(s), s.t.ha1)).status).toBe(403);
    const admin = await createTestUser("ADMIN", "Webmin");
    expect((await concept(s, full(s), await login(admin.id))).status).toBe(403);
    await prisma.ring.update({ where: { id: s.ring.id }, data: { active: false } });
    expect((await concept(s, full(s))).status).toBe(403);
  });

  it("verwijzingen moeten bij deze ring horen (wijk, eigen roeping, account) en bisschop of buiten-Ringtools-functies zijn niet te kiezen", async () => {
    const s = await setup();
    const otherRing = await createTestRing("Andere ring");
    const otherUnit = await createUnit((await createTestUser("RINGSECRETARIS", "Beheer Ander", { ringId: otherRing.id, isRingManager: true })).id, otherRing.id, { kind: "WIJK", name: "Vreemde wijk" });
    expect((await concept(s, full(s, { unitId: otherUnit.id }))).status).toBe(400);

    const foreign = await createTestUser("HOGERAAD", "Vreemd Lid", { ringId: otherRing.id });
    const linkForeign = await concept(s, full(s, { persons: [main("X Persoon", { accountMode: "GEKOPPELD", userId: foreign.id })] }));
    expect(linkForeign.status).toBe(400);
    expect(linkForeign.body.error).toMatch(/geen actief lid van deze ring/);

    const bishop = await createCustomCalling(s.manager.id, s.ring.id, { name: "Bisschop", category: "Overig" });
    const b = await concept(s, full(s, { functionSource: "EIGEN", functionCode: bishop.id }));
    expect(b.status).toBe(400);
    expect(b.body.error).toMatch(/bisschop/i);
    // de ringpresident volgt een procedure buiten Ringtools
    expect((await concept(s, full(s, { functionCode: "ringpresident" }))).status).toBe(400);
    // raadgever in de bisschap valt wél binnen Ringtools (afspraak met de eigenaar)
    expect((await concept(s, full(s, { functionCode: "eerste-raadgever-in-de-bisschap" }))).status).toBe(200);
  });

  it("je kunt jezelf niet als betrokkene koppelen, en een account niet tweemaal in één dossier", async () => {
    const s = await setup();
    const self = await concept(s, full(s, { persons: [main("Ik Zelf", { accountMode: "GEKOPPELD", userId: s.manager.id })] }));
    expect(self.status).toBe(400);
    const dup = await concept(s, full(s, { functionCode: "zhv-presidente", persons: [main("A Persoon", { accountMode: "GEKOPPELD", userId: s.ha1.id }), { role: "RAADGEVER", followUpCode: "eerste-raadgeefster-zhv-presidium-ring", answer: "NAAM", name: "B Persoon", accountMode: "GEKOPPELD", userId: s.ha1.id }] }));
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/al aan een andere betrokkene/);
  });
});

describe("Indienen", () => {
  it("valideert alles opnieuw: naam, wijk of gemeente, functie, account-identificatie, procedurebevestiging", async () => {
    const s = await setup();
    const check = async (body: Record<string, unknown>, expected: RegExp) => {
      const c = await concept(s, body);
      expect(c.status).toBe(200);
      const r = await submit(c.body.id, s.t.manager);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(expected);
      expect((await prisma.ontheffing.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe("CONCEPT");
    };
    await check(full(s, { persons: [main("X")] }), /naam van de persoon/);
    await check(full(s, { unitId: null }), /wijk of gemeente/);
    await check(full(s, { functionSource: null, functionCode: null }), /Kies een roeping/);
    await check(full(s, { persons: [{ role: "HOOFD", name: "Piet Voorbeeld" }] }), /Ringtools-account/); // account-identificatie is verplicht en nooit automatisch
    await check(full(s, { functionCode: "muziekdeskundige" }), /Bevestig dat de bevoegde leiding de procedure/); // niet-geverifieerde regel
    const own = await createCustomCalling(s.manager.id, s.ring.id, { name: "Eigen functie", category: "Overig" });
    await check(full(s, { functionSource: "EIGEN", functionCode: own.id }), /Bevestig dat de bevoegde leiding de procedure/);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("is geblokkeerd zolang de ringinrichting geen wijken of gemeenten kent; het concept blijft bewaard", async () => {
    const s = await setup();
    const c = await concept(s, full(s));
    await prisma.ringUnit.deleteMany();
    const r = await submit(c.body.id, s.t.manager);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/ringinrichting is nog niet compleet/);
    expect((await prisma.ontheffing.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe("CONCEPT");
  });

  it("legt unit, functie, catalogusversie en procedure vast; latere wijzigingen veranderen het dossier niet", async () => {
    const s = await setup();
    const id = await submitted(s);
    const row = await prisma.ontheffing.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "PRESIDIUM_VOTING", unitNameSnapshot: s.unit.name, unitKindSnapshot: "WIJK", functionCode: "ringadministrateur", functionName: "Ringadministrateur" });
    expect(row.catalogVersion).toMatch(/^\d{4}\.\d{2}-\d+$/);
    expect(row.procedureSnapshot).toMatchObject({ code: "ringadministrateur", ruleStatus: "GEVERIFIEERD" });
    await prisma.ringUnit.update({ where: { id: s.unit.id }, data: { name: "Hernoemde wijk", active: false } });
    expect((await view(id, s.t.manager)).body.unit).toMatchObject({ name: s.unit.name });
    // een ingediend dossier is geen concept meer
    expect((await call("POST", `/ontheffingen/${id}`, { token: s.t.manager, body: { unitId: s.unit.id } })).status).toBe(400);
  });

  it("dubbel indienen (herhaling en gelijktijdig) geeft één overgang en één set generieke meldingen, zonder e-mail", async () => {
    const s = await setup();
    const c = await concept(s, full(s));
    const results = await Promise.all([submit(c.body.id, s.t.manager), submit(c.body.id, s.t.manager), submit(c.body.id, s.t.manager)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => !r.body.alreadySubmitted)).toHaveLength(1);
    expect(await prisma.ontheffingVoter.count({ where: { stage: "PRESIDIUM" } })).toBe(2);
    const notes = await prisma.notification.findMany({ where: { ontheffingId: c.body.id } });
    expect(notes).toHaveLength(2);
    for (const note of notes) {
      expect(note.type).toBe("CONFIDENTIAL_PROPOSAL");
      expect(`${note.title} ${note.message}`).not.toMatch(/Piet|Voorbeeld|Ringadministrateur|ontheffing|Wijk/i);
      expect(note.targetUrl).toBe(`/ontheffingen/${c.body.id}`);
    }
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("slaagt het indienen maar mislukken de meldingen, dan herstelt een herhaling zonder dubbele meldingen", async () => {
    const s = await setup();
    const c = await concept(s, full(s));
    const spy = vi.spyOn(prisma.notification, "createMany").mockRejectedValueOnce(new Error("storing"));
    const first = await submit(c.body.id, s.t.manager);
    spy.mockRestore();
    expect(first.status).toBe(200);
    expect(first.body.notificationsDelivered).toBe(false);
    expect((await prisma.ontheffing.findUniqueOrThrow({ where: { id: c.body.id } })).notifyEvent).toBe("SUBMITTED");
    expect(await prisma.notification.count()).toBe(0);
    await prisma.ontheffing.update({ where: { id: c.body.id }, data: { notifyClaimedAt: new Date(Date.now() - 5 * 60_000), updatedAt: new Date(Date.now() - 10 * 60_000) } });
    const again = await submit(c.body.id, s.t.manager);
    expect(again.body).toMatchObject({ alreadySubmitted: true, notificationsDelivered: true });
    expect(await prisma.notification.count({ where: { ontheffingId: c.body.id } })).toBe(2);
    expect((await prisma.ontheffing.findUniqueOrThrow({ where: { id: c.body.id } })).notifyEvent).toBeNull();
    expect(await deliverOntheffingNotifications(c.body.id)).toBe("nothing");
    expect(await retryPendingOntheffingNotifications()).toBe(0);
    expect(await prisma.notification.count({ where: { ontheffingId: c.body.id } })).toBe(2);
  });
});

describe("Behandeling: individueel en gezamenlijk, vrijgave, uitvoering", () => {
  it("volledige route: presidium → expliciete vrijgave → hoge raad → informeren → bekendmaken → verwerken → verwijderen na 30 dagen", async () => {
    const s = await setup();
    const id = await submitted(s);
    expect((await view(id, s.t.ha1)).status).toBe(403); // hoge raad ziet het nog niet

    expect((await vote(id, s.t.ha1, true)).status).toBe(403); // hoge raad heeft geen toegang tot de presidiumronde
    expect((await vote(id, s.t.president, true)).status).toBe(200);
    expect((await view(id, s.t.manager)).body.status).toBe("PRESIDIUM_VOTING");
    expect((await vote(id, s.t.counselor, true)).status).toBe(200);
    let v = (await view(id, s.t.manager)).body;
    expect(v).toMatchObject({ status: "PRESIDIUM_APPROVED", viewer: { canRelease: true } });
    // geen automatische doorstart: hoge raad nog geen deelnemers en geen toegang
    expect(await prisma.ontheffingVoter.count({ where: { stage: "HOGERAAD" } })).toBe(0);
    expect((await view(id, s.t.ha1)).status).toBe(403);
    expect((await release(id, s.t.ha1)).status).toBe(403); // alleen staf

    // pas na informeren buiten de app is een eerste stap mogelijk; hier eerst vrijgave
    expect((await release(id, s.t.manager)).body).toMatchObject({ released: true });
    expect((await release(id, s.t.manager)).body).toMatchObject({ released: false, alreadyReleased: true });
    expect(await prisma.ontheffingVoter.count({ where: { stage: "HOGERAAD" } })).toBe(3);
    expect(await prisma.notification.count({ where: { ontheffingId: id, type: "CONFIDENTIAL_HOGERAAD" } })).toBe(3); // geen dubbele meldingen
    expect((await view(id, s.t.ha1)).body).toMatchObject({ status: "HOGERAAD_VOTING", viewer: { staff: false, canVote: true } });
    // een hogeraadslid ziet geen koppelings- of uitvoeringsgegevens
    expect(JSON.stringify((await view(id, s.t.ha1)).body)).not.toMatch(/accountMode|execution|audit/);

    for (const who of ["ha1", "ha2"] as const) expect((await vote(id, s.t[who], true)).status).toBe(200);
    expect((await view(id, s.t.manager)).body.status).toBe("HOGERAAD_VOTING");
    expect((await vote(id, s.t.ha3, true)).body.status).toBe("APPROVED");
    v = (await view(id, s.t.manager)).body;
    const pid = v.persons[0].id as string;

    // volgorde: bekendmaking vóór informeren en verwerken vóór bekendmaking kan niet
    expect((await step(pid, "announce", s.t.manager)).status).toBe(400);
    expect((await step(pid, "process", s.t.manager)).status).toBe(400);
    expect((await step(pid, "inform", s.t.ha1)).status).toBe(403);
    expect((await step(pid, "inform", s.t.manager)).status).toBe(200);
    expect((await step(pid, "inform", s.t.manager)).status).toBe(200); // idempotent
    expect((await step(pid, "process", s.t.manager)).status).toBe(400);
    expect((await step(pid, "announce", s.t.manager, { thanked: true })).status).toBe(200);
    expect((await step(pid, "process", s.t.manager)).body).toMatchObject({ dossierProcessed: true });
    v = (await view(id, s.t.manager)).body;
    expect(v.status).toBe("PROCESSED");
    expect(v.persons[0].execution).toMatchObject({ informedAt: expect.any(String), announcedAt: expect.any(String), thankedAt: expect.any(String), processedAt: expect.any(String) });
    expect(v.audit.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(["SUBMITTED", "HOGERAAD_RELEASED", "PERSON_INFORMED", "PERSON_ANNOUNCED", "PERSON_PROCESSED", "PROCESSED"]));
    // audit bevat geen namen
    expect(JSON.stringify(v.audit)).not.toMatch(/Piet|Voorbeeld/);
    expect((await call("POST", `/ontheffingen/${id}/delete`, { token: s.t.manager, body: { confirmed: true } })).status).toBe(400); // verwerkt: automatisch

    // bewaartermijn: 30 dagen na verwerking
    expect(await deleteDueOntheffingen()).toBe(0);
    await prisma.ontheffing.update({ where: { id }, data: { processedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await deleteDueOntheffingen()).toBe(1);
    expect(await prisma.ontheffing.count()).toBe(0);
    expect(await prisma.ontheffingPerson.count()).toBe(0);
    expect(await prisma.notification.count({ where: { ontheffingId: id } })).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("een negatieve reactie pauzeert; een lege hoge raad keurt nooit goed en blokkeert de vrijgave", async () => {
    const s = await setup();
    const id = await submitted(s);
    await vote(id, s.t.president, true);
    expect((await vote(id, s.t.counselor, false)).body.status).toBe("PRESIDIUM_PAUSED");
    expect(await prisma.notification.count({ where: { ontheffingId: id, type: "CONFIDENTIAL_PAUSED" } })).toBe(2);
    expect((await vote(id, s.t.counselor, true)).body.status).toBe("PRESIDIUM_APPROVED");

    await prisma.ringMembership.updateMany({ where: { ringId: s.ring.id, role: "HOGERAAD" }, data: { active: false } });
    const r = await release(id, s.t.manager);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/geen actieve hogeraadsleden/);
    expect((await view(id, s.t.manager)).body.blockers).toHaveLength(1);
    expect((await prisma.ontheffing.findUniqueOrThrow({ where: { id } })).status).toBe("PRESIDIUM_APPROVED");
  });

  it("gezamenlijk besluit: presidium en hoge raad, zonder reacties namens anderen; presiderend lid verplicht; negatieve reactie vereist afhandeling", async () => {
    const s = await setup();
    const id = await submitted(s);
    const decide = (token: string, body: Record<string, unknown>) => call("POST", `/ontheffingen/${id}/group-decision`, { token, body });
    expect((await decide(s.t.ha1, { stage: "PRESIDIUM", decidedOn: today(), agreed: true })).status).toBe(403);
    expect((await decide(s.t.manager, { stage: "PRESIDIUM", decidedOn: today(), agreed: false })).status).toBe(400);
    expect((await decide(s.t.manager, { stage: "HOGERAAD", decidedOn: today(), agreed: true })).status).toBe(400); // verkeerde fase
    await vote(id, s.t.president, false);
    expect((await decide(s.t.manager, { stage: "PRESIDIUM", decidedOn: today(), agreed: true })).status).toBe(400); // negatieve reactie niet afgehandeld
    expect((await decide(s.t.manager, { stage: "PRESIDIUM", decidedOn: today(), agreed: true, resolveNegative: true, resolutionNote: "Besproken en alsnog akkoord in vergadering." })).body).toMatchObject({ status: "PRESIDIUM_APPROVED" });
    expect(await prisma.ontheffingVote.count()).toBe(1); // de negatieve reactie blijft staan; geen reacties aangemaakt
    expect((await decide(s.t.manager, { stage: "PRESIDIUM", decidedOn: today(), agreed: true })).body).toMatchObject({ alreadyRegistered: true });

    await release(id, s.t.manager);
    expect((await decide(s.t.manager, { stage: "HOGERAAD", decidedOn: today(), agreed: true, presentUserIds: [s.ha1.id] })).status).toBe(400); // presiderend lid ontbreekt
    expect((await decide(s.t.manager, { stage: "HOGERAAD", decidedOn: today(), agreed: true, presidingUserId: s.ha1.id, presentUserIds: [s.ha1.id] })).status).toBe(400); // geen presidiumlid
    expect((await decide(s.t.manager, { stage: "HOGERAAD", decidedOn: today(), agreed: true, presidingUserId: s.president.id, presentUserIds: [s.manager.id] })).status).toBe(400);
    const ok = await decide(s.t.manager, { stage: "HOGERAAD", decidedOn: today(), agreed: true, presidingUserId: s.president.id, presentUserIds: [s.ha1.id, s.ha2.id], absentUserIds: [s.ha3.id] });
    expect(ok.body).toMatchObject({ status: "APPROVED" });
    expect(await prisma.ontheffingVote.count()).toBe(1);
    expect(await prisma.ontheffingDecision.count()).toBe(2);
  });

  it("uitvoeringsstappen kunnen pas na presidiumakkoord; verwerken pas na besluit", async () => {
    const s = await setup();
    const id = await submitted(s);
    const pid = (await view(id, s.t.manager)).body.persons[0].id as string;
    expect((await step(pid, "inform", s.t.manager)).status).toBe(400); // presidium heeft nog niet besloten
    await vote(id, s.t.president, true);
    await vote(id, s.t.counselor, true);
    expect((await step(pid, "inform", s.t.manager)).status).toBe(200); // informeren kan vóór de vrijgave aan de hoge raad
    expect((await step(pid, "announce", s.t.manager)).status).toBe(400); // bekendmaken pas na het definitieve besluit
    expect((await step(pid, "process", s.t.manager)).status).toBe(400);
  });
});

describe("Robuustheid van de rondes", () => {
  it("gelijktijdige vrijgave geeft één overgang en één set meldingen", async () => {
    const s = await setup();
    const id = await submitted(s);
    await vote(id, s.t.president, true);
    await vote(id, s.t.counselor, true);
    const results = await Promise.all([release(id, s.t.manager), release(id, s.t.manager), release(id, s.t.manager)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.released)).toHaveLength(1);
    expect(await prisma.ontheffingVoter.count({ where: { stage: "HOGERAAD" } })).toBe(3);
    expect(await prisma.notification.count({ where: { ontheffingId: id, type: "CONFIDENTIAL_HOGERAAD" } })).toBe(3);
  });

  it("een gedeactiveerd hogeraadslid blokkeert de ronde niet; nieuwe stemmen van niet-deelnemers worden geweigerd", async () => {
    const s = await setup();
    const id = await submitted(s);
    await vote(id, s.t.president, true);
    await vote(id, s.t.counselor, true);
    await release(id, s.t.manager);
    await vote(id, s.t.ha1, true);
    await vote(id, s.t.ha2, true);
    await prisma.ringMembership.updateMany({ where: { userId: s.ha3.id }, data: { active: false } });
    expect((await vote(id, s.t.ha3, true)).status).toBe(403);
    expect((await vote(id, s.t.ha2, true)).body.status).toBe("APPROVED"); // herberekening telt alleen nog actieve deelnemers
    const late = await createTestUser("HOGERAAD", "Laat Lid", { ringId: s.ring.id });
    expect((await vote(id, await login(late.id), true)).status).toBe(403);
  });

  it("een betrokken lid kan geen presiderend of aanwezig lid van het gezamenlijk besluit zijn", async () => {
    const s = await setup();
    const id = await submitted(s, { functionCode: "hogeraadslid", persons: [main("Hogeraad A", { accountMode: "GEKOPPELD", userId: s.ha1.id })] });
    const decide = (body: Record<string, unknown>) => call("POST", `/ontheffingen/${id}/group-decision`, { token: s.t.manager, body });
    await vote(id, s.t.president, true);
    await vote(id, s.t.counselor, true);
    await release(id, s.t.manager);
    expect((await decide({ stage: "HOGERAAD", decidedOn: today(), agreed: true, presidingUserId: s.president.id, presentUserIds: [s.ha1.id] })).status).toBe(400);
    expect((await decide({ stage: "HOGERAAD", decidedOn: today(), agreed: true, presidingUserId: s.president.id, presentUserIds: [s.ha2.id, s.ha3.id] })).body.status).toBe("APPROVED");
  });
});

describe("Vertrouwelijkheid van de betrokkene", () => {
  it("een gekoppeld hogeraadslid kan het dossier nergens ontdekken: dossier, lijst, aantallen, melding, stem, deeplink en API-antwoord", async () => {
    const s = await setup();
    const id = await submitted(s, { functionCode: "hogeraadslid", persons: [main("Hogeraad A", { accountMode: "GEKOPPELD", userId: s.ha1.id })] });
    await vote(id, s.t.president, true);
    await vote(id, s.t.counselor, true);
    await release(id, s.t.manager);

    // uitgesloten van de ronde; de anderen doen mee
    expect((await prisma.ontheffingVoter.findMany({ where: { ontheffingId: id, stage: "HOGERAAD" } })).map((v) => v.userId).sort()).toEqual([s.ha2.id, s.ha3.id].sort());
    expect(await prisma.notification.count({ where: { userId: s.ha1.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: s.ha2.id, ontheffingId: id } })).toBe(1);

    // detail: identiek antwoord als bij een niet-bestaand dossier
    const mine = await view(id, s.t.ha1);
    expect(mine.status).toBe(403);
    expect(mine.body).toEqual((await view("onbestaand123456", s.t.ha1)).body);
    // lijst, aantallen, dashboard, app-badge
    expect((await call("GET", `/ontheffingen?ring=${s.ring.id}`, { token: s.t.ha1 })).body.ontheffingen).toEqual([]);
    expect((await call("GET", `/ontheffingen?ring=${s.ring.id}`, { token: s.t.ha2 })).body.ontheffingen).toHaveLength(1);
    expect(await ontheffingCounts(s.ha1.id, s.ring.id)).toEqual({ needsMyVote: 0, open: 0 });
    expect(await ontheffingCounts(s.ha2.id, s.ring.id)).toEqual({ needsMyVote: 1, open: 1 });
    expect((await call("GET", `/dashboard?ring=${s.ring.id}`, { token: s.t.ha1 })).body.ontheffingen).toEqual({ needsMyVote: 0, open: 0 });
    expect(await getPendingActionCount(s.ha1.id)).toBe(0);
    expect(await getPendingActionCount(s.ha2.id)).toBeGreaterThan(0);
    expect((await call("GET", `/notifications?ring=${s.ring.id}`, { token: s.t.ha1 })).body.notifications ?? []).toHaveLength(0);
    // stemmen, vrijgave, uitvoering en verwijderen: geweigerd, zonder bestaan te onthullen
    expect((await vote(id, s.t.ha1, true)).status).toBe(403);
    expect((await release(id, s.t.ha1)).status).toBe(403);
    expect((await call("POST", `/ontheffingen/${id}/delete`, { token: s.t.ha1, body: { confirmed: true } })).status).toBe(403);
    expect(await prisma.ontheffing.count()).toBe(1);
    // ook een per ongeluk meegegeven ontvanger krijgt nooit een melding (centrale bescherming in notify)
    await notify({ userIds: [s.ha1.id, s.ha2.id], ringId: s.ring.id, ontheffingId: id, event: "CONFIDENTIAL_HOGERAAD", url: `/ontheffingen/${id}` });
    expect(await prisma.notification.count({ where: { userId: s.ha1.id } })).toBe(0);

    // na de hogeraadsbehandeling en na persoonlijke kennisgeving blijft de uitsluiting gelden (open vraag voor de eigenaar)
    await vote(id, s.t.ha2, true);
    await vote(id, s.t.ha3, true);
    const pid = (await view(id, s.t.manager)).body.persons[0].id as string;
    expect((await step(pid, "inform", s.t.manager)).status).toBe(200);
    expect((await view(id, s.t.ha1)).status).toBe(403);
    expect((await prisma.ontheffingVote.count({ where: { userId: s.ha1.id } }))).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("de koppeling gaat nooit op naam: een gebruiker met dezelfde naam als de betrokkene wordt niet uitgesloten", async () => {
    const s = await setup();
    const id = await submitted(s, { functionCode: "hogeraadslid", persons: [main(s.ha1.name, { accountMode: "GEEN_ACCOUNT" })] });
    await vote(id, s.t.president, true);
    await vote(id, s.t.counselor, true);
    await release(id, s.t.manager);
    expect(await prisma.ontheffingVoter.count({ where: { ontheffingId: id, stage: "HOGERAAD" } })).toBe(3);
    expect((await view(id, s.t.ha1)).status).toBe(200); // geen automatische koppeling: de staf heeft expliciet 'geen account' verklaard
    expect(await prisma.ontheffingPerson.count({ where: { userId: { not: null } } })).toBe(0);
  });

  it("een betrokken ringpresident wordt uitgesloten van de presidiumronde en ziet het dossier niet; het concept zag hij ook niet", async () => {
    const s = await setup();
    const c = await concept(s, full(s, { functionCode: "hogeraadslid" }), s.t.manager);
    expect((await view(c.body.id, s.t.president)).status).toBe(403); // concept: alleen de aanmaker, dus ook vóór de koppeling niet
    await call("POST", `/ontheffingen/${c.body.id}`, { token: s.t.manager, body: { persons: [main("President X", { accountMode: "GEKOPPELD", userId: s.president.id })] } });
    expect((await submit(c.body.id, s.t.manager)).status).toBe(200);
    expect((await prisma.ontheffingVoter.findMany({ where: { ontheffingId: c.body.id } })).map((v) => v.userId)).toEqual([s.counselor.id]);
    expect((await view(c.body.id, s.t.president)).status).toBe(403);
    expect((await vote(c.body.id, s.t.president, true)).status).toBe(403);
    expect((await vote(c.body.id, s.t.counselor, true)).body.status).toBe("PRESIDIUM_APPROVED");
    expect(await prisma.notification.count({ where: { userId: s.president.id } })).toBe(0);
  });

  it("de tijdelijke koppeling verdwijnt met het dossier (verwijderen en opruimen); concepten verlopen na 30 dagen", async () => {
    const s = await setup();
    const a = await submitted(s, { persons: [main("Een Betrokkene", { accountMode: "GEKOPPELD", userId: s.ha1.id })] });
    expect(await prisma.ontheffingPerson.count({ where: { userId: s.ha1.id } })).toBe(1);
    expect((await call("POST", `/ontheffingen/${a}/delete`, { token: s.t.manager, body: { confirmed: true } })).status).toBe(200);
    expect(await prisma.ontheffingPerson.count()).toBe(0);
    const c = await concept(s, full(s));
    await prisma.ontheffing.update({ where: { id: c.body.id }, data: { updatedAt: new Date(Date.now() - 31 * 86_400_000) } });
    expect(await deleteDueOntheffingen()).toBe(1);
    expect(await prisma.ontheffing.count()).toBe(0);
  });

  it("isolatie tussen ringen: staf, hogeraadsleden en de webmin van een andere ring of zonder lidmaatschap hebben geen toegang", async () => {
    const s = await setup();
    const id = await submitted(s);
    const other = await createTestRing("Buitenring");
    const stranger = await createTestUser("RINGPRESIDIUM", "Vreemd Presidium", { ringId: other.id });
    const tok = await login(stranger.id);
    expect((await view(id, tok)).status).toBe(403);
    expect((await vote(id, tok, true)).status).toBe(403);
    expect((await call("GET", `/ontheffingen?ring=${s.ring.id}`, { token: tok })).status).toBe(403);
    const admin = await createTestUser("ADMIN", "Webmin 2");
    expect((await view(id, await login(admin.id))).status).toBe(403);
    expect((await call("GET", "/ontheffingen")).status).toBe(401);
    // een gedeactiveerd lid verliest toegang
    await prisma.ringMembership.updateMany({ where: { userId: s.counselor.id }, data: { active: false } });
    expect((await view(id, s.t.counselor)).status).toBe(403);
  });
});

describe("Gezamenlijke ontheffing (president(e) en raadgevers)", () => {
  const PRES = "zhv-presidente";
  const RG1 = "eerste-raadgeefster-zhv-presidium-ring";
  const RG2 = "tweede-raadgeefster-zhv-presidium-ring";
  const body = (s: S, persons: Record<string, unknown>[]) => full(s, { functionCode: PRES, persons });
  const ok = { role: "RAADGEVER", followUpCode: RG1, answer: "NAAM", name: "Eerste Raadgeefster", accountMode: "GEEN_ACCOUNT" };
  const na = { role: "RAADGEVER", followUpCode: RG2, answer: "NIET_VAN_TOEPASSING", naReason: "Functie is al vacant." };

  it("vraagt verplicht naar de raadgevers; per raadgever 'Naam invullen' of 'Niet van toepassing' met optionele reden", async () => {
    const s = await setup();
    const c = await concept(s, body(s, [main("Presidente Voorbeeld")]));
    expect(c.status).toBe(200);
    const v = (await view(c.body.id, s.t.manager)).body;
    expect(v).toMatchObject({ joint: true, followUps: [{ code: RG1 }, { code: RG2 }] });
    expect(v.persons.filter((p: { role: string }) => p.role === "RAADGEVER").map((p: { answer: string }) => p.answer)).toEqual(["OPEN", "OPEN"]);
    // onbeantwoord → niet in te dienen
    const r = await submit(c.body.id, s.t.manager);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Beantwoord de vraag/);
    // naam zonder naam → fout; n.v.t. zonder reden mag
    await call("POST", `/ontheffingen/${c.body.id}`, { token: s.t.manager, body: { persons: [{ ...ok, name: null }, { ...na, naReason: null }] } });
    expect((await submit(c.body.id, s.t.manager)).body.error).toMatch(/Vul de naam van de/);
    await call("POST", `/ontheffingen/${c.body.id}`, { token: s.t.manager, body: { persons: [ok, na] } });
    expect((await submit(c.body.id, s.t.manager)).status).toBe(200);
    const after = (await view(c.body.id, s.t.manager)).body;
    expect(after.persons.find((p: { followUpCode: string }) => p.followUpCode === RG2)).toMatchObject({ answer: "NIET_VAN_TOEPASSING", naReason: "Functie is al vacant.", name: null });
  });

  it("een raadgever zonder persoon heeft geen account en geen uitvoeringsstatus; een functie zonder vervolgvragen kent die niet", async () => {
    const s = await setup();
    const c = await concept(s, body(s, [main("Presidente Voorbeeld"), { ...na, accountMode: "GEKOPPELD", userId: s.ha1.id }, ok]));
    expect(c.status).toBe(200);
    await submit(c.body.id, s.t.manager);
    const rows = await prisma.ontheffingPerson.findMany({ where: { ontheffingId: c.body.id, role: "RAADGEVER" } });
    expect(rows.find((r) => r.followUpCode === RG2)).toMatchObject({ userId: null, accountMode: "ONBEKEND", name: null });
    const plain = await concept(s, full(s));
    expect((await view(plain.body.id, s.t.manager)).body).toMatchObject({ joint: false, followUps: [] });
    expect(await prisma.ontheffingPerson.count({ where: { ontheffingId: plain.body.id, role: "RAADGEVER" } })).toBe(0);
  });

  it("één besluit voor het hele dossier (geen afzonderlijke goedkeuringen) en een afzonderlijke uitvoeringsstatus per persoon", async () => {
    const s = await setup();
    const c = await concept(s, body(s, [main("Presidente Voorbeeld"), ok, na]));
    await submit(c.body.id, s.t.manager);
    await approveFully(s, c.body.id);
    expect(await prisma.ontheffingVote.count({ where: { stage: "PRESIDIUM" } })).toBe(2); // presidiumleden, niet per betrokkene
    expect(await prisma.ontheffingVote.count({ where: { stage: "HOGERAAD" } })).toBe(3);
    expect(await prisma.ontheffingDecision.count()).toBe(0);
    const v = (await view(c.body.id, s.t.manager)).body;
    expect(v.status).toBe("APPROVED");
    const [head, adv, naPerson] = [v.persons.find((p: { role: string }) => p.role === "HOOFD"), v.persons.find((p: { followUpCode: string }) => p.followUpCode === RG1), v.persons.find((p: { followUpCode: string }) => p.followUpCode === RG2)];
    expect(naPerson.execution).toBeNull();
    expect((await step(naPerson.id, "inform", s.t.manager)).status).toBe(400); // niet van toepassing: niets te informeren

    // hoofdpersoon volledig afgerond, raadgever nog niet → dossier nog niet verwerkt
    for (const st of ["inform", "announce"]) expect((await step(head.id, st, s.t.manager)).status).toBe(200);
    expect((await step(head.id, "process", s.t.manager)).body).toMatchObject({ dossierProcessed: false });
    let w = (await view(c.body.id, s.t.manager)).body;
    expect(w.status).toBe("APPROVED");
    expect(w.persons.find((p: { id: string }) => p.id === head.id).execution.processedAt).toEqual(expect.any(String));
    expect(w.persons.find((p: { id: string }) => p.id === adv.id).execution).toMatchObject({ informedAt: null, processedAt: null });
    for (const st of ["inform", "announce"]) expect((await step(adv.id, st, s.t.manager)).status).toBe(200);
    expect((await step(adv.id, "process", s.t.manager)).body).toMatchObject({ dossierProcessed: true });
    w = (await view(c.body.id, s.t.manager)).body;
    expect(w.status).toBe("PROCESSED");
  });

  it("een gekoppelde raadgever is ook onzichtbaar en uitgesloten van de rondes", async () => {
    const s = await setup();
    const c = await concept(s, body(s, [main("Presidente Voorbeeld"), { ...ok, accountMode: "GEKOPPELD", userId: s.ha2.id }, na]));
    await submit(c.body.id, s.t.manager);
    await approveFully(s, c.body.id, ["ha1", "ha3"]);
    expect((await prisma.ontheffing.findUniqueOrThrow({ where: { id: c.body.id } })).status).toBe("APPROVED");
    expect((await view(c.body.id, s.t.ha2)).status).toBe(403);
    expect(await prisma.notification.count({ where: { userId: s.ha2.id } })).toBe(0);
  });
});

describe("API-contract ontheffingen (gedeelde types)", () => {
  it("de antwoorden van de server voldoen aan shared/api-types.ts", async () => {
    const s = await setup();
    const id = await submitted(s);
    const list = (await call("GET", `/ontheffingen?ring=${s.ring.id}`, { token: s.t.manager })).body.ontheffingen as OntheffingListItem[];
    expect(list[0]).toMatchObject({ id, status: "PRESIDIUM_VOTING", joint: false, needsMyVote: false });
    const staff = (await view(id, s.t.manager)).body as OntheffingView;
    expect(staff.viewer.staff).toBe(true);
    expect(staff.rounds?.presidium.eligible).toBe(2);
    expect(staff.persons[0]).toMatchObject({ role: "HOOFD", answer: "NAAM", accountMode: "GEEN_ACCOUNT" });
    const voter = (await view(id, s.t.president)).body as OntheffingView;
    expect(voter.viewer).toMatchObject({ staff: true, canVote: true });
    const dash = (await call("GET", `/dashboard?ring=${s.ring.id}`, { token: s.t.president })).body as Dashboard;
    expect(dash.ontheffingen).toEqual({ needsMyVote: 1, open: 1 });
    const notes = (await call("GET", `/notifications?ring=${s.ring.id}`, { token: s.t.president })).body.notifications as AppNotification[];
    expect(notes[0]).toMatchObject({ ontheffingId: id, callingId: null, type: "CONFIDENTIAL_PROPOSAL" });
  });
});
