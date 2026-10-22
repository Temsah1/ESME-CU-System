import React from 'react';
import { SECTION_KEYS, SECTION_LABELS } from '../../../domain/cms';
import type { ContentLink, ContentSocial, PublicSectionKey, WebsiteContentConfig } from '../../../types';
import { PanelTitle, Switch, TextField, TinyButton } from './fields';
import type { PanelProps } from './CopyPanels';

/**
 * Which blocks exist and which addresses the page may follow. Both are content the operator owns,
 * and both are checked by the same validator on the way in — so a link typed here is held to the
 * same rule as one written into the cache by hand, and a block cannot be hidden by leaving it out.
 */

export const BlocksPanel: React.FC<PanelProps> = ({ draft, patch }) => {
  const listed = [...(draft.sections ?? [])].sort((a, b) => a.order - b.order);
  const known = new Set(listed.map((section) => section.key));
  // A section the draft never mentions is still a section of the page: it is appended visible, so
  // content cannot disappear by omission.
  const rows: PublicSectionKey[] = [...listed.map((section) => section.key), ...SECTION_KEYS.filter((key) => !known.has(key))];

  const setVisible = (key: PublicSectionKey, visible: boolean) => {
    const next = rows.map((sectionKey, order) => {
      const current = listed.find((section) => section.key === sectionKey);
      return { key: sectionKey, visible: sectionKey === key ? visible : (current?.visible ?? true), order };
    });
    patch({ sections: next });
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <PanelTitle title="Page blocks">
        Switching a block off takes it out of the page: the public site does not render it, and the navbar drops the
        link that would have pointed at it. A hidden block keeps its content, so switching it back on restores it.
      </PanelTitle>

      <ul className="space-y-2">
        {rows.map((key, index) => {
          const current = listed.find((section) => section.key === key);
          const visible = current?.visible ?? true;
          return (
            <li
              key={key}
              className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  {index + 1}. {SECTION_LABELS[key]}
                </span>
                <span className="block text-[11px] font-mono text-slate-400">#{key}</span>
              </span>
              <Switch
                label={visible ? 'Visible' : 'Hidden'}
                ariaLabel={SECTION_LABELS[key]}
                checked={visible}
                onChange={(checked) => setVisible(key, checked)}
              />
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] leading-relaxed text-slate-500">
        The order printed here is the order the page draws its blocks in — the build owns that sequence, and an
        operator switches blocks off rather than moving them. The document still stores an <span className="font-mono">order</span>{' '}
        number per section; this form keeps it in step with what the page actually renders instead of offering a
        control the page ignores.
      </p>
    </div>
  );
};

const LinkRows: React.FC<{
  group: string;
  items: ContentLink[];
  onChange: (items: ContentLink[]) => void;
  idPrefix: string;
  hrefHint: string;
}> = ({ group, items, onChange, idPrefix, hrefHint }) => {
  const setRow = (index: number, updates: Partial<ContentLink>) =>
    onChange(items.map((row, position) => (position === index ? { ...row, ...updates } : row)));

  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">{group}</legend>
      {items.map((row, index) => (
        <div key={row.id || index} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <TextField label="Label" value={row.label} onChange={(label) => setRow(index, { label })} />
              <TextField label="Address" value={row.href} onChange={(href) => setRow(index, { href })} hint={hrefHint} />
            </div>
            <div className="pb-1 space-y-2">
              <Switch label="Shown" checked={row.visible} onChange={(visible) => setRow(index, { visible })} />
              <TinyButton tone="danger" onClick={() => onChange(items.filter((_, position) => position !== index))}>
                Remove
              </TinyButton>
            </div>
          </div>
          {(row.label.trim() === '' || row.href.trim() === '') && (
            <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
              This row is saved as nothing: a link with no label or no address is dropped, and the drop is reported in
              the notes above.
            </p>
          )}
        </div>
      ))}
      <TinyButton
        onClick={() =>
          onChange([...items, { id: `${idPrefix}_${Date.now().toString(36)}`, label: '', href: '', visible: true }])
        }
      >
        Add a link
      </TinyButton>
      {items.length === 0 && <p className="text-[11px] text-slate-500">Nothing is listed here, so this list renders empty.</p>}
    </fieldset>
  );
};

export const LinksPanel: React.FC<PanelProps> = ({ draft, patch }) => {
  const setFooter = (updates: Partial<WebsiteContentConfig['footer']>) =>
    patch({ footer: { ...draft.footer, ...updates } });

  return (
    <div className="space-y-6 max-w-2xl">
      <PanelTitle title="Navigation, footer and socials">
        The navbar, the footer links and the handles printed on the page. Addresses are refused, not repaired: a link
        the page would not follow is dropped when the draft is written and the drop is named.
      </PanelTitle>

      <LinkRows
        group="Navbar links"
        items={draft.navigation ?? []}
        onChange={(navigation) => patch({ navigation })}
        idPrefix="nav"
        hrefHint="A block on this page (#about), a path on this site, or an http(s) address."
      />

      <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300">Footer</h3>
        <TextField label="Footer blurb" rows={2} value={draft.footer.blurb} onChange={(blurb) => setFooter({ blurb })} />
        <TextField
          label="Copyright line"
          value={draft.footer.copyright}
          onChange={(copyright) => setFooter({ copyright })}
        />
        <LinkRows
          group="Footer links"
          items={draft.footer.links ?? []}
          onChange={(links) => setFooter({ links })}
          idPrefix="foot"
          hrefHint="A block on this page (#about), a path on this site, or an http(s) address."
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Social profiles</legend>
        {(draft.socials ?? []).map((row, index) => {
          const setRow = (updates: Partial<ContentSocial>) =>
            patch({ socials: draft.socials.map((entry, position) => (position === index ? { ...entry, ...updates } : entry)) });
          return (
            <div key={row.id || index} className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <TextField label="Network" value={row.network} onChange={(network) => setRow({ network })} placeholder="LinkedIn" />
                <TextField label="Handle" value={row.handle} onChange={(handle) => setRow({ handle })} placeholder="@ESME_Cairo" />
              </div>
              <TextField
                label="Profile URL"
                value={row.url}
                onChange={(url) => setRow({ url })}
                hint="Only a confirmed http(s) profile address goes here. Left empty, the page prints the handle without linking it."
              />
              <div className="flex items-center justify-between">
                <Switch label="Shown" checked={row.visible} onChange={(visible) => setRow({ visible })} />
                <TinyButton
                  tone="danger"
                  onClick={() => patch({ socials: draft.socials.filter((_, position) => position !== index) })}
                >
                  Remove
                </TinyButton>
              </div>
            </div>
          );
        })}
        <TinyButton
          onClick={() =>
            patch({
              socials: [...(draft.socials ?? []), { id: `soc_${Date.now().toString(36)}`, network: '', handle: '', url: '', visible: true }],
            })
          }
        >
          Add a profile
        </TinyButton>
        {(draft.socials ?? []).length === 0 && (
          <p className="text-[11px] text-slate-500">No profile is listed, so the page prints no socials.</p>
        )}
      </fieldset>
    </div>
  );
};
