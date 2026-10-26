// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ALL_ROLES,
  canActOn,
  canReadProfile,
  capabilitiesFor,
  hasCapability,
  isPrimaryAdmin,
  scopeFor,
  validateRoleChange,
  PRIVILEGED_ROLES,
  PRIMARY_ADMIN,
} from './roles';
import {
  ACCOUNT_STATUSES,
  applicationStageFor,
  canAccessErp,
  canTransition,
  describeLoginOutcome,
  isDecidable,
  InvalidStatusTransitionError,
  assertTransition,
  repairStoredStatus,
} from './accountState';
import {
  createPendingRegistration,
  findDuplicateIdentity,
  isPasswordAcceptable,
  MAX_SUBMISSIONS_PER_WINDOW,
  normalizeEmail,
  normalizeUsername,
  submissionThrottleBlocked,
  validatePassword,
  validateRegistration,
  type RegistrationInput,
} from './registration';

const superAdmin = { role: 'super_admin' as const, id: 'usr_superadmin', committeeId: undefined };
const director = { role: 'director' as const, id: 'usr_dir_te', committeeId: 'comm_te' };
const head = { role: 'head' as const, id: 'usr_head_te', committeeId: 'comm_te' };
const member = { role: 'member' as const, id: 'usr_mem_1', committeeId: 'comm_te' };
const moderator = { role: 'moderator' as const, id: 'usr_mod_it', committeeId: 'comm_it' };

