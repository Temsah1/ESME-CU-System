import type { EmailLocale, EmailPayload } from '../domain/email';

/**
 * One request per message, never one per attempt. A retried click, a replayed queue drain and a
 * duplicate sweep all carry the same `idempotencyKey`, which is what makes "no duplicate sends"
 * a property of the system rather than of the caller's good intentions.
 */
export type EmailRequest = {
  id: string;
  event: EmailPayload['event'];
  /** The account the message is about, so a rename or a mute applies to the person, not the address. */
  recipientId: string;
  to: string;
  locale: EmailLocale;
  payload: EmailPayload;
  idempotencyKey: string;
  createdAt: string;
  /** How many times a sender has tried this request. */
  attempts: number;
  lastError?: string;
};

export type DeliveryStatus = 'queued' | 'sent' | 'failed' | 'suppressed';

export type DeliveryReceipt = {
  requestId: string;
  idempotencyKey: string;
  status: DeliveryStatus;
  attemptedAt: string;
  /** True only for the development outbox. It is what stops a UI from claiming delivery. */
  simulated: boolean;
  /** The provider's own id, when the provider returned one. Never invented. */
  providerMessageId?: string;
  error?: string;
};

/**
 * `local-outbox` — development: keep the message, render it for inspection, deliver nothing.
 * `server-queue` — a provider is configured: the browser holds no sender at all. The write that
 *   changes the record also writes `esme_email_outbox`, and the scheduled Edge Function drains it.
 *   Anything this side claims about delivery would be a guess, so it claims nothing.
 * `disabled` — a production build with no provider configured. Refuses instead of pretending.
 */
export type EmailSenderKind = 'local-outbox' | 'server-queue' | 'disabled';

export interface EmailSender {
  readonly kind: EmailSenderKind;
  /** Rendered in the admin surface whenever the sender cannot actually deliver. Empty when it can. */
  readonly warningBanner: string;
  send(request: EmailRequest): Promise<DeliveryReceipt>;
}
