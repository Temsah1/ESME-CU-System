import type { MediaAsset, MediaKind, WebsiteContentConfig } from '../types';
import { PROTECTED_ASSETS, isProtectedAsset, safeContentHref, slotsUsingAsset } from './cms';

/**
 * The media library as rules, before any screen or storage exists.
 *
 * What the library is for: every picture on the public page is an asset an operator can name,
 * describe, point a slot at, and delete only when nothing points at it. Two things follow from
 * that and are enforced here rather than in a form — a file is accepted for what its bytes are,
 * not for the extension the sender wrote, and a delete that would leave a slot pointing at
 * nothing is refused with the slots named.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_EDGE = 32;
export const MAX_ALT_LENGTH = 200;

export const ACCEPTED_MIME: Record<MediaKind, string[]> = {
  png: ['image/png'],
  jpeg: ['image/jpeg', 'image/jpg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
};

export const ACCEPTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;

const KIND_BY_EXTENSION: Record<string, MediaKind | undefined> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.gif': 'gif',
};

/** A `File`/`Blob` narrowed to what this layer can decide on — no DOM types in the domain. */
export type UploadInput = {
  name: string;
  type?: string;
  size: number;
  /** The first bytes of the file. Without them only the claimed type can be checked. */
  head?: Uint8Array;
  width?: number;
  height?: number;
  alt?: string;
  caption?: string;
  decorative?: boolean;
};

export type Refusal = { ok: false; code: string; message: string };
export type Acceptance = { ok: true; asset: Omit<MediaAsset, 'id' | 'origin' | 'addedAt'> };

/**
 * The signature the bytes actually carry. A file renamed to `.png` is still the file it is, and a
 * document that claims to be an image is refused here rather than rendered as a broken picture.
 */
export function sniffKind(head: Uint8Array): MediaKind | null {
  const at = (i: number) => head[i] ?? 0;
  const text = (from: number, length: number) =>
    Array.from(head.slice(from, from + length)).map((byte) => String.fromCharCode(byte)).join('');

  if (at(0) === 0x89 && text(1, 3) === 'PNG' && at(4) === 0x0d && at(5) === 0x0a) return 'png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'webp';
  if (text(0, 3) === 'GIF' && (at(3) === 0x38 || at(3) === 0x39)) return 'gif';
  return null;
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
};

function focal(value: unknown): { x: number; y: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const row = value as Record<string, unknown>;
  const { x, y } = row as { x: unknown; y: unknown };
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return { x: clamp(x), y: clamp(y) };
}

/**
 * Decides whether one upload may become an asset. Every check reports in the same shape so the
 * screen can print the reason instead of a generic failure.
 */
export function validateUpload(input: UploadInput): Acceptance | Refusal {
  const name = (input.name ?? '').trim();
  if (name === '') return { ok: false, code: 'name_missing', message: 'The file has no name, so the library could not list it.' };
  const extension = extensionOf(name).toLowerCase();
  if (extension === '.svg') {
    return { ok: false, code: 'svg_refused', message: 'Scalable vector files can carry scripts, so the library will not take an SVG. Export a PNG, WebP or JPEG instead. The ESME logo stays a bundled asset.' };
  }
  if (!KIND_BY_EXTENSION[extension]) {
    return {
      ok: false,
      code: 'extension_unsupported',
      message: `Only ${ACCEPTED_EXTENSIONS.join(', ')} files are accepted.`,
    };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, code: 'empty_file', message: 'The file arrived with no bytes in it.' };
  }
  if (input.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: `That file is ${(input.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB — a page image that big costs everyone who loads the site.`,
    };
  }

  // The claimed type is checked first, then the bytes: a mismatch is a refusal either way.
  const claimed = (input.type ?? '').toLowerCase().split(';')[0].trim();
  if (claimed !== '' && !Object.values(ACCEPTED_MIME).some((list) => list.includes(claimed))) {
    return { ok: false, code: 'mime_unsupported', message: `A file claiming to be ${claimed} is not one of the accepted image types.` };
  }

  let kind: MediaKind | null = null;
  if (input.head && input.head.length >= 12) {
    kind = sniffKind(input.head);
    if (kind === null) {
      return { ok: false, code: 'not_an_image', message: 'The bytes do not start with a PNG, JPEG, WebP or GIF header, whatever the file name says. This is not an image the page could show.' };
    }
    if (claimed !== '' && !ACCEPTED_MIME[kind].includes(claimed)) {
      return { ok: false, code: 'kind_mismatch', message: `The file says ${claimed} but its bytes are a ${kind.toUpperCase()}. Rename is not a conversion.` };
    }
  } else {
    kind = claimed ? (Object.keys(ACCEPTED_MIME) as MediaKind[]).find((k) => ACCEPTED_MIME[k].includes(claimed)) ?? null : null;
    if (kind === null) kind = KIND_BY_EXTENSION[extensionOf(name).toLowerCase()] ?? null;
    if (kind === null) return { ok: false, code: 'kind_unknown', message: 'Neither the file name, the declared type nor the bytes identify an accepted image.' };
  }

  if (input.width !== undefined || input.height !== undefined) {
    const width = input.width ?? 0;
    const height = input.height ?? 0;
    if (width < MIN_IMAGE_EDGE || height < MIN_IMAGE_EDGE) {
      return { ok: false, code: 'too_small', message: `A ${width}×${height} picture will not survive being stretched into a page layout. The smallest edge accepted is ${MIN_IMAGE_EDGE} pixels.` };
    }
  }

  const decorative = input.decorative === true;
  const alt = (input.alt ?? '').trim().slice(0, MAX_ALT_LENGTH);
  if (!decorative && alt === '') {
    return { ok: false, code: 'alt_missing', message: 'Describe what the picture shows so a screen reader can say it, or mark the image as decorative.' };
  }

  return {
    ok: true,
    asset: {
      name,
      src: '',
      kind,
      mime: ACCEPTED_MIME[kind][0],
      bytes: input.size,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      alt: decorative ? '' : alt,
      ...(input.caption && input.caption.trim() !== '' ? { caption: input.caption.trim().slice(0, MAX_ALT_LENGTH) } : {}),
      ...(decorative ? { decorative: true } : {}),
    },
  };
}

