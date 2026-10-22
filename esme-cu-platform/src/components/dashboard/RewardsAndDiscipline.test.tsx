// @vitest-environment jsdom
/**
 * The bonus and warning screen exercised as a surface, not as a unit: the store behind it is the
 * real AppProvider, the session is the real development adapter, and every claim the form makes is
 * checked against what lands in browser storage. The reported failure class this guards against is
 * a control that looks like it worked — a button that records nothing, or one that records what the
 * rules forbid — so each test reads the row back.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REWARD_POLICY, type RewardEntry, type RewardPolicy } from '../../domain/rewards';
import type { ScoreLedgerEntry, User } from '../../types';

const PASSWORD = 'Str0ng#RewardsUI1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

const account = (id: string, name: string, over: Partial<User> = {}): User => ({
  id,
  name,
  email: `${id}@esme.test`,
  username: id,
  role: 'member',
  status: 'active',
  committeeId: 'comm_te',
  totalPoints: 40,
  approvedTasksCount: 2,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
  ...over,
});

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;

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

  localStorage.setItem(
    `${V2}userProfiles`,
    JSON.stringify([account('usr_nada', 'Nada Yehia'), account('usr_omar', 'Omar Fathy', { username: 'omar.fathy', email: 'omar.fathy@esme.test' })])
  );

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  const adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

const entries = (): RewardEntry[] => JSON.parse(localStorage.getItem(`${V2}rewardEntries`) ?? '[]') as RewardEntry[];
const ledger = (): ScoreLedgerEntry[] => JSON.parse(localStorage.getItem(`${V2}scoreLedger`) ?? '[]') as ScoreLedgerEntry[];
const policy = (): RewardPolicy | null => JSON.parse(localStorage.getItem(`${V2}rewardPolicy`) ?? 'null') as RewardPolicy | null;

/** The button's own flag, not an aria attribute a renderer could fake. */
const disabled = (element: HTMLElement) => (element as HTMLButtonElement).disabled;

const openDialogsWithTitle = (title: string) =>
  Array.from(document.querySelectorAll('[role="dialog"]')).filter((element) => element.textContent?.includes(title));

async function dialogWithTitle(title: string) {
  await TL.waitFor(() => {
    if (openDialogsWithTitle(title).length === 0) throw new Error(`no dialog titled ${title}`);
  });
  // A closing modal can still sit in the document mid-animation, so the newest one is the live one.
  return TL.within(openDialogsWithTitle(title)[openDialogsWithTitle(title).length - 1] as HTMLElement);
}

