// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACADEMIC_SIGNUP_SCHEMA_ROWS,
  HIGH_BOARD_COMMITTEE,
  PREVIOUS_REFERENCE_COMMITTEE_IDS,
  REFERENCE_COMMITTEES,
  REFERENCE_FORM_FIELDS,
  REFERENCE_WEBSITE_CONTENT,
} from '../data/referenceContent';
import {
  ACADEMIC_SIGNUP_FIELDS,
  STREAMLINED_SIGNUP_FIELDS,
  upgradeAcademicSignupSchema,
  upgradeRegistrationFieldSchema,
} from '../domain/registration';
import { readV2, runStorageMigrations, storageVersion, TARGET_VERSION, writeV2, STORAGE_KEYS } from './migrations';

/**
 * Deleting the fictional sample rows from the source is only half the cleanup: a returning
 * visitor still carries them in browser storage. These tests pin the migration that retires
 * that cache, and prove it touches nothing outside the ESME namespace.
 */

class MemoryStorage {
  private map = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.map.set(key, value);
  }

  get length() {
    return this.map.size;
  }

  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(name: string) {
    return this.map.has(name) ? this.map.get(name)! : null;
  }

  setItem(name: string, value: string) {
    this.map.set(name, String(value));
  }

  removeItem(name: string) {
    this.map.delete(name);
  }
}

const V1 = STORAGE_KEYS.v1;

function seedV1() {
  const store = new MemoryStorage({
    [`${V1}users`]: JSON.stringify([{ id: 'usr_fake_1', name: 'Invented Member' }]),
    [`${V1}tasks`]: JSON.stringify([{ id: 'tsk_fake_1', title: 'Invented Task' }]),
    [`${V1}submissions`]: JSON.stringify([{ id: 'sub_fake_1' }]),
    [`${V1}scoreLedger`]: JSON.stringify([{ id: 'led_fake_1', points: 500 }]),
    [`${V1}applications`]: JSON.stringify([{ id: 'app_fake_1' }]),
    [`${V1}skillMatrix`]: JSON.stringify([{ id: 'skl_fake_1' }]),
    [`${V1}auditLogs`]: JSON.stringify([{ id: 'aud_fake_1' }]),
    [`${V1}notifications`]: JSON.stringify([{ id: 'not_fake_1' }]),
    [`${V1}currentUser`]: JSON.stringify({ id: 'usr_fake_1', role: 'super_admin' }),
    [`${V1}committees`]: JSON.stringify([{ id: 'comm_te', name: 'Technical & Engineering' }]),
    [`${V1}formFields`]: JSON.stringify([{ id: 'field_1' }]),
    [`${V1}seasonEvents`]: JSON.stringify([{ id: 'evt_1' }]),
    [`${V1}websiteContent`]: JSON.stringify({ heroTitle: 'ESME CU' }),
    [`${V1}theme`]: '"dark"',
    'unrelated_key_from_another_origin': 'keep-me',
  });
  vi.stubGlobal('localStorage', store);
}

beforeEach(() => {
  seedV1();
});

