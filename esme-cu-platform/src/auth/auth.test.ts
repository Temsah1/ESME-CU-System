// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalDevAdapter } from './localDevAdapter';
import { createSupabaseAdapter, configurationProblems, isSupabaseConfigured } from './supabaseAdapter';
import { resolveAdapter } from './index';
import { AccessRevokedError, AuthFailedError, AuthMisconfiguredError, AuthNotConfiguredError, RateLimitedError } from './errors';
import { DUPLICATE_IDENTITY_MESSAGE } from '../domain/registration';
import type { AuthAdapter, RegistrationDraft } from './types';

/**
 * These suites exercise the *rules* the auth layer must enforce: nothing is privileged at
 * registration, a submitted request is reviewable at once with no click in between, only an
 * approved account opens the ERP, the queue refuses a burst of submissions, and every admin
 * action re-reads the caller's capability.
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
    expect(registered.receipt.status).toBe('pending_approval');

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
    expect(record?.status).toBe('pending_approval');
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
  it('refuses a burst of submissions now that nothing waits for a click', async () => {
    await bootstrapSuperAdmin();
    // The administrator's account is inside the window too, so four more fill it.
    for (let i = 0; i < 4; i += 1) {
      const outcome = await adapter.register(draft({ email: `applicant${i}@esme-cu.edu`, username: `applicant.${i}` }));
      expect(outcome.ok).toBe(true);
    }
    const burst = await adapter.register(draft({ email: 'applicant4@esme-cu.edu', username: 'applicant.4' }));
    expect(burst.ok).toBe(false);
    if (!burst.ok) expect(burst.failure.code).toBe('rate_limited');
    // Nothing was written for the refused request, so the queue did not grow.
    expect((await adapter.listRegistrations()).filter((r) => r.email === 'applicant4@esme-cu.edu')).toHaveLength(0);
  });
});

/**
 * The academic questions are only worth having if the answers survive the trip.
 *
 * The portal validates against the schema it rendered; these run the same rules with no form in
 * the loop, because that is what the provider-side call does — and it is the difference between a
 * dropdown nobody can bypass and a suggestion an applicant can.
 */
describe('the academic answers on the trusted side', () => {
  it('are stored with the request and still there after the decision', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(
      draft({
        studentId: '2026-118842',
        academicYear: 'Junior',
        department: 'Mechanical Design & Production',
        phone: '+201000000000',
        committeeMembership: 'yes',
        committeeId: 'comm_high_board',
      })
    );
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;

    const before = (await adapter.listRegistrations()).find((r) => r.id === registered.receipt.reference);
    expect(before?.academicYear).toBe('Junior');
    expect(before?.department).toBe('Mechanical Design & Production');
    expect(before?.studentId).toBe('2026-118842');
    expect(before?.committeeMembership).toBe('yes');
    // The committee named on the form is the request; nothing is assigned until a reviewer says so.
    expect(before?.committeeId).toBe('comm_high_board');
    expect(before?.assignedCommitteeId).toBeUndefined();

    expect((await adapter.decideRegistration(registered.receipt.reference, 'approve')).ok).toBe(true);

    const after = (await adapter.listRegistrations()).find((r) => r.id === registered.receipt.reference);
    expect(after?.status).toBe('active');
    expect(after?.academicYear).toBe('Junior');
    expect(after?.department).toBe('Mechanical Design & Production');
    expect(after?.committeeMembership).toBe('yes');
    expect(after?.assignedCommitteeId).toBeUndefined();

    // …and the account the approval activated is a plain member, High Board named or not.
    const session = await adapter.signIn('aya.student@esme-cu.edu', STRONG);
    expect(session.identity.role).toBe('member');
    expect(session.identity.committeeId).toBe('comm_high_board');
    expect(session.identity.capabilities).not.toContain('registrations.decide');
    expect(session.identity.capabilities).not.toContain('users.role.assign');
  });

  it('refuses a yes that names no committee, with no form to catch it first', async () => {
    await bootstrapSuperAdmin();
    const outcome = await adapter.register(draft({ committeeMembership: 'yes' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.failure.code).toBe('validation');
      expect(Object.keys(outcome.failure.fields ?? {})).toContain('committeeId');
    }
    expect((await adapter.listRegistrations()).filter((r) => r.email === 'aya.student@esme-cu.edu')).toHaveLength(0);
  });

  it('refuses a second preference that names the same committee twice', async () => {
    await bootstrapSuperAdmin();
    const outcome = await adapter.register(
      draft({ committeeMembership: 'yes', committeeId: 'comm_mc', secondCommitteePreferenceId: 'comm_mc' })
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(Object.keys(outcome.failure.fields ?? {})).toContain('secondCommitteePreferenceId');
  });

  it('still registers the request an earlier build sent, with no academic answers at all', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;

    const record = (await adapter.listRegistrations()).find((r) => r.id === registered.receipt.reference);
    // Absent, not invented: a reviewer sees an empty row rather than a department nobody chose.
    expect(record?.committeeMembership).toBeUndefined();
    expect(record?.department).toBeUndefined();
    expect(record?.academicYear).toBeUndefined();
    expect((await adapter.decideRegistration(registered.receipt.reference, 'approve')).ok).toBe(true);
  });
});

