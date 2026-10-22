// @vitest-environment jsdom
/**
 * The workspace frame as a surface: which screens the sidebar and the palette offer, what the
 * breadcrumb prints, whether the narrow layout actually becomes a drawer, and whether a
 * notification takes the account to the record it names. The actor is a real session from the
 * development adapter — one test signs a member in — so a nav entry disappearing here is the
 * capability model at work, not a hardcoded list in the component.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../../auth/types';
import type { DashboardView } from './DashboardShell';
import type { User } from '../../types';

const PASSWORD = 'Str0ng#ShellUI1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const MEMBER = { fullName: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };

const account = (id: string, name: string, over: Partial<User> = {}): User => ({
  id,
  name,
  email: `${id}@esme.test`,
  username: id,
  role: 'member',
  status: 'active',
  committeeId: 'comm_te',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
  ...over,
});

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: AuthAdapter;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
  V2 = (await import('../../storage/migrations')).STORAGE_KEYS.v2;
});

/** jsdom reports no media queries, so the breakpoint the shell reads has to be stated. */
const stubViewport = (desktop: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  stubViewport(true);
  Element.prototype.scrollIntoView = () => {};
  // jsdom implements neither of these; the rail scrolls its own body on every view change.
  (Element.prototype as unknown as { scrollTo: (options?: unknown) => void }).scrollTo = () => {};

  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([account('usr_nada', 'Nada Yehia')]));

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

/** Approve an applicant and make their session the one the shell renders with. */
async function signInAsMember() {
  const registered = await adapter.register({
    ...MEMBER,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptedPolicies: true,
  });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
  const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve');
  if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
  const session = await adapter.signIn(MEMBER.email, PASSWORD);
  if (session.identity.role !== 'member') throw new Error(`expected a member session, got ${session.identity.role}`);
}

async function renderShell(view: DashboardView = 'overview') {
  const [{ AppProvider }, auth, { DashboardShell }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./DashboardShell'),
    import('../../motion'),
    import('motion/react'),
  ]);

  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  const navigate = vi.fn();
  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <Gate>
              <DashboardShell
                currentView={view}
                onViewChange={navigate}
                onExitToPublicWebsite={() => {}}
                onSignOut={() => {}}
              >
                <div>workspace body</div>
              </DashboardShell>
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  await TL.screen.findByText('workspace body');
  return { user: await userEvent.setup(), navigate };
}

const openPalette = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.keyboard('{Control>}k{/Control}');
  return TL.screen.findByRole('combobox', { name: /Search pages, people and tasks/ });
};

describe('what the frame offers', () => {
  it('lists the privileged screens for the administrator', async () => {
    await renderShell();
    for (const label of ['Members Directory', 'IT Moderator Tools', 'Settings & Backups', 'Bonuses & Warnings']) {
      expect(TL.screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeTruthy();
    }
  });

  it('offers a member only the screens their capabilities reach', async () => {
    await signInAsMember();
    await renderShell();

    expect(TL.screen.getByRole('button', { name: /Bonuses & Warnings/i })).toBeTruthy();
    for (const hidden of ['Members Directory', 'IT Moderator Tools', 'Settings & Backups', 'Website CMS', 'Audit Trail']) {
      expect(TL.screen.queryByRole('button', { name: new RegExp(hidden, 'i') })).toBeNull();
    }
  });

  it('prints the screen name and its section, never the internal id', async () => {
    await renderShell('kpi_analytics');
    // The label is the one from the nav table; the breadcrumb and the rail print it from the same
    // entry, so neither can drift from what the sidebar offered.
    expect(TL.screen.getAllByText('KPI & Analytics').length).toBeGreaterThan(0);
    expect(TL.screen.getAllByText('Core Command').length).toBeGreaterThan(0);
    expect(TL.screen.queryByText('kpi analytics')).toBeNull();
    // Nothing was seeded, so the season slot says so instead of inventing one. It appears in the
    // rail and in the breadcrumb, so both copies have to answer the same way.
    expect(TL.screen.getAllByText(/No season set|seasons? recorded, none active/).length).toBeGreaterThan(0);
  });
});

describe('the command palette', () => {
  it('opens on Ctrl+K, filters, and jumps to the chosen screen', async () => {
    const { user, navigate } = await renderShell();

    const box = await openPalette(user);
    await user.type(box, 'bonus');

    const option = await TL.screen.findByRole('option', { name: /^Bonuses & Warnings/ });
    expect(option.textContent).toContain('Operations & Execution');

    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('rewards');
  });

  it('names where an action goes instead of implying it ran', async () => {
    const { user, navigate } = await renderShell();
    const box = await openPalette(user);
    await user.type(box, 'Create a task');

    const option = await TL.screen.findByRole('option', { name: /Create a task/ });
    expect(option.textContent).toContain('opens Tasks Command');
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('tasks');
  });

  it('says so when nothing matches', async () => {
    const { user } = await renderShell();
    const box = await openPalette(user);
    await user.type(box, 'quantum ledger');
    expect(await TL.screen.findByText(/Nothing matches/)).toBeTruthy();
  });
});

describe('the narrow layout', () => {
  it('trades the rail for a drawer and still reaches every screen', async () => {
    stubViewport(false);
    const { user, navigate } = await renderShell();

    expect(TL.screen.queryByRole('button', { name: /Members Directory/i })).toBeNull();
    await user.click(TL.screen.getByRole('button', { name: 'Open menu' }));

    const drawer = await TL.screen.findByRole('button', { name: /Members Directory/i });
    expect(drawer).toBeTruthy();
    await user.click(drawer);
    // The jump and the close both happen on click; the exit animation itself cannot be watched
    // here because jsdom schedules no frames, so the panel lingers in the document.
    expect(navigate).toHaveBeenCalledWith('members');
  });
});

describe('the notification centre', () => {
  it('counts what is unread and opens the record a notice points at', async () => {
    localStorage.setItem(
      `${V2}notifications`,
      JSON.stringify([
        {
          id: 'not_1',
          title: 'Bonus recorded',
          message: 'You were awarded 15 points for the NDT workshop.',
          timestamp: '2026-02-02 10:00',
          read: false,
          type: 'success',
          delivery: 'in_app',
          link: 'rewards',
        },
      ])
    );
    const { user, navigate } = await renderShell();

    await user.click(TL.screen.getByRole('button', { name: /Notifications, 1 unread/ }));
    const notice = await TL.screen.findByRole('button', { name: /Bonus recorded/ });
    await user.click(notice);

    expect(navigate).toHaveBeenCalledWith('rewards');
    await TL.waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(`${V2}notifications`) ?? '[]') as { id: string; read: boolean }[];
      expect(stored.find((n) => n.id === 'not_1')?.read).toBe(true);
    });
  });
});
