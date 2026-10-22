import type {
  AuditLogItem,
  Committee,
  RegistrationApplication,
  ScoreLedgerEntry,
  SkillMatrixEntry,
  Task,
  TaskSubmission,
  User,
} from '../types';
import { METRIC_DEFINITIONS, type MetricValue, inPeriod, type Period } from './metrics';
import { OBJECTIVE_STATUS_LABEL, type ChapterSeason, type ObjectiveRollup } from './seasons';
import { scopeFor, type Capability, type Role, type Scope } from './roles';

/**
 * Spec I: an export is a copy of the records this account is allowed to read, and nothing more.
 *
 * Two rules hold here. Each section is gated by the same capability the on-screen surface uses,
 * and the scope that capability grants decides which rows survive — so a committee director's
 * file cannot contain another committee's ledger, and a section this account may not read is
 * never built at all rather than built and hidden.
 *
 * Second, every cell that is not a number is written as text with its leading formula character
 * neutralised. A task title or an audit detail is untrusted input typed by a member; a
 * spreadsheet that executes it is a code-execution channel.
 */

export type ReportCell = string | number | null;

export type ReportSheet = {
  id: ReportSectionId;
  name: string;
  columns: string[];
  rows: ReportCell[][];
  /** Provenance written into the sheet itself, so a printed copy carries its own origin. */
  notes: string[];
  capability: Capability;
};

export type ReportSectionId =
  | 'kpi'
  | 'members'
  | 'tasks'
  | 'submissions'
  | 'ledger'
  | 'skills'
  | 'objectives'
  | 'applications'
  | 'audit';

export const REPORT_SECTIONS: { id: ReportSectionId; label: string; capability: Capability; detail: string }[] = [
  { id: 'kpi', label: 'Key figures', capability: 'analytics.configure', detail: 'Period metrics, each with the records it was computed from.' },
  { id: 'members', label: 'Member directory', capability: 'users.read', detail: 'Name, role, committee, account status, points.' },
  { id: 'tasks', label: 'Tasks', capability: 'tasks.read', detail: 'Created inside the period, with deadline and assignees.' },
  { id: 'submissions', label: 'Submissions', capability: 'submissions.read', detail: 'Review state, rubric marks and awarded points.' },
  { id: 'ledger', label: 'Points ledger', capability: 'scores.read', detail: 'One row per scoring decision, with the reviewer.' },
  { id: 'skills', label: 'Skill assessments', capability: 'skills.read', detail: 'Recorded levels and the evidence behind each.' },
  { id: 'objectives', label: 'Seasons & objectives', capability: 'analytics.configure', detail: 'Key results as read, including the ones that are not measurable.' },
  { id: 'applications', label: 'Registration queue', capability: 'registrations.read', detail: 'Personal contact details — restricted on purpose.' },
  { id: 'audit', label: 'Audit trail', capability: 'audit.read', detail: 'Who did what, with the record id they touched.' },
];

export type ReportActor = Pick<User, 'id' | 'name' | 'role' | 'committeeId'>;

export type ReportInput = {
  actor: ReportActor;
  period: Period;
  generatedAt: string;
  users: User[];
  committees: Committee[];
  tasks: Task[];
  submissions: TaskSubmission[];
  ledger: ScoreLedgerEntry[];
  assessments: SkillMatrixEntry[];
  applications: RegistrationApplication[];
  audit: AuditLogItem[];
  seasons: ChapterSeason[];
  rollups: (seasonId: string) => ObjectiveRollup[];
  /** Optional: the same deterministic readings the dashboards show, for the key-figures sheet. */
  metricReadings?: MetricValue[];
};

/** Characters a spreadsheet would treat as the start of a formula. */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

export function looksLikeFormula(value: string): boolean {
  const first = value.trimStart()[0];
  return first !== undefined && FORMULA_LEADERS.includes(first);
}

/**
 * Neutralised by prefixing an apostrophe — the convention Excel itself shows for text that began
 * with a formula character. The visible word is preserved; only the lead character loses its meaning.
 */
export function sanitizeCell(value: ReportCell): ReportCell {
  if (value === null || typeof value === 'number') return value;
  const text = String(value);
  if (text.length === 0) return text;
  return looksLikeFormula(text) ? `'${text}` : text;
}

export function sanitizeRow(row: ReportCell[]): ReportCell[] {
  return row.map(sanitizeCell);
}

/** Numbers stay numbers: a report that cannot be summed is not a report. */
export const numeric = (value: number | null | undefined): ReportCell =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const committeeName = (committees: Committee[], id?: string) =>
  committees.find((c) => c.id === id)?.name ?? (id ? 'unknown committee id' : 'no committee recorded');

