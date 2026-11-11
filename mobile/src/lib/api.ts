import type { PasskeyAssertion, PasskeyRequestOptions } from "./passkeys";
import type {
  AppointAuthority,
  CatalogResult,
  ChurchFunctionCode,
  DraftListItem,
  DraftView,
  CustomCalling,
  EligibleAppointers,
  InvitationActivation,
  InvitationItem,
  InvitationSendResult,
  InvitationPreview,
  ApiMeta,
  AppNotification,
  CallingDetail,
  CallingItem,
  Dashboard,
  DeviceInfo,
  LoginResult,
  PendingMfaLogin,
  ManagedUser,
  Me,
  OntheffingConceptInput,
  OntheffingListItem,
  OntheffingView,
  RemindResult,
  RingMemberInfo,
  SessionInfo,
  RingSetup,
  TaskKey,
  TokenResult,
  UnitInfo,
  UnitKind,
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

export type DraftInput = Partial<{
  personName: string | null; unitId: string | null; functionSource: "STANDAARD" | "EIGEN" | null; functionCode: string | null;
  roepenAssigneeId: string | null; ondersteunenAssigneeId: string | null; aanstellenAssigneeId: string | null;
  roepenExternalName: string | null; aanstellenExternalName: string | null; procedureConfirmed: boolean;
}>;

export type ApiClientOptions = {
  baseUrl: string;
  getToken: () => string | null;
  /** Aangeroepen bij 401 (sessie verlopen, ingetrokken of gebruiker gedeactiveerd). */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  /** Maximale wachttijd per verzoek (standaard 20 s). */
  timeoutMs?: number;
  /**
   * Vangnet van de appvergrendeling: geeft dit `true`, dan wordt er NIET gevraagd (geen netwerkverkeer). Zo kan geen enkel scherm of
   * achtergrondproces gegevens ophalen of een sessie verversen zolang de app vergrendeld is. Standaard: nooit geblokkeerd.
   */
  isBlocked?: () => boolean;
};

/** Dunne client voor /api/mobile/v1. Het sessietoken gaat alleen in de Authorization-header, nooit in een URL. */
export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown, tokenOverride?: string | null): Promise<T> {
    if (this.opts.isBlocked?.()) throw new ApiRequestError(0, "Ringtools is vergrendeld. Ontgrendel de app om verder te gaan.", "app-locked");
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
      if (res.status === 401 && token && tokenOverride === undefined) this.opts.onUnauthorized?.();
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
  /** Geeft een volledige sessie, of — bij verplichte MFA met native passkeys — een pending-login zonder rechten. */
  login(email: string, code: string, deviceName: string) {
    return this.request<LoginResult | PendingMfaLogin>("POST", "/auth/login", { email, code, deviceName }, null);
  }
  reviewManagement(ringId: string) {
    return this.request<import("@shared/api-types").ReviewManagementView>("GET", `/rings/${encodeURIComponent(ringId)}/review-management`);
  }
  reviewLogin(email: string, password: string) {
    return this.request<LoginResult>("POST", "/auth/review/login", { email, password }, null);
  }
  reviewReauth(password: string) {
    return this.request<TokenResult>("POST", "/auth/review/reauth", { password });
  }
  deletionStatus() { return this.request<{ request: DeletionStatus | null }>("GET", "/privacy/deletion"); }
  requestDeletion() { return this.request<{ request: DeletionStatus; receipt: string }>("POST", "/privacy/deletion", { confirm: true }); }
  deletionReceipt(receipt: string) { return this.request<{ request: DeletionStatus | null }>("POST", "/privacy/deletion/status", { receipt }, null); }
  passkeyOptions(pendingToken: string) {
    return this.request<{ options: PasskeyRequestOptions }>("POST", "/auth/mfa/passkey/options", {}, pendingToken);
  }
  passkeyVerify(pendingToken: string, response: PasskeyAssertion) {
    return this.request<LoginResult>("POST", "/auth/mfa/passkey/verify", { response }, pendingToken);
  }
  totpVerify(pendingToken: string, proof: { code?: string; recoveryCode?: string }) {
    return this.request<LoginResult>("POST", "/auth/mfa/totp/verify", proof, pendingToken);
  }
  deviceChallenge(installationId: string) {
    return this.request<{ challengeId: string; challenge: string; deviceId: string; expiresAt: string }>("POST", "/auth/device/challenge", { installationId }, null);
  }
  deviceLogin(input: { installationId: string; challengeId: string; signature: string }) {
    return this.request<LoginResult>("POST", "/auth/device/login", input, null);
  }
  deviceStatus(installationId: string) {
    return this.request<{ registered: boolean; loginEnabled: boolean }>("POST", "/auth/device/status", { installationId });
  }
  deviceEnrollChallenge() {
    return this.request<{ enrollmentId: string; challenge: string; userId: string; expiresAt: string }>("POST", "/auth/device/enroll/challenge", {});
  }
  deviceEnrollComplete(input: { enrollmentId: string; publicKey: string; installationId: string; signature: string; platform: "IOS" | "ANDROID"; label: string }) {
    return this.request<{ ok: boolean; deviceId: string }>("POST", "/auth/device/enroll/complete", input);
  }
  deviceDisable(installationId: string) {
    return this.request<{ ok: boolean }>("POST", "/auth/device/disable", { installationId });
  }
  deviceActivateChallenge(installationId: string) {
    return this.request<{ challengeId: string; challenge: string; deviceId: string; expiresAt: string }>("POST", "/auth/device/activate/challenge", { installationId });
  }
  deviceActivateConfirm(input: { installationId: string; challengeId: string; signature: string }) {
    return this.request<{ ok: boolean }>("POST", "/auth/device/activate/confirm", input);
  }
  claimDevicePairing(code: string) {
    return this.request<{ registrationToken: string; challenge: string; expiresAt: string }>("POST", "/trusted-devices/pair/claim", { code }, null);
  }
  completeDevicePairing(input: { registrationToken: string; publicKey: string; signature: string; installationId: string; platform: "IOS" | "ANDROID"; label: string }) {
    return this.request<{ ok: boolean; deviceId: string }>("POST", "/trusted-devices/pair/complete", input, null);
  }
  cancelMfa(pendingToken: string) {
    return this.request<{ ok: boolean }>("POST", "/auth/mfa/cancel", {}, pendingToken);
  }
  refresh() {
    return this.request<{ rotated: boolean; token?: string; expiresAt?: string }>("POST", "/auth/refresh", {});
  }
  retryLogout(token: string) { return this.request<{ ok: boolean }>("POST", "/auth/logout", {}, token); }
  logout(pushToken?: string) {
    return this.request<{ ok: boolean }>("POST", "/auth/logout", { pushToken });
  }
  me() {
    return this.request<Me>("GET", "/me");
  }
  /** Herverificatie van een ingelogde MFA-gebruiker met een passkey (alleen als native passkeys op de server aan staan). */
  reauthPasskeyOptions() {
    return this.request<{ options: PasskeyRequestOptions }>("POST", "/auth/reauth/passkey/options", {});
  }
  reauthPasskeyVerify(response: PasskeyAssertion) {
    return this.request<TokenResult>("POST", "/auth/reauth/passkey/verify", { response });
  }
  userReauth(code: string) {
    return this.request<TokenResult>("POST", "/auth/reauth", { code });
  }
  // ---- Gebruikersbeheer (ringbeheerder: eigen ring) ----
  ringUsers(ringId: string) {
    return this.request<{ users: ManagedUser[] }>("GET", `/rings/${encodeURIComponent(ringId)}/users`);
  }
  addRingUser(ringId: string, input: { existingUserId?: string; name?: string; email?: string; churchFunction: string; churchFunctionCode?: ChurchFunctionCode; role: string; isRingManager: boolean; appointAuthority?: AppointAuthority }) {
    return this.request<{ userId: string; name: string; joinedRounds: number }>("POST", `/rings/${encodeURIComponent(ringId)}/users`, input);
  }
  updateRingUser(membershipId: string, input: { churchFunction: string; churchFunctionCode?: ChurchFunctionCode; role: string; isRingManager: boolean; active: boolean; appointAuthority?: AppointAuthority; name?: string; email?: string }) {
    return this.request<{ ok: boolean; joinedRounds: number }>("POST", `/memberships/${encodeURIComponent(membershipId)}`, input);
  }
  // ---- Uitnodigingen (ringbeheerder: eigen ring) ----
  ringInvitations(ringId: string) {
    return this.request<{ invitations: InvitationItem[] }>("GET", `/rings/${encodeURIComponent(ringId)}/invitations`);
  }
  createInvitation(ringId: string, input: { name: string; email: string; role: string; churchFunction?: string; churchFunctionCode?: ChurchFunctionCode; isRingManager: boolean }) {
    return this.request<{ id: string; sent: boolean }>("POST", `/rings/${encodeURIComponent(ringId)}/invitations`, input);
  }
  /** Beheerder: gewone inlogmail naar het geregistreerde adres van een bestaand lid (geen uitnodiging; code/link blijven verborgen). */
  sendLoginMail(ringId: string, userId: string) {
    return this.request<{ ok: boolean; message: string }>("POST", `/rings/${encodeURIComponent(ringId)}/users/${encodeURIComponent(userId)}/login-mail`, {});
  }
  resendInvitation(id: string) {
    return this.request<InvitationSendResult>("POST", `/invitations/${encodeURIComponent(id)}/resend`, {});
  }
  revokeInvitation(id: string) {
    return this.request<{ ok: boolean }>("POST", `/invitations/${encodeURIComponent(id)}/revoke`, {});
  }
  /** Ontvanger: controleren en activeren; het token staat in de body (nooit in de URL) en er is geen sessie nodig. */
  previewInvitation(token: string) {
    return this.request<InvitationPreview>("POST", "/invitations/preview", { token }, null);
  }
  activateInvitation(input: ({ token: string } | { email: string; code: string }) & { deviceName?: string; issueSession?: boolean }) {
    return this.request<InvitationActivation>("POST", "/invitations/activate", input, null);
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
  assignTask(id: string, task: TaskKey, assigneeId: string | null, externalName?: string) {
    return this.request<{ ok: boolean }>("POST", `/callings/${encodeURIComponent(id)}/tasks/${task.toLowerCase()}/assign`, { assigneeId, externalName });
  }
  ringMembers(ringId: string) {
    return this.request<{ members: RingMemberInfo[] }>("GET", `/rings/${encodeURIComponent(ringId)}/members`);
  }
  // ---- Concepten en nieuwe voorstellen: alleen via concepten (server valideert bij indienen; idempotent) ----
  createDraft(ringId: string, input: DraftInput) {
    return this.request<{ id: string }>("POST", `/drafts?ring=${encodeURIComponent(ringId)}`, input);
  }
  updateDraft(id: string, input: DraftInput) {
    return this.request<{ ok: boolean }>("POST", `/drafts/${encodeURIComponent(id)}`, input);
  }
  draft(id: string) {
    return this.request<DraftView>("GET", `/drafts/${encodeURIComponent(id)}`);
  }
  drafts(ringId: string) {
    return this.request<{ drafts: DraftListItem[] }>("GET", `/drafts?ring=${encodeURIComponent(ringId)}`);
  }
  deleteDraft(id: string) {
    return this.request<{ ok: boolean }>("POST", `/drafts/${encodeURIComponent(id)}/delete`, {});
  }
  /** Dient een concept in. Herhaald aanroepen (dubbel tikken, netwerkherhaling) maakt nooit een tweede voorstel. */
  submitDraft(id: string) {
    return this.request<{ id: string; alreadySubmitted: boolean; notificationsDelivered: boolean }>("POST", `/drafts/${encodeURIComponent(id)}/submit`, {});
  }
  suggestions(ringId: string, unitId: string | null, source: string | null, code: string | null) {
    const q = new URLSearchParams({ ring: ringId });
    if (unitId) q.set("unit", unitId);
    if (source) q.set("source", source);
    if (code) q.set("code", code);
    return this.request<{ suggestions: DraftView["suggestions"] | null }>("GET", `/drafts/suggestions?${q.toString()}`);
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
  releaseExecution(id: string) {
    return this.request<{ ok: boolean; released: boolean; alreadyReleased: boolean }>("POST", `/callings/${encodeURIComponent(id)}/release-execution`, {});
  }
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
    }
  ) {
    return this.request<{ ok: boolean; alreadyRegistered: boolean }>("POST", `/callings/${encodeURIComponent(id)}/group-decision`, input);
  }
  // ---- Ontheffingen (vertrouwelijk; een betrokkene krijgt nooit toegang tot het eigen dossier) ----
  ontheffingen(ringId: string) {
    return this.request<{ ontheffingen: OntheffingListItem[] }>("GET", `/ontheffingen?ring=${encodeURIComponent(ringId)}`);
  }
  ontheffing(id: string) {
    return this.request<OntheffingView>("GET", `/ontheffingen/${encodeURIComponent(id)}`);
  }
  createOntheffing(ringId: string, input: OntheffingConceptInput) {
    return this.request<{ id: string }>("POST", `/ontheffingen?ring=${encodeURIComponent(ringId)}`, input);
  }
  updateOntheffing(id: string, input: OntheffingConceptInput) {
    return this.request<{ ok: boolean }>("POST", `/ontheffingen/${encodeURIComponent(id)}`, input);
  }
  /** Idempotent: herhaald aanroepen (dubbel tikken, netwerkherhaling) maakt nooit een tweede overgang of dubbele meldingen. */
  submitOntheffing(id: string) {
    return this.request<{ id: string; alreadySubmitted: boolean; notificationsDelivered: boolean }>("POST", `/ontheffingen/${encodeURIComponent(id)}/submit`, {});
  }
  deleteOntheffing(id: string) {
    return this.request<{ ok: boolean }>("POST", `/ontheffingen/${encodeURIComponent(id)}/delete`, { confirmed: true });
  }
  voteOntheffing(id: string, support: boolean) {
    return this.request<{ status: string }>("POST", `/ontheffingen/${encodeURIComponent(id)}/vote`, { support });
  }
  /** Expliciete beoordeling van een openstaand dossier (aanhouden); verwijderen gaat via deleteOntheffing. */
  reviewOntheffing(id: string) {
    return this.request<{ ok: boolean }>("POST", `/ontheffingen/${encodeURIComponent(id)}/review`, {});
  }
  releaseOntheffing(id: string) {
    return this.request<{ released: boolean; alreadyReleased: boolean }>("POST", `/ontheffingen/${encodeURIComponent(id)}/release`, {});
  }
  ontheffingDecision(
    id: string,
    input: { stage: "PRESIDIUM" | "HOGERAAD"; decidedOn: string; agreed: boolean; note?: string; presidingUserId?: string; presentUserIds?: string[]; absentUserIds?: string[]; resolveNegative?: boolean; resolutionNote?: string }
  ) {
    return this.request<{ status: string; alreadyRegistered: boolean }>("POST", `/ontheffingen/${encodeURIComponent(id)}/group-decision`, input);
  }
  /** Uitvoering per persoon: persoonlijk informeren, bekendmaking (met eventuele dankbetuiging) en administratief verwerken. */
  ontheffingStep(personId: string, step: "inform" | "announce" | "process" | "rename", body: { thanksOffered?: boolean; name?: string } = {}) {
    return this.request<{ ok?: boolean; dossierProcessed?: boolean }>("POST", `/ontheffingen/persons/${encodeURIComponent(personId)}/${step}`, body);
  }
  // ---- Ringinrichting en catalogus (ringbeheerder: eigen ring) ----
  private ringPath(ringId: string, tail: string) {
    return `/rings/${encodeURIComponent(ringId)}/${tail}`;
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
    return this.request<{ ok: boolean }>("POST", `/units/${encodeURIComponent(id)}`, input);
  }
  customCallings(ringId: string) {
    return this.request<{ callings: CustomCalling[] }>("GET", this.ringPath(ringId, "custom-callings"));
  }
  createCustomCalling(ringId: string, input: { name: string; category: string }) {
    return this.request<{ id: string }>("POST", this.ringPath(ringId, "custom-callings"), input);
  }
  updateCustomCalling(id: string, input: { name?: string; category?: string; active?: boolean }) {
    return this.request<{ ok: boolean }>("POST", `/custom-callings/${encodeURIComponent(id)}`, input);
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
    return this.request<{ sessions: SessionInfo[] }>("GET", "/sessions");
  }
  revokeSession(id: string) {
    return this.request<{ ok: boolean }>("POST", `/sessions/${encodeURIComponent(id)}/revoke`, {});
  }
}

export type DeletionStatus = { id: string; status: string; requestedAt: string; dueAt: string; completedAt: string | null; blockerCount: number };
