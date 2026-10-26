// @vitest-environment jsdom
/**
 * The members directory as a rendered surface, on top of the shared table primitive. The actor is
 * a real session from the development adapter and the rows are the accounts that session is allowed
 * to read plus the local profile rows merged in, so what these tests can prove is that a removal is
 * written to storage after the confirmation — not that the primitive pages correctly, which
 * `DataTable.test.tsx` already covers.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../../auth/types';
import type { User } from '../../types';

const PASSWORD = 'Str0ng#Directory1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const APPLICANT = { fullName: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };

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

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: AuthAdapter;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
  V2 = (await import('../../storage/migrations')).STORAGE_KEYS.v2;
});

/** jsdom reports no media queries, so the breakpoint the table switches on has to be stated. */
const stubViewport = (desktop: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

const storedProfiles = (): { id: string; name: string }[] =>
  JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as { id: string; name: string }[];

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  stubViewport(true);
  Element.prototype.scrollIntoView = () => {};
  (Element.prototype as unknown as { scrollTo: (options?: unknown) => void }).scrollTo = () => {};
  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([account('usr_nada', 'Nada Yehia')]));

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

/** Approves the applicant while the administrator holds the session. */
async function approveApplicant(committeeId?: string) {
  const registered = await adapter.register({
    ...APPLICANT,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptedPolicies: true,
  });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
  const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId });
  if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
}

