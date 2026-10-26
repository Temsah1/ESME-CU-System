// @vitest-environment jsdom
/**
 * The Season Planner as a surface: the real store, the real development session, and every write
 * read back out of browser storage. This proves the client half of the 0013 capability change —
 * moderator and high_board get the same four actions super_admin already had, a member still gets
 * none. Server-side RLS is a separate claim and is NOT verified here; probes P31–P34 in the
 * migration are what would verify it against a database.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AppContextModule from '../../context/AppContext';

type Store = ReturnType<typeof AppContextModule.useApp>;
import type { Role, SeasonEvent, User } from '../../types';

const PASSWORD = 'Str0ng#SeasonUI1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

const BLANK_DRAFT: Omit<SeasonEvent, 'id'> = {
  title: 'Draft milestone',
  category: 'Workshop',
  dateOrQuarter: 'April 2027',
  status: 'Planned',
  targetMetric: '25 attendees',
  responsibleCommittee: 'Training Committee',
  description: '',
  isPublic: true,
};

const profile = (id: string, name: string, role: Role): User => ({
  id,
  name,
  email: `${id}@esme.test`,
  username: id,
  role,
  status: 'active',
  committeeId: 'comm_te',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
});

const seededEvent = (over: Partial<SeasonEvent> & Pick<SeasonEvent, 'id' | 'title'>): SeasonEvent => ({
  category: 'Workshop',
  dateOrQuarter: 'March 2027',
  status: 'Planned',
  targetMetric: '30 attendees',
  responsibleCommittee: 'Training Committee',
  description: '',
  isPublic: true,
  ...over,
});

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: import('../../auth/types').AuthAdapter;
let useApp: () => Store;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
  V2 = (await import('../../storage/migrations')).STORAGE_KEYS.v2;
  useApp = (await import('../../context/AppContext')).useApp;
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

  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([profile('usr_nada', 'Nada Yehia', 'member')]));

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

const plan = (): SeasonEvent[] => JSON.parse(localStorage.getItem(`${V2}seasonEvents`) ?? '[]') as SeasonEvent[];
const seedPlan = (events: SeasonEvent[]) => localStorage.setItem(`${V2}seasonEvents`, JSON.stringify(events));

function dialogsTitled(title: string): HTMLElement[] {
  // A closing modal can still sit in the document mid-animation, so callers take the last one.
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).filter((element) =>
    element.textContent?.includes(title)
  );
}

async function openDialog(title: string) {
  await TL.waitFor(() => {
    if (dialogsTitled(title).length === 0) throw new Error(`no dialog titled ${title}`);
  });
  return TL.within(dialogsTitled(title)[dialogsTitled(title).length - 1] as HTMLElement);
}

/** The bare store, so a test can call a write the screen would never render a button for. */
let captured: Store | null = null;

async function snapshot(): Promise<Store> {
  const Probe: React.FC = () => {
    const value = useApp();
    React.useEffect(() => {
      captured = value;
    }, [value]);
    return null;
  };
  const auth = await import('../../auth/AuthProvider');
  const { AppProvider } = await import('../../context/AppContext');
  const motion = await import('../../motion');
  const { MotionConfig } = await import('motion/react');

  TL.cleanup();
  captured = null;
  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <Probe />
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  await TL.waitFor(() => {
    if (!captured) throw new Error('the store has not rendered yet');
  });
  if (!captured) throw new Error('the store has not rendered yet');
  return captured;
}

async function mount() {
  const auth = await import('../../auth/AuthProvider');
  const { AppProvider } = await import('../../context/AppContext');
  const { SeasonPlanner } = await import('./SeasonPlanner');
  const motion = await import('../../motion');
  const { MotionConfig } = await import('motion/react');

  TL.cleanup();
  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <SeasonPlanner />
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  await TL.screen.findByRole('heading', { name: 'Season Planner' });
  return { user: await userEvent.setup() };
}

/**
 * An account holding the role under test, built while the Super Admin holds the session, then
 * signed in and mounted, so no test inherits another role's capability snapshot.
 */
