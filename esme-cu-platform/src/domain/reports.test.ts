// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  AuditLogItem,
  Committee,
  RegistrationApplication,
  ScoreLedgerEntry,
  SeasonEvent,
  SkillMatrixEntry,
  Task,
  TaskSubmission,
  User,
} from '../types';
import {
  REPORT_SECTIONS,
  buildReport,
  buildSheet,
  escapeHtml,
  looksLikeFormula,
  numeric,
  reportFileName,
  sanitizeCell,
  sectionsFor,
  toCsv,
  toPrintableHtml,
  type ReportActor,
  type ReportInput,
  type ReportSectionId,
  type ReportSheet,
} from './reports';
import { rollupObjective, type ChapterSeason, type KeyResult, type Objective, type OkrData } from './seasons';
import { METRIC_DEFINITIONS, type MetricValue, type Period } from './metrics';

/**
 * Spec I: an export is only trustworthy if the two things that can go wrong with it are pinned —
 * a spreadsheet that executes somebody's text, and a file that quietly carries records the reader
 * was never allowed to see. Every test below is about one of those.
 */

const PERIOD: Period = { label: 'Autumn term', from: '2026-09-01', to: '2026-12-01' };

const C1: Committee = {
  id: 'c1',
  name: 'Technical Committee',
  shortCode: 'TC',
  description: '',
  objectives: [],
  subTeams: [],
  isPublic: true,
  status: 'active',
  category: 'technical',
};
const C2: Committee = { ...C1, id: 'c2', name: 'Media Committee', shortCode: 'MC', category: 'media' };

const user = (patch: Partial<User> & Pick<User, 'id' | 'name' | 'role'>): User => ({
  email: `${patch.id}@esme.example`,
  username: patch.id,
  committeeId: 'c1',
  status: 'active',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-09-01',
  lastActive: '2026-10-01',
  ...patch,
});

const USERS: User[] = [
  user({ id: 'u1', name: 'Sam Member', role: 'member', totalPoints: 120, approvedTasksCount: 7 }),
  user({ id: 'u2', name: 'Rana Head', role: 'head', committeeId: 'c2', totalPoints: 40 }),
  user({ id: 'u3', name: '=HYPERLINK("http://evil", "click")', role: 'member' }),
];

const task = (patch: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
  description: '',
  committeeId: 'c1',
  committeeName: 'Technical Committee',
  assigneeIds: ['u1'],
  assigneeNames: ['Sam Member'],
  createdById: 'u2',
  createdByName: 'Rana Head',
  priority: 'medium',
  points: 20,
  startDate: '2026-09-05',
  deadline: '2026-09-30',
  status: 'approved',
  acceptanceCriteria: [],
  category: 'technical',
  createdAt: '2026-09-10T08:00:00.000Z',
  ...patch,
});

const TASKS: Task[] = [
  task({ id: 't1', title: 'Material testing protocol' }),
  task({ id: 't2', title: 'Spring field trip', createdAt: '2026-06-01T08:00:00.000Z' }),
  task({ id: 't3', title: '+SUM(A1:A9)', committeeId: 'c2', committeeName: 'Media Committee', assigneeIds: ['u2'], assigneeNames: ['Rana Head'] }),
];

const submission = (
  patch: Partial<TaskSubmission> & Pick<TaskSubmission, 'id' | 'memberId' | 'committeeId'>
): TaskSubmission => ({
  taskId: 't1',
  taskTitle: 'Material testing protocol',
  committeeName: 'Technical Committee',
  memberName: 'Sam Member',
  submittedAt: '2026-09-12T08:00:00.000Z',
  description: '',
  status: 'approved',
  rubricPercent: 80,
  reviewedBy: 'Rana Head',
  reviewedAt: '2026-09-13T08:00:00.000Z',
  proposedPoints: 25,
  awardedPoints: 30,
  version: 2,
  ...patch,
});

