import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
vi.mock("../src/components/Reauth", () => ({ useReauth: () => ({ run: (fn: () => Promise<unknown>) => fn(), dialog: null }) }));

import { renderUi } from "./ui";
const { CatalogOverview, procedureKind } = await import("../src/screens/CatalogOverview");
const { UserManager } = await import("../src/screens/UserManager");

afterEach(cleanup);

const entry = (over: Record<string, unknown>) => ({
  code: "x", source: "STANDAARD", name: "X", aliases: [], category: "Ringpresidium", type: "OVERIG", handbook: ["Algemeen handboek 30.8.3"], approvalRoute: "RINGPRESIDIUM_HOGE_RAAD", ringtoolsProcess: true,
  extraApproval: null, grantedBy: "RINGPRESIDENT_OF_RAADGEVER", appointedBy: "RINGPRESIDENT_OF_RAADGEVER", supportVenue: "RINGCONFERENTIE", appointment: "VERPLICHT", releaseFollowUps: [], warning: null,
  reviewNotes: [], active: true, catalogVersion: "2026.11-2", ruleStatus: "GEVERIFIEERD", requiresProcedureConfirmation: false, ...over,
});
const CATALOG = {
  version: "2026.11-2", categories: ["Ringpresidium", "Muziek", "Zustershulpvereniging van de ring"],
  callings: [
    entry({ code: "ringadministrateur", name: "Ringadministrateur" }),
    entry({ code: "muziekdeskundige", name: "Muziekdeskundige", category: "Muziek", ruleStatus: "TE_BEOORDELEN", grantedBy: "ONBEKEND", appointedBy: "ONBEKEND", supportVenue: "NADER_BEPALEN", appointment: "ONBEKEND", reviewNotes: ["Bevoegdheidsregel niet geverifieerd."], requiresProcedureConfirmation: true }),
    entry({ code: "ringpresident", name: "Ringpresident", ringtoolsProcess: false, ruleStatus: "BIJZONDER", approvalRoute: "AANGEWEZEN_AUTORITEIT", extraApproval: "Aangewezen algemeen autoriteit", grantedBy: "BIJZONDER", appointedBy: "BIJZONDER" }),
    entry({ code: "zhv-presidente", name: "ZHV-presidente", category: "Zustershulpvereniging van de ring", releaseFollowUps: ["a", "b"] }),
    entry({ code: "eigen-1", source: "EIGEN", name: "Koorcoördinator", category: "Muziek", ruleStatus: "EIGEN", approvalRoute: null, grantedBy: null, appointedBy: null, supportVenue: null, appointment: null, handbook: [], catalogVersion: null }),
  ],
};

