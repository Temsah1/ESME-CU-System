// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readV2, runStorageMigrations, storageVersion, writeV2, STORAGE_KEYS } from './migrations';

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
    expect(storageVersion()).toBe('v2');

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
