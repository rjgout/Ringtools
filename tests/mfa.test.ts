import { beforeEach, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser, createCalling } from "./setup";

const generateRegistrationOptions = vi.fn();
const verifyRegistrationResponse = vi.fn();
const generateAuthenticationOptions = vi.fn();
const verifyAuthenticationResponse = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (...args: unknown[]) => generateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) => verifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args: unknown[]) => generateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args: unknown[]) => verifyAuthenticationResponse(...args),
}));

const {
  startTotpEnrollment,
  verifyTotpCode,
  confirmTotpEnrollment,
  isTotpConfirmed,
  regenerateRecoveryCodes,
  consumeRecoveryCode,
} = await import("@/lib/mfa");
const {
  hasPasskeys,
  startPasskeyRegistration,
  verifyPasskeyRegistration,
  startPasskeyAuthentication,
  verifyPasskeyAuthentication,
} = await import("@/lib/webauthn");
const {
  createSession,
  getSessionUser,
  getSessionAwaitingMfa,
  promoteSessionToMfaVerified,
  isRecentlyMfaVerified,
  destroySessionById,
  listSessionsForUser,
} = await import("@/lib/auth");
const { castVote } = await import("@/lib/workflow");

function currentCodeFor(secretBase32: string): string {
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) });
  return totp.generate();
}

beforeEach(async () => {
  await resetDatabase();
  generateRegistrationOptions.mockReset();
  verifyRegistrationResponse.mockReset();
  generateAuthenticationOptions.mockReset();
  verifyAuthenticationResponse.mockReset();
});

describe("TOTP (adminaccount)", () => {
  it("een geldige code wordt geaccepteerd", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    const { secret } = await startTotpEnrollment(admin.id, admin.email);
    expect(await verifyTotpCode(admin.id, admin.email, currentCodeFor(secret))).toBe("OK");
  });

  it("een ongeldige code wordt afgewezen", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    await startTotpEnrollment(admin.id, admin.email);
    expect(await verifyTotpCode(admin.id, admin.email, "000000")).toBe("INVALID");
  });

  it("voorkomt hergebruik van dezelfde geldige code", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    const { secret } = await startTotpEnrollment(admin.id, admin.email);
    const code = currentCodeFor(secret);
    expect(await verifyTotpCode(admin.id, admin.email, code)).toBe("OK");
    expect(await verifyTotpCode(admin.id, admin.email, code)).toBe("INVALID");
  });

  it("vergrendelt na 5 mislukte pogingen, ook met een daarna geldige code", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    const { secret } = await startTotpEnrollment(admin.id, admin.email);
    for (let i = 0; i < 4; i++) {
      expect(await verifyTotpCode(admin.id, admin.email, "000000")).toBe("INVALID");
    }
    expect(await verifyTotpCode(admin.id, admin.email, "000000")).toBe("LOCKED");
    expect(await verifyTotpCode(admin.id, admin.email, currentCodeFor(secret))).toBe("LOCKED");
  });

  it("confirmTotpEnrollment bevestigt de inschrijving en levert 8 eenmalige herstelcodes op", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    const { secret } = await startTotpEnrollment(admin.id, admin.email);
    expect(await isTotpConfirmed(admin.id)).toBe(false);

    const result = await confirmTotpEnrollment(admin.id, admin.email, currentCodeFor(secret));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recoveryCodes).toHaveLength(8);
    expect(await isTotpConfirmed(admin.id)).toBe(true);
  });

  it("de QR-inschrijving blijft gelijk bij een herhaalde (nog onbevestigde) aanvraag, maar niet na forceNew", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    const first = await startTotpEnrollment(admin.id, admin.email);
    const second = await startTotpEnrollment(admin.id, admin.email);
    expect(second.secret).toBe(first.secret);

    const forced = await startTotpEnrollment(admin.id, admin.email, true);
    expect(forced.secret).not.toBe(first.secret);
  });
});

