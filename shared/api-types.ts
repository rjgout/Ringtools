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
  active: boolean;
  otherRingCount: number;
};

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
  readAt: string | null;
  createdAt: string;
};

export type SessionInfo = { id: string; device: string; createdAt: string; lastSeenAt: string; current: boolean };

export type DeviceInfo = { id: string; platform: "ios" | "android"; active: boolean; lastSeenAt: string };

export type LoginResult = Me & { token: string; expiresAt: string };

export type ApiMeta = { apiVersion: number; minAppVersion: string };

/** Foutvorm van elke API-respons met een foutstatus. */
export type ApiErrorBody = { error: string; code: string | null };
