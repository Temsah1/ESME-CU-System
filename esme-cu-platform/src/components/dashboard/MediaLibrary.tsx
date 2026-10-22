import React, { useMemo, useState } from 'react';
import {
  CircleCheck,
  HardDrive,
  ImageOff,
  Images,
  Link2,
  Replace,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ModalShell, useToast } from '../../motion';
import { slotLabel } from '../../domain/cms';
import {
  ACCEPTED_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  decideDelete,
  isDeviceOnlySrc,
  searchableAssets,
  usageOf,
  validateUpload,
} from '../../domain/media';
import type { UploadInput } from '../../domain/media';
import { EmptyState } from '../EmptyState';
import type { MediaAsset } from '../../types';
import type { DashboardView } from './DashboardShell';

/**
 * The media library.
 *
 * A library row describes a file; it is not the file. The bytes stay on this device behind a `blob:`
 * address until an asset store is connected, which is why every row says where it came from and
 * whether another browser could load it. What gets refused here is what the domain already refuses:
 * a file is judged by its bytes rather than its name, a slot that still points at a picture blocks
 * the delete, and the official logo cannot be replaced from any screen.
 */

/** Enough bytes to carry any of the four signatures `sniffKind` reads. */
const SNIFF_HEAD_BYTES = 16;
/** A browser that will not decode the picture never fires `load` or `error`, so the probe expires. */
const MEASURE_TIMEOUT_MS = 1500;

const describeBytes = (value: number) => {
  if (value === 0) return 'size not recorded';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
};

type Pending = {
  mode: 'add' | 'replace';
  assetId?: string;
  /** The row a replacement is standing in for, named so the dialog says what it is about to overwrite. */
  replacesName?: string;
  name: string;
  type: string;
  size: number;
  src: string;
  head: Uint8Array;
  width?: number;
  height?: number;
};

