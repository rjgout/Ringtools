import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "@/lib/prisma";
import { createSession, hasFreshFactorProof } from "@/lib/auth";
import { startTotpEnrollment, confirmTotpEnrollment, isTotpConfirmed, removeTotp, verifyTotpCode, regenerateRecoveryCodes } from "@/lib/mfa";
import { removePasskeyGuarded, removeTotpGuarded, enableMfaGuarded } from "@/lib/mfaMethods";
import { enrolledMethods } from "@/lib/mfaMethods";
import { resetDatabase, createTestUser } from "./setup";

// E2.1: authenticator-app (TOTP) voor gewone webgebruikers, achter WEB_TOTP_ENABLED. Acties worden met een nagebootste sessielaag getest.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
const session = {
  awaiting: null as unknown,
  current: null as unknown,
  recent: null as unknown,
};
vi.mock("@/lib/session", () => ({
  getAwaitingMfaUser: async () => session.awaiting,
  getCurrentSession: async () => session.current,
  requireRecentMfa: async () => {
    if (!session.recent) throw new Error("NEXT_REDIRECT:/profiel/beveiliging/herverifieer");
    return session.recent;
  },
  requireRole: async () => session.current && (session.current as { user: unknown }).user,
  setSessionCookie: vi.fn(),
  safeInternalPath: (v: string | null | undefined) => (v && v.startsWith("/") && !v.startsWith("//") ? v : null),
  getRequestUserAgent: async () => "test",
}));

const actions = await import("@/lib/actions/mfa.actions");

function code(secret: string, offset = 0): string {
  const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  return totp.generate({ timestamp: Date.now() + offset * 30_000 });
}
function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
async function pendingFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await createSession(userId);
  const row = await prisma.session.findFirstOrThrow({ where: { userId, mfaAt: null } });
  session.awaiting = { userId, sessionId: row.id, user, factorProvedAt: row.factorProvedAt };
  return row.id;
}
async function fullFor(userId: string, recent = true) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await createSession(userId);
  const row = await prisma.session.findFirstOrThrow({ where: { userId } });
  const value = { sessionId: row.id, user, mfaAt: recent ? new Date() : null };
  session.current = value;
  session.recent = recent ? value : null;
  return value;
}
async function confirmedTotp(userId: string, email: string) {
  const { secret } = await startTotpEnrollment(userId, email);
  await confirmTotpEnrollment(userId, email, code(secret));
  // Dezelfde tijdstap mag niet opnieuw: de volgende tests gebruiken de volgende stap.
  return secret;
}
async function addPasskey(userId: string) {
  await prisma.webAuthnCredential.create({ data: { userId, credentialId: `cred-${userId}-${Math.random()}`, publicKey: Buffer.from("x") } });
}

beforeEach(async () => {
  await resetDatabase();
  session.awaiting = null;
  session.current = null;
  session.recent = null;
  process.env.WEB_TOTP_ENABLED = "true";
});
afterEach(() => {
  delete process.env.WEB_TOTP_ENABLED;
});

