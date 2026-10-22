import React, { useState } from 'react';
import { CalendarRange, Flag, Target, Trophy, X } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor } from '../../domain/roles';
import { EmptyState } from '../EmptyState';
import { useToast } from '../../motion';
import { METRIC_DEFINITIONS, type MetricId } from '../../domain/metrics';
import {
  OBJECTIVE_STATUS_LABEL,
  OKR_RULES,
  compareSnapshots,
  seasonCovering,
  seasonsInOrder,
  type ChapterSeason,
  type ObjectiveRollup,
} from '../../domain/seasons';
import type { DashboardView } from './DashboardShell';

const METRIC_IDS = Object.keys(METRIC_DEFINITIONS) as MetricId[];

const unitFor = (unit: 'count' | '%' | 'pts' | 'ratio') =>
  unit === '%' ? '%' : unit === 'pts' ? ' pts' : unit === 'ratio' ? '×' : '';

const STATUS_STYLES: Record<string, string> = {
  achieved: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  on_track: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  at_risk: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  behind: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
  not_measurable: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  no_key_results: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  before_start: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
};

const emptySeason = { label: '', startDate: '', endDate: '', status: 'planning' as ChapterSeason['status'], theme: '', handover: '' };
const emptyObjective = { seasonId: '', title: '', why: '', committeeId: '' };
const emptyKeyResult = {
  objectiveId: '',
  label: '',
  metric: 'approval_rate' as MetricId,
  target: '70',
  baseline: '',
  direction: 'increase' as 'increase' | 'decrease',
  scope: 'chapter' as 'chapter' | 'committee',
  committeeId: '',
};

/**
 * Specs E and F. A season is a window the chapter wrote down; an objective is a claim measured
 * inside it by the same deterministic calculations used for scoring. Statuses are a stated rule
 * over a mean attainment, compared with the share of the season elapsed — never a model's guess.
 */
