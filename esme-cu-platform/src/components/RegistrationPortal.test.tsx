// @vitest-environment jsdom
/**
 * The signup form as an applicant meets it.
 *
 * The domain already says what a valid request is (`domain.test.ts`) and the storage migration says
 * how a returning device gets the extra questions (`migrations.test.ts`). What is proved here is the
 * rendered surface: which questions the shipped schema asks, that an optional question is answered by
 * leaving it alone rather than by the browser picking something on the applicant's behalf, that the
 * committee list offered is the one the homepage publishes, and that the membership answer decides
 * whether the committee question is asked at all.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACADEMIC_YEAR_OPTIONS, DEPARTMENT_OPTIONS, REFERENCE_COMMITTEES, REFERENCE_FORM_FIELDS } from '../data/referenceContent';
import type { RegistrationApplication, RegistrationFieldConfig } from '../types';
import { STORAGE_KEYS, TARGET_VERSION } from '../storage/migrations';

const PASSWORD = 'Volt#Arc7!2026';

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // The applicant's own device is current: the migration has nothing to rewrite here.
  localStorage.setItem(STORAGE_KEYS.version, TARGET_VERSION);
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => TL.cleanup());

/**
 * Mounts the portal the way the public site does — signed out, with the schema the store would
 * read from cache. Seeding `formFields` is what an operator's saved schema looks like, and
 * `committees` is what Committee Management has published; both default to the reference content.
 */
async function renderPortal(
  formFields: RegistrationFieldConfig[] = REFERENCE_FORM_FIELDS,
  committees: unknown[] = REFERENCE_COMMITTEES
) {
  localStorage.setItem(`${STORAGE_KEYS.v2}formFields`, JSON.stringify(formFields));
  localStorage.setItem(`${STORAGE_KEYS.v2}committees`, JSON.stringify(committees));

  const [{ AppProvider }, auth, { RegistrationPortal }, motion, { MotionConfig }] = await Promise.all([
    import('../context/AppContext'),
    import('../auth/AuthProvider'),
    import('./RegistrationPortal'),
    import('../motion'),
    import('motion/react'),
  ]);

  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <RegistrationPortal onBackToHome={() => {}} onNavigateToLogin={() => {}} />
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  await TL.waitFor(() => expect(TL.screen.getByRole('heading', { level: 1 })).toBeTruthy());
  return { user };
}

const filed = () =>
  JSON.parse(localStorage.getItem(`${STORAGE_KEYS.v2}applications`) ?? '[]') as RegistrationApplication[];

/** A required field prints an asterisk inside its label, so the match is a prefix, not the whole text. */
const label = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const field = (text: string) => TL.screen.getByLabelText(label(text));
const noField = (text: string) => expect(TL.screen.queryByLabelText(label(text))).toBeNull();

const ASKED = [
  'Full Name',
  'University Email',
  'Academic Year',
  'Department',
  'Primary Committee Preference',
  'Agreement to Chapter Policies & Code of Conduct',
];

const NOT_ASKED = [
  'Student ID',
  'Phone Number (WhatsApp)',
  'Secondary Committee Preference (Optional)',
  'Technical & Professional Skills',
  'Previous Experience & Projects',
  'Motivation for Joining ESME CU',
  'Weekly Availability',
];

const yesRadio = () => TL.screen.getByRole('radio', { name: /^Yes/ });
const noRadio = () => TL.screen.getByRole('radio', { name: /^No/ });
const committeeSelect = () => field('Primary Committee Preference') as HTMLSelectElement;

/** Everything the shipped schema demands of someone who is not yet on a committee. */
async function fillNonMember(user: Awaited<ReturnType<typeof userEvent.setup>>) {
  await user.type(field('Full Name'), 'Nada Officer');
  await user.type(field('University Email'), 'nada.officer@esme-cu.edu');
  await user.type(field('Username'), 'nada.officer');
  await user.type(field('Password'), PASSWORD);
  await user.type(field('Confirm password'), PASSWORD);
  await user.selectOptions(field('Academic Year'), ACADEMIC_YEAR_OPTIONS[1]);
  await user.selectOptions(field('Department'), DEPARTMENT_OPTIONS[0]);
  await user.click(noRadio());
  await user.click(field('Agreement to Chapter Policies & Code of Conduct'));
  await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));
}

