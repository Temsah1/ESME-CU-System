// @vitest-environment jsdom
/**
 * The committee CMS exercised as a rendered surface, not as a unit: the store behind it is the
 * real AppProvider, the session is the real development adapter, and what the page writes is
 * read back out of browser storage by a second mount. The reported failures were a save that
 * did not stick and a leader name that did not follow the account, so these tests cross both.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PASSWORD = 'Str0ng#Committee1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

type StoredRow = {
  id: string;
  name: string;
  shortCode: string;
  description: string;
  category: string;
  status: string;
  objectives: string[];
  subTeams: string[];
  isPublic: boolean;
  directorId?: string;
  headId?: string;
  updatedAt?: string;
};

const row = (over: Partial<StoredRow>): StoredRow => ({
  id: 'comm_te',
  name: 'Technical & Engineering Committee',
  shortCode: 'TE',
  description: 'Technical workshops and summits.',
  category: 'technical',
  status: 'active',
  objectives: ['Deliver EMSC 2027'],
  subTeams: ['NDT & Inspection'],
  isPublic: true,
  ...over,
});

const COMMITTEES: StoredRow[] = [
  row({}),
  row({ id: 'comm_mc', name: 'Media & Content Committee', shortCode: 'MC', category: 'media' }),
];

const member = (id: string, name: string, email: string) => ({
  id,
  name,
  email,
  username: email.split('@')[0],
  role: 'member',
  status: 'active',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-01-01',
  lastActive: 'Never signed in',
});

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;

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
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};

  localStorage.setItem(
    `${V2}userProfiles`,
    JSON.stringify([member('usr_nada', 'Nada Yehia', 'nada@esme.test'), member('usr_omar', 'Omar Mohamed', 'omar@esme.test')])
  );
  localStorage.setItem(`${V2}committees`, JSON.stringify(COMMITTEES));

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  const adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

const stored = (): StoredRow[] => JSON.parse(localStorage.getItem(`${V2}committees`) ?? '[]');
const rowOf = (id: string) => stored().find((c) => c.id === id);

async function openPage() {
  const [{ AppProvider }, auth, { CommitteeManagement }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./CommitteeManagement'),
    import('../../motion'),
    import('motion/react'),
  ]);

  // The dashboard only renders for a restored session, exactly as RequireAuth guards it in the
  // app; mounting it a frame earlier would ask the store to act without an actor.
  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <Gate>
              <CommitteeManagement />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  await TL.screen.findByText('Technical & Engineering Committee');
  return userEvent.setup();
}

/** One committee card, so a name printed twice on the page is not mistaken for one print. */
const card = (name: string) => {
  const element = TL.screen.getByText(name).closest('div.rounded-3xl');
  if (!element) throw new Error(`No committee card for ${name}`);
  return TL.within(element as HTMLElement);
};

/** The open modal that carries this heading, so two modals in the document are not merged. */
async function findDialog(title: string) {
  await TL.waitFor(() => {
    if (!openDialogWithTitle(title)) throw new Error(`No dialog titled ${title}`);
  });
  return TL.within(openDialogWithTitle(title) as HTMLElement);
}

const openDialogWithTitle = (title: string) =>
  Array.from(document.querySelectorAll('[role="dialog"]')).find((element) => element.textContent?.includes(title));

/** The topmost open modal; a closing one may still be in the document mid-animation. */
const dialog = () => {
  const dialogs = TL.screen.getAllByRole('dialog');
  return TL.within(dialogs[dialogs.length - 1] as HTMLElement);
};

/** Opens a card's leadership modal and the account picker for the Director seat. */
async function openDirectorPicker(user: Awaited<ReturnType<typeof openPage>>, index = 0) {
  await user.click(TL.screen.getAllByRole('button', { name: 'Leadership & history' })[index]);
  await user.click((await TL.screen.findAllByRole('button', { name: 'Appoint' }))[0]);
  await dialog().findByLabelText('Search accounts to appoint as Director');
  return TL.screen.getByRole('dialog');
}

const appointButtonIn = (li: Element) => li.querySelector('button') as HTMLButtonElement;

