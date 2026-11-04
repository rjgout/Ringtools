/**
 * Gedeeld API-contract van /api/mobile/v1: de server (src/lib/api) en de mobiele client (mobile/src)
 * gebruiken dezelfde types. Wijzig deze types alleen achterwaarts-compatibel of verhoog API_VERSION.
 */
export type Role = "RINGPRESIDIUM" | "RINGSECRETARIS" | "RINGADMINISTRATEUR" | "HOGERAAD";

export type RingInfo = { id: string; name: string; role: Role; churchFunction: string; isRingManager: boolean };

export type Me = {
  user: { id: string; name: string; email: string; emailNotificationsEnabled: boolean; mfaEnabled: boolean };
  rings: RingInfo[];
  pendingCount: number;
};

export type CallingStatus =
  | "PRESIDIUM_VOTING"
  | "PRESIDIUM_PAUSED"
  | "PRESIDIUM_APPROVED"
  | "HOGERAAD_VOTING"
  | "HOGERAAD_PAUSED"
  | "APPROVED"
  | "PROCESSED";

export type CallingItem = {
  id: string;
  ringId: string;
  personName: string;
  functionTitle: string;
  status: CallingStatus;
  phase: string;
  createdAt: string;
  needsMyResponse: boolean;
};

export type Dashboard = {
  ring: { id: string; name: string };
  role: Role;
  isStaff: boolean;
  counts: {
    presidium: number;
    hogeraad: number;
    paused: number;
    approved: number;
    readyToProcess: number;
    roepenOpen: number;
    ondersteunenOpen: number;
    aanstellenOpen: number;
    awaitingRelease: number;
  } | null;
  /** Aantallen voor ontheffingen; volgen dezelfde zichtbaarheid als de lijst (een betrokkene ziet dus nooit een aantal). */
  ontheffingen: { needsMyVote: number; open: number };
  attention: CallingItem[];
  pendingSupport: CallingItem[];
  myTasks: (CallingItem & { tasks: string[] })[];
};

export type Participant = { userId: string; name: string; support: boolean | null; lastInvitedAt: string; stillInvolved: boolean };

export type Round = {
  stage: "PRESIDIUM" | "HOGERAAD";
  title: string;
  state: "open" | "paused" | "done" | "upcoming";
  participants: Participant[];
  canRespond: boolean;
  myResponse: boolean | null;
};

export type TaskKey = "ROEPEN" | "ONDERSTEUNEN" | "AANSTELLEN";

export type TaskView = {
  task: TaskKey;
  label: string;
  assignee: { id: string; name: string } | null;
  /** Handmatig geregistreerde bevoegde externe persoon (alleen roepen/aanstellen). */
  assigneeExternalName: string | null;
  doneAt: string | null;
  doneBy: string | null;
  ondersteunenContext: "AVONDMAALSVERGADERING" | "RINGCONFERENTIE" | null;
  canAssign: boolean;
  canComplete: boolean;
};

/** Vastgelegd gezamenlijk besluit uit een vergadering (geen individuele reacties). Alleen zichtbaar voor ringstaf. */
export type GroupDecisionView = {
  stage: "PRESIDIUM" | "HOGERAAD";
  decidedOn: string;
  registeredBy: string;
  registeredAt: string;
  note: string | null;
  presiding: string | null;
  present: string[];
  absent: string[];
  overrodeNegativeVotes: boolean;
  resolutionNote: string | null;
};

export type CallingDetail = {
  id: string;
  ring: { id: string; name: string };
  personName: string;
  functionTitle: string;
  status: CallingStatus;
  phase: string;
  createdAt: string;
  createdBy: string;
  processedAt: string | null;
  me: { role: Role; isStaff: boolean };
  rounds: Round[];
  tasks: TaskView[];
  readyToProcess: boolean;
  canDelete: boolean;
  assignableUsers: { id: string; name: string; role: Role }[];
  /** Vastgelegd bij indienen (Fase C3); leeg voor voorstellen van vóór C3. */
  function: { source: "STANDAARD" | "EIGEN" | "VRIJE_TEKST" | null; code: string | null; catalogVersion: string | null; ruleStatus: string | null; needsReview: boolean; procedureConfirmed: boolean };
  unit: { name: string; kind: "WIJK" | "GEMEENTE" | null } | null;
  eligibleAssignees: { ROEPEN: string[] | null; AANSTELLEN: string[] | null };
  /** Presidium akkoord; wacht op een expliciete vrijgave aan de hoge raad. */
  awaitingRelease: boolean;
  canRelease: boolean;
  groupDecisions: GroupDecisionView[];
  /** Per fase: mag nu een gezamenlijk besluit worden vastgelegd (open fase, nog geen besluit, ringstaf)? */
  canRegisterGroupDecision: { PRESIDIUM: boolean; HOGERAAD: boolean };
};

