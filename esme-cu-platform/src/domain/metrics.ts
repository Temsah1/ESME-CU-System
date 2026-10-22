import type { Role, ScoreLedgerEntry, SeasonEvent, Task, TaskSubmission, User } from '../types';
import { ROLE_LABELS } from './roles';

/**
 * Every number shown in the executive views is produced here, so a figure can always be
 * traced to a definition, a period, a record set and a method. Nothing in this module
 * projects, smooths, fills in or estimates: an unmeasurable metric reports `null`.
 */

export type PolicyVersion = '2026.1';

export const EVALUATION_POLICIES: {
  version: PolicyVersion;
  effectiveFrom: string;
  note: string;
  criteria: Record<'member' | 'head' | 'director' | 'moderator', { label: string; weight: number; metric: MetricId; scoring: 'percent' | 'advisory' }[]>;
}[] = [
  {
    version: '2026.1',
    effectiveFrom: '2026-09-01',
    note: 'First versioned policy. Earlier seasons have no recorded policy, so their scores cannot be re-derived.',
    criteria: {
      member: [
        { label: 'Delivered work that passed review', weight: 60, metric: 'approval_rate', scoring: 'percent' },
        { label: 'Delivered inside the agreed window', weight: 30, metric: 'on_time_delivery', scoring: 'percent' },
        { label: 'Points earned from approved records', weight: 10, metric: 'net_points', scoring: 'advisory' },
      ],
      head: [
        { label: 'Committee work approved on review', weight: 40, metric: 'approval_rate', scoring: 'percent' },
        { label: 'Committee work delivered on time', weight: 30, metric: 'on_time_delivery', scoring: 'percent' },
        { label: 'Backlog cleared for the committee', weight: 30, metric: 'overdue_work', scoring: 'advisory' },
      ],
      director: [
        { label: 'Season milestones reached', weight: 40, metric: 'milestone_progress', scoring: 'percent' },
        { label: 'Committee workload spread across members', weight: 30, metric: 'committee_load', scoring: 'advisory' },
        { label: 'Committee deliverables approved', weight: 30, metric: 'approval_rate', scoring: 'percent' },
      ],
      moderator: [
        { label: 'Recruitment queue decided', weight: 50, metric: 'queue_backlog', scoring: 'advisory' },
        { label: 'Governance actions recorded', weight: 50, metric: 'audit_coverage', scoring: 'advisory' },
      ],
    },
  },
];

export function policyFor(version: PolicyVersion) {
  return EVALUATION_POLICIES.find((p) => p.version === version) ?? EVALUATION_POLICIES[0];
}

export type MetricId =
  | 'approval_rate'
  | 'on_time_delivery'
  | 'net_points'
  | 'overdue_work'
  | 'milestone_progress'
  | 'committee_load'
  | 'queue_backlog'
  | 'audit_coverage'
  | 'skill_coverage';

export type MetricDefinition = {
  id: MetricId;
  label: string;
  unit: '%' | 'pts' | 'count' | 'ratio';
  definition: string;
  method: string;
  missingData: string;
  sources: string[];
};

