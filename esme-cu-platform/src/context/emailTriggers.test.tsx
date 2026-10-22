// @vitest-environment jsdom
/**
 * A record change and its message are one step. These tests drive the real store — assign a task,
 * reject an application, award points, return work for revision — and read the email queue back,
 * because a trigger that only exists in a template is a feature nobody receives.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistrationApplication, Task, TaskSubmission, User } from '../types';

const PASSWORD = 'Str0ng#Email1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

type Store = {
  addTask: (task: Omit<Task, 'id' | 'createdAt'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  addUser: (user: Omit<User, 'id' | 'totalPoints' | 'approvedTasksCount' | 'joinedDate' | 'lastActive' | 'status'>) => void;
  submitApplication: (application: Omit<RegistrationApplication, 'id' | 'appliedDate' | 'status'>) => void;
  updateApplicationStatus: (id: string, status: RegistrationApplication['status'], notes?: string, committeeId?: string) => Promise<void>;
  addManualPointAdjustment: (memberId: string, points: number, reason: string) => void;
  reviewSubmission: (id: string, decision: 'approved' | 'rejected' | 'revision_requested', feedback: string) => void;
  notifications: { title: string; message: string }[];
};

let TL: typeof import('@testing-library/react');
let V2: string;
let ctx: Store | null = null;
let queueModule: typeof import('../email/queue');
let outboxModule: typeof import('../email/localOutboxSender');

const taskFields = (assigneeIds: string[], id = 'task_email') => ({
  title: 'Write the NDT workshop brief',
  description: 'Scope, speakers and equipment list for the first technical session.',
  committeeId: 'comm_te',
  committeeName: 'Technical & Engineering Committee',
  assigneeIds,
  assigneeNames: [],
  createdById: 'usr_admin',
  createdByName: ADMIN.fullName,
  priority: 'high' as const,
  points: 20,
  startDate: '2026-10-20',
  deadline: '2026-12-01',
  status: 'draft' as const,
  acceptanceCriteria: ['Brief approved by the Director'],
  category: 'training' as const,
  id,
  createdAt: '2026-10-20',
});

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  V2 = (await import('../storage/migrations')).STORAGE_KEYS.v2;
  queueModule = await import('../email/queue');
  outboxModule = await import('../email/localOutboxSender');
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

/** Waits for the queue to hold one request per event and for the sender's receipt to land. */
async function waitForEvent(event: string) {
  await TL.waitFor(() => {
    const entry = queueModule.readEmailQueue().find((e) => e.request.event === event);
    if (!entry) throw new Error(`no ${event} request in the queue`);
    if (!entry.receipt) throw new Error(`${event} has no delivery receipt yet`);
  });
  return queueModule.readEmailQueue().find((e) => e.request.event === event)!;
}

const MEMBER = {
  name: 'Nada Yehia',
  email: 'nada.yehia@example.test',
  username: 'nada.yehia',
  role: 'member' as const,
  committeeId: 'comm_te',
};