/** Actief lid van de eigen ring (alleen zichtbaar voor staf), o.a. om verantwoordelijken te kiezen. */
export type RingMemberInfo = { id: string; name: string; role: Role; churchFunction: string };

/** Gebruiker in beheerschermen (alleen voor ringbeheerders van die ring en de webmin). */
export type ManagedUser = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  churchFunction: string;
  role: Role;
  isRingManager: boolean;
  appointAuthority: AppointAuthority;
  activated: boolean;
  active: boolean;
  otherRingCount: number;
};

export type AppointAuthority = "NONE" | "RINGPRESIDENT" | "AANGEWEZEN_RAADGEVER" | "AANGEWEZEN_HOGERAADSLID";

export type AdminRing = { id: string; name: string; active: boolean; callingCount: number; memberCount: number; managers: string[] };

export type UserSearchHit = { id: string; name: string; email: string };

/** Nieuw sessietoken na herverificatie of voltooide webmin-login. */
export type TokenResult = { token: string; expiresAt: string };

export type RemindResult = { sent: number; skippedRecent: number };

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  callingId: string | null;
  ontheffingId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type SessionInfo = { id: string; device: string; createdAt: string; lastSeenAt: string; current: boolean };

export type DeviceInfo = { id: string; platform: "ios" | "android"; active: boolean; lastSeenAt: string };

export type LoginResult = Me & { token: string; expiresAt: string };

export type ApiMeta = { apiVersion: number; minAppVersion: string };

/** Foutvorm van elke API-respons met een foutstatus. */
export type ApiErrorBody = { error: string; code: string | null };

// ---- Ringinrichting en roepingencatalogus (Fase C2) ----

export type UnitKind = "WIJK" | "GEMEENTE";
export type UnitInfo = {
  id: string;
  kind: UnitKind;
  name: string;
  active: boolean;
  responsibleStatus: "OK" | "VACANT" | "INACTIEF";
  responsible: { id: string; name: string } | null;
  defaults: { roepen: { id: string; name: string } | null; ondersteunen: { id: string; name: string } | null; aanstellen: { id: string; name: string } | null };
};
export type SetupStep = { key: string; label: string; done: boolean; detail: string };
export type RingSetup = { steps: SetupStep[]; complete: boolean };

export type CatalogCalling = {
  /** Standaardroeping: stabiele interne code. Eigen roeping: id van de eigen roeping. */
  code: string;
  source: "STANDAARD" | "EIGEN";
  name: string;
  aliases: string[];
  category: string;
  type: string;
  handbook: string[];
  /** Alleen standaardroepingen; bij eigen roepingen worden nooit bevoegdheden afgeleid. */
  approvalRoute: string | null;
  ringtoolsProcess: boolean;
  extraApproval: string | null;
  grantedBy: string | null;
  appointedBy: string | null;
  supportVenue: string | null;
  appointment: string | null;
  releaseFollowUps: string[];
  warning: string | null;
  reviewNotes: string[];
  active: boolean;
  catalogVersion: string | null;
  /** GEVERIFIEERD | TE_BEOORDELEN | BIJZONDER | EIGEN. Alleen GEVERIFIEERD kent bevoegdheden toe; anders is menselijke controle nodig. */
  ruleStatus: string;
  /** Moet bij gebruik expliciet worden bevestigd dat de bevoegde leiding de procedure heeft gecontroleerd. */
  requiresProcedureConfirmation: boolean;
};
export type CatalogResult = { version: string; categories: string[]; callings: CatalogCalling[] };
export type EligibleAppointers = { rule: string | null; appointers: { id: string; name: string; authority: AppointAuthority }[] };
export type CustomCalling = { id: string; name: string; category: string; active: boolean; source: "EIGEN" };

// ---- Concepten en nieuwe voorstellen (Fase C3) ----

