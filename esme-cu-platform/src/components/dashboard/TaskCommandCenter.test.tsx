// @vitest-environment jsdom
/**
 * The task list as a rendered table. The point of these tests is the adoption: the rows are the
 * stored task records, the buttons are the moves the delivery flow allows for that row's state and
 * this session, and a confirmed move is read back out of storage. Column sorting and paging are
 * already covered in `DataTable.test.tsx`; this file only proves this screen is wired to real data.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../../auth/types';
import type { Task, User } from '../../types';

const PASSWORD = 'Str0ng#TaskUI1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

const profile = (id: string, name: string, over: Partial<User> = {}): User => ({
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

const task = (over: Partial<Task>): Task => ({
  id: 'tsk_1',
  title: 'Ultrasonic Testing Lab',
  description: 'Run the flaw-detection session and file the report.',
  committeeId: 'comm_te',
  committeeName: 'Technical & Engineering',
  assigneeIds: ['usr_nada'],
  assigneeNames: ['Nada Yehia'],
  createdById: 'usr_superadmin',
  createdByName: 'Kareem Tamer',
  priority: 'high',
  points: 120,
  startDate: '2026-02-01',
  deadline: '2026-02-20',
  status: 'submitted',
  acceptanceCriteria: ['Report filed'],
  category: 'Technical Workshop',
  createdAt: '2026-02-01 09:00',
  ...over,
});

const TASKS: Task[] = [
  task({ id: 'tsk_review', title: 'Ultrasonic Testing Lab', points: 120, status: 'submitted' }),
  task({
    id: 'tsk_mine',
    title: 'Recruitment Poster Wave',
    points: 40,
    status: 'assigned',
    committeeId: 'comm_mc',
    committeeName: 'Media & Content',
    assigneeIds: ['usr_superadmin'],
    assigneeNames: ['Kareem Tamer'],
  }),
];

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

const storedTasks = () => JSON.parse(localStorage.getItem(`${V2}tasks`) ?? '[]') as Task[];

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  stubViewport(true);
  Element.prototype.scrollIntoView = () => {};
  (Element.prototype as unknown as { scrollTo: (options?: unknown) => void }).scrollTo = () => {};
  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([profile('usr_nada', 'Nada Yehia')]));
  localStorage.setItem(`${V2}tasks`, JSON.stringify(TASKS));

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

async function renderTable() {
  const [{ AppProvider }, auth, { TaskCommandCenter }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./TaskCommandCenter'),
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
              <TaskCommandCenter />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  await user.click(await TL.screen.findByRole('button', { name: /Table/ }));
  return user;
}

const rowFor = async (title: string) => {
  await TL.screen.findByText(title);
  return TL.screen.getByText(title).closest('tr') as HTMLElement;
};

/** A row action carries its label in `title`; only confirmed ones also carry an aria-label. */
const rowAction = (row: HTMLElement, label: string) =>
  row.querySelector(`button[title="${label}"]`) as HTMLButtonElement | null;

