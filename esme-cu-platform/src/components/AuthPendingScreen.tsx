import React from 'react';
import { ShieldAlert, LifeBuoy } from 'lucide-react';

type Props = {
  reason: string;
  onBackToHome?: () => void;
};

/**
 * Shown when no authentication provider is configured. It is a blocker, not a
 * substitute: there is no demo login behind it and nothing to click through.
 */
export const AuthPendingScreen: React.FC<Props> = ({ reason, onBackToHome }) => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center px-4 py-12">
    <div className="w-full max-w-xl rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-xl shadow-slate-200/60 dark:shadow-black/40">
      <div className="flex items-start gap-3">
        <span className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-2.5 text-amber-700 dark:text-amber-300 shrink-0">
          <ShieldAlert className="w-5 h-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-lg font-black text-[#123B60] dark:text-white">Sign-in is unavailable</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{reason}</p>

          <div className="mt-5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 inline-flex items-center gap-1.5">
              <LifeBuoy className="w-3.5 h-3.5" aria-hidden /> What an operator does next
            </p>
            <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              <li>
                Create a Supabase project and copy its project URL and anon key into{" "}
                <code className="font-mono">.env</code> (see <code className="font-mono">.env.example</code>).
              </li>
              <li>
                Apply the migrations in <code className="font-mono">supabase/migrations</code> in order — they define
                the roles, account states, approval workflow and row-level security policies.
              </li>
              <li>
                Arm the one-time administrator window from the database console with{" "}
                <code className="font-mono">select esme_arm_bootstrap();</code>, then create the primary administrator
                from this screen within 15 minutes.
              </li>
              <li>Restart the app. The public site and dashboards come back on their own.</li>
            </ol>
          </div>

          <p className="mt-5 text-[11px] text-slate-500 dark:text-slate-400">
            The workspace is deliberately closed rather than opened with a demo account: a login that accepted a
            hard-coded credential would look identical to the real thing and grant access nothing else could take away.
          </p>

          {onBackToHome && (
            <button
              type="button"
              onClick={onBackToHome}
              className="mt-5 text-xs font-semibold text-[#123B60] dark:text-[#F59A16] hover:underline"
            >
              Back to the public website
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);

export default AuthPendingScreen;