describe("Herstelcodes", () => {
  it("een herstelcode werkt precies één keer", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    const [code] = await regenerateRecoveryCodes(admin.id);
    expect(await consumeRecoveryCode(admin.id, code)).toBe(true);
    expect(await consumeRecoveryCode(admin.id, code)).toBe(false);
  });

  it("nieuwe herstelcodes maken de oude ongeldig", async () => {
    const admin = await createTestUser("ADMIN", "Beheerder");
    const [oldCode] = await regenerateRecoveryCodes(admin.id);
    await regenerateRecoveryCodes(admin.id);
    expect(await consumeRecoveryCode(admin.id, oldCode)).toBe(false);
  });
});

describe("Passkeys (WebAuthn) — SDK-grens gemockt, eigen opslag/logica echt getest", () => {
  it("registreert een passkey en slaat publieke sleutel/teller correct op", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    generateRegistrationOptions.mockResolvedValue({ challenge: "reg-challenge" });
    await startPasskeyRegistration(user.id, user.email, user.name);

    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "cred-1", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
      },
    });
    const result = await verifyPasskeyRegistration(user.id, { id: "cred-1" } as never, "Mijn telefoon");
    expect(result.ok).toBe(true);
    expect(await hasPasskeys(user.id)).toBe(true);

    const stored = await prisma.webAuthnCredential.findUniqueOrThrow({ where: { credentialId: "cred-1" } });
    expect(stored.deviceLabel).toBe("Mijn telefoon");
    expect(Number(stored.counter)).toBe(0);

    // De challenge is éénmalig verbruikt en dus weg.
    expect(await prisma.webAuthnChallenge.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it("wijst registratie af zonder een eerder opgevraagde challenge", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const result = await verifyPasskeyRegistration(user.id, { id: "cred-x" } as never);
    expect(result.ok).toBe(false);
    expect(verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it("authenticatie werkt met userVerification=required en werkt de teller bij", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.webAuthnCredential.create({
      data: { userId: user.id, credentialId: "cred-2", publicKey: Buffer.from([9, 9]), counter: BigInt(5) },
    });

    generateAuthenticationOptions.mockResolvedValue({ challenge: "auth-challenge" });
    const options = await startPasskeyAuthentication(user.id);
    expect(options).not.toBeNull();
    const optsCall = generateAuthenticationOptions.mock.calls[0]?.[0];
    expect(optsCall.userVerification).toBe("required");

    verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
    const result = await verifyPasskeyAuthentication(user.id, { id: "cred-2" } as never);
    expect(result.ok).toBe(true);

    const updated = await prisma.webAuthnCredential.findUniqueOrThrow({ where: { credentialId: "cred-2" } });
    expect(Number(updated.counter)).toBe(6);
    expect(updated.lastUsedAt).not.toBeNull();
  });

  it("wijst een onbekende passkey af zonder de ingelogde gebruiker te raadplegen bij de SDK", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.webAuthnChallenge.create({ data: { userId: user.id, challenge: "x", expiresAt: new Date(Date.now() + 60_000) } });

    const result = await verifyPasskeyAuthentication(user.id, { id: "nooit-geregistreerd" } as never);
    expect(result.ok).toBe(false);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("behandelt een teller-terugval (mogelijk gekloond apparaat) als mislukte verificatie", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    await prisma.webAuthnCredential.create({
      data: { userId: user.id, credentialId: "cred-3", publicKey: Buffer.from([1]), counter: BigInt(10) },
    });
    await prisma.webAuthnChallenge.create({ data: { userId: user.id, challenge: "x", expiresAt: new Date(Date.now() + 60_000) } });

    verifyAuthenticationResponse.mockRejectedValue(new Error("Response counter value 3 was lower than expected 10"));
    const result = await verifyPasskeyAuthentication(user.id, { id: "cred-3" } as never);
    expect(result.ok).toBe(false);

    const events = await prisma.securityEvent.findMany({ where: { userId: user.id, type: "PASSKEY_LOGIN_FAILED" } });
    expect(events.length).toBeGreaterThan(0);
  });

  it("een andere gebruikers passkey kan niet voor een andere account gebruikt worden", async () => {
    const owner = await createTestUser("HOGERAAD", "Eigenaar");
    const attacker = await createTestUser("HOGERAAD", "Aanvaller");
    await prisma.webAuthnCredential.create({
      data: { userId: owner.id, credentialId: "cred-owner", publicKey: Buffer.from([1]), counter: BigInt(0) },
    });
    await prisma.webAuthnChallenge.create({ data: { userId: attacker.id, challenge: "x", expiresAt: new Date(Date.now() + 60_000) } });

    const result = await verifyPasskeyAuthentication(attacker.id, { id: "cred-owner" } as never);
    expect(result.ok).toBe(false);
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
  });
});

