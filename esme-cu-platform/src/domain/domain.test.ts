// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canActOn,
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
  isEligibleForApproval,
  InvalidStatusTransitionError,
  assertTransition,
} from './accountState';
import {
  createPendingRegistration,
  findDuplicateIdentity,
  isPasswordAcceptable,
  normalizeEmail,
  normalizeUsername,
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
    for (const role of ['member', 'director', 'head', 'moderator'] as const) {
      expect(hasCapability(role, 'users.role.assign')).toBe(false);
      expect(scopeFor(role, 'users.role.assign')).toBeNull();
    }
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
    expect(canTransition('pending_email_verification', 'pending_approval')).toBe(true);
    expect(canTransition('pending_email_verification', 'active')).toBe(false);
    expect(canTransition('pending_approval', 'active')).toBe(true);
    expect(canTransition('pending_approval', 'suspended')).toBe(false);
    expect(canTransition('active', 'pending_approval')).toBe(false);
    expect(canTransition('active', 'suspended')).toBe(true);
    expect(canTransition('suspended', 'active')).toBe(true);
    expect(canTransition('rejected', 'active')).toBe(false);
  });

  it('grants ERP access to active accounts only', () => {
    for (const status of ACCOUNT_STATUSES) {
      expect(canAccessErp(status)).toBe(status === 'active');
    }
  });

  it('projects every provider status onto exactly one review-board stage', () => {
    expect(applicationStageFor('pending_email_verification')).toBe('pending');
    expect(applicationStageFor('pending_approval')).toBe('under_review');
    expect(applicationStageFor('active')).toBe('accepted');
    expect(applicationStageFor('rejected')).toBe('rejected');
    // A suspended account was approved once; the stage keeps that and accountStatus carries the rest.
    expect(applicationStageFor('suspended')).toBe('accepted');
    expect(ACCOUNT_STATUSES.every((s) => typeof applicationStageFor(s) === 'string')).toBe(true);
  });

  it('requires verified email before approval', () => {
    expect(isEligibleForApproval('pending_approval', false)).toBe(false);
    expect(isEligibleForApproval('pending_approval', true)).toBe(true);
    expect(isEligibleForApproval('pending_email_verification', true)).toBe(false);
  });

  it('throws on an illegal transition', () => {
    expect(() => assertTransition('rejected', 'active')).toThrow(InvalidStatusTransitionError);
  });

  it('blocks login for every non-active status without leaking details', () => {
    for (const status of ACCOUNT_STATUSES.filter((s) => s !== 'active')) {
      expect(describeLoginOutcome(status, true).kind).toBe('blocked');
    }
    expect(describeLoginOutcome('active', true).kind).toBe('granted');
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

  it('rejects weak passwords, mismatched confirmation and unaccepted policies', () => {
    const errors = validateRegistration({ ...valid, password: 'short1!', confirmPassword: 'different' });
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
    expect(pending.status).toBe('pending_email_verification');
    expect(pending.role).toBe('member');
    expect(pending.capabilities).toEqual([]);
  });
});
