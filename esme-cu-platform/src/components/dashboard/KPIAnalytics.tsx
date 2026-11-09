import React, { useMemo } from 'react';
import { useReducedMotion } from 'motion/react';
import { CHART_CHROME, CHART_SERIES, PALETTE } from '../../theme/palette';
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
import { Alert, Card, StatTile } from '../ui';

const ChartCard: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
  <Card as="section" ariaLabel={label} className="p-4 sm:p-6">
    {children}
  </Card>
);

/** A chart with no rows underneath is reported as empty — it is not drawn as a set of zero bars. */
const NoData: React.FC<{ what: string }> = ({ what }) => (
  <div className="h-64 flex flex-col items-center justify-center text-center gap-2 rounded-card border border-dashed border-border-strong px-4">
    <Inbox className="w-5 h-5 text-ink-faint" aria-hidden />
    <p className="text-caption font-bold text-ink-muted">Nothing to plot</p>
    <p className="text-micro text-ink-subtle max-w-64 leading-relaxed">{what}</p>
  </div>
);

const ChartTitle: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-4">
    <h2 className="text-label font-bold text-ink-strong">{title}</h2>
    <p className="text-micro text-ink-subtle mt-1 leading-relaxed">{children}</p>
  </div>
);

const count = (n: number) => Math.round(n).toLocaleString();

export const KPIAnalytics: React.FC = () => {
  const { users, committees, tasks, submissions, seasonEvents, scoreLedger } = useApp();
  const currentUser = useActor();

  const COLORS = [...CHART_SERIES];
  // Recharts animates on its own clock and never asks the OS about reduced motion, so the flag is
  // read here and handed to every series. A bar that grows is decoration; the number beside it is
  // the measurement, and it is printed either way.
  const reduced = useReducedMotion();

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
    <div className="space-y-6">

      <header>
        <h1 className="text-headline font-extrabold text-ink-strong tracking-tight">Organization KPI &amp; Analytics</h1>
        <p className="text-label text-ink-muted mt-2 max-w-prose leading-relaxed">
          Counts taken from the {visibleUsers.length} account{visibleUsers.length === 1 ? '' : 's'},{' '}
          {visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'} and {visibleLedger.length} ledger row
          {visibleLedger.length === 1 ? '' : 's'} readable by your role. Nothing here is projected, smoothed or
          fetched from an external system.
        </p>
      </header>

      {visibleUsers.length === 0 && (
        <Alert tone="warning">
          The provider has returned no accounts yet, so every chart on this page has no input. They are shown as empty
          rather than drawing zero-filled series.
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Accounts in view"
          value={count(visibleUsers.length)}
          tone="brand"
          hint={`${activeMembers.length} active · ${visibleUsers.length - activeMembers.length} pending, suspended or rejected`}
        />
        <StatTile
          label="Deliverable Approval Rate"
          value={visibleSubmissions.length > 0 ? `${Math.round((approvedCount / visibleSubmissions.length) * 100)}%` : 'N/A'}
          tone="success"
          hint={visibleSubmissions.length > 0
            ? `${approvedCount} of ${visibleSubmissions.length} submissions approved`
            : 'No submissions have been recorded'}
        />
        <StatTile
          label="Net points in the ledger"
          value={`${count(visibleLedger.reduce((a, b) => a + b.points, 0))} pts`}
          tone="accent"
          hint={`${taskAwardPoints} from task and event awards, ${manualPoints} from manual adjustments`}
        />
        <StatTile
          label="Season targets written"
          value={count(seasonEvents.length)}
          tone="violet"
          hint={categorySummary}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <ChartCard label="Active accounts by committee">
          <ChartTitle title="Active accounts by committee">
            Counted from the {activeMembers.length} active account{activeMembers.length === 1 ? '' : 's'} in view;
            committees with no members show no bar.
          </ChartTitle>
          <div className="h-64">
            {activeMembers.length === 0 ? (
              <NoData what="No active account has been approved yet, so there is no roster to distribute." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={committeeDistributionData.filter((d) => d.members > 0)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" fontSize={11} stroke={CHART_CHROME.axis} />
                  <YAxis allowDecimals={false} fontSize={11} stroke={CHART_CHROME.axis} />
                  <Tooltip
                    contentStyle={{ backgroundColor: CHART_CHROME.tooltipBackground, borderRadius: '8px', border: 'none', color: CHART_CHROME.tooltipText, fontSize: '12px' }}
                  />
                  <Bar dataKey="members" fill={PALETTE.navy} radius={[8, 8, 0, 0]} isAnimationActive={!reduced} animationDuration={800} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard label="Points recorded by committee">
          <ChartTitle title="Points recorded by committee">
            Summed across all {visibleLedger.length} ledger row{visibleLedger.length === 1 ? '' : 's'} in view,
            including manual adjustments.
          </ChartTitle>
          <div className="h-64">
            {visibleLedger.length === 0 ? (
              <NoData what="The scoring ledger is empty, so no committee has earned points yet." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={committeePointsData.filter((d) => d.points !== 0)}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="name" fontSize={11} stroke={CHART_CHROME.axis} />
                  <YAxis fontSize={11} stroke={CHART_CHROME.axis} />
                  <Tooltip
                    contentStyle={{ backgroundColor: CHART_CHROME.tooltipBackground, borderRadius: '8px', border: 'none', color: CHART_CHROME.tooltipText, fontSize: '12px' }}
                  />
                  <Bar dataKey="points" fill={PALETTE.orange} radius={[8, 8, 0, 0]} isAnimationActive={!reduced} animationDuration={800} animationEasing="ease-out" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard label="Tasks by workflow status">
          <ChartTitle title="Tasks by workflow status">
            {visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'} in view, split by the status each row carries.
          </ChartTitle>
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
                    fontSize={11}
                    isAnimationActive={!reduced}
                    animationDuration={800}
                  >
                    {taskStatusData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: CHART_CHROME.tooltipBackground, borderRadius: '8px', border: 'none', color: CHART_CHROME.tooltipText, fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

        <ChartCard label="Roles held in view">
          <ChartTitle title="Roles held in view">
            Every role an account actually carries, read from the provider&apos;s record for it.
          </ChartTitle>
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
                    fontSize={11}
                    isAnimationActive={!reduced}
                    animationDuration={800}
                  >
                    {roleData.map((_entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: CHART_CHROME.tooltipBackground, borderRadius: '8px', border: 'none', color: CHART_CHROME.tooltipText, fontSize: '12px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartCard>

      </div>

    </div>
  );
};
