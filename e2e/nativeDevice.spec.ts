import { test, expect, type APIRequestContext } from "@playwright/test";
import crypto from "crypto";
import { prisma } from "../src/lib/prisma";
import { createVerifiedSession } from "../src/lib/auth";
import { enrollmentMessage } from "../src/lib/deviceEnrollment";
import { createE2eUser } from "./helpers/data";

/**
 * E2.4a/E2.5 – toestelroutes van de mobiele API tegen de echte server. Draait met `E2E_NATIVE_DEVICE=off|login|auto`
 * (de server moet met dezelfde vlaggen draaien):
 *   off   = NATIVE_DEVICE_LOGIN_ENABLED en NATIVE_DEVICE_AUTO_ENROLL_ENABLED uit
 *   login = alleen NATIVE_DEVICE_LOGIN_ENABLED (E2.4a) aan, automatische inrichting uit
 *   auto  = beide aan
 * Een test die de modus niet kan vaststellen faalt (geen stille skip): de eerste test vergelijkt de verwachting met /meta van de server.
 */
const MODE = process.env.E2E_NATIVE_DEVICE as "off" | "login" | "auto" | undefined;
test.skip(!MODE, "Zet E2E_NATIVE_DEVICE=off|login|auto (en start de server met dezelfde vlaggen; TRUSTED_DEVICES_ENABLED=true voor login/auto).");

const API = "/api/mobile/v1";
const sign = (k: crypto.KeyObject, m: string) => crypto.sign("sha256", Buffer.from(m), { key: k, dsaEncoding: "der" }).toString("base64");

async function seed(name: string, mfaEnabled = true) {
  const { user } = await createE2eUser("RINGSECRETARIS", name, { mfaEnabled });
  await prisma.user.update({ where: { id: user.id }, data: { activatedAt: new Date() } });
  const { rawToken } = await createVerifiedSession(user.id);
  return { user, token: rawToken };
}
const post = (request: APIRequestContext, path: string, token: string | null, data: unknown = {}) =>
  request.post(`${API}${path}`, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("serverconfiguratie komt overeen met de verwachte testmodus (geen ongeldige vlagcombinatie)", async ({ request }) => {
  const meta = await (await request.get(`${API}/meta`)).json();
  expect({ deviceLogin: !!meta.deviceLogin, deviceAutoEnroll: !!meta.deviceAutoEnroll }).toEqual({
    deviceLogin: MODE !== "off",
    deviceAutoEnroll: MODE === "auto",
  });
  if (MODE !== "off") expect(meta.trustedDevices).toBe(true); // E2.4a/E2.5 vereisen vertrouwde toestellen
});

test("zonder sessie zijn de inrichtingsroutes nooit bereikbaar", async ({ request }) => {
  for (const p of ["/auth/device/enroll/challenge", "/auth/device/enroll/complete", "/auth/device/disable"]) {
    expect((await post(request, p, null)).status()).toBe(401);
  }
});

test("inrichting: bereikbaar alleen met de automatische vlag; volledig pad en intrekken", async ({ request }) => {
  const { user, token } = await seed("Toestel Auto Een");
  const ch = await post(request, "/auth/device/enroll/challenge", token);
  if (MODE !== "auto") {
    expect(ch.ok()).toBe(false);
    expect(await prisma.deviceEnrollment.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.trustedDevice.count({ where: { userId: user.id } })).toBe(0);
    return;
  }
  expect(ch.status()).toBe(200);
  const c = await ch.json();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const installationId = crypto.randomBytes(16).toString("hex");
  const body = {
    enrollmentId: c.enrollmentId, installationId, platform: "IOS", label: "iPhone",
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    signature: sign(privateKey, enrollmentMessage({ id: c.enrollmentId, challenge: c.challenge }, user.id, installationId)),
  };
  // Ongeldige handtekening: niets geregistreerd
  const bad = await post(request, "/auth/device/enroll/complete", token, { ...body, signature: sign(crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey, "x") });
  expect(bad.ok()).toBe(false);
  expect(await prisma.trustedDevice.count({ where: { userId: user.id } })).toBe(0);
  const ok = await post(request, "/auth/device/enroll/complete", token, body);
  expect(ok.status()).toBe(200);
  const d = await prisma.trustedDevice.findFirstOrThrow({ where: { userId: user.id } });
  expect(d.loginEnabledAt).not.toBeNull();
  // Hergebruik van dezelfde inrichting mislukt
  expect((await post(request, "/auth/device/enroll/complete", token, body)).ok()).toBe(false);
  expect(await prisma.trustedDevice.count({ where: { userId: user.id } })).toBe(1);
  // Uitzetten
  expect((await post(request, "/auth/device/disable", token, { installationId })).status()).toBe(200);
  expect((await prisma.trustedDevice.findUniqueOrThrow({ where: { id: d.id } })).loginEnabledAt).toBeNull();
});

test("account zonder verplichte MFA kan geen toestel inrichten (server beslist, ongeacht de interface)", async ({ request }) => {
  const { user, token } = await seed("Toestel Zonder Mfa", false);
  expect((await post(request, "/auth/device/enroll/challenge", token)).ok()).toBe(false);
  expect(await prisma.deviceEnrollment.count({ where: { userId: user.id } })).toBe(0);
});

test("inloggen met toestel: route volgt de login-vlag; onbekend toestel krijgt geen challenge-uitkomst die iets verraadt", async ({ request }) => {
  const r = await post(request, "/auth/device/challenge", null, { installationId: crypto.randomBytes(16).toString("hex") });
  if (MODE === "off") expect(r.ok()).toBe(false);
  else {
    const r2 = await post(request, "/auth/device/challenge", null, { installationId: crypto.randomBytes(16).toString("hex") });
    expect(r.status()).toBe(r2.status());
  }
});
