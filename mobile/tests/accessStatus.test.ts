import { describe, expect, it } from "vitest";
import { accessInfo } from "../src/lib/accessStatus";
import type { ManagedUser, UserInvitation } from "@shared/api-types";

const NOW = new Date("2026-11-06T12:00:00Z");
const inv = (over: Partial<UserInvitation> = {}): UserInvitation => ({
  id: "i1", status: "VERSTUURD", sentAt: "2026-11-03T10:00:00Z", expiresAt: "2026-11-10T10:00:00Z", canResend: true, canRevoke: true, resendAvailableAt: null, resendBlockedReason: null, ...over,
});
const user = (over: Partial<ManagedUser> = {}): Pick<ManagedUser, "activated" | "activatedAt" | "active" | "email" | "invitation"> => ({
  activated: false, activatedAt: null, active: true, email: "lid@example.nl", invitation: null, ...over,
});

describe("Toegangsstatus per gebruiker", () => {
  it("niet geactiveerd met verstuurde uitnodiging: status, verzenddatum en opnieuw versturen", () => {
    const a = accessInfo(user({ invitation: inv() }), NOW);
    expect(a.badge).toBe("Nog niet geactiveerd");
    expect(a.lines.join(" ")).toMatch(/Uitnodiging verstuurd op .*geldig tot/);
    expect(a.resendInvitationId).toBe("i1");
    expect(a.resendNote).toBeNull();
    expect(a.guidance).toBeNull();
  });
  it("net verstuurd: opnieuw versturen toont de wachttijd (de server blijft de wachttijd afdwingen)", () => {
    const a = accessInfo(user({ invitation: inv({ resendAvailableAt: "2026-11-06T12:03:00Z" }) }), NOW);
    expect(a.resendInvitationId).toBe("i1");
    expect(a.resendNote).toMatch(/Opnieuw versturen kan vanaf/);
  });
  it("niet verstuurd, verlopen: opnieuw versturen mogelijk, met duidelijke status", () => {
    expect(accessInfo(user({ invitation: inv({ status: "NIET_VERSTUURD", sentAt: null }) }), NOW).lines[0]).toMatch(/nog niet verstuurd/);
    const exp = accessInfo(user({ invitation: inv({ status: "VERLOPEN" }) }), NOW);
    expect(exp.lines[0]).toMatch(/verlopen/);
    expect(exp.resendInvitationId).toBe("i1");
  });
  it("verzendlimiet bereikt: geen knop, wel uitleg", () => {
    const a = accessInfo(user({ invitation: inv({ canResend: false, resendBlockedReason: "LIMIET" }) }), NOW);
    expect(a.resendInvitationId).toBeNull();
    expect(a.resendNote).toMatch(/maximale aantal keren/);
  });
  it("geactiveerd account: opnieuw uitnodigen is NIET de oplossing; begrijpelijke, veilige vervolgstappen met het gebruikte e-mailadres", () => {
    const a = accessInfo(user({ activated: true, activatedAt: "2026-10-01T09:00:00Z", invitation: inv({ status: "GEACTIVEERD", canResend: false }) }), NOW);
    expect(a.badge).toBe("Geactiveerd");
    expect(a.resendInvitationId).toBeNull();
    expect(a.guidance?.[0]).toMatch(/lost een ontbrekende inlogcode niet op/);
    expect(a.guidance?.join(" ")).toContain("lid@example.nl");
    expect(a.guidance?.join(" ")).toMatch(/spammap/);
    expect(a.guidance?.join(" ")).not.toMatch(/inactief/); // account is actief
  });
  it("geactiveerd maar inactief: de uitleg noemt dat een inactief account geen inlogcode krijgt", () => {
    const a = accessInfo(user({ activated: true, activatedAt: "2026-10-01T09:00:00Z", active: false }), NOW);
    expect(a.guidance?.join(" ")).toMatch(/inactief/);
  });
  it("account zonder uitnodiging en nog nooit ingelogd: uitleg dat de persoon zelf een code kan aanvragen, geen opnieuw-versturen", () => {
    const a = accessInfo(user(), NOW);
    expect(a.resendInvitationId).toBeNull();
    expect(a.guidance?.join(" ")).toMatch(/nog nooit is ingelogd/);
    expect(a.guidance?.join(" ")).toMatch(/geen uitnodiging|Een uitnodiging is niet nodig/);
  });
  it("inlogmailknop: alleen voor een bestaand, actief account zonder openstaande uitnodiging; met wachttijdmelding", () => {
    expect(accessInfo(user({ canResendLoginMail: true }), NOW).loginMail.show).toBe(true);
    expect(accessInfo(user(), NOW).loginMail.show).toBe(false); // server staat het niet toe
    expect(accessInfo(user({ canResendLoginMail: true, active: false }), NOW).loginMail.show).toBe(false);
    expect(accessInfo(user({ canResendLoginMail: true, invitation: inv() }), NOW).loginMail.show).toBe(false); // openstaande uitnodiging: eerst die opnieuw versturen
    const wait = accessInfo(user({ canResendLoginMail: true, loginMailAvailableAt: "2026-11-07T10:03:00Z" }), NOW);
    expect(wait.loginMail.note).toMatch(/Net verstuurd/);
  });
  it("ingetrokken uitnodiging: geen knop; uitleg", () => {
    const a = accessInfo(user({ invitation: inv({ status: "INGETROKKEN", canResend: false, canRevoke: false }) }), NOW);
    expect(a.resendInvitationId).toBeNull();
    expect(a.guidance?.join(" ")).toMatch(/ingetrokken/);
  });
  it("toont nooit een token of code", () => {
    const text = JSON.stringify(accessInfo(user({ invitation: inv() }), NOW));
    expect(text).not.toMatch(/token|"code"/i);
  });
});
