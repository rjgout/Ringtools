import { createVerifiedSession, consumeLoginCode, rotateSessionIfDue, destroySession, mfaRequired } from "../auth";
import { rateLimit } from "../rateLimit";
import { emailSchema } from "../validation";
import { sendLoginMail } from "../loginMail";
import { resolveOpenLink } from "../openLinks";
import { authenticate, type ApiAuth } from "./auth";
import { ApiError, jsonResponse, errorResponse, readJson, str } from "./http";
import * as svc from "./service";

/** Verhoog bij een niet-achterwaarts-compatibele wijziging; de app toont dan een update-melding. */
export const API_VERSION = 1;
export const MIN_APP_VERSION = "1.0.0";

type Ctx = { request: Request; params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown>; auth: ApiAuth | null };
type Handler = (ctx: Ctx & { auth: ApiAuth }) => Promise<unknown>;
type PublicHandler = (ctx: Ctx) => Promise<unknown>;

type Route = { method: string; segments: string[]; auth: boolean; handler: PublicHandler };

const routes: Route[] = [];

function publicRoute(method: string, pattern: string, handler: PublicHandler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), auth: false, handler });
}

function authedRoute(method: string, pattern: string, handler: Handler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), auth: true, handler: handler as PublicHandler });
}

const ringOf = (ctx: Ctx) => ctx.query.get("ring") || str(ctx.body.ringId);

// ---- Inloggen (geen token nodig) ----

publicRoute("POST", "/auth/request-code", async ({ body }) => {
  const email = emailSchema.safeParse(body.email);
  if (!email.success) throw new ApiError(400, "Vul een geldig e-mailadres in.", "validation");
  const result = await sendLoginMail(email.data, null);
  if (!result.ok) throw new ApiError(429, result.message, "rate-limited");
  return { ok: true, message: result.message };
});

publicRoute("POST", "/auth/login", async ({ body }) => {
  const email = emailSchema.safeParse(body.email);
  const code = str(body.code).replace(/\s+/g, "");
  const invalid = new ApiError(401, "Deze code is onjuist of verlopen. Vraag zo nodig een nieuwe code aan.", "invalid-code");
  if (!email.success || !/^\d{8}$/.test(code)) throw invalid;

  if (!rateLimit(`login-code:${email.data}`, 10, 15 * 60 * 1000).allowed) {
    throw new ApiError(429, "Te veel pogingen. Probeer het later opnieuw.", "rate-limited");
  }
  const user = await consumeLoginCode(email.data, code);
  if (!user) throw invalid;
  if (user.role === "ADMIN") throw new ApiError(403, "Het beheerdersaccount gebruikt de webapp.", "admin-web-only");
  if (mfaRequired(user)) {
    throw new ApiError(
      403,
      "Voor jouw account is passkey-verificatie ingeschakeld. Inloggen met een passkey wordt in de app nog niet ondersteund. Log voorlopig in via de webapp; je beveiliging blijft ongewijzigd.",
      "mfa-not-supported"
    );
  }
  const device = str(body.deviceName).slice(0, 60).replace(/[^\p{L}\p{N} ._-]/gu, "");
  const session = await createVerifiedSession(user.id, `Ringtools-app${device ? ` (${device})` : ""}`);
  return { token: session.rawToken, expiresAt: session.expiresAt.toISOString(), ...(await svc.getMe(user.id)) };
});

// Versie en capaciteiten van de API; de app controleert hiermee of ze nog compatibel is.
publicRoute("GET", "/meta", async () => ({ apiVersion: API_VERSION, minAppVersion: MIN_APP_VERSION }));

// Het pushtoken is een geheim van het toestel; wie het kent mag het afmelden. Zo kan de app het
// ook afmelden als de sessie al is verlopen of ingetrokken (401).
publicRoute("POST", "/devices/unregister", async ({ body }) => {
  const token = str(body.token);
  if (token) await svc.unregisterDeviceToken(token);
  return { ok: true };
});

publicRoute("GET", "/open/:token", async ({ params }) => {
  const info = await resolveOpenLink(params.token);
  return info.valid ? { valid: true, callingId: info.callingId } : { valid: false };
});

// ---- Sessie ----

authedRoute("POST", "/auth/refresh", async ({ auth }) => {
  const result = await rotateSessionIfDue(auth.token);
  if (result.status === "none") throw new ApiError(401, "Je sessie is verlopen.", "unauthenticated");
  return result.rotated ? { rotated: true, token: result.rawToken, expiresAt: result.expiresAt.toISOString() } : { rotated: false };
});

authedRoute("POST", "/auth/logout", async ({ auth, body }) => {
  const pushToken = str(body.pushToken);
  if (pushToken) await svc.unregisterDevice(auth.user.id, pushToken);
  await destroySession(auth.token);
  return { ok: true };
});

authedRoute("GET", "/me", async ({ auth }) => svc.getMe(auth.user.id));

