// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  AuditLogItem,
  Committee,
  RegistrationApplication,
  SeasonEvent,
  SkillMatrixEntry,
  ScoreLedgerEntry,
  Task,
  TaskSubmission,
  User,
} from '../types';
import {
  OBJECTIVE_STATUS_LABEL,
  OKR_RULES,
  buildSeasonSnapshot,
  compareSnapshots,
  evaluateKeyResult,
  measureMetric,
  rollupObjective,
  seasonCovering,
  seasonElapsedFraction,
  seasonWindow,
  seasonsInOrder,
  type ChapterSeason,
  type KeyResult,
  type Objective,
  type OkrData,
} from './seasons';
import { inPeriod } from './metrics';

/**
 * Specs E and F: an objective is a claim measured against records inside a dated season.
 * The tests pin the honest cases — no baseline, no records, no key result — because a target
 * that cannot be measured must never be rendered as 0%.
 */

const SEASON: ChapterSeason = {
  id: 's27',
  label: '2026–2027',
  startDate: '2026-09-01',
  endDate: '2027-08-31',
  status: 'active',
  theme: 'Technical depth',
  handover: '',
  createdAt: '2026-09-01T08:00:00.000Z',
};

/** A season with roughly 40% of its days behind the as-of date, used by the pace rules. */
const HALFWAY: ChapterSeason = { ...SEASON, startDate: '2026-08-01', endDate: '2027-02-01' };

function keyResult(patch: Partial<KeyResult> & Pick<KeyResult, 'id'>): KeyResult {
  return {
    objectiveId: 'o1',
    label: 'Key result',
    metric: 'approval_rate',
    target: 70,
    baseline: null,
    direction: 'increase',
    scope: 'chapter',
    ...patch,
  };
}

function objective(patch: Partial<Objective> & Pick<Objective, 'id'>): Objective {
  return {
    seasonId: SEASON.id,
    title: 'Raise delivery quality',
    why: 'Reviews were uneven last season.',
    ownerName: 'Kareem Tamer',
    createdAt: '2026-09-05T08:00:00.000Z',
    updatedAt: '2026-09-05T08:00:00.000Z',
    ...patch,
  };
}

function submission(patch: Partial<TaskSubmission> & Pick<TaskSubmission, 'id'>): TaskSubmission {
  return {
    taskId: 't1',
    taskTitle: 'Task',
    committeeId: 'c1',
    committeeName: 'Operations',
    memberId: 'u2',
    memberName: 'Member Two',
    submittedAt: '2026-10-10T09:00:00.000Z',
    description: 'work',
    status: 'approved',
    proposedPoints: 10,
    version: 1,
    ...patch,
  };
}

function task(patch: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: 'Task',
    description: '',
    committeeId: 'c1',
    committeeName: 'Operations',
    assigneeIds: ['u2'],
    assigneeNames: ['Member Two'],
    createdById: 'u1',
    createdByName: 'Head',
    startDate: '2026-09-15',
    deadline: '2026-10-20',
    priority: 'medium',
    points: 10,
    status: 'in_progress',
    acceptanceCriteria: [],
    category: 'general',
    createdAt: '2026-09-01',
    ...patch,
  };
}

function committee(patch: Partial<Committee> & Pick<Committee, 'id' | 'name'>): Committee {
  return { shortCode: patch.name.slice(0, 3).toUpperCase(), description: '', objectives: [], subTeams: [], isPublic: true, status: 'active', category: 'technical', ...patch };
}

function member(patch: Partial<User> & Pick<User, 'id'>): User {
  return {
    name: 'Member Two',
    email: 'm2@esme.local',
    username: 'm2',
    role: 'member',
    committeeId: 'c1',
    status: 'active',
    totalPoints: 0,
    approvedTasksCount: 0,
    joinedDate: '2026-09-10',
    lastActive: '2026-10-15',
    ...patch,
  };
}

function assessment(patch: Partial<SkillMatrixEntry> & Pick<SkillMatrixEntry, 'id'>): SkillMatrixEntry {
  return {
    memberId: 'u2',
    memberName: 'Member Two',
    committeeId: 'c1',
    skillName: 'Materials Science',
    level: 'L2',
    lastAssessment: '2026-10-01',
    assessorName: 'Head',
    evidence: 'Walked the rig and reviewed the written report.',
    improvementGoal: '',
    ...patch,
  };
}

