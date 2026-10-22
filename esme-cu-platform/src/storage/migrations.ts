/**
 * Versioned browser-storage migration.
 *
 * V1 kept the whole operational dataset — 30 fictional members, invented tasks, fake
 * submissions, hand-written scores, sample applications and seeded audit events — plus
 * `currentUser`, which is what let a browser decide who was signed in and with which role.
 * Removing those arrays from the source was not enough: a returning visitor would still
 * have them in LocalStorage and the dashboard would repopulate.
 *
 * V2 keeps only reference content (committee structure, form schema, season plan, website
 * copy) plus a persisted theme choice. Operational collections are empty by definition and
 * come from the backend.
 *
 * V3 rewrites stored committee rows: `directorName` and `headName` are dropped, because a
 * committee now references the account and the account holds the only copy of the name. The
 * rewrite keeps ids, names, descriptions, objectives, sub-teams, status and assignments as
 * they are — nothing is emptied, nothing is reseeded.
 *
 * V4 rewrites the cached website document into the shape the CMS edits: the four text groups the
 * page already read keep every character the operator wrote, and the parts the old shape had no
 * place for — section visibility and order, nav links, footer, socials, image slots — arrive as
 * published defaults. A cached value that is not a page document at all is left alone rather
 * than rewritten into a blank page.
 *
 * V5 applies the streamlined signup to the cached questionnaire schema: the fields a returning
 * device inherited as mandatory-and-shown are switched off so its next applicant sees the short
 * form, and the committee preference stops being required. Any field this device's operator had
 * already set some other way keeps their setting — the migration corrects what the build shipped,
 * not a decision somebody made.
 *
 * V6 puts the academic questions back. Department and Academic Year return as required, with the
 * chapter's current wording and option lists, and the committee-membership question is added ahead
 * of the committee selector it controls. A cached committee list that is still exactly the four the
 * earlier build shipped gains High Board; a list anybody has edited is left alone, because adding
 * a body to a structure someone curates is not a version bump's call to make. Nothing in this step
 * touches a stored application, account or profile.
 *
 * Keys outside the ESME namespace are left untouched.
 */

import { normalizeCommitteeRow, hasCommitteeNamed } from '../domain/committees';
import { upgradeContentDocument } from '../domain/cms';
import { upgradeRegistrationFieldSchema, upgradeAcademicSignupSchema } from '../domain/registration';
import {
  ACADEMIC_SIGNUP_SCHEMA_ROWS,
  HIGH_BOARD_COMMITTEE,
  PREVIOUS_REFERENCE_COMMITTEE_IDS,
  REFERENCE_WEBSITE_CONTENT
} from '../data/referenceContent';

const V1_PREFIX = 'ESME_CU_STATE_V1_';
const V2_PREFIX = 'ESME_CU_STATE_V2_';
const VERSION_KEY = 'ESME_CU_SCHEMA_VERSION';
export const TARGET_VERSION = 'v6';

/** Reference content carried forward; everything else in the V1 namespace is discarded. */
const CARRIED_FORWARD = ['committees', 'formFields', 'seasonEvents', 'websiteContent', 'theme'];

export type MigrationReport = {
  ran: boolean;
  toVersion: string;
  removedKeys: string[];
  carriedKeys: string[];
  notes: string[];
};

export function storageVersion(): string {
  try {
    return localStorage.getItem(VERSION_KEY) ?? 'unversioned';
  } catch {
    return 'unavailable';
  }
}

/**
 * Brings the cached website document up to the shape the CMS edits. Every sentence the operator
 * wrote survives character for character; what the old document had no room for is filled with the
 * page's own published defaults, so upgrading a browser never hides a section or drops a link.
 */
function upgradeWebsiteDocument(report: MigrationReport): void {
  const raw = readV2<unknown>('websiteContent', null);
  if (raw === null) return;
  const { doc, notes, recognized } = upgradeContentDocument(raw, REFERENCE_WEBSITE_CONTENT);
  if (!recognized) {
    report.notes.push(
      'The cached website content is not readable as a page document, so it was left untouched instead of rewritten into an empty page.'
    );
    return;
  }
  writeV2('websiteContent', doc);
  notes.forEach((note) => report.notes.push(`Website document: ${note}`));
  if (notes.length === 0) {
    report.notes.push('The cached website document was rewritten to the editable shape with its copy unchanged.');
  }
}

