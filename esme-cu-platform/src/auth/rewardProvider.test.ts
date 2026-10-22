// @vitest-environment node
/**
 * The reward write path against a **stubbed** provider — not a PostgreSQL session. No database has
 * executed these statements, so what these tests prove is the client half of the contract: which
 * function the browser calls, with which argument names, what it does with the row that comes back,
 * and that a refusal or a missing schema is reported as a refusal rather than as a success.
 *
 * The other half — that `esme_award_bonus()` actually re-decides the cap, the rank and the scope
 * inside the database, and that `esme_reward_entries` refuses a direct insert — is 0006's own claim,
 * checked statically by supabase/migrations/migrationIntegrity.test.ts and still to be run against a
 * real project. See docs/TESTING.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RewardEntry } from '../domain/rewards';

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  vi.resetModules();
  // A syntactically valid publishable key. Nothing here reaches a network: the client is the stub
  // below, and these two values only have to pass configurationProblems() before it is built.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAAAA_AAAAAAA');
});

async function adapter() {
  const mod = await import('./supabaseAdapter');
  return mod.createSupabaseAdapter();
}

/** A row of `esme_reward_entries` in the column names 0006 creates. */
const bonusRow = {
  id: '3f1a2b4c-5d6e-7f80-91a2-b3c4d5e6f708',
  kind: 'bonus',
  actor_id: '11111111-1111-1111-1111-111111111111',
  actor_role: 'high_board',
  target_id: '22222222-2222-2222-2222-222222222222',
  target_role_at_time: 'member',
  committee_id: '33333333-3333-3333-3333-333333333333',
  points: 15,
  severity: null,
  reason: 'Ran the NDT workshop',
  evidence_url: null,
  issued_at: '2026-10-22T09:00:00+00:00',
  status: 'active',
  reversed_by_entry_id: null,
  score_ledger_id: '3f1a2b4c-5d6e-7f80-91a2-b3c4d5e6f708',
  acknowledged_at: null,
  acknowledged_by: null,
  idempotency_key: 'bonus:abc',
};

describe('the bonus write reaches the function that decides it', () => {
  it('calls esme_award_bonus with the target, the number, the reason and the key', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) }, rpc }),
    }));
    rpc.mockResolvedValue({ data: bonusRow, error: null });

    const result = await (
      await adapter()
    ).awardBonus({
      targetId: bonusRow.target_id,
      points: 15,
      reason: 'Ran the NDT workshop',
      idempotencyKey: 'bonus:abc',
      targetRole: 'member',
      targetCommitteeId: bonusRow.committee_id,
    });

    // The names matter as much as the call: PostgREST matches a JSON body to the function's
    // parameters, so one misspelled p_ argument is a 404 that looks like a refused action.
    expect(rpc).toHaveBeenCalledWith('esme_award_bonus', {
      p_target: bonusRow.target_id,
      p_points: 15,
      p_reason: 'Ran the NDT workshop',
      p_evidence_url: null,
      p_idempotency_key: 'bonus:abc',
    });
    expect(result).toEqual({
      ok: true,
      receipt: {
        id: bonusRow.id,
        kind: 'bonus',
        actorId: bonusRow.actor_id,
        actorRole: 'high_board',
        targetId: bonusRow.target_id,
        targetRoleAtTime: 'member',
        committeeId: bonusRow.committee_id,
        points: 15,
        severity: undefined,
        reason: 'Ran the NDT workshop',
        evidenceUrl: undefined,
        issuedAt: '2026-10-22T09:00:00+00:00',
        status: 'active',
        reversedByEntryId: undefined,
        idempotencyKey: 'bonus:abc',
      },
    });
    // The row the database wrote, not the role the caller asserted: the caller said nothing about
    // who filed it, and the receipt answers for the session the JWT carries.
    expect(result.ok && result.receipt.actorRole).toBe('high_board');
  });

  it('hands a raised ESME_ guard back as a refusal that names the rule', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) }, rpc }),
    }));
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'ESME_OVER_ACTION_CAP: the limit is 25 points per action', code: 'P0001' },
    });

    const result = await (
      await adapter()
    ).awardBonus({ targetId: bonusRow.target_id, points: 40, reason: 'Above the cap', idempotencyKey: 'bonus:cap', targetRole: 'member' });

    expect(result).toEqual({
      ok: false,
      error: { code: 'esme_over_action_cap', message: 'ESME_OVER_ACTION_CAP: the limit is 25 points per action' },
    });
  });

  it('says what is missing when the ledger has no schema yet, instead of a generic failure', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) }, rpc }),
    }));
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.esme_award_bonus(p_target, p_points, p_reason, p_evidence_url, p_idempotency_key) in the schema cache", code: 'PGRST202' },
    });

    const result = await (
      await adapter()
    ).awardBonus({ targetId: bonusRow.target_id, points: 5, reason: 'Helped at the career fair', idempotencyKey: 'k', targetRole: 'member' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('schema_missing');
      // An operator has to be able to act on the message without reading the source.
      expect(result.error.message).toContain('0006_rewards_discipline.sql');
    }
  });

  it('treats a function that filed nothing as a failure, not as an empty success', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) }, rpc }),
    }));
    rpc.mockResolvedValue({ data: null, error: null });

    const result = await (
      await adapter()
    ).issueWarning({ targetId: bonusRow.target_id, severity: 'formal', reason: 'Two deadlines missed', idempotencyKey: 'w:1', targetRole: 'member' });
    expect(result.ok).toBe(false);
  });
});