async function renderDirectory() {
  const [{ AppProvider }, auth, { MemberManagement }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./MemberManagement'),
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
              <MemberManagement />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  return { user };
}

const rowNames = () =>
  Array.from(document.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('td')?.textContent ?? '');

describe('the directory an administrator reads', () => {
  it('lists the accounts the session can reach, one row each', async () => {
    await renderDirectory();
    expect(await TL.screen.findByRole('heading', { name: 'Members Directory' })).toBeTruthy();

    // The local profile row and the bootstrapped admin account; nothing else is invented.
    await TL.waitFor(() => expect(rowNames().length).toBe(2));
    expect(TL.screen.getByText('Kareem Tamer')).toBeTruthy();
    expect(TL.screen.getByText('Nada Yehia')).toBeTruthy();
    expect(TL.screen.getByText(/2 accounts visible to you/)).toBeTruthy();
  });

  it('protects the primary administrator row from removal', async () => {
    await renderDirectory();
    const nadaRow = (await TL.screen.findByText('Nada Yehia')).closest('tr') as HTMLElement;
    const adminRow = (await TL.screen.findByText('Kareem Tamer')).closest('tr') as HTMLElement;

    // The signed-in account offers no removal at all; the other privileged account has it disabled.
    expect(nadaRow.querySelector('button[aria-label="Remove from directory"]')).toBeTruthy();
    expect(adminRow.querySelector('button[aria-label="Remove from directory"]')).toBeNull();
  });

  it("offers no role control on the administrator's own record and the whole control on another", async () => {
    const { user } = await renderDirectory();
    const adminRow = (await TL.screen.findByText('Kareem Tamer')).closest('tr') as HTMLElement;
    const nadaRow = (await TL.screen.findByText('Nada Yehia')).closest('tr') as HTMLElement;

    await user.click(adminRow.querySelector('button[aria-label="Open record"]') as HTMLElement);
    const block = (await TL.screen.findByText('Change role')).parentElement as HTMLElement;
    // The panel states the rule rather than offering a click the store refuses anyway.
    expect(block.textContent).toContain('decided by another Super Admin');
    expect(TL.screen.queryByRole('combobox', { name: 'Next role' })).toBeNull();

    await user.click(nadaRow.querySelector('button[aria-label="Open record"]') as HTMLElement);
    await TL.waitFor(() =>
      expect(TL.screen.queryByRole('combobox', { name: 'Next role' })).toBeTruthy()
    );
  });

  it('offers only the next states and files nothing until one is chosen', async () => {
    await approveApplicant('comm_te');
    const { user } = await renderDirectory();
    const row = (await TL.screen.findByText(APPLICANT.fullName)).closest('tr') as HTMLElement;
    await user.click(row.querySelector('button[aria-label="Open record"]') as HTMLElement);

    const state = (await TL.screen.findByLabelText('Next account state')) as HTMLSelectElement;
    // The state the account already holds is not a target, so the control opens on the placeholder
    // instead of on a value its own option list does not contain.
    expect(state.value).toBe('');
    expect(Array.from(state.options).map((o) => o.value)).toEqual(['', 'suspended']);
    const apply = TL.within(state.parentElement as HTMLElement).getByRole('button', {
      name: 'Apply',
    }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    await user.selectOptions(state, 'suspended');
    expect(apply.disabled).toBe(false);
    await user.click(apply);

    await TL.waitFor(() => {
      const profiles = JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[];
      expect(profiles.find((p) => p.email === APPLICANT.email)?.status).toBe('suspended');
    });
  });

  it('writes nothing until the confirmation is accepted', async () => {
    const { user } = await renderDirectory();
    await TL.screen.findByRole('button', { name: 'Remove from directory' });
    await TL.waitFor(() => expect(storedProfiles().some((p) => p.id === 'usr_nada')).toBe(true));

    await user.click(TL.screen.getByRole('button', { name: 'Remove from directory' }));
    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Nada Yehia');

    // Refusing the confirmation is not a write: the row stays in storage and on screen.
    await user.click(TL.within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(storedProfiles().some((p) => p.id === 'usr_nada')).toBe(true);
    expect(await TL.screen.findByText('Nada Yehia')).toBeTruthy();
  });

  it('drops the account from storage after the confirmation, and releases nothing else', async () => {
    const { user } = await renderDirectory();
    await TL.screen.findByRole('button', { name: 'Remove from directory' });
    await user.click(TL.screen.getByRole('button', { name: 'Remove from directory' }));
    const dialog = await TL.screen.findByRole('dialog');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Remove' }));

    await TL.waitFor(() => expect(storedProfiles().some((p) => p.id === 'usr_nada')).toBe(false));
    expect(TL.screen.queryByText('Nada Yehia')).toBeNull();
    expect(storedProfiles().some((p) => p.name === 'Kareem Tamer')).toBe(true);
  });

  it('searches across the accounts it was given', async () => {
    const { user } = await renderDirectory();
    await TL.screen.findByRole('button', { name: 'Remove from directory' });
    await user.type(
      TL.screen.getByRole('searchbox', { name: 'Search by name, email, or username...' }),
      'kareem'
    );
    await TL.waitFor(() => expect(rowNames().length).toBe(1));
    expect(rowNames()[0]).toContain('Kareem Tamer');
    expect(TL.screen.queryByText('Nada Yehia')).toBeNull();
  });

  it('renders the same accounts as cards on a narrow screen', async () => {
    stubViewport(false);
    await renderDirectory();
    await TL.waitFor(() => expect(document.querySelectorAll('ul > li').length).toBe(2));
    expect(document.querySelector('table')).toBeNull();
    const cards = document.querySelectorAll('ul > li');
    expect(Array.from(cards).some((card) => card.textContent?.includes('Nada Yehia'))).toBe(true);
    // A card prints the column labels the table keeps in its header.
    expect(TL.screen.getAllByText('Account State').length).toBeGreaterThan(0);
  });
});

/**
 * The two academic answers the signup form now asks, read and written from a profile.
 *
 * A directory row is the record an officer trusts, so the rule here is the one the whole feature
 * runs on: a value nobody gave reads as missing, a value a build invented never appears, and a value
 * an older account carries stays selectable even when the chapter's list has moved on without it.
 */
describe('the academic answers on a profile', () => {
  const profiles = () => JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[];

  it('reads an account that never gave them as unrecorded rather than as a guess', async () => {
    const { user } = await renderDirectory();
    const nadaRow = (await TL.screen.findByText('Nada Yehia')).closest('tr') as HTMLElement;
    // The directory prints the em dash this build uses for "not recorded", never an invented year.
    expect(nadaRow.textContent).toContain('—');
    expect(nadaRow.textContent).not.toContain('Sophomore');
    expect(nadaRow.textContent).not.toContain('Metallurgical & Materials Engineering');

    await user.click(nadaRow.querySelector('button[aria-label="Open record"]') as HTMLElement);
    const year = (await TL.screen.findByLabelText('Academic Year')) as HTMLSelectElement;
    const department = (await TL.screen.findByLabelText('Department')) as HTMLSelectElement;
    expect(year.value).toBe('');
    expect(department.value).toBe('');
    expect(year.options[year.selectedIndex].textContent).toBe('Not recorded');
  });

  it('saves the year and department chosen from the lists the signup form offers', async () => {
    const { user } = await renderDirectory();
    const nadaRow = (await TL.screen.findByText('Nada Yehia')).closest('tr') as HTMLElement;
    await user.click(nadaRow.querySelector('button[aria-label="Open record"]') as HTMLElement);

    await user.selectOptions(await TL.screen.findByLabelText('Academic Year'), 'Senior II');
    await user.selectOptions(await TL.screen.findByLabelText('Department'), 'Mechanical Design & Production');
    await user.click(TL.screen.getByRole('button', { name: 'Save Profile' }));

    await TL.waitFor(() =>
      expect(
        profiles().find((p) => p.id === 'usr_nada')?.academicYear === 'Senior II' &&
          profiles().find((p) => p.id === 'usr_nada')?.department === 'Mechanical Design & Production'
      ).toBe(true)
    );
  });

  it('keeps a value an older account carries selectable instead of rewriting it', async () => {
    localStorage.setItem(
      `${V2}userProfiles`,
      JSON.stringify([account('usr_nada', 'Nada Yehia', { academicYear: 'Third Year', department: 'Mechatronics' })])
    );
    const { user } = await renderDirectory();
    const nadaRow = (await TL.screen.findByText('Nada Yehia')).closest('tr') as HTMLElement;
    await user.click(nadaRow.querySelector('button[aria-label="Open record"]') as HTMLElement);

    const year = (await TL.screen.findByLabelText('Academic Year')) as HTMLSelectElement;
    // Neither value is on this build's list, and neither is dropped to make the row tidy.
    expect(year.value).toBe('Third Year');
    expect(Array.from(year.options).map((o) => o.value)).toContain('Third Year');
    expect((await TL.screen.findByLabelText('Department') as HTMLSelectElement).value).toBe('Mechatronics');

    await user.click(TL.screen.getByRole('button', { name: 'Save Profile' }));
    await TL.waitFor(() => expect(profiles().find((p) => p.id === 'usr_nada')?.academicYear).toBe('Third Year'));
  });

  it('starts a new member with nothing recorded until the officer chooses', async () => {
    const { user } = await renderDirectory();
    await TL.screen.findByText('Nada Yehia');
    await user.click(TL.screen.getByRole('button', { name: 'Provision Member' }));

    const dialog = await TL.screen.findByRole('dialog');
    // An earlier build prefilled "Sophomore" and one department as if the officer had chosen them.
    expect((TL.within(dialog).getByLabelText('Academic Year') as HTMLSelectElement).value).toBe('');
    expect((TL.within(dialog).getByLabelText('Department') as HTMLSelectElement).value).toBe('');
  });
});

describe('the directory a member reads', () => {
  it('offers no provisioning control and no row actions', async () => {
    await approveApplicant('comm_te');
    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);
    await renderDirectory();

    expect(await TL.screen.findByRole('heading', { name: 'Members Directory' })).toBeTruthy();
    expect(await TL.screen.findByText('This directory is not available to your role')).toBeTruthy();
    expect(rowNames()).toHaveLength(0);
    expect(TL.screen.queryByRole('button', { name: /Provision Member/i })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: 'Remove from directory' })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: 'Open record' })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: 'Award bonus' })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: 'Issue warning' })).toBeNull();
  });
});

