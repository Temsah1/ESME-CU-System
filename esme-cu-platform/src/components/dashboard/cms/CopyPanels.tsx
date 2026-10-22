import React from 'react';
import type { WebsiteContentConfig } from '../../../types';
import { useApp } from '../../../context/AppContext';
import { resolveImage } from '../../../domain/cms';
import { PanelTitle, StringListField, TextField } from './fields';

/**
 * The words on the page. Each panel edits the draft the shell holds; nothing here writes to the
 * store, because a half-typed sentence must not reach the cached draft, let alone the live page.
 */

export type PanelProps = {
  draft: WebsiteContentConfig;
  patch: (updates: Partial<WebsiteContentConfig>) => void;
};

const column = 'space-y-4 max-w-2xl';

export const HeroPanel: React.FC<PanelProps> = ({ draft, patch }) => {
  const set = (updates: Partial<WebsiteContentConfig['hero']>) => patch({ hero: { ...draft.hero, ...updates } });
  return (
    <div className={column}>
      <PanelTitle title="Hero section">
        The first thing a visitor reads. The share card falls back to the headline and supporting message when
        Sharing is left empty.
      </PanelTitle>
      <TextField label="Top badge text" value={draft.hero.badge} onChange={(badge) => set({ badge })} />
      <TextField label="Headline" value={draft.hero.headline} onChange={(headline) => set({ headline })} />
      <TextField
        label="Supporting message"
        rows={3}
        value={draft.hero.supportingMessage}
        onChange={(supportingMessage) => set({ supportingMessage })}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="Primary call to action" value={draft.hero.ctaPrimary} onChange={(ctaPrimary) => set({ ctaPrimary })} />
        <TextField label="Secondary call to action" value={draft.hero.ctaSecondary} onChange={(ctaSecondary) => set({ ctaSecondary })} />
      </div>
    </div>
  );
};

export const AboutPanel: React.FC<PanelProps> = ({ draft, patch }) => {
  const set = (updates: Partial<WebsiteContentConfig['about']>) => patch({ about: { ...draft.about, ...updates } });
  return (
    <div className={column}>
      <PanelTitle title="About the chapter">
        The story, the purpose and the two lists the block prints under them. An empty line is dropped when the
        draft is saved, so a blank row never reaches the page.
      </PanelTitle>
      <TextField label="Section title" value={draft.about.title} onChange={(title) => set({ title })} />
      <TextField label="Founding story" rows={5} value={draft.about.story} onChange={(story) => set({ story })} />
      <TextField label="Chapter purpose" rows={4} value={draft.about.purpose} onChange={(purpose) => set({ purpose })} />
      <StringListField
        label="Objectives"
        items={draft.about.objectives}
        onChange={(objectives) => set({ objectives })}
        placeholder="Write one objective"
      />
      <StringListField label="Values" items={draft.about.values} onChange={(values) => set({ values })} placeholder="Write one value" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TextField label="Founded" value={draft.about.foundedYear} onChange={(foundedYear) => set({ foundedYear })} />
        <TextField
          label="Founding faculty"
          value={draft.about.foundingFaculty}
          onChange={(foundingFaculty) => set({ foundingFaculty })}
        />
        <TextField
          label="Cairo chapter founded"
          value={draft.about.cairoChapterFounded}
          onChange={(cairoChapterFounded) => set({ cairoChapterFounded })}
        />
      </div>
    </div>
  );
};