describe('the signup form', () => {
  it('asks for an identity, two academic questions, the membership question and the agreement', async () => {
    await renderPortal();

    for (const name of ASKED) expect(field(name)).toBeTruthy();
    for (const name of ['Username', 'Password', 'Confirm password']) expect(field(name)).toBeTruthy();
    expect(TL.screen.getByRole('radiogroup', { name: /Are you a member of a committee/ })).toBeTruthy();
    for (const name of NOT_ASKED) noField(name);
  });

  it('offers the published committees, High Board included, as the only choices', async () => {
    await renderPortal();
    const values = Array.from(committeeSelect().options).map((o) => o.value).filter(Boolean);
    const open = REFERENCE_COMMITTEES.filter((c) => c.status === 'active' && c.isPublic);
    expect(values).toEqual(open.map((c) => c.id));
    expect(values).toContain('comm_high_board');
    expect(committeeSelect().textContent).toContain('High Board (HB)');
  });

  it('files an application that carries what the applicant was asked and nothing else', async () => {
    const { user } = await renderPortal();
    await fillNonMember(user);

    await TL.waitFor(() => expect(TL.screen.getByText('Application received')).toBeTruthy());

    const [row] = filed();
    expect(row.fullName).toBe('Nada Officer');
    expect(row.universityEmail).toBe('nada.officer@esme-cu.edu');
    expect(row.agreedToPolicies).toBe(true);
    expect(row.status).toBe('pending');
    expect(row.academicYear).toBe(ACADEMIC_YEAR_OPTIONS[1]);
    expect(row.department).toBe(DEPARTMENT_OPTIONS[0]);
    expect(row.committeeMembership).toBe('no');
    // Nothing was prefilled. An applicant who was never asked for a student ID is not recorded as
    // having given one, and a reviewer sees an empty row rather than a plausible lie.
    for (const key of ['studentId', 'phone', 'secondCommitteePreferenceId', 'technicalSkills', 'previousExperience', 'motivation', 'availabilityHours'] as const) {
      expect(row[key]).toBeUndefined();
    }
    expect(row.preferredCommitteeId).toBe('');
  });

  it('asks which committee someone who already belongs to one is in', async () => {
    const { user } = await renderPortal();
    await user.type(field('Full Name'), 'Youssef Adel');
    await user.type(field('University Email'), 'youssef.adel@esme-cu.edu');
    await user.type(field('Username'), 'youssef.adel');
    await user.type(field('Password'), PASSWORD);
    await user.type(field('Confirm password'), PASSWORD);
    await user.selectOptions(field('Academic Year'), ACADEMIC_YEAR_OPTIONS[2]);
    await user.selectOptions(field('Department'), DEPARTMENT_OPTIONS[1]);
    await user.click(yesRadio());
    await user.selectOptions(committeeSelect(), 'comm_high_board');
    await user.click(field('Agreement to Chapter Policies & Code of Conduct'));
    await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));

    await TL.waitFor(() => expect(filed().length).toBe(1));
    const [row] = filed();
    expect(row.committeeMembership).toBe('yes');
    expect(row.preferredCommitteeId).toBe('comm_high_board');
    // A request to join a committee is not an assignment: nothing here is approved on the device.
    expect(row.assignedCommitteeId).toBeUndefined();
  });

  it('stops asking which committee once the applicant says they are not on one', async () => {
    const { user } = await renderPortal();
    await user.click(yesRadio());
    expect(committeeSelect().value).toBe('');
    await user.selectOptions(committeeSelect(), 'comm_mc');
    await user.click(noRadio());
    expect(TL.screen.queryByLabelText(label('Primary Committee Preference'))).toBeNull();
  });

  it('forgets a committee named before the applicant changed their mind', async () => {
    const { user } = await renderPortal();
    await user.type(field('Full Name'), 'Hana Saleh');
    await user.type(field('University Email'), 'hana.saleh@esme-cu.edu');
    await user.type(field('Username'), 'hana.saleh');
    await user.type(field('Password'), PASSWORD);
    await user.type(field('Confirm password'), PASSWORD);
    await user.selectOptions(field('Academic Year'), ACADEMIC_YEAR_OPTIONS[0]);
    await user.selectOptions(field('Department'), DEPARTMENT_OPTIONS[0]);
    await user.click(yesRadio());
    await user.selectOptions(committeeSelect(), 'comm_mc');
    await user.click(noRadio());
    await user.click(field('Agreement to Chapter Policies & Code of Conduct'));
    await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));

    await TL.waitFor(() => expect(filed().length).toBe(1));
    // The stale choice is dropped rather than filed, so a reviewer never sees a membership the
    // applicant has just said they do not have. '' is this record's "no committee named".
    expect(filed()[0].preferredCommitteeId).toBe('');
    expect(filed()[0].committeeMembership).toBe('no');
  });

  it('offers no committee that is archived or kept off the homepage', async () => {
    const hidden = {
      ...REFERENCE_COMMITTEES[0],
      id: 'comm_old_tech',
      name: 'Technical Committee (2024)',
      status: 'archived' as const,
    };
    const privateOne = {
      ...REFERENCE_COMMITTEES[1],
      id: 'comm_internal',
      name: 'Internal Working Group',
      isPublic: false,
    };
    await renderPortal(REFERENCE_FORM_FIELDS, [hidden, privateOne, ...REFERENCE_COMMITTEES]);

    const values = Array.from(committeeSelect().options).map((o) => o.value);
    expect(values).not.toContain('comm_old_tech');
    expect(values).not.toContain('comm_internal');
    expect(committeeSelect().textContent).not.toContain('Technical Committee (2024)');
  });

  it('puts a field back on the page when the schema switches it on again', async () => {
    await renderPortal(
      REFERENCE_FORM_FIELDS.map((f) =>
        f.name === 'studentId' || f.name === 'motivation' ? { ...f, enabled: true } : f
      )
    );

    expect(field('Student ID')).toBeTruthy();
    expect(field('Motivation for Joining ESME CU')).toBeTruthy();
    noField('Phone Number (WhatsApp)');
  });

  it('records an answer the re-enabled field asked for', async () => {
    const { user } = await renderPortal(
      REFERENCE_FORM_FIELDS.map((f) => (f.name === 'studentId' ? { ...f, enabled: true } : f))
    );

    await user.type(field('Full Name'), 'Omar Fathy');
    await user.type(field('University Email'), 'omar.fathy@esme-cu.edu');
    await user.type(field('Student ID'), '2026-118842');
    await user.type(field('Username'), 'omar.fathy');
    await user.type(field('Password'), PASSWORD);
    await user.type(field('Confirm password'), PASSWORD);
    await user.selectOptions(field('Academic Year'), ACADEMIC_YEAR_OPTIONS[0]);
    await user.selectOptions(field('Department'), DEPARTMENT_OPTIONS[0]);
    await user.click(noRadio());
    await user.click(field('Agreement to Chapter Policies & Code of Conduct'));
    await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));

    await TL.waitFor(() => expect(filed().length).toBe(1));
    expect(filed()[0].studentId).toBe('2026-118842');
    expect(filed()[0].department).toBe(DEPARTMENT_OPTIONS[0]);
  });

  it('does not ask the membership question when the committee row is switched off', async () => {
    await renderPortal(REFERENCE_FORM_FIELDS.map((f) => (f.name === 'preferredCommitteeId' ? { ...f, enabled: false } : f)));

    expect(TL.screen.queryByRole('radiogroup', { name: /Are you a member of a committee/ })).toBeNull();
    noField('Primary Committee Preference');
  });
});