const SUBMISSIONS: TaskSubmission[] = [
  submission({ id: 's1', memberId: 'u1', committeeId: 'c1' }),
  submission({ id: 's2', memberId: 'u2', committeeId: 'c2', memberName: 'Rana Head', status: 'submitted', rubricPercent: null, awardedPoints: undefined, submittedAt: '2026-11-01T08:00:00.000Z' }),
];

const ledger = (patch: Partial<ScoreLedgerEntry> & Pick<ScoreLedgerEntry, 'id' | 'memberId' | 'committeeId'>): ScoreLedgerEntry => ({
  memberName: 'Sam Member',
  taskId: 't1',
  points: 30,
  actionType: 'task_completion',
  reviewerId: 'u2',
  reviewerName: 'Rana Head',
  timestamp: '2026-09-13 08:00',
  reason: 'Approved with rubric marks.',
  previousTotal: 90,
  newTotal: 120,
  ...patch,
});

const LEDGER: ScoreLedgerEntry[] = [
  ledger({ id: 'l1', memberId: 'u1', committeeId: 'c1' }),
  ledger({ id: 'l2', memberId: 'u2', committeeId: 'c2', memberName: 'Rana Head', timestamp: '2026-10-01 08:00' }),
  ledger({ id: 'l3', memberId: 'u1', committeeId: 'c1', timestamp: '2026-05-01 08:00' }),
];

const assess = (patch: Partial<SkillMatrixEntry> & Pick<SkillMatrixEntry, 'id' | 'memberId' | 'committeeId'>): SkillMatrixEntry => ({
  memberName: 'Sam Member',
  skillName: 'Materials Science',
  level: 'L2',
  lastAssessment: '2026-09-20',
  assessorName: 'Rana Head',
  evidence: 'Checked three coupon reports and signed the method.',
  improvementGoal: 'Run a full NDT cycle alone.',
  ...patch,
});

const ASSESSMENTS: SkillMatrixEntry[] = [
  assess({ id: 'a1', memberId: 'u1', committeeId: 'c1' }),
  assess({ id: 'a2', memberId: 'u2', committeeId: 'c2', memberName: 'Rana Head', level: 'L1', evidence: '' }),
];

const application = (
  patch: Partial<RegistrationApplication> & Pick<RegistrationApplication, 'id' | 'preferredCommitteeId'>
): RegistrationApplication => ({
  fullName: 'New Applicant',
  universityEmail: 'applicant@esme.example',
  academicYear: '2',
  department: 'Civil Engineering',
  phone: '01000000000',
  technicalSkills: '',
  previousExperience: '',
  motivation: '',
  availabilityHours: '10',
  agreedToPolicies: true,
  appliedDate: '2026-09-15',
  status: 'pending',
  ...patch,
});

const APPLICATIONS: RegistrationApplication[] = [
  application({ id: 'ap1', preferredCommitteeId: 'c1' }),
  application({ id: 'ap2', preferredCommitteeId: 'c2', status: 'accepted', fullName: '=1+1' }),
];

const audit = (patch: Partial<AuditLogItem> & Pick<AuditLogItem, 'id'>): AuditLogItem => ({
  actorId: 'u2',
  actorName: 'Rana Head',
  actorRole: 'head',
  action: 'Approved submission',
  targetType: 'submission',
  targetId: 's1',
  details: 'Rubric marked 80%.',
  timestamp: '2026-09-13 08:05',
  ...patch,
});

const AUDIT: AuditLogItem[] = [audit({ id: 'au1' }), audit({ id: 'au2', timestamp: '2026-05-02 08:05' })];

const EVENTS: SeasonEvent[] = [];

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

const OBJECTIVE: Objective = {
  id: 'o1',
  seasonId: SEASON.id,
  title: 'Raise delivery quality',
  why: 'Reviews were uneven last season.',
  ownerName: 'Rana Head',
  createdAt: '2026-09-05T08:00:00.000Z',
  updatedAt: '2026-09-05T08:00:00.000Z',
};

