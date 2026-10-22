// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  CourseCompletion,
  DevelopmentFeedback,
  DevelopmentGoal,
  SkillMatrixEntry,
  SkillRequirement,
  TrainingCourse,
  User,
} from '../types';
import {
  EVIDENCE_MIN_CHARS,
  actionableGaps,
  appliesTo,
  assertEvidence,
  currentLevel,
  developmentHistory,
  feedbackVisibleTo,
  levelIndex,
  notAssessed,
  progressReport,
  recommendCourses,
  requirementGaps,
} from './development';

/**
 * Spec B: a level is only ever what an assessor wrote down, a gap is only ever measured
 * against a recorded level, and an unassessed member is reported as unassessed — never as L0
 * and never inferred from tasks, points or attendance.
 */

const EVIDENCE = 'Reviewed the fracture report she wrote and walked the rig with her.';

function assessment(patch: Partial<SkillMatrixEntry> & Pick<SkillMatrixEntry, 'memberId' | 'skillName' | 'level'>): SkillMatrixEntry {
  return {
    id: `sk_${patch.memberId}_${patch.skillName}`,
    memberName: 'Member One',
    committeeId: 'c1',
    lastAssessment: '2026-10-01',
    assessorName: 'Head One',
    evidence: EVIDENCE,
    improvementGoal: '',
    ...patch,
  };
}

function member(patch: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'Member One',
    email: 'm1@esme.local',
    username: 'm1',
    role: 'member',
    committeeId: 'c1',
    status: 'active',
    totalPoints: 0,
    approvedTasksCount: 0,
    joinedDate: '2026-09-01',
    lastActive: '2026-10-01',
    ...patch,
  };
}

function requirement(patch: Partial<SkillRequirement> & Pick<SkillRequirement, 'id' | 'skillName' | 'minLevel'>): SkillRequirement {
  return { rationale: 'Lab rota coverage', ...patch };
}

function course(patch: Partial<TrainingCourse> & Pick<TrainingCourse, 'id' | 'skillName'>): TrainingCourse {
  return { title: 'Course', provider: 'Chapter', hours: 4, levelTarget: 'L2', ...patch };
}

function completion(patch: Partial<CourseCompletion> & Pick<CourseCompletion, 'id' | 'memberId' | 'courseId'>): CourseCompletion {
  return { completedAt: '2026-10-05', evidence: 'Submitted the exercise sheet', recordedBy: 'Head One', ...patch };
}

function goal(patch: Partial<DevelopmentGoal> & Pick<DevelopmentGoal, 'id' | 'memberId' | 'skillName'>): DevelopmentGoal {
  return {
    fromLevel: 'L1',
    toLevel: 'L2',
    dueDate: '2026-12-01',
    status: 'open',
    note: '',
    ownerName: 'Head One',
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...patch,
  };
}

function feedback(patch: Partial<DevelopmentFeedback> & Pick<DevelopmentFeedback, 'id' | 'memberId'>): DevelopmentFeedback {
  return {
    committeeId: 'c1',
    authorId: 'h1',
    authorName: 'Head One',
    authorRole: 'head',
    kind: 'mentor',
    body: 'Second draft of the procedure was clear.',
    at: '2026-10-06T09:00:00.000Z',
    visibility: 'member',
    ...patch,
  };
}

describe('evidence gate', () => {
  it('lets a low level through with a short note', () => {
    expect(() => assertEvidence('L0', 'shadowed a session')).not.toThrow();
    expect(() => assertEvidence('L1', '')).not.toThrow();
  });

  it('refuses L2 and above without written evidence', () => {
    expect(() => assertEvidence('L2', 'looks good')).toThrow(/at least \d+ characters/);
    expect(() => assertEvidence('L4', '')).toThrow();
  });

  it('accepts L2 once the assessor describes what was checked', () => {
    expect(() => assertEvidence('L2', EVIDENCE)).not.toThrow();
    expect(EVIDENCE.trim().length).toBeGreaterThanOrEqual(EVIDENCE_MIN_CHARS);
  });

  it('counts characters after trimming, so padding does not qualify', () => {
    const padded = '   ';
    expect(() => assertEvidence('L3', `${'x'.repeat(EVIDENCE_MIN_CHARS - 10)}${padded}`)).toThrow();
  });
});

