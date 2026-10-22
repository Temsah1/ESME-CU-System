// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storage/migrations';
import type { EmailPayload } from '../domain/email';
import {
  MAX_ATTEMPTS,
  clearEmailQueue,
  drainEmailQueue,
  emailIdempotencyKey,
  enqueueEmail,
  failedEmails,
  readEmailPreferences,
  readEmailQueue,
  resetFailedAttempts,
  writeEmailPreferences,
} from './queue';
import { createDisabledSender, createLocalOutboxSender, readOutbox } from './localOutboxSender';
import type { DeliveryReceipt, EmailRequest, EmailSender } from './types';

const taskAssigned: EmailPayload = {
  event: 'task_assigned',
  fullName: 'Aya Student',
  taskTitle: 'Write the NDT workshop brief',
  deadline: '2026-12-01',
  points: 20,
  taskUrl: 'https://esme.example/workspace?open=task:1',
  leaderName: 'Omar Head',
};

const recipient = { recipientId: 'usr_member', to: 'Aya.Student@esme-cu.edu' };

function receiptFor(request: EmailRequest, status: DeliveryReceipt['status']): DeliveryReceipt {
  return {
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    status,
    attemptedAt: new Date().toISOString(),
    simulated: false,
  };
}

/** The kind only labels the sender; these tests assert what the stub answered, not who answered it. */
function stubSender(send: EmailSender['send']): EmailSender {
  return { kind: 'server-queue', warningBanner: '', send };
}

beforeEach(() => {
  localStorage.clear();
  clearEmailQueue();
});