export type FunctionSource = "STANDAARD" | "EIGEN";
export type DraftData = {
  id: string; ringId: string; personName: string | null; unitId: string | null; functionSource: FunctionSource | "VRIJE_TEKST" | null; functionCode: string | null;
  roepenAssigneeId: string | null; ondersteunenAssigneeId: string | null; aanstellenAssigneeId: string | null;
  roepenExternalName: string | null; aanstellenExternalName: string | null; procedureConfirmed: boolean; submitted: boolean; updatedAt: string;
};
export type DraftSuggestion = { userId: string; name: string; source: "UNIT_STANDAARD" | "UNIT_VERANTWOORDELIJKE" } | null;
export type DraftSuggestions = {
  unit: { id: string; name: string; kind: UnitKind; responsibleStatus: "OK" | "VACANT" | "INACTIEF" } | null;
  roepen: DraftSuggestion; ondersteunen: DraftSuggestion; aanstellen: DraftSuggestion;
  notes: { roepen: string | null; aanstellen: string | null };
  eligible: { roepen: { id: string; name: string }[]; aanstellen: { id: string; name: string }[] };
};
export type DraftView = {
  draft: DraftData;
  procedure: { source: FunctionSource; code: string; name: string; category: string; ruleStatus: string; requiresConfirmation: boolean; warning: string; reviewNotes: string[] } | null;
  suggestions: DraftSuggestions;
};
export type DraftListItem = { id: string; personName: string | null; functionCode: string | null; functionSource: string | null; unitName: string | null; updatedAt: string };
export type ReviewOverview = { version: string; total: number; verified: number; items: { code: string; name: string; category: string; status: string; notes: string[] }[] };

// ---- Ontheffingen (Fase C4; vertrouwelijk) ----

export type OntheffingStatus =
  | "CONCEPT" | "PRESIDIUM_VOTING" | "PRESIDIUM_PAUSED" | "PRESIDIUM_APPROVED" | "HOGERAAD_VOTING" | "HOGERAAD_PAUSED" | "APPROVED" | "PROCESSED";
export type FollowUpAnswer = "OPEN" | "NAAM" | "NIET_VAN_TOEPASSING";
export type AccountLinkMode = "ONBEKEND" | "GEKOPPELD" | "GEEN_ACCOUNT";

export type OntheffingListItem = {
  id: string;
  status: OntheffingStatus;
  statusLabel: string;
  personName: string | null;
  functionName: string | null;
  unitName: string | null;
  joint: boolean;
  needsMyVote: boolean;
  updatedAt: string;
};

export type OntheffingExecution = { informedAt: string | null; announcedAt: string | null; thankedAt: string | null; processedAt: string | null };

/** Staf ziet alle velden; een hogeraadslid ziet alleen id, rol, functie en naam. */
export type OntheffingPerson = {
  id: string;
  role: "HOOFD" | "RAADGEVER";
  functionName: string;
  name: string | null;
  followUpCode?: string | null;
  answer?: FollowUpAnswer;
  naReason?: string | null;
  accountMode?: AccountLinkMode;
  userId?: string | null;
  execution?: OntheffingExecution | null;
};

export type RoundSummary = { eligible: number; responded: number; positive: number; negative: number };

export type OntheffingView = {
  id: string;
  ringId: string;
  status: OntheffingStatus;
  statusLabel: string;
  stage: "PRESIDIUM" | "HOGERAAD" | null;
  joint: boolean;
  unit: { name: string; kind: UnitKind | null } | null;
  function: { source: "STANDAARD" | "EIGEN" | null; code: string; name: string | null; ruleStatus: string; warning: string | null } | null;
  persons: OntheffingPerson[];
  viewer: { staff: boolean; canVote: boolean; myVote: boolean | null; canSubmit: boolean; canRelease: boolean; canDecide: boolean; canDelete: boolean };
  // Alleen staf:
  submittedAt?: string | null;
  procedureConfirmed?: boolean;
  requiresConfirmation?: boolean;
  unitId?: string | null;
  followUps?: { code: string; name: string }[];
  rounds?: { presidium: RoundSummary; hogeraad: RoundSummary };
  decisions?: { stage: "PRESIDIUM" | "HOGERAAD"; decidedOn: string; note: string | null; presentCount: number; absentCount: number; overrodeNegativeVotes: boolean }[];
  audit?: { type: string; actor: string; createdAt: string; detail: string | null }[];
  retention?: { deleteAfter: string } | null;
  blockers?: string[];
};

export type OntheffingConceptInput = Partial<{
  unitId: string | null;
  functionSource: "STANDAARD" | "EIGEN" | null;
  functionCode: string | null;
  procedureConfirmed: boolean;
  persons: {
    role: "HOOFD" | "RAADGEVER";
    followUpCode?: string | null;
    answer?: FollowUpAnswer;
    name?: string | null;
    naReason?: string | null;
    accountMode?: AccountLinkMode;
    userId?: string | null;
  }[];
}>;
