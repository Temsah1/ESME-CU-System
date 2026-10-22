import type { AuditLogItem, Committee, Role, User } from '../types';
import { ACCOUNT_STATUS_LABELS } from './accountState';
import { canActOn } from './roles';

/**
 * Committee structure and leadership rules, kept away from React so the same checks can be
 * mirrored by the Supabase policies in supabase/migrations.
 *
 * The rule that drove this module: leadership is a reference to an account. Names used to be
 * copied onto the committee row, so every reader (the public site included) displayed the
 * name the committee remembered, not the name the account has now.
 */

export type LeadershipPosition = 'director' | 'head';

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

/** Read through the account, never through a stored copy. */
export function leaderAccount(committee: Committee, position: LeadershipPosition, users: readonly User[]): User | null {
  return accountById(users, position === 'director' ? committee.directorId : committee.headId);
}

export function leadershipFor(
  committee: Committee,
  users: readonly User[]
): Record<LeadershipPosition, User | null> {
  return {
    director: leaderAccount(committee, 'director', users),
    head: leaderAccount(committee, 'head', users),
  };
}

export function seatId(committee: Committee, position: LeadershipPosition): string | undefined {
  return position === 'director' ? committee.directorId : committee.headId;
}

/** A dangling id is a data-integrity finding, not an empty seat: report it, never hide it. */
export function unresolvedLeaders(committee: Committee, users: readonly User[]): LeadershipPosition[] {
  return LEADERSHIP_POSITIONS.filter((position) => {
    const id = seatId(committee, position);
    return id !== undefined && id !== '' && accountById(users, id) === null;
  });
}

export function leadershipPostsOf(
  userId: string,
  committees: readonly Committee[]
): { committee: Committee; position: LeadershipPosition }[] {
  const posts: { committee: Committee; position: LeadershipPosition }[] = [];
  for (const committee of committees) {
    for (const position of LEADERSHIP_POSITIONS) {
      if (seatId(committee, position) === userId) posts.push({ committee, position });
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
 * Who may hold a seat, and what this operation is allowed to touch.
 *
 * Deliberately absent: this never reads or writes `User.role`. A leadership assignment is a
 * committee record; an account's role and its capabilities are a separate privileged
 * operation (`users.role.assign`), so appointing a Head cannot smuggle in elevated access.
 */
export function validateLeadershipAssignment(input: {
  committees: readonly Committee[];
  users: readonly User[];
  committeeId: string;
  position: LeadershipPosition;
  userId: string | null;
  actor: CommitteeActor;
}): AssignmentVerdict {
  const { committees, users, committeeId, position, userId, actor } = input;

  if (!canActOn(actor, 'committees.write', { committeeId })) {
    return { allowed: false, code: 'forbidden', reason: 'Your role does not allow you to change this committee’s leadership.' };
  }

  const committee = committees.find((c) => c.id === committeeId);
  if (!committee) return { allowed: false, code: 'no_committee', reason: 'That committee does not exist.' };

  if (userId === null) return { allowed: true };

  const account = accountById(users, userId);
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

  const otherPosition = position === 'director' ? 'head' : 'director';
  if (seatId(committee, otherPosition) === account.id) {
    return {
      allowed: false,
      code: 'double_seat',
      reason: `${account.name} is already this committee’s ${POSITION_LABELS[otherPosition]}. One person holds one seat.`,
    };
  }

  const elsewhere = leadershipPostsOf(account.id, committees).filter((post) => post.committee.id !== committee.id);
  if (elsewhere.length > 0) {
    return {
      allowed: false,
      code: 'already_leads',
      reason: `${account.name} already leads ${elsewhere.map((p) => `${POSITION_LABELS[p.position]} of ${p.committee.name}`).join(', ')}. Appointing them here would leave two committees claiming the same accountable person.`,
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

export type CommitteeInput = Omit<Committee, 'id' | 'memberCount' | 'updatedAt'>;

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

export function normalizeDraft(draft: CommitteeDraft): CommitteeDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    shortCode: draft.shortCode.trim().toUpperCase(),
    description: draft.description.trim(),
    objectives: draft.objectives.map((o) => o.trim()).filter(Boolean),
    subTeams: draft.subTeams.map((s) => s.trim()).filter(Boolean),
    directorId: draft.directorId ? draft.directorId : undefined,
    headId: draft.headId ? draft.headId : undefined,
  };
}

export type RosterVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; code: string };

/** Moving a member must not silently orphan the seat they may hold elsewhere. */
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
  const seats = leadershipPostsOf(account.id, committees).filter(
    (post) => toCommitteeId === null || post.committee.id !== toCommitteeId
  );
  if (seats.length > 0) {
    return {
      allowed: false,
      code: 'holds_seat',
      reason: `${account.name} is ${seats.map((s) => `${POSITION_LABELS[s.position]} of ${s.committee.name}`).join(', ')}. Reassign the seat first, or the committee would keep listing a leader who no longer belongs to it.`,
    };
  }
  return { allowed: true };
}

/** Used when an account is deleted: the seat empties, the person's other records are untouched. */
export function releaseLeadership(committees: readonly Committee[], userId: string): Committee[] {
  return committees.map((committee) => {
    if (committee.directorId !== userId && committee.headId !== userId) return committee;
    return {
      ...committee,
      directorId: committee.directorId === userId ? undefined : committee.directorId,
      headId: committee.headId === userId ? undefined : committee.headId,
    };
  });
}

export function releasedSeats(committees: readonly Committee[], userId: string): { committeeId: string; position: LeadershipPosition }[] {
  return committees.flatMap((committee) =>
    LEADERSHIP_POSITIONS.filter((position) => seatId(committee, position) === userId).map((position) => ({
      committeeId: committee.id,
      position,
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

/**
 * Reads a stored committee row into the current shape. Cached `directorName` / `headName`
 * values are dropped rather than trusted, and an id that no longer resolves stays in place so
 * `unresolvedLeaders` can report it instead of pretending the seat is empty.
 */
export function normalizeCommitteeRow(raw: unknown): Committee | null {  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  const asText = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
  const asList = (value: unknown) => (Array.isArray(value) ? value.map((v) => asText(v)).filter(Boolean) : []);
  const status = asText(row.status, 'active');
  const category = asText(row.category, 'technical');
  return {
    id: row.id,
    name: asText(row.name),
    shortCode: asText(row.shortCode),
    description: asText(row.description),
    directorId: asText(row.directorId) || undefined,
    headId: asText(row.headId) || undefined,
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
