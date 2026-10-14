import React from 'react';
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
  TrendingUp,
  Clock,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Plus
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { DashboardView } from './DashboardShell';

interface SuperAdminOverviewProps {
  onNavigate: (view: DashboardView) => void;
}

export const SuperAdminOverview: React.FC<SuperAdminOverviewProps> = ({ onNavigate }) => {
  const { 
    currentUser, 
    users, 
    committees, 
    tasks, 
    submissions, 
    applications, 
    seasonEvents, 
    scoreLedger,
    auditLogs
  } = useApp();

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
  const seasonProgressPct = Math.round((completedDeliverables / totalSeasonDeliverables) * 100);

  const kpiCards = [
    {
      label: 'Total Chapter Members',
      value: totalMembers,
      subtitle: `${users.filter(u => u.status === 'active').length} active in rosters`,
      icon: Users,
      color: 'text-[#123B60] dark:text-[#F59A16]',
      bg: 'bg-[#123B60]/10',
      actionView: 'members' as DashboardView
    },
    {
      label: 'Active Committees',
      value: activeCommittees,
      subtitle: 'T&E, M&C, MKT, Design',
      icon: Layers,
      color: 'text-[#F59A16]',
      bg: 'bg-[#F59A16]/10',
      actionView: 'committees' as DashboardView
    },
    {
      label: 'Active Tasks',
      value: activeTasks,
      subtitle: `${tasks.length} total season tasks`,
      icon: CheckSquare,
      color: 'text-blue-600',
      bg: 'bg-blue-500/10',
      actionView: 'tasks' as DashboardView
    },
    {
      label: 'Pending Submissions',
      value: pendingSubmissions,
      subtitle: 'Awaiting board review',
      icon: FileCheck2,
      color: 'text-amber-600',
      bg: 'bg-amber-500/10',
      actionView: 'submissions' as DashboardView
    },
    {
      label: 'Pending Applications',
      value: pendingApplications,
      subtitle: `${applications.length} recruitment entries`,
      icon: UserPlus,
      color: 'text-emerald-600',
      bg: 'bg-emerald-500/10',
      actionView: 'applications' as DashboardView
    },
    {
      label: 'Overdue / Flagged',
      value: overdueTasks,
      subtitle: 'Requiring leadership intervention',
      icon: AlertTriangle,
      color: 'text-rose-600',
      bg: 'bg-rose-500/10',
      actionView: 'tasks' as DashboardView
    },
    {
      label: 'Total Approved Points',
      value: totalPointsDistributed.toLocaleString(),
      subtitle: 'Points ledger verified',
      icon: Award,
      color: 'text-purple-600',
      bg: 'bg-purple-500/10',
      actionView: 'scoring' as DashboardView
    },
    {
      label: 'Season 26–27 Progress',
      value: `${seasonProgressPct}%`,
      subtitle: `${completedDeliverables} of ${totalSeasonDeliverables} milestones completed`,
      icon: Target,
      color: 'text-teal-600',
      bg: 'bg-teal-500/10',
      actionView: 'season_planner' as DashboardView
    }
  ];

  return (
    <div className="space-y-8">
      
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-[#123B60] via-[#0E2F4D] to-[#0A2239] rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-white/10">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-[#F59A16] text-xs font-bold border border-white/15">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Season 2026–2027 Command Center</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              Good morning, {currentUser.name}
            </h1>
            <p className="text-xs sm:text-sm text-slate-200 max-w-2xl leading-relaxed">
              Your ESME command center. Monitor performance, review submissions, manage your committees, and keep the chapter moving forward.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => onNavigate('tasks')}
              className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Task
            </button>
            <button
              onClick={() => onNavigate('submissions')}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl border border-white/20 transition flex items-center gap-1.5 backdrop-blur-sm"
            >
              <FileCheck2 className="w-3.5 h-3.5" />
              Review Submissions
            </button>
            <button
              onClick={() => onNavigate('website_cms')}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl border border-white/20 transition flex items-center gap-1.5 backdrop-blur-sm"
            >
              Edit Website
            </button>
          </div>
        </div>
      </div>

      {/* KPI Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              onClick={() => onNavigate(card.actionView)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 hover:shadow-md hover:border-[#123B60]/30 transition cursor-pointer flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{card.label}</span>
                <div className={`w-8 h-8 rounded-xl ${card.bg} ${card.color} flex items-center justify-center`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4">
                <div className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{card.value}</div>
                <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                  <span>{card.subtitle}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-60" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two-Column Middle Section: Workflows & Submissions Pending */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Urgent Review Queue */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Active Submission Queue</h2>
              <p className="text-[11px] text-slate-400">Work submitted by members requiring approval & point scoring</p>
            </div>
            <button
              onClick={() => onNavigate('submissions')}
              className="text-xs text-[#F59A16] font-bold hover:underline flex items-center gap-1"
            >
              View all ({submissions.length})
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {submissions.slice(0, 4).map((sub) => (
              <div
                key={sub.id}
                onClick={() => onNavigate('submissions')}
                className="p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer flex items-center justify-between gap-4"
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
              </div>
            ))}
          </div>
        </div>

        {/* Committee Status Summary */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Committees Roster</h2>
              <p className="text-[11px] text-slate-400">T&E, M&C, Marketing, and Design</p>
            </div>
            <button
              onClick={() => onNavigate('committees')}
              className="text-xs text-[#F59A16] font-bold hover:underline"
            >
              Manage
            </button>
          </div>

          <div className="space-y-3">
            {committees.map((comm) => (
              <div 
                key={comm.id}
                onClick={() => onNavigate('committees')}
                className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-xl bg-[#123B60] text-white flex items-center justify-center font-bold text-[10px]">
                    {comm.shortCode}
                  </span>
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-100">{comm.name}</div>
                    <div className="text-[10px] text-slate-400">{comm.directorName || 'No director'}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-slate-700 dark:text-slate-300">{comm.memberCount} members</div>
                  <div className="text-[10px] text-emerald-600 font-semibold">{comm.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Audit Log Snapshot */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Recent Organization Activity & Audit Log</h2>
            <p className="text-[11px] text-slate-400">Centralized immutable record of all administrative actions</p>
          </div>
          <button
            onClick={() => onNavigate('audit_log')}
            className="text-xs text-[#F59A16] font-bold hover:underline"
          >
            Full Audit Log
          </button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {auditLogs.slice(0, 5).map((log) => (
            <div key={log.id} className="py-3 flex items-center justify-between gap-4 text-xs">
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
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
