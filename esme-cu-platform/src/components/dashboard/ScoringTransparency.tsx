import React, { useMemo, useState } from 'react';
import { Gavel, Scale } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import type { Capability } from '../../domain/roles';
import { ROLE_LABELS } from '../../domain/roles';
import type { ScoreAppeal } from '../../domain/metrics';
import {
  EVALUATION_POLICIES,
  METRIC_DEFINITIONS,
  approvalRate,
  auditCoverage,
  milestoneProgress,
  netPoints,
  onTimeDelivery,
  overdueWork,
  queueBacklog,
  roleScore,
  skillCoverage,
  workloadSpread,
  type MetricId,
  type MetricValue,
  type Period,
} from '../../domain/metrics';
import type { User } from '../../types';
import { EmptyState } from '../EmptyState';
import { useToast } from '../../motion';

/**
 * Spec G: every figure a member is graded on must be traceable to a definition, a period, a
 * record set, a method and the policy version in force — and it must be disputable.
 *
 * This view reads nothing that the requesting account could not already read. A metric whose
 * source records are outside the account's scope is reported as not measured, never fetched in
 * the background and shown anyway.
 */

const fieldClass =
  'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]';
const labelClass = 'block text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-1';

const cardClass =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm';

const tableHead =
  'bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]';

const DECISIONS: { value: 'upheld' | 'overturned' | 'declined'; label: string }[] = [
  { value: 'upheld', label: 'Upheld — the figure stands' },
  { value: 'overturned', label: 'Overturned — the figure was wrong' },
  { value: 'declined', label: 'Declined — outside policy' },
];

function newest(
  ids: string[],
  timeOf: (id: string) => string | undefined
): string | null {
  let best: string | null = null;
  ids.forEach((id) => {
    const at = timeOf(id);
    if (at && (best === null || at > best)) best = at;
  });
  return best;
}

/**
 * "Last update" answered honestly: the newest record actually used by this calculation.
 * Some metrics are computed from rows that carry no timestamp at all, and this says so
 * instead of inventing one.
 */
function lastRecordUsed(
  value: MetricValue,
  ctx: {
    submissions: { id: string; submittedAt: string; reviewedAt?: string }[];
    tasks: { id: string; createdAt: string }[];
    ledger: { id: string; timestamp: string }[];
    applications: { id: string; appliedDate: string }[];
    audit: { id: string; timestamp: string }[];
    skills: { id: string; lastAssessment: string }[];
  }
): string | null {
  switch (value.id) {
    case 'approval_rate':
      return newest(value.recordIds, (id) => ctx.submissions.find((s) => s.id === id)?.reviewedAt);
    case 'on_time_delivery':
      return newest(value.recordIds, (id) => ctx.submissions.find((s) => s.id === id)?.submittedAt);
    case 'net_points':
      return newest(value.recordIds, (id) => ctx.ledger.find((l) => l.id === id)?.timestamp);
    case 'overdue_work':
      return newest(value.recordIds, (id) => ctx.tasks.find((t) => t.id === id)?.createdAt);
    case 'queue_backlog':
      return newest(value.recordIds, (id) => ctx.applications.find((a) => a.id === id)?.appliedDate);
    case 'audit_coverage':
      return newest(value.recordIds, (id) => ctx.audit.find((a) => a.id === id)?.timestamp);
    case 'skill_coverage':
      return newest(value.recordIds, (id) => ctx.skills.find((s) => s.id === id)?.lastAssessment);
    default:
      return null;
  }
}

