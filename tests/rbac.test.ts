import { describe, expect, it } from "vitest";
import { canAssignRole, canManageSettings, canManageRingUsers, canManageWorkflow, canVoteHogeraad, canVotePresidium, isStaff } from "@/lib/rbac";

describe("Rolverdeling", () => {
  it("alleen ringpresidium brengt ondersteuning uit in de presidiumronde", () => {
    expect(canVotePresidium("RINGPRESIDIUM")).toBe(true);
    expect(canVotePresidium("RINGSECRETARIS")).toBe(false);
    expect(canVotePresidium("RINGADMINISTRATEUR")).toBe(false);
    expect(canVotePresidium("HOGERAAD")).toBe(false);
    expect(canVotePresidium("ADMIN")).toBe(false);
  });

  it("alleen de hoge raad brengt ondersteuning uit in de hogeraadronde", () => {
    expect(canVoteHogeraad("HOGERAAD")).toBe(true);
    expect(canVoteHogeraad("RINGPRESIDIUM")).toBe(false);
  });

  it("secretaris en administrateur beheren de workflow maar brengen geen ondersteuning uit", () => {
    expect(isStaff("RINGSECRETARIS")).toBe(true);
    expect(isStaff("RINGADMINISTRATEUR")).toBe(true);
    expect(canManageWorkflow("RINGSECRETARIS")).toBe(true);
    expect(canVotePresidium("RINGSECRETARIS")).toBe(false);
    expect(canVoteHogeraad("RINGADMINISTRATEUR")).toBe(false);
  });

  it("alleen de systeemadministrator beheert instellingen", () => {
    expect(canManageSettings("ADMIN")).toBe(true);
    expect(canManageSettings("RINGPRESIDIUM")).toBe(false);
  });

  it("gebruikersbeheer is een aparte bevoegdheid (ringbeheerder), los van de workflowrol", () => {
    const manager = { isRingManager: true, active: true };
    const nonManager = { isRingManager: false, active: true };
    expect(canManageRingUsers("RINGSECRETARIS", manager)).toBe(true);
    expect(canManageRingUsers("HOGERAAD", manager)).toBe(true); // rol doet er niet toe
    expect(canManageRingUsers("RINGPRESIDIUM", nonManager)).toBe(false); // functie/rol alleen is niet genoeg
    expect(canManageRingUsers("HOGERAAD", { isRingManager: true, active: false })).toBe(false);
    expect(canManageRingUsers("RINGPRESIDIUM", null)).toBe(false);
    expect(canManageRingUsers("ADMIN", null)).toBe(true);
  });

  it("niemand kan via gebruikersbeheer het ADMIN-account toekennen (voorkomt bevoegdheidsverhoging)", () => {
    expect(canAssignRole("RINGPRESIDIUM", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("RINGPRESIDIUM", "HOGERAAD")).toBe(true);
  });
});
