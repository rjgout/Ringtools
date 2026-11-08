import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiClient } from "../src/lib/api";
import { parseTarget, routeFor } from "../src/lib/links";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

import { answerDialog, pickMenuItem, renderUi } from "./ui";
const { OntheffingForm } = await import("../src/screens/OntheffingForm");
const { OntheffingDetail } = await import("../src/screens/OntheffingDetail");
const { Ontheffingen } = await import("../src/screens/Ontheffingen");

afterEach(cleanup);

const entry = (over: Record<string, unknown>) => ({
  code: "x", source: "STANDAARD", name: "X", aliases: [], category: "Zustershulpvereniging van de ring", type: "PRESIDENT", handbook: [], approvalRoute: "RINGPRESIDIUM_HOGE_RAAD", ringtoolsProcess: true,
  extraApproval: null, grantedBy: null, appointedBy: null, supportVenue: null, appointment: null, releaseFollowUps: [], warning: null, reviewNotes: [], active: true, catalogVersion: "1",
  ruleStatus: "GEVERIFIEERD", requiresProcedureConfirmation: false, ...over,
});

describe("ApiClient: ontheffingen", () => {
  it("gebruikt uitsluitend de beveiligde ontheffingsroutes en stuurt geen namen in een URL", async () => {
    const calls: { url: string; body: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, body: (init.body as string) ?? null }); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "https://x/api", getToken: () => "t".repeat(30), fetchImpl });
    await api.ontheffingen("r1"); await api.ontheffing("o1"); await api.createOntheffing("r1", { unitId: "w1" }); await api.updateOntheffing("o1", { unitId: "w1" });
    await api.submitOntheffing("o1"); await api.voteOntheffing("o1", true); await api.releaseOntheffing("o1"); await api.deleteOntheffing("o1");
    await api.ontheffingStep("p1", "inform"); await api.ontheffingStep("p1", "announce", { thanksOffered: true }); await api.ontheffingStep("p1", "process");
    expect(calls.map((c) => c.url.replace("https://x/api", ""))).toEqual([
      "/ontheffingen?ring=r1", "/ontheffingen/o1", "/ontheffingen?ring=r1", "/ontheffingen/o1", "/ontheffingen/o1/submit", "/ontheffingen/o1/vote",
      "/ontheffingen/o1/release", "/ontheffingen/o1/delete", "/ontheffingen/persons/p1/inform", "/ontheffingen/persons/p1/announce", "/ontheffingen/persons/p1/process",
    ]);
    expect(calls.find((c) => c.url.endsWith("/announce"))?.body).toBe(JSON.stringify({ thanksOffered: true }));
  });
});

describe("Deeplinks voor ontheffingen", () => {
  it("herkent alleen het interne pad (pushmelding in de app); geen universele link of e-maillink", () => {
    expect(parseTarget("/ontheffingen/abcdefgh1234", "h.nl")).toEqual({ kind: "ontheffing", id: "abcdefgh1234" });
    expect(routeFor({ kind: "ontheffing", id: "abcdefgh1234" })).toBe("/ontheffingen/abcdefgh1234");
    expect(parseTarget("https://evil.example/ontheffingen/abcdefgh1234", "h.nl")).toBeNull();
    expect(parseTarget("/ontheffingen/../x", "h.nl")).toBeNull();
    expect(parseTarget("/ontheffingen", "h.nl")).toBeNull();
  });
});

function renderForm(api: Record<string, unknown>, path = "/ontheffingen/nieuw") {
  const full = {
    units: vi.fn(async () => ({ units: [{ id: "w1", kind: "WIJK", name: "Voorbeeld", active: true, responsibleStatus: "OK", responsible: null, defaults: {} }] })),
    ringMembers: vi.fn(async () => ({ members: [{ id: "u1", name: "Anna Hogeraad", role: "HOGERAAD", churchFunction: "" }] })),
    catalog: vi.fn(async () => ({ version: "1", categories: ["Zustershulpvereniging van de ring"], callings: [
      entry({ code: "zhv-presidente", name: "ZHV-presidente", releaseFollowUps: ["eerste", "tweede"] }),
    ] })),
    ontheffing: vi.fn(),
    createOntheffing: vi.fn(async () => ({ id: "o1" })), updateOntheffing: vi.fn(async () => ({ ok: true })), submitOntheffing: vi.fn(async () => ({ id: "o1", alreadySubmitted: false, notificationsDelivered: true })),
    deleteOntheffing: vi.fn(async () => ({ ok: true })),
    ...api,
  };
  auth.value = { api: full, ring: { id: "r1", name: "Ring", role: "RINGSECRETARIS" } };
  renderUi(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/ontheffingen/nieuw" element={<OntheffingForm />} /><Route path="/ontheffingen/concept/:id" element={<OntheffingForm />} />
    <Route path="/ontheffingen/:id" element={<div>detail</div>} /><Route path="/ontheffingen" element={<div>lijst</div>} />
  </Routes></MemoryRouter>);
  return full as Record<string, ReturnType<typeof vi.fn>>;
}