/**
 * The roster is the read scope, not the browser cache. A committee-scoped officer is shown their
 * own committee (and their own row) and nothing else; the committee filter offers only the
 * committees that scope makes reachable, so a select cannot name a committee the provider would
 * refuse to return.
 */
describe('the directory a committee officer reads', () => {
  async function signInAsDirector() {
    await approveApplicant('comm_te');
    const accounts = await adapter.listAccounts();
    const applicant = accounts.find((a) => a.email === APPLICANT.email);
    if (!applicant) throw new Error('the approved applicant is not in the provider directory');
    const promoted = await adapter.assignRole(applicant.id, 'director');
    if (!promoted.ok) throw new Error(`role change refused: ${promoted.error.code}`);
    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);
  }

  it('shows its own committee and hides another committee entirely', async () => {
    localStorage.setItem(
      `${V2}userProfiles`,
      JSON.stringify([
        account('usr_nada', 'Nada Yehia'),
        account('usr_mc', 'Mina Media', { committeeId: 'comm_mc' }),
      ])
    );
    await signInAsDirector();
    await renderDirectory();

    await TL.waitFor(() => expect(rowNames().length).toBe(2));
    expect(TL.screen.getByText('Nada Yehia')).toBeTruthy();
    expect(TL.screen.getByText(APPLICANT.fullName)).toBeTruthy();
    expect(TL.screen.queryByText('Mina Media')).toBeNull();
    expect(TL.screen.getByText(/2 accounts in Technical & Engineering Committee/)).toBeTruthy();
    // The board and the unassigned administrator are not part of this committee's roster.
    expect(TL.screen.queryByText('Kareem Tamer')).toBeNull();
  });

  it('offers only the committees its scope can reach in the filter', async () => {
    await signInAsDirector();
    await renderDirectory();
    await TL.waitFor(() => expect(rowNames().length).toBeGreaterThan(0));

    const committeeFilter = TL.screen.getByRole('combobox', { name: 'Filter by committee' });
    const options = TL.within(committeeFilter).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['All Committees', 'Technical & Engineering Committee']);
  });
});

