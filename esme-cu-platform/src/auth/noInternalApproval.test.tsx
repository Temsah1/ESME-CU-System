// @vitest-environment jsdom
/**
 * Regression cover for one requirement: an ordinary account enters the chapter without a person
 * inside the chapter approving it.
 *
 * Every case runs the production code path — `createSupabaseAdapter()`, the real `<AuthProvider>`
 * and the real route guards — with GoTrue and PostgREST replaced by a stub that answers the shapes
 * the migrations define: signup returns a session (0012), `esme_identity` answers a profile row,
 * `esme_ensure_own_profile` recovers a missing one (0019), and a policy refusal arrives as 42501.
 *
 * What this therefore proves is the *client's* decisions: which statuses it admits, which failures
 * it treats as a logout, what it sends to the provider, and what a guard renders. It is NOT evidence
 * about a live project's row level security, its Auth settings or an applied migration — those stay
 * BLOCKED on authorization, and the trusted-side halves of the same rules are probes P47-P52 in
 * supabase/probes/authorization_probes.sql.
 */
import React from 'react';
import * as TL from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canAccessErp, describeLoginOutcome } from '../domain/accountState';
import { capabilitiesFor, hasCapability } from '../domain/roles';
import type { Capability } from '../domain/roles';
import type { RegistrationDraft } from './types';

const AUTH_UID = '2ab7c9d4-7f11-4a3b-9c1e-0d6b2f4a8e11';
const PASSWORD = 'Str0ng#Kx91';

type Row = Record<string, unknown>;
type Reply = { data?: unknown; error?: unknown };

const harness = {
  /** The provider session `getSession()` reports — a returning visitor's persisted one. */
  session: null as Row | null,
  signInUser: null as Row | null,
  signInError: null as Row | null,
  signUpUser: null as Row | null,
  signUpSession: null as Row | null,
  signUpError: null as Row | null,
  /** Replies handed out in order; the last one repeats, so a second read never surprises a test. */
  identity: [] as Reply[],
  ensure: [] as Reply[],
  rpcCalls: [] as { name: string; args?: Row }[],
  signUpPayload: null as Row | null,
  signOuts: 0,
  authHandler: null as ((event: string, session: Row | null) => void | Promise<void>) | null,
};

/**
 * One client for the whole file: `supabaseAdapter` caches it after the first build, so every stub
 * method has to read `harness` at call time rather than close over a per-test value.
 */
function clientStub() {
  return {
    auth: {
      getSession: async () => ({ data: { session: harness.session } }),
      signInWithPassword: async () => ({
        data: { user: harness.signInUser, session: harness.signInUser ? harness.session : null },
        error: harness.signInError,
      }),
      signUp: async (input: Row) => {
        harness.signUpPayload = input;
        return { data: { user: harness.signUpUser, session: harness.signUpSession }, error: harness.signUpError };
      },
      signOut: async () => {
        harness.signOuts += 1;
        harness.session = null;
        return { data: {}, error: null };
      },
      onAuthStateChange: (handler: (event: string, session: Row | null) => void | Promise<void>) => {
        harness.authHandler = handler;
        return { data: { subscription: { unsubscribe: () => void (harness.authHandler = null) } } };
      },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
    },
    rpc: async (name: string, args?: Row) => {
      harness.rpcCalls.push({ name, args });
      const list = name === 'esme_identity' ? harness.identity : name === 'esme_ensure_own_profile' ? harness.ensure : null;
      if (!list) return { data: null, error: null };
      if (list.length === 0) return { data: [], error: null };
      return list.length === 1 ? list[0] : (list.shift() as Reply);
    },
    from: () => {
      const chain: Row = {
        select: () => chain,
        eq: () => chain,
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return chain;
    },
  };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => clientStub() }));

const profile = (over: Row = {}): Row => ({
  id: AUTH_UID,
  email: 'aya.student@example.test',
  username: 'aya.student',
  display_name: 'Aya Student',
  role: 'member',
  status: 'active',
  committee_id: null,
  ...over,
});

