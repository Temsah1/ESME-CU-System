/**
 * The HR Manager role, tested where permissions are decided.
 *
 * Two promises, in this order of importance:
 *   1. the six roles that shipped before this one still hold exactly the grants they held — the
 *      snapshot below is the matrix as it stood at commit ba2698f, not a re-typing of the current
 *      file, so a drift inside `director` or `member` fails here even though nothing else would
 *      notice; and
 *   2. the new role gets exactly the people-operations grants and nothing else.
 *
 * The UI guard and the provider guard both read this matrix (src/auth/guards.tsx and
 * supabase/migrations/0021_hr_manager_role.sql), so a row proven here is proven at both layers —
 * except where the SQL is checked by migrationIntegrity.test.ts instead.
 */
import { describe, expect, it } from 'vitest';
import type { Role, User } from '../types';
import { visibleTo } from './actions';
import { DEFAULT_REWARD_POLICY, mayOfferReward } from './rewards';
import {
  ALL_ROLES,
  PRIVILEGED_ROLES,
  ROLE_LABELS,
  ROLE_RANK,
  canActOn,
  capabilitiesFor,
  hasCapability,
  scopeFor,
  validateRoleChange,
} from './roles';

/** `capability=scope` for every role, sorted, as of the commit before HR Manager existed. */
const MATRIX_BEFORE_HR_ROLE: Record<string, string[]> = {
  super_admin: [
    'analytics.configure=all',
    'audit.read=all',
    'backups.manage=all',
    'cms.content.publish=all',
    'cms.content.write=all',
    'cms.media.manage=all',
    'cms.settings.global=all',
    'committees.archive=all',
    'committees.read=all',
    'committees.write=all',
    'events.read=all',
    'events.write=all',
    'integrations.manage=all',
    'notifications.manage=all',
    'registrations.decide=all',
    'registrations.read=all',
    'rewards.configure=all',
    'rewards.read=all',
    'rewards.write=all',
    'scores.adjust=all',
    'scores.read=all',
    'settings.manage=all',
    'skills.manage=all',
    'skills.read=all',
    'submissions.create=self',
    'submissions.read=all',
    'submissions.review=all',
    'tasks.assign=all',
    'tasks.delete=all',
    'tasks.read=all',
    'tasks.write=all',
    'users.create=all',
    'users.delete=all',
    'users.read=all',
    'users.role.assign=all',
    'users.suspend=all',
    'users.update=all',
  ],
  high_board: [
    'analytics.configure=all',
    'audit.read=all',
    'cms.content.publish=all',
    'cms.content.write=all',
    'cms.media.manage=all',
    'cms.settings.global=all',
    'committees.read=all',
    'events.read=all',
    'events.write=all',
    'notifications.manage=all',
    'registrations.read=all',
    'rewards.read=all',
    'rewards.write=all',
    'scores.read=all',
    'skills.read=all',
    'submissions.read=all',
    'submissions.review=all',
    'tasks.read=all',
    'users.read=all',
  ],
  moderator: [
    'audit.read=all',
    'cms.content.publish=all',
    'cms.content.write=all',
    'cms.media.manage=all',
    'cms.settings.global=all',
    'committees.read=all',
    'events.read=all',
    'events.write=all',
    'notifications.manage=all',
    'registrations.decide=all',
    'registrations.read=all',
    'scores.read=all',
    'submissions.read=all',
    'submissions.review=all',
    'tasks.read=all',
    'users.read=all',
  ],
  director: [
    'analytics.configure=committee',
    'cms.content.write=committee',
    'committees.read=all',
    'committees.write=committee',
    'events.read=all',
    'events.write=committee',
    'registrations.read=committee',
    'rewards.read=committee',
    'rewards.write=committee',
    'scores.read=committee',
    'skills.manage=committee',
    'skills.read=committee',
    'submissions.create=self',
    'submissions.read=committee',
    'submissions.review=committee',
    'tasks.assign=committee',
    'tasks.read=all',
    'tasks.write=committee',
    'users.read=committee',
    'users.update=committee',
  ],
  head: [
    'cms.content.write=committee',
    'committees.read=all',
    'events.read=all',
    'rewards.read=committee',
    'rewards.write=committee',
    'scores.read=committee',
    'skills.read=committee',
    'submissions.create=self',
    'submissions.read=committee',
    'submissions.review=committee',
    'tasks.assign=committee',
    'tasks.read=all',
    'tasks.write=committee',
    'users.read=committee',
  ],
  member: [
    'committees.read=all',
    'events.read=all',
    'rewards.read=self',
    'scores.read=self',
    'skills.read=self',
    'submissions.create=self',
    'submissions.read=self',
    'tasks.read=committee',
    'tasks.write=self',
  ],
};

const scopesOf = (role: Role) =>
  capabilitiesFor(role)
    .map((capability) => `${capability}=${scopeFor(role, capability)}`)
    .sort();

const hr = { role: 'hr_manager' as const, id: 'usr_hr_people', committeeId: undefined };
const teammate = { id: 'usr_mem_te', committeeId: 'comm_te' };