/**
 * Row-level scope, read from the capability matrix rather than passed in, so the caller cannot
 * relabel a committee export as chapter-wide. A record with no committee is never assumed to be
 * the actor's — except a chapter-wide objective, which is written for everybody.
 */
function visible(
  scope: Scope,
  actor: ReportActor,
  row: { committeeId?: string; owners: string[]; chapterWide?: boolean }
): boolean {
  if (scope === 'all') return true;
  if (scope === 'committee') {
    return row.chapterWide === true || (actor.committeeId !== undefined && row.committeeId === actor.committeeId);
  }
  return row.owners.includes(actor.id);
}

/** The same row test the sheets use, so a summary figure is computed over the rows the file can actually show. */
export const rowVisible = visible;

const scopeLabel = (scope: Scope, actor: ReportActor, committees: Committee[]) =>
  scope === 'all'
    ? 'Entire chapter'
    : scope === 'committee'
      ? `${committeeName(committees, actor.committeeId)} only`
      : "This account's own records only";

function provenance(input: ReportInput, scope: Scope, rows: number, extra: string[]): string[] {
  return [
    `Generated ${input.generatedAt} by ${input.actor.name} (${input.actor.role}).`,
    `Scope: ${scopeLabel(scope, input.actor, input.committees)}. Period: ${input.period.label}.`,
    `${rows} row(s). A row appears here only because this account is permitted to read the record it came from.`,
    ...extra,
  ];
}

/** Which sections this account may export, and the scope each one is cut down to. */
export function sectionsFor(actor: { role: Role }): (typeof REPORT_SECTIONS)[number][] {
  return REPORT_SECTIONS.filter((s) => scopeFor(actor.role, s.capability) !== null);
}