describe('V1 to V2 storage migration', () => {
  it('retires every operational collection and the browser-owned currentUser', () => {
    const report = runStorageMigrations();
    expect(report.ran).toBe(true);
    for (const suffix of ['users', 'tasks', 'submissions', 'scoreLedger', 'applications', 'skillMatrix', 'auditLogs', 'notifications', 'currentUser']) {
      expect(localStorage.getItem(`${V1}${suffix}`)).toBeNull();
      expect(report.removedKeys).toContain(`${V1}${suffix}`);
    }
  });

  it('carries reference content forward instead of discarding it', () => {
    runStorageMigrations();
    expect(readV2<{ id: string }[]>('committees', [])[0].id).toBe('comm_te');
    expect(readV2<unknown[]>('seasonEvents', [])).toHaveLength(1);
    expect(readV2('websiteContent', null)).toEqual({ heroTitle: 'ESME CU' });
    expect(readV2('theme', 'system')).toBe('dark');
  });

  it('leaves keys outside the ESME namespace alone', () => {
    runStorageMigrations();
    expect(localStorage.getItem('unrelated_key_from_another_origin')).toBe('keep-me');
  });

  it('records the version so a second load changes nothing', () => {
    expect(storageVersion()).toBe('unversioned');
    runStorageMigrations();
    expect(storageVersion()).toBe(TARGET_VERSION);

    localStorage.setItem(`${V1}users`, JSON.stringify([{ id: 'late_arrival' }]));
    const second = runStorageMigrations();
    expect(second.ran).toBe(false);
    expect(second.removedKeys).toEqual([]);
    expect(localStorage.getItem(`${V1}users`)).toContain('late_arrival');
  });

  it('reports honestly when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('private mode');
      },
    });
    const report = runStorageMigrations();
    expect(report.ran).toBe(false);
    expect(report.notes.join(' ')).toMatch(/unavailable/i);
    expect(storageVersion()).toBe('unavailable');
  });

  it('falls back instead of throwing when a stored value cannot be parsed', () => {
    writeV2('committees', { not: 'an array' });
    vi.stubGlobal('localStorage', new MemoryStorage({ [`${STORAGE_KEYS.v2}committees`]: '{ broken json' }));
    expect(readV2('committees', [])).toEqual([]);
    expect(readV2('committees', [{ id: 'fallback' }])).toEqual([{ id: 'fallback' }]);
  });

  it('swallows a write quota failure rather than breaking the session', () => {
    vi.stubGlobal('localStorage', {
      setItem() {
        throw new Error('quota exceeded');
      },
      getItem() {
        return null;
      },
    });
    expect(() => writeV2('theme', 'dark')).not.toThrow();
  });
});

const V2 = STORAGE_KEYS.v2;

function seedV2(committees: unknown, version = 'v2') {
  vi.stubGlobal(
    'localStorage',
    new MemoryStorage({
      [STORAGE_KEYS.version]: version,
      [`${V2}committees`]: JSON.stringify(committees),
    })
  );
}

describe('V2 to V3 committee shape upgrade', () => {
  it('drops the cached leader names and keeps everything the row actually recorded', () => {
    seedV2([
      {
        id: 'comm_te',
        name: 'Technical & Engineering Committee',
        shortCode: 'T&E',
        description: 'Engineering backbone.',
        directorId: 'usr_1',
        directorName: 'Old Cached Director Name',
        headId: 'usr_2',
        headName: 'Old Cached Head Name',
        objectives: ['Deliver 4 major events'],
        subTeams: ['NDT & Inspection'],
        isPublic: true,
        status: 'active',
        category: 'technical',
      },
    ]);

    const report = runStorageMigrations();
    const stored = readV2<Record<string, unknown>[]>('committees', []);

    expect(stored[0]).not.toHaveProperty('directorName');
    expect(stored[0]).not.toHaveProperty('headName');
    expect(stored[0].directorId).toBe('usr_1');
    expect(stored[0].headId).toBe('usr_2');
    expect(stored[0].name).toBe('Technical & Engineering Committee');
    expect(stored[0].objectives).toEqual(['Deliver 4 major events']);
    expect(stored[0].subTeams).toEqual(['NDT & Inspection']);
    expect(report.notes.join(' ')).toMatch(/cached leader names/i);
  });

  it('leaves an assignment that points at a missing account alone instead of clearing the seat', () => {
    seedV2([{ id: 'comm_mc', name: 'Media', shortCode: 'M&C', description: 'Editorial.', directorId: 'usr_deleted', objectives: [], subTeams: [], isPublic: true, status: 'active', category: 'media' }]);
    runStorageMigrations();
    expect(readV2<Record<string, unknown>[]>('committees', [])[0].directorId).toBe('usr_deleted');
  });

  it('leaves the content of a row that is already current untouched', () => {
    const clean = [{ id: 'comm_te', name: 'T&E', shortCode: 'T&E', description: 'd', objectives: [], subTeams: [], isPublic: true, status: 'active', category: 'technical' }];
    seedV2(clean);
    const report = runStorageMigrations();
    expect(readV2('committees', null)).toEqual(clean);
    expect(report.notes.join(' ')).not.toMatch(/cached leader names/i);
    expect(storageVersion()).toBe(TARGET_VERSION);
  });

  it('refuses to touch a stored value that is not a committee list', () => {
    seedV2({ directorName: 'Someone wrote this by hand' });
    const report = runStorageMigrations();
    expect(readV2('committees', null)).toEqual({ directorName: 'Someone wrote this by hand' });
    expect(report.notes.join(' ')).toMatch(/not readable as a list/i);
  });
});

