import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ApiRequestError } from "../src/lib/api";
import { digitsOnly } from "../src/lib/codeInput";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../src/lib/auth", () => ({ useAuth: () => auth.value }));
const { useReauth } = await import("../src/components/Reauth");
afterEach(cleanup);

function Harness({ action }: { action: () => Promise<string> }) {
  const { run, dialog } = useReauth();
  return (
    <div>
      <button onClick={() => void run(action).catch(() => {})}>Actie</button>
      {dialog}
    </div>
  );
}

describe("Geplakte codes", () => {
  it("digitsOnly haalt spaties en streepjes weg en kapt af op de lengte", () => {
    expect(digitsOnly("123 456", 6)).toBe("123456");
    expect(digitsOnly("123-456", 6)).toBe("123456");
    expect(digitsOnly(" 1234 5678 99", 8)).toBe("12345678");
    expect(digitsOnly("abc", 6)).toBe("");
  });

  it("herverificatie met TOTP: een geplakte code mét spatie ('123 456') geeft een volledige code en een werkende knop", async () => {
    const reauth = vi.fn(async () => {});
    auth.value = { reauth, reauthWithPasskey: vi.fn(), requestReauthCode: vi.fn(), isAdmin: false, me: { user: { mfaEnabled: true } }, api: { meta: vi.fn(async () => ({ nativeTotpLogin: true })) } };
    const action = vi.fn().mockRejectedValueOnce(new ApiRequestError(403, "Bevestig eerst opnieuw", "reauth-required")).mockResolvedValue("ok");
    render(<Harness action={action} />);
    fireEvent.click(screen.getByRole("button", { name: "Actie" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Vóór de correctie stond hier maxLength=6, waardoor "123 456" werd afgekapt tot "123 45" (5 cijfers) en de knop nooit actief werd.
    const input = await screen.findByLabelText("Code");
    fireEvent.change(input, { target: { value: "123 456" } });
    expect((input as HTMLInputElement).value).toBe("123456");
    const confirm = screen.getByRole("button", { name: "Bevestigen" });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(reauth).toHaveBeenCalledWith("123456"));
    expect(dialog).toBeTruthy();
  });
});

describe("Herverificatie-blok staat bovenin, nooit onder het toetsenbord", () => {
  const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
  it("de stijl verankert het blok aan de bovenkant en niet aan de onderkant", () => {
    const sheet = css.match(/\.sheet\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(sheet).toMatch(/top:\s*calc\(var\(--sat\)/);
    expect(sheet).not.toMatch(/bottom\s*:/);
    expect(sheet).toMatch(/overflow-y:\s*auto/); // bij een klein scherm scrolt het blok
  });
});
