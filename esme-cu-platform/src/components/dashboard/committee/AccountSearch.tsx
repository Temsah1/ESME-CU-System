import React, { useMemo, useState } from 'react';
import { Check, Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Committee, User } from '../../../types';
import { ACCOUNT_STATUS_LABELS } from '../../../domain/accountState';
import { ROLE_LABELS } from '../../../domain/roles';
import { POSITION_LABELS, validateLeadershipAssignment, type CommitteeActor, type LeadershipPosition } from '../../../domain/committees';

type Props = {
  committees: Committee[];
  users: User[];
  committee: Committee;
  position: LeadershipPosition;
  actor: CommitteeActor;
  /** Why the directory is empty, shown verbatim instead of an unexplained blank list. */
  directoryNote: string;
  busy?: boolean;
  /** Receives every checked account at once, so several people are appointed in one write. */
  onAdd: (profileIds: string[]) => void;
};

/**
 * Chooses the accounts that will hold a position. Every row is an account the provider returned;
 * there is no free-text name and no "create them again" path, because an appointment that
 * invents a person is exactly the failure this screen used to allow.
 *
 * Candidates come from the full directory — no slice and no page cap — while the list itself is
 * scrollable, so twenty or a hundred eligible accounts are all selectable.
 */
export const AccountSearch: React.FC<Props> = ({
  committees,
  users,
  committee,
  position,
  actor,
  directoryNote,
  busy = false,
  onAdd,
}) => {
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const candidates = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return users
      .filter((u) =>
        needle.length === 0
          ? true
          : [u.name, u.email, u.username].some((field) => (field ?? '').toLowerCase().includes(needle))
      )
      .map((account) => ({
        account,
        verdict: validateLeadershipAssignment({ committees, users, committeeId: committee.id, position, profileId: account.id, actor }),
      }))
      .sort((a, b) => {
        // Eligible people first: the list is a decision aid, not a dump.
        if (a.verdict.allowed !== b.verdict.allowed) return a.verdict.allowed ? -1 : 1;
        return a.account.name.localeCompare(b.account.name);
      });
  }, [actor, committee.id, committees, position, term, users]);

  const selectableIds = useMemo(
    () => candidates.filter(({ verdict }) => verdict.allowed).map(({ account }) => account.id),
    [candidates]
  );
  const chosen = useMemo(() => selected.filter((id) => selectableIds.includes(id)), [selectableIds, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]));

  if (users.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-5 text-[11px] text-slate-500">
        {directoryNote}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search accounts by name, email or username…"
          aria-label={`Search accounts to appoint as ${POSITION_LABELS[position]}`}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          disabled={selectableIds.length === 0}
          onClick={() => setSelected(selectableIds)}
          className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40"
        >
          Select all eligible ({selectableIds.length})
        </button>
        <button
          type="button"
          disabled={chosen.length === 0}
          onClick={() => setSelected([])}
          className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40"
        >
          Clear selection
        </button>
        <span className="text-slate-400">
          {chosen.length} selected · {candidates.length} account(s) listed · {users.length} in the directory
        </span>
      </div>

      {candidates.length === 0 && (
        <p className="text-[11px] text-slate-400 px-1">
          No account matches “{term}”. The directory holds {users.length} account(s); nobody is created by this search.
        </p>
      )}

      <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
        {candidates.map(({ account, verdict }) => (
          <li key={account.id} className="p-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{account.name}</div>
              <div className="text-[10px] text-slate-400 truncate">
                {ROLE_LABELS[account.role]} · {ACCOUNT_STATUS_LABELS[account.status]}
                {account.committeeId
                  ? ` · ${committees.find((c) => c.id === account.committeeId)?.shortCode ?? 'committee no longer listed'}`
                  : ' · no committee'}
              </div>
              {!verdict.allowed && <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">{verdict.reason}</p>}
              {verdict.allowed && verdict.warning && (
                <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600">
                  <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
                  {verdict.warning}
                </p>
              )}
              {verdict.allowed && !verdict.warning && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600">
                  <ShieldCheck className="w-3 h-3" />
                  Eligible — appointing adds one row for this position and never changes the account’s role.
                </p>
              )}
            </div>
            <label className={`shrink-0 flex items-center gap-1.5 text-[11px] font-bold ${verdict.allowed ? 'cursor-pointer' : 'opacity-40'}`}>
              <input
                type="checkbox"
                className="accent-[#123B60]"
                checked={chosen.includes(account.id)}
                disabled={!verdict.allowed || busy}
                onChange={() => toggle(account.id)}
                aria-label={`Select ${account.name} as ${POSITION_LABELS[position]}`}
              />
              {verdict.allowed ? 'Add' : 'Blocked'}
            </label>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={chosen.length === 0 || busy}
        onClick={() => onAdd(chosen)}
        className="w-full px-3 py-2 rounded-xl bg-[#123B60] text-white text-xs font-bold flex items-center justify-center gap-1.5 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800"
      >
        <Check className="w-4 h-4" />
        {busy ? 'Saving…' : `Appoint ${chosen.length} as ${POSITION_LABELS[position]}${chosen.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
};
