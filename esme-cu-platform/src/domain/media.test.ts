/**
 * The media library as rules. Nothing here touches a file input, a canvas or a bucket: these are
 * the decisions the screens and the store will have to make, tested where they are made. The cases
 * that matter are the ones a friendly form never shows — a file renamed to `.png`, a picture a
 * published slot still points at, and the official logo.
 */
import { describe, expect, it } from 'vitest';
import { REFERENCE_WEBSITE_CONTENT } from '../data/referenceContent';
import type { MediaAsset, WebsiteContentConfig } from '../types';
import {
  MAX_UPLOAD_BYTES,
  addToLibrary,
  bundledAssets,
  decideDelete,
  isDeviceOnlySrc,
  normalizeAssetList,
  normalizeAssetRow,
  replaceAsset,
  searchableAssets,
  sniffKind,
  usageOf,
  validateUpload,
} from './media';

const bytes = (...groups: number[][]) => new Uint8Array(groups.flat());
const PNG_HEAD = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 0]);
const JPEG_HEAD = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP_HEAD = bytes([0x52, 0x49, 0x46, 0x46], [0x22, 0x00, 0x00, 0x00], [0x57, 0x45, 0x42, 0x50]);
const GIF_HEAD = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], [0, 0, 0, 0, 0, 0]);
const HTML_HEAD = new Uint8Array(Array.from('<html><script>bad()</script>').map((c) => c.charCodeAt(0)).concat([0, 0, 0]));

const upload = (over: Partial<Parameters<typeof validateUpload>[0]> = {}) => ({
  name: 'team-day.png',
  type: 'image/png',
  size: 240_000,
  head: PNG_HEAD,
  width: 1600,
  height: 900,
  alt: 'Members at the annual chapter day',
  ...over,
});

const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'med_1',
  name: 'team-day.png',
  src: 'https://cdn.test/team-day.png',
  kind: 'png',
  mime: 'image/png',
  bytes: 240_000,
  alt: 'Members at the annual chapter day',
  origin: 'library',
  addedAt: '2026-10-19T09:00:00.000Z',
  ...over,
});

const docWithSlots = (slots: Record<string, string>): WebsiteContentConfig => ({
  ...REFERENCE_WEBSITE_CONTENT,
  images: Object.fromEntries(Object.entries(slots).map(([slotId, assetId]) => [slotId, { assetId, alt: 'x' }])),
});

describe('what the bytes actually are', () => {
  it('recognises the four accepted formats by header', () => {
    expect(sniffKind(PNG_HEAD)).toBe('png');
    expect(sniffKind(JPEG_HEAD)).toBe('jpeg');
    expect(sniffKind(WEBP_HEAD)).toBe('webp');
    expect(sniffKind(GIF_HEAD)).toBe('gif');
  });

  it('does not recognise anything else, however it is named', () => {
    expect(sniffKind(HTML_HEAD)).toBeNull();
    expect(validateUpload(upload({ head: HTML_HEAD, type: 'image/png' }))).toMatchObject({ ok: false, code: 'not_an_image' });
  });

  it('refuses a file whose declared type contradicts its header', () => {
    expect(validateUpload(upload({ head: JPEG_HEAD, type: 'image/png' }))).toMatchObject({ ok: false, code: 'kind_mismatch' });
    const accepted = validateUpload(upload({ head: JPEG_HEAD, type: 'image/jpeg', name: 'field-trip.jpg' }));
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.asset.kind).toBe('jpeg');
  });
});

