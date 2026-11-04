/**
 * Buildprofiel van deze installatie. `ringtools-build.js` (klassiek script, vóór de app geladen) zet
 * `window.__RINGTOOLS_BUILD__`. Standaard (ook op Android, web en alle store-builds) is het profiel "standard".
 * De iOS-configuratie "Debug-PersonalTeam" (gratis Apple Personal Team) overschrijft het bestand in de app-bundel via
 * een Xcode-buildfase met profiel "personal-team": dan ontbreken de capabilities Push Notifications en Associated Domains
 * en zijn native push en Universal Links niet beschikbaar.
 */
export type BuildProfile = "standard" | "personal-team";

type Win = { __RINGTOOLS_BUILD__?: { profile?: unknown } };

export function getBuildProfile(win: Win = window as unknown as Win): BuildProfile {
  return win.__RINGTOOLS_BUILD__?.profile === "personal-team" ? "personal-team" : "standard";
}

export function nativeCapabilities(profile: BuildProfile = getBuildProfile()) {
  const limited = profile === "personal-team";
  return { nativePush: !limited, universalLinks: !limited, limited };
}

export const PERSONAL_TEAM_NOTICE =
  "Dit is een testbuild voor een gratis Apple Personal Team: pushmeldingen en universele links (links uit e-mails die de app openen) zijn hier niet beschikbaar. Inloggen met een code, voorstellen bekijken en ondersteuning uitbrengen werken gewoon.";
