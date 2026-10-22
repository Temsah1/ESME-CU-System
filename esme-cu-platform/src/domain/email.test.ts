import { describe, expect, it } from 'vitest';
import {
  EMAIL_EVENT_LABELS,
  EMAIL_EVENTS,
  escapeHtml,
  isSecurityEvent,
  preferencesWithDefaults,
  renderEmail,
  safeUrl,
  shouldSend,
  shouldSendLoginAlert,
  type EmailPayload,
} from './email';

/** One representative payload per event, so a template cannot be added without being rendered. */
const SAMPLES: Record<EmailPayload['event'], EmailPayload> = {
  account_created: { event: 'account_created', fullName: 'Aya Student', reference: 'app_1' },
  account_approved: { event: 'account_approved', fullName: 'Aya Student', loginUrl: 'https://esme.example/login', committeeName: 'Technical Committee' },
  account_rejected: { event: 'account_rejected', fullName: 'Aya Student', reason: 'No seat in this season', reapplyUrl: 'https://esme.example/apply' },
  login_security_alert: {
    event: 'login_security_alert',
    fullName: 'Aya Student',
    occurredAt: '2026-10-19 09:00',
    device: 'Chrome on Windows',
    location: 'Cairo, EG',
    wasNotYouUrl: 'https://esme.example/security',
  },
  task_assigned: {
    event: 'task_assigned',
    fullName: 'Aya Student',
    taskTitle: 'Write the NDT workshop brief',
    deadline: '2026-12-01',
    points: 20,
    taskUrl: 'https://esme.example/workspace',
    leaderName: 'Omar Head',
  },
  task_assigned_to_team: {
    event: 'task_assigned_to_team',
    supervisorName: 'Sara Director',
    assigneeName: 'Aya Student',
    taskTitle: 'Write the NDT workshop brief',
    deadline: '2026-12-01',
    leaderName: 'Omar Head',
    taskUrl: 'https://esme.example/workspace',
  },
  bonus_awarded: { event: 'bonus_awarded', fullName: 'Aya Student', points: 15, reason: 'Ran the workshop', awarderName: 'Omar Head', newTotal: 115 },
  warning_issued: { event: 'warning_issued', fullName: 'Aya Student', severity: 'formal', reason: 'Missed two deadlines', issuerName: 'Omar Head' },
  warning_escalated: { event: 'warning_escalated', recipientName: 'Sara Director', memberName: 'Aya Student', count: 3, windowDays: 90 },
  deadline_reminder: {
    event: 'deadline_reminder',
    fullName: 'Aya Student',
    taskTitle: 'Write the NDT workshop brief',
    deadline: '2026-12-01',
    daysRemaining: 3,
    taskUrl: 'https://esme.example/workspace',
  },
  submission_revision_requested: {
    event: 'submission_revision_requested',
    fullName: 'Aya Student',
    taskTitle: 'Write the NDT workshop brief',
    feedback: 'Add the equipment list',
    taskUrl: 'https://esme.example/workspace',
  },
  submission_approved: { event: 'submission_approved', fullName: 'Aya Student', taskTitle: 'Write the NDT workshop brief', points: 20, newTotal: 120 },
  submission_rejected: { event: 'submission_rejected', fullName: 'Aya Student', taskTitle: 'Write the NDT workshop brief', reason: 'Delivered after the season closed' },
};

