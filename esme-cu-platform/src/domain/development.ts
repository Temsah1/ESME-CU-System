import type { DevelopmentFeedback, DevelopmentGoal, SkillRequirement, SkillMatrixEntry, TrainingCourse, CourseCompletion, User } from '../types';

/**
 * Spec B: competence is a claim about a person, so it is only ever recorded from evidence an
 * assessor looked at, and nothing in this module derives a level from task counts, points,
 * attendance or awards. A member with no assessment reads as "not assessed", never as L0.
 */

export type Level = SkillMatrixEntry['level'];
export const LEVELS: Level[] = ['L0', 'L1', 'L2', 'L3', 'L4'];

/** L2 is where a record says "this person can work alone", so it needs something written down. */
export const EVIDENCE_MIN_CHARS = 20;

export function levelIndex(level: Level): number {
  return LEVELS.indexOf(level);
}

export function assertEvidence(level: Level, evidence: string): void {
  const needed = levelIndex(level) >= levelIndex('L2');
  if (needed && evidence.trim().length < EVIDENCE_MIN_CHARS) {
    throw new Error(
      `${level} states the member works independently, so it needs at least ${EVIDENCE_MIN_CHARS} characters of evidence describing what the assessor checked.`
    );
  }
}

/**
 * The one place a level is read for a member. There is deliberately no sibling function that
 * infers a level from activity: 40 approved tasks prove volume, not competence.
 */
export function currentLevel(assessments: SkillMatrixEntry[], memberId: string, skillName: string): Level | null {
  const row = assessments.find((a) => a.memberId === memberId && a.skillName === skillName);
  return row ? row.level : null;
}

export type GapRow = {
  skillName: string;
  required: Level;
  current: Level | null;
  /** null when unassessed — the plan must say "not assessed", not "short by 2 levels". */
  shortBy: number | null;
  rationale: string;
};

/** Requirements that apply to this person: their committee's, their role's, or the chapter-wide ones. */
export function appliesTo(requirement: SkillRequirement, member: User): boolean {
  const committeeMatches = !requirement.committeeId || requirement.committeeId === member.committeeId;
  const roleMatches = !requirement.role || requirement.role === member.role;
  return committeeMatches && roleMatches;
}

export function requirementGaps(requirements: SkillRequirement[], assessments: SkillMatrixEntry[], member: User): GapRow[] {
  return requirements
    .filter((r) => appliesTo(r, member))
    .map((r) => {
      const current = currentLevel(assessments, member.id, r.skillName);
      return {
        skillName: r.skillName,
        required: r.minLevel,
        current,
        shortBy: current === null ? null : Math.max(0, levelIndex(r.minLevel) - levelIndex(current)),
        rationale: r.rationale,
      };
    });
}

/** A gap that can be planned for. An unassessed skill is a question, not a shortfall. */
export function actionableGaps(gaps: GapRow[]): GapRow[] {
  return gaps.filter((g) => g.current !== null && (g.shortBy ?? 0) > 0);
}

export function notAssessed(gaps: GapRow[]): GapRow[] {
  return gaps.filter((g) => g.current === null);
}

export function recommendCourses(
  gaps: GapRow[],
  courses: TrainingCourse[],
  completions: CourseCompletion[],
  memberId: string
): { course: TrainingCourse; forSkill: string; reason: string }[] {
  const done = new Set(completions.filter((c) => c.memberId === memberId).map((c) => c.courseId));
  return gaps
    .filter((g) => g.current !== null && (g.shortBy ?? 0) > 0)
    .map((gap) => {
      const candidates = courses
        .filter((c) => c.skillName === gap.skillName && !done.has(c.id))
        .sort((a, b) => levelIndex(a.levelTarget) - levelIndex(b.levelTarget));
      const course = candidates.find((c) => levelIndex(c.levelTarget) <= levelIndex(gap.required)) ?? candidates[0];
      if (!course) return null;
      return {
        course,
        forSkill: gap.skillName,
        reason: `Uncompleted course for ${gap.skillName}, targeting ${course.levelTarget} against the ${gap.required} this role requires.`,
      };
    })
    .filter((row): row is { course: TrainingCourse; forSkill: string; reason: string } => row !== null);
}

