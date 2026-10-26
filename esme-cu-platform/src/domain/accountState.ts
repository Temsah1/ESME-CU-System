/** Server-enforced account lifecycle. The client may display these; it never sets them. */
export type AccountStatus = 'pending_approval' | 'active' | 'rejected' | 'suspended';

export const ACCOUNT_STATUSES: AccountStatus[] = ['pending_approval', 'active', 'rejected', 'suspended'];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  // The value is the historical name; what it now means is a committee placement nobody has
  // recorded yet. No status in this list gates entry to the chapter — see canAccessErp().
  pending_approval: 'Pending placement',
  active: 'Active',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

/**
 * A transition is legal only if listed here. Anything else — including a browser
 * replaying a stale session or posting a role/status directly — is rejected.
 */
const TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  pending_approval: ['active', 'rejected'],
  active: ['suspended'],
  rejected: ['pending_approval'],
  suspended: ['active', 'rejected'],
};

export function canTransition(from: AccountStatus, to: AccountStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: AccountStatus, to: AccountStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: AccountStatus, to: AccountStatus) {
    super(`Account status transition "${from}" → "${to}" is not allowed.`);
    this.name = 'InvalidStatusTransitionError';
  }
}

/**
 * A submitted request is still reviewable the moment it exists: the queue records the committee
 * placement an applicant asked for, and only a reviewer's decision writes it.
 */
export function isDecidable(status: AccountStatus): boolean {
  return status === 'pending_approval';
}

/**
 * Authentication and directory status are separate questions.
 *
 * Signing up is enough to open the chapter: a member whose placement nobody has recorded yet is
 * still a signed-in member. The two statuses that speak here are sanctions — `rejected` and
 * `suspended` — and an account carrying one is turned away until a reviewer lifts it.
 *
 * This decides *entry*, never authority: what a session may read or write is the role's capability
 * scope (src/domain/roles.ts, mirrored by `esme_has_capability()`), so admitting a pending member
 * cannot widen what an administrator-only operation accepts.
 */
export function canAccessErp(status: AccountStatus): boolean {
  return status === 'active' || status === 'pending_approval';
}

/**
 * Browser storage outlives the state machine that wrote it: the removed
 * `pending_email_verification` stage, a blank value a stale form left behind, or anything a build
 * this one does not know introduced. A reader cannot act on a status with no transition, so it
 * repairs the value onto the placement queue — where the account still signs in and a reviewer can
 * still set it right by name.
 *
 * Repairing is deliberately not a lock-out. A sanction has to be one of the two named values; an
 * unrecognised string is not evidence that anybody revoked this account, and inventing one would
 * turn a schema change into a silent denial of service against every older row.
 */
export function repairStoredStatus(status: string | undefined): AccountStatus {
  return ACCOUNT_STATUSES.includes(status as AccountStatus) ? (status as AccountStatus) : 'pending_approval';
}

/**
 * The recruitment board labels each stage, so a provider status is projected onto it
 * rather than copied: a suspended account was approved once and that approval stays visible.
 */
export function applicationStageFor(
  status: AccountStatus
): 'pending' | 'under_review' | 'accepted' | 'rejected' {
  switch (status) {
    case 'pending_approval':
      return 'under_review';
    case 'active':
    case 'suspended':
      return 'accepted';
    case 'rejected':
      return 'rejected';
  }
}

/**
 * Proving the credential is what opens the workspace; the directory status only closes it again.
 * So a pending placement is a granted sign-in with a note, and the two sanctions are the only
 * answers that keep a correct password out.
 */
export function describeLoginOutcome(status: AccountStatus): { kind: 'granted' | 'blocked'; message: string } {
  switch (status) {
    case 'active':
      return { kind: 'granted', message: '' };
    case 'pending_approval':
      return {
        kind: 'granted',
        message: 'You are signed in. A reviewer still has to record your committee placement.',
      };
    case 'rejected':
      return {
        kind: 'blocked',
        message: 'An authorized reviewer marked this account as not accepted. Contact the chapter if you believe this is a mistake.',
      };
    case 'suspended':
      return {
        kind: 'blocked',
        message: 'This account is suspended. Access to the platform has been revoked.',
      };
  }
}