describe('the rest of the reward write surface', () => {
  const clientStub = () => ({ auth: { getSession: async () => ({ data: { session: null } }) }, rpc });

  it('reverses by entry id alone, so the caller cannot restate what it corrects', async () => {
    vi.doMock('@supabase/supabase-js', () => ({ createClient: clientStub }));
    rpc.mockResolvedValue({ data: { ...bonusRow, id: 'reversal-1', points: -15, reversed_by_entry_id: bonusRow.id }, error: null });

    await (
      await adapter()
    ).reverseRewardEntry({
      entryId: bonusRow.id,
      reason: 'Paid for the same deliverable twice',
      original: {
        id: bonusRow.id,
        kind: 'bonus',
        actorId: bonusRow.actor_id,
        actorName: 'Somebody',
        actorRole: 'high_board',
        targetId: bonusRow.target_id,
        targetName: 'Somebody else',
        targetRoleAtTime: 'member',
        points: 999,
        reason: 'A reason the server will never see',
        issuedAt: '2026-01-01T00:00:00.000Z',
        status: 'active',
        idempotencyKey: 'bonus:abc',
      },
    });

    expect(rpc).toHaveBeenCalledWith('esme_reverse_reward_entry', {
      p_entry: bonusRow.id,
      p_reason: 'Paid for the same deliverable twice',
    });
  });

  it('acknowledges a warning through its own function', async () => {
    vi.doMock('@supabase/supabase-js', () => ({ createClient: clientStub }));
    rpc.mockResolvedValue({ data: null, error: null });

    const warning: RewardEntry = {
      id: bonusRow.id,
      kind: 'warning',
      actorId: bonusRow.actor_id,
      actorName: 'Omar Director',
      actorRole: 'director',
      targetId: bonusRow.target_id,
      targetName: 'Nada Yehia',
      targetRoleAtTime: 'member',
      committeeId: bonusRow.committee_id,
      points: 0,
      severity: 'notice',
      reason: 'Missed the committee meeting',
      issuedAt: '2026-10-22T09:00:00+00:00',
      status: 'active',
      idempotencyKey: 'warn:1',
    };
    const ok = await (await adapter()).acknowledgeWarning(warning);

    expect(rpc).toHaveBeenCalledWith('esme_acknowledge_warning', { p_entry: bonusRow.id });
    expect(ok).toEqual({ ok: true });
  });

  it('refuses to build a client at all when the environment holds a secret key', async () => {
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_secret_AbCdEfGhIjKlMnOpQrStUv');
    vi.doMock('@supabase/supabase-js', () => ({ createClient: clientStub }));

    await expect(
      (await adapter()).awardBonus({ targetId: bonusRow.target_id, points: 5, reason: 'Anything', idempotencyKey: 'k', targetRole: 'member' })
    ).rejects.toThrow(/service-role|secret|https|project root/i);
    // Refusing to connect is not the same as filing nothing: no request was made at all.
    expect(rpc).not.toHaveBeenCalled();
  });
});