export const METRIC_DEFINITIONS: Record<MetricId, MetricDefinition> = {
  approval_rate: {
    id: 'approval_rate',
    label: 'Approval rate',
    unit: '%',
    definition: 'Of the submissions decided in the period, the share that ended approved.',
    method: 'approved / (approved + rejected). Submissions still awaiting a decision are excluded from both sides.',
    missingData: 'No decided submission in the period gives null, shown as "not measurable" — never 0%.',
    sources: ['task submissions'],
  },
  on_time_delivery: {
    id: 'on_time_delivery',
    label: 'On-time delivery',
    unit: '%',
    definition: 'Of the submissions that had a deadline on their task, the share filed on or before it.',
    method: 'submissions with submittedAt <= task.deadline / submissions whose task carries a deadline.',
    missingData: 'A submission whose task has no recorded deadline is excluded, not counted as late.',
    sources: ['task submissions', 'tasks'],
  },
  net_points: {
    id: 'net_points',
    label: 'Net points',
    unit: 'pts',
    definition: 'The signed sum of ledger rows in the period.',
    method: 'sum(points) over ledger rows whose recorded timestamp falls in the period.',
    missingData: 'An empty ledger gives null rather than zero: no activity is not the same as zero score.',
    sources: ['score ledger'],
  },
  overdue_work: {
    id: 'overdue_work',
    label: 'Overdue work',
    unit: 'count',
    definition: 'Tasks past their deadline that have not reached a terminal status.',
    method: 'tasks with deadline < period end and status not in approved, rejected or cancelled.',
    missingData: 'A task with no deadline is never counted as overdue.',
    sources: ['tasks'],
  },
  milestone_progress: {
    id: 'milestone_progress',
    label: 'Milestone progress',
    unit: '%',
    definition: 'Share of recorded season milestones marked Completed.',
    method: 'completed / all milestones written for the season.',
    missingData: 'A season with no milestones written gives null; a planned milestone is not a failed one.',
    sources: ['season events'],
  },
  committee_load: {
    id: 'committee_load',
    label: 'Workload spread',
    unit: 'ratio',
    definition: 'How evenly open tasks fall across the members of a committee.',
    method: 'largest member share of open tasks / that committee’s task-owning members.',
    missingData: 'A committee with one member or no tasks reports null — there is nothing to spread.',
    sources: ['tasks', 'members'],
  },
  queue_backlog: {
    id: 'queue_backlog',
    label: 'Recruitment backlog',
    unit: 'count',
    definition: 'Registration requests still awaiting a decision.',
    method: 'applications with status pending or under_review.',
    missingData: 'An unreadable provider queue reports null and says so; the board never guesses.',
    sources: ['registration queue'],
  },
  audit_coverage: {
    id: 'audit_coverage',
    label: 'Audit coverage',
    unit: 'count',
    definition: 'Governance actions recorded in the trail for the period.',
    method: 'audit entries whose timestamp falls in the period.',
    missingData: 'Only this browser’s cache is counted; actions from other devices are absent by design.',
    sources: ['audit trail'],
  },
  skill_coverage: {
    id: 'skill_coverage',
    label: 'Skill coverage',
    unit: '%',
    definition: 'Share of assessed skill rows recorded at L2 or above with written evidence.',
    method: 'assessments with level >= L2 and non-empty evidence / all assessments.',
    missingData: 'A member with no assessment appears as "not assessed", never as L0.',
    sources: ['skill matrix'],
  },
};

export type Period = { label: string; from: string | null; to: string | null };

export function inPeriod(timestamp: string, period: Period): boolean {
  const day = timestamp.slice(0, 10);
  if (period.from && day < period.from) return false;
  if (period.to && day > period.to) return false;
  return true;
}

export type MetricValue = {
  id: MetricId;
  /** null means "not measurable in this period", which the views must render as such. */
  value: number | null;
  unit: MetricDefinition['unit'];
  eligible: number;
  excluded: number;
  recordIds: string[];
  reason: string;
};

function outcome(id: MetricId, eligible: number, excluded: number, recordIds: string[], value: number | null, reason: string): MetricValue {
  return { id, value, unit: METRIC_DEFINITIONS[id].unit, eligible, excluded, recordIds, reason };
}

const DECIDED: TaskSubmission['status'][] = ['approved', 'rejected'];
const TERMINAL: Task['status'][] = ['approved', 'rejected', 'cancelled'];

export function approvalRate(submissions: TaskSubmission[], period: Period): MetricValue {
  const decided = submissions.filter((s) => DECIDED.includes(s.status) && inPeriod(s.submittedAt, period));
  const approved = decided.filter((s) => s.status === 'approved');
  if (decided.length === 0) {
    return outcome('approval_rate', 0, submissions.length - decided.length, [], null, 'No submission was decided in this period.');
  }
  return outcome(
    'approval_rate',
    decided.length,
    submissions.length - decided.length,
    approved.map((s) => s.id),
    Math.round((approved.length / decided.length) * 100),
    `${approved.length} of ${decided.length} decided submissions ended approved.`
  );
}

export function onTimeDelivery(submissions: TaskSubmission[], tasks: Task[], period: Period): MetricValue {
  const dated = submissions.filter((s) => {
    const task = tasks.find((t) => t.id === s.taskId);
    return task?.deadline && inPeriod(s.submittedAt, period);
  });
  if (dated.length === 0) {
    return outcome('on_time_delivery', 0, submissions.length, [], null, 'No submission in this period belongs to a task with a recorded deadline.');
  }
  const onTime = dated.filter((s) => {
    const task = tasks.find((t) => t.id === s.taskId);
    return task ? s.submittedAt.slice(0, 10) <= task.deadline : false;
  });
  return outcome(
    'on_time_delivery',
    dated.length,
    submissions.length - dated.length,
    onTime.map((s) => s.id),
    Math.round((onTime.length / dated.length) * 100),
    `${onTime.length} of ${dated.length} deadline-bearing submissions were filed on or before the deadline.`
  );
}

