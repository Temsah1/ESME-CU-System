// @vitest-environment node
/**
 * The client half of the registration decision, against a **stubbed** PostgREST surface.
 *
 * `esme_decide_registration(p_request_id)` locks `esme_registration_requests` by that id, so the
 * only thing this test has to prove is which value the browser sends and how a refusal is
 * reported. The database half — that the id is really a queue row and that a second reviewer
 * cannot decide the same row twice — is 0002's own claim, checked statically by
 * supabase/migrations/migrationIntegrity.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const order = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  order.mockReset();
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_publishable_AAAAAAAAAAAAAAAAAAAAAAAA_AAAAAAA');
});

async function adapter() {
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc,
      from: () => ({ select: () => ({ order }) }),
    }),
  }));
  const mod = await import('./supabaseAdapter');
  return mod.createSupabaseAdapter();
}

const queueRow = {
  id: '9f1c0c4e-0000-4000-8000-00000000req1',
  profile_id: '2ab70000-0000-4000-8000-00000000user',
  full_name: 'Mona Adel',
  email: 'mona.adel@example.test',
  username: 'mona.adel',
  requested_committee_id: 'comm_te',
  assigned_committee_id: null,
  submitted_at: '2026-10-20T09:00:00+00:00',
  status: 'pending_approval',
  decided_by_name: null,
  decided_at: null,
  rejection_reason: null,
  technical_skills: 'AutoCAD',
  previous_experience: '',
  motivation: 'Wants to join the technical committee',
  availability_hours: '8',
  agreed_to_policies: true,
};

describe('the queue read keeps the request id and the profile id apart', () => {
  it('maps both identities from the row', async () => {
    order.mockResolvedValue({ data: [queueRow], error: null });
    const records = await (await adapter()).listRegistrations();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(queueRow.id);
    expect(records[0].profileId).toBe(queueRow.profile_id);
  });
});

describe('the decision names the row it was given', () => {
  it('sends p_request_id as the queue row id', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const result = await (await adapter()).decideRegistration(queueRow.id, 'approve', {
      reason: 'Welcome aboard',
      committeeId: 'comm_te',
    });
    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('esme_decide_registration', {
      p_request_id: queueRow.id,
      p_decision: 'approve',
      p_reason: 'Welcome aboard',
      p_committee_id: 'comm_te',
    });
  });

  it('refuses an empty target without reaching the provider', async () => {
    const result = await (await adapter()).decideRegistration('', 'reject');
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('turns a vanished row into refresh guidance instead of the raw ESME code', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'ESME_NOT_FOUND: registration request', code: 'P0001' },
    });
    const result = await (await adapter()).decideRegistration(queueRow.id, 'approve');
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.message).toMatch(/no longer in the queue/i);
    expect(result.error.message).toMatch(/refresh/i);
    expect(result.error.message).not.toContain('ESME_NOT_FOUND');
  });

  it('turns a row another reviewer already decided into refresh guidance', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'ESME_ALREADY_DECIDED: request 9f1c is active', code: 'P0001' },
    });
    const result = await (await adapter()).decideRegistration(queueRow.id, 'reject');
    expect(result).toMatchObject({ ok: false, error: { code: 'already_decided' } });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.message).toMatch(/already decided/i);
    expect(result.error.message).not.toContain('ESME_ALREADY_DECIDED');
  });
});
