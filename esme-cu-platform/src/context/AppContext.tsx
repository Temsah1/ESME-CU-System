import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  User,
  Committee,
  Task,
  TaskSubmission,
  ScoreLedgerEntry,
  RegistrationApplication,
  RegistrationFieldConfig,
  SeasonEvent,
  SkillMatrixEntry,
  SkillRequirement,
  TrainingCourse,
  CourseCompletion,
  DevelopmentGoal,
  DevelopmentFeedback,
  AuditLogItem,
  NotificationItem,
  WebsiteContentConfig,
  MediaAsset,
} from '../types';
import {
  REFERENCE_COMMITTEES,
  REFERENCE_FORM_FIELDS,
  REFERENCE_SEASON_EVENTS,
  REFERENCE_WEBSITE_CONTENT,
} from '../data/referenceContent';
import { readV2, runStorageMigrations, storageVersion, writeV2, type MigrationReport } from '../storage/migrations';
import { useAuth } from '../auth/AuthProvider';
import {
  canActOn,
  hasCapability,
  isPrimaryAdmin,
  scopeFor,
  validateRoleChange,
  type Capability,
  type Role,
} from '../domain/roles';
import type { AccountStatus } from '../domain/accountState';
import { applicationStageFor, repairStoredStatus } from '../domain/accountState';
import type { RegistrationRecord } from '../auth/types';
import { assertTaskMove, canMoveSubmission, checkRevisionFeedback, checkReview, rubricFor, scoreRubric, selfServiceMoves } from '../domain/workflow';
import { appendAuditEntry } from '../domain/audit';
import {
  METRIC_DEFINITIONS,
  decideAppeal,
  validateAppeal,
  type AppealStatus,
  type MetricId,
  type ScoreAppeal,
} from '../domain/metrics';
import {
  DEFAULT_ACTION_PREFS,
  buildActionQueue,
  planNotifications,
  sortQueue,
  visibleTo,
  type ActionItem,
  type ActionPrefs,
  type EmittedKey,
} from '../domain/actions';
import { useEmailPipeline, type EmailPipeline } from '../email/useEmailPipeline';
import { shouldSendLoginAlert, type EmailPayload } from '../domain/email';
import {
  DEFAULT_REWARD_POLICY,
  applyReversal,
  entriesInPeriod,
  escalationRecipients,
  findByIdempotencyKey,
  validatePolicyEdit,
  validateRewardAction,
  RewardRefusedError,
  type RewardEntry,
  type RewardPolicy,
  type WarningSeverity,
} from '../domain/rewards';
import { assertEvidence, currentLevel, levelIndex } from '../domain/development';
import { mergeDirectory } from '../domain/directory';
import { fixtureFor, type TestAccountReport } from '../domain/testAccounts';
import { upgradeContentDocument, validateContentDocument } from '../domain/cms';
import {
  changedPaths,
  publishDraft,
  restoreRevision,
  summarizeChanges,
  normalizeRevisionList,
  unresolvedSlots,
  type ContentRevision,
} from '../domain/publishing';
import {
  addToLibrary,
  bundledAssets,
  decideDelete,
  normalizeAssetList,
  replaceAsset,
  validateUpload,
  type UploadInput,
} from '../domain/media';
import {
  CommitteeOperationProblem,
  CommitteeValidationProblem,
  LEADERSHIP_AUDIT_PREFIX,
  POSITION_LABELS,
  isStaleWrite,
  leaderAccount,
  normalizeCommitteeRow,
  normalizeDraft,
  releaseLeadership,
  releasedSeats,
  validateCommitteeDraft,
  validateLeadershipAssignment,
  validateRosterMove,
  type CommitteeActor,
  type CommitteeInput,
  type LeadershipPosition,
} from '../domain/committees';
import {
  buildSeasonSnapshot,
  rollupObjective,
  type ChapterSeason,
  type KeyResult,
  type Objective,
  type ObjectiveRollup,
  type OkrData,
} from '../domain/seasons';

/**
 * Operational collections start EMPTY.
 *
 * There is no fallback array of fictional members, tasks, submissions, scores,
 * applications, skill assessments, notifications or audit events in this file.
 * A fresh install renders empty states; real records arrive through the
 * authenticated backend once it is configured.
 */
const EMPTY_USERS: User[] = [];
const EMPTY_TASKS: Task[] = [];
const EMPTY_SUBMISSIONS: TaskSubmission[] = [];
const EMPTY_LEDGER: ScoreLedgerEntry[] = [];
const EMPTY_REWARDS: RewardEntry[] = [];
const EMPTY_APPLICATIONS: RegistrationApplication[] = [];
const EMPTY_SKILLS: SkillMatrixEntry[] = [];
const EMPTY_REQUIREMENTS: SkillRequirement[] = [];
const EMPTY_COURSES: TrainingCourse[] = [];
const EMPTY_COMPLETIONS: CourseCompletion[] = [];
const EMPTY_GOALS: DevelopmentGoal[] = [];
const EMPTY_FEEDBACK: DevelopmentFeedback[] = [];
const EMPTY_SEASONS: ChapterSeason[] = [];
const EMPTY_OBJECTIVES: Objective[] = [];
const EMPTY_KEY_RESULTS: KeyResult[] = [];
const EMPTY_SEASON_EVENTS: SeasonEvent[] = [];
const EMPTY_NOTIFICATIONS: NotificationItem[] = [];
const EMPTY_AUDIT: AuditLogItem[] = [];

export class CapabilityError extends Error {
  constructor(capability: Capability) {
    super(`Not permitted: your role does not grant "${capability}".`);
    this.name = 'CapabilityError';
  }
}

/**
 * A stored reward row is dropped unless it carries the parts that make it accountable — who did
 * it, to whom, and the key that keeps a retry from writing a second copy. Repairing a partial row
 * with defaults would invent an actor, which is exactly what a ledger must never do.
 */
function asRewardEntries(rows: unknown): RewardEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is RewardEntry =>
      !!row &&
      typeof (row as RewardEntry).id === 'string' &&
      typeof (row as RewardEntry).idempotencyKey === 'string' &&
      typeof (row as RewardEntry).actorId === 'string' &&
      typeof (row as RewardEntry).targetId === 'string' &&
      ((row as RewardEntry).kind === 'bonus' || (row as RewardEntry).kind === 'warning') &&
      ((row as RewardEntry).status === 'active' || (row as RewardEntry).status === 'reversed')
  );
}

/** An older or partial policy row keeps the defaults it does not override. */
function asRewardPolicy(stored: unknown): RewardPolicy {
  const row = (stored && typeof stored === 'object' ? stored : {}) as Partial<RewardPolicy>;
  return {
    ...DEFAULT_REWARD_POLICY,
    ...row,
    canAwardBonus: Array.isArray(row.canAwardBonus) ? row.canAwardBonus : DEFAULT_REWARD_POLICY.canAwardBonus,
    canIssueWarning: Array.isArray(row.canIssueWarning) ? row.canIssueWarning : DEFAULT_REWARD_POLICY.canIssueWarning,
    notifyRolesOnEscalation: Array.isArray(row.notifyRolesOnEscalation)
      ? row.notifyRolesOnEscalation
      : DEFAULT_REWARD_POLICY.notifyRolesOnEscalation,
  };
}

interface AppContextType {
  /** Signed-in actor, derived from the provider session. Null while signed out. */
  currentUser: User | null;
  authStatus: ReturnType<typeof useAuth>['status'];
  can: (capability: Capability, target?: { id?: string; committeeId?: string }) => boolean;

  users: User[];
  /** Where the directory came from, so a screen can say so out loud instead of implying a server. */
  directory: { from: 'provider' | 'local'; error: string | null; accounts: number };
  refreshDirectory: () => Promise<void>;
  addUser: (
    user: Omit<User, 'id' | 'totalPoints' | 'approvedTasksCount' | 'joinedDate' | 'lastActive' | 'status'>
  ) => void;
  updateUser: (id: string, updates: Partial<User>) => void;
  setAccountStatus: (id: string, status: AccountStatus) => Promise<void>;
  assignRole: (id: string, role: Role) => Promise<void>;
  deleteUser: (id: string) => void;
  /**
   * The three seeded testers. Seeding needs `users.create`, removal needs `users.delete`, and the
   * adapter refuses both outside a development environment whatever this screen says.
   */
  seedTestAccounts: () => Promise<TestAccountReport>;
  removeTestAccounts: () => Promise<TestAccountReport>;

  committees: Committee[];
  /** Every committee write returns the stored row so the caller keeps the current stamp. */
  addCommittee: (committee: CommitteeInput) => Committee;
  updateCommittee: (id: string, updates: Partial<Committee>, expected?: { updatedAt?: string }) => Committee;
  archiveCommittee: (id: string) => void;
  assignLeader: (input: {
    committeeId: string;
    position: LeadershipPosition;
    userId: string | null;
    expectedUpdatedAt?: string;
  }) => Committee;

  tasks: Task[];
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  /** Assignee-driven lifecycle moves; everything else comes from filing or reviewing. */
  moveTask: (id: string, to: Task['status']) => void;
  /** Board-side review moves. Approval is not one of them — see the review centre. */
  reviewTask: (id: string, to: 'under_review' | 'revision_requested' | 'rejected', feedback?: string) => void;

  submissions: TaskSubmission[];
  addSubmission: (submission: Omit<TaskSubmission, 'id' | 'submittedAt' | 'version' | 'status'>) => void;
  reviewSubmission: (
    submissionId: string,
    decision: 'approved' | 'rejected' | 'revision_requested',
    feedback: string,
    awardedPoints?: number,
    rubricMarks?: Record<string, 0 | 1 | 2 | null | undefined>
  ) => void;
  /** The UNDER_REVIEW step of the delivery lifecycle: claims the row without deciding it. */
  startSubmissionReview: (submissionId: string) => void;

  scoreLedger: ScoreLedgerEntry[];
  addManualPointAdjustment: (memberId: string, points: number, reason: string) => void;

  /**
   * Spec G part 5. Bonuses and warnings are one append-only ledger: an entry is never edited and
   * never deleted, a correction is a second entry that points at the first, and the same action
   * submitted twice lands on one record through its idempotency key.
   */
  rewardEntries: RewardEntry[];
  rewardPolicy: RewardPolicy;
  /** `idempotencyKey` is minted when the form opens, so a retried submit cannot write twice. */
  awardBonus: (input: { targetId: string; points: number; reason: string; evidenceUrl?: string; idempotencyKey: string }) => Promise<RewardEntry>;
  issueWarning: (input: { targetId: string; severity: WarningSeverity; reason: string; evidenceUrl?: string; idempotencyKey: string }) => Promise<RewardEntry>;
  reverseRewardEntry: (entryId: string, reason: string) => Promise<RewardEntry>;
  /** Reading a warning back, by its own target. Marks receipt; changes nothing about the entry. */
  acknowledgeWarning: (entryId: string) => Promise<void>;
  updateRewardPolicy: (patch: Partial<RewardPolicy>) => RewardPolicy;

  scoreAppeals: ScoreAppeal[];
  /** A member disputes a figure. Nothing here changes a score — it opens a record for an officer. */
  fileScoreAppeal: (input: { metric: MetricId; periodLabel: string; reason: string }) => void;
  decideScoreAppeal: (id: string, status: Exclude<AppealStatus, 'open'>, note: string) => void;

  applications: RegistrationApplication[];
  /** Where the queue was read from, so the board can say so out loud. */
  registrationQueue: { from: 'provider' | 'local'; error: string | null };
  refreshRegistrationQueue: () => Promise<void>;
  submitApplication: (application: Omit<RegistrationApplication, 'id' | 'appliedDate' | 'status'>) => void;
  updateApplicationStatus: (
    id: string,
    status: RegistrationApplication['status'],
    notes?: string,
    committeeId?: string
  ) => Promise<void>;

  formFields: RegistrationFieldConfig[];
  updateFormFields: (fields: RegistrationFieldConfig[]) => void;

  seasonEvents: SeasonEvent[];
  addSeasonEvent: (event: Omit<SeasonEvent, 'id'>) => void;
  updateSeasonEvent: (id: string, updates: Partial<SeasonEvent>) => void;
  /** Copies the transcribed vision-document milestones in as drafts. Returns how many were new. */
  loadReferenceSeasonPlan: () => number;

  skillMatrix: SkillMatrixEntry[];
  updateMemberSkill: (id: string, updates: Partial<SkillMatrixEntry>) => void;
  addMemberSkill: (entry: Omit<SkillMatrixEntry, 'id'>) => void;

  /** Spec B: development records. Levels come from evidence, never from activity. */
  skillRequirements: SkillRequirement[];
  addSkillRequirement: (entry: Omit<SkillRequirement, 'id'>) => void;
  courses: TrainingCourse[];
  addCourse: (entry: Omit<TrainingCourse, 'id'>) => void;
  courseCompletions: CourseCompletion[];
  recordCourseCompletion: (entry: Omit<CourseCompletion, 'id' | 'recordedBy'>) => void;
  developmentGoals: DevelopmentGoal[];
  addDevelopmentGoal: (entry: Omit<DevelopmentGoal, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'ownerName'>) => void;
  updateDevelopmentGoal: (id: string, updates: Partial<Pick<DevelopmentGoal, 'status' | 'note' | 'dueDate' | 'toLevel'>>) => void;
  developmentFeedback: DevelopmentFeedback[];
  addDevelopmentFeedback: (
    entry: Omit<DevelopmentFeedback, 'id' | 'at' | 'authorId' | 'authorName' | 'authorRole'>
  ) => void;

  /** Spec E/F: dated seasons, and objectives measured against records inside one. */
  seasons: ChapterSeason[];
  addSeason: (entry: Omit<ChapterSeason, 'id' | 'createdAt' | 'snapshot' | 'closedAt'>) => void;
  updateSeason: (id: string, updates: Partial<Pick<ChapterSeason, 'label' | 'theme' | 'handover' | 'startDate' | 'endDate' | 'status'>>) => void;
  /** Freezes the season's own figures. Nothing is recalculated or invented afterwards. */
  closeSeason: (id: string) => void;
  objectives: Objective[];
  addObjective: (entry: Omit<Objective, 'id' | 'createdAt' | 'updatedAt' | 'ownerName'>) => void;
  deleteObjective: (id: string) => void;
  keyResults: KeyResult[];
  addKeyResult: (entry: Omit<KeyResult, 'id'>) => void;
  deleteKeyResult: (id: string) => void;
  /** Deterministic rollups for one season, straight from the records as they stand now. */
  objectiveRollups: (seasonId: string) => ObjectiveRollup[];

  notifications: NotificationItem[];
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;

  /** Outbound mail for this device: the sender actually configured, the queue and its real receipts. */
  email: EmailPipeline;

  /** Reminder settings this account owns: which kinds to hear about and how early. */
  actionPrefs: ActionPrefs;
  setActionPrefs: (prefs: ActionPrefs) => void;
  /** The pending work this account can see, rebuilt from records on every call. */
  actionQueue: () => ActionItem[];
  /** Raises one notification per queue item never raised before. Never sends anything. */
  runActionSweep: () => { emitted: number; suppressed: string[] };

  auditLogs: AuditLogItem[];
  logAction: (action: string, targetType: AuditLogItem['targetType'], targetId: string, details: string) => void;

