import { ACCOUNT_STATUSES, canAccessErp, repairStoredStatus } from '../domain/accountState';
import { isPrimaryAdmin, validateRoleChange, hasCapability, capabilitiesFor, scopeFor, PUBLIC_REGISTRATION_ROLE, type Role } from '../domain/roles';
import {
  DUPLICATE_IDENTITY_MESSAGE,
  SUBMISSION_WINDOW_MINUTES,
  normalizeEmail,
  normalizeUsername,
  submissionThrottleBlocked,
  validatePassword,
  validateRegistration,
} from '../domain/registration';
import { AccessRevokedError, AuthFailedError, RateLimitedError } from './errors';
import { preferencesWithDefaults } from '../domain/email';
import { WARNING_SEVERITIES } from '../domain/rewards';
import { readEmailPreferences, writeEmailPreferences } from '../email/queue';
import {
  TEST_ACCOUNT_STATUS,
  emptyTestAccountReport,
  fixtureFor,
  planTestAccountSeed,
  resolveFixtureCommittee,
  testAccountSeedRefusal,
  type TestAccountFixture,
} from '../domain/testAccounts';
import type {
  AuthAdapter,
  AuthIdentity,
  AuthSession,
  RegistrationRecord,
} from './types';

const VAULT_KEY = 'ESME_CU_DEV_AUTH_V1';
const SESSION_KEY = 'ESME_CU_DEV_SESSION_V1';
const THROTTLE_KEY = 'ESME_CU_DEV_THROTTLE_V1';

const PBKDF2_ITERATIONS = 210_000;
const SESSION_MINUTES = 8 * 60;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

type StoredAccount = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: Role;
  status: AuthIdentity['status'];
  committeeId?: string;
  subTeam?: string;
  salt: string;
  hash: string;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  rejectionReason?: string;
  submittedAt: string;
  /** Absent on accounts provisioned before the questionnaire was stored locally. */
  agreedToPolicies?: boolean;
  assignedCommitteeId?: string;
  studentId?: string;
  academicYear?: string;
  department?: string;
  phone?: string;
  /** 'yes' / 'no'. Absent on accounts that registered before the membership question existed. */
  committeeMembership?: string;
  secondCommitteePreferenceId?: string;
  technicalSkills?: string;
  previousExperience?: string;
  motivation?: string;
  availabilityHours?: string;
  /** Set on a row this workspace provisioned rather than received from an applicant. */
  provisioned?: string;
};

/**
 * The journal this simulated server keeps. For a privilege line `detail` is the reason the action
 * ran or was turned down. Entries written before `outcome` existed have none, which reads as an
 * allowed action — the explicit mark only appears once refusals began to be kept.
 */
type VaultAudit = {
  at: string;
  actor: string;
  actorId?: string;
  targetId?: string;
  action: string;
  detail: string;
  outcome?: 'allowed' | 'denied';
  previousRole?: Role;
  newRole?: Role;
};
type Vault = { accounts: StoredAccount[]; audit: VaultAudit[] };
type Throttle = Record<string, { failures: number; lockedUntil: number }>;

const BANNER =
  'LOCAL DEVELOPMENT AUTH — these identities live in this browser only. Nothing here is production authentication. ' +
  'Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use the real provider.';

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return toBase64(bits);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readVault(): Vault {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return { accounts: [], audit: [] };
    const parsed = JSON.parse(raw) as Vault;
    const accounts = (Array.isArray(parsed.accounts) ? parsed.accounts : []).map((account) => ({
      ...account,
      status: repairStoredStatus(account.status),
    }));
    return { accounts, audit: Array.isArray(parsed.audit) ? parsed.audit : [] };
  } catch {
    return { accounts: [], audit: [] };
  }
}

function writeVault(vault: Vault): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

function readThrottle(): Throttle {
  try {
    return JSON.parse(localStorage.getItem(THROTTLE_KEY) ?? '{}') as Throttle;
  } catch {
    return {};
  }
}

