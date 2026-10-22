import { isSupabaseConfigured } from '../auth/supabaseAdapter';
import { createDisabledSender, createLocalOutboxSender, createServerQueueSender } from './localOutboxSender';
import type { EmailSender } from './types';

export type SenderResolution = { sender: EmailSender; reason: string };

/**
 * Same shape as the auth resolver, on purpose: a deployed build never falls back to a browser
 * simulation, and a build with no sender configured reports that instead of inventing a delivery.
 *
 * With a provider configured the browser holds no sender at all. A server-side write enqueues an
 * `esme_email_outbox` row in the same transaction, and the scheduled send-email function drains
 * it — so the address, the wording and the delivery status are decided where the record lives,
 * not in whatever tab happened to notice the change.
 */
export function resolveSender(): SenderResolution {
  if (isSupabaseConfigured()) {
    return {
      sender: createServerQueueSender(),
      reason:
        'Mail is queued by the database on the write that creates the record and sent by the scheduled send-email function. This device neither renders nor delivers it, and cannot confirm a delivery it did not make.',
    };
  }
  if (import.meta.env.DEV) {
    return { sender: createLocalOutboxSender(), reason: 'Development outbox: messages are rendered and stored locally, never delivered.' };
  }
  return { sender: createDisabledSender(), reason: 'No email sender is configured for this deployment.' };
}

export * from './types';
export { clearOutbox, readOutbox, type OutboxRecord } from './localOutboxSender';
