// @vitest-environment jsdom
/**
 * The recruitment queue as a rendered surface. The applicant rows come from the development
 * adapter's own vault, so a test can tell apart "this account may read the queue" from "this
 * account may decide an application", and can prove that a decision reaches storage only through
 * the dialog that records the reason alongside it.
 *
 * Note on dialogs: jsdom never fires requestAnimationFrame, so a closed ModalShell stays mounted
 * mid-exit. Every lookup therefore picks the dialog by the text it holds rather than by index.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../../auth/types';
import type { RegistrationApplication, User } from '../../types';

const PASSWORD = 'Str0ng#Recruit1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const APPLICANT = { fullName: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };
const REVIEWER = { fullName: 'Nada Yehia', email: 'nada.yehia@esme-cu.edu', username: 'nada.yehia' };

const account = (id: string, name: string, over: Partial<User> = {}): User => ({
  id,
  name,
  email: `${id}@esme.test`,
  username: id,
  role: 'member',
  status: 'active',
  committeeId: 'comm_te',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
  ...over,
});

const cachedApplication = (over: Partial<RegistrationApplication> = {}): RegistrationApplication => ({
  id: 'app_cached_1',
  fullName: APPLICANT.fullName,
  universityEmail: APPLICANT.email,
  studentId: '20210077',
  academicYear: 'Third Year',
  department: 'Mechanical Engineering',
  phone: '01000000001',
  preferredCommitteeId: 'comm_te',
  technicalSkills: 'SolidWorks',
  previousExperience: 'None',
  motivation: 'Wants to run the NDT track.',
  availabilityHours: '8 hours weekly',
  agreedToPolicies: true,
  appliedDate: '2026-02-11 10:04',
  status: 'pending',
  ...over,
});

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: AuthAdapter;
let promptSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
  V2 = (await import('../../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([account('usr_nada', 'Nada Yehia')]));
  // A rejection reason used to be typed into window.prompt, where a dismissal discarded it.
  promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => {
  TL.cleanup();
  promptSpy.mockRestore();
});

/** Registers an applicant without approving them, so the queue has something to decide. */
async function queueApplicant(
  who = APPLICANT,
  committeeId = 'comm_te',
  academic: Partial<Record<'studentId' | 'academicYear' | 'department' | 'phone' | 'committeeMembership', string>> = {}
) {
  const registered = await adapter.register({
    ...who,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptedPolicies: true,
    committeeId,
    ...academic,
  });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
}

/** A signed-in account at the given rank, made by approving an applicant and promoting it. */
async function signInAs(who: typeof ADMIN, role: 'high_board' | 'director' | 'member') {
  const registered = await adapter.register({
    ...who,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptedPolicies: true,
    committeeId: 'comm_te',
  });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
  const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
  if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
  if (role !== 'member') {
    const directory = await adapter.listAccounts();
    const found = directory.find((row) => row.email === who.email);
    if (!found) throw new Error('the approved account is not in the directory');
    const promoted = await adapter.assignRole(found.id, role);
    if (!promoted.ok) throw new Error(`promotion refused: ${promoted.error.code} — ${promoted.error.message}`);
  }
  await adapter.signOut();
  await adapter.signIn(who.email, PASSWORD);
}

async function renderQueue() {
  const [{ AppProvider }, auth, { RegistrationManager }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./RegistrationManager'),
    import('../../motion'),
    import('motion/react'),
  ]);

  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <Gate>
              <RegistrationManager />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  return { user };
}

const storedApps = (): RegistrationApplication[] =>
  JSON.parse(localStorage.getItem(`${V2}applications`) ?? '[]') as RegistrationApplication[];

const appRow = (name: string) => storedApps().find((a) => a.fullName === name);

async function dialogHolding(text: string): Promise<HTMLElement> {
  await TL.waitFor(() => {
    const found = TL.screen.getAllByRole('dialog').find((d) => d.textContent?.includes(text));
    expect(found ?? null).not.toBeNull();
  });
  return TL.screen.getAllByRole('dialog').find((d) => d.textContent?.includes(text)) as HTMLElement;
}

