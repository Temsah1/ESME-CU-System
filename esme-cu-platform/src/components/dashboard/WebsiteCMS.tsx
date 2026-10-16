import React, { useEffect, useState } from 'react';
import { Save, CircleCheck, Lock, TriangleAlert } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../motion';
import type { WebsiteContentConfig } from '../../types';

export const WebsiteCMS: React.FC = () => {
  const { websiteContent, updateWebsiteContent, can } = useApp();
  const { toast } = useToast();

  const [activeSection, setActiveSection] = useState<'hero' | 'about' | 'vision' | 'contact'>('hero');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const mayEdit = can('cms.settings.global');

  // Local draft state
  const [draft, setDraft] = useState<WebsiteContentConfig>(websiteContent);

  // A cached edit on another surface must not be silently overwritten by a stale draft here.
  useEffect(() => setDraft(websiteContent), [websiteContent]);

  const handleSave = () => {
    try {
      updateWebsiteContent(draft);
      setSavedAt(new Date().toLocaleTimeString());
      toast('Draft saved in this browser. Deploy the site to publish it.', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Save refused.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Public Website Content Management (CMS)</h1>
          <p className="text-xs text-slate-500">
            Customize headlines, supporting messages, objectives, and contact details without editing source code.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          {savedAt && (
            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
              <CircleCheck className="w-4 h-4" />
              Saved as a local draft at {savedAt}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={!mayEdit}
            className="px-5 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] disabled:opacity-50 disabled:hover:bg-[#F59A16] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            {mayEdit ? 'Save draft' : 'Read-only'}
          </button>
        </div>
      </div>

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

      <div className="rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-4 flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
        <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
        <p>
          Saving stores this text in the browser cache of the machine you are using. Nothing here is pushed to the live
          website: the public pages pick the configuration up on the next build and deploy, so the site you see online
          can differ from this draft.
        </p>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-1 flex overflow-x-auto">
        <button
          onClick={() => setActiveSection('hero')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeSection === 'hero' ? 'bg-[#123B60] text-white' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Hero Banner
        </button>
        <button
          onClick={() => setActiveSection('about')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeSection === 'about' ? 'bg-[#123B60] text-white' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          About & Profile
        </button>
        <button
          onClick={() => setActiveSection('vision')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeSection === 'vision' ? 'bg-[#123B60] text-white' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Official Vision 26–27
        </button>
        <button
          onClick={() => setActiveSection('contact')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeSection === 'contact' ? 'bg-[#123B60] text-white' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          Contact & Coordinates
        </button>
      </div>

      {/* Editor Body */}
      <fieldset
        disabled={!mayEdit}
        aria-label="Public website content editor"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6 min-w-0"
      >
        
        {activeSection === 'hero' && (
          <div className="space-y-4 max-w-2xl">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Hero Section Configuration</h2>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Top Badge Text</label>
              <input
                type="text"
                value={draft.hero.badge}
                onChange={(e) => setDraft({ ...draft, hero: { ...draft.hero, badge: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Headline</label>
              <input
                type="text"
                value={draft.hero.headline}
                onChange={(e) => setDraft({ ...draft, hero: { ...draft.hero, headline: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Supporting Message</label>
              <textarea
                rows={3}
                value={draft.hero.supportingMessage}
                onChange={(e) => setDraft({ ...draft, hero: { ...draft.hero, supportingMessage: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Primary CTA Label</label>
                <input
                  type="text"
                  value={draft.hero.ctaPrimary}
                  onChange={(e) => setDraft({ ...draft, hero: { ...draft.hero, ctaPrimary: e.target.value } })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Secondary CTA Label</label>
                <input
                  type="text"
                  value={draft.hero.ctaSecondary}
                  onChange={(e) => setDraft({ ...draft, hero: { ...draft.hero, ctaSecondary: e.target.value } })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {activeSection === 'about' && (
          <div className="space-y-4 max-w-2xl">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">About ESME & Society Profile</h2>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Section Title</label>
              <input
                type="text"
                value={draft.about.title}
                onChange={(e) => setDraft({ ...draft, about: { ...draft.about, title: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Founding Story & Chapter Origins</label>
              <textarea
                rows={4}
                value={draft.about.story}
                onChange={(e) => setDraft({ ...draft, about: { ...draft.about, story: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Chapter Purpose</label>
              <textarea
                rows={3}
                value={draft.about.purpose}
                onChange={(e) => setDraft({ ...draft, about: { ...draft.about, purpose: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
            </div>
          </div>
        )}

        {activeSection === 'vision' && (
          <div className="space-y-4 max-w-2xl">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">2026–2027 Vision Statement</h2>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Official Quote Statement</label>
              <textarea
                rows={2}
                value={draft.vision2027.quote}
                onChange={(e) => setDraft({ ...draft, vision2027: { ...draft.vision2027, quote: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none font-bold text-[#F59A16]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Vision Narrative</label>
              <textarea
                rows={4}
                value={draft.vision2027.description}
                onChange={(e) => setDraft({ ...draft, vision2027: { ...draft.vision2027, description: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
            </div>
          </div>
        )}

        {activeSection === 'contact' && (
          <div className="space-y-4 max-w-2xl">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Official Contact Coordinates</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Email</label>
                <input
                  type="email"
                  value={draft.contact.email}
                  onChange={(e) => setDraft({ ...draft, contact: { ...draft.contact, email: e.target.value } })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Phone</label>
                <input
                  type="tel"
                  value={draft.contact.phone}
                  onChange={(e) => setDraft({ ...draft, contact: { ...draft.contact, phone: e.target.value } })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Official Website URL</label>
                <input
                  type="text"
                  value={draft.contact.website}
                  onChange={(e) => setDraft({ ...draft, contact: { ...draft.contact, website: e.target.value } })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Social Handle</label>
                <input
                  type="text"
                  value={draft.contact.socialHandle}
                  onChange={(e) => setDraft({ ...draft, contact: { ...draft.contact, socialHandle: e.target.value } })}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Physical Location</label>
              <input
                type="text"
                value={draft.contact.location}
                onChange={(e) => setDraft({ ...draft, contact: { ...draft.contact, location: e.target.value } })}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
              />
            </div>
          </div>
        )}

      </fieldset>

    </div>
  );
};