const identityOf = (row: Row): Reply => ({ data: [row], error: null });
const providerError = (message: string, code?: string): Reply => ({
  data: null,
  error: code ? { message, code } : { message },
});

const draft = (over: Partial<RegistrationDraft> = {}): RegistrationDraft => ({
  fullName: 'Aya Student',
  email: 'aya.student@example.test',
  username: 'aya.student',
  password: PASSWORD,
  confirmPassword: PASSWORD,
  acceptedPolicies: true,
  motivation: 'Wants the NDT workshop track.',
  ...over,
});

async function adapter() {
  const mod = await import('./supabaseAdapter');
  return mod.createSupabaseAdapter();
}

/** The reason a rejection happened, read off the error without depending on module identity. */
function reasonOf(error: unknown): { name: string; reason?: string; retryable?: boolean; message: string } {
  const e = error as { name?: string; reason?: string; retryable?: boolean; message?: string };
  return { name: e?.name ?? '', reason: e?.reason, retryable: e?.retryable, message: e?.message ?? '' };
}

async function renderGate(options: { capability?: Capability } = {}) {
  const auth = await import('./AuthProvider');
  const guards = await import('./guards');

  const Harness: React.FC = () => {
    const { notice, identity } = auth.useAuth();
    const inner = options.capability ? (
      <guards.RequireCapability
        capability={options.capability}
        fallback={<p data-testid="denied">Not your area.</p>}
      >
        <p data-testid="workspace">The workspace is open.</p>
      </guards.RequireCapability>
    ) : (
      <p data-testid="workspace">The workspace is open.</p>
    );
    return (
      <div>
        <p data-testid="notice">{notice ?? ''}</p>
        <p data-testid="status">{identity?.status ?? ''}</p>
        <guards.RequireAuth onExit={() => undefined}>{inner}</guards.RequireAuth>
      </div>
    );
  };

  TL.render(
    React.createElement(auth.AuthProvider, null, React.createElement(Harness))
  );
  return TL.screen;
}

beforeEach(() => {
  Object.assign(harness, {
    session: null,
    signInUser: null,
    signInError: null,
    signUpUser: null,
    signUpSession: null,
    signUpError: null,
    identity: [],
    ensure: [],
    rpcCalls: [],
    signUpPayload: null,
    signOuts: 0,
    authHandler: null,
  });
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAAAA_AAAAAAA');
});

afterEach(() => {
  TL.cleanup();
  vi.unstubAllEnvs();
});

describe('a new account enters with no reviewer in between', () => {
  it('registers, and the same credentials open a member session one call later', async () => {
    const a = await adapter();
    harness.signUpUser = { id: AUTH_UID };
    harness.signUpSession = { user: { id: AUTH_UID } };

    const registered = await a.register(draft());
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.receipt.status).toBe('active');
    expect(registered.receipt.emailVerificationRequired).toBe(false);

    // Nothing was asked of a person inside the chapter between the two calls.
    expect(harness.rpcCalls.map((c) => c.name)).not.toContain('esme_decide_registration');

    harness.session = { user: { id: AUTH_UID } };
    harness.signInUser = { id: AUTH_UID };
    harness.identity = [identityOf(profile())];
    const session = await a.signIn('aya.student@example.test', PASSWORD);
    expect(session.identity.role).toBe('member');
    expect(session.identity.status).toBe('active');
    expect(session.identity.capabilities).toEqual(capabilitiesFor('member'));
  });

  it('resolves the profile through the auth uid the provider just issued', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile())];

    const session = await a.restore();
    expect(harness.rpcCalls).toContainEqual({ name: 'esme_identity', args: { p_user_id: AUTH_UID } });
    expect(session?.identity.id).toBe(AUTH_UID);
  });

  it('never sends a role, a status or an admin claim to the provider', async () => {
    const a = await adapter();
    harness.signUpUser = { id: AUTH_UID };
    harness.signUpSession = { user: { id: AUTH_UID } };

    // The draft type has no role field on purpose; the extra keys are what a tampered client would
    // smuggle in, and the payload builder must not forward them either way.
    await a.register(draft({ ...({ role: 'super_admin', is_admin: true, status: 'active' } as object) }));

    const data = harness.signUpPayload?.options as { data: Row } | undefined;
    expect(data).toBeTruthy();
    expect(Object.keys(data!.data)).not.toContain('role');
    expect(Object.keys(data!.data)).not.toContain('status');
    expect(Object.keys(data!.data)).not.toContain('is_admin');
    expect(JSON.stringify(data!.data)).not.toContain('super_admin');
    expect(data!.data.full_name).toBe('Aya Student');
  });

  it('takes the role from the profile row, so a claim in the draft changes nothing', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile({ role: 'member' }))];

    const session = await a.restore();
    expect(session?.identity.role).toBe('member');
    expect(hasCapability(session!.identity.role, 'users.read')).toBe(false);
    expect(hasCapability(session!.identity.role, 'registrations.decide')).toBe(false);
    expect(hasCapability(session!.identity.role, 'audit.read')).toBe(false);
  });

  it('keeps a privileged account exactly as privileged as it was', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile({ role: 'super_admin', display_name: 'Kareem Tamer' }))];

    const session = await a.restore();
    expect(session?.identity.role).toBe('super_admin');
    expect(session?.identity.capabilities).toContain('users.role.assign');
    expect(session?.identity.capabilities).toContain('registrations.decide');
  });
});

