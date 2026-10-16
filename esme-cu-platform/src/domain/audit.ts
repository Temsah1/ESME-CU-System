import type { AuditLogItem } from '../types';

/**
 * This browser caches the most recent entries only. The provider's esme_audit_log is
 * append-only and unbounded; a moderator clearing local cache never removes history.
 */
export const AUDIT_RETENTION = 500;

/** Newest first, capped, and never emptied by a limit of zero or less. */
export function appendAuditEntry(
  entries: AuditLogItem[],
  entry: AuditLogItem,
  limit: number = AUDIT_RETENTION
): AuditLogItem[] {
  return [entry, ...entries].slice(0, Math.max(1, Math.floor(limit)));
}

/** Entries the given reporting period covers, in the same newest-first order. */
export function auditInPeriod(entries: AuditLogItem[], from: string | null, to: string | null): AuditLogItem[] {
  return entries.filter((e) => {
    const day = e.timestamp.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}
