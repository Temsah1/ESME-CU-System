// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Committee, RegistrationApplication, ScoreLedgerEntry, Task, TaskSubmission, User } from '../types';
import {
  DECISION_RULES,
  deriveAlerts,
  deriveConfirmed,
  deriveSuggestions,
  deriveTrends,
  previousWindow,
  trendSignals,
  windowLengthDays,
  type DecisionInput,
} from './decisions';

/**
 * Spec A: the decision layer may only say what the records say. These tests pin the four
 * separations that make that checkable — a confirmed reading, a rule-fired alert, a trend that
 * needs two comparable windows, and a suggestion that must point back at an alert.
 */

function submission(patch: Partial<TaskSubmission> & Pick<TaskSubmission, 'id'>): TaskSubmission {
  return {
    taskId: 'task_1',
    taskTitle: 'Campaign',
    committeeId: 'c1',
    committeeName: 'Operations',
    memberId: 'u2',
    memberName: 'Member Two',
    submittedAt: '2026-10-05T09:00:00.000Z',
    description: 'done',
    status: 'submitted',
    proposedPoints: 10,
    version: 1,
    ...patch,
  };
}

function task(patch: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: 'Task',
    description: '',
    committeeId: 'c1',
    committeeName: 'Operations',
    assigneeIds: [],
    assigneeNames: [],
    createdById: 'u1',
    createdByName: 'Head',
    priority: 'medium',
    points: 10,
    startDate: '2026-09-01',
    deadline: '2026-11-01',
    status: 'in_progress',
    acceptanceCriteria: [],
    category: 'general',
    createdAt: '2026-09-01',
    ...patch,
  };
}