describe('account status gates access', () => {
  it('refuses an applicant whose request has not been decided yet', async () => {
    const admin = await bootstrapSuperAdmin();
    await adapter.register(draft());

    await expect(adapter.signIn('aya.student@esme-cu.edu', STRONG)).rejects.toBeInstanceOf(AccessRevokedError);
    // the failed attempt belongs to the applicant, not the administrator holding the session
    expect((await adapter.restore())?.identity.id).toBe(admin.identity.id);
  });

  it('approval is what activates an account, and the request is decidable the moment it exists', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');

    const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve');
    expect(approved.ok).toBe(true);

    const session = await adapter.signIn('aya.student@esme-cu.edu', STRONG);
    expect(session.identity.status).toBe('active');
  });

  it('will not decide the same request twice', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');

    expect((await adapter.decideRegistration(registered.receipt.reference, 'approve')).ok).toBe(true);
    const again = await adapter.decideRegistration(registered.receipt.reference, 'reject', { reason: 'changed my mind' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('already_decided');
  });

  it('repairs a vault row left on the retired verification stage', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');

    // Storage written by the build that still had the stage.
    const vault = JSON.parse(localStorage.getItem('ESME_CU_DEV_AUTH_V1') ?? '{}');
    vault.accounts.find((a: { id: string }) => a.id === registered.receipt.reference).status = 'pending_email_verification';
    localStorage.setItem('ESME_CU_DEV_AUTH_V1', JSON.stringify(vault));

    const reopened = createLocalDevAdapter();
    const queued = (await reopened.listRegistrations()).find((r) => r.id === registered.receipt.reference);
    expect(queued?.status).toBe('pending_approval');
    expect((await reopened.decideRegistration(registered.receipt.reference, 'approve')).ok).toBe(true);
  });

  it('suspending an account blocks it and leaves no usable session', async () => {
    await bootstrapSuperAdmin();
    const registered = await adapter.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');
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

describe('account directory', () => {
  /**
   * The committee screens can only appoint someone the provider actually reports. Before
   * `listAccounts` existed, an approved applicant stayed invisible to the ERP, so the
   * leadership selector offered nothing and an appointment could only be faked by creating a
   * duplicate profile by hand.
   */
  it('shows the administrator every account, applicants included', async () => {
    await bootstrapSuperAdmin();
    await adapter.register(draft());

    const accounts = await adapter.listAccounts();
    expect(accounts.map((a) => a.email).sort()).toEqual(['aya.student@esme-cu.edu', ADMIN.email].sort());
    const applicant = accounts.find((a) => a.email === 'aya.student@esme-cu.edu')!;
    expect(applicant).toMatchObject({ status: 'pending_approval', role: 'member' });
    // Nothing on the account says "awaiting a click" any more — the queue has no such stage.
    expect(applicant).not.toHaveProperty('emailVerified');
    expect(applicant.id).toBeTruthy();
    expect(applicant).not.toHaveProperty('hash');
    expect(applicant).not.toHaveProperty('salt');
  });

  it('lists an approved applicant under the same id the admin actions use', async () => {
    await bootstrapSuperAdmin();
    await adapter.register(draft());
    const queued = (await adapter.listRegistrations()).find((r) => r.email === 'aya.student@esme-cu.edu')!;

    const decided = await adapter.decideRegistration(queued.id, 'approve', { committeeId: 'comm_te' });
    expect(decided.ok).toBe(true);

    const listed = (await adapter.listAccounts()).find((a) => a.id === queued.id)!;
    expect(listed).toMatchObject({ status: 'active', committeeId: 'comm_te' });

    // The id the directory advertises is the id the provider will accept a change for.
    expect((await adapter.setAccountStatus(queued.id, 'suspended')).ok).toBe(true);
    expect((await adapter.listAccounts()).find((a) => a.id === queued.id)?.status).toBe('suspended');
    expect((await adapter.assignRole(queued.id, 'head')).ok).toBe(true);
  });

  it('refuses the directory to a role that has no users.read', async () => {
    await bootstrapSuperAdmin();
    await adapter.register(draft());
    const queued = (await adapter.listRegistrations()).find((r) => r.email === 'aya.student@esme-cu.edu')!;
    await adapter.decideRegistration(queued.id, 'approve');
    await adapter.signIn(queued.email, STRONG);

    await expect(adapter.listAccounts()).rejects.toBeInstanceOf(AuthFailedError);
  });
});

describe('email preferences through the adapter', () => {
  it('round-trips the choice through the provider, not through the screen state', async () => {
    const admin = await bootstrapSuperAdmin();

    expect(await adapter.readEmailPreferences()).toEqual(
      expect.objectContaining({ userId: admin.identity.id, locale: 'en', mutedEvents: [] })
    );

    const saved = await adapter.saveEmailPreferences({
      userId: admin.identity.id,
      locale: 'ar',
      mutedEvents: ['deadline_reminder'],
      updatedAt: new Date().toISOString(),
    });
    expect(saved.ok).toBe(true);

    // A second adapter over the same storage is what another mount of the screen sees.
    const reopened = createLocalDevAdapter();
    expect(await reopened.readEmailPreferences()).toMatchObject({ locale: 'ar', mutedEvents: ['deadline_reminder'] });
  });

  it('will not store an account-safety mute, even from a hand-made request', async () => {
    await bootstrapSuperAdmin();
    const result = await adapter.saveEmailPreferences({
      userId: 'someone-else',
      locale: 'en',
      mutedEvents: ['login_security_alert', 'account_approved', 'task_assigned'],
      updatedAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(true);

    const stored = await adapter.readEmailPreferences();
    expect(stored?.mutedEvents).toEqual(['task_assigned']);
    // The request claimed another account; the provider keys the row to the session.
    expect(stored?.userId).not.toBe('someone-else');
  });

  it('refuses to save for an account that is not signed in', async () => {
    await bootstrapSuperAdmin();
    await adapter.signOut();
    const result = await adapter.saveEmailPreferences({
      userId: 'x',
      locale: 'en',
      mutedEvents: [],
      updatedAt: new Date().toISOString(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no-session');
    expect(await adapter.readEmailPreferences()).toBeNull();
  });
});

describe('seeded test accounts', () => {
  const COMMITTEES = [
    { id: 'comm_te', shortCode: 'T&E', name: 'Technical & Engineering Committee' },
    { id: 'comm_marketing', shortCode: 'MK', name: 'Marketing Committee' },
  ];
  const accounts = () =>
    (JSON.parse(localStorage.getItem('ESME_CU_DEV_AUTH_V1') ?? '{}').accounts ?? []) as {
      id: string;
      email: string;
      username: string;
      role: string;
      status: string;
      hash: string;
    }[];

  async function seed() {
    await bootstrapSuperAdmin();
    return adapter.seedTestAccounts({ committees: COMMITTEES });
  }

  it('opens one account per role, seated and signed in with its own fixture password', async () => {
    const report = await seed();
    expect(report.refusal).toBeNull();
    expect(report.created.map((c) => c.email)).toEqual([
      'test.head@esme.test',
      'test.director@esme.test',
      'test.member@esme.test',
    ]);
    expect(report.conflicts).toEqual([]);

    const head = await adapter.signIn('test.head@esme.test', 'TestHead@123');
    expect(head.identity.role).toBe('head');
    expect(head.identity.committeeId).toBe('comm_te');
    const director = await adapter.signIn('test.director@esme.test', 'TestDir@123');
    expect(director.identity.role).toBe('director');
    expect(director.identity.committeeId).toBe('comm_marketing');
    const member = await adapter.signIn('test.member@esme.test', 'TestMem@123');
    expect(member.identity.capabilities).toContain('submissions.create');
  });

  it('seeds an active account, not an applicant waiting to be decided', async () => {
    await seed();
    // A plain member is normally in the queue because an approved applicant stays readable there;
    // a provisioned tester never applied, so it must not appear as though it did.
    const registered = await adapter.register(draft());
    expect(registered.ok).toBe(true);
    const queue = await adapter.listRegistrations();
    expect(queue.map((r) => r.email)).toContain('aya.student@esme-cu.edu');
    expect(queue.map((r) => r.email)).not.toContain('test.member@esme.test');
  });

  it('resets a fixture this device had edited away, and says it repaired rather than created', async () => {
    await seed();
    const vault = JSON.parse(localStorage.getItem('ESME_CU_DEV_AUTH_V1') ?? '{}');
    vault.accounts.find((a: { email: string }) => a.email === 'test.head@esme.test').role = 'member';
    vault.accounts.find((a: { email: string }) => a.email === 'test.head@esme.test').status = 'suspended';
    localStorage.setItem('ESME_CU_DEV_AUTH_V1', JSON.stringify(vault));

    const second = await adapter.seedTestAccounts({ committees: COMMITTEES });
    expect(second.created).toEqual([]);
    expect(second.repaired.map((r) => r.email)).toEqual([
      'test.head@esme.test',
      'test.director@esme.test',
      'test.member@esme.test',
    ]);
    expect(accounts().length).toBe(4); // three testers plus the primary admin, never a fourth tester

    const revived = await adapter.signIn('test.head@esme.test', 'TestHead@123');
    expect(revived.identity.role).toBe('head');
    expect(revived.identity.status).toBe('active');
  });

  it('refuses to take over an identity a real account already holds', async () => {
    await bootstrapSuperAdmin();
    const squatter = await adapter.register(draft({ username: 'test_head' }));
    expect(squatter.ok).toBe(true);
    const before = accounts().find((a) => a.username === 'test_head');

    const report = await adapter.seedTestAccounts({ committees: COMMITTEES });
    expect(report.conflicts.map((c) => c.fixtureKey)).toEqual(['head']);
    expect(report.conflicts[0].reason).toMatch(/not this fixture/);
    expect(report.created.map((c) => c.email)).toEqual([
      'test.director@esme.test',
      'test.member@esme.test',
    ]);
    const after = accounts().find((a) => a.username === 'test_head');
    expect(after?.hash).toBe(before?.hash);
    expect(after?.email).toBe('aya.student@esme-cu.edu');
  });

  it('deletes exactly the three testers and leaves every other account alone', async () => {
    await seed();
    const registered = await adapter.register(draft());
    expect(registered.ok).toBe(true);

    const report = await adapter.removeTestAccounts();
    expect(report.refusal).toBeNull();
    expect(report.removed.slice().sort()).toEqual(
      ['test.head@esme.test', 'test.director@esme.test', 'test.member@esme.test'].sort()
    );
    expect(accounts().map((a) => a.email).sort()).toEqual([ADMIN.email, 'aya.student@esme-cu.edu'].sort());
  });

  it('drops the live session when the account holding it is one of the testers', async () => {
    await seed();
    // Reachable through a promotion: a tester raised to Super Admin is the only fixture that could
    // issue its own deletion, and it must not stay authenticated to a row that no longer exists.
    const promote = await adapter.assignRole('usr_test_head', 'super_admin');
    expect(promote.ok).toBe(true);
    await adapter.signIn('test.head@esme.test', 'TestHead@123');
    expect(localStorage.getItem('ESME_CU_DEV_SESSION_V1')).toBeTruthy();

    const report = await adapter.removeTestAccounts();
    expect(report.removed.length).toBe(3);
    expect(localStorage.getItem('ESME_CU_DEV_SESSION_V1')).toBeNull();
  });

  it('will not seed in a production build unless the operator switched it on', async () => {
    await bootstrapSuperAdmin();
    vi.stubEnv('PROD', true);
    const report = await adapter.seedTestAccounts({ committees: COMMITTEES });
    expect(report.refusal).toMatch(/production build/i);
    expect(report.created).toEqual([]);
    expect(accounts().length).toBe(1);
    vi.unstubAllEnvs();

    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_ALLOW_TEST_ACCOUNTS', 'true');
    const allowed = await adapter.seedTestAccounts({ committees: COMMITTEES });
    expect(allowed.refusal).toBeNull();
    expect(allowed.created.length).toBe(3);
    vi.unstubAllEnvs();
  });

  it('seats a tester without inventing a committee this workspace does not have', async () => {
    await bootstrapSuperAdmin();
    const report = await adapter.seedTestAccounts({ committees: [{ id: 'comm_only_te', shortCode: 't&e' }] });
    expect(report.unresolvedCommittees).toEqual(['comm_marketing']);
    expect(report.created.find((c) => c.username === 'test_head')?.committeeId).toBe('comm_only_te');
    expect(report.created.find((c) => c.username === 'test_director')?.committeeId).toBeUndefined();
  });

  it('requires the capability that opens accounts, whichever session asks', async () => {
    await seed();
    await adapter.signIn('test.member@esme.test', 'TestMem@123');
    await expect(adapter.seedTestAccounts({ committees: COMMITTEES })).rejects.toBeInstanceOf(AuthFailedError);
    await expect(adapter.removeTestAccounts()).rejects.toBeInstanceOf(AuthFailedError);
  });

  it('never creates the real provider’s accounts from a browser, and prints the statements instead', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    const provider = createSupabaseAdapter();
    const seed = await provider.seedTestAccounts({ committees: COMMITTEES });
    expect(seed.refusal).toContain('esme_arm_test_account_seed');
    expect(seed.refusal).toContain('esme_seed_test_accounts');
    const remove = await provider.removeTestAccounts();
    expect(remove.refusal).toContain('esme_remove_test_accounts');
    // Refusing is not the same as failing: no client was built, so no credential was needed.
    expect(storage.length).toBe(0);
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

  it('refuses a configured-looking provider that cannot work from a browser', () => {
    // Synthetic. A publishable key is still a credential and never belongs in a tracked file; the
    // shape is what this test cares about, not a live value.
    const publishable = 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAAAA_AAAAAAA';
    // The mistake this catches was observed in a real .env.local: the REST path pasted after the
    // project host, which sends every request to …/rest/v1/rest/v1/… and reads back as a bad login.
    expect(configurationProblems('https://project.supabase.co/rest/v1/', publishable)).toEqual([
      expect.stringContaining('project root only'),
    ]);
    expect(configurationProblems('not a url', publishable)[0]).toContain('absolute URL');
    expect(configurationProblems('http://project.supabase.co', publishable)).toEqual([]);

    const serviceRoleJwt = `header.${btoa(JSON.stringify({ role: 'service_role' })).replace(/\+/g, '-').replace(/\//g, '_')}.sig`;
    for (const forbidden of ['sb_secret_AbCdEfGhIjKlMnOpQrStUv', serviceRoleJwt]) {
      const problems = configurationProblems('https://project.supabase.co', forbidden);
      expect(problems).toHaveLength(1);
      // The value is a credential: the words that reach the screen must not carry it.
      expect(problems[0]).not.toContain(forbidden);
      expect(problems[0]).not.toContain('AbCdEfGhIjKlMnOp');
    }

    expect(configurationProblems('https://project.supabase.co', publishable)).toEqual([]);
    expect(configurationProblems('https://project.supabase.co', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig')).toEqual([]);
  });

  it('raises the misconfiguration instead of letting it look like a rejected password', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co/rest/v1/');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_secret_AbCdEfGhIjKlMnOpQrStUv');
    const first = await createSupabaseAdapter().restore().catch((e: unknown) => e);
    expect(first).toBeInstanceOf(AuthMisconfiguredError);
    expect((first as AuthMisconfiguredError).problems).toEqual([
      expect.stringContaining('project root only'),
      expect.stringContaining('secret API key'),
    ]);

    // A failed attempt may not be memoised: the second call must report the configuration it is
    // actually looking at now, not the first one's complaint. Neither call builds a client, so this
    // stays offline — the client is only reached once both values pass.
    vi.stubEnv('VITE_SUPABASE_URL', 'not a url');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAAAA_AAAAAAA');
    const second = await createSupabaseAdapter().restore().catch((e: unknown) => e);
    expect(second).toBeInstanceOf(AuthMisconfiguredError);
    expect((second as AuthMisconfiguredError).problems).toEqual([expect.stringContaining('absolute URL')]);

    // The rejected configuration is still a configured provider: falling back to the development
    // vault here would let a misread environment sign somebody in against browser storage.
    expect(isSupabaseConfigured()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('does not report a saved email preference that no provider accepted', async () => {
    const withoutProvider = createSupabaseAdapter();
    await expect(withoutProvider.readEmailPreferences()).rejects.toBeInstanceOf(AuthNotConfiguredError);
    await expect(
      withoutProvider.saveEmailPreferences({
        userId: 'x',
        locale: 'ar',
        mutedEvents: ['task_assigned'],
        updatedAt: new Date().toISOString(),
      })
    ).rejects.toBeInstanceOf(AuthNotConfiguredError);
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
