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
  ontheffingen: { needsMyVote: number; open: number; needsReview: number };
  attention: CallingItem[];
  pendingSupport: CallingItem[];
  myTasks: (CallingItem & { tasks: string[] })[];
};

export type Participant = {
  userId: string;
  name: string;
  support: boolean | null;
  /** Status via een gezamenlijk besluit in een vergadering (geen eigen reactie): akkoord of afwezig. Telt niet als stem. Additief veld. */
  meeting?: "AKKOORD" | "AFWEZIG" | null;
  lastInvitedAt: string;
  stillInvolved: boolean;
};

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
export type RingMemberInfo = { id: string; name: string; role: Role; churchFunction: string; churchFunctionCode: ChurchFunctionCode };

/** Gestructureerde kerkelijke functie (los van de Ringtools-rol; bepaalt welke bevoegdheden mogelijk zijn). ONBEKEND = nog niet vastgelegd: geen bevoegdheden. */
export type ChurchFunctionCode = "ONBEKEND" | "RINGPRESIDENT" | "EERSTE_RAADGEVER" | "TWEEDE_RAADGEVER" | "RINGSECRETARIS" | "RINGADMINISTRATEUR" | "HOGERAADSLID" | "ANDERS";

/** Gebruiker in beheerschermen (alleen voor ringbeheerders van die ring en de webmin). */
export type ManagedUser = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  churchFunction: string;
  churchFunctionCode: ChurchFunctionCode;
  role: Role;
  isRingManager: boolean;
  appointAuthority: AppointAuthority;
  activated: boolean;
  /** Moment van activatie (eerste volledige inlog of geactiveerde uitnodiging); null = nog niet geactiveerd. Additief veld. */
  activatedAt?: string | null;
  /** Meest recente uitnodiging voor dit e-mailadres binnen deze ring (status, verzenddatum, mogelijkheid tot opnieuw versturen). Additief veld. */
  invitation?: UserInvitation | null;
  /** Mag de beheerder een gewone inlogmail laten versturen (actief, bestaand account; geen uitnodiging)? Additief veld. */
  canResendLoginMail?: boolean;
  /** Eerstvolgend moment waarop opnieuw een inlogmail kan worden verstuurd (afkoelperiode); null = nu. Additief veld. */
  loginMailAvailableAt?: string | null;
  active: boolean;
  otherRingCount: number;
};
export type UserInvitation = {
  id: string;
  status: InvitationStatus;
  sentAt: string | null;
  expiresAt: string;
  canResend: boolean;
  canRevoke: boolean;
  resendAvailableAt: string | null;
  resendBlockedReason: "LIMIET" | null;
};

/** Uitnodiging in het gebruikersbeheer. Bevat nooit een token of code. */
/** Antwoord op (opnieuw) versturen. `inProgress`: een andere verzending loopt al; er is niets extra verstuurd. */
export type InvitationSendResult = { id: string; sent: boolean; inProgress?: boolean };
export type InvitationStatus = "NIET_VERSTUURD" | "VERSTUURD" | "VERLOPEN" | "INGETROKKEN" | "GEACTIVEERD";
export type InvitationItem = {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  churchFunction: string;
  churchFunctionCode: ChurchFunctionCode;
  isRingManager: boolean;
  status: InvitationStatus;
  sentAt: string | null;
  expiresAt: string;
  canResend: boolean;
  canRevoke: boolean;
  /** Additief: vroegste moment waarop opnieuw versturen weer mag, en waarom het eventueel niet meer kan. */
  resendAvailableAt?: string | null;
  resendBlockedReason?: "LIMIET" | null;
};
export type InvitationPreview =
  | { valid: true; name: string; ringName: string; roleLabel: string; expiresAt: string }
  | { valid: false; reason: "expired" | "invalid" };
/** Resultaat van een activatie: zonder verplichte MFA direct ingelogd; met verplichte MFA geen sessie (de gebruiker logt daarna in met de bestaande tweede factor). */
export type InvitationActivation =
  | { ok: true; email: string; ringName: string; mfaRequired: boolean; signedIn: false }
  /** Zonder verplichte MFA direct een gewone volledige sessie (zelfde vorm als een login). */
  | ({ ok: true; email: string; ringName: string; mfaRequired: false; signedIn: true } & LoginResult);

