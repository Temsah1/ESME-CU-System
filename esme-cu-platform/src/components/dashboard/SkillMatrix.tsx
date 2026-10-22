import React, { useMemo, useState } from 'react';
import { Search, Plus, X, UserSearch, GraduationCap, Target, MessagesSquare, ListChecks } from 'lucide-react';
import { useApp, useActor } from '../../context/AppContext';
import { METRIC_DEFINITIONS } from '../../domain/metrics';
import { scopeFor } from '../../domain/roles';
import {
  actionableGaps,
  developmentHistory,
  feedbackVisibleTo,
  notAssessed,
  progressReport,
  recommendCourses,
  requirementGaps,
} from '../../domain/development';
import { ModalShell, useToast } from '../../motion';
import { EmptyState } from '../EmptyState';
import type { SkillMatrixEntry, User } from '../../types';

type SkillLevel = SkillMatrixEntry['level'];
type MatrixTab = 'matrix' | 'plan' | 'catalogue' | 'feedback';

const TABS: { id: MatrixTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'matrix', label: 'Assessments', icon: UserSearch },
  { id: 'plan', label: 'Development plan', icon: Target },
  { id: 'catalogue', label: 'Requirements & courses', icon: GraduationCap },
  { id: 'feedback', label: 'Mentor feedback', icon: MessagesSquare },
];

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
  const {
    skillMatrix,
    updateMemberSkill,
    addMemberSkill,
    skillRequirements,
    addSkillRequirement,
    courses,
    addCourse,
    courseCompletions,
    recordCourseCompletion,
    developmentGoals,
    addDevelopmentGoal,
    updateDevelopmentGoal,
    developmentFeedback,
    addDevelopmentFeedback,
    users,
    committees,
    keyResults,
    objectives,
    seasons,
    can,
  } = useApp();
  const currentUser = useActor();
  const { toast } = useToast();

  const [tab, setTab] = useState<MatrixTab>('matrix');
  const [searchTerm, setSearchTerm] = useState('');
  const [skillFilter, setSkillFilter] = useState('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [requirementForm, setRequirementForm] = useState({
    committeeId: '',
    skillName: 'Materials Science' as SkillMatrixEntry['skillName'],
    minLevel: 'L2' as SkillLevel,
    rationale: '',
  });
  const [courseForm, setCourseForm] = useState({
    skillName: 'Materials Science' as SkillMatrixEntry['skillName'],
    title: '',
    provider: '',
    hours: '4',
    levelTarget: 'L2' as SkillLevel,
  });
  const [completionForm, setCompletionForm] = useState({ memberId: '', courseId: '', evidence: '' });
  const [goalForm, setGoalForm] = useState({
    memberId: '',
    skillName: 'Materials Science' as SkillMatrixEntry['skillName'],
    toLevel: 'L2' as SkillLevel,
    dueDate: '',
    note: '',
  });
  const [feedbackForm, setFeedbackForm] = useState({
    memberId: '',
    kind: 'mentor' as 'mentor' | 'reviewer',
    body: '',
    visibility: 'member' as 'member' | 'committee',
  });
  const [openHistory, setOpenHistory] = useState<string | null>(null);

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

  const manageScope = scopeFor(currentUser.role, 'skills.manage');

  // The plan is written per person, so its audience is exactly the people this account's
  // read scope reaches — a member sees only themselves, a head only their own committee.
  const planMembers = useMemo(() => {
    if (readScope === 'self') return users.filter((u) => u.id === currentUser.id);
    if (readScope === 'committee') return users.filter((u) => u.committeeId && u.committeeId === currentUser.committeeId);
    return users;
  }, [users, readScope, currentUser.id, currentUser.committeeId]);

  const plans = useMemo(
    () =>
      planMembers.map((member) => {
        const gaps = requirementGaps(skillRequirements, skillMatrix, member);
        return {
          member,
          gaps,
          shortfalls: actionableGaps(gaps),
          unassessed: notAssessed(gaps),
          recommendations: recommendCourses(gaps, courses, courseCompletions, member.id),
          goals: developmentGoals.filter((g) => g.memberId === member.id),
          history: developmentHistory({
            assessments: skillMatrix.filter((a) => a.memberId === member.id),
            courses,
            completions: courseCompletions.filter((c) => c.memberId === member.id),
            goals: developmentGoals.filter((g) => g.memberId === member.id),
            feedback: developmentFeedback.filter((f) => f.memberId === member.id && feedbackVisibleTo(f, currentUser)),
            memberId: member.id,
          }),
        };
      }),
    [planMembers, skillRequirements, skillMatrix, courses, courseCompletions, developmentGoals, developmentFeedback, currentUser]
  );

  const scopeLabel =
    readScope === 'self'
      ? 'Your own records'
      : readScope === 'committee'
        ? committees.find((c) => c.id === currentUser.committeeId)?.name ?? 'your committee'
        : 'Whole chapter';

  const scopedReport = useMemo(
    () =>
      progressReport({
        members: planMembers,
        assessments: skillMatrix,
        goals: developmentGoals,
        completions: courseCompletions,
        scopeLabel,
      }),
    [planMembers, skillMatrix, developmentGoals, courseCompletions, scopeLabel]
  );

  /**
   * The headline target is a key result someone wrote under an objective, not a sentence this
   * screen remembers. It is read through the same committee rule the records use: a chapter-wide
   * skill_coverage result applies to anyone, a committee one only to its own members.
   */
  const skillTarget = useMemo(() => {
    const candidates = keyResults.filter(
      (kr) =>
        kr.metric === 'skill_coverage' &&
        (kr.scope === 'chapter' || !kr.committeeId || kr.committeeId === currentUser.committeeId)
    );
    const kr = candidates[0];
    if (!kr) return null;
    const objective = objectives.find((o) => o.id === kr.objectiveId);
    const season = seasons.find((s) => s.id === objective?.seasonId);
    return {
      label: kr.label,
      target: `${kr.target}${METRIC_DEFINITIONS.skill_coverage.unit}`,
      scopeLabel: kr.scope === 'chapter' ? 'Whole chapter' : committees.find((c) => c.id === kr.committeeId)?.name ?? 'One committee',
      owner: objective?.title ?? 'Objective not recorded',
      seasonLabel: season?.label ?? 'No dated season attached',
    };
  }, [keyResults, objectives, seasons, committees, currentUser.committeeId]);

  const visibleFeedback = useMemo(
    () => developmentFeedback.filter((f) => feedbackVisibleTo(f, currentUser)),
    [developmentFeedback, currentUser]
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

  const submitRequirement = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addSkillRequirement({
        committeeId: requirementForm.committeeId || undefined,
        skillName: requirementForm.skillName,
        minLevel: requirementForm.minLevel,
        rationale: requirementForm.rationale,
      });
      setRequirementForm({ ...requirementForm, rationale: '' });
      toast('Requirement published.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The requirement was not saved.', 'error');
    }
  };

  const submitCourse = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addCourse({
        skillName: courseForm.skillName,
        title: courseForm.title,
        provider: courseForm.provider,
        hours: Number(courseForm.hours),
        levelTarget: courseForm.levelTarget,
      });
      setCourseForm({ ...courseForm, title: '', provider: '' });
      toast('Course added to the catalogue.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The course was not added.', 'error');
    }
  };

  const submitCompletion = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      recordCourseCompletion({
        memberId: completionForm.memberId,
        courseId: completionForm.courseId,
        completedAt: new Date().toISOString(),
        evidence: completionForm.evidence,
      });
      setCompletionForm({ ...completionForm, evidence: '' });
      toast('Completion recorded. The level only moves when an assessor writes one.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The completion was not recorded.', 'error');
    }
  };

  const submitGoal = (e: React.FormEvent) => {
    e.preventDefault();
    const member = users.find((u) => u.id === goalForm.memberId);
    if (!member) {
      toast('Choose a member your account can plan for.', 'error');
      return;
    }
    const assessed = skillMatrix.find((a) => a.memberId === member.id && a.skillName === goalForm.skillName)?.level ?? 'L0';
    try {
      addDevelopmentGoal({
        memberId: member.id,
        skillName: goalForm.skillName,
        fromLevel: assessed,
        toLevel: goalForm.toLevel,
        dueDate: goalForm.dueDate,
        note: goalForm.note,
      });
      setGoalForm({ ...goalForm, dueDate: '', note: '' });
      toast('Goal opened.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The goal was not saved.', 'error');
    }
  };

  const submitFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      addDevelopmentFeedback({
        memberId: feedbackForm.memberId,
        kind: feedbackForm.kind,
        body: feedbackForm.body,
        visibility: feedbackForm.visibility,
      });
      setFeedbackForm({ ...feedbackForm, body: '' });
      toast(feedbackForm.visibility === 'committee' ? 'Note shared with the committee.' : 'Private note saved.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The note was not saved.', 'error');
    }
  };

  const closeGoal = (id: string, status: 'achieved' | 'dropped' | 'open') => {
    try {
      updateDevelopmentGoal(id, { status });
      toast(`Goal marked ${status}.`, 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The goal was not changed.', 'error');
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

        {tab === 'matrix' && manageableMembers.length > 0 && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Assess Member
          </button>
        )}
      </div>

      {/* Tabs — each one is a different record type, all read through the same skills scope. */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition border ${
              tab === id
                ? 'bg-[#123B60] text-white border-[#123B60] shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-[#F59A16]'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'matrix' && (
        <>
      {/* Season target */}
      <div className="bg-gradient-to-r from-[#123B60] to-[#0A2239] rounded-2xl p-6 text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <span className="text-[10px] font-bold text-[#F59A16] uppercase tracking-wider">
            {skillTarget ? `${skillTarget.scopeLabel} target · ${skillTarget.seasonLabel}` : 'No written skill target'}
          </span>
          <h2 className="text-lg font-bold mt-1">
            {skillTarget ? skillTarget.label : 'Nobody has set a skill coverage target yet'}
          </h2>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            {skillTarget ? (
              <>
                Recorded as a key result under the objective “{skillTarget.owner}”, with a target of{' '}
                {skillTarget.target}. It is edited on the Seasons &amp; Objectives page, not here — this screen only
                reads it, so the percentage below cannot drift from the number someone wrote down.
              </>
            ) : (
              <>
                A target is a key result on the metric “{METRIC_DEFINITIONS.skill_coverage.label}”, written on the
                Seasons &amp; Objectives page. Nothing is shown here until one exists, because a headline figure this
                screen invented would be a claim nobody made.
              </>
            )}{' '}
            Nothing schedules the assessments or picks next month&apos;s learning theme automatically — people record
            those here.
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
      </>
      )}

      {tab === 'plan' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Progress inside {scopedReport.scopeLabel.toLowerCase()}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mt-4">
              {[
                { label: 'Members in scope', value: scopedReport.members },
                { label: 'With ≥1 assessment', value: scopedReport.assessedMembers },
                { label: 'Assessments', value: scopedReport.assessments },
                { label: 'At L2+', value: scopedReport.l2PlusShare === null ? '—' : `${scopedReport.l2PlusShare}%` },
                { label: 'Goals open / achieved', value: `${scopedReport.goalsOpen} / ${scopedReport.goalsAchieved}` },
                { label: 'Completions', value: scopedReport.coursesCompleted },
              ].map((cell) => (
                <div key={cell.label} className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
                  <div className="text-lg font-black text-[#123B60] dark:text-[#F59A16]">{cell.value}</div>
                  <div className="text-[10px] text-slate-500 leading-tight">{cell.label}</div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-4">{scopedReport.method}</p>
          </div>

          {skillRequirements.length === 0 && (
            <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-300">
              No requirement has been written yet, so nobody can show a gap: the plan below lists {plans.length}{' '}
              {plans.length === 1 ? 'member' : 'members'} with nothing to compare against. Publish what each committee
              asks for under &quot;Requirements &amp; courses&quot; first.
            </p>
          )}

          {plans.length === 0 ? (
            <EmptyState
              title="No members in your scope"
              description="The plan reads the directory through the same skills scope as the matrix, so an account that can reach no member here sees no rows — not a chapter-wide list."
              icon={Target}
            />
          ) : (
            plans.map(({ member, shortfalls, unassessed, recommendations, goals, history }) => {
              const mayPlan = can('skills.read', { id: member.id, committeeId: member.committeeId });
              return (
                <div
                  key={member.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{member.name}</h3>
                      <p className="text-[10px] text-slate-400">
                        {committeeName(member.committeeId ?? '')} • {shortfalls.length}{' '}
                        {shortfalls.length === 1 ? 'shortfall' : 'shortfalls'} • {unassessed.length}{' '}
                        {unassessed.length === 1 ? 'skill' : 'skills'} not assessed
                      </p>
                    </div>
                    <button
                      onClick={() => setOpenHistory(openHistory === member.id ? null : member.id)}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300"
                    >
                      {openHistory === member.id ? 'Hide history' : `History (${history.length})`}
                    </button>
                  </div>

                  {shortfalls.length === 0 && unassessed.length === 0 && skillRequirements.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Nothing required of this member is currently short, based on the assessments on file. That is a
                      statement about recorded levels, not about ability.
                    </p>
                  )}

                  {unassessed.length > 0 && (
                    <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                        Asked for but never assessed
                      </div>
                      <ul className="mt-1.5 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                        {unassessed.map((g) => (
                          <li key={g.skillName}>
                            <span className="font-bold">{g.skillName}</span> — required {g.required}, no assessment on
                            file. This is an open question, not a shortfall.
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {shortfalls.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                            <th className="py-1.5 pr-3">Skill</th>
                            <th className="py-1.5 pr-3">Required</th>
                            <th className="py-1.5 pr-3">Recorded</th>
                            <th className="py-1.5 pr-3">Levels short</th>
                            <th className="py-1.5">Why it is required</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shortfalls.map((g) => (
                            <tr key={g.skillName} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="py-1.5 pr-3 font-bold text-slate-800 dark:text-slate-200">{g.skillName}</td>
                              <td className="py-1.5 pr-3">{g.required}</td>
                              <td className="py-1.5 pr-3">{g.current}</td>
                              <td className="py-1.5 pr-3 font-bold text-[#D47F0A]">{g.shortBy}</td>
                              <td className="py-1.5 text-slate-500">{g.rationale}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {recommendations.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Suggested from the catalogue — a suggestion, not a decision
                      </div>
                      <ul className="space-y-1.5">
                        {recommendations.map((rec) => (
                          <li key={`${member.id}-${rec.course.id}`} className="text-xs text-slate-600 dark:text-slate-300 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5">
                            <span className="font-bold text-slate-800 dark:text-slate-200">{rec.course.title}</span>
                            {' '}· {rec.course.provider}, {rec.course.hours}h · {rec.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {goals.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Goals</div>
                      {goals.map((g) => (
                        <div key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5">
                          <div className="text-xs">
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {g.skillName} {g.fromLevel} → {g.toLevel}
                            </span>
                            <span className="text-slate-400"> · due {g.dueDate} · {g.status}</span>
                            {g.note && <div className="text-[10px] text-slate-500 mt-0.5">{g.note}</div>}
                          </div>
                          {mayPlan && g.status === 'open' && (
                            <div className="flex gap-1.5">
                              <button onClick={() => closeGoal(g.id, 'achieved')} className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                Achieved
                              </button>
                              <button onClick={() => closeGoal(g.id, 'dropped')} className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold">
                                Dropped
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px] text-slate-400">
                        &quot;Achieved&quot; is refused unless an assessor has already recorded the target level — the
                        person who wrote the goal cannot close it.
                      </p>
                    </div>
                  )}

                  {openHistory === member.id && (
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                      {history.length === 0 ? (
                        <p className="text-xs text-slate-400">
                          Nothing recorded about this member&apos;s development yet — no assessment, course, goal or note.
                        </p>
                      ) : (
                        <ol className="space-y-1.5">
                          {history.map((h, i) => (
                            <li key={`${h.at}-${i}`} className="text-xs text-slate-600 dark:text-slate-300">
                              <span className="text-slate-400">{h.at.slice(0, 10)}</span> ·{' '}
                              <span className="font-bold uppercase text-[10px]">{h.kind}</span> · {h.summary}{' '}
                              <span className="text-slate-400">({h.actor})</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {planMembers.length > 0 && can('skills.read', { id: currentUser.id, committeeId: currentUser.committeeId }) && (
            <form onSubmit={submitGoal} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Open a goal</h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <select
                  aria-label="Member the goal belongs to"
                  required
                  value={goalForm.memberId}
                  onChange={(e) => setGoalForm({ ...goalForm, memberId: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="" disabled>Member…</option>
                  {planMembers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Competency area"
                  value={goalForm.skillName}
                  onChange={(e) => setGoalForm({ ...goalForm, skillName: e.target.value as SkillMatrixEntry['skillName'] })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  {SKILL_AREAS.map((area) => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
                <select
                  aria-label="Target level"
                  value={goalForm.toLevel}
                  onChange={(e) => setGoalForm({ ...goalForm, toLevel: e.target.value as SkillLevel })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
                <input
                  type="date"
                  required
                  aria-label="Due date"
                  value={goalForm.dueDate}
                  onChange={(e) => setGoalForm({ ...goalForm, dueDate: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
              </div>
              <input
                aria-label="Note for the goal"
                placeholder="What will change between the two levels?"
                value={goalForm.note}
                onChange={(e) => setGoalForm({ ...goalForm, note: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
              <p className="text-[10px] text-slate-400">
                The starting level is read from the assessment on file; a skill nobody has assessed starts at L0 and says
                so in the history. A goal that contradicts a recorded level is refused.
              </p>
              <div className="flex justify-end">
                <button type="submit" className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl">
                  Open goal
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === 'catalogue' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">What each level is asked to reach</h2>
            <p className="text-[10px] text-slate-400 mt-1">
              Requirements say what a committee or role needs. They never change a level — only an assessor&apos;s record does.
            </p>
            {skillRequirements.length === 0 ? (
              <p className="text-xs text-slate-500 mt-3">No requirement written yet.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {skillRequirements.map((r) => (
                  <li key={r.id} className="text-xs text-slate-600 dark:text-slate-300 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5">
                    <span className="font-bold text-slate-800 dark:text-slate-200">{r.skillName}</span> at {r.minLevel}{' '}
                    for {r.committeeId ? committeeName(r.committeeId) : 'every committee'}
                    {r.role ? ` · role ${r.role}` : ''} — {r.rationale}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {manageScope !== 'self' && (
            <form onSubmit={submitRequirement} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Publish a requirement</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <select
                  aria-label="Committee the requirement binds"
                  value={requirementForm.committeeId}
                  onChange={(e) => setRequirementForm({ ...requirementForm, committeeId: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="">Every committee</option>
                  {committees.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Competency area"
                  value={requirementForm.skillName}
                  onChange={(e) => setRequirementForm({ ...requirementForm, skillName: e.target.value as SkillMatrixEntry['skillName'] })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  {SKILL_AREAS.map((area) => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
                <select
                  aria-label="Minimum level"
                  value={requirementForm.minLevel}
                  onChange={(e) => setRequirementForm({ ...requirementForm, minLevel: e.target.value as SkillLevel })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
              <input
                required
                aria-label="Why this level is required"
                placeholder="Why is this level required? Not that it is, but why."
                value={requirementForm.rationale}
                onChange={(e) => setRequirementForm({ ...requirementForm, rationale: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
              <p className="text-[10px] text-slate-400">
                Only an account whose skills scope reaches the whole chapter may save a requirement that names no
                committee; the rest must pick one they belong to.
              </p>
              <div className="flex justify-end">
                <button type="submit" className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white text-xs font-bold rounded-xl">
                  Publish requirement
                </button>
              </div>
            </form>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Course catalogue</h2>
            {courses.length === 0 ? (
              <p className="text-xs text-slate-500 mt-3">
                Nothing in the catalogue, so the plan can point a gap at no course. Recommendations stay empty until a
                course is added.
              </p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {courses.map((c) => (
                  <li key={c.id} className="text-xs text-slate-600 dark:text-slate-300 rounded-lg bg-slate-50 dark:bg-slate-800/50 p-2.5">
                    <span className="font-bold text-slate-800 dark:text-slate-200">{c.title}</span> · {c.skillName} ·{' '}
                    {c.provider} · {c.hours}h · targets {c.levelTarget} ·{' '}
                    {courseCompletions.filter((k) => k.courseId === c.id).length} completion(s) recorded
                  </li>
                ))}
              </ul>
            )}
          </div>

          {manageScope === 'all' && (
            <form onSubmit={submitCourse} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Add a course</h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <input
                  required
                  aria-label="Course title"
                  placeholder="Title"
                  value={courseForm.title}
                  onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
                <input
                  required
                  aria-label="Who runs the course"
                  placeholder="Provider"
                  value={courseForm.provider}
                  onChange={(e) => setCourseForm({ ...courseForm, provider: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
                <input
                  required
                  type="number"
                  min="1"
                  aria-label="Hours"
                  value={courseForm.hours}
                  onChange={(e) => setCourseForm({ ...courseForm, hours: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                />
                <select
                  aria-label="Target level"
                  value={courseForm.levelTarget}
                  onChange={(e) => setCourseForm({ ...courseForm, levelTarget: e.target.value as SkillLevel })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  {LEVELS.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
              <select
                aria-label="Competency area"
                value={courseForm.skillName}
                onChange={(e) => setCourseForm({ ...courseForm, skillName: e.target.value as SkillMatrixEntry['skillName'] })}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              >
                {SKILL_AREAS.map((area) => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
              <div className="flex justify-end">
                <button type="submit" className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white text-xs font-bold rounded-xl">
                  Add course
                </button>
              </div>
            </form>
          )}

          {manageableMembers.length > 0 && courses.length > 0 && (
            <form onSubmit={submitCompletion} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Record a completion</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <select
                  required
                  aria-label="Member who completed it"
                  value={completionForm.memberId}
                  onChange={(e) => setCompletionForm({ ...completionForm, memberId: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="" disabled>Member…</option>
                  {manageableMembers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <select
                  required
                  aria-label="Course completed"
                  value={completionForm.courseId}
                  onChange={(e) => setCompletionForm({ ...completionForm, courseId: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="" disabled>Course…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </div>
              <textarea
                required
                rows={2}
                aria-label="Evidence for the completion"
                placeholder="What was submitted or shown?"
                value={completionForm.evidence}
                onChange={(e) => setCompletionForm({ ...completionForm, evidence: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
              <p className="text-[10px] text-slate-400">
                Saving this does not move anybody&apos;s level. Attendance is not evidence of competence, and the matrix
                stays where the assessor left it.
              </p>
              <div className="flex justify-end">
                <button type="submit" className="px-4 py-2 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl">
                  Record completion
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === 'feedback' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Notes you can read</h2>
            <p className="text-[10px] text-slate-400 mt-1">
              {visibleFeedback.length} of {developmentFeedback.length} note(s) in this workspace are visible to your
              account. A note marked private is readable only by the member it describes and the person who wrote it —
              never by a director on the strength of the role alone.
            </p>
            {visibleFeedback.length === 0 ? (
              <p className="text-xs text-slate-500 mt-3">No feedback recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {visibleFeedback.map((f) => (
                  <li key={f.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {f.kind === 'mentor' ? 'Mentor note' : 'Reviewer note'} · {users.find((u) => u.id === f.memberId)?.name ?? 'member no longer in the directory'}
                      </span>
                      <span className="text-[10px] text-slate-400">{f.at} · {f.visibility === 'committee' ? 'committee-visible' : 'private'}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 mt-1.5">{f.body}</p>
                    <p className="text-[10px] text-slate-400 mt-1.5">Written by {f.authorName} ({f.authorRole})</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {planMembers.length > 0 && (
            <form onSubmit={submitFeedback} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Write a note</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <select
                  required
                  aria-label="Member the note is about"
                  value={feedbackForm.memberId}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, memberId: e.target.value })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="" disabled>Member…</option>
                  {planMembers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <select
                  aria-label="Kind of note"
                  value={feedbackForm.kind}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, kind: e.target.value as 'mentor' | 'reviewer' })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="mentor">Mentor</option>
                  <option value="reviewer">Reviewer</option>
                </select>
                <select
                  aria-label="Who may read the note"
                  value={feedbackForm.visibility}
                  onChange={(e) => setFeedbackForm({ ...feedbackForm, visibility: e.target.value as 'member' | 'committee' })}
                  className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 outline-none"
                >
                  <option value="member">Only this member and me</option>
                  <option value="committee">My committee&apos;s leadership</option>
                </select>
              </div>
              <textarea
                required
                rows={3}
                aria-label="The note itself"
                placeholder="Something the member can act on…"
                value={feedbackForm.body}
                onChange={(e) => setFeedbackForm({ ...feedbackForm, body: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
              <p className="text-[10px] text-slate-400">
                Feedback is advice about work. It cannot raise or lower a level, and nothing on this page turns a note
                into a competency record.
              </p>
              <div className="flex justify-end">
                <button type="submit" className="px-4 py-2 bg-[#123B60] hover:bg-[#0A2239] text-white text-xs font-bold rounded-xl">
                  Save note
                </button>
              </div>
            </form>
          )}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2.5">
            <ListChecks className="w-4 h-4 shrink-0 text-[#F59A16] mt-0.5" />
            <span>
              Every writer on this page is checked against the member&apos;s committee on the way in, and each write
              leaves an audit entry. Records sit in this browser&apos;s own storage until a backend is configured — the
              delivery report lists what that still leaves unverified.
            </span>
          </div>
        </div>
      )}

    </div>
  );
};
