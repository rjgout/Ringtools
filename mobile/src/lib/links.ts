/**
 * Bepaalt waar een link of pushmelding naartoe leidt. Alleen bekende interne routes worden
 * herkend (voorstel en e-maillink); alles anders — externe URL's, onbekende paden — levert null
 * op en wordt genegeerd.
 */
export type Target = { kind: "calling"; id: string } | { kind: "open"; token: string };

const ID = /^[A-Za-z0-9_-]{8,64}$/;

export function parseTarget(input: string | null | undefined): Target | null {
  if (!input || typeof input !== "string") return null;
  let path = input.trim();

  // Volledige URL's: alleen https op de eigen host of het eigen schema ringtools://
  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(path);
  if (full) {
    const [, scheme, host, rest] = full;
    if (scheme.toLowerCase() === "ringtools") path = `/${host}${rest}`;
    else if (scheme.toLowerCase() === "https") path = rest || "/";
    else return null;
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;

  const [clean] = path.split(/[?#]/);
  const calling = /^\/roepingen\/([^/]+)\/?$/.exec(clean);
  if (calling && ID.test(calling[1])) return { kind: "calling", id: calling[1] };
  const open = /^\/open\/([^/]+)\/?$/.exec(clean);
  if (open && ID.test(open[1])) return { kind: "open", token: open[1] };
  return null;
}

/** Interne route in de app voor een herkend doel. */
export function routeFor(target: Target): string {
  return target.kind === "calling" ? `/roepingen/${target.id}` : `/open/${target.token}`;
}
