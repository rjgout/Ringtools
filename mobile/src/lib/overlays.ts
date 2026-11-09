/**
 * Stapel van geopende overlays (contextmenu, dialoog, sheet). De Android-terugknop sluit eerst de bovenste overlay en navigeert pas
 * daarna (zie App.tsx). Een overlay meldt zich aan bij het openen en af bij het sluiten; alleen de eigen registratie wordt verwijderd.
 */
type Entry = { id: number; close: () => void };
const stack: Entry[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Meldt wijzigingen (open/dicht) aan o.a. de native tabbalk, die tijdens een overlay verdwijnt. Verwijdert alleen de eigen luisteraar. */
export function subscribeOverlays(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function registerOverlay(close: () => void): () => void {
  const entry = { id: next++, close };
  stack.push(entry);
  emit();
  return () => {
    const i = stack.findIndex((e) => e.id === entry.id);
    if (i >= 0) stack.splice(i, 1);
    emit();
  };
}

/** Sluit de bovenste overlay. Geeft true als er iets gesloten is (de terugactie is dan afgehandeld). */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export const hasOverlay = () => stack.length > 0;
