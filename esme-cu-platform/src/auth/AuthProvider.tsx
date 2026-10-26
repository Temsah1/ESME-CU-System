import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { canAccessErp, describeLoginOutcome } from '../domain/accountState';
import { hasCapability, type Capability, type Role } from '../domain/roles';
import { resolveAdapter } from './index';
import { AccessRevokedError, AuthNotConfiguredError, ProfileResolutionError } from './errors';
import type { AuthAdapter, AuthIdentity, AuthSession, RegistrationDraft, RegistrationOutcome } from './types';

export type AuthStatus = 'checking' | 'signed_out' | 'signed_in' | 'unavailable';

export type AuthState = {
  status: AuthStatus;
  session: AuthSession | null;
  identity: AuthIdentity | null;
  adapter: AuthAdapter | null;
  /** Populated when no provider is configured; blocks the whole app rather than faking a login. */
  configurationError: string | null;
  needsPrimaryAdminBootstrap: boolean;
  notice: string | null;
};

type AuthActions = {
  signIn: (identifier: string, password: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
  register: (draft: RegistrationDraft) => Promise<RegistrationOutcome>;
  refresh: () => Promise<void>;
  bootstrapPrimaryAdmin: (input: {
    fullName: string;
    email: string;
    username: string;
    password: string;
    confirmPassword: string;
  }) => Promise<{ ok: boolean; message: string }>;
  clearNotice: () => void;
};

const AuthContext = createContext<(AuthState & AuthActions) | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const resolution = useMemo(() => resolveAdapter(), []);
  const adapter = resolution.adapter;
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>(adapter ? 'checking' : 'unavailable');
  const [configurationError, setConfigurationError] = useState<string | null>(
    resolution.adapter ? null : resolution.reason
  );
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  // Read-only mirror of `session`, so a retryable profile failure can be answered without the
  // current session becoming a dependency of `probe` — re-creating probe would re-subscribe to the
  // provider on every sign-in.
  const sessionRef = useRef<AuthSession | null>(null);
  const applySession = useCallback((next: AuthSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  const probe = useCallback(async () => {
    if (!adapter) return;
    const attempt = ++generation.current;
    try {
      const restored = await adapter.restore();
      if (attempt !== generation.current) return;
      applySession(restored);
      setStatus(restored ? 'signed_in' : 'signed_out');
    } catch (error) {
      if (attempt !== generation.current) return;
      if (worthRidingOut(error, sessionRef.current !== null)) {
        setNotice(error.message);
        return;
      }
      applySession(null);
      setStatus('signed_out');
      if (error instanceof AccessRevokedError) {
        setNotice(statusMessageFor(error.status));
      } else if (error instanceof ProfileResolutionError) {
        // The provider session is real and still held. Saying "your session expired" here would
        // send the reader to retype a password that already worked.
        setNotice(error.message);
      } else if (error instanceof AuthNotConfiguredError) {
        setStatus('unavailable');
        setConfigurationError(error.message);
      } else {
        setNotice('The sign-in session expired. Please sign in again.');
      }
    }
    if (attempt !== generation.current) return;
    setNeedsBootstrap(await adapter.requiresPrimaryAdminBootstrap());
  }, [adapter, applySession]);

  useEffect(() => {
    if (!adapter) return;
    void probe();
    return adapter.subscribe((next, problem) => {
      // Defence in depth: an adapter that reports a sanctioned account is not allowed to leave it
      // signed in, even though every adapter already refuses to emit one.
      const granted = next && canAccessErp(next.identity.status) ? next : null;
      if (granted) {
        applySession(granted);
        setNotice(null);
        setStatus('signed_in');
        return;
      }
      if (worthRidingOut(problem, sessionRef.current !== null)) {
        // A refresh that could not read the profile leaves the last good identity in place and says
        // so. This is the path that used to look like the session had expired.
        setNotice(problem.message);
        return;
      }
      applySession(null);
      setStatus('signed_out');
      // A profile read that failed is reported as what it was, not as a logout the user caused.
      if (problem instanceof ProfileResolutionError) setNotice(problem.message);
    });
  }, [adapter, probe, applySession]);

  const signIn = useCallback<AuthActions['signIn']>(
    async (identifier, password) => {
      if (!adapter) return { ok: false, message: configurationError ?? 'Authentication is unavailable.' };
      try {
        const next = await adapter.signIn(identifier, password);
        applySession(next);
        setStatus('signed_in');
        setNeedsBootstrap(false);
        return { ok: true, message: '' };
      } catch (error) {
        await probe();
        if (error instanceof AccessRevokedError) {
          return { ok: false, message: statusMessageFor(error.status) };
        }
        return { ok: false, message: error instanceof Error ? error.message : 'Sign-in failed.' };
      }
    },
    [adapter, applySession, configurationError, probe]
  );

  const signOut = useCallback(async () => {
    if (!adapter) return;
    await adapter.signOut();
    applySession(null);
    setStatus('signed_out');
  }, [adapter, applySession]);

  const register = useCallback<AuthActions['register']>(
    async (draft) => {
      if (!adapter) {
        return { ok: false, failure: { code: 'unavailable', message: configurationError ?? 'Registration is unavailable.' } };
      }
      return adapter.register(draft);
    },
    [adapter, configurationError]
  );

  const bootstrapPrimaryAdmin = useCallback<AuthActions['bootstrapPrimaryAdmin']>(
    async (input) => {
      if (!adapter) return { ok: false, message: 'Authentication is unavailable.' };
      const result = await adapter.bootstrapPrimaryAdmin(input);
      if (result.ok) {
        await probe();
        return { ok: true, message: 'Primary administrator provisioned. Sign in to continue.' };
      }
      return { ok: false, message: result.error.message };
    },
    [adapter, probe]
  );

  const value = useMemo<AuthState & AuthActions>(
    () => ({
      status,
      session,
      identity: session?.identity ?? null,
      adapter,
      configurationError,
      needsPrimaryAdminBootstrap: needsBootstrap,
      notice,
      signIn,
      signOut,
      register,
      refresh: probe,
      bootstrapPrimaryAdmin,
      clearNotice: () => setNotice(null),
    }),
    [status, session, adapter, configurationError, needsBootstrap, notice, signIn, signOut, register, probe, bootstrapPrimaryAdmin]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Whether a failed profile read may be ridden out.
 *
 * The provider still holds a session that a valid credential opened, so a database that is
 * unreachable, refusing a read, or not migrated yet is a reason to warn — not a reason to throw
 * away a workspace somebody is already standing in. Two conditions make the difference: the read
 * has to be one a retry could fix, and there has to be a good identity to keep. A missing profile
 * after recovery was tried has neither, and correctly closes the session.
 */
function worthRidingOut(problem: unknown, hasSession: boolean): problem is ProfileResolutionError {
  return problem instanceof ProfileResolutionError && problem.retryable && hasSession;
}

/**
 * Only the two sanctions close a session, and their wording comes from the same place the guard
 * reads it. There is no "waiting for approval" answer any more: an account that proved its
 * credential is signed in, and a placement nobody has recorded yet says so in the workspace.
 */
function statusMessageFor(status: string): string {
  return status === 'rejected' || status === 'suspended'
    ? describeLoginOutcome(status).message
    : 'Your session could not be opened. Sign in again.';
}

export function useAuth(): AuthState & AuthActions {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}

/** Authorization always comes from the server-issued identity, never from local preferences. */
export function useCan(capability: Capability): boolean {
  const { identity } = useAuth();
  return identity ? hasCapability(identity.role, capability) : false;
}

export function useRole(): Role | null {
  const { identity } = useAuth();
  return identity?.role ?? null;
}
