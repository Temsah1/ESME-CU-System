import React, { useState } from 'react';
import { 
  Award, 
  TrendingUp, 
  Search, 
  Filter, 
  PlusCircle, 
  History, 
  User, 
  CheckCircle2, 
  ShieldAlert,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ModalShell, useToast } from '../../motion';

export const PointsAndLeaderboard: React.FC = () => {
  const { users, scoreLedger, addManualPointAdjustment, currentUser } = useApp();
  
  const [selectedTab, setSelectedTab] = useState<'leaderboard' | 'ledger'>('leaderboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [committeeFilter, setCommitteeFilter] = useState('all');
  
  // Manual point adjustment modal state
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const { toast } = useToast();
  const [selectedMemberId, setSelectedMemberId] = useState(users[0]?.id || '');
  const [pointsChange, setPointsChange] = useState<number>(50);
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const canAdjust = currentUser.role === 'super_admin' || currentUser.role === 'director';

  const sortedUsers = [...users].sort((a, b) => b.totalPoints - a.totalPoints);

  const filteredUsers = sortedUsers.filter((u) => {
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesComm = committeeFilter === 'all' || u.committeeId === committeeFilter;
    return matchesSearch && matchesComm;
  });

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustmentReason.trim()) {
      alert('A valid reason is required for audit traceability.');
      return;
    }
    addManualPointAdjustment(selectedMemberId, Number(pointsChange), adjustmentReason);
    toast(`${Number(pointsChange) > 0 ? '+' : ''}${Number(pointsChange)} pts adjustment recorded`);
    setIsAdjustModalOpen(false);
    setAdjustmentReason('');
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Chapter Scoring & Leaderboards</h1>
          <p className="text-xs text-slate-500">
            Real-time merit tracking, transparent append-only score ledger, and performance rankings.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1 flex">
            <button
              onClick={() => setSelectedTab('leaderboard')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                selectedTab === 'leaderboard' ? 'bg-[#123B60] text-white' : 'text-slate-500'
              }`}
            >
              Leaderboard
            </button>
            <button
              onClick={() => setSelectedTab('ledger')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                selectedTab === 'ledger' ? 'bg-[#123B60] text-white' : 'text-slate-500'
              }`}
            >
              Scoring Ledger ({scoreLedger.length})
            </button>
          </div>

          {canAdjust && (
            <button
              onClick={() => setIsAdjustModalOpen(true)}
              className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              Adjust Points
            </button>
          )}
        </div>
      </div>

      {selectedTab === 'leaderboard' ? (
        <div className="space-y-6">
          
          {/* Top 3 Podium Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {sortedUsers.slice(0, 3).map((u, idx) => (
              <div
                key={u.id}
                className={`p-6 rounded-3xl border relative overflow-hidden flex flex-col justify-between ${
                  idx === 0 
                    ? 'bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-amber-300 dark:border-amber-700' 
                    : idx === 1 
                      ? 'bg-gradient-to-br from-slate-400/10 via-slate-400/5 to-transparent border-slate-300 dark:border-slate-700'
                      : 'bg-gradient-to-br from-orange-400/10 via-orange-400/5 to-transparent border-orange-300 dark:border-orange-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs ${
                    idx === 0 ? 'bg-amber-500 text-white' : idx === 1 ? 'bg-slate-400 text-white' : 'bg-orange-600 text-white'
                  }`}>
                    #{idx + 1}
                  </span>
                  <Award className={`w-6 h-6 ${
                    idx === 0 ? 'text-amber-500' : idx === 1 ? 'text-slate-400' : 'text-orange-500'
                  }`} />
                </div>

                <div className="mt-4">
                  <h2 className="text-base font-black text-slate-900 dark:text-white">{u.name}</h2>
                  <p className="text-xs text-slate-500">{u.role.toUpperCase()} • {u.department || 'ESME CU'}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
                  <span className="text-slate-500">{u.approvedTasksCount} approved tasks</span>
                  <span className="font-extrabold text-base text-[#F59A16]">{u.totalPoints} pts</span>
                </div>
              </div>
            ))}
          </div>

          {/* Full Leaderboard Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Overall Rankings</span>
              <span className="text-[11px] text-slate-400">Total ranked active contributors: {sortedUsers.length}</span>
            </div>

            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-4">Rank</th>
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4 text-center">Approved Tasks</th>
                  <th className="py-3 px-4 text-right">Total Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map((u, idx) => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors duration-150">
                    <td className="py-3 px-4 font-bold text-slate-500">#{idx + 1}</td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-800 dark:text-slate-100">{u.name}</div>
                      <div className="text-[10px] text-slate-400">{u.email}</div>
                    </td>
                    <td className="py-3 px-4 capitalize text-slate-600 dark:text-slate-300">{u.role.replace('_', ' ')}</td>
                    <td className="py-3 px-4 text-center font-semibold text-slate-700 dark:text-slate-300">{u.approvedTasksCount}</td>
                    <td className="py-3 px-4 text-right font-black text-[#F59A16] text-sm">{u.totalPoints} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </div>
      ) : (
        /* Immutable Score Ledger View */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Append-Only Scoring Ledger</span>
              <p className="text-[10px] text-slate-400">Chronological immutable audit log of all point distributions</p>
            </div>
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
              Audit Verified
            </span>
          </div>

          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]">
              <tr>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Adjustment</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Reviewer</th>
                <th className="py-3 px-4">Reason & Justification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {scoreLedger.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors duration-150">
                  <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">{entry.timestamp}</td>
                  <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">{entry.memberName}</td>
                  <td className="py-3 px-4 font-bold text-emerald-600">
                    +{entry.points} pts
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {entry.actionType.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{entry.reviewerName}</td>
                  <td className="py-3 px-4 text-slate-500 text-[11px] max-w-xs truncate" title={entry.reason}>
                    {entry.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Manual Point Adjustment Modal */}
      <ModalShell open={isAdjustModalOpen} onClose={() => setIsAdjustModalOpen(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Manual Point Adjustment</h2>
              <button onClick={() => setIsAdjustModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Select Member</label>
                <select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} (Current: {u.totalPoints} pts)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Points Delta (+/-)</label>
                <input
                  type="number"
                  required
                  value={pointsChange}
                  onChange={(e) => setPointsChange(Number(e.target.value))}
                  placeholder="e.g. 50"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-bold text-[#F59A16] outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Mandatory Audit Justification</label>
                <textarea
                  required
                  rows={3}
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="Explain reason for bonus, summit contribution, or point modification..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#123B60] text-white font-bold rounded-xl"
                >
                  Commit Adjustment
                </button>
              </div>
            </form>
      </ModalShell>

    </div>
  );
};