async function signInAs(key: string, role: Role) {
  await adapter.signOut();
  await adapter.signIn(ADMIN.email, PASSWORD);

  const identity = { fullName: `Plan ${key}`, email: `${key}@planner.test`, username: `plan_${key}` };
  const reg = await adapter.register({
    ...identity,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    committeeId: 'comm_te',
    acceptedPolicies: true,
  });
  if (!reg.ok) throw new Error(`fixture registration refused: ${reg.failure.message}`);
  const decide = await adapter.decideRegistration(reg.receipt.reference, 'approve');
  if (!decide.ok) throw new Error(`fixture approval refused: ${decide.error.message}`);
  if (role !== 'member') {
    const grant = await adapter.assignRole(reg.receipt.reference, role);
    if (!grant.ok) throw new Error(`fixture role grant refused: ${grant.error.message}`);
  }
  localStorage.setItem(
    `${V2}userProfiles`,
    JSON.stringify([
      ...(JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[]),
      profile(reg.receipt.reference, identity.fullName, role),
    ])
  );

  await adapter.signOut();
  await adapter.signIn(identity.email, PASSWORD);
}

async function fillMilestone(
  user: ReturnType<typeof userEvent.setup>,
  box: Awaited<ReturnType<typeof openDialog>>,
  title: string
) {
  await user.clear(box.getByLabelText('Title'));
  await user.type(box.getByLabelText('Title'), title);
  await user.clear(box.getByLabelText('Date / month'));
  await user.type(box.getByLabelText('Date / month'), 'February 2027');
  await user.clear(box.getByLabelText('Target to write down'));
  await user.type(box.getByLabelText('Target to write down'), '150 attendees');
}