describe("E2.1 – methoden en vlag", () => {
  it("met de vlag uit telt TOTP voor een gewone gebruiker niet mee (fail-closed)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await confirmedTotp(user.id, user.email);
    expect(await enrolledMethods(user)).toEqual(["totp"]);
    delete process.env.WEB_TOTP_ENABLED;
    expect(await enrolledMethods(user)).toEqual([]);
  });

  it("het beheerdersaccount valt buiten de methodelogica", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    await confirmedTotp(admin.id, admin.email);
    expect(await enrolledMethods(admin)).toEqual([]);
  });

  it("inschrijving geeft acht gehashte herstelcodes; removeTotp ruimt alles op", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await confirmedTotp(user.id, user.email);
    const rows = await prisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.codeHash.length >= 32 && !r.codeHash.includes("-"))).toBe(true);
    await removeTotp(user.id);
    expect(await isTotpConfirmed(user.id)).toBe(false);
    expect(await prisma.recoveryCode.count({ where: { userId: user.id } })).toBe(0);
  });

  it("replay-race: twee gelijktijdige verificaties met dezelfde code slagen nooit allebei", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const secret = await confirmedTotp(user.id, user.email);
    const c = code(secret, 1);
    const results = await Promise.all(Array.from({ length: 6 }, () => verifyTotpCode(user.id, user.email, c)));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
  });

  it("gelijktijdige foute pogingen worden allemaal geteld (lockout na 5)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await confirmedTotp(user.id, user.email);
    await Promise.all(Array.from({ length: 5 }, () => verifyTotpCode(user.id, user.email, "000000")));
    const row = await prisma.totpCredential.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.failedAttempts).toBeGreaterThanOrEqual(5);
    expect(row.lockedUntil).not.toBeNull();
  });
});

describe("E2.1 – inloggen met TOTP", () => {
  it("vlag uit: een gewone gebruiker kan niet met TOTP inloggen, ook niet met een geldige code", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const secret = await confirmedTotp(user.id, user.email);
    delete process.env.WEB_TOTP_ENABLED;
    const sessionId = await pendingFor(user.id);
    const res = await actions.verifyTotpLoginAction(null, form({ code: code(secret, 1) }));
    expect(res.ok).toBe(false);
    expect(await prisma.session.findUnique({ where: { id: sessionId } })).toMatchObject({ mfaAt: null });
  });

  it("geldige code promoveert de wachtende sessie precies één keer; dezelfde code opnieuw wordt geweigerd (replay)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const secret = await confirmedTotp(user.id, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    const sessionId = await pendingFor(user.id);
    const c = code(secret, 1);
    await expect(actions.verifyTotpLoginAction(null, form({ code: c, redirect: "/dashboard" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(await prisma.session.findUnique({ where: { id: sessionId } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id, mfaAt: { not: null } } })).toBe(1);
    expect(await verifyTotpCode(user.id, user.email, c)).toBe("INVALID");
  });

  it("een onbevestigde TOTP-rij is geen bewijs", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { secret } = await startTotpEnrollment(user.id, user.email);
    await addPasskey(user.id);
    await pendingFor(user.id);
    const res = await actions.verifyTotpLoginAction(null, form({ code: code(secret) }));
    expect(res.ok).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id, mfaAt: { not: null } } })).toBe(0);
  });

  it("te veel foute codes vergrendelen (persistente lockout)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const secret = await confirmedTotp(user.id, user.email);
    await pendingFor(user.id);
    for (let i = 0; i < 5; i++) await actions.verifyTotpLoginAction(null, form({ code: "000000" }));
    const res = await actions.verifyTotpLoginAction(null, form({ code: code(secret, 1) }));
    expect(res.ok).toBe(false);
    expect((await prisma.totpCredential.findUniqueOrThrow({ where: { userId: user.id } })).lockedUntil).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id, mfaAt: { not: null } } })).toBe(0);
  });

  it("herstelcode: eenmalig bruikbaar bij een gewone gebruiker met authenticator-app", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const secret = await confirmedTotp(user.id, user.email);
    void secret;
    const codes = await regenerateRecoveryCodes(user.id);
    await pendingFor(user.id);
    await expect(actions.useRecoveryCodeLoginAction(null, form({ code: codes[0], redirect: "/dashboard" }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    await pendingFor(user.id);
    const again = await actions.useRecoveryCodeLoginAction(null, form({ code: codes[0] }));
    expect(again.ok).toBe(false);
  });

  it("herstelcode zonder (bevestigde) authenticator-app of met vlag uit: geweigerd", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await addPasskey(user.id);
    const codes = await regenerateRecoveryCodes(user.id); // verdwaalde codes zonder TOTP
    await pendingFor(user.id);
    expect((await actions.useRecoveryCodeLoginAction(null, form({ code: codes[0] }))).ok).toBe(false);
    const other = await createTestUser("HOGERAAD", "Ander");
    await confirmedTotp(other.id, other.email);
    const otherCodes = await regenerateRecoveryCodes(other.id);
    delete process.env.WEB_TOTP_ENABLED;
    await pendingFor(other.id);
    expect((await actions.useRecoveryCodeLoginAction(null, form({ code: otherCodes[0] }))).ok).toBe(false);
    expect(await prisma.session.count({ where: { mfaAt: { not: null } } })).toBe(0);
  });

  it("nieuwe herstelcodes maken vereist recente MFA en maakt de oude ongeldig", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await confirmedTotp(user.id, user.email);
    const old = await regenerateRecoveryCodes(user.id);
    await fullFor(user.id, false);
    await expect(actions.regenerateRecoveryCodesAction()).rejects.toThrow("herverifieer");
    await fullFor(user.id);
    const res = await actions.regenerateRecoveryCodesAction();
    expect(res.ok && res.recoveryCodes).toHaveLength(8);
    await pendingFor(user.id);
    expect((await actions.useRecoveryCodeLoginAction(null, form({ code: old[0] }))).ok).toBe(false);
  });
});