function identityOf(account: StoredAccount): AuthIdentity {
  return {
    id: account.id,
    email: account.email,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    status: account.status,
    committeeId: account.committeeId,
    capabilities: capabilitiesFor(account.role),
  };
}

function randomId(prefix: string): string {
  return `${prefix}_${toBase64(crypto.getRandomValues(new Uint8Array(12))).replace(/[^A-Za-z0-9]/g, '')}`;
}

function recordOf(account: StoredAccount): RegistrationRecord {
  return {
    // The local vault has no separate request table: the account row is the queue row.
    id: account.id,
    profileId: account.id,
    fullName: account.displayName,
    email: account.email,
    username: account.username,
    committeeId: account.committeeId,
    assignedCommitteeId: account.assignedCommitteeId,
    submittedAt: account.submittedAt,
    status: account.status,
    decisionBy: account.decidedBy,
    decisionAt: account.decidedAt,
    rejectionReason: account.rejectionReason,
    studentId: account.studentId,
    academicYear: account.academicYear,
    department: account.department,
    phone: account.phone,
    committeeMembership: account.committeeMembership,
    secondCommitteePreferenceId: account.secondCommitteePreferenceId,
    technicalSkills: account.technicalSkills ?? '',
    previousExperience: account.previousExperience ?? '',
    motivation: account.motivation ?? '',
    availabilityHours: account.availabilityHours ?? '',
    agreedToPolicies: account.agreedToPolicies === true,
  };
}

/**
 * Development fallback used only when no provider is configured.
 *
 * It is NOT a production authentication path: the vault is browser storage, so these
 * identities are visible to anyone with the machine, and every "server-side" rule below
 * is a simulation that keeps the UI and tests honest about behaviour, not a security
 * boundary. The adapter advertises this through `warningBanner`, which the shell renders
 * until a real provider answers.
 */
