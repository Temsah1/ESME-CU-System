/**
 * ESME CU — outbound email sender.
 *
 * Deployed as a Supabase Edge Function and invoked on a schedule (supabase/README.md has the
 * pg_cron and dashboard setup). It does one job: drain the queue the database filled, hand each
 * message to the provider, and write down what the provider answered.
 *
 * What it deliberately cannot do:
 *   * accept a recipient, a subject or an HTML body from the caller — every field is read from
 *     esme_email_outbox, which only the authoritative triggers write;
 *   * send anything when the provider is not configured — it fails closed and leaves the rows
 *     queued, rather than reporting success the member would never receive;
 *   * run for an anonymous caller — the scheduler must present EMAIL_CRON_SECRET, or a public
 *     URL becomes a way to drain and probe the queue.
 *
 * Requests to Postgres go through PostgREST RPC with the service-role key, so this bundle has
 * no runtime dependencies beyond the Deno global.
 */

import {
  renderEmail,
  type EmailEvent,
  type EmailLocale,
  type EmailPayload,
} from '../_shared/email.ts';

const RESEND_API = 'https://api.resend.com/emails';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? '';
const APP_URL = Deno.env.get('APP_PUBLIC_URL') ?? '';
const CRON_SECRET = Deno.env.get('EMAIL_CRON_SECRET') ?? '';

const MAX_ATTEMPTS = int(Deno.env.get('EMAIL_MAX_ATTEMPTS'), 3);
const BATCH_LIMIT = Math.min(int(Deno.env.get('EMAIL_BATCH_LIMIT'), 20), 100);
const SEND_DELAY_MS = Math.min(int(Deno.env.get('EMAIL_SEND_DELAY_MS'), 250), 5000);

/** Fields each template interpolates. A queue row missing one is suppressed, never guessed at. */
const REQUIRED_FIELDS: Record<EmailEvent, string[]> = {
  account_created: ['fullName', 'reference'],
  account_approved: ['fullName'],
  account_rejected: ['fullName'],
  login_security_alert: ['fullName', 'occurredAt', 'device'],
  task_assigned: ['fullName', 'taskTitle', 'deadline', 'points', 'leaderName'],
  task_assigned_to_team: ['supervisorName', 'assigneeName', 'taskTitle', 'deadline', 'leaderName'],
  bonus_awarded: ['fullName', 'points', 'reason', 'awarderName', 'newTotal'],
  warning_issued: ['fullName', 'severity', 'reason', 'issuerName'],
  warning_escalated: ['recipientName', 'memberName', 'count', 'windowDays'],
  deadline_reminder: ['fullName', 'taskTitle', 'deadline', 'daysRemaining'],
  submission_revision_requested: ['fullName', 'taskTitle', 'feedback'],
  submission_approved: ['fullName', 'taskTitle', 'points', 'newTotal'],
  submission_rejected: ['fullName', 'taskTitle', 'reason'],
};

