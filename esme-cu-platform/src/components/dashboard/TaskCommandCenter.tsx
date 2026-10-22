import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckSquare,
  Plus,
  Search,
  Calendar,
  Award,
  Upload,
  X,
  Play,
  Ban,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor } from '../../domain/roles';
import { canMoveTask, selfServiceMoves } from '../../domain/workflow';
import { useStickyNonNull, ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import { DataTable, type DataTableAction } from './DataTable';
import type { Task, TaskStatus } from '../../types';

const MOVE_LABELS: Partial<Record<TaskStatus, string>> = {
  in_progress: 'Start work',
  cancelled: 'Cancel task',
};

/** Ascending by this rank puts the most urgent work on top. */
const PRIORITY_RANK: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export const TaskCommandCenter: React.FC = () => {
  const { tasks, committees, users, addTask, moveTask, reviewTask, addSubmission, can } = useApp();
  const currentUser = useActor();
  
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');
  const [searchTerm, setSearchTerm] = useState('');
  const [committeeFilter, setCommitteeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { toast } = useToast();
  const [selectedTaskForSubmission, setSelectedTaskForSubmission] = useState<Task | null>(null);

  // New task form state. The start date is filled when the modal opens, not while this
  // component renders, so the clock is only read on an explicit user action.
  const blankTask = () => ({
    title: '',
    description: '',
    committeeId: '',
    assigneeIds: [] as string[],
    priority: 'medium' as Task['priority'],
    points: 100,
    startDate: '',
    deadline: '',
    acceptanceCriteria: '',
    category: 'Technical Workshop'
  });
  const [newTask, setNewTask] = useState(blankTask);

  // Submission form state
  const [submissionDesc, setSubmissionDesc] = useState('');
  const [submissionLinks, setSubmissionLinks] = useState('');

  const canCreateTask = can('tasks.write');
  const maySubmit = can('submissions.create');
  const taskScope = scopeFor(currentUser.role, 'tasks.read');

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesComm = committeeFilter === 'all' || t.committeeId === committeeFilter;
    const matchesPrio = priorityFilter === 'all' || t.priority === priorityFilter;

    // Visibility follows the scope the provider grants for tasks.read.
    if (taskScope === 'self') return matchesSearch && matchesComm && matchesPrio && t.assigneeIds.includes(currentUser.id);
    if (taskScope === 'committee') {
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
    const draft = newTask;

    try {
      const comm = committees.find((c) => c.id === draft.committeeId);
      if (!comm) throw new Error('Choose the committee that owns this task before saving.');
      const assignees = users.filter((u) => draft.assigneeIds.includes(u.id));

      addTask({
        title: draft.title,
        description: draft.description,
        committeeId: draft.committeeId,
        committeeName: comm.name,
        assigneeIds: draft.assigneeIds,
        assigneeNames: assignees.map(a => a.name),
        createdById: currentUser.id,
        createdByName: currentUser.name,
        priority: draft.priority,
        points: Number(draft.points),
        startDate: draft.startDate,
        deadline: draft.deadline,
        status: 'assigned',
        acceptanceCriteria: draft.acceptanceCriteria.split('\n').filter(c => c.trim()),
        category: draft.category
      });

      toast(`Task "${draft.title}" created`);
      setIsCreateModalOpen(false);
      setNewTask(blankTask());
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The task was refused.', 'error');
    }
  };

  const openCreateModal = () => {
    setNewTask({ ...blankTask(), startDate: new Date().toISOString().split('T')[0] });
    setIsCreateModalOpen(true);
  };

  // Only an assignee moves a task, and only along the states the delivery flow leaves open.
  const movesFor = (task: Task) =>
    task.assigneeIds.includes(currentUser.id) ? selfServiceMoves(task.status) : [];

  const handleMove = (task: Task, to: TaskStatus) => {
    try {
      moveTask(task.id, to);
      toast(`"${task.title}" is now ${to.replace('_', ' ')}.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That move was refused.', 'error');
    }
  };

  type BoardReviewMove = 'under_review' | 'revision_requested' | 'rejected';
  const [reviewMove, setReviewMove] = useState<{ task: Task; to: BoardReviewMove } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  // Board-side review moves only. Approving happens in the review centre, where the rubric runs.
  const mayReviewTask = (task: Task) =>
    can('submissions.review', { committeeId: task.committeeId }) &&
    (task.status === 'submitted' || task.status === 'under_review');

  const openReviewMove = (task: Task, to: BoardReviewMove) => {
    setReviewMove({ task, to });
    setReviewNote('');
  };

  const confirmReviewMove = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewMove) return;
    try {
      reviewTask(reviewMove.task.id, reviewMove.to, reviewNote);
      toast(`"${reviewMove.task.title}" is now ${reviewMove.to.replace(/_/g, ' ')}.`, 'success');
      setReviewMove(null);
      setReviewNote('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'That decision was not recorded.', 'error');
    }
  };

  const viewReviewMove = useStickyNonNull(reviewMove);
  const viewTask = useStickyNonNull(selectedTaskForSubmission);

  const noTasksState = {
    title: 'No tasks recorded',
    description:
      'Nothing appears because no task rows exist within your scope. History is never simulated to fill a board — create the first task with the button above, or connect the backend that stores them.',
    icon: CheckSquare,
  };

  /**
   * What one row offers: the reviewer's decisions, the assignee's own moves and a submission
   * portal — the same set the board shows, derived from the delivery flow rather than the view.
   */
  const rowActionsFor = (task: Task): DataTableAction<Task>[] => [
    ...(mayReviewTask(task) && task.status === 'submitted'
      ? [
          {
            key: 'review',
            label: 'Take into review',
            icon: Eye,
            showLabel: true,
            onClick: () => openReviewMove(task, 'under_review'),
          } as DataTableAction<Task>,
        ]
      : []),
    ...(mayReviewTask(task)
      ? [
          {
            key: 'revision',
            label: 'Return for revision',
            icon: RotateCcw,
            showLabel: true,
            onClick: () => openReviewMove(task, 'revision_requested'),
          } as DataTableAction<Task>,
          {
            key: 'reject',
            label: 'Reject',
            icon: Ban,
            showLabel: true,
            danger: true,
            onClick: () => openReviewMove(task, 'rejected'),
          } as DataTableAction<Task>,
        ]
      : []),
    ...movesFor(task).map(
      (to) =>
        ({
          key: `move:${to}`,
          label: MOVE_LABELS[to] ?? to.replace('_', ' '),
          icon: to === 'in_progress' ? Play : Ban,
          showLabel: true,
          danger: to === 'cancelled',
          confirm:
            to === 'cancelled'
              ? {
                  title: 'Cancel this task?',
                  confirmLabel: 'Cancel task',
                  body: (t: Task) =>
                    `"${t.title}" leaves the pipeline and stops counting toward deadlines. Assignees and the point value stay on the record, and the decision is audited.`,
                }
              : undefined,
          onClick: () => handleMove(task, to),
        }) as DataTableAction<Task>
    ),
    ...(maySubmit && canMoveTask(task.status, 'submitted')
      ? [
          {
            key: 'submit',
            label: 'Submit work',
            icon: Upload,
            showLabel: true,
            onClick: () => setSelectedTaskForSubmission(task),
          } as DataTableAction<Task>,
        ]
      : []),
  ];

  const handleSubmitDeliverable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskForSubmission) return;

    const task = selectedTaskForSubmission;
    const description = submissionDesc;
    const links = submissionLinks.split('\n').map(l => l.trim()).filter(Boolean);

    try {
      addSubmission({
        taskId: task.id,
        taskTitle: task.title,
        committeeId: task.committeeId,
        committeeName: task.committeeName,
        memberId: currentUser.id,
        memberName: currentUser.name,
        description,
        externalLinks: links,
        proposedPoints: task.points
      });
      toast('Deliverable submitted for review');
      setSelectedTaskForSubmission(null);
      setSubmissionDesc('');
      setSubmissionLinks('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The submission was refused.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Task Command & Delivery Center</h1>
          <p className="text-xs text-slate-500">
            {taskScope === 'self'
              ? 'Your assigned workflows, deadlines, and deliverable submission portal.'
              : 'Assign committee deliverables, set point values, track status pipelines, and inspect deadlines.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* View toggle */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 flex">
            {(['board', 'table'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`relative px-3 py-1 rounded-lg text-xs font-bold ${
                  viewMode === mode ? 'text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {viewMode === mode && (
                  <motion.span
                    layoutId="task-view-pill"
                    className="absolute inset-0 bg-[#123B60] rounded-lg"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{mode === 'board' ? 'Kanban' : 'Table'}</span>
              </button>
            ))}
          </div>

          {canCreateTask && (
            <button
              onClick={openCreateModal}
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
      {tasks.length === 0 ? (
        <EmptyState {...noTasksState} />
      ) : viewMode === 'board' ? (
        <motion.div
          key="board"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 overflow-x-auto pb-4"
        >
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
                      className="bg-white dark:bg-slate-900 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-[#123B60]/30 transition-all duration-200 space-y-2.5"
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

                      {mayReviewTask(t) && (
                        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                          <div className="flex flex-wrap gap-1.5">
                            {t.status === 'submitted' && (
                              <button
                                onClick={() => openReviewMove(t, 'under_review')}
                                className="px-2 py-1 rounded-lg border border-purple-300 text-purple-700 dark:text-purple-300 text-[10px] font-bold hover:bg-purple-50 dark:hover:bg-purple-950/30"
                              >
                                Take into review
                              </button>
                            )}
                            <button
                              onClick={() => openReviewMove(t, 'revision_requested')}
                              className="px-2 py-1 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-400 text-[10px] font-bold hover:bg-amber-50 dark:hover:bg-amber-950/20"
                            >
                              Return for revision
                            </button>
                            <button
                              onClick={() => openReviewMove(t, 'rejected')}
                              className="px-2 py-1 rounded-lg border border-red-300 text-red-700 dark:text-red-400 text-[10px] font-bold hover:bg-red-50 dark:hover:bg-red-950/20"
                            >
                              Reject
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            Approval is recorded in the Review Centre, where the rubric and the independent-reviewer
                            check run.
                          </p>
                        </div>
                      )}

                      {movesFor(t).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {movesFor(t).map((to) => (
                            <button
                              key={to}
                              onClick={() => handleMove(t, to)}
                              className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 border ${
                                to === 'in_progress'
                                  ? 'border-indigo-300 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                                  : 'border-slate-300 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              {to === 'in_progress' ? <Play className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                              {MOVE_LABELS[to] ?? to}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Submit deliverable — needs the submission capability and a task the flow lets you file against */}
                      {maySubmit && canMoveTask(t.status, 'submitted') && (
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
        </motion.div>
      ) : (
        /* Table View — the same records, the same decisions, in rows. */
        <motion.div
          key="table"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <DataTable
            rows={filteredTasks}
            rowKey={(t) => t.id}
            noMatchesLabel="No task matches this search and these filters."
            empty={noTasksState}
            columns={[
              {
                key: 'task',
                label: 'Task',
                cardTitle: true,
                sortValue: (t) => t.title,
                render: (t) => (
                  <>
                    <div className="font-bold text-slate-800 dark:text-slate-100">{t.title}</div>
                    <div className="text-[11px] text-slate-400 line-clamp-1">{t.description}</div>
                  </>
                ),
              },
              {
                key: 'committee',
                label: 'Committee',
                sortValue: (t) => t.committeeName,
                render: (t) => <span className="text-slate-600 dark:text-slate-300">{t.committeeName}</span>,
              },
              {
                key: 'priority',
                label: 'Priority',
                sortValue: (t) => PRIORITY_RANK[t.priority],
                render: (t) => (
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-slate-100 dark:bg-slate-800">
                    {t.priority}
                  </span>
                ),
              },
              {
                key: 'points',
                label: 'Points',
                align: 'center',
                sortValue: (t) => t.points,
                render: (t) => <span className="font-bold text-[#F59A16]">{t.points} pts</span>,
              },
              {
                key: 'deadline',
                label: 'Deadline',
                sortValue: (t) => t.deadline,
                render: (t) => <span className="text-slate-500">{t.deadline}</span>,
              },
              {
                key: 'status',
                label: 'Status',
                sortValue: (t) => t.status.replace('_', ' '),
                render: (t) => (
                  <span className="text-[10px] px-2.5 py-1 rounded-full font-bold uppercase bg-blue-100 text-blue-700">
                    {t.status.replace('_', ' ')}
                  </span>
                ),
              },
            ]}
            actions={rowActionsFor}
          />
        </motion.div>
      )}

      {/* Create Task Modal */}
      <ModalShell open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
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
                    onChange={(e) => setNewTask({ ...newTask, committeeId: e.target.value, assigneeIds: [] })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="" disabled>
                      {committees.length === 0 ? 'No committees stored yet' : 'Choose a committee...'}
                    </option>
                    {committees.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {committees.length === 0 && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      A task must belong to a committee. Create one in Committees & Sectors first.
                    </p>
                  )}
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
                  {users.filter(u => u.committeeId === newTask.committeeId).length === 0 ? (
                    <p className="text-[11px] text-slate-400 p-1">
                      {newTask.committeeId
                        ? 'No members are attached to this committee yet. You can still save the task and assign later.'
                        : 'Pick a committee to list its members.'}
                    </p>
                  ) : (
                    users.filter(u => u.committeeId === newTask.committeeId).map((u) => (
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
                  ))
                  )}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Acceptance Criteria (1 per line)</label>
                <textarea
                  rows={2}
                  value={newTask.acceptanceCriteria}
                  onChange={(e) => setNewTask({ ...newTask, acceptanceCriteria: e.target.value })}
                  placeholder="What must be true before this counts as done..."
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
      </ModalShell>

      {/* Submit Work Modal */}
      <ModalShell open={!!selectedTaskForSubmission} onClose={() => setSelectedTaskForSubmission(null)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
          {viewTask && (
          <>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Submit Task Deliverables</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">{viewTask.title}</p>
              </div>
              <button onClick={() => setSelectedTaskForSubmission(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitDeliverable} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl text-amber-800 dark:text-amber-200">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <Award className="w-3.5 h-3.5 text-[#F59A16]" />
                  Potential Reward: {viewTask.points} Points
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
          </>
          )}
      </ModalShell>

      {/* Board-side review move: a claim, a return or a rejection. Never an approval. */}
      <ModalShell open={!!reviewMove} onClose={() => setReviewMove(null)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-md w-full shadow-2xl">
        {viewReviewMove && (
          <form onSubmit={confirmReviewMove} className="space-y-4 text-xs">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white capitalize">
                {viewReviewMove.to.replace(/_/g, ' ')}
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">{viewReviewMove.task.title}</p>
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="board-review-note">
                {viewReviewMove.to === 'revision_requested' ? 'What must change (required)' : 'Note on this decision'}
              </label>
              <textarea
                id="board-review-note"
                rows={3}
                required={viewReviewMove.to === 'revision_requested'}
                minLength={viewReviewMove.to === 'revision_requested' ? 15 : undefined}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={
                  viewReviewMove.to === 'revision_requested'
                    ? 'Name the missing evidence or the defect to fix...'
                    : 'Optional context for the audit trail...'
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
              />
            </div>
            {viewReviewMove.to !== 'revision_requested' && (
              <p className="text-[11px] text-slate-400">
                This records your name and the decision in the audit trail. It awards no points — an approval with a
                rubric is made in the Review Centre.
              </p>
            )}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setReviewMove(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
              >
                Cancel
              </button>
              <button type="submit" className="px-5 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white font-bold rounded-xl">
                Record decision
              </button>
            </div>
          </form>
        )}
      </ModalShell>

    </div>
  );
};
