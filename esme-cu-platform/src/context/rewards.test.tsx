// @vitest-environment jsdom
/**
 * The bonus and warning store exercised through the real provider: the directory comes from the
 * development adapter, the records are written by the same actions the dashboard calls, and what
 * the screen reports is read back out of browser storage by a second mount. A bonus has to land in
 * two places at once — the accountability entry and the scoring ledger the leaderboard already
 * reads — so that pair is what these tests cross, along with the retries and refusals around it.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoreLedgerEntry, User } from '../types';
import { activeWarningsOf, type RewardEntry, type RewardPolicy } from '../domain/rewards';

const PASSWORD = 'Str0ng#Rewards1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

type Store = {
  users: User[];
  rewardEntries: RewardEntry[];
  rewardPolicy: RewardPolicy;
  scoreLedger: ScoreLedgerEntry[];
  auditLogs: { action: string; details: string }[];
  notifications: { title: string; message: string }[];
  awardBonus: (input: { targetId: string; points: number; reason: string; evidenceUrl?: string; idempotencyKey: string }) => Promise<RewardEntry>;
  issueWarning: (input: { targetId: string; severity: 'notice' | 'formal' | 'final'; reason: string; evidenceUrl?: string; idempotencyKey: string }) => Promise<RewardEntry>;
  reverseRewardEntry: (entryId: string, reason: string) => Promise<RewardEntry>;
  acknowledgeWarning: (entryId: string) => Promise<void>;
  updateRewardPolicy: (patch: Partial<RewardPolicy>) => RewardPolicy;
};

let TL: typeof import('@testing-library/react');
let V2: string;
let ctx: Store | null = null;
let queue: typeof import('../email/queue');

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

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  V2 = (await import('../storage/migrations')).STORAGE_KEYS.v2;
  queue = await import('../email/queue');
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  ctx = null;
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

  localStorage.setItem(
    `${V2}userProfiles`,
    JSON.stringify([
      account('usr_nada', 'Nada Yehia'),
      account('usr_dir', 'Omar Director', { role: 'director', email: 'omar@esme.test', username: 'omar' }),
      account('usr_suspended', 'Sara Suspended', { status: 'suspended' }),
    ])
  );

  const { createLocalDevAdapter } = await import('../auth/localDevAdapter');
  const adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

async function mount() {
  const [{ AppProvider, useApp }, auth] = await Promise.all([import('../context/AppContext'), import('../auth/AuthProvider')]);

  const Probe: React.FC = () => {
    const value = useApp() as unknown as Store;
    React.useEffect(() => {
      ctx = value;
    }, [value]);
    return null;
  };
  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <auth.AuthProvider>
      <AppProvider>
        <Gate>
          <Probe />
        </Gate>
      </AppProvider>
    </auth.AuthProvider>
  );
  await TL.waitFor(() => {
    if (!ctx) throw new Error('the store has not rendered yet');
  });
}

const storedEntries = (): RewardEntry[] => JSON.parse(localStorage.getItem(`${V2}rewardEntries`) ?? '[]') as RewardEntry[];
const storedLedger = (): ScoreLedgerEntry[] => JSON.parse(localStorage.getItem(`${V2}scoreLedger`) ?? '[]') as ScoreLedgerEntry[];

/** The store flushes through an effect, so a write is only proven once the row is readable. */
async function expectStoredEntries(count: number) {
  await TL.waitFor(() => {
    const rows = storedEntries();
    if (rows.length !== count) throw new Error(`expected ${count} reward row(s), found ${rows.length}`);
  });
}

