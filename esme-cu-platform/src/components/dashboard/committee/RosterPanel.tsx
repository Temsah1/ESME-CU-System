import React, { useMemo, useState } from 'react';
import { Search, UserMinus, UserPlus, X } from 'lucide-react';
import type { Committee, User } from '../../../types';
import { ACCOUNT_STATUS_LABELS } from '../../../domain/accountState';
import { ROLE_LABELS } from '../../../domain/roles';
import { POSITION_LABELS, leadershipPostsOf, rosterOf, type LeadershipPosition } from '../../../domain/committees';

type Props = {
  committee: Committee;
  committees: Committee[];
  users: User[];
  mayWrite: boolean;
  onMove: (userId: string, committeeId: string | null) => void;
};

/**
 * The roster is read from the accounts, never typed onto the committee row: a member is
 * someone whose account names this committee. That is the only definition the rest of the
 * platform can check, and the reason a hand-written member count used to disagree with the
 * members directory.
 */
export const RosterPanel: React.FC<Props> = ({ committee, committees, users, mayWrite, onMove }) => {
  const [adding, setAdding] = useState(false);
  const [term, setTerm] = useState('');

  const roster = useMemo(() => rosterOf(committee.id, users), [committee.id, users]);
  const active = roster.filter((u) => u.status === 'active');
  const waiting = roster.filter((u) => u.status !== 'active');

  const candidates = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return users
      .filter((u) => u.committeeId !== committee.id)
      .filter((u) =>
        needle.length === 0 ? true : [u.name, u.email, u.username].some((f) => (f ?? '').toLowerCase().includes(needle))
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 40);
  }, [committee.id, term, users]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">
          {active.length} active member{active.length === 1 ? '' : 's'}
          {waiting.length > 0 ? ` • ${waiting.length} not yet active` : ''}
        </p>
        {mayWrite && (
          <button
            type="button"
            onClick={() => setAdding((open) => !open)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#123B60] text-white flex items-center gap-1"
          >
            <UserPlus className="w-3.5 h-3.5" />
            {adding ? 'Close picker' : 'Add member'}
          </button>
        )}
      </div>

      {adding && mayWrite && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search accounts to move into this committee…"
              aria-label="Search accounts to add to this committee"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
            />
          </div>
          {candidates.length === 0 ? (
            <p className="text-[11px] text-slate-400">
              {users.length === 0
                ? 'The directory is empty, so there is nobody to add. Accounts come from the provider — approvals appear here after the next sync.'
                : `No other account matches “${term}”. Moving an account here changes its committee; it is not a second copy of the person.`}
            </p>
          ) : (
            <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {candidates.map((u) => (
                <li key={u.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{u.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {ROLE_LABELS[u.role]} · {ACCOUNT_STATUS_LABELS[u.status]} ·{' '}
                      {u.committeeId ? committees.find((c) => c.id === u.committeeId)?.shortCode ?? 'unknown committee' : 'no committee'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={u.status !== 'active'}
                    onClick={() => onMove(u.id, committee.id)}
                    className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#F59A16] text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800"
                  >
                    {u.status === 'active' ? 'Move in' : 'Not active'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {roster.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-5 text-[11px] text-slate-500">
          No account names this committee yet. The public site still lists the committee; only the member count is honest about
          being zero.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800">
          {roster.map((member) => {
            const seats = leadershipPostsOf(member.id, committees).filter((post) => post.committee.id !== committee.id);
            const heldHere = leadershipPostsOf(member.id, [committee]).map((post) => POSITION_LABELS[post.position as LeadershipPosition]);
            return (
              <li key={member.id} className="p-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {member.name}
                    {heldHere.length > 0 && (
                      <span className="ml-2 text-[10px] font-semibold text-[#F59A16]">{heldHere.join(', ')} of this committee</span>
                    )}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {ROLE_LABELS[member.role]} · {ACCOUNT_STATUS_LABELS[member.status]} · {member.totalPoints} pts
                  </p>
                  {seats.length > 0 && (
                    <p className="mt-0.5 text-[10px] text-amber-600">
                      Leads {seats.map((s) => `${POSITION_LABELS[s.position]} of ${s.committee.name}`).join(', ')} — moving them out
                      would be refused until the seat is reassigned.
                    </p>
                  )}
                </div>
                {mayWrite && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <select
                      aria-label={`Move ${member.name} to another committee`}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) onMove(member.id, e.target.value);
                      }}
                      className="max-w-[9rem] px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                    >
                      <option value="">Move to…</option>
                      {committees
                        .filter((c) => c.id !== committee.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.shortCode} — {c.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onMove(member.id, null)}
                      title="Release from this committee"
                      aria-label={`Release ${member.name} from this committee`}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!mayWrite && (
        <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <X className="w-3 h-3" />
          Your role reads the roster but cannot change it.
        </p>
      )}
    </div>
  );
};
