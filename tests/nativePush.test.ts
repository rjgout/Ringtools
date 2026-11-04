import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { resetDatabase, createTestUser } from "./setup";

const sendFcmMock = vi.fn();
const sendApnsMock = vi.fn();
vi.mock("@/lib/nativePush", async (original) => ({
  ...(await original<typeof import("@/lib/nativePush")>()),
  sendFcm: (...a: unknown[]) => sendFcmMock(...a),
  sendApns: (...a: unknown[]) => sendApnsMock(...a),
}));
const webPushMock = vi.fn();
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => webPushMock(...a) } }));

const real = await vi.importActual<typeof import("@/lib/nativePush")>("@/lib/nativePush");
const { sendPushToUser, webSubscriptionCoveredByNative } = await import("@/lib/push");

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const saJson = JSON.stringify({
  project_id: "ringtools-test",
  client_email: "svc@ringtools-test.iam.gserviceaccount.com",
  private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const p8 = ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130";

function configure() {
  process.env.FCM_SERVICE_ACCOUNT_JSON = saJson;
  process.env.APNS_KEY_P8 = p8;
  process.env.APNS_KEY_ID = "ABC123DEFG";
  process.env.APNS_TEAM_ID = "TEAM123456";
  process.env.APNS_BUNDLE_ID = "nl.example.app";
}
function unconfigure() {
  for (const k of ["FCM_SERVICE_ACCOUNT_JSON", "APNS_KEY_P8", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) delete process.env[k];
}

beforeEach(async () => {
  await resetDatabase();
  sendFcmMock.mockReset();
  sendApnsMock.mockReset();
  webPushMock.mockReset();
  real.resetNativePushCaches();
});
afterEach(unconfigure);

describe("Providers (FCM en APNs) met geïnjecteerde transport", () => {
  it("zonder configuratie doen de providers niets", async () => {
    unconfigure();
    expect(real.nativePushStatus()).toEqual({ fcm: false, apns: false });
    const transport = { postJson: vi.fn(), http2Post: vi.fn() };
    expect(await real.sendFcm("t".repeat(30), { title: "a", body: "b", url: "/x" }, transport)).toBe("error");
    expect(await real.sendApns("t".repeat(30), { title: "a", body: "b", url: "/x" }, transport)).toBe("error");
    expect(transport.postJson).not.toHaveBeenCalled();
  });

  it("FCM: haalt eerst een OAuth-token (JWT RS256), verstuurt generieke tekst en herkent een ongeldig token", async () => {
    configure();
    const postJson = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: { access_token: "ya29.test", expires_in: 3600 } })
      .mockResolvedValueOnce({ status: 200, json: { name: "m1" } })
      .mockResolvedValueOnce({ status: 404, json: { error: { status: "UNREGISTERED" } } });
    const transport = { postJson, http2Post: vi.fn() };
    expect(await real.sendFcm("tok-" + "a".repeat(30), { title: "Nieuw voorstel", body: "Er staat iets klaar.", url: "/roepingen/abc", tag: "calling-1" }, transport)).toBe("ok");
    const [tokenUrl, , tokenBody] = postJson.mock.calls[0];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    const [h, c, sig] = (tokenBody as { assertion: string }).assertion.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString()).iss).toBe("svc@ringtools-test.iam.gserviceaccount.com");
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), rsa.publicKey, Buffer.from(sig, "base64url"))).toBe(true);

    const [sendUrl, sendHeaders, sendBody] = postJson.mock.calls[1];
    expect(sendUrl).toBe("https://fcm.googleapis.com/v1/projects/ringtools-test/messages:send");
    expect(sendHeaders).toEqual({ Authorization: "Bearer ya29.test" });
    expect(sendBody.message.data).toEqual({ url: "/roepingen/abc" });
    expect(sendBody.message.android.collapse_key).toBe("calling-1");

    // Tweede verzending hergebruikt het gecachte OAuth-token en meldt een ongeldig token.
    expect(await real.sendFcm("tok-" + "b".repeat(30), { title: "a", body: "b", url: "/x" }, transport)).toBe("invalid-token");
    expect(postJson).toHaveBeenCalledTimes(3);
  });

  it("APNs: ES256-JWT, juiste topic/endpoint en herkenning van een ongeldig token", async () => {
    configure();
    const http2Post = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, json: null })
      .mockResolvedValueOnce({ status: 400, json: { reason: "BadDeviceToken" } })
      .mockResolvedValueOnce({ status: 500, json: { reason: "InternalServerError" } });
    const transport = { postJson: vi.fn(), http2Post };
    const payload = { title: "Nieuw voorstel", body: "Er staat iets klaar.", url: "/roepingen/abc" };
    expect(await real.sendApns("ab".repeat(32), payload, transport)).toBe("ok");
    const [origin, path, headers, body] = http2Post.mock.calls[0];
    expect(origin).toBe("https://api.push.apple.com");
    expect(path).toBe(`/3/device/${"ab".repeat(32)}`);
    expect(headers["apns-topic"]).toBe("nl.example.app");
    const [h, c, sig] = (headers.authorization as string).replace("bearer ", "").split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString()).iss).toBe("TEAM123456");
    expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
    expect(JSON.parse(body as string)).toEqual({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default" }, url: "/roepingen/abc" });

    expect(await real.sendApns("cd".repeat(32), payload, transport)).toBe("invalid-token");
    expect(await real.sendApns("ef".repeat(32), payload, transport)).toBe("error");
  });
});

