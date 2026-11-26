import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderUi } from "./ui";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
const { DeclaratieNieuw, DeclaratiesHome, NOT_ACTIVATED_NOTICE } = await import("../src/screens/Declaraties");
afterEach(cleanup);

const ctx = (over: Record<string, unknown> = {}) => ({
  name: "Piet Jansen", onboarded: true, preferredRingId: "r1", preferredUnitId: null, official: { administer: false, president: false },
  destinations: [{ ringId: "r1", ringName: "Ring A", activated: false, units: [{ unitId: "u1", name: "Wijk 1", kind: "WIJK", activated: true }] }], ...over,
});

describe("Declaraties (client)", () => {
  it("niet-geactiveerde bestemming toont exact de vaste melding en houdt het indienen geblokkeerd", async () => {
    auth.value = { api: { declarationContext: vi.fn(async () => ctx()) }, ring: null };
    renderUi(<MemoryRouter><DeclaratieNieuw /></MemoryRouter>);
    expect((await screen.findAllByText(NOT_ACTIVATED_NOTICE)).length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Declaratie indienen" }) as HTMLButtonElement).disabled).toBe(true);
    expect(NOT_ACTIVATED_NOTICE).toBe("Declareren is voor deze ring, wijk of gemeente nog niet geactiveerd. Neem contact op met je plaatselijke leiders om de declaratiemodule te laten activeren.");
  });

  it("direct naar de ring vraagt de uitdrukkelijke bevestiging; kiezen van een wijk niet", async () => {
    auth.value = { api: { declarationContext: vi.fn(async () => ctx({ destinations: [{ ringId: "r1", ringName: "Ring A", activated: true, units: [{ unitId: "u1", name: "Wijk 1", kind: "WIJK", activated: true }] }] })) }, ring: null };
    renderUi(<MemoryRouter><DeclaratieNieuw /></MemoryRouter>);
    expect(await screen.findByText("Weet je zeker dat deze declaratie voor de ring is en niet voor je wijk of gemeente?")).toBeTruthy();
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "u1" } });
    expect(screen.queryByText("Weet je zeker dat deze declaratie voor de ring is en niet voor je wijk of gemeente?")).toBeNull();
  });

  it("nieuwe gebruiker moet eerst naam, ring en eenheid bevestigen (onboarding)", async () => {
    auth.value = { api: { declarationContext: vi.fn(async () => ctx({ onboarded: false, preferredRingId: null })), myDeclarations: vi.fn(async () => ({ items: [] })) }, ring: null, reloadMe: vi.fn() };
    renderUi(<MemoryRouter><DeclaratiesHome /></MemoryRouter>);
    expect(await screen.findByText("Je gegevens")).toBeTruthy();
    expect(screen.queryByText("Nieuwe declaratie")).toBeNull();
  });
});
