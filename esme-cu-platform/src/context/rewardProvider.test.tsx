// @vitest-environment jsdom
/**
 * The reward store with the provider in charge of the write.
 *
 * `rewards.test.tsx` proves the rules; this file proves who answers. The adapter the app resolves is
 * replaced with the real development adapter plus spies on the reward calls, so every assertion here
 * is about what the store does with a provider's answer: a refusal writes nothing anywhere, the row
 * that comes back is the row the ledger keeps, an account without the capability never reaches the
 * write at all, and a replayed submit cannot pay twice.
 *
 * The provider in these tests is stubbed. It is not a PostgreSQL session, so nothing here shows the
 * SQL behaving; that stays in docs/TESTING.md's list of what has not been run.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RewardEntry } from '../domain/rewards';
import type { AdminActionResult, AuthAdapter, BonusWrite, RewardWriteReceipt, RewardWriteResult, WarningWrite } from '../auth/types';
import { AuthFailedError } from '../auth/errors';

let injected: AuthAdapter | null = null;

vi.mock('../auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth')>();
  return {
    ...actual,
    resolveAdapter: () => (injected ? { adapter: injected } : { adapter: null, reason: 'no adapter resolved for this run' }),
  };
});

const PASSWORD = 'Str0ng#Provide1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const MEMBER = { fullName: 'Sara Member', email: 'sara.member@esme-cu.edu', username: 'sara.member' };
const SERVER_ID = '3f1a2b4c-5d6e-7f80-91a2-b3c4d5e6f708';
const SERVER_COMMITTEE = 'c0mm0000-0000-4000-8000-000000000001';
const ADMIN_ID = 'usr_superadmin';

type Store = {
  users: { id: string; name: string; totalPoints: number }[];
  rewardEntries: RewardEntry[];
  scoreLedger: { id: string; points: number; timestamp: string; actionType: string }[];
  auditLogs: { action: string }[];
  notifications: { title: string }[];
  awardBonus: (input: { targetId: string; points: number; reason: string; evidenceUrl?: string; idempotencyKey: string }) => Promise<RewardEntry>;
  issueWarning: (input: { targetId: string; severity: 'notice' | 'formal' | 'final'; reason: string; idempotencyKey: string }) => Promise<RewardEntry>;
  reverseRewardEntry: (entryId: string, reason: string) => Promise<RewardEntry>;
  acknowledgeWarning: (entryId: string) => Promise<void>;
};

let TL: typeof import('@testing-library/react');
let V2: string;
let ctx: Store | null = null;
let queue: typeof import('../email/queue');
/** The un-spyed adapter, so a test can ask the gate directly instead of through the store. */
let base: AuthAdapter;

const account = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `${id}@esme.test`,
  username: id,
  role: 'member',
  status: 'active',
  committeeId: SERVER_COMMITTEE,
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
  injected = null;
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
    JSON.stringify([account('usr_nada', 'Nada Yehia'), account(ADMIN_ID, ADMIN.fullName, { role: 'super_admin', email: ADMIN.email })])
  );

  const { createLocalDevAdapter } = await import('../auth/localDevAdapter');
  base = createLocalDevAdapter();
  const boot = await base.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await base.signIn(ADMIN.email, PASSWORD);
  injected = base;
});

afterEach(() => TL.cleanup());

const REVERSAL_ID = '5e2b3c4d-6f70-8192-a3b4-c5d6e7f80910';
const FILED_AT = '2026-10-22T09:00:00.000Z';

/**
 * What `esme_award_bonus()` returns: a row whose id, instant and actor role the server decided, and
 * whose points, reason and idempotency key are the ones it was handed. A stub that invented its own
 * key would let a replayed submit through, which is exactly the behaviour these tests must not fake.
 */
const receiptOf = (
  write: { targetId: string; points: number; reason: string; idempotencyKey: string; targetRole: BonusWrite['targetRole']; targetCommitteeId?: string },
  over: Partial<RewardWriteReceipt> = {}
): RewardWriteResult => ({
  ok: true,
  receipt: {
    id: SERVER_ID,
    kind: 'bonus',
    actorId: ADMIN_ID,
    actorRole: 'super_admin',
    targetId: write.targetId,
    targetRoleAtTime: write.targetRole,
    committeeId: write.targetCommitteeId,
    points: write.points,
    reason: write.reason,
    issuedAt: FILED_AT,
    status: 'active',
    idempotencyKey: write.idempotencyKey,
    ...over,
  },
});

