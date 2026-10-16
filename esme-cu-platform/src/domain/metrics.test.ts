// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ScoreLedgerEntry, SeasonEvent, Task, TaskSubmission, User } from '../types';
import {
  EVALUATION_POLICIES,
  METRIC_DEFINITIONS,
  approvalRate,
  auditCoverage,
  decideAppeal,
  inPeriod,
  milestoneProgress,
  netPoints,
  onTimeDelivery,
  overdueWork,
  policyFor,
  queueBacklog,
  roleScore,
  skillCoverage,
  validateAppeal,
  workloadSpread,
  type MetricId,
  type MetricValue,
  type Period,
  type ScoreAppeal,
} from './metrics';

const Q: Period = { label: 'Autumn 2026', from: '2026-09-01', to: '2026-12-31' };

function submission(patch: Partial<TaskSubmission> & Pick<TaskSubmission, 'id'>): TaskSubmission {
  return {
    taskId: 'task_1',
    taskTitle: 'Field campaign',
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

function member(patch: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'M',
    email: 'm@esme.local',
    username: 'm',
    role: 'member',
    committeeId: 'c1',
    status: 'active',
    emailVerified: true,
    totalPoints: 0,
    approvedTasksCount: 0,
    joinedDate: '2026-09-01',
    lastActive: '2026-10-01',
    ...patch,
  };
}

describe('period filtering', () => {
  it('includes both endpoints and an open-ended period', () => {
    expect(inPeriod('2026-09-01T00:00:00.000Z', Q)).toBe(true);
    expect(inPeriod('2026-12-31T23:59:59.000Z', Q)).toBe(true);
    expect(inPeriod('2026-08-31T23:59:59.000Z', Q)).toBe(false);
    expect(inPeriod('2027-01-01T00:00:00.000Z', Q)).toBe(false);
    expect(inPeriod('2024-01-01', { label: 'All time', from: null, to: null })).toBe(true);
  });
});

describe('approval rate', () => {
  const rows = [
    submission({ id: 's1', status: 'approved' }),
    submission({ id: 's2', status: 'rejected' }),
    submission({ id: 's3', status: 'approved' }),
    submission({ id: 's4', status: 'under_review' }),
    submission({ id: 's5', status: 'approved', submittedAt: '2026-03-01T00:00:00.000Z' }),
  ];

  it('counts decided rows in the period and ignores undecided ones entirely', () => {
    const result = approvalRate(rows, Q);
    expect(result.value).toBe(67);
    expect(result.eligible).toBe(3);
    expect(result.excluded).toBe(2);
    expect(result.recordIds).toEqual(['s1', 's3']);
    expect(result.reason).toBe('2 of 3 decided submissions ended approved.');
  });

  it('is not measurable — not zero — when nothing was decided', () => {
    const result = approvalRate([submission({ id: 's4', status: 'under_review' })], Q);
    expect(result.value).toBeNull();
    expect(result.unit).toBe('%');
    expect(result.reason).toMatch(/No submission was decided/);
  });
});

describe('on-time delivery', () => {
  const tasks = [
    task({ id: 'task_1', deadline: '2026-10-10' }),
    task({ id: 'task_2', deadline: '' }),
    task({ id: 'task_3', deadline: '2026-09-20' }),
  ];

  it('excludes a submission whose task carries no deadline instead of calling it late', () => {
    const result = onTimeDelivery(
      [
        submission({ id: 'a', taskId: 'task_1', submittedAt: '2026-10-10T08:00:00.000Z' }),
        submission({ id: 'b', taskId: 'task_2' }),
        submission({ id: 'c', taskId: 'task_3', submittedAt: '2026-10-01T00:00:00.000Z' }),
      ],
      tasks,
      Q
    );
    expect(result.eligible).toBe(2);
    expect(result.excluded).toBe(1);
    expect(result.value).toBe(50);
    expect(result.recordIds).toEqual(['a']);
  });

  it('is not measurable when no task in view has a deadline', () => {
    const result = onTimeDelivery([submission({ id: 'b', taskId: 'task_2' })], tasks, Q);
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(/with a recorded deadline/);
  });
});

describe('net points', () => {
  it('sums signed rows in the period for one member', () => {
    const rows = [
      ledgerRow({ id: 'l1', points: 30 }),
      ledgerRow({ id: 'l2', points: -10, actionType: 'manual_adjustment' }),
      ledgerRow({ id: 'l3', points: 5, memberId: 'u9' }),
      ledgerRow({ id: 'l4', points: 99, timestamp: '2026-01-01T00:00:00.000Z' }),
    ];
    const result = netPoints(rows, Q, 'u2');
    expect(result.value).toBe(20);
    expect(result.eligible).toBe(2);
    expect(result.excluded).toBe(2);
  });

  it('reports null for an empty ledger — no activity is not a zero score', () => {
    expect(netPoints([], Q).value).toBeNull();
    expect(netPoints([ledgerRow({ id: 'l4', timestamp: '2025-01-01T00:00:00.000Z' })], Q).value).toBeNull();
  });
});

describe('overdue work', () => {
  it('never counts a task without a deadline and skips closed ones', () => {
    const asOf = '2026-11-15T12:00:00.000Z';
    const result = overdueWork(
      [
        task({ id: 't1', deadline: '2026-11-01', status: 'in_progress' }),
        task({ id: 't2', deadline: '', status: 'assigned' }),
        task({ id: 't3', deadline: '2026-11-01', status: 'approved' }),
        task({ id: 't4', deadline: '2026-12-01', status: 'submitted' }),
      ],
      Q,
      asOf
    );
    expect(result.value).toBe(1);
    expect(result.recordIds).toEqual(['t1']);
    expect(result.excluded).toBe(1);
    expect(result.reason).toMatch(/1 task\(s\) carry no deadline/);
  });
});

describe('workload spread', () => {
  const users = [member({ id: 'u1' }), member({ id: 'u2' }), member({ id: 'u3' })];

  it('measures the busiest share of open work and names who holds none', () => {
    const result = workloadSpread(
      [
        task({ id: 't1', assigneeIds: ['u1', 'u2'] }),
        task({ id: 't2', assigneeIds: ['u1'] }),
        task({ id: 't3', assigneeIds: ['outsider'] }),
      ],
      users,
      'c1'
    );
    expect(result.unit).toBe('ratio');
    expect(result.value).toBe(0.67);
    expect(result.excluded).toBe(0);
    expect(result.recordIds).toEqual(['u1', 'u2']);
    expect(result.reason).toMatch(/Busiest assigned member holds 2 of 3 open task\(s\); 1 member\(s\) hold none/);
  });

  it('is not measurable for a one-member committee', () => {
    expect(workloadSpread([task({ id: 't1', assigneeIds: ['u1'] })], [member({ id: 'u1' })], 'c1').value).toBeNull();
  });

  it('is not measurable when the committee has no open task', () => {
    const result = workloadSpread([task({ id: 't1', status: 'approved', assigneeIds: ['u1', 'u2'] })], users, 'c1');
    expect(result.value).toBeNull();
  });
});

describe('queue backlog, audit coverage and milestones', () => {
  it('counts undecided recruitment only', () => {
    const result = queueBacklog([
      { id: 'a1', status: 'pending' },
      { id: 'a2', status: 'under_review' },
      { id: 'a3', status: 'accepted' },
      { id: 'a4', status: 'waitlisted' },
    ]);
    expect(result.value).toBe(2);
    expect(result.recordIds).toEqual(['a1', 'a2']);
  });

  it('counts audit entries in the period and says where they came from', () => {
    const result = auditCoverage(
      [
        { id: 'e1', timestamp: '2026-10-01T00:00:00.000Z' },
        { id: 'e2', timestamp: '2026-01-01T00:00:00.000Z' },
      ],
      Q
    );
    expect(result.value).toBe(1);
    expect(result.excluded).toBe(1);
    expect(result.reason).toMatch(/browser/i);
  });

  it('leaves a planned milestone uncounted as failure', () => {
    const result = milestoneProgress([
      { id: 'm1', status: 'Completed' },
      { id: 'm2', status: 'Planned' },
      { id: 'm3', status: 'In Preparation' },
      { id: 'm4', status: 'Confirmed' },
    ] as SeasonEvent[]);
    expect(result.value).toBe(25);
    expect(result.recordIds).toEqual(['m1']);
  });

  it('is not measurable for a season with no milestone written', () => {
    const result = milestoneProgress([]);
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(/No milestone has been written/);
  });
});

describe('skill coverage', () => {
  it('needs both a level and written evidence', () => {
    const result = skillCoverage([
      { id: 'k1', level: 'L3', evidence: 'Ran the NDT pilot' },
      { id: 'k2', level: 'L2', evidence: '   ' },
      { id: 'k3', level: 'L1', evidence: 'Shadowed a session' },
      { id: 'k4', level: 'L4', evidence: 'Authored the checklist' },
    ]);
    expect(result.value).toBe(50);
    expect(result.excluded).toBe(1);
    expect(result.recordIds).toEqual(['k1', 'k4']);
  });

  it('is unknown, not zero, when nobody was assessed', () => {
    expect(skillCoverage([]).value).toBeNull();
  });
});

describe('evaluation policy and role scores', () => {
  const measurable = (over: Partial<Record<MetricId, MetricValue>> = {}): Partial<Record<MetricId, MetricValue>> => ({
    approval_rate: approvalRate([submission({ id: 'a', status: 'approved' })], Q),
    on_time_delivery: onTimeDelivery([submission({ id: 'a', status: 'approved' })], [task({ id: 'task_1' })], Q),
    ...over,
  });

  it('ships exactly one versioned policy and resolves it by version', () => {
    expect(EVALUATION_POLICIES.map((p) => p.version)).toEqual(['2026.1']);
    expect(policyFor('2026.1').effectiveFrom).toBe('2026-09-01');
    expect(policyFor('2026.1').note).toMatch(/cannot be re-derived/);
  });

  it('weights only the percent criteria that were measurable', () => {
    const score = roleScore('member', measurable());
    expect(score.total).toBe(100);
    expect(score.lines).toHaveLength(3);
    expect(score.lines.find((l) => l.metric === 'net_points')?.contribution).toBeNull();
    expect(score.note).toMatch(/Averaged over 90% of the policy weight/);
  });

  it('does not penalise a member whose data was never recorded', () => {
    const score = roleScore('member', {
      approval_rate: approvalRate([submission({ id: 'a', status: 'approved' })], Q),
      on_time_delivery: onTimeDelivery([submission({ id: 'b', taskId: 'task_x' })], [task({ id: 'task_x', deadline: '' })], Q),
    });
    expect(score.total).toBe(100);
    expect(score.lines.find((l) => l.metric === 'on_time_delivery')?.value).toBeNull();
    expect(score.note).toMatch(/Averaged over 60% of the policy weight; 2 criterion left out/);
  });

  it('produces no score at all when nothing is measurable', () => {
    const score = roleScore('moderator', {});
    expect(score.total).toBeNull();
    expect(score.note).toBe('No criterion could be measured, so no score is produced.');
    expect(score.lines.every((l) => l.scoring === 'advisory')).toBe(true);
  });

  it('refuses to invent a score for a role the policy does not cover', () => {
    const score = roleScore('super_admin', measurable());
    expect(score.total).toBeNull();
    expect(score.lines).toEqual([]);
    expect(score.note).toMatch(/defines no evaluation criteria for super admin/);
  });

  it('keeps every metric definition honest about missing data', () => {
    for (const definition of Object.values(METRIC_DEFINITIONS)) {
      expect(definition.method.length).toBeGreaterThan(20);
      expect(definition.missingData.length).toBeGreaterThan(10);
      expect(definition.sources.length).toBeGreaterThan(0);
    }
  });
});

describe('score appeals', () => {
  const appeal: ScoreAppeal = {
    id: 'app_1',
    memberId: 'u2',
    memberName: 'Member Two',
    metric: 'approval_rate',
    periodLabel: 'Autumn 2026',
    reason: 'Two of my submissions were decided in the wrong period.',
    filedAt: '2026-10-20T00:00:00.000Z',
    status: 'open',
  };

  it('requires a named metric, a named period and a usable explanation', () => {
    expect(validateAppeal(appeal)).toEqual([]);
    expect(
      validateAppeal({ metric: 'not_a_metric' as any, periodLabel: '  ', reason: 'unfair' })
    ).toHaveLength(3);
    expect(validateAppeal({ ...appeal, reason: 'short' })).toEqual([
      'Give at least 20 characters explaining what is inaccurate.',
    ]);
  });

  it('records a decision without touching the disputed figure', () => {
    const decided = decideAppeal(appeal, 'overturned', 'The period filter excluded a decided submission.', 'Kareem Tamer', '2026-10-22T00:00:00.000Z');
    expect(decided.status).toBe('overturned');
    expect(decided.decidedBy).toBe('Kareem Tamer');
    expect(decided.decisionNote).toBe('The period filter excluded a decided submission.');
    expect(appeal.status).toBe('open');
  });

  it('refuses a second decision and an undocumented one', () => {
    const decided = decideAppeal(appeal, 'upheld', 'The calculation matches the records.', 'Kareem Tamer', '2026-10-22T00:00:00.000Z');
    expect(() => decideAppeal(decided, 'declined', 'changed my mind', 'Kareem Tamer', '2026-10-23T00:00:00.000Z')).toThrow(/already decided/);
    expect(() => decideAppeal(appeal, 'upheld', 'ok', 'Kareem Tamer', '2026-10-22T00:00:00.000Z')).toThrow(/at least 10 characters/);
  });
});
