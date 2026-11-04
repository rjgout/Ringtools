/**
 * Universal Links voor de iOS-app: een e-maillink naar /open/<token> of /roepingen/<id> opent
 * dan direct de app als die is geïnstalleerd (anders gewoon de browser). Vereist
 * APPLE_APP_ID = "<TEAM-ID>.<bundle-id>", bijv. "ABCDE12345.nl.ringapeldoorn.ringtools".
 */
export const dynamic = "force-dynamic";

export function GET() {
  const appId = process.env.APPLE_APP_ID;
  const details = appId
    ? [{ appIDs: [appId], components: [{ "/": "/open/*" }, { "/": "/roepingen/*" }, { "/": "/uitnodiging/*" }] }]
    : [];
  // `webcredentials` is voorbereiding voor native passkeys (C5.2): pas actief als de app de entitlement `webcredentials:<host>` heeft
  // (na toesteltest); tot die tijd is het onschadelijk. Zonder APPLE_APP_ID blijft alles leeg.
  const webcredentials = appId ? { apps: [appId] } : undefined;
  return new Response(JSON.stringify({ applinks: { details }, ...(webcredentials ? { webcredentials } : {}) }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