const kr = (patch: Partial<KeyResult> & Pick<KeyResult, 'id'>): KeyResult => ({
  objectiveId: OBJECTIVE.id,
  label: 'Approval rate above 70%',
  metric: 'approval_rate',
  target: 70,
  baseline: null,
  direction: 'increase',
  scope: 'chapter',
  ...patch,
});

const okrData = (): OkrData => ({
  tasks: TASKS,
  submissions: SUBMISSIONS,
  applications: APPLICATIONS,
  ledger: LEDGER,
  users: USERS,
  committees: [C1, C2],
  events: EVENTS,
  assessments: ASSESSMENTS,
  audit: AUDIT,
  asOf: '2026-11-01T08:00:00.000Z',
});

const ADMIN: ReportActor = { id: 'u_admin', name: 'Kareem Tamer', role: 'super_admin', committeeId: undefined };
const DIRECTOR: ReportActor = { id: 'u_dir', name: 'Dana Director', role: 'director', committeeId: 'c1' };
const MEMBER: ReportActor = { id: 'u1', name: 'Sam Member', role: 'member', committeeId: 'c1' };

function inputFor(actor: ReportActor, patch: Partial<ReportInput> = {}): ReportInput {
  return {
    actor,
    period: PERIOD,
    generatedAt: '2026-10-16T09:00:00.000Z',
    users: USERS,
    committees: [C1, C2],
    tasks: TASKS,
    submissions: SUBMISSIONS,
    ledger: LEDGER,
    assessments: ASSESSMENTS,
    applications: APPLICATIONS,
    audit: AUDIT,
    seasons: [SEASON],
    rollups: () => [],
    ...patch,
  };
}

const cell = (sheet: ReportSheet, row: number, column: string) => sheet.rows[row][sheet.columns.indexOf(column)];

describe('formula injection guard', () => {
  it('neutralises every character a spreadsheet would evaluate', () => {
    expect(sanitizeCell('=HYPERLINK("http://evil")')).toBe("'=HYPERLINK(\"http://evil\")");
    expect(sanitizeCell('@SUM(1,2)')).toBe("'@SUM(1,2)");
    expect(sanitizeCell('+1+1')).toBe("'+1+1");
    expect(sanitizeCell('-1+1')).toBe("'-1+1");
    expect(sanitizeCell('\t=1')).toBe("'\t=1");
    expect(sanitizeCell('\r=1')).toBe("'\r=1");
  });

  it('catches a lead character hidden behind spaces, because a cell is trimmed before evaluation', () => {
    expect(looksLikeFormula('   =cmd')).toBe(true);
    expect(looksLikeFormula('Ordinary title')).toBe(false);
    expect(looksLikeFormula('12 apples')).toBe(false);
  });

  it('leaves ordinary text and empty strings untouched', () => {
    expect(sanitizeCell('Materials Science')).toBe('Materials Science');
    expect(sanitizeCell('')).toBe('');
    expect(sanitizeCell(null)).toBeNull();
  });

  it('keeps numbers numeric, including a negative one, so a report can still be summed', () => {
    expect(sanitizeCell(-5)).toBe(-5);
    expect(numeric(-5)).toBe(-5);
    expect(numeric(Number.NaN)).toBeNull();
    expect(numeric(undefined)).toBeNull();
    expect(cell(buildSheet('members', inputFor(ADMIN))!, 0, 'Points')).toBe(120);
  });

  it('applies the guard to a member name, which is text somebody typed', () => {
    const sheet = buildSheet('members', inputFor(ADMIN))!;
    const row = sheet.rows.find((r) => String(r[0]).includes('HYPERLINK'))!;
    expect(String(row[0]).startsWith("'=")).toBe(true);
  });

  it('applies it again in CSV, where the file is plain text and Excel is the reader', () => {
    const csv = toCsv([buildSheet('applications', inputFor(ADMIN))!]);
    expect(csv).toContain("'=1+1");
  });
});

