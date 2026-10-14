import React from 'react';
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
import { 
  LineChart as LineChartIcon
} from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const KPIAnalytics: React.FC = () => {
  const { users, committees, tasks, submissions, seasonEvents, scoreLedger } = useApp();

  // Colors
  const COLORS = ['#123B60', '#F59A16', '#10B981', '#6366F1', '#EC4899', '#8B5CF6'];

  // Committee Member Distribution
  const committeeDistributionData = committees.map(c => ({
    name: c.shortCode,
    fullName: c.name,
    members: users.filter(u => u.committeeId === c.id).length
  }));

  // Tasks by Status
  const statusCounts: Record<string, number> = {};
  tasks.forEach(t => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  });
  const taskStatusData = Object.keys(statusCounts).map(status => ({
    name: status.replace('_', ' '),
    count: statusCounts[status]
  }));

  // Points by Committee
  const committeePointsData = committees.map(c => {
    const points = scoreLedger
      .filter(entry => entry.committeeId === c.id)
      .reduce((sum, entry) => sum + entry.points, 0);
    return {
      name: c.shortCode,
      points: points
    };
  });

  // Role Breakdown
  const roleCounts: Record<string, number> = {};
  users.forEach(u => {
    roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
  });
  const roleData = Object.keys(roleCounts).map(role => ({
    name: role.replace('_', ' '),
    count: roleCounts[role]
  }));

  return (
    <div className="space-y-8">
      
      {/* Header */}
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white">Organization KPI & Analytics Intelligence</h1>
        <p className="text-xs text-slate-500">
          Real-time organizational health, task throughput, committee point distributions, and member performance metrics.
        </p>
      </div>

      {/* Top 4 Performance Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="text-slate-400 text-xs font-semibold">Total Roster Strength</div>
          <div className="text-2xl font-black text-[#123B60] dark:text-white mt-2">{users.length} Students</div>
          <div className="text-[11px] text-emerald-600 font-semibold mt-1">100% Cairo University affiliated</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="text-slate-400 text-xs font-semibold">Deliverable Approval Rate</div>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            {submissions.length > 0 
              ? `${Math.round((submissions.filter(s => s.status === 'approved').length / submissions.length) * 100)}%` 
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">{submissions.filter(s => s.status === 'approved').length} approved submissions</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="text-slate-400 text-xs font-semibold">Approved Points Circulated</div>
          <div className="text-2xl font-black text-[#F59A16] mt-2">
            {scoreLedger.reduce((a, b) => a + b.points, 0).toLocaleString()} pts
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Directly tied to verified deliverables</div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="text-slate-400 text-xs font-semibold">Season Milestone Track</div>
          <div className="text-2xl font-black text-purple-600 mt-2">
            {seasonEvents.length} Targets
          </div>
          <div className="text-[11px] text-slate-400 mt-1">4 Summits, 10 Workshops, 3 Issues</div>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Committee Member Size */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Roster Size by Committee</h2>
          <p className="text-[11px] text-slate-400 mb-6">Distribution of active members across technical and creative branches</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={committeeDistributionData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="name" fontSize={11} stroke="#94A3B8" />
                <YAxis fontSize={11} stroke="#94A3B8" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                />
                <Bar dataKey="members" fill="#123B60" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Points by Committee */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Total Points Earned by Committee</h2>
          <p className="text-[11px] text-slate-400 mb-6">Cumulative merit output verified via approved task ledger</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={committeePointsData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="name" fontSize={11} stroke="#94A3B8" />
                <YAxis fontSize={11} stroke="#94A3B8" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '11px' }}
                />
                <Bar dataKey="points" fill="#F59A16" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Task Pipeline Status Breakdown */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Tasks by Workflow Pipeline Status</h2>
          <p className="text-[11px] text-slate-400 mb-4">Pipeline health from assigned through review and approval</p>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={taskStatusData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  fill="#8884d8"
                  label={(entry: any) => `${entry.name || ''} ${entry.percent ? (entry.percent * 100).toFixed(0) + '%' : ''}`}
                  fontSize={10}
                >
                  {taskStatusData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Role Distribution */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Organization Hierarchy Structure</h2>
          <p className="text-[11px] text-slate-400 mb-4">Ratio of Super Admin, Directors, Heads, Members, and Moderators</p>
          <div className="h-64 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={roleData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                  label={(entry: any) => `${entry.name || ''} (${entry.value ?? entry.count ?? ''})`}
                  fontSize={10}
                >
                  {roleData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

    </div>
  );
};
