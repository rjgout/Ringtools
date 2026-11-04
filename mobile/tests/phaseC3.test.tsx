import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiClient, ApiRequestError } from "../src/lib/api";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

const { NewCalling } = await import("../src/screens/NewCalling");

afterEach(cleanup);

const entry = (over: Record<string, unknown>) => ({
  code: "x", source: "STANDAARD", name: "X", aliases: [], category: "Ringpresidium", type: "OVERIG", handbook: [], approvalRoute: "RINGPRESIDIUM_HOGE_RAAD", ringtoolsProcess: true,
  extraApproval: null, grantedBy: null, appointedBy: null, supportVenue: null, appointment: null, releaseFollowUps: [], warning: null, reviewNotes: [], active: true, catalogVersion: "1",
  ruleStatus: "GEVERIFIEERD", requiresProcedureConfirmation: false, ...over,
});
const suggestions = (over: Record<string, unknown> = {}) => ({
  unit: { id: "w1", name: "Voorbeeld", kind: "WIJK", responsibleStatus: "OK" },
  roepen: null, ondersteunen: null, aanstellen: { userId: "h1", name: "Hans", source: "UNIT_VERANTWOORDELIJKE" },
  notes: { roepen: null, aanstellen: null }, eligible: { roepen: [{ id: "p1", name: "Piet" }], aanstellen: [{ id: "h1", name: "Hans" }, { id: "p1", name: "Piet" }] }, ...over,
});

function setup(api: Record<string, unknown>, path = "/voorstellen/nieuw") {
  const full = {
    units: vi.fn(async () => ({ units: [{ id: "w1", kind: "WIJK", name: "Voorbeeld", active: true, responsibleStatus: "OK", responsible: null, defaults: {} }] })),
    ringMembers: vi.fn(async () => ({ members: [{ id: "u1", name: "Anna", role: "HOGERAAD", churchFunction: "" }] })),
    catalog: vi.fn(async () => ({ version: "1", categories: ["Ringpresidium"], callings: [
      entry({ code: "ringadministrateur", name: "Ringadministrateur" }),
      entry({ code: "instituutshoofd", name: "Instituutshoofd", category: "Seminarie en instituut", ruleStatus: "TE_BEOORDELEN", requiresProcedureConfirmation: true, warning: "Menselijke controle nodig: x" }),
    ] })),
    suggestions: vi.fn(async () => ({ suggestions: suggestions() })),
    createDraft: vi.fn(async () => ({ id: "d1" })), updateDraft: vi.fn(async () => ({ ok: true })), submitDraft: vi.fn(async () => ({ id: "nieuw", alreadySubmitted: false })),
    deleteDraft: vi.fn(async () => ({ ok: true })), createCustomCalling: vi.fn(),
    ...api,
  };
  auth.value = { api: full, ring: { id: "r1", name: "Ring" } };
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/voorstellen/nieuw" element={<NewCalling />} /><Route path="/voorstellen/concept/:id" element={<NewCalling />} />
    <Route path="/roepingen/:id" element={<div>detail</div>} /><Route path="/voorstellen" element={<div>lijst</div>} />
  </Routes></MemoryRouter>);
  return full as Record<string, ReturnType<typeof vi.fn>>;
}

describe("ApiClient: concepten", () => {
  it("gebruikt uitsluitend /drafts voor nieuwe voorstellen (geen directe aanmaak)", async () => {
    const calls: { url: string; body: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, body: (init.body as string) ?? null }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "https://x/api", getToken: () => "t".repeat(30), fetchImpl });
    await api.createDraft("r1", { personName: "Jan" }); await api.updateDraft("d1", { unitId: "w1" }); await api.submitDraft("d1"); await api.deleteDraft("d1"); await api.suggestions("r1", "w1", "STANDAARD", "x");
    expect(calls.map((c) => c.url)).toEqual([
      "https://x/api/drafts?ring=r1", "https://x/api/drafts/d1", "https://x/api/drafts/d1/submit", "https://x/api/drafts/d1/delete", "https://x/api/drafts/suggestions?ring=r1&unit=w1&source=STANDAARD&code=x",
    ]);
    expect((api as unknown as Record<string, unknown>).createCalling).toBeUndefined();
  });
});

