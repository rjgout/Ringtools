import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import http2 from "http2";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
  private_key_id: "key-id-123",
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
  for (const k of ["FCM_SERVICE_ACCOUNT_JSON", "FCM_SERVICE_ACCOUNT_FILE", "APNS_KEY_P8_FILE", "APNS_PRODUCTION", "APNS_KEY_P8", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) delete process.env[k];
}

beforeEach(async () => {
  await resetDatabase();
  sendFcmMock.mockReset();
  sendApnsMock.mockReset();
  webPushMock.mockReset();
  real.resetNativePushCaches();
});
afterEach(unconfigure);

function makeTransport() {
  return { postJson: vi.fn(), postForm: vi.fn(), http2Post: vi.fn() };
}
const FCM_PAYLOAD = { title: "Nieuw voorstel", body: "Er staat iets klaar.", url: "/roepingen/abc", tag: "calling-1" };
const tokenOk = (token = "ya29.test", expires_in = 3600) => ({ status: 200, json: { access_token: token, expires_in } });

describe("Providers (FCM en APNs) met geïnjecteerde transport", () => {
  it("zonder configuratie doen de providers niets", async () => {
    unconfigure();
    expect(real.nativePushStatus()).toEqual({ fcm: false, apns: false });
    const transport = makeTransport();
    expect(await real.sendFcm("t".repeat(30), { title: "a", body: "b", url: "/x" }, transport)).toBe("error");
    expect(await real.sendApns("t".repeat(30), { title: "a", body: "b", url: "/x" }, transport)).toBe("error");
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(transport.postForm).not.toHaveBeenCalled();
  });

  it("FCM: tokenaanvraag volgt de Google-serviceaccountflow (JWT bearer, kid, aud, scope, ≤ 1 uur)", async () => {
    configure();
    const t = makeTransport();
    t.postForm.mockResolvedValue(tokenOk());
    t.postJson.mockResolvedValue({ status: 200, json: { name: "m1" } });
    expect(await real.sendFcm("tok-" + "a".repeat(30), FCM_PAYLOAD, t)).toBe("ok");

    expect(t.postForm).toHaveBeenCalledTimes(1);
    const [url, params] = t.postForm.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.keys(params).sort()).toEqual(["assertion", "grant_type"]);
    expect(params.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [h, c, sig] = params.assertion.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT", kid: "key-id-123" });
    const claim = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claim).toMatchObject({ iss: "svc@ringtools-test.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token" });
    expect(claim.exp - claim.iat).toBeLessThanOrEqual(3600);
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${c}`), rsa.publicKey, Buffer.from(sig, "base64url"))).toBe(true);

    const [sendUrl, sendHeaders, sendBody] = t.postJson.mock.calls[0];
    expect(sendUrl).toBe("https://fcm.googleapis.com/v1/projects/ringtools-test/messages:send");
    expect(sendHeaders).toEqual({ Authorization: "Bearer ya29.test" });
    expect(sendBody.message.data).toEqual({ url: "/roepingen/abc" });
    expect(sendBody.message.android.collapse_key).toBe("calling-1");
  });

  it("de echte transport verstuurt de tokenaanvraag als application/x-www-form-urlencoded (niet als JSON)", async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: "ya29.x", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const res = await real.defaultTransport.postForm("https://oauth2.googleapis.com/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: "a.b.c",
      });
      expect(res.status).toBe(200);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" });
      expect(init.body).toBe("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=a.b.c");
      expect(() => JSON.parse(init.body as string)).toThrow(); // geen JSON-body
      const parsed = new URLSearchParams(init.body as string);
      expect(parsed.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("de echte JSON-transport stuurt het FCM-bericht als JSON met Authorization-header", async () => {
    const fetchMock = vi.fn(async () => Response.json({ name: "m" }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await real.defaultTransport.postJson("https://fcm.googleapis.com/v1/projects/p/messages:send", { Authorization: "Bearer t" }, { message: { token: "x" } });
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer t" });
      expect(JSON.parse(init.body as string)).toEqual({ message: { token: "x" } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("FCM: het toegangstoken wordt gecachet en pas vernieuwd kort vóór het verloopt", async () => {
    configure();
    vi.useFakeTimers();
    try {
      const t = makeTransport();
      t.postForm.mockResolvedValueOnce(tokenOk("tok-1", 3600)).mockResolvedValueOnce(tokenOk("tok-2", 3600));
      t.postJson.mockResolvedValue({ status: 200, json: {} });
      await real.sendFcm("a".repeat(30), FCM_PAYLOAD, t);
      await real.sendFcm("b".repeat(30), FCM_PAYLOAD, t);
      expect(t.postForm).toHaveBeenCalledTimes(1); // hergebruikt
      vi.advanceTimersByTime(3600 * 1000 - 30_000); // < 60 s over → vernieuwen
      await real.sendFcm("c".repeat(30), FCM_PAYLOAD, t);
      expect(t.postForm).toHaveBeenCalledTimes(2);
      expect(t.postJson.mock.calls[2][1]).toEqual({ Authorization: "Bearer tok-2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("FCM: bij 401 wordt het token één keer vernieuwd en het bericht opnieuw verstuurd", async () => {
    configure();
    const t = makeTransport();
    t.postForm.mockResolvedValueOnce(tokenOk("old")).mockResolvedValueOnce(tokenOk("new"));
    t.postJson.mockResolvedValueOnce({ status: 401, json: { error: { status: "UNAUTHENTICATED" } } }).mockResolvedValueOnce({ status: 200, json: {} });
    expect(await real.sendFcm("a".repeat(30), FCM_PAYLOAD, t)).toBe("ok");
    expect(t.postForm).toHaveBeenCalledTimes(2);
    expect(t.postJson.mock.calls[1][1]).toEqual({ Authorization: "Bearer new" });
    // een blijvende 401 leidt niet tot een lus
    t.postJson.mockResolvedValue({ status: 401, json: {} });
    t.postForm.mockResolvedValue(tokenOk("again"));
    expect(await real.sendFcm("b".repeat(30), FCM_PAYLOAD, t)).toBe("error");
  });

  it("FCM: een mislukte tokenaanvraag geeft een fout, wordt niet gecachet en geen bericht verstuurd", async () => {
    configure();
    const t = makeTransport();
    t.postForm.mockResolvedValueOnce({ status: 400, json: { error: "invalid_grant" } }).mockResolvedValueOnce(tokenOk("ok-token"));
    await expect(real.sendFcm("a".repeat(30), FCM_PAYLOAD, t)).rejects.toThrow(/status 400, invalid_grant/);
    expect(t.postJson).not.toHaveBeenCalled();
    t.postJson.mockResolvedValue({ status: 200, json: {} });
    expect(await real.sendFcm("a".repeat(30), FCM_PAYLOAD, t)).toBe("ok"); // volgende poging probeert opnieuw
    expect(t.postForm).toHaveBeenCalledTimes(2);
  });

  it("FCM: gelijktijdige verzendingen delen één tokenaanvraag", async () => {
    configure();
    const t = makeTransport();
    let release!: () => void;
    t.postForm.mockImplementation(() => new Promise((r) => (release = () => r(tokenOk()))));
    t.postJson.mockResolvedValue({ status: 200, json: {} });
    const sends = Promise.all([1, 2, 3].map((i) => real.sendFcm(String(i).repeat(30), FCM_PAYLOAD, t)));
    await vi.waitFor(() => expect(t.postForm).toHaveBeenCalledTimes(1));
    release();
    expect(await sends).toEqual(["ok", "ok", "ok"]);
    expect(t.postForm).toHaveBeenCalledTimes(1);
  });

  it("FCM: alleen een onbekend token (404/UNREGISTERED) wordt als ongeldig gemeld; overige fouten blijven fout", async () => {
    configure();
    const t = makeTransport();
    t.postForm.mockResolvedValue(tokenOk());
    t.postJson
      .mockResolvedValueOnce({ status: 404, json: { error: { status: "NOT_FOUND" } } })
      .mockResolvedValueOnce({ status: 400, json: { error: { status: "INVALID_ARGUMENT" } } })
      .mockResolvedValueOnce({ status: 503, json: { error: { status: "UNAVAILABLE" } } })
      .mockResolvedValueOnce({ status: 400, json: { error: { status: "UNREGISTERED" } } });
    const results = [];
    for (const c of "abcd") results.push(await real.sendFcm(c.repeat(30), FCM_PAYLOAD, t));
    expect(results).toEqual(["invalid-token", "error", "error", "invalid-token"]);
  });

  it("APNs: ES256-JWT, juiste topic/endpoint en herkenning van een ongeldig token", async () => {
    configure();
    const t = makeTransport();
    t.http2Post
      .mockResolvedValueOnce({ status: 200, json: null })
      .mockResolvedValueOnce({ status: 400, json: { reason: "BadDeviceToken" } })
      .mockResolvedValueOnce({ status: 500, json: { reason: "InternalServerError" } });
    const payload = { title: "Nieuw voorstel", body: "Er staat iets klaar.", url: "/roepingen/abc" };
    expect(await real.sendApns("ab".repeat(32), payload, t)).toBe("ok");
    const [origin, path, headers, body] = t.http2Post.mock.calls[0];
    expect(origin).toBe("https://api.push.apple.com");
    expect(path).toBe(`/3/device/${"ab".repeat(32)}`);
    expect(headers["apns-topic"]).toBe("nl.example.app");
    expect(headers["apns-push-type"]).toBe("alert");
    const [h, c, sig] = (headers.authorization as string).replace("bearer ", "").split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString()).iss).toBe("TEAM123456");
    expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
    expect(JSON.parse(body as string)).toEqual({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default" }, url: "/roepingen/abc" });
    expect(await real.sendApns("cd".repeat(32), payload, t)).toBe("invalid-token");
    expect(await real.sendApns("ef".repeat(32), payload, t)).toBe("error");
  });

  it("APNs: production versus sandbox (TestFlight/App Store = production, Xcode-development = sandbox)", async () => {
    configure();
    const t = makeTransport();
    t.http2Post.mockResolvedValue({ status: 200, json: null });
    const payload = { title: "a", body: "b", url: "/x" };
    await real.sendApns("ab".repeat(32), payload, t); // standaard: production
    process.env.APNS_PRODUCTION = "false";
    await real.sendApns("ab".repeat(32), payload, t);
    delete process.env.APNS_PRODUCTION;
    expect(t.http2Post.mock.calls.map((c) => c[0])).toEqual(["https://api.push.apple.com", "https://api.sandbox.push.apple.com"]);
  });

  it("APNs: de echte HTTP/2-transport spreekt het protocol (pad, headers, body, statusafhandeling)", async () => {
    const received: { path?: string; headers?: Record<string, unknown>; body?: string } = {};
    const server = http2.createServer();
    server.on("stream", (stream, headers) => {
      received.path = String(headers[":path"]);
      received.headers = headers as Record<string, unknown>;
      let data = "";
      stream.on("data", (c) => (data += c));
      stream.on("end", () => {
        received.body = data;
        stream.respond({ ":status": 400, "content-type": "application/json" });
        stream.end(JSON.stringify({ reason: "BadDeviceToken" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await real.defaultTransport.http2Post(`http://127.0.0.1:${port}`, "/3/device/abc", { "apns-topic": "nl.example.app", "content-type": "application/json" }, '{"aps":{}}');
      expect(res).toEqual({ status: 400, json: { reason: "BadDeviceToken" } });
      expect(received.path).toBe("/3/device/abc");
      expect(received.headers?.[":method"]).toBe("POST");
      expect(received.headers?.["apns-topic"]).toBe("nl.example.app");
      expect(received.body).toBe('{"aps":{}}');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("sleutels kunnen uit bestanden komen (geen geheimen in env-variabelen of GitHub)", () => {
    unconfigure();
    const dir = mkdtempSync(join(tmpdir(), "push-"));
    try {
      writeFileSync(join(dir, "fcm.json"), saJson);
      writeFileSync(join(dir, "AuthKey.p8"), p8);
      process.env.FCM_SERVICE_ACCOUNT_FILE = join(dir, "fcm.json");
      process.env.APNS_KEY_P8_FILE = join(dir, "AuthKey.p8");
      process.env.APNS_KEY_ID = "ABC123DEFG";
      process.env.APNS_TEAM_ID = "TEAM123456";
      process.env.APNS_BUNDLE_ID = "nl.example.app";
      expect(real.nativePushStatus()).toEqual({ fcm: true, apns: true });
    } finally {
      delete process.env.FCM_SERVICE_ACCOUNT_FILE;
      delete process.env.APNS_KEY_P8_FILE;
      rmSync(dir, { recursive: true });
    }
    expect(real.nativePushStatus()).toEqual({ fcm: false, apns: false });
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
