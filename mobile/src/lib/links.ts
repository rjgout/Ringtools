/**
 * Bepaalt waar een universele link, app-link of pushmelding naartoe leidt. Alleen bekende interne
 * routes op de eigen host worden herkend (voorstel en e-maillink); alles anders — externe hosts,
 * onbekende paden, open redirects — levert null op en wordt genegeerd. Het token van een
 * e-maillink wordt nooit gelogd en verlaat de app alleen richting de eigen backend.
 */
export type Target = { kind: "calling"; id: string } | { kind: "ontheffing"; id: string } | { kind: "open"; token: string };

const ID = /^[A-Za-z0-9_-]{8,128}$/;

export function parseTarget(input: string | null | undefined, ownHost: string): Target | null {
  if (!input || typeof input !== "string") return null;
  let path = input.trim();

  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/i.exec(path);
  if (full) {
    const [, scheme, host, rest] = full;
    if (scheme.toLowerCase() !== "https" || host.toLowerCase() !== ownHost.toLowerCase()) return null;
    path = rest || "/";
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;

  const [clean] = path.split(/[?#]/);
  const calling = /^\/roepingen\/([^/]+)\/?$/.exec(clean);
  if (calling && ID.test(calling[1])) return { kind: "calling", id: calling[1] };
  // Alleen intern (pushmelding binnen de app); ontheffingen hebben bewust geen universele link en geen e-maillink.
  const ontheffing = /^\/ontheffingen\/([^/]+)\/?$/.exec(clean);
  if (ontheffing && ID.test(ontheffing[1])) return { kind: "ontheffing", id: ontheffing[1] };
  const open = /^\/open\/([^/]+)\/?$/.exec(clean);
  if (open && ID.test(open[1])) return { kind: "open", token: open[1] };
  return null;
}

/** Interne route in de app voor een herkend doel. */
export function routeFor(target: Target): string {
  if (target.kind === "calling") return `/roepingen/${target.id}`;
  if (target.kind === "ontheffing") return `/ontheffingen/${target.id}`;
  return `/open/${target.token}`;
}
