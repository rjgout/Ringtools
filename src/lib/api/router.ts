import * as privacy from "../accountDeletion";
import { loginReviewAccount } from "../reviewAuth";
import { loginInvitedPerson } from "../invitationLogin";
import { createVerifiedSession, consumeLoginCode, rotateSessionIfDue, mfaRequired } from "../auth";
import { rateLimit } from "../rateLimit";
import { emailSchema } from "../validation";
import { sendLoginMail } from "../loginMail";
import { resolveOpenLink } from "../openLinks";
import * as webPush from "../webPush";
import { isDevelopmentEnvironment } from "../devGuard";
import { prisma } from "../prisma";
import { assertTrustedWebRequest, authenticate, isWebClientRequest, sessionCookieHeader, type ApiAuth } from "./auth";
import { ApiError, jsonResponse, errorResponse, readJson, str } from "./http";
import * as svc from "./service";
import { reviewOverview } from "../catalog/callings";
import * as mgmt from "./management";
import * as setup from "./setup";
import * as drafts from "./drafts";
import * as ontheffingen from "./ontheffingen";
import * as trustedDevicesApi from "./trustedDevices";
import * as deviceLoginApi from "./deviceLogin";
import * as invitations from "./invitations";
import * as nativeMfa from "./nativeMfa";
import { env } from "../env";

/** Verhoog bij een niet-achterwaarts-compatibele wijziging; de app toont dan een update-melding. */
export const API_VERSION = 1;
export const MIN_APP_VERSION = "1.0.0";

type Ctx = { request: Request; params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown>; auth: ApiAuth | null };
type Handler = (ctx: Ctx & { auth: ApiAuth }) => Promise<unknown>;
type PublicHandler = (ctx: Ctx) => Promise<unknown>;

type Route = { method: string; segments: string[]; auth: false | "user"; handler: PublicHandler };

const routes: Route[] = [];

function publicRoute(method: string, pattern: string, handler: PublicHandler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), auth: false, handler });
}

function authedRoute(method: string, pattern: string, handler: Handler) {
  routes.push({ method, segments: pattern.split("/").filter(Boolean), auth: "user", handler: handler as PublicHandler });
}

const ringOf = (ctx: Ctx) => ctx.query.get("ring") || str(ctx.body.ringId);

// ---- Inloggen (geen token nodig) ----

publicRoute("POST", "/auth/request-code", async ({ request, body }) => {
  if (!rateLimit(`request-code-ip:${clientKeyOf(request)}`, 30, 15 * 60 * 1000).allowed) throw new ApiError(429, "Te veel aanvragen. Probeer het later opnieuw.", "rate-limited");
  const email = emailSchema.safeParse(body.email);
  if (!email.success) throw new ApiError(400, "Vul een geldig e-mailadres in.", "validation");
  const result = await sendLoginMail(email.data, null, { codeOnly: true });
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
  if (!user) {
    const invited = await loginInvitedPerson(email.data, code, "Ringtools-app");
    if (!invited) throw invalid;
    return { token: invited.token, expiresAt: invited.expiresAt.toISOString(), ...(await svc.getMe(invited.userId)) };
  }
  if (user.role === "ADMIN") throw new ApiError(403, "Het beheerdersaccount gebruikt de webapp.", "admin-web-only");
  if (mfaRequired(user)) {
    // Verplichte MFA: nooit een volledige sessie op de code alleen. Met native passkeys (functievlag) volgt een beperkte pending-login;
    // zonder de vlag de oude, veilige weigering. De code is in beide gevallen al verbruikt.
    return nativeMfa.beginMfaLogin(user, email.data);
  }
  const device = str(body.deviceName).slice(0, 60).replace(/[^\p{L}\p{N} ._-]/gu, "");
  const session = await createVerifiedSession(user.id, `Ringtools-app${device ? ` (${device})` : ""}`, email.data);
  return { token: session.rawToken, expiresAt: session.expiresAt.toISOString(), ...(await svc.getMe(user.id)) };
});

publicRoute("POST", "/auth/review/login", async ({ request, body }) => {
  const result = await loginReviewAccount(str(body.email), str(body.password), clientKeyOf(request));
  return { token: result.token, expiresAt: result.expiresAt.toISOString(), ...(await svc.getMe(result.userId)) };
});
authedRoute("POST", "/auth/review/reauth", async ({ request, auth, body }) => {
  if (auth.user.accountKind !== "REVIEW") throw new ApiError(403, "Niet beschikbaar.", "forbidden");
  const result = await loginReviewAccount(auth.user.email, str(body.password), clientKeyOf(request));
  await svc.revokeMySession(auth.user.id, auth.sessionId);
  return { token: result.token, expiresAt: result.expiresAt.toISOString() };
});

