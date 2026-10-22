// @vitest-environment node
/**
 * The signup rules on the trusted side, with no form in the way.
 *
 * `RegistrationPortal.test.tsx` proves what an applicant sees; this proves what the chapter's rules
 * say, because the same function runs in both auth adapters before anything is written. The two
 * questions that only exist on the form are deliberately absent here — a device that never was
 * offered them must keep registering, so a missing academic answer is only refused by a schema that
 * asks for one.
 */
import { describe, expect, it } from 'vitest';
import {
  ACADEMIC_YEAR_OPTIONS,
  COMMITTEE_MEMBERSHIP_CHOICES,
  DEPARTMENT_OPTIONS,
  HIGH_BOARD_COMMITTEE,
  REFERENCE_COMMITTEES,
  REFERENCE_FORM_FIELDS,
} from '../data/referenceContent';
import { hasCommitteeNamed, registrationCommitteeOptions } from './committees';
import {
  COMMITTEE_MEMBERSHIP_VALUES,
  createPendingRegistration,
  isCommitteeMembershipAnswer,
  resolveCommitteeAnswer,
  validateRegistration,
  type RegistrationFieldSpec,
  type RegistrationInput,
} from './registration';

const STRONG = 'Str0ng#Kx91';

/** The committees an applicant may name right now: the published rows, narrowed the form narrows them. */
const openCommittees = registrationCommitteeOptions(REFERENCE_COMMITTEES);
const openIds = openCommittees.map((committee) => committee.id);

/** The shipped questionnaire, with the live committee list injected where the form injects it. */
const shippedSchema: RegistrationFieldSpec[] = REFERENCE_FORM_FIELDS.filter((field) => field.enabled).map((field) => ({
  name: field.name,
  required: field.required,
  enabled: true,
  options:
    field.name === 'preferredCommitteeId' || field.name === 'secondCommitteePreferenceId'
      ? openIds
      : (field.options as string[] | undefined),
}));

const asked = (over: Partial<RegistrationInput> = {}): RegistrationInput => ({
  fullName: 'Aya Student',
  email: 'aya.student@esme-cu.edu',
  username: 'aya.student',
  password: STRONG,
  confirmPassword: STRONG,
  acceptedPolicies: true,
  department: DEPARTMENT_OPTIONS[0],
  academicYear: ACADEMIC_YEAR_OPTIONS[2],
  committeeMembership: 'no',
  ...over,
});

describe('registration the chapter asks for today', () => {
  it('accepts an applicant who answers every academic question', () => {
    expect(validateRegistration(asked(), shippedSchema)).toEqual({});
  });

  it('refuses a required academic question left blank', () => {
    expect(validateRegistration(asked({ department: '' }), shippedSchema).department).toBe('Choose your department.');
    expect(validateRegistration(asked({ academicYear: undefined }), shippedSchema).academicYear).toBe(
      'Choose your academic year.'
    );
  });

  it('refuses an academic answer that is not one of the options offered', () => {
    // A hand-made request is not bound by the dropdown, so the list binds it here instead.
    const errors = validateRegistration(asked({ academicYear: 'Graduate III', department: 'Welding' }), shippedSchema);
    expect(errors.academicYear).toBe('Choose one of the options offered.');
    expect(errors.department).toBe('Choose one of the options offered.');
  });

  it('accepts someone who is not on a committee and asks them no committee', () => {
    const errors = validateRegistration(asked({ committeeMembership: 'no', committeeId: undefined }), shippedSchema);
    expect(errors).toEqual({});
    expect(shippedSchema.find((field) => field.name === 'preferredCommitteeId')?.required).toBe(false);
  });

  it('requires a member to name the committee they belong to', () => {
    const missing = validateRegistration(asked({ committeeMembership: 'yes', committeeId: '' }), shippedSchema);
    expect(missing.committeeId).toBe('Choose the committee you belong to.');

    const named = validateRegistration(asked({ committeeMembership: 'yes', committeeId: 'comm_mc' }), shippedSchema);
    expect(named).toEqual({});
  });

  it('refuses a committee nobody publishes', () => {
    const errors = validateRegistration(
      asked({ committeeMembership: 'yes', committeeId: 'comm_does_not_exist' }),
      shippedSchema
    );
    expect(errors.committeeId).toBe('Choose one of the options offered.');
  });

  it('refuses the same committee named as first and second preference', () => {
    const errors = validateRegistration(
      asked({ committeeMembership: 'yes', committeeId: 'comm_mc', secondCommitteePreferenceId: 'comm_mc' }),
      shippedSchema
    );
    expect(errors.secondCommitteePreferenceId).toBeTruthy();
  });

  it('accepts High Board as a committee and still makes an applicant a plain pending member', () => {
    expect(openIds).toContain(HIGH_BOARD_COMMITTEE.id);
    const errors = validateRegistration(
      asked({ committeeMembership: 'yes', committeeId: HIGH_BOARD_COMMITTEE.id }),
      shippedSchema
    );
    expect(errors).toEqual({});

    // What the request becomes does not depend on which committee was named: no role, no
    // capability, and approval is still ahead of it.
    const pending = createPendingRegistration();
    expect(pending.role).toBe('member');
    expect(pending.status).toBe('pending_approval');
    expect(pending.capabilities).toEqual([]);
  });
});

