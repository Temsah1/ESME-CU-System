// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AuditLogItem, Committee, User } from '../types';
import {
  LEADERSHIP_AUDIT_PREFIX,
  POSITION_LABELS,
  isStaleWrite,
  leaderAccount,
  leadershipHistory,
  leadershipPostsOf,
  normalizeCommitteeRow,
  normalizeDraft,
  releaseLeadership,
  releasedSeats,
  rosterOf,
  unresolvedLeaders,
  validateCommitteeDraft,
  validateLeadershipAssignment,
  validateRosterMove,
  type CommitteeActor,
  type CommitteeInput,
} from './committees';

/**
 * The repair spec's verification list, written as tests: create, rename, full edit,
 * appoint, replace the Head, replace the Director, refuse a nonexistent account, refuse an
 * ineligible one, refuse an unauthorized actor, survive a reload, refuse a stale write, and
 * keep the leadership history correct after an account is removed.
 */

const SUPER: CommitteeActor = { role: 'super_admin', id: 'usr_superadmin' };
/** The capability matrix gives `committees.write` to a Director of the committee, not to a Head. */
const DIRECTOR_OF_TE: CommitteeActor = { role: 'director', id: 'usr_dir', committeeId: 'comm_te' };
const HEAD_OF_TE: CommitteeActor = { role: 'head', id: 'usr_head_te', committeeId: 'comm_te' };
const MEMBER: CommitteeActor = { role: 'member', id: 'usr_member' };

function user(patch: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'Person',
    email: `${patch.id}@esme.example`,
    username: patch.id ?? 'person',
    role: 'member',
    status: 'active',
    totalPoints: 0,
    approvedTasksCount: 0,
    joinedDate: '2026-01-01',
    lastActive: 'Just now',
    ...patch,
  };
}

function committee(patch: Partial<Committee> & Pick<Committee, 'id'>): Committee {
  return {
    name: `Committee ${patch.id}`,
    shortCode: `C${patch.id.slice(-1)}`.toUpperCase(),
    description: 'Mandate.',
    objectives: ['One objective'],
    subTeams: ['One sub-team'],
    isPublic: true,
    status: 'active',
    category: 'technical',
    ...patch,
  };
}

const USERS: User[] = [
  user({ id: 'u_dir', name: 'Dina Director', role: 'director', committeeId: 'comm_te' }),
  user({ id: 'u_head', name: 'Hassan Head', role: 'head', committeeId: 'comm_te' }),
  user({ id: 'u_member', name: 'Mona Member', committeeId: 'comm_te' }),
  user({ id: 'u_pending', name: 'Pia Pending', status: 'pending_approval', committeeId: 'comm_mc' }),
  user({ id: 'u_suspended', name: 'Sam Suspended', status: 'suspended' }),
  user({ id: 'u_other_lead', name: 'Ola Leads', committeeId: 'comm_mc' }),
];

const TE = committee({ id: 'comm_te', name: 'Technical & Engineering', shortCode: 'T&E', directorId: 'u_dir', headId: 'u_head' });
const MC = committee({ id: 'comm_mc', name: 'Media & Content', shortCode: 'M&C' });
const COMMITTEES: Committee[] = [TE, MC];

const assign = (input: Omit<Parameters<typeof validateLeadershipAssignment>[0], 'committees' | 'users'>) =>
  validateLeadershipAssignment({ committees: COMMITTEES, users: USERS, ...input });

