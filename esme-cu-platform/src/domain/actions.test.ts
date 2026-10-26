// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SeasonEvent, Task, TaskSubmission, User } from '../types';
import {
  DEFAULT_ACTION_PREFS,
  buildActionQueue,
  dueForReminder,
  escalationFor,
  planNotifications,
  sortQueue,
  visibleTo,
  type ActionPrefs,
} from './actions';

/**
 * Spec D: the queue is a projection of records, a reminder is one announcement per record
 * stage, and who may see an item follows the read scopes — not which screen is open.
 */

const AS_OF = '2026-10-16T09:00:00.000Z';

function task(patch: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: 'Task',
    description: '',
    committeeId: 'c1',
    committeeName: 'Operations',
    assigneeIds: ['u2'],
    assigneeNames: ['Member Two'],
    createdById: 'u1',
    createdByName: 'Head',
    priority: 'medium',
    points: 10,
    startDate: '2026-09-01',
    deadline: '2026-10-20',
    status: 'in_progress',
    acceptanceCriteria: [],
    category: 'general',
    createdAt: '2026-09-01',
    ...patch,
  };
}

function submission(patch: Partial<TaskSubmission> & Pick<TaskSubmission, 'id'>): TaskSubmission {
  return {
    taskId: 't1',
    taskTitle: 'Task',
    committeeId: 'c1',
    committeeName: 'Operations',
    memberId: 'u2',
    memberName: 'Member Two',
    submittedAt: '2026-10-10T09:00:00.000Z',
    description: 'done',
    status: 'submitted',
    proposedPoints: 10,
    version: 1,
    ...patch,
  };
}

function person(patch: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'Person',
    email: 'p@esme.local',
    username: 'person',
    role: 'member',
    committeeId: 'c1',
    status: 'active',
    totalPoints: 0,
    approvedTasksCount: 0,
    joinedDate: '2026-09-01',
    lastActive: '2026-10-01',
    ...patch,
  };
}

function event(patch: Partial<SeasonEvent> & Pick<SeasonEvent, 'id'>): SeasonEvent {
  return {
    title: 'Event',
    category: 'Workshop',
    dateOrQuarter: 'Q2',
    status: 'Planned',
    targetMetric: '',
    responsibleCommittee: 'c1',
    description: '',
    isPublic: true,
    ...patch,
  };
}

const build = (patch: Partial<Parameters<typeof buildActionQueue>[0]> = {}) =>
  buildActionQueue({
    tasks: [],
    submissions: [],
    events: [],
    users: [person({ id: 'u2', name: 'Member Two' })],
    asOf: AS_OF,
    prefs: DEFAULT_ACTION_PREFS,
    ...patch,
  });

describe('queue contents', () => {
  it('rises from records only, and nothing from an empty workspace', () => {
    expect(build()).toEqual([]);
  });

  it('gives an open dated task a review entry and an extra overdue entry once the date passes', () => {
    const soon = build({ tasks: [task({ id: 't1', deadline: '2026-10-20' })] });
    expect(soon.map((i) => i.kind)).toEqual(['review']);
    expect(soon[0].dueInDays).toBe(4);

    const late = build({ tasks: [task({ id: 't2', deadline: '2026-10-01' })] });
    expect(late.map((i) => i.kind).sort()).toEqual(['overdue', 'review']);
    expect(late.find((i) => i.kind === 'overdue')!.dueInDays).toBe(-15);
  });

  it('ignores closed tasks, undated tasks and decided submissions', () => {
    expect(
      build({
        tasks: [
          task({ id: 't1', status: 'approved' }),
          task({ id: 't2', deadline: '' }),
        ],
        submissions: [submission({ id: 's1', status: 'approved' })],
      })
    ).toEqual([]);
  });

  it('leaves the retired recruitment queue out of the work list', () => {
    const queue = build({ tasks: [task({ id: 't1', deadline: '2026-10-20' })] });
    expect(queue.map((i) => i.view)).not.toContain('applications');
    expect(queue.map((i) => i.kind)).not.toContain('recruitment');
  });

  it('separates a season milestone from an ordinary event', () => {
    const queue = build({ events: [event({ id: 'e1' }), event({ id: 'e2', category: 'Major Event' }), event({ id: 'e3', status: 'Completed' })] });
    expect(queue.map((i) => i.kind)).toEqual(['event', 'milestone']);
  });

  it('drops a whole kind when the account turned its reminders off', () => {
    const prefs: ActionPrefs = { ...DEFAULT_ACTION_PREFS, enabled: { ...DEFAULT_ACTION_PREFS.enabled, overdue: false } };
    const queue = build({ prefs, tasks: [task({ id: 't1', deadline: '2026-10-01' })] });
    expect(queue.map((i) => i.kind)).toEqual(['review']);
  });
});