describe('reading a level', () => {
  it('returns null, not L0, for a skill nobody has assessed', () => {
    const rows = [assessment({ memberId: 'u1', skillName: 'Inspection & NDT', level: 'L2' })];
    expect(currentLevel(rows, 'u1', 'Inspection & NDT')).toBe('L2');
    expect(currentLevel(rows, 'u1', 'Presentation')).toBeNull();
    expect(currentLevel(rows, 'u2', 'Inspection & NDT')).toBeNull();
  });

  it('orders levels without treating an unassessed skill as the lowest', () => {
    expect(levelIndex('L0')).toBeLessThan(levelIndex('L2'));
    expect(levelIndex('L4')).toBe(4);
  });
});

describe('requirements and gaps', () => {
  it('applies a requirement by committee and role', () => {
    const m = member({ id: 'u1' });
    expect(appliesTo(requirement({ id: 'r1', skillName: 'Materials Science', minLevel: 'L2' }), m)).toBe(true);
    expect(appliesTo(requirement({ id: 'r2', skillName: 'Materials Science', minLevel: 'L2', committeeId: 'c2' }), m)).toBe(false);
    expect(appliesTo(requirement({ id: 'r3', skillName: 'Materials Science', minLevel: 'L2', role: 'head' }), m)).toBe(false);
    expect(appliesTo(requirement({ id: 'r4', skillName: 'Materials Science', minLevel: 'L2', role: 'member' }), m)).toBe(true);
  });

  it('keeps an unassessed skill out of the shortfall arithmetic', () => {
    const gaps = requirementGaps(
      [
        requirement({ id: 'r1', skillName: 'Materials Science', minLevel: 'L3' }),
        requirement({ id: 'r2', skillName: 'Presentation', minLevel: 'L2' }),
      ],
      [assessment({ memberId: 'u1', skillName: 'Materials Science', level: 'L1' })],
      member({ id: 'u1' })
    );
    const science = gaps.find((g) => g.skillName === 'Materials Science');
    expect(science?.current).toBe('L1');
    expect(science?.shortBy).toBe(2);
    const presentation = gaps.find((g) => g.skillName === 'Presentation');
    expect(presentation?.current).toBeNull();
    expect(presentation?.shortBy).toBeNull();
  });

  it('separates actionable gaps from the ones that only need an assessment', () => {
    const gaps = requirementGaps(
      [
        requirement({ id: 'r1', skillName: 'Materials Science', minLevel: 'L2' }),
        requirement({ id: 'r2', skillName: 'Presentation', minLevel: 'L2' }),
        requirement({ id: 'r3', skillName: 'Inspection & NDT', minLevel: 'L1' }),
      ],
      [
        assessment({ memberId: 'u1', skillName: 'Materials Science', level: 'L1' }),
        assessment({ memberId: 'u1', skillName: 'Inspection & NDT', level: 'L4' }),
      ],
      member({ id: 'u1' })
    );
    expect(actionableGaps(gaps).map((g) => g.skillName)).toEqual(['Materials Science']);
    expect(notAssessed(gaps).map((g) => g.skillName)).toEqual(['Presentation']);
  });

  it('carries the requirement rationale onto the gap so a plan can quote it', () => {
    const gaps = requirementGaps(
      [requirement({ id: 'r1', skillName: 'Technical Research', minLevel: 'L2', rationale: 'Literature review rota' })],
      [assessment({ memberId: 'u1', skillName: 'Technical Research', level: 'L1' })],
      member({ id: 'u1' })
    );
    expect(gaps[0].rationale).toBe('Literature review rota');
  });
});

