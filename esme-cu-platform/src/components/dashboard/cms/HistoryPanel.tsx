import React from 'react';
import { ExternalLink, History, RotateCcw } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useToast } from '../../../motion';
import { documentsMatch, summarizeChanges } from '../../../domain/publishing';
import { TinyButton } from './fields';

/**
 * What is live, what is waiting, and how to get an older page back.
 *
 * The live document is the one the public site renders; the draft is what the editor holds. Reading
 * them side by side is the point of this panel — an operator should be able to answer "what would a
 * visitor see if I published now" without a deploy, and undo a publish that should not have happened.
 */

const shown = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
};

export const HistoryPanel: React.FC = () => {
  const { publishedContent, contentRevisions, unpublishedChanges, restoreContentRevision, can } = useApp();
  const { toast } = useToast();
  const mayPublish = can('cms.content.publish');

  const origin = contentRevisions.find((revision) => documentsMatch(revision.document, publishedContent));

  const restore = (id: string) => {
    try {
      const outcome = restoreContentRevision(id);
      toast(
        outcome.unresolvedSlots.length > 0
          ? `Rolled the live page back. ${outcome.unresolvedSlots.length} slot(s) name a picture this device does not hold, so those blocks show the asset shipped with the build.`
          : 'Rolled the live page back to that revision. The rollback is recorded as a new entry.',
        'success'
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Restore refused.', 'error');
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="space-y-1">
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Live page and history</h2>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          Publishing moves the draft onto the page a visitor reads, in this app. It is not a deploy: the build ships
          through no provider, so what the internet sees is still the last bundle pushed to it.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">The page as it stands</p>
        <p className="text-sm font-bold text-slate-900 dark:text-white">{publishedContent.hero.headline}</p>
        <p className="text-[11px] text-slate-500">
          {origin
            ? `Published ${shown(origin.savedAt)} by ${origin.actorName || 'an account this device cannot name'}${
                origin.label === '' ? '' : ` — “${origin.label}”`
              }.`
            : 'Nobody has published from this browser, so the page still shows the copy shipped with the build.'}
        </p>
        <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
          {unpublishedChanges.length === 0
            ? 'The draft matches the live page.'
            : `${unpublishedChanges.length} field(s) in the draft are not on the live page: ${summarizeChanges(unpublishedChanges)}`}
        </p>
        <TinyButton onClick={() => window.open('/', '_blank', 'noopener')} className="inline-flex items-center gap-1.5 mt-1">
          <ExternalLink className="w-3.5 h-3.5" /> Open the live page
        </TinyButton>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" /> Published revisions
        </p>
        {contentRevisions.length === 0 && (
          <p className="text-xs text-slate-500 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4">
            No revision is recorded on this device. The first publish writes the first entry, and a rollback is kept as
            its own entry so the history still answers who published what and when.
          </p>
        )}
        <ol className="space-y-2">
          {contentRevisions.map((revision) => {
            const isLive = documentsMatch(revision.document, publishedContent);
            return (
              <li key={revision.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {shown(revision.savedAt)}
                      {isLive && <span className="ml-2 text-[10px] font-black uppercase text-emerald-600">live now</span>}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {revision.actorName || revision.actorId || 'no name recorded'}
                      {revision.label === '' ? '' : ` — “${revision.label}”`}
                    </p>
                  </div>
                  <TinyButton
                    tone={isLive ? 'neutral' : 'brand'}
                    disabled={isLive || !mayPublish}
                    onClick={() => restore(revision.id)}
                    className="inline-flex items-center gap-1.5 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {isLive ? 'Already live' : 'Restore this'}
                  </TinyButton>
                </div>
                <p className="text-[11px] font-mono leading-relaxed text-slate-400">{summarizeChanges(revision.changes)}</p>
                {!mayPublish && (
                  <p className="text-[11px] text-slate-500">Restoring a revision writes the live page, so it needs the publish capability.</p>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};
