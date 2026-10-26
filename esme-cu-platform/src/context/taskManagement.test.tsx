// @vitest-environment jsdom
/**
 * Task editing, archival and deletion through the real store.
 *
 * The point of these tests is the rule, not the button: a Super Admin may rewrite a brief and
 * retire a task, an assignee may only move their own work through the delivery flow, and a task
 * that has a submission is archived rather than deleted. `TaskCommandCenter.test.tsx` covers the
 * screen; this file reaches the store directly so a missing button cannot pass for enforcement.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task, TaskSubmission, User } from '../types';

const PASSWORD = 'Str0ng#Tasks9';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const MEMBER = {
  fullName: 'Nada Yehia',
  email: 'nada.yehia@example.test',
  username: 'nada.yehia',
  password: PASSWORD,
  confirmPassword: PASSWORD,
  committeeId: 'comm_te',
  acceptedPolicies: true,
};

type Store = {
  tasks: Task[];
  currentUser: User;
  updateTask: (id: string, updates: Partial<Task>) => void;
  archiveTask: (id: string) => void;
  restoreTask: (id: string) => void;
  deleteTask: (id: string) => void;
  moveTask: (id: string, to: Task['status']) => void;
};

let TL: typeof import('@testing-library/react');
let V2: string;
let ctx: Store | null = null;

const task = (over: Partial<Task> = {}): Task => ({
  id: 'tsk_keep',
  title: 'Write the NDT workshop brief',
  description: 'Scope, speakers and equipment list for the first technical session.',
  committeeId: 'comm_te',
  committeeName: 'Technical & Engineering Committee',
  assigneeIds: ['usr_nada'],
  assigneeNames: ['Nada Yehia'],
  createdById: 'usr_admin',
  createdByName: ADMIN.fullName,
  priority: 'high',
  points: 40,
  startDate: '2026-10-20',
  deadline: '2026-11-20',
  status: 'assigned',
  acceptanceCriteria: ['Brief approved by the Director'],
  referenceLinks: [],
  category: 'Workshop',
  createdAt: '2026-10-20',
  ...over,
});

const profile = (over: Partial<User> = {}): User => ({
  id: 'usr_nada',
  name: 'Nada Yehia',
  email: 'nada.yehia@example.test',
  username: 'nada.yehia',
  role: 'member',
  status: 'active',
  committeeId: 'comm_te',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
  ...over,
});

const submission = (taskId: string): TaskSubmission => ({
  id: 'sub_1',
  taskId,
  taskTitle: 'Write the NDT workshop brief',
  committeeId: 'comm_te',
  committeeName: 'Technical & Engineering Committee',
  memberId: 'usr_nada',
  memberName: 'Nada Yehia',
  submittedAt: '2026-10-25T10:00:00.000Z',
  description: 'First draft attached.',
  status: 'submitted',
  proposedPoints: 40,
  version: 1,
});

const storedTasks = () => JSON.parse(localStorage.getItem(`${V2}tasks`) ?? '[]') as Task[];

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  V2 = (await import('../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  ctx = null;
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
  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([profile()]));
});

afterEach(() => TL.cleanup());

const localAdapter = async () => (await import('../auth/localDevAdapter')).createLocalDevAdapter();

async function signInAdmin() {
  const adapter = await localAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
}

/** Registers a member through the same path the portal uses, and returns the profile id. */
async function signInMember() {
  const adapter = await localAdapter();
  const outcome = await adapter.register(MEMBER);
  if (!outcome.ok) throw new Error(`registration refused: ${outcome.failure.message}`);
  await adapter.signIn(MEMBER.email, PASSWORD);
  return outcome.receipt.reference;
}

async function mount() {
  const [{ AppProvider, useApp }, auth] = await Promise.all([
    import('../context/AppContext'),
    import('../auth/AuthProvider'),
  ]);

  const Probe: React.FC = () => {
    const value = useApp() as unknown as Store;
    React.useEffect(() => {
      ctx = value;
    }, [value]);
    return null;
  };
  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <auth.AuthProvider>
      <AppProvider>
        <Gate>
          <Probe />
        </Gate>
      </AppProvider>
    </auth.AuthProvider>
  );
  await TL.waitFor(() => {
    if (!ctx) throw new Error('the store has not rendered yet');
  });
  return ctx!;
}

