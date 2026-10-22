// @vitest-environment jsdom
/**
 * The home screen as three screens. Each test signs in through the development adapter and reads
 * what the page prints, so the difference between them is the role matrix at work rather than a
 * branch someone could rewrite: a member's home cannot grow a chapter figure, a Head's cannot grow
 * a committee-totalled chapter view, and an empty workspace cannot produce a number at all.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../../auth/types';
import type { RewardEntry } from '../../domain/rewards';
import type { User } from '../../types';

const PASSWORD = 'Str0ng#HomeUI1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const APPLICANT = { fullName: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };

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
  // jsdom has no IntersectionObserver, and a counter that waits for the viewport never starts.
  // Everything the home screen draws is reported as already on screen.
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
  V2 = (await import('../../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([account('usr_nada', 'Nada Yehia')]));

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

/** Approves the applicant while the administrator is still the session, then returns their account id. */
async function approveApplicant(committeeId?: string) {
  const registered = await adapter.register({
    ...APPLICANT,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptedPolicies: true,
  });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
  const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId });
  if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
  const directory = await adapter.listAccounts();
  const found = directory.find((row) => row.email === APPLICANT.email);
  if (!found) throw new Error('the approved account is not in the directory');
  return found.id;
}

async function renderHome() {
  const [{ AppProvider }, auth, { DashboardHome }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./DashboardHome'),
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
              <DashboardHome onNavigate={navigate} />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  return { user, navigate };
}

describe('the chapter home (Super Admin session)', () => {
  it('reports an empty season plan as unknown, not as 0%', async () => {
    const { user } = await renderHome();
    expect(await TL.screen.findByRole('heading', { name: /Kareem Tamer/ })).toBeTruthy();

    // Nothing is seeded into the planner, so the milestone count has no denominator to divide by.
    expect(TL.screen.getByText('No milestone is written in the season planner yet')).toBeTruthy();
    expect(TL.screen.getByText('Season progress')).toBeTruthy();
    // The label the screen used to print for a season nobody recorded is gone.
    expect(TL.screen.queryByText(/Season 26–27/)).toBeNull();
    expect(user).toBeTruthy();
  });

  it('counts chapter totals only because this account reads the whole chapter', async () => {
    await renderHome();
    expect(await TL.screen.findByText('Total Chapter Members')).toBeTruthy();
    expect(TL.screen.getByText('Active Committees')).toBeTruthy();
  });
});

describe("a member's home", () => {
  it('shows the person their own records and no chapter figure', async () => {
    await approveApplicant('comm_te');
    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);
    await renderHome();

    expect(await TL.screen.findByRole('heading', { name: /Aya Student/ })).toBeTruthy();
    expect(TL.screen.getByText('Points in the ledger')).toBeTruthy();
    expect(TL.screen.getByText('No score entry names you yet')).toBeTruthy();
    expect(TL.screen.getByText(/This page lists only records that name you/)).toBeTruthy();

    // The chapter view is not hidden by CSS here — it is never rendered for this session.
    expect(TL.screen.queryByText('Total Chapter Members')).toBeNull();
    expect(TL.screen.queryByText('Active Committees')).toBeNull();
  });

  it('reads bonus and warning history back from the ledger rows that name the account', async () => {
    const id = await approveApplicant('comm_te');
    const entry: RewardEntry = {
      id: 'rwd_1',
      kind: 'bonus',
      actorId: 'usr_admin',
      actorName: 'Kareem Tamer',
      actorRole: 'super_admin',
      targetId: id,
      targetName: APPLICANT.fullName,
      targetRoleAtTime: 'member',
      committeeId: 'comm_te',
      points: 15,
      reason: 'Delivered the NDT workshop material a week early.',
      issuedAt: '2026-03-04 09:12',
      status: 'active',
      idempotencyKey: 'idem_home_1',
    };
    localStorage.setItem(`${V2}rewardEntries`, JSON.stringify([entry]));

    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);
    await renderHome();

    expect(await TL.screen.findByText('+15 pts')).toBeTruthy();
    expect(TL.screen.getByText('15 bonus point(s) awarded')).toBeTruthy();
    expect(TL.screen.getByText('Delivered the NDT workshop material a week early.')).toBeTruthy();
  });
});

describe("a Head's home", () => {
  it('renders the committee scope, and keeps the account role apart from the seat', async () => {
    const id = await approveApplicant('comm_te');
    const promoted = await adapter.assignRole(id, 'head');
    if (!promoted.ok) throw new Error(`promotion refused: ${promoted.error.code} — ${promoted.error.message}`);
    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);
    await renderHome();

    expect(await TL.screen.findByRole('heading', { name: /Aya Student/ })).toBeTruthy();
    expect(TL.screen.getByText('Committee command')).toBeTruthy();
    expect(TL.screen.getByText('Committee roster')).toBeTruthy();
    // Two different facts, printed apart: the rank the account holds and the leadership seat it fills.
    expect(TL.screen.getByText(/Account role: Team Head/)).toBeTruthy();
    expect(TL.screen.getByText('No committee seat assigned')).toBeTruthy();
    // Committee leadership reads its own committee, not the chapter.
    expect(TL.screen.queryByText('Total Chapter Members')).toBeNull();
  });
});
