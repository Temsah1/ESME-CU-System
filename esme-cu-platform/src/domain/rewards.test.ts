/**
 * The bonus and warning rules, tested where they are decided. Every case below is a request that
 * could arrive from a form, a replayed click or a hand-made call, and each one has to land on the
 * same answer the server gives: the actor's role and reach are checked before the record's shape,
 * and a correction is always a second entry.
 */
import { describe, expect, it } from 'vitest';
import type { User } from '../types';
import {
  DEFAULT_REWARD_POLICY,
  activeWarningsOf,
  applyReversal,
  bonusPointsOf,
  entriesInPeriod,
  escalationRecipients,
  findByIdempotencyKey,
  isSafeEvidenceUrl,
  validatePolicyEdit,
  validateRewardAction,
  warningNumberAfter,
  type RewardEntry,
  type RewardPolicy,
  type WarningSeverity,
} from './rewards';

const NOW = '2026-10-19T12:00:00.000Z';

const person = (over: Partial<User> = {}): User => ({
  id: 'usr_nada',
  name: 'Nada Yehia',
  email: 'nada@esme.test',
  username: 'nada',
  role: 'member',
  committeeId: 'comm_te',
  status: 'active',
  totalPoints: 40,
  approvedTasksCount: 2,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
  ...over,
});

const admin = person({ id: 'usr_admin', name: 'Kareem Tamer', username: 'temsah1', email: 'kareem.tamer@example.test', role: 'super_admin', committeeId: undefined });
const board = person({ id: 'usr_board', name: 'Salma Reda', username: 'salma', email: 'salma@esme.test', role: 'high_board', committeeId: undefined });
const director = person({ id: 'usr_dir', name: 'Omar Director', username: 'omar', email: 'omar@esme.test', role: 'director', committeeId: 'comm_te' });
const head = person({ id: 'usr_head', name: 'May Head', username: 'may', email: 'may@esme.test', role: 'head', committeeId: 'comm_te', subTeam: 'NDT' });
const member = person();

const actorOf = (u: User) => ({ id: u.id, role: u.role, committeeId: u.committeeId, subTeam: u.subTeam });

const attempt = (over: Partial<Parameters<typeof validateRewardAction>[0]> = {}) =>
  validateRewardAction({
    kind: 'bonus',
    actor: actorOf(admin),
    target: member,
    points: 10,
    severity: 'notice',
    reason: 'Ran the NDT workshop for the first-year cohort',
    policy: DEFAULT_REWARD_POLICY,
    entries: [],
    now: NOW,
    ...over,
  });

const bonus = (over: Partial<RewardEntry> = {}): RewardEntry => ({
  id: over.id ?? 'rew_bonus_1',
  kind: 'bonus',
  actorId: director.id,
  actorName: director.name,
  actorRole: 'director',
  targetId: member.id,
  targetName: member.name,
  targetRoleAtTime: 'member',
  committeeId: member.committeeId,
  points: 10,
  reason: 'Delivered the brief early',
  issuedAt: '2026-10-10T09:00:00.000Z',
  status: 'active',
  idempotencyKey: `bonus:${over.id ?? 'rew_bonus_1'}`,
  ...over,
});

const warning = (over: Partial<RewardEntry> = {}): RewardEntry => ({
  id: over.id ?? 'rew_warn_1',
  kind: 'warning',
  actorId: director.id,
  actorName: director.name,
  actorRole: 'director',
  targetId: member.id,
  targetName: member.name,
  targetRoleAtTime: 'member',
  committeeId: member.committeeId,
  points: 0,
  severity: 'notice',
  reason: 'Missed the committee meeting without notice',
  issuedAt: '2026-10-11T09:00:00.000Z',
  status: 'active',
  idempotencyKey: `warning:${over.id ?? 'rew_warn_1'}`,
  ...over,
});

