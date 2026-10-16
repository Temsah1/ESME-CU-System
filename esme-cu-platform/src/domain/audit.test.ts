// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditLogItem } from '../types';
import { readV2, writeV2 } from '../storage/migrations';
import { AUDIT_RETENTION, appendAuditEntry, auditInPeriod } from './audit';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(name: string) {
    return this.map.has(name) ? this.map.get(name)! : null;
  }
  setItem(name: string, value: string) {
    this.map.set(name, String(value));
  }
  removeItem(name: string) {
    this.map.delete(name);
  }
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
}

function entry(id: string, timestamp: string): AuditLogItem {
  return {
    id,
    actorId: 'usr_admin',
    actorName: 'Kareem Tamer',
    actorRole: 'super_admin',
    action: 'Reviewed Submission: APPROVED',
    targetType: 'submission',
    targetId: `sub_${id}`,
    details: `decision for ${id}`,
    timestamp,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

describe('audit trail retention', () => {
  it('keeps the newest entry at the front', () => {
    const next = appendAuditEntry([entry('old', '2026-01-01T00:00:00.000Z')], entry('new', '2026-10-01T00:00:00.000Z'));
    expect(next.map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('caps the local cache at the documented retention without dropping the arriving entry', () => {
    const filled = Array.from({ length: AUDIT_RETENTION }, (_, i) => entry(`e${i}`, '2026-10-01T00:00:00.000Z'));
    const next = appendAuditEntry(filled, entry('arriving', '2026-10-02T00:00:00.000Z'));
    expect(next).toHaveLength(AUDIT_RETENTION);
    expect(next[0].id).toBe('arriving');
    expect(next[1].id).toBe('e0');
    expect(next.some((e) => e.id === `e${AUDIT_RETENTION - 1}`)).toBe(false);
    expect(next.some((e) => e.id === 'e1')).toBe(true);
  });

  it('always keeps at least the arriving record even if a limit is misconfigured', () => {
    expect(appendAuditEntry([], entry('a', '2026-10-01T00:00:00.000Z'), 0)).toHaveLength(1);
    expect(appendAuditEntry([entry('b', '2026-10-01T00:00:00.000Z')], entry('a', '2026-10-02T00:00:00.000Z'), -5)).toEqual([
      expect.objectContaining({ id: 'a' }),
    ]);
  });

  it('survives a reload, which is what makes it an accountability record', () => {
    const stored = appendAuditEntry([], entry('a', '2026-10-01T00:00:00.000Z'));
    writeV2('auditLogs', stored);
    expect(readV2<AuditLogItem[]>('auditLogs', [])).toEqual(stored);
  });

  it('reads back an empty cache as no records rather than a fabricated trail', () => {
    expect(readV2<AuditLogItem[]>('auditLogs', [])).toEqual([]);
  });
});

describe('audit reporting periods', () => {
  const rows = [
    entry('q4', '2026-12-31T23:59:59.000Z'),
    entry('autumn', '2026-10-05T09:00:00.000Z'),
    entry('summer', '2026-08-31T23:59:59.000Z'),
  ];

  it('includes both endpoints of the period', () => {
    expect(auditInPeriod(rows, '2026-09-01', '2026-12-31').map((e) => e.id)).toEqual(['q4', 'autumn']);
  });

  it('treats an open bound as unbounded', () => {
    expect(auditInPeriod(rows, null, null)).toHaveLength(3);
    expect(auditInPeriod(rows, '2026-09-01', null).map((e) => e.id)).toEqual(['q4', 'autumn']);
  });
});
