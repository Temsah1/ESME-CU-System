import React, { useMemo, useState } from 'react';
import {
  Award,
  Gavel,
  History,
  ListOrdered,
  PlusCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import type { Role, User } from '../../types';
import { ALL_ROLES, ROLE_LABELS, ROLE_RANK, isPrimaryAdmin, scopeFor } from '../../domain/roles';
import {
  WARNING_SEVERITIES,
  bonusPointsOf,
  entriesInPeriod,
  SEVERITY_LABELS,
  activeWarningsOf,
  validatePolicyEdit,
  validateRewardAction,
  warningNumberAfter,
  type RewardEntry,
  type RewardKind,
  type RewardPolicy,
  type WarningSeverity,
} from '../../domain/rewards';
import { ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import type { DashboardView } from './DashboardShell';

type Props = { onNavigate: (view: DashboardView) => void };

type Tab = 'ledger' | 'mine' | 'policy';
type FormKind = 'bonus' | 'warning';

const PAGE_SIZE = 12;

/** Keys are minted when a form opens, so a double-click or a re-submit replays onto one entry. */
const mintKey = (kind: FormKind) => `${kind}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;

/** Rendered from the stored ISO stamp: no locale-dependent formatting, so what is on screen is the record. */
const issuedAt = (iso: string) => iso.slice(0, 16).replace('T', ' ');

const signed = (points: number) => `${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points)}`;

const KIND_LABEL: Record<RewardKind, string> = { bonus: 'Bonus', warning: 'Warning' };

/**
 * Read when this module loads, never during render. A rolling window measured off a clock that
 * ticks between two renders would let the preview and the counts on one screen disagree, and the
 * entry the store writes is stamped with the real time anyway.
 */
const SCREEN_OPENED_AT = new Date().toISOString();

export const RewardsAndDiscipline: React.FC<Props> = ({ onNavigate }) => {
  const {
    users,
    committees,
    rewardEntries,
    rewardPolicy,
    awardBonus,
    issueWarning,
    reverseRewardEntry,
    acknowledgeWarning,
    updateRewardPolicy,
    can,
  } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>('ledger');
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | RewardKind>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'reversed'>('all');
  const [committeeFilter, setCommitteeFilter] = useState('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'points'>('newest');
  const [page, setPage] = useState(0);

  const [form, setForm] = useState<FormKind | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [targetId, setTargetId] = useState('');
  const [pickTerm, setPickTerm] = useState('');
  const [points, setPoints] = useState(10);
  const [severity, setSeverity] = useState<WarningSeverity>('notice');
  const [reason, setReason] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');

  const [reversal, setReversal] = useState<RewardEntry | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  const [draft, setDraft] = useState<RewardPolicy | null>(null);

  /** One write is in flight at a time: the record is filed by the provider, so the answer is pending. */
  const [filing, setFiling] = useState(false);

  // Held in state so opening a form re-reads the moment from the click, not from the render: two
  // reads of a ticking clock on one screen could put an entry inside the window in the preview and
  // outside it in the count beside the table.
  const [clock, setClock] = useState(SCREEN_OPENED_AT);

  const mayWrite = can('rewards.write');
  const mayConfigure = can('rewards.configure');
  const readScope = scopeFor(currentUser.role, 'rewards.read');
  const writeScope = scopeFor(currentUser.role, 'rewards.write');

  // What the account may read. A member's scope is `self`, so their own record is the only
  // history this screen can show them — it never pretends to be the chapter's.
  const visibleEntries = useMemo(() => {
    if (readScope === 'self') return rewardEntries.filter((e) => e.targetId === currentUser.id || e.actorId === currentUser.id);
    if (readScope === 'committee') return rewardEntries.filter((e) => e.committeeId === currentUser.committeeId);
    return rewardEntries;
  }, [rewardEntries, readScope, currentUser.id, currentUser.committeeId]);

  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = visibleEntries.filter((e) => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (committeeFilter !== 'all' && e.committeeId !== committeeFilter) return false;
      if (!needle) return true;
      return [e.targetName, e.actorName, e.reason].some((field) => field.toLowerCase().includes(needle));
    });
    const byDate = (a: RewardEntry, b: RewardEntry) => (sort === 'oldest' ? a.issuedAt.localeCompare(b.issuedAt) : b.issuedAt.localeCompare(a.issuedAt));
    return [...rows].sort((a, b) => (sort === 'points' ? b.points - a.points || byDate(a, b) : byDate(a, b)));
  }, [visibleEntries, search, kindFilter, statusFilter, committeeFilter, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filteredEntries.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const myRecord = useMemo(
    () => rewardEntries.filter((e) => e.targetId === currentUser.id),
    [rewardEntries, currentUser.id]
  );
  const myOpenWarnings = myRecord.filter((e) => e.kind === 'warning' && e.status === 'active' && !e.acknowledgedAt);

  const summary = useMemo(() => {
    const bonuses = visibleEntries.filter((e) => e.kind === 'bonus' && e.status === 'active');
    const inWindow = bonuses.filter(
      (e) => new Date(e.issuedAt).getTime() >= new Date(clock).getTime() - rewardPolicy.periodDays * 86400000
    );
    const warnings = visibleEntries.filter((e) => e.kind === 'warning' && e.status === 'active');
    return {
      bonusCount: bonuses.length,
      bonusPointsWindow: inWindow.reduce((sum, e) => sum + e.points, 0),
      warningCount: warnings.length,
      reversed: visibleEntries.filter((e) => e.status === 'reversed').length,
      windowDays: rewardPolicy.periodDays,
    };
  }, [visibleEntries, rewardPolicy.periodDays, clock]);

  /** The accounts this actor may aim at, each carrying the verdict the store would reach. */
  const candidates = useMemo(() => {
    if (!writeScope) return [];
    const needle = pickTerm.trim().toLowerCase();
    const inScope = (u: User) =>
      writeScope === 'all' ? true : writeScope === 'committee' ? u.committeeId === currentUser.committeeId : u.id === currentUser.id;
    return users
      .filter((u) => inScope(u))
      .filter((u) =>
        needle.length === 0 ? true : [u.name, u.email, u.username].some((field) => (field ?? '').toLowerCase().includes(needle))
      )
      .map((account) => ({
        account,
        verdict: validateRewardAction({
          kind: form ?? 'bonus',
          actor: { id: currentUser.id, role: currentUser.role, committeeId: currentUser.committeeId, subTeam: currentUser.subTeam },
          target: account,
          points: form === 'warning' ? 0 : points,
          severity: form === 'warning' ? severity : undefined,
          reason: reason.trim() || '·',
          evidenceUrl,
          policy: rewardPolicy,
          entries: rewardEntries,
          now: clock,
          targetIsPrimaryAdmin: isPrimaryAdmin(account),
        }),
      }))
      .sort((a, b) => {
        if (a.verdict.allowed !== b.verdict.allowed) return a.verdict.allowed ? -1 : 1;
        return a.account.name.localeCompare(b.account.name);
      });
  }, [users, writeScope, pickTerm, form, points, severity, reason, evidenceUrl, rewardPolicy, rewardEntries, currentUser, clock]);

  const selectedTarget = targetId ? users.find((u) => u.id === targetId) ?? null : null;

  /** The same call the store makes before it writes — so the form refuses before the record does. */
  const preview = useMemo(() => {
    if (!form) return null;
    const decision = validateRewardAction({
      kind: form,
      actor: { id: currentUser.id, role: currentUser.role, committeeId: currentUser.committeeId, subTeam: currentUser.subTeam },
      target: selectedTarget,
      points: form === 'warning' ? 0 : points,
      severity: form === 'warning' ? severity : undefined,
      reason,
      evidenceUrl,
      policy: rewardPolicy,
      entries: rewardEntries,
      now: clock,
      targetIsPrimaryAdmin: selectedTarget ? isPrimaryAdmin(selectedTarget) : false,
    });
    return { decision, now: clock };
  }, [form, selectedTarget, points, severity, reason, evidenceUrl, rewardPolicy, rewardEntries, currentUser, clock]);

  const openForm = (kind: FormKind) => {
    setClock(new Date().toISOString());
    setForm(kind);
    setIdempotencyKey(mintKey(kind));
    setTargetId('');
    setPickTerm('');
    setPoints(10);
    setSeverity('notice');
    setReason('');
    setEvidenceUrl('');
  };

  const closeForm = () => {
    setForm(null);
    setIdempotencyKey('');
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !preview || filing) return;
    if (!preview.decision.allowed) {
      toast(preview.decision.reason, 'error');
      return;
    }
    // The provider files the record, so the button cannot outrun the answer: a second click while
    // the first is in flight would be a replay, and the idempotency key is what makes it harmless.
    setFiling(true);
    try {
      const entry =
        form === 'bonus'
          ? await awardBonus({ targetId, points, reason, evidenceUrl, idempotencyKey })
          : await issueWarning({ targetId, severity, reason, evidenceUrl, idempotencyKey });
      toast(
        entry.kind === 'bonus'
          ? `${signed(entry.points)} pts recorded for ${entry.targetName}`
          : `${SEVERITY_LABELS[entry.severity ?? 'notice']} recorded for ${entry.targetName}`,
        'success'
      );
      closeForm();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The entry was not recorded.', 'error');
    } finally {
      setFiling(false);
    }
  };

  const submitReversal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversal || filing) return;
    setFiling(true);
    try {
      const entry = await reverseRewardEntry(reversal.id, reversalReason);
      toast(reversal.kind === 'bonus' ? `Entry reversed; ${signed(entry.points)} pts written against it` : 'The warning was withdrawn by a reversing entry', 'success');
      setReversal(null);
      setReversalReason('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The reversal was not recorded.', 'error');
    } finally {
      setFiling(false);
    }
  };

  const savePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    try {
      updateRewardPolicy(draft);
      toast('Permission matrix updated. New caps apply to the next entry.', 'success');
      setDraft(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The matrix was not saved.', 'error');
    }
  };

  const draftErrors = draft ? validatePolicyEdit(draft) : [];
  const canRecordBonus = mayWrite && rewardPolicy.canAwardBonus.includes(currentUser.role);
  const canRecordWarning = mayWrite && rewardPolicy.canIssueWarning.includes(currentUser.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Bonuses &amp; Warnings</h1>
          <p className="text-xs text-slate-500">
            {readScope === 'self'
              ? 'Your own record. Bonuses and warnings for other members are not visible to this account.'
              : readScope === 'committee'
                ? `Every entry inside ${committees.find((c) => c.id === currentUser.committeeId)?.name ?? 'your committee'}, plus ones you filed yourself.`
                : 'Every entry in the chapter. Corrections appear as new reversing entries, never as edits.'}
          </p>
          <p className="text-[11px] text-slate-400">
            These entries live in this browser, because the ledger is still read from here. Filing a
            new one asks the chapter's database, and a refusal there records nothing on this device —
            so an officer's entries on another machine do not appear in this list yet.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 flex">
            <button
              onClick={() => setTab('ledger')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${tab === 'ledger' ? 'bg-[#123B60] text-white' : 'text-slate-500'}`}
            >
              Ledger ({visibleEntries.length})
            </button>
            <button
              onClick={() => setTab('mine')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${tab === 'mine' ? 'bg-[#123B60] text-white' : 'text-slate-500'}`}
            >
              My record{myOpenWarnings.length > 0 ? ` (${myOpenWarnings.length})` : ''}
            </button>
            {mayConfigure && (
              <button
                onClick={() => setTab('policy')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${tab === 'policy' ? 'bg-[#123B60] text-white' : 'text-slate-500'}`}
              >
                Permission matrix
              </button>
            )}
          </div>

          {mayWrite && (
            <>
              {canRecordBonus && (
                <button
                  onClick={() => openForm('bonus')}
                  className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  Award bonus
                </button>
              )}
              {canRecordWarning && (
                <button
                  onClick={() => openForm('warning')}
                  className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                >
                  <Gavel className="w-4 h-4" />
                  Issue warning
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {tab === 'ledger' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Active bonuses', value: summary.bonusCount, note: 'entries in your scope' },
              {
                label: `Points inside ${summary.windowDays} days`,
                value: summary.bonusPointsWindow,
                note: `ceiling ${rewardPolicy.maxBonusPointsPerMemberPerPeriod} per member`,
              },
              { label: 'Active warnings', value: summary.warningCount, note: `escalates at ${rewardPolicy.escalateWarningsAfter}` },
              { label: 'Reversed entries', value: summary.reversed, note: 'each has a reason attached' },
            ].map((card) => (
              <div key={card.label} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{card.label}</div>
                <div className="mt-1 text-xl font-black text-slate-900 dark:text-white">{card.value}</div>
                <div className="text-[10px] text-slate-400">{card.note}</div>
              </div>
            ))}
          </div>

          {visibleEntries.length === 0 ? (
            <EmptyState
              title="Nothing has been recorded yet"
              description={
                mayWrite
                  ? 'The ledger is empty because no bonus or warning has been filed. Awarding one writes the entry and, for a bonus, the matching point movement.'
                  : 'The ledger is empty inside your scope. Entries appear here when one names you or a member you can read.'
              }
              icon={ListOrdered}
              action={
                canRecordBonus ? (
                  <button onClick={() => openForm('bonus')} className="px-4 py-2 bg-[#123B60] text-white text-xs font-bold rounded-xl">
                    Award the first bonus
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Search by member, issuer or reason…"
                    aria-label="Search entries"
                    className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={kindFilter}
                    onChange={(e) => {
                      setKindFilter(e.target.value as 'all' | RewardKind);
                      setPage(0);
                    }}
                    aria-label="Filter by kind"
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold outline-none"
                  >
                    <option value="all">Bonuses and warnings</option>
                    <option value="bonus">Bonuses only</option>
                    <option value="warning">Warnings only</option>
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as 'all' | 'active' | 'reversed');
                      setPage(0);
                    }}
                    aria-label="Filter by status"
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold outline-none"
                  >
                    <option value="all">Standing and reversed</option>
                    <option value="active">Standing only</option>
                    <option value="reversed">Reversed only</option>
                  </select>
                  {readScope !== 'self' && committees.some((c) => visibleEntries.some((e) => e.committeeId === c.id)) && (
                    <select
                      value={committeeFilter}
                      onChange={(e) => {
                        setCommitteeFilter(e.target.value);
                        setPage(0);
                      }}
                      aria-label="Filter by committee"
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold outline-none"
                    >
                      <option value="all">All committees you can see</option>
                      {committees
                        .filter((c) => visibleEntries.some((e) => e.committeeId === c.id))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <select
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value as 'newest' | 'oldest' | 'points');
                      setPage(0);
                    }}
                    aria-label="Sort entries"
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold outline-none"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="points">Largest point movement</option>
                  </select>
                </div>
              </div>

              {filteredEntries.length === 0 ? (
                <p className="p-10 text-center text-xs text-slate-400">
                  {visibleEntries.length} {visibleEntries.length === 1 ? 'entry' : 'entries'} exist in your scope, but none match
                  this search or these filters.
                </p>
              ) : (
                <>
                  {/* Rows are cards on narrow screens: a six-column table at 320px is unreadable, not responsive. */}
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
                    {paged.map((entry) => (
                      <li key={entry.id} className="p-4 space-y-2">
                        <EntryBadge entry={entry} />
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100">{entry.targetName}</div>
                        <p className="text-[11px] text-slate-500">{entry.reason}</p>
                        <div className="text-[10px] text-slate-400">
                          {issuedAt(entry.issuedAt)} · by {entry.actorName} ({ROLE_LABELS[entry.actorRole]})
                        </div>
                        <EntryActions
                          entry={entry}
                          mayWrite={mayWrite}
                          onReverse={() => {
                            setReversal(entry);
                            setReversalReason('');
                          }}
                        />
                      </li>
                    ))}
                  </ul>

                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="py-3 px-4">Issued</th>
                          <th className="py-3 px-4">Member</th>
                          <th className="py-3 px-4">Entry</th>
                          <th className="py-3 px-4 text-right">Points</th>
                          <th className="py-3 px-4">Reason</th>
                          <th className="py-3 px-4">Filed by</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {paged.map((entry) => (
                          <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors duration-150">
                            <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">{issuedAt(entry.issuedAt)}</td>
                            <td className="py-3 px-4">
                              <div className="font-bold text-slate-800 dark:text-slate-100">{entry.targetName}</div>
                              <div className="text-[10px] text-slate-400">
                                as {ROLE_LABELS[entry.targetRoleAtTime]}
                                {entry.committeeId ? ` · ${committees.find((c) => c.id === entry.committeeId)?.shortCode ?? 'committee not listed'}` : ''}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <EntryBadge entry={entry} />
                            </td>
                            <td
                              className={`py-3 px-4 text-right font-black ${
                                entry.points < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : entry.points > 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-400'
                              }`}
                            >
                              {entry.kind === 'warning' ? '—' : `${signed(entry.points)} pts`}
                            </td>
                            <td className="py-3 px-4 text-slate-500 text-[11px] max-w-xs">
                              <span className="line-clamp-2" title={entry.reason}>
                                {entry.reason}
                              </span>
                              {entry.evidenceUrl && (
                                <a
                                  href={entry.evidenceUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="block text-[10px] text-[#123B60] dark:text-sky-400 underline"
                                >
                                  evidence
                                </a>
                              )}
                            </td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                              {entry.actorName}
                              <div className="text-[10px] text-slate-400">{ROLE_LABELS[entry.actorRole]}</div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex justify-end">
                                <EntryActions
                                  entry={entry}
                                  mayWrite={mayWrite}
                                  onReverse={() => {
                                    setReversal(entry);
                                    setReversalReason('');
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {pageCount > 1 && (
                    <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        Page {safePage + 1} of {pageCount} · {filteredEntries.length} of {visibleEntries.length} entries
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          disabled={safePage === 0}
                          className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 font-bold"
                        >
                          Previous
                        </button>
                        <button
                          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                          disabled={safePage >= pageCount - 1}
                          className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40 font-bold"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Bonus points also appear as a row in the scoring ledger, so the leaderboard and this record are the same
            numbers.{' '}
            <button onClick={() => onNavigate('scoring')} className="font-bold text-[#123B60] dark:text-sky-400 underline">
              Open the scoring ledger
            </button>
          </p>
        </div>
      )}

      {tab === 'mine' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
              <Award className="w-4 h-4 text-[#F59A16]" />
              Your record
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
              <div>
                <div className="text-slate-400">Total score</div>
                <div className="text-lg font-black text-[#F59A16]">{currentUser.totalPoints} pts</div>
              </div>
              <div>
                <div className="text-slate-400">Bonus points standing</div>
                <div className="text-lg font-black text-slate-800 dark:text-slate-100">{bonusPointsOf(rewardEntries, currentUser.id)}</div>
              </div>
              <div>
                <div className="text-slate-400">Active warnings</div>
                <div className="text-lg font-black text-slate-800 dark:text-slate-100">{activeWarningsOf(rewardEntries, currentUser.id).length}</div>
              </div>
              <div>
                <div className="text-slate-400">In {rewardPolicy.periodDays}-day window</div>
                <div className="text-lg font-black text-slate-800 dark:text-slate-100">
                  {entriesInPeriod(rewardEntries, currentUser.id, 'warning', rewardPolicy.periodDays, clock).length}
                </div>
              </div>
            </div>
          </div>

          {myRecord.length === 0 ? (
            <EmptyState
              title="No entry names you"
              description="Nothing has been recorded as a bonus or a warning against your account. A member cannot record either for anyone, including themselves."
              icon={History}
            />
          ) : (
            <ul className="space-y-3">
              {myRecord.map((entry) => (
                <li key={entry.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <EntryBadge entry={entry} />
                    <span className="text-[10px] text-slate-400">{issuedAt(entry.issuedAt)}</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">{entry.reason}</p>
                  <div className="text-[10px] text-slate-400">
                    Filed by {entry.actorName} ({ROLE_LABELS[entry.actorRole]})
                    {entry.kind === 'bonus' && ` · ${signed(entry.points)} pts`}
                    {entry.status === 'reversed' && ' · reversed by a later entry'}
                  </div>
                  {entry.kind === 'warning' && entry.status === 'active' && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                      <span className="text-[10px] text-slate-400">
                        {entry.acknowledgedAt ? `Acknowledged ${issuedAt(entry.acknowledgedAt)}` : 'Confirming you have read this changes nothing about the record itself.'}
                      </span>
                      {!entry.acknowledgedAt && (
                        <button
                          onClick={() => {
                            void (async () => {
                              try {
                                await acknowledgeWarning(entry.id);
                                toast('Acknowledged. The warning still stands as recorded.', 'success');
                              } catch (error) {
                                toast(error instanceof Error ? error.message : 'The acknowledgement was not saved.', 'error');
                              }
                            })();
                          }}
                          className="px-3 py-1.5 rounded-xl bg-[#123B60] text-white text-[11px] font-bold"
                        >
                          Acknowledge
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'policy' && mayConfigure && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
                <SlidersHorizontal className="w-4 h-4 text-[#123B60]" />
                Who may award, how much, and when it escalates
              </div>
              {!draft && (
                <button
                  onClick={() => setDraft({ ...rewardPolicy })}
                  className="px-3 py-1.5 rounded-xl bg-[#123B60] text-white text-[11px] font-bold"
                >
                  Edit matrix
                </button>
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              Last set {issuedAt(rewardPolicy.updatedAt)} by{' '}
              {rewardPolicy.updatedBy === 'system-default' ? 'the shipped default' : (users.find((u) => u.id === rewardPolicy.updatedBy)?.name ?? rewardPolicy.updatedBy)}.
              The matrix caps what an officer may do; the capability and the committee scope still have to agree before
              anything is written.
            </p>

            {!draft && (
              <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                <PolicyCell label="May award a bonus" value={rewardPolicy.canAwardBonus.map((r) => ROLE_LABELS[r]).join(', ') || 'nobody'} />
                <PolicyCell label="May issue a warning" value={rewardPolicy.canIssueWarning.map((r) => ROLE_LABELS[r]).join(', ') || 'nobody'} />
                <PolicyCell label="Per action" value={`${rewardPolicy.maxBonusPointsPerAction} pts`} />
                <PolicyCell
                  label={`Per member / ${rewardPolicy.periodDays} days`}
                  value={`${rewardPolicy.maxBonusPointsPerMemberPerPeriod} pts`}
                />
                <PolicyCell label="Escalate after" value={`${rewardPolicy.escalateWarningsAfter} warnings`} />
                <PolicyCell label="Escalation tells" value={rewardPolicy.notifyRolesOnEscalation.map((r) => ROLE_LABELS[r]).join(', ') || 'nobody'} />
              </dl>
            )}

            {draft && (
              <form onSubmit={savePolicy} className="space-y-5 text-xs">
                <fieldset>
                  <legend className="font-bold text-slate-700 dark:text-slate-300 mb-2">Roles that may award a bonus</legend>
                  <RoleChecks value={draft.canAwardBonus} onChange={(next) => setDraft({ ...draft, canAwardBonus: next })} />
                </fieldset>
                <fieldset>
                  <legend className="font-bold text-slate-700 dark:text-slate-300 mb-2">Roles that may issue a warning</legend>
                  <RoleChecks value={draft.canIssueWarning} onChange={(next) => setDraft({ ...draft, canIssueWarning: next })} />
                </fieldset>
                <fieldset>
                  <legend className="font-bold text-slate-700 dark:text-slate-300 mb-2">Escalation tells these roles</legend>
                  <RoleChecks value={draft.notifyRolesOnEscalation} onChange={(next) => setDraft({ ...draft, notifyRolesOnEscalation: next })} />
                </fieldset>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <NumberField
                    label="Maximum points per action"
                    value={draft.maxBonusPointsPerAction}
                    field="maxBonusPointsPerAction"
                    errors={draftErrors}
                    onChange={(v) => setDraft({ ...draft, maxBonusPointsPerAction: v })}
                  />
                  <NumberField
                    label={`Maximum points per member / ${draft.periodDays} days`}
                    value={draft.maxBonusPointsPerMemberPerPeriod}
                    field="maxBonusPointsPerMemberPerPeriod"
                    errors={draftErrors}
                    onChange={(v) => setDraft({ ...draft, maxBonusPointsPerMemberPerPeriod: v })}
                  />
                  <NumberField
                    label="Rolling window in days"
                    value={draft.periodDays}
                    field="periodDays"
                    errors={draftErrors}
                    onChange={(v) => setDraft({ ...draft, periodDays: v })}
                  />
                  <NumberField
                    label="Escalate after this many warnings"
                    value={draft.escalateWarningsAfter}
                    field="escalateWarningsAfter"
                    errors={draftErrors}
                    onChange={(v) => setDraft({ ...draft, escalateWarningsAfter: v })}
                  />
                </div>

                {draftErrors.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-rose-600 dark:text-rose-400">
                    {draftErrors.map((error) => (
                      <li key={`${error.field}-${error.message}`}>{error.message}</li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button type="button" onClick={() => setDraft(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-semibold">
                    Discard
                  </button>
                  <button type="submit" disabled={draftErrors.length > 0} className="px-5 py-2 bg-[#123B60] text-white font-bold rounded-xl disabled:opacity-50">
                    Save matrix
                  </button>
                </div>
              </form>
            )}
          </div>

          <p className="text-[11px] text-slate-400">
            A change here is audited and applies to entries written after it; it never restates an entry that already
            exists. This matrix is still saved to this browser: esme_update_reward_policy() is not wired yet, because a
            device holding an older copy would overwrite the chapter's current cap. Entries, by contrast, are filed by
            the server.
          </p>
        </div>
      )}

      {/* Award / warn modal */}
      <ModalShell
        open={form !== null}
        onClose={closeForm}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {form && (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {form === 'bonus' ? 'Award a bonus' : 'Issue a warning'}
              </h2>
              <button onClick={closeForm} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitForm} className="space-y-4 text-xs">
              <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                {form === 'bonus'
                  ? `A bonus writes two records under one id: this entry and a scoring-ledger row of ${signed(points)} points. Cap is ${rewardPolicy.maxBonusPointsPerAction} per action and ${rewardPolicy.maxBonusPointsPerMemberPerPeriod} per member in ${rewardPolicy.periodDays} days.`
                  : `A warning moves no points. It raises the member's count inside the ${rewardPolicy.periodDays}-day window, and at ${rewardPolicy.escalateWarningsAfter} the ${rewardPolicy.notifyRolesOnEscalation.map((r) => ROLE_LABELS[r]).join(' and ')} are alerted.`}
              </p>

              <div>
                <span className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Member</span>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" aria-hidden />
                  <input
                    type="search"
                    value={pickTerm}
                    onChange={(e) => setPickTerm(e.target.value)}
                    placeholder="Search accounts by name, email or username…"
                    aria-label="Search accounts to record this entry against"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none focus:ring-2 focus:ring-[#123B60]"
                  />
                </div>
                {candidates.length === 0 && (
                  <p className="mt-2 text-[11px] text-slate-400">
                    {users.length === 0
                      ? 'The directory this account can read is empty, so nobody can be selected. No account is created here.'
                      : `No account matches “${pickTerm}”. ${users.length} account(s) are visible to your role.`}
                  </p>
                )}
                <ul className="mt-2 max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
                  {candidates.map(({ account, verdict }) => (
                    <li key={account.id} className="p-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                          {account.name}
                          {account.id === currentUser.id && ' (you)'}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {ROLE_LABELS[account.role]} · {account.status === 'active' ? 'active' : account.status}
                          {account.committeeId
                            ? ` · ${committees.find((c) => c.id === account.committeeId)?.shortCode ?? 'committee not listed'}`
                            : ' · no committee'}
                          {` · ${bonusPointsOf(rewardEntries, account.id)} bonus pts, ${activeWarningsOf(rewardEntries, account.id).length} active warning(s)`}
                        </div>
                        {!verdict.allowed ? (
                          <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">{verdict.reason}</p>
                        ) : verdict.warning ? (
                          <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600">
                            <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
                            {verdict.warning}
                          </p>
                        ) : (
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600">
                            <ShieldCheck className="w-3 h-3" />
                            Eligible — {form === 'bonus' ? 'the reason below is mandatory' : 'severity is accountability, not points'}
                            {'.'}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={!verdict.allowed}
                        onClick={() => setTargetId(account.id)}
                        aria-label={`Select ${account.name}`}
                        className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold ${
                          targetId === account.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#123B60] text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800'
                        }`}
                      >
                        {targetId === account.id ? 'Selected' : verdict.allowed ? 'Select' : 'Blocked'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {form === 'bonus' ? (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="reward-points">
                    Bonus points
                  </label>
                  <input
                    id="reward-points"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={points}
                    onChange={(e) => setPoints(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-[#F59A16] outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="reward-severity">
                    Severity
                  </label>
                  <select
                    id="reward-severity"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as WarningSeverity)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    {WARNING_SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  {selectedTarget && (
                    <p className="mt-1 text-[10px] text-slate-400">
                      {selectedTarget.name} would be warning{' '}
                      {warningNumberAfter(rewardEntries, selectedTarget.id, rewardPolicy, clock)} in{' '}
                      {rewardPolicy.periodDays} days.
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="reward-reason">
                  Reason (mandatory)
                </label>
                <textarea
                  id="reward-reason"
                  required
                  rows={3}
                  maxLength={400}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={form === 'bonus' ? 'What exactly did the member do, and under which task or event?' : 'What happened, when, and what is expected to change?'}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
                <div className="text-[10px] text-slate-400 text-right">{reason.length}/400</div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="reward-evidence">
                  Evidence link (optional)
                </label>
                <input
                  id="reward-evidence"
                  type="url"
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              {preview && (
                <div
                  className={`rounded-xl px-3.5 py-2.5 text-[11px] ${
                    !preview.decision.allowed
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                      : preview.decision.warning
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {!preview.decision.allowed ? (
                    <>Blocked: {preview.decision.reason}</>
                  ) : preview.decision.warning ? (
                    <>Before you commit: {preview.decision.warning}</>
                  ) : (
                    <>
                      Ready to write {selectedTarget ? `for ${selectedTarget.name}` : 'this entry'}
                      {form === 'bonus'
                        ? ` — ${signed(points)} points, new total ${(selectedTarget?.totalPoints ?? 0) + points} pts.`
                        : ' — no points move; the member and the audit trail both get the reason.'}
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={closeForm} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-semibold">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!preview?.decision.allowed || filing}
                  className="px-5 py-2 bg-[#123B60] text-white font-bold rounded-xl disabled:opacity-50"
                >
                  {filing ? 'Recording…' : form === 'bonus' ? 'Record bonus' : 'Record warning'}
                </button>
              </div>
            </form>
          </>
        )}
      </ModalShell>

      {/* Reversal modal */}
      <ModalShell
        open={reversal !== null}
        onClose={() => setReversal(null)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl"
      >
        {reversal && (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Reverse this entry</h2>
              <button onClick={() => setReversal(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={submitReversal} className="space-y-4 text-xs">
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <EntryBadge entry={reversal} />
                  <span className="font-bold text-slate-800 dark:text-slate-100">{reversal.targetName}</span>
                </div>
                <p className="text-[11px] text-slate-500">{reversal.reason}</p>
                <div className="text-[10px] text-slate-400">
                  {issuedAt(reversal.issuedAt)} · filed by {reversal.actorName} · entry {reversal.id}
                </div>
              </div>

              <p className="text-[11px] text-slate-500">
                The original keeps its text and gains a pointer to the new entry
                {reversal.kind === 'bonus' ? `, and ${signed(-reversal.points)} points are written against ${reversal.targetName}.` : ' — the warning is withdrawn, not deleted.'}
              </p>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="reversal-reason">
                  Why is this being reversed? (mandatory)
                </label>
                <textarea
                  id="reversal-reason"
                  required
                  rows={3}
                  maxLength={400}
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="e.g. Awarded twice for the same deliverable; the second entry is undone."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setReversal(null)} className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 font-semibold">
                  Keep the entry
                </button>
                <button type="submit" disabled={filing} className="px-5 py-2 bg-rose-600 text-white font-bold rounded-xl disabled:opacity-50">
                  {filing ? 'Recording…' : 'Write reversing entry'}
                </button>
              </div>
            </form>
          </>
        )}
      </ModalShell>
    </div>
  );
};

const EntryBadge: React.FC<{ entry: RewardEntry }> = ({ entry }) => (
  <span className="inline-flex items-center gap-1.5">
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
        entry.kind === 'bonus'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
      }`}
    >
      {KIND_LABEL[entry.kind]}
      {entry.kind === 'warning' && entry.severity ? ` · ${SEVERITY_LABELS[entry.severity]}` : ''}
    </span>
    {entry.status === 'reversed' && (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        reversed
      </span>
    )}
  </span>
);

const EntryActions: React.FC<{ entry: RewardEntry; mayWrite: boolean; onReverse: () => void }> = ({ entry, mayWrite, onReverse }) => (
  <>
    {entry.status === 'active' && entry.reversedByEntryId && (
      <span className="text-[10px] text-slate-400 italic" title={`Reverses ${entry.reversedByEntryId}`}>
        correcting entry
      </span>
    )}
    {mayWrite && entry.status === 'active' && (
      <button
        type="button"
        onClick={onReverse}
        aria-label={`Reverse entry ${entry.id}`}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:border-rose-300 hover:text-rose-600"
      >
        <RotateCcw className="w-3 h-3" />
        Reverse
      </button>
    )}
  </>
);

const PolicyCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
    <div className="text-[10px] uppercase font-bold text-slate-400">{label}</div>
    <div className="mt-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{value}</div>
  </div>
);

/** A member role is never offered: capability plus the matrix both have to agree, and a member is not an officer. */
const OFFICER_ROLES = ALL_ROLES.filter((r) => r !== 'member' && r !== 'moderator');

const RoleChecks: React.FC<{ value: Role[]; onChange: (next: Role[]) => void }> = ({ value, onChange }) => (
  <div className="flex flex-wrap gap-2">
    {OFFICER_ROLES.map((role) => (
      <label
        key={role}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer ${
          value.includes(role)
            ? 'border-[#123B60] bg-[#123B60] text-white'
            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
        }`}
      >
        <input
          type="checkbox"
          checked={value.includes(role)}
          onChange={(e) => onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))}
          aria-label={`${ROLE_LABELS[role]} (rank ${ROLE_RANK[role]})`}
          className="sr-only"
        />
        {ROLE_LABELS[role]}
      </label>
    ))}
  </div>
);

const NumberField: React.FC<{
  label: string;
  value: number;
  field: keyof RewardPolicy;
  errors: { field: keyof RewardPolicy; message: string }[];
  onChange: (next: number) => void;
}> = ({ label, value, field, errors, onChange }) => {
  const error = errors.find((e) => e.field === field);
  return (
    <div>
      <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
      />
      {error && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">{error.message}</p>}
    </div>
  );
};

export default RewardsAndDiscipline;