describe('who may record a bonus or a warning', () => {
  it('refuses an account whose role holds no rewards capability', () => {
    const decision = attempt({ actor: actorOf(member), target: person({ id: 'usr_other', name: 'Someone Else' }) });
    expect(decision).toMatchObject({ allowed: false, code: 'forbidden' });
  });

  it('refuses a moderator, because the capability and the matrix are two different grants', () => {
    const moderator = person({ id: 'usr_mod', name: 'IT Moderator', username: 'mod', email: 'mod@esme.test', role: 'moderator', committeeId: 'comm_te' });
    // `rewards.write` is not granted to a moderator at all, so the capability answers first.
    expect(attempt({ actor: actorOf(moderator) })).toMatchObject({ allowed: false, code: 'forbidden' });
  });

  it('refuses a role the permission matrix switched off, even though it holds the capability', () => {
    const policy: RewardPolicy = { ...DEFAULT_REWARD_POLICY, canAwardBonus: ['director', 'high_board', 'super_admin'] };
    expect(attempt({ actor: actorOf(head), policy })).toMatchObject({ allowed: false, code: 'policy_disabled' });
  });

  it('lets a member read their own record but never write one', () => {
    expect(attempt({ actor: actorOf(member), target: member })).toMatchObject({ allowed: false, code: 'forbidden' });
  });

  it('refuses an action that is outside the actor\'s committee reach', () => {
    const other = person({ id: 'usr_mc', committeeId: 'comm_mc', name: 'Media Member' });
    // The capability scope answers first: a Director's reach is their own committee's records.
    expect(attempt({ actor: actorOf(director), target: other })).toMatchObject({ allowed: false, code: 'forbidden' });
    // An account with no committee passes the scope test, so the role rule is what stops it.
    expect(attempt({ actor: actorOf(director), target: person({ id: 'usr_none', committeeId: undefined, name: 'Unassigned' }) })).toMatchObject({
      allowed: false,
      code: 'outside_committee',
    });
  });

  it('stops a Head at the edge of their own sub-team', () => {
    const elsewhere = person({ id: 'usr_other', subTeam: 'Roadmap' });
    expect(attempt({ actor: actorOf(head), target: elsewhere })).toMatchObject({ allowed: false, code: 'outside_team' });
  });

  it('refuses a self-issued entry whoever asks', () => {
    expect(attempt({ actor: actorOf(director), target: director })).toMatchObject({ allowed: false, code: 'self_target' });
    expect(attempt({ actor: actorOf(admin), target: admin })).toMatchObject({ allowed: false, code: 'self_target' });
  });

  it('protects the primary Super Admin account from discipline by a superior-free path', () => {
    expect(attempt({ actor: actorOf(board), target: admin, targetIsPrimaryAdmin: true })).toMatchObject({ allowed: false, code: 'protected' });
    // Without that flag the rank rule still stops a board member from touching an administrator.
    expect(attempt({ actor: actorOf(board), target: admin })).toMatchObject({ allowed: false, code: 'above_rank' });
  });

  it('refuses an action aimed at an equal or a superior, and allows one aimed downward', () => {
    expect(attempt({ actor: actorOf(head), target: director })).toMatchObject({ allowed: false, code: 'above_rank' });
    expect(attempt({ actor: actorOf(director), target: head })).toMatchObject({ allowed: true });
    expect(attempt({ actor: actorOf(head), target: person({ id: 'usr_peer', role: 'head', committeeId: 'comm_te', subTeam: 'NDT' }) })).toMatchObject({
      allowed: false,
      code: 'above_rank',
    });
    // A High Board sits above the committee ladder, so board-to-board is a peer action.
    expect(attempt({ actor: actorOf(board), target: person({ id: 'usr_board2', role: 'high_board', committeeId: undefined }) })).toMatchObject({
      allowed: false,
      code: 'above_rank',
    });
    expect(attempt({ actor: actorOf(admin), target: person({ id: 'usr_sa', name: 'Second Admin', username: 'sa', email: 'sa@esme.test', role: 'super_admin', committeeId: undefined }) })).toMatchObject({
      allowed: true,
    });
  });

  it('refuses an account that is not active and one that is not in the directory', () => {
    expect(attempt({ target: person({ status: 'suspended' }) })).toMatchObject({ allowed: false, code: 'inactive_target' });
    expect(attempt({ target: null })).toMatchObject({ allowed: false, code: 'no_target' });
  });
});