function ledgerRow(patch: Partial<ScoreLedgerEntry> & Pick<ScoreLedgerEntry, 'id'>): ScoreLedgerEntry {
  return {
    memberId: 'u2',
    memberName: 'Member Two',
    committeeId: 'c1',
    points: 10,
    actionType: 'task_completion',
    reviewerId: 'u1',
    reviewerName: 'Head',
    timestamp: '2026-10-11T09:00:00.000Z',
    reason: 'approved work',
    previousTotal: 0,
    newTotal: 10,
    ...patch,
  };
}

function application(patch: Partial<RegistrationApplication> & Pick<RegistrationApplication, 'id'>): RegistrationApplication {
  return {
    fullName: 'Applicant One',
    universityEmail: 'a1@student.esme.local',
    academicYear: '2026–2027',
    department: 'Mechanical',
    phone: '01000000000',
    preferredCommitteeId: 'c1',
    technicalSkills: 'CAD',
    previousExperience: 'none',
    motivation: 'wants to join',
    availabilityHours: '8',
    agreedToPolicies: true,
    appliedDate: '2026-10-01',
    status: 'pending',
    ...patch,
  };
}

function emptyData(patch: Partial<OkrData> = {}): OkrData {
  return {
    tasks: [],
    submissions: [],
    applications: [],
    ledger: [],
    users: [],
    committees: [],
    events: [],
    assessments: [],
    audit: [],
    asOf: '2026-10-16T09:00:00.000Z',
    ...patch,
  };
}

const WINDOW = seasonWindow(SEASON);

describe('season windows', () => {
  it('labels the window with the season it belongs to', () => {
    expect(WINDOW.from).toBe('2026-09-01');
    expect(WINDOW.to).toBe('2027-08-31');
    expect(WINDOW.label).toContain('2026–2027');
  });

  it('measures elapsed pace between the endpoints only', () => {
    expect(seasonElapsedFraction(SEASON, '2026-09-01T00:00:00.000Z')).toBe(0);
    expect(seasonElapsedFraction(SEASON, '2027-08-31T00:00:00.000Z')).toBe(1);
    expect(seasonElapsedFraction(SEASON, '2026-01-01T00:00:00.000Z')).toBe(0);
  });

  it('keeps a season that crosses the calendar year arithmetically whole', () => {
    const fraction = seasonElapsedFraction(SEASON, '2026-11-30T00:00:00.000Z');
    expect(fraction).not.toBeNull();
    expect(fraction!).toBeGreaterThan(0.2);
    expect(fraction!).toBeLessThan(0.3);
  });

  it('refuses to pace a season whose dates are inverted', () => {
    expect(seasonElapsedFraction({ ...SEASON, startDate: '2027-08-31', endDate: '2026-09-01' }, '2026-10-01')).toBeNull();
  });

  it('orders seasons and finds the one covering a date, or none', () => {
    const previous: ChapterSeason = { ...SEASON, id: 's26', label: '2025–2026', startDate: '2025-09-01', endDate: '2026-08-31' };
    expect(seasonsInOrder([SEASON, previous]).map((s) => s.id)).toEqual(['s26', 's27']);
    expect(seasonCovering([previous, SEASON], '2026-07-01')?.id).toBe('s26');
    expect(seasonCovering([SEASON], '2024-01-01')).toBeUndefined();
  });

  it('keeps records outside the window out of the calculation', () => {
    expect(inPeriod('2026-08-31T23:00:00.000Z', WINDOW)).toBe(false);
    expect(inPeriod('2026-09-01T00:00:00.000Z', WINDOW)).toBe(true);
    expect(inPeriod('2027-09-01T00:00:00.000Z', WINDOW)).toBe(false);
  });
});