const newAssetId = () => `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** The first bytes, which is all a signature needs. `FileReader` because every browser has it. */
const readHead = (file: File) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsArrayBuffer(file.slice(0, SNIFF_HEAD_BYTES));
  });

/**
 * The address the preview and the stored row share. Only `blob:` qualifies: a `data:` URL would put
 * the whole file inside this browser's storage key, which is where the quota goes.
 */
const addressFor = (file: File) => (typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);

/** Best effort: the pixel size, when this browser is willing to decode the picture at all. */
const measure = (src: string) =>
  new Promise<{ width?: number; height?: number }>((resolve) => {
    const image = new Image();
    const settle = (size: { width?: number; height?: number }) => {
      window.clearTimeout(timer);
      resolve(size);
    };
    const timer = window.setTimeout(() => settle({}), MEASURE_TIMEOUT_MS);
    image.onload = () => settle({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => settle({});
    image.src = src;
  });

const UploadDialog: React.FC<{
  pending: Pending;
  onClose: () => void;
  onSubmit: (pending: Pending, description: { alt: string; caption: string; decorative: boolean }) => void;
}> = ({ pending, onClose, onSubmit }) => {
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [decorative, setDecorative] = useState(false);

  const input: UploadInput = {
    name: pending.name,
    type: pending.type,
    size: pending.size,
    head: pending.head,
    ...(pending.width !== undefined ? { width: pending.width } : {}),
    ...(pending.height !== undefined ? { height: pending.height } : {}),
    alt,
    caption,
    decorative,
  };
  // The same rules the store applies on the write, run here so the reason is read before the press.
  const check = validateUpload(input);

  const field =
    'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-[#F59A16]/40';

  return (
    <ModalShell
      open
      onClose={onClose}
      className="max-w-xl w-full max-h-[88vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-900 p-5 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {pending.mode === 'add' ? 'Describe this picture' : 'Replace a picture'}
          </h2>
          <p className="text-[11px] text-slate-500">
            {pending.name} · {describeBytes(pending.size)}
            {pending.width ? ` · ${pending.width}×${pending.height}` : ' · size not measured by this browser'}
            {pending.replacesName ? ` — stands in for ${pending.replacesName}` : ''}
          </p>
        </div>
        <button onClick={onClose} aria-label="Cancel without filing the file" className="p-1 text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="aspect-video rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800">
        <img src={pending.src} alt="" className="w-full h-full object-cover" />
      </div>

      <label className="block">
        <span className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">What the picture shows</span>
        <input
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          className={field}
          placeholder="Board of the 2025-2026 academic year"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Caption (optional)</span>
        <input value={caption} onChange={(event) => setCaption(event.target.value)} className={field} />
      </label>

      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          role="switch"
          checked={decorative}
          onChange={(event) => setDecorative(event.target.checked)}
          aria-label="This picture is decoration"
          className="mt-0.5 w-4 h-4 accent-[#F59A16]"
        />
        <span>
          <span className="block text-xs font-bold text-slate-700 dark:text-slate-300">It is decoration</span>
          <span className="block text-[11px] text-slate-500">
            A screen reader then skips it and an empty description is correct. If the picture carries information,
            describe it instead.
          </span>
        </span>
      </label>

      {!check.ok && (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-3 py-2 text-[11px] font-bold text-rose-700 dark:text-rose-300"
        >
          {check.message}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(pending, { alt, caption, decorative })}
          disabled={!check.ok}
          className="px-4 py-2 rounded-xl bg-[#123B60] text-white text-xs font-bold disabled:opacity-50"
        >
          {pending.mode === 'add' ? 'Add to library' : 'Replace in place'}
        </button>
      </div>
    </ModalShell>
  );
};

const AssetCard: React.FC<{
  asset: MediaAsset;
  usage: { slots: string[]; textPaths: string[] };
  broken: boolean;
  mayManage: boolean;
  onFile: (asset: MediaAsset, file: File) => void;
  onDelete: (asset: MediaAsset) => void;
  onBroken: (asset: MediaAsset) => void;
}> = ({ asset, usage, broken, mayManage, onFile, onDelete, onBroken }) => {
  const inUse = usage.slots.length > 0;
  const canReplace = mayManage && asset.protected !== true;

  return (
    <li className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
      <div className="aspect-video bg-slate-100 dark:bg-slate-800 grid place-items-center overflow-hidden">
        {broken ? (
          <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 px-3 text-center">
            These bytes did not survive a reload. Upload the file again to put it back.
          </span>
        ) : (
          <img src={asset.src} alt="" loading="lazy" onError={() => onBroken(asset)} className="w-full h-full object-cover" />
        )}
      </div>

      <div className="p-3 space-y-2 flex-1 flex flex-col">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate" title={asset.name}>
            {asset.name}
          </p>
          <p className="text-[10px] font-mono text-slate-400 truncate" title={asset.id}>{asset.id}</p>
        </div>

        <p className="text-[11px] text-slate-500 leading-relaxed flex-1">
          {asset.decorative
            ? 'Decorative — no description, and a screen reader skips it.'
            : asset.alt === ''
              ? 'No description, so a screen reader gets nothing where this picture is used.'
              : asset.alt}
        </p>

        <p className="text-[10px] font-mono text-slate-400">
          {asset.kind.toUpperCase()} · {describeBytes(asset.bytes)}
          {asset.width ? ` · ${asset.width}×${asset.height}` : ''} ·{' '}
          {asset.origin === 'bundled' ? 'ships with the build' : 'upload'}
          {asset.deviceOnly ? ' · this device only' : ''}
        </p>

        <p className={`text-[10px] font-bold ${inUse ? 'text-[#D47F0A] dark:text-[#F59A16]' : 'text-slate-400'}`}>
          {inUse ? (
            <>
              <Link2 className="w-3 h-3 inline -mt-0.5" aria-hidden /> Used by {usage.slots.length} slot(s):{' '}
              {usage.slots.map((slot) => slotLabel(slot)).join(', ')}
            </>
          ) : (
            'Nothing in the live page or the draft points here.'
          )}
        </p>

        {asset.protected && (
          <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" aria-hidden /> Protected — the official logo is neither replaceable nor deletable.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <label
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 transition ${
              canReplace ? 'hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer' : 'opacity-40'
            }`}
            title={
              asset.protected
                ? 'The official ESME logo is not replaceable.'
                : 'Swap the file behind this id; slots that point here keep pointing here'
            }
          >
            <Replace className="w-3.5 h-3.5" aria-hidden /> Replace
            <input
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(',')}
              className="sr-only"
              aria-label={`Choose a file to replace ${asset.name}`}
              disabled={!canReplace}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onFile(asset, file);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => onDelete(asset)}
            disabled={!mayManage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-500/40 text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden /> Delete
          </button>
          {!mayManage && <span className="text-[10px] text-slate-400">Your role can read the library but not change it.</span>}
        </div>
      </div>
    </li>
  );
};