describe('enqueueing an email request', () => {
  it('keys a request by event, recipient and record so a retried action is one message', () => {
    const first = enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_1:usr_member' });
    const second = enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_1:usr_member' });

    expect(first.queued).toBe(true);
    expect(second).toMatchObject({ queued: false, reason: 'duplicate' });
    expect(readEmailQueue()).toHaveLength(1);
    expect(readEmailQueue()[0].request.idempotencyKey).toBe(
      emailIdempotencyKey('task_assigned', 'usr_member', 'task_1:usr_member')
    );
  });

  it('normalises the address and refuses one that is not an address', () => {
    const ok = enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_1' });
    if (!ok.queued) throw new Error(`a valid address should queue, got ${ok.reason}`);
    expect(ok.request.to).toBe('aya.student@esme-cu.edu');

    const bad = enqueueEmail({ payload: taskAssigned, recipientId: 'usr_x', to: 'not-an-address', ref: 'task_2' });
    expect(bad).toEqual({ queued: false, reason: 'invalid-recipient' });
    expect(readEmailQueue()).toHaveLength(1);
  });

  it('lets a member mute a reminder but never a security notice', () => {
    writeEmailPreferences({
      userId: 'usr_member',
      locale: 'en',
      mutedEvents: ['task_assigned'],
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_9' })).toMatchObject({ queued: false, reason: 'muted' });

    const alert: EmailPayload = {
      event: 'login_security_alert',
      fullName: 'Aya Student',
      occurredAt: '2026-10-19T09:00:00.000Z',
      device: 'Chrome on Windows',
      wasNotYouUrl: 'https://esme.example/security',
    };
    // A stored list that carries a security event is corrected on the way in, not trusted.
    writeEmailPreferences({
      userId: 'usr_member',
      locale: 'en',
      mutedEvents: ['task_assigned', 'login_security_alert'],
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    expect(readEmailPreferences('usr_member').mutedEvents).toEqual(['task_assigned']);
    expect(enqueueEmail({ payload: alert, ...recipient, ref: 'session_1' }).queued).toBe(true);
  });

  it('ignores a mute written for a different account', () => {
    writeEmailPreferences({
      userId: 'usr_other',
      locale: 'en',
      mutedEvents: ['task_assigned'],
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_other_prefs' }).queued).toBe(true);
  });

  it('honours a stored locale for the recipient rather than the actor', () => {
    writeEmailPreferences({
      userId: 'usr_member',
      locale: 'ar',
      mutedEvents: [],
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    const result = enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_locale' });
    expect(result.queued && result.request.locale).toBe('ar');
  });
});

describe('draining the queue', () => {
  it('records the status the sender returned and does not resend a delivered message', async () => {
    enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_drain' });
    const send = vi.fn(async (request: EmailRequest) => ({ ...receiptFor(request, 'sent'), providerMessageId: 'rm_123' }));

    const first = await drainEmailQueue(stubSender(send));
    expect(first).toMatchObject({ attempted: 1, byStatus: { sent: 1 } });
    expect(readEmailQueue()[0].receipt).toMatchObject({ status: 'sent', providerMessageId: 'rm_123', simulated: false });

    const second = await drainEmailQueue(stubSender(send));
    expect(second.attempted).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a failure and stops at the attempt ceiling instead of looping', async () => {
    enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_fail' });
    const send = vi.fn(async (request: EmailRequest) => ({ ...receiptFor(request, 'failed'), error: 'provider-timeout' }));

    for (let attempt = 1; attempt <= MAX_ATTEMPTS + 2; attempt += 1) {
      await drainEmailQueue(stubSender(send));
      expect(send).toHaveBeenCalledTimes(Math.min(attempt, MAX_ATTEMPTS));
    }

    const entry = readEmailQueue()[0];
    expect(entry.request.attempts).toBe(MAX_ATTEMPTS);
    expect(entry.receipt).toMatchObject({ status: 'failed', error: 'provider-timeout' });
    expect(failedEmails()).toHaveLength(1);

    expect(resetFailedAttempts()).toBe(1);
    await drainEmailQueue(stubSender(send));
    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS + 1);
  });

  it('turns a sender that throws into a recorded failure, not a lost message', async () => {
    enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_throw' });
    const summary = await drainEmailQueue(
      stubSender(async () => {
        throw new Error('The function did not answer');
      })
    );
    expect(summary.byStatus.failed).toBe(1);
    expect(readEmailQueue()[0].receipt?.error).toBe('The function did not answer');
  });

  it('keeps the request id stable across attempts so the provider can dedupe', async () => {
    enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_stable' });
    const send = vi.fn(async (request: EmailRequest) => receiptFor(request, 'failed'));
    await drainEmailQueue(stubSender(send));
    await drainEmailQueue(stubSender(send));
    const [firstKey, secondKey] = send.mock.calls.map(([request]) => request.idempotencyKey);
    expect(firstKey).toBe(secondKey);
    expect(send.mock.calls[1][0].attempts).toBe(1);
  });
});

describe('the senders themselves', () => {
  it('the development outbox stores the rendered message and never claims delivery', async () => {
    const sender = createLocalOutboxSender();
    expect(sender.warningBanner).toMatch(/Nothing has been delivered/);
    enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_outbox' });
    await drainEmailQueue(sender);

    const record = readOutbox()[0];
    expect(record.receipt).toMatchObject({ status: 'queued', simulated: true });
    expect(record.html).toContain('Write the NDT workshop brief');
    expect(readEmailQueue()[0].receipt?.simulated).toBe(true);
  });

  it('a deployment with no sender suppresses rather than pretending', async () => {
    const sender = createDisabledSender();
    enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_disabled' });
    await drainEmailQueue(sender);
    expect(readEmailQueue()[0].receipt).toMatchObject({ status: 'suppressed', error: 'no-sender-configured', simulated: false });
  });

  it('keeps the outbox and the queue in their own storage keys', async () => {
    const sender = createLocalOutboxSender();
    enqueueEmail({ payload: taskAssigned, ...recipient, ref: 'task_keys' });
    await drainEmailQueue(sender);
    expect(localStorage.getItem('ESME_CU_DEV_OUTBOX_V1')).toContain('task_assigned');
    expect(localStorage.getItem(`${STORAGE_KEYS.v2}emailQueue`)).toContain('task_assigned');
  });
});