  websiteContent: WebsiteContentConfig;
  updateWebsiteContent: (updates: Partial<WebsiteContentConfig>) => void;
  /** The document the public page renders, kept apart from the draft an operator is editing. */
  publishedContent: WebsiteContentConfig;
  contentRevisions: ContentRevision[];
  /** Field paths the draft changed against the live page; empty means nothing is waiting to publish. */
  unpublishedChanges: string[];
  publishWebsiteContent: (label?: string) => { revision: ContentRevision; notes: string[]; unresolvedSlots: string[] };
  discardWebsiteDraft: () => { discarded: number };
  restoreContentRevision: (revisionId: string) => { revision: ContentRevision; notes: string[]; unresolvedSlots: string[] };
  /** Bundled pictures plus this device's uploads, in the order a picker lists them. */
  mediaLibrary: MediaAsset[];
  addMediaAsset: (input: UploadInput, details: { id: string; src: string; addedAt?: string }) => MediaAsset;
  replaceMediaAsset: (assetId: string, input: UploadInput, src: string) => MediaAsset;
  deleteMediaAsset: (assetId: string) => void;
  setImageSlot: (slotId: string, assetId: string | null) => void;

  theme: 'light' | 'dark' | 'system';
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;

  resetLocalCache: () => void;
  exportDataJSON: () => string;
  importDataJSON: (jsonStr: string) => boolean;
  storageVersion: string;
  storageMigration: MigrationReport;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 16);

/**
 * A per-browser id and the last sign-in alert sent to this account from it. "Known device" here
 * means this machine, which is what the person can actually judge when they read the alert.
 */
const DEVICE_TOKEN_KEY = 'ESME_CU_DEVICE_TOKEN_V1';
const LOGIN_ALERT_PREFIX = 'ESME_CU_LOGIN_ALERT_V1:';
const LOGIN_ALERT_WINDOW_HOURS = 12;