describe('capability matrix', () => {
  it('only super_admin and moderator can decide registrations', () => {
    for (const role of ['member', 'director', 'head'] as const) {
      expect(hasCapability(role, 'registrations.decide')).toBe(false);
    }
    expect(hasCapability('super_admin', 'registrations.decide')).toBe(true);
    expect(hasCapability('moderator', 'registrations.decide')).toBe(true);
  });

  it('denies role assignment to every role except super_admin', () => {
    // Every label the platform ships, not a hand-typed list: a role added without revisiting the
    // matrix has to fail here rather than quietly inherit the capability.
    for (const role of ALL_ROLES) {
      if (role === 'super_admin') continue;
      expect(hasCapability(role, 'users.role.assign'), role).toBe(false);
      expect(scopeFor(role, 'users.role.assign'), role).toBeNull();
    }
    expect(hasCapability('super_admin', 'users.role.assign')).toBe(true);
  });

  it('counts every role label except member as privileged', () => {
    // 0002 froze four labels as privileged; 0006 added high_board and the list stayed behind, so a
    // grantee below Super Admin could hand out a chapter-wide read role. The rule is now "not
    // member", in TS here and in SQL in 0010, and this pins that nothing was left out.
    expect([...PRIVILEGED_ROLES].sort()).toEqual(ALL_ROLES.filter((role) => role !== 'member').sort());
  });

  it('refuses every account as its own privilege gate', () => {
    for (const actor of [member, director, head, moderator, superAdmin]) {
      const verdict = validateRoleChange(actor, { id: actor.id, role: actor.role }, 'moderator');
      expect(verdict.allowed, actor.role).toBe(false);
    }
    // Including a demotion: an administrator cannot remove their own privileges by accident and be
    // left with no path back, which is the case 0002's esme_assign_role() allowed until 0010.
    const selfDemote = validateRoleChange(superAdmin, { id: superAdmin.id, role: 'super_admin' }, 'member');
    expect(selfDemote.allowed).toBe(false);
    if (!selfDemote.allowed) expect(selfDemote.reason).toMatch(/own role/);
  });

  it('denies members every administrative capability', () => {
    const adminCaps: string[] = [
      'users.create', 'users.delete', 'users.suspend', 'registrations.decide',
      'committees.write', 'tasks.delete', 'submissions.review', 'scores.adjust',
      'cms.settings.global', 'cms.content.publish', 'audit.read', 'settings.manage',
      'integrations.manage', 'backups.manage',
    ];
    for (const cap of adminCaps) {
      expect(hasCapability('member', cap as never)).toBe(false);
    }
  });

  it('does not give moderators global settings or backup power by accident', () => {
    for (const cap of ['users.role.assign', 'users.suspend', 'settings.manage', 'backups.manage', 'integrations.manage'] as const) {
      expect(hasCapability('moderator', cap)).toBe(false);
    }
  });

  it('grants committee scope only inside the actor committee', () => {
    expect(canActOn(director, 'submissions.review', { committeeId: 'comm_te' })).toBe(true);
    expect(canActOn(director, 'submissions.review', { committeeId: 'comm_mc' })).toBe(false);
    expect(canActOn(head, 'tasks.assign', { committeeId: 'comm_mc' })).toBe(false);
    expect(canActOn(director, 'users.read', {})).toBe(true);
  });

  it('denies committee capabilities to a role with no committee', () => {
    expect(canActOn({ role: 'director', id: 'x' }, 'tasks.assign', { committeeId: 'comm_te' })).toBe(false);
  });

  it('restricts self-scoped capabilities to the actor record', () => {
    expect(canActOn(member, 'submissions.create', { id: 'usr_mem_1' })).toBe(true);
    expect(canActOn(member, 'submissions.create', { id: 'usr_mem_2' })).toBe(false);
  });

  it('lists capabilities without leaking unknown roles', () => {
    expect(capabilitiesFor('member').length).toBeLessThan(capabilitiesFor('super_admin').length);
    expect(capabilitiesFor('super_admin')).toContain('backups.manage');
  });

  it('gives the public content suite to the administrator, IT Moderator and High Board', () => {
    // 0015 completes the set 0013 started for events. The screen-level gates (nav, CMS, media)
    // read these same names, so a missing row hides the work from the officer who runs it.
    const contentCaps = [
      'cms.settings.global',
      'cms.content.write',
      'cms.content.publish',
      'cms.media.manage',
      'events.write',
    ] as const;
    for (const role of ['super_admin', 'moderator', 'high_board'] as const) {
      for (const cap of contentCaps) expect(hasCapability(role, cap), `${role} ${cap}`).toBe(true);
    }
    for (const cap of contentCaps) expect(hasCapability('member', cap), `member ${cap}`).toBe(false);

    // The grant is the content suite, not the platform.
    for (const cap of ['users.role.assign', 'users.suspend', 'settings.manage', 'integrations.manage', 'backups.manage'] as const) {
      expect(hasCapability('high_board', cap), `high_board ${cap}`).toBe(false);
    }

    // Committee leads may draft copy for their own committee; publishing stays with the three roles.
    expect(scopeFor('head', 'cms.content.write')).toBe('committee');
    expect(hasCapability('head', 'cms.content.publish')).toBe(false);
    expect(hasCapability('director', 'cms.content.publish')).toBe(false);
  });
});

describe('directory visibility follows the read scope', () => {
  const otherCommittee = { id: 'usr_other', committeeId: 'comm_mc' };
  const unassigned = { id: 'usr_none' };

  it('shows the whole chapter to the roles whose users.read is all', () => {
    for (const actor of [superAdmin, { role: 'high_board' as const, id: 'usr_board' }, moderator]) {
      expect(canReadProfile(actor, otherCommittee), actor.role).toBe(true);
      expect(canReadProfile(actor, unassigned), actor.role).toBe(true);
    }
  });

  it('keeps a committee-scoped officer inside their committee, plus their own record', () => {
    expect(canReadProfile(director, { id: 'usr_te', committeeId: 'comm_te' })).toBe(true);
    expect(canReadProfile(director, otherCommittee)).toBe(false);
    // The board and an unassigned account are not this committee's roster.
    expect(canReadProfile(director, { id: 'usr_board', committeeId: undefined })).toBe(false);
    expect(canReadProfile(director, unassigned)).toBe(false);
    // Their own row remains readable even if their committee link is missing.
    expect(canReadProfile({ role: 'director', id: 'usr_dir' }, { id: 'usr_dir' })).toBe(true);
    expect(canReadProfile(head, { id: 'usr_te', committeeId: 'comm_te' })).toBe(true);
    expect(canReadProfile(head, otherCommittee)).toBe(false);
  });

  it('gives a member no directory at all', () => {
    expect(canReadProfile(member, { id: member.id, committeeId: 'comm_te' })).toBe(false);
    expect(canReadProfile(member, otherCommittee)).toBe(false);
  });
});

