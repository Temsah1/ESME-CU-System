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
 * Keys outside the ESME namespace are left untouched.
 */

const V1_PREFIX = 'ESME_CU_STATE_V1_';
const V2_PREFIX = 'ESME_CU_STATE_V2_';
const VERSION_KEY = 'ESME_CU_SCHEMA_VERSION';

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

export function runStorageMigrations(): MigrationReport {
  const report: MigrationReport = {
    ran: false,
    toVersion: 'v2',
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
  if (current === 'v2') {
    report.toVersion = 'v2';
    return report;
  }

  report.ran = true;

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

  try {
    localStorage.setItem(VERSION_KEY, 'v2');
  } catch {
    report.notes.push('Could not record the storage version.');
  }

  report.notes.push(
    'Deleted the V1 operational cache (users, tasks, submissions, score ledger, applications, skill matrix, notifications, audit log) and the browser-owned currentUser.'
  );
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
