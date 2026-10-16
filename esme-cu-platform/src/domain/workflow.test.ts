// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REVIEW_POLICY,
  REVIEW_RUBRICS,
  assertTaskMove,
  canMoveSubmission,
  canMoveTask,
  checkRevisionFeedback,
  checkReview,
  nextTaskStatuses,
  rubricFor,
  scoreRubric,
  selfServiceMoves,
  type ReviewRejection,
} from './workflow';

const general = rubricFor(undefined);

/** Narrows the allowed/denied union so a test can read the reason it is asserting on. */
function refusal(verdict: ReviewRejection): string {
  if (verdict.allowed) throw new Error('Expected the review to be refused, but it was allowed.');
  return verdict.reason;
}

describe('task lifecycle', () => {
  it('walks the documented path and no other', () => {
    expect(nextTaskStatuses('assigned')).toEqual(['in_progress', 'submitted', 'cancelled']);
    expect(canMoveTask('assigned', 'approved')).toBe(false);
    expect(canMoveTask('in_progress', 'assigned')).toBe(false);
    expect(canMoveTask('submitted', 'under_review')).toBe(true);
    expect(canMoveTask('revision_requested', 'submitted')).toBe(true);
  });

  it('closes a decided task', () => {
    for (const closed of ['approved', 'rejected', 'cancelled'] as const) {
      expect(nextTaskStatuses(closed)).toEqual([]);
      expect(canMoveTask(closed, 'in_progress')).toBe(false);
    }
  });

  it('names the allowed next states when a move is refused', () => {
    expect(() => assertTaskMove('approved', 'submitted')).toThrow(/cannot go from "approved" to "submitted"/);
    expect(() => assertTaskMove('approved', 'submitted')).toThrow(/already closed/);
    expect(() => assertTaskMove('draft', 'approved')).toThrow(/allowed next: assigned, cancelled/);
    expect(() => assertTaskMove('submitted', 'approved')).not.toThrow();
  });

  it('lets an overdue task recover but not skip straight to approval', () => {
    expect(canMoveTask('overdue', 'submitted')).toBe(true);
    expect(canMoveTask('overdue', 'approved')).toBe(false);
  });

  it('leaves an assignee only the moves that are theirs to make', () => {
    expect(selfServiceMoves('assigned')).toEqual(['in_progress', 'cancelled']);
    expect(selfServiceMoves('in_progress')).toEqual(['cancelled']);
    // Once work is filed, only the delivery flow moves it — never the person holding the card.
    expect(selfServiceMoves('submitted')).toEqual([]);
    expect(selfServiceMoves('under_review')).toEqual([]);
    expect(selfServiceMoves('revision_requested')).toEqual(['in_progress', 'cancelled']);
    expect(selfServiceMoves('approved')).toEqual([]);
  });
});

describe('submission lifecycle', () => {
  it('only accepts a new attempt after a revision request', () => {
    expect(canMoveSubmission('submitted', 'under_review')).toBe(true);
    expect(canMoveSubmission('revision_requested', 'submitted')).toBe(true);
    expect(canMoveSubmission('revision_requested', 'approved')).toBe(false);
    expect(canMoveSubmission('approved', 'rejected')).toBe(false);
    expect(canMoveSubmission('rejected', 'submitted')).toBe(false);
  });
});