async function openPage() {
  const [{ AppProvider }, auth, { RewardsAndDiscipline }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./RewardsAndDiscipline'),
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
              <RewardsAndDiscipline onNavigate={navigate} />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  await TL.screen.findByRole('heading', { name: 'Bonuses & Warnings' });
  return { user: await userEvent.setup(), navigate };
}

describe('awarding from the screen', () => {
  it('starts with an explanation, not a sample row', async () => {
    await openPage();
    expect(TL.screen.getByText('Nothing has been recorded yet')).toBeTruthy();
    expect(TL.screen.getByText('Ledger (0)')).toBeTruthy();
    // The screen says where the records live, because a device-local ledger is not the shared
    // ledger the server rules were written for.
    expect(TL.screen.getByText(/These entries live in this browser/)).toBeTruthy();
    expect(entries()).toEqual([]);
  });

  it('records a bonus through the form and writes the point movement with it', async () => {
    const { user } = await openPage();
    await user.click(TL.screen.getByRole('button', { name: 'Award bonus' }));
    const box = await dialogWithTitle('Award a bonus');

    // Nothing is submittable before a member and a reason exist: a bonus is not a bare number.
    expect(disabled(box.getByRole('button', { name: 'Record bonus' }))).toBe(true);

    await user.type(box.getByLabelText('Search accounts to record this entry against'), 'Nada');
    await user.click(await box.findByRole('button', { name: 'Select Nada Yehia' }));

    await user.clear(box.getByLabelText('Bonus points'));
    await user.type(box.getByLabelText('Bonus points'), '15');
    await user.type(box.getByLabelText('Reason (mandatory)'), 'Ran the NDT workshop for the first-year cohort');

    // The preview is the same verdict the store will run, so it can only go green once a reason exists.
    expect(box.getByText(/Ready to write for Nada Yehia/)).toBeTruthy();
    expect(disabled(box.getByRole('button', { name: 'Record bonus' }))).toBe(false);
    await user.click(box.getByRole('button', { name: 'Record bonus' }));

    await TL.waitFor(() => {
      if (entries().length !== 1) throw new Error(`stored ${entries().length} entry(ies)`);
    });
    const [written] = entries();
    expect(written).toMatchObject({ kind: 'bonus', targetId: 'usr_nada', points: 15, actorRole: 'super_admin', status: 'active' });
    expect(ledger()).toHaveLength(1);
    expect(ledger()[0]).toMatchObject({ memberId: 'usr_nada', points: 15, actionType: 'bonus', previousTotal: 40, newTotal: 55 });
    expect(TL.screen.getAllByText('+15 pts').length).toBeGreaterThan(0);
    expect(TL.screen.getByText('Ledger (1)')).toBeTruthy();
  });

  it('shows which rule blocks each account instead of hiding the list', async () => {
    const { user } = await openPage();
    await user.click(TL.screen.getByRole('button', { name: 'Award bonus' }));
    const box = await dialogWithTitle('Award a bonus');

    // The signed-in administrator is the only account here that cannot be a target at all.
    const self = await box.findByRole('button', { name: 'Select Kareem Tamer' });
    expect(disabled(self)).toBe(true);
    expect(box.getByText(/Nobody can award themselves a bonus/)).toBeTruthy();

    await user.click(box.getByRole('button', { name: 'Select Nada Yehia' }));
    // Both members in the directory are eligible, so the verdict is counted, not pinned to one print.
    expect(box.getAllByText(/Eligible — the reason below is mandatory/).length).toBeGreaterThan(0);
  });

  it('refuses a cap the matrix does not allow, before anything is written', async () => {
    const { user } = await openPage();
    await user.click(TL.screen.getByRole('button', { name: 'Award bonus' }));
    const box = await dialogWithTitle('Award a bonus');
    await user.click(await box.findByRole('button', { name: 'Select Nada Yehia' }));
    await user.type(box.getByLabelText('Reason (mandatory)'), 'Above the shipped per-action cap');
    await user.clear(box.getByLabelText('Bonus points'));
    await user.type(box.getByLabelText('Bonus points'), '26');

    expect(box.getByText(/Blocked: The limit is 25 points per action/)).toBeTruthy();
    expect(disabled(box.getByRole('button', { name: 'Record bonus' }))).toBe(true);
    expect(entries()).toEqual([]);
  });

  it('announces an escalation before the third warning is committed', async () => {
    const seed = (n: number): RewardEntry => ({
      id: `rew_seed_${n}`,
      kind: 'warning',
      actorId: 'usr_admin',
      actorName: ADMIN.fullName,
      actorRole: 'super_admin',
      targetId: 'usr_nada',
      targetName: 'Nada Yehia',
      targetRoleAtTime: 'member',
      committeeId: 'comm_te',
      points: 0,
      severity: 'notice',
      reason: `Missed session ${n} without notice`,
      issuedAt: new Date(Date.now() - n * 86400000).toISOString(),
      status: 'active',
      idempotencyKey: `seed:${n}`,
    });
    localStorage.setItem(`${V2}rewardEntries`, JSON.stringify([seed(1), seed(2)]));

    const { user } = await openPage();
    await user.click(TL.screen.getByRole('button', { name: 'Issue warning' }));
    const box = await dialogWithTitle('Issue a warning');
    await user.click(await box.findByRole('button', { name: 'Select Nada Yehia' }));
    expect(box.getByText(/would be warning 3 in 90 days/)).toBeTruthy();

    await user.selectOptions(box.getByLabelText('Severity'), 'final');
    await user.type(box.getByLabelText('Reason (mandatory)'), 'Missed the summit handover');
    expect(box.getByText(/Before you commit: This is warning 3 in 90 days/)).toBeTruthy();
    await user.click(box.getByRole('button', { name: 'Record warning' }));

    await TL.waitFor(() => {
      if (entries().filter((e) => e.kind === 'warning').length !== 3) throw new Error('the third warning was not stored');
    });
    // Discipline moves no points, so nothing reached the scoring ledger.
    expect(ledger()).toEqual([]);
    expect(TL.screen.getAllByText(/Warning · Final warning/).length).toBeGreaterThan(0);
  });
});

describe('correcting from the screen', () => {
  it('reverses a bonus with a second entry that takes the points back', async () => {
    const { user } = await openPage();
    await user.click(TL.screen.getByRole('button', { name: 'Award bonus' }));
    const award = await dialogWithTitle('Award a bonus');
    await user.click(await award.findByRole('button', { name: 'Select Nada Yehia' }));
    await user.type(award.getByLabelText('Reason (mandatory)'), 'Awarded twice by mistake');
    await user.click(award.getByRole('button', { name: 'Record bonus' }));
    await TL.waitFor(() => {
      if (entries().length !== 1) throw new Error('the bonus was not stored');
    });

    // The entry is listed twice on this screen — cards for narrow viewports and the table for wide
    // ones — so either control opens the same reversal modal.
    await user.click(TL.screen.getAllByRole('button', { name: /^Reverse entry/ })[0]);
    const box = await dialogWithTitle('Reverse this entry');
    // A reversal with no reason is refused twice over: the form will not submit and the store will not
    // write. Checking the stored rows is the part that matters, so that is what is read back here.
    await user.click(box.getByRole('button', { name: 'Write reversing entry' }));
    expect(entries()).toHaveLength(1);

    await user.type(box.getByLabelText(/Why is this being reversed/), 'The same deliverable was paid for twice.');
    await user.click(box.getByRole('button', { name: 'Write reversing entry' }));

    await TL.waitFor(() => {
      if (entries().length !== 2) throw new Error(`stored ${entries().length} entry(ies)`);
    });
    const reversal = entries().find((e) => e.status === 'active' && e.reversedByEntryId)!;
    const original = entries().find((e) => e.status === 'reversed')!;
    expect(reversal.points).toBe(-original.points);
    expect(reversal.reversedByEntryId).toBe(original.id);
    expect(reversal.reason).toBe('The same deliverable was paid for twice.');
    expect(original.reason).toBe('Awarded twice by mistake');
    expect(ledger().filter((l) => l.actionType === 'penalty')).toHaveLength(1);
    expect(TL.screen.getAllByText('reversed').length).toBeGreaterThan(0);
    expect(TL.screen.getByText('Reversed entries')).toBeTruthy();
    expect(TL.screen.getAllByText('correcting entry').length).toBeGreaterThan(0);
  });
});

describe('the permission matrix on screen', () => {
  it('refuses a cap it cannot honour and keeps the stored default', async () => {
    const { user } = await openPage();
    await user.click(TL.screen.getByRole('button', { name: 'Permission matrix' }));

    // Read-only until an officer asks to edit: the caps on screen are the stored ones.
    expect(TL.screen.getByText('Who may award, how much, and when it escalates')).toBeTruthy();
    expect(TL.screen.queryByLabelText('Maximum points per action')).toBeNull();
    await user.click(TL.screen.getByRole('button', { name: 'Edit matrix' }));

    const cap = TL.screen.getByLabelText('Maximum points per action');
    await user.clear(cap);
    await user.type(cap, '0');
    // The reason prints both beside the field and in the summary list under the form.
    expect(TL.screen.getAllByText(/whole number between 1 and 500/).length).toBeGreaterThan(0);
    expect(disabled(TL.screen.getByRole('button', { name: 'Save matrix' }))).toBe(true);
    expect(policy()?.maxBonusPointsPerAction).toBe(25);

    await user.clear(cap);
    await user.type(cap, '40');
    const ceiling = TL.screen.getByLabelText(/Maximum points per member/);
    await user.clear(ceiling);
    await user.type(ceiling, '120');
    expect(disabled(TL.screen.getByRole('button', { name: 'Save matrix' }))).toBe(false);
    await user.click(TL.screen.getByRole('button', { name: 'Save matrix' }));

    await TL.waitFor(() => {
      if (policy()?.maxBonusPointsPerAction !== 40) throw new Error('the matrix was not written back');
    });
    expect(policy()?.maxBonusPointsPerMemberPerPeriod).toBe(120);
    expect(TL.screen.getByText('Permission matrix updated. New caps apply to the next entry.')).toBeTruthy();
  });

  it('hides an action the matrix switched off for this role', async () => {
    // The capability says a Super Admin may write; the matrix says only a High Board may award a
    // bonus right now, so the bonus control is absent while the warning control stays.
    localStorage.setItem(
      `${V2}rewardPolicy`,
      JSON.stringify({ ...DEFAULT_REWARD_POLICY, canAwardBonus: ['high_board'], canIssueWarning: ['super_admin', 'high_board'] })
    );

    await openPage();
    expect(TL.screen.queryByRole('button', { name: 'Award bonus' })).toBeNull();
    expect(disabled(TL.screen.getByRole('button', { name: 'Issue warning' }))).toBe(false);
  });
});
