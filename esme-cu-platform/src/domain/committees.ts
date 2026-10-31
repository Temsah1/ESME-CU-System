import type {
  AuditLogItem,
  Committee,
  CommitteeAssignment,
  CommitteePosition,
  Role,
  User,
} from '../types';
import { ACCOUNT_STATUS_LABELS } from './accountState';
import { canActOn } from './roles';

/**
 * Committee structure and leadership rules, kept away from React so the same checks can be
 * mirrored by the Supabase policies in supabase/migrations.
 *
 * Leadership is a list of assignments, not two seats. The database table
 * `esme_leadership_seats` holds one row per (committee, position, profile), so a committee can
 * have any number of Heads and Directors and one person can hold both roles or lead several
 * committees. Nothing in this module caps a list: the only refusals are authorization,
 * eligibility and duplicate-assignment checks.
 */

export type LeadershipPosition = CommitteePosition;

export const LEADERSHIP_POSITIONS: LeadershipPosition[] = ['director', 'head'];

export const POSITION_LABELS: Record<LeadershipPosition, string> = {
  director: 'Director',
  head: 'Head',
};

export const COMMITTEE_CATEGORIES = ['technical', 'media', 'marketing', 'operations', 'management'] as const;
export const COMMITTEE_STATUSES = ['active', 'archived'] as const;

export const LIMITS = {
  name: 80,
  shortCode: 8,
  description: 600,
  objectives: 12,
  subTeams: 12,
  subTeamLength: 60,
} as const;

/** The acting account. Capabilities are read from the role, never from what the form claims. */
export type CommitteeActor = { role: Role; id: string; committeeId?: string };

/**
 * Carries field-level problems to the form so a rejected save can point at the input that
 * caused it instead of showing one generic failure.
 */
export class CommitteeValidationProblem extends Error {
  readonly issues: DraftIssue[];

  constructor(issues: DraftIssue[]) {
    super(issues[0]?.message ?? 'This committee record is not valid.');
    this.name = 'CommitteeValidationProblem';
    this.issues = issues;
  }
}

/** A refused leadership or roster change, with the rule that refused it. */
export class CommitteeOperationProblem extends Error {
  readonly code: string;

  constructor(code: string, reason: string) {
    super(reason);
    this.name = 'CommitteeOperationProblem';
    this.code = code;
  }
}

export function asCommitteeProblem(error: unknown): { code: string; reason: string; field?: DraftField; issues?: DraftIssue[] } {
  if (error instanceof CommitteeValidationProblem) {
    return { code: 'invalid', reason: error.message, field: error.issues[0]?.field, issues: error.issues };
  }
  if (error instanceof CommitteeOperationProblem) return { code: error.code, reason: error.message };
  if (error instanceof Error) return { code: 'failed', reason: error.message };
  return { code: 'failed', reason: 'That change was refused.' };
}

const accountById = (users: readonly User[], id?: string): User | null =>
  id === undefined || id === '' ? null : users.find((u) => u.id === id) ?? null;

export function assignmentsFor(committee: Committee, position: LeadershipPosition): CommitteeAssignment[] {
  return committee.assignments.filter((assignment) => assignment.position === position);
}

export function assignedProfileIds(committee: Committee, position: LeadershipPosition): string[] {
  return assignmentsFor(committee, position).map((assignment) => assignment.profileId);
}

export type ResolvedAssignment = {
  assignment: CommitteeAssignment;
  account: User | null;
};

/** Every assignment in the position, including ids the directory cannot resolve. */
export function leaderAccounts(
  committee: Committee,
  position: LeadershipPosition,
  users: readonly User[]
): ResolvedAssignment[] {
  return assignmentsFor(committee, position).map((assignment) => ({
    assignment,
    account: accountById(users, assignment.profileId),
  }));
}

/** The first resolvable holder, kept for compact summaries. Full lists use leaderAccounts(). */
export function leaderAccount(committee: Committee, position: LeadershipPosition, users: readonly User[]): User | null {
  return leaderAccounts(committee, position, users).find((entry) => entry.account !== null)?.account ?? null;
}

export function leaderNames(committee: Committee, position: LeadershipPosition, users: readonly User[]): string[] {
  return leaderAccounts(committee, position, users).map(
    ({ assignment, account }) => account?.name ?? `Unknown account (${assignment.profileId})`
  );
}