/** A directory row, shaped the way the screens that call `mayOfferReward()` already hold one. */
const person = (over: Partial<User> = {}): User => ({
  id: 'usr_mem_te',
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

describe('HR Manager: existing roles did not move', () => {
  it('holds the pre-existing matrix verbatim for the six roles that shipped first', () => {
    expect(Object.keys(MATRIX_BEFORE_HR_ROLE).sort()).toEqual(
      ['director', 'head', 'high_board', 'member', 'moderator', 'super_admin']
    );
    for (const [role, before] of Object.entries(MATRIX_BEFORE_HR_ROLE)) {
      expect(scopesOf(role as Role), `${role} gained or lost a grant`).toEqual(before);
    }
  });

  it('keeps the seniority numbers of those six roles', () => {
    expect(ROLE_RANK).toMatchObject({
      super_admin: 100,
      high_board: 80,
      moderator: 70,
      director: 50,
      head: 40,
      member: 10,
    });
  });

  it('lists the new role without displacing the order of the others', () => {
    expect(ALL_ROLES).toEqual(['super_admin', 'high_board', 'moderator', 'hr_manager', 'director', 'head', 'member']);
    expect(ROLE_LABELS.hr_manager).toBe('HR Manager');
  });

  it('counts HR Manager as privileged, so only a Super Admin can grant it', () => {
    expect(PRIVILEGED_ROLES).toContain('hr_manager');
    // The rule 0010 encodes as "every label except member": nothing may be left out of both lists.
    expect([...PRIVILEGED_ROLES].sort()).toEqual(ALL_ROLES.filter((role) => role !== 'member').sort());
  });
});

describe('HR Manager: what the role may do', () => {
  const granted = [
    'users.read',
    'users.create',
    'users.update',
    'users.suspend',
    'registrations.read',
    'registrations.decide',
    'committees.read',
    'committees.write',
    'tasks.read',
    'submissions.read',
    'scores.read',
    'events.read',
    'skills.read',
    'analytics.configure',
    'notifications.manage',
    'rewards.read',
    'rewards.write',
  ] as const;

  it.each(granted)('allows %s at chapter scope', (capability) => {
    expect(hasCapability('hr_manager', capability)).toBe(true);
    expect(scopeFor('hr_manager', capability)).toBe('all');
  });

  it('holds no other capability than the people-operations list', () => {
    expect(scopesOf('hr_manager')).toEqual(granted.map((capability) => `${capability}=all`).sort());
  });

  it('reaches any committee record despite belonging to no committee', () => {
    // The scope test the directory depends on: a placement officer with no committee of their own
    // still has to open the person they are moving.
    expect(canActOn(hr, 'users.update', teammate)).toBe(true);
    expect(canActOn(hr, 'committees.write', { id: 'comm_te' })).toBe(true);
  });
});

describe('HR Manager: what the role must not do', () => {
  const refused = [
    // it runs people operations, not the chapter's money, website or machinery
    'users.delete',
    'users.role.assign',
    'committees.archive',
    'tasks.write',
    'tasks.assign',
    'tasks.delete',
    'submissions.review',
    'submissions.create',
    'scores.adjust',
    'events.write',
    'skills.manage',
    'cms.settings.global',
    'cms.content.write',
    'cms.content.publish',
    'cms.media.manage',
    'audit.read',
    'settings.manage',
    'integrations.manage',
    'backups.manage',
    'rewards.configure',
  ] as const;

  it.each(refused)('denies %s outright', (capability) => {
    expect(hasCapability('hr_manager', capability)).toBe(false);
    expect(scopeFor('hr_manager', capability)).toBeNull();
  });

  it('cannot hand the role to anyone, including itself', () => {
    const selfGrant = validateRoleChange(hr, { id: hr.id, role: 'member' }, 'hr_manager');
    expect(selfGrant.allowed).toBe(false);
    if (!selfGrant.allowed) expect(selfGrant.reason).toMatch(/Super Admin/);

    const anotherHr = validateRoleChange(hr, { id: 'usr_hr_other', role: 'member' }, 'hr_manager');
    expect(anotherHr.allowed).toBe(false);
  });

  it('cannot demote or promote through any privileged role', () => {
    for (const role of PRIVILEGED_ROLES) {
      expect(validateRoleChange(hr, { id: 'usr_head_te', role: 'head' }, role).allowed, role).toBe(false);
    }
  });

  it('is still blocked from targeting someone at or above its own rank', () => {
    expect(ROLE_RANK.hr_manager).toBeGreaterThan(ROLE_RANK.director);
    expect(ROLE_RANK.hr_manager).toBeLessThan(ROLE_RANK.moderator);

    expect(mayOfferReward('bonus', hr, person({ id: 'usr_board', role: 'high_board', committeeId: undefined }), {
      policy: DEFAULT_REWARD_POLICY,
    })).toBe(false);
  });
});

describe('HR Manager: the shared rules read the role the same way', () => {
  it('sees chapter-wide work in the action queue, like the other staff roles', () => {
    const foreign = { ownerId: 'usr_mem_te', committeeId: 'comm_te' };
    expect(visibleTo(hr, foreign)).toBe(true);
    // unchanged for the roles that shipped first
    expect(visibleTo({ role: 'member', id: 'usr_hr_people' }, foreign)).toBe(false);
    expect(visibleTo({ role: 'member', id: 'usr_mem_te' }, foreign)).toBe(true);
    expect(visibleTo({ role: 'director', id: 'usr_dir_te', committeeId: 'comm_it' }, foreign)).toBe(false);
  });

  it('may recognise a member but may not discipline one', () => {
    const target = person();
    expect(mayOfferReward('bonus', hr, target, { policy: DEFAULT_REWARD_POLICY })).toBe(true);
    expect(mayOfferReward('warning', hr, target, { policy: DEFAULT_REWARD_POLICY })).toBe(false);
  });
});
