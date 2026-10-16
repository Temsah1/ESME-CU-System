// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalDevAdapter } from './localDevAdapter';
import { createSupabaseAdapter, isSupabaseConfigured } from './supabaseAdapter';
import { resolveAdapter } from './index';
import { AccessRevokedError, AuthFailedError, AuthNotConfiguredError, RateLimitedError } from './errors';
import { DUPLICATE_IDENTITY_MESSAGE } from '../domain/registration';
import type { AuthAdapter, RegistrationDraft } from './types';

/**
 * These suites exercise the *rules* the auth layer must enforce: nothing is privileged at
 * registration, email verification alone grants no access, only the decided states open the
 * ERP, and every admin action re-reads the caller's capability.
 *
 * They run against the local development adapter, which simulates those rules in browser
 * storage. It is the only adapter reachable without provider credentials, so passing here
 * does NOT verify the Supabase integration, its RLS policies, or real mail delivery —
 * those remain BLOCKED until a project and keys exist.
 */

class MemoryStorage {
  private map = new Map<string, string>();

  get length() {
    return this.map.size;
  }

  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(name: string) {
    return this.map.has(name) ? this.map.get(name)! : null;
  }

  setItem(name: string, value: string) {
    this.map.set(name, String(value));
  }

  removeItem(name: string) {
    this.map.delete(name);
  }

  clear() {
    this.map.clear();
  }
}

const STRONG = 'Str0ng#Kx91';
const ADMIN = {
  fullName: 'Kareem Tamer',
  email: 'kareemeltemsah7@gmail.com',
  username: 'kareem.admin',
  password: STRONG,
  confirmPassword: STRONG,
};

const draft = (over: Partial<RegistrationDraft> = {}): RegistrationDraft => ({
  fullName: 'Aya Student',
  email: 'aya.student@esme-cu.edu',
  username: 'aya.student',
  password: STRONG,
  confirmPassword: STRONG,
  acceptedPolicies: true,
  ...over,
});

let adapter: AuthAdapter;

async function bootstrapSuperAdmin() {
  const result = await adapter.bootstrapPrimaryAdmin(ADMIN);
  if (!result.ok) throw new Error(`bootstrap refused: ${result.error.code} — ${result.error.message}`);
  return (await adapter.signIn(ADMIN.email, ADMIN.password))!;
}

beforeEach(() => {
  const storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', storage);
  adapter = createLocalDevAdapter();
});

describe('primary administrator bootstrap', () => {
  it('creates the first Super Admin only while no privileged account exists', async () => {
    expect(await adapter.requiresPrimaryAdminBootstrap()).toBe(true);
    const admin = await bootstrapSuperAdmin();
    expect(admin.identity.role).toBe('super_admin');
    expect(admin.identity.status).toBe('active');
    expect(await adapter.requiresPrimaryAdminBootstrap()).toBe(false);

    const second = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, email: 'other@example.com', username: 'other' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe('exists');
  });

  it('refuses a bootstrap password that would not survive the policy', async () => {
    const weak = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: 'short', confirmPassword: 'short' });
    expect(weak.ok).toBe(false);
    expect(await adapter.requiresPrimaryAdminBootstrap()).toBe(true);
  });

  it('stores a derived hash and salt, never the password itself', async () => {
    await bootstrapSuperAdmin();
    const vault = JSON.parse(localStorage.getItem('ESME_CU_DEV_AUTH_V1') ?? '{}');
    const serialized = JSON.stringify(vault);
    expect(serialized).not.toContain(STRONG);
    expect(vault.accounts[0].salt).toBeTruthy();
    expect(vault.accounts[0].hash).toBeTruthy();
  });
});

