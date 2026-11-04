import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiClient } from "../src/lib/api";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

const { RingSetup } = await import("../src/screens/RingSetup");
const { CallingPicker } = await import("../src/components/CallingPicker");

afterEach(cleanup);

const entry = (over: Record<string, unknown>) => ({
  code: "x", source: "STANDAARD", name: "X", aliases: [], category: "Muziek", type: "OVERIG", handbook: [], approvalRoute: "RINGPRESIDIUM_HOGE_RAAD", ringtoolsProcess: true,
  extraApproval: null, grantedBy: null, appointedBy: null, supportVenue: null, appointment: null, releaseFollowUps: [], warning: null, reviewNotes: [], active: true, catalogVersion: "1", ...over,
});

describe("ApiClient: ringinrichting", () => {
  it("gebruikt /admin-routes in beheermodus en gewone ringroutes voor de ringbeheerder", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => { urls.push(url); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const api = new ApiClient({ baseUrl: "https://x/api", getToken: () => "t".repeat(30), fetchImpl });
    await api.units("r1"); await api.ringSetup("r1"); await api.updateUnit("u1", { active: false }); await api.createCustomCalling("r1", { name: "N", category: "C" });
    api.admin = true;
    await api.units("r1"); await api.updateUnit("u1", { active: false });
    await api.catalog("r1", "tol lk", "Technologie"); await api.appointers("r1", "ringadministrateur");
    expect(urls).toEqual([
      "https://x/api/rings/r1/units", "https://x/api/rings/r1/setup", "https://x/api/units/u1", "https://x/api/rings/r1/custom-callings",
      "https://x/api/admin/rings/r1/units", "https://x/api/admin/units/u1",
      "https://x/api/catalog/callings?ring=r1&q=tol%20lk&category=Technologie", "https://x/api/catalog/callings/ringadministrateur/appointers?ring=r1",
    ]);
  });
});

describe("Ringinrichting in de app", () => {
  const baseApi = () => ({
    ringSetup: vi.fn(async () => ({ complete: false, steps: [
      { key: "manager", label: "Ringbeheerder aangewezen", done: true, detail: "" },
      { key: "hogeraad", label: "Hogeraadsleden toegevoegd", done: false, detail: "Zonder hogeraadsleden blijft elk voorstel na het presidium wachten." },
    ] })),
    units: vi.fn(async () => ({ units: [
      { id: "w1", kind: "WIJK", name: "Voorbeeld", active: true, responsibleStatus: "VACANT", responsible: null, defaults: { roepen: null, ondersteunen: null, aanstellen: null } },
      { id: "g1", kind: "GEMEENTE", name: "Proef", active: true, responsibleStatus: "OK", responsible: { id: "h1", name: "Hans" }, defaults: { roepen: null, ondersteunen: null, aanstellen: null } },
    ] })),
    ringUsers: vi.fn(async () => ({ users: [{ userId: "h1", name: "Hans", role: "HOGERAAD", active: true }, { userId: "p1", name: "Piet", role: "RINGPRESIDIUM", active: true }] })),
    customCallings: vi.fn(async () => ({ callings: [] })),
    catalog: vi.fn(async () => ({ version: "1", categories: ["Muziek"], callings: [] })),
    updateUnit: vi.fn(async () => ({ ok: true })), createUnit: vi.fn(async () => ({ id: "n" })), createCustomCalling: vi.fn(async () => ({ id: "c" })), updateCustomCalling: vi.fn(),
  });

  it("toont de voortgang, een vacature en kan een verantwoordelijk hogeraadslid koppelen (alleen hogeraadsleden te kiezen)", async () => {
    const api = baseApi();
    auth.value = { api };
    render(<RingSetup ringId="r1" />);
    expect(await screen.findByText(/Zonder hogeraadsleden blijft elk voorstel/)).toBeTruthy();
    expect(await screen.findByText("Vacature")).toBeTruthy();
    const select = (await screen.findByLabelText("Verantwoordelijk hogeraadslid", { selector: "#w1-responsibleUserId" })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Vacature (nog niemand)", "Hans"]); // ringpresidium is niet te kiezen
    fireEvent.change(select, { target: { value: "h1" } });
    await waitFor(() => expect(api.updateUnit).toHaveBeenCalledWith("w1", { responsibleUserId: "h1" }));
  });

  it("voegt een wijk of gemeente toe en toont servermeldingen", async () => {
    const api = baseApi();
    api.createUnit = vi.fn(async () => { throw new (await import("../src/lib/api")).ApiRequestError(400, "Er bestaat al een wijk of gemeente met deze naam.", "ring"); });
    auth.value = { api };
    render(<RingSetup ringId="r1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Gemeente" }));
    fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Proef" } });
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/bestaat al/);
    expect(api.createUnit).toHaveBeenCalledWith("r1", { kind: "GEMEENTE", name: "Proef" });
  });
});