describe('bonuses through the store', () => {
  it('writes the accountability entry and the point movement the leaderboard reads, in one step', async () => {
    await mount();

    const entry = await ctx!.awardBonus({
      targetId: 'usr_nada',
      points: 15,
      reason: 'Ran the NDT workshop for the first-year cohort',
      idempotencyKey: 'bonus:first',
    });
    await expectStoredEntries(1);
    await TL.waitFor(() => {
      const ledger = storedLedger();
      if (!ledger.some((l) => l.id === `ledg_${entry.id}`)) throw new Error('the paired ledger row has not been written yet');
    });

    expect(entry).toMatchObject({
      kind: 'bonus',
      targetId: 'usr_nada',
      targetName: 'Nada Yehia',
      targetRoleAtTime: 'member',
      actorId: ctx!.users.find((u) => u.username === 'temsah1')!.id,
      actorName: ADMIN.fullName,
      actorRole: 'super_admin',
      points: 15,
      status: 'active',
      idempotencyKey: 'bonus:first',
    });

    const ledger = ctx!.scoreLedger.find((l) => l.id === `ledg_${entry.id}`)!;
    expect(ledger).toMatchObject({ memberId: 'usr_nada', points: 15, actionType: 'bonus', previousTotal: 40, newTotal: 55, reason: entry.reason });
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(55);
    expect(ctx!.auditLogs.some((row) => row.action === 'Bonus Awarded' && row.details.includes(entry.id))).toBe(true);
    expect(ctx!.notifications.map((n) => n.title)).toContain('Bonus points awarded');

    const mailed = queue.readEmailQueue().filter((e) => e.request.event === 'bonus_awarded');
    expect(mailed).toHaveLength(1);
    expect(mailed[0].request).toMatchObject({ recipientId: 'usr_nada', to: 'usr_nada@esme.test' });
    expect(mailed[0].request.payload).toMatchObject({ points: 15, newTotal: 55, awarderName: ADMIN.fullName });
  });

  it('collapses a replayed submit onto the entry that already exists instead of paying twice', async () => {
    await mount();

    const first = await ctx!.awardBonus({ targetId: 'usr_nada', points: 20, reason: 'Delivered the summit brief a week early', idempotencyKey: 'bonus:retry' });
    await expectStoredEntries(1);
    const replay = await ctx!.awardBonus({ targetId: 'usr_nada', points: 20, reason: 'Delivered the summit brief a week early', idempotencyKey: 'bonus:retry' });
    await Promise.resolve();

    expect(replay.id).toBe(first.id);
    expect(ctx!.rewardEntries.filter((e) => e.idempotencyKey === 'bonus:retry')).toHaveLength(1);
    expect(ctx!.scoreLedger.filter((l) => l.id === `ledg_${first.id}`)).toHaveLength(1);
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(60);
    expect(storedEntries()).toHaveLength(1);
  });

  it('refuses an account that is not in the directory, one that is not active, and its own awarder', async () => {
    await mount();

    await expect(ctx!.awardBonus({ targetId: 'usr_ghost', points: 5, reason: 'Helped at the career fair', idempotencyKey: 'bonus:ghost' })).rejects.toThrow(
      /not in the directory/
    );
    await expect(ctx!.awardBonus({ targetId: 'usr_suspended', points: 5, reason: 'Helped at the career fair', idempotencyKey: 'bonus:susp' })).rejects.toThrow(
      /not an active account/
    );

    const adminId = ctx!.users.find((u) => u.username === 'temsah1')!.id;
    await expect(ctx!.awardBonus({ targetId: adminId, points: 50, reason: 'Kept the platform running', idempotencyKey: 'bonus:self' })).rejects.toThrow(
      /themselves|protected/
    );
    expect(ctx!.rewardEntries).toHaveLength(0);
    expect(storedEntries()).toHaveLength(0);
  });

  it('refuses a bonus the permission matrix would not allow and keeps the ledger clean', async () => {
    await mount();

    await expect(ctx!.awardBonus({ targetId: 'usr_nada', points: 26, reason: 'Above the shipped per-action cap', idempotencyKey: 'bonus:cap' })).rejects.toThrow(
      /limit is 25 points per action/
    );
    expect(ctx!.rewardEntries).toHaveLength(0);
    expect(ctx!.scoreLedger).toHaveLength(0);
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(40);
  });
});