describe('review rubrics', () => {
  it('maps a task category to its documented criteria, general otherwise', () => {
    expect(rubricFor('Workshop')).toBe(REVIEW_RUBRICS.Workshop);
    expect(rubricFor('Magazine Issue')).toBe(REVIEW_RUBRICS['Magazine Issue']);
    expect(rubricFor('Does Not Exist')).toBe(rubricFor(undefined));
    expect(rubricFor(undefined).length).toBeGreaterThan(1);
  });

  it('scores only what was marked', () => {
    const result = scoreRubric(general, { [general[0].id]: 2, [general[1].id]: 1 });
    expect(result.assessed).toBe(2);
    expect(result.percent).toBe(75);
    expect(result.unassessed).toEqual([general[2].label]);
    expect(result.verdict).toBe('meets_standard');
  });

  it('reports no figure rather than zero when nothing is marked', () => {
    const result = scoreRubric(general, {});
    expect(result.percent).toBeNull();
    expect(result.verdict).toBe('insufficient_evidence');
    expect(result.unassessed).toHaveLength(general.length);
  });

  it('treats every marked criterion as 0 without dropping it from the denominator', () => {
    const result = scoreRubric(general, Object.fromEntries(general.map((c) => [c.id, 0])));
    expect(result.percent).toBe(0);
    expect(result.verdict).toBe('below_standard');
  });

  it('draws the verdict lines at 75 and 50', () => {
    const four = rubricFor('Workshop');
    expect(scoreRubric(four, { [four[0].id]: 2, [four[1].id]: 1 }).percent).toBe(75);
    expect(scoreRubric(four, { [four[0].id]: 2, [four[1].id]: 1, [four[2].id]: 1, [four[3].id]: 0 }).percent).toBe(50);
    expect(scoreRubric(four, { [four[0].id]: 2, [four[1].id]: 1, [four[2].id]: 1, [four[3].id]: 0 }).verdict).toBe('borderline');
    expect(scoreRubric(four, { [four[0].id]: 1, [four[1].id]: 1 }).percent).toBe(50);
    expect(scoreRubric(four, { [four[0].id]: 1, [four[1].id]: 0 }).percent).toBe(25);
  });
});

describe('review policy', () => {
  const author = 'usr_author';
  const submission = { memberId: author, status: 'submitted' as const };
  const marked = scoreRubric(general, { [general[0].id]: 2, [general[1].id]: 2 });
  const oneMark = scoreRubric(general, { [general[0].id]: 2 });

  it('refuses an author approving their own work while independent review is required', () => {
    expect(checkReview(author, submission, 'approved', marked).allowed).toBe(false);
    expect(refusal(checkReview(author, submission, 'approved', marked))).toMatch(/Independent review/);
    expect(checkReview('usr_other', submission, 'approved', marked).allowed).toBe(true);
  });

  it('still lets the author send their own work back for revision', () => {
    expect(checkReview(author, submission, 'revision_requested', oneMark).allowed).toBe(true);
  });

  it('refuses an approval that has no rubric evidence', () => {
    expect(checkReview('usr_other', submission, 'approved', scoreRubric(general, {})).allowed).toBe(false);
  });

  it('refuses an approval below the minimum criteria coverage', () => {
    expect(refusal(checkReview('usr_other', submission, 'approved', oneMark))).toMatch(/at least 2 rubric criteria/);
    expect(DEFAULT_REVIEW_POLICY.minRubricCriteria).toBe(2);
  });

  it('refuses a move the submission lifecycle does not allow', () => {
    expect(checkReview('usr_other', { ...submission, status: 'approved' }, 'rejected', marked).allowed).toBe(false);
    expect(checkReview('usr_other', { ...submission, status: 'revision_requested' }, 'approved', marked).allowed).toBe(false);
  });

  it('does not gate rejection on the rubric', () => {
    expect(checkReview('usr_other', submission, 'rejected', scoreRubric(general, {})).allowed).toBe(true);
  });

  it('can be relaxed by configuration, but an approval always needs some rubric evidence', () => {
    const lenient = { independentReview: false, minRubricCriteria: 0 };
    expect(checkReview(author, submission, 'approved', oneMark, lenient).allowed).toBe(true);
    expect(refusal(checkReview(author, submission, 'approved', scoreRubric(general, {}), lenient))).toMatch(/no documented basis/);
    expect(checkReview('usr_other', { ...submission, status: 'rejected' }, 'approved', marked, lenient).allowed).toBe(false);
  });
});

describe('revision feedback', () => {
  it('requires something the member can act on', () => {
    expect(checkRevisionFeedback(undefined).allowed).toBe(false);
    expect(checkRevisionFeedback('   ').allowed).toBe(false);
    expect(checkRevisionFeedback('fix the logo').allowed).toBe(false);
    expect(checkRevisionFeedback('The attendance sheet is missing; re-upload it with signatures.').allowed).toBe(true);
  });

  it('counts characters after trimming', () => {
    const exactly = 'x'.repeat(15);
    expect(checkRevisionFeedback(`  ${exactly}  `).allowed).toBe(true);
    expect(checkRevisionFeedback('x'.repeat(14)).allowed).toBe(false);
  });
});