describe("Sessies: verplichte MFA-gate", () => {
  it("een sessie direct na identiteitscontrole geeft GEEN toegang via getSessionUser, wel via getSessionAwaitingMfa", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const { rawToken } = await createSession(user.id);

    expect(await getSessionUser(rawToken)).toBeNull();
    const awaiting = await getSessionAwaitingMfa(rawToken);
    expect(awaiting?.userId).toBe(user.id);
  });

  it("na promotie werkt het oude token niet meer en geeft het nieuwe volledige toegang", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const { rawToken: oldToken } = await createSession(user.id);
    const awaiting = await getSessionAwaitingMfa(oldToken);
    const { rawToken: newToken } = await promoteSessionToMfaVerified(awaiting!.sessionId, user.id);

    expect(await getSessionUser(oldToken)).toBeNull();
    expect((await getSessionUser(newToken))?.id).toBe(user.id);
    expect(await getSessionAwaitingMfa(newToken)).toBeNull(); // al afgerond, niet opnieuw als "wachtend" te gebruiken
  });

  it("isRecentlyMfaVerified herkent een verlopen verificatie", async () => {
    expect(isRecentlyMfaVerified(new Date())).toBe(true);
    expect(isRecentlyMfaVerified(new Date(Date.now() - 20 * 60 * 1000))).toBe(false);
    expect(isRecentlyMfaVerified(null)).toBe(false);
  });

  it("een gedeactiveerde gebruiker verliest toegang, ook met een volledig geverifieerde sessie", async () => {
    const user = await createTestUser("HOGERAAD", "Hogeraadslid Een");
    const { rawToken: oldToken } = await createSession(user.id);
    const awaiting = await getSessionAwaitingMfa(oldToken);
    const { rawToken } = await promoteSessionToMfaVerified(awaiting!.sessionId, user.id);
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    expect(await getSessionUser(rawToken)).toBeNull();
  });

  it("sessies kunnen individueel beëindigd worden, maar niet door een andere gebruiker", async () => {
    const owner = await createTestUser("HOGERAAD", "Eigenaar");
    const other = await createTestUser("HOGERAAD", "Ander");
    const { rawToken } = await createSession(owner.id);
    const awaiting = await getSessionAwaitingMfa(rawToken);
    await promoteSessionToMfaVerified(awaiting!.sessionId, owner.id);
    const [session] = await listSessionsForUser(owner.id);

    await destroySessionById(other.id, session.id); // verkeerde userId: geen effect
    expect(await listSessionsForUser(owner.id)).toHaveLength(1);

    await destroySessionById(owner.id, session.id);
    expect(await listSessionsForUser(owner.id)).toHaveLength(0);
  });
});

describe("Bestaande workflows blijven werken na de MFA-uitbreiding", () => {
  it("een roeping aanmaken en stemmen werkt ongewijzigd", async () => {
    const presidium = await createTestUser("RINGPRESIDIUM", "President Een");
    const calling = await createCalling({ personName: "Jan Jansen", functionTitle: "Hogeraadslid", createdById: presidium.id });
    const updated = await castVote({ callingId: calling.id, userId: presidium.id, support: true });
    expect(updated.status).toBe("APPROVED");
  });
});