/** The resolved adapter, with the named reward calls replaced by spies that answer for it. */
function providerWith(
  writes: {
    awardBonus?: (write: BonusWrite) => Promise<RewardWriteResult>;
    issueWarning?: (write: WarningWrite) => Promise<RewardWriteResult>;
    reverseRewardEntry?: (write: { entryId: string; reason: string; original: RewardEntry }) => Promise<RewardWriteResult>;
    acknowledgeWarning?: (entry: RewardEntry) => Promise<AdminActionResult>;
  } = {}
) {
  const spy = {
    awardBonus: vi.fn(writes.awardBonus ?? ((write: BonusWrite) => Promise.resolve(receiptOf(write)))),
    issueWarning: vi.fn(
      writes.issueWarning ?? ((write: WarningWrite) => Promise.resolve(receiptOf({ ...write, points: 0 }, { kind: 'warning', severity: write.severity })))
    ),
    reverseRewardEntry: vi.fn(writes.reverseRewardEntry ?? ((write: { original: RewardEntry }) => Promise.resolve(reversalOf(write.original)))),
    acknowledgeWarning: vi.fn(writes.acknowledgeWarning ?? (() => Promise.resolve({ ok: true } as const))),
  };
  injected = { ...base, ...spy } as AuthAdapter;
  return spy;
}

/** What `esme_reverse_reward_entry()` returns: a new row, pointing at the one it answers. */
const reversalOf = (original: RewardEntry): RewardWriteResult => ({
  ok: true,
  receipt: {
    id: REVERSAL_ID,
    kind: original.kind,
    actorId: original.actorId,
    actorRole: 'super_admin',
    targetId: original.targetId,
    targetRoleAtTime: original.targetRoleAtTime,
    committeeId: original.committeeId,
    points: original.kind === 'bonus' ? -original.points : 0,
    reason: 'Corrected',
    reversedByEntryId: original.id,
    issuedAt: FILED_AT,
    status: 'active',
    idempotencyKey: `reverse:${original.id}:${original.actorId}`,
  },
});

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
const storedLedger = () => JSON.parse(localStorage.getItem(`${V2}scoreLedger`) ?? '[]') as { id: string }[];

describe('a provider that refuses', () => {
  it('leaves no entry, no point movement, no mail and no audit row behind', async () => {
    providerWith({
      awardBonus: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'esme_over_period_cap', message: 'ESME_OVER_PERIOD_CAP: Nada Yehia already has 90 bonus points in this 90 day window' },
        }),
    });
    await mount();

    await expect(
      ctx!.awardBonus({ targetId: 'usr_nada', points: 20, reason: 'Delivered the summit brief a week early', idempotencyKey: 'bonus:refused' })
    ).rejects.toThrow(/OVER_PERIOD_CAP/);

    expect(ctx!.rewardEntries).toHaveLength(0);
    expect(ctx!.scoreLedger).toHaveLength(0);
    expect(storedEntries()).toHaveLength(0);
    expect(storedLedger()).toHaveLength(0);
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(40);
    expect(ctx!.auditLogs.some((row) => row.action === 'Bonus Awarded')).toBe(false);
    expect(ctx!.notifications.map((n) => n.title)).not.toContain('Bonus points awarded');
    expect(queue.readEmailQueue().filter((e) => e.request.event === 'bonus_awarded')).toHaveLength(0);
  });

  it('does not mark a warning read when the provider will not stamp it', async () => {
    providerWith({
      acknowledgeWarning: () =>
        Promise.resolve({ ok: false, error: { code: 'esme_forbidden', message: 'ESME_FORBIDDEN: only the member the warning is about can acknowledge it' } }),
    });
    // Filed against the signed-in account so the store's own check passes and only the provider says no.
    localStorage.setItem(
      `${V2}rewardEntries`,
      JSON.stringify([
        {
          id: 'warn_stale',
          kind: 'warning',
          actorId: 'usr_dir',
          actorName: 'Omar Director',
          actorRole: 'director',
          targetId: ADMIN_ID,
          targetName: ADMIN.fullName,
          targetRoleAtTime: 'super_admin',
          points: 0,
          severity: 'notice',
          reason: 'Missed the handover',
          issuedAt: new Date().toISOString(),
          status: 'active',
          idempotencyKey: 'warn:stamp',
        },
      ])
    );
    await mount();

    await expect(ctx!.acknowledgeWarning('warn_stale')).rejects.toThrow(/only the member/i);
    expect(ctx!.rewardEntries.find((e) => e.id === 'warn_stale')!.acknowledgedAt).toBeUndefined();
    expect(storedEntries().find((e) => e.id === 'warn_stale')!.acknowledgedAt).toBeUndefined();
  });
});

