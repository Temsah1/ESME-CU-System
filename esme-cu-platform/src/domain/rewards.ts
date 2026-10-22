import type { Role, User } from '../types';
import { ROLE_LABELS, ROLE_RANK, canActOn, hasCapability } from './roles';

/**
 * Rewards and discipline share one rule set: an entry is a record, never an edit.
 *
 * Points are not stored as an editable number anywhere in this module — the leaderboard is
 * recomputed from the ledger, so a bonus and its reversal are both visible and the total always
 * explains itself. A warning carries no points: severity is accountability, not currency.
 */

export type RewardKind = 'bonus' | 'warning';

/** Notice → formal → final. The order is what the escalation rule counts on. */
export type WarningSeverity = 'notice' | 'formal' | 'final';

export const WARNING_SEVERITIES: WarningSeverity[] = ['notice', 'formal', 'final'];

export const SEVERITY_LABELS: Record<WarningSeverity, string> = {
  notice: 'Notice',
  formal: 'Formal warning',
  final: 'Final warning',
};

export type RewardEntry = {
  id: string;
  kind: RewardKind;
  /** The account that performed the action — read from the session, never from a form field. */
  actorId: string;
  actorName: string;
  actorRole: Role;
  targetId: string;
  targetName: string;
  /** Frozen at write time so history does not rewrite itself when someone is later promoted. */
  targetRoleAtTime: Role;
  committeeId?: string;
  points: number;
  severity?: WarningSeverity;
  reason: string;
  evidenceUrl?: string;
  issuedAt: string;
  /** Set when the member confirms they have read a warning. Optional by policy. */
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  /** 'active' until a reversing entry points at it, then 'reversed'. The row never changes otherwise. */
  status: 'active' | 'reversed';
  reversedByEntryId?: string;
  /** Duplicate submissions of the same action (a retried click, a replayed request) collapse onto one entry. */
  idempotencyKey: string;
};

export type RewardPolicy = {
  /** Who may perform each action, as a capability grant checked against the actor's role. */
  canAwardBonus: Role[];
  canIssueWarning: Role[];
  maxBonusPointsPerAction: number;
  /** Bonus points allowed per member inside the rolling window, and the window length in days. */
  maxBonusPointsPerMemberPerPeriod: number;
  periodDays: number;
  /** After this many active warnings in the period, the committee's Director and the board are alerted. */
  escalateWarningsAfter: number;
  notifyRolesOnEscalation: Role[];
  updatedAt: string;
  updatedBy: string;
};

export const DEFAULT_REWARD_POLICY: RewardPolicy = {
  canAwardBonus: ['head', 'director', 'high_board', 'super_admin'],
  canIssueWarning: ['head', 'director', 'high_board', 'super_admin'],
  maxBonusPointsPerAction: 25,
  maxBonusPointsPerMemberPerPeriod: 100,
  periodDays: 90,
  escalateWarningsAfter: 3,
  notifyRolesOnEscalation: ['director', 'high_board'],
  updatedAt: '2026-10-19T00:00:00.000Z',
  updatedBy: 'system-default',
};

export type Actor = { id: string; role: Role; committeeId?: string; subTeam?: string };

export type RewardRejection =
  | { allowed: true; warning?: string }
  | { allowed: false; code: string; reason: string };

const LIMITS = { reason: 400, evidenceUrl: 300 } as const;

/** Only http/https can be stored; anything else is a broken or dangerous link, not evidence. */
export function isSafeEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The whole decision, in one place, so the store and the SQL can mirror the same order:
 * capability → who the target is → the kind-specific ceiling → the shape of the record.
 *
 * A Head reaches their own team; a Director reaches their own committee; High Board and Super
 * Admin reach the chapter. Nobody touches themselves, a superior, or an equal — except a Super
 * Admin acting on another Super Admin, and never on the primary administrator account.
 */