const AppealDecision: React.FC<{ appeal: ScoreAppeal; mayDecide: boolean }> = ({ appeal, mayDecide }) => {
  const { decideScoreAppeal } = useApp();
  const { toast } = useToast();
  const [status, setStatus] = useState<'upheld' | 'overturned' | 'declined'>('upheld');
  const [note, setNote] = useState('');

  if (appeal.status !== 'open') {
    return (
      <div className="text-[11px] text-slate-500">
        <span className="font-bold uppercase text-[10px]">{appeal.status}</span>
        {appeal.decidedBy && (
          <span className="mt-0.5 block">
            {appeal.decidedBy} · {appeal.decidedAt} — {appeal.decisionNote}
          </span>
        )}
      </div>
    );
  }
  if (!mayDecide) {
    return <p className="text-[11px] text-slate-400">Awaiting a decision by an account that holds the scoring capability.</p>;
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          decideScoreAppeal(appeal.id, status, note);
          toast('Review request decided and recorded.', 'success');
          setNote('');
        } catch (error) {
          toast(error instanceof Error ? error.message : 'The decision was not recorded.', 'error');
        }
      }}
    >
      <label className="sr-only" htmlFor={`appeal-status-${appeal.id}`}>
        Decision for this review request
      </label>
      <select
        id={`appeal-status-${appeal.id}`}
        value={status}
        onChange={(e) => setStatus(e.target.value as typeof status)}
        className={fieldClass}
      >
        {DECISIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`appeal-note-${appeal.id}`}>
        Written note for the decision
      </label>
      <input
        id={`appeal-note-${appeal.id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note for the member (at least 10 characters)"
        className={fieldClass}
      />
      <button type="submit" className="px-3 py-1.5 rounded-xl bg-[#123B60] text-white text-[11px] font-bold">
        Record decision
      </button>
    </form>
  );
};

export const ScoringTransparency: React.FC<{ members: User[] }> = ({ members }) => {
  const app = useApp();
  const actor = useActor();
  const { submissions, tasks, scoreLedger, applications, auditLogs, skillMatrix, seasonEvents, users, scoreAppeals, can } =
    app;
  const { toast } = useToast();

  const [from, setFrom] = useState(EVALUATION_POLICIES[0].effectiveFrom);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [subjectId, setSubjectId] = useState(actor.id);
  const [appealMetric, setAppealMetric] = useState<MetricId>('approval_rate');
  const [appealReason, setAppealReason] = useState('');

  const subject = members.find((m) => m.id === subjectId) ?? members[0];

  const period: Period = { label: `${from} to ${to}`, from, to };

  const mayRead = (capability: Capability) =>
    subject ? can(capability, { id: subject.id, committeeId: subject.committeeId }) : false;

  // Recomputed on render: a plain pass over the records already in this workspace, no fetching.
  const measured: Partial<Record<MetricId, MetricValue>> = (() => {
    if (!subject) return {};
    const mine = submissions.filter((s) => s.memberId === subject.id);
    const assigned = tasks.filter((t) => t.assigneeIds.includes(subject.id));
    return {
      approval_rate: approvalRate(mine, period),
      on_time_delivery: onTimeDelivery(mine, tasks, period),
      net_points: netPoints(scoreLedger, period, subject.id),
      // Judged as of the close of the period, not the moment you load the page: the same
      // report run twice must give the same number.
      overdue_work: overdueWork(assigned, period, to),
      milestone_progress: milestoneProgress(seasonEvents),
      committee_load: mayRead('users.read') ? workloadSpread(tasks, users, subject.committeeId ?? '') : undefined,
      queue_backlog: mayRead('registrations.read')
        ? queueBacklog(applications.map((a) => ({ id: a.id, status: a.status })))
        : undefined,
      audit_coverage: mayRead('audit.read')
        ? auditCoverage(
            auditLogs.filter((l) => l.actorId === subject.id),
            period
          )
        : undefined,
      skill_coverage: mayRead('skills.read')
        ? skillCoverage(skillMatrix.filter((s) => s.memberId === subject.id))
        : undefined,
    };
  })();

  const score = subject ? roleScore(subject.role, measured) : null;
  const recordCtx = { submissions, tasks, ledger: scoreLedger, applications, audit: auditLogs, skills: skillMatrix };

  // Only a figure that this breakdown actually reports can be disputed.
  const disputable: MetricId[] =
    score && score.lines.length > 0
      ? Array.from(new Set(score.lines.map((l) => l.metric)))
      : (Object.keys(METRIC_DEFINITIONS) as MetricId[]);
  const metricChoice = disputable.includes(appealMetric) ? appealMetric : disputable[0];

  const visibleAppeals = useMemo(() => {
    const ids = new Set(members.map((m) => m.id));
    return scoreAppeals.filter((a) => ids.has(a.memberId) || a.memberId === actor.id);
  }, [scoreAppeals, members, actor.id]);

  if (!subject) {
    return (
      <EmptyState
        title="No member to score"
        description="Policy and metric definitions are below, but a breakdown needs at least one account visible to your role."
        icon={Scale}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Reporting period */}
      <div className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Reporting period</h2>
          <p className="text-[11px] text-slate-400">
            Every figure on this page is computed over these dates and nothing else. A timestamp outside the window is
            excluded from both the numerator and the denominator.
          </p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelClass} htmlFor="period-from">
              From
            </label>
            <input id="period-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="period-to">
              To
            </label>
            <input id="period-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="period-subject">
              Breakdown for
            </label>
            <select id="period-subject" value={subject.id} onChange={(e) => setSubjectId(e.target.value)} className={fieldClass}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {ROLE_LABELS[m.role]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Role score breakdown */}
      <div className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">
              {subject.id === actor.id ? 'Your evaluation' : `${subject.name}'s evaluation`}
            </h2>
            <p className="text-[11px] text-slate-400">
              Policy {score?.policyVersion} · {ROLE_LABELS[subject.role]} · {period.label}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-[#F59A16]">{score?.total === null ? '—' : `${score?.total}%`}</div>
            <div className="text-[10px] text-slate-400">weighted average of measurable criteria</div>
          </div>
        </div>

        <p className="px-4 pt-3 text-[11px] text-slate-500">{score?.note}</p>

        <table className="w-full text-left text-xs mt-2">
          <thead className={tableHead}>
            <tr>
              <th className="py-3 px-4">Criterion</th>
              <th className="py-3 px-4">Weight</th>
              <th className="py-3 px-4 text-right">Value</th>
              <th className="py-3 px-4 text-right">Contribution</th>
              <th className="py-3 px-4">Method & data</th>
              <th className="py-3 px-4">Last record used</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {score?.lines.map((line) => {
              const value = measured[line.metric];
              const def = METRIC_DEFINITIONS[line.metric];
              const at = value ? lastRecordUsed(value, recordCtx) : null;
              return (
                <tr key={`${line.metric}-${line.label}`}>
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-800 dark:text-slate-100">{line.label}</div>
                    <div className="text-[10px] text-slate-400">
                      {def.label} · {line.scoring === 'percent' ? 'counts toward the score' : 'advisory — context only'}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{line.weight}%</td>
                  <td className="py-3 px-4 text-right font-bold text-slate-800 dark:text-slate-100">
                    {line.value === null ? (
                      <span className="text-slate-400 font-semibold">not measurable</span>
                    ) : (
                      `${line.value}${def.unit === 'pts' ? ' pts' : def.unit === 'ratio' ? '×' : def.unit === '%' ? '%' : ''}`
                    )}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-300">
                    {line.contribution === null ? '—' : `${line.contribution.toFixed(1)} pts of weight`}
                  </td>
                  <td className="py-3 px-4 text-[11px] text-slate-500 max-w-xs">
                    {line.note}
                    <span className="mt-1 block text-slate-400">
                      Sources: {def.sources.join(', ')}. Missing data: {def.missingData}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[11px] text-slate-500 whitespace-nowrap">
                    {at ?? (value ? 'no dated record' : 'not read for this account')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-4 py-3 text-[11px] text-slate-400">
          A criterion your account cannot read is left as "not read" instead of being fetched. Missing records never
          count as zero: they drop out of the average, and the weight actually used is stated above.
        </p>
      </div>

      {/* Policy in force */}
      <div className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Evaluation policies on record</h2>
          <p className="text-[11px] text-slate-400">
            Weights are versioned. An older season is scored under the policy that was in force then — this chapter has
            one version, and earlier seasons have none recorded.
          </p>
        </div>
        {EVALUATION_POLICIES.map((policy) => (
          <div key={policy.version} className="p-4 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
            <p className="text-[11px] text-slate-500 mb-3">
              <span className="font-bold text-slate-800 dark:text-slate-100">Version {policy.version}</span> · effective{' '}
              {policy.effectiveFrom} · {policy.note}
            </p>
            <table className="w-full text-left text-xs">
              <thead className={tableHead}>
                <tr>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Criterion</th>
                  <th className="py-2.5 px-4 text-right">Weight</th>
                  <th className="py-2.5 px-4">Scoring</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {Object.entries(policy.criteria).map(([role, criteria]) =>
                  criteria.map((c) => (
                    <tr key={`${role}-${c.metric}`}>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{ROLE_LABELS[role as keyof typeof ROLE_LABELS]}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-800 dark:text-slate-100">{c.label}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600 dark:text-slate-300">{c.weight}%</td>
                      <td className="py-2.5 px-4 text-[11px] text-slate-500">
                        {METRIC_DEFINITIONS[c.metric].label} —{' '}
                        {c.scoring === 'percent' ? 'counted as a percentage' : 'advisory, never counted toward the total'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Metric dictionary */}
      <div className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Metric definitions</h2>
          <p className="text-[11px] text-slate-400">
            The same text the calculation follows. If a figure and this table disagree, the table is the defect and
            should be filed as a review request below.
          </p>
        </div>
        <table className="w-full text-left text-xs">
          <thead className={tableHead}>
            <tr>
              <th className="py-2.5 px-4">Metric</th>
              <th className="py-2.5 px-4">Definition</th>
              <th className="py-2.5 px-4">Calculation method</th>
              <th className="py-2.5 px-4">Missing data</th>
              <th className="py-2.5 px-4">Source records</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {Object.values(METRIC_DEFINITIONS).map((def) => (
              <tr key={def.id}>
                <td className="py-2.5 px-4">
                  <div className="font-bold text-slate-800 dark:text-slate-100">{def.label}</div>
                  <div className="text-[10px] text-slate-400">unit: {def.unit}</div>
                </td>
                <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{def.definition}</td>
                <td className="py-2.5 px-4 text-slate-500">{def.method}</td>
                <td className="py-2.5 px-4 text-slate-500">{def.missingData}</td>
                <td className="py-2.5 px-4 text-[11px] text-slate-500">{def.sources.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Appeals */}
      <div className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Review requests</h2>
          <p className="text-[11px] text-slate-400">
            Filing one records a dispute. It changes no score, no ledger row and no submission — a correction is a
            separate adjustment with its own reason and audit entry.
          </p>
        </div>

        <form
          className="p-4 space-y-3 border-b border-slate-100 dark:border-slate-800"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              app.fileScoreAppeal({ metric: metricChoice, periodLabel: period.label, reason: appealReason });
              toast('Review request filed. An officer will answer it here.', 'success');
              setAppealReason('');
            } catch (error) {
              toast(error instanceof Error ? error.message : 'The request was not filed.', 'error');
            }
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="appeal-metric">
                Figure under dispute
              </label>
              <select
                id="appeal-metric"
                value={metricChoice}
                onChange={(e) => setAppealMetric(e.target.value as MetricId)}
                className={fieldClass}
              >
                {disputable.map((metric) => (
                  <option key={metric} value={metric}>
                    {METRIC_DEFINITIONS[metric].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="appeal-period">
                Period
              </label>
              <input id="appeal-period" value={period.label} readOnly className={`${fieldClass} text-slate-500`} />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="appeal-reason">
              What is inaccurate, and why (at least 20 characters)
            </label>
            <textarea
              id="appeal-reason"
              rows={3}
              value={appealReason}
              onChange={(e) => setAppealReason(e.target.value)}
              placeholder="e.g. Two submissions decided on 14 October belong to me and are not counted above."
              className={fieldClass}
            />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="px-4 py-2 rounded-xl bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold flex items-center gap-1.5">
              <Gavel className="w-3.5 h-3.5" aria-hidden />
              File review request
            </button>
          </div>
        </form>

        {visibleAppeals.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-400">
            No review request has been filed by an account visible to your role.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visibleAppeals.map((appeal) => {
              const owner = users.find((u) => u.id === appeal.memberId);
              const def = METRIC_DEFINITIONS[appeal.metric];
              return (
                <li key={appeal.id} className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="lg:col-span-2">
                    <p className="text-[11px] text-slate-400">
                      {appeal.memberName} · filed {appeal.filedAt} · {appeal.periodLabel}
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-800 dark:text-slate-100">
                      Disputes: {def?.label ?? appeal.metric}
                    </p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{appeal.reason}</p>
                  </div>
                  <AppealDecision
                    appeal={appeal}
                    mayDecide={can('scores.adjust', { committeeId: owner?.committeeId })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ScoringTransparency;