describe("Catalogusoverzicht onder Inrichting", () => {
  it("onderscheidt geverifieerde regels, de algemene ringprocedure (nog te beoordelen), functies buiten Ringtools en eigen roepingen", () => {
    const kinds = Object.fromEntries(CATALOG.callings.map((c) => [c.code, procedureKind(c as never)]));
    expect(kinds).toEqual({ ringadministrateur: "GEVERIFIEERD", muziekdeskundige: "ALGEMEEN", ringpresident: "BUITEN", "zhv-presidente": "GEVERIFIEERD", "eigen-1": "EIGEN" });
  });

  it("toont per organisatie de functies met procedure, bevoegdheden, steunverlening, aanstellingsplicht, handboek en controlepunten; alleen lezen", async () => {
    const catalog = vi.fn(async () => CATALOG);
    auth.value = { api: { catalog }, ring: { id: "r1" } };
    renderUi(<MemoryRouter><CatalogOverview ringId="r1" /></MemoryRouter>);
    expect(await screen.findByText("Ringadministrateur")).toBeTruthy();
    expect(screen.getByText(/Alleen lezen/)).toBeTruthy();
    expect(screen.getByText(/een bestaand dossier behoudt de procedure die bij indienen is vastgelegd/)).toBeTruthy();
    expect(screen.getByText("1 geverifieerd".replace("1", "2"))).toBeTruthy();
    expect(screen.getByRole("group", { name: "Muziek" })).toBeTruthy();

    const music = within(screen.getByText("Muziekdeskundige").closest("details")!);
    expect(music.getByText(/Algemene ringprocedure – regels nog te beoordelen/)).toBeTruthy();
    expect(music.getAllByText("Niet vastgesteld – menselijke controle nodig")).toHaveLength(2); // roepen en aanstellen
    expect(music.getByText("Nader te bepalen")).toBeTruthy();
    expect(music.getByText("Bevoegdheidsregel niet geverifieerd.")).toBeTruthy();
    expect(music.getByText(/Ringtools kent hier geen bevoegdheden aan personen toe/)).toBeTruthy();

    const admin = within(screen.getByText("Ringadministrateur").closest("details")!);
    expect(admin.getAllByText("Ringpresident of aangewezen raadgever")).toHaveLength(2); // roepen en aanstellen
    expect(admin.getByText("Ringconferentie")).toBeTruthy();
    expect(admin.getByText("Verplicht")).toBeTruthy();
    expect(admin.getByText(/Algemeen handboek 30.8.3/)).toBeTruthy();

    const president = within(screen.getByText("Ringpresident").closest("details")!);
    expect(president.getByText(/procedure buiten Ringtools/)).toBeTruthy();
    expect(president.getAllByText(/Aangewezen algemeen autoriteit/).length).toBeGreaterThan(0);

    expect(within(screen.getByText("ZHV-presidente").closest("details")!).getByText(/verplicht naar de raadgevers gevraagd/)).toBeTruthy();
    expect(within(screen.getByText("Koorcoördinator").closest("details")!).getByText(/geen bevoegdheden of bijzondere kerkelijke procedures afgeleid/)).toBeTruthy();
  });

  it("zoekt, filtert op organisatie (server) en soort regel (client)", async () => {
    const catalog = vi.fn(async () => CATALOG);
    auth.value = { api: { catalog }, ring: { id: "r1" } };
    renderUi(<MemoryRouter><CatalogOverview ringId="r1" /></MemoryRouter>);
    await screen.findByText("Ringadministrateur");
    fireEvent.change(screen.getByLabelText("Soort regel"), { target: { value: "BUITEN" } });
    expect(screen.queryByText("Ringadministrateur")).toBeNull();
    expect(screen.getByText("Ringpresident")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Soort regel"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText(/Alleen functies met controlepunten/));
    expect(screen.queryByText("Ringadministrateur")).toBeNull();
    expect(screen.getByText("Muziekdeskundige")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Zoeken"), { target: { value: "muziek" } });
    fireEvent.change(screen.getByLabelText("Organisatie"), { target: { value: "Muziek" } });
    await waitFor(() => expect(catalog).toHaveBeenLastCalledWith("r1", "muziek", "Muziek"));
  });
});

describe("Gebruikersbeheer: gestructureerde kerkelijke functie", () => {
  const user = (over: Record<string, unknown>) => ({ membershipId: "m1", userId: "u1", name: "Piet", email: "p@x.nl", churchFunction: "", churchFunctionCode: "ONBEKEND", role: "RINGPRESIDIUM", isRingManager: false, appointAuthority: "NONE", activated: true, active: true, otherRingCount: 0, ...over });
  function setup(users: unknown[]) {
    const api = { ringUsers: vi.fn(async () => ({ users })), addRingUser: vi.fn(async () => ({ userId: "n", name: "N", joinedRounds: 0 })), updateRingUser: vi.fn(async () => ({ ok: true, joinedRounds: 0 })) };
    auth.value = { api, ring: { id: "r1" } };
    renderUi(<MemoryRouter><UserManager ringId="r1" /></MemoryRouter>);
    return api;
  }

  it("toont een ontbrekende functie als 'nog vast te leggen' en biedt alleen functies die bij de rol passen", async () => {
    setup([user({})]);
    expect(await screen.findByText("Kerkelijke functie nog vast te leggen")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Wijzig Piet"));
    const fn = screen.getByLabelText("Kerkelijke functie") as HTMLSelectElement;
    expect([...fn.options].map((o) => o.value)).toEqual(["ONBEKEND", "RINGPRESIDENT", "EERSTE_RAADGEVER", "TWEEDE_RAADGEVER", "ANDERS"]); // geen hogeraadslid/secretaris bij rol ringpresidium
    fireEvent.change(screen.getByLabelText("Ringtools-rol (toegang)"), { target: { value: "HOGERAAD" } });
    expect([...(screen.getByLabelText("Kerkelijke functie") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["ONBEKEND", "HOGERAADSLID", "ANDERS"]);
    expect(screen.getByText(/Een rol geeft nooit kerkelijke bevoegdheid/)).toBeTruthy();
  });

  it("machtiging alleen bij passende functie; de ringpresident heeft geen machtiging nodig; opslaan stuurt functie en machtiging mee", async () => {
    const api = setup([user({ churchFunctionCode: "EERSTE_RAADGEVER", role: "RINGPRESIDIUM" })]);
    fireEvent.click(await screen.findByLabelText("Wijzig Piet"));
    const auth1 = screen.getByLabelText("Machtiging") as HTMLSelectElement;
    expect([...auth1.options].map((o) => o.value)).toEqual(["NONE", "AANGEWEZEN_RAADGEVER"]);
    fireEvent.change(auth1, { target: { value: "AANGEWEZEN_RAADGEVER" } });
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    await waitFor(() => expect(api.updateRingUser).toHaveBeenCalledWith("m1", expect.objectContaining({ churchFunctionCode: "EERSTE_RAADGEVER", appointAuthority: "AANGEWEZEN_RAADGEVER", role: "RINGPRESIDIUM" })));

    fireEvent.click(await screen.findByLabelText("Wijzig Piet"));
    fireEvent.change(screen.getByLabelText("Kerkelijke functie"), { target: { value: "RINGPRESIDENT" } });
    expect([...(screen.getByLabelText("Machtiging") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["NONE"]);
    expect(screen.getByText(/op grond van zijn functie bevoegd/)).toBeTruthy();
  });

  it("een functie die niet bij de nieuwe rol past wordt teruggezet naar 'Nog niet vastgelegd' (nooit geraden)", async () => {
    setup([user({ churchFunctionCode: "RINGPRESIDENT", role: "RINGPRESIDIUM" })]);
    fireEvent.click(await screen.findByLabelText("Wijzig Piet"));
    fireEvent.change(screen.getByLabelText("Ringtools-rol (toegang)"), { target: { value: "RINGSECRETARIS" } });
    expect((screen.getByLabelText("Kerkelijke functie") as HTMLSelectElement).value).toBe("ONBEKEND");
  });
});