const V1_SEED_WEBSITE = JSON.stringify({ heroTitle: 'ESME CU' });

function seedV3(websiteContent: unknown, committees: unknown = []) {
  vi.stubGlobal(
    'localStorage',
    new MemoryStorage({
      [STORAGE_KEYS.version]: 'v3',
      [`${V2}committees`]: JSON.stringify(committees),
      [`${V2}websiteContent`]: JSON.stringify(websiteContent),
    })
  );
}

describe('V3 to V4 website document upgrade', () => {
  it('keeps every word the operator wrote and adds what the old shape had no room for', () => {
    const cached = {
      hero: { badge: 'Official Student Chapter', headline: 'Welcome to ESME CU Chapter', supportingMessage: 'Empowering Engineering Students.', ctaPrimary: 'Login', ctaSecondary: 'Join ESME' },
      about: { title: 'About', story: 'Founded in 2009.', purpose: 'Qualifying students.', objectives: ['Bridge the gap'], values: ['Be Positive Valuable'], foundedYear: '2009', foundingFaculty: 'FPME', cairoChapterFounded: '2015' },
      vision2027: { headline: 'Vision', quote: 'A quote.', description: 'A description.', pillars: [] },
      contact: { email: 'a@b.test', phone: '+20', website: 'https://www.esmecairo.com/', socialHandle: '@ESME_Cairo', location: 'Giza' },
    };
    seedV3(cached);
    const report = runStorageMigrations();
    const doc = readV2<Record<string, any>>('websiteContent', {});

    expect(storageVersion()).toBe(TARGET_VERSION);
    expect(doc.hero).toEqual(cached.hero);
    expect(doc.about).toEqual(cached.about);
    expect(doc.vision2027).toEqual(cached.vision2027);
    expect(doc.contact.website).toBe('https://www.esmecairo.com/');
    expect(doc.sections).toHaveLength(10);
    expect(doc.sections.filter((s: { visible: boolean }) => s.visible)).toHaveLength(10);
    expect(doc.images).toEqual({});
    // The old shape had no field for the header links or the footer copy, so an upgrade that left
    // them empty took the navigation away from the page and made the loss look like an edit.
    expect(doc.navigation.map((l: { href: string }) => l.href)).toEqual([
      '#home', '#about', '#vision', '#history', '#appreciation', '#committees', '#events', '#magazine', '#insights', '#contact',
    ]);
    expect(doc.footer.copyright).toBe(REFERENCE_WEBSITE_CONTENT.footer.copyright);
    expect(doc.socials.map((s: { handle: string }) => s.handle)).toEqual(['@ESME_Cairo']);
    expect(report.notes.join(' ')).toMatch(/no link behind it/i);
  });

  it('refuses to rewrite a cached value that is not a page document', () => {
    seedV3({ heroTitle: 'ESME CU' });
    const report = runStorageMigrations();
    expect(readV2('websiteContent', null)).toEqual(JSON.parse(V1_SEED_WEBSITE));
    expect(report.notes.join(' ')).toMatch(/not readable as a page document/i);
    expect(storageVersion()).toBe(TARGET_VERSION);
  });

  it('leaves a browser with no cached page alone', () => {
    vi.stubGlobal('localStorage', new MemoryStorage({ [STORAGE_KEYS.version]: 'v3', [`${V2}committees`]: '[]' }));
    const report = runStorageMigrations();
    expect(readV2('websiteContent', null)).toBeNull();
    expect(report.notes.join(' ')).not.toMatch(/page document/i);
  });

  it('does not re-run the committee rewrite on a browser that already had it', () => {
    seedV3({ hero: { headline: 'x', badge: '', supportingMessage: '', ctaPrimary: '', ctaSecondary: '' } }, [
      { id: 'comm_te', name: 'T&E', shortCode: 'T&E', description: 'd', directorId: 'usr_1', directorName: 'Still Cached', objectives: [], subTeams: [], isPublic: true, status: 'active', category: 'technical' },
    ]);
    const report = runStorageMigrations();
    expect(readV2<Record<string, unknown>[]>('committees', [])[0]).toHaveProperty('directorName');
    expect(report.notes.join(' ')).not.toMatch(/cached leader names/i);
  });

  it('records the version so a second load changes nothing', () => {
    seedV3({ hero: { headline: 'Keep me', badge: '', supportingMessage: '', ctaPrimary: '', ctaSecondary: '' } });
    runStorageMigrations();
    const stored = readV2('websiteContent', null);
    const second = runStorageMigrations();
    expect(second.ran).toBe(false);
    expect(readV2('websiteContent', null)).toEqual(stored);
  });
});