describe('a directory status is placement, not a gate', () => {
  it('admits a legacy account still parked in pending_approval without signing it out', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile({ status: 'pending_approval' }))];

    const session = await a.restore();
    expect(session?.identity.status).toBe('pending_approval');
    expect(session?.identity.capabilities).toEqual(capabilitiesFor('member'));
    expect(harness.signOuts).toBe(0);
  });

  it('closes a session only for the two sanctions', async () => {
    const a = await adapter();
    for (const status of ['rejected', 'suspended']) {
      harness.session = { user: { id: AUTH_UID } };
      harness.signOuts = 0;
      harness.identity = [identityOf(profile({ status }))];
      const outcome = reasonOf(await a.restore().catch((e: unknown) => e));
      expect(outcome.name).toBe('AccessRevokedError');
      expect(harness.signOuts).toBe(1);
    }
    expect(canAccessErp('pending_approval')).toBe(true);
    expect(canAccessErp('active')).toBe(true);
    expect(canAccessErp('rejected')).toBe(false);
    expect(canAccessErp('suspended')).toBe(false);
  });

  it('names only the two sanctions as blocked outcomes', () => {
    expect(describeLoginOutcome('pending_approval').kind).toBe('granted');
    expect(describeLoginOutcome('active').kind).toBe('granted');
    for (const status of ['rejected', 'suspended'] as const) {
      expect(describeLoginOutcome(status).kind).toBe('blocked');
    }
    // No wording in the admitted branch may claim somebody has to approve the account.
    expect(describeLoginOutcome('pending_approval').message).toMatch(/signed in/i);
    expect(describeLoginOutcome('pending_approval').message).not.toMatch(/ask an administrator/i);
  });
});

describe('email verification is a provider step, never an approval', () => {
  it('reports verification as required when the provider issued no session', async () => {
    const a = await adapter();
    harness.signUpUser = { id: AUTH_UID };
    harness.signUpSession = null;

    const registered = await a.register(draft());
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(registered.receipt.emailVerificationRequired).toBe(true);
    expect(registered.receipt.status).toBe('active');
  });

  it('reports it as satisfied when the provider opened a session straight away', async () => {
    const a = await adapter();
    harness.signUpUser = { id: AUTH_UID };
    harness.signUpSession = { user: { id: AUTH_UID } };

    const registered = await a.register(draft());
    if (!registered.ok) throw new Error('registration should succeed');
    expect(registered.receipt.emailVerificationRequired).toBe(false);
  });

  it('refuses a sign-in the provider refused, and says nothing about approval', async () => {
    const a = await adapter();
    harness.signInError = { message: 'Email not confirmed' };
    harness.signInUser = null;

    const outcome = reasonOf(await a.signIn('aya.student@example.test', PASSWORD).catch((e: unknown) => e));
    expect(outcome.name).toBe('AuthFailedError');
    expect(outcome.message).toMatch(/did not match/i);
    expect(outcome.message).not.toMatch(/approv/i);
  });
});