export function validateRewardAction(input: {
  kind: RewardKind;
  actor: Actor;
  target: User | null;
  points: number;
  severity?: WarningSeverity;
  reason: string;
  evidenceUrl?: string;
  policy: RewardPolicy;
  entries: readonly RewardEntry[];
  now: string;
  targetIsPrimaryAdmin?: boolean;
}): RewardRejection {
  const { kind, actor, target, points, severity, reason, evidenceUrl, policy, entries, now, targetIsPrimaryAdmin } = input;

  if (!hasCapability(actor.role, 'rewards.write')) {
    return { allowed: false, code: 'forbidden', reason: `${ROLE_LABELS[actor.role]} may not record bonuses or warnings.` };
  }
  const allowedRoles = kind === 'bonus' ? policy.canAwardBonus : policy.canIssueWarning;
  if (!allowedRoles.includes(actor.role)) {
    return {
      allowed: false,
      code: 'policy_disabled',
      reason: `The permission matrix does not let a ${ROLE_LABELS[actor.role]} record a ${kind}. A Super Admin can change that in Settings.`,
    };
  }
  if (!canActOn(actor, 'rewards.write', { committeeId: target?.committeeId })) {
    return { allowed: false, code: 'forbidden', reason: 'This action is outside the committees you can act on.' };
  }
  if (!target) {
    return { allowed: false, code: 'no_target', reason: 'That member is not in the directory, so nothing can be recorded against them.' };
  }
  if (target.id === actor.id) {
    return { allowed: false, code: 'self_target', reason: 'Nobody can award themselves a bonus or issue themselves a warning.' };
  }
  if (targetIsPrimaryAdmin) {
    return { allowed: false, code: 'protected', reason: 'The primary Super Admin account is not a target for rewards or discipline.' };
  }
  if (target.status !== 'active') {
    return { allowed: false, code: 'inactive_target', reason: `${target.name} is not an active account, so this entry would point at nobody.` };
  }

  const actorRank = ROLE_RANK[actor.role];
  const targetRank = ROLE_RANK[target.role];
  const peerSuperAdmin = actor.role === 'super_admin' && target.role === 'super_admin';
  if (targetRank >= actorRank && !peerSuperAdmin) {
    return {
      allowed: false,
      code: 'above_rank',
      reason: `${target.name} is a ${ROLE_LABELS[target.role]} — at or above your level. Actions only travel downwards.`,
    };
  }

  // Committee reach alone is not enough for a Head: their team is the sub-team they lead.
  if (actor.role === 'head' && actor.subTeam && target.subTeam !== actor.subTeam) {
    return {
      allowed: false,
      code: 'outside_team',
      reason: `A Team Head acts inside their own sub-team. ${target.name} sits in ${target.subTeam ? target.subTeam : 'no sub-team'}, not ${actor.subTeam}.`,
    };
  }
  if (actor.role === 'director' && target.committeeId !== actor.committeeId) {
    return {
      allowed: false,
      code: 'outside_committee',
      reason: `A Committee Director acts inside their own committee. ${target.name} belongs to ${target.committeeId ? 'another committee' : 'no committee'}.`,
    };
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return { allowed: false, code: 'no_reason', reason: `A ${kind} without a reason is not a record — write why it was given.` };
  }
  if (trimmedReason.length > LIMITS.reason) {
    return { allowed: false, code: 'reason_length', reason: `Keep the reason to ${LIMITS.reason} characters.` };
  }
  if (evidenceUrl && evidenceUrl.trim()) {
    const url = evidenceUrl.trim();
    if (url.length > LIMITS.evidenceUrl || !isSafeEvidenceUrl(url)) {
      return { allowed: false, code: 'evidence_url', reason: 'Evidence must be a short http(s) link.' };
    }
  }

  if (kind === 'bonus') {
    if (!Number.isFinite(points) || points <= 0 || !Number.isInteger(points)) {
      return { allowed: false, code: 'bad_points', reason: 'A bonus is a whole number of points above zero.' };
    }
    if (points > policy.maxBonusPointsPerAction) {
      return {
        allowed: false,
        code: 'over_action_cap',
        reason: `The limit is ${policy.maxBonusPointsPerAction} points per action. A Super Admin can raise it in the permission matrix.`,
      };
    }
    const inPeriod = entriesInPeriod(entries, target.id, 'bonus', policy.periodDays, now);
    const periodTotal = inPeriod.reduce((sum, e) => sum + e.points, 0);
    if (periodTotal + points > policy.maxBonusPointsPerMemberPerPeriod) {
      return {
        allowed: false,
        code: 'over_period_cap',
        reason: `${target.name} already has ${periodTotal} bonus points in this ${policy.periodDays}-day window; the ceiling is ${policy.maxBonusPointsPerMemberPerPeriod}.`,
      };
    }
    if (inPeriod.length >= 5) {
      return {
        allowed: true,
        warning: `${target.name} has received ${inPeriod.length} bonuses in ${policy.periodDays} days. That is worth a look before another.`,
      };
    }
    return { allowed: true };
  }

  if (!severity || !WARNING_SEVERITIES.includes(severity)) {
    return { allowed: false, code: 'bad_severity', reason: 'Choose a severity: notice, formal or final.' };
  }
  const activeWarnings = entriesInPeriod(entries, target.id, 'warning', policy.periodDays, now);
  const nextNumber = activeWarnings.length + 1;
  if (nextNumber >= policy.escalateWarningsAfter) {
    return {
      allowed: true,
      warning: `This is warning ${nextNumber} in ${policy.periodDays} days, so ${policy.notifyRolesOnEscalation.map((r) => ROLE_LABELS[r]).join(' and ')} will be alerted.`,
    };
  }
  return { allowed: true };
}