export function netPoints(ledger: ScoreLedgerEntry[], period: Period, memberId?: string): MetricValue {
  const rows = ledger.filter((l) => (!memberId || l.memberId === memberId) && inPeriod(l.timestamp, period));
  if (rows.length === 0) {
    return outcome('net_points', 0, ledger.length, [], null, 'The ledger holds no row for this period.');
  }
  const total = rows.reduce((sum, r) => sum + r.points, 0);
  return outcome('net_points', rows.length, ledger.length - rows.length, rows.map((r) => r.id), total, `${rows.length} ledger row(s) summed.`);
}

export function overdueWork(tasks: Task[], period: Period, asOf: string): MetricValue {
  const overdue = tasks.filter(
    (t) => t.deadline && t.deadline < asOf.slice(0, 10) && !TERMINAL.includes(t.status) && inPeriod(t.startDate, { label: period.label, from: null, to: asOf.slice(0, 10) })
  );
  const noDeadline = tasks.filter((t) => !t.deadline).length;
  return outcome(
    'overdue_work',
    tasks.length,
    noDeadline,
    overdue.map((t) => t.id),
    overdue.length,
    `${overdue.length} task(s) past deadline without a terminal status; ${noDeadline} task(s) carry no deadline and were never counted.`
  );
}

export function workloadSpread(tasks: Task[], users: User[], committeeId: string): MetricValue {
  const open = tasks.filter((t) => t.committeeId === committeeId && !TERMINAL.includes(t.status));
  const owners = new Set(users.filter((u) => u.committeeId === committeeId).map((u) => u.id));
  if (open.length === 0 || owners.size < 2) {
    return outcome('committee_load', open.length, 0, [], null, 'This committee has no open task or only one member, so there is no spread to measure.');
  }
  const perMember = new Map<string, number>();
  open.forEach((t) => t.assigneeIds.filter((id) => owners.has(id)).forEach((id) => perMember.set(id, (perMember.get(id) ?? 0) + 1)));
  const shares = [...perMember.values()].sort((a, b) => b - a);
  const busiest = shares[0] ?? 0;
  return outcome(
    'committee_load',
    open.length,
    open.length - shares.reduce((a, b) => a + b, 0),
    [...perMember.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id),
    shares.length ? Number((busiest / open.length).toFixed(2)) : null,
    `Busiest assigned member holds ${busiest} of ${open.length} open task(s); ${owners.size - shares.length} member(s) hold none.`
  );
}

export function queueBacklog(pending: { id: string; status: string }[]): MetricValue {
  const open = pending.filter((a) => a.status === 'pending' || a.status === 'under_review');
  return outcome('queue_backlog', pending.length, pending.length - open.length, open.map((a) => a.id), open.length, `${open.length} request(s) awaiting a decision.`);
}

export function auditCoverage(entries: { id: string; timestamp: string }[], period: Period): MetricValue {
  const rows = entries.filter((e) => inPeriod(e.timestamp, period));
  return outcome('audit_coverage', rows.length, entries.length - rows.length, rows.map((e) => e.id), rows.length, `${rows.length} recorded action(s) in this browser’s cache.`);
}

/**
 * Milestones are counted as written. `dateOrQuarter` is free text ("Q1", "February 2027"),
 * so no period filter is pretended: the season list is the record.
 */
export function milestoneProgress(events: SeasonEvent[]): MetricValue {
  const completed = events.filter((e) => e.status === 'Completed');
  if (events.length === 0) {
    return outcome('milestone_progress', 0, 0, [], null, 'No milestone has been written for this season.');
  }
  return outcome(
    'milestone_progress',
    events.length,
    0,
    completed.map((e) => e.id),
    Math.round((completed.length / events.length) * 100),
    `${completed.length} of ${events.length} written milestone(s) recorded as Completed.`
  );
}

