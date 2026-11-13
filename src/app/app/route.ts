import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { safeInternalPath } from "@/lib/safePath";

/**
 * Webomgeving (web/PWA): serveert de gedeelde React-client (dezelfde als de iOS-app, gebouwd met `npm run build:web` in mobile/).
 * - Alleen voor een volledig ingelogde gewone gebruiker (sessiecookie, MFA voltooid); anders naar de bestaande inlogpagina, met behoud van de bestemming.
 * - Het beheerdersaccount hoort in de webmin-omgeving.
 * De pagina zelf bevat geen gegevens: alles komt via /api/mobile/v1 met de HttpOnly-cookie. Nooit cachen.
 */
export const dynamic = "force-dynamic";

const SHELL = path.join(process.cwd(), "public", "app", "index.html");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = safeInternalPath(url.searchParams.get("to"));
  const self = to ? `/app?to=${encodeURIComponent(to)}` : "/app";
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(self)}`);
  if (user.role === "ADMIN") redirect("/dashboard");
  let html: string;
  try {
    html = await readFile(SHELL, "utf8");
  } catch {
    return new Response("De webomgeving is op deze server niet gebouwd.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  });
}
