import React, { useMemo, useState } from 'react';
import { Search, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Committee, User } from '../../../types';
import { ACCOUNT_STATUS_LABELS } from '../../../domain/accountState';
import { ROLE_LABELS } from '../../../domain/roles';
import { validateLeadershipAssignment, type CommitteeActor, type LeadershipPosition } from '../../../domain/committees';

type Props = {
  committees: Committee[];
  users: User[];
  committee: Committee;
  position: LeadershipPosition;
  actor: CommitteeActor;
  /** Why the directory is empty, shown verbatim instead of an unexplained blank list. */
  directoryNote: string;
  onAssign: (userId: string) => void;
};

/**
 * Chooses the account that will hold a seat. Every row is an account the provider returned;
 * there is no free-text name and no "create them again" path, because an appointment that
 * invents a person is exactly the failure this screen used to allow.
 */
export const AccountSearch: React.FC<Props> = ({ committees, users, committee, position, actor, directoryNote, onAssign }) => {
  const [term, setTerm] = useState('');

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
        verdict: validateLeadershipAssignment({ committees, users, committeeId: committee.id, position, userId: account.id, actor }),
      }))
      .sort((a, b) => {
        // Eligible people first: the list is a decision aid, not a dump.
        if (a.verdict.allowed !== b.verdict.allowed) return a.verdict.allowed ? -1 : 1;
        return a.account.name.localeCompare(b.account.name);
      });
  }, [actor, committee.id, committees, position, term, users]);

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
          aria-label={`Search accounts to appoint as ${position === 'director' ? 'Director' : 'Head'}`}
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]"
        />
      </div>

      {candidates.length === 0 && (
        <p className="text-[11px] text-slate-400 px-1">
          No account matches “{term}”. The directory holds {users.length} account(s); nobody is created by this search.
        </p>
      )}

      <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
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
              {!verdict.allowed && (
                <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-400">{verdict.reason}</p>
              )}
              {verdict.allowed && verdict.warning && (
                <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600">
                  <TriangleAlert className="w-3 h-3 shrink-0 mt-0.5" />
                  {verdict.warning}
                </p>
              )}
              {verdict.allowed && !verdict.warning && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-600">
                  <ShieldCheck className="w-3 h-3" />
                  Eligible — appointing changes this seat only, never the account’s role.
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={!verdict.allowed}
              onClick={() => onAssign(account.id)}
              className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#123B60] text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800"
            >
              {verdict.allowed ? 'Appoint' : 'Blocked'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
