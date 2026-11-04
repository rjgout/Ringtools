import type { NextRequest } from "next/server";
import { resolveMfaActor, mayEnrollFirstFactorWhilePending } from "@/lib/mfaActor";
import { verifyPasskeyRegistration } from "@/lib/webauthn";
import { isRecentlyMfaVerified, promoteSessionToMfaVerified } from "@/lib/auth";
import { setSessionCookie, safeInternalPath, getRequestUserAgent } from "@/lib/session";
import { logSecurityEvent } from "@/lib/securityEvents";

export async function POST(request: NextRequest) {
  const actor = await resolveMfaActor();
  if (!actor) return Response.json({ error: "Niet ingelogd." }, { status: 401 });

  // Wachtende sessie: alleen een eerste inschrijving, nooit een tweede factor "erbij".
  if (!(await mayEnrollFirstFactorWhilePending(actor))) {
    return Response.json({ error: "Deze actie is nu niet toegestaan. Log in met je bestaande tweede factor." }, { status: 403 });
  }

  if (actor.mode === "full" && actor.mfaRequired && !isRecentlyMfaVerified(actor.mfaAt)) {
    return Response.json({ error: "Herverifieer eerst om deze actie uit te voeren." }, { status: 403 });
  }

  let body: { response?: unknown; redirect?: string; deviceLabel?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ongeldig verzoek." }, { status: 400 });
  }
  if (!body.response) return Response.json({ error: "Ongeldig verzoek." }, { status: 400 });

  const result = await verifyPasskeyRegistration(actor.userId, body.response as never, body.deviceLabel);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });

  // In "pending"-context (tijdens inloggen) is dit meteen de eerste
  // passkey van een gebruiker zonder MFA: registratie rondt de login af.
  if (actor.mode === "pending") {
    const { rawToken } = await promoteSessionToMfaVerified(actor.sessionId, actor.userId, await getRequestUserAgent());
    await setSessionCookie(rawToken);
    await logSecurityEvent({ userId: actor.userId, type: "MFA_VERIFIED" });
    const redirectTo = safeInternalPath(body.redirect) || "/dashboard";
    return Response.json({ ok: true, redirect: redirectTo });
  }

  return Response.json({ ok: true });
}