describe('capability gating', () => {
  it('builds nothing at all for a section this account cannot read', () => {
    expect(buildSheet('members', inputFor(MEMBER))).toBeNull();
    expect(buildSheet('audit', inputFor(MEMBER))).toBeNull();
    expect(buildSheet('applications', inputFor(MEMBER))).toBeNull();
    expect(buildSheet('kpi', inputFor(MEMBER))).toBeNull();
  });

  it('drops the unreadable sheets from the report instead of shipping empty ones', () => {
    const all = REPORT_SECTIONS.map((s) => s.id) as ReportSectionId[];
    const built = buildReport(all, inputFor(MEMBER));
    expect(built.map((s) => s.id).sort()).toEqual(['ledger', 'skills', 'submissions', 'tasks']);
    expect(built.every((s) => s.rows.length > 0)).toBe(true);
  });

  it('offers a super administrator every section and a member only their own four', () => {
    expect(sectionsFor(ADMIN)).toHaveLength(REPORT_SECTIONS.length);
    expect(sectionsFor(MEMBER).map((s) => s.id)).toEqual(['tasks', 'submissions', 'ledger', 'skills']);
    expect(sectionsFor(MEMBER).map((s) => s.label)).not.toContain('Audit trail');
  });

  it('names the capability that let each sheet through, so the file argues for itself', () => {
    const sheet = buildSheet('ledger', inputFor(DIRECTOR))!;
    expect(sheet.capability).toBe('scores.read');
    expect(sheet.notes[1]).toContain('Period: Autumn term');
  });
});

describe('row scope inside a readable section', () => {
  it('cuts a directory down to the actor’s committee', () => {
    const sheet = buildSheet('members', inputFor(DIRECTOR))!;
    const names = sheet.rows.map((r) => r[0]);
    expect(names).toContain('Sam Member');
    expect(names).not.toContain('Rana Head');
  });

  it('records the narrowed scope in the provenance rather than claiming the chapter', () => {
    expect(buildSheet('members', inputFor(DIRECTOR))!.notes[1]).toContain('Technical Committee only');
    expect(buildSheet('members', inputFor(ADMIN))!.notes[1]).toContain('Entire chapter');
    expect(buildSheet('ledger', inputFor(MEMBER))!.notes[1]).toContain("This account's own records only");
  });

  it('keeps a ledger row for the committee and drops the other committee plus the out-of-period one', () => {
    const sheet = buildSheet('ledger', inputFor(DIRECTOR))!;
    expect(sheet.rows.map((r) => r[0])).toEqual(['2026-09-13 08:00']);
  });

  it('shows a member only their own submissions and assessments', () => {
    expect(buildSheet('submissions', inputFor(MEMBER))!.rows).toHaveLength(1);
    expect(buildSheet('skills', inputFor(MEMBER))!.rows).toHaveLength(1);
    expect(buildSheet('submissions', inputFor(DIRECTOR))!.rows.map((r) => r[0])).toEqual(['s1']);
  });

  it('honours a tasks.read scope of all, which a director genuinely holds', () => {
    const sheet = buildSheet('tasks', inputFor(DIRECTOR))!;
    expect(sheet.rows.map((r) => r[0])).toEqual(['t1', 't3']);
  });

  it('filters the registration queue by the committee the application points at', () => {
    const sheet = buildSheet('applications', inputFor(DIRECTOR))!;
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0][1]).toBe('New Applicant');
  });

  it('never assumes a record without a committee belongs to the actor', () => {
    const orphan = buildSheet('members', inputFor(DIRECTOR, { users: [user({ id: 'u9', name: 'No Committee', role: 'member', committeeId: undefined })] }))!;
    expect(orphan.rows).toHaveLength(0);
    expect(orphan.notes[2]).toContain('0 row(s)');
  });

  it('reports an unknown committee id as unknown instead of hiding it', () => {
    const sheet = buildSheet('tasks', inputFor(ADMIN, { tasks: [task({ id: 'tx', title: 'Ghost committee', committeeId: 'nope' })] }))!;
    expect(sheet.rows[0][3]).toBe('unknown committee id');
  });
});