describe('the task table', () => {
  it('shows one row per stored task inside this scope', async () => {
    await renderTable();
    expect(await TL.screen.findByText('Ultrasonic Testing Lab')).toBeTruthy();
    expect(TL.screen.getByText('Recruitment Poster Wave')).toBeTruthy();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('offers the reviewer decisions only on the row that is waiting for review', async () => {
    await renderTable();

    const reviewRow = await rowFor('Ultrasonic Testing Lab');
    expect(rowAction(reviewRow, 'Take into review')).toBeTruthy();
    expect(rowAction(reviewRow, 'Return for revision')).toBeTruthy();
    expect(rowAction(reviewRow, 'Reject')).toBeTruthy();

    const assignedRow = await rowFor('Recruitment Poster Wave');
    expect(rowAction(assignedRow, 'Take into review')).toBeNull();
    expect(rowAction(assignedRow, 'Reject')).toBeNull();
  });

  it('records a reviewer decision against the row it was taken from', async () => {
    const user = await renderTable();
    const reviewRow = await rowFor('Ultrasonic Testing Lab');
    await user.click(rowAction(reviewRow, 'Return for revision') as HTMLButtonElement);

    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Ultrasonic Testing Lab');
    await user.type(TL.within(dialog).getByRole('textbox'), 'The flaw maps are missing the depth calibration.');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Record decision' }));

    await TL.waitFor(() =>
      expect(storedTasks().find((t) => t.id === 'tsk_review')?.status).toBe('revision_requested')
    );
  });

  it('confirms a self-service cancellation before it leaves the pipeline', async () => {
    const user = await renderTable();
    const ownRow = await rowFor('Recruitment Poster Wave');
    const cancel = rowAction(ownRow, 'Cancel task');
    expect(cancel).toBeTruthy();

    await user.click(cancel as HTMLButtonElement);
    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Recruitment Poster Wave');
    expect(storedTasks().find((t) => t.id === 'tsk_mine')?.status).toBe('assigned');

    await user.click(TL.within(dialog).getByRole('button', { name: 'Cancel task' }));
    await TL.waitFor(() => expect(storedTasks().find((t) => t.id === 'tsk_mine')?.status).toBe('cancelled'));
    expect(storedTasks().find((t) => t.id === 'tsk_review')?.status).toBe('submitted');
  });

  it('sorts on the values actually stored', async () => {
    const user = await renderTable();
    const rows = () =>
      Array.from(document.querySelectorAll('tbody tr')).map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent ?? '');
        return { title: cells[0] ?? '', points: cells[3] ?? '' };
      });

    await user.click(TL.screen.getByRole('button', { name: 'Points' }));
    expect(rows()[0]).toMatchObject({ title: expect.stringContaining('Recruitment Poster Wave'), points: '40 pts' });

    await user.click(TL.screen.getByRole('button', { name: 'Points' }));
    expect(rows()[0]).toMatchObject({ title: expect.stringContaining('Ultrasonic Testing Lab'), points: '120 pts' });
  });

  it('edits a task from its own row and shows the saved value', async () => {
    const user = await renderTable();
    const row = await rowFor('Ultrasonic Testing Lab');
    await user.click(rowAction(row, 'Edit task') as HTMLButtonElement);

    const dialog = await TL.screen.findByRole('dialog');
    const title = TL.within(dialog).getByLabelText('Task Title') as HTMLInputElement;
    await user.clear(title);
    await user.type(title, 'Ultrasonic Testing Lab — revised');
    await user.click(TL.within(dialog).getByRole('button', { name: /Save changes/i }));

    await TL.waitFor(() =>
      expect(storedTasks().find((t) => t.id === 'tsk_review')?.title).toBe('Ultrasonic Testing Lab — revised')
    );
    expect(await TL.screen.findByText('Ultrasonic Testing Lab — revised')).toBeTruthy();
    // Editing the brief is not a status change: the row is still waiting for its review.
    expect(storedTasks().find((t) => t.id === 'tsk_review')?.status).toBe('submitted');
  });

  it('archives only after confirmation and lists the row again under archived', async () => {
    const user = await renderTable();
    const row = await rowFor('Recruitment Poster Wave');
    await user.click(rowAction(row, 'Archive task') as HTMLButtonElement);

    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('assignments, submissions and score history are kept');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Archive task' }));

    await TL.waitFor(() => expect(TL.screen.queryByText('Recruitment Poster Wave')).toBeNull());
    expect(storedTasks().find((t) => t.id === 'tsk_mine')?.archivedAt).toBeTruthy();

    await user.click(TL.screen.getByRole('button', { name: /Show archived/ }));
    expect(await TL.screen.findByText('Recruitment Poster Wave')).toBeTruthy();
  });

  it('turns the same two tasks into cards on a narrow screen', async () => {
    stubViewport(false);
    await renderTable();
    await TL.waitFor(() => expect(document.querySelectorAll('ul > li').length).toBe(2));
    expect(document.querySelector('table')).toBeNull();
    expect(TL.screen.getAllByText('Deadline').length).toBe(2);
  });
});