describe('course recommendations', () => {
  const courses = [
    course({ id: 'k1', skillName: 'Materials Science', levelTarget: 'L1', title: 'Basics' }),
    course({ id: 'k2', skillName: 'Materials Science', levelTarget: 'L2', title: 'Practical' }),
    course({ id: 'k3', skillName: 'Materials Science', levelTarget: 'L4', title: 'Masterclass' }),
  ];

  it('offers an uncompleted course aimed at or below the required level', () => {
    const gaps = requirementGaps(
      [requirement({ id: 'r1', skillName: 'Materials Science', minLevel: 'L2' })],
      [assessment({ memberId: 'u1', skillName: 'Materials Science', level: 'L1' })],
      member({ id: 'u1' })
    );
    const recs = recommendCourses(gaps, courses, [], 'u1');
    expect(recs).toHaveLength(1);
    expect(recs[0].course.id).toBe('k1');
    expect(recs[0].reason).toContain('L1');
  });

  it('skips a course already completed and falls back to the next one', () => {
    const gaps = requirementGaps(
      [requirement({ id: 'r1', skillName: 'Materials Science', minLevel: 'L2' })],
      [assessment({ memberId: 'u1', skillName: 'Materials Science', level: 'L1' })],
      member({ id: 'u1' })
    );
    const recs = recommendCourses(gaps, courses, [completion({ id: 'c1', memberId: 'u1', courseId: 'k1' })], 'u1');
    expect(recs[0].course.id).toBe('k2');
  });

  it('recommends nothing for a gap in an area with no course, rather than an unrelated one', () => {
    const gaps = requirementGaps(
      [requirement({ id: 'r1', skillName: 'Project Management', minLevel: 'L2' })],
      [assessment({ memberId: 'u1', skillName: 'Project Management', level: 'L1' })],
      member({ id: 'u1' })
    );
    expect(recommendCourses(gaps, courses, [], 'u1')).toEqual([]);
  });

  it('recommends nothing for a skill that was never assessed', () => {
    const gaps = requirementGaps(
      [requirement({ id: 'r1', skillName: 'Materials Science', minLevel: 'L2' })],
      [],
      member({ id: 'u1' })
    );
    expect(recommendCourses(gaps, courses, [], 'u1')).toEqual([]);
  });
});

describe('development history', () => {
  it('interleaves assessments, completions, goals and feedback newest first', () => {
    const rows = developmentHistory({
      assessments: [assessment({ memberId: 'u1', skillName: 'Materials Science', level: 'L2', lastAssessment: '2026-10-02' })],
      courses: [course({ id: 'k1', skillName: 'Materials Science', title: 'Practical' })],
      completions: [completion({ id: 'c1', memberId: 'u1', courseId: 'k1', completedAt: '2026-10-04' })],
      goals: [goal({ id: 'g1', memberId: 'u1', skillName: 'Presentation', updatedAt: '2026-10-05T00:00:00.000Z' })],
      feedback: [feedback({ id: 'f1', memberId: 'u1', at: '2026-10-01T00:00:00.000Z' })],
      memberId: 'u1',
    });
    expect(rows.map((r) => r.kind)).toEqual(['goal', 'course', 'assessment', 'feedback']);
    expect(rows[1].summary).toContain('Practical');
    expect(rows[2].summary).toContain('L2');
  });

  it('says which record carries no evidence instead of dropping it', () => {
    const rows = developmentHistory({
      assessments: [assessment({ memberId: 'u1', skillName: 'Presentation', level: 'L1', evidence: '' })],
      courses: [],
      completions: [],
      goals: [],
      feedback: [],
      memberId: 'u1',
    });
    expect(rows[0].summary).toContain('none recorded');
  });

  it('shows nothing for a member with no records', () => {
    expect(
      developmentHistory({ assessments: [], courses: [], completions: [], goals: [], feedback: [], memberId: 'u9' })
    ).toEqual([]);
  });
});