describe('a profile that cannot be read is reported as itself', () => {
  it('recovers a profile the signup trigger failed to create, exactly once', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [{ data: [], error: null }, identityOf(profile())];

    const session = await a.restore();
    expect(session?.identity.id).toBe(AUTH_UID);
    expect(harness.rpcCalls.filter((c) => c.name === 'esme_ensure_own_profile')).toHaveLength(1);
    expect(harness.signOuts).toBe(0);
  });

  it('treats a PGRST116 no-rows answer as an absent profile, not an outage', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [providerError('Cannot embed the return values', 'PGRST116'), identityOf(profile())];

    expect((await a.restore())?.identity.status).toBe('active');
  });

  it('still says missing profile when the recovery step also answers nothing', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [{ data: [], error: null }];
    harness.ensure = [{ data: false, error: null }];

    const outcome = reasonOf(await a.restore().catch((e: unknown) => e));
    expect(outcome.reason).toBe('missing_profile');
    expect(outcome.retryable).toBe(false);
    expect(outcome.message).toMatch(/no chapter profile/i);
    expect(outcome.message).not.toMatch(/ask an administrator/i);
    // The credential the provider issued is not thrown away because a row is missing.
    expect(harness.signOuts).toBe(0);
  });

  it('classifies a row level security refusal as a refusal, and keeps the session', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [providerError('permission denied for table esme_profiles', '42501')];

    const outcome = reasonOf(await a.restore().catch((e: unknown) => e));
    expect(outcome.reason).toBe('access_denied');
    expect(outcome.retryable).toBe(true);
    expect(outcome.message).toMatch(/refused to read/i);
    expect(harness.signOuts).toBe(0);
  });

  it('names an unapplied migration as one instead of a password problem', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [providerError('Could not find the function public.esme_identity(p_user_id) in the schema cache', 'PGRST202')];

    const first = reasonOf(await a.restore().catch((e: unknown) => e));
    expect(first.reason).toBe('not_migrated');
    expect(first.message).toMatch(/migrations/i);

    // The same reading when only the recovery step is missing: absent profile + unknown function.
    harness.identity = [{ data: [], error: null }];
    harness.ensure = [providerError('Could not find the function public.esme_ensure_own_profile in the schema cache', 'PGRST202')];
    const second = reasonOf(await a.restore().catch((e: unknown) => e));
    expect(second.reason).toBe('not_migrated');
  });

  it('calls an unreachable database unavailable, never an expired session', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [providerError('fetch failed')];

    const outcome = reasonOf(await a.restore().catch((e: unknown) => e));
    expect(outcome.reason).toBe('provider_unavailable');
    expect(outcome.retryable).toBe(true);
    expect(outcome.message).not.toMatch(/expired/i);
  });

  it('passes the failure reason to subscribers instead of reporting a plain sign-out', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile()), providerError('permission denied for table esme_profiles', '42501')];

    const seen: { session: unknown; problem: unknown }[] = [];
    a.subscribe((session, problem) => seen.push({ session, problem }));
    await TL.waitFor(() => expect(harness.authHandler).toBeTruthy());

    await harness.authHandler?.('SIGNED_IN', harness.session);
    await harness.authHandler?.('TOKEN_REFRESHED', harness.session);

    expect(seen[0]?.session).toBeTruthy();
    expect(reasonOf(seen[1]?.problem).reason).toBe('access_denied');
    expect(seen[1]?.session).toBeNull();
    expect(harness.signOuts).toBe(0);
  });

  it('reports a real sign-out with no problem attached', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile())];

    const seen: { session: unknown; problem: unknown }[] = [];
    a.subscribe((session, problem) => seen.push({ session, problem }));
    await TL.waitFor(() => expect(harness.authHandler).toBeTruthy());

    await harness.authHandler?.('SIGNED_OUT', null);
    expect(seen).toEqual([{ session: null, problem: undefined }]);
  });

  it('repairs a status this build does not know onto the placement queue', async () => {
    const a = await adapter();
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile({ status: 'pending_email_verification' }))];

    const session = await a.restore();
    expect(session?.identity.status).toBe('pending_approval');
    expect(canAccessErp(session!.identity.status)).toBe(true);
  });
});

