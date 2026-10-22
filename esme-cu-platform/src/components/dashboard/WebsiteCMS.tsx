import React, { useMemo, useState } from 'react';
import { CircleCheck, Lock, Save, Send, TriangleAlert, Undo2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../motion';
import { validateContentDocument } from '../../domain/cms';
import { changedPaths, summarizeChanges } from '../../domain/publishing';
import type { WebsiteContentConfig } from '../../types';
import { AboutPanel, ContactPanel, HeroPanel, SharingPanel, VisionPanel, type PanelProps } from './cms/CopyPanels';
import { BlocksPanel, LinksPanel } from './cms/StructurePanels';
import { ImagesPanel } from './cms/ImagesPanel';
import { HistoryPanel } from './cms/HistoryPanel';
import type { DashboardView } from './DashboardShell';

type Tab = 'hero' | 'about' | 'vision' | 'contact' | 'sharing' | 'blocks' | 'links' | 'images' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'hero', label: 'Hero' },
  { id: 'about', label: 'About' },
  { id: 'vision', label: 'Vision' },
  { id: 'contact', label: 'Contact' },
  { id: 'sharing', label: 'Share card' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'links', label: 'Links' },
  { id: 'images', label: 'Images' },
  { id: 'history', label: 'History' },
];

/**
 * The content editor.
 *
 * One draft is held here and nowhere else: every panel edits it through `patch`, Save writes it to
 * the store (which runs it through the validator), and Publish is only offered once what is stored
 * matches what is on screen. That ordering is deliberate — publish promotes the stored draft, so a
 * half-typed sentence in this form must never be mistaken for something the live page has.
 */
