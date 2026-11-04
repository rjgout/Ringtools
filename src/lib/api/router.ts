import { createVerifiedSession, consumeLoginCode, rotateSessionIfDue, destroySession, mfaRequired } from "../auth";
import { rateLimit } from "../rateLimit";
import { emailSchema } from "../validation";
import { sendLoginMail } from "../loginMail";
import { resolveOpenLink } from "../openLinks";
import { authenticate, type ApiAuth } from "./auth";
import { ApiError, jsonResponse, errorResponse, readJson, str } from "./http";
import * as svc from "./service";
import { reviewOverview } from "../catalog/callings";
import * as mgmt from "./management";
import * as setup from "./setup";
import * as drafts from "./drafts";
import * as ontheffingen from "./ontheffingen";

/** Verhoog bij een niet-achterwaarts-compatibele wijziging; de app toont dan een update-melding. */
export const API_VERSION = 1;
export const MIN_APP_VERSION = "1.0.0";

type Ctx = { request: Request; params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown>; auth: ApiAuth | null };
type Handler = (ctx: Ctx & { auth: ApiAuth }) => Promise<unknown>;
type PublicHandler = (ctx: Ctx) => Promise<unknown>;

type Route = { method: string; segments: string[]; auth: false | "user" | "admin"; handler: PublicHandler };

const routes: Route[] = [];

function publicRoute(method: string, pattern: string, handler: PublicHandler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), auth: false, handler });
}

function authedRoute(method: string, pattern: string, handler: Handler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), auth: "user", handler: handler as PublicHandler });
}

/** Alleen het beheerdersaccount (webmin) met voltooide TOTP; gewone gebruikers krijgen 403. */
function adminRoute(method: string, pattern: string, handler: Handler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), auth: "admin", handler: handler as PublicHandler });
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