describe('public registration', () => {
  it('cannot grant a privileged role: an approved applicant signs in as a plain member', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.receipt.status).toBe('pending_email_verification');
    expect(registered.receipt.requiresEmailVerification).toBe(true);

    const verified = await adapter.completeEmailVerification(registered.receipt.reference);
    expect(verified.ok).toBe(true);
    const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve');
    expect(approved.ok).toBe(true);

    const session = await adapter.signIn('aya.student@esme-cu.edu', STRONG);
    expect(session.identity.role).toBe('member');
    expect(session.identity.status).toBe('active');
    expect(session.identity.capabilities).not.toContain('registrations.decide');
  });

  it('hands the reviewer the questionnaire, not just the identity', async () => {
    await bootstrapSuperAdmin();
    await adapter.signIn(ADMIN.email, STRONG);
    const registered = await adapter.register(
      draft({ motivation: 'Wants to run the NDT workshop track.', technicalSkills: 'ANSYS, ultrasonic testing', availabilityHours: '10 h/week' })
    );
    if (!registered.ok) throw new Error('registration should succeed');

    const queue = await adapter.listRegistrations();
    const record = queue.find((r) => r.id === registered.receipt.reference);
    expect(record).toBeDefined();
    expect(record?.motivation).toBe('Wants to run the NDT workshop track.');
    expect(record?.technicalSkills).toBe('ANSYS, ultrasonic testing');
    expect(record?.availabilityHours).toBe('10 h/week');
    expect(record?.status).toBe('pending_email_verification');
    expect(record?.emailVerified).toBe(false);
  });

  it('rejects a duplicate identity with the deliberately vague message', async () => {    await bootstrapSuperAdmin();
    const first = await adapter.register(draft());
    expect(first.ok).toBe(true);

    const emailClash = await adapter.register(draft({ username: 'someone.else' }));
    const usernameClash = await adapter.register(draft({ email: 'other.person@esme-cu.edu' }));
    if (!emailClash.ok || !usernameClash.ok) {
      if (!emailClash.ok) expect(emailClash.failure.code).toBe('duplicate');
      // Identical either way: a rejected request must not name the field that collided.
      if (!emailClash.ok && !usernameClash.ok) expect(usernameClash.failure).toEqual(emailClash.failure);
      if (!emailClash.ok) {
        expect(emailClash.failure.message).toBe(DUPLICATE_IDENTITY_MESSAGE);
        expect(emailClash.failure.fields).toBeUndefined();
      }
    } else {
      throw new Error('both registrations should have been refused');
    }
  });

  it('returns field-keyed validation errors instead of a server message', async () => {
    await bootstrapSuperAdmin();
    const outcome = await adapter.register(
      draft({ fullName: 'A', email: 'not-an-email', username: 'A', password: 'weak', confirmPassword: 'weak2', acceptedPolicies: false })
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe('validation');
      expect(Object.keys(outcome.failure.fields ?? {}).sort()).toEqual(
        ['acceptedPolicies', 'confirmPassword', 'email', 'fullName', 'password', 'username'].sort()
      );
    }
  });
});

describe('account status gates access', () => {
  it('refuses an applicant who has not verified the email address yet', async () => {
    const admin = await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');

    await expect(adapter.signIn('aya.student@esme-cu.edu', STRONG)).rejects.toBeInstanceOf(AccessRevokedError);
    // the failed attempt belongs to the applicant, not the administrator holding the session
    expect((await adapter.restore())?.identity.id).toBe(admin.identity.id);
  });

  it('email verification on its own still grants no ERP access', async () => {
    const admin = await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');
    await adapter.completeEmailVerification(registered.receipt.reference);

    await expect(adapter.signIn('aya.student@esme-cu.edu', STRONG)).rejects.toBeInstanceOf(AccessRevokedError);
    // the administrator session is untouched by the failed attempt
    expect((await adapter.restore())?.identity.id).toBe(admin.identity.id);
  });

  it('approval is what activates an account, and it waits for verification', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');

    const tooEarly = await adapter.decideRegistration(registered.receipt.reference, 'approve');
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.error.code).toBe('unverified');

    await adapter.completeEmailVerification(registered.receipt.reference);
    const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve');
    expect(approved.ok).toBe(true);

    const session = await adapter.signIn('aya.student@esme-cu.edu', STRONG);
    expect(session.identity.status).toBe('active');
  });

  it('suspending an account blocks it and leaves no usable session', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');
    await adapter.completeEmailVerification(registered.receipt.reference);
    await adapter.decideRegistration(registered.receipt.reference, 'approve');
    const memberId = registered.receipt.reference;

    localStorage.setItem('ESME_CU_DEV_SESSION_V1', JSON.stringify({ userId: memberId, expiresAt: Date.now() + 60_000 }));
    expect((await adapter.restore())?.identity.id).toBe(memberId);

    await adapter.signIn(ADMIN.email, ADMIN.password);
    const suspended = await adapter.setAccountStatus(memberId, 'suspended');
    expect(suspended.ok).toBe(true);

    // A token minted before the suspension is refused: status is re-read on every restore.
    localStorage.setItem('ESME_CU_DEV_SESSION_V1', JSON.stringify({ userId: memberId, expiresAt: Date.now() + 60_000 }));
    expect(await adapter.restore()).toBeNull();
    await expect(adapter.signIn('aya.student@esme-cu.edu', STRONG)).rejects.toBeInstanceOf(AccessRevokedError);
  });

  it('protects the primary administrator and keeps suspension above moderator rank', async () => {
    const admin = await bootstrapSuperAdmin();
    const self = await adapter.setAccountStatus(admin.identity.id, 'suspended');
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error.code).toBe('protected');

    // Promote the applicant to a moderator: they may decide registrations, not suspend people.
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');
    await adapter.completeEmailVerification(registered.receipt.reference);
    await adapter.decideRegistration(registered.receipt.reference, 'approve');
    const promoted = await adapter.assignRole(registered.receipt.reference, 'moderator');
    expect(promoted.ok).toBe(true);

    await adapter.signIn('aya.student@esme-cu.edu', STRONG);
    expect((await adapter.restore())?.identity.role).toBe('moderator');
    await expect(adapter.setAccountStatus(admin.identity.id, 'suspended')).rejects.toBeInstanceOf(AuthFailedError);
    expect(await adapter.decideRegistration(admin.identity.id, 'reject', { reason: 'no' })).toEqual({ ok: false, error: { code: 'protected', message: expect.any(String) } });

    await adapter.signOut();
    await expect(adapter.setAccountStatus(admin.identity.id, 'suspended')).rejects.toBeInstanceOf(AccessRevokedError);
  });
});

