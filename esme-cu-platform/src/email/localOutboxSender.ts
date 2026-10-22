import { renderEmail } from '../domain/email';
import type { DeliveryReceipt, EmailRequest, EmailSender } from './types';

/**
 * Development only. Nothing here talks to a provider, and nothing here is allowed to say
 * "sent": a request leaves this sender as `queued`, with `simulated: true` on the receipt, and
 * the rendered HTML is stored so an operator can read exactly what would have gone out.
 *
 * It exists so every trigger, template, mute rule and idempotency path can be exercised before
 * any credentials exist — not to simulate a delivery for a demo.
 */

const OUTBOX_KEY = 'ESME_CU_DEV_OUTBOX_V1';

export type OutboxRecord = { request: EmailRequest; receipt: DeliveryReceipt; html: string; text: string };

export function readOutbox(): OutboxRecord[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxRecord[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(records: OutboxRecord[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(records.slice(-200)));
  } catch {
    // Private mode or a full quota: the app keeps working, and the queue is visibly empty.
  }
}

export function clearOutbox(): void {
  try {
    localStorage.removeItem(OUTBOX_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function createLocalOutboxSender(): EmailSender {
  return {
    kind: 'local-outbox',
    warningBanner:
      'Local email outbox: messages are rendered and stored on this device only. Nothing has been delivered — configure the server-side sender to send mail.',
    async send(request) {
      const rendered = renderEmail({ payload: request.payload, to: request.to, locale: request.locale });
      const receipt: DeliveryReceipt = {
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        status: 'queued',
        attemptedAt: new Date().toISOString(),
        simulated: true,
      };
      const records = readOutbox().filter((r) => r.request.idempotencyKey !== request.idempotencyKey);
      records.push({ request, receipt, html: rendered.html, text: rendered.text });
      writeOutbox(records);
      return receipt;
    },
  };
}

/**
 * The provider is configured, so this side has no sender. The write that created the record also
 * wrote an `esme_email_outbox` row, and the scheduled Edge Function drains it. A receipt here
 * would be a claim about a message this browser never touched, so the only honest answer is
 * `suppressed` with the reason the sender is on the server.
 */
export function createServerQueueSender(): EmailSender {
  return {
    kind: 'server-queue',
    warningBanner: '',
    async send(request) {
      return {
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        status: 'suppressed',
        attemptedAt: new Date().toISOString(),
        simulated: false,
        error: 'the database queue owns delivery; this device does not send mail',
      };
    },
  };
}

/** A production build with no sender. Refusing is the only honest answer it can give. */
export function createDisabledSender(): EmailSender {
  return {
    kind: 'disabled',
    warningBanner: 'No email sender is configured on this deployment, so no message can be sent.',
    async send(request) {
      return {
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        status: 'suppressed',
        attemptedAt: new Date().toISOString(),
        simulated: false,
        error: 'no-sender-configured',
      };
    },
  };
}