function seedV4(formFields: unknown) {
  vi.stubGlobal(
    'localStorage',
    new MemoryStorage({
      [STORAGE_KEYS.version]: 'v4',
      [`${V2}formFields`]: JSON.stringify(formFields),
    })
  );
}

/** The schema exactly as the build shipped it before the streamlined signup. */
function theOldLongForm() {
  return Object.entries(STREAMLINED_SIGNUP_FIELDS).map(([name, { from }], index) => ({
    id: `f${index + 1}`,
    name,
    label: name,
    type: 'text',
    required: from.required,
    enabled: from.enabled,
    order: index + 1,
  }));
}

describe('V4 to V5 registration schema upgrade', () => {
  it('switches off the fields the short signup no longer asks', () => {
    seedV4(theOldLongForm());
    const report = runStorageMigrations();
    const stored = readV2<Record<string, unknown>[]>('formFields', []);

    for (const [name, change] of Object.entries(STREAMLINED_SIGNUP_FIELDS)) {
      // The two academic questions are the exception: the next step puts them back, so a device
      // that has never been seen since v4 ends up asked for them again rather than spared.
      if (name in ACADEMIC_SIGNUP_FIELDS) continue;
      const row = stored.find((field) => field.name === name);
      expect(row).toMatchObject(change.to);
    }
    // The committee question is the one retired field the form still shows — optional, not gone.
    expect(stored.find((field) => field.name === 'preferredCommitteeId')).toMatchObject({
      required: false,
      enabled: true,
    });
    expect(report.notes.join(' ')).toMatch(/switched off 9 registration field/i);
    expect(report.notes.join(' ')).toMatch(/stopped requiring 1 registration field\(s\).*preferredCommitteeId/i);
    expect(report.notes.join(' ')).toMatch(/form schema/i);
  });

  it('keeps a setting the operator made instead of overwriting it', () => {
    seedV4([
      ...theOldLongForm(),
      // Somebody already decided Student ID should be asked but never forced.
      { id: 'x1', name: 'studentId', label: 'Student ID', type: 'text', required: false, enabled: true, order: 30 },
    ]);
    const report = runStorageMigrations();
    const stored = readV2<Record<string, unknown>[]>('formFields', []);

    expect(stored.find((field) => field.id === 'x1')).toMatchObject({ required: false, enabled: true });
    expect(report.notes.join(' ')).toMatch(/left 1 registration field/i);
  });

  it('leaves the name, label, options and order of every row intact', () => {
    const rows = theOldLongForm().map((row) => ({ ...row, options: ['Freshman', 'Senior II'] }));
    seedV4(rows);
    runStorageMigrations();
    const stored = readV2<Record<string, unknown>[]>('formFields', []);
    // The membership question is the one row this device has never been offered; everything it
    // already had keeps its own name, label, options and order.
    const keptRows = stored.filter((field) => field.name !== 'committeeMembership');
    expect(keptRows.map((field) => field.name)).toEqual(rows.map((field) => field.name));
    expect(
      keptRows.every(
        (field) =>
          field.name === 'academicYear' ||
          field.name === 'department' ||
          JSON.stringify(field.options) === '["Freshman","Senior II"]'
      )
    ).toBe(true);
    expect(keptRows.every((field) => typeof field.label === 'string' && typeof field.id === 'string')).toBe(true);
  });

  it('refuses to rewrite a cached value that is not a field list', () => {
    seedV4({ name: 'studentId' });
    const report = runStorageMigrations();
    expect(readV2('formFields', null)).toEqual({ name: 'studentId' });
    expect(report.notes.join(' ')).toMatch(/not readable as a field list/i);
  });

  it('leaves a browser with no cached schema alone', () => {
    vi.stubGlobal('localStorage', new MemoryStorage({ [STORAGE_KEYS.version]: 'v4' }));
    const report = runStorageMigrations();
    expect(readV2('formFields', null)).toBeNull();
    expect(report.notes.join(' ')).not.toMatch(/registration field/i);
  });

  it('rewrites a row that is already current without reporting a change', () => {
    seedV4(
      Object.entries(STREAMLINED_SIGNUP_FIELDS).map(([name, { to }], index) => ({
        id: `f${index + 1}`,
        name,
        label: name,
        type: 'text',
        required: to.required,
        enabled: to.enabled,
        order: index + 1,
      }))
    );
    const report = runStorageMigrations();
    expect(report.notes.join(' ')).not.toMatch(/switched off|stopped requiring/);
    // The academic step does report: this device is being asked two questions it had stopped asking.
    expect(report.notes.join(' ')).toMatch(/Put 2 academic question\(s\) back/i);
  });

  it('ships a reference schema that already matches the table the migration applies', () => {
    // The migration is written against what the previous build shipped. If the two drift, a
    // returning device silently keeps a field the short signup was supposed to stop asking.
    for (const [name, change] of Object.entries(STREAMLINED_SIGNUP_FIELDS)) {
      if (name in ACADEMIC_SIGNUP_FIELDS) continue;
      expect(REFERENCE_FORM_FIELDS.find((field) => field.name === name)).toMatchObject(change.to);
    }
    expect(upgradeRegistrationFieldSchema(theOldLongForm()).kept).toEqual([]);
  });
});