export const WebsiteCMS: React.FC<{ onNavigate?: (view: DashboardView) => void }> = ({ onNavigate }) => {
  const {
    websiteContent,
    updateWebsiteContent,
    unpublishedChanges,
    publishWebsiteContent,
    discardWebsiteDraft,
    can,
  } = useApp();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>('hero');
  const [draft, setDraft] = useState<WebsiteContentConfig>(websiteContent);
  const [syncedFrom, setSyncedFrom] = useState<WebsiteContentConfig>(websiteContent);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishLabel, setPublishLabel] = useState('');

  const mayEdit = can('cms.settings.global');
  const mayPublish = can('cms.content.publish');

  // A cached edit on another surface must not be silently overwritten by a stale draft here, and a
  // save that the validator rewrote must show the document that was actually stored. Adjusted while
  // rendering rather than in an effect, so the form never paints a draft the store has moved past.
  if (syncedFrom !== websiteContent) {
    setSyncedFrom(websiteContent);
    setDraft(websiteContent);
  }

  const patch: PanelProps['patch'] = (updates) => setDraft((current) => ({ ...current, ...updates }));

  /** The same rules the store applies, run here so a refusal is seen before it is saved. */
  const check = useMemo(() => validateContentDocument(draft), [draft]);
  const unsaved = changedPaths(websiteContent, draft).length > 0;
  const waiting = unpublishedChanges.length;

  const handleSave = () => {
    try {
      updateWebsiteContent(draft);
      setSavedAt(new Date().toLocaleTimeString());
      toast(
        check.notes.length === 0
          ? 'Draft saved in this browser.'
          : `Draft saved with ${check.notes.length} field(s) adjusted: ${check.notes.join(' ')}`,
        check.notes.length === 0 ? 'success' : 'info'
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Save refused.', 'error');
    }
  };

  const handlePublish = () => {
    try {
      const outcome = publishWebsiteContent(publishLabel);
      setPublishLabel('');
      toast(
        outcome.unresolvedSlots.length > 0
          ? `Published. ${outcome.unresolvedSlots.length} slot(s) name a picture this device does not hold, so those blocks show the asset shipped with the build: ${outcome.unresolvedSlots.join(', ')}.`
          : `Published. The live page now says: ${summarizeChanges(outcome.revision.changes)}.`,
        'success'
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Publish refused.', 'error');
    }
  };

  const handleDiscard = () => {
    try {
      const { discarded } = discardWebsiteDraft();
      toast(discarded === 0 ? 'The draft already matches the live page.' : `Threw away ${discarded} unpublished field(s).`, 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Discard refused.', 'error');
    }
  };

  const publishBlockedBecause = !mayPublish
    ? 'Publishing the live page needs the cms.content.publish capability, which this role does not hold.'
    : unsaved
      ? 'Save the draft first: publish promotes what is stored, not what is unsaved in this form.'
      : waiting === 0
        ? 'Nothing to publish — the draft matches the live page.'
        : null;

  const panel = (() => {
    const props: PanelProps = { draft, patch };
    switch (tab) {
      case 'hero':
        return <HeroPanel {...props} />;
      case 'about':
        return <AboutPanel {...props} />;
      case 'vision':
        return <VisionPanel {...props} />;
      case 'contact':
        return <ContactPanel {...props} />;
      case 'sharing':
        return <SharingPanel {...props} />;
      case 'blocks':
        return <BlocksPanel {...props} />;
      case 'links':
        return <LinksPanel {...props} />;
      case 'images':
        return <ImagesPanel {...props} onNavigate={onNavigate} />;
      case 'history':
        return null;
    }
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Public website content</h1>
          <p className="text-xs text-slate-500">
            The words, blocks, links and pictures of the public page. Editing changes a draft; publishing puts it on
            the page.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {savedAt && (
            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <CircleCheck className="w-4 h-4" /> Draft saved {savedAt}
            </span>
          )}
          <span
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg ${
              waiting === 0
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
            }`}
          >
            {waiting === 0 ? 'Live page matches the draft' : `${waiting} field(s) waiting to publish`}
          </span>

          <label className="block">
            <span className="sr-only">Note for the publish history</span>
            <input
              value={publishLabel}
              onChange={(event) => setPublishLabel(event.target.value)}
              placeholder="What changed (optional)"
              aria-label="Note for the publish history"
              className="w-44 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] outline-none"
            />
          </label>

          <button
            onClick={handleSave}
            disabled={!mayEdit}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> Save draft
          </button>
          <button
            onClick={handlePublish}
            disabled={publishBlockedBecause !== null}
            className="px-4 py-2.5 rounded-xl bg-[#123B60] text-white text-xs font-bold hover:bg-[#0d2c47] transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <Send className="w-4 h-4" /> Publish live page
          </button>
          <button
            onClick={handleDiscard}
            disabled={!mayEdit || waiting === 0}
            className="px-3 py-2.5 rounded-xl border border-rose-200 dark:border-rose-500/40 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition flex items-center gap-1.5 disabled:opacity-50"
          >
            <Undo2 className="w-4 h-4" /> Discard draft
          </button>
        </div>
      </div>

      {publishBlockedBecause && (
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400" role="status">
          {publishBlockedBecause}
        </p>
      )}

      {!mayEdit && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 flex items-start gap-3 text-xs text-slate-600 dark:text-slate-300">
          <Lock className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" aria-hidden />
          <p>
            Global site copy is written by the <span className="font-mono text-[10px]">cms.settings.global</span>{' '}
            capability. Your role can read this configuration but not change it, and the provider — not this page — is
            what refuses a write attempt.
          </p>
        </div>
      )}

      {check.notes.length > 0 && (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200 space-y-1.5">
          <p className="flex items-start gap-3 text-xs font-bold">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
            Saving now would change what you typed, because the page will not accept it as written:
          </p>
          <ul className="list-disc pl-9 space-y-0.5 text-[11px] leading-relaxed">
            {check.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {mayEdit && check.notes.length === 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-start gap-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" aria-hidden />
          <p>
            Save stores the draft in this browser; Publish moves it onto the page a visitor reads. Neither is a deploy —
            this build ships through no provider, so the internet still serves the last bundle pushed to it. A publish
            is written to the history and can be rolled back from the History tab.
          </p>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-1 flex overflow-x-auto">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            aria-pressed={tab === entry.id}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
              tab === entry.id ? 'bg-[#123B60] text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm min-w-0">
          <HistoryPanel />
        </div>
      ) : (
        <fieldset
          disabled={!mayEdit}
          aria-label="Public website content editor"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6 min-w-0"
        >
          {panel}
        </fieldset>
      )}
    </div>
  );
};
