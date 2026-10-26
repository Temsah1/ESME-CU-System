// @vitest-environment jsdom
/**
 * What the analytics screen is allowed to claim.
 *
 * The browser module is mocked so each test answers as the deployment would: with no project
 * configured, and with rows a sync actually wrote. The historical screenshots stay inside their
 * collapsed record and never enter a live total — the same rule the page was written to keep.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialLoad, SocialPost, SocialSyncRun } from '../../domain/socialInsights';
import type { User } from '../../types';

const metaSync = vi.hoisted(() => ({
  socialSourceFromEnv: vi.fn(),
  loadSocialInsights: vi.fn(),
  requestSocialSync: vi.fn(),
}));

vi.mock('../../social/metaSync', () => metaSync);

const PASSWORD = 'Str0ng#Social1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const APPLICANT = { fullName: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: import('../../auth/types').AuthAdapter;

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

const run = (over: Partial<SocialSyncRun> = {}): SocialSyncRun => ({
  id: 'run_1',
  provider: 'meta_graph',
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  finishedAt: new Date(Date.now() - 3_500_000).toISOString(),
  status: 'ok',
  rowsWritten: 2,
  detail: '',
  ...over,
});

const post = (over: Partial<SocialPost> & Pick<SocialPost, 'id' | 'title'>): SocialPost => ({
  platform: 'facebook',
  externalId: `ext_${over.id}`,
  permalink: null,
  publishedAt: '2026-10-01T10:00:00.000Z',
  impressions: null,
  interactions: null,
  shares: null,
  reach: null,
  audience: {},
  fetchedAt: '2026-10-25T10:00:00.000Z',
  ...over,
});

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
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

  metaSync.socialSourceFromEnv.mockReset();
  metaSync.loadSocialInsights.mockReset();
  metaSync.requestSocialSync.mockReset();

  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([account('usr_nada', 'Nada Yehia')]));
  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

async function renderView() {
  const [{ AppProvider }, auth, { SocialMediaInsightsView }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./SocialMediaInsightsView'),
    import('../../motion'),
    import('motion/react'),
  ]);

  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <Gate>
              <SocialMediaInsightsView />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  await userEvent.setup();
}

describe('with no project configured', () => {
  beforeEach(() => {
    metaSync.socialSourceFromEnv.mockResolvedValue({
      status: 'blocked',
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });
    metaSync.loadSocialInsights.mockResolvedValue({
      state: 'blocked',
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    } satisfies SocialLoad);
  });

  it('says the sync is blocked and names the missing browser variables', async () => {
    await renderView();

    expect(await TL.screen.findByText('Live sync is blocked')).toBeTruthy();
    // The banner and the configuration card both name the variables; neither invents a figure.
    expect(TL.screen.getAllByText(/VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/).length).toBeGreaterThan(0);
    // Nothing is rendered as a live figure: there is no run and no row to total.
    expect(TL.screen.queryByText('Posts stored')).toBeNull();
    expect(TL.screen.queryByText('Engagement rate')).toBeNull();
  });

  it('offers the sync control but leaves it disabled, and asks for no request', async () => {
    await renderView();

    const button = (await TL.screen.findByRole('button', { name: /Sync now/ })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await TL.act(async () => {
      button.click();
    });
    expect(metaSync.requestSocialSync).not.toHaveBeenCalled();
  });

  it('keeps the transcribed record inside a collapsed block labelled not live', async () => {
    await renderView();

    const summary = await TL.screen.findByText(/Historical record transcribed from screenshots/);
    expect(summary.textContent).toContain('not live');
    // A summary inside <details> is the only place the old figures are described; the live KPI
    // shape above it is absent, so the two cannot be read as one total.
    expect(summary.closest('details')).not.toBeNull();
    expect(TL.screen.getByText(/This is a historical record, not a measurement from this system/)).toBeTruthy();
  });
});

describe('with rows a sync wrote', () => {
  beforeEach(() => {
    metaSync.socialSourceFromEnv.mockResolvedValue({ status: 'ready', client: {} });
    metaSync.loadSocialInsights.mockResolvedValue({
      state: 'ready',
      runs: [run()],
      posts: [
        post({ id: 'p1', title: 'Orientation recap', impressions: 1000, interactions: 25, shares: 5 }),
        post({ id: 'p2', title: 'Workshop photos', impressions: null, interactions: 5, shares: 0 }),
      ],
      rejectedRows: 0,
    } satisfies SocialLoad);
  });

  it('totals only the stored rows, and prints a missing metric as a dash', async () => {
    await renderView();

    expect(await TL.screen.findByText('Posts stored')).toBeTruthy();
    // Once in the KPI card and once in the row that carried the figure.
    expect(TL.screen.getAllByText('1,000')).toHaveLength(2);
    expect(TL.screen.getByText('30')).toBeTruthy();
    expect(TL.screen.getByText('3%')).toBeTruthy();
    expect(TL.screen.getByText('Measurements are current')).toBeTruthy();
    // p1 reach, p2 impressions and p2 reach: three gaps, never filled with a zero.
    expect(TL.screen.getAllByText('—')).toHaveLength(3);
    expect(TL.screen.getByText('Workshop photos')).toBeTruthy();
  });
});

describe('a member without integrations.manage', () => {
  it('reads the page but is not offered the sync button', async () => {
    metaSync.socialSourceFromEnv.mockResolvedValue({ status: 'blocked', missing: ['VITE_SUPABASE_URL'] });
    metaSync.loadSocialInsights.mockResolvedValue({ state: 'blocked', missing: ['VITE_SUPABASE_URL'] });

    const registered = await adapter.register({
      ...APPLICANT,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptedPolicies: true,
    });
    if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code}`);
    const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
    if (!approved.ok) throw new Error(`approval refused: ${approved.error.code}`);

    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);
    await renderView();

    expect(await TL.screen.findByText('Live sync is blocked')).toBeTruthy();
    expect(TL.screen.queryByRole('button', { name: /Sync now/ })).toBeNull();
  });
});
