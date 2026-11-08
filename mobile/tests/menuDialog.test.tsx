import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { ActionMenu, placeMenu, type MenuItem } from "../src/components/Menu";
import { ConfirmProvider, Sheet, useConfirm } from "../src/components/Dialog";
import { closeTopOverlay, hasOverlay } from "../src/lib/overlays";

afterEach(cleanup);

const items = (onSelect = vi.fn()): MenuItem[] => [
  { id: "a", label: "Bewerken", onSelect },
  { id: "b", label: "Verborgen", hidden: true, onSelect: vi.fn() },
  { id: "c", label: "Verwijderen…", danger: true, onSelect: vi.fn() },
];

describe("placeMenu: altijd binnen het scherm, onder of boven de knop", () => {
  const vp = { width: 390, height: 844 };
  it("onder de knop als daar ruimte is, rechts uitgelijnd met de knop", () => {
    const p = placeMenu({ top: 100, bottom: 148, left: 326, right: 374 }, { width: 220, height: 200 }, vp);
    expect(p.placement).toBe("below");
    expect(p.top).toBe(152);
    expect(p.left).toBe(374 - 220);
  });
  it("boven de knop als eronder te weinig ruimte is", () => {
    const p = placeMenu({ top: 700, bottom: 748, left: 326, right: 374 }, { width: 220, height: 300 }, vp);
    expect(p.placement).toBe("above");
    expect(p.top + 300).toBeLessThanOrEqual(700);
  });
  it("nooit buiten het scherm, ook niet bij een knop aan de linkerrand of een te hoog menu", () => {
    const left = placeMenu({ top: 100, bottom: 148, left: 0, right: 48 }, { width: 220, height: 200 }, vp);
    expect(left.left).toBeGreaterThanOrEqual(8);
    const tall = placeMenu({ top: 400, bottom: 448, left: 326, right: 374 }, { width: 220, height: 2000 }, { width: 320, height: 568 });
    expect(tall.top).toBeGreaterThanOrEqual(8);
  });
  it("blijft binnen een smal scherm (320 px)", () => {
    const p = placeMenu({ top: 100, bottom: 148, left: 266, right: 314 }, { width: 280, height: 150 }, { width: 320, height: 568 });
    expect(p.left + 280).toBeLessThanOrEqual(320 - 8);
    expect(p.left).toBeGreaterThanOrEqual(8);
  });
});