describe('the membership question', () => {
  it('has exactly two answers, and only those two', () => {
    expect(COMMITTEE_MEMBERSHIP_VALUES).toEqual(['yes', 'no']);
    expect(COMMITTEE_MEMBERSHIP_CHOICES.map((choice) => choice.value)).toEqual([...COMMITTEE_MEMBERSHIP_VALUES]);
    expect(isCommitteeMembershipAnswer('yes')).toBe(true);
    expect(isCommitteeMembershipAnswer('أيوه')).toBe(false);
    expect(isCommitteeMembershipAnswer(undefined)).toBe(false);
  });

  it('refuses an answer that is not one of the two, on the trusted side too', () => {
    expect(validateRegistration(asked({ committeeMembership: 'maybe' })).committeeMembership).toBe('Answer yes or no.');
  });

  it('demands a committee for a yes even when no schema is handed to it', () => {
    // The adapters call this function without a schema, so the conditional has to travel with it.
    expect(validateRegistration(asked({ committeeMembership: 'yes', committeeId: undefined })).committeeId).toBe(
      'Choose the committee you belong to.'
    );
    expect(validateRegistration(asked({ committeeMembership: 'no', committeeId: undefined }))).toEqual({});
  });

  it('drops a committee left behind by an applicant who changed their mind to no', () => {
    expect(resolveCommitteeAnswer('no', 'comm_mc')).toBeUndefined();
    expect(resolveCommitteeAnswer('no', '')).toBe('');
    expect(resolveCommitteeAnswer('no', undefined)).toBeUndefined();
    expect(resolveCommitteeAnswer('yes', 'comm_mc')).toBe('comm_mc');
    expect(resolveCommitteeAnswer(undefined, 'comm_mc')).toBe('comm_mc');
  });
});

describe('the committee list the signup offers', () => {
  it('is the published list, in the published order, with no committee named twice', () => {
    const published = REFERENCE_COMMITTEES.filter((committee) => committee.status === 'active' && committee.isPublic);
    expect(registrationCommitteeOptions(REFERENCE_COMMITTEES)).toEqual(published);
  });

  it('keeps archived and unpublished committees out of the choices', () => {
    const rows = [
      { ...REFERENCE_COMMITTEES[0], id: 'comm_old', name: 'Old Committee', status: 'archived' as const },
      { ...REFERENCE_COMMITTEES[0], id: 'comm_secret', name: 'Private Panel', isPublic: false },
    ];
    expect(registrationCommitteeOptions(rows)).toEqual([]);
  });

  it('keeps one row per id when the same committee is listed twice', () => {
    const twice = [REFERENCE_COMMITTEES[0], REFERENCE_COMMITTEES[0], REFERENCE_COMMITTEES[1]];
    expect(registrationCommitteeOptions(twice).map((committee) => committee.id)).toEqual([
      REFERENCE_COMMITTEES[0].id,
      REFERENCE_COMMITTEES[1].id,
    ]);
  });

  it('recognises a committee already present under another spelling', () => {
    const rows = [{ id: 'comm_hb_2024', name: 'High  Board' }, { id: 'comm_te', name: 'Technical & Engineering' }];
    expect(hasCommitteeNamed(rows, 'High Board')).toBe(true);
    expect(hasCommitteeNamed(rows, 'high-board')).toBe(true);
    expect(hasCommitteeNamed(rows, 'Welding Society')).toBe(false);
  });
});

describe('an account this build has never asked', () => {
  it('still registers when no schema is supplied', () => {
    // The adapters validate without a questionnaire in hand: the academic questions a device was
    // never offered cannot be refused on its behalf.
    expect(validateRegistration({ ...asked(), department: undefined, academicYear: undefined, committeeMembership: undefined })).toEqual({});
  });

  it('keeps the identity rules it already had', () => {
    expect(validateRegistration(asked({ acceptedPolicies: false })).acceptedPolicies).toBeTruthy();
    expect(validateRegistration(asked({ email: 'not-an-email' })).email).toBeTruthy();
    expect(validateRegistration(asked({ username: 'A' })).username).toBeTruthy();
    expect(validateRegistration(asked({ password: 'weak', confirmPassword: 'weaker' })).confirmPassword).toBeTruthy();
  });

  it('refuses a field the schema switched back on but nobody answered', () => {
    const withStudentId = [...shippedSchema, { name: 'studentId', required: true, enabled: true }];
    expect(validateRegistration(asked(), withStudentId).studentId).toBe('Answer this question.');
  });

  it('only stops validating a row the schema explicitly switched off', () => {
    // A spec that leaves the flag out is still a question that was asked, not one that was retired.
    const loose = [{ name: 'department', required: true }] as unknown as RegistrationFieldSpec[];
    expect(validateRegistration(asked({ department: '' }), loose).department).toBe('Choose your department.');
    const off = [{ name: 'department', required: true, enabled: false }];
    expect(validateRegistration(asked({ department: '' }), off).department).toBeUndefined();
  });
});