describe("sendPushToUser met native apparaten", () => {
  it("stuurt via de juiste provider, slaat inactieve apparaten over en ruimt ongeldige tokens op", async () => {
    configure();
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await prisma.devicePushToken.createMany({
      data: [
        { userId: user.id, token: "ios-token-" + "a".repeat(30), platform: "ios", provider: "apns" },
        { userId: user.id, token: "and-token-" + "b".repeat(30), platform: "android", provider: "fcm" },
        { userId: user.id, token: "off-token-" + "c".repeat(30), platform: "android", provider: "fcm", active: false },
        { userId: user.id, token: "bad-token-" + "d".repeat(30), platform: "android", provider: "fcm" },
      ],
    });
    sendApnsMock.mockResolvedValue("ok");
    sendFcmMock.mockImplementation(async (token: string) => (token.startsWith("bad-") ? "invalid-token" : "ok"));
    const delivered = await sendPushToUser(user.id, { title: "T", body: "B", url: "https://evil.example/x" });
    expect(delivered).toBe(2);
    expect(sendApnsMock).toHaveBeenCalledTimes(1);
    expect(sendFcmMock).toHaveBeenCalledTimes(2); // actief android + bad; het inactieve apparaat niet
    expect(sendFcmMock.mock.calls[0][1].url).toBe("/dashboard"); // externe URL wordt nooit doorgegeven
    expect(JSON.stringify(sendFcmMock.mock.calls)).not.toContain(user.email);
    expect(await prisma.devicePushToken.count({ where: { token: { startsWith: "bad-" } } })).toBe(0);
    expect(await prisma.devicePushToken.count({ where: { token: { startsWith: "off-" } } })).toBe(1);
  });

  it("zonder provider-configuratie worden native apparaten overgeslagen zonder fout", async () => {
    unconfigure();
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await prisma.devicePushToken.create({ data: { userId: user.id, token: "ios-token-" + "a".repeat(30), platform: "ios", provider: "apns" } });
    expect(await sendPushToUser(user.id, { title: "T", body: "B" })).toBe(0);
    expect(sendApnsMock).not.toHaveBeenCalled();
  });

  it("Web Push blijft ongewijzigd werken en dubbele meldingen op dezelfde telefoon worden voorkomen", async () => {
    configure();
    process.env.VAPID_PUBLIC_KEY = "BPublicKey";
    process.env.VAPID_PRIVATE_KEY = "privateKey";
    process.env.VAPID_SUBJECT = "mailto:test@example.nl";
    const user = await createTestUser("HOGERAAD", "Gebruiker");
    await prisma.devicePushToken.create({ data: { userId: user.id, token: "ios-token-" + "a".repeat(30), platform: "ios", provider: "apns" } });
    await prisma.pushSubscription.createMany({
      data: [
        { userId: user.id, endpoint: "https://web.push.apple.com/iphone", p256dh: "k", auth: "a", userAgent: IOS_UA },
        { userId: user.id, endpoint: "https://fcm.googleapis.com/fcm/send/desktop", p256dh: "k", auth: "a", userAgent: DESKTOP_UA },
      ],
    });
    sendApnsMock.mockResolvedValue("ok");
    webPushMock.mockResolvedValue({});
    const delivered = await sendPushToUser(user.id, { title: "T", body: "B", url: "/dashboard" });
    expect(delivered).toBe(2); // 1 native iPhone + 1 desktopbrowser
    expect(webPushMock).toHaveBeenCalledTimes(1);
    expect((webPushMock.mock.calls[0][0] as { endpoint: string }).endpoint).toContain("desktop");
  });

  it("webSubscriptionCoveredByNative: alleen hetzelfde mobiele platform telt als gedekt", () => {
    expect(webSubscriptionCoveredByNative(IOS_UA, new Set(["ios"]))).toBe(true);
    expect(webSubscriptionCoveredByNative(IOS_UA, new Set(["android"]))).toBe(false);
    expect(webSubscriptionCoveredByNative("Mozilla/5.0 (Linux; Android 15)", new Set(["android"]))).toBe(true);
    expect(webSubscriptionCoveredByNative(DESKTOP_UA, new Set(["ios", "android"]))).toBe(false);
    expect(webSubscriptionCoveredByNative(null, new Set(["ios"]))).toBe(false);
  });
});
