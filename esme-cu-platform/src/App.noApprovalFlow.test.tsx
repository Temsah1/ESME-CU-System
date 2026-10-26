// @vitest-environment jsdom
/**
 * The whole front door, clicked through: a stranger registers and ends up inside the chapter.
 *
 * This is the acceptance criterion for "no internal account approval", run against the real
 * `App` — `AuthProvider`, `AppProvider`, the public site, the signup form, the sign-in screen and
 * the workspace behind `RequireAuth` — with the documented local development adapter standing in
 * for the provider (Vitest runs with no `VITE_SUPABASE_*`, and the adapter is the same lifecycle
 * rules the Supabase one enforces). Screen wiring is what is being proved here; row level security
 * is not reachable from this file and stays with probes P47-P52.
 *
 * Reduced motion is switched on deliberately: this journey was once unclickable for exactly these
 * users (see App.reducedMotion.test.tsx), so the route through it is asserted rather than assumed.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACADEMIC_YEAR_OPTIONS, DEPARTMENT_OPTIONS } from './data/referenceContent';
import { STORAGE_KEYS, TARGET_VERSION } from './storage/migrations';

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];

const PASSWORD = 'Str0ng#Kx91';
const MEMBER = { name: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.admin@esme-cu.edu', username: 'kareem.admin', password: 'Adm1n#Kx91' };

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly cb: (entries: { isIntersecting: boolean; intersectionRatio: number; target: Element }[]) => void;
      constructor(cb: (entries: { isIntersecting: boolean; intersectionRatio: number; target: Element }[]) => void) {
        this.cb = cb;
      }
      observe(target: Element) {
        this.cb([{ isIntersecting: true, intersectionRatio: 1, target }]);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver
  );
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(STORAGE_KEYS.version, TARGET_VERSION);
  vi.stubEnv('DEV', true);
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion: reduce/.test(query) || query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  window.scrollTo = () => {};
});

afterEach(() => TL.cleanup());

async function renderApp() {
  const { App } = await import('./App');
  TL.render(<App />);
  const user = await userEvent.setup();
  await TL.waitFor(() => expect(TL.screen.getByRole('heading', { level: 1 })).toBeTruthy());
  return { user };
}

const label = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const field = (text: string) => TL.screen.getByLabelText(label(text));

/**
 * The member's own home page. The workspace first shows `AppProvider`'s loading skeleton, so the
 * wait is longer than Testing Library's default second — the data has to arrive before the guard's
 * destination can be read.
 */
const memberHome = () =>
  TL.screen.findByRole('heading', { level: 1, name: /Aya Student/ }, { timeout: 10000 });

/**
 * Puts a Super Admin in the vault before the journey starts, because that is how a live chapter is
 * found: the primary account is provisioned first, members arrive afterwards. Without one,
 * `LoginScreen` swaps the sign-in form for "First administrator setup"
 * (src/components/LoginScreen.tsx:44-46) and no member can reach the credentials fields — a
 * property of a genuinely empty deployment, not an approval gate, so the fixture supplies it rather
 * than the test working around it. The first test deliberately omits this and proves the very
 * first registrant still lands as a plain `member`.
 */
async function seedPrimaryAdmin() {
  const { createLocalDevAdapter } = await import('./auth/localDevAdapter');
  const result = await createLocalDevAdapter().bootstrapPrimaryAdmin({ ...ADMIN, confirmPassword: ADMIN.password });
  if (!result.ok) throw new Error(`bootstrap refused: ${result.error.code} — ${result.error.message}`);
}