function int(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Equal-length, non-short-circuiting compare: a wrong secret must not leak its own prefix. */
function secretsMatch(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`${fn} failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

type OutboxRow = {
  id: number;
  event: EmailEvent;
  payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
};

type RecipientInfo = {
  event: EmailEvent;
  payload: Record<string, unknown>;
  email: string | null;
  status: string;
  locale: EmailLocale;
  muted: boolean;
};

/**
 * Links are composed here, from the app's own origin, because a database trigger has no idea
 * what hostname the site is served from. Nothing from the payload is trusted as a URL: safeUrl()
 * inside the template layer still decides whether the link is rendered at all.
 */
function actionUrl(event: EmailEvent, payload: Record<string, unknown>): string | undefined {
  if (!APP_URL) return undefined;
  const root = APP_URL.replace(/\/+$/, '');
  const taskId = payload.taskId;
  switch (event) {
    case 'account_approved':
      return `${root}/signin`;
    case 'account_rejected':
      return `${root}/register`;
    case 'login_security_alert':
      return `${root}/settings/security`;
    case 'task_assigned':
    case 'task_assigned_to_team':
    case 'deadline_reminder':
    case 'submission_revision_requested':
      return taskId ? `${root}/dashboard?open=${encodeURIComponent(`task:${String(taskId)}`)}` : `${root}/dashboard`;
    default:
      return undefined;
  }
}

function buildPayload(info: RecipientInfo): EmailPayload | string {
  const required = REQUIRED_FIELDS[info.event];
  const data = info.payload;
  for (const field of required) {
    const value = data[field];
    if (value === null || value === undefined || value === '') {
      return `payload is missing "${field}"`;
    }
  }
  return { event: info.event, ...data } as EmailPayload;
}

type Outcome = { kind: 'sent' | 'failed' | 'suppressed'; messageId?: string; error?: string };

async function send(rendered: ReturnType<typeof renderEmail>, ref: string): Promise<Outcome> {
  try {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // Resend drops a second message carrying the same reference within its dedupe window,
        // so a retried run of this function cannot put two copies in one inbox.
        'X-Entity-Ref-ID': ref,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [rendered.to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: { 'X-Preheader': rendered.preheader },
      }),
    });

    const body = await response.text();
    if (!response.ok) {
      return { kind: 'failed', error: `provider ${response.status}: ${body.slice(0, 300)}` };
    }
    let id = '';
    try {
      id = String(JSON.parse(body)?.id ?? '');
    } catch {
      // A 2xx with an unreadable body still means the provider took the message; the id is lost.
    }
    return { kind: 'sent', messageId: id || undefined };
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error.message : 'network error' };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'post-only: the scheduler drains the queue' });
  }

  // Fail closed on every missing piece of configuration. A half-set-up sender must not pretend.
  if (!CRON_SECRET) return json(503, { error: 'EMAIL_CRON_SECRET is not set; refusing to run' });
  if (!secretsMatch(req.headers.get('x-esme-cron-secret') ?? '', CRON_SECRET)) {
    return json(401, { error: 'the scheduler secret did not match' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return json(503, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' });
  if (!RESEND_API_KEY || !RESEND_FROM) {
    return json(503, { error: 'email provider is not configured; nothing was sent and the queue is untouched' });
  }

  const summary = { claimed: 0, sent: 0, failed: 0, suppressed: 0, errors: [] as string[] };

  for (let i = 0; i < BATCH_LIMIT; i++) {
    let rows: OutboxRow[];
    try {
      rows = await rpc<OutboxRow[]>('esme_claim_next_email', { p_max_attempts: MAX_ATTEMPTS });
    } catch (error) {
      summary.errors.push(String(error));
      break;
    }
    const row = rows?.[0];
    if (!row) break;
    summary.claimed++;

    let outcome: Outcome;
    try {
      const info = await rpc<RecipientInfo>('esme_email_recipient', { p_outbox_id: row.id });

      if (!info.email) {
        // Nothing can be delivered to a profile with no address, now or on a retry.
        outcome = { kind: 'suppressed', error: 'recipient has no email address on file' };
      } else if (info.muted && !isSecurityRow(row.event)) {
        // A message the preferences silence is a suppression, not a provider failure: it must
        // not burn the retry budget or read as an outage to an admin.
        outcome = { kind: 'suppressed', error: 'suppressed by recipient preferences' };
      } else {
        const payload = buildPayload(info);
        if (typeof payload === 'string') {
          outcome = { kind: 'suppressed', error: payload };
        } else {
          const rendered = renderEmail({
            payload,
            to: info.email,
            locale: info.locale === 'ar' ? 'ar' : 'en',
            actionUrl: actionUrl(row.event, row.payload),
          });
          outcome = await send(rendered, row.idempotency_key);
        }
      }
    } catch (error) {
      outcome = { kind: 'failed', error: error instanceof Error ? error.message : 'sender error' };
    }

    try {
      await rpc('esme_record_email_result', {
        p_outbox_id: row.id,
        p_status: outcome.kind,
        p_provider_message_id: outcome.messageId ?? null,
        p_error: outcome.error ?? null,
        p_max_attempts: MAX_ATTEMPTS,
      });
      if (outcome.kind === 'sent') summary.sent++;
      else if (outcome.kind === 'suppressed') summary.suppressed++;
      else summary.failed++;
    } catch (error) {
      // The row stays 'processing' and is handed back after ten minutes; the provider already
      // has the message, so the reference header stops a second copy if it is attempted again.
      summary.errors.push(`recording row ${row.id}: ${String(error)}`);
    }

    if (SEND_DELAY_MS > 0 && i + 1 < BATCH_LIMIT) await delay(SEND_DELAY_MS);
  }

  return json(200, { ...summary, provider: 'resend', simulated: false });
});

function isSecurityRow(event: EmailEvent): boolean {
  return ['account_created', 'account_approved', 'account_rejected', 'login_security_alert'].includes(event);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