/** Rolling window, measured backwards from `now`, counting active entries only. */
export function entriesInPeriod(
  entries: readonly RewardEntry[],
  targetId: string,
  kind: RewardKind,
  periodDays: number,
  now: string
): RewardEntry[] {
  const cutoff = new Date(now).getTime() - periodDays * 24 * 60 * 60 * 1000;
  return entries.filter(
    (e) =>
      e.targetId === targetId &&
      e.kind === kind &&
      e.status === 'active' &&
      // A withdrawal names the entry it withdraws. It is a correction, not another warning, so it
      // must not push the member over the escalation threshold by existing.
      !(kind === 'warning' && e.reversedByEntryId) &&
      new Date(e.issuedAt).getTime() >= cutoff
  );
}

/**
 * Two requests that mean the same action must produce one record. The key is supplied by the
 * caller that starts the action (a click, a queue drain), never generated per attempt.
 */
export function findByIdempotencyKey(entries: readonly RewardEntry[], key: string): RewardEntry | undefined {
  return entries.find((e) => e.idempotencyKey === key);
}

/** Reversing is an append. The original keeps its text and gains a pointer, so the trail stays readable. */
export function applyReversal(entries: readonly RewardEntry[], reversal: RewardEntry): RewardEntry[] {
  const target = entries.find((e) => e.id === reversal.reversedByEntryId);
  if (!target) throw new Error('That entry does not exist, so it cannot be reversed.');
  if (target.status === 'reversed') throw new Error('That entry has already been reversed.');
  if (reversal.kind !== target.kind) throw new Error('A reversal answers one kind of entry, not another.');
  if (reversal.kind === 'bonus' && reversal.points >= 0) {
    throw new Error('A reversing bonus entry has to carry the negative of what it undoes.');
  }
  if (reversal.kind === 'warning' && reversal.points !== 0) {
    throw new Error('A reversing warning entry carries no points — it withdraws the warning.');
  }
  return [...entries.map((e) => (e.id === target.id ? { ...e, status: 'reversed' as const, reversedByEntryId: reversal.id } : e)), reversal];
}

/** Points come from the ledger, nothing else. A missing entry means the balance is what it is. */
export function bonusPointsOf(entries: readonly RewardEntry[], memberId: string): number {
  return entries.filter((e) => e.targetId === memberId && e.kind === 'bonus' && e.status === 'active').reduce((sum, e) => sum + e.points, 0);
}

export function activeWarningsOf(entries: readonly RewardEntry[], memberId: string): RewardEntry[] {
  return entries.filter((e) => e.targetId === memberId && e.kind === 'warning' && e.status === 'active' && !e.reversedByEntryId);
}

