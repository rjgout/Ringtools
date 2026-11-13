import { describe, expect, it } from "vitest";
import { webAppTargetFor } from "@/lib/webAppRedirect";

// Web/PWA: de vroegere webpagina's verwijzen door naar de gedeelde interface (/app); de webmin blijft op zijn eigen pagina's.
describe("webAppTargetFor – gewone gebruiker", () => {
  const user = { isAdmin: false };
  it("brengt elke bestaande gebruikerspagina naar hetzelfde scherm", () => {
    expect(webAppTargetFor("/dashboard", user)).toBe("/app");
    expect(webAppTargetFor("/roepingen?filter=presidium", user)).toBe("/app?to=%2Fvoorstellen");
    expect(webAppTargetFor("/roepingen/nieuw", user)).toBe("/app?to=%2Fvoorstellen%2Fnieuw");
    expect(webAppTargetFor("/roepingen/clx123abc", user)).toBe("/app?to=%2Froepingen%2Fclx123abc");
    expect(webAppTargetFor("/roepingen/clx123abc?melding=besluit-vastgelegd", user)).toBe("/app?to=%2Froepingen%2Fclx123abc");
    expect(webAppTargetFor("/gebruikers/", user)).toBe("/app?to=%2Fbeheer%2Fgebruikers");
    expect(webAppTargetFor("/profiel", user)).toBe("/app?to=%2Fprofiel");
  });
  it("een webmin-pagina of onbekende pagina brengt een gewone gebruiker naar het overzicht, nooit naar een vreemd adres", () => {
    for (const path of ["/ringen", "/ringen/abc", "/instellingen", "/roepingen/../../evil", "/roepingen/a/b", "/roepingen/%2F%2Fevil.example", null, ""]) {
      expect(webAppTargetFor(path, user), String(path)).toMatch(/^\/app(\?to=%2F[A-Za-z0-9%_-]*)?$/);
    }
    expect(webAppTargetFor("/ringen", user)).toBe("/app");
    expect(webAppTargetFor("/roepingen/%2F%2Fevil.example", user)).toBe("/app");
  });
});

describe("webAppTargetFor – beheerder (webmin)", () => {
  const admin = { isAdmin: true };
  it("blijft op de webmin-pagina's", () => {
    for (const path of ["/dashboard", "/ringen", "/ringen/abc", "/instellingen", "/profiel"]) expect(webAppTargetFor(path, admin), path).toBeNull();
  });
  it("de vroegere gebruikerspagina's gaan naar het webmin-overzicht", () => {
    for (const path of ["/roepingen", "/roepingen/abc", "/roepingen/nieuw", "/gebruikers"]) expect(webAppTargetFor(path, admin), path).toBe("/dashboard");
  });
});
