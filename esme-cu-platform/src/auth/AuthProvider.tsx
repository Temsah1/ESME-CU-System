import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { canAccessErp } from '../domain/accountState';
import { hasCapability, type Capability, type Role } from '../domain/roles';
import { resolveAdapter } from './index';
import { AccessRevokedError, AuthNotConfiguredError } from './errors';
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

  const probe = useCallback(async () => {
    if (!adapter) return;
    const attempt = ++generation.current;
    try {
      const restored = await adapter.restore();
      if (attempt !== generation.current) return;
      setSession(restored);
      setStatus(restored ? 'signed_in' : 'signed_out');
    } catch (error) {
      if (attempt !== generation.current) return;
      setSession(null);
      setStatus('signed_out');
      if (error instanceof AccessRevokedError) {
        setNotice('Your access was revoked by an administrator. Please sign in again.');
      } else if (error instanceof AuthNotConfiguredError) {
        setStatus('unavailable');
        setConfigurationError(error.message);
      } else {
        setNotice('The sign-in session expired. Please sign in again.');
      }
    }
    if (attempt !== generation.current) return;
    setNeedsBootstrap(await adapter.requiresPrimaryAdminBootstrap());
  }, [adapter]);

  useEffect(() => {
    if (!adapter) return;
    void probe();
    return adapter.subscribe((next) => {
      setSession(next);
      setStatus(next && canAccessErp(next.identity.status) ? 'signed_in' : 'signed_out');
    });
  }, [adapter, probe]);

  const signIn = useCallback<AuthActions['signIn']>(
    async (identifier, password) => {
      if (!adapter) return { ok: false, message: configurationError ?? 'Authentication is unavailable.' };
      try {
        const next = await adapter.signIn(identifier, password);
        setSession(next);
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
    [adapter, configurationError, probe]
  );

  const signOut = useCallback(async () => {
    if (!adapter) return;
    await adapter.signOut();
    setSession(null);
    setStatus('signed_out');
  }, [adapter]);

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

function statusMessageFor(status: string): string {
  switch (status) {
    case 'pending_approval':
      return 'Your request is waiting for administrator approval. You will be notified once a decision is made.';
    case 'rejected':
      return 'This registration request was not approved.';
    case 'suspended':
      return 'This account is suspended. Access to the platform has been revoked.';
    default:
      return 'Access denied.';
  }
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
