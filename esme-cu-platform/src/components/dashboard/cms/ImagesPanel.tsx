import React, { useMemo, useState } from 'react';
import { ImageOff, Search, X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { ModalShell } from '../../../motion';
import { FIXED_IMAGE_SLOTS, resolveImage, slotLabel } from '../../../domain/cms';
import { searchableAssets } from '../../../domain/media';
import type { ContentImageSlot, MediaAsset } from '../../../types';
import { PanelTitle, TextField, TinyButton } from './fields';
import type { PanelProps } from './CopyPanels';
import type { DashboardView } from '../DashboardShell';

/**
 * The pictures the page draws.
 *
 * A slot names an asset; it never holds a typed address. That is what keeps a content write from
 * aiming the public site at an arbitrary remote host, and it is why the picker only offers what the
 * library can answer with. A slot pointing at an id this device does not hold is reported, not
 * silently repainted — the page falls back to the asset shipped with the build, and the operator
 * hears that before a visitor does.
 */

const MediaPicker: React.FC<{ title: string; onClose: () => void; onPick: (asset: MediaAsset) => void }> = ({
  title,
  onClose,
  onPick,
}) => {
  const { mediaLibrary } = useApp();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchableAssets(mediaLibrary, query), [mediaLibrary, query]);

  return (
    <ModalShell open onClose={onClose} className="max-w-3xl w-full max-h-[85vh] overflow-hidden rounded-3xl bg-white dark:bg-slate-900 p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Choose a picture</h2>
          <p className="text-[11px] text-slate-500">For {title}. Bundled assets ship with the build; uploads live in the media library.</p>
        </div>
        <button onClick={onClose} aria-label="Close the picker" className="p-1 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by file name, description or type"
          aria-label="Search the media library"
          className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
        />
      </div>

      <div className="overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-3 pr-1">
        {results.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => onPick(asset)}
            className="text-left rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:border-[#F59A16] transition"
          >
            <span className="block aspect-video bg-slate-100 dark:bg-slate-800">
              <img src={asset.src} alt="" className="w-full h-full object-cover" loading="lazy" />
            </span>
            <span className="block p-2 space-y-0.5">
              <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{asset.name}</span>
              <span className="block text-[10px] text-slate-500 truncate">
                {asset.alt === '' ? (asset.decorative ? 'Decorative, no description' : 'No description yet') : asset.alt}
              </span>
              <span className="block text-[10px] font-mono text-slate-400">
                {asset.origin === 'bundled' ? 'bundled' : 'upload'}
                {asset.deviceOnly ? ' · this device only' : ''}
              </span>
            </span>
          </button>
        ))}
        {results.length === 0 && (
          <p className="col-span-full text-xs text-slate-500 py-6 text-center">
            Nothing in the library matches “{query}”. Upload a picture from the Media Library screen first.
          </p>
        )}
      </div>
    </ModalShell>
  );
};