/** Who must be told, given the policy: the committee Director plus the configured notify roles. */
export function escalationRecipients(
  entries: readonly RewardEntry[],
  policy: RewardPolicy,
  target: User,
  now: string
): { role: Role; committeeId?: string }[] {
  const active = entriesInPeriod(entries, target.id, 'warning', policy.periodDays, now);
  if (active.length < policy.escalateWarningsAfter) return [];
  return policy.notifyRolesOnEscalation.map((role) => ({ role, committeeId: role === 'director' ? target.committeeId : undefined }));
}

/** Thrown by the store when a reward action is refused, so the form can show which rule answered. */
export class RewardRefusedError extends Error {
  readonly code: string;

  constructor(code: string, reason: string) {
    super(reason);
    this.name = 'RewardRefusedError';
    this.code = code;
  }
}

/** The number this new warning would be inside the window, which is what the escalation rule compares. */
export function warningNumberAfter(
  entries: readonly RewardEntry[],
  targetId: string,
  policy: RewardPolicy,
  now: string
): number {
  return entriesInPeriod(entries, targetId, 'warning', policy.periodDays, now).length + 1;
}

export type PolicyRejection = { field: keyof RewardPolicy; message: string };

/**
 * The matrix is a control, so its limits have limits: caps have to stay whole and positive, the
 * window has to be long enough to mean something, and the escalation threshold has to be reachable.
 */
export function validatePolicyEdit(draft: RewardPolicy): PolicyRejection[] {
  const errors: PolicyRejection[] = [];
  if (!Number.isInteger(draft.maxBonusPointsPerAction) || draft.maxBonusPointsPerAction < 1 || draft.maxBonusPointsPerAction > 500) {
    errors.push({ field: 'maxBonusPointsPerAction', message: 'The per-action cap must be a whole number between 1 and 500.' });
  }
  if (!Number.isInteger(draft.maxBonusPointsPerMemberPerPeriod) || draft.maxBonusPointsPerMemberPerPeriod < 1) {
    errors.push({ field: 'maxBonusPointsPerMemberPerPeriod', message: 'The period ceiling must be a whole number of points.' });
  }
  if (!Number.isInteger(draft.periodDays) || draft.periodDays < 7 || draft.periodDays > 365) {
    errors.push({ field: 'periodDays', message: 'The rolling window has to be between 7 and 365 days.' });
  }
  if (!Number.isInteger(draft.escalateWarningsAfter) || draft.escalateWarningsAfter < 1 || draft.escalateWarningsAfter > 10) {
    errors.push({ field: 'escalateWarningsAfter', message: 'Escalate between 1 and 10 warnings.' });
  }
  if (draft.periodDays < 30 && draft.escalateWarningsAfter > 2) {
    errors.push({ field: 'periodDays', message: 'A window shorter than a month cannot reasonably wait for three warnings.' });
  }
  if (draft.maxBonusPointsPerMemberPerPeriod < draft.maxBonusPointsPerAction) {
    errors.push({
      field: 'maxBonusPointsPerMemberPerPeriod',
      message: 'The period ceiling has to sit at or above the per-action cap, or a single allowed bonus would not fit.',
    });
  } else if (draft.maxBonusPointsPerMemberPerPeriod < 3 * draft.maxBonusPointsPerAction) {
    errors.push({
      field: 'maxBonusPointsPerMemberPerPeriod',
      message: `At ${draft.maxBonusPointsPerMemberPerPeriod} points per ${draft.periodDays} days, three ordinary bonuses of ${draft.maxBonusPointsPerAction} points would not fit.`,
    });
  }
  if (draft.canAwardBonus.length === 0) {
    errors.push({ field: 'canAwardBonus', message: 'At least one role has to be able to award a bonus, or the control is a dead end.' });
  }
  if (draft.canIssueWarning.some((r) => !draft.canAwardBonus.includes(r) && r !== 'super_admin' && r !== 'high_board')) {
    errors.push({ field: 'canIssueWarning', message: 'A role that can warn but never reward reads as a punishment switch, not a policy.' });
  }
  if (!draft.notifyRolesOnEscalation.includes('director') && draft.notifyRolesOnEscalation.length === 0) {
    errors.push({ field: 'notifyRolesOnEscalation', message: 'Escalation has to tell somebody.' });
  }
  return errors;
}
