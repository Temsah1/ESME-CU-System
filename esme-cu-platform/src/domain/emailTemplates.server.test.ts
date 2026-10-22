import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EMAIL_EVENTS,
  EMAIL_EVENT_LABELS,
  SECURITY_EVENTS,
  renderEmail as renderClientEmail,
  type EmailEvent,
  type EmailPayload,
} from './email';
import {
  EMAIL_EVENTS as SERVER_EVENTS,
  EMAIL_EVENT_LABELS as SERVER_LABELS,
  SECURITY_EVENTS as SERVER_SECURITY,
  renderEmail as renderServerEmail,
  type EmailPayload as ServerPayload,
} from '../../supabase/functions/_shared/email.ts';

/**
 * `supabase/functions/_shared/email.ts` is a copy of `src/domain/email.ts`, because a deployable
 * Edge Function bundle can only import from inside `supabase/functions/`. A copy is only safe if
 * something proves it stayed a copy, so this file renders every event through both modules and
 * compares the output character by character. The third copy — the enum of event names inside
 * migration 0005, and the required-fields table inside the sender — is checked against the same list.
 */

type Samples = Record<EmailEvent, EmailPayload>;

const SAMPLES: Samples = {
  account_created: { event: 'account_created', fullName: 'Nada Salem', reference: 'REG-42' },
  account_approved: {
    event: 'account_approved',
    fullName: 'Nada Salem',
    loginUrl: 'https://esme.test/signin',
    committeeName: 'Media Committee',
  },
  account_rejected: { event: 'account_rejected', fullName: 'Nada Salem', reason: 'The portfolio was incomplete' },
  login_security_alert: {
    event: 'login_security_alert',
    fullName: 'Nada Salem',
    occurredAt: '2026-10-19T08:15:00Z',
    device: 'Chrome on Windows',
    location: 'Cairo, Egypt',
    wasNotYouUrl: 'https://esme.test/settings/security',
  },
  task_assigned: {
    event: 'task_assigned',
    fullName: 'Nada Salem',
    taskTitle: 'Issue 4 cover',
    deadline: '2026-10-25',
    points: 15,
    taskUrl: 'https://esme.test/dashboard?open=task%3At1',
    leaderName: 'Omar Fathy',
  },
  task_assigned_to_team: {
    event: 'task_assigned_to_team',
    supervisorName: 'Yara Adel',
    assigneeName: 'Nada Salem',
    taskTitle: 'Issue 4 cover',
    deadline: '2026-10-25',
    leaderName: 'Omar Fathy',
    taskUrl: 'https://esme.test/dashboard',
  },
  bonus_awarded: {
    event: 'bonus_awarded',
    fullName: 'Nada Salem',
    points: 10,
    reason: 'Stayed late for the launch',
    awarderName: 'Omar Fathy',
    newTotal: 145,
    taskTitle: 'Issue 4 cover',
  },
  warning_issued: {
    event: 'warning_issued',
    fullName: 'Nada Salem',
    severity: 'formal',
    reason: 'Two deadlines missed without notice',
    issuerName: 'Omar Fathy',
    evidenceUrl: 'https://esme.test/dashboard',
  },
  warning_escalated: { event: 'warning_escalated', recipientName: 'Yara Adel', memberName: 'Nada Salem', count: 3, windowDays: 60 },
  deadline_reminder: {
    event: 'deadline_reminder',
    fullName: 'Nada Salem',
    taskTitle: 'Issue 4 cover',
    deadline: '2026-10-25',
    daysRemaining: 2,
    taskUrl: 'https://esme.test/dashboard',
  },
  submission_revision_requested: {
    event: 'submission_revision_requested',
    fullName: 'Nada Salem',
    taskTitle: 'Issue 4 cover',
    feedback: 'Use the approved grid',
    taskUrl: 'https://esme.test/dashboard',
  },
  submission_approved: { event: 'submission_approved', fullName: 'Nada Salem', taskTitle: 'Issue 4 cover', points: 15, newTotal: 145 },
  submission_rejected: { event: 'submission_rejected', fullName: 'Nada Salem', taskTitle: 'Issue 4 cover', reason: 'Delivered after the print date' },
};

const sql = readFileSync(new URL('../../supabase/migrations/0005_email_notifications.sql', import.meta.url), 'utf8');
const sender = readFileSync(new URL('../../supabase/functions/send-email/index.ts', import.meta.url), 'utf8');

const enumFromMigration = (): string[] => {
  const block = sql.match(/create type esme_email_event as enum \(([\s\S]*?)\);/)?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

const requiredFieldsFromSender = (): string[] => {
  const block = sender.match(/const REQUIRED_FIELDS: Record<EmailEvent, string\[\]> = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
};

describe('the server template copy cannot drift from the client one', () => {
  it('agrees on which events exist, in which order, and which are security notices', () => {
    expect(SERVER_EVENTS).toEqual(EMAIL_EVENTS);
    expect(SERVER_SECURITY).toEqual(SECURITY_EVENTS);
    expect(SERVER_LABELS).toEqual(EMAIL_EVENT_LABELS);
  });

  it('covers every event with a sample, so a new template cannot skip this check', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...EMAIL_EVENTS].sort());
  });

  it('renders byte-identical mail for every event in both languages', () => {
    for (const event of EMAIL_EVENTS) {
      for (const locale of ['en', 'ar'] as const) {
        const payload = SAMPLES[event];
        const fromClient = renderClientEmail({ payload, to: 'member@esme.test', locale });
        const fromServer = renderServerEmail({ payload: payload as ServerPayload, to: 'member@esme.test', locale });
        const label = `${event} (${locale})`;
        expect(fromServer.subject, `${label} subject`).toBe(fromClient.subject);
        expect(fromServer.preheader, `${label} preheader`).toBe(fromClient.preheader);
        expect(fromServer.html, `${label} html`).toBe(fromClient.html);
        expect(fromServer.text, `${label} text`).toBe(fromClient.text);
      }
    }
  });

  it('keeps the same link rules when the payload carries no url', () => {
    const withoutLink = { ...SAMPLES.task_assigned, taskUrl: 'javascript:alert(1)' };
    expect(renderServerEmail({ payload: withoutLink as ServerPayload, to: 'a@b.test', locale: 'en' }).html).not.toContain('javascript:');
    expect(renderClientEmail({ payload: withoutLink, to: 'a@b.test', locale: 'en' }).html).not.toContain('javascript:');
  });
});

describe('the database and the sender name the same events', () => {
  it('migration 0005 declares exactly the client event list', () => {
    expect(enumFromMigration().sort()).toEqual([...EMAIL_EVENTS].sort());
  });

  it('the sender has a required-fields entry for every event', () => {
    expect([...requiredFieldsFromSender()].sort()).toEqual([...EMAIL_EVENTS].sort());
  });

  it('the sender never trusts a caller-supplied recipient or body', () => {
    // The only inputs the function reads from the request are the secret header and nothing else.
    expect(sender).not.toMatch(/body\.(to|html|subject|payload|recipient)/);
    expect(sender).toMatch(/x-esme-cron-secret/);
    expect(sender).toMatch(/refusing to run/);
  });
});
