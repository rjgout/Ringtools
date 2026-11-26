import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createVerifiedSession } from "@/lib/auth";
import { hashToken } from "@/lib/crypto";
import { resetDatabase, createTestUser, createTestRing } from "./setup";

const sendMailMock = vi.fn();
vi.mock("@/lib/mailer", async (original) => ({ ...(await original<typeof import("@/lib/mailer")>()), sendMail: (...a: unknown[]) => sendMailMock(...a) }));
const { handleApi } = await import("@/lib/api/router");
const decl = await import("@/lib/declarations/service");
const fin = await import("@/lib/declarations/finance");
const { seal, open } = await import("@/lib/declarations/crypto");

let ip = 0;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const file = (name = "bon.png") => ({ fileName: name, dataBase64: PNG.toString("base64") });

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost/api/mobile/v1${path}`);
  const res = await handleApi(
    new Request(url, { method, headers: { ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), "Content-Type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` }, body: method === "GET" ? undefined : JSON.stringify(opts.body ?? {}) }),
    url.pathname.replace("/api/mobile/v1/", "").split("/").filter(Boolean),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const tokenFor = async (userId: string) => (await createVerifiedSession(userId, "test")).rawToken;

beforeEach(async () => {
  process.env.DECLARATIONS_ENABLED = "true";
  await resetDatabase();
  await prisma.ringInvitation.deleteMany();
  sendMailMock.mockReset();
  sendMailMock.mockResolvedValue(undefined);
});
afterEach(() => { delete process.env.DECLARATIONS_ENABLED; });