export function buildSheet(id: ReportSectionId, input: ReportInput): ReportSheet | null {
  const section = REPORT_SECTIONS.find((s) => s.id === id);
  if (!section) return null;
  const scope = scopeFor(input.actor.role, section.capability);
  if (scope === null) return null;

  if (id === 'kpi') {
    const readings = input.metricReadings ?? [];
    const rows = readings.map((r) =>
      sanitizeRow([
        METRIC_DEFINITIONS[r.id].label,
        r.value === null ? 'not measurable' : r.value,
        r.unit,
        numeric(r.eligible),
        numeric(r.excluded),
        r.recordIds.join(', ') || 'none',
        `${METRIC_DEFINITIONS[r.id].method} ${r.reason}`,
      ])
    );
    return {
      id,
      name: 'Key figures',
      columns: ['Metric', 'Value', 'Unit', 'Eligible records', 'Excluded', 'Record ids', 'Method'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, [
        'Each value is the deterministic calculation the dashboard shows over the same period — no rounding, no estimate, no figure that only exists in this file.',
        'A metric with no eligible record reads "not measurable". That is not zero.',
        rows.length === 0 ? 'No reading was passed in, so this sheet is headers only.' : '',
      ].filter(Boolean)),
    };
  }

  if (id === 'members') {
    const rows = input.users
      .filter((u) => visible(scope, input.actor, { committeeId: u.committeeId, owners: [u.id] }))
      .map((u) =>
        sanitizeRow([
          u.name,
          u.username,
          u.email,
          u.role,
          committeeName(input.committees, u.committeeId),
          u.status,
          numeric(u.totalPoints),
          numeric(u.approvedTasksCount),
          u.joinedDate,
        ])
      );
    return {
      id,
      name: 'Members',
      columns: ['Name', 'Username', 'Email', 'Role', 'Committee', 'Account status', 'Points', 'Approved tasks', 'Joined'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, [
        'Points and approved-task counts are copied from the directory row, which the ledger calculations write.',
        'Email addresses are personal data: this sheet exists only because this account holds users.read.',
      ]),
    };
  }

  if (id === 'tasks') {
    const rows = input.tasks
      .filter((t) => inPeriod(t.createdAt, input.period))
      .filter((t) => visible(scope, input.actor, { committeeId: t.committeeId, owners: t.assigneeIds }))
      .map((t) =>
        sanitizeRow([
          t.id,
          t.title,
          t.status,
          committeeName(input.committees, t.committeeId),
          t.assigneeNames.join(', ') || 'unassigned',
          t.priority,
          t.startDate,
          t.deadline,
          numeric(t.points),
          t.createdAt,
        ])
      );
    return {
      id,
      name: 'Tasks',
      columns: ['Id', 'Title', 'Status', 'Committee', 'Assignees', 'Priority', 'Start', 'Deadline', 'Points', 'Created'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, ['Created-date filter: only tasks created inside the period are listed.']),
    };
  }

  if (id === 'submissions') {
    const rows = input.submissions
      .filter((s) => inPeriod(s.submittedAt, input.period))
      .filter((s) => visible(scope, input.actor, { committeeId: s.committeeId, owners: [s.memberId] }))
      .map((s) =>
        sanitizeRow([
          s.id,
          s.taskTitle,
          s.memberName,
          committeeName(input.committees, s.committeeId),
          s.status,
          s.submittedAt,
          s.reviewedBy ?? 'not reviewed',
          s.reviewedAt ?? '',
          numeric(s.rubricPercent),
          numeric(s.awardedPoints ?? s.proposedPoints),
          numeric(s.version),
        ])
      );
    return {
      id,
      name: 'Submissions',
      columns: ['Id', 'Task', 'Member', 'Committee', 'Status', 'Submitted', 'Reviewed by', 'Reviewed at', 'Rubric %', 'Points', 'Version'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, [
        'Rubric % is empty where no rubric was marked; an unmarked rubric is not a zero.',
        'Points fall back to the proposed value only when nothing was awarded yet, and the status column shows when that is the case.',
        'Version 1 is the first submission; a revision request increments it. The number counts resubmission rounds, not quality.',
      ]),
    };
  }

  if (id === 'ledger') {
    const rows = input.ledger
      .filter((l) => inPeriod(l.timestamp, input.period))
      .filter((l) => visible(scope, input.actor, { committeeId: l.committeeId, owners: [l.memberId] }))
      .map((l) =>
        sanitizeRow([
          l.timestamp,
          l.memberName,
          committeeName(input.committees, l.committeeId),
          numeric(l.points),
          l.actionType,
          l.reviewerName,
          l.reason,
          numeric(l.previousTotal),
          numeric(l.newTotal),
          l.taskId ?? '',
        ])
      );
    return {
      id,
      name: 'Ledger',
      columns: ['Timestamp', 'Member', 'Committee', 'Points', 'Type', 'Reviewer', 'Reason', 'Previous total', 'New total', 'Task'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, [
        'Every row is one decision somebody made; the totals columns are what the ledger stored at that moment.',
      ]),
    };
  }

  if (id === 'skills') {
    const rows = input.assessments
      .filter((a) => visible(scope, input.actor, { committeeId: a.committeeId, owners: [a.memberId] }))
      .map((a) =>
        sanitizeRow([
          a.memberName,
          committeeName(input.committees, a.committeeId),
          a.skillName,
          a.level,
          a.lastAssessment,
          a.assessorName,
          a.evidence,
          a.improvementGoal,
        ])
      );
    return {
      id,
      name: 'Skills',
      columns: ['Member', 'Committee', 'Competency', 'Level', 'Assessed', 'Assessor', 'Evidence', 'Next goal'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, [
        'Levels are what an assessor recorded. A member absent from this sheet was never assessed — not assessed at zero.',
      ]),
    };
  }

  if (id === 'applications') {
    const rows = input.applications
      .filter((a) =>
        visible(scope, input.actor, {
          committeeId: a.assignedCommitteeId ?? a.preferredCommitteeId,
          owners: a.authUserId === undefined ? [] : [a.authUserId],
        })
      )
      .map((a) =>
        sanitizeRow([
          a.appliedDate,
          a.fullName,
          a.universityEmail,
          a.department ?? '',
          a.academicYear ?? '',
          committeeName(input.committees, a.preferredCommitteeId),
          a.status,
          a.phone ?? '',
        ])
      );
    return {
      id,
      name: 'Applications',
      columns: ['Applied', 'Name', 'University email', 'Department', 'Year', 'First choice', 'Status', 'Phone'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, [
        'Contact details are personal data: this sheet exists only because this account holds registrations.read.',
        'A blank Department, Year or Phone means the signup form never asked for it, not that the applicant left it out.',
      ]),
    };
  }

  if (id === 'audit') {
    const rows = input.audit
      .filter((a) => inPeriod(a.timestamp, input.period))
      .filter((a) => visible(scope, input.actor, { owners: [a.actorId] }))
      .map((a) => sanitizeRow([a.timestamp, a.actorName, a.actorRole, a.action, a.targetType, a.targetId, a.details]));
    return {
      id,
      name: 'Audit',
      columns: ['Timestamp', 'Actor', 'Role', 'Action', 'Target type', 'Target id', 'Details'],
      rows,
      capability: section.capability,
      notes: provenance(input, scope, rows.length, [
        'Audit entries kept in this browser are capped at the most recent ones, so an old period can read shorter than it was.',
      ]),
    };
  }

  const rows: ReportCell[][] = [];
  for (const season of input.seasons) {
    for (const rollup of input.rollups(season.id)) {
      if (!visible(scope, input.actor, { committeeId: rollup.objective.committeeId, owners: [], chapterWide: rollup.objective.committeeId === undefined })) continue;
      if (rollup.readings.length === 0) {
        rows.push(
          sanitizeRow([
            season.label,
            rollup.objective.title,
            rollup.objective.ownerName,
            committeeName(input.committees, rollup.objective.committeeId),
            OBJECTIVE_STATUS_LABEL[rollup.status],
            'no key result attached',
            '',
            '',
            rollup.method,
          ])
        );
        continue;
      }
      for (const reading of rollup.readings) {
        rows.push(
          sanitizeRow([
            season.label,
            rollup.objective.title,
            rollup.objective.ownerName,
            committeeName(input.committees, rollup.objective.committeeId),
            OBJECTIVE_STATUS_LABEL[rollup.status],
            reading.kr.label,
            METRIC_DEFINITIONS[reading.kr.metric].label,
            reading.value.value === null ? 'not measurable' : numeric(reading.value.value),
            `${rollup.method} ${METRIC_DEFINITIONS[reading.kr.metric].method} ${reading.value.reason}`,
          ])
        );
      }
    }
  }
  return {
    id,
    name: 'Objectives',
    columns: ['Season', 'Objective', 'Owner', 'Scope', 'Status', 'Key result', 'Metric', 'Read value', 'Method'],
    rows,
    capability: section.capability,
    notes: provenance(input, scope, rows.length, [
      'Status is a stated rule over the mean of the measurable key results, compared with how much of the season has elapsed.',
      'A key result that cannot be read is exported as "not measurable", with the reason, rather than as zero.',
    ]),
  };
}