describe('who may see what', () => {
  const item = { ownerId: 'u2', committeeId: 'c1' };
  it('confines a member to work that names them', () => {
    expect(visibleTo({ role: 'member', id: 'u2', committeeId: 'c1' }, item)).toBe(true);
    expect(visibleTo({ role: 'member', id: 'u9', committeeId: 'c1' }, item)).toBe(false);
  });

  it('confines committee leadership to its committee', () => {
    expect(visibleTo({ role: 'head', id: 'u1', committeeId: 'c1' }, item)).toBe(true);
    expect(visibleTo({ role: 'director', id: 'u1', committeeId: 'c2' }, item)).toBe(false);
  });

  it('opens the chapter to moderators and Super Admins', () => {
    expect(visibleTo({ role: 'moderator', id: 'u1' }, item)).toBe(true);
    expect(visibleTo({ role: 'super_admin', id: 'u1' }, item)).toBe(true);
  });
});

describe('ordering, reminders and escalation', () => {
  it('puts the nearest date first, then closed dates, then priority', () => {
    const queue = sortQueue([
      { ...build({ events: [event({ id: 'e1' })] })[0] },
      taskQueue('tfar', '2026-10-30'),
      taskQueue('tsoon', '2026-10-17'),
    ]);
    expect(queue.map((i) => i.recordId)).toEqual(['tsoon', 'tfar', 'e1']);
  });

  it('reminds inside the lead time and immediately for what already went by', () => {
    const queue = [taskQueue('t1', '2026-10-18'), taskQueue('t2', '2026-10-30'), taskQueue('t3', '2026-10-01')];
    expect(dueForReminder(queue, 2).map((i) => i.recordId).sort()).toEqual(['t1', 't3']);
    expect(dueForReminder(queue, 0).map((i) => i.recordId)).toEqual(['t3']);
  });

  it('escalates only past the stated number of days overdue', () => {
    const actor = { role: 'super_admin' as const, id: 'u1' };
    const late = taskQueue('t1', '2026-10-01');
    expect(escalationFor(taskQueue('t2', '2026-10-15'), actor, [])).toBeNull();
    expect(escalationFor(late, actor, [person({ id: 'u2' })])).toContain('head');
    expect(escalationFor(late, actor, [person({ id: 'u2', role: 'head' })])).toContain('director');
    expect(escalationFor(late, actor, [person({ id: 'u2', role: 'director' })])).toContain('Super Admin');
  });
});

describe('one announcement per record stage', () => {
  const queue = build({ tasks: [task({ id: 't1', deadline: '2026-10-01' })] });

  it('emits a key once and suppresses it every time after', () => {
    const first = planNotifications(queue, []);
    expect(first.toEmit).toHaveLength(queue.length);
    expect(first.suppressed).toEqual([]);

    const emitted = first.toEmit.map((n, i) => ({ key: n.key, raisedAt: `2026-10-16T0${i}:00:00.000Z` }));
    const second = planNotifications(queue, emitted);
    expect(second.toEmit).toEqual([]);
    expect(second.suppressed.sort()).toEqual(queue.map((i) => i.key).sort());
  });

  it('cannot announce the same key twice inside one batch', () => {
    const doubled = [...queue, ...queue];
    expect(planNotifications(doubled, []).toEmit).toHaveLength(queue.length);
  });

  it('re-raises a stage that genuinely changed, and not one that did not', () => {
    const asReview = build({ submissions: [submission({ id: 's1', status: 'submitted' })] });
    const { toEmit } = planNotifications(asReview, []);
    expect(planNotifications(asReview, [{ key: toEmit[0].key, raisedAt: 'x' }]).toEmit).toEqual([]);

    const moved = build({ submissions: [submission({ id: 's1', status: 'under_review' })] });
    const again = planNotifications(moved, [{ key: toEmit[0].key, raisedAt: 'x' }]);
    expect(again.toEmit.map((n) => n.key)).toEqual(['approval:s1:under_review']);
  });

  it('links every notification to the screen that can act on it', () => {
    planNotifications(queue, []).toEmit.forEach((n) =>
      expect(['tasks', 'submissions', 'season_planner', 'scoring']).toContain(n.link)
    );
  });
});

function taskQueue(id: string, deadline: string) {
  const queue = build({ tasks: [task({ id, deadline })] });
  return queue.find((i) => i.kind === 'review')!;
}
