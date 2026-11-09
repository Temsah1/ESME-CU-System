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
import { Button } from '../ui';

/**
 * Spec A: an executive view that keeps four things apart and says which one it is showing —
 * a confirmed reading, a rule that fired, a period-over-period trend, or a suggestion.
 * Every row carries its window, its method and the records behind it.
 */

const cardClass = 'rounded-card border border-border bg-surface shadow-card';
const headClass =
  'bg-surface-muted border-b border-border text-ink-muted font-semibold uppercase text-micro tracking-wider';
const fieldClass =
  'px-3 py-2 rounded-control border border-border bg-surface text-caption text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus';

/* Severity is a wash plus a border in the same tone as the status badges, so an "action" row and a
 * "refused" badge read as the same urgency everywhere in the product. */
const severityStyles: Record<Signal['severity'], string> = {
  action: 'border-danger/30 bg-danger/10',
  watch: 'border-warning/30 bg-warning/10',
  info: 'border-border bg-surface-muted',
};

const SignalRow: React.FC<{ signal: Signal; onNavigate: (view: DashboardView) => void }> = ({
  signal,
  onNavigate,
}) => (
  <li className={`p-4 rounded-card border ${severityStyles[signal.severity]}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-label font-bold text-ink-strong">{signal.title}</p>
        <p className="mt-1 text-caption text-ink-muted">{signal.detail}</p>
      </div>
      {signal.view && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => onNavigate(signal.view as DashboardView)}
        >
          Open {signal.view.replace('_', ' ')}
          <ArrowUpRight className="w-3 h-3" aria-hidden />
        </Button>
      )}
    </div>
    <p className="mt-2 text-micro text-ink-muted">
      Window: {signal.period} · Records: {signal.recordIds.length > 0 ? signal.recordIds.join(', ') : 'none'}
    </p>
    <p className="mt-0.5 text-micro text-ink-subtle">How: {signal.method}</p>
  </li>
);

export const ExecutiveDecisionCenter: React.FC<{ onNavigate: (view: DashboardView) => void }> = ({ onNavigate }) => {
  const {
    tasks,
    submissions,
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
    audit: can('audit.read') ? auditLogs : [],
    period: { from, to },
    // Judged as of the close of the window you asked for, not the minute the page loaded:
    // the same report re-run has to give the same alerts.
    asOf: `${to}T23:59:59.000Z`,
  };

  const confirmed = deriveConfirmed(scoped).filter((row) => {
    if (row.id === 'confirmed-audit_coverage') return can('audit.read');
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
          <h1 className="text-title font-black text-ink-strong">Executive Decision Center</h1>
          <p className="mt-1 text-caption text-ink-muted">
            Readings are computed from the {scoped.tasks.length} task, {scoped.submissions.length} submission and{' '}
            {scoped.ledger.length} ledger records this account can see
            {taskScope === 'committee' ? ` within ${actor.committeeId ?? 'your committee'}` : ''}. Nothing here is
            sample data.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-micro font-bold text-ink-muted mb-1" htmlFor="dc-from">
              From
            </label>
            <input id="dc-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
          </div>
          <div>
            <label className="block text-micro font-bold text-ink-muted mb-1" htmlFor="dc-to">
              To
            </label>
            <input id="dc-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
          </div>
        </div>
      </div>

      <div className={`${cardClass} p-4 flex items-start gap-2.5`}>
        <Eye className="w-4 h-4 text-ink-brand mt-0.5 shrink-0" aria-hidden />
        <p className="text-caption text-ink-muted">
          The four sections below are deliberately separate. A confirmed reading is arithmetic over records. An alert is
          one of {Object.keys(DECISION_RULES).length} stated thresholds crossing ({Object.entries(DECISION_RULES)
            .map(([k, v]) => `${k}: ${typeof v === 'number' && k === 'imbalanceShare' ? `${v * 100}%` : v}`)
            .join(', ')}). A trend compares two equal windows. A suggestion is a candidate action, never a fact, and it
          only exists because an alert fired.
        </p>
      </div>

      {scoped.tasks.length + scoped.submissions.length + scoped.ledger.length === 0 && (
        <EmptyState
          title="No operational records yet"
          description="This center reads tasks, submissions and the score ledger. Until the workspace holds real rows, the readings below report not measurable rather than showing invented activity."
          icon={Target}
        />
      )}

      {/* 1. Needs action */}
      <section className={cardClass}>
        <div className="p-4 border-b border-border-subtle flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-danger" aria-hidden />
          <h2 className="text-label font-bold text-ink-strong">Rule-based alerts that need someone now</h2>
        </div>
        {actionNeeded.length === 0 ? (
          <p className="p-6 text-caption text-ink-subtle">No alert rule crossed in this window. That is an absence of records or of breaches, not a clean bill of health.</p>
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
          <div className="p-4 border-b border-border-subtle">
            <h2 className="text-label font-bold text-ink-strong">Rule-based alerts worth watching</h2>
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
        <div className="p-4 border-b border-border-subtle">
          <h2 className="text-label font-bold text-ink-strong">Confirmed readings</h2>
          <p className="text-caption text-ink-subtle">Arithmetic over the records in the window above. No model, no estimate.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-caption">
            <thead className={headClass}>
              <tr>
                <th className="py-2.5 px-4">Reading</th>
                <th className="py-2.5 px-4">What the records say</th>
                <th className="py-2.5 px-4">Window</th>
                <th className="py-2.5 px-4">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {confirmed.map((row) => (
                <tr key={row.id}>
                  <td className="py-2.5 px-4 font-bold text-ink-strong">{row.title}</td>
                  <td className="py-2.5 px-4 text-ink-muted">{row.detail}</td>
                  <td className="py-2.5 px-4 text-caption text-ink-muted whitespace-nowrap">{row.period}</td>
                  <td className="py-2.5 px-4 text-micro text-ink-subtle">{row.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-3 text-micro text-ink-subtle">
          {can('audit.read') ? '' : 'Audit coverage is not listed: this account has no audit.read scope.'}
        </p>
      </section>

      {/* 4. Trends */}
      <section className={cardClass}>
        <div className="p-4 border-b border-border-subtle">
          <h2 className="text-label font-bold text-ink-strong">Historical trend — this window against the equal window before it</h2>
          <p className="text-caption text-ink-subtle">
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
        <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-2">
          <h2 className="text-label font-bold text-ink-strong">Objectives off pace</h2>
          {seasons.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => onNavigate('seasons_objectives')}>
              Seasons &amp; Objectives
              <ArrowUpRight className="w-3 h-3" aria-hidden />
            </Button>
          )}
        </div>
        {seasons.length === 0 ? (
          <p className="p-6 text-caption text-ink-subtle">
            Not available. No season with dates on record exists, so an objective would have no window to be measured
            inside. The season planner holds event milestones — those appear in Milestone progress above, and they are
            not objectives.
          </p>
        ) : rollups.length === 0 ? (
          <p className="p-6 text-caption text-ink-subtle">
            {seasons.length} season(s) on record, none carrying an objective your account can read. Nothing is estimated
            here: an objective has to be written before it can be measured.
          </p>
        ) : offPace.length === 0 ? (
          <p className="p-6 text-caption text-ink-subtle">
            {rollups.length} objective(s) measured, none behind or at risk against the share of its season elapsed.
            Statuses are the stated rule over the mean of measurable key results, and an unmeasurable objective is
            listed as such rather than as on track.
          </p>
        ) : (
          <ul className="p-4 space-y-3">
            {offPace.map((rollup) => (
              <li key={rollup.objective.id} className={`p-4 rounded-card border ${severityStyles[rollup.status === 'behind' ? 'action' : 'watch']}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-label font-bold text-ink-strong">{rollup.objective.title}</p>
                    <p className="mt-1 text-caption text-ink-muted">
                      {OBJECTIVE_STATUS_LABEL[rollup.status]}
                      {rollup.attainment !== null && ` · ${Math.round(rollup.attainment * 100)}% of target`}
                      {rollup.elapsed !== null && ` against ${Math.round(rollup.elapsed * 100)}% of the season elapsed`}
                      {rollup.attainment === null && ` · ${rollup.method}`}
                    </p>
                  </div>
                  <Target className="w-4 h-4 text-ink-accent shrink-0" aria-hidden />
                </div>
                <p className="mt-2 text-micro text-ink-muted">
                  Rule: on track holds the elapsed pace, at risk allows {Math.round(OKR_RULES.atRiskSlack * 100)} points of
                  slip. Key results: {rollup.readings.map((r) => `${METRIC_DEFINITIONS[r.kr.metric].label} ${r.value.value === null ? 'not measurable' : r.value.value}`).join(' · ') || 'none written'}
                </p>
                <p className="mt-0.5 text-micro text-ink-subtle">
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
        <div className="p-4 border-b border-border-subtle flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-ink-accent" aria-hidden />
          <h2 className="text-label font-bold text-ink-strong">Candidate next actions</h2>
        </div>
        {suggestions.length === 0 ? (
          <p className="p-6 text-caption text-ink-subtle">
            No suggestion: every one of these is generated from an alert that fired, and none did in this window.
          </p>
        ) : (
          <ul className="p-4 space-y-2">
            {suggestions.map((suggestion) => (
              <li key={`${suggestion.signalId}-${suggestion.action}`} className="text-caption text-ink-muted flex gap-2">
                <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />
                <span>
                  <span className="font-bold text-micro uppercase tracking-wide text-ink-accent">Suggestion — not a confirmed fact.</span>{' '}
                  {suggestion.action}{' '}
                  <span className="text-micro text-ink-subtle">
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
        <div className="p-4 border-b border-border-subtle">
          <h2 className="text-label font-bold text-ink-strong">AI insights layer</h2>
        </div>
        <p className="p-6 text-caption text-ink-muted">
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
