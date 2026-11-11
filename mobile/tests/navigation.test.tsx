import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { backAction, isTabRoot, navTitle, parentPath, tabForPath, titleOf, TAB_ROOT } from "../src/lib/navigation";
import { NavBar, Segmented, TabBar } from "../src/components/ui";

afterEach(cleanup);

describe("Navigatielogica (puur)", () => {
  it("elk pad hoort bij precies één hoofdgebied; detailschermen blijven onder hun gebied actief", () => {
    expect(tabForPath("/")).toBe("overzicht");
    expect(tabForPath("/ontheffingen/abc")).toBe("voorstellen"); // ontheffingen staan in de lijst bij Voorstellen
    expect(tabForPath("/voorstellen/nieuw")).toBe("voorstellen");
    expect(tabForPath("/roepingen/x")).toBe("voorstellen"); // voorheen: geen enkele tab actief
    expect(tabForPath("/beheer/inrichting")).toBe("beheer");
    expect(tabForPath("/meldingen")).toBe("meldingen");
    expect(tabForPath("/demo-beheer")).toBe("profiel");
    expect(parentPath("/demo-beheer")).toBe("/profiel");
    expect(tabForPath("/onbekend")).toBe("overzicht");
  });
  it("hoofdschermen hebben geen terugknop; diepere schermen wel", () => {
    for (const p of ["/", "/voorstellen", "/meldingen", "/profiel", "/beheer/gebruikers"]) expect(isTabRoot(p)).toBe(true);
    for (const p of ["/roepingen/1", "/voorstellen/nieuw", "/ontheffingen/9"]) expect(isTabRoot(p)).toBe(false);
  });
  it("terug: met geschiedenis een stap terug; zonder geschiedenis (melding/link) naar het bovenliggende scherm — nooit vast", () => {
    expect(backAction("/roepingen/1", true)).toEqual({ kind: "history" });
    expect(backAction("/roepingen/1", false)).toEqual({ kind: "path", to: "/voorstellen" });
    expect(backAction("/ontheffingen/9", false)).toEqual({ kind: "path", to: "/voorstellen" });
    expect(backAction("/voorstellen/concept/3", false)).toEqual({ kind: "path", to: "/voorstellen" });
    // Op een ander hoofdscherm brengt terug je naar het overzicht; op het overzicht zelf gaat de app naar de achtergrond (null).
    expect(backAction("/meldingen", true)).toEqual({ kind: "path", to: "/" });
    expect(backAction("/", true)).toBeNull();
  });
  it("titels en terugknoplabels", () => {
    expect(navTitle("/roepingen/1")).toBe("Voorstel");
    expect(navTitle("/ontheffingen/nieuw")).toBe("Nieuwe ontheffing");
    expect(titleOf(parentPath("/roepingen/1"))).toBe("Voorstellen");
    expect(titleOf(parentPath("/ontheffingen/9"))).toBe("Voorstellen");
  });
});

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}
function renderTabs(path: string, props: { unread?: number; pending?: number; manage?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar unread={props.unread ?? 0} pending={props.pending ?? 0} canManageUsers={props.manage} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>
  );
}

describe("Tabbalk", () => {
  it("toont icoon + label, maximaal vijf tabs (ook voor ringbeheerders) en markeert de actieve tab met aria-current", () => {
    renderTabs("/roepingen/1", { manage: true });
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Overzicht", "Voorstellen", "Beheer", "Meldingen", "Profiel"]);
    expect(links.length).toBeLessThanOrEqual(5);
    expect(links.every((l) => l.querySelector("svg[aria-hidden='true']"))).toBe(true);
    expect(screen.getByRole("link", { name: "Voorstellen" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Overzicht" }).getAttribute("aria-current")).toBeNull();
  });
  it("zonder beheerrechten geen Beheer-tab (de server beslist, dit is alleen de weergave)", () => {
    renderTabs("/", { manage: false });
    expect(screen.queryByRole("link", { name: "Beheer" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });
  it("badges: aantal met toegankelijk label, begrensd op 99+", () => {
    renderTabs("/", { unread: 120, pending: 3 });
    expect(screen.getByLabelText("3 wachten op jou")).toBeTruthy();
    expect(screen.getByLabelText("120 ongelezen").textContent).toBe("99+");
  });
  it("tikken op een andere tab navigeert naar het hoofdscherm; opnieuw tikken op de actieve tab blijft daar en scrollt omhoog", () => {
    const scroll = vi.fn();
    const main = document.createElement("main");
    main.className = "page";
    (main as unknown as { scrollTo: typeof scroll }).scrollTo = scroll;
    document.body.appendChild(main);
    renderTabs("/voorstellen/nieuw");
    fireEvent.click(screen.getByRole("link", { name: "Meldingen" }));
    expect(screen.getByTestId("where").textContent).toBe(TAB_ROOT.meldingen);
    fireEvent.click(screen.getByRole("link", { name: "Meldingen" }));
    expect(screen.getByTestId("where").textContent).toBe("/meldingen");
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    main.remove();
  });
  it("tikken op de actieve tab vanuit een dieper scherm brengt je naar het hoofdscherm van die tab", () => {
    renderTabs("/roepingen/1");
    fireEvent.click(screen.getByRole("link", { name: "Voorstellen" }));
    expect(screen.getByTestId("where").textContent).toBe("/voorstellen");
  });
});

describe("Navigatiebalk en segmenten", () => {
  it("terugknop heeft een toegankelijke naam met het vorige scherm en roept onBack aan", () => {
    const onBack = vi.fn();
    render(<NavBar title="Voorstel" backLabel="Voorstellen" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "Terug naar Voorstellen" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Voorstel")).toBeTruthy();
  });
  it("segmentbesturing: één geselecteerd segment (aria-selected), wisselen roept onChange aan", () => {
    const onChange = vi.fn();
    render(<Segmented label="Beheer" value="a" onChange={onChange} options={[{ value: "a", label: "Gebruikers" }, { value: "b", label: "Inrichting" }]} />);
    expect(screen.getByRole("tab", { name: "Gebruikers" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Inrichting" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