describe('the shape of the entry', () => {
  it('requires a reason and keeps it short', () => {
    expect(attempt({ reason: '   ' })).toMatchObject({ allowed: false, code: 'no_reason' });
    expect(attempt({ reason: 'x'.repeat(401) })).toMatchObject({ allowed: false, code: 'reason_length' });
  });

  it('accepts only an http(s) evidence link', () => {
    expect(isSafeEvidenceUrl('https://drive.esme.test/brief.pdf')).toBe(true);
    expect(isSafeEvidenceUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeEvidenceUrl('not a link')).toBe(false);
    expect(attempt({ evidenceUrl: 'javascript:alert(1)' })).toMatchObject({ allowed: false, code: 'evidence_url' });
    expect(attempt({ evidenceUrl: '   ' })).toMatchObject({ allowed: true });
  });

  it('wants a whole positive number of points for a bonus', () => {
    expect(attempt({ points: 0 })).toMatchObject({ allowed: false, code: 'bad_points' });
    expect(attempt({ points: -10 })).toMatchObject({ allowed: false, code: 'bad_points' });
    expect(attempt({ points: 7.5 })).toMatchObject({ allowed: false, code: 'bad_points' });
  });

  it('honours the per-action cap and the period ceiling from the matrix', () => {
    expect(attempt({ points: 26 })).toMatchObject({ allowed: false, code: 'over_action_cap' });

    const stacked = [bonus({ id: 'b1', points: 30, issuedAt: NOW }), bonus({ id: 'b2', points: 40, issuedAt: NOW }), bonus({ id: 'b3', points: 25, issuedAt: NOW })];
    const decision = attempt({ points: 10, entries: stacked });
    expect(decision).toMatchObject({ allowed: false, code: 'over_period_cap' });
    if (decision.allowed === false) expect(decision.reason).toContain('95 bonus points');
  });

  it('leaves a reversed entry out of the ceiling it would otherwise hit', () => {
    const reversed = bonus({ id: 'b1', points: 90, status: 'reversed' });
    expect(attempt({ points: 25, entries: [reversed] })).toMatchObject({ allowed: true });
  });

  it('warns — without blocking — after several bonuses in one window', () => {
    const five = [1, 2, 3, 4, 5].map((n) => bonus({ id: `b${n}`, points: 3, issuedAt: NOW }));
    const decision = attempt({ points: 3, entries: five });
    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.warning).toContain('5 bonuses');
  });

  it('requires a severity for a warning and moves no points with it', () => {
    expect(attempt({ kind: 'warning', severity: undefined, points: 0 })).toMatchObject({ allowed: false, code: 'bad_severity' });
    expect(attempt({ kind: 'warning', severity: 'formal' as WarningSeverity, points: 0 })).toMatchObject({ allowed: true });
  });

  it('announces the escalation before the warning is written, not after', () => {
    const two = [warning({ id: 'w1', issuedAt: NOW }), warning({ id: 'w2', issuedAt: NOW })];
    const decision = attempt({ kind: 'warning', points: 0, entries: two });
    expect(decision.allowed).toBe(true);
    expect(decision.allowed && decision.warning).toMatch(/warning 3 in 90 days/);
    expect(decision.allowed && decision.warning).toContain('Director');
    expect(warningNumberAfter(two, member.id, DEFAULT_REWARD_POLICY, NOW)).toBe(3);
  });
});

