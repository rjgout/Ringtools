import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser } from "./setup";
import {
  createMagicLinkToken,
  consumeMagicLinkToken,
  previewMagicLinkToken,
  verifyAdminPassword,
  hashPassword,
  createSession,
  getSessionUser,
  getSessionAwaitingMfa,
  promoteSessionToMfaVerified,
  destroySession,
} from "@/lib/auth";
import { ensureAdminAccount } from "@/lib/bootstrap";

beforeEach(async () => {
  await resetDatabase();
});

describe("Magic-link authenticatie", () => {
  it("een geldige token logt precies één keer in (eenmalig gebruik)", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const { rawToken } = await createMagicLinkToken(user.id);

    const preview = await previewMagicLinkToken(rawToken);
    expect(preview.valid).toBe(true);

    const first = await consumeMagicLinkToken(rawToken);
    expect(first?.id).toBe(user.id);

    const second = await consumeMagicLinkToken(rawToken);
    expect(second).toBeNull();
  });

  it("een verlopen token is ongeldig", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const { rawToken } = await createMagicLinkToken(user.id);
    await prisma.magicLinkToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 60 * 1000) },
    });

    expect(await consumeMagicLinkToken(rawToken)).toBeNull();
  });

  it("een gedeactiveerde gebruiker kan niet meer inloggen via een nog geldige token", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const { rawToken } = await createMagicLinkToken(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    expect(await consumeMagicLinkToken(rawToken)).toBeNull();
  });

  it("onbekende gebruikers krijgen geen toegang (een niet-bestaande token is simpelweg ongeldig)", async () => {
    expect(await consumeMagicLinkToken("niet-bestaande-token")).toBeNull();
  });
});

describe("Sessies", () => {
  // createSession() maakt sinds de verplichte MFA-uitbreiding alleen een
  // "wacht op MFA"-sessie aan (zie tests/mfa.test.ts voor die gate zelf);
  // hier wordt eerst gepromoveerd naar een volledig ingelogde sessie, zoals
  // na een geslaagde TOTP/passkey-verificatie.
  it("een sessie is geldig totdat deze wordt opgeruimd of de gebruiker gedeactiveerd wordt", async () => {
    const user = await createTestUser("RINGPRESIDIUM", "President Een");
    const { rawToken: awaitingToken } = await createSession(user.id);
    const awaiting = await getSessionAwaitingMfa(awaitingToken);
    const { rawToken } = await promoteSessionToMfaVerified(awaiting!.sessionId, user.id);

    expect((await getSessionUser(rawToken))?.id).toBe(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await getSessionUser(rawToken)).toBeNull();
  });

  it("uitloggen verwijdert de sessie direct", async () => {
    const user = await createTestUser("RINGPRESIDIUM", "President Een");
    const { rawToken } = await createSession(user.id);
    await destroySession(rawToken);
    expect(await getSessionUser(rawToken)).toBeNull();
  });
});

describe("Admin-account (webmin)", () => {
  it("wordt aangemaakt met het bootstrap-wachtwoord als het nog niet bestaat", async () => {
    process.env.BOOTSTRAP_ADMIN_USERNAME = "webmin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "eerste-wachtwoord-123";
    await ensureAdminAccount();

    const admin = await verifyAdminPassword("webmin", "eerste-wachtwoord-123");
    expect(admin).not.toBeNull();
  });

  it("een later gewijzigd wachtwoord wordt bij herstart NIET overschreven door de bootstrap-waarde", async () => {
    process.env.BOOTSTRAP_ADMIN_USERNAME = "webmin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "eerste-wachtwoord-123";
    await ensureAdminAccount();

    const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword("nieuw-wachtwoord-456") } });

    // Simuleer een herstart van de container met dezelfde env-variabele.
    await ensureAdminAccount();

    expect(await verifyAdminPassword("webmin", "nieuw-wachtwoord-456")).not.toBeNull();
    expect(await verifyAdminPassword("webmin", "eerste-wachtwoord-123")).toBeNull();
  });

  it("onjuiste inloggegevens worden altijd geweigerd", async () => {
    process.env.BOOTSTRAP_ADMIN_USERNAME = "webmin";
    process.env.BOOTSTRAP_ADMIN_PASSWORD = "eerste-wachtwoord-123";
    await ensureAdminAccount();

    expect(await verifyAdminPassword("webmin", "verkeerd-wachtwoord")).toBeNull();
    expect(await verifyAdminPassword("onbekend", "eerste-wachtwoord-123")).toBeNull();
  });
});