describe('an authorized editor rewrites the brief, not its history', () => {
  it('saves every managed field and leaves status, ownership and references alone', async () => {
    await signInAdmin();
    localStorage.setItem(`${V2}tasks`, JSON.stringify([task()]));
    const store = await mount();

    store.updateTask('tsk_keep', {
      title: 'Rewrite the NDT workshop brief',
      description: 'Scope, speakers, equipment list and a dry-run slot.',
      points: 60,
      deadline: '2026-12-01',
      priority: 'urgent',
      acceptanceCriteria: ['Brief approved by the Director', 'Dry run booked'],
    });

    await TL.waitFor(() => {
      const saved = storedTasks().find((t) => t.id === 'tsk_keep');
      if (saved?.title !== 'Rewrite the NDT workshop brief') throw new Error('the edit has not been written');
    });
    expect(storedTasks().find((t) => t.id === 'tsk_keep')).toMatchObject({
      title: 'Rewrite the NDT workshop brief',
      points: 60,
      deadline: '2026-12-01',
      priority: 'urgent',
      status: 'assigned',
      assigneeIds: ['usr_nada'],
      createdById: 'usr_admin',
      referenceLinks: [],
      category: 'Workshop',
    });
  });

  it('refuses an invalid update and leaves the stored row untouched', async () => {
    await signInAdmin();
    localStorage.setItem(`${V2}tasks`, JSON.stringify([task()]));
    const store = await mount();

    expect(() => store.updateTask('tsk_keep', { title: '  ' })).toThrow(/title/i);
    expect(() => store.updateTask('tsk_keep', { points: 2 })).toThrow(/points/i);
    expect(() => store.updateTask('tsk_keep', { deadline: '2026-02-30' })).toThrow(/deadline/i);
    expect(storedTasks().find((t) => t.id === 'tsk_keep')?.title).toBe('Write the NDT workshop brief');
  });

  it('reports an unknown task instead of pretending the edit landed', async () => {
    await signInAdmin();
    localStorage.setItem(`${V2}tasks`, JSON.stringify([task()]));
    const store = await mount();
    expect(() => store.updateTask('tsk_missing', { title: 'Nope' })).toThrow(/not in this workspace/i);
  });
});

describe('an assignee cannot take over the brief', () => {
  it('refuses metadata edits and deletion, but keeps the delivery move', async () => {
    const memberId = await signInMember();
    localStorage.setItem(`${V2}tasks`, JSON.stringify([task({ assigneeIds: [memberId] })]));
    const store = await mount();
    expect(store.currentUser.role).toBe('member');

    expect(() => store.updateTask('tsk_keep', { title: 'Mine now' })).toThrow(/tasks\.write/);
    expect(() => store.updateTask('tsk_keep', { points: 500 })).toThrow(/tasks\.write/);
    expect(() => store.archiveTask('tsk_keep')).toThrow(/tasks\.delete/);
    expect(() => store.deleteTask('tsk_keep')).toThrow(/tasks\.delete/);
    expect(storedTasks().find((t) => t.id === 'tsk_keep')?.title).toBe('Write the NDT workshop brief');

    // The workflow move is still the assignee's: tightening the metadata rule must not stall work.
    store.moveTask('tsk_keep', 'in_progress');
    await TL.waitFor(() =>
      expect(storedTasks().find((t) => t.id === 'tsk_keep')?.status).toBe('in_progress')
    );
  });
});

describe('archiving retires a task without erasing what happened', () => {
  it('marks the row, makes it read-only and restores it to the same record', async () => {
    await signInAdmin();
    localStorage.setItem(`${V2}tasks`, JSON.stringify([task()]));
    const store = await mount();

    store.archiveTask('tsk_keep');
    await TL.waitFor(() => {
      const archived = storedTasks().find((t) => t.id === 'tsk_keep');
      if (!archived?.archivedAt) throw new Error('the archive has not been written');
    });
    const archived = storedTasks().find((t) => t.id === 'tsk_keep')!;
    expect(archived.archivedBy).toBe(ADMIN.fullName);
    expect(archived.assigneeIds).toEqual(['usr_nada']);
    // The store's actions close over the state of their render; read the one that sees the archive.
    const live = ctx!;
    expect(() => live.updateTask('tsk_keep', { title: 'Edited while archived' })).toThrow(/read-only/i);
    expect(() => live.archiveTask('tsk_keep')).toThrow(/already archived/i);

    live.restoreTask('tsk_keep');
    await TL.waitFor(() => {
      const restored = storedTasks().find((t) => t.id === 'tsk_keep');
      if (restored?.archivedAt) throw new Error('the restore has not been written');
    });
    expect(storedTasks().find((t) => t.id === 'tsk_keep')).toMatchObject({
      title: 'Write the NDT workshop brief',
      assigneeIds: ['usr_nada'],
    });
  });

  it('refuses a hard delete once a submission refers to the task', async () => {
    await signInAdmin();
    localStorage.setItem(`${V2}tasks`, JSON.stringify([task()]));
    localStorage.setItem(`${V2}submissions`, JSON.stringify([submission('tsk_keep')]));
    const store = await mount();

    expect(() => store.deleteTask('tsk_keep')).toThrow(/archive it instead of deleting/i);
    // Neither the task nor the deliverable was removed.
    expect(storedTasks().find((t) => t.id === 'tsk_keep')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(`${V2}submissions`) ?? '[]')).toHaveLength(1);
  });

  it('deletes a task that nothing else refers to', async () => {
    await signInAdmin();
    localStorage.setItem(`${V2}tasks`, JSON.stringify([task(), task({ id: 'tsk_clean', title: 'Unused draft' })]));
    const store = await mount();

    store.deleteTask('tsk_clean');
    await TL.waitFor(() => expect(storedTasks().some((t) => t.id === 'tsk_clean')).toBe(false));
    expect(storedTasks().some((t) => t.id === 'tsk_keep')).toBe(true);
    expect(() => ctx!.deleteTask('tsk_clean')).toThrow(/not in this workspace/i);
  });
});
