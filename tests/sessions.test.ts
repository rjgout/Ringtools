import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import {
  createVerifiedSession,
  createSession,
  getSessionUser,
  getActiveSession,
  getSessionAwaitingMfa,
  rotateSessionIfDue,
  destroySession,
  destroyAllSessionsForUser,
  createMagicLinkToken,
  consumeMagicLinkToken,
  consumeLoginCode,
  deleteExpiredAuthData,
  SESSION_IDLE_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_ROTATE_INTERVAL_MS,
  SESSION_ROTATION_GRACE_MS,
  MAGIC_CODE_MAX_ATTEMPTS,
} from "@/lib/auth";
import { safeInternalPath } from "@/lib/safePath";
import { resetDatabase, createTestUser } from "./setup";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDatabase();
});

async function rowFor(rawToken: string) {
  return prisma.session.findFirstOrThrow({ where: { OR: [{ tokenHash: hashToken(rawToken) }, { prevTokenHash: hashToken(rawToken) }] } });
}

describe("Doorlopende sessies (ingelogd blijven in de PWA)", () => {
  it("een ingelogde sessie blijft geldig na een lange pauze en wordt bij gebruik verlengd", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createVerifiedSession(user.id);
    // Gesimuleerd: 20 dagen niets gedaan; de oorspronkelijke verloopdatum zou over 40 dagen zijn.
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 20 * DAY), createdAt: new Date(Date.now() - 20 * DAY), expiresAt: new Date(Date.now() + 40 * DAY) },
    });

    expect((await getSessionUser(rawToken))?.id).toBe(user.id);
    const row = await rowFor(rawToken);
    // Verlengd tot de volledige inactiviteitstermijn vanaf nu.
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + SESSION_IDLE_TTL_MS - 60_000);
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(60_000);
  });

  it("schrijft niet bij elk verzoek naar de database (hooguit eens per kwartier)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createVerifiedSession(user.id);
    const before = await rowFor(rawToken);
    await getSessionUser(rawToken);
    await getSessionUser(rawToken);
    const after = await rowFor(rawToken);
    expect(after.lastSeenAt.getTime()).toBe(before.lastSeenAt.getTime());
    expect(SESSION_TOUCH_INTERVAL_MS).toBeGreaterThan(0);
  });

  it("een sessie zonder gebruik langer dan de inactiviteitstermijn verloopt en wordt verwijderd", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createVerifiedSession(user.id);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect(await getSessionUser(rawToken)).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("de absolute levensduur wordt niet door dagelijks gebruik verlengd", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createVerifiedSession(user.id);
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - SESSION_ABSOLUTE_TTL_MS - DAY), expiresAt: new Date(Date.now() + 30 * DAY) },
    });
    expect(await getSessionUser(rawToken)).toBeNull();

    const second = await createVerifiedSession(user.id);
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(second.rawToken) },
      data: { createdAt: new Date(Date.now() - SESSION_ABSOLUTE_TTL_MS + 3 * DAY), lastSeenAt: new Date(Date.now() - DAY) },
    });
    await getSessionUser(second.rawToken);
    const row = await rowFor(second.rawToken);
    // Verlenging is begrensd door createdAt + absolute levensduur (nog 3 dagen).
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(row.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS);
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now() + 4 * DAY);
  });

  it("een sessie die nog op MFA wacht wordt nooit verlengd en geeft geen toegang", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createSession(user.id);
    expect(await getSessionUser(rawToken)).toBeNull();
    expect(await getActiveSession(rawToken)).toBeNull();
    expect((await getSessionAwaitingMfa(rawToken))?.userId).toBe(user.id);
  });
});

describe("Veilige rotatie van het sessietoken", () => {
  it("roteert niet voordat het interval is verstreken", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createVerifiedSession(user.id);
    expect(await rotateSessionIfDue(rawToken)).toEqual({ status: "ok", rotated: false });
  });

  it("roteert na het interval: nieuw token werkt, aanmaakdatum blijft, oud token kort geldig daarna ongeldig", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken: oldToken } = await createVerifiedSession(user.id);
    const created = new Date(Date.now() - SESSION_ROTATE_INTERVAL_MS - 60_000);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { createdAt: created } });

    const result = await rotateSessionIfDue(oldToken);
    expect(result.status).toBe("ok");
    if (result.status !== "ok" || !result.rotated) throw new Error("verwachtte een rotatie");

    expect((await getSessionUser(result.rawToken))?.id).toBe(user.id);
    const row = await rowFor(result.rawToken);
    expect(row.createdAt.getTime()).toBe(created.getTime());

    // Het vorige token blijft kort geldig (gelijktijdige verzoeken, verloren antwoord)...
    expect((await getSessionUser(oldToken))?.id).toBe(user.id);
    // ...maar niet langer dan de coulanceperiode.
    await prisma.session.updateMany({ where: { userId: user.id }, data: { rotatedAt: new Date(Date.now() - SESSION_ROTATION_GRACE_MS - 1000) } });
    expect(await getSessionUser(oldToken)).toBeNull();
    expect((await getSessionUser(result.rawToken))?.id).toBe(user.id);
  });

  it("bij gelijktijdige aanroepen roteert er precies één", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createVerifiedSession(user.id);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 2 * DAY) } });

    const results = await Promise.all([1, 2, 3, 4].map(() => rotateSessionIfDue(rawToken)));
    expect(results.filter((r) => r.status === "ok" && r.rotated).length).toBe(1);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it("een onbekend, verlopen of ingetrokken token roteert niet", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    expect(await rotateSessionIfDue("onbekend")).toEqual({ status: "none" });
    expect(await rotateSessionIfDue(null)).toEqual({ status: "none" });
    const { rawToken } = await createVerifiedSession(user.id);
    await destroySession(rawToken);
    expect(await rotateSessionIfDue(rawToken)).toEqual({ status: "none" });
  });
});