describe('the queue a decision-maker reads', () => {
  it('lists the applicant the provider holds and says where the list came from', async () => {
    await queueApplicant();
    await renderQueue();

    expect(await TL.screen.findByRole('heading', { name: 'Recruitment & Application Manager' })).toBeTruthy();
    expect(await TL.screen.findByText(APPLICANT.fullName)).toBeTruthy();
    expect(TL.screen.getByText(/Queue read from the .* provider/)).toBeTruthy();
    expect(TL.screen.getByText('Applications (1)')).toBeTruthy();
  });

  it('separates what an applicant asked for from the seat a reviewer assigns', async () => {
    await queueApplicant(APPLICANT, 'comm_high_board', {
      committeeMembership: 'yes',
      academicYear: 'Junior',
      department: 'Mechanical Design & Production',
    });
    await renderQueue();
    await TL.screen.findByText(APPLICANT.fullName);

    expect(TL.screen.getByText('Yes — says they already belong to a committee')).toBeTruthy();
    // The committee named on the form is readable, and it is still only a request.
    expect(TL.screen.getByText('High Board')).toBeTruthy();
    expect(TL.screen.getByText('Junior')).toBeTruthy();
    expect(TL.screen.getByText(/Mechanical Design & Production/)).toBeTruthy();
    expect(document.querySelector('button[title="Approve and activate the account"]')).toBeTruthy();
    expect(appRow(APPLICANT.fullName)?.assignedCommitteeId).toBeUndefined();
  });

  it('says so when an application predates the questions this build asks', async () => {
    // An applicant registered before the academic schema shipped, read by a reviewer today.
    await queueApplicant();
    await renderQueue();
    await TL.screen.findByText(APPLICANT.fullName);

    expect(TL.screen.getByText('Not recorded — this application predates the question')).toBeTruthy();
    // Nothing is invented to fill the gap: no year line rather than a plausible one.
    expect(TL.screen.queryByText(/^Year:/)).toBeNull();
  });

  it('shows a non-member as a non-member, with no committee named', async () => {
    await queueApplicant(APPLICANT, '', { committeeMembership: 'no', academicYear: 'Freshman' });
    await renderQueue();
    await TL.screen.findByText(APPLICANT.fullName);

    expect(TL.screen.getByText('No — not a member of a committee yet')).toBeTruthy();
    expect(TL.screen.getByText('No committee named')).toBeTruthy();
    expect(TL.screen.getByText('Freshman')).toBeTruthy();
  });

  it('records a rejection only with a reason, and never through a browser prompt', async () => {
    await queueApplicant();
    const { user } = await renderQueue();
    await TL.screen.findByText(APPLICANT.fullName);

    await user.click(document.querySelector('button[title="Record a rejection"]') as HTMLElement);
    const dialog = await dialogHolding('Reject ' + APPLICANT.fullName);
    expect(promptSpy).not.toHaveBeenCalled();

    const submit = TL.within(dialog).getByRole('button', { name: 'Record rejection' });
    // An empty reason is refused before the write, not discovered after it.
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(appRow(APPLICANT.fullName)?.status).not.toBe('rejected');

    await user.type(
      TL.within(dialog).getByRole('textbox', { name: /Reason for rejection/ }),
      'No availability inside the recruitment window.'
    );
    await TL.waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await user.click(submit);

    await TL.waitFor(() => expect(appRow(APPLICANT.fullName)?.status).toBe('rejected'));
    expect(appRow(APPLICANT.fullName)?.internalNotes).toBe('No availability inside the recruitment window.');
    expect(TL.screen.getAllByText('rejected').length).toBeGreaterThan(0);
  });

  it('files the committee the reviewer chooses together with the approval', async () => {
    await queueApplicant();
    const { user } = await renderQueue();
    await TL.screen.findByText(APPLICANT.fullName);

    await user.click(TL.screen.getByRole('button', { name: 'Accept' }));
    const dialog = await dialogHolding('Approve ' + APPLICANT.fullName);
    await user.selectOptions(TL.within(dialog).getByRole('combobox', { name: /Committee seat/ }), 'comm_mc');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Approve and activate' }));

    await TL.waitFor(() => expect(appRow(APPLICANT.fullName)?.status).toBe('accepted'));
    expect(appRow(APPLICANT.fullName)?.assignedCommitteeId).toBe('comm_mc');
  });

  it('leaves a decided applicant with no further decision to make', async () => {
    await queueApplicant();
    const { user } = await renderQueue();
    await TL.screen.findByText(APPLICANT.fullName);

    await user.click(TL.screen.getByRole('button', { name: 'Accept' }));
    const dialog = await dialogHolding('Approve ' + APPLICANT.fullName);
    await user.click(TL.within(dialog).getByRole('button', { name: 'Approve and activate' }));
    await TL.waitFor(() => expect(appRow(APPLICANT.fullName)?.status).toBe('accepted'));

    // A decided applicant keeps the row, but the control that could reopen it is inert.
    expect(TL.screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    const reject = document.querySelector('button[title="Record a rejection"]') as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
  });

  it('edits the registration schema when the CMS settings capability is held', async () => {
    const { user } = await renderQueue();
    await user.click(await TL.screen.findByRole('button', { name: 'Form Schema Builder' }));

    expect(await TL.screen.findByRole('heading', { name: 'Registration Field Schema' })).toBeTruthy();
    expect(TL.screen.getByRole('button', { name: 'Save Schema Changes' })).toBeTruthy();
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => !box.disabled)).toBe(true);
  });
});