/** Where the bytes will be read from. A `blob:` URL dies with the tab, so it is never shared. */
export function isDeviceOnlySrc(src: string): boolean {
  return src.startsWith('blob:') || src.startsWith('data:');
}

/**
 * An address the page may put in an `img`. Same rules as a content link, minus the fragment: a
 * same-site path, an absolute http(s) address, or bytes this device holds for preview only. A
 * backslash is refused even inside a path, because `/\host` reaches another host in some parsers.
 */
export function isLoadableSrc(src: string): boolean {
  if (src === '' || src.includes('\\') || src.startsWith('#')) return false;
  return isDeviceOnlySrc(src) || safeContentHref(src) !== null;
}

/** A library row as stored; anything else in the key is dropped when it is read back. */
export function normalizeAssetRow(value: unknown): MediaAsset | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const src = typeof row.src === 'string' ? row.src.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const kind = row.kind as MediaKind;
  if (id === '' || src === '' || name === '' || !ACCEPTED_MIME[kind]) return null;
  if (!isLoadableSrc(src)) return null;

  const bytes = typeof row.bytes === 'number' && Number.isFinite(row.bytes) && row.bytes > 0 ? row.bytes : 0;
  return {
    id,
    name,
    src,
    kind,
    mime: typeof row.mime === 'string' && ACCEPTED_MIME[kind].includes(row.mime.toLowerCase()) ? row.mime : ACCEPTED_MIME[kind][0],
    bytes,
    ...(typeof row.width === 'number' && Number.isFinite(row.width) ? { width: row.width } : {}),
    ...(typeof row.height === 'number' && Number.isFinite(row.height) ? { height: row.height } : {}),
    alt: typeof row.alt === 'string' ? row.alt.slice(0, MAX_ALT_LENGTH) : '',
    ...(typeof row.caption === 'string' && row.caption !== '' ? { caption: row.caption.slice(0, MAX_ALT_LENGTH) } : {}),
    ...(row.decorative === true ? { decorative: true } : {}),
    ...(focal(row.focal) ? { focal: focal(row.focal) } : {}),
    origin: row.origin === 'bundled' ? 'bundled' : 'library',
    addedAt: typeof row.addedAt === 'string' ? row.addedAt : '',
    ...(row.protected === true ? { protected: true } : {}),
    ...(isDeviceOnlySrc(src) || row.deviceOnly === true ? { deviceOnly: true } : {}),
  };
}

export function normalizeAssetList(value: unknown): MediaAsset[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeAssetRow).filter((asset): asset is MediaAsset => asset !== null);
}

/** The bundled pictures the page ships with, so the picker can offer them before any upload. */
export function bundledAssets(): MediaAsset[] {
  const bundled: { src: string; name: string; alt: string; kind: MediaKind; protected?: boolean }[] = [
    { src: '/branding/esme_logo.png', name: 'esme_logo.png', alt: 'ESME Cairo University chapter logo', kind: 'png', protected: true },
    { src: '/branding/esme_team_celebration.png', name: 'esme_team_celebration.png', alt: 'ESME CU members together', kind: 'png' },
    { src: '/branding/board_poster_2025_2026.png', name: 'board_poster_2025_2026.png', alt: 'Board of the 2025-2026 academic year', kind: 'png' },
    { src: '/history/xref_585.png', name: 'xref_585.png', alt: 'Faculty of Engineering, Cairo University', kind: 'png' },
  ];
  return bundled.map((entry, index) => ({
    id: `bund_${index + 1}`,
    name: entry.name,
    src: entry.src,
    kind: entry.kind,
    mime: ACCEPTED_MIME[entry.kind][0],
    bytes: 0,
    alt: entry.alt,
    origin: 'bundled' as const,
    addedAt: '',
    ...(entry.protected ? { protected: true } : {}),
  }));
}

export type Delegation = { assetById: (id: string | undefined) => MediaAsset | undefined };

