import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell
} from 'recharts';
import { Inbox } from 'lucide-react';

import { useApp, useActor } from '../../context/AppContext';
import { scopeFor } from '../../domain/roles';
import { AnimatedNumber, Reveal, StaggerGroup, StaggerItem, groupItemScale } from '../../motion';

const ChartCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.2 }}
    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow"
  >
    {children}
  </motion.div>
);

/** A chart with no rows underneath is reported as empty — it is not drawn as a set of zero bars. */
const NoData: React.FC<{ what: string }> = ({ what }) => (
  <div className="h-64 flex flex-col items-center justify-center text-center gap-2 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
    <Inbox className="w-5 h-5 text-slate-400" aria-hidden />
    <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Nothing to plot</p>
    <p className="text-[11px] text-slate-400 max-w-[16rem]">{what}</p>
  </div>
);

export const KPIAnalytics: React.FC = () => {
  const { users, committees, tasks, submissions, seasonEvents, scoreLedger } = useApp();
  const currentUser = useActor();

  // Colors
  const COLORS = ['#123B60', '#F59A16', '#10B981', '#6366F1', '#EC4899', '#8B5CF6'];

  // Every figure below is counted from the rows this account was given. A director whose
  // scores.read scope is `committee` is shown their committee's rows, not chapter totals.
  const scoreScope = scopeFor(currentUser.role, 'scores.read');
  const visibleUsers = useMemo(() => {
    if (scoreScope === 'self') return users.filter((u) => u.id === currentUser.id);
    if (scoreScope === 'committee') return users.filter((u) => u.committeeId === currentUser.committeeId);
    return users;
  }, [users, scoreScope, currentUser.id, currentUser.committeeId]);

  const visibleIds = useMemo(() => new Set(visibleUsers.map((u) => u.id)), [visibleUsers]);
  const visibleLedger = useMemo(
    () => scoreLedger.filter((entry) => visibleIds.has(entry.memberId)),
    [scoreLedger, visibleIds]
  );
  const visibleSubmissions = useMemo(
    () => submissions.filter((s) => visibleIds.has(s.memberId)),
    [submissions, visibleIds]
  );
  const visibleTasks = useMemo(
    () => tasks.filter((t) => scoreScope === 'committee' ? t.committeeId === currentUser.committeeId : true),
    [tasks, scoreScope, currentUser.committeeId]
  );

  const activeMembers = visibleUsers.filter((u) => u.status === 'active');

  // Committee Member Distribution
  const committeeDistributionData = committees.map(c => ({
    name: c.shortCode,
    fullName: c.name,
    members: activeMembers.filter(u => u.committeeId === c.id).length
  }));

  // Tasks by Status
  const statusCounts: Record<string, number> = {};
  visibleTasks.forEach(t => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });
  const taskStatusData = Object.keys(statusCounts).map(status => ({
    name: status.replace('_', ' '),
    count: statusCounts[status]
  }));

  // Points by Committee
  const committeePointsData = committees.map(c => {
    const points = visibleLedger
      .filter(entry => entry.committeeId === c.id)
      .reduce((sum, entry) => sum + entry.points, 0);
    return {
      name: c.shortCode,
      points: points
    };
  });

  const taskAwardPoints = visibleLedger
    .filter((e) => e.actionType === 'task_completion' || e.actionType === 'event_attendance')
    .reduce((sum, e) => sum + e.points, 0);
  const manualPoints = visibleLedger
    .filter((e) => e.actionType !== 'task_completion' && e.actionType !== 'event_attendance')
    .reduce((sum, e) => sum + e.points, 0);

  // Role Breakdown
  const roleCounts: Record<string, number> = {};
  visibleUsers.forEach(u => {
    roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
  });
  const roleData = Object.keys(roleCounts).map(role => ({
    name: role.replace('_', ' '),
    count: roleCounts[role]
  }));

  const approvedCount = visibleSubmissions.filter(s => s.status === 'approved').length;

  const categoryCounts = seasonEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.category] = (acc[event.category] ?? 0) + 1;
    return acc;
  }, {});
  const categorySummary =
    Object.entries(categoryCounts)
      .map(([category, count]) => `${count} ${category.toLowerCase()}${count === 1 ? '' : 's'}`)
      .join(', ') || 'no targets written yet';

  return (
    <div className="space-y-8">
      
      {/* Header */}
      <Reveal y={14}>
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Organization KPI &amp; Analytics</h1>
          <p className="text-xs text-slate-500">
            Counts taken from the {visibleUsers.length} account{visibleUsers.length === 1 ? '' : 's'},{' '}
            {visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'} and {visibleLedger.length} ledger row
            {visibleLedger.length === 1 ? '' : 's'} readable by your role. Nothing here is projected, smoothed or
            fetched from an external system.
          </p>
        </div>
      </Reveal>

      {visibleUsers.length === 0 && (
        <p className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200">
          The provider has returned no accounts yet, so every chart on this page has no input. They are shown as empty
          rather than drawing zero-filled series.
        </p>
      )}

      {/* Top 4 Performance Badges */}
      <StaggerGroup className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" step={0.07} amount={0.15}>
        <StaggerItem variants={groupItemScale}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-[#123B60]/30 transition-all duration-200">
            <div className="text-slate-400 text-xs font-semibold">Accounts in view</div>
            <div className="text-2xl font-black text-[#123B60] dark:text-white mt-2">
              <AnimatedNumber value={visibleUsers.length} startOnView />
            </div>
            <div className="text-[11px] text-slate-400 font-semibold mt-1">
              {activeMembers.length} active • {visibleUsers.length - activeMembers.length} pending, suspended or rejected
            </div>
          </div>
        </StaggerItem>

        <StaggerItem variants={groupItemScale}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-emerald-500/40 transition-all duration-200">
            <div className="text-slate-400 text-xs font-semibold">Deliverable Approval Rate</div>
            <div className="text-2xl font-black text-emerald-600 mt-2">
              {visibleSubmissions.length > 0
                ? <><AnimatedNumber value={Math.round((approvedCount / visibleSubmissions.length) * 100)} format={(n) => `${Math.round(n)}%`} startOnView /></>
                : 'N/A'}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {visibleSubmissions.length > 0
                ? `${approvedCount} of ${visibleSubmissions.length} submissions approved`
                : 'No submissions have been recorded'}
            </div>
          </div>
        </StaggerItem>

        <StaggerItem variants={groupItemScale}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-[#F59A16]/40 transition-all duration-200">
            <div className="text-slate-400 text-xs font-semibold">Net points in the ledger</div>
            <div className="text-2xl font-black text-[#F59A16] mt-2">
              <AnimatedNumber value={visibleLedger.reduce((a, b) => a + b.points, 0)} startOnView /> pts
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {taskAwardPoints} from task and event awards, {manualPoints} from manual adjustments
            </div>
          </div>
        </StaggerItem>

        <StaggerItem variants={groupItemScale}>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-purple-500/40 transition-all duration-200">
            <div className="text-slate-400 text-xs font-semibold">Season targets written</div>
            <div className="text-2xl font-black text-purple-600 mt-2">
              <AnimatedNumber value={seasonEvents.length} startOnView />
            </div>
            <div className="text-[11px] text-slate-400 mt-1">{categorySummary}</div>
          </div>
        </StaggerItem>
      </StaggerGroup>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Committee Member Size */}
        <ChartCard>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Active accounts by committee</h2>
          <p className="text-[11px] text-slate-400 mb-6">
            Counted from the {activeMembers.length} active account{activeMembers.length === 1 ? '' : 's'} in view;
            committees with no members show no bar.
          </p>
          <div className="h-64">
            {activeMembers.length === 0 ? (
              <NoData what="No active account has been approved yet, so there is no roster to distribute." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={committeeDistributionData.filter((d) => d.members > 0)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" fontSize={11} stroke="#94A3B8" />
                  <YAxis allowDecimals={false} fontSize={11} stroke="#94A3B8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                  />
                  <Bar dataKey="members" fill="#123B60" radius={[8, 8, 0, 0]} animationDuration={800} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        {/* Points by Committee */}
        <ChartCard>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Points recorded by committee</h2>
          <p className="text-[11px] text-slate-400 mb-6">
            Summed across all {visibleLedger.length} ledger row{visibleLedger.length === 1 ? '' : 's'} in view,
            including manual adjustments.
          </p>
          <div className="h-64">
            {visibleLedger.length === 0 ? (
              <NoData what="The scoring ledger is empty, so no committee has earned points yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={committeePointsData.filter((d) => d.points !== 0)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" fontSize={11} stroke="#94A3B8" />
                  <YAxis fontSize={11} stroke="#94A3B8" />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                  />
                  <Bar dataKey="points" fill="#F59A16" radius={[8, 8, 0, 0]} animationDuration={800} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        {/* Task Pipeline Status Breakdown */}
        <ChartCard>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Tasks by workflow status</h2>
          <p className="text-[11px] text-slate-400 mb-4">
            {visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'} in view, split by the status each row carries.
          </p>
          <div className="h-64 flex items-center justify-center">
            {visibleTasks.length === 0 ? (
              <NoData what="No task has been created, so the pipeline has no stages to show." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={taskStatusData}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(entry: any) => `${entry.name ?? ''} ${entry.percent ? (entry.percent * 100).toFixed(0) + '%' : ''}`}
                    fontSize={10}
                    animationDuration={800}
                  >
                    {taskStatusData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        {/* Role Distribution */}
        <ChartCard>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Roles held in view</h2>
          <p className="text-[11px] text-slate-400 mb-4">
            Every role an account actually carries, read from the provider&apos;s record for it.
          </p>
          <div className="h-64 flex items-center justify-center">
            {visibleUsers.length === 0 ? (
              <NoData what="No accounts are visible to this role, so the hierarchy has no members to count." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={roleData}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    label={(entry: any) => `${entry.name ?? ''} (${entry.value ?? entry.count ?? ''})`}
                    fontSize={10}
                    animationDuration={800}
                  >
                    {roleData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

      </div>

    </div>
  );
};