export function skillCoverage(assessments: { id: string; level: string; evidence: string }[]): MetricValue {
  const evidenced = assessments.filter((a) => a.evidence.trim().length > 0);
  const proficient = evidenced.filter((a) => ['L2', 'L3', 'L4'].includes(a.level));
  if (assessments.length === 0) {
    return outcome('skill_coverage', 0, 0, [], null, 'No skill assessment has been recorded, so coverage is unknown — not zero.');
  }
  return outcome(
    'skill_coverage',
    assessments.length,
    assessments.length - evidenced.length,
    proficient.map((a) => a.id),
    Math.round((proficient.length / assessments.length) * 100),
    `${proficient.length} of ${assessments.length} assessment(s) sit at L2 or above with written evidence; ${assessments.length - evidenced.length} carry none and are excluded from proficiency.`
  );
}

export type ScoreLine = {
  label: string;
  weight: number;
  metric: MetricId;
  scoring: 'percent' | 'advisory';
  value: number | null;
  contribution: number | null;
  note: string;
};

export type RoleScore = {
  policyVersion: PolicyVersion;
  role: string;
  lines: ScoreLine[];
  total: number | null;
  note: string;
};

/**
 * A role score averages only the criteria that were measurable, and reports the weights it
 * had to leave out. Nobody is marked down for data that was never recorded, and advisory
 * counts (points, backlogs) cannot lift or sink a score — a documented choice, not an accident.
 */
export function roleScore(
  role: Role,
  values: Partial<Record<MetricId, MetricValue>>,
  version: PolicyVersion = '2026.1'
): RoleScore {
  const policy = policyFor(version);
  const criteria = policy.criteria[role as keyof typeof policy.criteria];
  if (!criteria) {
    return { policyVersion: policy.version, role, lines: [], total: null, note: `Policy ${policy.version} defines no evaluation criteria for ${ROLE_LABELS[role]}.` };
  }
  const lines: ScoreLine[] = criteria.map((c) => {
    const metric = values[c.metric];
    return {
      label: c.label,
      weight: c.weight,
      metric: c.metric,
      scoring: c.scoring,
      value: metric?.value ?? null,
      contribution: c.scoring === 'percent' && metric?.value !== null && metric?.value !== undefined ? (metric.value / 100) * c.weight : null,
      note: metric?.reason ?? `${METRIC_DEFINITIONS[c.metric].label} was not read for this period.`,
    };
  });
  const scored = lines.filter((l) => l.contribution !== null);
  const weightUsed = scored.reduce((sum, l) => sum + l.weight, 0);
  const dropped = lines.filter((l) => l.contribution === null);
  return {
    policyVersion: policy.version,
    role,
    lines,
    total: weightUsed === 0 ? null : Math.round((scored.reduce((sum, l) => sum + (l.contribution ?? 0), 0) / weightUsed) * 100),
    note:
      weightUsed === 0
        ? 'No criterion could be measured, so no score is produced.'
        : `Averaged over ${weightUsed}% of the policy weight; ${dropped.length} criterion left out as unmeasurable or advisory.`,
  };
}

export type AppealStatus = 'open' | 'upheld' | 'overturned' | 'declined';

export type ScoreAppeal = {
  id: string;
  memberId: string;
  memberName: string;
  metric: MetricId;
  periodLabel: string;
  reason: string;
  filedAt: string;
  status: AppealStatus;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
};

/** A complaint is only actionable if it names the figure, the period and why it is wrong. */
export function validateAppeal(draft: Pick<ScoreAppeal, 'metric' | 'periodLabel' | 'reason'>): string[] {
  const errors: string[] = [];
  if (!METRIC_DEFINITIONS[draft.metric]) errors.push('Name the metric you are disputing.');
  if (!draft.periodLabel.trim()) errors.push('Name the reporting period the figure belongs to.');
  if (draft.reason.trim().length < 20) errors.push('Give at least 20 characters explaining what is inaccurate.');
  return errors;
}

/**
 * Deciding an appeal records the decision and nothing else. It cannot edit a ledger row,
 * a submission or a score — a correction is a separate, reasoned, audited adjustment.
 */
export function decideAppeal(
  appeal: ScoreAppeal,
  status: Exclude<AppealStatus, 'open'>,
  note: string,
  actor: string,
  at: string
): ScoreAppeal {
  if (appeal.status !== 'open') throw new Error('This review request was already decided.');
  if (note.trim().length < 10) throw new Error('A decision needs a written note of at least 10 characters.');
  return { ...appeal, status, decisionNote: note.trim(), decidedBy: actor, decidedAt: at };
}