type Filter = 'all' | 'bundled' | 'upload' | 'device';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'bundled', label: 'Ships with the build' },
  { id: 'upload', label: 'Uploads' },
  { id: 'device', label: 'This device only' },
];

export const MediaLibrary: React.FC<{ onNavigate: (view: DashboardView) => void }> = ({ onNavigate }) => {
  const { mediaLibrary, addMediaAsset, replaceMediaAsset, deleteMediaAsset, publishedContent, websiteContent, can } =
    useApp();
  const { toast } = useToast();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirming, setConfirming] = useState<MediaAsset | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const mayManage = can('cms.media.manage');
  const documents = [publishedContent, websiteContent];

  const shown = useMemo(() => {
    const found = searchableAssets(mediaLibrary, query);
    if (filter === 'bundled') return found.filter((asset) => asset.origin === 'bundled');
    if (filter === 'upload') return found.filter((asset) => asset.origin === 'library');
    if (filter === 'device') return found.filter((asset) => asset.deviceOnly === true);
    return found;
  }, [mediaLibrary, query, filter]);

  const uploads = mediaLibrary.filter((asset) => asset.origin === 'library');
  const heldBytes = uploads.reduce((total, asset) => total + asset.bytes, 0);

  const stage = async (file: File, mode: Pending['mode'], replaces?: MediaAsset) => {
    const src = addressFor(file);
    if (src === null) {
      toast('This browser will not hand out a temporary address for the file, so nothing could be checked against its bytes.', 'error');
      return;
    }
    try {
      const head = await readHead(file);
      const size = await measure(src);
      setPending({
        mode,
        ...(replaces ? { assetId: replaces.id, replacesName: replaces.name } : {}),
        name: file.name,
        type: file.type,
        size: file.size,
        src,
        head,
        ...size,
      });
    } catch {
      toast('The browser would not give up the bytes of that file, so it could not be checked.', 'error');
    }
  };

  const submit = (staged: Pending, description: { alt: string; caption: string; decorative: boolean }) => {
    const input: UploadInput = {
      name: staged.name,
      type: staged.type,
      size: staged.size,
      head: staged.head,
      ...(staged.width !== undefined ? { width: staged.width } : {}),
      ...(staged.height !== undefined ? { height: staged.height } : {}),
      ...description,
    };
    try {
      if (staged.mode === 'add') {
        const asset = addMediaAsset(input, { id: newAssetId(), src: staged.src });
        toast(`Filed ${asset.name} in the library. It lives on this device only until an asset store is connected.`, 'success');
      } else {
        const assetId = staged.assetId!;
        const previous = mediaLibrary.find((asset) => asset.id === assetId);
        const asset = replaceMediaAsset(assetId, input, staged.src);
        if (previous && isDeviceOnlySrc(previous.src) && previous.src !== staged.src) URL.revokeObjectURL?.(previous.src);
        toast(`Replaced the picture behind ${asset.name}. Every slot that pointed at it still does.`, 'success');
      }
      setPending(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The library refused that file.', 'error');
    }
  };

  const confirmDelete = (asset: MediaAsset) => {
    try {
      deleteMediaAsset(asset.id);
      if (isDeviceOnlySrc(asset.src)) URL.revokeObjectURL?.(asset.src);
      toast(`${asset.name} is gone from this device. Nothing pointed at it.`, 'info');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Delete refused.', 'error');
    } finally {
      setConfirming(null);
    }
  };

  const deletion = confirming ? decideDelete(confirming, documents) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Media library</h1>
          <p className="text-xs text-slate-500 max-w-2xl">
            Every picture a page block can ask for, with the slots that use it. A row describes a file; the bytes
            themselves stay on this device until an asset store is connected.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1.5">
            <HardDrive className="w-4 h-4" aria-hidden />
            {uploads.length === 0 ? 'Nothing uploaded on this device' : `${uploads.length} upload(s), ${describeBytes(heldBytes)} here`}
          </span>
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, description or type"
              aria-label="Search the media library"
              className="w-60 pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs outline-none"
            />
          </label>
          <button
            onClick={() => onNavigate('website_cms')}
            className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Image slots in the CMS
          </button>
          <label
            className={`px-4 py-2.5 rounded-xl bg-[#123B60] text-white text-xs font-bold flex items-center gap-1.5 ${
              mayManage ? 'hover:bg-[#0d2c47] cursor-pointer' : 'opacity-50'
            }`}
          >
            <Upload className="w-4 h-4" aria-hidden /> Upload a picture
            <input
              type="file"
              accept={ACCEPTED_EXTENSIONS.join(',')}
              className="sr-only"
              aria-label="Upload a picture to the media library"
              disabled={!mayManage}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void stage(file, 'add');
              }}
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition ${
              filter === entry.id
                ? 'border-[#123B60] bg-[#123B60] text-white'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {uploads.length === 0 && (
        <p className="text-[11px] leading-relaxed text-slate-500 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-4 py-3">
          The rows below are the pictures that ship with the build. A page block points at a library row by id and
          never takes a typed address, so a new picture has to be filed here before the Images tab can offer it. Files
          are accepted up to {MAX_UPLOAD_BYTES / 1024 / 1024} MB as {ACCEPTED_EXTENSIONS.join(', ')}; an SVG is refused
          because it can carry scripts.
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title={query === '' ? 'No picture matches this filter' : 'Nothing in the library matches that search'}
          description={
            query === ''
              ? 'Change the filter to see the rest of the library.'
              : `No file name, description, caption or type contains “${query}”. Clear the search to see the whole library.`
          }
          icon={query === '' ? Images : ImageOff}
          action={
            query !== '' ? (
              <button
                onClick={() => setQuery('')}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200"
              >
                Clear the search
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {shown.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              usage={usageOf(asset, documents)}
              broken={broken[asset.id] === true}
              mayManage={mayManage}
              onFile={(entry, file) => void stage(file, 'replace', entry)}
              onDelete={setConfirming}
              onBroken={(entry) => setBroken((current) => ({ ...current, [entry.id]: true }))}
            />
          ))}
        </ul>
      )}

      {pending && <UploadDialog pending={pending} onClose={() => setPending(null)} onSubmit={submit} />}

      <ModalShell
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl"
      >
        {confirming && deletion && (
          <div className="space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {deletion.allowed ? `Delete ${confirming.name}?` : `${confirming.name} cannot be deleted yet`}
            </h2>
            {deletion.allowed ? (
              <p className="text-xs leading-relaxed text-slate-500">
                No slot in the live page or the draft points at it, so removing this row takes nothing off the page. The
                bytes are on this device only, and the deletion is written to the audit trail.
              </p>
            ) : (
              <ul className="list-disc pl-5 space-y-1.5 text-xs leading-relaxed text-rose-700 dark:text-rose-300">
                {deletion.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setConfirming(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                {deletion.allowed ? 'Cancel' : 'Close'}
              </button>
              {deletion.allowed && (
                <button
                  onClick={() => confirmDelete(confirming)}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <CircleCheck className="w-4 h-4" aria-hidden /> Delete from this device
                </button>
              )}
            </div>
          </div>
        )}
      </ModalShell>
    </div>
  );
};

export default MediaLibrary;
