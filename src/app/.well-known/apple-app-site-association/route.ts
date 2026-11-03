/**
 * Universal Links voor de iOS-app: een e-maillink naar /open/<token> of /roepingen/<id> opent
 * dan direct de app als die is geïnstalleerd (anders gewoon de browser). Vereist
 * APPLE_APP_ID = "<TEAM-ID>.<bundle-id>", bijv. "ABCDE12345.nl.ringapeldoorn.ringtools".
 */
export const dynamic = "force-dynamic";

export function GET() {
  const appId = process.env.APPLE_APP_ID;
  const details = appId
    ? [{ appIDs: [appId], components: [{ "/": "/open/*" }, { "/": "/roepingen/*" }] }]
    : [];
  return new Response(JSON.stringify({ applinks: { details } }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