describe('the window, the ledger and the reversal', () => {
  it('measures the rolling window backwards and ignores other members', () => {
    const inside = warning({ id: 'w_in', issuedAt: '2026-09-01T00:00:00.000Z' });
    const outside = warning({ id: 'w_out', issuedAt: '2026-01-01T00:00:00.000Z' });
    const otherMember = warning({ id: 'w_other', issuedAt: NOW, targetId: 'usr_other' });
    const rows = entriesInPeriod([inside, outside, otherMember], member.id, 'warning', 90, NOW);
    expect(rows.map((e) => e.id)).toEqual(['w_in']);
  });

  it('collapses a replayed action onto the entry that already exists', () => {
    const written = bonus({ id: 'rew_x' });
    expect(findByIdempotencyKey([written], 'bonus:rew_x')).toBe(written);
    expect(findByIdempotencyKey([written], 'bonus:something_else')).toBeUndefined();
  });

  it('sums standing bonuses and lists standing warnings', () => {
    const rows = [
      bonus({ id: 'b1', points: 10 }),
      bonus({ id: 'b2', points: 25, status: 'reversed' }),
      warning({ id: 'w1' }),
      warning({ id: 'w2', status: 'reversed' }),
    ];
    expect(bonusPointsOf(rows, member.id)).toBe(10);
    expect(activeWarningsOf(rows, member.id).map((e) => e.id)).toEqual(['w1']);
  });

  it('does not count the withdrawal of a warning as another warning', () => {
    const withdrawn = warning({ id: 'w1', status: 'reversed', reversedByEntryId: 'w1_r' });
    const withdrawal = { ...withdrawn, id: 'w1_r', status: 'active' as const, reversedByEntryId: 'w1' };
    const rows = [withdrawn, withdrawal];
    expect(entriesInPeriod(rows, member.id, 'warning', 90, NOW)).toEqual([]);
    expect(activeWarningsOf(rows, member.id)).toEqual([]);
    expect(warningNumberAfter(rows, member.id, DEFAULT_REWARD_POLICY, NOW)).toBe(1);
    expect(escalationRecipients([warning({ id: 'a', issuedAt: NOW }), warning({ id: 'b', issuedAt: NOW }), withdrawn, withdrawal], DEFAULT_REWARD_POLICY, member, NOW)).toEqual([]);
  });

  it('reverses by appending, and points the original at the entry that undid it', () => {
    const original = bonus({ id: 'b1', points: 20 });
    const reversal: RewardEntry = {
      ...original,
      id: 'b1_r',
      points: -20,
      reason: 'Awarded twice for the same deliverable',
      issuedAt: NOW,
      status: 'active',
      reversedByEntryId: 'b1',
      idempotencyKey: 'reverse:b1:b1_r',
    };
    const after = applyReversal([original], reversal);
    expect(after).toHaveLength(2);
    expect(after.find((e) => e.id === 'b1')).toMatchObject({ status: 'reversed', reversedByEntryId: 'b1_r' });
    expect(after.find((e) => e.id === 'b1_r')).toMatchObject({ points: -20, status: 'active', reversedByEntryId: 'b1' });
    expect(after.find((e) => e.id === 'b1')!.reason).toBe('Delivered the brief early');
  });

  it('refuses a reversal that would edit history instead of adding to it', () => {
    const original = bonus({ id: 'b1', points: 20 });
    const against = (over: Partial<RewardEntry> = {}) => ({ ...original, id: 'x', points: -20, reversedByEntryId: 'b1', ...over });
    expect(() => applyReversal([original], { ...against(), reversedByEntryId: 'nope' })).toThrow(/does not exist/);
    expect(() => applyReversal([{ ...original, status: 'reversed' }], against())).toThrow(/already been reversed/);
    expect(() => applyReversal([original], against({ points: 20 }))).toThrow(/negative/);
    expect(() => applyReversal([warning({ id: 'w1' })], { ...against(), reversedByEntryId: 'w1', kind: 'bonus' })).toThrow(/one kind/);
    expect(() => applyReversal([warning({ id: 'w1' })], { ...against(), reversedByEntryId: 'w1', kind: 'warning', points: 5 })).toThrow(/carries no points/);
  });

  it('names the officers an escalation must reach, and nobody before the threshold', () => {
    expect(escalationRecipients([], DEFAULT_REWARD_POLICY, member, NOW)).toEqual([]);
    const three = [1, 2, 3].map((n) => warning({ id: `w${n}`, issuedAt: NOW }));
    expect(escalationRecipients(three, DEFAULT_REWARD_POLICY, member, NOW)).toEqual([
      { role: 'director', committeeId: 'comm_te' },
      { role: 'high_board', committeeId: undefined },
    ]);
  });
});

describe('the permission matrix has limits of its own', () => {
  it('refuses caps, windows and thresholds that would make the control meaningless', () => {
    const errors = validatePolicyEdit({
      ...DEFAULT_REWARD_POLICY,
      maxBonusPointsPerAction: 0,
      periodDays: 3,
      escalateWarningsAfter: 0,
      canAwardBonus: [],
    });
    expect(errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['maxBonusPointsPerAction', 'periodDays', 'escalateWarningsAfter', 'canAwardBonus'])
    );
  });

  it('refuses a period ceiling that cannot fit three ordinary bonuses', () => {
    expect(validatePolicyEdit({ ...DEFAULT_REWARD_POLICY, maxBonusPointsPerAction: 50, maxBonusPointsPerMemberPerPeriod: 40 }).map((e) => e.field)).toContain(
      'maxBonusPointsPerMemberPerPeriod'
    );
    const errors = validatePolicyEdit({ ...DEFAULT_REWARD_POLICY, maxBonusPointsPerAction: 50, maxBonusPointsPerMemberPerPeriod: 60 });
    expect(errors.find((e) => e.field === 'maxBonusPointsPerMemberPerPeriod')?.message).toContain('three ordinary bonuses');
  });

  it('refuses a warning-only role and an escalation that tells nobody', () => {
    expect(
      validatePolicyEdit({ ...DEFAULT_REWARD_POLICY, canAwardBonus: ['super_admin'], canIssueWarning: ['head', 'super_admin'] }).map((e) => e.field)
    ).toContain('canIssueWarning');
    expect(validatePolicyEdit({ ...DEFAULT_REWARD_POLICY, notifyRolesOnEscalation: [] }).map((e) => e.field)).toContain('notifyRolesOnEscalation');
  });

  it('accepts the shipped default, so a clean install is not refusing its own settings', () => {
    expect(validatePolicyEdit(DEFAULT_REWARD_POLICY)).toEqual([]);
  });
});