authedRoute("GET", "/privacy/deletion", async ({ auth }) => ({ request: await privacy.getAccountDeletionStatus(auth.user.id) }));
authedRoute("POST", "/privacy/deletion", async ({ auth, body }) => {
  mgmt.requireFreshAuth(auth);
  if (body.confirm !== true) throw new ApiError(400, "Bevestig dat je het volledige account wilt verwijderen.", "confirmation-required");
  return privacy.requestAccountDeletion(auth.user.id);
});
publicRoute("POST", "/privacy/deletion/status", async ({ request, body }) => {
  if (!rateLimit(`deletion-status:${clientKeyOf(request)}`, 60, 60000).allowed) throw new ApiError(429, "Te veel aanvragen. Probeer later opnieuw.", "rate-limited");
  return { request: await privacy.getDeletionReceiptStatus(str(body.receipt)) };
});

// Uitnodigingen (ontvanger): voorvertoning en activatie. Token of code staan in de body, nooit in de URL. Alleen issueSession:true vraagt een sessie aan.
const clientKeyOf = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "onbekend";
publicRoute("POST", "/invitations/preview", async ({ request, body }) => invitations.previewInvitationApi(body, clientKeyOf(request)));
publicRoute("POST", "/invitations/activate", async ({ request, body }) => invitations.activateInvitationApi(body, clientKeyOf(request)));
publicRoute("POST", "/auth/device/challenge", async ({ request, body }) => deviceLoginApi.deviceChallengeApi(body, clientKeyOf(request)));
publicRoute("POST", "/auth/device/login", async ({ request, body }) => {
  const result = await deviceLoginApi.deviceLoginApi(body, clientKeyOf(request));
  return { token: result.token, expiresAt: result.expiresAt.toISOString(), ...(await svc.getMe(result.userId)) };
});
authedRoute("POST", "/auth/device/status", async ({ auth, body }) => deviceLoginApi.deviceStatusApi(auth, body));
authedRoute("POST", "/auth/device/enroll/challenge", async ({ auth }) => deviceLoginApi.enrollChallengeApi(auth));
authedRoute("POST", "/auth/device/enroll/complete", async ({ auth, body }) => deviceLoginApi.enrollCompleteApi(auth, body));
authedRoute("POST", "/auth/device/disable", async ({ auth, body }) => deviceLoginApi.deviceDisableApi(auth, body));
authedRoute("POST", "/auth/device/activate/challenge", async ({ auth, body }) => deviceLoginApi.activationChallengeApi(auth, body));
authedRoute("POST", "/auth/device/activate/confirm", async ({ auth, body }) => deviceLoginApi.activationConfirmApi(auth, body));
publicRoute("POST", "/trusted-devices/pair/claim", async ({ request, body }) => trustedDevicesApi.claimPairingApi(body, clientKeyOf(request)));
publicRoute("POST", "/trusted-devices/pair/complete", async ({ request, body }) => trustedDevicesApi.completePairingApi(body, clientKeyOf(request)));

// Versie en capaciteiten van de API; de app controleert hiermee of ze nog compatibel is.
publicRoute("GET", "/meta", async () => ({ apiVersion: API_VERSION, minAppVersion: MIN_APP_VERSION, nativePasskeys: env.nativePasskeysEnabled, nativeTotpLogin: env.nativeTotpLoginEnabled, trustedDevices: env.trustedDevicesEnabled, deviceLogin: env.nativeDeviceLoginEnabled, deviceAutoEnroll: env.nativeDeviceAutoEnrollEnabled, ...(isDevelopmentEnvironment() ? { environment: "development" as const } : {}) }));

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

// Native passkeys (C5.2): de pending-login staat in de Authorization-header en werkt uitsluitend op deze drie routes.
const pendingTokenOf = (request: Request) => {
  const token = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token) throw new ApiError(401, "Je inlogsessie is verlopen. Log opnieuw in.", "unauthenticated");
  return token;
};
publicRoute("POST", "/auth/mfa/passkey/options", async ({ request }) => nativeMfa.loginPasskeyOptions(pendingTokenOf(request)));
publicRoute("POST", "/auth/mfa/totp/verify", async ({ request, body }) => {
  const result = await nativeMfa.loginTotpVerify(pendingTokenOf(request), body);
  return { token: result.token, expiresAt: result.expiresAt, ...(await svc.getMe(result.userId)) };
});
publicRoute("POST", "/auth/mfa/passkey/verify", async ({ request, body }) => {
  const result = await nativeMfa.loginPasskeyVerify(pendingTokenOf(request), body);
  return { token: result.token, expiresAt: result.expiresAt, ...(await svc.getMe(result.userId)) };
});
publicRoute("POST", "/auth/mfa/cancel", async ({ request }) => nativeMfa.cancelPendingLogin(pendingTokenOf(request)));
authedRoute("POST", "/auth/reauth/passkey/options", async ({ auth }) => nativeMfa.reauthPasskeyOptions(auth));
authedRoute("POST", "/auth/reauth/passkey/verify", async ({ auth, body }) => nativeMfa.reauthPasskeyVerify(auth, body));

