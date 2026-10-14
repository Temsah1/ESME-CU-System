import React, { useState } from 'react';
import { 
  Globe, 
  Save, 
  RotateCcw, 
  CheckCircle2, 
  Sliders, 
  Sparkles, 
  Eye, 
  Layers, 
  FileText 
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import type { WebsiteContentConfig } from '../../types';

export const WebsiteCMS: React.FC = () => {
  const { websiteContent, updateWebsiteContent } = useApp();
  
  const [activeSection, setActiveSection] = useState<'hero' | 'about' | 'vision' | 'contact'>('hero');
  const [savedMessage, setSavedMessage] = useState(false);

  // Local draft state
  const [draft, setDraft] = useState<WebsiteContentConfig>(websiteContent);

  const handleSave = () => {
    updateWebsiteContent(draft);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 3000);
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

        <div className="flex items-center gap-2">
          {savedMessage && (
            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" />
              Published Live!
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-5 py-2.5 bg-[#F59A16] hover:bg-[#D47F0A] text-white text-xs font-bold rounded-xl shadow-md transition flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            Save & Publish
          </button>
        </div>
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
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
        
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

      </div>

    </div>
  );
};
