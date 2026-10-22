import type { AuditLogItem, Committee, RegistrationApplication, ScoreLedgerEntry, SeasonEvent, Task, TaskSubmission, User } from '../types';
import {
  METRIC_DEFINITIONS,
  approvalRate,
  auditCoverage,
  milestoneProgress,
  netPoints,
  onTimeDelivery,
  overdueWork,
  queueBacklog,
  workloadSpread,
  type MetricValue,
  type Period,
} from './metrics';

/**
 * Spec A: the decision layer separates four things that dashboards usually blur together.
 *
 *  - `confirmed` — a number read straight out of the records, with its method.
 *  - `alert`     — a documented rule crossing a documented threshold, not a model's guess.
 *  - `trend`     — the same measurement over a comparable earlier window, or none.
 *  - `suggestion`— a candidate next action. Always derived from a signal above, never a fact.
 *
 * Nothing here invents a figure: an unmeasurable reading reports null and stays unmeasurable,
 * and a trend whose earlier window has no data says so instead of comparing against nothing.
 */

export type SignalKind = 'confirmed' | 'alert' | 'trend';

export type SignalView =
  | 'tasks'
  | 'submissions'
  | 'applications'
  | 'scoring'
  | 'committees'
  | 'season_planner'
  | 'skill_matrix'
  | 'members';

export type Signal = {
  id: string;
  kind: SignalKind;
  /** `action` needs someone now; `watch` is worth knowing; `info` is context. */
  severity: 'action' | 'watch' | 'info';
  title: string;
  detail: string;
  /** The window the figures belong to, repeated on every signal so nothing floats free. */
  period: string;
  method: string;
  recordIds: string[];
  view?: SignalView;
};

export type Suggestion = {
  signalId: string;
  action: string;
  /** Every suggestion in this build comes from a stated rule, not a model. */
  origin: 'rule';
};

/** The thresholds are constants, stated on the signal that uses them. */
export const DECISION_RULES = {
  /** A deliverable nobody has touched for this many days is called out. */
  reviewStallDays: 7,
  /** A registration nobody has answered for this many days is called out. */
  recruitmentStallDays: 7,
  /** One member holding more than this share of a committee's open work is called out. */
  imbalanceShare: 0.5,
} as const;

const addDays = (iso: string, days: number): string => {
  const [year, month, day] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
};