/** A dangling id is a data-integrity finding, not an empty seat: report it, never hide it. */
export function unresolvedAssignments(
  committee: Committee,
  users: readonly User[]
): { position: LeadershipPosition; profileId: string }[] {
  return LEADERSHIP_POSITIONS.flatMap((position) =>
    leaderAccounts(committee, position, users)
      .filter(({ account }) => account === null)
      .map(({ assignment }) => ({ position, profileId: assignment.profileId }))
  );
}

export function unresolvedLeaders(committee: Committee, users: readonly User[]): LeadershipPosition[] {
  return LEADERSHIP_POSITIONS.filter((position) =>
    leaderAccounts(committee, position, users).some(({ account }) => account === null)
  );
}

export function leadershipPostsOf(
  userId: string,
  committees: readonly Committee[]
): { committee: Committee; position: LeadershipPosition; profileId: string }[] {
  const posts: { committee: Committee; position: LeadershipPosition; profileId: string }[] = [];
  for (const committee of committees) {
    for (const assignment of committee.assignments) {
      if (assignment.profileId === userId) {
        posts.push({ committee, position: assignment.position, profileId: userId });
      }
    }
  }
  return posts;
}

/**
 * Membership is read from the account. One committee per account is what `User.committeeId`
 * already stores, so the roster cannot disagree with the directory.
 */
export function rosterOf(committeeId: string, users: readonly User[]): User[] {
  return users.filter((u) => u.committeeId === committeeId);
}

export type AssignmentVerdict =
  | { allowed: true; warning?: string }
  | { allowed: false; reason: string; code: string };

/**
 * Who may hold an assignment.
 *
 * Deliberately absent: this never reads or writes `User.role`. A leadership assignment is a
 * committee record; an account's role and its capabilities are a separate privileged
 * operation (`users.role.assign`), so appointing a Head cannot smuggle in elevated access.
 *
 * Also absent: any maximum. A person may hold both positions in one committee or lead several
 * committees; the only refusals are the capability check, an inactive account and an exact
 * duplicate (same committee, same position, same person).
 */
export function validateLeadershipAssignment(input: {
  committees: readonly Committee[];
  users: readonly User[];
  committeeId: string;
  position: LeadershipPosition;
  profileId: string;
  actor: CommitteeActor;
}): AssignmentVerdict {
  const { committees, users, committeeId, position, profileId, actor } = input;

  if (!canActOn(actor, 'committees.write', { committeeId })) {
    return { allowed: false, code: 'forbidden', reason: 'Your role does not allow you to change this committee’s leadership.' };
  }

  const committee = committees.find((c) => c.id === committeeId);
  if (!committee) return { allowed: false, code: 'no_committee', reason: 'That committee does not exist.' };

  if (!profileId) return { allowed: false, code: 'no_account', reason: 'Choose an account to appoint.' };

  const account = accountById(users, profileId);
  if (!account) {
    return { allowed: false, code: 'no_account', reason: 'That account does not exist, so it cannot be appointed.' };
  }
  if (account.status !== 'active') {
    return {
      allowed: false,
      code: 'inactive',
      reason: `${account.name} is ${ACCOUNT_STATUS_LABELS[account.status].toLowerCase()} — only an active account may hold a seat.`,
    };
  }

  if (assignedProfileIds(committee, position).includes(account.id)) {
    return {
      allowed: false,
      code: 'already_assigned',
      reason: `${account.name} is already ${position === 'director' ? 'a Director' : 'a Head'} of ${committee.name}.`,
    };
  }

  const otherPosition: LeadershipPosition = position === 'director' ? 'head' : 'director';
  if (assignedProfileIds(committee, otherPosition).includes(account.id)) {
    return {
      allowed: true,
      warning: `${account.name} also holds the ${POSITION_LABELS[otherPosition]} assignment here. The two assignments are independent.`,
    };
  }

  if (account.committeeId !== undefined && account.committeeId !== committee.id) {
    return {
      allowed: true,
      warning: `${account.name} belongs to another committee. Appointing them does not move their membership — transfer it from the members directory if the seat should also move them.`,
    };
  }

  return { allowed: true };
}

export type CommitteeInput = Omit<Committee, 'id' | 'memberCount' | 'updatedAt' | 'assignments'>;

export type DraftField = 'name' | 'shortCode' | 'description' | 'category' | 'status' | 'objectives' | 'subTeams';

export type DraftIssue = { field: DraftField; message: string };

export type CommitteeDraft = CommitteeInput;

/**
 * Validation runs on the stored write, not only in the form, so a request that skips the
 * interface is held to the same rules.
 */