describe('an upload the library will take', () => {
  it('accepts a described image and records its format, size and description', () => {
    const accepted = validateUpload(upload({ caption: 'March 2026, the corrosion lab' }));
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.asset).toMatchObject({
      name: 'team-day.png',
      kind: 'png',
      mime: 'image/png',
      bytes: 240_000,
      width: 1600,
      height: 900,
      alt: 'Members at the annual chapter day',
      caption: 'March 2026, the corrosion lab',
    });
    expect(accepted.asset.src).toBe('');
  });

  it('refuses a vector file, and says why in terms of the logo', () => {
    expect(validateUpload(upload({ name: 'logo.svg', type: 'image/svg+xml', head: new Uint8Array(Array.from('<svg xmlns="http://www.w3.org/2000/svg" ').map((c) => c.charCodeAt(0))) })))
      .toMatchObject({ ok: false, code: 'svg_refused' });
  });

  it('refuses an unknown extension, an empty file and one over the cap', () => {
    expect(validateUpload(upload({ name: 'notes.txt', type: 'text/plain' }))).toMatchObject({ ok: false, code: 'extension_unsupported' });
    expect(validateUpload(upload({ size: 0 }))).toMatchObject({ ok: false, code: 'empty_file' });
    expect(validateUpload(upload({ size: MAX_UPLOAD_BYTES + 1 }))).toMatchObject({ ok: false, code: 'too_large' });
    expect(validateUpload(upload({ type: 'application/x-msdownload', name: 'tool.png' }))).toMatchObject({ ok: false, code: 'mime_unsupported' });
  });

  it('refuses a thumbnail too small for a layout, and accepts one at the edge', () => {
    expect(validateUpload(upload({ width: 24, height: 24 }))).toMatchObject({ ok: false, code: 'too_small' });
    expect(validateUpload(upload({ width: 32, height: 48 })).ok).toBe(true);
  });

  it('requires a description, or an explicit statement that the picture is decorative', () => {
    expect(validateUpload(upload({ alt: '   ' }))).toMatchObject({ ok: false, code: 'alt_missing' });
    const decorative = validateUpload(upload({ alt: '', decorative: true }));
    expect(decorative.ok).toBe(true);
    if (decorative.ok) expect(decorative.asset.alt).toBe('');
  });

  it('adds an asset with the id and clock the caller supplies, and refuses a collision', () => {
    const accepted = validateUpload(upload());
    const added = addToLibrary([], accepted, { id: 'med_9', src: 'https://cdn.test/team-day.png', addedAt: '2026-10-19T09:00:00.000Z' });
    expect(added.asset?.id).toBe('med_9');
    expect(added.asset?.origin).toBe('library');
    expect(added.asset?.deviceOnly).toBeUndefined();
    expect(addToLibrary(added.library, accepted, { id: 'med_9', src: 'https://cdn.test/other.png', addedAt: '' })).toMatchObject({ refusal: expect.stringContaining('med_9') });
    expect(addToLibrary([], accepted, { id: '  ', src: 'https://cdn.test/x.png', addedAt: '' }).refusal).toMatch(/no id/i);
    expect(addToLibrary([], accepted, { id: 'med_10', src: 'javascript:alert(1)', addedAt: '' }).refusal).toMatch(/not one the page could load/);
  });

  it('marks bytes that live on this device only', () => {
    expect(isDeviceOnlySrc('blob:http://localhost/abc')).toBe(true);
    expect(isDeviceOnlySrc('data:image/png;base64,AAAA')).toBe(true);
    expect(isDeviceOnlySrc('https://cdn.test/a.png')).toBe(false);
    const fromBlob = addToLibrary([], validateUpload(upload()), { id: 'med_b', src: 'blob:http://localhost/abc', addedAt: '' });
    expect(fromBlob.asset?.deviceOnly).toBe(true);
  });
});

describe('a library row read back from storage', () => {
  it('keeps a row that describes a real asset and drops one that does not', () => {
    expect(normalizeAssetRow(asset())).not.toBeNull();
    expect(normalizeAssetRow(asset({ src: '/branding/team.png' }))).not.toBeNull();
    expect(normalizeAssetRow(asset({ id: '' }))).toBeNull();
    expect(normalizeAssetRow(asset({ src: '' }))).toBeNull();
    expect(normalizeAssetRow(asset({ name: '' }))).toBeNull();
    expect(normalizeAssetRow(asset({ kind: 'bmp' as MediaAsset['kind'] }))).toBeNull();
    expect(normalizeAssetRow('not even an object')).toBeNull();
    expect(normalizeAssetList({ not: 'a list' })).toEqual([]);
  });

  it('refuses a source the page must not load, and never trusts a claimed mime', () => {
    expect(normalizeAssetRow(asset({ src: 'javascript:alert(1)' }))).toBeNull();
    expect(normalizeAssetRow(asset({ src: '//attacker.example/a.png' }))).toBeNull();
    expect(normalizeAssetRow(asset({ src: '/\\attacker.example' }))).toBeNull();
    const lying = normalizeAssetRow(asset({ mime: 'text/html' }));
    expect(lying?.mime).toBe('image/png');
  });

  it('keeps a focus point inside the picture and flags device-only bytes', () => {
    const withFocal = normalizeAssetRow(asset({ focal: { x: 1.7, y: -0.4 } }));
    expect(withFocal?.focal).toEqual({ x: 1, y: 0 });
    expect(normalizeAssetRow(asset({ focal: 'center' as unknown as { x: number; y: number } }))?.focal).toBeUndefined();
    expect(normalizeAssetRow(asset({ src: 'blob:http://localhost/x' }))?.deviceOnly).toBe(true);
  });
});

describe('what an asset is used by', () => {
  it('names the slots that point at it, in the document it reads', () => {
    const doc = docWithSlots({ 'home.heroCard': 'med_1', 'sharing.ogImage': 'med_1', 'about.campus': 'med_2' });
    expect(usageOf(asset(), doc).slots).toEqual(['home.heroCard', 'sharing.ogImage']);
    expect(usageOf(asset({ id: 'med_unused' }), doc).slots).toEqual([]);
  });

  it('also reports a path written into the copy, so a delete cannot hide a reference', () => {
    const doc = { ...REFERENCE_WEBSITE_CONTENT, about: { ...REFERENCE_WEBSITE_CONTENT.about, story: 'See https://cdn.test/team-day.png for the gallery.' } };
    expect(usageOf(asset(), doc).textPaths.join(' ')).toMatch(/about\.story/);
  });

  it('lists the bundled pictures, with the logo protected and never offered as a slot', () => {
    const library = bundledAssets();
    const logo = library.find((entry) => entry.src === '/branding/esme_logo.png');
    expect(logo?.protected).toBe(true);
    expect(logo?.origin).toBe('bundled');
    expect(library.every((entry) => entry.bytes === 0)).toBe(true);
  });
});

