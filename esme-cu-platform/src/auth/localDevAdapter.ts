import { canAccessErp } from '../domain/accountState';
import { isPrimaryAdmin, validateRoleChange, hasCapability, capabilitiesFor, PUBLIC_REGISTRATION_ROLE, type Role } from '../domain/roles';
import { normalizeEmail, normalizeUsername, validatePassword, validateRegistration, DUPLICATE_IDENTITY_MESSAGE } from '../domain/registration';
import { AccessRevokedError, AuthFailedError, RateLimitedError } from './errors';
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
  emailVerified: boolean;
  committeeId?: string;
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
  secondCommitteePreferenceId?: string;
  technicalSkills?: string;
  previousExperience?: string;
  motivation?: string;
  availabilityHours?: string;
};

type Vault = { accounts: StoredAccount[]; audit: { at: string; actor: string; action: string; detail: string }[] };
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
    return { accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [], audit: Array.isArray(parsed.audit) ? parsed.audit : [] };
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
    emailVerified: account.emailVerified,
    committeeId: account.committeeId,
    capabilities: capabilitiesFor(account.role),
  };
}

function randomId(prefix: string): string {
  return `${prefix}_${toBase64(crypto.getRandomValues(new Uint8Array(12))).replace(/[^A-Za-z0-9]/g, '')}`;
}

function recordOf(account: StoredAccount): RegistrationRecord {
  return {
    id: account.id,
    fullName: account.displayName,
    email: account.email,
    username: account.username,
    committeeId: account.committeeId,
    assignedCommitteeId: account.assignedCommitteeId,
    submittedAt: account.submittedAt,
    emailVerified: account.emailVerified,
    status: account.status,
    decisionBy: account.decidedBy,
    decisionAt: account.decidedAt,
    rejectionReason: account.rejectionReason,
    studentId: account.studentId,
    academicYear: account.academicYear,
    department: account.department,
    phone: account.phone,
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
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const account: StoredAccount = {
        id: randomId('dev'),
        email,
        username,
        displayName: draft.fullName.trim(),
        role: PUBLIC_REGISTRATION_ROLE,
        // A new registration is never active, whatever the browser asks for.
        status: 'pending_email_verification',
        emailVerified: false,
        committeeId: draft.committeeId,
        salt: toBase64(saltBytes),
        hash: await derive(draft.password, saltBytes),
        createdAt: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
        agreedToPolicies: draft.acceptedPolicies,
        studentId: draft.studentId,
        academicYear: draft.academicYear,
        department: draft.department,
        phone: draft.phone,
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
        receipt: { reference: account.id, status: account.status, requiresEmailVerification: true },
      };
    },

    async resendVerification() {
      // No mail transport exists locally; the dev UI verifies in place.
    },

    async completeEmailVerification(token) {
      requireCapability('registrations.decide');
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === token);
      if (!account) return { ok: false, error: { code: 'not_found', message: 'Verification link is no longer valid.' } };
      account.emailVerified = true;
      if (account.status === 'pending_email_verification') account.status = 'pending_approval';
      writeVault(vault);
      return { ok: true };
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
      requireCapability('registrations.read');
      return readVault()
        .accounts.filter((a) => a.status !== 'active' || a.role === PUBLIC_REGISTRATION_ROLE)
        .map(recordOf);
    },

    async decideRegistration(id, decision, options) {
      const actor = requireCapability('registrations.decide');
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === id);
      if (!account) return { ok: false, error: { code: 'not_found', message: 'This request no longer exists.' } };
      if (isPrimaryAdmin(account)) return { ok: false, error: { code: 'protected', message: 'The primary Super Admin cannot be decided from the queue.' } };
      if (account.status !== 'pending_approval' && account.status !== 'pending_email_verification') {
        return { ok: false, error: { code: 'already_decided', message: 'This request was already decided.' } };
      }
      if (decision === 'approve') {
        if (!account.emailVerified) return { ok: false, error: { code: 'unverified', message: 'The applicant has not verified their email yet.' } };
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
      vault.audit.unshift({ at: account.decidedAt, actor: actor.displayName, action: `registration_${decision}`, detail: account.email });
      writeVault(vault);
      return { ok: true };
    },

    async setAccountStatus(id, status) {
      const actor = requireCapability('users.suspend');
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === id);
      if (!account) return { ok: false, error: { code: 'not_found', message: 'No such account.' } };
      if (isPrimaryAdmin(account)) return { ok: false, error: { code: 'protected', message: 'The primary Super Admin account is protected.' } };
      if (account.id === actor.id && status !== 'active') {
        return { ok: false, error: { code: 'self_lockout', message: 'You cannot lock your own account.' } };
      }
      account.status = status;
      vault.audit.unshift({ at: new Date().toISOString(), actor: actor.displayName, action: `status_${status}`, detail: account.email });
      writeVault(vault);
      // A revoked account keeps no live session.
      if (currentSession()?.identity.id === account.id) localStorage.removeItem(SESSION_KEY);
      return { ok: true };
    },

    async assignRole(id, role) {
      const actor = requireCapability('users.role.assign');
      const vault = readVault();
      const account = vault.accounts.find((a) => a.id === id);
      if (!account) return { ok: false, error: { code: 'not_found', message: 'No such account.' } };
      const verdict = validateRoleChange(actor, { id: account.id, role: account.role }, role, isPrimaryAdmin(account));
      if (!verdict.allowed) return { ok: false, error: { code: 'denied', message: verdict.reason } };
      account.role = role;
      vault.audit.unshift({ at: new Date().toISOString(), actor: actor.displayName, action: `role_${role}`, detail: account.email });
      writeVault(vault);
      return { ok: true };
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
        emailVerified: true,
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