describe('the queue a reader without decision power sees', () => {
  it('lists applicants but offers no decision control', async () => {
    await queueApplicant();
    await signInAs(REVIEWER, 'high_board');
    const { user } = await renderQueue();

    expect(await TL.screen.findByText(APPLICANT.fullName)).toBeTruthy();
    expect(TL.screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(document.querySelector('button[title="Record a rejection"]')).toBeNull();

    await user.click(TL.screen.getByRole('button', { name: 'Full Profile' }));
    const dialog = await dialogHolding(APPLICANT.fullName);
    expect(TL.within(dialog).getByText(/holds no registration decision capability/)).toBeTruthy();
    expect(TL.within(dialog).queryByRole('button', { name: 'Waitlist' })).toBeNull();
    expect(TL.within(dialog).queryByRole('button', { name: 'Accept Candidate' })).toBeNull();
  });

  it('reads the schema but cannot edit or save it', async () => {
    await signInAs(REVIEWER, 'high_board');
    const { user } = await renderQueue();
    await user.click(await TL.screen.findByRole('button', { name: 'Form Schema Builder' }));

    expect(await TL.screen.findByRole('heading', { name: 'Registration Field Schema' })).toBeTruthy();
    expect(TL.screen.queryByRole('button', { name: 'Save Schema Changes' })).toBeNull();
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => box.disabled)).toBe(true);
  });

  it('narrows the queue to one committee for a committee-scoped reader', async () => {
    await queueApplicant(APPLICANT, 'comm_te');
    const OTHER = { fullName: 'Omar Design', email: 'omar.design@esme-cu.edu', username: 'omar.design' };
    await queueApplicant(OTHER, 'comm_design');

    // The reviewer account sits in comm_te, so the provider never hands over the other row.
    await signInAs(REVIEWER, 'director');
    await renderQueue();

    expect(await TL.screen.findByText(APPLICANT.fullName)).toBeTruthy();
    expect(TL.screen.queryByText(OTHER.fullName)).toBeNull();
  });
});

describe('the queue an account with no read capability opens', () => {
  it('prints a refusal instead of the applicant rows this browser cached', async () => {
    await queueApplicant();
    await signInAs(REVIEWER, 'member');
    // A cached queue is exactly what the capability gate has to survive.
    localStorage.setItem(`${V2}applications`, JSON.stringify([cachedApplication()]));
    await renderQueue();

    expect(await TL.screen.findByText('Applicant records are not open to this account')).toBeTruthy();
    expect(TL.screen.queryByText(APPLICANT.fullName)).toBeNull();
    expect(TL.screen.queryByText(/Queue read from the/)).toBeNull();
    expect(TL.screen.queryByRole('button', { name: /^Applications \(/ })).toBeNull();
  });
});
