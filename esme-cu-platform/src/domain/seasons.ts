import type {
  AuditLogItem,
  Committee,
  RegistrationApplication,
  SeasonEvent,
  SkillMatrixEntry,
  ScoreLedgerEntry,
  Task,
  TaskSubmission,
  User,
} from '../types';
import {
  METRIC_DEFINITIONS,
  approvalRate,
  auditCoverage,
  milestoneProgress,
  netPoints,
  onTimeDelivery,
  overdueWork,
  queueBacklog,
  skillCoverage,
  workloadSpread,
  type MetricId,
  type MetricValue,
  type Period,
} from './metrics';

/**
 * Specs E and F: a season is a dated window the chapter wrote down, and an objective is a
 * target someone claimed, measured against records that already exist. Nothing here fills a
 * gap with a plausible number — a key result with no baseline, or a season with no records
 * inside it, reports itself as unmeasurable instead of as 0%.
 *
 * Closing a season freezes the figures that were true on the day it was closed. Earlier
 * seasons keep no snapshot, so they stay unmeasurable rather than gaining invented history.
 */

export type SeasonStatus = 'planning' | 'active' | 'closed';
export type KrDirection = 'increase' | 'decrease';

export interface ChapterSeason {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: SeasonStatus;
  theme: string;
  handover: string;
  createdAt: string;
  closedAt?: string;
  snapshot?: SeasonSnapshot;
}

/** The frozen numbers a closed season keeps, each with the method that produced it. */
export type SeasonSnapshot = {
  takenAt: string;
  lines: { label: string; value: string; method: string; recordIds: string[] }[];
};