describe('period window', () => {
  it('lists only tasks created inside the window and says so', () => {
    const sheet = buildSheet('tasks', inputFor(ADMIN))!;
    expect(sheet.rows.map((r) => r[0])).toEqual(['t1', 't3']);
    expect(sheet.notes).toContain('Created-date filter: only tasks created inside the period are listed.');
  });

  it('keeps the audit trail inside the window', () => {
    expect(buildSheet('audit', inputFor(ADMIN))!.rows.map((r) => r[0])).toEqual(['2026-09-13 08:05']);
  });

  it('treats an open window as the whole record', () => {
    const open = inputFor(ADMIN, { period: { label: 'All time', from: null, to: null } });
    expect(buildSheet('tasks', open)!.rows).toHaveLength(3);
    expect(buildSheet('audit', open)!.rows).toHaveLength(2);
  });
});

describe('key figures sheet', () => {
  const reading = (patch: Partial<MetricValue> & Pick<MetricValue, 'id'>): MetricValue => ({
    value: 50,
    unit: 'count',
    eligible: 2,
    excluded: 1,
    recordIds: ['s1', 's2'],
    reason: 'Two decided submission(s).',
    ...patch,
  });

  it('writes the value, the records behind it and the method', () => {
    const sheet = buildSheet(
      'kpi',
      inputFor(ADMIN, { metricReadings: [reading({ id: 'approval_rate', unit: '%' })] })
    )!;
    expect(cell(sheet, 0, 'Metric')).toBe('Approval rate');
    expect(cell(sheet, 0, 'Value')).toBe(50);
    expect(cell(sheet, 0, 'Record ids')).toBe('s1, s2');
    expect(String(cell(sheet, 0, 'Method'))).toContain('approved / (approved + rejected)');
  });

  it('renders an unmeasurable metric as words, never as a zero', () => {
    const sheet = buildSheet('kpi', inputFor(ADMIN, { metricReadings: [reading({ id: 'net_points', value: null, unit: 'pts', eligible: 0, recordIds: [] })] }))!;
    expect(cell(sheet, 0, 'Value')).toBe('not measurable');
    expect(cell(sheet, 0, 'Record ids')).toBe('none');
  });

  it('is an empty sheet with an explanation when no reading was passed in', () => {
    const sheet = buildSheet('kpi', inputFor(ADMIN))!;
    expect(sheet.rows).toHaveLength(0);
    expect(sheet.notes.join(' ')).toContain('headers only');
  });
});