/**
 * Drops the cached leader names from the rows already in storage. An assignment whose account
 * is gone is left exactly as it was: silently clearing it would turn a broken reference into a
 * seat that looks deliberately empty, and the integrity report exists to surface it.
 */
function upgradeCommitteeRows(report: MigrationReport): void {
  const raw = readV2<unknown>('committees', null);
  if (!Array.isArray(raw)) {
    if (raw !== null) report.notes.push('The stored committee list is not readable as a list, so it was left untouched.');
    return;
  }

  const rows: ReturnType<typeof normalizeCommitteeRow>[] = raw.map(normalizeCommitteeRow);
  const dropped = rows.filter((row): row is NonNullable<typeof row> => row !== null);
  if (dropped.length !== rows.length) {
    report.notes.push(`${rows.length - dropped.length} unreadable committee row(s) discarded; ${dropped.length} kept.`);
  }

  const cachedNames = raw.filter(
    (row) => typeof row === 'object' && row !== null && ('directorName' in row || 'headName' in row)
  ).length;

  // Runs once per version bump, so rewriting the same content is not a data change.
  writeV2('committees', dropped);
  if (cachedNames > 0) {
    report.notes.push(
      `Removed the cached leader names from ${cachedNames} committee row(s). Names are read from the appointed account now, so renaming a leader updates every screen at once.`
    );
  }
}

/**
 * Brings a cached questionnaire schema up to the streamlined signup. Only rows still sitting at
 * what the build shipped are switched off; a row this device set some other way is its operator's
 * decision and stays.
 */
function upgradeRegistrationSchema(report: MigrationReport): void {
  const raw = readV2<unknown>('formFields', null);
  if (raw === null) return;
  if (!Array.isArray(raw)) {
    report.notes.push('The cached registration schema is not readable as a field list, so it was left untouched.');
    return;
  }

  const { rows, switchedOff, madeOptional, kept } = upgradeRegistrationFieldSchema(raw);
  if (switchedOff.length > 0 || madeOptional.length > 0) writeV2('formFields', rows);

  if (switchedOff.length > 0) {
    report.notes.push(
      `Switched off ${switchedOff.length} registration field(s) the short signup no longer asks: ${switchedOff.join(', ')}. ` +
        'They stay in the schema, so Registration → Form Schema can turn any of them back on.'
    );
  }
  if (madeOptional.length > 0) {
    report.notes.push(
      `Stopped requiring ${madeOptional.length} registration field(s) the form still shows: ${madeOptional.join(', ')}.`
    );
  }
  if (kept.length > 0) {
    report.notes.push(
      `Left ${kept.length} registration field(s) exactly as this device had set them: ${kept.join(', ')}.`
    );
  }
}

/**
 * Brings a cached questionnaire up to the academic signup: the two academic questions return
 * required, with the wording and options this build ships, and the committee-membership question is
 * added. Only a row still sitting at what an earlier build shipped is rewritten.
 */
function upgradeAcademicSignup(report: MigrationReport): void {
  const raw = readV2<unknown>('formFields', null);
  if (!Array.isArray(raw)) return;

  const { rows, turnedOn, relabelled, added, kept } = upgradeAcademicSignupSchema(raw, ACADEMIC_SIGNUP_SCHEMA_ROWS);
  if (turnedOn.length > 0 || relabelled.length > 0 || added.length > 0) writeV2('formFields', rows);

  if (turnedOn.length > 0) {
    report.notes.push(
      `Put ${turnedOn.length} academic question(s) back on the signup form as required: ${turnedOn.join(', ')}.`
    );
  }
  if (relabelled.length > 0) {
    report.notes.push(`Refreshed the wording and options of ${relabelled.length} field(s): ${relabelled.join(', ')}.`);
  }
  if (added.length > 0) {
    report.notes.push(
      `Added ${added.join(', ')} to the cached schema, ahead of the committee question it controls.`
    );
  }
  if (kept.length > 0) {
    report.notes.push(`Left ${kept.length} academic field(s) as this device had set them: ${kept.join(', ')}.`);
  }
}

/**
 * Offers High Board to a device whose cached committee list is still exactly the one the earlier
 * build shipped. The row is compared by name as well as id, so a list that already carries it under
 * another spelling is not given a second copy. An edited list is left to its owner: Committee
 * Management is where a chapter adds a body on purpose.
 */
