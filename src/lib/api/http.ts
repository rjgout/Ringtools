import { AccountDeletionError } from "../accountDeletion";
import { SessionNoLongerValidError } from "../auth";
/** Fout met een HTTP-status en een Nederlandse melding, voor de JSON-API van de native app. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export const NO_STORE = { "Cache-Control": "no-store" };

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorResponse(err: unknown): Response {
  // Een gelijktijdig verzoek was ons voor: de sessie is al verbruikt. Gewoon als verlopen sessie behandelen (geen 500).
  if (err instanceof SessionNoLongerValidError) return jsonResponse({ error: "Je inlogsessie is verlopen. Log opnieuw in.", code: "unauthenticated" }, 401);
  if (err instanceof AccountDeletionError) return jsonResponse({ error: err.message, code: "deletion" }, 400);
  if (err instanceof ApiError) {
    return jsonResponse({ error: err.message, code: err.code ?? null }, err.status);
  }
  console.error("[api] Onverwachte fout:", err);
  return jsonResponse({ error: "Er ging iets mis aan onze kant. Probeer het later opnieuw.", code: "server" }, 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