describe('the three planning roles hold the plan end to end', () => {
  it.each([
    ['super_admin', 'sa'],
    ['moderator', 'mod'],
    ['high_board', 'hb'],
  ] as [Role, string][])('%s can add, edit, save and delete a milestone', async (role, key) => {
    await signInAs(key, role);
    const { user } = await mount();

    await user.click(TL.screen.getByRole('button', { name: 'Add Milestone / Event' }));
    const add = await openDialog('Add Season Milestone');
    await fillMilestone(user, add, 'Winter Field Campaign');
    await user.click(add.getByRole('button', { name: 'Save Milestone' }));
    await TL.waitFor(() => {
      expect(plan()).toHaveLength(1);
    });
    expect(plan()[0].title).toBe('Winter Field Campaign');
    expect(plan()[0].responsibleCommittee).toBe('Not yet assigned');

    await user.click(TL.screen.getByRole('button', { name: 'Edit Winter Field Campaign' }));
    const edit = await openDialog('Edit Season Milestone');
    expect((edit.getByLabelText('Title') as HTMLInputElement).value).toBe('Winter Field Campaign');
    await user.clear(edit.getByLabelText('Target to write down'));
    await user.type(edit.getByLabelText('Target to write down'), '200 attendees');
    await user.click(edit.getByRole('button', { name: 'Save Changes' }));
    await TL.waitFor(() => {
      expect(plan()[0].targetMetric).toBe('200 attendees');
    });
    // Saving an edit updates the row it opened from; it never appends a second copy.
    expect(plan()).toHaveLength(1);

    // Cancelling an edit writes nothing, even though the field was changed.
    await user.click(TL.screen.getByRole('button', { name: 'Edit Winter Field Campaign' }));
    const abandoned = await openDialog('Edit Season Milestone');
    await user.clear(abandoned.getByLabelText('Title'));
    await user.type(abandoned.getByLabelText('Title'), 'Retitled by a cancelled edit');
    await user.click(abandoned.getByRole('button', { name: 'Cancel' }));
    expect(plan()[0].title).toBe('Winter Field Campaign');

    // The delete button alone is not consent: the plan is unchanged until the dialog confirms.
    await user.click(TL.screen.getByRole('button', { name: 'Delete Winter Field Campaign' }));
    const confirm = await openDialog('Delete this milestone?');
    expect(plan()).toHaveLength(1);
    await user.click(confirm.getByRole('button', { name: 'Delete milestone' }));
    await TL.waitFor(() => {
      expect(plan()).toHaveLength(0);
    });
  });

  it('leaves an ordinary member with no plan controls', async () => {
    await signInAs('plain_member', 'member');
    await mount();

    expect(TL.screen.queryByRole('button', { name: 'Add Milestone / Event' })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(TL.screen.getByText(/You are reading the plan/)).toBeTruthy();
  });

  it('refuses a member at the store itself, and writes nothing', async () => {
    await signInAs('member_refusal', 'member');
    const store = await snapshot();

    expect(store.can('events.write')).toBe(false);
    expect(() => store.addSeasonEvent(BLANK_DRAFT)).toThrow(/events\.write|permitted|capability/i);
    expect(() => store.updateSeasonEvent('evt_1', { status: 'Completed' })).toThrow();
    expect(() => store.deleteSeasonEvent('evt_1')).toThrow();
    expect(() => store.loadReferenceSeasonPlan()).toThrow();
    expect(plan()).toEqual([]);
  });
});

describe('deletion is confirmed, named, and scoped to one row', () => {
  it('keeps the milestone when the confirmation is dismissed', async () => {
    seedPlan([seededEvent({ id: 'evt_1', title: 'Graduate Bootcamp' })]);
    const { user } = await mount();

    await user.click(TL.screen.getByRole('button', { name: 'Delete Graduate Bootcamp' }));
    const confirm = await openDialog('Delete this milestone?');
    await user.click(confirm.getByRole('button', { name: 'Cancel' }));

    expect(plan()).toHaveLength(1);
    expect(plan()[0].title).toBe('Graduate Bootcamp');
  });

  it('removes only the confirmed milestone when the plan holds several', async () => {
    seedPlan([
      seededEvent({ id: 'evt_a', title: 'Autumn Workshop' }),
      seededEvent({ id: 'evt_b', title: 'Spring Workshop' }),
    ]);
    const { user } = await mount();

    await user.click(TL.screen.getByRole('button', { name: 'Delete Spring Workshop' }));
    const confirm = await openDialog('Delete this milestone?');
    // A confirmation that cannot name the row it is about to destroy is not a confirmation.
    expect(confirm.getByText('Spring Workshop')).toBeTruthy();
    expect(confirm.queryByText('Autumn Workshop')).toBeNull();

    await user.click(confirm.getByRole('button', { name: 'Delete milestone' }));
    await TL.waitFor(() => {
      expect(plan().map((e) => e.id)).toEqual(['evt_a']);
    });
  });

  it('refuses to report success on a milestone nobody had', async () => {
    seedPlan([seededEvent({ id: 'evt_1', title: 'Magazine Issue 4' })]);
    const store = await snapshot();

    expect(() => store.deleteSeasonEvent('evt_does_not_exist')).toThrow(/no longer in the plan/);
    expect(plan().map((e) => e.id)).toEqual(['evt_1']);
  });

  it('preserves a recorded result through an edit, because the form does not own evidence', async () => {
    seedPlan([
      seededEvent({
        id: 'evt_1',
        title: 'Professional Session',
        category: 'Professional Session',
        status: 'Completed',
        targetMetric: '60 attendees',
        actualMetric: '58 attended, 12 signed the register twice',
        responsibleCommittee: 'Corporate Relations',
      }),
    ]);
    const { user } = await mount();

    await user.click(TL.screen.getByRole('button', { name: 'Edit Professional Session' }));
    const edit = await openDialog('Edit Season Milestone');
    await user.clear(edit.getByLabelText('Date / month'));
    await user.type(edit.getByLabelText('Date / month'), 'February 2027');
    await user.click(edit.getByRole('button', { name: 'Save Changes' }));

    await TL.waitFor(() => {
      expect(plan()[0].dateOrQuarter).toBe('February 2027');
    });
    expect(plan()[0].actualMetric).toBe('58 attended, 12 signed the register twice');
    expect(plan()[0].status).toBe('Completed');
  });
});