describe('key result measurement', () => {
  it('runs the documented metric over the season window', () => {
    const reading = evaluateKeyResult(
      keyResult({ id: 'k1' }),
      emptyData({ submissions: [submission({ id: 'sub1' }), submission({ id: 'sub2', status: 'rejected' })] }),
      WINDOW
    );
    expect(reading.value.value).toBe(50);
    expect(reading.attainment).toBeCloseTo(50 / 70, 5);
    expect(reading.unmeasurable).toBeNull();
  });

  it('reports no records as unmeasurable rather than as 0%', () => {
    const reading = evaluateKeyResult(keyResult({ id: 'k1' }), emptyData(), WINDOW);
    expect(reading.value.value).toBeNull();
    expect(reading.attainment).toBeNull();
    expect(reading.unmeasurable).toBeTruthy();
  });

  it('excludes records from a different committee when the result is committee-scoped', () => {
    const data = emptyData({
      committees: [committee({ id: 'c1', name: 'Operations' }), committee({ id: 'c2', name: 'Media' })],
      submissions: [submission({ id: 'sub1', committeeId: 'c1' }), submission({ id: 'sub2', committeeId: 'c2', status: 'rejected' })],
    });
    expect(measureMetric('approval_rate', keyResult({ id: 'k1' }), data, WINDOW).value).toBe(50);
    const scoped = measureMetric('approval_rate', keyResult({ id: 'k2', scope: 'committee', committeeId: 'c1' }), data, WINDOW);
    expect(scoped.value).toBe(100);
    expect(scoped.recordIds).toEqual(['sub1']);
  });

  it('will not spread a committee metric chapter-wide', () => {
    const value = measureMetric('committee_load', keyResult({ id: 'k1', metric: 'committee_load' }), emptyData(), WINDOW);
    expect(value.value).toBeNull();
    expect(value.reason).toContain('per committee');
  });

  it('measures a falling target against its baseline, not against zero', () => {
    const data = emptyData({
      tasks: [
        task({ id: 't1', deadline: '2026-10-01' }),
        task({ id: 't2', deadline: '2026-10-05' }),
        task({ id: 't3', status: 'approved', deadline: '2026-10-05' }),
      ],
    });
    const reading = evaluateKeyResult(keyResult({ id: 'k1', metric: 'overdue_work', target: 1, baseline: 4, direction: 'decrease' }), data, WINDOW);
    expect(reading.value.value).toBe(2);
    expect(reading.attainment).toBeCloseTo((4 - 2) / (4 - 1), 5);
  });

  it('refuses to invent progress for a falling target with no baseline', () => {
    const reading = evaluateKeyResult(
      keyResult({ id: 'k1', metric: 'overdue_work', target: 0, baseline: null, direction: 'decrease' }),
      emptyData({ tasks: [task({ id: 't1', deadline: '2026-10-01' })] }),
      WINDOW
    );
    expect(reading.value.value).toBe(1);
    expect(reading.attainment).toBeNull();
    expect(reading.unmeasurable).toContain('starting point');
  });

  it('scores a falling target as met once it reaches it', () => {
    const reading = evaluateKeyResult(
      keyResult({ id: 'k1', metric: 'overdue_work', target: 0, baseline: 4, direction: 'decrease' }),
      emptyData({ tasks: [task({ id: 't1', status: 'approved' })] }),
      WINDOW
    );
    expect(reading.value.value).toBe(0);
    expect(reading.attainment).toBe(1);
  });

  it('caps attainment at 1 instead of letting overshoot imply more than finished', () => {
    const reading = evaluateKeyResult(keyResult({ id: 'k1' }), emptyData({ submissions: [submission({ id: 'sub1' })] }), WINDOW);
    expect(reading.value.value).toBe(100);
    expect(reading.attainment).toBe(1);
  });

  it('measures skill coverage from recorded assessments only', () => {
    const data = emptyData({
      assessments: [
        assessment({ id: 'a1', level: 'L2' }),
        assessment({ id: 'a2', level: 'L1' }),
        assessment({ id: 'a3', level: 'L3', evidence: '' }),
      ],
    });
    const reading = evaluateKeyResult(keyResult({ id: 'k1', metric: 'skill_coverage', target: 100 }), data, WINDOW);
    // One of three recorded assessments sits at L2+ with evidence; the unevidenced L3 is
    // excluded from proficiency, so the documented calculation returns 33%.
    expect(reading.value.value).toBe(33);
    expect(reading.value.excluded).toBe(1);
    expect(reading.attainment).toBeCloseTo(0.33, 5);
  });

  it('counts the recruitment queue, not submitted work, behind the backlog', () => {
    const data = emptyData({
      applications: [
        application({ id: 'ap1', status: 'pending' }),
        application({ id: 'ap2', status: 'under_review' }),
        application({ id: 'ap3', status: 'accepted' }),
      ],
    });
    expect(measureMetric('queue_backlog', keyResult({ id: 'k1', metric: 'queue_backlog', target: 0 }), data, WINDOW).value).toBe(2);
  });

  it('reads audit coverage from entries inside the season only', () => {
    const entry = (patch: Partial<AuditLogItem> & Pick<AuditLogItem, 'id'>): AuditLogItem => ({
      actorId: 'u1',
      actorName: 'Head',
      actorRole: 'head',
      action: 'Approved Submission',
      targetType: 'submission',
      targetId: 'sub1',
      details: '',
      timestamp: '2026-10-05 09:00',
      ...patch,
    });
    const data = emptyData({ audit: [entry({ id: 'aud1' }), entry({ id: 'aud2', timestamp: '2025-06-01 09:00' })] });
    const value = measureMetric('audit_coverage', keyResult({ id: 'k1', metric: 'audit_coverage', target: 2 }), data, WINDOW);
    expect(value.value).toBe(1);
    expect(value.recordIds).toEqual(['aud1']);
  });
});

