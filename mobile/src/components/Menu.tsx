import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInRouterContext, useLocation } from "react-router-dom";
import { registerOverlay } from "../lib/overlays";

export type MenuItem = {
  id: string;
  label: string;
  /** Pad van een 24×24-icoon (zelfde stijl als de tabbalk). */
  icon?: string;
  onSelect: () => void;
  /** Rood: verwijderen, intrekken, deactiveren. */
  danger?: boolean;
  disabled?: boolean;
  /** Onzichtbaar item (rolgebonden): wordt niet getoond; de server blijft de bevoegdheid bepalen. */
  hidden?: boolean;
};

const VIEWPORT_MARGIN = 8;
const GAP = 4;

/** Plaatst een menu bij zijn knop: onder de knop als daar ruimte is, anders erboven, altijd binnen het scherm. Puur en getest. */
export function placeMenu(
  anchor: { top: number; bottom: number; left: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number }
): { top: number; left: number; placement: "below" | "above" } {
  const below = viewport.height - anchor.bottom - GAP - VIEWPORT_MARGIN;
  const above = anchor.top - GAP - VIEWPORT_MARGIN;
  const placement = menu.height <= below || below >= above ? "below" : "above";
  let top = placement === "below" ? anchor.bottom + GAP : anchor.top - GAP - menu.height;
  // Past het menu in geen van beide richtingen volledig, dan blijft het binnen het scherm (het menu scrolt zelf).
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewport.height - VIEWPORT_MARGIN - Math.min(menu.height, viewport.height - 2 * VIEWPORT_MARGIN)));
  // Rechts uitgelijnd met de knop (de knop staat doorgaans rechts op de rij), maar nooit buiten het scherm.
  let left = anchor.right - menu.width;
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewport.width - VIEWPORT_MARGIN - menu.width));
  return { top, left, placement };
}

/** Sluit het menu zodra de route verandert (alleen gemonteerd zolang het menu open is, binnen een router). */
function CloseOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const location = useLocation();
  const start = useRef(location.pathname + location.search);
  useEffect(() => {
    if (location.pathname + location.search !== start.current) onNavigate();
  }, [location.pathname, location.search, onNavigate]);
  return null;
}

/** Icoonknop van 48 × 48 px. Altijd met een toegankelijke naam. */
export function IconButton({ label, children, ...rest }: { label: string; children: React.ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
  return (
    <button type="button" className="icon-btn" aria-label={label} {...rest}>
      {children}
    </button>
  );
}

const DOTS = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
  </svg>
);

/**
 * Contextmenu bij een rij of kaart (⋯). Opent direct bij de knop, past automatisch boven of onder de knop en blijft binnen het scherm.
 * Sluit bij tikken buiten het menu, Escape, de Android-terugknop, navigatie en scrollen van de pagina; de focus keert terug naar de knop.
 * Items zijn toetsenbord- en schermlezerbediend (menu/menuitem, pijltjestoetsen).
 */
export function ActionMenu({ label, items, disabled = false }: { label: string; items: MenuItem[]; disabled?: boolean }) {
  const visible = items.filter((i) => !i.hidden);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "below" | "above" } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const inRouter = useInRouterContext();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  // Positie bepalen zodra het menu gemeten kan worden; opnieuw bij schermgrootte (toetsenbord, draaien) en scrollen.
  const place = useCallback(() => {
    if (!trigger.current || !menu.current) return;
    const a = trigger.current.getBoundingClientRect();
    const m = menu.current.getBoundingClientRect();
    const vv = window.visualViewport;
    setPos(placeMenu(a, { width: m.width, height: menu.current.scrollHeight }, { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight }));
  }, []);
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, visible.length]);

  useEffect(() => {
    if (!open) return;
    const off = registerOverlay(() => close());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") close(false);
    };
    const onResize = () => place();
    // Scrollen van de pagina verplaatst de knop: het menu volgt, zodat het nooit los van de rij zweeft.
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [open, close, place]);

  // Eerste item krijgt de focus bij openen.
  useEffect(() => {
    if (open && pos) menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [open, pos]);

  if (visible.length === 0) return null;

  const move = (e: React.KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === "ArrowDown" ? (i + 1) % els.length : e.key === "ArrowUp" ? (i - 1 + els.length) % els.length : e.key === "Home" ? 0 : e.key === "End" ? els.length - 1 : -1;
    if (to >= 0 && els.length) { e.preventDefault(); els[to].focus(); }
  };

  return (
    <>
      <button ref={trigger} type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled} onClick={() => (open ? close() : setOpen(true))}>
        {DOTS}
      </button>
      {open && inRouter && <CloseOnNavigate onNavigate={() => close(false)} />}
      {open &&
        createPortal(
          <>
            <div className="menu-backdrop" data-testid="menu-backdrop" onPointerDown={() => close(false)} />
            <div
              ref={menu}
              id={menuId}
              role="menu"
              aria-label={label}
              className={`menu glass${pos ? "" : " measuring"}`}
              data-placement={pos?.placement}
              style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0 }}
              onKeyDown={move}
            >
              {visible.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`menu-item${item.danger ? " danger" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    close(false);
                    // Na het sluiten uitvoeren: een bevestigingsdialoog kan dan de focus overnemen.
                    window.setTimeout(item.onSelect, 0);
                  }}
                >
                  {item.icon && (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={item.icon} /></svg>
                  )}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

/** Iconen voor menu-items (zelfde lijnstijl als de tabbalk). */
export const MENU_ICONS = {
  edit: "M4 20h4L19 9l-4-4L4 16z M13 7l4 4",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6",
  remind: "M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7 M10 20a2 2 0 0 0 4 0",
  mail: "M3 6h18v12H3z M3 7l9 7 9-7",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M5 21c1-4 4-6 7-6s6 2 7 6",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M6 6l12 12",
  undo: "M9 7L4 12l5 5 M4 12h11a5 5 0 0 1 0 10h-3",
  send: "M4 12l16-8-6 16-3-6z",
} as const;