describe('warnings through the store', () => {
  it('records discipline that moves no points and tells the member why', async () => {
    await mount();

    const entry = await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'formal', reason: 'Two deadlines missed without notice', idempotencyKey: 'warn:1' });
    await expectStoredEntries(1);

    expect(entry).toMatchObject({ kind: 'warning', severity: 'formal', points: 0, status: 'active' });
    expect(ctx!.scoreLedger).toHaveLength(0);
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(40);
    expect(ctx!.auditLogs.some((row) => row.action === 'Warning Issued')).toBe(true);

    const mailed = queue.readEmailQueue().find((e) => e.request.event === 'warning_issued');
    expect(mailed?.request.payload).toMatchObject({ severity: 'formal', issuerName: ADMIN.fullName });
  });

  it('escalates to the committee Director once the window threshold is reached, once per warning', async () => {
    await mount();

    await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'notice', reason: 'Late to the first session', idempotencyKey: 'warn:e1' });
    await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'notice', reason: 'Late to the second session', idempotencyKey: 'warn:e2' });
    await expectStoredEntries(2);
    expect(ctx!.notifications.some((n) => n.title.includes('warnings in 90 days'))).toBe(false);

    await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'final', reason: 'Missed the summit handover', idempotencyKey: 'warn:e3' });
    await expectStoredEntries(3);

    const escalation = ctx!.notifications.filter((n) => n.title.includes('has 3 warnings in 90 days'));
    expect(escalation).toHaveLength(1);
    expect(escalation[0].message).toMatch(/in front of you/);

    // A replay of the third warning is the same action, so it escalates once rather than twice.
    await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'final', reason: 'Missed the summit handover', idempotencyKey: 'warn:e3' });
    await Promise.resolve();
    expect(ctx!.rewardEntries.filter((e) => e.kind === 'warning')).toHaveLength(3);
    expect(ctx!.notifications.filter((n) => n.title.includes('has 3 warnings in 90 days'))).toHaveLength(1);
  });

  it('will not let the awarder acknowledge a warning that belongs to someone else', async () => {
    await mount();

    const entry = await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'notice', reason: 'Missed the committee meeting', idempotencyKey: 'warn:a1' });
    await expectStoredEntries(1);

    await expect(ctx!.acknowledgeWarning(entry.id)).rejects.toThrow(/only the member/i);
    expect(ctx!.rewardEntries.find((e) => e.id === entry.id)!.acknowledgedAt).toBeUndefined();
  });
});

describe('correcting a record', () => {
  it('reverses a bonus with a second entry and takes the points back through the ledger', async () => {
    await mount();

    const original = await ctx!.awardBonus({ targetId: 'usr_nada', points: 20, reason: 'Awarded twice by mistake', idempotencyKey: 'bonus:dup' });
    await expectStoredEntries(1);
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(60);

    // A correction with no reason is a silent edit with extra steps, so it is refused first.
    await expect(ctx!.reverseRewardEntry(original.id, '   ')).rejects.toThrow(/without a reason/);

    const reversal = await ctx!.reverseRewardEntry(original.id, 'The same deliverable was paid for twice.');
    await TL.waitFor(() => {
      const rows = storedEntries();
      if (rows.length !== 2) throw new Error(`expected the reversal to be stored, found ${rows.length} row(s)`);
    });

    const stored = ctx!.rewardEntries.find((e) => e.id === original.id)!;
    expect(stored.status).toBe('reversed');
    expect(stored.reversedByEntryId).toBe(reversal.id);
    // The original text is untouched: a correction adds, it never rewrites.
    expect(stored.reason).toBe('Awarded twice by mistake');
    expect(reversal).toMatchObject({ points: -20, reversedByEntryId: original.id, status: 'active', reason: 'The same deliverable was paid for twice.' });

    const penalty = ctx!.scoreLedger.find((l) => l.id === `ledg_${reversal.id}`)!;
    expect(penalty).toMatchObject({ points: -20, actionType: 'penalty', previousTotal: 60, newTotal: 40 });
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(40);
    expect(ctx!.auditLogs.some((row) => row.action === 'Reward Entry Reversed')).toBe(true);
    await expect(ctx!.reverseRewardEntry(original.id, 'Reversing it twice')).rejects.toThrow(/already been reversed/);
  });

  it('withdraws a warning without inventing a points movement', async () => {
    await mount();

    const warning = await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'notice', reason: 'Reported for a session they did attend', idempotencyKey: 'warn:rev' });
    await expectStoredEntries(1);

    const reversal = await ctx!.reverseRewardEntry(warning.id, 'The attendance sheet shows they were there.');
    await expectStoredEntries(2);

    expect(reversal).toMatchObject({ kind: 'warning', points: 0, reversedByEntryId: warning.id });
    expect(ctx!.scoreLedger).toHaveLength(0);
    expect(ctx!.rewardEntries.find((e) => e.id === warning.id)!.status).toBe('reversed');
    // A withdrawn warning no longer counts toward the escalation threshold, and the withdrawal that
    // recorded it is not itself a second warning.
    expect(activeWarningsOf(ctx!.rewardEntries, 'usr_nada')).toHaveLength(0);
  });
});

