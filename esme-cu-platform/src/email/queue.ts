import { preferencesWithDefaults, shouldSend } from '../domain/email';
import { EMAIL_PATTERN, normalizeEmail } from '../domain/registration';
import type { EmailEvent, EmailLocale, EmailPayload, EmailPreferences } from '../domain/email';
import { readV2, writeV2 } from '../storage/migrations';
import type { DeliveryReceipt, DeliveryStatus, EmailRequest, EmailSender } from './types';

/**
 * The browser half of the email pipeline. It does one job: turn a real record change into a
 * request that carries a stable idempotency key, hand that request to a sender, and remember the
 * receipt the sender actually returned. It never renders "sent" from its own state — the receipt
 * decides, and the development sender's receipt says `queued` with `simulated: true`.
 */

const QUEUE_LIMIT = 200;

/** Retries stop here. The key is what protects a recipient, not the attempt counter. */
export const MAX_ATTEMPTS = 3;

export type EmailQueueEntry = { request: EmailRequest; receipt: DeliveryReceipt | null };

/** The message is about a record, not a click: the same approval retried is the same key. */
export function emailIdempotencyKey(event: EmailEvent, recipientId: string, ref: string): string {
  return `${event}:${recipientId}:${ref}`;
}

export function readEmailQueue(): EmailQueueEntry[] {
  return readV2<EmailQueueEntry[]>('emailQueue', [])
    .filter((e) => e && typeof e.request?.idempotencyKey === 'string' && typeof e.request.to === 'string');
}

function persist(entries: EmailQueueEntry[]): void {
  writeV2('emailQueue', entries.slice(-QUEUE_LIMIT));
}

export function readEmailPreferences(userId: string): EmailPreferences {
  const rows = readV2<Partial<EmailPreferences>[]>('emailPreferences', []);
  return preferencesWithDefaults(rows.find((r) => r.userId === userId), userId);
}

export function writeEmailPreferences(pref: EmailPreferences): void {
  const rows = readV2<Partial<EmailPreferences>[]>('emailPreferences', []).filter((r) => r.userId !== pref.userId);
  rows.push(pref);
  writeV2('emailPreferences', rows);
}

export type EnqueueResult =
  | { queued: true; request: EmailRequest }
  | { queued: false; reason: 'invalid-recipient' | 'muted' | 'duplicate'; request?: EmailRequest };

export function enqueueEmail(input: {
  payload: EmailPayload;
  recipientId: string;
  to: string;
  /** The record this message reports on — the application id, task id, ledger entry id. */
  ref: string;
  locale?: EmailLocale;
  preferences?: EmailPreferences;
}): EnqueueResult {
  const to = normalizeEmail(input.to);
  if (!EMAIL_PATTERN.test(to)) return { queued: false, reason: 'invalid-recipient' };

  const prefs = input.preferences ?? readEmailPreferences(input.recipientId);
  if (!shouldSend(prefs, input.payload.event)) {
    return { queued: false, reason: 'muted' };
  }

  const idempotencyKey = emailIdempotencyKey(input.payload.event, input.recipientId, input.ref);
  const existing = readEmailQueue().find((e) => e.request.idempotencyKey === idempotencyKey);
  if (existing) return { queued: false, reason: 'duplicate', request: existing.request };

  const request: EmailRequest = {
    id: `eml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    event: input.payload.event,
    recipientId: input.recipientId,
    to,
    locale: input.locale ?? prefs.locale,
    payload: input.payload,
    idempotencyKey,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  persist([...readEmailQueue(), { request, receipt: null }]);
  return { queued: true, request };
}

export function isRetryable(entry: EmailQueueEntry): boolean {
  if (!entry.receipt) return true;
  return entry.receipt.status === 'failed' && entry.request.attempts < MAX_ATTEMPTS;
}

export type DrainSummary = {
  attempted: number;
  byStatus: Record<DeliveryStatus, number>;
  simulated: number;
  rejected: number;
};

const emptyStatuses = (): Record<DeliveryStatus, number> => ({ queued: 0, sent: 0, failed: 0, suppressed: 0 });

/**
 * One pass over the pending entries. Retries reuse the same request id and key, so a provider that
 * already accepted the message answers with the same receipt instead of a second mail.
 */
export async function drainEmailQueue(sender: EmailSender): Promise<DrainSummary> {
  const entries = readEmailQueue();
  const summary: DrainSummary = { attempted: 0, byStatus: emptyStatuses(), simulated: 0, rejected: 0 };
  let changed = false;

  for (const entry of entries) {
    if (!isRetryable(entry)) {
      if (entry.receipt) summary.byStatus[entry.receipt.status] += 1;
      continue;
    }
    summary.attempted += 1;
    let receipt: DeliveryReceipt;
    try {
      receipt = await sender.send(entry.request);
    } catch (error) {
      receipt = {
        requestId: entry.request.id,
        idempotencyKey: entry.request.idempotencyKey,
        status: 'failed',
        attemptedAt: new Date().toISOString(),
        simulated: false,
        error: error instanceof Error ? error.message : 'The email sender did not answer.',
      };
    }
    entry.receipt = receipt;
    entry.request = {
      ...entry.request,
      attempts: entry.request.attempts + 1,
      lastError: receipt.error,
    };
    summary.byStatus[receipt.status] += 1;
    if (receipt.simulated) summary.simulated += 1;
    changed = true;
  }

  if (changed) persist(entries);
  return summary;
}

export function pendingEmailCount(): number {
  return readEmailQueue().filter((e) => isRetryable(e)).length;
}

export function failedEmails(): EmailQueueEntry[] {
  return readEmailQueue().filter((e) => e.receipt?.status === 'failed' || e.receipt?.status === 'suppressed');
}

/** A manually retried entry forgets its attempt count; the key stays, so the provider still dedupes. */
export function resetFailedAttempts(): number {
  const entries = readEmailQueue();
  let count = 0;
  for (const entry of entries) {
    if (entry.receipt?.status === 'failed') {
      entry.receipt = null;
      entry.request = { ...entry.request, attempts: 0, lastError: undefined };
      count += 1;
    }
  }
  if (count > 0) persist(entries);
  return count;
}

export function clearEmailQueue(): void {
  persist([]);
}