// Webmin: wachtwoord (stap 1) en TOTP/herstelcode (stap 2); pas daarna ontstaat een volledige sessie.
publicRoute("POST", "/admin/auth/login", async ({ request, body }) =>
  mgmt.adminLogin(body, request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "onbekend")
);
publicRoute("POST", "/admin/auth/totp", async ({ request, body }) => {
  const token = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError(401, "Je inlogsessie is verlopen. Log opnieuw in.", "unauthenticated");
  return mgmt.adminVerifyTotp(token, body);
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
// Nieuwe voorstellen lopen uitsluitend via concepten (server-side validatie bij indienen; idempotent).
authedRoute("GET", "/drafts", async (ctx) => drafts.listDraftsFor(ctx.auth.user.id, ringOf(ctx)));
authedRoute("POST", "/drafts", async (ctx) => drafts.createDraftFor(ctx.auth.user.id, ringOf(ctx), ctx.body));
authedRoute("GET", "/drafts/suggestions", async (ctx) => drafts.suggestionsFor(ctx.auth.user.id, ringOf(ctx), ctx.query));
authedRoute("GET", "/drafts/:id", async ({ auth, params }) => drafts.getDraftFor(auth.user.id, params.id));
authedRoute("POST", "/drafts/:id", async ({ auth, params, body }) => drafts.updateDraftFor(auth.user.id, params.id, body));
authedRoute("POST", "/drafts/:id/delete", async ({ auth, params }) => drafts.deleteDraftFor(auth.user.id, params.id));
authedRoute("POST", "/drafts/:id/submit", async ({ auth, params }) => drafts.submitDraftFor(auth.user.id, params.id));
// ---- Ontheffingen (vertrouwelijk; betrokkenen hebben geen toegang tot hun eigen dossier) ----
authedRoute("GET", "/ontheffingen", async (ctx) => ontheffingen.listFor(ctx.auth.user.id, ringOf(ctx)));
authedRoute("POST", "/ontheffingen", async (ctx) => ontheffingen.createFor(ctx.auth.user.id, ringOf(ctx), ctx.body));
authedRoute("GET", "/ontheffingen/:id", async ({ auth, params }) => ontheffingen.viewFor(auth.user.id, params.id));
authedRoute("POST", "/ontheffingen/:id", async ({ auth, params, body }) => ontheffingen.updateFor(auth.user.id, params.id, body));
authedRoute("POST", "/ontheffingen/:id/submit", async ({ auth, params }) => ontheffingen.submitFor(auth.user.id, params.id));
authedRoute("POST", "/ontheffingen/:id/delete", async ({ auth, params, body }) => ontheffingen.deleteFor(auth.user.id, params.id, body.confirmed === true));
authedRoute("POST", "/ontheffingen/:id/vote", async ({ auth, params, body }) => ontheffingen.voteFor(auth.user.id, params.id, body.support));
authedRoute("POST", "/ontheffingen/:id/review", async ({ auth, params }) => ontheffingen.reviewFor(auth.user.id, params.id));
authedRoute("POST", "/ontheffingen/:id/release", async ({ auth, params }) => ontheffingen.releaseFor(auth.user.id, params.id));
authedRoute("POST", "/ontheffingen/:id/group-decision", async ({ auth, params, body }) => ontheffingen.decisionFor(auth.user.id, params.id, body));
authedRoute("POST", "/ontheffingen/persons/:pid/:step", async ({ auth, params, body }) => ontheffingen.personStepFor(auth.user.id, params.pid, params.step, body));
authedRoute("GET", "/catalog/review", async () => reviewOverview());
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
authedRoute("POST", "/callings/:id/release", async ({ auth, params }) => svc.releaseFor(auth.user.id, params.id));
authedRoute("POST", "/callings/:id/group-decision", async ({ auth, params, body }) => svc.groupDecisionFor(auth.user.id, params.id, body));
authedRoute("POST", "/callings/:id/process", async ({ auth, params }) => svc.markProcessedFor(auth.user.id, params.id));
authedRoute("POST", "/callings/:id/tasks/:task/assign", async ({ auth, params, body }) =>
  svc.assignTaskFor(auth.user.id, params.id, params.task, str(body.assigneeId) || null, str(body.externalName) || null)
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

// ---- Gebruikersbeheer: ringbeheerder (eigen ring) ----

authedRoute("POST", "/auth/reauth", async ({ auth, body }) => mgmt.userReauth(auth, body));
authedRoute("GET", "/rings/:id/users", async ({ auth, params }) => mgmt.listUsersFor(auth, params.id));
authedRoute("POST", "/rings/:id/users", async ({ auth, params, body }) => mgmt.addUserFor(auth, params.id, body));
authedRoute("POST", "/memberships/:id", async ({ auth, params, body }) => mgmt.updateUserFor(auth, params.id, body));

// ---- Ringinrichting en catalogus (ringbeheerder: eigen ring; webmin via /admin) ----

authedRoute("GET", "/rings/:id/setup", async ({ auth, params }) => setup.setupFor(auth, params.id));
authedRoute("GET", "/rings/:id/units", async ({ auth, params }) => setup.unitsFor(auth, params.id));
authedRoute("POST", "/rings/:id/units", async ({ auth, params, body }) => setup.createUnitFor(auth, params.id, body));
authedRoute("POST", "/units/:id", async ({ auth, params, body }) => setup.updateUnitFor(auth, params.id, body));
authedRoute("GET", "/rings/:id/custom-callings", async ({ auth, params }) => setup.customCallingsFor(auth, params.id));
authedRoute("POST", "/rings/:id/custom-callings", async ({ auth, params, body }) => setup.createCustomCallingFor(auth, params.id, body));
authedRoute("POST", "/custom-callings/:id", async ({ auth, params, body }) => setup.updateCustomCallingFor(auth, params.id, body));
authedRoute("GET", "/catalog/callings", async (ctx) => setup.catalogFor(ctx.auth.user.id, ringOf(ctx), ctx.query.get("q") || "", ctx.query.get("category") || ""));
authedRoute("GET", "/catalog/callings/:code/appointers", async (ctx) => setup.appointersFor(ctx.auth.user.id, ringOf(ctx), ctx.params.code));

// ---- Systeembeheer (webmin) ----

adminRoute("GET", "/admin/me", async ({ auth }) => ({ user: { id: auth.user.id, name: auth.user.name, email: auth.user.email }, isAdmin: true }));
adminRoute("POST", "/admin/auth/reauth", async ({ auth, body }) => mgmt.adminReauth(auth, body));
adminRoute("POST", "/admin/auth/refresh", async ({ auth }) => {
  const result = await rotateSessionIfDue(auth.token);
  if (result.status === "none") throw new ApiError(401, "Je sessie is verlopen.", "unauthenticated");
  return result.rotated ? { rotated: true, token: result.rawToken, expiresAt: result.expiresAt.toISOString() } : { rotated: false };
});
adminRoute("POST", "/admin/auth/logout", async ({ auth }) => {
  await destroySession(auth.token);
  return { ok: true };
});
adminRoute("GET", "/admin/sessions", async ({ auth }) => svc.listMySessions(auth.user.id, auth.token));
adminRoute("POST", "/admin/sessions/:id/revoke", async ({ auth, params }) => svc.revokeMySession(auth.user.id, params.id));
adminRoute("GET", "/admin/rings", async () => mgmt.listRingsFor());
adminRoute("POST", "/admin/rings", async ({ auth, body }) => mgmt.createRingFor(auth, body));
adminRoute("POST", "/admin/rings/:id/rename", async ({ auth, params, body }) => mgmt.renameRingFor(auth, params.id, body));
adminRoute("POST", "/admin/rings/:id/active", async ({ auth, params, body }) => mgmt.setRingActiveFor(auth, params.id, body));
adminRoute("GET", "/admin/rings/:id/users", async ({ auth, params }) => mgmt.listUsersFor(auth, params.id));
adminRoute("POST", "/admin/rings/:id/users", async ({ auth, params, body }) => mgmt.addUserFor(auth, params.id, body));
adminRoute("POST", "/admin/memberships/:id", async ({ auth, params, body }) => mgmt.updateUserFor(auth, params.id, body));
adminRoute("GET", "/admin/rings/:id/setup", async ({ auth, params }) => setup.setupFor(auth, params.id));
adminRoute("GET", "/admin/rings/:id/units", async ({ auth, params }) => setup.unitsFor(auth, params.id));
adminRoute("POST", "/admin/rings/:id/units", async ({ auth, params, body }) => setup.createUnitFor(auth, params.id, body));
adminRoute("POST", "/admin/units/:id", async ({ auth, params, body }) => setup.updateUnitFor(auth, params.id, body));
adminRoute("GET", "/admin/catalog/callings", async (ctx) => setup.catalogForAdmin(ringOf(ctx), ctx.query.get("q") || "", ctx.query.get("category") || ""));
adminRoute("GET", "/admin/rings/:id/custom-callings", async ({ auth, params }) => setup.customCallingsFor(auth, params.id));
adminRoute("POST", "/admin/rings/:id/custom-callings", async ({ auth, params, body }) => setup.createCustomCallingFor(auth, params.id, body));
adminRoute("POST", "/admin/custom-callings/:id", async ({ auth, params, body }) => setup.updateCustomCallingFor(auth, params.id, body));
adminRoute("GET", "/admin/catalog/review", async () => reviewOverview());
adminRoute("GET", "/admin/users", async ({ query }) => mgmt.searchUsersFor(query.get("q") || ""));

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
      const auth = r.auth ? await authenticate(request, r.auth) : null;
      const body = request.method === "GET" ? {} : await readJson(request);
      const data = await (r.handler as PublicHandler)({ request, params, query: url.searchParams, body, auth });
      return jsonResponse(data);
    }
    throw new ApiError(pathMatch ? 405 : 404, pathMatch ? "Methode niet toegestaan." : "Niet gevonden.", pathMatch ? "method" : "not-found");
  } catch (err) {
    return errorResponse(err);
  }
}