export function windowLengthDays(period: { from: string; to: string }): number {
  const [y1, m1, d1] = period.from.split('-').map(Number);
  const [y2, m2, d2] = period.to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/** The equal-length window immediately before this one — the only comparison claimed to be comparable. */
export function previousWindow(period: { from: string; to: string }): Period {
  const length = windowLengthDays(period);
  const to = addDays(period.from, -1);
  const from = addDays(to, -(length - 1));
  return { label: `${from} to ${to}`, from, to };
}

const daysBetween = (fromIso: string, toIso: string) =>
  Math.floor((Date.parse(toIso) - Date.parse(fromIso.slice(0, 10))) / 86400000);

export type DecisionInput = {
  tasks: Task[];
  submissions: TaskSubmission[];
  applications: RegistrationApplication[];
  ledger: ScoreLedgerEntry[];
  users: User[];
  committees: Committee[];
  events: SeasonEvent[];
  audit: AuditLogItem[];
  period: { from: string; to: string };
  asOf: string;
};

function reading(id: MetricValue['id'], value: MetricValue, periodLabel: string): Signal {
  const def = METRIC_DEFINITIONS[id];
  const suffix = def.unit === '%' ? '%' : def.unit === 'pts' ? ' pts' : def.unit === 'ratio' ? '×' : '';
  return {
    id: `confirmed-${id}`,
    kind: 'confirmed',
    severity: 'info',
    title: def.label,
    detail:
      value.value === null
        ? `Not measurable — ${value.reason.charAt(0).toLowerCase()}${value.reason.slice(1)}`
        : `${value.value}${suffix} — ${value.reason}`,
    period: periodLabel,
    method: `${def.method} Records outside the figure: ${value.excluded}. ${def.missingData}`,
    recordIds: value.recordIds,
  };
}

export function deriveConfirmed(input: DecisionInput): Signal[] {
  const period: Period = { label: `${input.period.from} to ${input.period.to}`, ...input.period };
  return [
    reading('approval_rate', approvalRate(input.submissions, period), period.label),
    reading('on_time_delivery', onTimeDelivery(input.submissions, input.tasks, period), period.label),
    reading('net_points', netPoints(input.ledger, period), period.label),
    reading('overdue_work', overdueWork(input.tasks, period, input.asOf), period.label),
    reading('queue_backlog', queueBacklog(input.applications.map((a) => ({ id: a.id, status: a.status }))), period.label),
    reading('audit_coverage', auditCoverage(input.audit, period), period.label),
    // Milestones are counted as written; `dateOrQuarter` is free text, so no window is claimed.
    reading('milestone_progress', milestoneProgress(input.events), 'as written for this season'),
  ];
}

/** Rule-based alerts: each one names the rule it crossed and the records behind it. */
export function deriveAlerts(input: DecisionInput): Signal[] {
  const signals: Signal[] = [];
  const label = `${input.period.from} to ${input.period.to}`;

  const overdue = input.tasks.filter(
    (t) => t.deadline && t.deadline < input.asOf.slice(0, 10) && !['approved', 'rejected', 'cancelled'].includes(t.status)
  );
  if (overdue.length > 0) {
    signals.push({
      id: 'alert-overdue-tasks',
      kind: 'alert',
      severity: 'action',
      title: `${overdue.length} task${overdue.length === 1 ? '' : 's'} past deadline`,
      detail: overdue.map((t) => `${t.title} (due ${t.deadline})`).join('; '),
      period: label,
      method: `Rule: deadline earlier than ${input.asOf.slice(0, 10)} and status not approved, rejected or cancelled. Tasks with no deadline are never counted.`,
      recordIds: overdue.map((t) => t.id),
      view: 'tasks',
    });
  }

  const stalled = input.submissions.filter(
    (s) =>
      (s.status === 'submitted' || s.status === 'under_review') &&
      daysBetween(s.submittedAt, input.asOf) >= DECISION_RULES.reviewStallDays
  );
  if (stalled.length > 0) {
    signals.push({
      id: 'alert-stalled-reviews',
      kind: 'alert',
      severity: 'action',
      title: `${stalled.length} deliverable${stalled.length === 1 ? '' : 's'} awaiting a decision`,
      detail: stalled.map((s) => `${s.taskTitle} from ${s.memberName} (${daysBetween(s.submittedAt, input.asOf)} days)`).join('; '),
      period: label,
      method: `Rule: still submitted or under review and filed ${DECISION_RULES.reviewStallDays} or more days before ${input.asOf.slice(0, 10)}.`,
      recordIds: stalled.map((s) => s.id),
      view: 'submissions',
    });
  }

  const waitingApps = input.applications.filter(
    (a) => (a.status === 'pending' || a.status === 'under_review') && daysBetween(a.appliedDate, input.asOf) >= DECISION_RULES.recruitmentStallDays
  );
  if (waitingApps.length > 0) {
    signals.push({
      id: 'alert-stalled-recruitment',
      kind: 'alert',
      severity: 'watch',
      title: `${waitingApps.length} application${waitingApps.length === 1 ? '' : 's'} unanswered`,
      detail: waitingApps.map((a) => `${a.fullName} (${daysBetween(a.appliedDate, input.asOf)} days)`).join('; '),
      period: label,
      method: `Rule: still pending or under review ${DECISION_RULES.recruitmentStallDays} or more days after the applied date.`,
      recordIds: waitingApps.map((a) => a.id),
      view: 'applications',
    });
  }

  const imbalanced = input.committees
    .filter((c) => c.status === 'active')
    .map((c) => ({ committee: c, spread: workloadSpread(input.tasks, input.users, c.id) }))
    .filter((row) => row.spread.value !== null && row.spread.value > DECISION_RULES.imbalanceShare)
    .sort((a, b) => (b.spread.value ?? 0) - (a.spread.value ?? 0));
  if (imbalanced.length > 0) {
    signals.push({
      id: 'alert-workload-imbalance',
      kind: 'alert',
      severity: 'watch',
      title: `${imbalanced.length} committee${imbalanced.length === 1 ? '' : 's'} with concentrated work`,
      detail: imbalanced
        .map((row) => `${row.committee.name}: ${row.spread.reason}`)
        .join('; '),
      period: label,
      method: `Rule: busiest assigned member holds more than ${DECISION_RULES.imbalanceShare * 100}% of the committee's open tasks. Committees with one member or no open task are not measured.`,
      recordIds: imbalanced.map((row) => row.spread.recordIds[0]).filter(Boolean),
      view: 'committees',
    });
  }

  return signals;
}

export type TrendComparison = {
  metric: MetricValue['id'];
  label: string;
  current: MetricValue;
  previous: MetricValue;
  currentLabel: string;
  previousLabel: string;
  /** null when either side is unmeasurable — a change cannot be reported against nothing. */
  change: number | null;
  statement: string;
};

/** The three readings that mean the same thing in two windows. Counts and ratios are not compared. */
const COMPARABLE: MetricValue['id'][] = ['approval_rate', 'on_time_delivery', 'net_points'];

export function deriveTrends(input: DecisionInput): TrendComparison[] {
  const current: Period = { label: `${input.period.from} to ${input.period.to}`, ...input.period };
  const prior = previousWindow(input.period);
  const measure = (period: Period, id: MetricValue['id']): MetricValue => {
    if (id === 'approval_rate') return approvalRate(input.submissions, period);
    if (id === 'on_time_delivery') return onTimeDelivery(input.submissions, input.tasks, period);
    return netPoints(input.ledger, period);
  };
  return COMPARABLE.map((id) => {
    const now = measure(current, id);
    const before = measure(prior, id);
    const change = now.value === null || before.value === null ? null : now.value - before.value;
    return {
      metric: id,
      label: METRIC_DEFINITIONS[id].label,
      current: now,
      previous: before,
      currentLabel: current.label,
      previousLabel: prior.label,
      change,
      statement:
        change === null
          ? `No comparable figure: ${now.value === null ? 'this window' : 'the previous window'} has no measurable ${METRIC_DEFINITIONS[id].label.toLowerCase()}.`
          : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}${METRIC_DEFINITIONS[id].unit === 'pts' ? ' pts' : '%'} against ${before.value} in ${prior.label}.`,
    };
  });
}

/** Suggestions are generated from signals only. A suggestion with no signal is not generated. */
export function deriveSuggestions(signals: Signal[]): Suggestion[] {
  const out: Suggestion[] = [];
  signals.forEach((signal) => {
    if (signal.kind !== 'alert' || signal.severity === 'info') return;
    if (signal.id === 'alert-overdue-tasks')
      out.push({ signalId: signal.id, action: 'Re-date or close the tasks named, then re-check the committee queue.', origin: 'rule' });
    if (signal.id === 'alert-stalled-reviews')
      out.push({ signalId: signal.id, action: 'Assign each deliverable to a reviewer who is not its author and take it into review.', origin: 'rule' });
    if (signal.id === 'alert-stalled-recruitment')
      out.push({ signalId: signal.id, action: 'Decide the waiting applications, or record why each one is still open.', origin: 'rule' });
    if (signal.id === 'alert-workload-imbalance')
      out.push({ signalId: signal.id, action: 'Move open work from the named member to a committee member holding none.', origin: 'rule' });
  });
  return out;
}

export function trendSignals(trends: TrendComparison[], periodLabel: string): Signal[] {
  return trends.map((trend) => ({
    id: `trend-${trend.metric}`,
    kind: 'trend' as SignalKind,
    severity: 'info' as const,
    title: `${trend.label} over period`,
    detail: trend.statement,
    period: periodLabel,
    method: `The same definition applied twice: ${trend.previous.reason} in ${trend.previousLabel}, and ${trend.current.reason} in ${trend.currentLabel}.`,
    recordIds: [...trend.current.recordIds, ...trend.previous.recordIds],
  }));
}
