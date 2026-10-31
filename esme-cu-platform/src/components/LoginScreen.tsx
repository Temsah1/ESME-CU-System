import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useApp } from '../context/AppContext';
import { ThemeToggle } from './ThemeToggle';
import { passwordChecks, validatePassword, normalizeEmail } from '../domain/registration';
import '../lib/motion/cutora.css';

type Props = {
  onBackToHome: () => void;
  onNavigateToJoin: () => void;
  onLoginSuccess: () => void;
};

type Panel = 'signin' | 'forgot' | 'bootstrap';

/**
 * The three slides the hero side carries. Nothing here auto-plays: a visitor who asks for calm, and a
 * visitor who is busy typing a password, both get a still page until they click a dot.
 */
const SLIDES = [
  {
    kicker: 'Recruitment season',
    headline: ['Where the chapter', 'keeps its momentum.'],
    sub: 'One workspace for the whole season — applications, committees, tasks and the record of who did what, written once into the chapter database instead of emailed around as a spreadsheet.',
    caption: '01 · Recruitment season, start to finish',
  },
  {
    kicker: 'Committees',
    headline: ['Every board,', 'one source of truth.'],
    sub: 'Heads, directors and rosters are read from the same record by everyone, so a handover is a change of status rather than a search through last year’s files.',
    caption: '02 · Committees and people',
  },
  {
    kicker: 'Access',
    headline: ['Sign in,', 'pick up the thread.'],
    sub: 'What you may open follows the role the provider holds for you. This screen decides none of it, and no account inside the chapter has to approve yours first.',
    caption: '03 · Roles and permissions',
  },
];

const HEADING: Record<Panel, string> = {
  signin: 'Sign in',
  forgot: 'Reset your password',
  bootstrap: 'Create the first administrator',
};

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** What "remember me" is allowed to keep: the identifier that opens the next visit, never the password. */
const REMEMBER_KEY = 'ESME_CU_REMEMBER_ID_V1';

const readRemembered = () => {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
};

const writeRemembered = (keep: boolean, identifier: string) => {
  try {
    if (keep) window.localStorage.setItem(REMEMBER_KEY, identifier);
    else window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // A browser that refuses storage just never remembers. The sign-in itself is unaffected.
  }
};

