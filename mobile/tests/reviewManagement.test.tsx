import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
const { ReviewManagementDemo } = await import("../src/screens/ReviewManagementDemo");
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup(reviewAccount = true, role = "RINGSECRETARIS") {
  const reviewManagement = vi.fn(async () => ({ readOnly: true, ringName: "Fictieve demo", users: [{ name: "Apple Review 3", role: "RINGSECRETARIS", churchFunction: "Fictief", active: true }], units: [{ name: "Fictieve wijk", kind: "WIJK" }] }));
  auth.value = { me: { user: { reviewAccount } }, ring: { id: "demo", role }, api: { reviewManagement } };
  return reviewManagement;
}
it("Review 3 leest fictieve rollen en inrichting zonder mutatieknoppen", async () => {
  const load = setup(); render(<ReviewManagementDemo />);
  expect(await screen.findByText("Apple Review 3")).toBeTruthy();
  expect(screen.getByText("Ringsecretaris")).toBeTruthy();
  expect(screen.getByText(/Fictieve wijk/)).toBeTruthy();
  expect(load).toHaveBeenCalledWith("demo");
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText(/Je krijgt geen ringbeheerrechten/)).toBeTruthy();
});
it.each([[false, "RINGSECRETARIS"], [true, "HOGERAAD"]])("andere accounts vragen geen demobeheer op (%s/%s)", async (review, role) => {
  const load = setup(review, role); render(<ReviewManagementDemo />);
  await waitFor(() => expect(screen.getByText(/alleen beschikbaar voor Apple Review 3/)).toBeTruthy());
  expect(load).not.toHaveBeenCalled();
});
