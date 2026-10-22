import React, { useMemo, useState } from 'react';
import { Award, PlusCircle, X, Search, Users, ListOrdered } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor } from '../../domain/roles';
import { ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import { ScoringTransparency } from './ScoringTransparency';

const signed = (points: number) => `${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points)} pts`;

export const PointsAndLeaderboard: React.FC = () => {
  const { users, scoreLedger, committees, addManualPointAdjustment, can } = useApp();
  const currentUser = useActor();

  const [selectedTab, setSelectedTab] = useState<'leaderboard' | 'ledger' | 'policy'>('leaderboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [committeeFilter, setCommitteeFilter] = useState('all');

  // Manual point adjustment modal state
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const { toast } = useToast();
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [pointsChange, setPointsChange] = useState<number>(0);
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const mayAdjust = can('scores.adjust');

  // A member's scores.read scope is `self`, a director's is `committee`. Totals outside that
  // scope are simply not returned to this account, so the ranking is built from them.
  const scoreScope = scopeFor(currentUser.role, 'scores.read');
  const visibleUsers = useMemo(() => {
    if (scoreScope === 'self') return users.filter((u) => u.id === currentUser.id);
    if (scoreScope === 'committee') return users.filter((u) => u.committeeId === currentUser.committeeId);
    return users;
  }, [users, scoreScope, currentUser.id, currentUser.committeeId]);

  const visibleIds = useMemo(() => new Set(visibleUsers.map((u) => u.id)), [visibleUsers]);

  const sortedUsers = useMemo(
    () =>
      [...visibleUsers]
        .sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name))
        .filter((u) => u.status === 'active'),
    [visibleUsers]
  );

  const inactiveCount = visibleUsers.length - sortedUsers.length;

  const filteredUsers = sortedUsers.filter((u) => {
    const matchesSearch = u.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesComm = committeeFilter === 'all' || u.committeeId === committeeFilter;
    return matchesSearch && matchesComm;
  });

  const visibleLedger = scoreLedger.filter((entry) => visibleIds.has(entry.memberId));

  const openAdjustModal = () => {
    setPointsChange(0);
    setAdjustmentReason('');
    setIsAdjustModalOpen(true);
  };

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addManualPointAdjustment(selectedMemberId, Number(pointsChange), adjustmentReason);
      toast(`${signed(Number(pointsChange))} recorded for this member`, 'success');
      setIsAdjustModalOpen(false);
      setAdjustmentReason('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The adjustment was not recorded.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Chapter Scoring & Leaderboards</h1>
          <p className="text-xs text-slate-500">
            Totals are summed from the ledger rows this account can see — {visibleLedger.length} of{' '}
            {scoreLedger.length} entries.
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
              Scoring Ledger ({visibleLedger.length})
            </button>
            <button
              onClick={() => setSelectedTab('policy')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                selectedTab === 'policy' ? 'bg-[#123B60] text-white' : 'text-slate-500'
              }`}
            >
              How this is scored
            </button>
          </div>

          {mayAdjust && (
            <button
              onClick={openAdjustModal}
              disabled={visibleUsers.length === 0}
              className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              Adjust Points
            </button>
          )}
        </div>
      </div>

      {selectedTab === 'leaderboard' ? (
        <div className="space-y-6">

          {sortedUsers.length === 0 ? (
            <EmptyState
              title="No ranked members yet"
              description={
                inactiveCount > 0
                  ? `${visibleUsers.length} ${visibleUsers.length === 1 ? 'account is' : 'accounts are'} visible to your role but none is active, and an inactive account holds no standing on this board.`
                  : 'Accounts reach this board once the authentication provider returns them and an administrator approves them.'
              }
              icon={Users}
            />
          ) : (
            <>
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
                  <p className="text-xs text-slate-500">
                    {u.role.replace('_', ' ')}
                    {u.department ? ` • ${u.department}` : ' • department not recorded'}
                  </p>
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
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                Rankings you can read
                <span className="ml-2 font-normal text-slate-400">
                  {scoreScope === 'self'
                    ? 'your account only'
                    : scoreScope === 'committee'
                      ? 'your committee only'
                      : 'the whole chapter'}
                </span>
              </span>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by name"
                    aria-label="Search the ranking by member name"
                    className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#123B60]"
                  />
                </div>
                {visibleUsers.some((u) => u.committeeId) && (
                  <select
                    value={committeeFilter}
                    onChange={(e) => setCommitteeFilter(e.target.value)}
                    aria-label="Filter by committee"
                    className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold outline-none"
                  >
                    <option value="all">All committees you can see</option>
                    {committees
                      .filter((c) => visibleUsers.some((u) => u.committeeId === c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                  </select>
                )}
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <p className="p-10 text-center text-xs text-slate-400">
                {searchTerm || committeeFilter !== 'all'
                  ? `${sortedUsers.length} ranked ${sortedUsers.length === 1 ? 'member' : 'members'} exist, but none match this search or filter.`
                  : 'No member in your scope has a score yet.'}
              </p>
            ) : (
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
            )}
          </div>
            </>
          )}

        </div>
      ) : selectedTab === 'policy' ? (
        <ScoringTransparency members={visibleUsers} />
      ) : (
        /* Scoring ledger */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">Scoring ledger</span>
            <p className="text-[10px] text-slate-400">
              One row per recorded point movement, newest first. This application never rewrites or deletes a row once
              written; whether the provider enforces that is a separate question — see the technical workspace.
            </p>
          </div>

          {visibleLedger.length === 0 ? (
            <EmptyState
              title="No points have been recorded"
              description="The ledger fills up when a submission is approved or an adjustment is committed. Nothing here is pre-populated."
              icon={ListOrdered}
            />
          ) : (
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
              {visibleLedger.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors duration-150">
                  <td className="py-3 px-4 text-slate-400 text-[11px] whitespace-nowrap">{entry.timestamp.slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">{entry.memberName}</td>
                  <td
                    className={`py-3 px-4 font-bold ${
                      entry.points < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {signed(entry.points)}
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
          )}
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
              <p className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                A manual adjustment writes a ledger row in your name with the reason below. It is checked against the
                scores capability and your committee scope before anything changes, and only members visible to your
                account can be selected.
              </p>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="adjust-member">Select member</label>
                <select
                  id="adjust-member"
                  required
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="" disabled>Choose a member…</option>
                  {visibleUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} (current total: {u.totalPoints} pts)</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="adjust-delta">Points delta (use a minus sign to deduct)</label>
                <input
                  id="adjust-delta"
                  type="number"
                  required
                  value={pointsChange}
                  onChange={(e) => setPointsChange(Number(e.target.value))}
                  placeholder="e.g. 50 or -20"
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