describe("Nieuw voorstel in vijf stappen", () => {
  it("naam → unit → roeping → verantwoordelijken → indienen: bewaart als concept en dient server-side in", async () => {
    const api = setup({});
    fireEvent.change(await screen.findByLabelText(/Naam \(handmatig invoeren\)/), { target: { value: "Jan Jansen" } });
    fireEvent.change(screen.getByLabelText("Wijk of gemeente"), { target: { value: "w1" } });
    const submit = screen.getByRole("button", { name: "Voorstel indienen" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // nog geen roeping gekozen
    fireEvent.click(await screen.findByRole("option", { name: /Ringadministrateur/ }));
    expect(submit.disabled).toBe(false);
    // voorgesteld verantwoordelijke overnemen (alleen aanstellen is voorgesteld, want alleen daarvoor is hij bevoegd)
    fireEvent.click(await screen.findByRole("button", { name: /Voorstel overnemen: Hans/ }));
    expect((screen.getByLabelText("Wie stelt de persoon aan?") as HTMLSelectElement).value).toBe("h1");
    expect([...(screen.getByLabelText("Wie roept de persoon?") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Nog niet toegewezen", "Piet"]); // alleen bevoegden
    fireEvent.click(submit);
    await waitFor(() => expect(api.submitDraft).toHaveBeenCalledWith("d1"));
    expect(api.createDraft).toHaveBeenCalledWith("r1", expect.objectContaining({ personName: "Jan Jansen", unitId: "w1", functionSource: "STANDAARD", functionCode: "ringadministrateur", aanstellenAssigneeId: "h1" }));
    expect(await screen.findByText("detail")).toBeTruthy();
  });

  it("slaat een onvolledig concept op zonder in te dienen", async () => {
    const api = setup({});
    fireEvent.change(await screen.findByLabelText(/Naam \(handmatig invoeren\)/), { target: { value: "Alleen naam" } });
    fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
    await waitFor(() => expect(api.createDraft).toHaveBeenCalledWith("r1", expect.objectContaining({ personName: "Alleen naam", functionCode: null, unitId: null })));
    expect(api.submitDraft).not.toHaveBeenCalled();
    expect(await screen.findByText("lijst")).toBeTruthy();
  });

  it("een niet-geverifieerde roeping vraagt om bevestiging van de bevoegde leiding en toont de waarschuwing", async () => {
    const api = setup({ suggestions: vi.fn(async () => ({ suggestions: suggestions({ aanstellen: null, notes: { roepen: "Menselijke controle nodig: geen bevoegdheden vastgesteld.", aanstellen: "Menselijke controle nodig: geen bevoegdheden vastgesteld." }, eligible: { roepen: [], aanstellen: [] } }) })) });
    fireEvent.change(await screen.findByLabelText(/Naam \(handmatig invoeren\)/), { target: { value: "Jan Jansen" } });
    fireEvent.change(screen.getByLabelText("Wijk of gemeente"), { target: { value: "w1" } });
    fireEvent.click(await screen.findByRole("option", { name: /Instituutshoofd/ }));
    expect((await screen.findAllByText(/Menselijke controle nodig/)).length).toBeGreaterThan(0);
    const submit = screen.getByRole("button", { name: "Voorstel indienen" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/bevoegde leiding heeft de procedure/));
    expect(submit.disabled).toBe(false);
    // bevoegde externe persoon kan handmatig worden geregistreerd
    fireEvent.change(screen.getByLabelText(/Of: externe uitvoerder zonder Ringtools-account/, { selector: "#ex-aanstellen" }), { target: { value: "Gebiedszeventiger Extern" } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.createDraft).toHaveBeenCalledWith("r1", expect.objectContaining({ procedureConfirmed: true, aanstellenExternalName: "Gebiedszeventiger Extern", aanstellenAssigneeId: null })));
  });

  it("dubbel tikken op Indienen dient maar één keer in", async () => {
    let resolve: (v: { id: string; alreadySubmitted: boolean }) => void = () => {};
    const submitDraft = vi.fn(() => new Promise<{ id: string; alreadySubmitted: boolean }>((r) => { resolve = r; }));
    const api = setup({ submitDraft });
    fireEvent.change(await screen.findByLabelText(/Naam \(handmatig invoeren\)/), { target: { value: "Jan Jansen" } });
    fireEvent.change(screen.getByLabelText("Wijk of gemeente"), { target: { value: "w1" } });
    fireEvent.click(await screen.findByRole("option", { name: /Ringadministrateur/ }));
    const form = screen.getByRole("button", { name: "Voorstel indienen" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(submitDraft).toHaveBeenCalledTimes(1));
    expect(api.createDraft).toHaveBeenCalledTimes(1);
    resolve({ id: "nieuw", alreadySubmitted: false });
    expect(await screen.findByText("detail")).toBeTruthy();
  });

  it("opent een bestaand concept, werkt het bij en kan het verwijderen; servermeldingen worden getoond", async () => {
    const draft = vi.fn(async () => ({
      draft: { id: "d9", ringId: "r1", personName: "Bewaarde Naam", unitId: "w1", functionSource: "STANDAARD", functionCode: "ringadministrateur", roepenAssigneeId: null, ondersteunenAssigneeId: null, aanstellenAssigneeId: null, roepenExternalName: null, aanstellenExternalName: null, procedureConfirmed: false, submitted: false, updatedAt: "" },
      procedure: { source: "STANDAARD", code: "ringadministrateur", name: "Ringadministrateur", category: "Ringpresidium", ruleStatus: "GEVERIFIEERD", requiresConfirmation: false, warning: "", reviewNotes: [] },
      suggestions: suggestions(),
    }));
    const submitDraft = vi.fn(async () => { throw new ApiRequestError(400, "Kies de wijk of gemeente van herkomst.", "workflow"); });
    const api = setup({ draft, submitDraft }, "/voorstellen/concept/d9");
    await waitFor(() => expect((screen.getByLabelText(/Naam \(handmatig invoeren\)/) as HTMLInputElement).value).toBe("Bewaarde Naam"));
    fireEvent.click(screen.getByRole("button", { name: "Voorstel indienen" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/wijk of gemeente van herkomst/);
    expect(api.updateDraft).toHaveBeenCalledWith("d9", expect.objectContaining({ personName: "Bewaarde Naam" })); // bestaand concept wordt bijgewerkt, niet opnieuw aangemaakt
    expect(api.createDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Concept verwijderen" }));
    await waitFor(() => expect(api.deleteDraft).toHaveBeenCalledWith("d9"));
  });
});
