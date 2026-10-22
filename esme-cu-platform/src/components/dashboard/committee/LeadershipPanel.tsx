import React, { useState } from 'react';
import { History, ShieldCheck, TriangleAlert, UserPlus, X } from 'lucide-react';
import type { AuditLogItem, Committee, User } from '../../../types';
import { ACCOUNT_STATUS_LABELS } from '../../../domain/accountState';
import { ROLE_LABELS } from '../../../domain/roles';
import {
  LEADERSHIP_POSITIONS,
  POSITION_LABELS,
  leaderAccount,
  leadershipHistory,
  unresolvedLeaders,
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
  onAssign: (position: LeadershipPosition, userId: string | null) => void;
};

/**
 * The seat and the role are two different facts, and this panel says so on every row:
 * appointing a Head records who leads the committee, it does not grant capabilities.
 * Elevation is a separate privileged operation the members directory performs.
 */
export const LeadershipPanel: React.FC<Props> = ({
  committee,
  committees,
  users,
  audit,
  actor,
  directoryNote,
  mayWrite,
  onAssign,
}) => {
  const [choosing, setChoosing] = useState<LeadershipPosition | null>(null);
  const dangling = unresolvedLeaders(committee, users);
  const history = leadershipHistory(audit, committee.id);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500">
        A seat stores one account id and nothing else. The name, role and status below are read from that account each time this
        screen renders, so renaming or replacing a person is reflected here, on the dashboard and on the public site at once.
      </p>

      {dangling.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-[11px] text-amber-800 dark:text-amber-300">
          <p className="flex items-center gap-1.5 font-bold">
            <TriangleAlert className="w-4 h-4" /> {dangling.length} seat(s) point at an account that is not in this directory
          </p>
          <p className="mt-1">
            {dangling.map((p) => POSITION_LABELS[p]).join(', ')} holds an id no account answers. It is shown rather than cleared so the
            gap is not mistaken for an empty seat. Appointing a valid account replaces it and is written to the audit trail.
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        {LEADERSHIP_POSITIONS.map((position) => {
          const holder = leaderAccount(committee, position, users);
          const seated = position === 'director' ? committee.directorId : committee.headId;
          return (
            <div key={position} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{POSITION_LABELS[position]}</span>
                {seated && (
                  <span className="text-[10px] text-slate-400">{seated.slice(0, 12)}…</span>
                )}
              </div>

              {holder ? (
                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{holder.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {holder.email} · {ROLE_LABELS[holder.role]} · {ACCOUNT_STATUS_LABELS[holder.status]}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Home committee:
                    {holder.committeeId
                      ? ` ${committees.find((c) => c.id === holder.committeeId)?.name ?? 'not in this list'}`
                      : ' none assigned'}
                  </p>
                  <p className="flex items-start gap-1 text-[10px] text-emerald-600">
                    <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
                    Holds this seat by committee record only. Their {ROLE_LABELS[holder.role]} access is unchanged.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">
                  {seated ? 'Seat holds an unresolvable account id.' : 'Vacant — nobody is accountable for this seat.'}
                </p>
              )}

              {mayWrite && actor && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setChoosing(choosing === position ? null : position)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#123B60] text-white flex items-center gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {holder ? 'Replace' : 'Appoint'}
                  </button>
                  {seated && (
                    <button
                      type="button"
                      onClick={() => onAssign(position, null)}
                      className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-500 flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      Clear seat
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {choosing && actor && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
              Choose the account to seat as {POSITION_LABELS[choosing]} of {committee.name}
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
            onAssign={(userId) => {
              onAssign(choosing, userId);
              setChoosing(null);
            }}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <History className="w-3.5 h-3.5" /> Leadership history for this committee
        </p>
        {history.length === 0 ? (
          <p className="text-[11px] text-slate-400">
            No leadership decision recorded yet. Every appointment, replacement or clearance writes one line here.
          </p>
        ) : (
          <ul className="space-y-1">
            {history.slice(0, 8).map((entry) => (
              <li key={entry.id} className="text-[11px] text-slate-500 dark:text-slate-400">
                <span className="text-slate-400">{entry.timestamp}</span> — {entry.details}
                <span className="text-slate-400"> ({entry.actorName})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
