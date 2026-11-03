/**
 * App Links voor de Android-app. Vereist ANDROID_SHA256_FINGERPRINTS (komma-gescheiden
 * SHA-256-vingerafdrukken van het app-ondertekeningscertificaat, te vinden in de Play Console
 * onder "App-integriteit") en optioneel ANDROID_PACKAGE (standaard nl.ringapeldoorn.ringtools).
 */
export const dynamic = "force-dynamic";

export function GET() {
  const fingerprints = (process.env.ANDROID_SHA256_FINGERPRINTS || "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const body =
    fingerprints.length === 0
      ? []
      : [
          {
            relation: ["delegate_permission/common.handle_all_urls"],
            target: {
              namespace: "android_app",
              package_name: process.env.ANDROID_PACKAGE || "nl.ringapeldoorn.ringtools",
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ];
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
  });
}