describe('objective rollup', () => {
  const obj = objective({ id: 'o1' });

  it('says there is nothing to calculate when an objective has no key result', () => {
    const rollup = rollupObjective(obj, [], emptyData(), SEASON);
    expect(rollup.status).toBe('no_key_results');
    expect(rollup.attainment).toBeNull();
    expect(OBJECTIVE_STATUS_LABEL[rollup.status]).toBe('No key result yet');
  });

  it('keeps an unmeasurable objective unmeasurable instead of calling it behind', () => {
    const rollup = rollupObjective(obj, [keyResult({ id: 'k1' })], emptyData(), SEASON);
    expect(rollup.status).toBe('not_measurable');
    expect(rollup.attainment).toBeNull();
    expect(rollup.method).toContain('unmeasurable');
  });

  it('calls a pace below the elapsed season behind, and the stated slack at risk', () => {
    const data = emptyData({ ledger: [ledgerRow({ id: 'l1', points: 10 })] });
    const behind = rollupObjective(obj, [keyResult({ id: 'k1', metric: 'net_points', target: 40 })], data, HALFWAY);
    const atRisk = rollupObjective(obj, [keyResult({ id: 'k1', metric: 'net_points', target: 25 })], data, HALFWAY);
    const onTrack = rollupObjective(obj, [keyResult({ id: 'k1', metric: 'net_points', target: 20 })], data, HALFWAY);
    expect(behind.elapsed).toBeCloseTo(0.41, 2);
    expect(behind.attainment).toBe(0.25);
    expect(behind.status).toBe('behind');
    expect(OKR_RULES.atRiskSlack).toBe(0.15);
    expect([atRisk.status, onTrack.status]).toEqual(['at_risk', 'on_track']);
  });

  it('paces an early-season objective against the days actually elapsed', () => {
    const data = emptyData({ ledger: [ledgerRow({ id: 'l1', points: 10 })] });
    const rollup = rollupObjective(obj, [keyResult({ id: 'k1', metric: 'net_points', target: 40 })], data, {
      ...SEASON,
      startDate: '2026-09-01',
      endDate: '2027-08-31',
    });
    expect(rollup.elapsed).not.toBeNull();
    expect(rollup.elapsed!).toBeLessThan(0.2);
    expect(rollup.attainment).toBe(0.25);
    expect(rollup.status).toBe('on_track');
  });

  it('marks an objective achieved only when every key result has met its target', () => {
    const data = emptyData({
      submissions: [submission({ id: 'sub1' })],
      assessments: [assessment({ id: 'a1', level: 'L2' })],
    });
    const rollup = rollupObjective(
      obj,
      [keyResult({ id: 'k1', target: 100 }), keyResult({ id: 'k2', metric: 'skill_coverage', target: 100 })],
      data,
      SEASON
    );
    expect(rollup.status).toBe('achieved');
    expect(rollup.attainment).toBe(1);
  });

  it('does not average away an unmeasurable result while reporting the rest', () => {
    const data = emptyData({ submissions: [submission({ id: 'sub1' })] });
    const rollup = rollupObjective(obj, [keyResult({ id: 'k1', target: 100 }), keyResult({ id: 'k2', metric: 'net_points' })], data, SEASON);
    expect(rollup.readings).toHaveLength(2);
    expect(rollup.readings[1].attainment).toBeNull();
    expect(rollup.attainment).toBe(1);
    expect(rollup.method).toContain('1 of 2');
  });

  it('refuses to pace an objective before its season opens', () => {
    const rollup = rollupObjective(obj, [keyResult({ id: 'k1' })], emptyData(), {
      ...SEASON,
      status: 'planning',
      startDate: '2027-09-01',
      endDate: '2028-08-31',
    });
    expect(rollup.status).toBe('before_start');
    expect(OBJECTIVE_STATUS_LABEL[rollup.status]).toBe('Season not open');
  });
});