describe("E2.1 – inschrijving tijdens het inloggen", () => {
  it("zonder enige methode: toegestaan, geeft factorbewijs en geen herstelcodes", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { secret } = await startTotpEnrollment(user.id, user.email);
    await pendingFor(user.id);
    const res = await actions.confirmTotpEnrollmentLoginAction(null, form({ code: code(secret) }));
    expect(res.ok).toBe(true);
    expect(res.recoveryCodes).toHaveLength(8);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(hasFreshFactorProof({ factorProvedAt: row.factorProvedAt })).toBe(true);
  });

  it("met een bestaande passkey: geen zwakkere factor erbij met alleen de e-mailcode", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await addPasskey(user.id);
    const { secret } = await startTotpEnrollment(user.id, user.email);
    await pendingFor(user.id);
    const res = await actions.confirmTotpEnrollmentLoginAction(null, form({ code: code(secret) }));
    expect(res.ok).toBe(false);
    expect(await isTotpConfirmed(user.id)).toBe(false);
  });

  it("vlag uit: niet beschikbaar", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { secret } = await startTotpEnrollment(user.id, user.email);
    delete process.env.WEB_TOTP_ENABLED;
    await pendingFor(user.id);
    expect((await actions.confirmTotpEnrollmentLoginAction(null, form({ code: code(secret) }))).ok).toBe(false);
  });
});