describe('feedback visibility', () => {
  it('is private to the member and the author by default', () => {
    const f = feedback({ id: 'f1', memberId: 'u1', authorId: 'h1' });
    expect(feedbackVisibleTo(f, { id: 'u1', role: 'member', committeeId: 'c1' })).toBe(true);
    expect(feedbackVisibleTo(f, { id: 'h1', role: 'head', committeeId: 'c1' })).toBe(true);
    expect(feedbackVisibleTo(f, { id: 'u2', role: 'member', committeeId: 'c1' })).toBe(false);
    expect(feedbackVisibleTo(f, { id: 'd1', role: 'director', committeeId: 'c1' })).toBe(false);
  });

  it('opens to the committee only when the author marks it so, and only inside that committee', () => {
    const f = feedback({ id: 'f1', memberId: 'u1', authorId: 'h1', visibility: 'committee' });
    expect(feedbackVisibleTo(f, { id: 'u2', role: 'member', committeeId: 'c1' })).toBe(true);
    expect(feedbackVisibleTo(f, { id: 'h2', role: 'head', committeeId: 'c2' })).toBe(false);
  });

  it('never leaks a committee-visible note to another committee through a missing committee id', () => {
    const f = feedback({ id: 'f1', memberId: 'u1', authorId: 'h1', visibility: 'committee', committeeId: undefined });
    expect(feedbackVisibleTo(f, { id: 'u2', role: 'member', committeeId: 'c1' })).toBe(false);
  });
});

describe('progress report', () => {
  const assessments = [
    assessment({ memberId: 'u1', skillName: 'Materials Science', level: 'L2' }),
    assessment({ memberId: 'u1', skillName: 'Presentation', level: 'L1' }),
    assessment({ memberId: 'u2', skillName: 'Inspection & NDT', level: 'L3' }),
  ];

  it('counts the L2+ share over recorded assessments inside the scope', () => {
    const report = progressReport({
      members: [member({ id: 'u1' }), member({ id: 'u2' })],
      assessments,
      goals: [goal({ id: 'g1', memberId: 'u1', skillName: 'Presentation', status: 'open' })],
      completions: [completion({ id: 'c1', memberId: 'u1', courseId: 'k1' })],
      scopeLabel: 'Operations',
    });
    expect(report.members).toBe(2);
    expect(report.assessedMembers).toBe(2);
    expect(report.assessments).toBe(3);
    expect(report.l2Plus).toBe(2);
    expect(report.l2PlusShare).toBe(67);
    expect(report.goalsOpen).toBe(1);
    expect(report.coursesCompleted).toBe(1);
  });

  it('reports null instead of 0% when nothing has been assessed', () => {
    const report = progressReport({
      members: [member({ id: 'u3' })],
      assessments,
      goals: [],
      completions: [],
      scopeLabel: 'Empty committee',
    });
    expect(report.assessments).toBe(0);
    expect(report.l2PlusShare).toBeNull();
    expect(report.members).toBe(1);
  });

  it('does not let records from outside the scope inflate the numbers', () => {
    const report = progressReport({
      members: [member({ id: 'u2' })],
      assessments,
      goals: [goal({ id: 'g1', memberId: 'u1', skillName: 'Presentation' })],
      completions: [completion({ id: 'c1', memberId: 'u1', courseId: 'k1' })],
      scopeLabel: 'One member',
    });
    expect(report.assessments).toBe(1);
    expect(report.goalsOpen).toBe(0);
    expect(report.coursesCompleted).toBe(0);
  });

  it('states the method so a reader can tell an unassessed member from an L0 one', () => {
    const report = progressReport({ members: [], assessments: [], goals: [], completions: [], scopeLabel: 'Chapter' });
    expect(report.method).toContain('never as L0');
  });
});