describe('email triggers on real record changes', () => {
  it('assigning a task queues one message per member and re-saving the same roster adds nothing', async () => {
    await mount();
    ctx!.addUser(MEMBER);
    let members: User[] = [];
    await TL.waitFor(() => {
      members = JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[];
      if (!members.some((u) => u.email === MEMBER.email)) throw new Error('the profile has not been written yet');
    });
    const memberId = members.find((u) => u.email === MEMBER.email)!.id;

    ctx!.addTask(taskFields([memberId]));
    const first = await waitForEvent('task_assigned');
    expect(first.request.recipientId).toBe(memberId);
    expect(first.request.to).toBe(MEMBER.email);
    expect(ctx!.notifications.map((n) => n.title)).toContain('Task assigned');

    const tasks = JSON.parse(localStorage.getItem(`${V2}tasks`) ?? '[]') as Task[];
    const taskId = tasks.find((t) => t.title === 'Write the NDT workshop brief')!.id;

    ctx!.addUser({ ...MEMBER, name: 'Omar Second', email: 'omar.second@example.test', username: 'omar.second' });
    await TL.waitFor(() => {
      const all = JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[];
      if (!all.some((u) => u.email === 'omar.second@example.test')) throw new Error('the second profile has not been written yet');
      members = all;
    });
    const secondId = members.find((u) => u.email === 'omar.second@example.test')!.id;

    ctx!.updateTask(taskId, { assigneeIds: [memberId, secondId] });
    await waitForEvent('task_assigned');
    const assigned = queueModule.readEmailQueue().filter((e) => e.request.event === 'task_assigned');
    expect(assigned.map((e) => e.request.recipientId).sort()).toEqual([memberId, secondId].sort());

    // The same roster written again names no new member, so no new message is queued.
    ctx!.updateTask(taskId, { assigneeIds: [secondId, memberId] });
    await Promise.resolve();
    expect(queueModule.readEmailQueue().filter((e) => e.request.event === 'task_assigned')).toHaveLength(2);
  });

  it('queueing the outbox sender records a simulated receipt, never a delivery', async () => {
    await mount();
    ctx!.addUser(MEMBER);
    let members: User[] = [];
    await TL.waitFor(() => {
      members = JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[];
      if (!members.some((u) => u.email === MEMBER.email)) throw new Error('the profile has not been written yet');
    });
    ctx!.addTask(taskFields([members.find((u) => u.email === MEMBER.email)!.id]));

    const entry = await waitForEvent('task_assigned');
    expect(entry.receipt).toMatchObject({ status: 'queued', simulated: true });
    expect(entry.receipt?.status).not.toBe('sent');
    expect(outboxModule.readOutbox().some((r) => r.html.includes('NDT workshop brief'))).toBe(true);
  });

  it('an approval decision reaches the applicant with the reason the board wrote', async () => {
    await mount();
    ctx!.submitApplication({
      fullName: 'New Applicant',
      universityEmail: 'new.applicant@example.test',
      studentId: '2026-999',
      academicYear: 'Third',
      department: 'Civil Engineering',
      phone: '+201000000000',
      preferredCommitteeId: 'comm_te',
      technicalSkills: 'AutoCAD',
      previousExperience: '',
      motivation: 'Wants to learn site supervision',
      availabilityHours: '10',
      agreedToPolicies: true,
    });
    await waitForEvent('account_created');

    const stored = JSON.parse(localStorage.getItem(`${V2}applications`) ?? '[]') as RegistrationApplication[];
    const application = stored.find((a) => a.fullName === 'New Applicant')!;
    await ctx!.updateApplicationStatus(application.id, 'rejected', 'No seat left in this season');

    const rejected = await waitForEvent('account_rejected');
    expect(rejected.request.to).toBe('new.applicant@example.test');
    expect(rejected.request.payload).toMatchObject({ reason: 'No seat left in this season' });
  });

  /**
   * The mail used to be the last step after a click nobody made. Now the decision itself queues
   * it, so the guarantee has to be that one decision is one message and a repeat is refused.
   */
  it('queues the decision mail once per decision and refuses a replayed write', async () => {
    const application = {
      fullName: 'Late Applicant',
      universityEmail: 'late.applicant@example.test',
      studentId: '2026-998',
      academicYear: 'Second',
      department: 'Mechanical Engineering',
      phone: '+201000000001',
      preferredCommitteeId: 'comm_te',
      technicalSkills: 'MATLAB',
      previousExperience: '',
      motivation: 'Wants to join the robotics track',
      availabilityHours: '6',
      agreedToPolicies: true,
    };
    await mount();
    ctx!.submitApplication(application);
    await waitForEvent('account_created');

    const stored = JSON.parse(localStorage.getItem(`${V2}applications`) ?? '[]') as RegistrationApplication[];
    const id = stored.find((a) => a.fullName === 'Late Applicant')!.id;
    await ctx!.updateApplicationStatus(id, 'accepted', '', 'comm_te');

    const approved = await waitForEvent('account_approved');
    expect(approved.request.payload).toMatchObject({ event: 'account_approved', fullName: 'Late Applicant' });
    expect(
      queueModule.readEmailQueue().filter((e) => e.request.event === 'account_approved').length
    ).toBe(1);

    // The same decision written again cannot open a second message for the same record.
    const replay = queueModule.enqueueEmail({
      payload: approved.request.payload,
      recipientId: approved.request.recipientId,
      to: approved.request.to,
      ref: id,
    });
    expect(replay).toMatchObject({ queued: false, reason: 'duplicate' });

    // And the store will not take a second decision on an application that already has one.
    await expect(ctx!.updateApplicationStatus(id, 'rejected', 'changed my mind')).rejects.toThrow(/already has a decision/);
  });

  it('a positive point adjustment is announced as a bonus and a penalty is not', async () => {
    await mount();
    ctx!.addUser(MEMBER);
    let members: User[] = [];
    await TL.waitFor(() => {
      members = JSON.parse(localStorage.getItem(`${V2}userProfiles`) ?? '[]') as User[];
      if (!members.some((u) => u.email === MEMBER.email)) throw new Error('the profile has not been written yet');
    });
    const memberId = members.find((u) => u.email === MEMBER.email)!.id;

    ctx!.addManualPointAdjustment(memberId, -5, 'Missed the committee meeting without notice');
    expect(queueModule.readEmailQueue().some((e) => e.request.event === 'bonus_awarded')).toBe(false);

    ctx!.addManualPointAdjustment(memberId, 15, 'Ran the workshop for the first-year cohort');
    const bonus = await waitForEvent('bonus_awarded');
    expect(bonus.request.payload).toMatchObject({ points: 15, newTotal: 15, awarderName: ADMIN.fullName });
  });

  it('returning work for revision emails the member who owns the submission', async () => {
    const member = { ...MEMBER, id: 'usr_nada', status: 'active', totalPoints: 0, approvedTasksCount: 0, joinedDate: '2026-01-01', lastActive: 'Just now' } as User;
    localStorage.setItem(`${V2}userProfiles`, JSON.stringify([member]));
    localStorage.setItem(`${V2}tasks`, JSON.stringify([{ ...taskFields(['usr_nada']), status: 'submitted' }]));
    localStorage.setItem(
      `${V2}submissions`,
      JSON.stringify([
        {
          id: 'sub_seed',
          taskId: 'task_email',
          taskTitle: 'Write the NDT workshop brief',
          committeeId: 'comm_te',
          committeeName: 'Technical & Engineering Committee',
          memberId: 'usr_nada',
          memberName: member.name,
          submittedAt: '2026-10-19 08:00',
          description: 'Draft brief',
          status: 'submitted',
          proposedPoints: 20,
          version: 1,
        } satisfies TaskSubmission,
      ])
    );

    await mount();
    ctx!.reviewSubmission('sub_seed', 'revision_requested', 'Add the equipment list and the speaker names.');
    const revision = await waitForEvent('submission_revision_requested');
    expect(revision.request.recipientId).toBe('usr_nada');
    expect(revision.request.payload).toMatchObject({ feedback: 'Add the equipment list and the speaker names.' });
  });

  it('reports a new sign-in once per device and does not repeat it on the next mount', async () => {
    await mount();
    const alert = await waitForEvent('login_security_alert');
    expect(alert.request.to).toBe(ADMIN.email);

    TL.cleanup();
    ctx = null;
    await mount();
    expect(queueModule.readEmailQueue().filter((e) => e.request.event === 'login_security_alert')).toHaveLength(1);
  });
});