export const VisionPanel: React.FC<PanelProps> = ({ draft, patch }) => {
  const set = (updates: Partial<WebsiteContentConfig['vision2027']>) =>
    patch({ vision2027: { ...draft.vision2027, ...updates } });
  const setPillar = (index: number, updates: Partial<WebsiteContentConfig['vision2027']['pillars'][number]>) =>
    set({ pillars: draft.vision2027.pillars.map((pillar, position) => (position === index ? { ...pillar, ...updates } : pillar)) });

  return (
    <div className={column}>
      <PanelTitle title="Vision statement">
        The quote, the narrative and the pillars the block lists. Pillars are stored in the order written here.
      </PanelTitle>
      <TextField label="Section headline" value={draft.vision2027.headline} onChange={(headline) => set({ headline })} />
      <TextField label="Official quote" rows={2} value={draft.vision2027.quote} onChange={(quote) => set({ quote })} />
      <TextField
        label="Vision narrative"
        rows={4}
        value={draft.vision2027.description}
        onChange={(description) => set({ description })}
      />

      <fieldset className="space-y-4">
        <legend className="text-xs font-bold text-slate-700 dark:text-slate-300">Pillars</legend>
        {draft.vision2027.pillars.map((pillar, index) => (
          <div key={index} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Pillar {index + 1}</span>
              <button
                type="button"
                aria-label={`Remove pillar ${index + 1}`}
                onClick={() => set({ pillars: draft.vision2027.pillars.filter((_, position) => position !== index) })}
                className="text-[11px] font-bold text-rose-600 hover:underline"
              >
                Remove
              </button>
            </div>
            <TextField label="Title" value={pillar.title} onChange={(title) => setPillar(index, { title })} />
            <TextField
              label="Description"
              rows={3}
              value={pillar.description}
              onChange={(description) => setPillar(index, { description })}
            />
            <StringListField
              label={`Pillar ${index + 1} points`}
              items={pillar.points}
              onChange={(points) => setPillar(index, { points })}
              placeholder="Write one point"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => set({ pillars: [...draft.vision2027.pillars, { title: '', description: '', points: [] }] })}
          className="text-[11px] font-bold text-[#D47F0A] hover:underline"
        >
          Add a pillar
        </button>
        {draft.vision2027.pillars.length === 0 && (
          <p className="text-[11px] text-slate-500">No pillar is listed, so the block renders without them.</p>
        )}
      </fieldset>
    </div>
  );
};

export const ContactPanel: React.FC<PanelProps> = ({ draft, patch }) => {
  const set = (updates: Partial<WebsiteContentConfig['contact']>) => patch({ contact: { ...draft.contact, ...updates } });
  return (
    <div className={column}>
      <PanelTitle title="Contact coordinates">
        Saved as addresses, not as markup: anything but http(s) in the website field is refused when the draft is
        written, and the page prints what is left.
      </PanelTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="Email" type="email" value={draft.contact.email} onChange={(email) => set({ email })} />
        <TextField label="Phone" type="tel" value={draft.contact.phone} onChange={(phone) => set({ phone })} />
      </div>
      <TextField
        label="Official website"
        value={draft.contact.website}
        onChange={(website) => set({ website })}
        hint="An http(s) address the page may link to. A javascript: or data: address is refused and stored empty."
      />
      <TextField label="Physical location" rows={2} value={draft.contact.location} onChange={(location) => set({ location })} />
    </div>
  );
};

/** The card a pasted link becomes. It reads the same three fields the page's head tags are written from. */
export const SharingPanel: React.FC<PanelProps> = ({ draft, patch }) => {
  const { mediaLibrary } = useApp();
  const set = (updates: Partial<WebsiteContentConfig['sharing']>) => patch({ sharing: { ...draft.sharing, ...updates } });
  const assetById = (assetId: string) => mediaLibrary.find((asset) => asset.id === assetId);
  const card = resolveImage(
    draft,
    'sharing.ogImage',
    { src: '/branding/esme_team_celebration.png', alt: 'ESME CU Student Chapter' },
    assetById
  );

  return (
    <div className={column}>
      <PanelTitle title="Share card">
        What a link to the site shows when someone pastes it. Left empty, the page falls back to the hero headline
        and supporting message, so the card never goes out blank.
      </PanelTitle>
      <TextField
        label="Card title"
        value={draft.sharing.title}
        onChange={(title) => set({ title })}
        hint={draft.sharing.title === '' ? `Empty, so the card uses the headline: “${draft.hero.headline}”.` : undefined}
      />
      <TextField
        label="Card description"
        rows={3}
        value={draft.sharing.description}
        onChange={(description) => set({ description })}
        hint={
          draft.sharing.description === ''
            ? 'Empty, so the card uses the hero supporting message.'
            : undefined
        }
      />

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden max-w-md">
        <div className="aspect-[1.91/1] bg-slate-100 dark:bg-slate-800">
          {card.src !== '' ? (
            <img src={card.src} alt={card.alt} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full grid place-items-center text-[11px] text-slate-400">No card image</div>
          )}
        </div>
        <div className="p-3 space-y-0.5 bg-white dark:bg-slate-900">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Share card preview</p>
          <p className="text-xs font-bold text-slate-900 dark:text-white">{draft.sharing.title || draft.hero.headline}</p>
          <p className="text-[11px] leading-relaxed text-slate-500 line-clamp-2">
            {draft.sharing.description || draft.hero.supportingMessage}
          </p>
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        The picture above is the <span className="font-mono">sharing.ogImage</span> slot as the page resolves it.
        Choose it on the Images tab.
      </p>
    </div>
  );
};
