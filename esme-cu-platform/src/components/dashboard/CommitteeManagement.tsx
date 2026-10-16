import React, { useMemo, useState } from 'react';
import { Plus, Search, Eye, EyeOff, Edit3, Archive, X, Target, Building2 } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { useStickyNonNull, ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import type { Committee } from '../../types';

export const CommitteeManagement: React.FC = () => {
  const { committees, users, addCommittee, updateCommittee, archiveCommittee, can } = useApp();
  const currentUser = useActor();

  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { toast } = useToast();
  const [editingComm, setEditingComm] = useState<Committee | null>(null);

  const [newComm, setNewComm] = useState({
    name: '',
    shortCode: '',
    description: '',
    directorId: '',
    headId: '',
    objectives: '',
    subTeams: '',
    isPublic: true,
    status: 'active' as const,
    category: 'technical' as const
  });

  const filteredCommittees = useMemo(
    () =>
      committees.filter(
        (c) =>
          c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          c.shortCode.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [committees, searchTerm]
  );

  /** Counted from real memberships every render — never typed in and never stored on the row. */
  const rosterCounts = useMemo(() => {
    const counts = new Map<string, { active: number; pending: number }>();
    for (const u of users) {
      if (!u.committeeId) continue;
      const current = counts.get(u.committeeId) ?? { active: 0, pending: 0 };
      if (u.status === 'active') current.active += 1;
      else current.pending += 1;
      counts.set(u.committeeId, current);
    }
    return counts;
  }, [users]);

  const runWrite = (label: string, operation: () => void) => {
    try {
      operation();
      toast(label, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That change was refused.', 'error');
    }
  };

  const handleCreateCommittee = (e: React.FormEvent) => {
    e.preventDefault();
    const director = users.find(u => u.id === newComm.directorId);
    const head = users.find(u => u.id === newComm.headId);

    runWrite(`Committee "${newComm.name}" created`, () =>
      addCommittee({
        name: newComm.name,
        shortCode: newComm.shortCode.toUpperCase(),
        description: newComm.description,
        directorId: newComm.directorId || undefined,
        directorName: director?.name,
        headId: newComm.headId || undefined,
        headName: head?.name,
        objectives: newComm.objectives.split('\n').filter(o => o.trim()),
        subTeams: newComm.subTeams.split(',').map(s => s.trim()).filter(Boolean),
        isPublic: newComm.isPublic,
        status: newComm.status,
        category: newComm.category
      })
    );

    setIsCreateModalOpen(false);
    setNewComm({
      name: '',
      shortCode: '',
      description: '',
      directorId: '',
      headId: '',
      objectives: '',
      subTeams: '',
      isPublic: true,
      status: 'active',
      category: 'technical'
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingComm) return;
    const director = users.find(u => u.id === editingComm.directorId);
    const head = users.find(u => u.id === editingComm.headId);

    runWrite('Committee updated', () =>
      updateCommittee(editingComm.id, {
        name: editingComm.name,
        shortCode: editingComm.shortCode,
        description: editingComm.description,
        directorId: editingComm.directorId,
        directorName: director?.name,
        headId: editingComm.headId,
        headName: head?.name,
        isPublic: editingComm.isPublic,
        status: editingComm.status
      })
    );
    setEditingComm(null);
  };

  const viewComm = useStickyNonNull(editingComm);

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Committees &amp; Sectors Manager</h1>
          <p className="text-xs text-slate-500">
            {committees.length} committee{committees.length === 1 ? '' : 's'} configured •{' '}
            {can('committees.write')
              ? currentUser.committeeId
                ? 'you may edit the committee you belong to'
                : 'you may edit committee settings'
              : 'read-only for your role'}
            .
          </p>
        </div>

        {can('committees.write') && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Create Committee
          </button>
        )}
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search committees by name or acronym (e.g. T&E, M&C)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
          />
        </div>
      </div>

      {/* Committee Cards Grid */}
      {committees.length === 0 ? (
        <EmptyState
          title="No committees are configured"
          description="Committee definitions are reference content: with none saved, this page is empty and the public website shows no committee structure. An administrator creates the first one."
          icon={Building2}
          action={
            can('committees.write') ? (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="px-4 py-2 bg-[#123B60] text-white text-xs font-bold rounded-xl"
              >
                Create the first committee
              </button>
            ) : undefined
          }
        />
      ) : filteredCommittees.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-400">
          {committees.length} committee{committees.length === 1 ? '' : 's'} exist, but none match “{searchTerm}”.
        </p>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredCommittees.map((comm) => {
          const roster = rosterCounts.get(comm.id) ?? { active: 0, pending: 0 };
          const mayEditThis = can('committees.write', { committeeId: comm.id });
          const mayArchiveThis = can('committees.archive', { committeeId: comm.id });
          return (
            <div 
              key={comm.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 bg-[#123B60] text-white font-black text-xs rounded-lg">
                      {comm.shortCode}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase text-slate-700 dark:text-slate-200 ${
                      comm.status === 'active' ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-slate-100 dark:bg-slate-800'
                    }`}>
                      {comm.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {mayEditThis && (
                      <button
                        onClick={() =>
                          runWrite(
                            comm.isPublic ? `${comm.shortCode} hidden from the public site` : `${comm.shortCode} shown on the public site`,
                            () => updateCommittee(comm.id, { isPublic: !comm.isPublic })
                          )
                        }
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                        title={comm.isPublic ? 'Visible on the website draft — click to hide' : 'Hidden — click to show'}
                        aria-label={comm.isPublic ? `Hide ${comm.name} from the public site` : `Show ${comm.name} on the public site`}
                      >
                        {comm.isPublic ? <Eye className="w-4 h-4 text-emerald-600" /> : <EyeOff className="w-4 h-4 text-slate-400" />}
                      </button>
                    )}
                    {mayEditThis && (
                      <button
                        onClick={() => setEditingComm(comm)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label={`Edit ${comm.name}`}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    )}
                    {mayArchiveThis && comm.status === 'active' && (
                      <button
                        onClick={() => runWrite(`${comm.shortCode} archived`, () => archiveCommittee(comm.id))}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        aria-label={`Archive ${comm.name}`}
                        title="Archive this committee"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">{comm.name}</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">{comm.description}</p>

                {/* Leadership Box */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-100 dark:border-slate-800 text-xs mb-4 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Director:</span>
                    <strong className="text-slate-800 dark:text-slate-200">{comm.directorName || 'Unassigned'}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Head:</span>
                    <strong className="text-slate-800 dark:text-slate-200">{comm.headName || 'Unassigned'}</strong>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Members assigned:</span>
                    <strong className="text-[#F59A16] text-right">
                      {roster.active} active
                      {roster.pending > 0 && (
                        <span className="text-slate-400 font-semibold"> • {roster.pending} not yet active</span>
                      )}
                    </strong>
                  </div>
                </div>

                {/* Subteams */}
                <div className="space-y-1.5 mb-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sub-Teams:</span>
                  {comm.subTeams.length === 0 ? (
                    <p className="text-[11px] text-slate-400">None recorded.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {comm.subTeams.map((sub, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px]">
                          {sub}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Objectives */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                  Objectives written for this committee:
                </span>
                {comm.objectives.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    None yet — an administrator records them through Edit.
                  </p>
                ) : (
                  <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
                    {comm.objectives.slice(0, 2).map((obj, i) => (
                      <li key={i} className="flex items-center gap-1.5">
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
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Create Committee Modal */}
      <ModalShell open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Create New Committee</h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCommittee} className="space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Committee Name</label>
                  <input
                    type="text"
                    required
                    value={newComm.name}
                    onChange={(e) => setNewComm({ ...newComm, name: e.target.value })}
                    placeholder="e.g. Human Resources Committee"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Acronym</label>
                  <input
                    type="text"
                    required
                    value={newComm.shortCode}
                    onChange={(e) => setNewComm({ ...newComm, shortCode: e.target.value })}
                    placeholder="HR"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none uppercase font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Description & Scope</label>
                <textarea
                  required
                  rows={2}
                  value={newComm.description}
                  onChange={(e) => setNewComm({ ...newComm, description: e.target.value })}
                  placeholder="Mandate and responsibilities..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Appoint Director</label>
                  <select
                    value={newComm.directorId}
                    onChange={(e) => setNewComm({ ...newComm, directorId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="">Select Director...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Appoint Head</label>
                  <select
                    value={newComm.headId}
                    onChange={(e) => setNewComm({ ...newComm, headId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="">Select Head...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Sub-teams (Comma-separated)</label>
                <input
                  type="text"
                  value={newComm.subTeams}
                  onChange={(e) => setNewComm({ ...newComm, subTeams: e.target.value })}
                  placeholder="e.g. Recruitment, Internal Culture, Member Evaluation"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Objectives (1 per line)</label>
                <textarea
                  rows={2}
                  value={newComm.objectives}
                  onChange={(e) => setNewComm({ ...newComm, objectives: e.target.value })}
                  placeholder="Write the objective this committee is accountable for…"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl"
                >
                  Save Committee
                </button>
              </div>
            </form>
      </ModalShell>

      {/* Edit Committee Modal */}
      <ModalShell open={!!editingComm} onClose={() => setEditingComm(null)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
          {viewComm && (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Edit Committee: {viewComm.name}</h2>
              <button onClick={() => setEditingComm(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdate} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Name</label>
                <input
                  type="text"
                  required
                  value={viewComm.name}
                  onChange={(e) => setEditingComm({ ...viewComm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                  rows={3}
                  value={viewComm.description}
                  onChange={(e) => setEditingComm({ ...viewComm, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Director</label>
                  <select
                    value={viewComm.directorId || ''}
                    onChange={(e) => setEditingComm({ ...viewComm, directorId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="">Unassigned</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Head</label>
                  <select
                    value={viewComm.headId || ''}
                    onChange={(e) => setEditingComm({ ...viewComm, headId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="">Unassigned</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingComm(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#123B60] text-white font-bold rounded-xl"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </>
          )}
      </ModalShell>

    </div>
  );
};