export function buildReport(sectionIds: ReportSectionId[], input: ReportInput): ReportSheet[] {
  return sectionIds.map((id) => buildSheet(id, input)).filter((s): s is ReportSheet => s !== null);
}

/** Flattened CSV for readers without a spreadsheet app. Same sanitisation, plus a guard prefix. */
export function toCsv(sheets: ReportSheet[]): string {
  const escape = (value: ReportCell) => {
    const text = sanitizeCell(value);
    const asString = text === null ? '' : String(text);
    return /[",\n\r]/.test(asString) ? `"${asString.replace(/"/g, '""')}"` : asString;
  };
  const blocks = sheets.map((sheet) => {
    const lines = [
      `# ${sheet.name}`,
      ...sheet.notes.map((note) => `# ${note}`),
      sheet.columns.map(escape).join(','),
      ...sheet.rows.map((row) => row.map(escape).join(',')),
    ];
    return lines.join('\r\n');
  });
  return blocks.join('\r\n\r\n');
}

/**
 * A single printable document. The browser renders it; saving as PDF is the reader's own print
 * dialog, and no PDF library is asked to guess what a spreadsheet should look like.
 */
export function toPrintableHtml(sheets: ReportSheet[], title: string): string {
  const table = (sheet: ReportSheet) => `
    <section>
      <h2>${escapeHtml(sheet.name)}</h2>
      <ul class="notes">${sheet.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
      <table>
        <thead><tr>${sheet.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${sheet.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell === null ? '' : String(cell))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="count">${rowOrRows(sheet.rows.length)}</p>
    </section>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; color: #0f172a; margin: 24px; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      h2 { font-size: 14px; margin: 24px 0 6px; border-bottom: 2px solid #123B60; padding-bottom: 4px; }
      .notes { font-size: 10px; color: #475569; margin: 0 0 8px; padding-left: 16px; }
      table { border-collapse: collapse; width: 100%; font-size: 10px; }
      th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; }
      .count { font-size: 10px; color: #64748b; }
      @media print { body { margin: 8mm; } h2 { break-after: avoid; } table { break-inside: auto; } }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    ${sheets.map(table).join('')}
  </body>
</html>`;
}

const rowOrRows = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;

/** Text reaches HTML only through this escape, so a task titled `<img onerror=...>` stays text. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Filename for the download. No record data crosses into it. */
export function reportFileName(kind: 'xlsx' | 'csv', generatedAt: string) {
  return `ESME_CU_report_${generatedAt.slice(0, 10)}.${kind}`;
}