authedRoute("POST", "/auth/refresh", async ({ auth }) => {
  const result = await rotateSessionIfDue(auth.token);
  if (result.status === "none") throw new ApiError(401, "Je sessie is verlopen.", "unauthenticated");
  return result.rotated ? { rotated: true, token: result.rawToken, expiresAt: result.expiresAt.toISOString() } : { rotated: false };
});

authedRoute("POST", "/auth/logout", async ({ auth, body }) => {
  const pushToken = str(body.pushToken);
  if (pushToken) await svc.unregisterDevice(auth.user.id, pushToken);
  await svc.revokeMySession(auth.user.id, auth.sessionId);
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
authedRoute("POST", "/callings/:id/release-execution", async ({ auth, params }) => svc.releaseExecutionFor(auth.user.id, params.id));
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

// Webpush (VAPID) en e-mailvoorkeur voor de webomgeving (web/PWA). Alleen via de sessiecookie: de native app gebruikt APNs/FCM (`/devices`).
const webOnly = (auth: ApiAuth) => {
  if (auth.via !== "cookie") throw new ApiError(404, "Niet gevonden.", "not-found");
};
authedRoute("GET", "/web-push", async ({ auth }) => (webOnly(auth), webPush.webPushOverview(auth.user.id)));
authedRoute("POST", "/web-push/subscribe", async ({ auth, body, request }) => {
  webOnly(auth);
  const keys = (body.keys && typeof body.keys === "object" ? body.keys : {}) as Record<string, unknown>;
  return webPush.subscribeWebPush(auth.user.id, { endpoint: str(body.endpoint), keys: { p256dh: str(keys.p256dh), auth: str(keys.auth) } }, request.headers.get("user-agent") ?? undefined);
});
authedRoute("POST", "/web-push/unsubscribe", async ({ auth, body }) => (webOnly(auth), webPush.unsubscribeWebPush(auth.user.id, str(body.endpoint))));
authedRoute("POST", "/web-push/test", async ({ auth }) => (webOnly(auth), webPush.sendTestWebPush(auth.user.id)));
authedRoute("POST", "/web-push/:id/remove", async ({ auth, params }) => {
  webOnly(auth);
  await webPush.removeWebPushSubscription(auth.user.id, params.id);
  return { ok: true };
});
authedRoute("POST", "/me/email-notifications", async ({ auth, body }) => {
  webOnly(auth);
  await prisma.user.update({ where: { id: auth.user.id }, data: { emailNotificationsEnabled: body.enabled === true } });
  return { ok: true, enabled: body.enabled === true };
});
authedRoute("GET", "/sessions", async ({ auth }) => svc.listMySessions(auth.user.id, auth.token));
authedRoute("POST", "/sessions/:id/revoke", async ({ auth, params }) => svc.revokeMySession(auth.user.id, params.id));
authedRoute("POST", "/devices/remove", async ({ auth, body }) => svc.unregisterDevice(auth.user.id, str(body.token)));

// ---- Gebruikersbeheer: ringbeheerder (eigen ring) ----

// Verse e-mailcode voor herverificatie, uitsluitend naar het geregistreerde adres van het ingelogde account (zelfde mail en limieten als inloggen).
authedRoute("POST", "/auth/reauth/request-code", async ({ auth }) => {
  const result = await sendLoginMail(auth.user.email.trim().toLowerCase(), null);
  if (!result.ok) throw new ApiError(429, result.message, "rate-limited");
  return { ok: true };
});
authedRoute("POST", "/auth/reauth", async ({ auth, body }) => mgmt.userReauth(auth, body));
authedRoute("GET", "/rings/:id/review-management", async ({ auth, params }) => mgmt.reviewManagementFor(auth, params.id));
authedRoute("GET", "/rings/:id/users", async ({ auth, params }) => mgmt.listUsersFor(auth, params.id));
authedRoute("POST", "/rings/:id/users/:userId/login-mail", async ({ auth, params }) => mgmt.sendLoginMailFor(auth, params.id, params.userId));
authedRoute("POST", "/rings/:id/users", async ({ auth, params, body }) => mgmt.addUserFor(auth, params.id, body));
authedRoute("POST", "/memberships/:id", async ({ auth, params, body }) => mgmt.updateUserFor(auth, params.id, body));
authedRoute("GET", "/rings/:id/invitations", async ({ auth, params }) => invitations.listInvitationsFor(auth, params.id));
authedRoute("POST", "/rings/:id/invitations", async ({ auth, params, body }) => invitations.createInvitationFor(auth, params.id, body));
authedRoute("POST", "/invitations/:id/resend", async ({ auth, params }) => invitations.resendInvitationFor(auth, params.id));
authedRoute("POST", "/invitations/:id/revoke", async ({ auth, params }) => invitations.revokeInvitationFor(auth, params.id));
authedRoute("POST", "/invitations/:id", async ({ auth, params, body }) => invitations.updateInvitationFor(auth, params.id, body));

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
/** Openbare routes die de webclient mag aanroepen (geen token, geen gegevens van anderen). */
const WEB_PUBLIC_ROUTES = new Set(["meta"]);
/** Routes die alleen voor de native app bestaan (toestelsleutels, native push, demo-aanmelding). */
const WEB_BLOCKED_PREFIXES = ["auth/device", "auth/review", "auth/reauth/passkey/options", "auth/reauth/passkey/verify", "trusted-devices", "devices/remove"];

export async function handleApi(request: Request, segments: string[]): Promise<Response> {
  try {
    const url = new URL(request.url);
    // Systeembeheer (webmin) gebeurt uitsluitend via de beveiligde website. Elke /admin/…-aanroep wordt direct en zonder verdere verwerking
    // afgewezen, ook als de aanvrager een (oude) beheerderssessie heeft of de route ooit bestond.
    if (segments[0] === "admin") throw new ApiError(410, "Systeembeheer is niet beschikbaar in de app. Meld je aan op de beveiligde website.", "admin-web-only");
    let pathMatch = false;
    for (const r of routes) {
      const params = match(r, request.method, segments);
      if (!params) {
        if (r.segments.length === segments.length && r.segments.every((s, i) => s.startsWith(":") || s === segments[i])) pathMatch = true;
        continue;
      }
      const web = isWebClientRequest(request);
      if (web) {
        // Webomgeving (cookie): eerst de herkomst controleren, ook op openbare routes. Routes die een token uitgeven of bij een toestel horen
        // (inloggen met code, toestelsleutels, koppelen, uitnodiging met sessie) zijn voor de webclient afgesloten: aanmelden gebeurt daar
        // uitsluitend via de bestaande website (e-mailcode, MFA) en het sessietoken komt nooit in JavaScript.
        assertTrustedWebRequest(request);
        const path = segments.join("/");
        if (!r.auth && !WEB_PUBLIC_ROUTES.has(path)) throw new ApiError(403, "Dit is niet beschikbaar in de webomgeving.", "web-not-allowed");
        if (WEB_BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) throw new ApiError(403, "Dit is niet beschikbaar in de webomgeving.", "web-not-allowed");
      }
      const auth = r.auth ? await authenticate(request, r.auth) : null;
      const body = request.method === "GET" ? {} : await readJson(request);
      const data = await (r.handler as PublicHandler)({ request, params, query: url.searchParams, body, auth });
      if (auth?.via === "cookie") {
        // Een vervangen sessietoken (herverificatie, rotatie) gaat als HttpOnly-cookie terug en wordt uit de JSON verwijderd; uitloggen wist de cookie.
        const out = data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : data;
        const headers: Record<string, string> = {};
        if (out && typeof out === "object" && !Array.isArray(out) && "token" in out) {
          const token = (out as Record<string, unknown>).token;
          delete (out as Record<string, unknown>).token;
          if (typeof token === "string" && token) headers["Set-Cookie"] = sessionCookieHeader(token);
        }
        if (segments.join("/") === "auth/logout") headers["Set-Cookie"] = sessionCookieHeader(null);
        return jsonResponse(out, 200, headers);
      }
      return jsonResponse(data);
    }
    throw new ApiError(pathMatch ? 405 : 404, pathMatch ? "Methode niet toegestaan." : "Niet gevonden.", pathMatch ? "method" : "not-found");
  } catch (err) {
    return errorResponse(err);
  }
}