export function validateCommitteeDraft(
  draft: CommitteeDraft,
  committees: readonly Committee[],
  editingId?: string
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const name = draft.name.trim();
  const shortCode = draft.shortCode.trim().toUpperCase();

  if (name.length === 0) issues.push({ field: 'name', message: 'A committee needs a name.' });
  if (name.length > LIMITS.name) issues.push({ field: 'name', message: `Keep the name to ${LIMITS.name} characters.` });
  if (!/^[A-Z0-9][A-Z0-9&.+/ -]{1,7}$/.test(shortCode)) {
    issues.push({ field: 'shortCode', message: 'The acronym is 2-8 characters: letters, digits and & . + / space.' });
  }
  if (draft.description.trim().length === 0) {
    issues.push({ field: 'description', message: 'Write what this committee is accountable for.' });
  }
  if (draft.description.trim().length > LIMITS.description) {
    issues.push({ field: 'description', message: `Keep the description to ${LIMITS.description} characters.` });
  }
  if (!COMMITTEE_CATEGORIES.includes(draft.category)) issues.push({ field: 'category', message: 'Choose one of the recorded categories.' });
  if (!COMMITTEE_STATUSES.includes(draft.status)) issues.push({ field: 'status', message: 'A committee is active or archived.' });
  if (draft.objectives.length > LIMITS.objectives) {
    issues.push({ field: 'objectives', message: `${LIMITS.objectives} objectives maximum.` });
  }
  if (draft.subTeams.length > LIMITS.subTeams) {
    issues.push({ field: 'subTeams', message: `${LIMITS.subTeams} sub-teams maximum.` });
  }
  if (draft.subTeams.some((s) => s.trim().length > LIMITS.subTeamLength)) {
    issues.push({ field: 'subTeams', message: `Keep each sub-team name to ${LIMITS.subTeamLength} characters.` });
  }

  const clash = committees.find(
    (c) => c.id !== editingId && (c.name.trim().toLowerCase() === name.toLowerCase() || c.shortCode.trim().toUpperCase() === shortCode)
  );
  if (clash) {
    const nameClash = clash.name.trim().toLowerCase() === name.toLowerCase();
    issues.push({
      field: nameClash ? 'name' : 'shortCode',
      message: `${clash.shortCode} already uses that ${nameClash ? 'name' : 'acronym'}. Two committees cannot share one identity.`,
    });
  }

  return issues;
}

export function normalizeDraft(draft: CommitteeInput): CommitteeInput {
  return {
    ...draft,
    name: draft.name.trim(),
    shortCode: draft.shortCode.trim().toUpperCase(),
    description: draft.description.trim(),
    objectives: draft.objectives.map((o) => o.trim()).filter(Boolean),
    subTeams: draft.subTeams.map((s) => s.trim()).filter(Boolean),
  };
}

export type RosterVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; code: string };

/**
 * Moving a member. Leadership assignments are independent rows, so a home-committee change
 * no longer has to be refused because the person holds a seat: the assignment stays attached
 * to the committee it names. The move still requires users.update reach and an active account.
 */
export function validateRosterMove(input: {
  committees: readonly Committee[];
  users: readonly User[];
  userId: string;
  toCommitteeId: string | null;
  actor: CommitteeActor;
}): RosterVerdict {
  const { committees, users, userId, toCommitteeId, actor } = input;
  const account = accountById(users, userId);
  if (!account) return { allowed: false, code: 'no_account', reason: 'That account does not exist.' };
  if (toCommitteeId !== null && !committees.find((c) => c.id === toCommitteeId)) {
    return { allowed: false, code: 'no_committee', reason: 'That committee does not exist.' };
  }
  if (!canActOn(actor, 'users.update', { committeeId: account.committeeId })) {
    return { allowed: false, code: 'forbidden', reason: 'Your role does not allow you to move this account.' };
  }
  if (toCommitteeId !== null && account.status !== 'active') {
    return {
      allowed: false,
      code: 'inactive',
      reason: `${account.name} is ${ACCOUNT_STATUS_LABELS[account.status].toLowerCase()}. Only an active account is given a committee home.`,
    };
  }
  return { allowed: true };
}

/** Used when an account is deleted: every assignment it held empties; other rows are untouched. */
export function releaseLeadership(committees: readonly Committee[], userId: string): Committee[] {
  return committees.map((committee) => {
    const assignments = committee.assignments.filter((assignment) => assignment.profileId !== userId);
    return assignments.length === committee.assignments.length ? committee : { ...committee, assignments };
  });
}