describe('committee draft validation', () => {
  const base: CommitteeInput = {
    name: 'Human Resources Committee',
    shortCode: 'HR',
    description: 'Owns recruitment, culture and member evaluation.',
    objectives: ['Onboard every new member within two weeks'],
    subTeams: ['Recruitment', 'Internal Culture'],
    isPublic: true,
    status: 'active',
    category: 'management',
  };

  it('accepts a complete draft and normalizes its text', () => {
    const messy: CommitteeInput = {
      ...base,
      name: '  Human Resources Committee  ',
      shortCode: 'hr',
      description: '  Owns recruitment.  ',
      objectives: ['  First  ', '', '   '],
      subTeams: [' Recruitment ', ''],
    };
    expect(validateCommitteeDraft(messy, COMMITTEES)).toEqual([]);
    expect(normalizeDraft(messy)).toMatchObject({
      name: 'Human Resources Committee',
      shortCode: 'HR',
      description: 'Owns recruitment.',
      objectives: ['First'],
      subTeams: ['Recruitment'],
    });
  });

  it('refuses a name or acronym already used by another committee', () => {
    expect(validateCommitteeDraft({ ...base, name: 'technical & engineering', shortCode: 'ZZ' }, COMMITTEES)).toEqual([
      { field: 'name', message: expect.stringContaining('cannot share one identity') },
    ]);
    expect(validateCommitteeDraft({ ...base, shortCode: 't&e' }, COMMITTEES)).toEqual([
      { field: 'shortCode', message: expect.stringContaining('T&E already uses that acronym') },
    ]);
    // The row being edited is allowed to keep its own identity.
    expect(validateCommitteeDraft({ ...base, name: 'Technical & Engineering', shortCode: 'T&E' }, COMMITTEES, 'comm_te')).toEqual([]);
  });

  it('refuses an unusable acronym, an empty mandate and over-long lists', () => {
    const issues = validateCommitteeDraft(
      { ...base, shortCode: '!', description: '   ', objectives: Array.from({ length: 13 }, (_, i) => `o${i}`) },
      COMMITTEES
    );
    expect(issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['shortCode', 'description', 'objectives'])
    );
  });
});

describe('leadership assignment', () => {
  it('appoints an active account and says so in both directions', () => {
    expect(assign({ committeeId: 'comm_te', position: 'head', userId: 'u_member', actor: SUPER })).toEqual({ allowed: true });
  });

  it('replacing a seat names the person who loses it, never a cached string', () => {
    const before = leaderAccount(TE, 'head', USERS);
    expect(before?.name).toBe('Hassan Head');
    const replaced = committee({ ...TE, headId: 'u_member' });
    expect(leaderAccount(replaced, 'head', USERS)?.name).toBe('Mona Member');
  });

  it('refuses an account that does not exist', () => {
    expect(assign({ committeeId: 'comm_te', position: 'head', userId: 'usr_ghost', actor: SUPER })).toMatchObject({
      allowed: false,
      code: 'no_account',
    });
  });

  it.each([
    ['u_pending', 'pending approval'],
    ['u_suspended', 'suspended'],
  ])('refuses the ineligible account %s (%s)', (userId, label) => {
    const verdict = assign({ committeeId: 'comm_te', position: 'head', userId, actor: SUPER });
    expect(verdict).toMatchObject({ allowed: false, code: 'inactive' });
    expect(verdict.allowed ? '' : verdict.reason).toContain(label);
  });

  it('refuses one person holding both seats of one committee', () => {
    expect(assign({ committeeId: 'comm_te', position: 'head', userId: 'u_dir', actor: SUPER })).toMatchObject({
      allowed: false,
      code: 'double_seat',
    });
  });

  it('refuses a person who already leads another committee', () => {
    const leadsElsewhere = [...COMMITTEES, committee({ id: 'comm_op', name: 'Operations', shortCode: 'OPS', headId: 'u_other_lead' })];
    const verdict = validateLeadershipAssignment({
      committees: leadsElsewhere,
      users: USERS,
      committeeId: 'comm_te',
      position: 'head',
      userId: 'u_other_lead',
      actor: SUPER,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed ? '' : verdict.reason).toContain('Operations');
  });

  it('warns — but allows — an appointment that does not move the account’s membership', () => {
    const verdict = assign({ committeeId: 'comm_mc', position: 'head', userId: 'u_member', actor: SUPER });
    expect(verdict.allowed).toBe(true);
    expect(verdict.allowed ? verdict.warning : undefined).toContain('does not move their membership');
  });

  it('refuses an actor whose role does not reach this committee', () => {
    expect(assign({ committeeId: 'comm_te', position: 'head', userId: 'u_member', actor: MEMBER })).toMatchObject({
      allowed: false,
      code: 'forbidden',
    });
    // A Director of the committee may change its seats; the same person cannot reach
    // another committee, and a Head has no committees.write at all.
    expect(assign({ committeeId: 'comm_te', position: 'head', userId: 'u_member', actor: DIRECTOR_OF_TE }).allowed).toBe(true);
    expect(assign({ committeeId: 'comm_mc', position: 'head', userId: 'u_member', actor: DIRECTOR_OF_TE }).allowed).toBe(false);
    expect(assign({ committeeId: 'comm_te', position: 'head', userId: 'u_member', actor: HEAD_OF_TE }).allowed).toBe(false);
  });

  it('clears a seat without checking eligibility', () => {
    expect(assign({ committeeId: 'comm_te', position: 'head', userId: null, actor: DIRECTOR_OF_TE })).toEqual({ allowed: true });
  });

  it('reports an unresolvable id as an integrity finding, not as an empty seat', () => {
    const broken = committee({ id: 'comm_b', name: 'Broken', shortCode: 'BRK', directorId: 'usr_deleted' });
    expect(unresolvedLeaders(broken, USERS)).toEqual(['director']);
    expect(leaderAccount(broken, 'director', USERS)).toBeNull();
    expect(unresolvedLeaders(TE, USERS)).toEqual([]);
  });

  it('lists every committee an account leads', () => {
    const posts = leadershipPostsOf('u_dir', COMMITTEES);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ committee: { id: 'comm_te' }, position: 'director' });
  });
});

