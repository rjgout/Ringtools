import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

import { answerDialog, pickMenuItem, renderUi } from "./ui";
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
  readyToProcess: true, canDelete: true, assignableUsers: [{ id: "u1", name: "Anna", role: "HOGERAAD" }, { id: "p1", name: "President", role: "RINGPRESIDIUM" }],
  awaitingRelease: false, canRelease: false, groupDecisions: [], canRegisterGroupDecision: { PRESIDIUM: false, HOGERAAD: false }, ...over,
});

function renderDetail(api: Record<string, unknown>, d = detail()) {
  const full = { calling: vi.fn(async () => d), ...api };
  auth.value = { api: full, ring: { id: "r1" }, selectRing: vi.fn() };
  renderUi(<MemoryRouter initialEntries={["/roepingen/c1"]}><Routes>
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
    pickMenuItem("Acties voor Anna", "Herinner");
    await waitFor(() => expect(api.remind).toHaveBeenCalledWith("c1", "u1"));
    pickMenuItem("Acties voor Bert", "Opnieuw vragen");
    await waitFor(() => expect(api.reinvite).toHaveBeenCalledWith("c1", "u2"));
    pickMenuItem("Acties voor Anna", /Uit ronde halen/);
    await screen.findByRole("alertdialog");
    expect(api.removeParticipant).not.toHaveBeenCalled(); // eerst bevestigen
    answerDialog("Uit ronde halen");
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
    pickMenuItem("Acties voor dit voorstel", /Voorstel verwijderen/);
    await screen.findByRole("alertdialog");
    expect(api.deleteCalling).not.toHaveBeenCalled();
    answerDialog("Verwijderen");
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

});

describe("C1: vrijgave en gezamenlijk akkoord", () => {
  it("toont 'wacht op vrijgave' en geeft pas na de knop vrij", async () => {
    const api = renderDetail({ release: vi.fn(async () => ({ ok: true, released: true, alreadyReleased: false })) }, detail({ status: "PRESIDIUM_APPROVED", awaitingRelease: true, canRelease: true })) as Record<string, ReturnType<typeof vi.fn>>;
    expect(await screen.findByText(/Presidium akkoord – wacht op vrijgave aan de hoge raad/)).toBeTruthy();
    expect(api.release).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vrijgeven aan de hoge raad" }));
    await waitFor(() => expect(api.release).toHaveBeenCalledWith("c1"));
  });

  it("legt een gezamenlijk presidiumakkoord vast zonder individuele reacties; bevestiging is verplicht", async () => {
    const api = renderDetail({ groupDecision: vi.fn(async () => ({ ok: true, alreadyRegistered: false })), release: vi.fn() }, detail({ canRegisterGroupDecision: { PRESIDIUM: true, HOGERAAD: false } })) as Record<string, ReturnType<typeof vi.fn>>;
    fireEvent.click(await screen.findByText(/Gezamenlijk akkoord ringpresidium registreren/));
    expect(screen.queryByLabelText(/Direct vrijgeven/)).toBeNull();
    const submit = screen.getByRole("button", { name: "Besluit vastleggen" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // zonder expliciete verklaring kan niets worden vastgelegd
    fireEvent.click(screen.getByLabelText(/heeft dit voorstel in de vergadering akkoord bevonden/));
    // In dit voorbeeld heeft Bert negatief gereageerd: zonder gemotiveerde afhandeling blijft vastleggen geblokkeerd.
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/negatieve reactie is in de vergadering afgehandeld/));
    fireEvent.change(screen.getByLabelText(/Hoe is dit afgehandeld/), { target: { value: "Zorg besproken en weggenomen." } });
    // het besluit is van de presidiumleden: zonder aangegeven deelnemers (een secretaris legt alleen vast) blijft vastleggen geblokkeerd
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("President"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api.groupDecision).toHaveBeenCalledWith("c1", expect.objectContaining({ stage: "PRESIDIUM", agreed: true, resolveNegative: true, presentUserIds: ["p1"] })));
    // registreren en vrijgeven zijn twee afzonderlijke handelingen: er is geen optie om direct vrij te geven
    expect(api.groupDecision.mock.calls[0][1]).not.toHaveProperty("releaseNow");
    expect(api.release).not.toHaveBeenCalled();
  });

  it("hoge raad: vereist een voorzitter uit het ringpresidium en aanwezigen; afwezigen worden apart doorgegeven", async () => {
    const d = detail({ status: "HOGERAAD_VOTING", canRegisterGroupDecision: { PRESIDIUM: false, HOGERAAD: true } });
    (d.rounds as unknown[]).push({ stage: "HOGERAAD", title: "Hoge raad", state: "open", canRespond: false, myResponse: null, participants: [
      { userId: "h1", name: "Hans", support: null, lastInvitedAt: "", stillInvolved: true }, { userId: "h2", name: "Hella", support: null, lastInvitedAt: "", stillInvolved: true } ] });
    const api = renderDetail({ groupDecision: vi.fn(async () => ({ ok: true, alreadyRegistered: false })) }, d) as Record<string, ReturnType<typeof vi.fn>>;
    fireEvent.click(await screen.findByText(/Gezamenlijk akkoord hoge raad registreren/));
    fireEvent.click(screen.getByLabelText(/heeft dit voorstel in de vergadering akkoord bevonden/));
    const submit = screen.getByRole("button", { name: "Besluit vastleggen" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // geen voorzitter en geen aanwezigen
    fireEvent.change(screen.getByLabelText(/Voorzitter/), { target: { value: "p1" } });
    const [presentHans] = screen.getAllByLabelText("Hans");
    fireEvent.click(presentHans);
    fireEvent.click(screen.getAllByLabelText("Hella")[1]);
    fireEvent.click(submit);
    await waitFor(() => expect(api.groupDecision).toHaveBeenCalledWith("c1", expect.objectContaining({ stage: "HOGERAAD", presidingUserId: "p1", presentUserIds: ["h1"], absentUserIds: ["h2"] })));
  });
});