describe('directory filters', () => {
  it('narrows the roster by role and by sub-team without leaving the visible set', async () => {
    localStorage.setItem(
      `${V2}userProfiles`,
      JSON.stringify([
        account('usr_nada', 'Nada Yehia', { subTeam: 'NDT & Inspection' }),
        account('usr_ai', 'Aya AI', { subTeam: 'Materials Testing & AI' }),
        account('usr_other', 'Other Committee', { committeeId: 'comm_mc' }),
      ])
    );
    const { user } = await renderDirectory();
    await TL.waitFor(() => expect(rowNames().length).toBe(4)); // three profiles plus the administrator

    const roleFilter = TL.screen.getByRole('combobox', { name: 'Filter by role' });
    await user.selectOptions(roleFilter, 'super_admin');
    await TL.waitFor(() => expect(rowNames().length).toBe(1));
    expect(rowNames()[0]).toContain('Kareem Tamer');

    await user.selectOptions(roleFilter, 'member');
    const subTeamFilter = await TL.screen.findByRole('combobox', { name: 'Filter by sub-team' });
    // The sub-team list is derived from the rows in scope, not from every committee's teams.
    const teams = TL.within(subTeamFilter).getAllByRole('option').map((o) => o.textContent);
    expect(teams).toEqual(['All Sub-teams', 'Materials Testing & AI', 'NDT & Inspection']);

    await user.selectOptions(subTeamFilter, 'NDT & Inspection');
    await TL.waitFor(() => expect(rowNames().length).toBe(1));
    expect(rowNames()[0]).toContain('Nada Yehia');
    expect(TL.screen.queryByText('Aya AI')).toBeNull();
  });
});

/**
 * The inline bonus and warning controls sit on the person's own row. What a row offers is the
 * store's rule read backwards: the same self, rank, High Board and committee checks decide both
 * whether the button exists and whether the write would be accepted, so no row shows a dead action.
 */