describe('roster moves', () => {
  const move = (userId: string, toCommitteeId: string | null, actor: CommitteeActor) =>
    validateRosterMove({ committees: COMMITTEES, users: USERS, userId, toCommitteeId, actor });

  it('moves a plain member between committees', () => {
    expect(move('u_member', 'comm_mc', SUPER).allowed).toBe(true);
    expect(rosterOf('comm_te', USERS)).toHaveLength(3);
  });

  it('refuses to move an account that leads another committee', () => {
    const verdict = move('u_dir', 'comm_mc', SUPER);
    expect(verdict.allowed).toBe(false);
    expect(verdict.allowed ? '' : verdict.reason).toContain('Reassign the seat first');
  });

  it('refuses to give a non-active account a committee home', () => {
    expect(move('u_pending', 'comm_te', SUPER)).toMatchObject({ allowed: false, code: 'inactive' });
  });

  it('refuses an actor who cannot reach the account', () => {
    expect(move('u_member', 'comm_mc', MEMBER).allowed).toBe(false);
  });
});

describe('removing an account from the roster', () => {
  it('vacates every seat it held and nothing else changes', () => {
    const seats = releasedSeats(COMMITTEES, 'u_dir');
    expect(seats).toEqual([{ committeeId: 'comm_te', position: 'director' }]);

    const after = releaseLeadership(COMMITTEES, 'u_dir');
    expect(after.find((c) => c.id === 'comm_te')?.directorId).toBeUndefined();
    expect(after.find((c) => c.id === 'comm_te')?.headId).toBe('u_head');
    expect(after.find((c) => c.id === 'comm_te')?.name).toBe(TE.name);
    // The person who is gone is no longer reported as an unresolved leader: the seat is empty.
    expect(unresolvedLeaders(after[0], USERS)).toEqual([]);
  });

  it('keeps history readable after the account is gone', () => {
    const audit: AuditLogItem[] = [
      {
        id: 'a1',
        actorId: 'usr_superadmin',
        actorName: 'Kareem Tamer',
        actorRole: 'super_admin',
        action: `${LEADERSHIP_AUDIT_PREFIX} Assigned`,
        targetType: 'committee',
        targetId: 'comm_te',
        details: 'Director Nour assigned (previous: Dina Director)',
        timestamp: '2026-10-01 09:00',
      },
      {
        id: 'a2',
        actorId: 'usr_superadmin',
        actorName: 'Kareem Tamer',
        actorRole: 'super_admin',
        action: 'Updated User Profile',
        targetType: 'user',
        targetId: 'u_dir',
        details: 'Modified fields: department',
        timestamp: '2026-10-02 09:00',
      },
      {
        id: 'a3',
        actorId: 'usr_head_te',
        actorName: 'Hassan Head',
        actorRole: 'head',
        action: `${LEADERSHIP_AUDIT_PREFIX} Cleared`,
        targetType: 'committee',
        targetId: 'comm_mc',
        details: 'Head seat cleared',
        timestamp: '2026-10-03 09:00',
      },
    ];
    const history = leadershipHistory(audit, 'comm_te');
    expect(history.map((h) => h.id)).toEqual(['a1']);
    expect(POSITION_LABELS.director).toBe('Director');
  });
});

