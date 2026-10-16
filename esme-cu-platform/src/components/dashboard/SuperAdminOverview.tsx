import React from 'react';
import { motion } from 'motion/react';
import {
  Users,
  Layers,
  CheckSquare,
  FileCheck2,
  UserPlus,
  AlertTriangle,
  Award,
  Target,
  ArrowUpRight,
  Sparkles,
  ChevronRight,
  Plus
} from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import type { DashboardView } from './DashboardShell';
import { AnimatedNumber, MagneticButton, StaggerGroup, StaggerItem, groupItemScale, transitions } from '../../motion';

interface SuperAdminOverviewProps {
  onNavigate: (view: DashboardView) => void;
}

export const SuperAdminOverview: React.FC<SuperAdminOverviewProps> = ({ onNavigate }) => {
  const {
    users,
    committees,
    tasks,
    submissions,
    applications,
    seasonEvents,
    scoreLedger,
    auditLogs,
    can
  } = useApp();
  const currentUser = useActor();

  // Dynamic calculations from initialized state
  const totalMembers = users.length;
  const activeCommittees = committees.filter(c => c.status === 'active').length;
  const activeTasks = tasks.filter(t => t.status === 'assigned' || t.status === 'in_progress').length;
  const pendingSubmissions = submissions.filter(s => s.status === 'submitted' || s.status === 'under_review').length;
  const pendingApplications = applications.filter(a => a.status === 'pending').length;
  const overdueTasks = tasks.filter(t => t.status === 'overdue' || (new Date(t.deadline) < new Date() && t.status !== 'approved')).length;
  const totalPointsDistributed = scoreLedger.reduce((acc, curr) => acc + curr.points, 0);

  // Season KPI completion calculation
  const totalSeasonDeliverables = seasonEvents.length;
  const completedDeliverables = seasonEvents.filter(e => e.status === 'Completed').length;
  const seasonProgressPct = totalSeasonDeliverables === 0
    ? 0
    : Math.round((completedDeliverables / totalSeasonDeliverables) * 100);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const rosterSizeFor = (committeeId: string) => users.filter(u => u.committeeId === committeeId).length;

  const kpiCards: {
    label: string;
    value: number;
    format?: (n: number) => string;
    subtitle: React.ReactNode;
    icon: React.ElementType;
    color: string;
    bg: string;
    actionView: DashboardView;
    capability?: Parameters<typeof can>[0];
  }[] = [
    {
      label: 'Total Chapter Members',
      capability: 'users.read',
      value: totalMembers,
      subtitle: `${users.filter(u => u.status === 'active').length} active in rosters`,
      icon: Users,
      color: 'text-[#123B60] dark:text-[#F59A16]',
      bg: 'bg-[#123B60]/10',
      actionView: 'members'
    },
    {
      label: 'Active Committees',
      value: activeCommittees,
      subtitle: committees.filter(c => c.status === 'active').map(c => c.shortCode).join(', ') || 'No active committees',
      icon: Layers,
      color: 'text-[#F59A16]',
      bg: 'bg-[#F59A16]/10',
      actionView: 'committees'
    },
    {
      label: 'Active Tasks',
      capability: 'tasks.read',
      value: activeTasks,
      subtitle: `${tasks.length} total season tasks`,
      icon: CheckSquare,
      color: 'text-blue-600',
      bg: 'bg-blue-500/10',
      actionView: 'tasks'
    },
    {
      label: 'Pending Submissions',
      capability: 'submissions.read',
      value: pendingSubmissions,
      subtitle: 'Awaiting board review',
      icon: FileCheck2,
      color: 'text-amber-600',
      bg: 'bg-amber-500/10',
      actionView: 'submissions'
    },
    {
      label: 'Pending Applications',
      value: pendingApplications,
      capability: 'registrations.read',
      subtitle: `${applications.length} recruitment entries`,
      icon: UserPlus,
      color: 'text-emerald-600',
      bg: 'bg-emerald-500/10',
      actionView: 'applications'
    },
    {
      label: 'Overdue / Flagged',
      capability: 'tasks.read',
      value: overdueTasks,
      subtitle: 'Requiring leadership intervention',
      icon: AlertTriangle,
      color: 'text-rose-600',
      bg: 'bg-rose-500/10',
      actionView: 'tasks'
    },
    {
      label: 'Points Recorded',
      value: totalPointsDistributed,
      capability: 'scores.read',
      subtitle: `${scoreLedger.length} ledger entries`,
      icon: Award,
      color: 'text-purple-600',
      bg: 'bg-purple-500/10',
      actionView: 'scoring'
    },
    {
      label: 'Season 26–27 Progress',
      value: seasonProgressPct,
      format: (n) => `${Math.round(n)}%`,
      subtitle: `${completedDeliverables} of ${totalSeasonDeliverables} milestones completed`,
      icon: Target,
      color: 'text-teal-600',
      bg: 'bg-teal-500/10',
      actionView: 'season_planner'
    }
  ];

  const visibleKpiCards = kpiCards.filter((card) => card.capability === undefined || can(card.capability));

  return (
    <div className="space-y-8">

      {/* Welcome Banner */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="bg-gradient-to-r from-[#123B60] via-[#0E2F4D] to-[#0A2239] rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-white/10"
      >
        <div className="absolute inset-0 bg-grid-pattern-dark opacity-10 pointer-events-none"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[#F59A16] text-xs font-bold border border-white/15">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Season 2026–2027 Command Center</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              {greeting}, {currentUser.name}
            </h1>
            <p className="text-xs sm:text-sm text-slate-200 max-w-2xl leading-relaxed">
              Your ESME command center. Monitor performance, review submissions, manage your committees, and keep the chapter moving forward.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {can('tasks.write') && (
            <MagneticButton
              onClick={() => onNavigate('tasks')}
              strength={0.2}
              className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Task
            </MagneticButton>
            )}
            {can('submissions.review') && (
            <motion.button
              onClick={() => onNavigate('submissions')}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl border border-white/20 flex items-center gap-1.5 backdrop-blur-sm"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={transitions.micro}
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              Review Submissions
            </motion.button>
            )}
            {can('cms.content.write') && (
            <motion.button
              onClick={() => onNavigate('website_cms')}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl border border-white/20 flex items-center gap-1.5 backdrop-blur-sm"
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={transitions.micro}
            >
              Edit Website
            </motion.button>
            )}
          </div>
        </div>
      </motion.div>

      {/* KPI Metric Cards Grid */}
      <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" step={0.06} amount={0.1}>
        {visibleKpiCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <StaggerItem key={idx} variants={groupItemScale} className="h-full">
              <motion.div
                onClick={() => onNavigate(card.actionView)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(card.actionView); } }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                transition={transitions.standard}
                className="group/card bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:shadow-md hover:border-[#123B60]/30 transition-[box-shadow,border-color] cursor-pointer flex flex-col justify-between h-full focus-visible:outline-2 focus-visible:outline-[#F59A16]"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{card.label}</span>
                  <div className={`w-8 h-8 rounded-xl ${card.bg} ${card.color} flex items-center justify-center`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                    <AnimatedNumber value={card.value} format={card.format} startOnView />
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>{card.subtitle}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 opacity-60 transition-transform duration-200 group-hover/card:translate-x-0.5 group-hover/card:-translate-y-0.5" />
                  </div>
                </div>
              </motion.div>
            </StaggerItem>
          );
        })}
      </StaggerGroup>

      {/* Two-Column Middle Section: Workflows & Submissions Pending */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Urgent Review Queue */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Submission Queue</h2>
              <p className="text-[11px] text-slate-400">Work submitted by members requiring approval & point scoring</p>
            </div>
            <motion.button
              onClick={() => onNavigate('submissions')}
              className="text-xs text-[#F59A16] font-bold hover:underline flex items-center gap-1"
              whileHover={{ x: 2 }}
              transition={transitions.micro}
            >
              View all ({submissions.length})
              <ChevronRight className="w-3.5 h-3.5" />
            </motion.button>
          </div>

          {submissions.length === 0 && (
            <p className="text-[11px] text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 px-4 py-6 text-center">
              Nothing is waiting for review. Submissions appear here as soon as members file work against a task.
            </p>
          )}
          <StaggerGroup className="space-y-3" step={0.07} amount={0.1}>
            {submissions.slice(0, 4).map((sub) => (
              <StaggerItem key={sub.id}>
                <motion.div
                  onClick={() => onNavigate('submissions')}
                  whileHover={{ x: 4 }}
                  transition={transitions.micro}
                  className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">{sub.taskTitle}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
                      <span>{sub.memberName}</span>
                      <span>•</span>
                      <span>{sub.committeeName}</span>
                      <span>•</span>
                      <span className="text-[#F59A16] font-semibold">{sub.proposedPoints} pts</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                      sub.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700'
                        : sub.status === 'revision_requested'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                    }`}>
                      {sub.status.replace('_', ' ')}
                    </span>
                  </div>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </motion.div>

        {/* Committee Status Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Committees Roster</h2>
              <p className="text-[11px] text-slate-400">
                {committees.length} committee{committees.length === 1 ? '' : 's'} in the organizational structure
              </p>
            </div>
            <button
              onClick={() => onNavigate('committees')}
              className="text-xs text-[#F59A16] font-bold hover:underline"
            >
              Manage
            </button>
          </div>

          <StaggerGroup className="space-y-3" step={0.06} amount={0.1}>
            {committees.length === 0 && (
              <p className="text-[11px] text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 px-4 py-6 text-center">
                No committees are defined yet.
              </p>
            )}
            {committees.map((comm) => (
              <StaggerItem key={comm.id}>
                <motion.div
                  onClick={() => onNavigate('committees')}
                  whileHover={{ x: 3, scale: 1.005 }}
                  transition={transitions.micro}
                  className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-[#123B60]/30 transition-colors text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-xl bg-[#123B60] text-white flex items-center justify-center font-bold text-[10px]">
                      {comm.shortCode}
                    </span>
                    <div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{comm.name}</div>
                      <div className="text-[10px] text-slate-400">{comm.directorName ?? 'Director not assigned'}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-700 dark:text-slate-300">
                      {rosterSizeFor(comm.id)} member{rosterSizeFor(comm.id) === 1 ? '' : 's'}
                    </div>
                    <div className="text-[10px] text-emerald-600 font-semibold">{comm.status}</div>
                  </div>
                </motion.div>
              </StaggerItem>
            ))}
          </StaggerGroup>
        </motion.div>

      </div>

      {/* Audit Log Snapshot */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Recent Organization Activity & Audit Log</h2>
            <p className="text-[11px] text-slate-400">Centralized immutable record of all administrative actions</p>
          </div>
          {can('audit.read') && (
            <button
              onClick={() => onNavigate('audit_log')}
              className="text-xs text-[#F59A16] font-bold hover:underline"
            >
              Full Audit Log
            </button>
          )}
        </div>

        {auditLogs.length === 0 && (
          <p className="text-[11px] text-slate-400 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 px-4 py-6 text-center">
            No administrative actions recorded in this workspace yet. Every privileged change made here will appear as
            an append-only entry.
          </p>
        )}
        <StaggerGroup className="divide-y divide-slate-100 dark:divide-slate-800" step={0.05} amount={0.1}>
          {auditLogs.slice(0, 5).map((log) => (
            <StaggerItem key={log.id}>
              <motion.div
                className="py-3 px-2 -mx-2 rounded-lg flex items-center justify-between gap-4 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                whileHover={{ x: 4 }}
                transition={transitions.micro}
              >
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[#123B60] dark:text-[#F59A16] font-bold text-[10px]">
                    {log.actorName[0]}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-100">
                      <strong>{log.actorName}</strong> {log.action}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{log.details}</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 shrink-0">{log.timestamp}</div>
              </motion.div>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </motion.div>

    </div>
  );
};
