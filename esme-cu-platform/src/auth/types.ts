import type { AccountStatus } from '../domain/accountState';
import type { EmailPreferences } from '../domain/email';
import type { Capability, Role } from '../domain/roles';
import type { RewardKind, RewardEntry, WarningSeverity } from '../domain/rewards';
import type { TestAccountReport } from '../domain/testAccounts';

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
  /** 'yes' / 'no' — the answer that decides whether `committeeId` is required. */
  committeeMembership?: string;
  secondCommitteePreferenceId?: string;
  technicalSkills?: string;
  previousExperience?: string;
  motivation?: string;
  availabilityHours?: string;
};

export type RegistrationReceipt = {
  reference: string;
  status: AccountStatus;
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
  status: AccountStatus;
  decisionBy?: string;
  decisionAt?: string;
  rejectionReason?: string;
  studentId?: string;
  academicYear?: string;
  department?: string;
  phone?: string;
  committeeMembership?: string;
  secondCommitteePreferenceId?: string;
  technicalSkills: string;
  previousExperience: string;
  motivation: string;
  availabilityHours: string;
  agreedToPolicies: boolean;
};

export type AdminActionFailure = { code: string; message: string };

export type AdminActionResult = { ok: true } | { ok: false; error: AdminActionFailure };

/** The committees a test-account seed may seat someone in, as the caller's workspace knows them. */
export type TestAccountCommitteeSource = { id: string; shortCode?: string; name?: string };

/**
 * An account exactly as the provider stores it. The ERP directory is merged from these
 * rows: a person's name, role, status and committee come from the provider and nowhere
 * else, so renaming or approving an account updates every screen at once instead of
 * leaving a copy behind on a committee row.
 *
 * Only the fields that decide identity and eligibility are here. Soft profile fields
 * (department, academic year, phone) stay with the ERP record that owns them.
 */
export type AuthAccount = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: Role;
  status: AccountStatus;
  committeeId?: string;
  /** ISO instant the provider opened the account; shown instead of the ERP's own date stamp. */
  createdAt: string;
};

/**
 * A reward row as the provider filed it.
 *
 * The two names an officer reads on the ledger — who filed it and who it is about — are deliberately
 * absent. `esme_reward_entries` stores ids plus the roles frozen at write time, and a display name
 * belongs to the directory, so the caller fills these two strings from accounts it can already read
 * rather than the adapter issuing a second query for a label.
 */
export type RewardWriteReceipt = {
  id: string;
  kind: RewardKind;
  actorId: string;
  actorRole: Role;
  targetId: string;
  targetRoleAtTime: Role;
  committeeId?: string;
  points: number;
  severity?: WarningSeverity;
  reason: string;
  evidenceUrl?: string;
  issuedAt: string;
  status: 'active' | 'reversed';
  reversedByEntryId?: string;
  idempotencyKey: string;
};

export type BonusWrite = {
  targetId: string;
  points: number;
  reason: string;
  evidenceUrl?: string;
  idempotencyKey: string;
  /**
   * The target exactly as this workspace's directory holds them. `esme_award_bonus()` ignores both
   * fields — it reads the profile row by id and freezes the role inside the transaction — and the
   * offline adapter uses them, because it has no profile table of its own.
   */
  targetRole: Role;
  targetCommitteeId?: string;
};

export type WarningWrite = {
  targetId: string;
  severity: WarningSeverity;
  reason: string;
  evidenceUrl?: string;
  idempotencyKey: string;
  targetRole: Role;
  targetCommitteeId?: string;
};

export type RewardWriteResult = { ok: true; receipt: RewardWriteReceipt } | { ok: false; error: AdminActionFailure };

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

  /**
   * Tell the provider a session opened, so it can decide whether the member gets a sign-in
   * alert. The database owns the address, the wording and the rate limit; a browser only
   * reports the fact. Must never reject — an alert that fails to raise cannot break sign-in.
   */
  reportSignIn(input: { device: string; occurredAt: string }): Promise<void>;

  /**
   * What this account has asked to be mailed about. With a real provider the row lives on the
   * server because that is the copy the sender reads before it mails — a preference kept only in
   * this browser would be honoured on one device and ignored on every other. Null means the
   * account has never chosen, which the caller renders as the defaults.
   */
  readEmailPreferences(): Promise<EmailPreferences | null>;
  saveEmailPreferences(prefs: EmailPreferences): Promise<AdminActionResult>;

  signIn(identifier: string, password: string): Promise<AuthSession>;
  signOut(): Promise<void>;

  register(draft: RegistrationDraft): Promise<RegistrationOutcome>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(token: string, newPassword: string): Promise<AdminActionResult>;

  listRegistrations(): Promise<RegistrationRecord[]>;

  /**
   * The accounts this actor is allowed to see. The provider decides that list —
   * row level security in production, the session's capability locally — and a
   * hand-made request cannot widen it.
   *
   * Every leadership selector, roster move and member search reads from here, which
   * is what makes "assign a Head who does not exist" impossible instead of a typo
   * that saves happily until the next reload.
   */
  listAccounts(): Promise<AuthAccount[]>;
  decideRegistration(
    id: string,
    decision: Decision,
    options?: { reason?: string; committeeId?: string }
  ): Promise<AdminActionResult>;

  setAccountStatus(id: string, status: AccountStatus): Promise<AdminActionResult>;
  assignRole(id: string, role: Role): Promise<AdminActionResult>;

  /**
   * The reward ledger is written here, not in the caller. `esme_award_bonus()`, `esme_issue_warning()`,
   * `esme_reverse_reward_entry()` and `esme_acknowledge_warning()` are the only paths into
   * `esme_reward_entries` — the table revokes insert/update from `authenticated` and a guard trigger
   * refuses a direct write — so the cap, the rank check, the committee scope and the idempotency key
   * are re-decided inside the database session against the JWT's role, not against anything a request
   * body claims. A refusal returns `{ ok: false }`; nothing was filed, and the caller must not write
   * its own copy of the record.
   *
   * The `original` and `entry` fields are the offline ledger the local adapter is handed because it
   * has no rows of its own; the Supabase adapter ignores both and reads the row by id, so a caller
   * cannot edit the record it is asking to correct by editing what it passes here.
   */
  awardBonus(write: BonusWrite): Promise<RewardWriteResult>;
  issueWarning(write: WarningWrite): Promise<RewardWriteResult>;
  reverseRewardEntry(write: { entryId: string; reason: string; original: RewardEntry }): Promise<RewardWriteResult>;
  acknowledgeWarning(entry: RewardEntry): Promise<AdminActionResult>;

  /**
   * The three testers that let a reviewer see the workspace through a Head's, a Director's or a
   * Member's eyes. Seeding adds the missing ones and re-applies the password, role and committee
   * of the ones that exist; it refuses an identity that belongs to a real account instead of
   * taking it over. `removeTestAccounts()` deletes exactly those rows and nothing else.
   *
   * Both are environment-gated inside the adapter, not only in the caller: a production bundle and
   * a real provider refuse, and the refusal text says what the operator must do instead.
   */
  seedTestAccounts(input: { committees: TestAccountCommitteeSource[] }): Promise<TestAccountReport>;
  removeTestAccounts(): Promise<TestAccountReport>;

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
