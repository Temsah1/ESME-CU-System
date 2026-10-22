// @vitest-environment jsdom
/**
 * Operational records must outlive the tab. Tasks, submissions, the score ledger, applications
 * and the skill matrix used to be React state only: a reload emptied them, which made assigned
 * work look undone and let a score be recorded twice. The store is mounted, a task is created
 * through the real context, the tree is torn down, and a second mount reads the same record
 * back out of browser storage.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../types';

const PASSWORD = 'Str0ng#Cache1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

type Store = {
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
  tasks: Task[];
  submissions: unknown[];
  scoreLedger: unknown[];
  applications: unknown[];
  skillMatrix: unknown[];
};

let TL: typeof import('@testing-library/react');
let V2: string;
let ctx: Store | null = null;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  V2 = (await import('../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(async () => {
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

  const { createLocalDevAdapter } = await import('../auth/localDevAdapter');
  const adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

async function mount() {
  const [{ AppProvider, useApp }, auth] = await Promise.all([import('../context/AppContext'), import('../auth/AuthProvider')]);

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
}

describe('operational cache', () => {
  it('keeps a task created through the store after the page is remounted', async () => {
    await mount();

    ctx!.addTask({
      title: 'Write the NDT workshop brief',
      description: 'Scope, speakers and equipment list for the first technical session.',
      committeeId: 'comm_te',
      committeeName: 'Technical & Engineering Committee',
      assigneeIds: [],
      assigneeNames: [],
      createdById: 'usr_admin',
      createdByName: ADMIN.fullName,
      priority: 'high',
      points: 20,
      startDate: '2026-10-20',
      deadline: '2026-12-01',
      status: 'draft',
      acceptanceCriteria: ['Brief approved by the Director'],
      category: 'training',
    });

    // The store writes through an effect, so the flush is awaited rather than assumed.
    await TL.waitFor(() => {
      const cached = JSON.parse(localStorage.getItem(`${V2}tasks`) ?? '[]') as Task[];
      expect(cached.map((t) => t.title)).toContain('Write the NDT workshop brief');
    });

    TL.cleanup();
    ctx = null;
    await mount();

    const tasks = ctx!.tasks.filter((t) => t.title === 'Write the NDT workshop brief');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ priority: 'high', points: 20, status: 'draft' });
  });

  it('reads back a stored submission, ledger entry, application and skill record on a fresh mount', async () => {
    localStorage.setItem(`${V2}submissions`, JSON.stringify([{ id: 'sub_1', taskId: 'task_1', memberName: 'Nada Yehia' }]));
    localStorage.setItem(`${V2}scoreLedger`, JSON.stringify([{ id: 'led_1', memberId: 'usr_nada', points: 10, reason: 'Delivered on time' }]));
    localStorage.setItem(`${V2}applications`, JSON.stringify([{ id: 'app_1', fullName: 'New Applicant', agreedToPolicies: true }]));
    localStorage.setItem(`${V2}skillMatrix`, JSON.stringify([{ id: 'sk_1', memberId: 'usr_nada', skillName: 'Presentation' }]));

    await mount();

    expect(ctx!.submissions).toHaveLength(1);
    expect(ctx!.scoreLedger).toHaveLength(1);
    expect(ctx!.applications).toHaveLength(1);
    expect(ctx!.skillMatrix).toHaveLength(1);
  });
});