describe('season snapshot and continuity', () => {
  it('freezes the season figures with their method and record ids', () => {
    const snapshot = buildSeasonSnapshot(
      SEASON,
      emptyData({
        submissions: [submission({ id: 'sub1' }), submission({ id: 'sub2', status: 'rejected' })],
        assessments: [assessment({ id: 'a1' })],
        users: [member({ id: 'u2' }), member({ id: 'u9', joinedDate: '2027-09-01' })],
      })
    );
    const approval = snapshot.lines.find((l) => l.label === 'Approval rate');
    expect(approval?.value).toBe('50%');
    expect(approval?.recordIds).toEqual(['sub1']);
    expect(approval?.method).toContain('1 of 2');
    expect(snapshot.takenAt).toBe('2026-10-16T09:00:00.000Z');
    const joins = snapshot.lines.find((l) => l.label.includes('joined'));
    expect(joins?.value).toBe('1');
    expect(joins?.recordIds).toEqual(['u2']);
  });

  it('records a line as not measurable when the season held no such record', () => {
    const snapshot = buildSeasonSnapshot(SEASON, emptyData());
    expect(snapshot.lines.find((l) => l.label === 'Approval rate')?.value).toBe('not measurable');
    expect(snapshot.lines.find((l) => l.label === 'Milestone progress')?.value).toBe('not measurable');
    expect(snapshot.lines.find((l) => l.label === 'Members joined on or before the closing day')?.value).toBe('0');
  });

  it('compares a season against the one before, and says when there is none', () => {
    const current = buildSeasonSnapshot(SEASON, emptyData({ submissions: [submission({ id: 'sub1' })] }));
    expect(compareSnapshots(current, undefined).every((row) => row.previous === null)).toBe(true);
    const previous = buildSeasonSnapshot(
      { ...SEASON, id: 's26' },
      emptyData({ submissions: [submission({ id: 'p1' }), submission({ id: 'p2', status: 'rejected' })] })
    );
    const approval = compareSnapshots(current, previous).find((r) => r.label === 'Approval rate');
    expect(approval).toEqual({ label: 'Approval rate', current: '100%', previous: '50%' });
  });

  it('scopes milestones by the committee written on them', () => {
    const event: SeasonEvent = {
      id: 'e1',
      title: 'Rig workshop',
      category: 'Workshop',
      dateOrQuarter: 'Q1',
      status: 'Completed',
      targetMetric: '20 attendees',
      responsibleCommittee: 'Operations',
      description: '',
      isPublic: true,
    };
    const data = emptyData({
      committees: [committee({ id: 'c1', name: 'Operations' })],
      events: [event, { ...event, id: 'e2', status: 'Planned', responsibleCommittee: 'Media' }],
    });
    expect(measureMetric('milestone_progress', keyResult({ id: 'k1', metric: 'milestone_progress' }), data, WINDOW).value).toBe(50);
    expect(
      measureMetric('milestone_progress', keyResult({ id: 'k2', metric: 'milestone_progress', scope: 'committee', committeeId: 'c1' }), data, WINDOW).value
    ).toBe(100);
  });
});