function member(patch: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'Member',
    email: 'm@esme.local',
    username: 'member',
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

function committee(patch: Partial<Committee> & Pick<Committee, 'id'>): Committee {
  return {
    name: `Committee ${patch.id}`,
    shortCode: 'C',
    description: '',
    objectives: [],
    subTeams: [],
    isPublic: true,
    status: 'active',
    category: 'operations',
    ...patch,
  };
}

function application(patch: Partial<RegistrationApplication> & Pick<RegistrationApplication, 'id'>): RegistrationApplication {
  return {
    fullName: 'Applicant',
    universityEmail: 'a@esme.local',
    academicYear: '3',
    department: 'Civil',
    phone: '',
    preferredCommitteeId: 'c1',
    technicalSkills: '',
    previousExperience: '',
    motivation: '',
    availabilityHours: '5',
    agreedToPolicies: true,
    appliedDate: '2026-10-01',
    status: 'pending',
    ...patch,
  };
}

function ledgerRow(patch: Partial<ScoreLedgerEntry> & Pick<ScoreLedgerEntry, 'id'>): ScoreLedgerEntry {
  return {
    memberId: 'u2',
    memberName: 'Member Two',
    committeeId: 'c1',
    points: 10,
    actionType: 'task_completion',
    reviewerId: 'u1',
    reviewerName: 'Head',
    timestamp: '2026-10-05T09:00:00.000Z',
    reason: 'approved work',
    previousTotal: 0,
    newTotal: 10,
    ...patch,
  };
}

const PERIOD = { from: '2026-10-01', to: '2026-10-31' };

function input(patch: Partial<DecisionInput> = {}): DecisionInput {
  return {
    tasks: [],
    submissions: [],
    applications: [],
    ledger: [],
    users: [],
    committees: [],
    events: [],
    audit: [],
    period: PERIOD,
    asOf: '2026-10-16T12:00:00.000Z',
    ...patch,
  };
}

describe('reporting windows', () => {
  it('counts both endpoints when sizing a window', () => {
    expect(windowLengthDays(PERIOD)).toBe(31);
    expect(windowLengthDays({ from: '2026-10-01', to: '2026-10-01' })).toBe(1);
  });

  it('places the previous window immediately before, same length, never overlapping', () => {
    const prior = previousWindow(PERIOD);
    expect(prior.from).toBe('2026-08-31');
    expect(prior.to).toBe('2026-09-30');
    expect(prior.label).toBe('2026-08-31 to 2026-09-30');
  });

  it('steps across a month boundary without drifting', () => {
    expect(previousWindow({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      label: '2026-01-29 to 2026-02-28',
      from: '2026-01-29',
      to: '2026-02-28',
    });
  });
});

describe('confirmed readings', () => {
  it('states the figure, its window and its method on every row', () => {
    const rows = deriveConfirmed(
      input({
        submissions: [submission({ id: 's1', status: 'approved', reviewedAt: '2026-10-06T10:00:00.000Z' })],
      })
    );
    expect(rows).toHaveLength(7);
    rows.forEach((row) => expect(row.period).toBeTruthy());
    const approval = rows.find((r) => r.id === 'confirmed-approval_rate')!;
    expect(approval.kind).toBe('confirmed');
    expect(approval.detail).toContain('100%');
    expect(approval.method).toContain('approved / (approved + rejected)');
    expect(approval.recordIds).toEqual(['s1']);
  });

  it('calls an unreadable figure not measurable instead of zero', () => {
    const rows = deriveConfirmed(input());
    const approval = rows.find((r) => r.id === 'confirmed-approval_rate')!;
    expect(approval.detail.startsWith('Not measurable')).toBe(true);
    expect(approval.detail).not.toContain('0%');
  });

  it('does not claim a date window for milestones, whose records are undated', () => {
    const rows = deriveConfirmed(input());
    expect(rows.find((r) => r.id === 'confirmed-milestone_progress')!.period).toBe('as written for this season');
  });
});

describe('rule-based alerts', () => {
  it('fires on past-deadline work and names the rule and records', () => {
    const alerts = deriveAlerts(
      input({
        tasks: [task({ id: 't1', deadline: '2026-10-01', status: 'in_progress' }), task({ id: 't2', deadline: '', status: 'approved' })],
      })
    );
    const overdue = alerts.find((a) => a.id === 'alert-overdue-tasks')!;
    expect(overdue.severity).toBe('action');
    expect(overdue.recordIds).toEqual(['t1']);
    expect(overdue.method).toContain('not approved, rejected or cancelled');
  });

  it('stays silent when nothing crosses a threshold', () => {
    expect(deriveAlerts(input())).toEqual([]);
  });

  it('uses the stated stall rule for reviews and recruitment', () => {
    const fresh = submission({ id: 's1', submittedAt: '2026-10-14T09:00:00.000Z' });
    const stale = submission({ id: 's2', submittedAt: '2026-10-01T09:00:00.000Z' });
    const alerts = deriveAlerts(input({ submissions: [fresh, stale] }));
    const stalled = alerts.find((a) => a.id === 'alert-stalled-reviews')!;
    expect(stalled.title).toContain('1 deliverable');
    expect(stalled.recordIds).toEqual(['s2']);
    expect(stalled.method).toContain(`${DECISION_RULES.reviewStallDays} or more days`);

    const apps = deriveAlerts(
      input({
        applications: [
          application({ id: 'a1', appliedDate: '2026-10-15' }),
          application({ id: 'a2', appliedDate: '2026-09-01', status: 'under_review' }),
          application({ id: 'a3', appliedDate: '2026-09-01', status: 'accepted' }),
        ],
      })
    );
    const waiting = apps.find((a) => a.id === 'alert-stalled-recruitment')!;
    expect(waiting.recordIds).toEqual(['a2']);
  });

  it('reports a committee only when one member holds the stated share of open work', () => {
    const rows = (share: number) =>
      input({
        committees: [committee({ id: 'c1' })],
        users: [member({ id: 'u1' }), member({ id: 'u2' })],
        tasks: Array.from({ length: 4 }, (_, i) =>
          task({
            id: `t${i}`,
            status: 'in_progress',
            assigneeIds: i < 4 - share ? ['u1'] : ['u2'],
          })
        ),
      });
    const concentrated = deriveAlerts(rows(1));
    expect(concentrated.find((a) => a.id === 'alert-workload-imbalance')!.detail).toContain('Committee c1');

    // 2 of 4 open tasks on each member is exactly the even split — no alert.
    expect(deriveAlerts(rows(2)).find((a) => a.id === 'alert-workload-imbalance')).toBeUndefined();
  });
});

describe('period-over-period trends', () => {
  const trendsOf = (patch: Partial<DecisionInput>) => deriveTrends(input(patch));

  it('compares only what means the same in both windows', () => {
    expect(trendsOf({}).map((t) => t.metric)).toEqual(['approval_rate', 'on_time_delivery', 'net_points']);
  });

  it('reports a change against a comparable earlier window', () => {
    const trends = trendsOf({
      submissions: [
        submission({ id: 'old', status: 'rejected', submittedAt: '2026-09-10T09:00:00.000Z', reviewedAt: '2026-09-11T09:00:00.000Z' }),
        submission({ id: 'new', status: 'approved', submittedAt: '2026-10-10T09:00:00.000Z', reviewedAt: '2026-10-11T09:00:00.000Z' }),
      ],
    });
    const approval = trends.find((t) => t.metric === 'approval_rate')!;
    expect(approval.previous.value).toBe(0);
    expect(approval.current.value).toBe(100);
    expect(approval.change).toBe(100);
    expect(approval.statement).toContain('2026-08-31 to 2026-09-30');
  });

  it('moves the points line only when each window holds a ledger row', () => {
    const trends = trendsOf({
      ledger: [
        ledgerRow({ id: 'l1', points: 30, timestamp: '2026-09-15T09:00:00.000Z' }),
        ledgerRow({ id: 'l2', points: 10, timestamp: '2026-10-05T09:00:00.000Z' }),
      ],
    });
    const points = trends.find((t) => t.metric === 'net_points')!;
    expect(points.previous.value).toBe(30);
    expect(points.current.value).toBe(10);
    expect(points.change).toBe(-20);
    expect(points.statement).toContain('−20 pts');
  });

  it('refuses to compare a figure that the earlier window cannot support', () => {
    const trends = trendsOf({
      submissions: [submission({ id: 'new', status: 'approved', reviewedAt: '2026-10-11T09:00:00.000Z' })],
    });
    const approval = trends.find((t) => t.metric === 'approval_rate')!;
    expect(approval.change).toBeNull();
    expect(approval.statement).toContain('No comparable figure');
    expect(trendSignals(trends, 'October 2026').every((s) => s.kind === 'trend')).toBe(true);
  });
});

describe('suggestions', () => {
  it('only ever comes from a signal that fired', () => {
    const alerts = deriveAlerts(
      input({ tasks: [task({ id: 't1', deadline: '2026-10-01', status: 'in_progress' })] })
    );
    const suggestions = deriveSuggestions(alerts);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].signalId).toBe('alert-overdue-tasks');
    expect(suggestions[0].origin).toBe('rule');
  });

  it('produces nothing when the records raise nothing', () => {
    expect(deriveSuggestions(deriveAlerts(input()))).toEqual([]);
  });

  it('never turns a confirmed reading into a claim about what to do', () => {
    const confirmed = deriveConfirmed(input());
    expect(deriveSuggestions(confirmed)).toEqual([]);
  });
});
