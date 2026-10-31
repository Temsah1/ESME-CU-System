import React, { useMemo, useState } from 'react';
import { Archive, Building2, Crown, Eye, EyeOff, Pencil, Plus, RefreshCw, Search, Target, Users, X } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import type { Committee } from '../../types';
import { ACCOUNT_STATUS_LABELS } from '../../domain/accountState';
import { ROLE_LABELS } from '../../domain/roles';
import {
  LEADERSHIP_POSITIONS,
  POSITION_LABELS,
  asCommitteeProblem,
  leaderAccounts,
  rosterOf,
  unresolvedAssignments,
  type DraftIssue,
  type LeadershipPosition,
} from '../../domain/committees';
import { CommitteeForm } from './committee/CommitteeForm';
import { toDraft, toFormValues, type FormValues } from './committee/committeeDraft';
import { LeadershipPanel } from './committee/LeadershipPanel';
import { RosterPanel } from './committee/RosterPanel';

type Modal =
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'leadership'; id: string }
  | { kind: 'roster'; id: string }
  | null;

const ModalHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => (
  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
    <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
    <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
      <X className="w-5 h-5" />
    </button>
  </div>
);

export const CommitteeManagement: React.FC = () => {
  const {
    committees,
    users,
    directory,
    refreshDirectory,
    auditLogs,
    can,
    committeeSource,
    refreshCommittees,
    addCommittee,
    updateCommittee,
    archiveCommittee,
    addCommitteeAssignments,
    removeCommitteeAssignment,
    updateUser,
  } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [issues, setIssues] = useState<DraftIssue[]>([]);
  // Captured when the form opens: the write carries it, so a row changed in another tab or
  // by another officer is refused instead of silently overwritten.
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const actor = { role: currentUser.role, id: currentUser.id, committeeId: currentUser.committeeId };

  const directoryNote =
    directory.error !== null
      ? `The account directory could not be read: ${directory.error}`
      : directory.from === 'provider'
        ? `${users.length} account(s) read from the configured provider.`
        : users.length === 0
          ? 'No account is available to appoint. The directory is filled by the provider — approved applicants appear after a refresh.'
          : `${users.length} profile(s) cached in this browser; the provider directory has not answered.`;

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return committees.filter(
      (c) =>
        needle.length === 0 ||
        c.name.toLowerCase().includes(needle) ||
        c.shortCode.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle)
    );
  }, [committees, searchTerm]);

  const openModal = (next: Modal) => {
    setIssues([]);
    const id = next && 'id' in next ? next.id : undefined;
    setExpectedUpdatedAt(committees.find((c) => c.id === id)?.updatedAt);
    setModal(next);
  };

  /** Runs a write, and reports what the rules said when it was refused. */
  const runWrite = async <T,>(label: string, operation: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await operation();
      setIssues([]);
      toast(label, 'success');
      return result;
    } catch (error) {
      const problem = asCommitteeProblem(error);
      if (problem.issues) setIssues(problem.issues);
      toast(problem.reason, 'error');
      return undefined;
    }
  };

  const handleCreate = async (values: FormValues) => {
    setSaving(true);
    try {
      const created = await runWrite(`Committee “${values.name.trim()}” created`, () => addCommittee(toDraft(values)));
      if (created) {
        openModal({ kind: 'leadership', id: created.id });
        toast('Committee created. Now appoint its leadership — any number of people may hold each position.', 'info');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string, values: FormValues) => {
    setSaving(true);
    try {
      const updated = await runWrite('Committee updated', () =>
        updateCommittee(id, toDraft(values), { updatedAt: expectedUpdatedAt })
      );
      if (updated) setModal(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAddAssignments = async (committee: Committee, position: LeadershipPosition, profileIds: string[]) => {
    const names = profileIds.map((id) => users.find((u) => u.id === id)?.name ?? 'that account').join(', ');
    await runWrite(
      `${profileIds.length} ${POSITION_LABELS[position]}${profileIds.length === 1 ? '' : 's'} appointed: ${names}`,
      () =>
        addCommitteeAssignments({
          committeeId: committee.id,
          position,
          profileIds,
          expectedUpdatedAt: committee.updatedAt,
        })
    );
  };

  const handleRemoveAssignment = async (committee: Committee, position: LeadershipPosition, profileId: string) => {
    const name = users.find((u) => u.id === profileId)?.name ?? 'that account';
    await runWrite(`${POSITION_LABELS[position]} ${name} removed`, () =>
      removeCommitteeAssignment({
        committeeId: committee.id,
        position,
        profileId,
        expectedUpdatedAt: committee.updatedAt,
      })
    );
  };

  const handleMove = async (userId: string, toCommitteeId: string | null) => {
    const member = users.find((u) => u.id === userId);
    await runWrite(member ? `${member.name} ${toCommitteeId ? 'moved' : 'released from the roster'}` : 'Roster updated', async () =>
      updateUser(userId, { committeeId: toCommitteeId ?? '' })
    );
  };

  /** One line naming every position and its holders, so an edit form can say where leadership lives. */
  const leadershipSummary = (committee: Committee) =>
    LEADERSHIP_POSITIONS.map((position) => {
      const entries = leaderAccounts(committee, position, users);
      const names = entries
        .map(({ assignment, account }) => account?.name ?? `unresolved ${assignment.profileId.slice(0, 8)}…`)
        .join(', ');
      return `${POSITION_LABELS[position]}: ${entries.length} assigned${names.length > 0 ? ` (${names})` : ''}`;
    }).join(' • ');

  const editing = modal && 'id' in modal ? committees.find((c) => c.id === modal.id) : undefined;
  const mayCreate = can('committees.write');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Committees &amp; Leadership</h1>
          <p className="text-xs text-slate-500">
            {committees.length} committee{committees.length === 1 ? '' : 's'} configured •{' '}
            {can('committees.write')
              ? currentUser.committeeId
                ? 'you may edit the committee you belong to'
                : 'you may edit committee settings'
              : 'read-only for your role'}
            .
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {committeeSource.error !== null
              ? `The committee list could not be read: ${committeeSource.error}`
              : committeeSource.from === 'provider'
                ? `${committees.length} committee(s) and their leadership assignments read from the configured provider.`
                : `${committees.length} committee(s) cached in this browser; the provider committee list has not answered.`}{' '}
            <button onClick={() => void refreshCommittees()} className="inline-flex items-center gap-1 underline decoration-dotted">
              <RefreshCw className="w-3 h-3" />
              Refresh committees
            </button>{' '}
            <button onClick={() => void refreshDirectory()} className="inline-flex items-center gap-1 underline decoration-dotted">
              <RefreshCw className="w-3 h-3" />
              Refresh directory
            </button>
          </p>
        </div>

        {mayCreate && (
          <button
            onClick={() => openModal({ kind: 'create' })}
            className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Create Committee
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="search"
            placeholder="Search committees by name, acronym or description…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search committees"
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
          />
        </div>
      </div>

      {committees.length === 0 ? (
        <EmptyState
          title="No committees are configured"
          description="Committee definitions are reference content: with none saved, this page is empty and the public website shows no committee structure. An administrator creates the first one."
          icon={Building2}
          action={
            mayCreate ? (
              <button onClick={() => openModal({ kind: 'create' })} className="px-4 py-2 bg-[#123B60] text-white text-xs font-bold rounded-xl">
                Create the first committee
              </button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-400">
          {committees.length} committee{committees.length === 1 ? '' : 's'} exist, but none match “{searchTerm}”.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map((comm) => {
            const mayEditThis = can('committees.write', { committeeId: comm.id });
            const mayArchiveThis = can('committees.archive', { committeeId: comm.id });
            const members = rosterOf(comm.id, users);
            const activeMembers = members.filter((m) => m.status === 'active');
            const waitingMembers = members.filter((m) => m.status !== 'active');
            const holders = LEADERSHIP_POSITIONS.map((position) => ({
              position,
              entries: leaderAccounts(comm, position, users),
            }));
            const dangling = unresolvedAssignments(comm, users);
            return (
              <div
                key={comm.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="px-3 py-1 bg-[#123B60] text-white font-black text-xs rounded-lg">{comm.shortCode}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase text-slate-700 dark:text-slate-200 ${
                          comm.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-slate-100 dark:bg-slate-800'
                        }`}
                      >
                        {comm.status}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 capitalize">
                        {comm.category}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {mayEditThis && (
                        <button
                          onClick={() =>
                            void runWrite(
                              comm.isPublic ? `${comm.shortCode} hidden from the public site` : `${comm.shortCode} shown on the public site`,
                              () => updateCommittee(comm.id, { isPublic: !comm.isPublic }, { updatedAt: comm.updatedAt })
                            )
                          }
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                          title={comm.isPublic ? 'Shown on the public website — click to hide' : 'Hidden — click to show'}
                          aria-label={comm.isPublic ? `Hide ${comm.name} from the public site` : `Show ${comm.name} on the public site`}
                        >
                          {comm.isPublic ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
                        </button>
                      )}
                      {mayEditThis && (
                        <button
                          onClick={() => openModal({ kind: 'edit', id: comm.id })}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                          aria-label={`Edit ${comm.name}`}
                          title="Edit every committee field"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {mayArchiveThis && comm.status === 'active' && (
                        <button
                          onClick={() => void runWrite(`${comm.shortCode} archived`, () => archiveCommittee(comm.id))}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          aria-label={`Archive ${comm.name}`}
                          title="Archive — records and seats are retained"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">{comm.name}</h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">{comm.description}</p>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 text-xs mb-3 space-y-2">
                    {holders.map(({ position, entries }) => (
                      <div key={position}>
                        <div className="flex justify-between gap-2">
                          <span className="text-slate-400">{POSITION_LABELS[position]}:</span>
                          <strong className="text-slate-800 dark:text-slate-200 text-right">
                            {entries.length === 0 ? 'Unassigned' : `${entries.length} assigned`}
                          </strong>
                        </div>
                        {entries.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {entries.map(({ assignment, account }) => (
                              <li key={assignment.profileId} className="text-[10px] font-semibold text-slate-500 text-right truncate">
                                {account ? (
                                  <>
                                    {account.name}
                                    <span className="text-slate-400">
                                      {' '}
                                      · {ROLE_LABELS[account.role]} · {ACCOUNT_STATUS_LABELS[account.status]}
                                    </span>
                                  </>
                                ) : (
                                  <span className="text-amber-600">Unknown account {assignment.profileId.slice(0, 8)}…</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Members:</span>
                      <strong className="text-[#F59A16] text-right">
                        {activeMembers.length} active
                        {waitingMembers.length > 0 && (
                          <span className="text-slate-400 font-semibold"> • {waitingMembers.length} not yet active</span>
                        )}
                      </strong>
                    </div>
                  </div>

                  {dangling.length > 0 && (
                    <p className="mb-3 flex items-start gap-1.5 text-[11px] text-amber-600">
                      <X className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      {dangling.length} assignment{dangling.length === 1 ? '' : 's'} point at an account id that is not in the directory.
                      Open leadership to correct {dangling.length === 1 ? 'it' : 'them'}.
                    </p>
                  )}

                  <div className="flex items-center gap-2 mb-4">
                    <button
                      onClick={() => openModal({ kind: 'leadership', id: comm.id })}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
                    >
                      <Crown className="w-3.5 h-3.5 text-[#F59A16]" />
                      Leadership &amp; history
                    </button>
                    <button
                      onClick={() => openModal({ kind: 'roster', id: comm.id })}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 flex items-center gap-1.5"
                    >
                      <Users className="w-3.5 h-3.5 text-[#123B60]" />
                      Roster
                    </button>
                  </div>

                  <div className="space-y-1.5 mb-4">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sub-Teams:</span>
                    {comm.subTeams.length === 0 ? (
                      <p className="text-[11px] text-slate-400">None recorded.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {comm.subTeams.map((sub) => (
                          <span key={sub} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px]">
                            {sub}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                    Objectives written for this committee:
                  </span>
                  {comm.objectives.length === 0 ? (
                    <p className="text-xs text-slate-400">None yet — an administrator records them through Edit.</p>
                  ) : (
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                      {comm.objectives.slice(0, 2).map((obj, i) => (
                        <li key={`${obj}-${i}`} className="flex items-center gap-1.5">
                          <Target className="w-3.5 h-3.5 text-[#F59A16] shrink-0" />
                          <span className="truncate">{obj}</span>
                        </li>
                      ))}
                      {comm.objectives.length > 2 && (
                        <li className="text-[11px] text-slate-400">
                          +{comm.objectives.length - 2} more objective{comm.objectives.length - 2 === 1 ? '' : 's'}
                        </li>
                      )}
                    </ul>
                  )}
                  {comm.updatedAt && <p className="mt-2 text-[10px] text-slate-300 dark:text-slate-600">Last saved {comm.updatedAt}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ModalShell
        open={modal?.kind === 'create'}
        onClose={() => setModal(null)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        <ModalHeader title="Create New Committee" onClose={() => setModal(null)} />
        <CommitteeForm
          initial={toFormValues()}
          issues={issues}
          submitLabel="Create committee"
          seatsSummary="A committee is created with no leadership assignments. The leadership panel opens straight after, and any number of accounts may be appointed to each position."
          busy={saving}
          onSubmit={handleCreate}
          onCancel={() => setModal(null)}
        />
      </ModalShell>

      <ModalShell
        open={modal?.kind === 'edit'}
        onClose={() => setModal(null)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        {editing && (
          <>
            <ModalHeader title={`Edit Committee: ${editing.name}`} onClose={() => setModal(null)} />
            <CommitteeForm
              key={`${editing.id}-${editing.updatedAt ?? 'fresh'}`}
              initial={toFormValues(editing)}
              issues={issues}
              submitLabel="Save changes"
              seatsSummary={`Leadership is not edited here — ${leadershipSummary(editing)}.`}
              busy={saving}
              onSubmit={(values) => handleUpdate(editing.id, values)}
              onCancel={() => setModal(null)}
            />
          </>
        )}
      </ModalShell>

      <ModalShell
        open={modal?.kind === 'leadership'}
        onClose={() => setModal(null)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        {editing && (
          <>
            <ModalHeader title={`Leadership: ${editing.name}`} onClose={() => setModal(null)} />
            <LeadershipPanel
              committee={editing}
              committees={committees}
              users={users}
              audit={auditLogs}
              actor={actor}
              directoryNote={directoryNote}
              mayWrite={can('committees.write', { committeeId: editing.id })}
              onAdd={(position, profileIds) => handleAddAssignments(editing, position, profileIds)}
              onRemove={(position, profileId) => handleRemoveAssignment(editing, position, profileId)}
            />
          </>
        )}
      </ModalShell>

      <ModalShell
        open={modal?.kind === 'roster'}
        onClose={() => setModal(null)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        {editing && (
          <>
            <ModalHeader title={`Roster: ${editing.name}`} onClose={() => setModal(null)} />
            <RosterPanel
              committee={editing}
              committees={committees}
              users={users}
              mayWrite={can('users.update', { committeeId: editing.id })}
              onMove={handleMove}
            />
          </>
        )}
      </ModalShell>
    </div>
  );
};
