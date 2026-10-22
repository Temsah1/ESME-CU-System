import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMAIL_EVENT_LABELS,
  preferencesWithDefaults,
  type EmailLocale,
  type EmailPayload,
  type EmailPreferences,
} from '../domain/email';
import type { AuthAdapter } from '../auth/types';
import { resolveSender } from './index';
import {
  clearEmailQueue,
  drainEmailQueue,
  enqueueEmail,
  isRetryable,
  readEmailQueue,
  resetFailedAttempts,
  type DrainSummary,
  type EmailQueueEntry,
  type EnqueueResult,
} from './queue';
import type { EmailSender, EmailSenderKind } from './types';

/**
 * The React side of the email pipeline: it holds the sender chosen by `resolveSender`, keeps the
 * persisted queue in view state, and reports only what the sender returned. A caller that wants to
 * tell someone "an email was sent" has to read it off `lastReceipt`, which carries the provider's
 * status or the development sender's explicit `simulated: true`.
 */
export type EmailPipeline = {
  senderKind: EmailSenderKind;
  /** Non-empty whenever the active sender cannot actually deliver. The admin surface renders it. */
  senderWarning: string;
  reason: string;
  entries: EmailQueueEntry[];
  pending: number;
  failures: EmailQueueEntry[];
  lastDrain: DrainSummary | null;
  notify: (input: { payload: EmailPayload; recipientId: string; to: string; ref: string; locale?: EmailLocale }) => EnqueueResult;
  flush: () => Promise<DrainSummary | null>;
  retryFailed: () => Promise<DrainSummary | null>;
  discardQueue: () => void;
  preferences: EmailPreferences | null;
  /** Where the choices below are stored. `server` is the copy the sender reads before it mails. */
  preferencesStoredOn: 'server' | 'this device';
  /** `null` when the choice was saved, otherwise the message to show instead of a false success. */
  mute: (event: EmailPayload['event'], muted: boolean) => Promise<string | null>;
  setLocale: (locale: EmailLocale) => Promise<string | null>;
  labelOf: (event: EmailPayload['event']) => string;
};

export function useEmailPipeline(viewerId: string | undefined, adapter: AuthAdapter | null): EmailPipeline {
  const resolution = useMemo(() => resolveSender(), []);
  const sender: EmailSender = resolution.sender;

  const [entries, setEntries] = useState<EmailQueueEntry[]>(() => readEmailQueue());
  const [lastDrain, setLastDrain] = useState<DrainSummary | null>(null);
  const [preferences, setPreferences] = useState<EmailPreferences | null>(null);
  const draining = useRef(false);

  useEffect(() => {
    if (!viewerId || !adapter) {
      setPreferences(null);
      return;
    }
    let current = true;
    void adapter
      .readEmailPreferences()
      .then((saved) => {
        if (current) setPreferences(preferencesWithDefaults(saved ?? undefined, viewerId));
      })
      .catch(() => {
        // Reading is not enough to send: fall back to the defaults and let the save below report
        // the outage when the member actually tries to change something.
        if (current) setPreferences(preferencesWithDefaults(undefined, viewerId));
      });
    return () => {
      current = false;
    };
  }, [adapter, viewerId]);

  /** Applies the change locally, hands it to the provider, and rolls back if the provider refused. */
  const persistPreferences = useCallback(
    async (next: EmailPreferences): Promise<string | null> => {
      if (!adapter || !viewerId) return 'You are not signed in, so nothing was saved.';
      const previous = preferences;
      setPreferences(next);
      const result = await adapter.saveEmailPreferences(next).catch((error: unknown) => ({
        ok: false as const,
        error: { code: 'email-preferences', message: error instanceof Error ? error.message : 'The save failed.' },
      }));
      if (!result.ok) {
        setPreferences(previous);
        return result.error?.message ?? 'The chapter could not save those email preferences.';
      }
      // Re-read so the screen shows what the server stored, not what this browser asked for.
      const saved = await adapter.readEmailPreferences().catch(() => null);
      setPreferences(preferencesWithDefaults(saved ?? next, viewerId));
      return null;
    },
    [adapter, preferences, viewerId]
  );

  const refresh = useCallback(() => setEntries(readEmailQueue()), []);

  const notify = useCallback<EmailPipeline['notify']>(
    (input) => {
      const result = enqueueEmail(input);
      if (result.queued) refresh();
      return result;
    },
    [refresh]
  );

  const flush = useCallback(async () => {
    if (draining.current) return null;
    draining.current = true;
    try {
      const summary = await drainEmailQueue(sender);
      setLastDrain(summary);
      refresh();
      return summary.attempted > 0 ? summary : null;
    } finally {
      draining.current = false;
    }
  }, [refresh, sender]);

  const pending = entries.filter(isRetryable).length;
  const failures = entries.filter((e) => e.receipt?.status === 'failed' || e.receipt?.status === 'suppressed');

  // A message written into the queue is handed to the sender on the same tick it appears.
  useEffect(() => {
    if (pending === 0) return;
    const timer = window.setTimeout(() => void flush(), 0);
    return () => window.clearTimeout(timer);
  }, [flush, pending]);

  const retryFailed = useCallback(async () => {
    resetFailedAttempts();
    refresh();
    return flush();
  }, [flush, refresh]);

  const discardQueue = useCallback(() => {
    clearEmailQueue();
    refresh();
  }, [refresh]);

  const mute = useCallback(
    async (event: EmailPayload['event'], muted: boolean) => {
      if (!preferences) return 'Choose your email settings again once your account has loaded.';
      const next: EmailPreferences = {
        ...preferences,
        mutedEvents: muted
          ? [...new Set([...preferences.mutedEvents, event])]
          : preferences.mutedEvents.filter((e) => e !== event),
        updatedAt: new Date().toISOString(),
      };
      return persistPreferences(next);
    },
    [persistPreferences, preferences]
  );

  const setLocale = useCallback(
    async (locale: EmailLocale) => {
      if (!preferences) return 'Choose your email settings again once your account has loaded.';
      return persistPreferences({ ...preferences, locale, updatedAt: new Date().toISOString() });
    },
    [persistPreferences, preferences]
  );

  return {
    senderKind: sender.kind,
    senderWarning: sender.warningBanner,
    reason: resolution.reason,
    entries,
    pending,
    failures,
    lastDrain,
    notify,
    flush,
    retryFailed,
    discardQueue,
    preferences,
    preferencesStoredOn: adapter?.kind === 'supabase' ? 'server' : 'this device',
    mute,
    setLocale,
    labelOf: (event) => EMAIL_EVENT_LABELS[event],
  };
}
