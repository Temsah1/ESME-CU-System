import React, { useMemo, useState } from 'react';
import { Search, Plus, X, UserSearch } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { scopeFor } from '../../domain/roles';
import { ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import type { SkillMatrixEntry, User } from '../../types';

type SkillLevel = SkillMatrixEntry['level'];

const SKILL_AREAS: SkillMatrixEntry['skillName'][] = [
  'Materials Science',
  'Inspection & NDT',
  'Engineering Software',
  'Technical Research',
  'Presentation',
  'Project Management',
];

const LEVELS: SkillLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];

const LEVEL_DESCRIPTIONS: Record<SkillLevel, string> = {
  L0: 'Novice — no prior practical knowledge',
  L1: 'Aware — theoretical understanding and foundational terminology',
  L2: 'Practitioner — executes standard lab or design tasks independently',
  L3: 'Advanced — troubleshoots complex issues and guides teammates',
  L4: 'Master — subject-matter authority, designs the curriculum',
};

const L2_PLUS: SkillLevel[] = ['L2', 'L3', 'L4'];

export const SkillMatrix: React.FC = () => {
  const { skillMatrix, updateMemberSkill, addMemberSkill, users, committees, can } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState('');
  const [skillFilter, setSkillFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [newEntry, setNewEntry] = useState({
    memberId: '',
    skillName: 'Materials Science' as SkillMatrixEntry['skillName'],
    level: 'L1' as SkillMatrixEntry['level'],
    evidence: '',
    improvementGoal: '',
  });

  // skills.read is `self` for a member and `committee` for a head or director, so the
  // rows this account may see are filtered before anything is counted.
  const readScope = scopeFor(currentUser.role, 'skills.read');
  const visibleEntries = useMemo(() => {
    if (readScope === 'self') return skillMatrix.filter((s) => s.memberId === currentUser.id);
    if (readScope === 'committee') return skillMatrix.filter((s) => s.committeeId === currentUser.committeeId);
    return skillMatrix;
  }, [skillMatrix, readScope, currentUser.id, currentUser.committeeId]);

  const manageableMembers = useMemo(
    () => users.filter((u) => can('skills.manage', { committeeId: u.committeeId })),
    [users, can]
  );

  const filteredEntries = visibleEntries.filter((s) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = s.memberName.toLowerCase().includes(term) || s.evidence.toLowerCase().includes(term);
    const matchesSkill = skillFilter === 'all' || s.skillName === skillFilter;
    return matchesSearch && matchesSkill;
  });

  const assessedMembers = new Set(visibleEntries.map((s) => s.memberId)).size;
  const l2PlusEntries = visibleEntries.filter((s) => L2_PLUS.includes(s.level)).length;
  const l2PlusShare = visibleEntries.length > 0 ? Math.round((l2PlusEntries / visibleEntries.length) * 100) : null;

  const committeeName = (id: string) => committees.find((c) => c.id === id)?.name ?? 'committee not recorded';

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const member = users.find((u) => u.id === newEntry.memberId);
    if (!member) {
      toast('Choose a member you are allowed to assess.', 'error');
      return;
    }
    if (!member.committeeId) {
      toast('This member has no committee recorded, so the assessment cannot be filed under one.', 'error');
      return;
    }
    try {
      addMemberSkill({
        memberId: member.id,
        memberName: member.name,
        committeeId: member.committeeId,
        skillName: newEntry.skillName,
        level: newEntry.level,
        lastAssessment: new Date().toISOString().split('T')[0],
        assessorName: currentUser.name,
        evidence: newEntry.evidence,
        improvementGoal: newEntry.improvementGoal,
      });
      setIsAddModalOpen(false);
      setNewEntry({ memberId: '', skillName: 'Materials Science', level: 'L1', evidence: '', improvementGoal: '' });
      toast('Assessment recorded.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The assessment was not recorded.', 'error');
    }
  };

  const changeLevel = (entry: SkillMatrixEntry, level: string) => {
    try {
      updateMemberSkill(entry.id, { level: level as SkillMatrixEntry['level'] });
      toast(`${entry.memberName} set to ${level}.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The level was not changed.', 'error');
    }
  };

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">L0–L4 Member Skill Matrix</h1>
          <p className="text-xs text-slate-500">
            Competency records written by an assessor. {visibleEntries.length}{' '}
            {visibleEntries.length === 1 ? 'assessment is' : 'assessments are'} readable by your account across{' '}
            {assessedMembers} {assessedMembers === 1 ? 'member' : 'members'}.
          </p>
        </div>

        {manageableMembers.length > 0 && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Assess Member
          </button>
        )}
      </div>

      {/* Season target */}
      <div className="bg-gradient-to-r from-[#123B60] to-[#0A2239] rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="text-[10px] font-bold text-[#F59A16] uppercase tracking-wider">Chapter target for 2026–2027</span>
          <h2 className="text-lg font-bold mt-1">70% of active technical members at L2 or above by July</h2>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            A written goal from the season plan, edited below the header on the Season Planner page. Nothing schedules
            the assessments or picks next month&apos;s learning theme automatically — people record those here.
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0 bg-white/10 px-5 py-3 rounded-2xl border border-white/15">
          <div className="text-right">
            <div className="text-2xl font-black text-[#F59A16]">{l2PlusShare === null ? '—' : `${l2PlusShare}%`}</div>
            <div className="text-[10px] text-slate-300">of recorded assessments at L2+</div>
          </div>
          <div className="w-12 h-12 rounded-full border-4 border-[#F59A16] border-t-white flex items-center justify-center font-bold text-xs">
            {l2PlusEntries}/{visibleEntries.length}
          </div>
        </div>
      </div>

      {visibleEntries.length === 0 && (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 text-xs text-slate-600 dark:text-slate-300">
          Nothing is measured against that target yet. The percentage stays blank rather than showing 0%, because zero
          assessments is not the same finding as zero members reaching L2.
        </p>
      )}

      {/* Search and filters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="search"
            aria-label="Search assessments by member or evidence"
            placeholder="Search by member name or assessment evidence..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-[#123B60]"
          />
        </div>

        <select
          value={skillFilter}
          onChange={(e) => setSkillFilter(e.target.value)}
          aria-label="Filter by competency area"
          className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs bg-slate-50 dark:bg-slate-800 font-medium outline-none"
        >
          <option value="all">All competency areas</option>
          {SKILL_AREAS.map((area) => (
            <option key={area} value={area}>{area}</option>
          ))}
        </select>
      </div>

      {/* Assessment cards */}
      {visibleEntries.length === 0 ? (
        <EmptyState
          title="No skill assessments recorded"
          description={
            manageableMembers.length > 0
              ? 'Use "Assess Member" to write the first one. Levels change only when an assessor records them — no score exists until then.'
              : 'Assessments are written by someone holding the skills capability for the member\'s committee. Your role can read this page but not add to it.'
          }
          icon={UserSearch}
        />
      ) : filteredEntries.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-400">
          {visibleEntries.length} assessment{visibleEntries.length === 1 ? '' : 's'} exist
          {searchTerm ? ` for the term "${searchTerm}"` : ''}
          {skillFilter !== 'all' ? ` in ${skillFilter}` : ''}, but none match both filters.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEntries.map((entry) => {
            const mayEditLevel = can('skills.manage', { committeeId: entry.committeeId });
            return (
              <div
                key={entry.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-xs font-bold text-[#123B60] dark:text-[#F59A16]">
                      {entry.skillName}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full font-black text-xs text-slate-700 dark:text-slate-100 ${
                      entry.level === 'L4' ? 'bg-purple-100 dark:bg-purple-900/40' :
                      entry.level === 'L3' ? 'bg-emerald-100 dark:bg-emerald-900/40' :
                      entry.level === 'L2' ? 'bg-blue-100 dark:bg-blue-900/40' :
                      'bg-slate-100 dark:bg-slate-800'
                    }`}>
                      {entry.level}
                    </span>
                  </div>

                  <h2 className="text-base font-bold text-slate-900 dark:text-white">{entry.memberName}</h2>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {committeeName(entry.committeeId)} • assessed {entry.lastAssessment} by {entry.assessorName}
                  </div>

                  <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 text-xs space-y-2">
                    <div>
                      <span className="font-bold text-slate-700 dark:text-slate-300 block text-[10px] uppercase">Evidence cited by the assessor:</span>
                      <p className="text-slate-600 dark:text-slate-400 mt-0.5">{entry.evidence || 'None recorded.'}</p>
                    </div>
                    <div>
                      <span className="font-bold text-slate-700 dark:text-slate-300 block text-[10px] uppercase">Goal for the next cycle:</span>
                      <p className="text-[#123B60] dark:text-[#F59A16] font-medium mt-0.5">{entry.improvementGoal || 'None recorded.'}</p>
                    </div>
                  </div>
                </div>

                {mayEditLevel && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 mt-4 flex items-center justify-between gap-2 text-xs">
                    <label htmlFor={`level-${entry.id}`} className="text-[11px] text-slate-400">Record level:</label>
                    <select
                      id={`level-${entry.id}`}
                      value={entry.level}
                      onChange={(e) => changeLevel(entry, e.target.value)}
                      className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 font-bold text-xs outline-none"
                    >
                      {LEVELS.map((level) => (
                        <option key={level} value={level}>{level} — {LEVEL_DESCRIPTIONS[level].split('—')[0].trim()}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add assessment modal */}
      <ModalShell open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Record Member Skill Assessment</h2>
          <button onClick={() => setIsAddModalOpen(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleCreate} className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="assess-member">Select member</label>
            <select
              id="assess-member"
              required
              value={newEntry.memberId}
              onChange={(e) => setNewEntry({ ...newEntry, memberId: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            >
              <option value="" disabled>Choose a member…</option>
              {manageableMembers.map((u: User) => (
                <option key={u.id} value={u.id}>{u.name} ({committeeName(u.committeeId ?? '')})</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">
              Only members your skills capability reaches are listed — {manageableMembers.length} of {users.length}{' '}
              readable accounts.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="assess-area">Competency area</label>
              <select
                id="assess-area"
                value={newEntry.skillName}
                onChange={(e) => setNewEntry({ ...newEntry, skillName: e.target.value as SkillMatrixEntry['skillName'] })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
              >
                {SKILL_AREAS.map((area) => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="assess-level">Assessment level</label>
              <select
                id="assess-level"
                value={newEntry.level}
                onChange={(e) => setNewEntry({ ...newEntry, level: e.target.value as SkillMatrixEntry['level'] })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none font-bold text-[#123B60]"
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>{level} — {LEVEL_DESCRIPTIONS[level].split('—')[0].trim()}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 -mt-1">{LEVEL_DESCRIPTIONS[newEntry.level]}.</p>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="assess-evidence">Evidence reviewed by the assessor</label>
            <textarea
              id="assess-evidence"
              required
              rows={2}
              value={newEntry.evidence}
              onChange={(e) => setNewEntry({ ...newEntry, evidence: e.target.value })}
              placeholder="What you saw or checked that supports this level…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1" htmlFor="assess-goal">Improvement goal for the next cycle</label>
            <textarea
              id="assess-goal"
              required
              rows={2}
              value={newEntry.improvementGoal}
              onChange={(e) => setNewEntry({ ...newEntry, improvementGoal: e.target.value })}
              placeholder="The next concrete step for this member…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold"
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
      </ModalShell>

    </div>
  );
};