/** Fills the public form as an applicant who is not choosing a committee, then submits it. */
async function registerAMember(user: Awaited<ReturnType<typeof userEvent.setup>>) {
  await user.click(TL.screen.getByRole('button', { name: /Join ESME/ }));
  await TL.screen.findByText('Join ESME CU Student Chapter');

  await user.type(field('Full Name'), MEMBER.name);
  await user.type(field('University Email'), MEMBER.email);
  await user.type(field('Username'), MEMBER.username);
  await user.type(field('Password'), PASSWORD);
  await user.type(field('Confirm password'), PASSWORD);
  await user.selectOptions(field('Academic Year'), ACADEMIC_YEAR_OPTIONS[1]);
  await user.selectOptions(field('Department'), DEPARTMENT_OPTIONS[0]);
  // The membership question's "no" answer: nobody is being placed before they sign in.
  await user.click(TL.screen.getByRole('radio', { name: /^No/ }));
  await user.click(field('Agreement to Chapter Policies & Code of Conduct'));
  await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));
}

describe('a stranger registers and reaches the workspace', () => {
  it('finishes signup with an account that works, and no sentence about approval', async () => {
    const { user } = await renderApp();
    await registerAMember(user);

    expect(await TL.screen.findByText('Account created')).toBeTruthy();
    expect(TL.screen.getByText(/Sign into Member Portal/i)).toBeTruthy();
    expect(TL.screen.queryByText(/pending approval/i)).toBeNull();
    expect(TL.screen.queryByText(/ask an administrator/i)).toBeNull();
    expect(TL.screen.queryByText(/wait(ing)? for (an )?approv/i)).toBeNull();

    const stored = JSON.parse(localStorage.getItem('ESME_CU_DEV_AUTH_V1') ?? '{"accounts":[]}') as {
      accounts: { email: string; role: string; status: string }[];
    };
    const created = stored.accounts.find((a) => a.email === MEMBER.email);
    expect(created?.role).toBe('member');
    expect(created?.status).toBe('active');
    // The first registrant in an empty vault gets nothing: no privileged account was created
    // behind the scenes, so nobody is waiting to be approved either.
    expect(stored.accounts).toHaveLength(1);
    expect(stored.accounts.some((a) => a.role !== 'member')).toBe(false);
  });

  it('signs that account straight in and opens the workspace behind the guard', async () => {
    await seedPrimaryAdmin();
    const { user } = await renderApp();
    await registerAMember(user);
    await TL.screen.findByText('Account created');

    await user.click(TL.screen.getByRole('button', { name: /Sign into Member Portal/i }));

    await TL.screen.findByLabelText(label('Password'));
    await user.type(TL.screen.getByLabelText(label('Email or username')), MEMBER.email);
    await user.type(TL.screen.getByLabelText(label('Password')), PASSWORD);
    await user.click(TL.screen.getByRole('button', { name: /^Sign in$/ }));

    // RequireAuth admitted the session: the member's own workspace rendered and the sign-in form is gone.
    expect(await memberHome()).toBeTruthy();
    expect(TL.screen.queryByLabelText(label('Password'))).toBeNull();
    expect(TL.screen.queryByText(/pending approval|awaiting approval|Access restricted/i)).toBeNull();
  });

  it('restores the returning member without asking a reviewer for anything', async () => {
    await seedPrimaryAdmin();
    const { user } = await renderApp();
    await registerAMember(user);
    await TL.screen.findByText('Account created');
    await user.click(TL.screen.getByRole('button', { name: /Sign into Member Portal/i }));
    await user.type(await TL.screen.findByLabelText(label('Email or username')), MEMBER.email);
    await user.type(TL.screen.getByLabelText(label('Password')), PASSWORD);
    await user.click(TL.screen.getByRole('button', { name: /^Sign in$/ }));
    await memberHome();

    // A reload: the provider session persists, and the public page's primary action enters.
    TL.cleanup();
    const { user: returning } = await renderApp();
    await TL.screen.findByRole('heading', { level: 1, name: /Welcome to ESME CU Chapter/ });
    await returning.click(TL.screen.getByRole('button', { name: /Login to Dashboard/ }));

    expect(await memberHome()).toBeTruthy();
    expect(TL.screen.queryByLabelText(label('Password'))).toBeNull();
  });
});
