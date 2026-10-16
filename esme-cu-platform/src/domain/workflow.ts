import type { Task, TaskSubmission } from '../types';

/**
 * Delivery lifecycle. The UI offers these moves; nothing outside them is allowed, and a
 * decided submission cannot be reopened silently — a new attempt is a new version.
 */
const TASK_FLOW: Record<Task['status'], Task['status'][]> = {
  draft: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'submitted', 'cancelled'],
  in_progress: ['submitted', 'cancelled'],
  submitted: ['under_review', 'revision_requested', 'approved', 'rejected'],
  under_review: ['revision_requested', 'approved', 'rejected'],
  revision_requested: ['in_progress', 'submitted', 'cancelled'],
  approved: [],
  rejected: [],
  cancelled: [],
  overdue: ['in_progress', 'submitted', 'cancelled'],
};

const SUBMISSION_FLOW: Record<TaskSubmission['status'], TaskSubmission['status'][]> = {
  submitted: ['under_review', 'revision_requested', 'approved', 'rejected'],
  under_review: ['revision_requested', 'approved', 'rejected'],
  revision_requested: ['submitted'],
  approved: [],
  rejected: [],
};

export function nextTaskStatuses(from: Task['status']): Task['status'][] {
  return TASK_FLOW[from] ?? [];
}

/**
 * The only moves a person working the task may make themselves. Everything past
 * SUBMITTED belongs to the delivery flow and is reached by filing or reviewing, so a
 * status can never be typed into existence.
 */
export const SELF_SERVICE_TASK_MOVES: Task['status'][] = ['in_progress', 'cancelled'];

export function selfServiceMoves(from: Task['status']): Task['status'][] {
  return nextTaskStatuses(from).filter((status) => SELF_SERVICE_TASK_MOVES.includes(status));
}

export function canMoveTask(from: Task['status'], to: Task['status']): boolean {
  return nextTaskStatuses(from).includes(to);
}

export function canMoveSubmission(from: TaskSubmission['status'], to: TaskSubmission['status']): boolean {
  return (SUBMISSION_FLOW[from] ?? []).includes(to);
}

export function assertTaskMove(from: Task['status'], to: Task['status']): void {
  if (!canMoveTask(from, to)) {
    throw new Error(
      `A task cannot go from "${from.replace(/_/g, ' ')}" to "${to.replace(/_/g, ' ')}"` +
        (nextTaskStatuses(from).length ? ` — allowed next: ${nextTaskStatuses(from).join(', ')}.` : ' — it is already closed.')
    );
  }
}

export type ReviewDecision = Extract<TaskSubmission['status'], 'approved' | 'rejected' | 'revision_requested'>;

/**
 * Completion (a submission was filed) is recorded separately from approval and quality:
 * a filed task proves nothing about its standard, and an approved task carries a rubric.
 */
export type RubricCriterion = { id: string; label: string; guidance: string };

export const REVIEW_RUBRICS: Record<string, RubricCriterion[]> = {
  Workshop: [
    { id: 'brief', label: 'Learning brief', guidance: 'Audience, prerequisites and stated outcomes.' },
    { id: 'materials', label: 'Materials delivered', guidance: 'Slides, handouts and dataset or rig ready to use.' },
    { id: 'safety', label: 'Safety and logistics', guidance: 'Room, PPE, tooling and a fallback plan.' },
    { id: 'followup', label: 'Follow-up evidence', guidance: 'Attendance record and what participants produced.' },
  ],
  'Major Event': [
    { id: 'program', label: 'Programme', guidance: 'Sessions, speakers and timings confirmed in writing.' },
    { id: 'sponsors', label: 'Partners', guidance: 'Sponsor or faculty commitments recorded.' },
    { id: 'operations', label: 'Day-of operations', guidance: 'Registration, venue and contingency plan.' },
    { id: 'report', label: 'After-action report', guidance: 'Turnout, issues and lessons, with sources.' },
  ],
  'Magazine Issue': [
    { id: 'editorial', label: 'Editorial content', guidance: 'Articles sourced, attributed and fact-checked.' },
    { id: 'design', label: 'Layout', guidance: 'Approved template, readable figures, page proofs.' },
    { id: 'review', label: 'Technical review', guidance: 'Named reviewer for each technical article.' },
  ],
  'Field Campaign': [
    { id: 'reach', label: 'Reach', guidance: 'Counts collected on site, with method.' },
    { id: 'assets', label: 'Materials used', guidance: 'Stickers, merch or panels accounted for.' },
    { id: 'conduct', label: 'Conduct', guidance: 'Permission to activate on campus and any incidents.' },
  ],
  general: [
    { id: 'criteria', label: 'Acceptance criteria', guidance: 'Each written criterion addressed or excused.' },
    { id: 'evidence', label: 'Evidence', guidance: 'Links or files that show the work, not a description of it.' },
    { id: 'quality', label: 'Standard', guidance: 'Accuracy, completeness and presentation.' },
  ],
};