describe('a provider that answers', () => {
  it('keeps the row the provider filed — its id, its instant, its roles — as the record', async () => {
    providerWith();
    await mount();

    const entry = await ctx!.awardBonus({ targetId: 'usr_nada', points: 15, reason: 'Ran the NDT workshop', idempotencyKey: 'bonus:provided' });

    expect(entry.id).toBe(SERVER_ID);
    expect(entry.issuedAt).toBe('2026-10-22T09:00:00.000Z');
    expect(entry.actorRole).toBe('super_admin');
    expect(entry.targetRoleAtTime).toBe('member');
    // The two names are display, taken from the directory and the session, never from the form.
    expect(entry.targetName).toBe('Nada Yehia');
    expect(entry.actorName).toBe(ADMIN.fullName);
    // And the point movement is paired with the provider's id, not one the browser invented.
    await TL.waitFor(() => {
      if (!storedLedger().some((l) => l.id === `ledg_${SERVER_ID}`)) throw new Error('the paired ledger row has not been written');
    });
    expect(ctx!.scoreLedger.find((l) => l.id === `ledg_${SERVER_ID}`)!.timestamp).toBe('2026-10-22T09:00:00.000Z');
  });

  it('collapses a replayed submit onto the one entry the key already names', async () => {
    const spy = providerWith();
    await mount();

    const first = await ctx!.awardBonus({ targetId: 'usr_nada', points: 15, reason: 'Ran the NDT workshop', idempotencyKey: 'bonus:twice' });
    await TL.waitFor(() => {
      if (storedEntries().length !== 1) throw new Error(`expected one row, found ${storedEntries().length}`);
    });
    const replay = await ctx!.awardBonus({ targetId: 'usr_nada', points: 15, reason: 'Ran the NDT workshop', idempotencyKey: 'bonus:twice' });

    expect(replay.id).toBe(first.id);
    expect(ctx!.rewardEntries).toHaveLength(1);
    expect(ctx!.scoreLedger).toHaveLength(1);
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(55);
    // The workspace holds the ledger, so a key it has already filed is not offered to the provider a
    // second time; against a real project, the unique column is the same guard one layer down.
    expect(spy.awardBonus).toHaveBeenCalledTimes(1);
  });

  it('flips the original only after the provider files the reversing row', async () => {
    const spy = providerWith();
    await mount();

    const original = await ctx!.awardBonus({ targetId: 'usr_nada', points: 20, reason: 'Paid for the same deliverable twice', idempotencyKey: 'bonus:to-reverse' });
    await TL.waitFor(() => {
      if (storedEntries().length !== 1) throw new Error('the bonus has not been filed yet');
    });

    spy.reverseRewardEntry.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'esme_already_reversed', message: 'ESME_ALREADY_REVERSED: that entry has already been reversed' },
      })
    );
    await expect(ctx!.reverseRewardEntry(original.id, 'Undoing it twice')).rejects.toThrow(/already been reversed/);
    expect(ctx!.rewardEntries.find((e) => e.id === original.id)!.status).toBe('active');
    expect(ctx!.scoreLedger.filter((l) => l.actionType === 'penalty')).toHaveLength(0);
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(60);

    // Same key, same entry, now accepted: the store may not decide that a refusal keeps applying
    // after the server has changed its answer.
    spy.reverseRewardEntry.mockImplementation((write) => Promise.resolve(reversalOf(write.original)));
    const reversal = await ctx!.reverseRewardEntry(original.id, 'The second entry is undone.');
    expect(reversal.id).toBe(REVERSAL_ID);
    expect(reversal.reversedByEntryId).toBe(original.id);
    await TL.waitFor(() => {
      if (storedEntries().find((e) => e.id === original.id)?.status !== 'reversed') throw new Error('the original has not been flipped');
    });
    expect(ctx!.users.find((u) => u.id === 'usr_nada')!.totalPoints).toBe(40);
    expect(ctx!.scoreLedger.find((l) => l.actionType === 'penalty')).toMatchObject({ points: -20 });
  });
});

describe('an account with no authority to write', () => {
  it('is refused by the store before the provider is asked, and refused again by the provider', async () => {
    const registered = await base.register({ ...MEMBER, password: PASSWORD, confirmPassword: PASSWORD, acceptedPolicies: true });
    if (!registered.ok) throw new Error(`registration refused: ${registered.failure.message}`);
    const approved = await base.decideRegistration(registered.receipt.reference, 'approve', { committeeId: SERVER_COMMITTEE });
    if (!approved.ok) throw new Error(`approval refused: ${approved.error.message}`);
    await base.signOut();
    await base.signIn(MEMBER.email, PASSWORD);

    const spy = providerWith();
    await mount();

    await expect(ctx!.awardBonus({ targetId: ADMIN_ID, points: 5, reason: 'Helped at the career fair', idempotencyKey: 'bonus:nope' })).rejects.toThrow(
      /may not record bonuses or warnings/
    );
    expect(spy.awardBonus).not.toHaveBeenCalled();
    expect(ctx!.rewardEntries).toHaveLength(0);

    // The gate that stands in for RLS: asked directly, with nothing in front of it, the adapter still
    // refuses — which is why the client-side check above is a courtesy and not the control.
    await expect(
      base.awardBonus({ targetId: ADMIN_ID, points: 5, reason: 'Anything at all', idempotencyKey: 'bonus:direct', targetRole: 'member' })
    ).rejects.toBeInstanceOf(AuthFailedError);
    await expect(
      base.issueWarning({ targetId: ADMIN_ID, severity: 'notice', reason: 'Anything at all', idempotencyKey: 'warn:direct', targetRole: 'member' })
    ).rejects.toBeInstanceOf(AuthFailedError);
  });
});
