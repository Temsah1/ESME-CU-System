/** Server-enforced account lifecycle. The client may display these; it may never set them. */
export type AccountStatus =
  | 'pending_email_verification'
  | 'pending_approval'
  | 'active'
  | 'rejected'
  | 'suspended';

export const ACCOUNT_STATUSES: AccountStatus[] = [
  'pending_email_verification',
  'pending_approval',
  'active',
  'rejected',
  'suspended',
];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  pending_email_verification: 'Pending email verification',
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
  pending_email_verification: ['pending_approval', 'rejected'],
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

/** Verified email is a precondition for approval, not a grant of access. */
export function isEligibleForApproval(
  status: AccountStatus,
  emailVerified: boolean
): boolean {
  return status === 'pending_approval' && emailVerified;
}

/** The only status that may reach protected ERP surfaces or APIs. */
export function canAccessErp(status: AccountStatus): boolean {
  return status === 'active';
}

/**
 * The recruitment board labels each stage, so a provider status is projected onto it
 * rather than copied: a suspended account was approved once and that approval stays visible.
 */
export function applicationStageFor(
  status: AccountStatus
): 'pending' | 'under_review' | 'accepted' | 'rejected' {
  switch (status) {
    case 'pending_email_verification':
      return 'pending';
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
 * Credential verification is separate from authorization: a pending or suspended
 * applicant may be shown a status screen, never dashboard content.
 */
export function describeLoginOutcome(
  status: AccountStatus,
  emailVerified: boolean
): { kind: 'granted' | 'blocked'; message: string } {
  switch (status) {
    case 'active':
      return { kind: 'granted', message: '' };
    case 'pending_email_verification':
      return {
        kind: 'blocked',
        message: emailVerified
          ? 'Your email is verified. An administrator still needs to approve your account.'
          : 'Check your inbox to verify your email address, then wait for approval.',
      };
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