const conceptView = (over: Record<string, unknown> = {}) => ({
  id: "o1", ringId: "r1", status: "CONCEPT", statusLabel: "Concept", stage: null, joint: true, unit: null, unitId: "w1", procedureConfirmed: false, requiresConfirmation: false,
  function: { source: "STANDAARD", code: "zhv-presidente", name: "ZHV-presidente", ruleStatus: "GEVERIFIEERD", warning: null },
  persons: [
    { id: "p0", role: "HOOFD", functionName: "ZHV-presidente", name: "Anna Presidente", answer: "NAAM", accountMode: "GEEN_ACCOUNT", userId: null },
    { id: "p1", role: "RAADGEVER", followUpCode: "eerste", functionName: "Eerste raadgeefster", name: null, answer: "OPEN", accountMode: "ONBEKEND", userId: null },
    { id: "p2", role: "RAADGEVER", followUpCode: "tweede", functionName: "Tweede raadgeefster", name: null, answer: "OPEN", accountMode: "ONBEKEND", userId: null },
  ],
  followUps: [{ code: "eerste", name: "Eerste raadgeefster" }, { code: "tweede", name: "Tweede raadgeefster" }],
  viewer: { staff: true, canVote: false, myVote: null, canSubmit: true, canRelease: false, canDecide: false, canDelete: true },
  ...over,
});