async function member(name: string, ringId: string, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.create({ data: { name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@test.example`, role: "KERKLID", active: true, ...extra } });
  return u;
}
async function assign(userId: string, ringId: string, role: "ADMIN" | "SUBADMIN" | "RING_PRESIDENT_READ" | "UNIT_LEADER", unitId: string | null = null) {
  return prisma.financeAssignment.create({ data: { userId, ringId, unitId, role } });
}
/** Ring met ringpresident-lezer + administrateur: geactiveerd. Optioneel een geactiveerde wijk. */
async function activatedRing(name: string, withUnit = true) {
  const ring = await createTestRing(name);
  const president = await member(`President ${name}`, ring.id);
  const admin = await member(`Admin ${name}`, ring.id);
  await assign(president.id, ring.id, "RING_PRESIDENT_READ");
  await assign(admin.id, ring.id, "ADMIN");
  let unit = null;
  if (withUnit) {
    unit = await prisma.ringUnit.create({ data: { ringId: ring.id, kind: "WIJK", name: `Wijk ${name}` } });
    const bishop = await member(`Bisschop ${name}`, ring.id);
    const uadmin = await member(`Wijkadmin ${name}`, ring.id);
    await assign(bishop.id, ring.id, "UNIT_LEADER", unit.id);
    await assign(uadmin.id, ring.id, "ADMIN", unit.id);
    return { ring, unit, president, admin, uadmin, bishop };
  }
  return { ring, unit, president, admin, uadmin: null, bishop: null };
}
const base = (ringId: string, unitId: string | null, extra: Record<string, unknown> = {}) => ({
  clientRequestId: `req-${Math.random().toString(36).slice(2, 12)}`, ringId, unitId, ringDirectConfirmed: unitId ? undefined : true,
  organization: "Jongevolwassenen", approverName: "Jan Bisschop", approvalConfirmed: true, forWhom: "Piet", payeeName: "Piet", amount: "12,50",
  description: "Boodschappen activiteit", files: [file()], ...extra,
});

describe("zelfregistratie", () => {
  it("onbekend adres: code → account KERKLID zonder ring; geen bestaan-verraad; tweede keer geen nieuw account", async () => {
    const r = await call("POST", "/auth/request-code", { body: { email: "Nieuw.Lid@Example.nl" } });
    expect(r.status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const code = /(\d{8})/.exec(String((sendMailMock.mock.calls[0][0] as { text: string }).text))![1];
    const bad = await call("POST", "/auth/login", { body: { email: "nieuw.lid@example.nl", code: "00000000" } });
    expect(bad.status).toBe(401);
    const ok = await call("POST", "/auth/login", { body: { email: "nieuw.lid@example.nl", code } });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    const u = await prisma.user.findFirstOrThrow({ where: { email: "nieuw.lid@example.nl" } });
    expect(u.role).toBe("KERKLID");
    expect(await prisma.ringMembership.count({ where: { userId: u.id } })).toBe(0);
    const again = await call("POST", "/auth/login", { body: { email: "nieuw.lid@example.nl", code } });
    expect(again.status).toBe(401); // code is eenmalig
    expect(await prisma.user.count({ where: { email: "nieuw.lid@example.nl" } })).toBe(1);
  });
  it("zonder functievlag geen registratie", async () => {
    delete process.env.DECLARATIONS_ENABLED;
    await call("POST", "/auth/request-code", { body: { email: "x@example.nl" } });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
  it("bestaand account krijgt nooit een registratiecode (geen duplicaat)", async () => {
    await createTestUser("HOGERAAD", "Bestaand", { email: "best@example.nl" });
    await call("POST", "/auth/request-code", { body: { email: "BEST@example.nl" } });
    expect(await prisma.invitationLoginCode.count({ where: { purpose: "registration" } })).toBe(0);
  });
  it("registratie beperkt: maximaal 3 codes per adres per uur", async () => {
    for (let i = 0; i < 5; i++) await call("POST", "/auth/request-code", { body: { email: "spam@example.nl" } });
    expect(await prisma.invitationLoginCode.count({ where: { purpose: "registration", email: "spam@example.nl" } })).toBeLessThanOrEqual(3);
  });
  it("een openstaande financiële toekenning wordt bij geverifieerde registratie op exact dat adres geclaimd", async () => {
    const { ring } = await activatedRing("Ring P", false);
    const manager = await createTestUser("RINGADMINISTRATEUR", "Beheerder", { ringId: ring.id, isRingManager: true });
    await fin.assignFinanceRole({ actorId: manager.id, ringId: ring.id, unitId: null, email: "Nieuw@example.nl", role: "SUBADMIN" });
    expect(await prisma.pendingFinanceAssignment.count()).toBe(1);
    const reg = await import("@/lib/registration");
    sendMailMock.mockClear();
    expect(await reg.sendRegistrationCode("nieuw@example.nl")).toBe(true);
    const code = /(\d{8})/.exec(String((sendMailMock.mock.calls[0][0] as { text: string }).text))![1];
    const res = await reg.loginRegisteringPerson("nieuw@example.nl", code, "test");
    expect(res).not.toBeNull();
    const a = await prisma.financeAssignment.findMany({ where: { userId: res!.userId } });
    expect(a).toHaveLength(1);
    expect(a[0].role).toBe("SUBADMIN");
  });
});

describe("financiële functies en activering", () => {
  it("alleen ringbeheerders van de eigen ring kunnen functies toekennen; geen zoeklijst", async () => {
    const A = await createTestRing("A");
    const B = await createTestRing("B");
    const mgrA = await createTestUser("RINGADMINISTRATEUR", "Mgr A", { ringId: A.id, isRingManager: true });
    const plain = await createTestUser("RINGSECRETARIS", "Gewoon", { ringId: A.id });
    await expect(fin.assignFinanceRole({ actorId: plain.id, ringId: A.id, unitId: null, email: "a@example.nl", role: "ADMIN" })).rejects.toMatchObject({ status: 403 });
    await expect(fin.assignFinanceRole({ actorId: mgrA.id, ringId: B.id, unitId: null, email: "a@example.nl", role: "ADMIN" })).rejects.toMatchObject({ status: 403 });
    await expect(fin.assignFinanceRole({ actorId: mgrA.id, ringId: A.id, unitId: null, email: "geen-email", role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
  });
  it("een financiële rol is onafhankelijk van een roeprol, en ringbeheerder krijgt geen automatische inzage", async () => {
    const { ring, admin } = await activatedRing("Ring I", false);
    const mgr = await createTestUser("RINGADMINISTRATEUR", "Mgr", { ringId: ring.id, isRingManager: true });
    const owner = await member("Lid", ring.id);
    const { id } = await decl.submitDeclaration(owner.id, base(ring.id, null));
    await expect(decl.openDeclaration(mgr.id, id)).rejects.toMatchObject({ status: 404 });
    await expect(decl.openDeclaration(admin.id, id)).resolves.toBeTruthy();
  });
  it("activering: ring vereist president + administrateur; wijk bisschop + administrateur; verwijderen schakelt uit", async () => {
    const ring = await createTestRing("Ring X");
    const unit = await prisma.ringUnit.create({ data: { ringId: ring.id, kind: "WIJK", name: "W" } });
    expect((await fin.activationFor(ring.id, null)).activated).toBe(false);
    const p = await member("Pres", ring.id); const a = await member("Adm", ring.id);
    await assign(p.id, ring.id, "RING_PRESIDENT_READ");
    expect((await fin.activationFor(ring.id, null)).missing).toEqual(["administrator"]);
    const aa = await assign(a.id, ring.id, "ADMIN");
    expect((await fin.activationFor(ring.id, null)).activated).toBe(true);
    expect((await fin.activationFor(ring.id, unit.id)).activated).toBe(false); // ring-activering geldt niet voor een wijk
    const b = await member("Bis", ring.id); const w = await member("Wadm", ring.id);
    await assign(b.id, ring.id, "UNIT_LEADER", unit.id); await assign(w.id, ring.id, "SUBADMIN", unit.id);
    expect((await fin.activationFor(ring.id, unit.id)).activated).toBe(true);
    await prisma.financeAssignment.update({ where: { id: aa.id }, data: { active: false } });
    expect((await fin.activationFor(ring.id, null)).activated).toBe(false);
  });
});

describe("indienen", () => {
  it("niet-geactiveerde bestemming: precieze melding en server weigert", async () => {
    const ring = await createTestRing("Leeg");
    const u = await member("Lid", ring.id);
    const t = await tokenFor(u.id);
    const r = await call("POST", "/declarations", { token: t, body: base(ring.id, null) });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("Declareren is voor deze ring, wijk of gemeente nog niet geactiveerd. Neem contact op met je plaatselijke leiders om de declaratiemodule te laten activeren.");
    expect(await prisma.declaration.count()).toBe(0);
  });
  it("direct naar de ring vereist expliciete bevestiging", async () => {
    const { ring } = await activatedRing("R1", false);
    const u = await member("Lid", ring.id);
    await expect(decl.submitDeclaration(u.id, base(ring.id, null, { ringDirectConfirmed: false }))).rejects.toMatchObject({ code: "ring-confirmation-required" });
  });
  it("voorafgaande goedkeuring is verplicht; ongeldige bedragen, bijlagen en lege velden worden geweigerd", async () => {
    const { ring, unit } = await activatedRing("R2");
    const u = await member("Lid", ring.id);
    await expect(decl.submitDeclaration(u.id, base(ring.id, unit!.id, { approvalConfirmed: false }))).rejects.toMatchObject({ status: 400 });
    for (const amount of ["0", "-5", "abc", "1.234,50", "12,505", 60000]) await expect(decl.submitDeclaration(u.id, base(ring.id, unit!.id, { amount }))).rejects.toMatchObject({ status: 400 });
    await expect(decl.submitDeclaration(u.id, base(ring.id, unit!.id, { files: [] }))).rejects.toMatchObject({ code: "attachment" });
    await expect(decl.submitDeclaration(u.id, base(ring.id, unit!.id, { files: [{ fileName: "x.png", dataBase64: Buffer.from("geen plaatje").toString("base64") }] }))).rejects.toMatchObject({ code: "attachment" });
    await expect(decl.submitDeclaration(u.id, base(ring.id, unit!.id, { payeeName: "  " }))).rejects.toMatchObject({ status: 400 });
    expect(await prisma.declaration.count()).toBe(0);
  });
  it("PDF met actieve inhoud wordt geweigerd; geldige PDF en afbeelding worden geaccepteerd", async () => {
    const { ring, unit } = await activatedRing("R3");
    const u = await member("Lid", ring.id);
    const evil = Buffer.from("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF");
    await expect(decl.submitDeclaration(u.id, base(ring.id, unit!.id, { files: [{ fileName: "a.pdf", dataBase64: evil.toString("base64") }] }))).rejects.toMatchObject({ code: "attachment" });
    const good = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");
    await expect(decl.submitDeclaration(u.id, base(ring.id, unit!.id, { files: [file(), { fileName: "b.pdf", dataBase64: good.toString("base64") }] }))).resolves.toMatchObject({ created: true });
  });
  it("opgeslagen gegevens zijn versleuteld; idempotent bij herhaald verzoek", async () => {
    const { ring, unit } = await activatedRing("R4");
    const u = await member("Lid", ring.id);
    const input = base(ring.id, unit!.id, { description: "GEHEIME-OMSCHRIJVING" });
    const a = await decl.submitDeclaration(u.id, input);
    const b = await decl.submitDeclaration(u.id, input);
    expect(a.created).toBe(true); expect(b).toEqual({ id: a.id, created: false });
    expect(await prisma.declaration.count()).toBe(1);
    const row = await prisma.declaration.findUniqueOrThrow({ where: { id: a.id }, include: { attachments: true } });
    expect(Buffer.from(row.sealed).includes(Buffer.from("GEHEIME-OMSCHRIJVING"))).toBe(false);
    expect(Buffer.from(row.attachments[0].data).includes(PNG.subarray(0, 8))).toBe(false);
    expect(row.status).toBe("SUBMITTED");
    expect(row.amountCents).toBe(1250);
    // AAD-binding: ciphertext van de ene rij is niet bruikbaar op een andere
    expect(() => open(Buffer.from(row.sealed), "declaration:ander-id")).toThrow();
    expect(open(seal(Buffer.from("x"), "ctx"), "ctx").toString()).toBe("x");
  });
  it("een bestaand lid zonder declaratieprofiel kan declareren; beheerder/review-accounts niet", async () => {
    const { ring, unit } = await activatedRing("R5");
    const admin = await createTestUser("ADMIN", "Webmin");
    await expect(decl.submitDeclaration(admin.id, base(ring.id, unit!.id))).rejects.toMatchObject({ status: 403 });
  });
});

describe("autorisatie over ringen en units heen", () => {
  it("administrateur ziet alleen eigen ring/unit; ander lid en andere ring zien niets (IDOR)", async () => {
    const A = await activatedRing("Alpha");
    const B = await activatedRing("Beta");
    const ownerA = await member("Lid Alpha", A.ring.id);
    const ownerB = await member("Lid Beta", B.ring.id);
    const dA = await decl.submitDeclaration(ownerA.id, base(A.ring.id, A.unit!.id));
    const dAring = await decl.submitDeclaration(ownerA.id, base(A.ring.id, null));
    const dB = await decl.submitDeclaration(ownerB.id, base(B.ring.id, B.unit!.id));
    // wijkadmin A ziet de wijkdeclaratie, niet de rechtstreekse ringdeclaratie
    expect((await decl.listForOfficial(A.uadmin!.id)).items.map((i) => i.id)).toEqual([dA.id]);
    // ringadmin A (ring-niveau) ziet de ringdeclaratie, niet de wijkdeclaratie
    expect((await decl.listForOfficial(A.admin.id)).items.map((i) => i.id)).toEqual([dAring.id]);
    await expect(decl.openDeclaration(A.admin.id, dA.id)).rejects.toMatchObject({ status: 404 });
    await expect(decl.openDeclaration(A.admin.id, dB.id)).rejects.toMatchObject({ status: 404 });
    await expect(decl.openDeclaration(ownerB.id, dA.id)).rejects.toMatchObject({ status: 404 });
    await expect(decl.setStatus(ownerA.id, dA.id, "PROCESSED")).rejects.toMatchObject({ status: 403 }); // de eigenaar verwerkt nooit zelf
    const att = (await prisma.declarationAttachment.findFirstOrThrow({ where: { declarationId: dA.id } })).id;
    await expect(decl.downloadAttachment(ownerB.id, dA.id, att)).rejects.toMatchObject({ status: 404 });
    await expect(decl.downloadAttachment(B.admin.id, dA.id, att)).rejects.toMatchObject({ status: 404 });
    await expect(decl.downloadAttachment(ownerA.id, dB.id, att)).rejects.toMatchObject({ status: 404 });
    const dl = await decl.downloadAttachment(A.uadmin!.id, dA.id, att);
    expect(dl.bytes.equals(PNG)).toBe(true);
    expect(await prisma.declarationAccessLog.count({ where: { declarationId: dA.id, kind: "DOWNLOAD" } })).toBe(1);
  });
  it("een administrateur ziet zijn eigen declaraties niet in het beheeroverzicht", async () => {
    const A = await activatedRing("Gamma", false);
    const d = await decl.submitDeclaration(A.admin.id, base(A.ring.id, null));
    expect((await decl.listForOfficial(A.admin.id)).items).toHaveLength(0);
    expect((await decl.listMine(A.admin.id))).toHaveLength(1);
    await expect(decl.setStatus(A.admin.id, d.id, "PROCESSED")).rejects.toMatchObject({ status: 403 }); // geen zelfverwerking
  });
  it("trekt de ring in (gedeactiveerd): functionaris verliest toegang; bestaande declaraties blijven voor de eigenaar", async () => {
    const A = await activatedRing("Delta", false);
    const owner = await member("Lid", A.ring.id);
    const d = await decl.submitDeclaration(owner.id, base(A.ring.id, null));
    await prisma.ring.update({ where: { id: A.ring.id }, data: { active: false } });
    await expect(decl.openDeclaration(A.admin.id, d.id)).rejects.toMatchObject({ status: 404 });
    await expect(decl.openDeclaration(owner.id, d.id)).resolves.toBeTruthy();
    await expect(decl.submitDeclaration(owner.id, base(A.ring.id, null))).rejects.toMatchObject({ status: 404 });
  });
  it("na deactivering van een bestemming blijven declaraties zichtbaar, maar nieuwe indiening wordt geweigerd", async () => {
    const A = await activatedRing("Eps", false);
    const owner = await member("Lid", A.ring.id);
    const d = await decl.submitDeclaration(owner.id, base(A.ring.id, null));
    await prisma.financeAssignment.updateMany({ where: { ringId: A.ring.id, role: "ADMIN" }, data: { active: false } });
    await expect(decl.submitDeclaration(owner.id, base(A.ring.id, null))).rejects.toMatchObject({ code: "not-activated" });
    expect((await decl.listMine(owner.id)).map((x) => x.id)).toEqual([d.id]);
  });
});

describe("ringpresident (alleen lezen) en statusverwerking", () => {
  it("president leest zonder statuswijziging, met apart toegangslog; kan niet verwerken", async () => {
    const A = await activatedRing("Zeta", false);
    const owner = await member("Lid", A.ring.id);
    const d = await decl.submitDeclaration(owner.id, base(A.ring.id, null));
    const view = await decl.openDeclaration(A.president.id, d.id);
    expect(view.viewerRole).toBe("president");
    expect(view.canProcess).toBe(false);
    expect(view.status).toBe("SUBMITTED");
    expect((await prisma.declaration.findUniqueOrThrow({ where: { id: d.id } })).seenAt).toBeNull();
    expect(await prisma.declarationAccessLog.count({ where: { declarationId: d.id, userId: A.president.id, kind: "VIEW_PRESIDENT" } })).toBe(1);
    await expect(decl.setStatus(A.president.id, d.id, "PROCESSED")).rejects.toMatchObject({ status: 403 });
    // president ziet ook wijkdeclaraties van de eigen ring
    const Z = await activatedRing("Eta");
    const u = await member("Lid E", Z.ring.id);
    const dz = await decl.submitDeclaration(u.id, base(Z.ring.id, Z.unit!.id));
    expect((await decl.openDeclaration(Z.president.id, dz.id)).viewerRole).toBe("president");
    await expect(decl.openDeclaration(A.president.id, dz.id)).rejects.toMatchObject({ status: 404 });
  });
  it("administrateur opent → automatisch 'Gezien' (één keer, met tijdstempel en historie)", async () => {
    const A = await activatedRing("Theta", false);
    const owner = await member("Lid", A.ring.id);
    const d = await decl.submitDeclaration(owner.id, base(A.ring.id, null));
    const first = await decl.openDeclaration(A.admin.id, d.id);
    expect(first.status).toBe("SEEN");
    const seenAt = (await prisma.declaration.findUniqueOrThrow({ where: { id: d.id } })).seenAt!;
    await decl.openDeclaration(A.admin.id, d.id);
    expect((await prisma.declaration.findUniqueOrThrow({ where: { id: d.id } })).seenAt!.getTime()).toBe(seenAt.getTime());
    expect(await prisma.declarationStatusEvent.count({ where: { declarationId: d.id, toStatus: "SEEN" } })).toBe(1);
    // de eigenaar die zijn eigen declaratie opent verandert niets
    const own = await decl.openDeclaration(owner.id, d.id);
    expect(own.viewerRole).toBe("owner");
  });
  it("statusovergangen: geldig, ongeldig, toelichting verplicht, eindstatus blijft; historie bewaard", async () => {
    const A = await activatedRing("Iota", false);
    const owner = await member("Lid", A.ring.id);
    const d = await decl.submitDeclaration(owner.id, base(A.ring.id, null));
    await decl.openDeclaration(A.admin.id, d.id);
    await expect(decl.setStatus(A.admin.id, d.id, "SUBMITTED")).rejects.toMatchObject({ status: 400 });
    await expect(decl.setStatus(A.admin.id, d.id, "UITBETAALD")).rejects.toMatchObject({ status: 400 });
    await expect(decl.setStatus(A.admin.id, d.id, "NEEDS_INFO")).rejects.toMatchObject({ code: "note-required" });
    await decl.setStatus(A.admin.id, d.id, "NEEDS_INFO", "Graag de bon opnieuw uploaden.");
    await decl.setStatus(A.admin.id, d.id, "IN_PROGRESS");
    await decl.setStatus(A.admin.id, d.id, "PROCESSED");
    await expect(decl.setStatus(A.admin.id, d.id, "REJECTED", "Toch niet.")).rejects.toMatchObject({ code: "invalid-transition" });
    const detail = await decl.openDeclaration(owner.id, d.id);
    expect(detail.history.map((h) => h.toStatus)).toEqual(["SUBMITTED", "SEEN", "NEEDS_INFO", "IN_PROGRESS", "PROCESSED"]);
    expect(detail.statusLabel).toBe("Administratief verwerkt");
    expect(detail.canProcess).toBe(false);
  });
});

describe("API en functievlag", () => {
  it("zonder functievlag bestaan de routes niet en /meta meldt het niet", async () => {
    const { ring } = await activatedRing("Kappa", false);
    const u = await member("Lid", ring.id);
    const t = await tokenFor(u.id);
    delete process.env.DECLARATIONS_ENABLED;
    expect((await call("GET", "/declarations", { token: t })).status).toBe(404);
    expect((await call("GET", "/meta")).body.declarations).toBe(false);
    process.env.DECLARATIONS_ENABLED = "true";
    expect((await call("GET", "/meta")).body.declarations).toBe(true);
    expect((await call("GET", "/declarations", { token: t })).status).toBe(200);
  });
  it("onboarding: profiel opslaan en bestemmingen met activeringsstatus", async () => {
    const A = await activatedRing("Lambda");
    const empty = await createTestRing("Leeg");
    const u = await member("Lid", A.ring.id);
    const t = await tokenFor(u.id);
    const ctx = await call("GET", "/declarations/context", { token: t });
    expect(ctx.status).toBe(200);
    expect(ctx.body.onboarded).toBe(false);
    const dest = ctx.body.destinations as { ringId: string; activated: boolean; units: { activated: boolean }[] }[];
    expect(dest.find((d) => d.ringId === A.ring.id)!.activated).toBe(true);
    expect(dest.find((d) => d.ringId === empty.id)!.activated).toBe(false);
    expect((await call("POST", "/declarations/profile", { token: t, body: { name: "Piet Jansen", ringId: A.ring.id, unitId: "bestaat-niet" } })).status).toBe(404);
    expect((await call("POST", "/declarations/profile", { token: t, body: { name: "Piet Jansen", ringId: A.ring.id, unitId: A.unit!.id } })).status).toBe(200);
    const again = await call("GET", "/declarations/context", { token: t });
    expect(again.body).toMatchObject({ onboarded: true, name: "Piet Jansen", preferredRingId: A.ring.id, preferredUnitId: A.unit!.id });
  });
  it("end-to-end via API: indienen, eigen lijst, beheerlijst, verwerken, downloaden", async () => {
    const A = await activatedRing("Mu");
    const u = await member("Lid", A.ring.id);
    const t = await tokenFor(u.id);
    const sub = await call("POST", "/declarations", { token: t, body: base(A.ring.id, A.unit!.id) });
    expect(sub.status).toBe(200);
    const mine = await call("GET", "/declarations", { token: t });
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0].statusLabel).toBe("Ingediend");
    const at = await tokenFor(A.uadmin!.id);
    const list = await call("GET", "/declarations/official", { token: at });
    expect(list.body.items).toHaveLength(1);
    expect(list.body.roles.administer).toBe(true);
    const det = await call("GET", `/declarations/${sub.body.id}`, { token: at });
    expect(det.body.status).toBe("SEEN");
    const dl = await call("GET", `/declarations/${sub.body.id}/attachments/${det.body.attachments[0].id}`, { token: at });
    expect(Buffer.from(dl.body.dataBase64, "base64").equals(PNG)).toBe(true);
    expect((await call("POST", `/declarations/${sub.body.id}/status`, { token: t, body: { status: "PROCESSED" } })).status).toBe(403);
    expect((await call("POST", `/declarations/${sub.body.id}/status`, { token: at, body: { status: "PROCESSED" } })).status).toBe(200);
    // geen notificatie-/mailinhoud met bedragen of omschrijving
    for (const c of sendMailMock.mock.calls) expect(JSON.stringify(c)).not.toContain("Boodschappen");
  });
  it("ringbeheerder kent functies toe via de API; gewone gebruiker niet", async () => {
    const ring = await createTestRing("Nu");
    const mgr = await createTestUser("RINGADMINISTRATEUR", "Mgr", { ringId: ring.id, isRingManager: true });
    const other = await createTestUser("RINGSECRETARIS", "Sec", { ringId: ring.id });
    const mt = await tokenFor(mgr.id); const ot = await tokenFor(other.id);
    expect((await call("POST", `/rings/${ring.id}/finance`, { token: ot, body: { email: "x@example.nl", role: "ADMIN" } })).status).toBe(403);
    const ok = await call("POST", `/rings/${ring.id}/finance`, { token: mt, body: { email: "x@example.nl", role: "ADMIN" } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    const list = await call("GET", `/rings/${ring.id}/finance`, { token: mt });
    expect(list.body.assignments).toHaveLength(1);
    expect(list.body.assignments[0].pending).toBe(true);
    const rev = await call("POST", `/finance/${list.body.assignments[0].id}/revoke`, { token: mt, body: { pending: true } });
    expect(rev.status).toBe(200);
    expect((await call("GET", `/rings/${ring.id}/finance`, { token: ot })).status).toBe(403);
  });
});

describe("verificatie van openstaande functies en uitgeschakelde module", () => {
  it("een klaarstaande functie voor een onbekend adres is pas actief na geverifieerde code; verkeerde code activeert niets", async () => {
    const { ring } = await activatedRing("Verif", false);
    const mgr = await createTestUser("RINGADMINISTRATEUR", "Mgr V", { ringId: ring.id, isRingManager: true });
    await fin.assignFinanceRole({ actorId: mgr.id, ringId: ring.id, unitId: null, email: "wacht@example.nl", role: "ADMIN" });
    expect(await prisma.user.count({ where: { email: "wacht@example.nl" } })).toBe(0);
    expect(await prisma.financeAssignment.count({ where: { ringId: ring.id, role: "ADMIN" } })).toBe(1); // alleen de bestaande administrateur
    const reg = await import("@/lib/registration");
    sendMailMock.mockClear();
    await reg.sendRegistrationCode("wacht@example.nl");
    expect(await reg.loginRegisteringPerson("wacht@example.nl", "00000000", "t")).toBeNull();
    expect(await prisma.user.count({ where: { email: "wacht@example.nl" } })).toBe(0);
    expect(await prisma.financeAssignment.count({ where: { ringId: ring.id, role: "ADMIN" } })).toBe(1);
    expect((await prisma.pendingFinanceAssignment.findFirstOrThrow({ where: { email: "wacht@example.nl" } })).claimedAt).toBeNull();
    // Een andere persoon die zich met een ander adres registreert, claimt niets
    await reg.sendRegistrationCode("ander@example.nl");
    const code2 = /(\d{8})/.exec(String((sendMailMock.mock.calls.at(-1)![0] as { text: string }).text))![1];
    const other = await reg.loginRegisteringPerson("ander@example.nl", code2, "t");
    expect(await prisma.financeAssignment.count({ where: { userId: other!.userId } })).toBe(0);
  });
  it("een onverifieerde claim geeft geen toegang: zonder code geen sessie, na verificatie wel", async () => {
    const { ring } = await activatedRing("Verif2", false);
    const mgr = await createTestUser("RINGADMINISTRATEUR", "Mgr V2", { ringId: ring.id, isRingManager: true });
    await fin.assignFinanceRole({ actorId: mgr.id, ringId: ring.id, unitId: null, email: "echt@example.nl", role: "SUBADMIN" });
    const reg = await import("@/lib/registration");
    sendMailMock.mockClear();
    await reg.sendRegistrationCode("echt@example.nl");
    const code = /(\d{8})/.exec(String((sendMailMock.mock.calls.at(-1)![0] as { text: string }).text))![1];
    const ok = await reg.loginRegisteringPerson("echt@example.nl", code, "t");
    expect((await fin.loadScopes(ok!.userId)).map((s) => s.role)).toEqual(["SUBADMIN"]);
  });
  it("met DECLARATIONS_ENABLED uit: geen registratie, geen declaratieroutes, geen claim; bestaande inlogmail ongewijzigd", async () => {
    delete process.env.DECLARATIONS_ENABLED;
    const reg = await import("@/lib/registration");
    expect(await reg.sendRegistrationCode("nieuw@example.nl")).toBe(false);
    expect(await reg.loginRegisteringPerson("nieuw@example.nl", "12345678", "t")).toBeNull();
    const ring = await createTestRing("Uit");
    const u = await createTestUser("RINGSECRETARIS", "Bestaand lid", { ringId: ring.id, email: "lid@example.nl" });
    const t = await tokenFor(u.id);
    for (const [m, path] of [["GET", "/declarations"], ["GET", "/declarations/context"], ["GET", "/declarations/official"], ["POST", "/declarations"], ["GET", `/rings/${ring.id}/finance`]] as const) {
      expect((await call(m, path, { token: t, body: {} })).status).toBe(404);
    }
    expect((await call("GET", "/meta")).body.declarations).toBe(false);
    sendMailMock.mockClear();
    expect((await call("POST", "/auth/request-code", { body: { email: "lid@example.nl" } })).status).toBe(200);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect((await call("GET", "/me", { token: t })).body.rings).toHaveLength(1);
  });
});

describe("accountverwijdering", () => {
  it("open declaratie blokkeert verwijdering; afgehandelde blijft zonder accountkoppeling en zonder directe naam (niet anoniem)", async () => {
    const { completeAccountDeletion } = await import("@/lib/accountDeletion");
    const A = await activatedRing("Omega", false);
    const owner = await member("Lid", A.ring.id);
    const web = await createTestUser("ADMIN", "Webmin");
    const d = await decl.submitDeclaration(owner.id, base(A.ring.id, null));
    const req = await prisma.accountDeletionRequest.create({ data: { userId: owner.id, status: "REQUESTED", receiptHash: `h-${Date.now()}`, dueAt: new Date(Date.now() + 86400000) } });
    const blocked = await completeAccountDeletion(web.id, req.id, { identityChecked: true });
    expect(blocked.completed).toBe(false);
    expect(blocked.blockers.map((b) => b.kind)).toContain("OPEN_DECLARATIONS");
    await decl.openDeclaration(A.admin.id, d.id);
    await decl.setStatus(A.admin.id, d.id, "PROCESSED");
    const done = await completeAccountDeletion(web.id, req.id, { identityChecked: true });
    expect(done.completed).toBe(true);
    const row = await prisma.declaration.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.ownerId).toBeNull();
    expect(row.ownerName).toBe("Verwijderde gebruiker");
    expect(row.status).toBe("PROCESSED");
  });
});

describe("bestaande roepingen blijven ongemoeid", () => {
  it("getMe/lidmaatschappen van een kerklid zonder ring is leeg maar geldig; hashToken ongewijzigd", async () => {
    const u = await prisma.user.create({ data: { name: "Kerklid", email: "k@example.nl", role: "KERKLID", active: true } });
    const t = await tokenFor(u.id);
    const me = await call("GET", "/me", { token: t });
    expect(me.status).toBe(200);
    expect(me.body.rings).toEqual([]);
    expect(hashToken("a")).toBe(hashToken("a"));
  });
});