describe('the permission matrix', () => {
  it('saves a cap the Super Admin sets and audits it', async () => {
    await mount();

    const next = ctx!.updateRewardPolicy({ maxBonusPointsPerAction: 40, maxBonusPointsPerMemberPerPeriod: 120 });
    expect(next).toMatchObject({ maxBonusPointsPerAction: 40, maxBonusPointsPerMemberPerPeriod: 120, updatedBy: ctx!.users.find((u) => u.username === 'temsah1')!.id });
    await TL.waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(`${V2}rewardPolicy`) ?? 'null') as RewardPolicy | null;
      if (!stored || stored.maxBonusPointsPerAction !== 40) throw new Error('the matrix has not been written yet');
    });
    expect(ctx!.auditLogs.some((row) => row.action === 'Updated Reward Policy')).toBe(true);

    // The raised cap now admits a bonus the default refused.
    const entry = await ctx!.awardBonus({ targetId: 'usr_nada', points: 35, reason: 'Led the inspection campaign end to end', idempotencyKey: 'bonus:raised' });
    expect(entry.points).toBe(35);
  });

  it('refuses a matrix that would make the control meaningless', async () => {
    await mount();
    const before = ctx!.rewardPolicy;

    expect(() => ctx!.updateRewardPolicy({ maxBonusPointsPerAction: 0 })).toThrow(/between 1 and 500/);
    expect(() => ctx!.updateRewardPolicy({ periodDays: 3 })).toThrow(/between 7 and 365 days/);
    expect(() => ctx!.updateRewardPolicy({ canAwardBonus: [] })).toThrow(/at least one role/i);
    expect(ctx!.rewardPolicy).toEqual(before);
    // The store mirrors the policy it holds, so what is on disk is still the refused-from draft's
    // predecessor: a rejected edit must not reach storage.
    const stored = JSON.parse(localStorage.getItem(`${V2}rewardPolicy`) ?? 'null') as RewardPolicy | null;
    expect(stored?.maxBonusPointsPerAction).toBe(25);
    expect(stored?.periodDays).toBe(90);
    expect(stored?.updatedBy).toBe('system-default');
  });
});

describe('rewards survive the tab', () => {
  it('reads the entries and the matrix back out of storage on a fresh mount', async () => {
    await mount();
    const entry = await ctx!.awardBonus({ targetId: 'usr_nada', points: 12, reason: 'Wrote the equipment checklist', idempotencyKey: 'bonus:persist' });
    await ctx!.issueWarning({ targetId: 'usr_nada', severity: 'notice', reason: 'Missed the briefing', idempotencyKey: 'warn:persist' });
    ctx!.updateRewardPolicy({ escalateWarningsAfter: 4 });
    await TL.waitFor(() => {
      if (storedEntries().length !== 2) throw new Error('the entries have not been flushed yet');
    });

    TL.cleanup();
    ctx = null;
    await mount();

    expect(ctx!.rewardEntries.map((e) => e.id).sort()).toEqual([entry.id, ctx!.rewardEntries.find((e) => e.kind === 'warning')!.id].sort());
    expect(ctx!.rewardPolicy.escalateWarningsAfter).toBe(4);
    expect(ctx!.rewardEntries.find((e) => e.id === entry.id)).toMatchObject({ points: 12, status: 'active', idempotencyKey: 'bonus:persist' });
    // The point movement it paired with is still the one row the leaderboard reads.
    expect(ctx!.scoreLedger.filter((l) => l.actionType === 'bonus')).toHaveLength(1);
  });

  it('drops a stored entry that is missing the fields a record needs', async () => {
    localStorage.setItem(
      `${V2}rewardEntries`,
      JSON.stringify([
        { id: 'rew_ok', kind: 'bonus', actorId: 'usr_admin', targetId: 'usr_nada', points: 5, status: 'active', idempotencyKey: 'k', issuedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'rew_broken', kind: 'bonus' },
        'not even a record',
      ])
    );

    await mount();
    expect(ctx!.rewardEntries.map((e) => e.id)).toEqual(['rew_ok']);
  });
});
