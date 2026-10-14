import React, { useState } from 'react';
import { 
  CheckSquare, 
  Plus, 
  Search, 
  Filter, 
  Calendar, 
  Award, 
  Clock, 
  AlertCircle, 
  ChevronRight, 
  CheckCircle2, 
  Upload, 
  ExternalLink,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { Task, TaskStatus } from '../../types';

export const TaskCommandCenter: React.FC = () => {
  const { tasks, committees, users, addTask, updateTask, currentUser, addSubmission } = useApp();
  
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');
  const [searchTerm, setSearchTerm] = useState('');
  const [committeeFilter, setCommitteeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTaskForSubmission, setSelectedTaskForSubmission] = useState<Task | null>(null);

  // New task form state
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    committeeId: committees[0]?.id || 'comm_te',
    assigneeIds: [] as string[],
    priority: 'medium' as Task['priority'],
    points: 100,
    startDate: new Date().toISOString().split('T')[0],
    deadline: '',
    acceptanceCriteria: '',
    category: 'Technical Workshop'
  });

  // Submission form state
  const [submissionDesc, setSubmissionDesc] = useState('');
  const [submissionLinks, setSubmissionLinks] = useState('');

  const canCreateTask = currentUser.role === 'super_admin' || currentUser.role === 'director' || currentUser.role === 'head';

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesComm = committeeFilter === 'all' || t.committeeId === committeeFilter;
    const matchesPrio = priorityFilter === 'all' || t.priority === priorityFilter;

    // Role-scoped visibility: Members only see tasks assigned to them or their committee
    if (currentUser.role === 'member') {
      const isAssigned = t.assigneeIds.includes(currentUser.id);
      const isSameComm = t.committeeId === currentUser.committeeId;
      return matchesSearch && matchesComm && matchesPrio && (isAssigned || isSameComm);
    }
    return matchesSearch && matchesComm && matchesPrio;
  });

  const columns: { status: TaskStatus; label: string; color: string }[] = [
    { status: 'assigned', label: 'Assigned', color: 'border-blue-400' },
    { status: 'in_progress', label: 'In Progress', color: 'border-indigo-400' },
    { status: 'submitted', label: 'Submitted', color: 'border-amber-400' },
    { status: 'under_review', label: 'Under Review', color: 'border-purple-400' },
    { status: 'revision_requested', label: 'Revision', color: 'border-orange-400' },
    { status: 'approved', label: 'Approved', color: 'border-emerald-400' }
  ];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const comm = committees.find(c => c.id === newTask.committeeId);
    const assignees = users.filter(u => newTask.assigneeIds.includes(u.id));

    addTask({
      title: newTask.title,
      description: newTask.description,
      committeeId: newTask.committeeId,
      committeeName: comm?.name || 'Committee',
      assigneeIds: newTask.assigneeIds,
      assigneeNames: assignees.map(a => a.name),
      createdById: currentUser.id,
      createdByName: currentUser.name,
      priority: newTask.priority,
      points: Number(newTask.points),
      startDate: newTask.startDate,
      deadline: newTask.deadline,
      status: 'assigned',
      acceptanceCriteria: newTask.acceptanceCriteria.split('\n').filter(c => c.trim()),
      category: newTask.category
    });

    setIsCreateModalOpen(false);
    setNewTask({
      title: '',
      description: '',
      committeeId: committees[0]?.id || 'comm_te',
      assigneeIds: [],
      priority: 'medium',
      points: 100,
      startDate: new Date().toISOString().split('T')[0],
      deadline: '',
      acceptanceCriteria: '',
      category: 'Technical Workshop'
    });
  };

  const handleSubmitDeliverable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskForSubmission) return;

    addSubmission({
      taskId: selectedTaskForSubmission.id,
      taskTitle: selectedTaskForSubmission.title,
      committeeId: selectedTaskForSubmission.committeeId,
      committeeName: selectedTaskForSubmission.committeeName,
      memberId: currentUser.id,
      memberName: currentUser.name,
      description: submissionDesc,
      externalLinks: submissionLinks.split('\n').map(l => l.trim()).filter(Boolean),
      status: 'submitted',
      proposedPoints: selectedTaskForSubmission.points
    });

    setSelectedTaskForSubmission(null);
    setSubmissionDesc('');
    setSubmissionLinks('');
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Task Command & Delivery Center</h1>
          <p className="text-xs text-slate-500">
            {currentUser.role === 'member'
              ? 'Your assigned workflows, deadlines, and deliverable submission portal.'
              : 'Assign committee deliverables, set point values, track status pipelines, and inspect deadlines.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* View toggle */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 flex">
            <button
              onClick={() => setViewMode('board')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                viewMode === 'board' ? 'bg-[#123B60] text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Kanban
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                viewMode === 'table' ? 'bg-[#123B60] text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Table
            </button>
          </div>

          {canCreateTask && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Create Task
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search task title, description, or assignees..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={committeeFilter}
            onChange={(e) => setCommitteeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
          >
            <option value="all">All Committees</option>
            {committees.map((c) => (
              <option key={c.id} value={c.id}>{c.shortCode} - {c.name}</option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Kanban Board View */}
      {viewMode === 'board' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 overflow-x-auto pb-4">
          {columns.map((col) => {
            const colTasks = filteredTasks.filter(t => t.status === col.status);
            return (
              <div 
                key={col.status}
                className="bg-slate-100/60 dark:bg-slate-900/40 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 flex flex-col min-w-[240px]"
              >
                {/* Column Header */}
                <div className={`flex items-center justify-between pb-2 border-b-2 ${col.color} mb-3`}>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{col.label}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-extrabold shadow-xs">
                    {colTasks.length}
                  </span>
                </div>

                {/* Task Cards */}
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-md transition space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-bold text-[#123B60] dark:text-[#F59A16]">
                          {t.committeeName.split(' ')[0]}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                          t.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                          t.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {t.priority}
                        </span>
                      </div>

                      <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2">
                        {t.title}
                      </h2>

                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                        {t.description}
                      </p>

                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-[#F59A16]" />
                          <span>{t.deadline}</span>
                        </div>
                        <div className="flex items-center gap-1 font-bold text-[#F59A16]">
                          <Award className="w-3 h-3" />
                          <span>{t.points} pts</span>
                        </div>
                      </div>

                      {/* Submit deliverable button for members */}
                      {t.status !== 'approved' && (
                        <button
                          onClick={() => setSelectedTaskForSubmission(t)}
                          className="w-full mt-2 py-1.5 rounded-lg bg-[#123B60] hover:bg-[#0A2239] text-white text-[11px] font-bold transition flex items-center justify-center gap-1.5"
                        >
                          <Upload className="w-3 h-3" />
                          Submit Work
                        </button>
                      )}
                    </div>
                  ))}
                  {colTasks.length === 0 && (
                    <div className="text-center py-8 text-[11px] text-slate-400 italic">
                      No tasks
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
              <tr>
                <th className="py-3 px-4">Task</th>
                <th className="py-3 px-4">Committee</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Points</th>
                <th className="py-3 px-4">Deadline</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredTasks.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-800 dark:text-slate-100">{t.title}</div>
                    <div className="text-[11px] text-slate-400 line-clamp-1">{t.description}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{t.committeeName}</td>
                  <td className="py-3 px-4">
                    <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-100 dark:bg-slate-800">
                      {t.priority}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-bold text-[#F59A16]">{t.points} pts</td>
                  <td className="py-3 px-4 text-slate-500">{t.deadline}</td>
                  <td className="py-3 px-4">
                    <span className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase bg-blue-100 text-blue-700">
                      {t.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setSelectedTaskForSubmission(t)}
                      className="px-3 py-1 bg-[#123B60] text-white rounded-lg text-xs font-semibold"
                    >
                      Submit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Task Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Create New Organization Task</h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  placeholder="e.g. Ultrasonic Testing Workshop Curriculum & Sourcing"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Description</label>
                <textarea
                  required
                  rows={2}
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  placeholder="Task mandate, context, and expected output..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Responsible Committee</label>
                  <select
                    value={newTask.committeeId}
                    onChange={(e) => setNewTask({ ...newTask, committeeId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    {committees.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Priority</label>
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Point Value</label>
                  <input
                    type="number"
                    required
                    min={10}
                    max={500}
                    value={newTask.points}
                    onChange={(e) => setNewTask({ ...newTask, points: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none font-bold text-[#F59A16]"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Deadline</label>
                  <input
                    type="date"
                    required
                    value={newTask.deadline}
                    onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Assign Members</label>
                <div className="max-h-28 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl p-2 space-y-1">
                  {users.filter(u => u.committeeId === newTask.committeeId).map((u) => (
                    <label key={u.id} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={newTask.assigneeIds.includes(u.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewTask({ ...newTask, assigneeIds: [...newTask.assigneeIds, u.id] });
                          } else {
                            setNewTask({ ...newTask, assigneeIds: newTask.assigneeIds.filter(id => id !== u.id) });
                          }
                        }}
                        className="rounded text-[#123B60]"
                      />
                      <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">{u.name} ({u.role})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Acceptance Criteria (1 per line)</label>
                <textarea
                  rows={2}
                  value={newTask.acceptanceCriteria}
                  onChange={(e) => setNewTask({ ...newTask, acceptanceCriteria: e.target.value })}
                  placeholder="Minimum 2 certified trainers sourced..."
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
                  Assign Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submit Work Modal */}
      {selectedTaskForSubmission && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Submit Task Deliverables</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{selectedTaskForSubmission.title}</p>
              </div>
              <button onClick={() => setSelectedTaskForSubmission(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitDeliverable} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-amber-800 dark:text-amber-200">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <Award className="w-3.5 h-3.5 text-[#F59A16]" />
                  Potential Reward: {selectedTaskForSubmission.points} Points
                </div>
                <div className="text-[11px]">Points are awarded into the chapter ledger upon director review and approval.</div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Submission Description & Summary</label>
                <textarea
                  required
                  rows={3}
                  value={submissionDesc}
                  onChange={(e) => setSubmissionDesc(e.target.value)}
                  placeholder="Detail the work accomplished, methodology, and key milestones completed..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">External Links / Drive URLs (1 per line)</label>
                <textarea
                  rows={2}
                  value={submissionLinks}
                  onChange={(e) => setSubmissionLinks(e.target.value)}
                  placeholder="https://drive.google.com/folder-or-document..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedTaskForSubmission(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white font-bold rounded-xl flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Submit for Review
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
