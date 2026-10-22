import React, { useState } from 'react';
import { AlertTriangle, ArrowUpRight, Eye, Sparkles, Target } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor } from '../../domain/roles';
import type { DashboardView } from './DashboardShell';
import {
  DECISION_RULES,
  deriveAlerts,
  deriveConfirmed,
  deriveSuggestions,
  deriveTrends,
  trendSignals,
  type DecisionInput,
  type Signal,
} from '../../domain/decisions';
import { EmptyState } from '../EmptyState';
import { METRIC_DEFINITIONS } from '../../domain/metrics';
import { OBJECTIVE_STATUS_LABEL, OKR_RULES } from '../../domain/seasons';

/**
 * Spec A: an executive view that keeps four things apart and says which one it is showing —
 * a confirmed reading, a rule that fired, a period-over-period trend, or a suggestion.
 * Every row carries its window, its method and the records behind it.
 */

const cardClass =
  'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm';
const fieldClass =
  'px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]';

const severityStyles: Record<Signal['severity'], string> = {
  action: 'border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/20',
  watch: 'border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20',
  info: 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40',
};

const SignalRow: React.FC<{ signal: Signal; onNavigate: (view: DashboardView) => void }> = ({
  signal,
  onNavigate,
}) => (
  <li className={`p-4 rounded-xl border ${severityStyles[signal.severity]}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{signal.title}</p>
        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{signal.detail}</p>
      </div>
      {signal.view && (
        <button
          onClick={() => onNavigate(signal.view as DashboardView)}
          className="shrink-0 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-[#123B60] dark:text-[#F59A16] flex items-center gap-1"
        >
          Open {signal.view.replace('_', ' ')}
          <ArrowUpRight className="w-3 h-3" aria-hidden />
        </button>
      )}
    </div>
    <p className="mt-2 text-[10px] text-slate-500">
      Window: {signal.period} · Records: {signal.recordIds.length > 0 ? signal.recordIds.join(', ') : 'none'}
    </p>
    <p className="mt-0.5 text-[10px] text-slate-400">How: {signal.method}</p>
  </li>
);

export const ExecutiveDecisionCenter: React.FC<{ onNavigate: (view: DashboardView) => void }> = ({ onNavigate }) => {
  const {
    tasks,
    submissions,
    applications,
    scoreLedger,
    users,
    committees,
    seasonEvents,
    auditLogs,
    seasons,
    objectiveRollups,
    can,
  } = useApp();
  const actor = useActor();

  const [from, setFrom] = useState('2026-09-01');
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Objectives are read through the analytics scope: a director sees the ones filed under
  // their own committee, plus chapter-wide ones.
  const objectiveScope = scopeFor(actor.role, 'analytics.configure');
  const rollups = seasons
    .flatMap((s) => objectiveRollups(s.id))
    .filter((r) => objectiveScope === 'all' || !r.objective.committeeId || r.objective.committeeId === actor.committeeId);
  const offPace = rollups.filter((r) => r.status === 'behind' || r.status === 'at_risk');

  // The nav entry is presentation. The records shown are limited here, by this account's read scope.
  const taskScope = scopeFor(actor.role, 'tasks.read');
  const byCommittee = <T extends { committeeId?: string }>(rows: T[]) =>
    taskScope === 'committee' ? rows.filter((r) => !r.committeeId || r.committeeId === actor.committeeId) : rows;

  const scoped: DecisionInput = {
    tasks: byCommittee(tasks),
    submissions: byCommittee(submissions),
    ledger: byCommittee(scoreLedger),
    users: byCommittee(users),
    committees:
      taskScope === 'committee' ? committees.filter((c) => c.id === actor.committeeId) : committees,
    events: seasonEvents,
    applications:
      taskScope === 'committee'
        ? applications.filter((a) => a.preferredCommitteeId === actor.committeeId)
        : applications,
    audit: can('audit.read') ? auditLogs : [],
    period: { from, to },
    // Judged as of the close of the window you asked for, not the minute the page loaded:
    // the same report re-run has to give the same alerts.
    asOf: `${to}T23:59:59.000Z`,
  };

  const confirmed = deriveConfirmed(scoped).filter((row) => {
    if (row.id === 'confirmed-audit_coverage') return can('audit.read');
    if (row.id === 'confirmed-queue_backlog') return can('registrations.read');
    return true;
  });
  const alerts = deriveAlerts(scoped);
  const trends = trendSignals(deriveTrends(scoped), `${from} to ${to}`);
  const suggestions = deriveSuggestions(alerts);
  const actionNeeded = alerts.filter((a) => a.severity === 'action');
  const worthWatching = alerts.filter((a) => a.severity === 'watch');

  const aiProvider = 'No AI provider is configured for this workspace';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Executive Decision Center</h1>
          <p className="text-xs text-slate-500">
            Readings are computed from the {scoped.tasks.length} task, {scoped.submissions.length} submission and{' '}
            {scoped.ledger.length} ledger records this account can see
            {taskScope === 'committee' ? ` within ${actor.committeeId ?? 'your committee'}` : ''}. Nothing here is
            sample data.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1" htmlFor="dc-from">
              From
            </label>
            <input id="dc-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1" htmlFor="dc-to">
              To
            </label>
            <input id="dc-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
          </div>
        </div>
      </div>

      <div className={`${cardClass} p-4 flex items-start gap-2.5`}>
        <Eye className="w-4 h-4 text-[#123B60] dark:text-[#F59A16] mt-0.5 shrink-0" aria-hidden />
        <p className="text-[11px] text-slate-600 dark:text-slate-300">
          The four sections below are deliberately separate. A confirmed reading is arithmetic over records. An alert is
          one of {Object.keys(DECISION_RULES).length} stated thresholds crossing ({Object.entries(DECISION_RULES)
            .map(([k, v]) => `${k}: ${typeof v === 'number' && k === 'imbalanceShare' ? `${v * 100}%` : v}`)
            .join(', ')}). A trend compares two equal windows. A suggestion is a candidate action, never a fact, and it
          only exists because an alert fired.
        </p>
      </div>

      {scoped.tasks.length + scoped.submissions.length + scoped.applications.length + scoped.ledger.length === 0 && (
        <EmptyState
          title="No operational records yet"
          description="This center reads tasks, submissions, applications and the score ledger. Until the workspace holds real rows, the readings below report not measurable rather than showing invented activity."
          icon={Target}
        />
      )}

      {/* 1. Needs action */}
      <section className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600" aria-hidden />
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Rule-based alerts that need someone now</h2>
        </div>
        {actionNeeded.length === 0 ? (
          <p className="p-6 text-xs text-slate-400">No alert rule crossed in this window. That is an absence of records or of breaches, not a clean bill of health.</p>
        ) : (
          <ul className="p-4 space-y-3">
            {actionNeeded.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onNavigate={onNavigate} />
            ))}
          </ul>
        )}
      </section>

      {/* 2. Worth watching */}
      {worthWatching.length > 0 && (
        <section className={cardClass}>
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Rule-based alerts worth watching</h2>
          </div>
          <ul className="p-4 space-y-3">
            {worthWatching.map((signal) => (
              <SignalRow key={signal.id} signal={signal} onNavigate={onNavigate} />
            ))}
          </ul>
        </section>
      )}

      {/* 3. Confirmed readings */}
      <section className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Confirmed readings</h2>
          <p className="text-[11px] text-slate-400">Arithmetic over the records in the window above. No model, no estimate.</p>
        </div>
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
            <tr>
              <th className="py-2.5 px-4">Reading</th>
              <th className="py-2.5 px-4">What the records say</th>
              <th className="py-2.5 px-4">Window</th>
              <th className="py-2.5 px-4">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {confirmed.map((row) => (
              <tr key={row.id}>
                <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-100">{row.title}</td>
                <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{row.detail}</td>
                <td className="py-2.5 px-4 text-[11px] text-slate-500 whitespace-nowrap">{row.period}</td>
                <td className="py-2.5 px-4 text-[10px] text-slate-400">{row.method}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-[10px] text-slate-400">
          {can('audit.read') ? '' : 'Audit coverage is not listed: this account has no audit.read scope. '}
          {can('registrations.read') ? '' : 'Recruitment backlog is not listed for the same reason.'}
        </p>
      </section>

      {/* 4. Trends */}
      <section className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Historical trend — this window against the equal window before it</h2>
          <p className="text-[11px] text-slate-400">
            A change is reported only when both windows can measure the same thing.
          </p>
        </div>
        <ul className="p-4 space-y-3">
          {trends.map((signal) => (
            <SignalRow key={signal.id} signal={signal} onNavigate={onNavigate} />
          ))}
        </ul>
      </section>

      {/* 5. Objectives */}
      <section className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Objectives off pace</h2>
          {seasons.length > 0 && (
            <button
              onClick={() => onNavigate('seasons_objectives')}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-[#123B60] dark:text-[#F59A16] flex items-center gap-1"
            >
              Seasons &amp; Objectives
              <ArrowUpRight className="w-3 h-3" aria-hidden />
            </button>
          )}
        </div>
        {seasons.length === 0 ? (
          <p className="p-6 text-xs text-slate-400">
            Not available. No season with dates on record exists, so an objective would have no window to be measured
            inside. The season planner holds event milestones — those appear in Milestone progress above, and they are
            not objectives.
          </p>
        ) : rollups.length === 0 ? (
          <p className="p-6 text-xs text-slate-400">
            {seasons.length} season(s) on record, none carrying an objective your account can read. Nothing is estimated
            here: an objective has to be written before it can be measured.
          </p>
        ) : offPace.length === 0 ? (
          <p className="p-6 text-xs text-slate-400">
            {rollups.length} objective(s) measured, none behind or at risk against the share of its season elapsed.
            Statuses are the stated rule over the mean of measurable key results, and an unmeasurable objective is
            listed as such rather than as on track.
          </p>
        ) : (
          <ul className="p-4 space-y-3">
            {offPace.map((rollup) => (
              <li key={rollup.objective.id} className={`p-4 rounded-xl border ${severityStyles[rollup.status === 'behind' ? 'action' : 'watch']}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{rollup.objective.title}</p>
                    <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                      {OBJECTIVE_STATUS_LABEL[rollup.status]}
                      {rollup.attainment !== null && ` · ${Math.round(rollup.attainment * 100)}% of target`}
                      {rollup.elapsed !== null && ` against ${Math.round(rollup.elapsed * 100)}% of the season elapsed`}
                      {rollup.attainment === null && ` · ${rollup.method}`}
                    </p>
                  </div>
                  <Target className="w-4 h-4 text-[#F59A16] shrink-0" aria-hidden />
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  Rule: on track holds the elapsed pace, at risk allows {Math.round(OKR_RULES.atRiskSlack * 100)} points of
                  slip. Key results: {rollup.readings.map((r) => `${METRIC_DEFINITIONS[r.kr.metric].label} ${r.value.value === null ? 'not measurable' : r.value.value}`).join(' · ') || 'none written'}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-400">
                  Records behind this:
                  {' '}
                  {rollup.readings.flatMap((r) => r.value.recordIds).join(', ') || 'none — no record backs this reading yet'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. Suggestions */}
      <section className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#F59A16]" aria-hidden />
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">Candidate next actions</h2>
        </div>
        {suggestions.length === 0 ? (
          <p className="p-6 text-xs text-slate-400">
            No suggestion: every one of these is generated from an alert that fired, and none did in this window.
          </p>
        ) : (
          <ul className="p-4 space-y-2">
            {suggestions.map((suggestion) => (
              <li key={`${suggestion.signalId}-${suggestion.action}`} className="text-xs text-slate-600 dark:text-slate-300 flex gap-2">
                <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-[#F59A16]" aria-hidden />
                <span>
                  <span className="font-bold text-[10px] uppercase tracking-wide text-[#F59A16]">Suggestion — not a confirmed fact.</span>{' '}
                  {suggestion.action}{' '}
                  <span className="text-[10px] text-slate-400">
                    From “{alerts.find((a) => a.id === suggestion.signalId)?.title}”. Nothing here changes a record by
                    itself; a person does that from the linked screen.
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 7. AI layer */}
      <section className={cardClass}>
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100">AI insights layer</h2>
        </div>
        <p className="p-6 text-xs text-slate-500">
          {aiProvider}. Spec H makes this layer optional, so this build ships the deterministic parts — readings, rules
          and trends — and leaves natural-language questions and narrative summaries switched off. Official KPIs stay
          database arithmetic either way: a model would only restate what the tables above already compute, and it is
          not permitted to approve applicants, change permissions, edit records or issue a final evaluation.
        </p>
      </section>
    </div>
  );
};

export default ExecutiveDecisionCenter;
