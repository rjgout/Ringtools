import { useEffect } from "react";
import { routeInbox, type RouteInbox } from "./routeInbox";

/** Verwerkt bestemmingen uit links/meldingen uitsluitend zolang `ready` (ontgrendeld en niet afgeschermd) waar is. */
export function useRouteInbox(ready: boolean, onRoute: (route: string) => void, inbox: RouteInbox = routeInbox): void {
  useEffect(() => {
    if (!ready) return;
    const take = () => {
      const route = inbox.take();
      if (route) onRoute(route);
    };
    take();
    return inbox.subscribe(take);
  }, [ready, onRoute, inbox]);
}
