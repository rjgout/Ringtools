import crypto from "crypto";
import http2 from "http2";
import { env } from "./env";

/**
 * Pushmeldingen naar de native iOS/Android-app (Capacitor): APNs voor iOS en
 * Firebase Cloud Messaging (HTTP v1) voor Android. Sleutels komen uitsluitend uit
 * environment variables; zonder configuratie is de betreffende provider uit en
 * slaat de server die apparaten over (Web Push blijft gewoon werken).
 *
 * De payload bevat alleen generieke tekst en een intern pad (`url`), nooit namen,
 * functies of stemresultaten.
 */

export type NativePayload = { title: string; body: string; url: string; tag?: string };
export type NativeResult = "ok" | "invalid-token" | "error";

export type NativeTransport = {
  /** POST met JSON naar een https-URL; geeft status en JSON-body (of null) terug. */
  postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: unknown }>;
  /** POST via HTTP/2 (APNs). */
  http2Post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; json: unknown }>;
};

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export const defaultTransport: NativeTransport = {
  async postJson(url, headers, body) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* lege respons */
    }
    return { status: res.status, json };
  },
  http2Post(origin, path, headers, body) {
    return new Promise((resolve, reject) => {
      const client = http2.connect(origin);
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error("APNs timeout"));
      }, 10_000);
      client.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      const req = client.request({ ":method": "POST", ":path": path, ...headers });
      let status = 0;
      let data = "";
      req.on("response", (h) => (status = Number(h[":status"] ?? 0)));
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        clearTimeout(timer);
        client.close();
        let json: unknown = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          /* geen JSON */
        }
        resolve({ status, json });
      });
      req.on("error", (err) => {
        clearTimeout(timer);
        client.destroy();
        reject(err);
      });
      req.end(body);
    });
  },
};

// ---- FCM (Android) ----

let fcmToken: { value: string; expiresAt: number } | null = null;

async function fcmAccessToken(sa: { client_email: string; private_key: string }, transport: NativeTransport): Promise<string> {
  if (fcmToken && fcmToken.expiresAt > Date.now() + 60_000) return fcmToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })
  );
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claim}`), sa.private_key).toString("base64url");
  const res = await transport.postJson("https://oauth2.googleapis.com/token", {}, {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${header}.${claim}.${signature}`,
  });
  const json = res.json as { access_token?: string; expires_in?: number } | null;
  if (res.status !== 200 || !json?.access_token) throw new Error(`FCM-token ophalen mislukt (status ${res.status})`);
  fcmToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return fcmToken.value;
}

export async function sendFcm(token: string, payload: NativePayload, transport: NativeTransport = defaultTransport): Promise<NativeResult> {
  const fcm = env.fcm;
  if (!fcm) return "error";
  const access = await fcmAccessToken(fcm.serviceAccount, transport);
  const res = await transport.postJson(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcm.projectId)}/messages:send`,
    { Authorization: `Bearer ${access}` },
    {
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url },
        android: { ...(payload.tag ? { collapse_key: payload.tag } : {}), notification: { channel_id: "default" } },
      },
    }
  );
  if (res.status === 200) return "ok";
  const error = (res.json as { error?: { status?: string } } | null)?.error?.status;
  return res.status === 404 || error === "UNREGISTERED" || error === "INVALID_ARGUMENT" ? "invalid-token" : "error";
}

// ---- APNs (iOS) ----

let apnsJwt: { value: string; issuedAt: number } | null = null;

function apnsAuthToken(apns: { keyP8: string; keyId: string; teamId: string }): string {
  // APNs vereist een vers token tussen 20 en 60 minuten oud.
  if (apnsJwt && Date.now() - apnsJwt.issuedAt < 40 * 60_000) return apnsJwt.value;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: apns.keyId }));
  const claim = b64url(JSON.stringify({ iss: apns.teamId, iat: Math.floor(Date.now() / 1000) }));
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claim}`), { key: apns.keyP8, dsaEncoding: "ieee-p1363" }).toString("base64url");
  apnsJwt = { value: `${header}.${claim}.${signature}`, issuedAt: Date.now() };
  return apnsJwt.value;
}

export async function sendApns(token: string, payload: NativePayload, transport: NativeTransport = defaultTransport): Promise<NativeResult> {
  const apns = env.apns;
  if (!apns) return "error";
  const body = JSON.stringify({ aps: { alert: { title: payload.title, body: payload.body }, sound: "default" }, url: payload.url });
  const res = await transport.http2Post(
    apns.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com",
    `/3/device/${encodeURIComponent(token)}`,
    {
      authorization: `bearer ${apnsAuthToken(apns)}`,
      "apns-topic": apns.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      ...(payload.tag ? { "apns-collapse-id": payload.tag.slice(0, 64) } : {}),
      "content-type": "application/json",
    },
    body
  );
  if (res.status === 200) return "ok";
  const reason = (res.json as { reason?: string } | null)?.reason;
  return res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic" ? "invalid-token" : "error";
}

export function nativePushStatus() {
  return { fcm: env.fcm !== null, apns: env.apns !== null };
}

/** Voor tests: wist de gecachte tokens. */
export function resetNativePushCaches() {
  fcmToken = null;
  apnsJwt = null;
}