/** The questionnaire exactly as the streamlined signup (v5) shipped it: no membership row, and the
 * orders that build wrote — contiguous, with no hole where this build inserts its new question. */
function theStreamlinedForm() {
  return REFERENCE_FORM_FIELDS.filter((field) => field.name !== 'committeeMembership')
    .sort((a, b) => a.order - b.order)
    .map((field, index) => {
      if (field.name === 'academicYear') {
        return { ...field, label: 'Academic Year', required: false, enabled: false, options: undefined, order: index + 1 };
      }
      if (field.name === 'department') {
        return { ...field, label: 'Department / Major', required: false, enabled: false, order: index + 1 };
      }
      return { ...field, order: index + 1 };
    });
}

function seedV5(formFields: unknown, committees: unknown[] = REFERENCE_COMMITTEES) {
  vi.stubGlobal(
    'localStorage',
    new MemoryStorage({
      [STORAGE_KEYS.version]: 'v5',
      [`${V2}formFields`]: JSON.stringify(formFields),
      [`${V2}committees`]: JSON.stringify(committees),
    })
  );
}

const rowOf = (name: string) =>
  (readV2<Record<string, unknown>[]>('formFields', []).find((field) => field.name === name) ?? {}) as Record<string, unknown>;

describe('V5 to V6 academic signup upgrade', () => {
  it('seeds the fixture at what the streamlined build actually shipped', () => {
    // Everything below is measured against this state, so it is pinned to the table the v5 step
    // applies rather than to a hand-written guess: retired rows sit at `to`, academic rows keep
    // the labels that build printed, and the numbering is contiguous.
    const seeded = theStreamlinedForm();
    for (const [name, change] of Object.entries(STREAMLINED_SIGNUP_FIELDS)) {
      expect(seeded.find((field) => field.name === name)).toMatchObject(change.to);
    }
    expect(seeded.map((field) => field.order)).toEqual(seeded.map((_, index) => index + 1));
    expect(seeded.find((field) => field.name === 'academicYear')?.label).toBe('Academic Year');
    expect(seeded.find((field) => field.name === 'department')?.label).toBe('Department / Major');
    expect(seeded.find((field) => field.name === 'committeeMembership')).toBeUndefined();
  });

  it('puts the two academic questions back and adds the membership question where it belongs', () => {
    seedV5(theStreamlinedForm());
    const report = runStorageMigrations();
    const stored = readV2<Record<string, unknown>[]>('formFields', []);

    for (const [name, change] of Object.entries(ACADEMIC_SIGNUP_FIELDS)) {
      expect(rowOf(name)).toMatchObject(change.to);
    }
    expect(rowOf('academicYear').label).toBe('Academic Year / السنة الدراسية');
    expect(rowOf('academicYear').options).toBeTypeOf('object');
    expect(rowOf('department').label).toBe('Department / القسم');

    const names = stored.map((field) => field.name);
    expect(names).toContain('committeeMembership');
    // The selector only appears once this question is answered, so the question comes first.
    expect(names.indexOf('committeeMembership')).toBe(names.indexOf('preferredCommitteeId') - 1);
    expect(stored.map((field) => field.order)).toEqual(stored.map((_, i) => i + 1));

    const notes = report.notes.join(' ');
    expect(notes).toMatch(/Put 2 academic question\(s\) back/i);
    expect(notes).toMatch(/Added committeeMembership/i);
    expect(notes).toMatch(/Refreshed the wording and options/i);
  });

  it('keeps an academic setting this device already made instead of overwriting it', () => {
    seedV5(
      theStreamlinedForm().map((field) =>
        // An operator who had switched Academic Year back on, but left it optional.
        field.name === 'academicYear' ? { ...field, required: false, enabled: true } : field
      )
    );
    const report = runStorageMigrations();

    expect(rowOf('academicYear')).toMatchObject({ required: false, enabled: true });
    expect(rowOf('department')).toMatchObject({ required: true, enabled: true });
    expect(report.notes.join(' ')).toMatch(/Left 1 academic field\(s\) as this device had set them: academicYear/i);
  });

  it('offers the academic questions again on the second load without adding them twice', () => {
    seedV5(theStreamlinedForm());
    runStorageMigrations();
    const once = readV2<unknown[]>('formFields', []);
    const again = upgradeAcademicSignupSchema(once, ACADEMIC_SIGNUP_SCHEMA_ROWS);

    expect(again.added).toEqual([]);
    expect(again.turnedOn).toEqual([]);
    expect(again.relabelled).toEqual([]);
    expect(again.kept).toEqual([]);
    expect(again.rows).toEqual(once);
  });

  it('ships a reference schema that already matches what the migration applies', () => {
    for (const [name, change] of Object.entries(ACADEMIC_SIGNUP_FIELDS)) {
      expect(REFERENCE_FORM_FIELDS.find((field) => field.name === name)).toMatchObject(change.to);
    }
    expect(upgradeAcademicSignupSchema(theStreamlinedForm(), ACADEMIC_SIGNUP_SCHEMA_ROWS).kept).toEqual([]);
    expect(
      upgradeAcademicSignupSchema(REFERENCE_FORM_FIELDS, ACADEMIC_SIGNUP_SCHEMA_ROWS).added.filter(
        (name) => name === 'committeeMembership'
      )
    ).toEqual([]);
  });

  it('offers High Board to a device whose committee list nobody edited', () => {
    // The four committees the earlier build shipped, and nothing else.
    const untouched = REFERENCE_COMMITTEES.filter((c) => PREVIOUS_REFERENCE_COMMITTEE_IDS.includes(c.id));
    expect(untouched.map((c) => c.id)).toEqual(PREVIOUS_REFERENCE_COMMITTEE_IDS);
    seedV5(theStreamlinedForm(), untouched);
    const report = runStorageMigrations();
    const committees = readV2<Record<string, unknown>[]>('committees', []);

    expect(committees.map((c) => c.id)).toContain(HIGH_BOARD_COMMITTEE.id);
    expect(report.notes.join(' ')).toMatch(/Added the High Board committee/i);
    expect(report.notes.join(' ')).toMatch(/grants no role and no access/i);
  });

  it('does not add a second High Board to a list that already carries one under another id', () => {
    seedV5(theStreamlinedForm(), [
      ...PREVIOUS_REFERENCE_COMMITTEE_IDS.map((id) => REFERENCE_COMMITTEES.find((c) => c.id === id)!),
      { ...HIGH_BOARD_COMMITTEE, id: 'comm_hb_custom', name: 'High Board' },
    ]);
    const report = runStorageMigrations();
    const committees = readV2<Record<string, unknown>[]>('committees', []);

    expect(committees.filter((c) => c.name === 'High Board')).toHaveLength(1);
    expect(committees.map((c) => c.id)).not.toContain(HIGH_BOARD_COMMITTEE.id);
    expect(report.notes.join(' ')).not.toMatch(/Added the High Board committee/i);
  });

  it('leaves a committee list the chapter edited to its own curator', () => {
    seedV5(theStreamlinedForm(), [
      ...PREVIOUS_REFERENCE_COMMITTEE_IDS.map((id) => REFERENCE_COMMITTEES.find((c) => c.id === id)!),
      // A body this chapter added by hand: the list is no longer the one any build shipped.
      { ...HIGH_BOARD_COMMITTEE, id: 'comm_welding', name: 'Welding Society', shortCode: 'WS' },
    ]);
    const report = runStorageMigrations();
    const committees = readV2<Record<string, unknown>[]>('committees', []);

    expect(committees.map((c) => c.id)).toContain('comm_welding');
    expect(committees.map((c) => c.id)).not.toContain(HIGH_BOARD_COMMITTEE.id);
    expect(report.notes.join(' ')).toMatch(/Left this device.s committee list alone/i);
  });

  it('leaves a browser with no cached schema and no cached committees alone', () => {
    vi.stubGlobal('localStorage', new MemoryStorage({ [STORAGE_KEYS.version]: 'v5' }));
    const report = runStorageMigrations();
    expect(readV2('formFields', null)).toBeNull();
    expect(readV2('committees', null)).toBeNull();
    expect(report.notes.join(' ')).not.toMatch(/academic question|High Board/i);
  });

  it('repairs a device that recorded v6 while its rows were still the streamlined ones', () => {
    // A version stamp is not a guarantee about the rows it sits beside. A browser that ran an
    // earlier build of this version wrote v6 while its questionnaire was still the streamlined
    // one, and gating the academic steps behind the stamp alone left that device asking nothing
    // academic — the state a real browser was found in, which is why these two steps re-run.
    const untouched = REFERENCE_COMMITTEES.filter((c) => PREVIOUS_REFERENCE_COMMITTEE_IDS.includes(c.id));
    vi.stubGlobal(
      'localStorage',
      new MemoryStorage({
        [STORAGE_KEYS.version]: 'v6',
        [`${V2}formFields`]: JSON.stringify(theStreamlinedForm()),
        [`${V2}committees`]: JSON.stringify(untouched),
      })
    );
    const report = runStorageMigrations();

    expect(report.ran, 'the one-time version sweep stays gated behind the stamp').toBe(false);
    expect(report.removedKeys).toEqual([]);
    for (const [name, change] of Object.entries(ACADEMIC_SIGNUP_FIELDS)) {
      expect(rowOf(name)).toMatchObject(change.to);
    }
    expect(readV2<Record<string, unknown>[]>('formFields', []).map((field) => field.name)).toContain('committeeMembership');
    expect(readV2<Record<string, unknown>[]>('committees', []).map((c) => c.id)).toContain(HIGH_BOARD_COMMITTEE.id);
    expect(storageVersion()).toBe('v6');

    // And it does not keep rewriting: the same device on the next load changes nothing at all.
    const repaired = readV2<unknown[]>('formFields', []);
    const second = runStorageMigrations();
    expect(readV2<unknown[]>('formFields', [])).toEqual(repaired);
    expect(second.notes.join(' ')).not.toMatch(/academic question|High Board/i);
  });
});