export type HistoryEntry = {
  at: string;
  kind: 'assessment' | 'course' | 'goal' | 'feedback';
  summary: string;
  actor: string;
};

/** One chronological view, newest first, of everything recorded about a member's development. */
export function developmentHistory(input: {
  assessments: SkillMatrixEntry[];
  courses: TrainingCourse[];
  completions: CourseCompletion[];
  goals: DevelopmentGoal[];
  feedback: DevelopmentFeedback[];
  memberId: string;
}): HistoryEntry[] {
  const rows: HistoryEntry[] = [
    ...input.assessments
      .filter((a) => a.memberId === input.memberId)
      .map((a) => ({
        at: a.lastAssessment,
        kind: 'assessment' as const,
        summary: `${a.skillName} assessed ${a.level}. Evidence: ${a.evidence || 'none recorded'}`,
        actor: a.assessorName,
      })),
    ...input.completions
      .filter((c) => c.memberId === input.memberId)
      .map((c) => ({
        at: c.completedAt,
        kind: 'course' as const,
        summary: `Completed ${input.courses.find((k) => k.id === c.courseId)?.title ?? 'a course'} — ${c.evidence}`,
        actor: c.recordedBy,
      })),
    ...input.goals
      .filter((g) => g.memberId === input.memberId)
      .map((g) => ({
        at: g.updatedAt,
        kind: 'goal' as const,
        summary: `${g.skillName}: ${g.fromLevel} → ${g.toLevel}, ${g.status}${g.note ? ` (${g.note})` : ''}`,
        actor: g.ownerName,
      })),
    ...input.feedback
      .filter((f) => f.memberId === input.memberId)
      .map((f) => ({ at: f.at, kind: 'feedback' as const, summary: `${f.kind}: ${f.body}`, actor: f.authorName })),
  ];
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Feedback is private to the member until the author marks it committee-visible. */
export function feedbackVisibleTo(feedback: DevelopmentFeedback, actor: Pick<User, 'id' | 'role' | 'committeeId'>): boolean {
  if (feedback.memberId === actor.id) return true;
  if (feedback.authorId === actor.id) return true;
  if (feedback.visibility === 'member') return false;
  const memberCommittee = feedback.committeeId;
  return memberCommittee !== undefined && memberCommittee === actor.committeeId;
}

export type ProgressReport = {
  scopeLabel: string;
  members: number;
  assessedMembers: number;
  assessments: number;
  l2Plus: number;
  /** null instead of 0: an unassessed group has no share, which is a different finding. */
  l2PlusShare: number | null;
  goalsOpen: number;
  goalsAchieved: number;
  coursesCompleted: number;
  method: string;
};

export function progressReport(input: {
  members: User[];
  assessments: SkillMatrixEntry[];
  goals: DevelopmentGoal[];
  completions: CourseCompletion[];
  scopeLabel: string;
}): ProgressReport {
  const ids = new Set(input.members.map((m) => m.id));
  const rows = input.assessments.filter((a) => ids.has(a.memberId));
  const assessed = new Set(rows.map((a) => a.memberId)).size;
  const l2Plus = rows.filter((a) => levelIndex(a.level) >= levelIndex('L2')).length;
  const goals = input.goals.filter((g) => ids.has(g.memberId));
  return {
    scopeLabel: input.scopeLabel,
    members: input.members.length,
    assessedMembers: assessed,
    assessments: rows.length,
    l2Plus,
    l2PlusShare: rows.length === 0 ? null : Math.round((l2Plus / rows.length) * 100),
    goalsOpen: goals.filter((g) => g.status === 'open').length,
    goalsAchieved: goals.filter((g) => g.status === 'achieved').length,
    coursesCompleted: input.completions.filter((c) => ids.has(c.memberId)).length,
    method:
      'L2+ share is recorded assessments at L2 or above over recorded assessments, inside this scope. Members with no assessment are counted in "members", never in the numerator, and never as L0.',
  };
}