describe('a delete request', () => {
  it('refuses to delete the official logo even when no slot uses it', () => {
    const decision = decideDelete(asset({ src: '/branding/esme_logo.png', name: 'esme_logo.png', origin: 'bundled', protected: true }), REFERENCE_WEBSITE_CONTENT);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reasons.join(' ')).toMatch(/protected/);
  });

  it('refuses a picture a published slot still points at, and names the slots', () => {
    const doc = docWithSlots({ 'home.heroCard': 'med_1' });
    const decision = decideDelete(asset(), doc);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reasons.join(' ')).toMatch(/home\.heroCard/);
  });

  it('refuses a bundled asset, because removing it from a list does not remove it from the build', () => {
    const decision = decideDelete(asset({ src: '/branding/esme_team_celebration.png', origin: 'bundled' }), REFERENCE_WEBSITE_CONTENT);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reasons.join(' ')).toMatch(/ships with the build/);
  });

  it('allows an uploaded picture nothing points at', () => {
    expect(decideDelete(asset(), REFERENCE_WEBSITE_CONTENT)).toEqual({ allowed: true });
    expect(decideDelete(asset(), docWithSlots({ 'home.heroCard': 'med_other' }))).toEqual({ allowed: true });
  });

  it('checks the draft as well as the live page, because a delete is felt by the next publish', () => {
    const live = REFERENCE_WEBSITE_CONTENT;
    const draft = docWithSlots({ 'about.campus': 'med_1' });
    expect(decideDelete(asset(), [live, draft]).allowed).toBe(false);
    const reasons = decideDelete(asset(), [live, draft]);
    if (!reasons.allowed) expect(reasons.reasons.join(' ')).toMatch(/about\.campus/);
    expect(decideDelete(asset(), [live, docWithSlots({ 'about.campus': 'med_other' })])).toEqual({ allowed: true });
  });
});

describe('replacing a picture in place', () => {
  it('keeps the id so every slot that used it now shows the new bytes', () => {
    const library = [asset(), asset({ id: 'med_2', name: 'board.png' })];
    const swapped = replaceAsset(library, 'med_1', validateUpload(upload({ name: 'team-day-2027.png', width: 2000, height: 1200 })), 'https://cdn.test/team-day-2027.png');
    expect(swapped.refusal).toBeUndefined();
    expect(swapped.library[0]).toMatchObject({ id: 'med_1', name: 'team-day-2027.png', src: 'https://cdn.test/team-day-2027.png', width: 2000 });
    expect(swapped.library[1]).toBe(library[1]);
    expect(library[0].src).toBe('https://cdn.test/team-day.png');
  });

  it('refuses a protected asset, an unknown id, and an upload that failed validation', () => {
    const library = [
      asset({ id: 'bund_logo', src: '/branding/esme_logo.png', name: 'esme_logo.png', origin: 'bundled', protected: true }),
      asset({ id: 'med_9', name: 'team.png', src: '/branding/team.png' }),
    ];
    expect(replaceAsset(library, 'bund_logo', validateUpload(upload()), 'https://cdn.test/my-logo.png').refusal).toMatch(/protected/);
    expect(replaceAsset(library, 'med_gone', validateUpload(upload()), 'https://cdn.test/a.png').refusal).toMatch(/not in the library/);
    expect(replaceAsset(library, 'med_9', validateUpload(upload({ name: 'diagram.svg', type: 'image/svg+xml' })), 'https://cdn.test/diagram.svg').refusal).toMatch(/scripts/);
    expect(replaceAsset(library, 'med_9', validateUpload(upload({ alt: '' })), 'https://cdn.test/a.png').refusal).toMatch(/screen reader/);
    // A file that never reached the library keeps its bytes: a refusal is not a partial write.
    expect(replaceAsset(library, 'med_9', validateUpload(upload({ alt: '' })), 'https://cdn.test/a.png').library).toEqual(library);
    expect(replaceAsset(library, 'med_9', validateUpload(upload()), '/\\attacker.example/a.png').refusal).toMatch(/not one the page could load/);
  });

  it('narrows the search to what the operator typed', () => {
    const library = [asset(), asset({ id: 'med_2', name: 'board_poster.png', alt: 'The board for 2025-2026' })];
    expect(searchableAssets(library, '').length).toBe(2);
    expect(searchableAssets(library, 'board').map((entry) => entry.id)).toEqual(['med_2']);
    expect(searchableAssets(library, 'annual').map((entry) => entry.id)).toEqual(['med_1']);
    expect(searchableAssets(library, 'gif').length).toBe(0);
  });
});
