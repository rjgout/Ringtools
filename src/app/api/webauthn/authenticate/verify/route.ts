import type { NextRequest } from "next/server";
import { resolveMfaActor } from "@/lib/mfaActor";
import { verifyPasskeyAuthentication } from "@/lib/webauthn";
import { promoteSessionToMfaVerified } from "@/lib/auth";
import { setSessionCookie, safeInternalPath, getRequestUserAgent } from "@/lib/session";
import { logSecurityEvent } from "@/lib/securityEvents";

export async function POST(request: NextRequest) {
  const actor = await resolveMfaActor();
  if (!actor) return Response.json({ error: "Niet ingelogd." }, { status: 401 });

  let body: { response?: unknown; redirect?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Ongeldig verzoek." }, { status: 400 });
  }
  if (!body.response) return Response.json({ error: "Ongeldig verzoek." }, { status: 400 });

  const result = await verifyPasskeyAuthentication(actor.userId, body.response as never);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 400 });

  // Elke geslaagde verificatie roteert de sessie en zet mfaAt=nu, zowel bij
  // het afronden van een login ("pending") als bij het herverifiëren van
  // een al volledig ingelogde sessie voor een gevoelige actie ("full").
  const { rawToken } = await promoteSessionToMfaVerified(actor.sessionId, actor.userId, await getRequestUserAgent());
  await setSessionCookie(rawToken);
  await logSecurityEvent({ userId: actor.userId, type: "MFA_VERIFIED" });

  if (actor.mode === "pending") {
    const redirectTo = safeInternalPath(body.redirect) || "/dashboard";
    return Response.json({ ok: true, redirect: redirectTo });
  }
  return Response.json({ ok: true });
}
