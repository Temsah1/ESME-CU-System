import React, { useState } from 'react';
import { AlertTriangle, Mail, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { EMAIL_EVENTS, EMAIL_EVENT_LABELS, SECURITY_EVENTS, type EmailEvent } from '../../domain/email';
import type { EmailSenderKind } from '../../email';
import { EmptyState } from '../EmptyState';
import { useToast } from '../../motion';

/**
 * Part 4's visible half: what this device queued, what the sender actually answered, and what the
 * signed-in person wants to hear about. Nothing here claims a delivery the receipt did not report,
 * so a simulated message reads as simulated and a server-side queue is described as one.
 */

const cardClass = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm';
const headClass = 'bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[10px]';

const statusStyle: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  queued: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  suppressed: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const statusLabel = (entry: { request: { attempts: number }; receipt: { status: string } | null }) =>
  entry.receipt ? entry.receipt.status : `pending (try ${entry.request.attempts + 1})`;

const badgeFor = (kind: EmailSenderKind): { text: string; className: string } =>
  kind === 'server-queue'
    ? {
        text: 'Queued on the server',
        className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
      }
    : kind === 'local-outbox'
      ? {
          text: 'Simulated only — nothing is delivered',
          className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        }
      : {
          text: 'No real delivery yet',
          className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
        };

export const NotificationsAndEmail: React.FC = () => {
  const { email, currentUser, can } = useApp();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const isAdmin = can('notifications.manage');
  const muted = new Set(email.preferences?.mutedEvents ?? []);
  const badge = badgeFor(email.senderKind);
  const onServerQueue = email.senderKind === 'server-queue';

  const retry = async () => {
    setBusy(true);
    const summary = await email.retryFailed();
    setBusy(false);
    toast(
      summary
        ? `${summary.attempted} message(s) tried again — ${summary.byStatus.sent} sent, ${summary.byStatus.failed} failed, ${summary.byStatus.suppressed} suppressed.`
        : 'The sender did not answer that retry.',
      summary && summary.byStatus.failed + summary.byStatus.suppressed > 0 ? 'error' : 'success'
    );
  };

  const drain = async () => {
    setBusy(true);
    const summary = await email.flush();
    setBusy(false);
    toast(
      summary
        ? `${summary.attempted} message(s) handed to the ${email.senderKind} sender${summary.simulated > 0 ? ` — ${summary.simulated} simulated, nothing delivered` : ''}.`
        : 'Nothing was waiting in the queue.',
      'info'
    );
  };

  const chooseLocale = async (locale: 'en' | 'ar') => {
    const failure = await email.setLocale(locale);
    toast(failure ?? (locale === 'ar' ? 'Messages will be written in Arabic.' : 'Messages will be written in English.'), failure ? 'error' : 'info');
  };

  const toggle = async (event: EmailEvent, next: boolean) => {
    const failure = await email.mute(event, next);
    toast(
      failure ??
        (next ? `${EMAIL_EVENT_LABELS[event]} will not be emailed to you.` : `${EMAIL_EVENT_LABELS[event]} is emailed to you again.`),
      failure ? 'error' : 'info'
    );
  };

  if (!currentUser) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#123B60] dark:text-white flex items-center gap-2">
          <Mail className="w-5 h-5" aria-hidden />
          Alerts & Email
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Every record change below is written when the change is written. Delivery is the sender's answer, never the screen's.
        </p>
      </div>

      <div className={`${cardClass} p-4 flex flex-wrap items-start gap-3`}>
        <div className="flex-1 min-w-[240px]">
          <div className="text-[10px] uppercase font-bold text-slate-400">Outbound sender</div>
          <div className="font-bold text-slate-800 dark:text-slate-100">{email.senderKind}</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{email.reason}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase ${badge.className}`}>{badge.text}</span>
          {isAdmin && !onServerQueue && (
            <div className="flex gap-2">
              <button
                onClick={() => void drain()}
                disabled={busy || email.pending === 0}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-[#123B60] dark:text-[#F59A16] disabled:opacity-40"
              >
                Hand {email.pending} pending to sender
              </button>
              {email.failures.length > 0 && (
                <button
                  onClick={() => void retry()}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-[#123B60] text-white text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-40"
                >
                  <RefreshCw className="w-3 h-3" aria-hidden />
                  Retry {email.failures.length} failed
                </button>
              )}
            </div>
          )}
        </div>
        {email.senderWarning && (
          <div className="w-full rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-[11px] text-amber-900 dark:text-amber-200 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            {email.senderWarning}
          </div>
        )}
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        <div className={`${headClass} px-4 py-2 flex items-center justify-between`}>
          <span>{onServerQueue ? 'Messages this device would queue' : 'Messages this device queued'}</span>
          {isAdmin && !onServerQueue && email.entries.length > 0 && (
            <button
              onClick={() => {
                email.discardQueue();
                toast('The local queue was cleared. Records and the audit trail were not touched.', 'info');
              }}
              className="text-[10px] font-bold uppercase text-slate-500 inline-flex items-center gap-1 hover:text-rose-600"
            >
              <Trash2 className="w-3 h-3" aria-hidden />
              Clear queue
            </button>
          )}
        </div>
        {email.entries.length === 0 ? (
          <EmptyState
            title={onServerQueue ? 'This device queues nothing' : 'No message has been queued yet'}
            description={
              onServerQueue
                ? 'Delivery is decided where the record is written. Read the server queue with: select event, status, attempts, last_error from esme_email_outbox order by created_at desc limit 50;'
                : 'A request appears here when an application is decided, a task is assigned, work is reviewed or points are awarded.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Event</th>
                  <th className="px-4 py-2">Recipient</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Attempts</th>
                  <th className="px-4 py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {email.entries.slice(-40).reverse().map((entry) => (
                  <tr key={entry.request.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-200">{EMAIL_EVENT_LABELS[entry.request.event]}</td>
                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{entry.request.to}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          statusStyle[entry.receipt?.status ?? 'queued'] ?? 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {statusLabel(entry)}
                      </span>
                      {entry.receipt?.simulated && (
                        <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">simulated — not delivered</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{entry.request.attempts}</td>
                    <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                      {entry.receipt?.providerMessageId
                        ? `provider id ${entry.receipt.providerMessageId}`
                        : entry.receipt?.error ?? entry.request.lastError ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        <div className={`${headClass} px-4 py-2 flex flex-wrap items-center justify-between gap-2`}>
          <span>Your email preferences</span>
          <span className="normal-case font-normal text-[10px] text-slate-500 dark:text-slate-400">
            {email.preferences === null
              ? 'Reading your saved choices…'
              : email.preferencesStoredOn === 'server'
                ? 'Saved on the server — the sender honours them from any device'
                : 'Saved on this device only — no server is configured to read them'}
          </span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-bold uppercase text-slate-400">Language</span>
            {(['en', 'ar'] as const).map((locale) => (
              <button
                key={locale}
                onClick={() => void chooseLocale(locale)}
                disabled={email.preferences === null}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold disabled:opacity-40 ${
                  email.preferences?.locale === locale
                    ? 'bg-[#123B60] text-white border-[#123B60]'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                {locale === 'en' ? 'English' : 'العربية'}
              </button>
            ))}
          </div>
          <ul className="grid sm:grid-cols-2 gap-2">
            {EMAIL_EVENTS.map((event) => {
              const locked = SECURITY_EVENTS.includes(event);
              return (
                <li key={event}>
                  <label
                    className={`flex items-start gap-2 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-[11px] ${
                      locked ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!locked && !muted.has(event)}
                      disabled={locked || email.preferences === null}
                      onChange={(e) => void toggle(event, !e.target.checked)}
                      className="mt-0.5 accent-[#123B60]"
                    />
                    <span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{EMAIL_EVENT_LABELS[event]}</span>
                      <span className="block text-slate-400">
                        {locked ? (
                          <span className="inline-flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" aria-hidden />
                            Account safety notice — cannot be switched off
                          </span>
                        ) : muted.has(event) ? (
                          'Muted for this account'
                        ) : (
                          'Sent to your email address'
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};