/**
 * A refused application has to say so at every field it refused.
 *
 * `validateRegistration()` returns a field-keyed map and the portal used to print
 * `Object.values(errors)[0]` in a banner, so an applicant who fixed the name learned about the
 * email only on the next click. The values below are non-empty and shaped so the browser's own
 * `type="email"` check passes, so what is being tested is the chapter's rules, not the platform's.
 */
describe('a refused application', () => {
  /**
   * The agreement box stays required under the shipped schema, but the form is `noValidate`, so the
   * chapter's own rules are what refuse it. Switching the schema requirement off here is what lets
   * these cases prove the store refuses an unchecked agreement on its own rules, not the row's.
   */
  const schema = REFERENCE_FORM_FIELDS.map((f) =>
    f.name === 'agreedToPolicies' ? { ...f, required: false } : f
  );

  /** The two questions that only have one right answer each, left at "not chosen". */
  const rejectEveryRule = async () => {
    const { user } = await renderPortal(schema);
    await user.type(field('Full Name'), 'Al');
    await user.type(field('University Email'), 'nada@esme-cu');
    await user.type(field('Username'), 'Nada!');
    await user.type(field('Password'), 'abc');
    await user.type(field('Confirm password'), 'ab');
    await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));
    const summary = await TL.screen.findByRole('alert');
    return { user, summary };
  };

  it('marks every rejected field in one pass, not one per click', async () => {
    const { summary } = await rejectEveryRule();
    // identity (5) + agreement + department + academic year + membership question
    expect(summary.textContent).toContain('9 details below need your attention');

    const messages = [
      /full name as it appears in chapter records/,
      /valid email address/,
      /3–30 characters/,
      /Password needs/,
      /Passwords do not match/,
      /Accept the privacy policy/,
      /Choose your department/,
      /Choose your academic year/,
      /whether you already belong to a committee/,
    ];
    for (const pattern of messages) expect(TL.screen.getByText(pattern)).toBeTruthy();
    // Nothing was filed: a refusal is a refusal at every level, not a partial write.
    expect(filed()).toEqual([]);
  });

  it('attaches each message to the control it belongs to', async () => {
    await rejectEveryRule();

    for (const [labelText, id] of [
      ['Full Name', 'reg-field-fullName'],
      ['University Email', 'reg-field-universityEmail'],
      ['Department', 'reg-field-department'],
      ['Academic Year', 'reg-field-academicYear'],
    ] as const) {
      const control = field(labelText);
      expect(control.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(`${id}-error`)?.textContent).toBeTruthy();
      expect(control.getAttribute('aria-describedby')).toBe(`${id}-error`);
    }
    const membership = TL.screen.getByRole('radiogroup', { name: /Are you a member of a committee/ });
    expect(membership.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('reg-field-committeeMembership-error')?.textContent).toBeTruthy();
    expect(field('Agreement to Chapter Policies & Code of Conduct').getAttribute('aria-invalid')).toBe('true');
  });

  it('clears only the complaint the applicant is answering', async () => {
    const { user } = await rejectEveryRule();

    await user.type(field('Full Name'), 'i');
    await TL.waitFor(() => expect(TL.screen.queryByText(/full name as it appears/)).toBeNull());

    expect(TL.screen.getByText(/valid email address/)).toBeTruthy();
    expect(TL.screen.getByText(/Passwords do not match/)).toBeTruthy();
    expect(TL.screen.getByText(/Choose your department/)).toBeTruthy();
  });

  it('refuses a yes with no committee named', async () => {
    const { user } = await renderPortal(schema);
    await user.type(field('Full Name'), 'Nada Officer');
    await user.type(field('University Email'), 'nada.officer@esme-cu.edu');
    await user.type(field('Username'), 'nada.officer');
    await user.type(field('Password'), PASSWORD);
    await user.type(field('Confirm password'), PASSWORD);
    await user.selectOptions(field('Academic Year'), ACADEMIC_YEAR_OPTIONS[0]);
    await user.selectOptions(field('Department'), DEPARTMENT_OPTIONS[0]);
    await user.click(yesRadio());
    await user.click(field('Agreement to Chapter Policies & Code of Conduct'));
    await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));

    expect((await TL.screen.findByRole('alert')).textContent).toContain('One detail below needs your attention');
    expect(TL.screen.getByText(/Choose the committee you belong to/)).toBeTruthy();
    expect(filed()).toEqual([]);
  });

  it('still refuses an unchecked agreement when the schema stopped requiring it', async () => {
    const { user } = await renderPortal(schema);
    await user.type(field('Full Name'), 'Nada Officer');
    await user.type(field('University Email'), 'nada.officer@esme-cu.edu');
    await user.type(field('Username'), 'nada.officer');
    await user.type(field('Password'), PASSWORD);
    await user.type(field('Confirm password'), PASSWORD);
    await user.click(TL.screen.getByRole('button', { name: /Submit Application/ }));

    // department, academic year, membership question and the agreement the store always demands
    expect((await TL.screen.findByRole('alert')).textContent).toContain('4 details below need your attention');
    expect(TL.screen.getByText(/Accept the privacy policy/)).toBeTruthy();
    expect(filed()).toEqual([]);
  });
});
