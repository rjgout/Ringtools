import { describe, expect, it } from "vitest";
import { webAppTargetFor } from "@/lib/webAppRedirect";

// Web/PWA v2: doorverwijzing van de bestaande webpagina's naar de gedeelde interface, alleen met de vlag en nooit voor de webmin.
describe("webAppTargetFor", () => {
  const on = { isAdmin: false, enabled: true };
  it("verwijst met de vlag uit of voor de beheerder nooit door", () => {
    for (const path of ["/dashboard", "/roepingen", "/roepingen/abc", "/gebruikers", "/profiel"]) {
      expect(webAppTargetFor(path, { isAdmin: false, enabled: false })).toBeNull();
      expect(webAppTargetFor(path, { isAdmin: true, enabled: true })).toBeNull();
    }
  });
  it("brengt elke bestaande gebruikerspagina naar hetzelfde scherm", () => {
    expect(webAppTargetFor("/dashboard", on)).toBe("/app");
    expect(webAppTargetFor("/roepingen?filter=presidium", on)).toBe("/app?to=%2Fvoorstellen");
    expect(webAppTargetFor("/roepingen/nieuw", on)).toBe("/app?to=%2Fvoorstellen%2Fnieuw");
    expect(webAppTargetFor("/roepingen/clx123abc", on)).toBe("/app?to=%2Froepingen%2Fclx123abc");
    expect(webAppTargetFor("/gebruikers/", on)).toBe("/app?to=%2Fbeheer%2Fgebruikers");
    expect(webAppTargetFor("/profiel", on)).toBe("/app?to=%2Fprofiel");
  });
  it("laat webmin-pagina's en onbekende of vreemde paden met rust (geen open doorverwijzing)", () => {
    for (const path of ["/ringen", "/ringen/abc", "/instellingen", "/roepingen/../../evil", "/roepingen/a/b", "/roepingen/%2F%2Fevil.example", null, ""]) {
      expect(webAppTargetFor(path, on)).toBeNull();
    }
  });
});
