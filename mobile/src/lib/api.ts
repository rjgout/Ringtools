import type { AppNotification, CallingDetail, CallingItem, Dashboard, Me } from "./types";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null
  ) {
    super(message);
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => string | null;
  /** Wordt aangeroepen als de server 401 teruggeeft (sessie verlopen of ingetrokken). */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
};

/** Dunne client voor de JSON-API van Ringtools (/api/v1). Alle teksten van de server zijn al Nederlands. */
export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, tokenOverride?: string | null): Promise<T> {
    const token = tokenOverride === undefined ? this.opts.getToken() : tokenOverride;
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl}/api/v1${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiRequestError(0, "Geen verbinding met de server. Controleer je internetverbinding.", "network");
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* lege of niet-JSON-respons */
    }
    if (!res.ok) {
      if (res.status === 401 && token) this.opts.onUnauthorized?.();
      throw new ApiRequestError(res.status, typeof data.error === "string" ? data.error : "Er ging iets mis.", typeof data.code === "string" ? data.code : null);
    }
    return data as T;
  }

  requestCode(email: string) {
    return this.request<{ ok: boolean; message: string }>("POST", "/auth/request-code", { email }, null);
  }
  login(email: string, code: string, deviceName: string) {
    return this.request<Me & { token: string; expiresAt: string }>("POST", "/auth/login", { email, code, deviceName }, null);
  }
  refresh() {
    return this.request<{ rotated: boolean; token?: string; expiresAt?: string }>("POST", "/auth/refresh", {});
  }
  /** Meldt een push-token af zonder sessie (het token zelf is het geheim); werkt dus ook na een 401. */
  unregisterDevice(token: string) {
    return this.request<{ ok: boolean }>("POST", "/devices/unregister", { token }, null);
  }
  logout(pushToken?: string) {
    return this.request<{ ok: boolean }>("POST", "/auth/logout", { pushToken });
  }
  me() {
    return this.request<Me>("GET", "/me");
  }
  dashboard(ringId: string) {
    return this.request<Dashboard>("GET", `/dashboard?ring=${encodeURIComponent(ringId)}`);
  }
  callings(ringId: string, filter = "alle") {
    return this.request<{ callings: CallingItem[] }>("GET", `/callings?ring=${encodeURIComponent(ringId)}&filter=${encodeURIComponent(filter)}`);
  }
  calling(id: string) {
    return this.request<CallingDetail>("GET", `/callings/${encodeURIComponent(id)}`);
  }
  createCalling(ringId: string, personName: string, functionTitle: string) {
    return this.request<{ id: string }>("POST", `/callings?ring=${encodeURIComponent(ringId)}`, { personName, functionTitle });
  }
  vote(id: string, support: boolean) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/vote`, { support });
  }
  remind(id: string, userId?: string) {
    return this.request<{ sent: number; skippedRecent: number }>("POST", `/callings/${encodeURIComponent(id)}/remind`, { userId });
  }
  reinvite(id: string, userId: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/reinvite`, { userId });
  }
  removeParticipant(id: string, userId: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/remove-participant`, { userId });
  }
  deleteCalling(id: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/delete`, { confirmed: true });
  }
  process(id: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/process`, {});
  }
  assignTask(id: string, task: string, assigneeId: string | null) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/tasks/${task.toLowerCase()}/assign`, { assigneeId });
  }
  completeTask(id: string, task: string, ondersteunenContext?: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/tasks/${task.toLowerCase()}/complete`, {
      doneAt: new Date().toISOString(),
      ondersteunenContext,
    });
  }
  notifications(ringId: string) {
    return this.request<{ unreadCount: number; notifications: AppNotification[] }>("GET", `/notifications?ring=${encodeURIComponent(ringId)}`);
  }
  markRead(ringId: string, id?: string) {
    return this.request<{ ok: boolean }>("POST", "/notifications/read", { ringId, id });
  }
  registerDevice(token: string, platform: "ios" | "android") {
    return this.request<{ ok: boolean }>("POST", "/devices", { token, platform });
  }
  resolveOpenLink(token: string) {
    return this.request<{ valid: boolean; callingId?: string }>("GET", `/open/${encodeURIComponent(token)}`, undefined, null);
  }
}
