/** Server-enforced account lifecycle. The client may display these; it never sets them. */
export type AccountStatus = 'pending_approval' | 'active' | 'rejected' | 'suspended';

export const ACCOUNT_STATUSES: AccountStatus[] = ['pending_approval', 'active', 'rejected', 'suspended'];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending_approval: 'Pending approval',
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
 * A submitted request is reviewable the moment it exists: nothing an applicant does on
 * their own — clicking a link, waiting for a mail — moves it forward. Only a decision does.
 */
export function isDecidable(status: AccountStatus): boolean {
  return status === 'pending_approval';
}

/** The only status that may reach protected ERP surfaces or APIs. */
export function canAccessErp(status: AccountStatus): boolean {
  return status === 'active';
}

/**
 * Browser storage outlives the state machine that wrote it: the removed
 * `pending_email_verification` stage, a blank value a stale form left behind, or anything a build
 * this one does not know introduced. A row holding any of them can neither sign in nor be
 * decided, so readers repair it onto the queue rather than acting on a status with no transition.
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
 * Proving the credential is separate from authorization: a pending or suspended
 * applicant may be shown a status screen, never dashboard content.
 */
export function describeLoginOutcome(status: AccountStatus): { kind: 'granted' | 'blocked'; message: string } {
  switch (status) {
    case 'active':
      return { kind: 'granted', message: '' };
    case 'pending_approval':
      return {
        kind: 'blocked',
        message: 'Your account is waiting for an administrator to review it. You will be notified once a decision is made.',
      };
    case 'rejected':
      return {
        kind: 'blocked',
        message: 'This registration request was not approved. Contact the chapter if you believe this is a mistake.',
      };
    case 'suspended':
      return {
        kind: 'blocked',
        message: 'This account is suspended. Access to the platform has been revoked.',
      };
  }
}
