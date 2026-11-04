import type { Me } from "@shared/api-types";
import { ApiRequestError } from "./api";

export type Resumed =
  | { kind: "signedOut" }
  | { kind: "signedIn"; me: Me }
  | { kind: "unavailable"; error: ApiRequestError };

type Deps = {
  getToken: () => Promise<string | null>;
  /** Zet het token in het geheugen van de API-client voordat /me wordt opgevraagd. */
  useToken: (token: string) => void;
  me: () => Promise<Me>;
};

/**
 * Hervat een bewaarde sessie bij het opstarten. Geeft ALTIJD een eindtoestand terug (nooit een uitzondering of
 * eeuwig laden): geen/onleesbaar token of 401 → uitgelogd; geen verbinding, time-out of serverfout →
 * "unavailable" (het token blijft bewaard, de gebruiker kan opnieuw proberen); anders ingelogd.
 */
export async function resumeSession(deps: Deps): Promise<Resumed> {
  let token: string | null;
  try {
    token = await deps.getToken();
  } catch {
    return { kind: "signedOut" }; // beveiligde opslag onleesbaar: veilig terugvallen op inloggen
  }
  if (!token) return { kind: "signedOut" };
  deps.useToken(token);
  try {
    return { kind: "signedIn", me: await deps.me() };
  } catch (err) {
    const error = err instanceof ApiRequestError ? err : new ApiRequestError(0, "Er ging iets mis bij het starten.", "unknown");
    if (error.status === 401) return { kind: "signedOut" };
    return { kind: "unavailable", error };
  }
}
