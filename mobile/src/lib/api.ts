import type {
  AdminRing,
  AppointAuthority,
  CatalogResult,
  CustomCalling,
  EligibleAppointers,
  ApiMeta,
  AppNotification,
  CallingDetail,
  CallingItem,
  Dashboard,
  DeviceInfo,
  LoginResult,
  ManagedUser,
  Me,
  RemindResult,
  RingMemberInfo,
  SessionInfo,
  RingSetup,
  TaskKey,
  TokenResult,
  UnitInfo,
  UnitKind,
  UserSearchHit,
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
  /** Maximale wachttijd per verzoek (standaard 20 s). */
  timeoutMs?: number;
};

/** Dunne client voor /api/mobile/v1. Het sessietoken gaat alleen in de Authorization-header, nooit in een URL. */
export class ApiClient {
  /** Beheermodus (webmin): sessie-, refresh- en logoutroutes liggen dan onder /admin. */
  admin = false;
  constructor(private opts: ApiClientOptions) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, tokenOverride?: string | null): Promise<T> {
    const token = tokenOverride === undefined ? this.opts.getToken() : tokenOverride;
    let res: Response;
    // Time-out: een hangende verbinding mag de app nooit eindeloos laten laden.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl}${path}`, {
        signal: controller.signal,
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
    } finally {
      clearTimeout(timer);
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
    return this.request<{ rotated: boolean; token?: string; expiresAt?: string }>("POST", this.admin ? "/admin/auth/refresh" : "/auth/refresh", {});
  }
  logout(pushToken?: string) {
    return this.admin ? this.request<{ ok: boolean }>("POST", "/admin/auth/logout", {}) : this.request<{ ok: boolean }>("POST", "/auth/logout", { pushToken });
  }
  me() {
    return this.request<Me>("GET", "/me");
  }
  // ---- Webmin ----
  adminLogin(username: string, password: string) {
    return this.request<{ pendingToken: string; expiresAt: string }>("POST", "/admin/auth/login", { username, password }, null);
  }
  /** Tweede stap: het wachtende token gaat alleen in de Authorization-header. */
  adminVerify(pendingToken: string, proof: { code?: string; recoveryCode?: string }) {
    return this.request<TokenResult>("POST", "/admin/auth/totp", proof, pendingToken);
  }
  adminMe() {
    return this.request<{ user: { id: string; name: string; email: string }; isAdmin: boolean }>("GET", "/admin/me");
  }
  adminReauth(code: string) {
    return this.request<TokenResult>("POST", "/admin/auth/reauth", { code });
  }
  userReauth(code: string) {
    return this.request<TokenResult>("POST", "/auth/reauth", { code });
  }
  adminRings() {
    return this.request<{ rings: AdminRing[] }>("GET", "/admin/rings");
  }
  adminCreateRing(input: { name: string; existingUserId?: string; userName?: string; userEmail?: string; churchFunction: string; role: string }) {
    return this.request<{ id: string; name: string }>("POST", "/admin/rings", input);
  }
  adminRenameRing(id: string, name: string) {
    return this.request<{ ok: boolean }>("POST", `/admin/rings/${encodeURIComponent(id)}/rename`, { name });
  }
  adminSetRingActive(id: string, active: boolean) {
    return this.request<{ ok: boolean }>("POST", `/admin/rings/${encodeURIComponent(id)}/active`, { active });
  }
  adminSearchUsers(q: string) {
    return this.request<{ users: UserSearchHit[] }>("GET", `/admin/users?q=${encodeURIComponent(q)}`);
  }
  // ---- Gebruikersbeheer (ringbeheerder: eigen ring; webmin: via /admin) ----
  ringUsers(ringId: string) {
    return this.request<{ users: ManagedUser[] }>("GET", `${this.admin ? "/admin" : ""}/rings/${encodeURIComponent(ringId)}/users`);
  }
  addRingUser(ringId: string, input: { existingUserId?: string; name?: string; email?: string; churchFunction: string; role: string; isRingManager: boolean; appointAuthority?: AppointAuthority }) {
    return this.request<{ userId: string; name: string; joinedRounds: number }>("POST", `${this.admin ? "/admin" : ""}/rings/${encodeURIComponent(ringId)}/users`, input);
  }
  updateRingUser(membershipId: string, input: { churchFunction: string; role: string; isRingManager: boolean; active: boolean; appointAuthority?: AppointAuthority; name?: string; email?: string }) {
    return this.request<{ ok: boolean; joinedRounds: number }>("POST", `${this.admin ? "/admin" : ""}/memberships/${encodeURIComponent(membershipId)}`, input);
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
  completeTask(id: string, task: TaskKey, opts: { doneAt?: string; ondersteunenContext?: "AVONDMAALSVERGADERING" | "RINGCONFERENTIE" } = {}) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/tasks/${task.toLowerCase()}/complete`, opts);
  }
  assignTask(id: string, task: TaskKey, assigneeId: string | null) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/tasks/${task.toLowerCase()}/assign`, { assigneeId });
  }
  ringMembers(ringId: string) {
    return this.request<{ members: RingMemberInfo[] }>("GET", `/rings/${encodeURIComponent(ringId)}/members`);
  }
  createCalling(
    ringId: string,
    input: { personName: string; functionTitle: string; roepenAssigneeId?: string | null; ondersteunenAssigneeId?: string | null; aanstellenAssigneeId?: string | null }
  ) {
    return this.request<{ id: string }>("POST", `/callings?ring=${encodeURIComponent(ringId)}`, input);
  }
  /** Herinnert één deelnemer (userId) of iedereen die nog niet heeft gereageerd. */
  remind(id: string, userId?: string) {
    return this.request<RemindResult>("POST", `/callings/${encodeURIComponent(id)}/remind`, { userId });
  }
  reinvite(id: string, userId: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/reinvite`, { userId });
  }
  removeParticipant(id: string, userId: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/remove-participant`, { userId });
  }
  /** Geeft een voorstel met presidiumakkoord expliciet vrij aan de hoge raad (idempotent). */
  release(id: string) {
    return this.request<{ ok: boolean; released: boolean; alreadyReleased: boolean }>("POST", `/callings/${encodeURIComponent(id)}/release`, {});
  }
  /** Legt een in een vergadering genomen gezamenlijk besluit vast; maakt nooit individuele reacties namens anderen. */
  groupDecision(
    id: string,
    input: {
      stage: "PRESIDIUM" | "HOGERAAD";
      decidedOn: string;
      agreed: boolean;
      note?: string;
      presidingUserId?: string;
      presentUserIds?: string[];
      absentUserIds?: string[];
      resolveNegative?: boolean;
      resolutionNote?: string;
      releaseNow?: boolean;
    }
  ) {
    return this.request<{ ok: boolean; alreadyRegistered: boolean }>("POST", `/callings/${encodeURIComponent(id)}/group-decision`, input);
  }
  // ---- Ringinrichting en catalogus (ringbeheerder: eigen ring; webmin: via /admin) ----
  private ringPath(ringId: string, tail: string) {
    return `${this.admin ? "/admin" : ""}/rings/${encodeURIComponent(ringId)}/${tail}`;
  }
  ringSetup(ringId: string) {
    return this.request<RingSetup>("GET", this.ringPath(ringId, "setup"));
  }
  units(ringId: string) {
    return this.request<{ units: UnitInfo[] }>("GET", this.ringPath(ringId, "units"));
  }
  createUnit(ringId: string, input: { kind: UnitKind; name: string; responsibleUserId?: string | null; defaultRoepenUserId?: string | null; defaultOndersteunenUserId?: string | null; defaultAanstellenUserId?: string | null }) {
    return this.request<{ id: string }>("POST", this.ringPath(ringId, "units"), input);
  }
  updateUnit(id: string, input: { name?: string; kind?: UnitKind; active?: boolean; responsibleUserId?: string | null; defaultRoepenUserId?: string | null; defaultOndersteunenUserId?: string | null; defaultAanstellenUserId?: string | null }) {
    return this.request<{ ok: boolean }>("POST", `${this.admin ? "/admin" : ""}/units/${encodeURIComponent(id)}`, input);
  }
  customCallings(ringId: string) {
    return this.request<{ callings: CustomCalling[] }>("GET", this.ringPath(ringId, "custom-callings"));
  }
  createCustomCalling(ringId: string, input: { name: string; category: string }) {
    return this.request<{ id: string }>("POST", this.ringPath(ringId, "custom-callings"), input);
  }
  updateCustomCalling(id: string, input: { name?: string; category?: string; active?: boolean }) {
    return this.request<{ ok: boolean }>("POST", `${this.admin ? "/admin" : ""}/custom-callings/${encodeURIComponent(id)}`, input);
  }
  /** Doorzoekbare roepingencatalogus (standaard + eigen roepingen van deze ring). */
  catalog(ringId: string, q: string, category = "") {
    return this.request<CatalogResult>("GET", `/catalog/callings?ring=${encodeURIComponent(ringId)}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`);
  }
  appointers(ringId: string, code: string) {
    return this.request<EligibleAppointers>("GET", `/catalog/callings/${encodeURIComponent(code)}/appointers?ring=${encodeURIComponent(ringId)}`);
  }
  markProcessed(id: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/process`, {});
  }
  deleteCalling(id: string, confirmed: boolean) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/delete`, { confirmed });
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
    return this.request<{ sessions: SessionInfo[] }>("GET", this.admin ? "/admin/sessions" : "/sessions");
  }
  revokeSession(id: string) {
    return this.request<{ ok: boolean }>("POST", `${this.admin ? "/admin" : ""}/sessions/${encodeURIComponent(id)}/revoke`, {});
  }
}
