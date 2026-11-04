import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createSession, getSessionAwaitingMfa, markSessionFactorProved, hasFreshFactorProof, FACTOR_PROOF_TTL_MS } from "@/lib/auth";
import { mayEnrollFirstFactorWhilePending, type MfaActor } from "@/lib/mfaActor";
import { encryptSecret } from "@/lib/crypto";
import { resetDatabase, createTestUser } from "./setup";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session", () => ({ getAwaitingMfaUser: vi.fn(), getCurrentSession: vi.fn() }));

beforeEach(async () => {
  await resetDatabase();
});

function pendingActor(userId: string): MfaActor {
  return { userId, sessionId: "s", mode: "pending", mfaAt: null, email: "x@y.nl", name: "X", mfaRequired: true };
}

describe("Wachtende sessie: bewijs van een tweede factor", () => {
  it("een nieuwe wachtende sessie heeft geen factorbewijs", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const { rawToken } = await createSession(user.id);
    const awaiting = await getSessionAwaitingMfa(rawToken);
    expect(awaiting).not.toBeNull();
    expect(awaiting!.factorProvedAt).toBeNull();
    expect(hasFreshFactorProof(awaiting!)).toBe(false);
  });

  it("markSessionFactorProved legt bewijs vast voor déze sessie, niet voor een andere", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    const a = await createSession(user.id);
    const b = await createSession(user.id);
    const awaitingA = (await getSessionAwaitingMfa(a.rawToken))!;
    await markSessionFactorProved(awaitingA.sessionId);
    expect(hasFreshFactorProof((await getSessionAwaitingMfa(a.rawToken))!)).toBe(true);
    expect(hasFreshFactorProof((await getSessionAwaitingMfa(b.rawToken))!)).toBe(false);
  });

  it("verouderd bewijs telt niet mee", () => {
    const old = new Date(Date.now() - FACTOR_PROOF_TTL_MS - 1000);
    expect(hasFreshFactorProof({ factorProvedAt: old })).toBe(false);
    expect(hasFreshFactorProof({ factorProvedAt: new Date() })).toBe(true);
    expect(hasFreshFactorProof({ factorProvedAt: null })).toBe(false);
  });
});

describe("Passkey inschrijven vanuit een wachtende sessie", () => {
  it("is toegestaan voor een gebruiker zonder tweede factor (eerste inschrijving)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    expect(await mayEnrollFirstFactorWhilePending(pendingActor(user.id))).toBe(true);
  });

  it("is geweigerd als de gebruiker al een passkey heeft", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await prisma.webAuthnCredential.create({ data: { userId: user.id, credentialId: "cred-1", publicKey: Buffer.from([1, 2, 3]) } });
    expect(await mayEnrollFirstFactorWhilePending(pendingActor(user.id))).toBe(false);
  });

  it("is geweigerd voor het adminaccount, ook zonder TOTP", async () => {
    const admin = await createTestUser("ADMIN", "Webmin");
    expect(await mayEnrollFirstFactorWhilePending(pendingActor(admin.id))).toBe(false);
  });

  it("is geweigerd als de gebruiker een bevestigde TOTP heeft", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await prisma.totpCredential.create({ data: { userId: user.id, secretEncrypted: encryptSecret("JBSWY3DPEHPK3PXP"), confirmedAt: new Date() } });
    expect(await mayEnrollFirstFactorWhilePending(pendingActor(user.id))).toBe(false);
  });

  it("legt een volledig ingelogde sessie geen beperking op (eigen step-up-regels)", async () => {
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    expect(await mayEnrollFirstFactorWhilePending({ ...pendingActor(user.id), mode: "full" })).toBe(true);
  });
});