export const SeasonsAndObjectives: React.FC<{ onNavigate: (view: DashboardView) => void }> = ({ onNavigate }) => {
  const {
    seasons,
    addSeason,
    updateSeason,
    closeSeason,
    objectives,
    addObjective,
    deleteObjective,
    keyResults,
    addKeyResult,
    deleteKeyResult,
    objectiveRollups,
    committees,
    seasonEvents,
    can,
  } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [seasonForm, setSeasonForm] = useState(emptySeason);
  const [objectiveForm, setObjectiveForm] = useState(emptyObjective);
  const [keyResultForm, setKeyResultForm] = useState(emptyKeyResult);
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const [openMethod, setOpenMethod] = useState<string | null>(null);
  // The clock is read once when the page opens, not on every render.
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  const ordered = seasonsInOrder(seasons);
  const writeScope = scopeFor(currentUser.role, 'analytics.configure');
  const mayWrite = writeScope === 'all' || writeScope === 'committee';
  const mayWriteChapterWide = writeScope === 'all';
  const currentSeason = seasonCovering(ordered, today);
  const activeSeasonId = selectedSeason || currentSeason?.id || ordered.find((s) => s.status === 'active')?.id || ordered[0]?.id || '';
  const season = ordered.find((s) => s.id === activeSeasonId);
  const rollups: ObjectiveRollup[] = season ? objectiveRollups(season.id) : [];
  const previousSeason = season ? ordered.filter((s) => s.endDate < season.startDate).pop() : undefined;
  const committeeName = (id?: string) => committees.find((c) => c.id === id)?.name ?? 'the whole chapter';
  const writableCommittees = committees.filter((c) => can('analytics.configure', { committeeId: c.id }));

  const submitSeason = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addSeason(seasonForm);
      setSeasonForm(emptySeason);
      toast('Season recorded. Nothing was measured yet — that needs records.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The season was not recorded.', 'error');
    }
  };

  const submitObjective = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addObjective({
        seasonId: objectiveForm.seasonId || activeSeasonId,
        title: objectiveForm.title,
        why: objectiveForm.why,
        committeeId: objectiveForm.committeeId || (writeScope === 'committee' ? currentUser.committeeId : undefined),
      });
      setObjectiveForm(emptyObjective);
      toast('Objective written. It stays unmeasurable until it has a key result.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The objective was not written.', 'error');
    }
  };

  const submitKeyResult = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addKeyResult({
        objectiveId: keyResultForm.objectiveId,
        label: keyResultForm.label,
        metric: keyResultForm.metric,
        target: Number(keyResultForm.target),
        baseline: keyResultForm.baseline === '' ? null : Number(keyResultForm.baseline),
        direction: keyResultForm.direction,
        scope: keyResultForm.scope,
        committeeId: keyResultForm.scope === 'committee' ? keyResultForm.committeeId || undefined : undefined,
      });
      setKeyResultForm({ ...emptyKeyResult, objectiveId: keyResultForm.objectiveId });
      toast('Key result added; the rollup recalculated from live records.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The key result was not added.', 'error');
    }
  };

  const close = (id: string) => {
    try {
      closeSeason(id);
      toast('Season closed and its figures frozen.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The season was not closed.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Seasons &amp; Objectives</h1>
          <p className="text-xs text-slate-500">
            {ordered.length === 0
              ? 'No season has been recorded yet, so there is no window to measure an objective inside.'
              : `${ordered.length} recorded season(s). ${currentSeason ? `${currentSeason.label} covers today.` : 'None of them covers today.'}`}
          </p>
        </div>
        <button
          onClick={() => onNavigate('season_planner')}
          className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 self-start sm:self-auto"
        >
          Milestones live in the Season Planner
        </button>
      </div>

      {mayWrite && (
        <form onSubmit={submitSeason} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-[#F59A16]" aria-hidden />
            Record a season
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
            <input
              required
              aria-label="Season label"
              placeholder="2026–2027"
              value={seasonForm.label}
              onChange={(e) => setSeasonForm({ ...seasonForm, label: e.target.value })}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
            <input
              required
              type="date"
              aria-label="Start date"
              value={seasonForm.startDate}
              onChange={(e) => setSeasonForm({ ...seasonForm, startDate: e.target.value })}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
            <input
              required
              type="date"
              aria-label="End date"
              value={seasonForm.endDate}
              onChange={(e) => setSeasonForm({ ...seasonForm, endDate: e.target.value })}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
            <select
              aria-label="Season status"
              value={seasonForm.status}
              onChange={(e) => setSeasonForm({ ...seasonForm, status: e.target.value as ChapterSeason['status'] })}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            >
              <option value="planning">Planning</option>
              <option value="active">Active</option>
            </select>
            <input
              aria-label="Season theme"
              placeholder="Theme"
              value={seasonForm.theme}
              onChange={(e) => setSeasonForm({ ...seasonForm, theme: e.target.value })}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
          </div>
          <textarea
            rows={2}
            aria-label="Handover note for the next season"
            placeholder="Handover note: what the next committee should know about this one."
            value={seasonForm.handover}
            onChange={(e) => setSeasonForm({ ...seasonForm, handover: e.target.value })}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
          />
          <p className="text-[10px] text-slate-400">
            A window that overlaps a season already on file is refused, and only one season can be active at a time.
            Seasons are chapter records, so this form is offered to a chapter-wide analytics scope only.
          </p>
          <div className="flex justify-end">
            <button type="submit" disabled={!mayWriteChapterWide} className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] disabled:opacity-40 text-white text-xs font-bold rounded-xl">
              Record season
            </button>
          </div>
        </form>
      )}

      {ordered.length === 0 ? (
        <EmptyState
          title="No season on record"
          description="Objectives need a dated window to be measured inside. Recording one creates no numbers by itself — the readings below come from tasks, submissions, the ledger, assessments and milestones that already exist."
          icon={Flag}
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {ordered.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSeason(s.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                  s.id === activeSeasonId
                    ? 'bg-[#123B60] text-white border-[#123B60]'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {s.label}
                <span className="ml-1.5 text-[10px] opacity-70">{s.status}</span>
              </button>
            ))}
          </div>

          {season && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">{season.label}</h2>
                  <p className="text-[11px] text-slate-500">
                    {season.startDate} to {season.endDate} · {season.status}
                    {season.theme ? ` · ${season.theme}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {season.status === 'planning' && mayWrite && (
                    <button
                      onClick={() => {
                        try {
                          updateSeason(season.id, { status: 'active' });
                          toast(`${season.label} opened.`, 'success');
                        } catch (error) {
                          toast(error instanceof Error ? error.message : 'The season was not opened.', 'error');
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold"
                    >
                      Open season
                    </button>
                  )}
                  {season.status !== 'closed' && mayWrite && (
                    <button onClick={() => close(season.id)} className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                      Close and freeze figures
                    </button>
                  )}
                </div>
              </div>

              {season.handover && (
                <p className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-bold uppercase text-[10px] tracking-wider">Handover</span> · {season.handover}
                </p>
              )}

              {season.snapshot && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Frozen at close ({season.snapshot.takenAt.slice(0, 10)})
                  </div>
                  <table className="w-full text-xs mt-2">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="py-1">Figure</th>
                        <th className="py-1">This season</th>
                        <th className="py-1">{previousSeason ? previousSeason.label : 'Previous season'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareSnapshots(season.snapshot, previousSeason?.snapshot).map((row) => (
                        <tr key={row.label} className="border-t border-slate-100 dark:border-slate-800">
                          <td className="py-1.5">{row.label}</td>
                          <td className="py-1.5 font-bold">{row.current}</td>
                          <td className="py-1.5 text-slate-500">{row.previous ?? 'no snapshot on record'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-slate-400 mt-2">
                    These lines were computed on the closing day and are kept as written. An earlier season with no
                    snapshot is shown as such rather than guessed at.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-2">Objectives and how they read now</h3>
                  {rollups.length === 0 ? (
                    <p className="text-xs text-slate-500 rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                      No objective is written for this season. {seasonEvents.length} milestone(s) exist in the planner,
                      and those are events, not objectives.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {rollups.map((rollup) => {
                        const krs = keyResults.filter((k) => k.objectiveId === rollup.objective.id);
                        return (
                          <li key={rollup.objective.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="text-xs font-bold text-slate-900 dark:text-white">{rollup.objective.title}</div>
                                <div className="text-[10px] text-slate-400">
                                  {committeeName(rollup.objective.committeeId)} · owner {rollup.objective.ownerName} · {rollup.objective.why}
                                </div>
                              </div>
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLES[rollup.status]}`}>
                                {OBJECTIVE_STATUS_LABEL[rollup.status]}
                              </span>
                            </div>

                            {rollup.attainment !== null && (
                              <div className="mt-3">
                                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full bg-[#F59A16]"
                                    style={{ width: `${Math.round(rollup.attainment * 100)}%` }}
                                    role="progressbar"
                                    aria-valuenow={Math.round(rollup.attainment * 100)}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-label={`Attainment toward ${rollup.objective.title}`}
                                  />
                                </div>
                                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                                  <span>{Math.round(rollup.attainment * 100)}% of target reached</span>
                                  <span>{rollup.elapsed === null ? 'no elapsed pace' : `${Math.round(rollup.elapsed * 100)}% of the season elapsed`}</span>
                                </div>
                              </div>
                            )}

                            <ul className="mt-3 space-y-1.5">
                              {rollup.readings.map((reading) => (
                                <li key={reading.kr.id} className="text-[11px] flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5">
                                  <span className="text-slate-600 dark:text-slate-300">
                                    <span className="font-bold">{reading.kr.label}</span> · {METRIC_DEFINITIONS[reading.kr.metric].label}{' '}
                                    {reading.kr.direction === 'decrease' ? 'down to' : 'up to'} {reading.kr.target}
                                    {reading.kr.baseline !== null ? ` from ${reading.kr.baseline}` : ''}
                                  </span>
                                  <span className="text-slate-500">
                                    {reading.value.value === null ? 'not measurable' : `${reading.value.value}${unitFor(reading.value.unit)} read`}
                                    {reading.attainment !== null && ` · ${Math.round(reading.attainment * 100)}% of target`}
                                  </span>
                                </li>
                              ))}
                            </ul>

                            {krs.length === 0 && (
                              <p className="text-[10px] text-slate-400 mt-2">
                                No key result, so nothing is calculated for this objective.
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <button
                                onClick={() => setOpenMethod(openMethod === rollup.objective.id ? null : rollup.objective.id)}
                                className="text-[10px] font-bold text-[#123B60] dark:text-[#F59A16]"
                              >
                                {openMethod === rollup.objective.id ? 'Hide method' : 'Method and records'}
                              </button>
                              {mayWrite && (
                                <button
                                  onClick={() => {
                                    try {
                                      deleteObjective(rollup.objective.id);
                                      toast('Objective removed with its key results.', 'success');
                                    } catch (error) {
                                      toast(error instanceof Error ? error.message : 'The objective was not removed.', 'error');
                                    }
                                  }}
                                  className="text-[10px] font-bold text-rose-600 flex items-center gap-1"
                                >
                                  <X className="w-3 h-3" aria-hidden />
                                  Delete
                                </button>
                              )}
                            </div>

                            {openMethod === rollup.objective.id && (
                              <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-[10px] text-slate-500 space-y-1.5">
                                <p>
                                  <span className="font-bold text-slate-700 dark:text-slate-300">Rule.</span> On track holds
                                  the elapsed pace; at risk allows {Math.round(OKR_RULES.atRiskSlack * 100)} points of slip;
                                  behind is anything under that. Mean of the measurable key results only.
                                </p>
                                <p>
                                  <span className="font-bold text-slate-700 dark:text-slate-300">Calculation.</span> {rollup.method}
                                </p>
                                {rollup.readings.map((reading) => (
                                  <p key={reading.kr.id}>
                                    <span className="font-bold">{METRIC_DEFINITIONS[reading.kr.metric].label}:</span>{' '}
                                    {METRIC_DEFINITIONS[reading.kr.metric].method} {reading.value.reason}{' '}
                                    {reading.value.recordIds.length > 0
                                      ? `Records: ${reading.value.recordIds.join(', ')}.`
                                      : 'No record id backs this reading.'}
                                  </p>
                                ))}
                                <p>
                                  <span className="font-bold">Definition.</span>{' '}
                                  {rollup.readings.map((r) => METRIC_DEFINITIONS[r.kr.metric].definition).join(' / ') || 'nothing measured'}
                                </p>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {mayWrite && season.status !== 'closed' && (
                  <div className="space-y-4">
                    <form onSubmit={submitObjective} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                      <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <Target className="w-4 h-4 text-[#F59A16]" aria-hidden />
                        Write an objective for {season.label}
                      </h3>
                      <input
                        required
                        aria-label="Objective title"
                        placeholder="What does the chapter want to be true by the end?"
                        value={objectiveForm.title}
                        onChange={(e) => setObjectiveForm({ ...objectiveForm, title: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                      />
                      <input
                        required
                        aria-label="Why this objective matters"
                        placeholder="Why this, and not something else?"
                        value={objectiveForm.why}
                        onChange={(e) => setObjectiveForm({ ...objectiveForm, why: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                      />
                      {writeScope === 'committee' ? (
                        <p className="text-[10px] text-slate-400">
                          Your scope files this under {committeeName(currentUser.committeeId)}. A chapter-wide objective
                          needs a chapter-wide scope.
                        </p>
                      ) : (
                        <select
                          aria-label="Committee the objective belongs to"
                          value={objectiveForm.committeeId}
                          onChange={(e) => setObjectiveForm({ ...objectiveForm, committeeId: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                        >
                          <option value="">The whole chapter</option>
                          {writableCommittees.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                      <div className="flex justify-end">
                        <button type="submit" className="px-3.5 py-1.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-[11px] font-bold rounded-xl">
                          Write objective
                        </button>
                      </div>
                    </form>

                    {objectives.length > 0 && (
                      <form onSubmit={submitKeyResult} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                          <Trophy className="w-4 h-4 text-[#F59A16]" aria-hidden />
                          Attach a key result
                        </h3>
                        <select
                          required
                          aria-label="Objective this key result serves"
                          value={keyResultForm.objectiveId}
                          onChange={(e) => setKeyResultForm({ ...keyResultForm, objectiveId: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                        >
                          <option value="" disabled>Objective…</option>
                          {objectives
                            .filter((o) => o.seasonId === season.id)
                            .map((o) => (
                              <option key={o.id} value={o.id}>{o.title}</option>
                            ))}
                        </select>
                        <input
                          required
                          aria-label="What will be counted"
                          placeholder="What will be counted?"
                          value={keyResultForm.label}
                          onChange={(e) => setKeyResultForm({ ...keyResultForm, label: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                        />
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <select
                            aria-label="Metric"
                            value={keyResultForm.metric}
                            onChange={(e) => setKeyResultForm({ ...keyResultForm, metric: e.target.value as MetricId })}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                          >
                            {METRIC_IDS.map((id) => (
                              <option key={id} value={id}>{METRIC_DEFINITIONS[id].label}</option>
                            ))}
                          </select>
                          <select
                            aria-label="Direction"
                            value={keyResultForm.direction}
                            onChange={(e) => setKeyResultForm({ ...keyResultForm, direction: e.target.value as 'increase' | 'decrease' })}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                          >
                            <option value="increase">should rise</option>
                            <option value="decrease">should fall</option>
                          </select>
                          <input
                            required
                            type="number"
                            aria-label="Target value"
                            placeholder="Target"
                            value={keyResultForm.target}
                            onChange={(e) => setKeyResultForm({ ...keyResultForm, target: e.target.value })}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                          />
                          <input
                            type="number"
                            aria-label="Baseline value, optional"
                            placeholder="Baseline (optional)"
                            value={keyResultForm.baseline}
                            onChange={(e) => setKeyResultForm({ ...keyResultForm, baseline: e.target.value })}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                          />
                          <select
                            aria-label="Scope of the measurement"
                            value={keyResultForm.scope}
                            onChange={(e) => setKeyResultForm({ ...keyResultForm, scope: e.target.value as 'chapter' | 'committee' })}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                          >
                            <option value="chapter">whole chapter</option>
                            <option value="committee">one committee</option>
                          </select>
                          {keyResultForm.scope === 'committee' && (
                            <select
                              required
                              aria-label="Committee measured"
                              value={keyResultForm.committeeId}
                              onChange={(e) => setKeyResultForm({ ...keyResultForm, committeeId: e.target.value })}
                              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                            >
                              <option value="" disabled>Committee…</option>
                              {writableCommittees.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400">{METRIC_DEFINITIONS[keyResultForm.metric].method}</p>
                        <p className="text-[10px] text-slate-400">{METRIC_DEFINITIONS[keyResultForm.metric].missingData}</p>
                        <div className="flex justify-end">
                          <button type="submit" className="px-3.5 py-1.5 bg-[#123B60] hover:bg-[#0A2239] text-white text-[11px] font-bold rounded-xl">
                            Add key result
                          </button>
                        </div>
                      </form>
                    )}

                    {keyResults.length > 0 && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-100 mb-2">Key results on file</h3>
                        <ul className="space-y-1.5">
                          {keyResults.map((k) => (
                            <li key={k.id} className="text-[11px] flex items-center justify-between gap-2 text-slate-600 dark:text-slate-300">
                              <span>
                                {k.label} · {METRIC_DEFINITIONS[k.metric].label} {k.direction === 'decrease' ? '↓' : '↑'} {k.target}
                                {k.baseline !== null ? ` (from ${k.baseline})` : ' (no baseline)'} · {k.scope}
                              </span>
                              {mayWrite && (
                                <button
                                  onClick={() => {
                                    try {
                                      deleteKeyResult(k.id);
                                      toast('Key result removed.', 'success');
                                    } catch (error) {
                                      toast(error instanceof Error ? error.message : 'The key result was not removed.', 'error');
                                    }
                                  }}
                                  className="text-rose-600 font-bold"
                                >
                                  Remove
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
