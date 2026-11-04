import type {
  ApiMeta,
  AppNotification,
  CallingDetail,
  CallingItem,
  Dashboard,
  DeviceInfo,
  LoginResult,
  Me,
  SessionInfo,
  TaskKey,
} from "@shared/api-types";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string | null
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => string | null;
  /** Aangeroepen bij 401 (sessie verlopen, ingetrokken of gebruiker gedeactiveerd). */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
};

/** Dunne client voor /api/mobile/v1. Het sessietoken gaat alleen in de Authorization-header, nooit in een URL. */
export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, tokenOverride?: string | null): Promise<T> {
    const token = tokenOverride === undefined ? this.opts.getToken() : tokenOverride;
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl}${path}`, {
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

  meta() {
    return this.request<ApiMeta>("GET", "/meta", undefined, null);
  }
  requestCode(email: string) {
    return this.request<{ ok: boolean; message: string }>("POST", "/auth/request-code", { email }, null);
  }
  login(email: string, code: string, deviceName: string) {
    return this.request<LoginResult>("POST", "/auth/login", { email, code, deviceName }, null);
  }
  refresh() {
    return this.request<{ rotated: boolean; token?: string; expiresAt?: string }>("POST", "/auth/refresh", {});
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
  vote(id: string, support: boolean) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/vote`, { support });
  }
  completeTask(id: string, task: TaskKey) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/tasks/${task.toLowerCase()}/complete`, {});
  }
  notifications(ringId: string) {
    return this.request<{ notifications: AppNotification[]; unreadCount: number }>("GET", `/notifications?ring=${encodeURIComponent(ringId)}`);
  }
  markNotificationsRead(ringId: string, id?: string) {
    return this.request<{ ok: boolean }>("POST", "/notifications/read", { ringId, id });
  }
  openLink(token: string) {
    return this.request<{ valid: boolean; callingId?: string }>("GET", `/open/${encodeURIComponent(token)}`, undefined, null);
  }
  registerDevice(token: string, platform: "ios" | "android", deviceId: string) {
    return this.request<{ ok: boolean }>("POST", "/devices", { token, platform, deviceId });
  }
  devices() {
    return this.request<{ devices: DeviceInfo[] }>("GET", "/devices");
  }
  setDeviceActive(id: string, active: boolean) {
    return this.request<{ ok: boolean }>("POST", `/devices/${encodeURIComponent(id)}/active`, { active });
  }
  /** Meldt een pushtoken af zonder sessie (het token zelf is het geheim); werkt dus ook na een 401. */
  unregisterDeviceToken(token: string) {
    return this.request<{ ok: boolean }>("POST", "/devices/unregister", { token }, null);
  }
  sessions() {
    return this.request<{ sessions: SessionInfo[] }>("GET", "/sessions");
  }
  revokeSession(id: string) {
    return this.request<{ ok: boolean }>("POST", `/sessions/${encodeURIComponent(id)}/revoke`, {});
  }
}
