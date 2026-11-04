import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));

const { CallingDetail } = await import("../src/screens/CallingDetail");

const detail = (ringId: string) => ({
  id: "c1", ring: { id: ringId, name: "Ring" }, personName: "Jan", functionTitle: "F", status: "PRESIDIUM_VOTING", phase: "Presidium",
  createdAt: "", createdBy: "", processedAt: null, me: { role: "HOGERAAD", isStaff: false }, rounds: [], tasks: [], readyToProcess: false, canDelete: false, assignableUsers: [],
});

function setup(activeRing: string, calling: string) {
  const selectRing = vi.fn(async () => {});
  const api = { calling: vi.fn(async () => detail(calling)) };
  auth.value = { api, ring: { id: activeRing }, selectRing };
  const view = render(
    <MemoryRouter initialEntries={["/roepingen/c1"]}>
      <Routes><Route path="/roepingen/:id" element={<CallingDetail />} /></Routes>
    </MemoryRouter>
  );
  return { selectRing, api, view };
}

afterEach(cleanup);

describe("CallingDetail: ringselectie als effect, niet tijdens het renderen", () => {
  it("schakelt precies één keer naar de ring van het voorstel als die afwijkt", async () => {
    const { selectRing } = setup("ring-A", "ring-B");
    await waitFor(() => expect(selectRing).toHaveBeenCalledWith("ring-B"));
    await new Promise((r) => setTimeout(r, 30));
    expect(selectRing).toHaveBeenCalledTimes(1);
  });
  it("doet niets (geen opslagactie) als de ring al de actieve is", async () => {
    const { selectRing, api } = setup("ring-A", "ring-A");
    await waitFor(() => expect(api.calling).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(selectRing).not.toHaveBeenCalled();
  });
});
