import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

const { CallingDetail } = await import("../src/screens/CallingDetail");
const { NewCalling } = await import("../src/screens/NewCalling");

const task = (over: Record<string, unknown>) => ({ task: "ROEPEN", label: "Roepen", assignee: null, doneAt: null, doneBy: null, ondersteunenContext: null, canAssign: true, canComplete: true, ...over });
const detail = (over: Record<string, unknown> = {}) => ({
  id: "c1", ring: { id: "r1", name: "Ring" }, personName: "Jan", functionTitle: "Leraar", status: "PRESIDIUM_VOTING", phase: "Presidium",
  createdAt: "", createdBy: "", processedAt: null, me: { role: "RINGPRESIDIUM", isStaff: true },
  rounds: [{ stage: "PRESIDIUM", title: "Presidium", state: "open", canRespond: false, myResponse: null, participants: [
    { userId: "u1", name: "Anna", support: null, lastInvitedAt: "", stillInvolved: true },
    { userId: "u2", name: "Bert", support: false, lastInvitedAt: "", stillInvolved: true },
  ] }],
  tasks: [task({}), task({ task: "ONDERSTEUNEN", label: "Ondersteunen" })],
  readyToProcess: true, canDelete: true, assignableUsers: [{ id: "u1", name: "Anna", role: "HOGERAAD" }], ...over,
});

function renderDetail(api: Record<string, unknown>, d = detail()) {
  const full = { calling: vi.fn(async () => d), ...api };
  auth.value = { api: full, ring: { id: "r1" }, selectRing: vi.fn() };
  render(<MemoryRouter initialEntries={["/roepingen/c1"]}><Routes>
    <Route path="/roepingen/:id" element={<CallingDetail />} /><Route path="/voorstellen" element={<div>lijst</div>} />
  </Routes></MemoryRouter>);
  return full;
}
afterEach(cleanup);

describe("Fase A: staf-acties vanuit de app (iOS en Android gebruiken dezelfde client)", () => {
  it("herinnert iedereen, één persoon, vraagt opnieuw en haalt iemand uit de ronde", async () => {
    const api = renderDetail({
      remind: vi.fn(async () => ({ sent: 2, skippedRecent: 1 })), reinvite: vi.fn(async () => ({ ok: true })), removeParticipant: vi.fn(async () => ({ ok: true })),
    }) as Record<string, ReturnType<typeof vi.fn>>;
    fireEvent.click(await screen.findByText(/Iedereen herinneren/));
    await waitFor(() => expect(api.remind).toHaveBeenCalledWith("c1"));
    expect(await screen.findByText(/2 herinnering\(en\) verstuurd, 1 recent al herinnerd/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Herinner Anna"));
    await waitFor(() => expect(api.remind).toHaveBeenCalledWith("c1", "u1"));
    fireEvent.click(screen.getByLabelText("Vraag Bert opnieuw"));
    await waitFor(() => expect(api.reinvite).toHaveBeenCalledWith("c1", "u2"));
    fireEvent.click(screen.getByLabelText("Verwijder Anna uit de ronde"));
    await waitFor(() => expect(api.removeParticipant).toHaveBeenCalledWith("c1", "u1"));
  });

  it("wijst taken toe en rondt ze af; Ondersteunen vereist eerst een gekozen gelegenheid", async () => {
    const api = renderDetail({ assignTask: vi.fn(async () => ({ ok: true })), completeTask: vi.fn(async () => ({ ok: true })) }) as Record<string, ReturnType<typeof vi.fn>>;
    fireEvent.change(await screen.findByLabelText("Verantwoordelijke", { selector: "#as-ROEPEN" }), { target: { value: "u1" } });
    await waitFor(() => expect(api.assignTask).toHaveBeenCalledWith("c1", "ROEPEN", "u1"));
    const buttons = screen.getAllByRole("button", { name: /registreren/ });
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Waar is ondersteund?"), { target: { value: "RINGCONFERENTIE" } });
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(api.completeTask).toHaveBeenCalledWith("c1", "ONDERSTEUNEN", { ondersteunenContext: "RINGCONFERENTIE" }));
  });

  it("verwerken en definitief verwijderen (pas na bevestiging)", async () => {
    const api = renderDetail({ markProcessed: vi.fn(async () => ({ ok: true })), deleteCalling: vi.fn(async () => ({ ok: true })) }) as Record<string, ReturnType<typeof vi.fn>>;
    fireEvent.click(await screen.findByText("Administratief verwerkt"));
    await waitFor(() => expect(api.markProcessed).toHaveBeenCalledWith("c1"));
    fireEvent.click(screen.getByText(/definitief verwijderen…/));
    expect(api.deleteCalling).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Definitief verwijderen" }));
    await waitFor(() => expect(api.deleteCalling).toHaveBeenCalledWith("c1", true));
    expect(await screen.findByText("lijst")).toBeTruthy();
  });

  it("toont een gewone deelnemer geen beheeracties", async () => {
    renderDetail({}, detail({ me: { role: "HOGERAAD", isStaff: false }, tasks: [], readyToProcess: false, canDelete: false }));
    await screen.findByText("Jan");
    expect(screen.queryByText(/Iedereen herinneren/)).toBeNull();
    expect(screen.queryByText(/verwijderen/i)).toBeNull();
    expect(screen.queryByText("Administratief verwerkt")).toBeNull();
  });

  it("nieuw voorstel: kiest verantwoordelijken uit de ring en dient in", async () => {
    const createCalling = vi.fn(async () => ({ id: "nieuw" }));
    auth.value = { api: { ringMembers: vi.fn(async () => ({ members: [{ id: "u1", name: "Anna", role: "HOGERAAD", churchFunction: "Bisschop" }] })), createCalling }, ring: { id: "r1", name: "Ring" } };
    render(<MemoryRouter initialEntries={["/voorstellen/nieuw"]}><Routes>
      <Route path="/voorstellen/nieuw" element={<NewCalling />} /><Route path="/roepingen/:id" element={<div>detail</div>} />
    </Routes></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText("Naam van de persoon"), { target: { value: "Jan Jansen" } });
    fireEvent.change(screen.getByLabelText("Roeping / functie"), { target: { value: "Leraar" } });
    fireEvent.change(screen.getByLabelText(/Verantwoordelijke voor roepen/), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Voorstel indienen" }));
    await waitFor(() => expect(createCalling).toHaveBeenCalledWith("r1", expect.objectContaining({ personName: "Jan Jansen", functionTitle: "Leraar", roepenAssigneeId: "u1", aanstellenAssigneeId: null })));
    expect(await screen.findByText("detail")).toBeTruthy();
  });
});