describe("Intrekken van sessies", () => {
  it("uitloggen trekt de sessie onmiddellijk in, ook via het vorige (geroteerde) token", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken: oldToken } = await createVerifiedSession(user.id);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 2 * DAY) } });
    const rotated = await rotateSessionIfDue(oldToken);
    if (rotated.status !== "ok" || !rotated.rotated) throw new Error("verwachtte een rotatie");

    await destroySession(oldToken);
    expect(await getSessionUser(rotated.rawToken)).toBeNull();
    expect(await getSessionUser(oldToken)).toBeNull();
  });

  it("deactivering van de gebruiker blokkeert alle sessies direct", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createVerifiedSession(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await getSessionUser(rawToken)).toBeNull();
  });

  it("meerdere apparaten hebben elk een eigen sessie; intrekken van één laat de andere staan", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const phone = await createVerifiedSession(user.id, "iPhone-PWA");
    const laptop = await createVerifiedSession(user.id, "Laptop");
    await destroySession(laptop.rawToken);
    expect((await getSessionUser(phone.rawToken))?.id).toBe(user.id);
    expect(await getSessionUser(laptop.rawToken)).toBeNull();

    await destroyAllSessionsForUser(user.id);
    expect(await getSessionUser(phone.rawToken)).toBeNull();
  });

  it("een nieuwe login elders laat bestaande sessies (bijv. de geïnstalleerde app) ongemoeid", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const app = await createVerifiedSession(user.id);
    await createMagicLinkToken(user.id);
    const browser = await createVerifiedSession(user.id);
    expect((await getSessionUser(app.rawToken))?.id).toBe(user.id);
    expect((await getSessionUser(browser.rawToken))?.id).toBe(user.id);
  });

  it("ruimt verlopen sessies en gebruikte inloglinks op", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const live = await createVerifiedSession(user.id);
    const stale = await createVerifiedSession(user.id);
    await prisma.session.updateMany({ where: { tokenHash: hashToken(stale.rawToken) }, data: { expiresAt: new Date(Date.now() - DAY) } });
    const used = await createMagicLinkToken(user.id);
    await consumeMagicLinkToken(used.rawToken);

    const cleaned = await deleteExpiredAuthData();
    expect(cleaned.sessions).toBe(1);
    expect(cleaned.magicLinks).toBe(1);
    expect((await getSessionUser(live.rawToken))?.id).toBe(user.id);
  });
});

describe("Magic links en inlogcode", () => {
  it("een link is precies één keer te gebruiken, ook bij gelijktijdige aanvragen", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createMagicLinkToken(user.id);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => consumeMagicLinkToken(rawToken)));
    expect(results.filter(Boolean).length).toBe(1);
  });

  it("de link is 15 minuten geldig vanaf het aanmaken, niet vanaf het openen", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken, expiresAt } = await createMagicLinkToken(user.id);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    await prisma.magicLinkToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumeMagicLinkToken(rawToken)).toBeNull();
  });

  it("de inlogcode werkt één keer en maakt daarmee ook de link ongeldig", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken, code } = await createMagicLinkToken(user.id, { withCode: true });
    expect(code).toMatch(/^\d{8}$/);

    expect((await consumeLoginCode(user.email, code!))?.id).toBe(user.id);
    expect(await consumeLoginCode(user.email, code!)).toBeNull();
    expect(await consumeMagicLinkToken(rawToken)).toBeNull();
  });

  it("de link maakt de code ongeldig", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken, code } = await createMagicLinkToken(user.id, { withCode: true });
    expect(await consumeMagicLinkToken(rawToken)).not.toBeNull();
    expect(await consumeLoginCode(user.email, code!)).toBeNull();
  });

  it("na te veel foute pogingen is de code onbruikbaar, ook de juiste", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { code } = await createMagicLinkToken(user.id, { withCode: true });
    const wrong = code === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < MAGIC_CODE_MAX_ATTEMPTS; i++) {
      expect(await consumeLoginCode(user.email, wrong)).toBeNull();
    }
    expect(await consumeLoginCode(user.email, code!)).toBeNull();
  });

  it("een code werkt niet zonder code-aanvraag, voor een onbekend adres of voor een gedeactiveerde gebruiker", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await createMagicLinkToken(user.id); // zonder code
    expect(await consumeLoginCode(user.email, "12345678")).toBeNull();
    expect(await consumeLoginCode("niemand@test.ringapeldoorn.nl", "12345678")).toBeNull();

    const { code } = await createMagicLinkToken(user.id, { withCode: true });
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await consumeLoginCode(user.email, code!)).toBeNull();
  });
});

describe("Veilige doelpaden (geen open redirect)", () => {
  it("accepteert alleen interne paden", () => {
    expect(safeInternalPath("/roepingen/abc123")).toBe("/roepingen/abc123");
    expect(safeInternalPath("/roepingen/abc?x=1#y")).toBe("/roepingen/abc?x=1#y");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "roepingen/abc", "javascript:alert(1)", "/a\nb", "", null, undefined]) {
      expect(safeInternalPath(bad as string | null | undefined)).toBeNull();
    }
  });
});