// ---- Overzichten ----

authedRoute("GET", "/dashboard", async (ctx) => svc.getDashboard(ctx.auth.user.id, ringOf(ctx)));
authedRoute("GET", "/callings", async (ctx) => ({
  callings: await svc.listCallingsFor(ctx.auth.user.id, ringOf(ctx), ctx.query.get("filter") || "alle"),
}));
authedRoute("POST", "/callings", async (ctx) => svc.createCallingFor(ctx.auth.user.id, ringOf(ctx), ctx.body));
authedRoute("GET", "/callings/:id", async ({ auth, params }) => svc.getCallingView(auth.user.id, params.id));

authedRoute("GET", "/rings/:id/members", async ({ auth, params }) => svc.listRingMembersFor(auth.user.id, params.id));

// ---- Ondersteuningsprocedure ----

authedRoute("POST", "/callings/:id/vote", async ({ auth, params, body }) => {
  if (typeof body.support !== "boolean") throw new ApiError(400, "Geef aan of je ondersteunt.", "validation");
  return svc.castVoteFor(auth.user.id, params.id, body.support);
});
authedRoute("POST", "/callings/:id/remind", async ({ auth, params, body }) => svc.remindFor(auth.user.id, params.id, str(body.userId) || undefined));
authedRoute("POST", "/callings/:id/reinvite", async ({ auth, params, body }) => svc.reinviteFor(auth.user.id, params.id, str(body.userId)));
authedRoute("POST", "/callings/:id/remove-participant", async ({ auth, params, body }) =>
  svc.removeParticipantFor(auth.user.id, params.id, str(body.userId))
);
authedRoute("POST", "/callings/:id/delete", async ({ auth, params, body }) => svc.deleteCallingFor(auth.user.id, params.id, body.confirmed === true));
authedRoute("POST", "/callings/:id/process", async ({ auth, params }) => svc.markProcessedFor(auth.user.id, params.id));
authedRoute("POST", "/callings/:id/tasks/:task/assign", async ({ auth, params, body }) =>
  svc.assignTaskFor(auth.user.id, params.id, params.task, str(body.assigneeId) || null)
);
authedRoute("POST", "/callings/:id/tasks/:task/complete", async ({ auth, params, body }) =>
  svc.completeTaskFor(auth.user.id, params.id, params.task, body)
);

// ---- Meldingen en apparaten ----

authedRoute("GET", "/notifications", async (ctx) => svc.listNotificationsFor(ctx.auth.user.id, ringOf(ctx)));
authedRoute("POST", "/notifications/read", async (ctx) => svc.markNotificationsRead(ctx.auth.user.id, ringOf(ctx), str(ctx.body.id) || null));
authedRoute("POST", "/devices", async ({ auth, body }) => svc.registerDevice(auth.user.id, str(body.token), str(body.platform), str(body.deviceId) || undefined));
authedRoute("GET", "/devices", async ({ auth }) => svc.listDevices(auth.user.id));
authedRoute("POST", "/devices/:id/active", async ({ auth, params, body }) => svc.setDeviceActive(auth.user.id, params.id, body.active === true));

// ---- Sessies (apparaten waarop dit account is ingelogd) ----

authedRoute("GET", "/sessions", async ({ auth }) => svc.listMySessions(auth.user.id, auth.token));
authedRoute("POST", "/sessions/:id/revoke", async ({ auth, params }) => svc.revokeMySession(auth.user.id, params.id));
authedRoute("POST", "/devices/remove", async ({ auth, body }) => svc.unregisterDevice(auth.user.id, str(body.token)));

function match(route: Route, method: string, segments: string[]): Record<string, string> | null {
  if (route.method !== method || route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const want = route.segments[i];
    if (want.startsWith(":")) params[want.slice(1)] = decodeURIComponent(segments[i]);
    else if (want !== segments[i]) return null;
  }
  return params;
}

/** Eén ingang voor de hele JSON-API (/api/mobile/v1/...). Alle fouten komen als JSON terug. */
export async function handleApi(request: Request, segments: string[]): Promise<Response> {
  try {
    const url = new URL(request.url);
    let pathMatch = false;
    for (const r of routes) {
      const params = match(r, request.method, segments);
      if (!params) {
        if (r.segments.length === segments.length && r.segments.every((s, i) => s.startsWith(":") || s === segments[i])) pathMatch = true;
        continue;
      }
      const auth = r.auth ? await authenticate(request) : null;
      const body = request.method === "GET" ? {} : await readJson(request);
      const data = await (r.handler as PublicHandler)({ request, params, query: url.searchParams, body, auth });
      return jsonResponse(data);
    }
    throw new ApiError(pathMatch ? 405 : 404, pathMatch ? "Methode niet toegestaan." : "Niet gevonden.", pathMatch ? "method" : "not-found");
  } catch (err) {
    return errorResponse(err);
  }
}
