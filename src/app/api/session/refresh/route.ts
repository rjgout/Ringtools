import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, rotateSessionIfDue } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

/**
 * Wordt door de app (SessionKeepAlive) aangeroepen bij openen en terugkeren naar de app.
 * Verlengt de sessie en roteert zo nodig het token (nieuw HttpOnly-cookie). Geeft nooit
 * gegevens terug behalve of de sessie geldig is.
 */
export async function POST() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE_NAME)?.value;
  const result = await rotateSessionIfDue(raw);

  if (result.status === "none") {
    return Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (result.rotated) {
    await setSessionCookie(result.rawToken);
  }
  return Response.json({ ok: true, rotated: result.rotated }, { headers: { "Cache-Control": "no-store" } });
}
