import React, { useState } from 'react';
import {
  Users,
  Search,
  UserPlus,
  Mail,
  X,
  Edit3,
  Trash2,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { useStickyNonNull, ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import { ALL_ROLES, ROLE_LABELS } from '../../domain/roles';
import { ACCOUNT_STATUS_LABELS, ACCOUNT_STATUSES, canTransition, type AccountStatus } from '../../domain/accountState';
import type { Role, User } from '../../types';

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]';

const labelClass = 'block font-bold text-slate-700 dark:text-slate-300 mb-1';

const STATUS_STYLES: Record<AccountStatus, string> = {
  pending_email_verification: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900',
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
  department: 'Metallurgical & Materials Engineering',
  academicYear: 'Sophomore',
  phone: '',
};

export const MemberManagement: React.FC = () => {
  const {
    users,
    committees,
    can,
    addUser,
    updateUser,
    assignRole,
    setAccountStatus,
    deleteUser
  } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCommitteeFilter, setSelectedCommitteeFilter] = useState('all');
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<'all' | Role>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUser, setNewUser] = useState({ ...BLANK_MEMBER, role: 'member' as Role });
  const [roleDraft, setRoleDraft] = useState<Role>(currentUser.role);
  const [statusDraft, setStatusDraft] = useState<AccountStatus>('active');
  const [pending, setPending] = useState(false);

  const mayCreate = can('users.create');
  const mayUpdate = can('users.update');
  const mayAssignRoles = can('users.role.assign');
  const maySuspend = can('users.suspend');
  const mayDelete = can('users.delete');

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.username.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCommittee = selectedCommitteeFilter === 'all' || u.committeeId === selectedCommitteeFilter;
    const matchesRole = selectedRoleFilter === 'all' || u.role === selectedRoleFilter;
    return matchesSearch && matchesCommittee && matchesRole;
  });

  const openEdit = (user: User) => {
    setEditingUser(user);
    setRoleDraft(user.role);
    setStatusDraft(user.status);
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
    runPrivileged(`Provisioned ${newUser.name}. The account starts pending approval.`, () => {
      addUser({
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
    if (!editingUser || statusDraft === editingUser.status) return;
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
            {users.length > 0
              ? `${users.length} account${users.length === 1 ? '' : 's'} visible to you. Roles and account states are set by the provider, never typed in here.`
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

      {users.length === 0 && (
        <EmptyState
          icon={Users}
          title="No member accounts yet"
          description="This directory reads from your authentication provider. Until that provider is configured and returns profiles, there is nothing to list — no sample members are inserted to fill the space."
          action={mayCreate ? (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 bg-[#123B60] text-white text-xs font-bold rounded-xl"
            >
              Provision the first account
            </button>
          ) : undefined}
        />
      )}

      {users.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search by name, email, or username..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedCommitteeFilter}
              onChange={(e) => setSelectedCommitteeFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
            >
              <option value="all">All Committees</option>
              {committees.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <select
              value={selectedRoleFilter}
              onChange={(e) => setSelectedRoleFilter(e.target.value as 'all' | Role)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
            >
              <option value="all">All Roles</option>
              {ALL_ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {filteredUsers.length === 0 && users.length > 0 && (
        <p className="text-xs text-slate-500 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-6 text-center">
          No accounts match this search and these filters.
        </p>
      )}

      {/* Members Table */}
      {filteredUsers.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Member Name</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Committee & Sub-team</th>
                  <th className="py-3 px-4">Academic Year</th>
                  <th className="py-3 px-4 text-center">Points</th>
                  <th className="py-3 px-4 text-center">Approved Tasks</th>
                  <th className="py-3 px-4">Account State</th>
                  {(mayUpdate || mayDelete) && <th className="py-3 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map((u) => {
                  const comm = committees.find((c) => c.id === u.committeeId);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#123B60] text-white flex items-center justify-center font-bold text-xs shrink-0">
                            {u.name.split(' ').map((n) => n[0]).join('')}
                          </div>
                          <div>
                            <div className="font-bold text-slate-800 dark:text-slate-100">{u.name}</div>
                            <div className="text-[11px] text-slate-400">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {ROLE_LABELS[u.role] ?? u.role}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-700 dark:text-slate-300">{comm ? comm.name : '—'}</div>
                        {u.subTeam && <div className="text-[10px] text-slate-400">{u.subTeam}</div>}
                      </td>

                      <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400">
                        <div>{u.academicYear || '—'}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{u.department}</div>
                      </td>

                      <td className="py-3.5 px-4 text-center font-bold text-[#F59A16]">
                        {u.totalPoints}
                      </td>

                      <td className="py-3.5 px-4 text-center font-semibold text-slate-700 dark:text-slate-300">
                        {u.approvedTasksCount}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[u.status]}`}>
                          {ACCOUNT_STATUS_LABELS[u.status]}
                        </span>
                      </td>

                      {(mayUpdate || mayDelete) && (
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {mayUpdate && (
                              <button
                                onClick={() => openEdit(u)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                                title="Open record"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {mayDelete && u.id !== currentUser.id && u.role !== 'super_admin' && (
                              <button
                                onClick={() => {
                                  if (confirm(`Remove ${u.name} from this device's directory? Deleting an identity is done on the provider.`)) {
                                    runPrivileged('Removed from the local directory.', () => deleteUser(u.id));
                                  }
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
                                title="Remove from directory"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
            This creates a profile record. It does not set a password and does not grant access: the account starts as
            <strong> pending approval</strong> and only reaches <strong>active</strong> after the email is confirmed
            and an approval decision is recorded.
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
              <input
                id="member-year"
                type="text"
                value={newUser.academicYear}
                onChange={(e) => setNewUser({ ...newUser, academicYear: e.target.value })}
                className={inputClass}
              />
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
              {viewUser.emailVerified ? (
                <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                  <ShieldCheck className="w-3 h-3" aria-hidden /> email verified
                </span>
              ) : (
                <span className="font-semibold">email not verified</span>
              )}
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
                  <input
                    id="edit-year"
                    type="text"
                    value={viewUser.academicYear || ''}
                    onChange={(e) => patchUser({ academicYear: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="edit-department">Department</label>
                <input
                  id="edit-department"
                  type="text"
                  value={viewUser.department || ''}
                  onChange={(e) => patchUser({ department: e.target.value })}
                  className={inputClass}
                />
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
                          {legalStatuses.map((s) => (
                            <option key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleStatusChange}
                          disabled={pending}
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
