/**
 * Tijdelijke, alleen-in-het-geheugen bewaarplaats voor een bestemming uit een deeplink of pushmelding die binnenkwam terwijl de app
 * nog vergrendeld was. De bestemming wordt pas na ontgrendeling verwerkt, vervalt na 5 minuten en wordt nooit opgeslagen of gelogd.
 */
export const ROUTE_TTL_MS = 5 * 60_000;

type Entry = { route: string; at: number };

export class RouteInbox {
  private entry: Entry | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  push(route: string): void {
    this.entry = { route, at: this.now() }; // een nieuwere bestemming vervangt de oude
    this.listeners.forEach((l) => l());
  }

  /** Haalt de bestemming op en verwijdert hem; een verlopen bestemming levert niets op. */
  take(): string | null {
    const e = this.entry;
    this.entry = null;
    if (!e) return null;
    return this.now() - e.at <= ROUTE_TTL_MS ? e.route : null;
  }

  clear(): void {
    this.entry = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

export const routeInbox = new RouteInbox();
