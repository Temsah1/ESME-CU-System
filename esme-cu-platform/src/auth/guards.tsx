import React from 'react';
import { useAuth } from './AuthProvider';
import { describeLoginOutcome } from '../domain/accountState';
import { hasCapability } from '../domain/roles';
import type { Capability } from '../domain/roles';

/**
 * These guards decide what a browser is *shown*. The authority that decides what a
 * request may *do* is the provider: the same capability matrix runs again in
 * supabase/migrations/0002_functions_rls.sql. Removing a button is never the control.
 */

export const AccessDenied: React.FC<{ title?: string; detail: string; onExit?: () => void }> = ({
  title = 'Access restricted',
  detail,
  onExit,
}) => (
  <div className="min-h-[60vh] flex items-center justify-center px-6">
    <div className="max-w-md w-full rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center">
      <h2 className="text-lg font-bold text-[#123B60] dark:text-white">{title}</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{detail}</p>
      {onExit && (
        <button
          type="button"
          onClick={onExit}
          className="mt-6 rounded-xl bg-[#F59A16] px-4 py-2 text-sm font-semibold text-[#123B60]"
        >
          Return to the website
        </button>
      )}
    </div>
  </div>
);

export const RequireAuth: React.FC<{ children: React.ReactNode; onExit?: () => void }> = ({ children, onExit }) => {
  const { status, identity, session } = useAuth();

  if (status === 'checking') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-slate-500">Restoring your session…</p>
      </div>
    );
  }
  if (status === 'unavailable') {
    return <AccessDenied title="Authentication is not configured" detail="This deployment has no authentication provider configured." />;
  }
  if (!session || !identity) {
    return (
      <AccessDenied
        title="Sign-in required"
        detail="Sign in to open the chapter workspace. Creating an account is enough — nobody inside the chapter has to approve it."
        onExit={onExit}
      />
    );
  }
  // Only a sanction closes the door. A member whose committee placement is still unrecorded
  // belongs here; what they may reach is the role's capability scope, not this status.
  const outcome = describeLoginOutcome(identity.status);
  if (outcome.kind === 'blocked') {
    return <AccessDenied title="Access restricted" detail={outcome.message} onExit={onExit} />;
  }
  return <>{children}</>;
};

export const RequireCapability: React.FC<{
  capability: Capability;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ capability, children, fallback }) => {
  const { identity } = useAuth();
  if (!identity || !hasCapability(identity.role, capability)) {
    return <>{fallback ?? <AccessDenied detail={`Your role (${identity?.role ?? 'unknown'}) is not authorized for this area.`} />}</>;
  }
  return <>{children}</>;
};