describe('email templates', () => {
  it('renders every declared event in both languages from its own record fields', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const event of EMAIL_EVENTS) {
        const rendered = renderEmail({ payload: SAMPLES[event], to: 'aya@esme.example', locale });
        expect(rendered.subject.length).toBeGreaterThan(0);
        expect(rendered.text.length).toBeGreaterThan(0);
        expect(rendered.html).not.toContain('undefined');
        expect(rendered.html).not.toContain('NaN');
        expect(rendered.html).toContain('ESME CU');
      }
    }
  });

  it('labels every event for the admin surface', () => {
    expect(Object.keys(EMAIL_EVENT_LABELS).sort()).toEqual([...EMAIL_EVENTS].sort());
  });

  it('lays an Arabic message out right-to-left and an English one left-to-right', () => {
    const ar = renderEmail({ payload: SAMPLES.account_created, to: 'aya@esme.example', locale: 'ar' });
    const en = renderEmail({ payload: SAMPLES.account_created, to: 'aya@esme.example', locale: 'en' });
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('lang="ar"');
    expect(en.html).toContain('dir="ltr"');
  });

  it('escapes a reason that contains markup instead of trusting it', () => {
    const payload: EmailPayload = {
      event: 'warning_issued',
      fullName: 'Aya Student',
      severity: 'formal',
      reason: '<script>alert(1)</script>',
      issuerName: 'Omar Head',
    };
    const rendered = renderEmail({ payload, to: 'aya@esme.example', locale: 'en' });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    // The plain-text part is not markup, so it carries the reason as written.
    expect(rendered.text).toContain('<script>alert(1)</script>');
  });

  it('drops a dangerous scheme from a link rather than escaping it into place', () => {
    const approved: EmailPayload = {
      event: 'account_approved',
      fullName: 'Aya Student',
      loginUrl: 'javascript:alert(1)',
    };
    expect(renderEmail({ payload: approved, to: 'aya@esme.example', locale: 'en' }).html).not.toContain('javascript:');
    expect(renderEmail({ payload: approved, to: 'aya@esme.example', locale: 'en' }).html).not.toContain('<a href');

    const assigned: EmailPayload = {
      event: 'task_assigned',
      fullName: 'Aya Student',
      taskTitle: 'Write the NDT workshop brief',
      deadline: '2026-12-01',
      points: 20,
      taskUrl: 'javascript:alert(1)',
      leaderName: 'Omar Head',
    };
    expect(renderEmail({ payload: assigned, to: 'aya@esme.example', locale: 'en' }).html).not.toContain('javascript:');
  });

  it('keeps a deadline reminder honest about a task that is already past due', () => {
    const past: EmailPayload = {
      event: 'deadline_reminder',
      fullName: 'Aya Student',
      taskTitle: 'Write the NDT workshop brief',
      deadline: '2026-12-01',
      daysRemaining: -4,
      taskUrl: 'https://esme.example/workspace',
    };
    expect(renderEmail({ payload: past, to: 'aya@esme.example', locale: 'en' }).text).toContain('4 day(s) past the deadline');
    expect(renderEmail({ payload: SAMPLES.deadline_reminder, to: 'aya@esme.example', locale: 'en' }).text).toContain('3 day(s) left');
  });

  it('escapes markup in every interpolated value', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('link and preference rules', () => {
  it('accepts only http(s) links', () => {
    expect(safeUrl('https://esme.example/x')).toContain('https://');
    expect(safeUrl('http://esme.example')).toContain('http://');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });

  it('marks the account-safety events as the ones nobody can switch off', () => {
    for (const event of ['account_created', 'account_approved', 'account_rejected', 'login_security_alert']) {
      expect(isSecurityEvent(event as EmailPayload['event'])).toBe(true);
    }
    expect(isSecurityEvent('deadline_reminder')).toBe(false);
  });

  it('suppresses a muted event but never a security one', () => {
    const prefs = preferencesWithDefaults(
      { locale: 'ar', mutedEvents: ['deadline_reminder', 'login_security_alert'] },
      'usr_1'
    );
    // The stored mute list claimed a security event; the reader removes it instead of honouring it.
    expect(prefs.mutedEvents).toEqual(['deadline_reminder']);
    expect(shouldSend(prefs, 'deadline_reminder')).toBe(false);
    expect(shouldSend(prefs, 'login_security_alert')).toBe(true);
    expect(shouldSend(undefined, 'bonus_awarded')).toBe(true);
  });

  it('alerts a sign-in from an unknown device and then only once per window', () => {
    const now = '2026-10-19T09:00:00.000Z';
    expect(shouldSendLoginAlert({ knownDevice: false, now, windowHours: 12 })).toBe(true);
    expect(shouldSendLoginAlert({ knownDevice: true, lastSentAt: '2026-10-19T05:00:00.000Z', now, windowHours: 12 })).toBe(false);
    expect(shouldSendLoginAlert({ knownDevice: true, lastSentAt: '2026-10-18T05:00:00.000Z', now, windowHours: 12 })).toBe(true);
  });
});