/** Which slots point at an asset, plus any text in the document that repeats the asset's path. */
export function usageOf(
  asset: MediaAsset,
  documents: WebsiteContentConfig | WebsiteContentConfig[]
): { slots: string[]; textPaths: string[] } {
  const docs = Array.isArray(documents) ? documents : [documents];
  const slots: string[] = [];
  const textPaths: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (asset.src !== '' && value.includes(asset.src)) textPaths.push(path);
      return;
    }
    if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    else if (typeof value === 'object' && value !== null) {
      Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => walk(entry, `${path}.${key}`));
    }
  };
  docs.forEach((doc) => {
    slotsUsingAsset(doc, asset.id).forEach((slot) => {
      if (!slots.includes(slot)) slots.push(slot);
    });
    walk(doc, '');
  });
  return { slots, textPaths };
}

export type DeleteDecision = { allowed: true } | { allowed: false; reasons: string[] };

/**
 * Why a picture may not be thrown away. A bundled asset is the chapter's own property, an asset a
 * slot still points at would leave a hole in the live page, and the logo is protected whatever a
 * request claims — no content surface is allowed to replace or delete it. Both the live page and
 * the draft are checked: a delete that only the draft would notice still breaks the next publish.
 */
export function decideDelete(
  asset: MediaAsset,
  documents: WebsiteContentConfig | WebsiteContentConfig[]
): DeleteDecision {
  const reasons: string[] = [];
  if (asset.protected || isProtectedAsset(asset.src)) {
    reasons.push(`${asset.name} is a protected bundled asset. The official ESME logo and the site icon are not replaceable or deletable from the CMS.`);
  }
  if (asset.origin === 'bundled' && reasons.length === 0) {
    reasons.push(`${asset.name} ships with the build. Removing it from the library would not remove it from the deployment, and a slot that still points at it would break.`);
  }
  const { slots } = usageOf(asset, documents);
  if (slots.length > 0) {
    reasons.push(`${slots.length} content slot(s) still use it: ${slots.join(', ')}. Point them at another picture first.`);
  }
  return reasons.length === 0 ? { allowed: true } : { allowed: false, reasons };
}

/**
 * Add an accepted upload as a new asset. `id` and `addedAt` come from the caller because this layer
 * reads no clock and invents no identifier it cannot guarantee.
 */
export function addToLibrary(
  library: MediaAsset[],
  accepted: Acceptance | Refusal,
  details: { id: string; src: string; addedAt: string }
): { library: MediaAsset[]; asset?: MediaAsset; refusal?: string } {
  if (!accepted.ok) return { library, refusal: accepted.message };
  if (details.id.trim() === '') return { library, refusal: 'The asset was given no id, so nothing can point at it.' };
  if (!isLoadableSrc(details.src)) return { library, refusal: 'The address stored for that file is not one the page could load.' };
  if (library.some((asset) => asset.id === details.id)) return { library, refusal: `An asset with the id ${details.id} is already in the library.` };
  const asset: MediaAsset = {
    ...accepted.asset,
    id: details.id,
    src: details.src,
    origin: 'library',
    addedAt: details.addedAt,
    ...(isDeviceOnlySrc(details.src) ? { deviceOnly: true } : {}),
  };
  return { library: [...library, asset], asset };
}

/**
 * Swap the bytes under an existing asset. The id and the slots that reference it do not move, so a
 * replacement cannot orphan a block; the description stays unless the operator edits it.
 */
export function replaceAsset(
  library: MediaAsset[],
  assetId: string,
  accepted: Acceptance | Refusal,
  src: string
): { library: MediaAsset[]; refusal?: string } {
  if (!accepted.ok) return { library, refusal: accepted.message };
  if (!isLoadableSrc(src)) return { library, refusal: 'The address stored for that file is not one the page could load.' };
  const index = library.findIndex((asset) => asset.id === assetId);
  if (index === -1) return { library, refusal: 'That asset is not in the library on this device, so there is nothing to replace.' };
  const current = library[index];
  if (current.protected || isProtectedAsset(current.src)) {
    return { library, refusal: `${current.name} is protected. The official ESME logo is not replaceable.` };
  }
  const next: MediaAsset = {
    ...current,
    ...accepted.asset,
    id: current.id,
    src,
    origin: current.origin === 'bundled' && !src.startsWith('/') ? 'library' : current.origin,
    deviceOnly: isDeviceOnlySrc(src) || undefined,
  };
  const copy = [...library];
  copy[index] = next;
  return { library: copy };
}

/** The list a picker shows: bundled first, then uploads newest first, all addressed by id. */
export function searchableAssets(library: MediaAsset[], query: string): MediaAsset[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return library;
  return library.filter(
    (asset) =>
      asset.name.toLowerCase().includes(needle) ||
      asset.alt.toLowerCase().includes(needle) ||
      (asset.caption ?? '').toLowerCase().includes(needle) ||
      asset.kind.includes(needle)
  );
}

export const PROTECTED_BUNDLED_PATHS = PROTECTED_ASSETS;