describe("Ontheffing: concept", () => {
  it("vraagt expliciet naar het Ringtools-account en koppelt nooit op naam; opslaan verstuurt niets", async () => {
    const api = renderForm({});
    fireEvent.change(await screen.findByLabelText("Naam"), { target: { value: "Anna Hogeraad" } });
    // geen automatische keuze: beide opties zijn leeg totdat de gebruiker kiest
    expect((screen.getByLabelText("Nee, geen Ringtools-account") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(/Ja, dit account/));
    fireEvent.change(screen.getByLabelText("Ringtools-account van de betrokkene"), { target: { value: "u1" } });
    fireEvent.change(screen.getByLabelText("Wijk of gemeente"), { target: { value: "w1" } });
    fireEvent.click(await screen.findByRole("option", { name: /ZHV-presidente/ }));
    fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
    await waitFor(() => expect(api.createOntheffing).toHaveBeenCalled());
    expect(api.createOntheffing).toHaveBeenCalledWith("r1", expect.objectContaining({
      unitId: "w1", functionSource: "STANDAARD", functionCode: "zhv-presidente",
      persons: [expect.objectContaining({ role: "HOOFD", name: "Anna Hogeraad", accountMode: "GEKOPPELD", userId: "u1" })],
    }));
    expect(api.submitOntheffing).not.toHaveBeenCalled();
    expect(screen.getByText(/nooit automatisch op naam/)).toBeTruthy();
  });

  it("toont verplicht de vragen over de raadgevers: 'Naam invullen' of 'Niet van toepassing' met reden", async () => {
    const api = renderForm({ ontheffing: vi.fn(async () => conceptView()) }, "/ontheffingen/concept/o1");
    expect(await screen.findByText("Eerste raadgeefster")).toBeTruthy();
    expect(screen.getAllByLabelText("Naam invullen")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("Niet van toepassing")[1]);
    fireEvent.change(screen.getByLabelText("Reden (optioneel)"), { target: { value: "Functie is vacant" } });
    fireEvent.click(screen.getAllByLabelText("Naam invullen")[0]);
    fireEvent.change(screen.getByLabelText("Naam", { selector: "#ad-name-eerste" }), { target: { value: "Bea Raadgeefster" } });
    fireEvent.click(screen.getByLabelText("Nee, geen Ringtools-account", { selector: "input[name='ad-link-eerste']" }));
    fireEvent.click(screen.getByRole("button", { name: "Concept opslaan" }));
    await waitFor(() => expect(api.updateOntheffing).toHaveBeenCalled());
    const sent = api.updateOntheffing.mock.calls[0][1] as { persons: Record<string, unknown>[] };
    expect(sent.persons.find((p) => p.followUpCode === "eerste")).toMatchObject({ answer: "NAAM", name: "Bea Raadgeefster", accountMode: "GEEN_ACCOUNT" });
    expect(sent.persons.find((p) => p.followUpCode === "tweede")).toMatchObject({ answer: "NIET_VAN_TOEPASSING", naReason: "Functie is vacant", name: null, accountMode: "ONBEKEND" });
  });

  it("blokkeert indienen zonder wijk of gemeente en meldt een onvolledige ringinrichting", async () => {
    const api = renderForm({ units: vi.fn(async () => ({ units: [] })) });
    fireEvent.change(await screen.findByLabelText("Naam"), { target: { value: "Anna" } });
    expect(await screen.findByText(/ringinrichting is nog niet compleet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Indienen bij ringpresidium" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.submitOntheffing).not.toHaveBeenCalled();
  });
});

function renderDetail(api: Record<string, unknown>, role = "RINGSECRETARIS") {
  const full = {
    ringMembers: vi.fn(async () => ({ members: [{ id: "u1", name: "Anna Hogeraad", role: "HOGERAAD", churchFunction: "" }, { id: "u2", name: "Piet President", role: "RINGPRESIDIUM", churchFunction: "" }] })),
    voteOntheffing: vi.fn(async () => ({ status: "x" })), releaseOntheffing: vi.fn(async () => ({ released: true, alreadyReleased: false })),
    ontheffingStep: vi.fn(async () => ({ ok: true })), ontheffingDecision: vi.fn(async () => ({ status: "x", alreadyRegistered: false })), deleteOntheffing: vi.fn(),
    ...api,
  };
  auth.value = { api: full, ring: { id: "r1", name: "Ring", role } };
  renderUi(<MemoryRouter initialEntries={["/ontheffingen/o1"]}><Routes><Route path="/ontheffingen/:id" element={<OntheffingDetail />} /><Route path="/ontheffingen" element={<div>lijst</div>} /></Routes></MemoryRouter>);
  return full as Record<string, ReturnType<typeof vi.fn>>;
}

const execution = (over: Record<string, unknown> = {}) => ({ informedAt: null, announcedAt: null, thanksOffered: null, processedAt: null, ...over });
const approvedView = (persons: unknown[]) => ({
  id: "o1", ringId: "r1", status: "APPROVED", statusLabel: "Besluit genomen — uitvoering", stage: null, joint: true, unit: { name: "Voorbeeld", kind: "WIJK" },
  function: { source: "STANDAARD", code: "zhv-presidente", name: "ZHV-presidente", ruleStatus: "GEVERIFIEERD", warning: null }, persons,
  viewer: { staff: true, canVote: false, myVote: null, canSubmit: false, canRelease: false, canDecide: false, canDelete: true },
  rounds: { presidium: { eligible: 2, responded: 2, positive: 2, negative: 0 }, hogeraad: { eligible: 3, responded: 3, positive: 3, negative: 0 } }, decisions: [], audit: [], retention: null, blockers: [],
});

describe("Ontheffing: uitvoering per persoon", () => {
  it("toont per persoon de afzonderlijke status en de stappen in vaste volgorde; geen stemknoppen bij bekendmaking of dankbetuiging", async () => {
    const api = renderDetail({
      ontheffing: vi.fn(async () => approvedView([
        { id: "p0", role: "HOOFD", functionName: "ZHV-presidente", name: "Anna Presidente", answer: "NAAM", accountMode: "GEEN_ACCOUNT", execution: execution({ informedAt: "2026-11-01T10:00:00Z" }) },
        { id: "p1", role: "RAADGEVER", followUpCode: "eerste", functionName: "Eerste raadgeefster", name: "Bea Raadgeefster", answer: "NAAM", accountMode: "GEEN_ACCOUNT", execution: execution() },
        { id: "p2", role: "RAADGEVER", followUpCode: "tweede", functionName: "Tweede raadgeefster", name: null, answer: "NIET_VAN_TOEPASSING", naReason: "Vacant", accountMode: "ONBEKEND", execution: null },
      ])),
    });
    expect((await screen.findAllByText("Anna Presidente")).length).toBeGreaterThan(0);
    expect(screen.getByText("Reden: Vacant")).toBeTruthy();
    // hoofdpersoon is geïnformeerd → bekendmaking kan; raadgeefster nog niet geïnformeerd → alleen informeren
    expect(screen.getAllByRole("button", { name: "Persoonlijk geïnformeerd registreren" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Bekendmaking registreren" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Administratief verwerkt" })).toBeNull(); // pas na bekendmaking
    expect(screen.queryByRole("button", { name: /Ik ondersteun/ })).toBeNull();
    // eerst expliciet kiezen of gelegenheid tot dankbetuiging is geboden; daarvoor is registreren uitgeschakeld
    expect((screen.getByRole("button", { name: "Bekendmaking registreren" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Ja, gelegenheid geboden"));
    fireEvent.click(screen.getByRole("button", { name: "Bekendmaking registreren" }));
    await waitFor(() => expect(api.ontheffingStep).toHaveBeenCalledWith("p0", "announce", { thanksOffered: true }));
    fireEvent.click(screen.getByRole("button", { name: "Persoonlijk geïnformeerd registreren" }));
    await waitFor(() => expect(api.ontheffingStep).toHaveBeenCalledWith("p1", "inform"));
  });

  it("een hogeraadslid ziet de stemknoppen maar geen koppelings-, uitvoerings- of auditgegevens", async () => {
    const api = renderDetail({
      ontheffing: vi.fn(async () => ({
        id: "o1", ringId: "r1", status: "HOGERAAD_VOTING", statusLabel: "Behandeling door de hoge raad", stage: "HOGERAAD", joint: false, unit: { name: "Voorbeeld", kind: "WIJK" },
        function: { source: "STANDAARD", code: "x", name: "Ringadministrateur", ruleStatus: "GEVERIFIEERD", warning: null },
        persons: [{ id: "p0", role: "HOOFD", functionName: "Ringadministrateur", name: "Piet Voorbeeld" }],
        viewer: { staff: false, canVote: true, myVote: null, canSubmit: false, canRelease: false, canDecide: false, canDelete: false },
      })),
    }, "HOGERAAD");
    fireEvent.click(await screen.findByRole("button", { name: "Ik ondersteun" }));
    await waitFor(() => expect(api.voteOntheffing).toHaveBeenCalledWith("o1", true));
    expect(screen.queryByText(/Ringtools-account/)).toBeNull();
    expect(screen.queryByText("Verloop")).toBeNull();
    expect(screen.queryByRole("button", { name: /Dossier verwijderen/ })).toBeNull();
    expect(api.ringMembers).not.toHaveBeenCalled();
  });

  it("de vrijgave aan de hoge raad is een aparte, expliciete handeling en blijft geblokkeerd bij een lege hoge raad", async () => {
    renderDetail({
      ontheffing: vi.fn(async () => ({ ...approvedView([{ id: "p0", role: "HOOFD", functionName: "x", name: "Anna", answer: "NAAM", accountMode: "GEEN_ACCOUNT", execution: execution() }]),
        status: "PRESIDIUM_APPROVED", statusLabel: "Akkoord ringpresidium — wacht op vrijgave", viewer: { staff: true, canVote: false, myVote: null, canSubmit: false, canRelease: true, canDecide: false, canDelete: true },
        blockers: ["Er zijn geen actieve hogeraadsleden die kunnen deelnemen."] })),
    });
    expect(await screen.findByText(/geen actieve hogeraadsleden/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Vrijgeven aan de hoge raad" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Ontheffingen: lijst", () => {
  it("toont de lijst en de knop voor een nieuwe ontheffing alleen aan ringstaf", async () => {
    auth.value = { api: { ontheffingen: vi.fn(async () => ({ ontheffingen: [{ id: "o1", status: "PRESIDIUM_VOTING", statusLabel: "Behandeling door het ringpresidium", personName: "Anna", functionName: "Ringadministrateur", unitName: "Voorbeeld", joint: false, needsMyVote: true, needsReview: false, updatedAt: "2026-11-01T10:00:00Z" }] })) }, ring: { id: "r1", name: "Ring", role: "HOGERAAD" } };
    renderUi(<MemoryRouter><Ontheffingen /></MemoryRouter>);
    expect(await screen.findByText("Anna")).toBeTruthy();
    expect(screen.queryByText("Nieuwe ontheffing")).toBeNull();
    expect(screen.getByLabelText("Wacht op jouw reactie")).toBeTruthy();
  });
});