describe('privilege escalation guards', () => {
  it('blocks a moderator promoting themselves to super_admin', () => {
    const result = validateRoleChange(moderator, { id: moderator.id, role: 'moderator' }, 'super_admin');
    expect(result.allowed).toBe(false);
  });

  it('blocks a director granting any privileged role', () => {
    for (const role of PRIVILEGED_ROLES) {
      expect(validateRoleChange(director, { id: 'usr_mem_1', role: 'member' }, role).allowed).toBe(false);
    }
  });

  it('lets super_admin grant member and moderator but never demote the primary admin', () => {
    expect(validateRoleChange(superAdmin, { id: 'usr_mem_1', role: 'member' }, 'moderator').allowed).toBe(true);
    const demote = validateRoleChange(
      superAdmin,
      { id: 'usr_superadmin', role: 'super_admin' },
      'member',
      true
    );
    expect(demote.allowed).toBe(false);
  });

  it('blocks a second super_admin editing the protected primary account', () => {
    const otherAdmin = { role: 'super_admin' as const, id: 'usr_other_admin' };
    expect(validateRoleChange(otherAdmin, { id: 'usr_superadmin', role: 'super_admin' }, 'head', true).allowed).toBe(false);
  });

  it('recognises the primary admin by either identifier, case-insensitively', () => {
    expect(isPrimaryAdmin({ email: PRIMARY_ADMIN.email })).toBe(true);
    expect(isPrimaryAdmin({ username: 'Temsah1' })).toBe(true);
    expect(isPrimaryAdmin({ email: 'someone@esme.edu.eg' })).toBe(false);
  });
});

describe('account state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('pending_approval', 'active')).toBe(true);
    expect(canTransition('pending_approval', 'rejected')).toBe(true);
    expect(canTransition('pending_approval', 'suspended')).toBe(false);
    expect(canTransition('active', 'pending_approval')).toBe(false);
    expect(canTransition('active', 'suspended')).toBe(true);
    expect(canTransition('suspended', 'active')).toBe(true);
    expect(canTransition('rejected', 'active')).toBe(false);
    expect(canTransition('rejected', 'pending_approval')).toBe(true);
  });

  it('grants ERP access to active accounts only', () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(canAccessErp(status)).toBe(status === 'active');
    }
  });

  it('has no stage before the review: a submission is decidable the moment it exists', () => {
    expect(ACCOUNT_STATUSES).toEqual(['pending_approval', 'active', 'rejected', 'suspended']);
    expect(isDecidable('pending_approval')).toBe(true);
    for (const status of ACCOUNT_STATUSES.filter((s) => s !== 'pending_approval')) {
      expect(isDecidable(status)).toBe(false);
    }
  });

  it('repairs a stored status this build cannot act on onto the review queue', () => {
    expect(repairStoredStatus('pending_email_verification')).toBe('pending_approval');
    // A blank or missing status can neither sign in nor be decided; it is repaired, not trusted.
    expect(repairStoredStatus('')).toBe('pending_approval');
    expect(repairStoredStatus(undefined)).toBe('pending_approval');
    for (const status of ACCOUNT_STATUSES) {
      expect(repairStoredStatus(status)).toBe(status);
    }
  });

  it('projects every provider status onto exactly one review-board stage', () => {
    expect(applicationStageFor('pending_approval')).toBe('under_review');
    expect(applicationStageFor('active')).toBe('accepted');
    expect(applicationStageFor('rejected')).toBe('rejected');
    // A suspended account was approved once; the stage keeps that and accountStatus carries the rest.
    expect(applicationStageFor('suspended')).toBe('accepted');
    expect(ACCOUNT_STATUSES.every((s) => typeof applicationStageFor(s) === 'string')).toBe(true);
  });

  it('throws on an illegal transition', () => {
    expect(() => assertTransition('rejected', 'active')).toThrow(InvalidStatusTransitionError);
  });

  it('blocks login for every non-active status without leaking details', () => {
    for (const status of ACCOUNT_STATUSES.filter((s) => s !== 'active')) {
      expect(describeLoginOutcome(status).kind).toBe('blocked');
    }
    expect(describeLoginOutcome('active').kind).toBe('granted');
  });
});