function deviceToken(): string {
  try {
    const existing = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (existing) return existing;
    const created = `dev_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_TOKEN_KEY, created);
    return created;
  } catch {
    return 'dev_unknown';
  }
}

/**
 * Links an emailed recipient can open. The workspace is one screen that switches its own view,
 * so a deep link names the record in the query rather than pretending to be a route.
 */
const appRoot = () => `${window.location.origin}${window.location.pathname}`;
const recordUrl = (kind: 'task' | 'application', id: string) => `${appRoot()}?open=${kind}:${encodeURIComponent(id)}`;

/**
 * The provider's queue row is the authority for who exists and where their request stands.
 * A locally captured questionnaire only fills fields the provider does not carry.
 */
function applicationFromRecord(record: RegistrationRecord, existing?: RegistrationApplication): RegistrationApplication {
  const base: RegistrationApplication = existing ?? {
    id: `app_${record.id}`,
    fullName: record.fullName,
    universityEmail: record.email,
    studentId: record.studentId ?? '',
    academicYear: record.academicYear ?? '',
    department: record.department ?? '',
    phone: record.phone ?? '',
    committeeMembership: record.committeeMembership,
    preferredCommitteeId: record.committeeId ?? '',
    secondCommitteePreferenceId: record.secondCommitteePreferenceId,
    technicalSkills: record.technicalSkills,
    previousExperience: record.previousExperience,
    motivation: record.motivation,
    availabilityHours: record.availabilityHours,
    agreedToPolicies: record.agreedToPolicies,
    appliedDate: record.submittedAt,
    status: applicationStageFor(record.status),
    authUserId: record.id,
  };
  return {
    ...base,
    fullName: record.fullName,
    universityEmail: record.email,
    status: applicationStageFor(record.status),
    accountStatus: record.status,
    authUserId: record.id,
    appliedDate: base.appliedDate || record.submittedAt,
    rejectionReason: record.rejectionReason ?? base.rejectionReason,
    assignedCommitteeId: record.assignedCommitteeId ?? base.assignedCommitteeId,
    committeeMembership: base.committeeMembership ?? record.committeeMembership,
    reviewedBy: record.decisionBy ?? base.reviewedBy,
    technicalSkills: base.technicalSkills || record.technicalSkills,
    previousExperience: base.previousExperience || record.previousExperience,
    motivation: base.motivation || record.motivation,
    availabilityHours: base.availabilityHours || record.availabilityHours,
  };
}

// One-shot V1 -> V2 -> V3 cleanup, run while this module loads so it precedes the first
// collection read. Idempotent: it writes a version key and returns early once present.
const storageMigration = runStorageMigrations();

/**
 * Reads the cached committee list through the same normalizer the migration uses, so a row
 * written by an older build cannot hand the UI a leader name that the account no longer holds.
 */
function readStoredCommittees(): Committee[] {
  return readV2<unknown[]>('committees', REFERENCE_COMMITTEES)
    .map(normalizeCommitteeRow)
    .filter((row): row is Committee => row !== null);
}

/**
 * Cached workspace records kept beside each account: points, approved-task counts and the
 * questionnaire answers the identity provider does not store. Identity fields are replaced
 * by the directory sync on every load, so a stale cached name cannot outlive the account.
 */
function readStoredUsers(): User[] {
  return readV2<unknown[]>('userProfiles', [])
    .map((row) => (row && typeof row === 'object' ? ({ ...(row as User), status: repairStoredStatus((row as User).status) } as User) : null))
    .filter((u): u is User => Boolean(u && typeof u.id === 'string' && typeof u.email === 'string'));
}

/**
 * The queue keeps a copy of the provider's status beside the stage shown to the board, so a row
 * cached before the verification stage was removed is repaired the same way the directory does.
 */
function readStoredApplications(): RegistrationApplication[] {
  return readV2<unknown[]>('applications', EMPTY_APPLICATIONS).map((row) => {
    const app = row as RegistrationApplication;
    return typeof app?.accountStatus === 'string'
      ? { ...app, accountStatus: repairStoredStatus(app.accountStatus) }
      : app;
  });
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const identity = auth.identity;

  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>(() =>
    readV2<'light' | 'dark' | 'system'>('theme', 'system')
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

  const [users, setUsers] = useState<User[]>(readStoredUsers);
  const [directoryState, setDirectoryState] = useState<{ from: 'provider' | 'local'; error: string | null; accounts: number }>({
    from: 'local',
    error: null,
    accounts: 0,
  });
  const [committees, setCommittees] = useState<Committee[]>(readStoredCommittees);
  const [tasks, setTasks] = useState<Task[]>(() => readV2('tasks', EMPTY_TASKS));
  const [submissions, setSubmissions] = useState<TaskSubmission[]>(() => readV2('submissions', EMPTY_SUBMISSIONS));
  const [scoreLedger, setScoreLedger] = useState<ScoreLedgerEntry[]>(() => readV2('scoreLedger', EMPTY_LEDGER));
  const [rewardEntries, setRewardEntries] = useState<RewardEntry[]>(() => asRewardEntries(readV2('rewardEntries', EMPTY_REWARDS)));
  const [rewardPolicy, setRewardPolicy] = useState<RewardPolicy>(() => asRewardPolicy(readV2('rewardPolicy', DEFAULT_REWARD_POLICY)));
  const [applications, setApplications] = useState<RegistrationApplication[]>(readStoredApplications);
  const [queueSource, setQueueSource] = useState<'provider' | 'local'>('local');
  const [queueError, setQueueError] = useState<string | null>(null);
  const [formFields, setFormFields] = useState<RegistrationFieldConfig[]>(() =>
    readV2('formFields', REFERENCE_FORM_FIELDS)
  );
  // The milestone plan is operational: a fresh workspace has none written yet, so the season
  // progress a home view reports cannot come from a transcribed vision document.
  const [seasonEvents, setSeasonEvents] = useState<SeasonEvent[]>(() =>
    readV2('seasonEvents', EMPTY_SEASON_EVENTS)
  );
  const [skillMatrix, setSkillMatrix] = useState<SkillMatrixEntry[]>(() => readV2('skillMatrix', EMPTY_SKILLS));
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => readV2('notifications', EMPTY_NOTIFICATIONS));
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(() => readV2('auditLogs', EMPTY_AUDIT));
  const [scoreAppeals, setScoreAppeals] = useState<ScoreAppeal[]>(() => readV2('scoreAppeals', []));
  const [actionPrefs, setActionPrefsState] = useState<ActionPrefs>(() => readV2('actionPrefs', DEFAULT_ACTION_PREFS));
  // The raised keys are what makes a second reminder for the same stage impossible.
  const [emittedKeys, setEmittedKeys] = useState<EmittedKey[]>(() => readV2('notificationKeys', []));
  const [skillRequirements, setSkillRequirements] = useState<SkillRequirement[]>(() => readV2('skillRequirements', EMPTY_REQUIREMENTS));
  const [courses, setCourses] = useState<TrainingCourse[]>(() => readV2('courses', EMPTY_COURSES));
  const [courseCompletions, setCourseCompletions] = useState<CourseCompletion[]>(() => readV2('courseCompletions', EMPTY_COMPLETIONS));
  const [developmentGoals, setDevelopmentGoals] = useState<DevelopmentGoal[]>(() => readV2('developmentGoals', EMPTY_GOALS));
  const [developmentFeedback, setDevelopmentFeedback] = useState<DevelopmentFeedback[]>(() => readV2('developmentFeedback', EMPTY_FEEDBACK));
  const [seasons, setSeasons] = useState<ChapterSeason[]>(() => readV2('seasons', EMPTY_SEASONS));
  const [objectives, setObjectives] = useState<Objective[]>(() => readV2('objectives', EMPTY_OBJECTIVES));
  const [keyResults, setKeyResults] = useState<KeyResult[]>(() => readV2('keyResults', EMPTY_KEY_RESULTS));
  // The cached document is read through the same validator the CMS writes with, so a browser
  // holding an older or hand-edited shape still gets a page the site can render — the chapter's
  // reference copy rather than a hero with no words in it.
  const [websiteContent, setWebsiteContent] = useState<WebsiteContentConfig>(() => {
    const cached = readV2<unknown>('websiteContent', null);
    if (cached === null) return REFERENCE_WEBSITE_CONTENT;
    const { doc, recognized } = upgradeContentDocument(cached, REFERENCE_WEBSITE_CONTENT);
    return recognized ? doc : REFERENCE_WEBSITE_CONTENT;
  });
  // The page the public site renders. Kept apart from the draft so "preview before publishing"
  // and "roll back" mean something, and so an unfinished edit is never what a visitor sees.
  const [publishedContent, setPublishedContent] = useState<WebsiteContentConfig>(() => {
    const cached = readV2<unknown>('publishedContent', null);
    if (cached === null) return REFERENCE_WEBSITE_CONTENT;
    const { doc, recognized } = upgradeContentDocument(cached, REFERENCE_WEBSITE_CONTENT);
    return recognized ? doc : REFERENCE_WEBSITE_CONTENT;
  });
  const [contentRevisions, setContentRevisions] = useState<ContentRevision[]>(() =>
    normalizeRevisionList(readV2<unknown>('contentRevisions', []))
  );
  // Uploads this device holds. Bundled assets are never stored here: they ship with the build.
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(() => normalizeAssetList(readV2<unknown>('mediaAssets', [])));

  // Reference content is cached locally; the CMS publish path is what makes it authoritative.
  useEffect(() => writeV2('committees', committees), [committees]);
  // A seat points at an account id, so the workspace records behind those ids must outlive
  // the tab too: an assignment to someone whose profile was memory-only became a dangling
  // reference the next morning.
  useEffect(() => writeV2('userProfiles', users), [users]);
  useEffect(() => writeV2('formFields', formFields), [formFields]);
  useEffect(() => writeV2('seasonEvents', seasonEvents), [seasonEvents]);
  useEffect(() => writeV2('websiteContent', websiteContent), [websiteContent]);
  // A published page and the history behind it are records, not view state: an operator who
  // publishes at midnight and reloads must not find the live page back to its shipped copy.
  useEffect(() => writeV2('publishedContent', publishedContent), [publishedContent]);
  useEffect(() => writeV2('contentRevisions', contentRevisions), [contentRevisions]);
  useEffect(() => writeV2('mediaAssets', mediaAssets), [mediaAssets]);
  useEffect(() => writeV2('theme', theme), [theme]);
  // Operational records must survive a reload. Work assigned yesterday, a submission reviewed
  // yesterday and a score recorded yesterday are not drafts to be lost on refresh — and a
  // queue that empties itself looks exactly like work nobody did.
  useEffect(() => writeV2('tasks', tasks), [tasks]);
  useEffect(() => writeV2('submissions', submissions), [submissions]);
  useEffect(() => writeV2('scoreLedger', scoreLedger), [scoreLedger]);
  // A recognition or a warning that vanishes on reload was never a record. The ledger and the
  // policy that limits it both have to outlive the tab.
  useEffect(() => writeV2('rewardEntries', rewardEntries), [rewardEntries]);
  useEffect(() => writeV2('rewardPolicy', rewardPolicy), [rewardPolicy]);
  useEffect(() => writeV2('applications', applications), [applications]);
  useEffect(() => writeV2('skillMatrix', skillMatrix), [skillMatrix]);
  // Audit entries survive a reload: an accountability record that lives only until F5 is not one.
  useEffect(() => writeV2('auditLogs', auditLogs), [auditLogs]);
  // A dispute lodged yesterday must still be answerable tomorrow.
  useEffect(() => writeV2('scoreAppeals', scoreAppeals), [scoreAppeals]);
  // Notification history and the raised-key registry outlive the tab, or a reminder repeats daily.
  useEffect(() => writeV2('notifications', notifications), [notifications]);
  useEffect(() => writeV2('notificationKeys', emittedKeys), [emittedKeys]);
  useEffect(() => writeV2('actionPrefs', actionPrefs), [actionPrefs]);
  // Development records are the assessor's written history; losing them on reload would
  // erase the evidence that supports every level on the matrix.
  useEffect(() => writeV2('skillRequirements', skillRequirements), [skillRequirements]);
  useEffect(() => writeV2('courses', courses), [courses]);
  useEffect(() => writeV2('courseCompletions', courseCompletions), [courseCompletions]);
  useEffect(() => writeV2('developmentGoals', developmentGoals), [developmentGoals]);
  useEffect(() => writeV2('developmentFeedback', developmentFeedback), [developmentFeedback]);
  // A season is a promise made on a date; the objectives written against it must outlive the tab.
  useEffect(() => writeV2('seasons', seasons), [seasons]);
  useEffect(() => writeV2('objectives', objectives), [objectives]);
  useEffect(() => writeV2('keyResults', keyResults), [keyResults]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Theme applies to <html>, so the public site, dashboard, dialogs and charts all follow it.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const currentUser = useMemo<User | null>(() => {
    if (!identity) return null;
    const profile = users.find((u) => u.id === identity.id);
    return {
      id: identity.id,
      name: identity.displayName,
      email: identity.email,
      username: identity.username,
      role: identity.role,
      status: identity.status,
      committeeId: identity.committeeId,
      subTeam: profile?.subTeam,
      academicYear: profile?.academicYear,
      department: profile?.department,
      studentId: profile?.studentId,
      phone: profile?.phone,
      avatar: profile?.avatar,
      totalPoints: profile?.totalPoints ?? 0,
      approvedTasksCount: profile?.approvedTasksCount ?? 0,
      joinedDate: profile?.joinedDate ?? '—',
      lastActive: profile?.lastActive ?? 'Just now',
    } as User;
  }, [identity, users]);

  const can = (capability: Capability, target?: { id?: string; committeeId?: string }) => {
    if (!currentUser) return false;
    if (!hasCapability(currentUser.role, capability)) return false;
    return canActOn(currentUser, capability, target ?? {});
  };

  const guard = (capability: Capability, target?: { id?: string; committeeId?: string }) => {
    if (!can(capability, target)) throw new CapabilityError(capability);
  };

  const logAction = (
    action: string,
    targetType: AuditLogItem['targetType'],
    targetId: string,
    details: string,
    evidence?: Pick<AuditLogItem, 'outcome' | 'previousRole' | 'newRole' | 'reason'>
  ) => {
    if (!currentUser) return;
    const entry: AuditLogItem = {
      id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      actorId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action,
      targetType,
      targetId,
      details,
      timestamp: stamp(),
      ...evidence,
    };
    setAuditLogs((prev) => appendAuditEntry(prev, entry));
  };

  /**
   * A refused privilege change is evidence, not noise: who asked, against which account, and why it
   * was turned down. Without it an attempt that never reached a row would leave no trace at all, and
   * a trail that only records successes cannot show that a guard was ever tested.
   */
  const logRefusal = (
    action: string,
    targetId: string,
    reason: string,
    roles?: { previousRole: Role; newRole: Role }
  ) => {
    logAction(action, 'user', targetId, `Refused: ${reason}`, {
      outcome: 'denied',
      reason,
      ...(roles ? { previousRole: roles.previousRole, newRole: roles.newRole } : {}),
    });
  };

  const email = useEmailPipeline(currentUser?.id, auth.adapter);

  /**
   * The three faces of one event: the in-app notice, the email request and the audit line. They
   * are written together so an event cannot show up in one and be missing from the others.
   *
   * With the Supabase adapter configured, the browser stops at the notice. The database trigger on
   * the authoritative write enqueues that message, and a browser request beside it would be a
   * second email to the same person for the same record.
   */
  const announce = (input: {
    payload: EmailPayload;
    recipientId: string;
    recipientName: string;
    recipientEmail?: string;
    /** The record this message reports on. Two calls with the same record are one email. */
    ref: string;
    title: string;
    message: string;
    type: NotificationItem['type'];
    link?: string;
  }): { emailed: boolean; outcome: string } => {
    const id = `not_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setNotifications((prev) =>
      [
        {
          id,
          title: input.title,
          message: input.message,
          type: input.type,
          timestamp: stamp(),
          read: false,
          link: input.link,
          delivery: 'in_app' as const,
        },
        ...prev,
      ].slice(0, 200)
    );

    if (auth.adapter?.kind === 'supabase') {
      logAction('Recorded Member Event', 'system', input.ref, `${input.payload.event} for ${input.recipientName} — queued by the server on the same write`);
      return { emailed: false, outcome: 'server' };
    }
    if (!input.recipientEmail) {
      logAction('Recorded Member Event', 'system', input.ref, `${input.payload.event} for ${input.recipientName} — no email address on the record, so nothing was queued`);
      return { emailed: false, outcome: 'no-address' };
    }

    const result = email.notify({
      payload: input.payload,
      recipientId: input.recipientId,
      to: input.recipientEmail,
      ref: input.ref,
    });
    const outcome = result.queued ? 'queued' : result.reason;
    logAction(
      'Queued Member Email',
      'system',
      input.ref,
      `${input.payload.event} for ${input.recipientName} — ${outcome}`
    );
    return { emailed: result.queued, outcome };
  };

  /** One notice per person added to a task, keyed by task and member so an edit cannot resend. */
  const announceTaskAssignment = (task: Task, memberIds: string[]) => {
    const assigned = memberIds
      .map((memberId) => users.find((u) => u.id === memberId))
      .filter((u): u is User => Boolean(u));
    const memberNames = assigned.map((u) => u.name).join(', ');
    for (const member of assigned) {
      announce({
        payload: {
          event: 'task_assigned',
          fullName: member.name,
          taskTitle: task.title,
          deadline: task.deadline,
          points: task.points,
          taskUrl: recordUrl('task', task.id),
          leaderName: currentUser?.name ?? 'the chapter',
        },
        recipientId: member.id,
        recipientName: member.name,
        recipientEmail: member.email,
        ref: `${task.id}:${member.id}`,
        title: 'Task assigned',
        message: `${member.name} was sent "${task.title}", due ${task.deadline}.`,
        type: 'info',
        link: 'tasks',
      });
    }

    // A Head's assignment is visible to the committee's Director. Nobody is mailed about their
    // own action, so an actor who holds both seats is skipped.
    if (currentUser?.role !== 'head') return;
    const director = users.find((u) => u.id === committees.find((c) => c.id === task.committeeId)?.directorId);
    if (!director || director.id === currentUser.id) return;
    announce({
      payload: {
        event: 'task_assigned_to_team',
        supervisorName: director.name,
        assigneeName: memberNames,
        taskTitle: task.title,
        deadline: task.deadline,
        leaderName: currentUser.name,
        taskUrl: recordUrl('task', task.id),
      },
      recipientId: director.id,
      recipientName: director.name,
      recipientEmail: director.email,
      ref: `${task.id}:supervisor`,
      title: 'Task assigned in your committee',
      message: `${currentUser.name} assigned "${task.title}" to ${memberNames}, due ${task.deadline}.`,
      type: 'info',
      link: 'tasks',
    });
  };

  // One sign-in alert per account per device per window. Reloading an existing session is not a
  // new sign-in, so the timestamp this writes is what keeps the alert honest.
  const announceRef = useRef(announce);
  const adapterRef = useRef(auth.adapter);
  useEffect(() => {
    announceRef.current = announce;
    adapterRef.current = auth.adapter;
  });

  useEffect(() => {
    if (!identity) return;
    const marker = `${identity.id}:${deviceToken()}`;
    const now = new Date().toISOString();
    const lastSentAt = (() => {
      try {
        return localStorage.getItem(LOGIN_ALERT_PREFIX + marker) ?? undefined;
      } catch {
        return undefined;
      }
    })();
    if (
      !shouldSendLoginAlert({
        knownDevice: Boolean(lastSentAt),
        lastSentAt,
        now,
        windowHours: LOGIN_ALERT_WINDOW_HOURS,
      })
    ) {
      return;
    }
    try {
      localStorage.setItem(LOGIN_ALERT_PREFIX + marker, now);
    } catch {
      // Storage refused: reporting anyway, since a silent sign-in alert is worse than a repeat one.
    }
    // With a real provider the database raises the email: it re-reads the address and applies
    // the same window from its own delivery log, so clearing a browser cache neither silences
    // an alert nor doubles it. The call below only reports that a session opened.
    if (adapterRef.current?.kind === 'supabase') {
      void adapterRef.current.reportSignIn({ device: navigator.userAgent.slice(0, 200), occurredAt: now });
    }
    announceRef.current({
      payload: {
        event: 'login_security_alert',
        fullName: identity.displayName,
        occurredAt: now,
        device: navigator.userAgent.slice(0, 120),
        wasNotYouUrl: appRoot(),
      },
      recipientId: identity.id,
      recipientName: identity.displayName,
      recipientEmail: identity.email,
      ref: `${marker}:${Math.floor(Date.now() / (LOGIN_ALERT_WINDOW_HOURS * 3_600_000))}`,
      title: 'New sign-in recorded',
      message: `${identity.displayName} was emailed the details of a sign-in from a new device.`,
      type: 'info',
    });
  }, [identity]);

  /**
   * A member's tasks.write is scoped to rows they are on, so the target must name the
   * member; passing only a committee would let any member edit anyone's task.
   */  const guardTaskWrite = (task: Task) => {
    if (!currentUser) throw new CapabilityError('tasks.write');
    if (scopeFor(currentUser.role, 'tasks.write') === 'self' && !task.assigneeIds.includes(currentUser.id)) {
      throw new CapabilityError('tasks.write');
    }
    guard('tasks.write', { id: currentUser.id, committeeId: task.committeeId });
  };

  const moveTask: AppContextType['moveTask'] = (id, to) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error('That task is not in this workspace.');
    guardTaskWrite(task);
    const allowed = selfServiceMoves(task.status);
    if (!allowed.includes(to)) {
      throw new Error(
        allowed.length
          ? `From ${task.status.replace(/_/g, ' ')} you may only move this task to ${allowed.join(' or ')}.`
          : `${task.title} is closed — its status is not changed from the board.`
      );
    }
    assertTaskMove(task.status, to);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: to } : t)));
    logAction(
      'Moved Task',
      'task',
      id,
      `${currentUser?.name ?? 'An assignee'}: ${task.title} moved ${task.status.replace(/_/g, ' ')} to ${to.replace(/_/g, ' ')}`
    );
  };

  /**
   * Claiming, returning or rejecting work from the board. Approval is deliberately absent:
   * it is recorded only in the review center, where the rubric and the independent-reviewer
   * check run, so a board shortcut cannot mint an approval with no quality basis.
   */
  const reviewTask: AppContextType['reviewTask'] = (id, to, feedback) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error('That task is not in this workspace.');
    if (!currentUser) throw new CapabilityError('submissions.review');
    if (task.status !== 'submitted' && task.status !== 'under_review') {
      throw new Error(`Only work that has been filed is reviewed; ${task.title} is ${task.status.replace(/_/g, ' ')}.`);
    }
    guard('submissions.review', { committeeId: task.committeeId });
    if (to === 'revision_requested') {
      const note = checkRevisionFeedback(feedback);
      if (!note.allowed) throw new Error(note.reason);
    }
    assertTaskMove(task.status, to);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: to } : t)));
    logAction(
      'Reviewed Task',
      'task',
      id,
      `${currentUser.name}: ${task.title} ${to.replace(/_/g, ' ')}${feedback?.trim() ? ` — ${feedback.trim()}` : ''}`
    );
  };

  const addUser: AppContextType['addUser'] = (userData) => {
    guard('users.create');
    // The directory already holds every account this actor can see, so a second row for
    // the same person is refused here rather than discovered when two seats point at two
    // ids for one member.
    const email = userData.email.trim().toLowerCase();
    const username = userData.username.trim().toLowerCase();
    if (users.some((u) => u.email.trim().toLowerCase() === email)) {
      throw new Error(`An account for ${userData.email} is already in the directory. Assign that account instead of creating a second one.`);
    }
    if (username && users.some((u) => u.username.trim().toLowerCase() === username)) {
      throw new Error(`An account already uses the username “${userData.username}”. Assign that account instead of creating a second one.`);
    }
    const newUser: User = {
      ...userData,
      id: `usr_${Date.now()}`,
      // A provisioned account still starts unapproved; activation is an explicit decision.
      status: 'pending_approval',
      totalPoints: 0,
      approvedTasksCount: 0,
      joinedDate: new Date().toISOString().split('T')[0],
      lastActive: 'Never signed in',
    };
    setUsers((prev) => [newUser, ...prev]);
    logAction('Provisioned User', 'user', newUser.id, `Created profile for ${newUser.name} as ${newUser.role}`);
  };

  const updateUser: AppContextType['updateUser'] = (id, updates) => {
    const target = users.find((u) => u.id === id);
    // Role, status and score totals never travel through a profile edit.
    const { role: _role, status: _status, totalPoints: _points, approvedTasksCount: _count, ...safe } = updates;
    // The strip is the defence, and the attempt is the evidence: an injected privileged field is
    // recorded before the guard runs, because the case worth seeing is a member editing their own
    // profile and adding `role` to the body — which needs no capability to attempt.
    if (target) {
      const attempted: string[] = [];
      if (_role !== undefined && _role !== target.role) attempted.push(`role ${target.role} → ${_role}`);
      if (_status !== undefined && _status !== target.status) attempted.push(`status ${target.status} → ${_status}`);
      if (_points !== undefined && _points !== target.totalPoints) attempted.push(`score total → ${_points}`);
      if (_count !== undefined && _count !== target.approvedTasksCount) attempted.push(`approved count → ${_count}`);
      if (attempted.length > 0) {
        logRefusal(
          'Protected Field Write Refused',
          id,
          `A profile edit cannot set ${attempted.join(', ')}.`,
          _role !== undefined && _role !== target.role ? { previousRole: target.role, newRole: _role } : undefined
        );
      }
    }
    if (id !== currentUser?.id) guard('users.update', { committeeId: target?.committeeId });
    // Moving a member between committees is a roster change, so it obeys the seat rules too.
    if (safe.committeeId !== undefined && safe.committeeId !== target?.committeeId && currentUser) {
      const verdict = validateRosterMove({
        committees,
        users,
        userId: id,
        toCommitteeId: safe.committeeId || null,
        actor: committeeActor(),
      });
      if (!verdict.allowed) throw new CommitteeOperationProblem(verdict.code, verdict.reason);
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...safe } : u)));
    logAction('Updated User Profile', 'user', id, `Modified fields: ${Object.keys(safe).join(', ') || 'none'}`);
  };

  const setAccountStatus: AppContextType['setAccountStatus'] = async (id, status) => {
    const target = users.find((u) => u.id === id);
    try {
      guard('users.suspend', { committeeId: target?.committeeId });
    } catch (error) {
      logRefusal('Account Status Change Refused', id, error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (!target) return;
    if (target.email === identity?.email && status !== 'active') {
      const reason = 'You cannot lock your own account.';
      logRefusal('Account Status Change Refused', id, reason);
      throw new Error(reason);
    }
    const result = auth.adapter ? await auth.adapter.setAccountStatus(id, status) : { ok: true as const };
    if (!result.ok) {
      logRefusal('Account Status Change Refused', id, result.error.message);
      throw new Error(result.error.message);
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status } : u)));
    logAction(
      `Account ${status.replace(/_/g, ' ')}`,
      'user',
      id,
      `${target.name}: ${target.status} → ${status}`,
      { outcome: 'allowed', reason: `Status moved from ${target.status} to ${status}` }
    );
  };

  /** Role grants never ride on a profile edit — they are their own privileged operation. */
  const assignRole: AppContextType['assignRole'] = async (id, role) => {
    const target = users.find((u) => u.id === id);
    if (!target || !currentUser) throw new Error('Member not found.');
    const roles = { previousRole: target.role, newRole: role };
    try {
      guard('users.role.assign', { committeeId: target.committeeId });
    } catch (error) {
      logRefusal('Role Change Refused', id, error instanceof Error ? error.message : String(error), roles);
      throw error;
    }
    const verdict = validateRoleChange(currentUser, target, role, isPrimaryAdmin(target));
    if (!verdict.allowed) {
      logRefusal('Role Change Refused', id, verdict.reason, roles);
      throw new Error(verdict.reason);
    }
    const result = auth.adapter ? await auth.adapter.assignRole(id, role) : { ok: true as const };
    if (!result.ok) {
      logRefusal('Role Change Refused', id, result.error.message, roles);
      throw new Error(result.error.message);
    }
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
    logAction(`Role set to ${role.replace(/_/g, ' ')}`, 'user', id, `${target.name}: ${target.role} → ${role}`, {
      outcome: 'allowed',
      previousRole: target.role,
      newRole: role,
    });
  };

  const deleteUser: AppContextType['deleteUser'] = (id) => {
    const target = users.find((u) => u.id === id);
    guard('users.delete', { committeeId: target?.committeeId });
    if (!target) return;
    if (target.role === 'super_admin') throw new Error('A Super Admin account cannot be deleted here.');
    // The account goes; the seat does not stay pointed at it. Nothing else about the
    // committee — name, description, objectives, sub-teams — is touched by a departure.
    const seats = releasedSeats(committees, id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
    if (seats.length > 0) {
      setCommittees((prev) => releaseLeadership(prev, id));
    }
    logAction(
      'Deleted User',
      'user',
      id,
      `Removed user ${target.name}${seats.length > 0 ? ` and vacated ${seats.map((s) => POSITION_LABELS[s.position]).join(', ')} seat(s)` : ''}`
    );
  };

  /**
   * Seeding is a provider write, not a state edit: the adapter decides whether the environment
   * allows it, and this store only records what came back. A refusal is returned to the screen
   * unfilled — an audit line for an action that did not happen would be a lie.
   */
  const seedTestAccounts: AppContextType['seedTestAccounts'] = async () => {
    guard('users.create');
    if (!auth.adapter) throw new Error('No authentication provider is configured.');
    const report = await auth.adapter.seedTestAccounts({
      committees: committees.map((c) => ({ id: c.id, shortCode: c.shortCode, name: c.name })),
    });
    if (report.refusal) return report;
    await refreshDirectory();
    logAction(
      'Seeded Test Accounts',
      'system',
      'test_accounts',
      `${report.created.length} created, ${report.repaired.length} repaired` +
        (report.conflicts.length > 0 ? `, ${report.conflicts.length} refused as somebody else's identity` : '') +
        (report.unresolvedCommittees.length > 0 ? `, unseated in ${report.unresolvedCommittees.join(', ')}` : '') +
        '. No password is recorded here.'
    );
    return report;
  };

  const removeTestAccounts: AppContextType['removeTestAccounts'] = async () => {
    guard('users.delete');
    if (!auth.adapter) throw new Error('No authentication provider is configured.');
    const report = await auth.adapter.removeTestAccounts();
    if (report.refusal) return report;
    // The directory keeps a row the provider no longer returns, so the removed testers are dropped
    // from this workspace's copy as well — and any seat they held is vacated the way a deletion does.
    const doomed = users.filter((u) => fixtureFor(u) !== undefined);
    if (doomed.length > 0) {
      setUsers((prev) => prev.filter((u) => fixtureFor(u) === undefined));
      for (const tester of doomed) {
        if (releasedSeats(committees, tester.id).length > 0) {
          setCommittees((prev) => releaseLeadership(prev, tester.id));
        }
      }
    }
    logAction(
      'Removed Test Accounts',
      'system',
      'test_accounts',
      `Deleted ${report.removed.length} seeded account(s): ${report.removed.join(', ') || 'none'}`
    );
    return report;
  };

  /** The account the committee rules act through. Never taken from a form field. */
  const committeeActor = (): CommitteeActor => {
    if (!currentUser) throw new CapabilityError('committees.write');
    return { role: currentUser.role, id: currentUser.id, committeeId: currentUser.committeeId };
  };

  const staleMessage = (name: string) =>
    `${name} was changed elsewhere while this form was open, so this write was refused rather than applied over it. Reload the row and make the change again.`;

  const addCommittee: AppContextType['addCommittee'] = (committeeInput) => {
    const actor = committeeActor();
    guard('committees.write');
    const draft = normalizeDraft(committeeInput);
    const issues = validateCommitteeDraft(draft, committees);
    if (issues.length > 0) throw new CommitteeValidationProblem(issues);

    const newCommittee: Committee = {
      ...draft,
      id: `comm_${Date.now()}`,
      directorId: draft.directorId || undefined,
      headId: draft.headId || undefined,
      updatedAt: stamp(),
    };

    // Appointments are validated against the list that will contain the new row, so a
    // creation cannot smuggle in a leader who already holds a seat somewhere else.
    const prospective = [...committees, newCommittee];
    for (const position of ['director', 'head'] as const) {
      const userId = position === 'director' ? newCommittee.directorId : newCommittee.headId;
      if (!userId) continue;
      const verdict = validateLeadershipAssignment({ committees: prospective, users, committeeId: newCommittee.id, position, userId, actor });
      if (!verdict.allowed) throw new CommitteeOperationProblem(verdict.code, verdict.reason);
    }

    setCommittees((prev) => [...prev, newCommittee]);
    const seated = (['director', 'head'] as const)
      .map((position) => {
        const account = leaderAccount(newCommittee, position, users);
        return account ? `${POSITION_LABELS[position]} ${account.name}` : null;
      })
      .filter(Boolean);
    logAction(
      'Created Committee',
      'committee',
      newCommittee.id,
      `${newCommittee.name} (${newCommittee.shortCode}) created${seated.length ? ` with ${seated.join(' and ')}` : ', no leadership seat filled'}`
    );
    return newCommittee;
  };

  /**
   * Field content only. The two seats are deliberately not accepted here: leadership moves
   * through `assignLeader`, which runs the eligibility rules and writes its own audit line, so
   * a routine text edit can never overwrite a seat as a side effect.
   */
  const updateCommittee: AppContextType['updateCommittee'] = (id, updates, expected) => {
    const current = committees.find((c) => c.id === id);
    if (!current) throw new CommitteeOperationProblem('no_committee', 'That committee does not exist.');
    guard('committees.write', { committeeId: id });
    if (isStaleWrite(current, expected?.updatedAt)) throw new CommitteeOperationProblem('stale', staleMessage(current.name));

    const { directorId: _directorId, headId: _headId, memberCount: _memberCount, updatedAt: _updatedAt, id: _id, ...rest } = updates;
    const draft = normalizeDraft({ ...current, ...rest });
    const issues = validateCommitteeDraft(draft, committees, id);
    if (issues.length > 0) throw new CommitteeValidationProblem(issues);

    const next: Committee = { ...draft, id: current.id, memberCount: current.memberCount, directorId: current.directorId, headId: current.headId, updatedAt: stamp() };
    const changed = Object.keys(rest).filter((key) => JSON.stringify(current[key as keyof Committee]) !== JSON.stringify(next[key as keyof Committee]));

    setCommittees((prev) => prev.map((c) => (c.id === id ? next : c)));
    logAction('Updated Committee', 'committee', id, `${next.name}: ${changed.length ? `changed ${changed.join(', ')}` : 'saved with no field change'}`);
    return next;
  };

  const archiveCommittee: AppContextType['archiveCommittee'] = (id) => {
    const current = committees.find((c) => c.id === id);
    if (!current) throw new CommitteeOperationProblem('no_committee', 'That committee does not exist.');
    guard('committees.archive', { committeeId: id });
    const next: Committee = { ...current, status: 'archived', updatedAt: stamp() };
    setCommittees((prev) => prev.map((c) => (c.id === id ? next : c)));
    // The seat is kept: an archived committee is history, and history names its office-holders.
    logAction('Archived Committee', 'committee', id, `${current.name} archived; its records and assignments are retained`);
  };

  const assignLeader: AppContextType['assignLeader'] = ({ committeeId, position, userId, expectedUpdatedAt }) => {
    const actor = committeeActor();
    const current = committees.find((c) => c.id === committeeId);
    if (!current) throw new CommitteeOperationProblem('no_committee', 'That committee does not exist.');
    if (isStaleWrite(current, expectedUpdatedAt)) throw new CommitteeOperationProblem('stale', staleMessage(current.name));

    const verdict = validateLeadershipAssignment({ committees, users, committeeId, position, userId, actor });
    if (!verdict.allowed) throw new CommitteeOperationProblem(verdict.code, verdict.reason);

    const account = userId ? users.find((u) => u.id === userId) ?? null : null;
    const previous = leaderAccount(current, position, users);
    const next: Committee = {
      ...current,
      directorId: position === 'director' ? userId ?? undefined : current.directorId,
      headId: position === 'head' ? userId ?? undefined : current.headId,
      updatedAt: stamp(),
    };

    setCommittees((prev) => prev.map((c) => (c.id === committeeId ? next : c)));
    logAction(
      `${LEADERSHIP_AUDIT_PREFIX} ${userId ? 'Assigned' : 'Cleared'}`,
      'committee',
      committeeId,
      `${POSITION_LABELS[position]} of ${current.name}: ${previous?.name ?? 'unassigned'} → ${account?.name ?? 'unassigned'}${verdict.warning ? ` — ${verdict.warning}` : ''}`
    );
    return next;
  };

  const addTask: AppContextType['addTask'] = (taskData) => {
    guard('tasks.write', { committeeId: taskData.committeeId });
    const newTask: Task = {
      ...taskData,
      id: `task_${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0],
    };
    setTasks((prev) => [newTask, ...prev]);
    logAction('Created Task', 'task', newTask.id, `Created task: ${newTask.title}`);
    announceTaskAssignment(newTask, newTask.assigneeIds);
  };

  const updateTask: AppContextType['updateTask'] = (id, updates) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error('That task is not in this workspace.');
    guardTaskWrite(task);
    if (updates.status && updates.status !== task.status) assertTaskMove(task.status, updates.status);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    logAction('Updated Task', 'task', id, `${currentUser?.name ?? 'Someone'} edited ${task.title}`);
    const added = (updates.assigneeIds ?? []).filter((memberId) => !task.assigneeIds.includes(memberId));
    if (added.length > 0) announceTaskAssignment({ ...task, ...updates }, added);
  };

  const deleteTask: AppContextType['deleteTask'] = (id) => {
    const task = tasks.find((t) => t.id === id);
    guard('tasks.delete', { committeeId: task?.committeeId });
    setTasks((prev) => prev.filter((t) => t.id !== id));
    logAction('Deleted Task', 'task', id, 'Removed task');
  };

  const addSubmission: AppContextType['addSubmission'] = (subData) => {
    if (!currentUser) throw new CapabilityError('submissions.create');
    guard('submissions.create', { id: currentUser.id });
    const task = tasks.find((t) => t.id === subData.taskId);
    if (!task) throw new Error('That deliverable names a task this workspace does not hold.');
    assertTaskMove(task.status, 'submitted');
    const version = submissions.filter((s) => s.taskId === subData.taskId && s.memberId === currentUser.id).length + 1;
    const newSub: TaskSubmission = {
      ...subData,
      memberId: currentUser.id,
      memberName: currentUser.name,
      id: `sub_${Date.now()}`,
      submittedAt: stamp(),
      version,
      status: 'submitted',
    };
    setSubmissions((prev) => [newSub, ...prev]);
    setTasks((prev) => prev.map((t) => (t.id === subData.taskId ? { ...t, status: 'submitted' } : t)));
    logAction(
      'Submitted Task Deliverables',
      'submission',
      newSub.id,
      `${currentUser.name} submitted v${version} for ${task?.title ?? newSub.taskTitle}`
    );
  };

  const reviewSubmission: AppContextType['reviewSubmission'] = (submissionId, decision, feedback, awardedPoints, rubricMarks) => {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return;
    guard('submissions.review', { id: sub.memberId, committeeId: sub.committeeId });

    if (!currentUser) throw new CapabilityError('submissions.review');
    const task = tasks.find((t) => t.id === sub.taskId);
    const rubric = scoreRubric(rubricFor(task?.category), rubricMarks ?? {});
    const verdict = checkReview(currentUser.id, sub, decision, rubric);
    if (!verdict.allowed) throw new Error(verdict.reason);
    if (decision === 'revision_requested') {
      const note = checkRevisionFeedback(feedback);
      if (!note.allowed) throw new Error(note.reason);
    }
    assertTaskMove(task?.status ?? 'submitted', decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'revision_requested');
    const criteria = rubricFor(task?.category);
    const markedCriteria = criteria
      .filter((c) => rubricMarks?.[c.id] === 0 || rubricMarks?.[c.id] === 1 || rubricMarks?.[c.id] === 2)
      .map((c) => ({ label: c.label, mark: rubricMarks?.[c.id] as 0 | 1 | 2 }));

    // A decided submission cannot be reviewed again, so a retried request cannot
    // double-award. The backend holds the same rule with a partial unique index on
    // esme_score_ledger (submission_id) plus an explicit guard in esme_record_review().
    if (sub.status === 'approved' || sub.status === 'rejected') {
      throw new Error(`This submission was already ${sub.status.replace(/_/g, ' ')}.`);
    }

    const points = decision === 'approved' ? (awardedPoints ?? sub.proposedPoints) : 0;

    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === submissionId
          ? {
              ...s,
              status: decision,
              reviewerFeedback: feedback,
              reviewedBy: currentUser.name,
              reviewedAt: stamp(),
              awardedPoints: points,
              reviewRubric: markedCriteria.length > 0 ? markedCriteria : s.reviewRubric,
              rubricPercent: rubric.percent ?? s.rubricPercent,
            }
          : s
      )
    );

    setTasks((prev) => prev.map((t) => (t.id === sub.taskId ? { ...t, status: decision } : t)));

    const alreadyAwarded = scoreLedger.some(
      (l) => l.taskId === sub.taskId && l.memberId === sub.memberId && l.actionType === 'task_completion'
    );

    if (decision === 'approved' && points > 0 && !alreadyAwarded) {
      const member = users.find((u) => u.id === sub.memberId);
      const previousTotal = member?.totalPoints ?? 0;
      const newTotal = previousTotal + points;
      setScoreLedger((prev) => [
        {
          id: `ledg_${Date.now()}`,
          memberId: sub.memberId,
          memberName: sub.memberName,
          committeeId: sub.committeeId,
          taskId: sub.taskId,
          taskTitle: sub.taskTitle,
          points,
          actionType: 'task_completion',
          reviewerId: currentUser?.id ?? 'system',
          reviewerName: currentUser?.name ?? 'system',
          timestamp: stamp(),
          reason: `Approved deliverables: ${sub.taskTitle}`,
          previousTotal,
          newTotal,
        },
        ...prev,
      ]);
      setUsers((prev) =>
        prev.map((u) =>
          u.id === sub.memberId
            ? { ...u, totalPoints: newTotal, approvedTasksCount: u.approvedTasksCount + 1 }
            : u
        )
      );
    }

    const member = users.find((u) => u.id === sub.memberId);
    // The ledger state update has not flushed yet, so the total the email reports is the one the
    // entry above actually wrote — not whatever `users` holds at this instant.
    const decidedTotal = (member?.totalPoints ?? 0) + (decision === 'approved' && points > 0 && !alreadyAwarded ? points : 0);
    const decisionMessage =
      decision === 'approved'
        ? `"${sub.taskTitle}" was approved and ${points} point(s) recorded for ${sub.memberName}.`
        : decision === 'rejected'
          ? `"${sub.taskTitle}" by ${sub.memberName} was not approved.`
          : `${sub.memberName} was asked to revise "${sub.taskTitle}".`;
    announce({
      payload:
        decision === 'approved'
          ? { event: 'submission_approved', fullName: sub.memberName, taskTitle: sub.taskTitle, points, newTotal: decidedTotal }
          : decision === 'rejected'
            ? { event: 'submission_rejected', fullName: sub.memberName, taskTitle: sub.taskTitle, reason: feedback }
            : { event: 'submission_revision_requested', fullName: sub.memberName, taskTitle: sub.taskTitle, feedback, taskUrl: recordUrl('task', sub.taskId) },
      recipientId: sub.memberId,
      recipientName: sub.memberName,
      recipientEmail: member?.email,
      ref: `${sub.id}:${decision}`,
      title:
        decision === 'approved' ? 'Submission approved' : decision === 'rejected' ? 'Submission not approved' : 'Revision requested',
      message: decisionMessage,
      type: decision === 'approved' ? 'success' : decision === 'rejected' ? 'alert' : 'warning',
      link: 'submissions',
    });

    logAction(
      `Reviewed Submission: ${decision.toUpperCase()}`,
      'submission',
      submissionId,
      `${decision} for ${sub.taskTitle} (${points > 0 ? `+${points}` : '0'} pts, rubric ${
        rubric.percent === null ? 'left unassessed' : `${rubric.percent}% over ${rubric.assessed} criteria`
      })`
    );
  };

  const startSubmissionReview: AppContextType['startSubmissionReview'] = (submissionId) => {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) return;
    guard('submissions.review', { id: sub.memberId, committeeId: sub.committeeId });
    if (!currentUser) throw new CapabilityError('submissions.review');
    if (!canMoveSubmission(sub.status, 'under_review')) {
      throw new Error(`A submission that is ${sub.status.replace(/_/g, ' ')} is not waiting for a reviewer.`);
    }
    const task = tasks.find((t) => t.id === sub.taskId);
    assertTaskMove(task?.status ?? 'submitted', 'under_review');
    setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? { ...s, status: 'under_review' } : s)));
    setTasks((prev) => prev.map((t) => (t.id === sub.taskId ? { ...t, status: 'under_review' } : t)));
    logAction(
      'Started Review',
      'submission',
      submissionId,
      `${currentUser.name} took ${sub.taskTitle} from ${sub.memberName} into review`
    );
  };

  const addManualPointAdjustment: AppContextType['addManualPointAdjustment'] = (memberId, points, reason) => {
    const member = users.find((u) => u.id === memberId);
    guard('scores.adjust', { committeeId: member?.committeeId });
    if (!member) throw new Error('That member is not in the roster visible to your account.');
    if (!Number.isFinite(points) || points === 0) throw new Error('An adjustment needs a non-zero point value.');
    if (reason.trim().length < 3) throw new Error('A score adjustment needs a written reason.');
    const previousTotal = member.totalPoints;
    const newTotal = previousTotal + points;
    const adjustmentId = `ledg_${Date.now()}`;
    setScoreLedger((prev) => [
      {
        id: adjustmentId,
        memberId: member.id,
        memberName: member.name,
        committeeId: member.committeeId ?? '',
        points,
        actionType: 'manual_adjustment',
        reviewerId: currentUser?.id ?? 'system',
        reviewerName: currentUser?.name ?? 'system',
        timestamp: stamp(),
        reason,
        previousTotal,
        newTotal,
      },
      ...prev,
    ]);
    setUsers((prev) => prev.map((u) => (u.id === memberId ? { ...u, totalPoints: newTotal } : u)));
    logAction('Adjusted Member Score', 'score', memberId, `${points > 0 ? '+' : ''}${points} pts — ${reason}`);
    if (points > 0) {
      announce({
        payload: {
          event: 'bonus_awarded',
          fullName: member.name,
          points,
          reason,
          awarderName: currentUser?.name ?? 'the chapter',
          newTotal,
        },
        recipientId: member.id,
        recipientName: member.name,
        recipientEmail: member.email,
        ref: adjustmentId,
        title: 'Bonus points awarded',
        message: `${member.name} was told they received ${points} bonus points for ${reason}.`,
        type: 'success',
        link: 'scoring',
      });
    }
  };

  /**
   * The provider a reward record is filed with. No adapter means no session and therefore no actor,
   * so every check below refuses first — this exists so that a record is never kept locally on the
   * strength of a provider that never answered.
   */
  const rewardWriter = () => {
    if (!auth.adapter) {
      throw new RewardRefusedError('provider_unavailable', 'No authentication provider is configured, so this record cannot be filed.');
    }
    return auth.adapter;
  };

  /**
   * One bonus, two records that share an id: the reward entry (who gave it, why, under whose
   * authority, whether it still stands) and the points movement the leaderboard already reads.
   * Writing only one of them would leave a recognition nobody counts or a count nobody signed.
   *
   * `validateRewardAction()` answers before the provider is asked, so an officer gets the rule in the
   * wording the form already uses. The answer that decides is the one from `esme_award_bonus()`: a
   * refusal there writes no entry, no ledger row, no new total and no mail in this browser.
   */
  const awardBonus: AppContextType['awardBonus'] = async ({ targetId, points, reason, evidenceUrl, idempotencyKey }) => {
    const target = users.find((u) => u.id === targetId) ?? null;
    const decision = validateRewardAction({
      kind: 'bonus',
      actor: { id: currentUser?.id ?? '', role: currentUser?.role ?? 'member', committeeId: currentUser?.committeeId, subTeam: currentUser?.subTeam },
      target,
      points,
      reason,
      evidenceUrl,
      policy: rewardPolicy,
      entries: rewardEntries,
      now: new Date().toISOString(),
      targetIsPrimaryAdmin: target ? isPrimaryAdmin(target) : false,
    });
    if (!decision.allowed) throw new RewardRefusedError(decision.code, decision.reason);
    const existing = findByIdempotencyKey(rewardEntries, idempotencyKey);
    if (existing) return existing;

    const member = target!;
    const result = await rewardWriter().awardBonus({
      targetId: member.id,
      points,
      reason: reason.trim(),
      evidenceUrl: evidenceUrl?.trim() || undefined,
      idempotencyKey,
      targetRole: member.role,
      targetCommitteeId: member.committeeId,
    });
    if (!result.ok) throw new RewardRefusedError(result.error.code, result.error.message);
    const receipt = result.receipt;

    // The receipt is the record; these two strings are display, read from the directory this
    // workspace already holds rather than from anything the form supplied.
    const entry: RewardEntry = { ...receipt, actorName: currentUser!.name, targetName: member.name };
    const entryId = receipt.id;
    const previousTotal = member.totalPoints;
    const newTotal = previousTotal + entry.points;
    const ledgerRow: ScoreLedgerEntry = {
      id: `ledg_${entryId}`,
      memberId: member.id,
      memberName: member.name,
      committeeId: member.committeeId ?? '',
      points: entry.points,
      actionType: 'bonus',
      reviewerId: currentUser!.id,
      reviewerName: currentUser!.name,
      timestamp: entry.issuedAt,
      reason: entry.reason,
      previousTotal,
      newTotal,
    };

    setRewardEntries((prev) => [entry, ...prev]);
    setScoreLedger((prev) => [ledgerRow, ...prev]);
    setUsers((prev) => prev.map((u) => (u.id === member.id ? { ...u, totalPoints: newTotal } : u)));
    logAction('Bonus Awarded', 'score', member.id, `+${entry.points} pts — ${entry.reason} (entry ${entryId})`);
    announce({
      payload: {
        event: 'bonus_awarded',
        fullName: member.name,
        points: entry.points,
        reason: entry.reason,
        awarderName: currentUser!.name,
        newTotal,
      },
      recipientId: member.id,
      recipientName: member.name,
      recipientEmail: member.email,
      ref: entryId,
      title: 'Bonus points awarded',
      message: `${entry.points} bonus points were awarded to ${member.name} for ${entry.reason}.`,
      type: 'success',
      link: 'rewards',
    });
    return entry;
  };

  /**
   * A warning moves no points — severity is accountability, not currency — but it does raise the
   * member's count inside the policy window, and crossing that threshold tells the people the
   * matrix names. The escalation notice goes out once per triggering entry, keyed by that entry.
   */
  const issueWarning: AppContextType['issueWarning'] = async ({ targetId, severity, reason, evidenceUrl, idempotencyKey }) => {
    const target = users.find((u) => u.id === targetId) ?? null;
    const decision = validateRewardAction({
      kind: 'warning',
      actor: { id: currentUser?.id ?? '', role: currentUser?.role ?? 'member', committeeId: currentUser?.committeeId, subTeam: currentUser?.subTeam },
      target,
      points: 0,
      severity,
      reason,
      evidenceUrl,
      policy: rewardPolicy,
      entries: rewardEntries,
      now: new Date().toISOString(),
      targetIsPrimaryAdmin: target ? isPrimaryAdmin(target) : false,
    });
    if (!decision.allowed) throw new RewardRefusedError(decision.code, decision.reason);
    const existing = findByIdempotencyKey(rewardEntries, idempotencyKey);
    if (existing) return existing;

    const member = target!;
    const result = await rewardWriter().issueWarning({
      targetId: member.id,
      severity,
      reason: reason.trim(),
      evidenceUrl: evidenceUrl?.trim() || undefined,
      idempotencyKey,
      targetRole: member.role,
      targetCommitteeId: member.committeeId,
    });
    if (!result.ok) throw new RewardRefusedError(result.error.code, result.error.message);
    const receipt = result.receipt;

    const entry: RewardEntry = { ...receipt, actorName: currentUser!.name, targetName: member.name };
    const entryId = receipt.id;
    // The state write is functional: two officers acting in the same tick must not overwrite each
    // other. `after` is only used to decide who to tell, so a stale read there costs a notification,
    // never a record.
    setRewardEntries((prev) => [entry, ...prev]);
    const after = [entry, ...rewardEntries];
    logAction('Warning Issued', 'user', member.id, `${severity} warning — ${entry.reason} (entry ${entryId})`);
    announce({
      payload: {
        event: 'warning_issued',
        fullName: member.name,
        severity,
        reason: entry.reason,
        issuerName: currentUser!.name,
        evidenceUrl: entry.evidenceUrl,
      },
      recipientId: member.id,
      recipientName: member.name,
      recipientEmail: member.email,
      ref: entryId,
      title: `${severity === 'final' ? 'Final' : severity === 'formal' ? 'Formal' : 'Notice'} warning recorded`,
      message: `${member.name} was told a ${severity} warning was recorded for ${entry.reason}.`,
      type: severity === 'final' ? 'alert' : 'warning',
      link: 'rewards',
    });

    const count = entriesInPeriod(after, member.id, 'warning', rewardPolicy.periodDays, new Date().toISOString()).length;
    if (count >= rewardPolicy.escalateWarningsAfter) {
      const told = new Set<string>();
      for (const { role, committeeId } of escalationRecipients(after, rewardPolicy, member, new Date().toISOString())) {
        users
          .filter((u) => u.role === role && (committeeId ? u.committeeId === committeeId : true) && u.status === 'active')
          .forEach((officer) => {
            if (told.has(`${entryId}:${officer.id}`)) return;
            told.add(`${entryId}:${officer.id}`);
            announce({
              payload: {
                event: 'warning_escalated',
                recipientName: officer.name,
                memberName: member.name,
                count,
                windowDays: rewardPolicy.periodDays,
              },
              recipientId: officer.id,
              recipientName: officer.name,
              recipientEmail: officer.email,
              ref: entryId,
              title: `${member.name} has ${count} warnings in ${rewardPolicy.periodDays} days`,
              message: `The ${rewardPolicy.periodDays}-day threshold is reached, so this is in front of you rather than in a file.`,
              type: 'warning',
              link: 'rewards',
            });
          });
      }
    }
    return entry;
  };

  /**
   * A correction is a second entry that cancels the first, never an edit of it. The original keeps
   * its text and gains a pointer, so "who reversed what, and why" stays answerable years later.
   */
  const reverseRewardEntry: AppContextType['reverseRewardEntry'] = async (entryId, reason) => {
    const original = rewardEntries.find((e) => e.id === entryId);
    if (!original) throw new RewardRefusedError('not_found', 'That entry does not exist, so it cannot be reversed.');
    if (original.status === 'reversed') throw new RewardRefusedError('already_reversed', 'That entry has already been reversed.');
    guard('rewards.write', { committeeId: original.committeeId });
    if (!reason.trim()) throw new RewardRefusedError('no_reason', 'A reversal without a reason is a silent edit with extra steps.');

    const result = await rewardWriter().reverseRewardEntry({ entryId, reason: reason.trim(), original });
    if (!result.ok) throw new RewardRefusedError(result.error.code, result.error.message);

    const reversalId = result.receipt.id;
    const reversal: RewardEntry = {
      ...result.receipt,
      actorName: currentUser!.name,
      targetName: original.targetName,
      acknowledgedAt: undefined,
      acknowledgedBy: undefined,
    };
    setRewardEntries(applyReversal(rewardEntries, reversal));

    if (original.kind === 'bonus' && original.points !== 0) {
      const member = users.find((u) => u.id === original.targetId);
      const previousTotal = member?.totalPoints ?? 0;
      const newTotal = previousTotal + reversal.points;
      setScoreLedger((prev) => [
        {
          id: `ledg_${reversalId}`,
          memberId: original.targetId,
          memberName: original.targetName,
          committeeId: original.committeeId ?? '',
          points: reversal.points,
          actionType: 'penalty',
          reviewerId: currentUser!.id,
          reviewerName: currentUser!.name,
          timestamp: reversal.issuedAt,
          reason: `Reversal of ${entryId}: ${reason.trim()}`,
          previousTotal,
          newTotal,
        },
        ...prev,
      ]);
      if (member) setUsers((prev) => prev.map((u) => (u.id === member.id ? { ...u, totalPoints: newTotal } : u)));
    }
    logAction(
      'Reward Entry Reversed',
      'score',
      original.targetId,
      `${original.kind} ${entryId} reversed by ${reversalId} — ${reason.trim()}`
    );
    return reversal;
  };

  /** Receipt, not agreement with the content: the entry itself is untouched apart from the stamp. */
  const acknowledgeWarning: AppContextType['acknowledgeWarning'] = async (entryId) => {
    const entry = rewardEntries.find((e) => e.id === entryId);
    if (!entry || entry.kind !== 'warning') throw new RewardRefusedError('not_found', 'Only a recorded warning can be acknowledged.');
    if (!currentUser || entry.targetId !== currentUser.id) {
      throw new RewardRefusedError('forbidden', 'Only the member the warning is about can acknowledge it.');
    }
    if (entry.acknowledgedAt) return;
    const result = await rewardWriter().acknowledgeWarning(entry);
    if (!result.ok) throw new RewardRefusedError(result.error.code, result.error.message);
    const at = stamp();
    setRewardEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, acknowledgedAt: at, acknowledgedBy: currentUser.id } : e))
    );
    logAction('Warning Acknowledged', 'user', entry.targetId, `${currentUser.name} read warning ${entryId} on ${at}`);
  };

  const updateRewardPolicy: AppContextType['updateRewardPolicy'] = (patch) => {
    guard('rewards.configure');
    const next: RewardPolicy = { ...rewardPolicy, ...patch, updatedAt: new Date().toISOString(), updatedBy: currentUser?.id ?? 'system' };
    const errors = validatePolicyEdit(next);
    if (errors.length > 0) throw new RewardRefusedError(errors[0].field, errors[0].message);
    setRewardPolicy(next);
    logAction(
      'Updated Reward Policy',
      'system',
      'reward_policy',
      `bonus cap ${next.maxBonusPointsPerAction}, period ${next.periodDays}d, escalate after ${next.escalateWarningsAfter}`
    );
    return next;
  };

  /**
   * Filing a review request writes a record, not a correction. The figure under dispute stays
   * exactly as the metrics module computed it until an officer decides, and a decision that
   * changes a score is made separately as a reasoned, audited adjustment.
   */
  const fileScoreAppeal: AppContextType['fileScoreAppeal'] = ({ metric, periodLabel, reason }) => {
    if (!currentUser) throw new CapabilityError('scores.read');
    guard('scores.read', { id: currentUser.id });
    const errors = validateAppeal({ metric, periodLabel, reason });
    if (errors.length) throw new Error(errors.join(' '));
    const appeal: ScoreAppeal = {
      id: `apl_${Date.now()}`,
      memberId: currentUser.id,
      memberName: currentUser.name,
      metric,
      periodLabel: periodLabel.trim(),
      reason: reason.trim(),
      filedAt: stamp(),
      status: 'open',
    };
    setScoreAppeals((prev) => [appeal, ...prev]);
    logAction(
      'Filed Score Review Request',
      'score',
      appeal.id,
      `${currentUser.name} disputed ${METRIC_DEFINITIONS[metric].label} for ${appeal.periodLabel}`
    );
  };

  const decideScoreAppeal: AppContextType['decideScoreAppeal'] = (id, status, note) => {
    const appeal = scoreAppeals.find((a) => a.id === id);
    if (!appeal) throw new Error('That review request is not in this workspace.');
    if (!currentUser) throw new CapabilityError('scores.adjust');
    const member = users.find((u) => u.id === appeal.memberId);
    guard('scores.adjust', { committeeId: member?.committeeId });
    if (appeal.memberId === currentUser.id) {
      throw new Error('You cannot decide your own review request; another officer must answer it.');
    }
    const decided = decideAppeal(appeal, status, note, currentUser.name, stamp());
    setScoreAppeals((prev) => prev.map((a) => (a.id === id ? decided : a)));
    logAction('Decided Score Review Request', 'score', id, `${decided.status}: ${decided.decisionNote}`);
  };

  /**
   * The recruitment queue is read from the provider, so an approver on any signed-in device
   * decides the same record the applicant created. Local rows only supply questionnaire
   * answers the provider does not carry and requests the provider cannot see.
   */
  const refreshRegistrationQueue = useCallback(async () => {
    if (!auth.adapter || !identity) return;
    if (!hasCapability(identity.role, 'registrations.read')) return;
    try {
      const records = await auth.adapter.listRegistrations();
      setApplications((prev) => {
        const byRef = new Map(prev.map((a) => [a.authUserId, a] as const));
        const visible = records.map((r) => applicationFromRecord(r, byRef.get(r.id)));
        const fromProvider = new Set(records.map((r) => r.id));
        return [...visible, ...prev.filter((a) => !a.authUserId || !fromProvider.has(a.authUserId))];
      });
      setQueueSource('provider');
      setQueueError(null);
    } catch (error) {
      setQueueSource('local');
      setQueueError(error instanceof Error ? error.message : 'The registration queue could not be loaded.');
    }
  }, [auth.adapter, identity]);

  useEffect(() => {
    void refreshRegistrationQueue();
  }, [refreshRegistrationQueue]);

  /**
   * Reads the account directory from the provider and merges it with the cached workspace
   * records. The same rule as the registration queue: the provider's rows win for identity,
   * and a failed read is reported instead of being hidden behind whatever the browser held.
   *
   * This is what makes a leadership assignment address a real person. Approved applicants
   * appear here, so a Head or Director is chosen from accounts that exist rather than typed
   * in or created a second time to make a dropdown look populated.
   */
  const refreshDirectory = useCallback(async () => {
    if (!auth.adapter || !identity) return;
    if (!hasCapability(identity.role, 'users.read')) {
      setDirectoryState({ from: 'local', error: null, accounts: 0 });
      return;
    }
    try {
      const accounts = await auth.adapter.listAccounts();
      setUsers((prev) => mergeDirectory(prev, accounts).merged);
      setDirectoryState({ from: 'provider', error: null, accounts: accounts.length });
    } catch (error) {
      setDirectoryState({
        from: 'local',
        error: error instanceof Error ? error.message : 'The account directory could not be loaded.',
        accounts: 0,
      });
    }
  }, [auth.adapter, identity]);

  useEffect(() => {
    void refreshDirectory();
  }, [refreshDirectory]);

  const submitApplication: AppContextType['submitApplication'] = (applicationData) => {
    const newApp: RegistrationApplication = {
      ...applicationData,
      id: `app_${Date.now()}`,
      appliedDate: stamp(),
      status: 'pending',
    };
    setApplications((prev) => [newApp, ...prev]);
    logAction('Application Submitted', 'application', newApp.id, `Application received from ${newApp.fullName}`);
    announce({
      payload: { event: 'account_created', fullName: newApp.fullName, reference: newApp.id },
      recipientId: newApp.authUserId ?? newApp.id,
      recipientName: newApp.fullName,
      recipientEmail: newApp.universityEmail,
      ref: newApp.id,
      title: 'Application received',
      message: `${newApp.fullName} was told their request is pending approval.`,
      type: 'info',
      link: 'applications',
    });
  };

  const updateApplicationStatus: AppContextType['updateApplicationStatus'] = async (id, status, notes, committeeId) => {
    guard('registrations.decide');
    const app = applications.find((a) => a.id === id);
    if (!app) return;
    if (app.status === 'accepted' || app.status === 'rejected') {
      throw new Error('This application already has a decision.');
    }
    // A decision is the provider's record first and this browser's copy second, so the
    // account status, welcome mail and audit entry all move from the same transaction.
    if (auth.adapter && app.authUserId && (status === 'accepted' || status === 'rejected')) {
      const result = await auth.adapter.decideRegistration(
        app.authUserId,
        status === 'accepted' ? 'approve' : 'reject',
        { reason: notes, committeeId }
      );
      if (!result.ok) throw new Error(result.error.message);
    }
    setApplications((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status,
              internalNotes: notes !== undefined ? notes : a.internalNotes,
              assignedCommitteeId: committeeId || a.assignedCommitteeId,
              reviewedBy: currentUser?.name ?? 'system',
              reviewedAt: stamp(),
            }
          : a
      )
    );
    logAction('Updated Application Status', 'application', id, `Status changed to ${status}`);
    const committeeName = committees.find((c) => c.id === (committeeId || app.assignedCommitteeId))?.name;
    if (status === 'accepted') {
      announce({
        payload: { event: 'account_approved', fullName: app.fullName, loginUrl: appRoot(), committeeName },
        recipientId: app.authUserId ?? app.id,
        recipientName: app.fullName,
        recipientEmail: app.universityEmail,
        ref: app.id,
        title: 'Application approved',
        message: `${app.fullName} was told they can sign in${committeeName ? ` to the ${committeeName}` : ''}.`,
        type: 'success',
        link: 'applications',
      });
    } else if (status === 'rejected') {
      announce({
        payload: { event: 'account_rejected', fullName: app.fullName, reason: notes, reapplyUrl: appRoot() },
        recipientId: app.authUserId ?? app.id,
        recipientName: app.fullName,
        recipientEmail: app.universityEmail,
        ref: app.id,
        title: 'Application rejected',
        message: `${app.fullName} was told their request was not approved${notes ? ' with the reason attached' : ''}.`,
        type: 'warning',
        link: 'applications',
      });
    }
    await refreshRegistrationQueue();
  };

  const updateFormFields: AppContextType['updateFormFields'] = (fields) => {
    guard('cms.settings.global');
    setFormFields(fields);
    logAction('Updated Registration Form Builder', 'cms', 'form_builder', 'Saved registration form schema');
  };

  const addSeasonEvent: AppContextType['addSeasonEvent'] = (evtData) => {
    guard('events.write');
    const newEvt: SeasonEvent = { ...evtData, id: `evt_${Date.now()}` };
    setSeasonEvents((prev) => [...prev, newEvt]);
    logAction('Added Season Event', 'system', newEvt.id, `Added event: ${newEvt.title}`);
  };

  const updateSeasonEvent: AppContextType['updateSeasonEvent'] = (id, updates) => {
    guard('events.write');
    setSeasonEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    logAction('Updated Season Event', 'system', id, `Updated season event: ${id}`);
  };

  /**
   * The 2026–2027 plan was transcribed from a vision document, so it exists as a draft someone
   * can start from — but it is never loaded by itself. A planner that arrives full of milestones
   * the chapter never wrote would hand every progress figure below it a fictional denominator.
   * Idempotent: a title already in the plan is not added twice.
   */
  const loadReferenceSeasonPlan: AppContextType['loadReferenceSeasonPlan'] = () => {
    guard('events.write');
    const known = new Set(seasonEvents.map((e) => e.title.trim().toLowerCase()));
    const missing = REFERENCE_SEASON_EVENTS.filter((e) => !known.has(e.title.trim().toLowerCase()));
    const suffix = Date.now();
    setSeasonEvents((prev) => [...prev, ...missing.map((e, i) => ({ ...e, id: `evt_${suffix}_${i}` }))]);
    logAction(
      'Loaded Reference Season Plan',
      'system',
      'season_events',
      `Copied the transcribed 2026–2027 milestone list into the planner as drafts (${missing.length} added, ${REFERENCE_SEASON_EVENTS.length - missing.length} already present)`
    );
    return missing.length;
  };

  const updateMemberSkill: AppContextType['updateMemberSkill'] = (id, updates) => {
    const entry = skillMatrix.find((s) => s.id === id);
    if (!entry) throw new Error('That assessment is not in this workspace.');
    guard('skills.manage', { committeeId: entry.committeeId });
    // Raising a level re-reads the written record that supports it. A change that only
    // touches the goal text is not a level claim and passes through.
    if (updates.level !== undefined) assertEvidence(updates.level, updates.evidence ?? entry.evidence);
    setSkillMatrix((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
    logAction('Updated Member Skill', 'user', id, `Set ${entry.memberName} to ${updates.level ?? entry.level} in ${updates.skillName ?? entry.skillName}`);
  };

  const addMemberSkill: AppContextType['addMemberSkill'] = (entry) => {
    guard('skills.manage', { committeeId: entry.committeeId });
    assertEvidence(entry.level, entry.evidence);
    if (!entry.evidence.trim()) throw new Error('Record what the assessment was based on.');
    const newEntry: SkillMatrixEntry = { ...entry, id: `sk_${Date.now()}` };
    setSkillMatrix((prev) => [...prev, newEntry]);
    logAction(
      'Added Skill Assessment',
      'user',
      newEntry.id,
      `Assessed ${newEntry.memberName} in ${newEntry.skillName}`
    );
  };

  /**
   * Spec B writers. Each one checks the capability against the member's committee with an
   * explicit id, because the scope helpers treat a missing id as "nothing to match" — and a
   * level, completion, goal or note is only worth storing when the person it describes is
   * actually the one the writer may reach.
   */
  const scopeForSkills = (committeeId?: string) => {
    if (!currentUser) throw new CapabilityError('skills.manage');
    const scope = scopeFor(currentUser.role, 'skills.manage');
    if (!scope) throw new CapabilityError('skills.manage');
    return { scope, memberCommittee: currentUser.committeeId, committeeId };
  };

  const addSkillRequirement: AppContextType['addSkillRequirement'] = (entry) => {
    const { scope, memberCommittee } = scopeForSkills(entry.committeeId);
    // A requirement without a committee binds every committee, so it is a chapter-wide rule
    // and only an all-scope account may write one.
    if (!entry.committeeId) {
      if (scope !== 'all') throw new CapabilityError('skills.manage');
    } else if (scope === 'committee' && entry.committeeId !== memberCommittee) {
      throw new CapabilityError('skills.manage');
    }
    if (!entry.rationale.trim()) throw new Error('Say why this level is required, not just that it is.');
    const newEntry: SkillRequirement = { ...entry, id: `req_${Date.now()}` };
    setSkillRequirements((prev) => [...prev, newEntry]);
    logAction(
      'Added Skill Requirement',
      'system',
      newEntry.id,
      `${newEntry.skillName} at ${newEntry.minLevel} for ${newEntry.committeeId ?? 'every committee'}${newEntry.role ? ` / ${newEntry.role}` : ''}`
    );
  };

  const addCourse: AppContextType['addCourse'] = (entry) => {
    const { scope } = scopeForSkills(undefined);
    // The catalogue is shared chapter-wide, so it is not a committee-scoped write.
    if (scope !== 'all') throw new CapabilityError('skills.manage');
    if (!entry.title.trim() || !entry.provider.trim()) throw new Error('A course needs a title and who runs it.');
    if (!(entry.hours > 0)) throw new Error('Record the hours the course actually takes.');
    const newEntry: TrainingCourse = { ...entry, id: `crs_${Date.now()}` };
    setCourses((prev) => [...prev, newEntry]);
    logAction('Added Training Course', 'system', newEntry.id, `${newEntry.title} (${newEntry.hours}h, targets ${newEntry.levelTarget})`);
  };

  /**
   * Logging a completion never touches skillMatrix: attending a course is not evidence that
   * someone works independently, and the level only moves when an assessor records one.
   */
  const recordCourseCompletion: AppContextType['recordCourseCompletion'] = (entry) => {
    const member = users.find((u) => u.id === entry.memberId);
    if (!member) throw new Error('That member is not in this workspace, so the completion cannot be filed.');
    guard('skills.manage', { committeeId: member.committeeId });
    const { scope, memberCommittee } = scopeForSkills(member.committeeId);
    if (scope === 'committee' && member.committeeId !== memberCommittee) throw new CapabilityError('skills.manage');
    const course = courses.find((c) => c.id === entry.courseId);
    if (!course) throw new Error('This course is not in the catalogue. Add it before recording a completion.');
    if (entry.evidence.trim().length < 12) throw new Error('Describe what was submitted or shown for this completion.');
    const duplicate = courseCompletions.some(
      (c) => c.memberId === entry.memberId && c.courseId === entry.courseId
    );
    if (duplicate) throw new Error(`${member.name} already has this completion recorded.`);
    const newEntry: CourseCompletion = {
      ...entry,
      id: `cmp_${Date.now()}`,
      recordedBy: currentUser?.name ?? 'unknown',
    };
    setCourseCompletions((prev) => [...prev, newEntry]);
    logAction('Recorded Course Completion', 'user', newEntry.id, `${member.name} completed ${course.title}`);
  };

  const addDevelopmentGoal: AppContextType['addDevelopmentGoal'] = (entry) => {
    const member = users.find((u) => u.id === entry.memberId);
    if (!member) throw new Error('That member is not in this workspace.');
    // A member sets their own goals; a head or director sets them for the committee.
    guard('skills.read', { id: member.id, committeeId: member.committeeId });
    if (levelIndex(entry.toLevel) <= levelIndex(entry.fromLevel)) {
      throw new Error(`A goal moves upward: ${entry.fromLevel} → ${entry.toLevel} is not progress to plan for.`);
    }
    const assessed = currentLevel(skillMatrix, member.id, entry.skillName);
    if (assessed !== null && assessed !== entry.fromLevel) {
      throw new Error(
        `${member.name} is assessed at ${assessed} in ${entry.skillName}. Start the goal from that level, or have an assessor re-read the evidence first.`
      );
    }
    if (!entry.dueDate) throw new Error('A goal without a date is a wish; record when it is due.');
    const at = new Date().toISOString();
    const newEntry: DevelopmentGoal = {
      ...entry,
      id: `goal_${Date.now()}`,
      status: 'open',
      ownerName: currentUser?.name ?? 'unknown',
      createdAt: at,
      updatedAt: at,
    };
    setDevelopmentGoals((prev) => [...prev, newEntry]);
    logAction('Added Development Goal', 'user', newEntry.id, `${member.name}: ${newEntry.skillName} ${newEntry.fromLevel} → ${newEntry.toLevel} by ${newEntry.dueDate}`);
  };

  /**
   * Only an assessor's record can close a goal: marking one 'achieved' checks the matrix for
   * the target level instead of trusting the person who wrote the goal.
   */
  const updateDevelopmentGoal: AppContextType['updateDevelopmentGoal'] = (id, updates) => {
    const goal = developmentGoals.find((g) => g.id === id);
    if (!goal) throw new Error('That goal is not in this workspace.');
    const member = users.find((u) => u.id === goal.memberId);
    guard('skills.read', { id: goal.memberId, committeeId: member?.committeeId });
    if (updates.status === 'achieved') {
      const assessed = currentLevel(skillMatrix, goal.memberId, goal.skillName);
      if (assessed === null) {
        throw new Error(
          `Nothing has been assessed for ${member?.name ?? 'this member'} in ${goal.skillName}, so the goal cannot be marked achieved. Record an assessment first.`
        );
      }
      if (levelIndex(assessed) < levelIndex(goal.toLevel)) {
        throw new Error(
          `The recorded level is ${assessed}, short of the ${goal.toLevel} this goal aims at. Keep it open until an assessor confirms ${goal.toLevel}.`
        );
      }
    }
    setDevelopmentGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates, updatedAt: new Date().toISOString() } : g))
    );
    logAction(
      'Updated Development Goal',
      'user',
      id,
      `${goal.skillName} ${goal.fromLevel} → ${updates.toLevel ?? goal.toLevel}: ${updates.status ?? goal.status}`
    );
  };

  /**
   * Mentor and reviewer notes are scoped harder than the matrix: 'member' visibility is only
   * ever readable by the person and the author, so writing one needs to reach that member,
   * and publishing one to the committee needs committee scope.
   */
  const addDevelopmentFeedback: AppContextType['addDevelopmentFeedback'] = (entry) => {
    if (!currentUser) throw new CapabilityError('skills.read');
    const member = users.find((u) => u.id === entry.memberId);
    if (!member) throw new Error('That member is not in this workspace.');
    guard('skills.read', { id: member.id, committeeId: member.committeeId });
    if (entry.visibility === 'committee') {
      const readScope = scopeFor(currentUser.role, 'skills.read');
      if (readScope !== 'all' && readScope !== 'committee') throw new CapabilityError('skills.read');
      if (readScope === 'committee' && member.committeeId !== currentUser.committeeId) {
        throw new CapabilityError('skills.read');
      }
    }
    if (entry.body.trim().length < 15) throw new Error('Write something the member can act on, not a rating.');
    const newEntry: DevelopmentFeedback = {
      ...entry,
      id: `fb_${Date.now()}`,
      at: stamp(),
      committeeId: member.committeeId,
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorRole: currentUser.role,
    };
    setDevelopmentFeedback((prev) => [...prev, newEntry]);
    logAction('Added Development Feedback', 'user', newEntry.id, `${newEntry.kind} note for ${member.name} (${newEntry.visibility})`);
  };

  /**
   * Spec E/F writers. Seasons and objectives are chapter-level claims, so they sit behind
   * `analytics.configure`: super_admin everywhere, a director only inside their own committee.
   */
  const leadershipGuard = (committeeId?: string) => {
    if (!currentUser) throw new CapabilityError('analytics.configure');
    const scope = scopeFor(currentUser.role, 'analytics.configure');
    if (!scope) throw new CapabilityError('analytics.configure');
    if (scope === 'committee' && committeeId !== undefined && committeeId !== currentUser.committeeId) {
      throw new CapabilityError('analytics.configure');
    }
    return scope;
  };

  const okrData = (): OkrData => ({
    tasks,
    submissions,
    applications,
    ledger: scoreLedger,
    users,
    committees,
    events: seasonEvents,
    assessments: skillMatrix,
    audit: auditLogs,
    asOf: new Date().toISOString(),
  });

  const addSeason: AppContextType['addSeason'] = (entry) => {
    leadershipGuard();
    if (!entry.label.trim()) throw new Error('Give the season a label the chapter will recognise.');
    if (entry.startDate >= entry.endDate) throw new Error('A season has to end after it starts.');
    const overlaps = seasons.find((s) => s.startDate <= entry.endDate && entry.startDate <= s.endDate);
    if (overlaps) throw new Error(`This window overlaps ${overlaps.label}, already recorded from ${overlaps.startDate} to ${overlaps.endDate}.`);
    if (entry.status === 'active' && seasons.some((s) => s.status === 'active')) {
      throw new Error('Close the season now marked active before opening another one.');
    }
    const newEntry: ChapterSeason = { ...entry, id: `sea_${Date.now()}`, createdAt: new Date().toISOString() };
    setSeasons((prev) => [...prev, newEntry]);
    logAction('Added Season', 'system', newEntry.id, `${newEntry.label} (${newEntry.startDate} to ${newEntry.endDate}), ${newEntry.status}`);
  };

  const updateSeason: AppContextType['updateSeason'] = (id, updates) => {
    const season = seasons.find((s) => s.id === id);
    if (!season) throw new Error('That season is not in this workspace.');
    leadershipGuard();
    if (season.status === 'closed' && (updates.startDate || updates.endDate)) {
      throw new Error(`${season.label} is closed and keeps its frozen figures; its dates cannot be rewritten.`);
    }
    if (updates.status === 'active' && seasons.some((s) => s.id !== id && s.status === 'active')) {
      throw new Error('Close the season now marked active before opening another one.');
    }
    const nextStart = updates.startDate ?? season.startDate;
    const nextEnd = updates.endDate ?? season.endDate;
    if (nextStart >= nextEnd) throw new Error('A season has to end after it starts.');
    setSeasons((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)));
    logAction('Updated Season', 'system', id, `${season.label}: ${Object.keys(updates).join(', ') || 'no field changed'}`);
  };

  /** Closing freezes what the records said that day, including the lines that were not measurable. */
  const closeSeason: AppContextType['closeSeason'] = (id) => {
    const season = seasons.find((s) => s.id === id);
    if (!season) throw new Error('That season is not in this workspace.');
    leadershipGuard();
    if (season.status === 'closed') throw new Error(`${season.label} is already closed.`);
    if (objectives.some((o) => o.seasonId === id) && !season.handover.trim()) {
      throw new Error('Write the handover note before closing: it is what the next season reads about this one.');
    }
    const snapshot = buildSeasonSnapshot(season, okrData());
    const at = new Date().toISOString();
    setSeasons((prev) => prev.map((s) => (s.id === id ? { ...s, status: 'closed' as const, closedAt: at, snapshot } : s)));
    logAction(
      'Closed Season',
      'system',
      id,
      `${season.label} frozen with ${snapshot.lines.length} figure(s); ${snapshot.lines.filter((l) => l.value === 'not measurable').length} were not measurable at closing`
    );
  };

  const addObjective: AppContextType['addObjective'] = (entry) => {
    const season = seasons.find((s) => s.id === entry.seasonId);
    if (!season) throw new Error('Choose a recorded season. An objective without one has no window to be measured in.');
    leadershipGuard(entry.committeeId);
    if (!entry.title.trim()) throw new Error('Name the objective.');
    if (!entry.why.trim()) throw new Error('Say why this matters, not only what will be counted.');
    if (season.endDate < new Date().toISOString().slice(0, 10)) {
      throw new Error(`${season.label} has already ended; an objective written into it now would be measured against a closed window.`);
    }
    const at = new Date().toISOString();
    const newEntry: Objective = { ...entry, id: `obj_${Date.now()}`, ownerName: currentUser?.name ?? 'unknown', createdAt: at, updatedAt: at };
    setObjectives((prev) => [...prev, newEntry]);
    logAction('Added Objective', 'system', newEntry.id, `${newEntry.title} (${season.label})`);
  };

  const deleteObjective: AppContextType['deleteObjective'] = (id) => {
    const objective = objectives.find((o) => o.id === id);
    if (!objective) throw new Error('That objective is not in this workspace.');
    leadershipGuard(objective.committeeId);
    setObjectives((prev) => prev.filter((o) => o.id !== id));
    setKeyResults((prev) => prev.filter((k) => k.objectiveId !== id));
    logAction('Deleted Objective', 'system', id, `${objective.title} and its ${keyResults.filter((k) => k.objectiveId === id).length} key result(s)`);
  };

  const addKeyResult: AppContextType['addKeyResult'] = (entry) => {
    const objective = objectives.find((o) => o.id === entry.objectiveId);
    if (!objective) throw new Error('Choose an objective this key result belongs to.');
    leadershipGuard(entry.committeeId ?? objective.committeeId);
    if (!entry.label.trim()) throw new Error('Describe what will be counted.');
    if (!Number.isFinite(entry.target)) throw new Error('The target has to be a number to measure against.');
    if (entry.baseline !== null && !Number.isFinite(entry.baseline)) throw new Error('A baseline is either a recorded number or nothing at all.');
    const committeeId = entry.scope === 'committee' ? entry.committeeId ?? objective.committeeId : entry.committeeId;
    if (entry.scope === 'committee' && !committeeId) {
      throw new Error('A committee-scoped key result has to name the committee.');
    }
    if (entry.metric === 'committee_load' && entry.scope !== 'committee') {
      throw new Error('Spread is defined per committee, so this key result must be committee-scoped.');
    }
    if (entry.direction === 'decrease' && entry.baseline === null) {
      throw new Error(
        'A falling target needs the starting point it began from, or progress stays unmeasurable. Record the baseline, or leave this as an increase.'
      );
    }
    const newEntry: KeyResult = { ...entry, committeeId, id: `kr_${Date.now()}` };
    setKeyResults((prev) => [...prev, newEntry]);
    logAction('Added Key Result', 'system', newEntry.id, `${newEntry.label} → ${newEntry.target} under ${objective.title}`);
  };

  const deleteKeyResult: AppContextType['deleteKeyResult'] = (id) => {
    const kr = keyResults.find((k) => k.id === id);
    if (!kr) throw new Error('That key result is not in this workspace.');
    const objective = objectives.find((o) => o.id === kr.objectiveId);
    leadershipGuard(kr.committeeId ?? objective?.committeeId);
    setKeyResults((prev) => prev.filter((k) => k.id !== id));
    logAction('Deleted Key Result', 'system', id, kr.label);
  };

  /**
   * Read on demand, never stored: the rollup is the calculation run over the records as they
   * stand, so a closed task moves an objective the next time somebody looks.
   */
  const objectiveRollups: AppContextType['objectiveRollups'] = (seasonId) => {
    const season = seasons.find((s) => s.id === seasonId);
    if (!season) return [];
    const data = okrData();
    return objectives.filter((o) => o.seasonId === seasonId).map((o) => rollupObjective(o, keyResults, data, season));
  };

  const markNotificationRead = (id: string) =>
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));

  const clearAllNotifications = () => setNotifications([]);

  const setActionPrefs: AppContextType['setActionPrefs'] = (prefs) => {
    if (!currentUser) throw new CapabilityError('tasks.read');
    setActionPrefsState(prefs);
    logAction('Updated Reminder Preferences', 'system', 'action-center', `${Object.values(prefs.enabled).filter(Boolean).length} of 6 kinds on, ${prefs.leadDays} day lead`);
  };

  /**
   * The queue is a projection, never a table: it is rebuilt from the records this account can
   * read each time, so closing a task removes its item instead of leaving a stale row.
   */
  const actionQueue: AppContextType['actionQueue'] = () => {
    if (!currentUser) return [];
    const actor = { role: currentUser.role, id: currentUser.id, committeeId: currentUser.committeeId };
    const queue = buildActionQueue({
      tasks,
      submissions,
      applications,
      events: seasonEvents,
      users,
      asOf: new Date().toISOString(),
      prefs: actionPrefs,
    });
    return sortQueue(
      queue.filter((item) =>
        visibleTo(actor, { ownerId: item.owner?.id ?? null, committeeId: item.committeeId })
      )
    );
  };

  /**
   * Duplicate prevention lives here: a queue item is announced once, identified by
   * (record, kind, stage). Deciding the record moves the key; re-running the sweep on the
   * same state adds nothing. Nothing is sent anywhere — the item lands in this workspace's
   * own list, and no delivery provider is configured.
   */
  const runActionSweep: AppContextType['runActionSweep'] = () => {
    if (!currentUser) throw new CapabilityError('tasks.read');
    guard('tasks.read', { id: currentUser.id, committeeId: currentUser.committeeId });
    const { toEmit, suppressed } = planNotifications(actionQueue(), emittedKeys);
    if (toEmit.length > 0) {
      const at = stamp();
      const batch = toEmit.map((n, index) => ({
        id: `not_${Date.now()}_${index}`,
        title: n.title,
        message: n.message,
        type: n.key.startsWith('overdue:') || n.key.startsWith('recruitment:') ? ('alert' as const) : ('warning' as const),
        timestamp: at,
        read: false,
        link: n.link,
        sourceKey: n.key,
        delivery: 'in_app' as const,
      }));
      // History is a rolling window; the raised-key registry is not capped, or old reminders return.
      setNotifications((prev) => [...batch, ...prev].slice(0, 200));
      setEmittedKeys((prev) => [...prev, ...toEmit.map((n) => ({ key: n.key, raisedAt: at }))]);
      for (const item of toEmit) {
        if (!item.key.startsWith('overdue:')) continue;
        const task = tasks.find((t) => t.id === item.key.slice('overdue:'.length));
        if (!task) continue;
        const daysRemaining = Math.ceil((new Date(task.deadline).getTime() - Date.now()) / 86_400_000);
        for (const memberId of task.assigneeIds) {
          const member = users.find((u) => u.id === memberId);
          if (!member) continue;
          announce({
            payload: {
              event: 'deadline_reminder',
              fullName: member.name,
              taskTitle: task.title,
              deadline: task.deadline,
              daysRemaining,
              taskUrl: recordUrl('task', task.id),
            },
            recipientId: member.id,
            recipientName: member.name,
            recipientEmail: member.email,
            // The raised key is per task, so a member is mailed once per overdue task, not once per sweep.
            ref: `${item.key}:${member.id}`,
            title: 'Deadline reminder',
            message: `${member.name} was reminded about "${task.title}", due ${task.deadline}.`,
            type: 'alert',
            link: 'tasks',
          });
        }
      }
      logAction(
        'Raised Action Reminders',
        'system',
        'action-center',
        `${batch.length} notification(s) written from live records; ${suppressed.length} key(s) already raised`
      );
    }
    return { emitted: toEmit.length, suppressed };
  };

  /**
   * Public site copy is a single global document, so editing it needs the global
   * settings capability rather than committee-scoped content rights. Saving here writes
   * the cached draft; a deploy is what puts it on the internet, and this app does not
   * deploy anything.
   */
  const updateWebsiteContent: AppContextType['updateWebsiteContent'] = (updates) => {
    guard('cms.settings.global');
    // The merged document goes through the same validator the editor uses, so a write that skips
    // the form cannot smuggle in a link the page would follow or a field of the wrong shape.
    const { doc, notes, recognized } = validateContentDocument({ ...websiteContent, ...updates });
    if (!recognized) return;
    setWebsiteContent(doc);
    if (notes.length > 0) {
      logAction(
        `Saved Website Content Draft (${notes.length} field(s) refused)`,
        'cms',
        'website_config',
        `Modified public page content in this browser. Refused: ${notes.join(' ')}`
      );
      return;
    }
    logAction('Saved Website Content Draft', 'cms', 'website_config', 'Modified public page content in this browser');
  };

  /** Bundled pictures plus whatever this device uploaded, addressed by id for every image slot. */
  const mediaLibrary: MediaAsset[] = useMemo(() => [...bundledAssets(), ...mediaAssets], [mediaAssets]);
  const assetIsHeld = (assetId: string) => mediaLibrary.some((asset) => asset.id === assetId);
  const unpublishedChanges = changedPaths(publishedContent, websiteContent);

  /**
   * Puts the draft on the live page. Publish is its own capability because it is the write that
   * reaches a visitor: the document is validated first, so a draft hand-made to skip the editor
   * cannot publish a link the page would follow, and a refusal changes nothing at all.
   */
  const publishWebsiteContent: AppContextType['publishWebsiteContent'] = (label = '') => {
    guard('cms.content.publish');
    if (!currentUser) throw new CapabilityError('cms.content.publish');
    const outcome = publishDraft({
      draft: websiteContent,
      published: publishedContent,
      revisions: contentRevisions,
      actor: { id: currentUser.id, name: currentUser.name },
      label,
      now: new Date().toISOString(),
      id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    setPublishedContent(outcome.published);
    setContentRevisions(outcome.revisions);
    const unresolved = unresolvedSlots(outcome.published, assetIsHeld);
    const detail = `Live page updated: ${summarizeChanges(outcome.revision.changes)}`;
    logAction(
      'Published Website Content',
      'cms',
      'website_config',
      unresolved.length > 0
        ? `${detail}. ${unresolved.length} slot(s) name a picture this device does not hold and will show the asset shipped with the build: ${unresolved.join(', ')}.`
        : detail
    );
    return { revision: outcome.revision, notes: outcome.notes, unresolvedSlots: unresolved };
  };

  /** Throws the draft away and takes the live page back. Nothing published is touched. */
  const discardWebsiteDraft: AppContextType['discardWebsiteDraft'] = () => {
    guard('cms.settings.global');
    const pending = changedPaths(publishedContent, websiteContent);
    if (pending.length === 0) return { discarded: 0 };
    setWebsiteContent(publishedContent);
    logAction('Discarded Website Draft', 'cms', 'website_config', `Dropped ${pending.length} unpublished field(s): ${summarizeChanges(pending)}`);
    return { discarded: pending.length };
  };

  /**
   * Rolls the live page back to a listed revision. The rollback is written as a new entry, so the
   * history still answers who published what and when after a restore.
   */
  const restoreContentRevision: AppContextType['restoreContentRevision'] = (revisionId) => {
    guard('cms.content.publish');
    if (!currentUser) throw new CapabilityError('cms.content.publish');
    const outcome = restoreRevision({
      revisions: contentRevisions,
      published: publishedContent,
      revisionId,
      actor: { id: currentUser.id, name: currentUser.name },
      now: new Date().toISOString(),
      id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    });
    if (!outcome.ok) throw new Error(outcome.refusal);
    setPublishedContent(outcome.published);
    setContentRevisions(outcome.revisions);
    logAction('Restored Website Revision', 'cms', 'website_config', `Rolled the live page back to revision ${revisionId}. Recorded as ${outcome.revision.id}.`);
    return { revision: outcome.revision, notes: outcome.notes, unresolvedSlots: unresolvedSlots(outcome.published, assetIsHeld) };
  };

  /** Files accepted bytes under an id this device chose. The library holds rows, never the pixels. */
  const addMediaAsset: AppContextType['addMediaAsset'] = (input, details) => {
    guard('cms.media.manage');
    const accepted = validateUpload(input);
    if (!accepted.ok) throw new Error(accepted.message);
    const added = addToLibrary(mediaAssets, accepted, {
      id: details.id,
      src: details.src,
      addedAt: details.addedAt ?? new Date().toISOString(),
    });
    if (added.refusal) throw new Error(added.refusal);
    setMediaAssets(added.library);
    logAction('Added Media Asset', 'cms', added.asset?.id ?? details.id, `Filed ${added.asset?.name ?? details.id} in the media library.`);
    return added.asset!;
  };

  /** Swaps the bytes under an existing id, so every slot that points at it shows the new picture. */
  const replaceMediaAsset: AppContextType['replaceMediaAsset'] = (assetId, input, src) => {
    guard('cms.media.manage');
    const accepted = validateUpload(input);
    if (!accepted.ok) throw new Error(accepted.message);
    const replaced = replaceAsset(mediaAssets, assetId, accepted, src);
    if (replaced.refusal) throw new Error(replaced.refusal);
    setMediaAssets(replaced.library);
    logAction('Replaced Media Asset', 'cms', assetId, `Replaced the picture behind ${assetId} in place. Slots that use it were not changed.`);
    return replaced.library.find((asset) => asset.id === assetId)!;
  };

  /**
   * Removes an upload from this device. Refused while the live page or the draft still points at
   * it, and refused for a bundled asset, which a list edit cannot remove from the deployment.
   */
  const deleteMediaAsset: AppContextType['deleteMediaAsset'] = (assetId) => {
    guard('cms.media.manage');
    const asset = mediaAssets.find((entry) => entry.id === assetId);
    if (!asset) throw new Error('That asset is not in this device library, so there is nothing to delete.');
    const decision = decideDelete(asset, [publishedContent, websiteContent]);
    if (!decision.allowed) throw new Error(decision.reasons.join(' '));
    setMediaAssets(mediaAssets.filter((entry) => entry.id !== assetId));
    logAction('Deleted Media Asset', 'cms', assetId, `Removed ${asset.name} from the media library. No slot pointed at it.`);
  };

  /** Points one image slot at a library asset, or back at the picture shipped with the build. */
  const setImageSlot: AppContextType['setImageSlot'] = (slotId, assetId) => {
    guard('cms.settings.global');
    const images = { ...(websiteContent.images ?? {}) };
    if (assetId === null) delete images[slotId];
    else {
      const asset = mediaLibrary.find((entry) => entry.id === assetId);
      if (!asset) throw new Error('That picture is not in the library on this device, so a slot cannot be pointed at it.');
      images[slotId] = { assetId, ...(asset.alt === '' ? {} : { alt: asset.alt }), ...(asset.caption ? { caption: asset.caption } : {}) };
    }
    updateWebsiteContent({ images });
  };

  const setTheme = (next: 'light' | 'dark' | 'system') => setThemeState(next);


  /**
   * Clears this app's own cache and restores reference content. Never touches a backend.
   * It throws away this browser's copy of every operational table, so it belongs to the same
   * capability as export and restore rather than to whoever can reach the settings screen.
   */
  const resetLocalCache = () => {
    guard('backups.manage');
    ['committees', 'formFields', 'seasonEvents', 'websiteContent', 'publishedContent', 'contentRevisions', 'mediaAssets', 'notifications', 'notificationKeys', 'actionPrefs', 'skillRequirements', 'courses', 'courseCompletions', 'developmentGoals', 'developmentFeedback', 'seasons', 'objectives', 'keyResults'].forEach((key) => {
      try {
        localStorage.removeItem(`ESME_CU_STATE_V2_${key}`);
      } catch {
        /* storage unavailable */
      }
    });
    setCommittees(REFERENCE_COMMITTEES);
    setFormFields(REFERENCE_FORM_FIELDS);
    setWebsiteContent(REFERENCE_WEBSITE_CONTENT);
    setPublishedContent(REFERENCE_WEBSITE_CONTENT);
    setContentRevisions([]);
    setMediaAssets([]);
    // Operational collections return to empty, not to a fictional dataset.
    setSeasonEvents(EMPTY_SEASON_EVENTS);
    setUsers(EMPTY_USERS);
    setTasks(EMPTY_TASKS);
    setSubmissions(EMPTY_SUBMISSIONS);
    setScoreLedger(EMPTY_LEDGER);
    setRewardEntries(EMPTY_REWARDS);
    setRewardPolicy(DEFAULT_REWARD_POLICY);
    setApplications(EMPTY_APPLICATIONS);
    setSkillMatrix(EMPTY_SKILLS);
    setNotifications(EMPTY_NOTIFICATIONS);
    setAuditLogs(EMPTY_AUDIT);
    setScoreAppeals([]);
    setEmittedKeys([]);
    setActionPrefsState(DEFAULT_ACTION_PREFS);
    setSkillRequirements(EMPTY_REQUIREMENTS);
    setCourses(EMPTY_COURSES);
    setCourseCompletions(EMPTY_COMPLETIONS);
    setDevelopmentGoals(EMPTY_GOALS);
    setDevelopmentFeedback(EMPTY_FEEDBACK);
    setSeasons(EMPTY_SEASONS);
    setObjectives(EMPTY_OBJECTIVES);
    setKeyResults(EMPTY_KEY_RESULTS);
  };

  /** A snapshot of what this browser holds — the backup capability owns it, and it is not a backend export. */
  const exportDataJSON = () => {
    guard('backups.manage');
    return JSON.stringify(
      {
        schemaVersion: storageVersion(),
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser?.email ?? 'anonymous',
        committees,
        tasks,
        submissions,
        scoreLedger,
        rewardEntries,
        rewardPolicy,
        scoreAppeals,
        applications,
        formFields,
        seasonEvents,
        skillMatrix,
        skillRequirements,
        courses,
        courseCompletions,
        developmentGoals,
        developmentFeedback,
        seasons,
        objectives,
        keyResults,
        notifications,
        auditLogs,
        websiteContent,
        publishedContent,
        contentRevisions,
        mediaAssets,
      },
      null,
      2
    );
  };

  const importDataJSON = (jsonStr: string) => {
    guard('backups.manage');
    try {
      const parsed = JSON.parse(jsonStr) as Partial<Record<string, unknown>>;
      // Committee rows from a foreign or older snapshot can carry the retired cached-name
      // fields; they go through the same normalizer the storage migration uses.
      if (Array.isArray(parsed.committees)) {
        const rows = parsed.committees.map(normalizeCommitteeRow);
        const kept = rows.filter((row): row is Committee => row !== null);
        setCommittees(kept);
        if (kept.length !== rows.length) {
          logAction('Imported Data', 'system', 'import', `${rows.length - kept.length} unreadable committee row(s) skipped during import`);
        }
      }
      if (Array.isArray(parsed.tasks)) setTasks(parsed.tasks as Task[]);
      if (Array.isArray(parsed.submissions)) setSubmissions(parsed.submissions as TaskSubmission[]);
      if (Array.isArray(parsed.scoreLedger)) setScoreLedger(parsed.scoreLedger as ScoreLedgerEntry[]);
      if ('rewardEntries' in parsed) setRewardEntries(asRewardEntries(parsed.rewardEntries));
      if ('rewardPolicy' in parsed) setRewardPolicy(asRewardPolicy(parsed.rewardPolicy));
      if (Array.isArray(parsed.scoreAppeals)) setScoreAppeals(parsed.scoreAppeals as ScoreAppeal[]);
      if (Array.isArray(parsed.applications)) setApplications(parsed.applications as RegistrationApplication[]);
      if (Array.isArray(parsed.formFields)) setFormFields(parsed.formFields as RegistrationFieldConfig[]);
      if (Array.isArray(parsed.seasonEvents)) setSeasonEvents(parsed.seasonEvents as SeasonEvent[]);
      if (Array.isArray(parsed.skillMatrix)) setSkillMatrix(parsed.skillMatrix as SkillMatrixEntry[]);
      if (Array.isArray(parsed.skillRequirements)) setSkillRequirements(parsed.skillRequirements as SkillRequirement[]);
      if (Array.isArray(parsed.courses)) setCourses(parsed.courses as TrainingCourse[]);
      if (Array.isArray(parsed.courseCompletions)) setCourseCompletions(parsed.courseCompletions as CourseCompletion[]);
      if (Array.isArray(parsed.developmentGoals)) setDevelopmentGoals(parsed.developmentGoals as DevelopmentGoal[]);
      if (Array.isArray(parsed.developmentFeedback)) setDevelopmentFeedback(parsed.developmentFeedback as DevelopmentFeedback[]);
      if (Array.isArray(parsed.seasons)) setSeasons(parsed.seasons as ChapterSeason[]);
      if (Array.isArray(parsed.objectives)) setObjectives(parsed.objectives as Objective[]);
      if (Array.isArray(parsed.keyResults)) setKeyResults(parsed.keyResults as KeyResult[]);
      // A snapshot from another device can carry the older page shape; both the draft and the
      // live document are put through the same upgrade the storage migration uses, and a value
      // that is not a page document at all is skipped instead of blanking the site.
      if (parsed.websiteContent) {
        const upgrade = upgradeContentDocument(parsed.websiteContent, REFERENCE_WEBSITE_CONTENT);
        if (upgrade.recognized) setWebsiteContent(upgrade.doc);
      }
      if (parsed.publishedContent) {
        const upgrade = upgradeContentDocument(parsed.publishedContent, REFERENCE_WEBSITE_CONTENT);
        if (upgrade.recognized) setPublishedContent(upgrade.doc);
      }
      if (Array.isArray(parsed.contentRevisions)) setContentRevisions(normalizeRevisionList(parsed.contentRevisions));
      if (Array.isArray(parsed.mediaAssets)) setMediaAssets(normalizeAssetList(parsed.mediaAssets));
      logAction('Imported Data', 'system', 'import', 'Restored a data snapshot');
      return true;
    } catch {
      return false;
    }
  };

  const value: AppContextType = {
    currentUser,
    authStatus: auth.status,
    can,
    users,
    directory: directoryState,
    refreshDirectory,
    addUser,
    updateUser,
    setAccountStatus,
    assignRole,
    deleteUser,
    seedTestAccounts,
    removeTestAccounts,
    committees,
    addCommittee,
    updateCommittee,
    archiveCommittee,
    assignLeader,
    tasks,
    addTask,
    updateTask,
    moveTask,
    reviewTask,
    deleteTask,
    submissions,
    addSubmission,
    reviewSubmission,
    startSubmissionReview,
    scoreLedger,
    addManualPointAdjustment,
    rewardEntries,
    rewardPolicy,
    awardBonus,
    issueWarning,
    reverseRewardEntry,
    acknowledgeWarning,
    updateRewardPolicy,
    scoreAppeals,
    fileScoreAppeal,
    decideScoreAppeal,
    applications,
    registrationQueue: { from: queueSource, error: queueError },
    refreshRegistrationQueue,
    submitApplication,
    updateApplicationStatus,
    formFields,
    updateFormFields,
    seasonEvents,
    addSeasonEvent,
    updateSeasonEvent,
    loadReferenceSeasonPlan,
    skillMatrix,
    updateMemberSkill,
    addMemberSkill,
    skillRequirements,
    addSkillRequirement,
    courses,
    addCourse,
    courseCompletions,
    recordCourseCompletion,
    developmentGoals,
    addDevelopmentGoal,
    updateDevelopmentGoal,
    developmentFeedback,
    addDevelopmentFeedback,
    seasons,
    addSeason,
    updateSeason,
    closeSeason,
    objectives,
    addObjective,
    deleteObjective,
    keyResults,
    addKeyResult,
    deleteKeyResult,
    objectiveRollups,
    notifications,
    markNotificationRead,
    clearAllNotifications,
    email,
    actionPrefs,
    setActionPrefs,
    actionQueue,
    runActionSweep,
    auditLogs,
    logAction,
    websiteContent,
    updateWebsiteContent,
    publishedContent,
    contentRevisions,
    unpublishedChanges,
    publishWebsiteContent,
    discardWebsiteDraft,
    restoreContentRevision,
    mediaLibrary,
    addMediaAsset,
    replaceMediaAsset,
    deleteMediaAsset,
    setImageSlot,
    theme,
    resolvedTheme,
    setTheme,
    resetLocalCache,
    exportDataJSON,
    importDataJSON,
    storageVersion: storageVersion(),
    storageMigration,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextType => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>.');
  return ctx;
};

/**
 * The acting member, for surfaces that only ever render inside <RequireAuth>.
 * Throws instead of inventing a stand-in user, so a session that expired mid-view
 * fails loudly rather than writing rows under the wrong actor.
 */
export const useActor = (): User => {
  const { currentUser } = useApp();
  if (!currentUser) throw new CapabilityError('users.read');
  return currentUser;
};