/**
 * Each case signs in through the local-dev vault, which derives a PBKDF2 hash at 210,000
 * iterations three times over — bootstrap, the restore() probe and signIn — and the full run
 * starts one worker per file, so this file's share of the CPU is a fraction of what it gets
 * alone. The default 5s was exceeded by a case that passes in isolation.
 */
describe('committee CMS', { timeout: 20_000 }, () => {
  it('shows both seats as unassigned while no account holds them', async () => {
    await openPage();
    expect(card('Technical & Engineering Committee').getAllByText('Unassigned')).toHaveLength(2);
    expect(card('Media & Content Committee').getAllByText('Unassigned')).toHaveLength(2);
  });

  it('edits every stored field and reads the same row back after the page is remounted', async () => {
    const user = await openPage();

    await user.click(TL.screen.getByLabelText('Edit Technical & Engineering Committee'));
    const field = (label: string) => dialog().getByLabelText(label) as HTMLTextAreaElement | HTMLSelectElement;

    await user.clear(field('Description and scope'));
    await user.type(field('Description and scope'), 'Runs the NDT track and the quarterly scientific review.');
    await user.clear(field('Objectives — one per line'));
    await user.type(field('Objectives — one per line'), 'Deliver EMSC 2027\nRun four NDT workshops');
    await user.clear(field('Sub-teams — one per line'));
    await user.type(field('Sub-teams — one per line'), 'NDT & Inspection\nAutomation & AI');
    await user.selectOptions(field('Category'), 'operations');
    await user.click(dialog().getByRole('button', { name: 'Save changes' }));

    expect(rowOf('comm_te')?.description).toBe('Runs the NDT track and the quarterly scientific review.');
    expect(rowOf('comm_te')?.objectives).toEqual(['Deliver EMSC 2027', 'Run four NDT workshops']);
    expect(rowOf('comm_te')?.subTeams).toEqual(['NDT & Inspection', 'Automation & AI']);
    expect(rowOf('comm_te')?.category).toBe('operations');

    TL.cleanup();
    await openPage();
    const body = card('Technical & Engineering Committee');
    expect(body.getByText('Runs the NDT track and the quarterly scientific review.')).toBeTruthy();
    expect(body.getByText('operations')).toBeTruthy();
    expect(body.getByText('Automation & AI')).toBeTruthy();
  });

  it('refuses an unusable acronym, points at the field, and leaves the stored row untouched', async () => {
    const user = await openPage();
    const before = JSON.stringify(stored());

    await user.click(TL.screen.getByLabelText('Edit Media & Content Committee'));
    const acronym = dialog().getByLabelText('Acronym') as HTMLInputElement;
    await user.clear(acronym);
    await user.type(acronym, '##');
    await user.click(dialog().getByRole('button', { name: 'Save changes' }));

    await dialog().findByText('The acronym is 2-8 characters: letters, digits and & . + / space.');
    expect(JSON.stringify(stored())).toBe(before);
  });

  it('seats a Director chosen from the directory, shows the account behind the seat, and leaves their role alone', async () => {
    const user = await openPage();

    await openDirectorPicker(user);
    await user.type(dialog().getByLabelText('Search accounts to appoint as Director'), 'nada');

    const candidate = await withinDialogText('Nada Yehia');
    expect(appointButtonIn(candidate).disabled).toBe(false);
    await user.click(appointButtonIn(candidate));

    await TL.waitFor(() => expect(rowOf('comm_te')?.directorId).toBe('usr_nada'));
    expect(await dialog().findByText(/nada@esme.test/)).toBeTruthy();
    expect(dialog().getByText(/Holds this seat by committee record only\. Their Member access is unchanged\./)).toBeTruthy();

    const body = card('Technical & Engineering Committee');
    expect(body.getByText('Nada Yehia')).toBeTruthy();
    expect(body.getByText('Member · Active')).toBeTruthy();

    // The seat must not have promoted the account in the directory either.
    const profiles = JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as { id: string; role: string }[];
    expect(profiles.find((p) => p.id === 'usr_nada')?.role).toBe('member');
  });

  it('blocks a second seat for a person who already leads another committee', async () => {
    localStorage.setItem(
      `${V2}committees`,
      JSON.stringify([row({}), row({ id: 'comm_mc', name: 'Media & Content Committee', shortCode: 'MC', category: 'media', directorId: 'usr_omar' })])
    );
    const user = await openPage();

    await openDirectorPicker(user);
    await user.type(dialog().getByLabelText('Search accounts to appoint as Director'), 'omar');

    const candidate = await withinDialogText('Omar Mohamed');
    expect(candidate.textContent).toMatch(/already leads/);
    expect(appointButtonIn(candidate).disabled).toBe(true);
    expect(rowOf('comm_te')?.directorId).toBeUndefined();
  });

  it('clearing a seat leaves the committee unassigned instead of keeping a stale name', async () => {
    localStorage.setItem(`${V2}committees`, JSON.stringify([row({ headId: 'usr_nada' })]));
    const user = await openPage();
    expect(card('Technical & Engineering Committee').getByText('Nada Yehia')).toBeTruthy();

    await user.click(TL.screen.getByRole('button', { name: 'Leadership & history' }));
    await dialog().findByText('Nada Yehia');
    await user.click(dialog().getByRole('button', { name: 'Clear seat' }));

    await TL.waitFor(() => expect(rowOf('comm_te')?.headId).toBeUndefined());
    expect(dialog().getAllByText('Vacant — nobody is accountable for this seat.').length).toBeGreaterThan(0);

    await user.click(dialog().getByRole('button', { name: 'Close' }));
    expect(card('Technical & Engineering Committee').getAllByText('Unassigned')).toHaveLength(2);
  });

  it('creates a committee with vacant seats, reopens the form empty, and refuses a used acronym', async () => {
    localStorage.setItem(`${V2}committees`, JSON.stringify([row({})]));
    const user = await openPage();

    await user.click(TL.screen.getByRole('button', { name: /Create Committee/ }));
    const form = await findDialog('Create New Committee');
    await user.type(form.getByLabelText('Committee name'), 'Human Resources Committee');
    await user.type(form.getByLabelText('Acronym'), 'HR');
    await user.type(form.getByLabelText('Description and scope'), 'Owns recruitment, retention and the member record.');
    await user.type(form.getByLabelText('Objectives — one per line'), 'Run the open-call cycle');
    await user.click(form.getByRole('button', { name: 'Create committee' }));

    // Creation stops at the row: the leadership panel opens next, and both seats are still vacant.
    const seats = await findDialog('Leadership: Human Resources Committee');
    expect(seats.getAllByText('Vacant — nobody is accountable for this seat.')).toHaveLength(2);
    expect(stored().find((c) => c.shortCode === 'HR')?.directorId).toBeUndefined();
    expect(stored().find((c) => c.shortCode === 'HR')?.headId).toBeUndefined();

    // A reopening is a fresh form, not the previous attempt left on the screen. The page is
    // remounted rather than waited on because a modal that is animating out stays in the
    // document, and this environment never runs the frame that removes it.
    TL.cleanup();
    const again = await openPage();
    await again.click(TL.screen.getByRole('button', { name: /Create Committee/ }));
    const reopened = await findDialog('Create New Committee');
    expect((reopened.getByLabelText('Committee name') as HTMLInputElement).value).toBe('');

    // Same acronym again: refused on the field, and nothing second is written.
    const before = JSON.stringify(stored());
    await again.type(reopened.getByLabelText('Committee name'), 'Second HR Committee');
    await again.type(reopened.getByLabelText('Acronym'), 'HR');
    await again.type(reopened.getByLabelText('Description and scope'), 'Duplicate identity attempt.');
    await again.click(reopened.getByRole('button', { name: 'Create committee' }));

    expect(reopened.getAllByText(/already uses that acronym/).length).toBeGreaterThan(0);
    expect(JSON.stringify(stored())).toBe(before);
  });
});

/** The candidate row for one account inside the open picker. */
async function withinDialogText(name: string) {
  await TL.waitFor(() => {
    const li = Array.from(document.querySelectorAll('ul.max-h-64 li')).find((el) => el.textContent?.includes(name));
    if (!li) throw new Error(`No candidate row for ${name}`);
  });
  return Array.from(document.querySelectorAll('ul.max-h-64 li')).find((el) => el.textContent?.includes(name))!;
}