export function createLocalDevAdapter(): AuthAdapter {
  const currentSession = (): AuthSession | null => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as { userId: string; expiresAt: number };
      if (session.expiresAt < Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      const account = readVault().accounts.find((a) => a.id === session.userId);
      // Status is re-read from the vault on every restore: a suspension or rejection
      // takes effect on the next navigation, and a refresh cannot resurrect access.
      if (!account || !canAccessErp(account.status)) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return { identity: identityOf(account), issuedAt: session.expiresAt - SESSION_MINUTES * 60_000, expiresAt: session.expiresAt };
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  };

  const requireCapability = (capability: Parameters<typeof hasCapability>[1]): AuthIdentity => {
    const session = currentSession();
    if (!session) throw new AccessRevokedError('pending_approval');
    // Mirrors the RLS policy in supabase/migrations/0002_rls_policies.sql.
    if (!hasCapability(session.identity.role, capability)) {
      throw new AuthFailedError('Your role is not permitted to perform this action.');
    }
    return session.identity;
  };

  /**
   * One shape for both halves of a privilege decision, so a refusal cannot be recorded differently
   * from a grant. A trail that only holds successes cannot show that a guard was ever exercised.
   */
  const auditLine = (input: {
    actor: AuthIdentity | null;
    targetId: string;
    action: string;
    detail: string;
    outcome: 'allowed' | 'denied';
    previousRole?: Role;
    newRole?: Role;
  }): VaultAudit => ({
    at: new Date().toISOString(),
    actor: input.actor?.displayName ?? 'no session',
    actorId: input.actor?.id,
    targetId: input.targetId,
    action: input.action,
    detail: input.detail,
    outcome: input.outcome,
    ...(input.previousRole !== undefined && input.newRole !== undefined
      ? { previousRole: input.previousRole, newRole: input.newRole }
      : {}),
  });

  /** A capability refusal happens before any row is loaded, so it writes the journal itself. */
  const requirePrivilege = (
    capability: Parameters<typeof hasCapability>[1],
    attempt: { action: string; targetId: string }
  ): AuthIdentity => {
    let actor: AuthIdentity;
    try {
      actor = requireCapability(capability);
    } catch (error) {
      if (error instanceof AuthFailedError || error instanceof AccessRevokedError) {
        const vault = readVault();
        // Who tried matters even when they were turned away, so the session is named if one existed.
        vault.audit.unshift(
          auditLine({ actor: currentSession()?.identity ?? null, ...attempt, detail: error.message, outcome: 'denied' })
        );
        writeVault(vault);
      }
      throw error;
    }
    return actor;
  };

  const openSession = (account: StoredAccount): AuthSession => {
    const expiresAt = Date.now() + SESSION_MINUTES * 60_000;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: account.id, expiresAt }));
    return { identity: identityOf(account), issuedAt: Date.now(), expiresAt };
  };

  const attempt = (key: string, succeed: boolean): void => {
    const throttle = readThrottle();
    const entry = throttle[key] ?? { failures: 0, lockedUntil: 0 };
    if (succeed) {
      delete throttle[key];
    } else {
      entry.failures += 1;
      if (entry.failures >= MAX_FAILED_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
        entry.failures = 0;
      }
      throttle[key] = entry;
    }
    localStorage.setItem(THROTTLE_KEY, JSON.stringify(throttle));
  };

  return {
    kind: 'local-dev',
    warningBanner: BANNER,

    async restore() {
      return currentSession();
    },

    /** There is no server to tell. The local pipeline raises the alert from the device instead. */
    async reportSignIn() {
      // deliberately empty
    },

    async readEmailPreferences() {
      const session = currentSession();
      return session ? readEmailPreferences(session.identity.id) : null;
    },

    async saveEmailPreferences(prefs) {
      const session = currentSession();
      if (!session) return { ok: false, error: { code: 'no-session', message: 'Sign in first.' } };
      // Keyed to the session, never to an id in the request, and read back through the defaults so
      // a hand-made mute list cannot store an account-safety event.
      writeEmailPreferences(preferencesWithDefaults(prefs, session.identity.id));
      return { ok: true };
    },

    subscribe(listener) {
      const onStorage = (event: StorageEvent) => {
        if (event.key === VAULT_KEY || event.key === SESSION_KEY) listener(currentSession());
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },

    async signIn(identifier, password) {
      const key = normalizeEmail(identifier.includes('@') ? identifier : identifier);
      const throttle = readThrottle();
      const entry = throttle[key];
      if (entry && entry.lockedUntil > Date.now()) throw new RateLimitedError(Math.ceil((entry.lockedUntil - Date.now()) / 1000));

      const account = readVault().accounts.find(
        (a) => a.email === key || normalizeUsername(a.username) === normalizeUsername(identifier)
      );
      // Same message and same work either way: no signal about which identifier exists.
      const probeSalt = account?.salt ?? toBase64(new Uint8Array(16));
      const probeHash = await derive(password || 'x', fromBase64(probeSalt));
      if (!account || !constantTimeEquals(probeHash, account.hash)) {
        attempt(key, false);
        throw new AuthFailedError();
      }
      attempt(key, true);
      if (!canAccessErp(account.status)) throw new AccessRevokedError(account.status);
      return openSession(account);
    },

    async signOut() {
      localStorage.removeItem(SESSION_KEY);
    },

    async register(draft) {
      const errors = validateRegistration(draft);
      if (Object.keys(errors).length > 0) {
        return { ok: false, failure: { code: 'validation', message: 'Check the highlighted fields.', fields: errors } };
      }
      const vault = readVault();
      const email = normalizeEmail(draft.email);
      const username = normalizeUsername(draft.username);
      if (vault.accounts.some((a) => a.email === email || a.username === username)) {
        return { ok: false, failure: { code: 'duplicate', message: DUPLICATE_IDENTITY_MESSAGE } };
      }
      // Nobody has to prove they own the address to file, so the queue is defended by refusing
      // a burst of submissions instead. Production has GoTrue's per-IP limit; this device stands
      // in for it locally, and the count is taken from the vault rather than from a browser claim.
      const now = new Date().toISOString();
      if (submissionThrottleBlocked(vault.accounts.map((a) => a.createdAt), now)) {
        return {
          ok: false,
          failure: {
            code: 'rate_limited',
            message: `Too many requests came from this device in the last ${SUBMISSION_WINDOW_MINUTES} minutes. Wait before submitting again.`,
          },
        };
      }
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const account: StoredAccount = {
        id: randomId('dev'),
        email,
        username,
        displayName: draft.fullName.trim(),
        role: PUBLIC_REGISTRATION_ROLE,
        // Signing up is enough to open the member workspace (migration 0012 in production);
        // the queue row is a committee-placement request, not an access gate.
        status: 'active',
        committeeId: draft.committeeId,
        salt: toBase64(saltBytes),
        hash: await derive(draft.password, saltBytes),
        createdAt: now,
        submittedAt: now,
        agreedToPolicies: draft.acceptedPolicies,
        studentId: draft.studentId,
        academicYear: draft.academicYear,
        department: draft.department,
        phone: draft.phone,
        committeeMembership: draft.committeeMembership,
        secondCommitteePreferenceId: draft.secondCommitteePreferenceId,
        technicalSkills: draft.technicalSkills,
        previousExperience: draft.previousExperience,
        motivation: draft.motivation,
        availabilityHours: draft.availabilityHours,
      };
      vault.accounts.unshift(account);
      writeVault(vault);
      return {
        ok: true,
        receipt: { reference: account.id, status: account.status },
      };
    },

    async requestPasswordReset(email) {
      void normalizeEmail(email);
      // Deliberately a no-op with a generic outcome: local dev has no mail transport,
      // and the response must not confirm whether the address is registered.
    },

    async confirmPasswordReset(token, newPassword) {
      const failures = validatePassword(newPassword);
      if (failures.length > 0) return { ok: false, error: { code: 'weak_password', message: `Password needs: ${failures.join(', ')}.` } };
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === token);
      if (!account) return { ok: false, error: { code: 'invalid_token', message: 'This reset link has expired.' } };
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      account.salt = toBase64(saltBytes);
      account.hash = await derive(newPassword, saltBytes);
      writeVault(vault);
      return { ok: true };
    },

    async listRegistrations() {
      const actor = requireCapability('registrations.read');
      const scope = scopeFor(actor.role, 'registrations.read');
      // The queue is narrowed where it is produced, the way the RLS policy narrows it in
      // production: a committee reader never receives an applicant from another committee.
      if (scope === 'committee' && !actor.committeeId) return [];
      return readVault()
        .accounts.filter(
          (a) =>
            !a.provisioned &&
            (scope !== 'committee' || a.committeeId === actor.committeeId) &&
            (a.status !== 'active' || a.role === PUBLIC_REGISTRATION_ROLE)
        )
        .map(recordOf);
    },

    async listAccounts() {
      requireCapability('users.read');
      // Applicants are accounts too: they belong in the directory so that an
      // unapproved person can be seen and refused by name, not silently
      // missing from a selector. Eligibility is enforced where the seat is written.
      return readVault()
        .accounts.map((a) => ({
          id: a.id,
          email: a.email,
          username: a.username,
          displayName: a.displayName,
          role: a.role,
          status: a.status,
          committeeId: a.committeeId,
          createdAt: a.createdAt,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    async decideRegistration(id, decision, options) {
      const actor = requirePrivilege('registrations.decide', { action: 'registration_decision_denied', targetId: id });
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === id);
      if (!account) {
        return {
          ok: false,
          error: {
            code: 'not_found',
            message:
              'That registration request is no longer in the queue. Another reviewer may have decided it; refresh to see the latest state.',
          },
        };
      }
      const refusal = (code: string, message: string) => {
        vault.audit.unshift(
          auditLine({ actor, targetId: account.id, action: 'registration_decision_denied', detail: message, outcome: 'denied' })
        );
        writeVault(vault);
        return { ok: false as const, error: { code, message } };
      };
      if (isPrimaryAdmin(account)) return refusal('protected', 'The primary Super Admin cannot be decided from the queue.');
      // The decision belongs to the application row, not the account row. Since 0012 a
      // self-registered account is already active, and approving only records its committee
      // placement — refusing here would make every new applicant undecidable.
      const applicationOpen = !account.provisioned && account.decidedAt === undefined;
      if (!applicationOpen) {
        return refusal('already_decided', 'This request was already decided by another reviewer. Refresh to see the outcome.');
      }
      const previousRole = account.role;
      if (decision === 'approve') {
        account.status = 'active';
        account.role = account.role === PUBLIC_REGISTRATION_ROLE ? PUBLIC_REGISTRATION_ROLE : account.role;
      } else {
        account.status = 'rejected';
        account.rejectionReason = options?.reason;
      }
      if (options?.committeeId) {
        account.committeeId = options.committeeId;
        account.assignedCommitteeId = options.committeeId;
      }
      account.decidedBy = actor.displayName;
      account.decidedAt = new Date().toISOString();
      vault.audit.unshift(
        auditLine({
          actor,
          targetId: account.id,
          action: `registration_${decision}`,
          detail: `${account.email} (${previousRole} → ${account.role})`,
          outcome: 'allowed',
          previousRole,
          newRole: account.role,
        })
      );
      writeVault(vault);
      return { ok: true };
    },

    async setAccountStatus(id, status) {
      const actor = requirePrivilege('users.suspend', { action: 'status_change_denied', targetId: id });
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === id);
      if (!account) return { ok: false, error: { code: 'not_found', message: 'No such account.' } };
      const refusal = (code: string, message: string) => {
        vault.audit.unshift(
          auditLine({ actor, targetId: account.id, action: 'status_change_denied', detail: message, outcome: 'denied' })
        );
        writeVault(vault);
        return { ok: false as const, error: { code, message } };
      };
      // Production types this parameter as `esme_account_status`, so Postgres refuses a value
      // outside the four before the update runs. Offline the row is plain JSON and would take
      // whatever a stale form sent — including nothing, leaving an account with no state at all.
      if (!ACCOUNT_STATUSES.includes(status)) {
        return refusal('invalid_status', `Choose an account state: ${ACCOUNT_STATUSES.join(', ')}.`);
      }
      if (isPrimaryAdmin(account)) return refusal('protected', 'The primary Super Admin account is protected.');
      if (account.id === actor.id && status !== 'active') {
        return refusal('self_lockout', 'You cannot lock your own account.');
      }
      const previous = account.status;
      account.status = status;
      vault.audit.unshift(
        auditLine({
          actor,
          targetId: account.id,
          action: `status_${status}`,
          detail: `${account.email}: ${previous} → ${status}`,
          outcome: 'allowed',
        })
      );
      writeVault(vault);
      // A revoked account keeps no live session.
      if (currentSession()?.identity.id === account.id) localStorage.removeItem(SESSION_KEY);
      return { ok: true };
    },

    async assignRole(id, role) {
      const actor = requirePrivilege('users.role.assign', { action: 'role_change_denied', targetId: id });
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === id);
      if (!account) return { ok: false, error: { code: 'not_found', message: 'No such account.' } };
      const verdict = validateRoleChange(actor, { id: account.id, role: account.role }, role, isPrimaryAdmin(account));
      if (!verdict.allowed) {
        vault.audit.unshift(
          auditLine({
            actor,
            targetId: account.id,
            action: 'role_change_denied',
            detail: verdict.reason,
            outcome: 'denied',
            previousRole: account.role,
            newRole: role,
          })
        );
        writeVault(vault);
        return { ok: false, error: { code: 'denied', message: verdict.reason } };
      }
      const previous = account.role;
      account.role = role;
      vault.audit.unshift(
        auditLine({
          actor,
          targetId: account.id,
          action: `role_${role}`,
          detail: `${account.email}: ${previous} → ${role}`,
          outcome: 'allowed',
          previousRole: previous,
          newRole: role,
        })
      );
      writeVault(vault);
      return { ok: true };
    },

    /**
     * A directory row with no credential. Sign-in can never match it (the salt and hash are empty),
     * but an activation or role change addresses a real vault row instead of answering
     * "No such account." — which is what a provisioned profile was before this existed.
     */
    async provisionAccount(input) {
      const actor = requirePrivilege('users.create', { action: 'provision_denied', targetId: input.id });
      const vault = readVault();
      const email = input.email.trim().toLowerCase();
      if (vault.accounts.some((a) => a.id === input.id || a.email.trim().toLowerCase() === email)) {
        return { ok: false, error: { code: 'duplicate', message: `An account for ${input.email} already exists.` } };
      }
      const now = new Date().toISOString();
      vault.accounts.unshift({
        id: input.id,
        email,
        username: input.username.trim().toLowerCase(),
        displayName: input.displayName,
        role: input.role,
        status: 'pending_approval',
        committeeId: input.committeeId,
        subTeam: input.subTeam,
        academicYear: input.academicYear,
        department: input.department,
        phone: input.phone,
        salt: '',
        hash: '',
        createdAt: now,
        submittedAt: now,
        provisioned: actor.displayName,
      });
      vault.audit.unshift(
        auditLine({
          actor,
          targetId: input.id,
          action: 'account_provisioned',
          detail: `${email} (${input.role}); no credential, pending until activated`,
          outcome: 'allowed',
        })
      );
      writeVault(vault);
      return { ok: true };
    },

    /**
     * The reward writes, offline.
     *
     * There is no server here to file a row, so this adapter does what the database would: applies the
     * capability the RLS policy applies (`requireCapability` below is the same test as
     * `esme_has_capability('rewards.write')`), refuses an actor acting on their own account, and
     * stamps and ids the record so the caller stores what a server would have returned rather than
     * what it guessed. What it deliberately does not re-check is the point cap and the rolling window:
     * this adapter holds no ledger — the entries live in the workspace cache the store owns — so
     * `validateRewardAction()` in src/domain/rewards.ts is the authority offline, and it is the same
     * code the SQL mirrors. Against a real provider, the function re-decides all of it.
     */
    async awardBonus(write) {
      const actor = requireCapability('rewards.write');
      if (write.targetId === actor.id) {
        return { ok: false, error: { code: 'esme_self_target', message: 'Nobody can award themselves a bonus.' } };
      }
      // The same absolute rule as 0016's trigger. The store has already refused it through
      // validateRewardAction(); this keeps the offline adapter from filing a record a server would not.
      if (write.targetRole === 'high_board') {
        return {
          ok: false,
          error: {
            code: 'esme_high_board_target',
            message: 'Bonus points are not awarded to a High Board seat.',
          },
        };
      }
      if (!Number.isInteger(write.points) || write.points < 1) {
        return { ok: false, error: { code: 'esme_bad_points', message: 'A bonus is a whole number of points above zero.' } };
      }
      return {
        ok: true,
        receipt: {
          id: randomId('rew'),
          kind: 'bonus',
          actorId: actor.id,
          actorRole: actor.role,
          targetId: write.targetId,
          targetRoleAtTime: write.targetRole,
          committeeId: write.targetCommitteeId,
          points: write.points,
          reason: write.reason.trim(),
          evidenceUrl: write.evidenceUrl?.trim() || undefined,
          issuedAt: new Date().toISOString(),
          status: 'active',
          idempotencyKey: write.idempotencyKey,
        },
      };
    },

    async issueWarning(write) {
      const actor = requireCapability('rewards.write');
      if (write.targetId === actor.id) {
        return { ok: false, error: { code: 'esme_self_target', message: 'Nobody can issue themselves a warning.' } };
      }
      if (!WARNING_SEVERITIES.includes(write.severity)) {
        return { ok: false, error: { code: 'esme_bad_severity', message: 'Choose a severity: notice, formal or final.' } };
      }
      return {
        ok: true,
        receipt: {
          id: randomId('rew'),
          kind: 'warning',
          actorId: actor.id,
          actorRole: actor.role,
          targetId: write.targetId,
          targetRoleAtTime: write.targetRole,
          committeeId: write.targetCommitteeId,
          points: 0,
          severity: write.severity,
          reason: write.reason.trim(),
          evidenceUrl: write.evidenceUrl?.trim() || undefined,
          issuedAt: new Date().toISOString(),
          status: 'active',
          idempotencyKey: write.idempotencyKey,
        },
      };
    },

    /**
     * Mirrors `esme_reverse_reward_entry()`: a second row that points at the first, carrying the
     * negative of the points it undoes, and the original's roles as they were when it was filed.
     * `write.original` is only consulted because an offline adapter has no table to read by id; a
     * provider reads the row itself, so this cannot be steered by a caller's copy.
     */
    async reverseRewardEntry(write) {
      const actor = requireCapability('rewards.write');
      const original = write.original;
      if (original.status === 'reversed') {
        return { ok: false, error: { code: 'esme_already_reversed', message: 'That entry has already been reversed.' } };
      }
      if (!write.reason.trim()) {
        return { ok: false, error: { code: 'esme_no_reason', message: 'A reversal without a reason is a silent edit with extra steps.' } };
      }
      return {
        ok: true,
        receipt: {
          id: randomId('rew'),
          kind: original.kind,
          actorId: actor.id,
          actorRole: actor.role,
          targetId: original.targetId,
          targetRoleAtTime: original.targetRoleAtTime,
          committeeId: original.committeeId,
          points: original.kind === 'bonus' ? -original.points : 0,
          severity: original.kind === 'warning' ? original.severity : undefined,
          reason: write.reason.trim(),
          issuedAt: new Date().toISOString(),
          status: 'active',
          reversedByEntryId: original.id,
          idempotencyKey: `reverse:${original.id}:${actor.id}`,
        },
      };
    },

    /** Receipt, not appeal: only the member the warning is about can file it, and the entry is otherwise untouched. */
    async acknowledgeWarning(entry) {
      const actor = requireCapability('rewards.read');
      if (entry.kind !== 'warning') {
        return { ok: false, error: { code: 'esme_not_a_warning', message: 'Only a recorded warning can be acknowledged.' } };
      }
      if (entry.targetId !== actor.id) {
        return { ok: false, error: { code: 'esme_forbidden', message: 'Only the member the warning is about can acknowledge it.' } };
      }
      return { ok: true };
    },

    /**
     * Seeded into the same browser vault every other development identity lives in. It is a
     * fixture, not a security boundary — the banner on the shell says so — but the guards that
     * decide *whether* to write are the ones the real provider uses, so a bundle built for
     * production refuses here exactly as it refuses there.
     */    async seedTestAccounts({ committees }) {
      // The same capability rule the RLS policy applies to an account insert: seeding is a
      // privileged write, and this adapter simulates the server, so it checks for itself.
      requireCapability('users.create');
      const refusal = testAccountSeedRefusal({
        adapterKind: 'local-dev',
        isProductionBuild: Boolean(import.meta.env.PROD),
        allowedByEnvironment: import.meta.env.VITE_ALLOW_TEST_ACCOUNTS === 'true',
      });
      if (refusal) return emptyTestAccountReport(refusal);

      const vault = readVault();
      const plan = planTestAccountSeed(vault.accounts);
      const report = emptyTestAccountReport(null);
      report.conflicts = plan.conflicts.map((c) => ({ fixtureKey: c.fixture.fixtureKey, reason: c.reason }));

      const seat = (fixture: TestAccountFixture) => {
        const committeeId = resolveFixtureCommittee(fixture, committees);
        if (!committeeId && !report.unresolvedCommittees.includes(fixture.committeeId)) {
          report.unresolvedCommittees.push(fixture.committeeId);
        }
        return committeeId;
      };

      const apply = async (fixture: TestAccountFixture, created: boolean) => {
        const committeeId = seat(fixture);
        const saltBytes = crypto.getRandomValues(new Uint8Array(16));
        const hash = await derive(fixture.password, saltBytes);
        const row: StoredAccount = {
          id: `usr_test_${fixture.fixtureKey}`,
          email: fixture.email,
          username: fixture.username,
          displayName: fixture.displayName,
          role: fixture.role,
          status: TEST_ACCOUNT_STATUS,
          committeeId,
          salt: toBase64(saltBytes),
          hash,
          createdAt: new Date().toISOString(),
          submittedAt: new Date().toISOString(),
          provisioned: 'test-fixture',
        };
        // Matched on identity, not on the seeded id: an account that already answers to this
        // address is repaired where it stands rather than duplicated beside it.
        const existing = vault.accounts.find((a) => a.id === row.id || a.email === row.email);
        if (existing) {
          Object.assign(existing, row, {
            id: existing.id,
            createdAt: existing.createdAt,
            submittedAt: existing.submittedAt,
            committeeId: committeeId ?? existing.committeeId,
          });
        } else {
          vault.accounts.unshift(row);
        }
        (created ? report.created : report.repaired).push({
          email: row.email,
          username: row.username,
          role: row.role,
          committeeId,
        });
      };

      for (const fixture of plan.create) await apply(fixture, true);
      for (const fixture of plan.repair) await apply(fixture, false);
      writeVault(vault);
      return report;
    },

    async removeTestAccounts() {
      requireCapability('users.delete');
      const vault = readVault();
      const doomed = vault.accounts.filter((a) => fixtureFor(a) !== undefined);
      if (doomed.length === 0) {
        const report = emptyTestAccountReport(null);
        return report;
      }
      vault.accounts = vault.accounts.filter((a) => fixtureFor(a) === undefined);
      writeVault(vault);
      // A tester holding its own live session is not left authenticated to a deleted row.
      const sessionUserId = (() => {
        try {
          return (JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') as { userId?: string }).userId;
        } catch {
          return undefined;
        }
      })();
      if (sessionUserId && doomed.some((a) => a.id === sessionUserId)) localStorage.removeItem(SESSION_KEY);
      const report = emptyTestAccountReport(null);
      report.removed = doomed.map((a) => a.email);
      return report;
    },

    async requiresPrimaryAdminBootstrap() {
      const vault = readVault();
      return !vault.accounts.some((a) => a.role === 'super_admin');
    },
    async bootstrapPrimaryAdmin(input) {
      const vault = readVault();
      if (vault.accounts.some((a) => a.role === 'super_admin')) {
        return { ok: false, error: { code: 'exists', message: 'A Super Admin already exists. Bootstrap is one-time only.' } };
      }
      const errors = validateRegistration({
        fullName: input.fullName,
        email: input.email,
        username: input.username,
        password: input.password,
        confirmPassword: input.password,
        committeeId: undefined,
        acceptedPolicies: true,
      });
      if (Object.keys(errors).length > 0) {
        return { ok: false, error: { code: 'validation', message: Object.values(errors).join(' ') } };
      }
      const email = normalizeEmail(input.email);
      const username = normalizeUsername(input.username);
      if (vault.accounts.some((a) => a.email === email || a.username === username)) {
        return { ok: false, error: { code: 'duplicate', message: 'An account with that email or username already exists.' } };
      }
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      vault.accounts.unshift({
        id: 'usr_superadmin',
        email,
        username,
        displayName: input.fullName.trim(),
        role: 'super_admin',
        status: 'active',
        salt: toBase64(saltBytes),
        hash: await derive(input.password, saltBytes),
        createdAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
      });
      vault.audit.unshift({ at: new Date().toISOString(), actor: 'system', action: 'bootstrap_super_admin', detail: email });
      writeVault(vault);
      return { ok: true };
    },
  };
}