describe("ActionMenu", () => {
  it("opent bij de knop met menu-rollen, toont geen verborgen items en geeft het eerste item de focus", async () => {
    render(<ActionMenu label="Acties voor Anna" items={items()} />);
    const trigger = screen.getByRole("button", { name: "Acties voor Anna" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Acties voor Anna" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(menu).getAllByRole("menuitem").map((e) => e.textContent)).toEqual(["Bewerken", "Verwijderen…"]);
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Bewerken" })));
  });

  it("zonder zichtbare items verschijnt de knop niet (rolgebonden acties)", () => {
    render(<ActionMenu label="Acties" items={[{ id: "x", label: "X", hidden: true, onSelect: vi.fn() }]} />);
    expect(screen.queryByRole("button", { name: "Acties" })).toBeNull();
  });

  it("kiezen sluit het menu en voert de actie één keer uit", async () => {
    const onSelect = vi.fn();
    render(<ActionMenu label="Acties" items={items(onSelect)} />);
    fireEvent.click(screen.getByRole("button", { name: "Acties" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bewerken" }));
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
  });

  it("sluit met Escape en geeft de focus terug aan de knop", () => {
    render(<ActionMenu label="Acties" items={items()} />);
    const trigger = screen.getByRole("button", { name: "Acties" });
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("sluit bij tikken buiten het menu zonder de achterliggende pagina te bedienen", () => {
    render(<ActionMenu label="Acties" items={items()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acties" }));
    fireEvent.pointerDown(screen.getByTestId("menu-backdrop"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("sluit via de Android-terugactie (overlaystapel) en meldt zich daarna af", () => {
    render(<ActionMenu label="Acties" items={items()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acties" }));
    expect(hasOverlay()).toBe(true);
    let handled = false;
    act(() => { handled = closeTopOverlay(); });
    expect(handled).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(hasOverlay()).toBe(false);
    expect(closeTopOverlay()).toBe(false); // niets open: de terugactie navigeert dan
  });

  it("sluit bij navigatie", async () => {
    let go: (to: string) => void = () => {};
    function Nav() { const n = useNavigate(); go = n; return null; }
    render(<MemoryRouter><Nav /><ActionMenu label="Acties" items={items()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Acties" }));
    act(() => go("/elders"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("pijltjestoetsen bewegen door de items", () => {
    render(<ActionMenu label="Acties" items={items()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acties" }));
    const [first, last] = screen.getAllByRole("menuitem");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(last);
  });
});

function Ask({ onResult, options }: { onResult: (v: boolean) => void; options?: Partial<Parameters<ReturnType<typeof useConfirm>>[0]> }) {
  const confirm = useConfirm();
  return <button onClick={() => void confirm({ title: "Voorstel verwijderen?", message: "Dit wordt definitief verwijderd.", detail: "Niet ongedaan te maken.", confirmLabel: "Verwijderen", danger: true, ...options }).then(onResult)}>Open</button>;
}

describe("Bevestigingsdialoog", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Open" }));

  it("toont titel, gevolgen en expliciete knoppen; focus staat op Annuleren (veilige keuze)", async () => {
    render(<ConfirmProvider><Ask onResult={vi.fn()} /></ConfirmProvider>);
    open();
    const dialog = await screen.findByRole("alertdialog", { name: "Voorstel verwijderen?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText("Dit wordt definitief verwijderd.")).toBeTruthy();
    expect(within(dialog).getByText("Niet ongedaan te maken.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Verwijderen" }).className).toContain("btn-danger");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Annuleren" }));
  });

  it("Annuleren, Escape, achtergrond en de Android-terugactie betekenen niet bevestigen", async () => {
    for (const how of ["cancel", "escape", "backdrop", "back"] as const) {
      const onResult = vi.fn();
      render(<ConfirmProvider><Ask onResult={onResult} /></ConfirmProvider>);
      open();
      const dialog = await screen.findByRole("alertdialog");
      if (how === "cancel") fireEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));
      if (how === "escape") fireEvent.keyDown(document, { key: "Escape" });
      if (how === "backdrop") fireEvent.pointerDown(screen.getByTestId("dialog-backdrop"));
      if (how === "back") act(() => void closeTopOverlay());
      await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      cleanup();
    }
  });

  it("bevestigen geeft true en herhaald tikken voert niet dubbel uit", async () => {
    const onResult = vi.fn();
    render(<ConfirmProvider><Ask onResult={onResult} /></ConfirmProvider>);
    open();
    const ok = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Verwijderen" });
    fireEvent.click(ok);
    fireEvent.click(ok);
    fireEvent.click(ok);
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it("houdt de focus binnen de dialoog (Tab en Shift+Tab lopen rond)", async () => {
    render(<ConfirmProvider><Ask onResult={vi.fn()} /></ConfirmProvider>);
    open();
    const dialog = await screen.findByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Annuleren" });
    const ok = within(dialog).getByRole("button", { name: "Verwijderen" });
    ok.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ok);
  });

  it("niet-destructieve bevestiging krijgt een gewone hoofdknop", async () => {
    render(<ConfirmProvider><Ask onResult={vi.fn()} options={{ danger: false, confirmLabel: "Vrijgeven" }} /></ConfirmProvider>);
    open();
    expect(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Vrijgeven" }).className).toContain("btn-primary");
  });

  it("een tweede bevestiging terwijl er al een openstaat annuleert de eerste (nooit twee dialogen)", async () => {
    const first = vi.fn();
    const second = vi.fn();
    function Two() {
      const confirm = useConfirm();
      return (<>
        <button onClick={() => void confirm({ title: "Eerste", message: "m", confirmLabel: "Ja" }).then(first)}>Een</button>
        <button onClick={() => void confirm({ title: "Tweede", message: "m", confirmLabel: "Ja" }).then(second)}>Twee</button>
      </>);
    }
    render(<ConfirmProvider><Two /></ConfirmProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Een" }));
    await screen.findByRole("alertdialog", { name: "Eerste" });
    act(() => { screen.getByRole("button", { name: "Twee" }).click(); });
    await screen.findByRole("alertdialog", { name: "Tweede" });
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    await waitFor(() => expect(first).toHaveBeenCalledWith(false));
  });
});

describe("Sheet", () => {
  it("opent als dialoog met titel, zet de focus binnen en sluit met Escape of de terugactie", () => {
    const onClose = vi.fn();
    render(<Sheet title="Gebruiker wijzigen" onClose={onClose}><input aria-label="Naam" /></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "Gebruiker wijzigen" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => void closeTopOverlay());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("een nieuwe sluitfunctie bij elke render verplaatst de focus niet opnieuw", () => {
    const { rerender } = render(<Sheet title="T" onClose={() => {}}><input aria-label="A" /><input aria-label="B" /></Sheet>);
    screen.getByLabelText("B").focus();
    rerender(<Sheet title="T" onClose={() => {}}><input aria-label="A" /><input aria-label="B" /></Sheet>);
    expect(document.activeElement).toBe(screen.getByLabelText("B"));
  });
});
