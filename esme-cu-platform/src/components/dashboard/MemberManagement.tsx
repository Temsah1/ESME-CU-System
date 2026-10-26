import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Mail,
  X,
  Edit3,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Award,
} from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { useStickyNonNull, ModalShell, useToast } from '../../motion';
import { DataTable, type DataTableAction } from './DataTable';
import { ALL_ROLES, ROLE_LABELS, canReadProfile, isPrimaryAdmin, scopeFor } from '../../domain/roles';
import {
  SEVERITY_LABELS,
  WARNING_SEVERITIES,
  mayOfferReward,
  validateRewardAction,
  warningNumberAfter,
  type RewardKind,
  type WarningSeverity,
} from '../../domain/rewards';
import { ACCOUNT_STATUS_LABELS, ACCOUNT_STATUSES, canTransition, type AccountStatus } from '../../domain/accountState';
import { ACADEMIC_YEAR_OPTIONS, DEPARTMENT_OPTIONS } from '../../data/referenceContent';
import type { Role, User } from '../../types';

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]';

const labelClass = 'block font-bold text-slate-700 dark:text-slate-300 mb-1';

const STATUS_STYLES: Record<AccountStatus, string> = {
  pending_approval: 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900',
  active: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
  suspended: 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

const BLANK_MEMBER = {
  name: '',
  email: '',
  username: '',
  committeeId: '',
  subTeam: '',
  department: '',
  academicYear: '',
  phone: '',
};

/**
 * The same two lists the signup form offers, so a profile and an application cannot store the same
 * fact two different ways. A value an older account already carries is appended rather than
 * dropped: opening a profile has to leave it selected, and saving it must not rewrite history
 * because the chapter's list moved on.
 */
const optionsFor = (list: string[], current: string | undefined): string[] =>
  current && !list.includes(current) ? [...list, current] : list;

export const MemberManagement: React.FC = () => {
  const {
    users,
    committees,
    can,
    addUser,
    updateUser,
    assignRole,
    setAccountStatus,
    deleteUser,
    rewardEntries,
    rewardPolicy,
    awardBonus,
    issueWarning,
  } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [selectedCommitteeFilter, setSelectedCommitteeFilter] = useState('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'all' | Role>('all');
  const [selectedSubTeamFilter, setSelectedSubTeamFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUser, setNewUser] = useState({ ...BLANK_MEMBER, role: 'member' as Role });
  const [roleDraft, setRoleDraft] = useState<Role>(currentUser.role);
  const [statusDraft, setStatusDraft] = useState<AccountStatus | ''>('');
  const [pending, setPending] = useState(false);

  // The inline form is opened for one person and one intent. The idempotency key is minted with
  // that intent, so a retried click or a re-submit lands on the same entry instead of a second one.
  const [rewardForm, setRewardForm] = useState<{
    kind: RewardKind;
    target: User;
    idempotencyKey: string;
    openedAt: string;
  } | null>(null);
  const [rewardPoints, setRewardPoints] = useState(10);
  const [rewardSeverity, setRewardSeverity] = useState<WarningSeverity>('notice');
  const [rewardReason, setRewardReason] = useState('');
  const [rewardEvidence, setRewardEvidence] = useState('');
  const [rewardFiling, setRewardFiling] = useState(false);

  const mayCreate = can('users.create');
  const mayUpdate = can('users.update');
  const mayAssignRoles = can('users.role.assign');
  const maySuspend = can('users.suspend');
  const mayDelete = can('users.delete');

  const actor = {
    id: currentUser.id,
    role: currentUser.role,
    committeeId: currentUser.committeeId,
    subTeam: currentUser.subTeam,
  };

  /**
   * The row-level question, answered from the same self/rank/high-board/committee rules the store
   * applies. A row that would be refused gets no button, so the screen never offers a dead action.
   */
  const offersReward = (kind: RewardKind, target: User) =>
    mayOfferReward(kind, actor, target, {
      policy: rewardPolicy,
      targetIsPrimaryAdmin: isPrimaryAdmin(target),
    });

  const openReward = (kind: RewardKind, target: User) => {
    setRewardForm({
      kind,
      target,
      idempotencyKey: `${kind}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`,
      openedAt: new Date().toISOString(),
    });
    setRewardPoints(10);
    setRewardSeverity('notice');
    setRewardReason('');
    setRewardEvidence('');
  };

  const closeReward = () => {
    if (rewardFiling) return;
    setRewardForm(null);
  };

  // The store reaches the same decision; this is only what the form shows before it is submitted,
  // including the rolling-window caps a row-level visibility check cannot see.
  const rewardPreview = rewardForm
    ? validateRewardAction({
        kind: rewardForm.kind,
        actor,
        target: rewardForm.target,
        points: rewardForm.kind === 'bonus' ? rewardPoints : 0,
        severity: rewardForm.kind === 'warning' ? rewardSeverity : undefined,
        reason: rewardReason,
        evidenceUrl: rewardEvidence,
        policy: rewardPolicy,
        entries: rewardEntries,
        now: rewardForm.openedAt,
        targetIsPrimaryAdmin: isPrimaryAdmin(rewardForm.target),
      })
    : null;

  const handleRewardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rewardForm || rewardFiling) return;
    if (rewardPreview && !rewardPreview.allowed) {
      toast(rewardPreview.reason, 'error');
      return;
    }
    const { kind, target, idempotencyKey } = rewardForm;
    setRewardFiling(true);
    try {
      const entry =
        kind === 'bonus'
          ? await awardBonus({
              targetId: target.id,
              points: rewardPoints,
              reason: rewardReason,
              evidenceUrl: rewardEvidence,
              idempotencyKey,
            })
          : await issueWarning({
              targetId: target.id,
              severity: rewardSeverity,
              reason: rewardReason,
              evidenceUrl: rewardEvidence,
              idempotencyKey,
            });
      toast(
        entry.kind === 'bonus'
          ? `${entry.points} bonus point${entry.points === 1 ? '' : 's'} recorded for ${entry.targetName}.`
          : `${SEVERITY_LABELS[entry.severity ?? 'notice']} recorded for ${entry.targetName}.`,
        'success'
      );
      setRewardForm(null);
      setRewardReason('');
      setRewardEvidence('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The entry was not recorded.', 'error');
    } finally {
      setRewardFiling(false);
    }
  };

  /**
   * The directory is a read of `users.read`'s scope, not of the workspace cache: a committee-scoped
   * officer sees their own committee and their own record, and an account with no grant sees no
   * rows. The provider's RLS applies the same rule, so filtering here cannot widen what a caller
   * could have read.
   */
  const directoryScope = scopeFor(currentUser.role, 'users.read');
  const visibleUsers = directoryScope ? users.filter((u) => canReadProfile(currentUser, u)) : [];
  const scopedCommittees =
    directoryScope === 'all'
      ? committees
      : committees.filter((c) => c.id === currentUser.committeeId);
  const committeeName = committees.find((c) => c.id === currentUser.committeeId)?.name;
  const subTeams = [...new Set(visibleUsers.map((u) => u.subTeam).filter((s): s is string => Boolean(s)))].sort();

  // Free-text search is the table's own; these selects are the scope the caller controls.
  const filteredUsers = visibleUsers.filter((u) => {
    const matchesCommittee = selectedCommitteeFilter === 'all' || u.committeeId === selectedCommitteeFilter;
    const matchesRole = selectedRoleFilter === 'all' || u.role === selectedRoleFilter;
    const matchesSubTeam = selectedSubTeamFilter === 'all' || u.subTeam === selectedSubTeamFilter;
    return matchesCommittee && matchesRole && matchesSubTeam;
  });

  const openEdit = (user: User) => {
    setEditingUser(user);
    setRoleDraft(user.role);
    // The state select offers transitions, never the state the account already holds, so its draft
    // starts empty rather than on a value no option carries — a controlled select whose value
    // matches nothing reports "" back to the caller.
    setStatusDraft('');
  };

  const runPrivileged = async (label: string, operation: () => Promise<void> | void) => {
    setPending(true);
    try {
      await operation();
      toast(label);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The request was refused.', 'error');
    } finally {
      setPending(false);
    }
  };

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault();
    runPrivileged(`Provisioned ${newUser.name}. The profile stays pending until it is activated here.`, async () => {
      await addUser({
        name: newUser.name,
        email: newUser.email,
        username: newUser.username || newUser.email.split('@')[0],
        role: mayAssignRoles ? newUser.role : 'member',
        committeeId: newUser.committeeId || committees[0]?.id || '',
        subTeam: newUser.subTeam,
        department: newUser.department,
        academicYear: newUser.academicYear,
        phone: newUser.phone,
      });
      setIsAddModalOpen(false);
      setNewUser({ ...BLANK_MEMBER, role: 'member' });
    });
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const draft = editingUser;
    runPrivileged('Profile updated.', () => {
      updateUser(draft.id, {
        name: draft.name,
        committeeId: draft.committeeId,
        subTeam: draft.subTeam,
        department: draft.department,
        academicYear: draft.academicYear,
        phone: draft.phone,
      });
      setEditingUser(null);
    });
  };

  const handleRoleChange = () => {
    if (!editingUser || roleDraft === editingUser.role) return;
    const target = editingUser;
    runPrivileged(`${target.name} is now ${ROLE_LABELS[roleDraft]}.`, async () => {
      await assignRole(target.id, roleDraft);
      setEditingUser({ ...target, role: roleDraft });
    });
  };

  const handleStatusChange = () => {
    // Only a state the account may actually move to is a write; the select's own option list is
    // the authority, so an empty draft or a value it does not offer is ignored instead of filed.
    if (!editingUser || !statusDraft || !canTransition(editingUser.status, statusDraft)) return;
    const target = editingUser;
    runPrivileged(`${target.name} moved to ${ACCOUNT_STATUS_LABELS[statusDraft]}.`, async () => {
      await setAccountStatus(target.id, statusDraft);
      setEditingUser({ ...target, status: statusDraft });
    });
  };

  const viewUser = useStickyNonNull(editingUser);

  const patchUser = (updates: Partial<User>) =>
    setEditingUser(viewUser ? { ...viewUser, ...updates } : null);

  const legalStatuses = viewUser
    ? ACCOUNT_STATUSES.filter((s) => s !== viewUser.status && canTransition(viewUser.status, s))
    : [];

  return (
    <div className="space-y-6">

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Members Directory</h1>
          <p className="text-xs text-slate-500">
            {directoryScope === null
              ? 'This directory is not available to your role. Your own record and your committee live on the Overview.'
              : directoryScope === 'committee'
                ? `${visibleUsers.length} account${visibleUsers.length === 1 ? '' : 's'} in ${
                    committeeName ?? 'your committee'
                  }. Other committees are outside your scope; the provider enforces the same boundary.`
                : visibleUsers.length > 0
                  ? `${visibleUsers.length} account${visibleUsers.length === 1 ? '' : 's'} visible to you. Roles and account states are set by the provider, never typed in here.`
                  : 'Accounts appear here when your authentication provider returns them.'}
          </p>
        </div>

        {mayCreate && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            Provision Member
          </button>
        )}
      </div>

      {/* An empty directory, a filtered-empty directory and a populated one are all states of the table. */}
      <DataTable
        rows={filteredUsers}
        rowKey={(u) => u.id}
        searchText={(u) => `${u.name} ${u.email} ${u.username}`}
        searchPlaceholder="Search by name, email, or username..."
        noMatchesLabel="No accounts match this search and these filters."
        empty={{
          title:
            directoryScope === null
              ? 'This directory is not available to your role'
              : directoryScope === 'committee'
                ? `No accounts in ${committeeName ?? 'your committee'} yet`
                : 'No member accounts yet',
          description:
            directoryScope === null
              ? 'Reading the chapter directory needs a role that holds users.read. Nothing is shown here, and nothing is inferred from the accounts this browser has cached.'
              : directoryScope === 'committee'
                ? 'Only accounts in your committee can appear here. Until the provider returns a profile for one, there is nothing to list.'
                : 'This directory reads from your authentication provider. Until that provider is configured and returns profiles, there is nothing to list — no sample members are inserted to fill the space.',
          icon: Users,
          action: mayCreate ? (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 bg-[#123B60] text-white text-xs font-bold rounded-xl"
            >
              Provision the first account
            </button>
          ) : undefined,
        }}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCommitteeFilter}
              onChange={(e) => setSelectedCommitteeFilter(e.target.value)}
              aria-label="Filter by committee"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
            >
              <option value="all">All Committees</option>
              {scopedCommittees.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              value={selectedRoleFilter}
              onChange={(e) => setSelectedRoleFilter(e.target.value as 'all' | Role)}
              aria-label="Filter by role"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
            >
              <option value="all">All Roles</option>
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>

            {subTeams.length > 1 && (
              <select
                value={selectedSubTeamFilter}
                onChange={(e) => setSelectedSubTeamFilter(e.target.value)}
                aria-label="Filter by sub-team"
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
              >
                <option value="all">All Sub-teams</option>
                {subTeams.map((team) => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
            )}
          </div>
        }
        columns={[
          {
            key: 'member',
            label: 'Member Name',
            cardTitle: true,
            sortValue: (u) => u.name,
            render: (u) => (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {u.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-800 dark:text-slate-100">{u.name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{u.email}</div>
                </div>
              </div>
            ),
          },
          {
            key: 'role',
            label: 'Role',
            sortValue: (u) => ROLE_LABELS[u.role] ?? u.role,
            render: (u) => (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {ROLE_LABELS[u.role] ?? u.role}
              </span>
            ),
          },
          {
            key: 'committee',
            label: 'Committee & Sub-team',
            sortValue: (u) => committees.find((c) => c.id === u.committeeId)?.name ?? '',
            render: (u) => {
              const comm = committees.find((c) => c.id === u.committeeId);
              return (
                <>
                  <div className="font-medium text-slate-700 dark:text-slate-300">{comm ? comm.name : '—'}</div>
                  {u.subTeam && <div className="text-[10px] text-slate-400">{u.subTeam}</div>}
                </>
              );
            },
          },
          {
            key: 'year',
            label: 'Academic Year',
            sortValue: (u) => u.academicYear ?? '',
            render: (u) => (
              <>
                <div className="text-slate-600 dark:text-slate-400">{u.academicYear || '—'}</div>
                <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{u.department || '—'}</div>
              </>
            ),
          },
          {
            key: 'points',
            label: 'Points',
            align: 'center',
            sortValue: (u) => u.totalPoints,
            render: (u) => <span className="font-bold text-[#F59A16]">{u.totalPoints}</span>,
          },
          {
            key: 'approved',
            label: 'Approved Tasks',
            align: 'center',
            sortValue: (u) => u.approvedTasksCount,
            render: (u) => (
              <span className="font-semibold text-slate-700 dark:text-slate-300">{u.approvedTasksCount}</span>
            ),
          },
          {
            key: 'state',
            label: 'Account State',
            sortValue: (u) => ACCOUNT_STATUS_LABELS[u.status],
            render: (u) => (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[u.status]}`}>
                {ACCOUNT_STATUS_LABELS[u.status]}
              </span>
            ),
          },
        ]}
        actions={[
          {
            key: 'award-bonus',
            label: 'Award bonus',
            icon: Award,
            hidden: (u: User) => !offersReward('bonus', u),
            onClick: (u: User) => openReward('bonus', u),
          } as DataTableAction<User>,
          {
            key: 'issue-warning',
            label: 'Issue warning',
            icon: AlertTriangle,
            hidden: (u: User) => !offersReward('warning', u),
            onClick: (u: User) => openReward('warning', u),
          } as DataTableAction<User>,
          ...(mayUpdate
            ? [
                {
                  key: 'open',
                  label: 'Open record',
                  icon: Edit3,
                  onClick: openEdit,
                } as DataTableAction<User>,
              ]
            : []),
          ...(mayDelete
            ? [
                {
                  key: 'remove',
                  label: 'Remove from directory',
                  icon: Trash2,
                  danger: true,
                  hidden: (u: User) => u.id === currentUser.id,
                  // The store refuses this write for a Super Admin regardless of what the row allows.
                  disabled: (u: User) => u.role === 'super_admin',
                  confirm: {
                    title: 'Remove this account from the directory?',
                    confirmLabel: 'Remove',
                    body: (u: User) =>
                      `This drops ${u.name} from this device's directory and releases any leadership seat held by that account. Deleting the identity itself is done on the authentication provider, and the audit trail keeps this action.`,
                  },
                  onClick: (u: User) =>
                    runPrivileged('Removed from the local directory.', () => deleteUser(u.id)),
                } as DataTableAction<User>,
              ]
            : []),
        ]}
      />

      {/* Inline bonus / warning modal, opened from one row and aimed only at that row. */}
      <ModalShell
        open={rewardForm !== null}
        onClose={closeReward}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {rewardForm && (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {rewardForm.kind === 'bonus'
                  ? `Award a bonus to ${rewardForm.target.name}`
                  : `Issue a warning to ${rewardForm.target.name}`}
              </h2>
              <button
                onClick={closeReward}
                disabled={rewardFiling}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRewardSubmit} className="space-y-4 text-xs">
              <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                {rewardForm.kind === 'bonus'
                  ? `A bonus writes the entry and a scoring-ledger row. Cap is ${rewardPolicy.maxBonusPointsPerAction} per action and ${rewardPolicy.maxBonusPointsPerMemberPerPeriod} per member in ${rewardPolicy.periodDays} days.`
                  : `A warning moves no points. This would be warning ${warningNumberAfter(
                      rewardEntries,
                      rewardForm.target.id,
                      rewardPolicy,
                      rewardForm.openedAt
                    )} in ${rewardPolicy.periodDays} days, and at ${rewardPolicy.escalateWarningsAfter} the ${
                      rewardPolicy.notifyRolesOnEscalation.map((r) => ROLE_LABELS[r]).join(' and ')
                    } are alerted.`}
              </p>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                <div className="font-bold text-slate-800 dark:text-slate-100">{rewardForm.target.name}</div>
                <div className="text-[10px] text-slate-400">
                  {ROLE_LABELS[rewardForm.target.role]}
                  {rewardForm.target.committeeId
                    ? ` · ${committees.find((c) => c.id === rewardForm.target.committeeId)?.name ?? 'committee not listed'}`
                    : ' · no committee'}
                  {` · ${rewardForm.target.totalPoints} pts`}
                </div>
              </div>

              {rewardForm.kind === 'bonus' ? (
                <div>
                  <label className={labelClass} htmlFor="inline-reward-points">Bonus points</label>
                  <input
                    id="inline-reward-points"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={rewardPoints}
                    onChange={(e) => setRewardPoints(Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
              ) : (
                <div>
                  <label className={labelClass} htmlFor="inline-reward-severity">Severity</label>
                  <select
                    id="inline-reward-severity"
                    value={rewardSeverity}
                    onChange={(e) => setRewardSeverity(e.target.value as WarningSeverity)}
                    className={inputClass}
                  >
                    {WARNING_SEVERITIES.map((s) => (
                      <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={labelClass} htmlFor="inline-reward-reason">Reason (mandatory)</label>
                <textarea
                  id="inline-reward-reason"
                  required
                  rows={3}
                  maxLength={400}
                  value={rewardReason}
                  onChange={(e) => setRewardReason(e.target.value)}
                  placeholder={
                    rewardForm.kind === 'bonus'
                      ? 'What exactly did the member do, and under which task or event?'
                      : 'What happened, when, and what is expected to change?'
                  }
                  className={inputClass}
                />
                <div className="text-[10px] text-slate-400 text-right">{rewardReason.length}/400</div>
              </div>

              <div>
                <label className={labelClass} htmlFor="inline-reward-evidence">Evidence link (optional)</label>
                <input
                  id="inline-reward-evidence"
                  type="url"
                  value={rewardEvidence}
                  onChange={(e) => setRewardEvidence(e.target.value)}
                  placeholder="https://…"
                  className={inputClass}
                />
              </div>

              {rewardPreview && (
                <div
                  className={`rounded-xl px-3.5 py-2.5 text-[11px] ${
                    !rewardPreview.allowed
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                      : rewardPreview.warning
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  }`}
                  role="status"
                >
                  {!rewardPreview.allowed ? (
                    <>Blocked: {rewardPreview.reason}</>
                  ) : rewardPreview.warning ? (
                    <>Before you commit: {rewardPreview.warning}</>
                  ) : (
                    <>
                      Ready to write for {rewardForm.target.name}
                      {rewardForm.kind === 'bonus'
                        ? ` — ${rewardPoints} points, new total ${rewardForm.target.totalPoints + rewardPoints} pts.`
                        : ' — no points move; the member and the audit trail both get the reason.'}
                    </>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={closeReward}
                  disabled={rewardFiling}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!rewardPreview?.allowed || rewardFiling}
                  className="px-5 py-2 bg-[#123B60] text-white font-bold rounded-xl disabled:opacity-50"
                >
                  {rewardFiling
                    ? 'Recording…'
                    : rewardForm.kind === 'bonus'
                      ? 'Record bonus'
                      : 'Record warning'}
                </button>
              </div>
            </form>
          </>
        )}
      </ModalShell>

      {/* Provision Member Modal */}
      <ModalShell open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Provision a Member Account</h2>
          <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreateUser} className="space-y-4 text-xs">
          <p className="text-[11px] text-slate-500 leading-relaxed rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2.5">
            This creates a directory profile. It sets no password and grants no access: the row stays
            <strong> pending</strong> until this directory moves it to <strong>active</strong>.
          </p>

          <div>
            <label className={labelClass} htmlFor="member-name">Full Name</label>
            <input
              id="member-name"
              type="text"
              required
              value={newUser.name}
              onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="member-email">Email</label>
              <input
                id="member-email"
                type="email"
                required
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="member-username">Username</label>
              <input
                id="member-username"
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className={inputClass}
                placeholder="derived from email"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="member-committee">Committee</label>
              <select
                id="member-committee"
                value={newUser.committeeId || committees[0]?.id || ''}
                onChange={(e) => setNewUser({ ...newUser, committeeId: e.target.value })}
                className={inputClass}
              >
                {committees.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="member-subteam">Sub-team</label>
              <input
                id="member-subteam"
                type="text"
                value={newUser.subTeam}
                onChange={(e) => setNewUser({ ...newUser, subTeam: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="member-year">Academic Year</label>
              <select
                id="member-year"
                value={newUser.academicYear}
                onChange={(e) => setNewUser({ ...newUser, academicYear: e.target.value })}
                className={inputClass}
              >
                <option value="">Not recorded</option>
                {ACADEMIC_YEAR_OPTIONS.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="member-department">Department</label>
              <select
                id="member-department"
                value={newUser.department}
                onChange={(e) => setNewUser({ ...newUser, department: e.target.value })}
                className={inputClass}
              >
                <option value="">Not recorded</option>
                {DEPARTMENT_OPTIONS.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="member-phone">Phone</label>
              <input
                id="member-phone"
                type="tel"
                value={newUser.phone}
                onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          {mayAssignRoles ? (
            <div>
              <label className={labelClass} htmlFor="member-role">Role</label>
              <select
                id="member-role"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as Role })}
                className={inputClass}
              >
                {ALL_ROLES.map((role) => (
                  <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                ))}
              </select>
              <p className="mt-1.5 text-[10px] text-slate-400 inline-flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" aria-hidden />
                Granting a privileged role is recorded in the audit trail.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">
              Role: <strong>Member</strong>. Assigning a privileged role requires the role-assignment capability.
            </p>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-5 py-2 bg-[#F59A16] hover:bg-[#D47F0A] disabled:opacity-60 text-white font-bold rounded-xl"
            >
              Create Account
            </button>
          </div>
        </form>
      </ModalShell>

      {/* Member Record Modal */}
      <ModalShell open={!!editingUser} onClose={() => setEditingUser(null)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
        {viewUser && (
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">{viewUser.name}</h2>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-slate-600" aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <Mail className="w-3.5 h-3.5" aria-hidden /> {viewUser.email}
              <span className="text-slate-300">•</span>@{viewUser.username}
              <span className="text-slate-300">•</span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[viewUser.status]}`}>
                {ACCOUNT_STATUS_LABELS[viewUser.status]}
              </span>
            </div>

            {/* Profile fields */}
            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="edit-name">Full Name</label>
                  <input
                    id="edit-name"
                    type="text"
                    required
                    value={viewUser.name}
                    onChange={(e) => patchUser({ name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="edit-committee">Committee</label>
                  <select
                    id="edit-committee"
                    value={viewUser.committeeId || ''}
                    onChange={(e) => patchUser({ committeeId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Unassigned</option>
                    {committees.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="edit-subteam">Sub-team</label>
                  <input
                    id="edit-subteam"
                    type="text"
                    value={viewUser.subTeam || ''}
                    onChange={(e) => patchUser({ subTeam: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="edit-year">Academic Year</label>
                  <select
                    id="edit-year"
                    value={viewUser.academicYear || ''}
                    onChange={(e) => patchUser({ academicYear: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Not recorded</option>
                    {optionsFor(ACADEMIC_YEAR_OPTIONS, viewUser.academicYear).map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="edit-department">Department</label>
                <select
                  id="edit-department"
                  value={viewUser.department || ''}
                  onChange={(e) => patchUser({ department: e.target.value })}
                  className={inputClass}
                >
                  <option value="">Not recorded</option>
                  {optionsFor(DEPARTMENT_OPTIONS, viewUser.department).map((department) => (
                    <option key={department} value={department}>{department}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={pending}
                  className="px-5 py-2 bg-[#123B60] disabled:opacity-60 text-white font-bold rounded-xl text-xs"
                >
                  Save Profile
                </button>
              </div>
            </form>

            {/* Privileged operations are separate, explicit and individually confirmed */}
            {(mayAssignRoles || maySuspend) && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {mayAssignRoles && (
                  <div className="p-4 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Change role</p>
                    {viewUser.id === currentUser.id ? (
                      // The store refuses a self-targeted grant whatever this panel shows; this only keeps
                      // the screen from inviting a click that cannot succeed.
                      <p className="text-xs font-bold text-slate-500">
                        A role change is decided by another Super Admin, so this control is not offered on your own
                        record.
                      </p>
                    ) : (
                    <div className="flex items-center gap-2">
                      <select
                        value={roleDraft}
                        onChange={(e) => setRoleDraft(e.target.value as Role)}
                        className={`${inputClass} flex-1`}
                        aria-label="Next role"
                      >
                        {ALL_ROLES.map((role) => (
                          <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                        ))}
                      </select>
                      <button
                        onClick={handleRoleChange}
                        disabled={pending || roleDraft === viewUser.role}
                        className="px-3.5 py-2 rounded-xl bg-[#F59A16] text-white text-xs font-bold disabled:opacity-50"
                      >
                        Apply
                      </button>
                    </div>
                    )}
                  </div>
                )}

                {maySuspend && (
                  <div className="p-4 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Change account state</p>
                    {legalStatuses.length === 0 ? (
                      <p className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
                        No further transition is allowed from {ACCOUNT_STATUS_LABELS[viewUser.status]}.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <select
                          value={statusDraft}
                          onChange={(e) => setStatusDraft(e.target.value as AccountStatus)}
                          className={`${inputClass} flex-1`}
                          aria-label="Next account state"
                        >
                          <option value="" disabled>Choose a new state…</option>
                          {legalStatuses.map((s) => (
                            <option key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleStatusChange}
                          disabled={pending || !statusDraft}
                          className="px-3.5 py-2 rounded-xl bg-[#123B60] text-white text-xs font-bold disabled:opacity-50"
                        >
                          Apply
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </ModalShell>

    </div>
  );
};
