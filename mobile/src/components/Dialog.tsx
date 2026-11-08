import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { registerOverlay } from "../lib/overlays";

/** Beschrijving van een bevestiging: wat gebeurt er, met duidelijke knoppen. */
export type ConfirmOptions = {
  title: string;
  /** Gevolgen in gewone taal. */
  message: string;
  /** Extra regel, bijv. "Deze actie kan niet ongedaan worden gemaakt." */
  detail?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Verwijderen, intrekken, deactiveren: rode bevestigingsknop. */
  danger?: boolean;
};

type Ask = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask | null>(null);

/** Eén app-eigen bevestigingsdialoog voor verwijderen, deactiveren, intrekken en vergelijkbare acties. Systeemprompts blijven voor biometrie en OS-toestemmingen. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm vereist een ConfirmProvider");
  return ask;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback<Ask>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // Een tweede bevestiging terwijl er al een open staat: de eerste telt als geannuleerd (nooit twee dialogen tegelijk).
        setState((prev) => {
          prev?.resolve(false);
          return { options, resolve };
        });
      }),
    []
  );
  const value = useMemo(() => ask, [ask]);
  const settle = (v: boolean) => {
    setState((s) => {
      s?.resolve(v);
      return null;
    });
  };
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state && <ConfirmDialog options={state.options} onResult={settle} />}
    </ConfirmContext.Provider>
  );
}

/**
 * Modale bevestiging. Focus gaat naar de veilige knop (Annuleren) en blijft binnen de dialoog; Escape, de Android-terugknop en tikken op de
 * achtergrond betekenen Annuleren. De bevestigingsknop kan na één tik niet nogmaals worden geactiveerd (geen dubbele uitvoering).
 */
export function ConfirmDialog({ options, onResult }: { options: ConfirmOptions; onResult: (confirmed: boolean) => void }) {
  const titleId = useId();
  const descId = useId();
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const done = useRef(false);
  const previous = useRef<Element | null>(null);

  const finish = useCallback(
    (v: boolean) => {
      if (done.current) return;
      done.current = true;
      onResult(v);
    },
    [onResult]
  );

  useEffect(() => {
    previous.current = document.activeElement;
    cancel.current?.focus();
    const off = registerOverlay(() => finish(false));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); return; }
      if (e.key !== "Tab" || !root.current) return;
      const f = Array.from(root.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      off();
      document.removeEventListener("keydown", onKey, true);
      // De focus keert terug naar het element dat de dialoog opende (als dat nog bestaat).
      if (previous.current instanceof HTMLElement && document.contains(previous.current)) previous.current.focus();
    };
  }, [finish]);

  return createPortal(
    <div className="dialog-backdrop" data-testid="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) finish(false); }}>
      <div ref={root} className="dialog glass card stack" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
        <h2 id={titleId} className="dialog-title">{options.title}</h2>
        <div id={descId} className="stack">
          <span>{options.message}</span>
          {options.detail && <span className="muted">{options.detail}</span>}
        </div>
        <div className="row dialog-actions">
          <button ref={cancel} type="button" className="btn btn-ghost" onClick={() => finish(false)}>{options.cancelLabel ?? "Annuleren"}</button>
          <button type="button" className={`btn ${options.danger ? "btn-danger" : "btn-primary"}`} onClick={() => finish(true)}>{options.confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Sheet voor formulieren en detailkeuzes die bij een rij horen: opent bovenaan het scherm (het toetsenbord dekt het nooit af), houdt de focus
 * binnen en sluit met Escape, de Android-terugknop of Annuleren. Vervangt formulieren die onderaan een lange pagina verschenen.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<Element | null>(null);
  // De sluitfunctie via een ref: een nieuwe functie bij elke render mag de focus niet opnieuw verplaatsen.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    previous.current = document.activeElement;
    root.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const close = () => closeRef.current();
    const off = registerOverlay(close);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      off();
      document.removeEventListener("keydown", onKey);
      if (previous.current instanceof HTMLElement && document.contains(previous.current)) previous.current.focus();
    };
  }, []);
  return createPortal(
    <div className="sheet-backdrop" data-testid="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div ref={root} className="glass card stack sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="sheet-title">{title}</h2>
        {children}
      </div>
    </div>,
    document.body
  );
}