function offerHighBoard(report: MigrationReport): void {
  const raw = readV2<unknown>('committees', null);
  if (!Array.isArray(raw)) return;
  const rows = raw.map(normalizeCommitteeRow).filter((row): row is NonNullable<typeof row> => row !== null);
  if (rows.length === 0) return;

  if (rows.some((row) => row.id === HIGH_BOARD_COMMITTEE.id) || hasCommitteeNamed(rows, HIGH_BOARD_COMMITTEE.name)) {
    return;
  }
  const ids = rows.map((row) => row.id);
  const untouched =
    PREVIOUS_REFERENCE_COMMITTEE_IDS.every((id) => ids.includes(id)) &&
    ids.every((id) => PREVIOUS_REFERENCE_COMMITTEE_IDS.includes(id));
  if (!untouched) {
    report.notes.push(
      'Left this device’s committee list alone because it has been edited; High Board can be added from Committee Management.'
    );
    return;
  }

  writeV2('committees', [...rows, HIGH_BOARD_COMMITTEE]);
  report.notes.push(
    'Added the High Board committee to this device’s list, so the homepage and the signup form offer it like any other committee. It is a committee only: it grants no role and no access.'
  );
}

export function runStorageMigrations(): MigrationReport {
  const report: MigrationReport = {
    ran: false,
    toVersion: TARGET_VERSION,
    removedKeys: [],
    carriedKeys: [],
    notes: [],
  };

  let current: string | null = null;
  try {
    current = localStorage.getItem(VERSION_KEY);
  } catch {
    report.notes.push('Browser storage is unavailable; nothing to migrate.');
    return report;
  }
  if (current === TARGET_VERSION) {
    // A stamp is not a guarantee about the rows: a device that ran an earlier build of this version
    // recorded v6 while its cached questionnaire was still the streamlined one. Both steps below
    // write only when they change something and refuse to touch a row this device set itself, so
    // re-running them on every load costs nothing and repairs that stamp.
    upgradeAcademicSignup(report);
    offerHighBoard(report);
    return report;
  }

  report.ran = true;

  // A browser already past v2 has had the operational cache retired; running the sweep again
  // would delete keys a later version legitimately owns. An unreadable version is treated as the
  // oldest shape, because a v1 device must be swept — and a device with no V1 keys loses nothing
  // by the sweep running, so the cautious reading is the safe one.
  const numericVersion = /^v(\d+)$/.exec(current ?? '')?.[1];
  const alreadyPastV2 = Number(numericVersion ?? 1) >= 2;
  if (!alreadyPastV2) {
    for (const suffix of CARRIED_FORWARD) {
      try {
        const value = localStorage.getItem(`${V1_PREFIX}${suffix}`);
        if (value) {
          localStorage.setItem(`${V2_PREFIX}${suffix}`, value);
          report.carriedKeys.push(`${V1_PREFIX}${suffix}`);
        }
      } catch {
        report.notes.push(`Could not carry forward ${suffix}.`);
      }
    }

    // Enumerate the V1 namespace only; unrelated origins and keys stay as they are.
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(V1_PREFIX) && !CARRIED_FORWARD.some((s) => key === `${V1_PREFIX}${s}`)) {
        stale.push(key);
      }
    }
    for (const key of stale) {
      localStorage.removeItem(key);
      report.removedKeys.push(key);
    }

    if (report.removedKeys.length > 0) {
      report.notes.push(
        `Deleted ${report.removedKeys.length} key(s) from the V1 operational cache (users, tasks, submissions, score ledger, applications, skill matrix, notifications, audit log) and the browser-owned currentUser.`
      );
    }
  }

  if (current !== 'v3') upgradeCommitteeRows(report);
  upgradeWebsiteDocument(report);
  upgradeRegistrationSchema(report);
  upgradeAcademicSignup(report);
  offerHighBoard(report);

  try {
    localStorage.setItem(VERSION_KEY, TARGET_VERSION);
  } catch {
    report.notes.push('Could not record the storage version.');
  }

  return report;
}

export function readV2<T>(suffix: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${V2_PREFIX}${suffix}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeV2(suffix: string, value: unknown): void {
  try {
    localStorage.setItem(`${V2_PREFIX}${suffix}`, JSON.stringify(value));
  } catch {
    // Storage quota or private mode: the session keeps working from memory.
  }
}

export const STORAGE_KEYS = { v1: V1_PREFIX, v2: V2_PREFIX, version: VERSION_KEY } as const;