export function rubricFor(category: string | undefined): RubricCriterion[] {
  return REVIEW_RUBRICS[category ?? 'general'] ?? REVIEW_RUBRICS.general;
}

export type RubricMark = 0 | 1 | 2;

export type RubricResult = {
  percent: number | null;
  assessed: number;
  unassessed: string[];
  verdict: 'meets_standard' | 'borderline' | 'below_standard' | 'insufficient_evidence';
};

/** 2 = met, 1 = partly, 0 = not met, and an unmarked criterion is left out, never zeroed. */
export function scoreRubric(criteria: RubricCriterion[], marks: Record<string, RubricMark | null | undefined>): RubricResult {
  const scored = criteria.filter((c) => marks[c.id] === 0 || marks[c.id] === 1 || marks[c.id] === 2);
  const unassessed = criteria.filter((c) => !scored.includes(c)).map((c) => c.label);
  if (scored.length === 0) {
    return { percent: null, assessed: 0, unassessed, verdict: 'insufficient_evidence' };
  }
  const earned = scored.reduce((sum, c) => sum + (marks[c.id] as RubricMark), 0);
  const percent = Math.round((earned / (scored.length * 2)) * 100);
  return {
    percent,
    assessed: scored.length,
    unassessed,
    verdict: percent >= 75 ? 'meets_standard' : percent >= 50 ? 'borderline' : 'below_standard',
  };
}

export type ReviewPolicy = {
  /** When true, the person who filed the work cannot be the one who approves it. */
  independentReview: boolean;
  /** Minimum rubric coverage before an approval may be recorded. */
  minRubricCriteria: number;
};

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = { independentReview: true, minRubricCriteria: 2 };

export type ReviewRejection = { allowed: true } | { allowed: false; reason: string };

/**
 * Independent review is a policy question, not a courtesy: an author deciding their own
 * work is refused for approvals, while sending it back for revision always stays allowed.
 */
export function checkReview(
  actorId: string,
  submission: Pick<TaskSubmission, 'memberId' | 'status'>,
  decision: ReviewDecision,
  rubric: RubricResult,
  policy: ReviewPolicy = DEFAULT_REVIEW_POLICY
): ReviewRejection {
  if (!canMoveSubmission(submission.status, decision)) {
    return { allowed: false, reason: `A submission that is ${submission.status.replace(/_/g, ' ')} cannot be ${decision.replace(/_/g, ' ')} directly.` };
  }
  if (policy.independentReview && decision === 'approved' && actorId === submission.memberId) {
    return { allowed: false, reason: 'Independent review is required: you cannot approve your own submission. Ask another reviewer or return it for revision.' };
  }
  if (decision !== 'approved') return { allowed: true };
  // How many criteria must be marked is configurable; that some are is not.
  if (rubric.verdict === 'insufficient_evidence') {
    return { allowed: false, reason: 'The rubric has no marks, so there is no documented basis for approval.' };
  }
  if (rubric.assessed < policy.minRubricCriteria) {
    return { allowed: false, reason: `Approval needs at least ${policy.minRubricCriteria} rubric criteria assessed; ${rubric.assessed} were.` };
  }
  return { allowed: true };
}

/** Feedback is what makes a revision round usable, so a return without it is refused. */
export function checkRevisionFeedback(feedback: string | undefined): ReviewRejection {
  if (!feedback || feedback.trim().length < 15) {
    return { allowed: false, reason: 'Returning work for revision needs specific feedback of at least 15 characters.' };
  }
  return { allowed: true };
}