describe('concurrent writes', () => {
  it('refuses a write whose row changed underneath it, and accepts a matching stamp', () => {
    const stored = committee({ id: 'comm_te', updatedAt: '2026-10-10 08:00' });
    expect(isStaleWrite(stored, '2026-10-10 08:00')).toBe(false);
    expect(isStaleWrite(stored, '2026-10-09 12:00')).toBe(true);
    // Rows written before stamps existed are accepted once, then stamped forever.
    expect(isStaleWrite(committee({ id: 'comm_old' }), undefined)).toBe(false);
  });
});

describe('a stored row read back after a reload', () => {
  it('drops the cached leader names that made renames invisible', () => {
    const legacy = {
      id: 'comm_te',
      name: 'Technical & Engineering',
      shortCode: 'T&E',
      description: 'Mandate.',
      objectives: ['One'],
      subTeams: ['Two'],
      isPublic: true,
      status: 'active',
      category: 'technical',
      directorId: 'u_dir',
      headId: 'u_head',
      directorName: 'Someone Who Left',
      headName: 'Also Stale',
    };
    const row = normalizeCommitteeRow(legacy) as Committee;
    expect(row).not.toHaveProperty('directorName');
    expect(row).not.toHaveProperty('headName');
    expect(row.directorId).toBe('u_dir');
    // The name the reader shows comes from the account, so it is current, not cached.
    expect(leaderAccount(row, 'director', USERS)?.name).toBe('Dina Director');
  });

  it('keeps an unresolvable id so the gap can be reported', () => {
    const row = normalizeCommitteeRow({ id: 'comm_x', directorId: 'usr_deleted' }) as Committee;
    expect(row.directorId).toBe('usr_deleted');
    expect(unresolvedLeaders(row, USERS)).toEqual(['director']);
  });

  it('coerces damaged values instead of trusting them', () => {
    const row = normalizeCommitteeRow({
      id: 'comm_y',
      name: 42,
      objectives: 'not a list',
      subTeams: [null, 'Real', ''],
      isPublic: false,
      status: 'archived',
      category: 'nonsense',
    }) as Committee;
    expect(row.name).toBe('');
    expect(row.objectives).toEqual([]);
    expect(row.subTeams).toEqual(['Real']);
    expect(row.isPublic).toBe(false);
    expect(row.status).toBe('archived');
    expect(row.category).toBe('technical');
  });

  it('refuses a row with no identity at all', () => {
    expect(normalizeCommitteeRow(null)).toBeNull();
    expect(normalizeCommitteeRow('committees')).toBeNull();
    expect(normalizeCommitteeRow({ name: 'No id' })).toBeNull();
  });
});
