import type { AccountStatus } from '../domain/accountState';
import type { Capability, Role } from '../domain/roles';

/**
 * Identity as returned by the trusted side of the integration. The client never
 * constructs this object; it receives it, and it is re-read after every refresh.
 */
export type AuthIdentity = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: Role;
  status: AccountStatus;
  emailVerified: boolean;
  committeeId?: string;
  /** Expanded server-side from the role. Display-only convenience — every check re-reads the matrix. */
  capabilities: Capability[];
};

export type AuthSession = {
  identity: AuthIdentity;
  issuedAt: number;
  expiresAt: number;
};

export type RegistrationDraft = {
  fullName: string;
  email: string;
  username: string;
  password: string;
  confirmPassword: string;
  committeeId?: string;
  acceptedPolicies: boolean;
  /** Captcha Guard token when the project configures one; optional otherwise. */
  captchaToken?: string;
  /**
   * Questionnaire answers travel with the identity so the provider's record is reviewable
   * from any signed-in device, not only the browser that submitted the form.
   */
  studentId?: string;
  academicYear?: string;
  department?: string;
  phone?: string;
  secondCommitteePreferenceId?: string;
  technicalSkills?: string;
  previousExperience?: string;
  motivation?: string;
  availabilityHours?: string;
};

export type RegistrationReceipt = {
  reference: string;
  status: AccountStatus;
  requiresEmailVerification: boolean;
};

/** Field-keyed so a rejected request cannot be used to probe which accounts exist. */
export type RegistrationFailure = {
  code: 'validation' | 'duplicate' | 'rate_limited' | 'unavailable';
  message: string;
  fields?: Partial<Record<keyof RegistrationDraft, string>>;
};

export type RegistrationOutcome =
  | { ok: true; receipt: RegistrationReceipt }
  | { ok: false; failure: RegistrationFailure };

export type Decision = 'approve' | 'reject';

export type RegistrationRecord = {
  id: string;
  fullName: string;
  email: string;
  username: string;
  committeeId?: string;
  assignedCommitteeId?: string;
  submittedAt: string;
  emailVerified: boolean;
  status: AccountStatus;
  decisionBy?: string;
  decisionAt?: string;
  rejectionReason?: string;
  studentId?: string;
  academicYear?: string;
  department?: string;
  phone?: string;
  secondCommitteePreferenceId?: string;
  technicalSkills: string;
  previousExperience: string;
  motivation: string;
  availabilityHours: string;
  agreedToPolicies: boolean;
};

export type AdminActionFailure = { code: string; message: string };

export type AdminActionResult = { ok: true } | { ok: false; error: AdminActionFailure };

/**
 * One interface, two implementations: the real provider and a clearly-labelled
 * local development fallback. Nothing in the UI may assume which one is active
 * except through `kind` and the banner it renders.
 */
export interface AuthAdapter {
  readonly kind: 'supabase' | 'local-dev';
  /** Rendered whenever `kind === 'local-dev'`. Production integrations return an empty string. */
  readonly warningBanner: string;

  restore(): Promise<AuthSession | null>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;

  signIn(identifier: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;

  register(draft: RegistrationDraft): Promise<RegistrationOutcome>;
  resendVerification(email: string): Promise<void>;
  completeEmailVerification(token: string): Promise<AdminActionResult>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(token: string, newPassword: string): Promise<AdminActionResult>;

  listRegistrations(): Promise<RegistrationRecord[]>;
  decideRegistration(
    id: string,
    decision: Decision,
    options?: { reason?: string; committeeId?: string }
  ): Promise<AdminActionResult>;

  setAccountStatus(id: string, status: AccountStatus): Promise<AdminActionResult>;
  assignRole(id: string, role: Role): Promise<AdminActionResult>;

  /**
   * True while no privileged account exists. The bootstrap path is the only way the
   * first Super Admin is created, and it demands an explicit operator-supplied password.
   */
  requiresPrimaryAdminBootstrap(): Promise<boolean>;
  bootstrapPrimaryAdmin(input: {
    fullName: string;
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
  }): Promise<AdminActionResult>;
}