describe('objectives sheet', () => {
  it('carries one row per key result and keeps a not-measurable read as words', () => {
    const chapterLoad = kr({ id: 'k1', metric: 'committee_load', label: 'Balance the load' });
    const rollup = rollupObjective(OBJECTIVE, [chapterLoad], okrData(), SEASON);
    const sheet = buildSheet('objectives', inputFor(ADMIN, { rollups: () => [rollup] }))!;
    expect(sheet.rows).toHaveLength(1);
    expect(cell(sheet, 0, 'Read value')).toBe('not measurable');
    expect(String(cell(sheet, 0, 'Status'))).toBe('Not measurable');
    expect(String(cell(sheet, 0, 'Method'))).toContain('no single denominator');
    expect(cell(sheet, 0, 'Metric')).toBe(METRIC_DEFINITIONS.committee_load.label);
  });

  it('lists a readable value with its status label for a measurable result', () => {
    const rollup = rollupObjective(OBJECTIVE, [kr({ id: 'k2' })], okrData(), SEASON);
    const sheet = buildSheet('objectives', inputFor(ADMIN, { rollups: () => [rollup] }))!;
    expect(cell(sheet, 0, 'Metric')).toBe('Approval rate');
    expect(typeof cell(sheet, 0, 'Read value')).toBe('number');
    expect(String(cell(sheet, 0, 'Objective'))).toBe('Raise delivery quality');
  });

  it('says plainly when an objective has nothing attached, instead of inventing a reading', () => {
    const rollup = rollupObjective(OBJECTIVE, [], okrData(), SEASON);
    const sheet = buildSheet('objectives', inputFor(ADMIN, { rollups: () => [rollup] }))!;
    expect(cell(sheet, 0, 'Key result')).toBe('no key result attached');
    expect(String(cell(sheet, 0, 'Status'))).toBe('No key result yet');
  });

  it('keeps a chapter-wide objective visible to a committee-scoped director', () => {
    const rollup = rollupObjective(OBJECTIVE, [kr({ id: 'k3' })], okrData(), SEASON);
    const sheet = buildSheet('objectives', inputFor(DIRECTOR, { rollups: () => [rollup] }))!;
    expect(sheet.rows).toHaveLength(1);
  });

  it('hides another committee’s objective from a director', () => {
    const rollup = rollupObjective({ ...OBJECTIVE, committeeId: 'c2' }, [kr({ id: 'k4' })], okrData(), SEASON);
    const sheet = buildSheet('objectives', inputFor(DIRECTOR, { rollups: () => [rollup] }))!;
    expect(sheet.rows).toHaveLength(0);
  });

  it('is absent entirely for a role without analytics.configure', () => {
    expect(buildSheet('objectives', inputFor(MEMBER))).toBeNull();
  });
});

describe('provenance and rendering', () => {
  it('states who generated the sheet, from what scope and how many rows', () => {
    const notes = buildSheet('members', inputFor(DIRECTOR))!.notes;
    expect(notes[0]).toContain('Dana Director (director)');
    expect(notes[0]).toContain('2026-10-16');
    expect(notes[2]).toContain('row(s)');
  });

  it('warns that a skills sheet omits the never-assessed', () => {
    expect(buildSheet('skills', inputFor(ADMIN))!.notes.join(' ')).toContain('not assessed at zero');
  });

  it('quotes anything with a comma, a quote or a newline in CSV', () => {
    const sheet = buildSheet('tasks', inputFor(ADMIN, { tasks: [task({ id: 'tz', title: 'One, "two"\rthree' })] }))!;
    const csv = toCsv([sheet]);
    expect(csv).toContain(`"One, ""two""\rthree"`);
    const header = csv.split('\r\n').find((l) => l.startsWith('Id,'));
    expect(header).toBeDefined();
  });

  it('writes each sheet as a commented block so a flat file still says where it came from', () => {
    const csv = toCsv([buildSheet('members', inputFor(ADMIN))!, buildSheet('ledger', inputFor(ADMIN))!]);
    expect(csv).toContain('# Members\r\n');
    expect(csv).toContain('# Ledger\r\n');
    expect(csv.split('# ').length).toBeGreaterThan(2);
  });

  it('escapes markup so a record containing a tag stays a string', () => {
    const sheet = buildSheet('tasks', inputFor(ADMIN, { tasks: [task({ id: 'te', title: '<img onerror=alert(1) src=x>' })] }))!;
    const html = toPrintableHtml([sheet], 'ESME report');
    expect(html).toContain('&lt;img onerror=alert(1) src=x&gt;');
    expect(html).not.toContain('<img onerror');
  });

  it('escapes the title too, which is caller text', () => {
    expect(toPrintableHtml([], '<b>ti</b>tle')).toContain('&lt;b&gt;ti&lt;/b&gt;tle');
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('names a file after the day it was written, never after a record', () => {
    expect(reportFileName('xlsx', '2026-10-16T09:00:00.000Z')).toBe('ESME_CU_report_2026-10-16.xlsx');
    expect(reportFileName('csv', '2026-10-16T09:00:00.000Z')).toBe('ESME_CU_report_2026-10-16.csv');
  });
});
