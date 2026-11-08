import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderUi } from "./ui";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
const { Home } = await import("../src/screens/Home");
afterEach(cleanup);

const dashboard = (over: Record<string, unknown> = {}) => ({
  isStaff: true, pendingSupport: [], myTasks: [], attention: [], counts: { presidium: 1, hogeraad: 0, awaitingRelease: 0, paused: 0, readyToProcess: 0 },
  ontheffingen: { open: 2, needsMyVote: 0, needsReview: 0 }, ...over,
});
const o = (over: Record<string, unknown> = {}) => ({ id: "o1", status: "PRESIDIUM_VOTING", statusLabel: "Behandeling", personName: "Anna", functionName: "Ringadministrateur", unitName: "Voorbeeld", joint: false, needsMyVote: true, needsReview: false, ...over });

function setup(dash: Record<string, unknown>, list = [o()]) {
  const ontheffingen = vi.fn(async () => ({ ontheffingen: list }));
  auth.value = { api: { dashboard: vi.fn(async () => dash), ontheffingen }, ring: { id: "r1", name: "Ring Apeldoorn", churchFunction: "Secretaris", role: "RINGSECRETARIS" } };
  renderUi(<MemoryRouter><Home /></MemoryRouter>);
  return ontheffingen;
}

describe("Overzicht: alleen overzicht, knoppen alleen waar een actie wacht", () => {
  it("geen Ontheffingen-knop en geen andere knoppen; een ontheffing die jouw reactie vraagt staat als rij met het type erbij", async () => {
    setup(dashboard({ ontheffingen: { open: 2, needsMyVote: 1, needsReview: 0 } }));
    const anna = (await screen.findByText("Anna")).closest("a")!;
    expect(within(anna).getByText("Ontheffing")).toBeTruthy();
    expect(within(anna).getByText("Jouw reactie")).toBeTruthy();
    expect(anna.getAttribute("href")).toBe("/ontheffingen/o1");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Ontheffingen/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Nieuw/ })).toBeNull();
  });

  it("zonder actie op een ontheffing: niets over ontheffingen in het overzicht en geen extra aanvraag", async () => {
    const list = setup(dashboard());
    await screen.findByText("Stand van zaken");
    expect(screen.queryByText("Ontheffing")).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(screen.getByText("Er staat niets voor je klaar.")).toBeTruthy();
  });
});