export interface Objective {
  id: string;
  seasonId: string;
  title: string;
  why: string;
  ownerName: string;
  committeeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KeyResult {
  id: string;
  objectiveId: string;
  label: string;
  metric: MetricId;
  target: number;
  /** null when the starting point was never recorded — progress then cannot be computed. */
  baseline: number | null;
  direction: KrDirection;
  scope: 'chapter' | 'committee';
  committeeId?: string;
}

export type OkrData = {
  tasks: Task[];
  submissions: TaskSubmission[];
  applications: RegistrationApplication[];
  ledger: ScoreLedgerEntry[];
  users: User[];
  committees: Committee[];
  events: SeasonEvent[];
  assessments: SkillMatrixEntry[];
  audit: AuditLogItem[];
  asOf: string;
};

/** The season's own window is the period every key result is measured inside. */
export function seasonWindow(season: ChapterSeason): Period {
  return { label: `${season.label} (${season.startDate} to ${season.endDate})`, from: season.startDate, to: season.endDate };
}

const DAY = 86400000;

/** How much of the season has elapsed, 0 to 1. null before it starts or without dates. */
export function seasonElapsedFraction(season: ChapterSeason, asOf: string): number | null {
  const start = Date.parse(season.startDate);
  const end = Date.parse(season.endDate);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  const now = Date.parse(asOf.slice(0, 10));
  if (Number.isNaN(now)) return null;
  const total = (end - start) / DAY;
  return Math.min(1, Math.max(0, (now - start) / DAY / total));
}

/** Records outside the season window never count toward it, whatever scope is chosen. */
function scoped(data: OkrData, kr: KeyResult): OkrData {
  if (kr.scope !== 'committee' || !kr.committeeId) return data;
  const id = kr.committeeId;
  const committeeName = data.committees.find((c) => c.id === id)?.name;
  return {
    ...data,
    tasks: data.tasks.filter((t) => t.committeeId === id),
    submissions: data.submissions.filter((s) => s.committeeId === id),
    ledger: data.ledger.filter((l) => l.committeeId === id),
    users: data.users.filter((u) => u.committeeId === id),
    assessments: data.assessments.filter((a) => a.committeeId === id),
    applications: data.applications.filter((a) => a.preferredCommitteeId === id || a.assignedCommitteeId === id),
    // Milestones name their owning committee in prose, so only an exact name match scopes them.
    events: committeeName ? data.events.filter((e) => e.responsibleCommittee === committeeName) : [],
  };
}

function pendingApplications(applications: RegistrationApplication[]) {
  return applications.filter((a) => a.status === 'pending' || a.status === 'under_review');
}

/** Runs the one documented calculation behind this metric, over this scope and window. */
export function measureMetric(metric: MetricId, kr: KeyResult, data: OkrData, window: Period): MetricValue {
  const view = scoped(data, kr);
  const period = { ...window, label: `${window.label} · ${kr.scope === 'committee' ? 'committee' : 'chapter'}` };
  switch (metric) {
    case 'approval_rate':
      return approvalRate(view.submissions, period);
    case 'on_time_delivery':
      return onTimeDelivery(view.submissions, view.tasks, period);
    case 'net_points':
      return netPoints(view.ledger, period);
    case 'overdue_work':
      return overdueWork(view.tasks, period, data.asOf);
    case 'milestone_progress':
      return milestoneProgress(view.events);
    case 'committee_load':
      if (kr.scope !== 'committee' || !kr.committeeId) {
        return {
          id: metric,
          value: null,
          unit: METRIC_DEFINITIONS[metric].unit,
          eligible: 0,
          excluded: 0,
          recordIds: [],
          reason: 'Spread is defined per committee; a chapter-wide key result has no single denominator to measure.',
        };
      }
      return workloadSpread(view.tasks, view.users, kr.committeeId);
    case 'queue_backlog':
      // The backlog this metric defines is the recruitment queue awaiting a decision.
      return queueBacklog(pendingApplications(view.applications));
    case 'audit_coverage':
      return auditCoverage(view.audit, period);
    case 'skill_coverage':
      return skillCoverage(view.assessments);
  }
}

export type KrReading = {
  kr: KeyResult;
  value: MetricValue;
  /** 0 to 1 against the target. null when the metric or the baseline makes it unmeasurable. */
  attainment: number | null;
  unmeasurable: string | null;
};

export function evaluateKeyResult(kr: KeyResult, data: OkrData, window: Period): KrReading {
  const value = measureMetric(kr.metric, kr, data, window);
  if (value.value === null) {
    return { kr, value, attainment: null, unmeasurable: value.reason };
  }
  if (kr.direction === 'increase') {
    if (kr.target === 0) {
      return { kr, value, attainment: null, unmeasurable: 'A target of zero cannot carry a share of progress.' };
    }
    return { kr, value, attainment: Math.min(1, Math.max(0, value.value / kr.target)), unmeasurable: null };
  }
  const met = value.value <= kr.target;
  if (met) return { kr, value, attainment: 1, unmeasurable: null };
  if (kr.baseline === null || kr.baseline <= kr.target) {
    return {
      kr,
      value,
      attainment: null,
      unmeasurable:
        kr.baseline === null
          ? 'No starting point was recorded, so the distance travelled toward this target cannot be measured.'
          : 'The recorded baseline is at or below the target, so this key result has no ground to cover.',
    };
  }
  const attainment = (kr.baseline - value.value) / (kr.baseline - kr.target);
  return { kr, value, attainment: Math.min(1, Math.max(0, attainment)), unmeasurable: null };
}

export type ObjectiveStatus = 'no_key_results' | 'not_measurable' | 'achieved' | 'on_track' | 'at_risk' | 'behind' | 'before_start';

export type ObjectiveRollup = {
  objective: Objective;
  readings: KrReading[];
  /** Mean attainment across measurable results. null when none is measurable. */
  attainment: number | null;
  status: ObjectiveStatus;
  /** The share of the season already elapsed, which is what "behind" is measured against. */
  elapsed: number | null;
  method: string;
};

/** A stated rule, not a model: on track holds the elapsed pace, at risk allows 15 points of slip. */
export const OKR_RULES = { atRiskSlack: 0.15 } as const;

export function rollupObjective(
  objective: Objective,
  keyResults: KeyResult[],
  data: OkrData,
  season: ChapterSeason
): ObjectiveRollup {
  const window = seasonWindow(season);
  const readings = keyResults.filter((k) => k.objectiveId === objective.id).map((kr) => evaluateKeyResult(kr, data, window));
  const elapsed = seasonElapsedFraction(season, data.asOf);
  if (elapsed === 0 && season.status === 'planning') {
    return { objective, readings, attainment: null, status: 'before_start', elapsed, method: 'The season has not opened, so no pace can be compared against.' };
  }
  if (readings.length === 0) {
    return {
      objective,
      readings,
      attainment: null,
      status: 'no_key_results',
      elapsed,
      method: 'The objective carries no key result, so there is no calculation to run.',
    };
  }
  const measurable = readings.filter((r) => r.attainment !== null);
  if (measurable.length === 0) {
    return {
      objective,
      readings,
      attainment: null,
      status: 'not_measurable',
      elapsed,
      method: `Every key result is unmeasurable in this window: ${readings.map((r) => r.unmeasurable).filter(Boolean).join(' ')}`,
    };
  }
  const attainment = measurable.reduce((sum, r) => sum + (r.attainment ?? 0), 0) / measurable.length;
  const allMet = measurable.length === readings.length && measurable.every((r) => (r.attainment ?? 0) >= 1);
  const expected = elapsed ?? 0;
  const status: ObjectiveStatus = allMet
    ? 'achieved'
    : attainment >= expected
      ? 'on_track'
      : attainment >= expected - OKR_RULES.atRiskSlack
        ? 'at_risk'
        : 'behind';
  return {
    objective,
    readings,
    attainment,
    status,
    elapsed,
    method: allMet
      ? 'All key results have reached their target inside the season window.'
      : `Mean attainment ${Math.round(attainment * 100)}% across ${measurable.length} of ${readings.length} measurable key result(s), compared with ${Math.round(expected * 100)}% of the season elapsed. At risk allows ${Math.round(OKR_RULES.atRiskSlack * 100)} points of slip.`,
  };
}

export const OBJECTIVE_STATUS_LABEL: Record<ObjectiveStatus, string> = {
  no_key_results: 'No key result yet',
  not_measurable: 'Not measurable',
  achieved: 'Achieved',
  on_track: 'On track',
  at_risk: 'At risk',
  behind: 'Behind schedule',
  before_start: 'Season not open',
};

/**
 * The figures a season keeps when it closes. Each line names its own record ids, so a later
 * reader can re-run the calculation instead of taking the snapshot on trust.
 */
export function buildSeasonSnapshot(season: ChapterSeason, data: OkrData): SeasonSnapshot {
  const window = seasonWindow(season);
  const chapterKeyResult = (metric: MetricId): KeyResult => ({
    id: `snapshot-${metric}`,
    objectiveId: 'snapshot',
    label: METRIC_DEFINITIONS[metric].label,
    metric,
    target: 0,
    baseline: null,
    direction: 'increase',
    scope: 'chapter',
  });
  const metrics: MetricId[] = ['approval_rate', 'on_time_delivery', 'net_points', 'milestone_progress', 'skill_coverage', 'audit_coverage'];
  const lines = metrics.map((metric) => {
    const value = measureMetric(metric, chapterKeyResult(metric), data, window);
    const suffix = value.unit === '%' ? '%' : value.unit === 'pts' ? ' pts' : value.unit === 'ratio' ? '×' : '';
    return {
      label: METRIC_DEFINITIONS[metric].label,
      value: value.value === null ? 'not measurable' : `${value.value}${suffix}`,
      method: `${METRIC_DEFINITIONS[metric].method} ${value.reason}`,
      recordIds: value.recordIds,
    };
  });
  const members = data.users.filter((u) => u.joinedDate <= season.endDate).length;
  lines.push({
    label: 'Members joined on or before the closing day',
    value: String(members),
    method: `Counted from the directory by joined date up to ${season.endDate}; accounts with no joined date are not counted.`,
    recordIds: data.users.filter((u) => u.joinedDate <= season.endDate).map((u) => u.id),
  });
  return { takenAt: data.asOf, lines };
}

/** Continuity across seasons: only two snapshots can be compared, and only on a shared line. */
export function compareSnapshots(
  current: SeasonSnapshot,
  previous: SeasonSnapshot | undefined
): { label: string; current: string; previous: string | null }[] {
  return current.lines.map((line) => ({
    label: line.label,
    current: line.value,
    previous: previous?.lines.find((p) => p.label === line.label)?.value ?? null,
  }));
}

export function seasonsInOrder(seasons: ChapterSeason[]): ChapterSeason[] {
  return [...seasons].sort((a, b) => (a.startDate === b.startDate ? a.label.localeCompare(b.label) : a.startDate < b.startDate ? -1 : 1));
}

/** The season covering a given day, or none — a date outside every recorded season is not assigned one. */
export function seasonCovering(seasons: ChapterSeason[], day: string): ChapterSeason | undefined {
  return seasons.find((s) => s.startDate <= day && day <= s.endDate);
}
