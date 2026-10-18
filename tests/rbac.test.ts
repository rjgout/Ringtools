import { describe, expect, it } from "vitest";
import { canAssignRole, canManageSettings, canManageUsers, canManageWorkflow, canVoteHogeraad, canVotePresidium, isStaff } from "@/lib/rbac";

describe("Rolverdeling", () => {
  it("alleen ringpresidium stemt in de presidiumfase", () => {
    expect(canVotePresidium("RINGPRESIDIUM")).toBe(true);
    expect(canVotePresidium("RINGSECRETARIS")).toBe(false);
    expect(canVotePresidium("RINGADMINISTRATEUR")).toBe(false);
    expect(canVotePresidium("HOGERAAD")).toBe(false);
    expect(canVotePresidium("ADMIN")).toBe(false);
  });

  it("alleen de hoge raad stemt in de hogeraadfase", () => {
    expect(canVoteHogeraad("HOGERAAD")).toBe(true);
    expect(canVoteHogeraad("RINGPRESIDIUM")).toBe(false);
  });

  it("secretaris en administrateur beheren de workflow maar stemmen niet", () => {
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

  it("hoge raad beheert geen gebruikers", () => {
    expect(canManageUsers("HOGERAAD")).toBe(false);
    expect(canManageUsers("RINGPRESIDIUM")).toBe(true);
    expect(canManageUsers("ADMIN")).toBe(true);
  });

  it("niemand kan via gebruikersbeheer het ADMIN-account toekennen (voorkomt bevoegdheidsverhoging)", () => {
    expect(canAssignRole("RINGPRESIDIUM", "ADMIN")).toBe(false);
    expect(canAssignRole("ADMIN", "ADMIN")).toBe(false);
    expect(canAssignRole("RINGPRESIDIUM", "HOGERAAD")).toBe(true);
  });
});