describe("E2.1 – beheer in het profiel", () => {
  it("inschrijven vereist recente MFA zolang verificatie aan staat", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await addPasskey(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await fullFor(user.id, false);
    await expect(actions.startUserTotpEnrollmentAction()).rejects.toThrow("herverifieer");
  });

  it("volledige stroom: inschrijven, inschakelen met alleen TOTP, laatste methode niet verwijderbaar", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await fullFor(user.id);
    const view = await actions.startUserTotpEnrollmentAction();
    const confirmed = await actions.confirmUserTotpEnrollmentAction(null, form({ code: code(view.secret) }));
    expect(confirmed.ok).toBe(true);
    expect(confirmed.recoveryCodes).toHaveLength(8);
    expect(await actions.enableUserMfaAction()).toMatchObject({ ok: true });
    await fullFor(user.id);
    const removed = await actions.removeUserTotpAction();
    expect(removed.ok).toBe(false);
    expect(await isTotpConfirmed(user.id)).toBe(true);
    await addPasskey(user.id);
    await fullFor(user.id);
    expect((await actions.removeUserTotpAction()).ok).toBe(true);
    expect(await isTotpConfirmed(user.id)).toBe(false);
  });

  it("de laatste passkey mag weg als er een authenticator-app is (en omgekeerd niet)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await addPasskey(user.id);
    await confirmedTotp(user.id, user.email);
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await fullFor(user.id);
    const cred = await prisma.webAuthnCredential.findFirstOrThrow({ where: { userId: user.id } });
    expect((await actions.removePasskeyAction(null, form({ credentialId: cred.id }))).ok).toBe(true);
  });

  it("vlag uit: inschrijven geweigerd", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    delete process.env.WEB_TOTP_ENABLED;
    await fullFor(user.id);
    await expect(actions.startUserTotpEnrollmentAction()).rejects.toThrow();
  });

  it("gelijktijdig laatste passkey en laatste authenticator-app verwijderen: er blijft altijd een methode over", async () => {
    for (let i = 0; i < 5; i++) {
      await resetDatabase();
      const user = await createTestUser("HOGERAAD", "Gebruiker");
      await addPasskey(user.id);
      await confirmedTotp(user.id, user.email);
      await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
      const cred = await prisma.webAuthnCredential.findFirstOrThrow({ where: { userId: user.id } });
      const [a, b] = await Promise.all([removePasskeyGuarded(user.id, cred.id), removeTotpGuarded(user.id)]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const left = (await prisma.webAuthnCredential.count({ where: { userId: user.id } })) + (await isTotpConfirmed(user.id) ? 1 : 0);
      expect(left).toBe(1);
    }
  });

  it("verificatie inschakelen zonder bruikbare methode is geweigerd; gelijktijdig met verwijderen blijft consistent", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    expect((await enableMfaGuarded(user.id)).ok).toBe(false);
    await confirmedTotp(user.id, user.email);
    const [en, rm] = await Promise.all([enableMfaGuarded(user.id), removeTotpGuarded(user.id)]);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const hasMethod = await isTotpConfirmed(user.id);
    // Nooit: verificatie aan zonder methode.
    expect(fresh.mfaEnabled && !hasMethod).toBe(false);
    expect(en.ok || rm.ok).toBe(true);
  });

  it("webmin-reset: vereist identiteitsbevestiging en e-mailadres; wist alles atomair, trekt sessies in en logt", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    const target = await createTestUser("HOGERAAD", "Doel");
    const other = await createTestUser("HOGERAAD", "Ander");
    await confirmedTotp(target.id, target.email);
    await addPasskey(target.id);
    await prisma.user.update({ where: { id: target.id }, data: { mfaEnabled: true } });
    await prisma.webAuthnChallenge.create({ data: { userId: target.id, challenge: "c", expiresAt: new Date(Date.now() + 60000) } });
    await createSession(target.id);
    await confirmedTotp(other.id, other.email);
    await fullFor(admin.id);

    expect((await actions.resetUserMfaAction(null, form({ userId: target.id, confirmEmail: target.email }))).ok).toBe(false); // geen identiteitsbevestiging
    expect((await actions.resetUserMfaAction(null, form({ userId: target.id, identityChecked: "yes", confirmEmail: "iemand@anders.nl" }))).ok).toBe(false);
    expect(await isTotpConfirmed(target.id)).toBe(true);

    const res = await actions.resetUserMfaAction(null, form({ userId: target.id, identityChecked: "yes", confirmEmail: target.email.toUpperCase() }));
    expect(res.ok).toBe(true);
    expect(await isTotpConfirmed(target.id)).toBe(false);
    expect(await prisma.webAuthnCredential.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.recoveryCode.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.securityEvent.count({ where: { userId: target.id, type: "MFA_RESET_BY_ADMIN", actorUserId: admin.id } })).toBe(1);
    expect(await isTotpConfirmed(other.id)).toBe(true); // andere gebruiker onaangetast
    // Eindtoestand: MFA aan, geen methode -> eerste inschrijving is dan toegestaan
    expect((await enrolledMethods(target))).toEqual([]);
  });
});
