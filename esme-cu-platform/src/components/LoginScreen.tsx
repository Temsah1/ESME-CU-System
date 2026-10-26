import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Loader2, ArrowLeft, ShieldCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { ThemeToggle } from './ThemeToggle';
import { passwordChecks, validatePassword, normalizeEmail } from '../domain/registration';

type Props = {
  onBackToHome: () => void;
  onNavigateToJoin: () => void;
  onLoginSuccess: () => void;
};

type Panel = 'signin' | 'forgot' | 'bootstrap';

const fieldClass =
  'w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-[#F59A16] focus:outline-none';

const labelClass = 'block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5';

export const LoginScreen: React.FC<Props> = ({ onBackToHome, onNavigateToJoin, onLoginSuccess }) => {
  const {
    signIn,
    adapter,
    status,
    needsPrimaryAdminBootstrap,
    configurationError,
    bootstrapPrimaryAdmin,
    refresh,
    notice,
    clearNotice,
  } = useAuth();

  const [panel, setPanel] = useState<Panel>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [boot, setBoot] = useState({ fullName: '', email: '', username: '', password: '', confirmPassword: '' });

  useEffect(() => {
    if (needsPrimaryAdminBootstrap && panel === 'signin') setPanel('bootstrap');
  }, [needsPrimaryAdminBootstrap, panel]);

  useEffect(() => {
    setError(null);
    setInfo(null);
  }, [panel]);

  const checks = useMemo(() => passwordChecks(panel === 'bootstrap' ? boot.password : password), [panel, boot.password, password]);

  const submitSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    clearNotice();
    const result = await signIn(identifier, password);
    setBusy(false);
    if (result.ok) {
      onLoginSuccess();
      return;
    }
    setError(result.message);
    setPassword('');
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!adapter) return;
    setBusy(true);
    try {
      await adapter.requestPasswordReset(normalizeEmail(identifier));
      setInfo('If that address belongs to a chapter account, a reset link is on its way.');
    } catch {
      setInfo('If that address belongs to a chapter account, a reset link is on its way.');
    } finally {
      setBusy(false);
    }
  };

  const submitBootstrap = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const failures = validatePassword(boot.password);
    if (failures.length > 0) {
      setError(`Password needs: ${failures.join(', ').toLowerCase()}.`);
      setBusy(false);
      return;
    }
    const result = await bootstrapPrimaryAdmin(boot);
    setBusy(false);
    if (result.ok) {
      setPanel('signin');
      setIdentifier(boot.email);
      setPassword('');
      setInfo(result.message);
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={onBackToHome}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-[#123B60] dark:hover:text-[#F59A16]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden /> Back to the website
        </button>
        <ThemeToggle />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/60 dark:shadow-black/40 p-7">
            <div className="flex items-center gap-3 mb-1">
              <img src="/branding/esme_logo.png" alt="ESME" className="h-11 w-11 object-contain" />
              <div className="min-w-0">
                <h1 className="text-lg font-black text-[#123B60] dark:text-white leading-tight truncate">
                  ESME CU Chapter
                </h1>
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {panel === 'bootstrap' ? 'First administrator setup' : 'Member & board workspace'}
                </p>
              </div>
            </div>

            {configurationError && (
              <p className="mt-4 rounded-xl bg-slate-100 dark:bg-slate-800 px-3.5 py-3 text-xs text-slate-700 dark:text-slate-200">
                {configurationError}
              </p>
            )}

            {notice && (
              <p role="status" className="mt-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 px-3.5 py-3 text-xs text-amber-900 dark:text-amber-200">
                {notice}
              </p>
            )}

            {info && (
              <p role="status" className="mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 px-3.5 py-3 text-xs text-emerald-800 dark:text-emerald-200">
                {info}
              </p>
            )}

            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 px-3.5 py-3 text-xs text-rose-800 dark:text-rose-200">
                {error}
              </p>
            )}

            {panel === 'signin' && (
              <form onSubmit={submitSignIn} className="mt-5 space-y-4" noValidate>
                <div>
                  <label htmlFor="identifier" className={labelClass}>Email or username</label>
                  <input
                    id="identifier"
                    name="identifier"
                    autoComplete="username"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={fieldClass}
                    placeholder="you@esme.edu.eg"
                  />
                </div>

                <div>
                  <label htmlFor="password" className={labelClass}>Password</label>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${fieldClass} pr-11`}
                      placeholder="Your password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy || status === 'unavailable'}
                  className="w-full rounded-xl bg-[#F59A16] hover:bg-[#e0890f] text-[#123B60] font-bold py-2.5 text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                  {busy ? 'Checking credentials…' : 'Sign in'}
                </button>

                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    onClick={() => setPanel('forgot')}
                    className="font-semibold text-slate-600 dark:text-slate-300 hover:text-[#123B60] dark:hover:text-[#F59A16] inline-flex items-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" aria-hidden /> Forgot password
                  </button>
                  <button
                    type="button"
                    onClick={onNavigateToJoin}
                    className="font-semibold text-[#123B60] dark:text-[#F59A16] hover:underline"
                  >
                    Apply to join
                  </button>
                </div>
              </form>
            )}

            {panel === 'forgot' && (
              <form onSubmit={submitReset} className="mt-5 space-y-4">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Enter the address on your chapter account. A reset link goes to it if an account exists —
                  the response is the same either way.
                </p>
                <div>
                  <label htmlFor="reset-email" className={labelClass}>Account email</label>
                  <input
                    id="reset-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-[#123B60] text-white font-bold py-2.5 text-sm disabled:opacity-60"
                >
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
                <button type="button" onClick={() => setPanel('signin')} className="w-full text-xs font-semibold text-slate-500 hover:text-[#123B60] dark:hover:text-[#F59A16]">
                  Back to sign in
                </button>
              </form>
            )}

            {panel === 'bootstrap' && adapter?.kind === 'supabase' && (
              <div className="mt-5 space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  No administrator exists in this project yet. The first Super Admin is provisioned inside the
                  database, because until it exists every browser caller would be anonymous. This screen does not
                  submit the password; run these two statements in the Supabase SQL editor:
                </p>
                <pre className="overflow-x-auto rounded-xl bg-slate-100 dark:bg-slate-800 p-3 text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
{`select esme_arm_bootstrap(interval '15 minutes');

select esme_bootstrap_primary_admin(
  'Full name', 'email@address', 'username', 'password'
);`}
                </pre>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  The window closes after one success or when it expires. Return here and sign in once it has run.
                </p>
                <button type="button" onClick={() => void refresh()} className="w-full text-xs font-semibold text-[#123B60] dark:text-[#F59A16]">
                  Check again
                </button>
              </div>
            )}

            {panel === 'bootstrap' && adapter?.kind !== 'supabase' && (
              <form onSubmit={submitBootstrap} className="mt-5 space-y-4">
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  No administrator exists yet. Choose the password for the chapter's primary account now.
                  It is never stored in this repository and cannot be recovered here — keep it in your password manager.
                </p>
                <div>
                  <label htmlFor="boot-name" className={labelClass}>Full name</label>
                  <input id="boot-name" required value={boot.fullName} onChange={(e) => setBoot({ ...boot, fullName: e.target.value })} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="boot-email" className={labelClass}>Email</label>
                  <input id="boot-email" type="email" required value={boot.email} onChange={(e) => setBoot({ ...boot, email: e.target.value })} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="boot-username" className={labelClass}>Username</label>
                  <input id="boot-username" required value={boot.username} onChange={(e) => setBoot({ ...boot, username: e.target.value })} className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="boot-password" className={labelClass}>Password</label>
                  <input id="boot-password" type="password" required value={boot.password} onChange={(e) => setBoot({ ...boot, password: e.target.value })} className={fieldClass} autoComplete="new-password" />
                </div>
                <div>
                  <label htmlFor="boot-confirm" className={labelClass}>Confirm password</label>
                  <input id="boot-confirm" type="password" required value={boot.confirmPassword} onChange={(e) => setBoot({ ...boot, confirmPassword: e.target.value })} className={fieldClass} autoComplete="new-password" />
                </div>
                <PasswordChecklist checks={checks} />
                <button
                  type="submit"
                  disabled={busy || boot.password !== boot.confirmPassword}
                  className="w-full rounded-xl bg-[#123B60] text-white font-bold py-2.5 text-sm disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                  {busy ? 'Provisioning…' : 'Create primary administrator'}
                </button>
              </form>
            )}
          </div>

          <p className="mt-4 text-center text-[11px] text-slate-500 dark:text-slate-400 inline-flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden />
            Signing in is the only step: no account inside the chapter has to approve you. Entry follows
            the status the provider holds — only a suspension or a rejection keeps you out — and what you
            may do follows your role. Neither is decided by this browser.
          </p>
        </motion.div>
      </main>
    </div>
  );
};

export const PasswordChecklist: React.FC<{ checks: { id: string; label: string; passed: boolean }[] }> = ({ checks }) => (
  <ul className="grid grid-cols-2 gap-1.5 text-[11px]">
    {checks.map((c) => (
      <li
        key={c.id}
        className={c.passed ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}
      >
        <span aria-hidden>{c.passed ? '✓' : '○'}</span> {c.label}
      </li>
    ))}
  </ul>
);

export default LoginScreen;