describe('the rendered workspace follows the same rule', () => {
  it('shows a member whose committee placement nobody has recorded the workspace', async () => {
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile({ status: 'pending_approval' }))];
    const screen = await renderGate();

    expect(await screen.findByTestId('workspace')).toBeTruthy();
    expect(screen.getByTestId('status').textContent).toBe('pending_approval');
    expect(screen.queryByText(/ask an administrator/i)).toBeNull();
    expect(screen.queryByText(/has to approve/i)).toBeNull();
  });

  it('turns away only a sanctioned account', async () => {
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile({ status: 'suspended' }))];
    const screen = await renderGate();

    // The session is torn down before the guard can hold a sanctioned identity, so what the reader
    // gets is the sign-in panel plus a notice that names the sanction — not an approval message.
    expect(await screen.findByText(/Sign in to open the chapter workspace/)).toBeTruthy();
    expect(screen.queryByTestId('workspace')).toBeNull();
    expect(screen.getByTestId('notice').textContent).toMatch(/suspended/);
  });

  it('keeps an administrator-only area closed to a member and open to the administrator', async () => {
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile({ status: 'pending_approval' }))];
    const screen = await renderGate({ capability: 'users.read' });

    expect(await screen.findByTestId('denied')).toBeTruthy();
    expect(screen.queryByTestId('workspace')).toBeNull();
    TL.cleanup();

    harness.identity = [identityOf(profile({ role: 'super_admin' }))];
    const admin = await renderGate({ capability: 'users.read' });
    expect(await admin.findByTestId('workspace')).toBeTruthy();
  });

  it('rides out a retryable profile failure mid-session instead of logging the member out', async () => {
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile()), providerError('fetch failed')];
    const screen = await renderGate();
    expect(await screen.findByTestId('workspace')).toBeTruthy();
    await TL.waitFor(() => expect(harness.authHandler).toBeTruthy());

    await harness.authHandler?.('TOKEN_REFRESHED', harness.session);

    expect(await screen.findByTestId('workspace')).toBeTruthy();
    expect(screen.getByTestId('notice').textContent).toMatch(/could not reach its database/i);
    // The first read consumed the good reply, so a refresh probe now sees the failure still standing.
    expect(harness.signOuts).toBe(0);
  });

  it('closes the workspace when the refresh reads a sanction', async () => {
    harness.session = { user: { id: AUTH_UID } };
    harness.identity = [identityOf(profile()), identityOf(profile({ status: 'suspended' }))];
    const screen = await renderGate();
    expect(await screen.findByTestId('workspace')).toBeTruthy();
    await TL.waitFor(() => expect(harness.authHandler).toBeTruthy());

    await harness.authHandler?.('USER_UPDATED', harness.session);

    expect(await screen.findByText(/Sign in to open the chapter workspace/)).toBeTruthy();
    expect(screen.queryByTestId('workspace')).toBeNull();
    // The adapter, not the guard, ended it — and it signed the provider out on the way.
    expect(harness.signOuts).toBe(1);
  });

  it('asks nobody to sign in when the session is simply not there yet', async () => {
    harness.session = null;
    harness.identity = [{ data: [], error: null }];
    const screen = await renderGate();

    expect(await screen.findByText(/Sign in to open the chapter workspace/)).toBeTruthy();
    expect(screen.getByText(/Creating an account is enough/i)).toBeTruthy();
  });
});