export function releasedSeats(
  committees: readonly Committee[],
  userId: string
): { committeeId: string; position: LeadershipPosition; profileId: string }[] {
  return committees.flatMap((committee) =>
    committee.assignments
      .filter((assignment) => assignment.profileId === userId)
      .map((assignment) => ({
        committeeId: committee.id,
        position: assignment.position,
        profileId: assignment.profileId,
      }))
  );
}

/**
 * A read-modify-write against a row somebody else changed must fail rather than overwrite.
 * Rows written before this stamp existed have none and are accepted once.
 */
export function isStaleWrite(committee: Committee, expectedUpdatedAt?: string): boolean {
  if (committee.updatedAt === undefined) return false;
  return expectedUpdatedAt !== committee.updatedAt;
}

export const LEADERSHIP_AUDIT_PREFIX = 'Committee Leadership';

export function leadershipHistory(audit: readonly AuditLogItem[], committeeId: string): AuditLogItem[] {
  return audit.filter(
    (entry) => entry.targetType === 'committee' && entry.targetId === committeeId && entry.action.startsWith(LEADERSHIP_AUDIT_PREFIX)
  );
}

const asPosition = (value: unknown): LeadershipPosition | null =>
  value === 'director' || value === 'head' ? value : null;

/**
 * Reads a stored committee row into the current shape. Cached `directorName` / `headName`
 * values are dropped rather than trusted, and an id that no longer resolves stays in place so
 * `unresolvedAssignments` can report it instead of pretending the seat is empty.
 *
 * Rows cached by an older build carry `directorId` / `headId`; they are converted into
 * assignments on read so a browser upgrade does not lose an existing holder.
 */
export function normalizeCommitteeRow(raw: unknown): Committee | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  const asText = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
  const asList = (value: unknown) => (Array.isArray(value) ? value.map((v) => asText(v)).filter(Boolean) : []);

  const assignments: CommitteeAssignment[] = [];
  const seen = new Set<string>();
  const push = (profileId: unknown, position: unknown, assignedAt?: unknown) => {
    const id = asText(profileId);
    const seat = asPosition(position);
    if (!id || !seat) return;
    const key = `${seat}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    assignments.push({
      profileId: id,
      position: seat,
      assignedAt: typeof assignedAt === 'string' && assignedAt.length > 0 ? assignedAt : undefined,
    });
  };

  if (Array.isArray(row.assignments)) {
    for (const entry of row.assignments) {
      if (typeof entry !== 'object' || entry === null) continue;
      const assignment = entry as Record<string, unknown>;
      push(
        assignment.profileId ?? assignment.profile_id,
        assignment.position,
        assignment.assignedAt ?? assignment.assigned_at
      );
    }
  }
  // Legacy rows from the two-column shape.
  push(row.directorId, 'director');
  push(row.headId, 'head');

  const status = asText(row.status, 'active');
  const category = asText(row.category, 'technical');
  return {
    id: row.id,
    name: asText(row.name),
    shortCode: asText(row.shortCode),
    description: asText(row.description),
    assignments,
    memberCount: typeof row.memberCount === 'number' ? row.memberCount : undefined,
    objectives: asList(row.objectives),
    subTeams: asList(row.subTeams),
    isPublic: row.isPublic !== false,
    status: status === 'archived' ? 'archived' : 'active',
    category: (COMMITTEE_CATEGORIES as readonly string[]).includes(category) ? (category as Committee['category']) : 'technical',
    updatedAt: asText(row.updatedAt) || undefined,
  };
}

/**
 * The committees an applicant may pick, taken from the same rows the homepage publishes and
 * narrowed by the two flags the chapter already documents: an archived committee is history, and
 * a committee kept off the public site is not a place a stranger is sent. Ids are de-duplicated
 * because the queue merges the provider's rows with the cached list, and one committee appearing
 * twice on a signup form is two answers to the same question.
 */
export function registrationCommitteeOptions(committees: readonly Committee[]): Committee[] {
  const seen = new Set<string>();
  return committees.filter((committee) => {
    if (committee.status !== 'active' || !committee.isPublic) return false;
    if (seen.has(committee.id)) return false;
    seen.add(committee.id);
    return true;
  });
}

/** Case, spacing and punctuation aside, "High Board" names one committee, however it was typed. */
export function committeeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Used before adding a committee to a stored list, so a differently spelled duplicate is never created. */
export function hasCommitteeNamed(committees: readonly { id?: string; name?: string }[], wanted: string): boolean {
  const key = committeeNameKey(wanted);
  return committees.some(
    (row) => typeof row?.name === 'string' && committeeNameKey(row.name) === key
  );
}