describe('registration rules', () => {
  const valid: RegistrationInput = {
    fullName: 'Mariam Adel',
    email: 'Mariam.Adel@esme.edu.eg',
    username: 'mariam.adel',
    password: 'Volt#Arc7!2026',
    confirmPassword: 'Volt#Arc7!2026',
    committeeId: 'comm_te',
    acceptedPolicies: true,
  };

  it('accepts a well-formed request', () => {
    expect(validateRegistration(valid)).toEqual({});
  });

  it('accepts the short signup: no committee and no questionnaire answers', () => {
    const shortForm: RegistrationInput = {
      fullName: 'Mariam Adel',
      email: 'mariam.adel@esme.edu.eg',
      username: 'mariam.adel',
      password: 'Volt#Arc7!2026',
      confirmPassword: 'Volt#Arc7!2026',
      acceptedPolicies: true,
    };
    expect(validateRegistration(shortForm)).toEqual({});
  });

  it('rejects weak passwords, mismatched confirmation and unaccepted policies', () => {    const errors = validateRegistration({ ...valid, password: 'short1!', confirmPassword: 'different' });
    expect(errors.password).toBeTruthy();
    expect(errors.confirmPassword).toBeTruthy();

    const noPolicy = validateRegistration({ ...valid, acceptedPolicies: false });
    expect(noPolicy.acceptedPolicies).toBeTruthy();
  });

  it('rejects bad emails and usernames', () => {
    expect(validateRegistration({ ...valid, email: 'not-an-email' }).email).toBeTruthy();
    expect(validateRegistration({ ...valid, username: 'ab' }).username).toBeTruthy();
    expect(validateRegistration({ ...valid, username: '_leading' }).username).toBeTruthy();
  });

  it('refuses passwords built from chapter words', () => {
    expect(isPasswordAcceptable('ESME2027!Chapter')).toBe(false);
    expect(validatePassword('Password1234!99')).toContain('Not based on a common or chapter-related word');
  });

  it('normalises identity fields before comparison', () => {
    expect(normalizeEmail('  KareemElTemsah7@Gmail.COM ')).toBe('kareemeltemsah7@gmail.com');
    expect(normalizeUsername('  Temsah1 ')).toBe('temsah1');
  });

  it('flags duplicate email before duplicate username', () => {
    const exists = (field: 'email' | 'username') => field === 'email';
    expect(findDuplicateIdentity(valid.email, valid.username, exists)).toBe('email');
    expect(findDuplicateIdentity(valid.email, valid.username, () => false)).toBeNull();
  });

  it('produces a pending applicant with zero capabilities', () => {
    const pending = createPendingRegistration();
    expect(pending.status).toBe('pending_approval');
    expect(pending.role).toBe('member');
    expect(pending.capabilities).toEqual([]);
  });

  it('refuses a burst of submissions once nobody has to click a link', () => {
    const now = '2026-10-19T12:00:00.000Z';
    const recent = Array.from({ length: MAX_SUBMISSIONS_PER_WINDOW }, (_, i) =>
      new Date(Date.parse(now) - i * 60_000).toISOString()
    );
    expect(submissionThrottleBlocked(recent, now)).toBe(true);
    expect(submissionThrottleBlocked(recent.slice(0, MAX_SUBMISSIONS_PER_WINDOW - 1), now)).toBe(false);
    // Outside the window the counter is gone, so a slow trickle of real applicants is never blocked.
    const aDayAgo = recent.map((stamp) => new Date(Date.parse(stamp) - 86_400_000).toISOString());
    expect(submissionThrottleBlocked(aDayAgo, now)).toBe(false);
    expect(submissionThrottleBlocked(['not-a-date'], now)).toBe(false);
  });
});