describe('the V1 sweep only runs on a device that never had it', () => {
  it('refuses to overwrite a current cache with a stray V1 key, and does not claim it deleted one', () => {
    const current = [{ id: 'comm_te', name: 'Technical & Engineering', shortCode: 'T&E', description: 'd', objectives: [], subTeams: [], isPublic: true, status: 'active', category: 'technical' }];
    vi.stubGlobal(
      'localStorage',
      new MemoryStorage({
        [STORAGE_KEYS.version]: 'v4',
        [`${V2}committees`]: JSON.stringify(current),
        // Left behind by an old build, or written by hand: it must not replace what the device
        // has used since v2, and the report must not say a sweep happened when none did.
        [`${V1}committees`]: JSON.stringify([{ id: 'comm_2024', name: 'A committee from two seasons ago' }]),
        [`${V1}users`]: JSON.stringify([{ id: 'usr_fake' }]),
      })
    );

    const report = runStorageMigrations();

    expect(readV2<Record<string, unknown>[]>('committees', []).map((row) => row.id)).toEqual(['comm_te']);
    expect(report.removedKeys).toEqual([]);
    expect(report.carriedKeys).toEqual([]);
    expect(report.notes.join(' ')).not.toMatch(/deleted \d+ key/i);
    expect(storageVersion()).toBe(TARGET_VERSION);
  });

  it('still sweeps a device whose only recorded shape is V1', () => {
    seedV1();
    const report = runStorageMigrations();
    expect(report.removedKeys.length).toBeGreaterThan(0);
    expect(report.notes.join(' ')).toMatch(/deleted \d+ key\(s\) from the v1 operational cache/i);
  });
});
