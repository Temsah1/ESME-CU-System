import React, { useState } from 'react';
import { History, Plus, ShieldCheck, TriangleAlert, UserPlus, X } from 'lucide-react';
import type { AuditLogItem, Committee, User } from '../../../types';
import { ACCOUNT_STATUS_LABELS } from '../../../domain/accountState';
import { ROLE_LABELS } from '../../../domain/roles';
import {
  LEADERSHIP_POSITIONS,
  POSITION_LABELS,
  leaderAccounts,
  leadershipHistory,
  unresolvedAssignments,
  type CommitteeActor,
  type LeadershipPosition,
} from '../../../domain/committees';
import { AccountSearch } from './AccountSearch';

type Props = {
  committee: Committee;
  committees: Committee[];
  users: User[];
  audit: AuditLogItem[];
  actor: CommitteeActor | null;
  directoryNote: string;
  mayWrite: boolean;
  onAdd: (position: LeadershipPosition, profileIds: string[]) => Promise<void> | void;
  onRemove: (position: LeadershipPosition, profileId: string) => Promise<void> | void;
};

/**
 * One position can hold any number of people, and each person is one row. Adding the next
 * Head never rewrites the existing ones, and removing one leaves the others alone — the panel
 * exposes the two operations separately so the difference is visible, not implied.
 */
export const LeadershipPanel: React.FC<Props> = ({
  committee,
  committees,
  users,
  audit,
  actor,
  directoryNote,
  mayWrite,
  onAdd,
  onRemove,
}) => {
  const [choosing, setChoosing] = useState<LeadershipPosition | null>(null);
  const [busy, setBusy] = useState(false);
  const dangling = unresolvedAssignments(committee, users);
  const history = leadershipHistory(audit, committee.id);

  const add = async (position: LeadershipPosition, profileIds: string[]) => {
    if (profileIds.length === 0) return;
    setBusy(true);
    try {
      await onAdd(position, profileIds);
      setChoosing(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (position: LeadershipPosition, profileId: string) => {
    setBusy(true);
    try {
      await onRemove(position, profileId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        Each appointment is one database row, so a committee may hold any number of Directors and any number of Heads at the same
        time. Names, roles and statuses are read from the accounts on every render; nothing is copied onto the committee.
      </p>

      {dangling.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-[11px] text-amber-800 dark:text-amber-300">
          <p className="flex items-center gap-1.5 font-bold">
            <TriangleAlert className="w-4 h-4" /> {dangling.length} assignment(s) point at an account that is not in this directory
          </p>
          <p className="mt-1">
            They are shown rather than silently dropped, so a broken reference is not mistaken for an empty position. Appointing a
            valid account adds a row; removing the broken one clears only that row.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {LEADERSHIP_POSITIONS.map((position) => {
          const entries = leaderAccounts(committee, position, users);
          return (
            <div key={position} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{POSITION_LABELS[position]}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-[#F59A16]">{entries.length} assigned</span>
                  {mayWrite && actor && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setChoosing(choosing === position ? null : position)}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#123B60] text-white flex items-center gap-1 disabled:opacity-50"
                    >
                      {choosing === position ? <X className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                      {choosing === position ? 'Close' : 'Add'}
                    </button>
                  )}
                </div>
              </div>

              {entries.length === 0 ? (
                <p className="text-[11px] text-slate-400">Nobody holds this position. Add as many accounts as the committee needs.</p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entries.map(({ assignment, account }) => (
                    <li key={assignment.profileId} className="py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                          {account?.name ?? `Unresolved account ${assignment.profileId.slice(0, 12)}…`}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          {account ? (
                            <>
                              {account.email} · {ROLE_LABELS[account.role]} · {ACCOUNT_STATUS_LABELS[account.status]}
                            </>
                          ) : (
                            'This id is not in the directory — remove it and appoint an account that is.'
                          )}
                        </p>
                        {account && (
                          <p className="text-[10px] text-slate-400">
                            Home committee:{' '}
                            {account.committeeId
                              ? committees.find((c) => c.id === account.committeeId)?.name ?? 'not in this list'
                              : ' none assigned'}
                          </p>
                        )}
                        {account && (
                          <p className="flex items-start gap-1 text-[10px] text-emerald-600">
                            <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
                            Holds this position by committee record only. Their {ROLE_LABELS[account.role]} access is unchanged.
                          </p>
                        )}
                        {assignment.assignedAt && <p className="text-[10px] text-slate-300 dark:text-slate-600">Assigned {assignment.assignedAt}</p>}
                      </div>
                      {mayWrite && actor && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(position, assignment.profileId)}
                          className="shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-500 flex items-center gap-1 disabled:opacity-50"
                          aria-label={`Remove ${account?.name ?? assignment.profileId} as ${POSITION_LABELS[position]}`}
                        >
                          <X className="w-3.5 h-3.5" />
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {choosing && actor && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
              Choose one or more accounts to add as {POSITION_LABELS[choosing]} of {committee.name}
            </p>
            <button type="button" onClick={() => setChoosing(null)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <AccountSearch
            committees={committees}
            users={users}
            committee={committee}
            position={choosing}
            actor={actor}
            directoryNote={directoryNote}
            busy={busy}
            onAdd={(profileIds) => void add(choosing, profileIds)}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <History className="w-3.5 h-3.5" /> Leadership history for this committee
        </p>
        {history.length === 0 ? (
          <p className="text-[11px] text-slate-400">
            No leadership decision recorded yet. Every appointment and removal writes one line here.
          </p>
        ) : (
          <ul className="space-y-1">
            {history.map((entry) => (
              <li key={entry.id} className="text-[11px] text-slate-500 dark:text-slate-400">
                <span className="text-slate-400">{entry.timestamp}</span> — {entry.details}
                <span className="text-slate-400"> ({entry.actorName})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mayWrite && !choosing && (
        <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <Plus className="w-3 h-3" />
          Appointments are independent rows: adding a second Head keeps the first, and removing one keeps the rest.
        </p>
      )}
    </div>
  );
};