/**
 * CUTORA (§6): one CSS entrance for the whole sheet — the stylesheet in `lib/motion/cutora.css` holds
 * the seventeen staged delays, the clip-wipe headline, the amber slider pill, the eye's drawn slash and
 * the ≤6px rejection shake. `entered` exists so that a panel switch after the opening does not replay
 * the page-load timing: those contents arrive on their own 0.45s rise instead.
 */
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
  const { resolvedTheme } = useApp();

  const [panel, setPanel] = useState<Panel>('signin');
  const [slide, setSlide] = useState(0);
  const [identifier, setIdentifier] = useState(readRemembered);
  const [remember, setRemember] = useState(() => readRemembered() !== '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [rejects, setRejects] = useState(0);
  const [shaking, setShaking] = useState(false);
  const [entered, setEntered] = useState(false);

  const [boot, setBoot] = useState({ fullName: '', email: '', username: '', password: '', confirmPassword: '' });

  useEffect(() => {
    if (needsPrimaryAdminBootstrap && panel === 'signin') setPanel('bootstrap');
  }, [needsPrimaryAdminBootstrap, panel]);

  useEffect(() => {
    setError(null);
    setInfo(null);
  }, [panel]);

  // The entrance ends when the last staged element ends — the footer rises last — and from there a
  // panel switch rises on its own instead of replaying the page-load timing.
  const dropStages = () => setEntered(true);

  // The attribute has to leave and come back for the shake to play a second time.
  useEffect(() => {
    if (rejects === 0) return;
    setShaking(true);
    const timer = setTimeout(() => setShaking(false), 320);
    return () => clearTimeout(timer);
  }, [rejects]);

  const seq = (step: number) => (entered ? null : `seq-${step}`);
  const checks = passwordChecks(panel === 'bootstrap' ? boot.password : password);

  const submitSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    clearNotice();
    const result = await signIn(identifier, password);
    setBusy(false);
    if (result.ok) {
      writeRemembered(remember, identifier);
      onLoginSuccess();
      return;
    }
    setError(result.message);
    setRejects((n) => n + 1);
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

  // One reserved box, one message at a time: an error arriving must not move the fields below it.
  const message: { kind: 'error' | 'notice' | 'info'; text: string } | null = error
    ? { kind: 'error', text: error }
    : notice
      ? { kind: 'notice', text: notice }
      : info
        ? { kind: 'info', text: info }
        : configurationError
          ? { kind: 'notice', text: configurationError }
          : null;

  const current = SLIDES[slide];

  return (
    <div
      className="cutora"
      data-tone={resolvedTheme === 'dark' ? 'dark' : 'light'}
      data-rejected={shaking ? '1' : undefined}
    >
      <header className={cx('cut-top', seq(1))}>
        <span className="cut-mark">
          <img src="/branding/esme_logo.png" alt="ESME" />
          ESME CU Chapter
        </span>
        <span className="cut-toplinks">
          <button type="button" className="cut-back" onClick={onBackToHome}>
            <ArrowLeft className="w-4 h-4" aria-hidden /> Back to the website
          </button>
          <ThemeToggle />
        </span>
      </header>

      <main className="cut-stage">
        <section className="cut-hero" aria-label="What the chapter workspace holds">
          <span className="cut-drift" aria-hidden />
          <p key={`kicker-${slide}`} className="cut-kicker">
            {current.kicker}
          </p>
          {current.headline.map((line, index) => (
            <h2 key={`${slide}-${index}`} className={cx('cut-line', seq(index === 0 ? 3 : 4))}>
              <span>{line}</span>
            </h2>
          ))}
          <p key={`sub-${slide}`} className={cx('cut-sub', seq(5))}>
            {current.sub}
          </p>
          <div className={cx('cut-dots', seq(6))} role="group" aria-label="Chapter highlights">
            {SLIDES.map((item, index) => (
              <button
                key={item.caption}
                type="button"
                aria-pressed={index === slide}
                aria-label={item.caption}
                onClick={() => setSlide(index)}
              />
            ))}
          </div>
          <p className={cx('cut-caption', seq(7))}>{current.caption}</p>
        </section>

        <div className={cx('cut-card', seq(2))}>
          <h1 className={cx('cut-h', seq(8))}>{HEADING[panel]}</h1>
          <p className={cx('cut-card-sub', seq(9))}>
            {panel === 'bootstrap' ? 'First administrator setup' : 'Member & board workspace'}
          </p>

          <div className="cut-msg">
            {message && (
              <p
                key={message.text}
                data-kind={message.kind}
                role={message.kind === 'error' ? 'alert' : 'status'}
              >
                {message.text}
              </p>
            )}
          </div>

          {panel === 'signin' && (
            <form className="cut-panel" onSubmit={submitSignIn} noValidate>
              <div className={cx('cut-field', seq(10))}>
                <label htmlFor="identifier">Email or username</label>
                <input
                  id="identifier"
                  name="identifier"
                  autoComplete="username"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@esme.edu.eg"
                />
              </div>

              <div className={cx('cut-field', seq(11))}>
                <label htmlFor="password">Password</label>
                <div className="cut-field--pad">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                  />
                  <button
                    type="button"
                    className="cut-eye"
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
                      <path d="M2.6 12s3.6-6.2 9.4-6.2 9.4 6.2 9.4 6.2-3.6 6.2-9.4 6.2S2.6 12 2.6 12Z" />
                      <circle cx="12" cy="12" r="2.9" />
                      <path className="slash" d="M4.4 19.6 19.6 4.4" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className={cx('cut-opt', seq(12))}>
                <label className="cut-check">
                  <input
                    type="checkbox"
                    name="remember"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <svg viewBox="0 0 20 20" aria-hidden>
                    <rect className="box" x="1" y="1" width="18" height="18" rx="5" />
                    <path className="tick" d="M5.4 10.3 8.6 13.5 14.6 6.9" />
                  </svg>
                  <span>Remember me</span>
                </label>
                <button type="button" onClick={() => setPanel('forgot')}>
                  Forgot password
                </button>
              </div>

              <button
                type="submit"
                className={cx('cut-submit', seq(13))}
                disabled={busy || status === 'unavailable'}
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {busy ? 'Checking credentials…' : 'Sign in'}
              </button>
            </form>
          )}

          {panel === 'forgot' && (
            <form className="cut-panel" onSubmit={submitReset}>
              <p className="cut-text">
                Enter the address on your chapter account. A reset link goes to it if an account exists —
                the response is the same either way.
              </p>
              <div className="cut-field">
                <label htmlFor="reset-email">Account email</label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>
              <button type="submit" className="cut-submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              <button type="button" className="cut-link" onClick={() => setPanel('signin')}>
                Back to sign in
              </button>
            </form>
          )}

          {panel === 'bootstrap' && adapter?.kind === 'supabase' && (
            <div className="cut-panel">
              <p className="cut-text">
                No administrator exists in this project yet. The first Super Admin is provisioned inside the
                database, because until it exists every browser caller would be anonymous. This screen does not
                submit the password; run these two statements in the Supabase SQL editor:
              </p>
              <pre className="cut-pre">{`select esme_arm_bootstrap(interval '15 minutes');

select esme_bootstrap_primary_admin(
  'Full name', 'email@address', 'username', 'password'
);`}</pre>
              <p className="cut-text">
                The window closes after one success or when it expires. Return here and sign in once it has run.
              </p>
              <button type="button" className="cut-secondary" onClick={() => void refresh()}>
                Check again
              </button>
            </div>
          )}

          {panel === 'bootstrap' && adapter?.kind !== 'supabase' && (
            <form className="cut-panel" onSubmit={submitBootstrap}>
              <p className="cut-text">
                No administrator exists yet. Choose the password for the chapter's primary account now. It is
                never stored in this repository and cannot be recovered here — keep it in your password manager.
              </p>
              <div className="cut-field">
                <label htmlFor="boot-name">Full name</label>
                <input
                  id="boot-name"
                  required
                  value={boot.fullName}
                  onChange={(e) => setBoot({ ...boot, fullName: e.target.value })}
                />
              </div>
              <div className="cut-field">
                <label htmlFor="boot-email">Email</label>
                <input
                  id="boot-email"
                  type="email"
                  required
                  value={boot.email}
                  onChange={(e) => setBoot({ ...boot, email: e.target.value })}
                />
              </div>
              <div className="cut-field">
                <label htmlFor="boot-username">Username</label>
                <input
                  id="boot-username"
                  required
                  value={boot.username}
                  onChange={(e) => setBoot({ ...boot, username: e.target.value })}
                />
              </div>
              <div className="cut-field">
                <label htmlFor="boot-password">Password</label>
                <input
                  id="boot-password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={boot.password}
                  onChange={(e) => setBoot({ ...boot, password: e.target.value })}
                />
              </div>
              <div className="cut-field">
                <label htmlFor="boot-confirm">Confirm password</label>
                <input
                  id="boot-confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={boot.confirmPassword}
                  onChange={(e) => setBoot({ ...boot, confirmPassword: e.target.value })}
                />
              </div>
              <PasswordChecklist checks={checks} />
              <button
                type="submit"
                className="cut-submit"
                disabled={busy || boot.password !== boot.confirmPassword}
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {busy ? 'Provisioning…' : 'Create primary administrator'}
              </button>
            </form>
          )}

          {panel === 'signin' && (
            <>
              <div className={cx('cut-divider', seq(14))}>New to the chapter?</div>
              <button
                type="button"
                className={cx('cut-secondary', seq(15))}
                onClick={onNavigateToJoin}
              >
                Apply to join
              </button>
            </>
          )}

          <p className={cx('cut-foot', seq(16))}>
            <ShieldCheck aria-hidden />
            <span>
              Signing in is the only step: no account inside the chapter has to approve you. Entry follows the
              status the provider holds — only a suspension or a rejection keeps you out — and what you may do
              follows your role. Neither is decided by this browser.
            </span>
          </p>
        </div>
      </main>

      <footer className={cx('cut-pagefoot', seq(17))} onAnimationEnd={dropStages}>
        ESME · Cairo University chapter · Recruitment OS
      </footer>
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