describe('capability enforcement inside the adapter', () => {
  it('refuses a decision from an account that lacks registrations.decide', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');
    await adapter.completeEmailVerification(registered.receipt.reference);
    await adapter.decideRegistration(registered.receipt.reference, 'approve');

    await adapter.signIn('aya.student@esme-cu.edu', STRONG);
    await expect(adapter.listRegistrations()).rejects.toBeInstanceOf(AuthFailedError);
    await expect(
      adapter.decideRegistration(registered.receipt.reference, 'reject', { reason: 'no' })
    ).rejects.toBeInstanceOf(AuthFailedError);
  });

  it('refuses a role change from an account that lacks users.role.assign', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');
    await adapter.completeEmailVerification(registered.receipt.reference);
    await adapter.decideRegistration(registered.receipt.reference, 'approve');
    const memberSession = await adapter.signIn('aya.student@esme-cu.edu', STRONG);

    await expect(adapter.assignRole(memberSession.identity.id, 'super_admin')).rejects.toBeInstanceOf(AuthFailedError);
    const vault = JSON.parse(localStorage.getItem('ESME_CU_DEV_AUTH_V1') ?? '{}');
    expect(vault.accounts.find((a: { id: string }) => a.id === memberSession.identity.id).role).toBe('member');
  });

  it('refuses every privileged call once the caller signs out', async () => {
    await bootstrapSuperAdmin();
    await adapter.signOut();
    expect(await adapter.restore()).toBeNull();
    await expect(adapter.listRegistrations()).rejects.toBeInstanceOf(AccessRevokedError);
    await expect(adapter.decideRegistration('whatever', 'approve')).rejects.toBeInstanceOf(AccessRevokedError);
  });

  it('never accepts a hand-made session key that outlives the token window', async () => {
    const admin = await bootstrapSuperAdmin();
    localStorage.setItem('ESME_CU_DEV_SESSION_V1', JSON.stringify({ userId: admin.identity.id, expiresAt: Date.now() - 1000 }));
    expect(await adapter.restore()).toBeNull();
  });
});

describe('brute-force handling', () => {
  it('gives the same generic error for an unknown account and a wrong password', async () => {
    await bootstrapSuperAdmin();
    const unknown = await adapter.signIn('ghost.person@esme-cu.edu', STRONG).catch((e) => e);
    const wrong = await adapter.signIn(ADMIN.email, `${STRONG}x`).catch((e) => e);
    expect(unknown).toBeInstanceOf(AuthFailedError);
    expect(wrong).toBeInstanceOf(AuthFailedError);
    expect((unknown as Error).message).toBe((wrong as Error).message);
  });

  it('locks an identifier after five failed attempts and clears on success', async () => {
    await bootstrapSuperAdmin();
    await adapter.signOut();
    for (let i = 0; i < 5; i += 1) {
      await adapter.signIn(ADMIN.email, `${STRONG}wrong`).catch(() => undefined);
    }
    // The correct password is refused while the lock holds, so a script gains nothing.
    await expect(adapter.signIn(ADMIN.email, STRONG)).rejects.toBeInstanceOf(RateLimitedError);

    const throttle = JSON.parse(localStorage.getItem('ESME_CU_DEV_THROTTLE_V1') ?? '{}');
    expect(Object.keys(throttle)).toHaveLength(1);
    expect(throttle['kareemeltemsah7@gmail.com'].lockedUntil).toBeGreaterThan(Date.now());

    // Once the window has passed, sign-in succeeds and the counter is wiped.
    throttle['kareemeltemsah7@gmail.com'].lockedUntil = Date.now() - 1000;
    localStorage.setItem('ESME_CU_DEV_THROTTLE_V1', JSON.stringify(throttle));
    const after = await adapter.signIn(ADMIN.email, STRONG);
    expect(after.identity.role).toBe('super_admin');
    expect(localStorage.getItem('ESME_CU_DEV_THROTTLE_V1')).toBe('{}');
  });
});

describe('provider resolution', () => {
  it('refuses to authenticate a production build from browser storage', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const resolved = resolveAdapter();
    expect(resolved.adapter).toBeNull();
    if ('reason' in resolved) {
      expect(resolved.reason).toContain('VITE_SUPABASE_URL');
      expect(resolved.reason).toContain('migrations');
    }
    vi.unstubAllEnvs();
  });

  it('names the missing variables rather than failing silently', async () => {
    expect(isSupabaseConfigured()).toBe(false);
    await expect(createSupabaseAdapter().restore()).rejects.toBeInstanceOf(AuthNotConfiguredError);
  });

  it('labels the development fallback as development-only in every session', () => {
    expect(adapter.kind).toBe('local-dev');
    expect(adapter.warningBanner).toContain('LOCAL DEVELOPMENT AUTH');
    expect(adapter.warningBanner).toContain('Nothing here is production authentication');
    expect(adapter.warningBanner).toContain('VITE_SUPABASE_URL');
    // The production integration carries no banner, so the UI can never mask it as safe.
    expect(createSupabaseAdapter().warningBanner).toBe('');
  });
});