export type AppointAuthority = "NONE" | "RINGPRESIDENT" | "AANGEWEZEN_RAADGEVER" | "AANGEWEZEN_HOGERAADSLID";



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

export type ApiMeta = { apiVersion: number; minAppVersion: string; /** Native passkeys zijn op de server ingeschakeld (functievlag). */ nativePasskeys?: boolean; /** Native login met e-mailcode + authenticator-app (functievlag). */ nativeTotpLogin?: boolean; /** Vertrouwde toestellen koppelen (functievlag). */ trustedDevices?: boolean; /** Wachtwoordloos inloggen met een geactiveerd vertrouwd toestel (functievlag, alleen iPhone). */ deviceLogin?: boolean; /** Face ID automatisch aanbieden en inrichten na de eerste volledige aanmelding (functievlag). */ deviceAutoEnroll?: boolean };

/** Antwoord op /auth/login voor een account met verplichte MFA zodra native passkeys zijn ingeschakeld: nog géén sessie. */
export type PendingMfaLogin = { mfaRequired: true; method: "passkey" | "totp"; /** Beschikbare tweede factoren; ontbreekt bij oudere servers (dan alleen passkey). */ methods?: ("passkey" | "totp")[]; pendingToken: string; expiresAt: string };

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
/** Bevoegde Ringtools-leden (functie + zo nodig machtiging). Een externe uitvoerder zonder Ringtools-account staat hier nooit in. */
export type EligibleAppointers = {
  rule: string | null;
  appointers: { id: string; name: string; authority: "RINGPRESIDENT" | "AANGEWEZEN_RAADGEVER" | "AANGEWEZEN_HOGERAADSLID"; basis: string; churchFunction: string }[];
};
export type CustomCalling = { id: string; name: string; category: string; active: boolean; source: "EIGEN" };

// ---- Concepten en nieuwe voorstellen (Fase C3) ----

export type FunctionSource = "STANDAARD" | "EIGEN";
export type DraftData = {
  id: string; ringId: string; personName: string | null; unitId: string | null; functionSource: FunctionSource | "VRIJE_TEKST" | null; functionCode: string | null;
  roepenAssigneeId: string | null; ondersteunenAssigneeId: string | null; aanstellenAssigneeId: string | null;
  roepenExternalName: string | null; aanstellenExternalName: string | null; procedureConfirmed: boolean; submitted: boolean; updatedAt: string;
};
export type DraftSuggestion = {
  userId: string;
  name: string;
  source: "UNIT_STANDAARD" | "UNIT_VERANTWOORDELIJKE" | "FUNCTIE_RINGPRESIDENT" | "FUNCTIE_ENIGE_BEVOEGDE";
  /** Op welke grond de persoon bevoegd is (functie + machtiging); leeg bij ondersteunen (geen bevoegdheidsregel). */
  basis?: string;
} | null;
export type DraftSuggestions = {
  unit: { id: string; name: string; kind: UnitKind; responsibleStatus: "OK" | "VACANT" | "INACTIEF" } | null;
  roepen: DraftSuggestion; ondersteunen: DraftSuggestion; aanstellen: DraftSuggestion;
  notes: { roepen: string | null; aanstellen: string | null };
  eligible: { roepen: { id: string; name: string; basis?: string; churchFunction?: string }[]; aanstellen: { id: string; name: string; basis?: string; churchFunction?: string }[] };
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
  /** Alleen staf: het dossier staat 90 dagen stil en wacht op een expliciete beoordeling. */
  needsReview: boolean;
  updatedAt: string;
};

/** `thanksOffered`: is bij de bekendmaking gelegenheid tot dankbetuiging geboden? (null tot de bekendmaking; niet: is er daadwerkelijk dank uitgesproken). */
export type OntheffingExecution = { informedAt: string | null; announcedAt: string | null; thanksOffered: boolean | null; processedAt: string | null };

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
  activity?: { lastActivityAt: string; reminderSentAt: string | null; needsReview: boolean };
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