describe('the inline bonus and warning controls', () => {
  const rewardEntries = () =>
    JSON.parse(localStorage.getItem(`${V2}rewardEntries`) ?? '[]') as {
      kind: string;
      targetId: string;
      points: number;
      severity?: string;
      reason: string;
      idempotencyKey: string;
    }[];

  const rowFor = async (name: string) => {
    const cell = await TL.screen.findByText(name);
    return cell.closest('tr') as HTMLElement;
  };

  it('offers both actions on a junior row and neither on the administrator\'s own row', async () => {
    await renderDirectory();
    const nadaRow = await rowFor('Nada Yehia');
    const adminRow = await rowFor('Kareem Tamer');

    expect(nadaRow.querySelector('button[aria-label="Award bonus"]')).toBeTruthy();
    expect(nadaRow.querySelector('button[aria-label="Issue warning"]')).toBeTruthy();
    // Nobody awards themselves, and a superior is not a target either.
    expect(adminRow.querySelector('button[aria-label="Award bonus"]')).toBeNull();
    expect(adminRow.querySelector('button[aria-label="Issue warning"]')).toBeNull();
  });

  it('keeps the warning action and drops the bonus action on a High Board row', async () => {
    localStorage.setItem(
      `${V2}userProfiles`,
      JSON.stringify([
        account('usr_nada', 'Nada Yehia'),
        account('usr_board', 'Salma Reda', { role: 'high_board', committeeId: undefined }),
      ])
    );
    await renderDirectory();
    const boardRow = await rowFor('Salma Reda');

    expect(boardRow.querySelector('button[aria-label="Issue warning"]')).toBeTruthy();
    expect(boardRow.querySelector('button[aria-label="Award bonus"]')).toBeNull();
  });

  it('records a bonus against the row it was opened from and updates the points on screen', async () => {
    const { user } = await renderDirectory();
    const nadaRow = await rowFor('Nada Yehia');
    await user.click(nadaRow.querySelector('button[aria-label="Award bonus"]') as HTMLElement);

    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Award a bonus to Nada Yehia');
    const points = TL.within(dialog).getByLabelText('Bonus points');
    await user.clear(points);
    await user.type(points, '12');
    await user.type(
      TL.within(dialog).getByLabelText('Reason (mandatory)'),
      'Ran the NDT workshop for the first-year cohort'
    );
    await user.click(TL.within(dialog).getByRole('button', { name: 'Record bonus' }));

    await TL.waitFor(() => expect(TL.screen.queryByRole('dialog')).toBeNull());
    expect(TL.screen.getByText(/12 bonus points recorded for Nada Yehia/)).toBeTruthy();
    // The row is re-read from the store, not guessed from the form.
    await TL.waitFor(() => expect(TL.screen.getByText('Nada Yehia').closest('tr')?.textContent).toContain('12'));
    await TL.waitFor(() => {
      const entry = rewardEntries().find((e) => e.targetId === 'usr_nada');
      expect(entry).toMatchObject({ kind: 'bonus', points: 12, reason: 'Ran the NDT workshop for the first-year cohort' });
    });
  });

  it('records a warning without moving points, after asking for a reason', async () => {
    const { user } = await renderDirectory();
    const nadaRow = await rowFor('Nada Yehia');
    await user.click(nadaRow.querySelector('button[aria-label="Issue warning"]') as HTMLElement);

    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Issue a warning to Nada Yehia');
    // An empty reason is refused before the provider is asked, so the submit stays disabled.
    expect((TL.within(dialog).getByRole('button', { name: 'Record warning' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(TL.within(dialog).getByLabelText('Severity'), 'formal');
    await user.type(TL.within(dialog).getByLabelText('Reason (mandatory)'), 'Missed the committee meeting without notice');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Record warning' }));

    await TL.waitFor(() => expect(TL.screen.queryByRole('dialog')).toBeNull());
    expect(TL.screen.getByText(/Formal warning recorded for Nada Yehia/)).toBeTruthy();
    await TL.waitFor(() => {
      const entry = rewardEntries().find((e) => e.targetId === 'usr_nada');
      expect(entry).toMatchObject({
        kind: 'warning',
        severity: 'formal',
        reason: 'Missed the committee meeting without notice',
      });
    });
    // No bonus was written and no points moved.
    expect(rewardEntries().some((e) => e.kind === 'bonus')).toBe(false);
  });

  it('keeps the form from submitting a bonus above the per-action cap', async () => {
    const { user } = await renderDirectory();
    const nadaRow = await rowFor('Nada Yehia');
    await user.click(nadaRow.querySelector('button[aria-label="Award bonus"]') as HTMLElement);

    const dialog = await TL.screen.findByRole('dialog');
    const points = TL.within(dialog).getByLabelText('Bonus points');
    await user.clear(points);
    await user.type(points, '30');
    await user.type(TL.within(dialog).getByLabelText('Reason (mandatory)'), 'A very large favour');

    // The store's answer is visible before the click, not only in a toast afterwards.
    expect(TL.within(dialog).getByText(/Blocked: The limit is 25 points per action/)).toBeTruthy();
    expect((TL.within(dialog).getByRole('button', { name: 'Record bonus' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
