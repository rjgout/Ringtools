import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfirmProvider } from "../src/components/Dialog";
import { ApiRequestError } from "../src/lib/api";
const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const saved = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
vi.mock("../src/lib/storage", () => ({ storage: { getDeletionReceipt: async () => null, setDeletionReceipt: saved, getDeviceKey: async () => null } }));
const { Login } = await import("../src/screens/Login");
const { AccountPrivacy } = await import("../src/components/AccountPrivacy");
const { useReauth } = await import("../src/components/Reauth");
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup() {
  const api = { meta: vi.fn(async () => ({ apiVersion: 1, minAppVersion: "1.0.0" })), requestCode: vi.fn(), deletionStatus: vi.fn(async () => ({ request: null })), requestDeletion: vi.fn(async () => ({ receipt: "test-ontvangstbewijs", request: { id: "verzoek", status: "REQUESTED", requestedAt: new Date().toISOString(), dueAt: new Date().toISOString(), completedAt: null, blockerCount: 0 } })) };
  const signInReview = vi.fn(async () => {});
  auth.value = { api, signInReview, me: { user: { id: "u", reviewAccount: true } } };
  return { api, signInReview };
}
it("Demoaccount is secundair en verstuurt exact wachtwoord zonder codeaanvraag", async () => {
  const { api, signInReview } = setup(); render(<Login />);
  fireEvent.click(screen.getByRole("button", { name: "Demoaccount" }));
  fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "review@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Wachtwoord"), { target: { value: "  fictief wachtwoord  " } });
  fireEvent.click(screen.getByRole("button", { name: "Aanmelden" }));
  await waitFor(() => expect(signInReview).toHaveBeenCalledWith("review@example.invalid", "  fictief wachtwoord  "));
  await waitFor(() => expect((screen.getByLabelText("Wachtwoord") as HTMLInputElement).value).toBe(""));
  expect(api.requestCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Terug naar normaal aanmelden" }));
  expect(screen.getByRole("button", { name: "Verder" })).toBeTruthy();
});
it("ongeldige demoaanmelding toont servermelding en wist wachtwoord", async () => {
  const { signInReview } = setup();
  signInReview.mockRejectedValueOnce(new ApiRequestError(401, "Aanmelding niet beschikbaar", "invalid-review-login"));
  render(<Login />); fireEvent.click(screen.getByRole("button", { name: "Demoaccount" }));
  fireEvent.change(screen.getByLabelText("E-mailadres"), { target: { value: "review@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Wachtwoord"), { target: { value: "fout" } });
  fireEvent.click(screen.getByRole("button", { name: "Aanmelden" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Aanmelding niet beschikbaar");
  expect((screen.getByLabelText("Wachtwoord") as HTMLInputElement).value).toBe("");
});
it("verwijderverzoek volgt bevestiging, annuleren doet niets en statusbewijs wordt beveiligd bewaard", async () => {
  const { api } = setup(); render(<ConfirmProvider><AccountPrivacy /></ConfirmProvider>);
  await waitFor(() => expect(api.deletionStatus).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Account verwijderen aanvragen…" }));
  fireEvent.click(await screen.findByRole("button", { name: "Annuleren" }));
  expect(api.requestDeletion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Account verwijderen aanvragen…" }));
  fireEvent.click(await screen.findByRole("button", { name: "Verwijdering aanvragen" }));
  await waitFor(() => expect(api.requestDeletion).toHaveBeenCalledOnce());
  await waitFor(() => expect(saved).toHaveBeenCalledWith("test-ontvangstbewijs"));
  expect(await screen.findByText("Ontvangen")).toBeTruthy();
});
it("reviewherverificatie behoudt spaties en vraagt geen mailbox of MFA-reset", async () => {
  setup(); const reauth = vi.fn(async () => {}); const requestReauthCode = vi.fn(); auth.value = { ...auth.value, reauth, requestReauthCode };
  const action = vi.fn().mockRejectedValueOnce(new ApiRequestError(403, "Opnieuw bevestigen", "reauth-required")).mockResolvedValue("ok");
  function Harness() { const { run, dialog } = useReauth(); return <><button onClick={() => void run(action)}>Actie</button>{dialog}</>; }
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Actie" }));
  fireEvent.change(await screen.findByLabelText("Wachtwoord"), { target: { value: " met spaties " } });
  fireEvent.click(screen.getByRole("button", { name: "Bevestigen" }));
  await waitFor(() => expect(reauth).toHaveBeenCalledWith(" met spaties "));
  expect(requestReauthCode).not.toHaveBeenCalled(); await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
});