describe("CallingPicker: zoeken en selecteren", () => {
  const catalog = vi.fn(async (_r: string, q: string) => ({
    version: "1", categories: ["Muziek", "Ringpresidium", "Technologie"],
    callings: [
      entry({ code: "ringtolk", name: "Ringtolk", category: "Technologie", warning: "Let op deze regel." }),
      entry({ code: "ringpresident", name: "Ringpresident", category: "Ringpresidium", ringtoolsProcess: false }),
      entry({ code: "eigen-1", source: "EIGEN", name: "Koorleider", category: "Muziek", approvalRoute: null }),
    ].filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase())),
  }));

  it("zoekt, selecteert, stelt de organisatie voor en laat roepingen buiten Ringtools niet kiezen", async () => {
    auth.value = { api: { catalog, createCustomCalling: vi.fn() } };
    const onChange = vi.fn();
    render(<CallingPicker ringId="r1" value={null} onChange={onChange} />);
    const presidentOption = await screen.findByRole("option", { name: /Ringpresident/ });
    expect((presidentOption as HTMLButtonElement).disabled).toBe(true);
    expect(presidentOption.textContent).toMatch(/buiten Ringtools/);
    fireEvent.click(presidentOption);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("option", { name: /Ringtolk/ }));
    expect(onChange).toHaveBeenCalledWith({ code: "ringtolk", source: "STANDAARD", name: "Ringtolk", category: "Technologie", customConfirmed: false });
    await waitFor(() => expect((screen.getByLabelText("Organisatie") as HTMLSelectElement).value).toBe("Technologie")); // automatisch voorgesteld
    fireEvent.change(screen.getByLabelText("Roeping zoeken"), { target: { value: "tolk" } });
    await waitFor(() => expect(catalog).toHaveBeenLastCalledWith("r1", "tolk", "Technologie"));
  });

  it("een eigen roeping vereist expliciete bevestiging van de bevoegde leiding", async () => {
    auth.value = { api: { catalog, createCustomCalling: vi.fn() } };
    let current: Record<string, unknown> | null = { code: "eigen-1", source: "EIGEN", name: "Koorleider", category: "Muziek", customConfirmed: false };
    const onChange = vi.fn((v) => { current = v; });
    const { rerender } = render(<CallingPicker ringId="r1" value={current as never} onChange={onChange} />);
    fireEvent.click(await screen.findByLabelText(/bevoegde leiding heeft de procedure/));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ source: "EIGEN", customConfirmed: true }));
    rerender(<CallingPicker ringId="r1" value={current as never} onChange={onChange} />);
  });

  it("voegt een eigen roeping toe onder het zoekresultaat", async () => {
    const createCustomCalling = vi.fn(async () => ({ id: "nieuw-id" }));
    auth.value = { api: { catalog, createCustomCalling } };
    const onChange = vi.fn();
    render(<CallingPicker ringId="r1" value={null} onChange={onChange} />);
    await screen.findByRole("option", { name: /Ringtolk/ });
    fireEvent.click(screen.getByRole("button", { name: "Eigen roeping toevoegen" }));
    fireEvent.change(screen.getByLabelText("Naam van de roeping"), { target: { value: "Fietscoördinator" } });
    fireEvent.change(screen.getByLabelText("Categorie"), { target: { value: "Activiteiten en sporten" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Toevoegen" })[0]);
    await waitFor(() => expect(createCustomCalling).toHaveBeenCalledWith("r1", { name: "Fietscoördinator", category: "Activiteiten en sporten" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ code: "nieuw-id", source: "EIGEN", customConfirmed: false })));
  });
});