export const ImagesPanel: React.FC<PanelProps & { onNavigate?: (view: DashboardView) => void }> = ({
  draft,
  patch,
  onNavigate,
}) => {
  const { mediaLibrary, can } = useApp();
  const [picking, setPicking] = useState<string | null>(null);

  const assetById = (assetId: string) => mediaLibrary.find((asset) => asset.id === assetId);
  const images = draft.images ?? {};

  const writeSlot = (slotId: string, slot: Partial<ContentImageSlot>) => {
    patch({ images: { ...images, [slotId]: { ...images[slotId], ...slot } } });
  };

  /** Drops the chosen asset and keeps the words written on the slot, so only the picture moves back. */
  const releaseSlot = (slotId: string) => {
    const current = images[slotId];
    if (!current) return;
    const kept: ContentImageSlot = {
      ...(current.alt !== undefined ? { alt: current.alt } : {}),
      ...(current.caption !== undefined ? { caption: current.caption } : {}),
    };
    const next = { ...images };
    if (Object.keys(kept).length === 0) delete next[slotId];
    else next[slotId] = kept;
    patch({ images: next });
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <PanelTitle title="Image slots">
        Each block of the page asks the library for one picture. Choosing here points the draft at an asset by id;
        clearing a slot sends the block back to the file that ships with the build. Nothing in this form takes a
        typed address.
      </PanelTitle>

      {onNavigate && can('cms.media.manage') && (
        <TinyButton tone="brand" onClick={() => onNavigate('media_library')}>
          Open the media library to file a new picture
        </TinyButton>
      )}

      <ul className="space-y-3">
        {FIXED_IMAGE_SLOTS.map((definition) => {
          const slot = images[definition.id];
          const asset = slot?.assetId ? assetById(slot.assetId) : undefined;
          const missing = Boolean(slot?.assetId) && !asset;
          const bundled = assetById(definition.defaultSrc);
          const shown = resolveImage(
            draft,
            definition.id,
            { src: definition.defaultSrc, alt: bundled?.alt ?? definition.label },
            assetById
          );

          return (
            <li
              key={definition.id}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col sm:flex-row gap-3"
            >
              <div className="w-full sm:w-40 shrink-0">
                <div className="aspect-video rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 grid place-items-center">
                  {shown.src === '' ? (
                    <ImageOff className="w-6 h-6 text-slate-400" aria-hidden />
                  ) : (
                    <img src={shown.src} alt="" className="w-full h-full object-cover" loading="lazy" />
                  )}
                </div>
              </div>

              <div className="flex-1 space-y-2 min-w-0">
                <div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{definition.label}</p>
                  <p className="text-[10px] font-mono text-slate-400">{definition.id}</p>
                </div>

                <p className="text-[11px] text-slate-500">
                  {asset ? (
                    <>
                      Points at <span className="font-bold">{asset.name}</span>
                      {asset.deviceOnly ? ' — bytes held on this device only, so no other browser can load them' : ''}.
                    </>
                  ) : missing ? (
                    <span className="text-amber-700 dark:text-amber-400 font-bold">
                      Names a picture this device does not hold ({slot?.assetId}). The page falls back to
                      {definition.defaultSrc === '' ? ' nothing — this block renders no image' : ` ${definition.defaultSrc}`}.
                    </span>
                  ) : definition.defaultSrc === '' ? (
                    'No picture chosen, so this block renders without an image.'
                  ) : (
                    <>
                      Drawing the asset shipped with the build (<span className="font-mono">{definition.defaultSrc}</span>).
                    </>
                  )}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <TextField
                    label="Alt text"
                    value={slot?.alt ?? asset?.alt ?? ''}
                    onChange={(alt) => writeSlot(definition.id, { alt })}
                    hint={
                      shown.alt === ''
                        ? 'Empty on both the slot and the asset, so a screen reader gets nothing here.'
                        : undefined
                    }
                  />
                  <TextField
                    label="Caption"
                    value={slot?.caption ?? asset?.caption ?? ''}
                    onChange={(caption) => writeSlot(definition.id, { caption })}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <TinyButton
                    tone="brand"
                    aria-label={`Choose a picture for ${definition.label}`}
                    onClick={() => setPicking(definition.id)}
                  >
                    Choose a picture
                  </TinyButton>
                  <TinyButton
                    onClick={() => releaseSlot(definition.id)}
                    disabled={!slot?.assetId}
                    aria-label={`Use the bundled asset for ${definition.label}`}
                    title="Drop the chosen asset; the block goes back to the file that ships with the build"
                  >
                    Use the bundled asset
                  </TinyButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {picking && (
        <MediaPicker
          title={slotLabel(picking)}
          onClose={() => setPicking(null)}
          onPick={(asset) => {
            writeSlot(picking, {
              assetId: asset.id,
              ...(asset.alt === '' ? {} : { alt: asset.alt }),
              ...(asset.caption ? { caption: asset.caption } : {}),
            });
            setPicking(null);
          }}
        />
      )}
    </div>
  );
};
