import React, { useState } from 'react';
import { 
  Award, 
  Search, 
  Filter, 
  CheckCircle2, 
  TrendingUp, 
  User, 
  Plus, 
  AlertCircle,
  X
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { SkillMatrixEntry } from '../../types';

export const SkillMatrix: React.FC = () => {
  const { skillMatrix, updateMemberSkill, addMemberSkill, users, currentUser } = useApp();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [skillFilter, setSkillFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [newEntry, setNewEntry] = useState({
    memberId: users[0]?.id || '',
    skillName: 'Materials Science' as SkillMatrixEntry['skillName'],
    level: 'L1' as SkillMatrixEntry['level'],
    assessorName: currentUser.name,
    evidence: '',
    improvementGoal: ''
  });

  const levelDescriptions = {
    L0: 'Novice (No prior practical knowledge)',
    L1: 'Aware (Theoretical understanding & foundational terminology)',
    L2: 'Practitioner (Independent execution of standard lab/design tasks)',
    L3: 'Advanced (Troubleshooting complex issues, guiding teammates)',
    L4: 'Master (Subject matter authority, curriculum design)'
  };

  const filteredEntries = skillMatrix.filter((s) => {
    const matchesSearch = s.memberName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.evidence.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSkill = skillFilter === 'all' || s.skillName === skillFilter;
    return matchesSearch && matchesSkill;
  });

  // Calculate target metric: % of active members at L2+
  const l2OrAboveCount = skillMatrix.filter(s => s.level === 'L2' || s.level === 'L3' || s.level === 'L4').length;
  const targetPct = skillMatrix.length > 0 ? Math.round((l2OrAboveCount / skillMatrix.length) * 100) : 0;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const mem = users.find(u => u.id === newEntry.memberId);
    if (!mem) return;

    addMemberSkill({
      memberId: newEntry.memberId,
      memberName: mem.name,
      committeeId: mem.committeeId || 'comm_te',
      skillName: newEntry.skillName,
      level: newEntry.level,
      lastAssessment: new Date().toISOString().split('T')[0],
      assessorName: currentUser.name,
      evidence: newEntry.evidence,
      improvementGoal: newEntry.improvementGoal
    });

    setIsAddModalOpen(false);
    setNewEntry({
      memberId: users[0]?.id || '',
      skillName: 'Materials Science',
      level: 'L1',
      assessorName: currentUser.name,
      evidence: '',
      improvementGoal: ''
    });
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">L0–L4 Member Skill Matrix</h1>
          <p className="text-xs text-slate-500">
            IWS-inspired progressive competency framework: Learn &rarr; Practice &rarr; Apply &rarr; Share Back &rarr; Validate.
          </p>
        </div>

        {currentUser.role !== 'member' && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Assess Member
          </button>
        )}
      </div>

      {/* Target Progress Card from Vision PDF */}
      <div className="bg-gradient-to-r from-[#123B60] to-[#0A2239] rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="text-[10px] font-bold text-[#F59A16] uppercase tracking-wider">Official 2026-2027 Season Target</span>
          <h2 className="text-lg font-bold mt-1">70% of Active Technical Members at L2+ by July</h2>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Monthly assessment cycle with low-score skills automatically becoming the focal theme for the following month's team learning sessions.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0 bg-white/10 px-5 py-3 rounded-2xl border border-white/15">
          <div className="text-right">
            <div className="text-2xl font-black text-[#F59A16]">{targetPct}%</div>
            <div className="text-[10px] text-slate-300">Current Progress</div>
          </div>
          <div className="w-12 h-12 rounded-full border-4 border-[#F59A16] border-t-white flex items-center justify-center font-bold text-xs">
            {l2OrAboveCount}/{skillMatrix.length}
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search by member name or assessment evidence..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
          />
        </div>

        <select
          value={skillFilter}
          onChange={(e) => setSkillFilter(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
        >
          <option value="all">All Evaluated Skills</option>
          <option value="Materials Science">Materials Science</option>
          <option value="Inspection & NDT">Inspection & NDT</option>
          <option value="Engineering Software">Engineering Software</option>
          <option value="Technical Research">Technical Research</option>
          <option value="Presentation">Presentation</option>
          <option value="Project Management">Project Management</option>
        </select>
      </div>

      {/* Skill Matrix Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredEntries.map((entry) => (
          <div
            key={entry.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs font-bold text-[#123B60] dark:text-[#F59A16]">
                  {entry.skillName}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full font-black text-xs ${
                  entry.level === 'L4' ? 'bg-purple-100 text-purple-800' :
                  entry.level === 'L3' ? 'bg-emerald-100 text-emerald-800' :
                  entry.level === 'L2' ? 'bg-blue-100 text-blue-800' :
                  'bg-slate-100 text-slate-700'
                }`}>
                  {entry.level}
                </span>
              </div>

              <h2 className="text-base font-bold text-slate-900 dark:text-white">{entry.memberName}</h2>
              <div className="text-[10px] text-slate-400 mt-0.5">Assessed: {entry.lastAssessment} by {entry.assessorName}</div>

              <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-2">
                <div>
                  <span className="font-bold text-slate-700 dark:text-slate-300 block text-[10px] uppercase">Verified Evidence:</span>
                  <p className="text-slate-600 dark:text-slate-400 mt-0.5">{entry.evidence}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-700 dark:text-slate-300 block text-[10px] uppercase">Next Improvement Goal:</span>
                  <p className="text-[#123B60] dark:text-[#F59A16] font-medium mt-0.5">{entry.improvementGoal}</p>
                </div>
              </div>
            </div>

            {currentUser.role !== 'member' && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 mt-4 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400">Level:</span>
                <select
                  value={entry.level}
                  onChange={(e) => updateMemberSkill(entry.id, { level: e.target.value as any })}
                  className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 font-bold text-xs outline-none"
                >
                  <option value="L0">L0 - Novice</option>
                  <option value="L1">L1 - Aware</option>
                  <option value="L2">L2 - Practitioner</option>
                  <option value="L3">L3 - Advanced</option>
                  <option value="L4">L4 - Master</option>
                </select>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Assessment Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Record Member Skill Assessment</h2>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Select Member</label>
                <select
                  value={newEntry.memberId}
                  onChange={(e) => setNewEntry({ ...newEntry, memberId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Competency Area</label>
                  <select
                    value={newEntry.skillName}
                    onChange={(e) => setNewEntry({ ...newEntry, skillName: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                  >
                    <option value="Materials Science">Materials Science</option>
                    <option value="Inspection & NDT">Inspection & NDT</option>
                    <option value="Engineering Software">Engineering Software</option>
                    <option value="Technical Research">Technical Research</option>
                    <option value="Presentation">Presentation</option>
                    <option value="Project Management">Project Management</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Assessment Level</label>
                  <select
                    value={newEntry.level}
                    onChange={(e) => setNewEntry({ ...newEntry, level: e.target.value as any })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none font-bold text-[#123B60]"
                  >
                    <option value="L0">L0 - Novice</option>
                    <option value="L1">L1 - Aware</option>
                    <option value="L2">L2 - Practitioner</option>
                    <option value="L3">L3 - Advanced</option>
                    <option value="L4">L4 - Master</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Verified Evidence / Test Result</label>
                <textarea
                  required
                  rows={2}
                  value={newEntry.evidence}
                  onChange={(e) => setNewEntry({ ...newEntry, evidence: e.target.value })}
                  placeholder="e.g. Conducted metallographic microstructural analysis on carbon steel..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Improvement Goal for Next Cycle</label>
                <textarea
                  required
                  rows={2}
                  value={newEntry.improvementGoal}
                  onChange={(e) => setNewEntry({ ...newEntry, improvementGoal: e.target.value })}
                  placeholder="e.g. Master angle beam shear wave inspection..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white font-bold rounded-xl"
                >
                  Record Assessment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
