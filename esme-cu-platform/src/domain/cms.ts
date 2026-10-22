import type {
  ContentImageSlot,
  ContentLink,
  ContentSectionState,
  ContentSocial,
  PublicSectionKey,
  WebsiteContentConfig,
} from '../types';
import { safeUrl } from './email';

/**
 * The public page as the operator sees it: which blocks exist, in which order, which links and
 * images they carry. Nothing here renders anything — the validator is what both the store and the
 * editor call, so a hand-made write is refused by the same rules the form applies.
 */

export const DOCUMENT_VERSION = 2;

export const SECTION_KEYS: PublicSectionKey[] = [
  'home',
  'about',
  'vision',
  'history',
  'appreciation',
  'committees',
  'events',
  'magazine',
  'insights',
  'contact',
];

export const SECTION_LABELS: Record<PublicSectionKey, string> = {
  home: 'Home / hero',
  about: 'About the chapter',
  vision: 'Vision',
  history: 'Our history',
  appreciation: 'Appreciation',
  committees: 'Committees',
  events: 'Events',
  magazine: 'Scientific magazine',
  insights: 'Meta insights',
  contact: 'Contact',
};

export type ImageSlotDefinition = {
  id: string;
  label: string;
  group: string;
  /**
   * The asset shipped with the build, used when no media asset is chosen. An empty string means
   * the block renders no image until one is — the site is never pointed at an invented path.
   */
  defaultSrc: string;
};

/** Slots the page always has. Lists such as the timeline own their slots; see `listSlotId`. */
export const FIXED_IMAGE_SLOTS: ImageSlotDefinition[] = [
  { id: 'home.heroCard', label: 'Hero card photo', group: 'Home', defaultSrc: '/branding/esme_team_celebration.png' },
  { id: 'about.campus', label: 'Faculty building photo', group: 'About', defaultSrc: '/history/xref_585.png' },
  { id: 'history.boardPoster', label: 'Board roster poster', group: 'History', defaultSrc: '/branding/board_poster_2025_2026.png' },
  { id: 'sharing.ogImage', label: 'Share card image', group: 'Sharing', defaultSrc: '/branding/esme_team_celebration.png' },
  { id: 'committees.cover', label: 'Committees section cover', group: 'Committees', defaultSrc: '' },
  { id: 'events.cover', label: 'Events section cover', group: 'Events', defaultSrc: '' },
  { id: 'magazine.cover', label: 'Magazine cover', group: 'Magazine', defaultSrc: '' },
];

/** The logo is deliberately absent from every slot list: it is a bundled, protected asset. */
export const PROTECTED_ASSETS: readonly string[] = ['/branding/esme_logo.png', '/favicon.svg'];

export function isProtectedAsset(src: string): boolean {
  return PROTECTED_ASSETS.includes(src);
}

export function listSlotId(group: string, index: number): string {
  return `${group}.item${index}`;
}

export function slotLabel(id: string): string {
  const known = FIXED_IMAGE_SLOTS.find((slot) => slot.id === id);
  if (known) return known.label;
  const parts = id.split('.');
  const group = parts[0];
  const name = parts.slice(1).join('.');
  const groupLabel = SECTION_LABELS[group as PublicSectionKey] ?? group;
  return `${groupLabel} — ${name}`;
}

/**
 * An `href` the page may follow: a fragment, a same-site path, or an absolute http(s) URL. The
 * scheme check is what refuses `javascript:` and a protocol-relative `//host`; a data URL has no
 * place in a link either. An absolute address comes back canonicalised — lower-cased host,
 * terminated path — so what is stored is what the browser will actually request.
 */
export function safeContentHref(value: string): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('#')) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')) return trimmed;
  return safeUrl(trimmed);
}

const MAX_TEXT = 4000;
const MAX_TITLE = 200;
const MAX_ITEMS = 40;

/** The groups every version of this document has, and the only thing that proves a cache is one. */
const DOCUMENT_GROUPS = ['hero', 'about', 'vision2027', 'contact'] as const;

type Notes = string[];

/**
 * Absence is not a refusal: a field the document never carried arrives empty with no note, so the
 * notes list says only what the page would not accept. A value of the wrong type is a different
 * matter and is reported.
 */
const isAbsent = (value: unknown) => value === undefined || value === null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function text(notes: Notes, value: unknown, path: string, cap: number): string {
  if (isAbsent(value)) return '';
  if (typeof value !== 'string') {
    notes.push(`${path} is not a text field, so it was stored empty.`);
    return '';
  }
  if (value.length > cap) {
    notes.push(`${path} was longer than ${cap} characters, so it was cut back.`);
    return value.slice(0, cap);
  }
  return value;
}

function stringList(notes: Notes, value: unknown, path: string): string[] {
  if (isAbsent(value)) return [];
  if (!Array.isArray(value)) {
    notes.push(`${path} must be a list of strings, so it was stored empty.`);
    return [];
  }
  const rows = value.length > MAX_ITEMS ? value.slice(0, MAX_ITEMS) : value;
  if (rows.length !== value.length) notes.push(`${path} carried more than ${MAX_ITEMS} entries, so the rest was dropped.`);
  return rows.map((entry, idx) => text(notes, entry, `${path}[${idx}]`, MAX_TEXT)).filter((entry) => entry !== '');
}

function links(notes: Notes, value: unknown, path: string): ContentLink[] {
  if (isAbsent(value)) return [];
  if (!Array.isArray(value)) {
    notes.push(`${path} must be a list of links, so the page keeps its own set.`);
    return [];
  }
  const out: ContentLink[] = [];
  value.forEach((raw, idx) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const label = text(notes, row.label, `${path}[${idx}].label`, MAX_TITLE).trim();
    const href = safeContentHref(typeof row.href === 'string' ? row.href : '');
    if (label === '') {
      notes.push(`${path}[${idx}] has no label, so it was dropped.`);
      return;
    }
    if (href === null) {
      notes.push(`${path}[${idx}] (“${label}”) points at an address this page will not follow, so it was dropped.`);
      return;
    }
    out.push({ id: text(notes, row.id, `${path}[${idx}].id`, 60) || `lnk_${idx}`, label, href, visible: row.visible !== false });
  });
  return out;
}

function socials(notes: Notes, value: unknown, path: string): ContentSocial[] {
  if (isAbsent(value)) return [];
  if (!Array.isArray(value)) {
    notes.push(`${path} must be a list of social links, so none are published.`);
    return [];
  }
  const out: ContentSocial[] = [];
  value.forEach((raw, idx) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const handle = text(notes, row.handle, `${path}[${idx}].handle`, MAX_TITLE);
    const network = text(notes, row.network, `${path}[${idx}].network`, MAX_TITLE);
    const url = safeUrl(typeof row.url === 'string' ? row.url.trim() : '');
    if (handle === '' && url === null) {
      notes.push(`${path}[${idx}] carries neither a handle nor a usable link, so it was dropped.`);
      return;
    }
    out.push({
      id: text(notes, row.id, `${path}[${idx}].id`, 60) || `soc_${idx}`,
      network,
      handle,
      url: url ?? '',
      visible: row.visible !== false,
    });
  });
  return out;
}

function sections(notes: Notes, value: unknown, path: string): ContentSectionState[] {
  if (isAbsent(value)) {
    return SECTION_KEYS.map((key, order) => ({ key, visible: true, order }));
  }
  if (!Array.isArray(value)) {
    notes.push(`${path} must be a list of sections, so every section renders in source order.`);
    return SECTION_KEYS.map((key, order) => ({ key, visible: true, order }));
  }
  const seen = new Set<PublicSectionKey>();
  const out: ContentSectionState[] = [];
  value.forEach((raw, idx) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const key = row.key as PublicSectionKey;
    if (!SECTION_KEYS.includes(key)) {
      notes.push(`${path}[${idx}] names “${String(row.key)}”, which is not a section of this site, so it was dropped.`);
      return;
    }
    if (seen.has(key)) {
      notes.push(`${path}[${idx}] repeats the “${key}” section, so the second copy was dropped.`);
      return;
    }
    seen.add(key);
    const order = typeof row.order === 'number' && Number.isFinite(row.order) ? row.order : idx;
    out.push({ key, visible: row.visible !== false, order });
  });
  // A section the document never mentions is still a section of the page: it is listed last and
  // left visible, so content cannot be hidden by omission.
  SECTION_KEYS.forEach((key) => {
    if (!seen.has(key)) out.push({ key, visible: true, order: out.length });
  });
  return out.sort((a, b) => a.order - b.order).map((section, order) => ({ ...section, order }));
}

function images(notes: Notes, value: unknown, path: string): Record<string, ContentImageSlot> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    notes.push(`${path} must be a set of image slots, so every slot keeps its bundled asset.`);
    return {};
  }
  const out: Record<string, ContentImageSlot> = {};
  Object.entries(value as Record<string, unknown>).forEach(([slotId, raw]) => {
    if (slotId.trim() === '') {
      notes.push(`${path} carries an unnamed slot, so it was dropped.`);
      return;
    }
    const row = (raw ?? {}) as Record<string, unknown>;
    const slot: ContentImageSlot = {};
    const assetId = typeof row.assetId === 'string' ? row.assetId.trim() : '';
    if (assetId !== '') slot.assetId = assetId.slice(0, 80);
    if (typeof row.alt === 'string') slot.alt = row.alt.slice(0, MAX_TITLE);
    if (typeof row.caption === 'string') slot.caption = row.caption.slice(0, MAX_TITLE);
    out[slotId] = slot;
  });
  return out;
}

/**
 * Accepts anything a request or an old cache could hold and returns the document the site can
 * actually render, plus the list of what was refused or dropped. An unsafe address is never
 * repaired into something else — it is left out and reported. `recognized` is false when the
 * input holds none of the groups this page reads, which means the write did not come from a
 * content document at all and should be refused rather than published as a blank page.
 */
export function validateContentDocument(
  raw: unknown
): { doc: WebsiteContentConfig; notes: string[]; recognized: boolean } {
  const notes: string[] = [];
  const row = (raw ?? {}) as Record<string, unknown>;
  const hero = (row.hero ?? {}) as Record<string, unknown>;
  const about = (row.about ?? {}) as Record<string, unknown>;
  const vision = (row.vision2027 ?? {}) as Record<string, unknown>;
  const contact = (row.contact ?? {}) as Record<string, unknown>;
  const sharing = (row.sharing ?? {}) as Record<string, unknown>;
  const footer = (row.footer ?? {}) as Record<string, unknown>;

  const headline = text(notes, hero.headline, 'hero.headline', MAX_TITLE);
  const supporting = text(notes, hero.supportingMessage, 'hero.supportingMessage', MAX_TEXT);
  const website = contact.website;
  const websiteUrl = safeUrl(typeof website === 'string' ? website.trim() : '');
  if (typeof website === 'string' && website.trim() !== '' && websiteUrl === null) {
    notes.push('contact.website is not an http(s) address, so it was stored empty.');
  }

  const pillarRows = Array.isArray(vision.pillars) ? vision.pillars : [];
  if (vision.pillars !== undefined && !Array.isArray(vision.pillars)) {
    notes.push('vision2027.pillars must be a list, so no pillars are published.');
  }

  const doc: WebsiteContentConfig = {
    documentVersion: DOCUMENT_VERSION,
    hero: {
      badge: text(notes, hero.badge, 'hero.badge', MAX_TITLE),
      headline,
      supportingMessage: supporting,
      ctaPrimary: text(notes, hero.ctaPrimary, 'hero.ctaPrimary', MAX_TITLE),
      ctaSecondary: text(notes, hero.ctaSecondary, 'hero.ctaSecondary', MAX_TITLE),
    },
    about: {
      title: text(notes, about.title, 'about.title', MAX_TITLE),
      story: text(notes, about.story, 'about.story', MAX_TEXT),
      purpose: text(notes, about.purpose, 'about.purpose', MAX_TEXT),
      objectives: stringList(notes, about.objectives, 'about.objectives'),
      values: stringList(notes, about.values, 'about.values'),
      foundedYear: text(notes, about.foundedYear, 'about.foundedYear', MAX_TITLE),
      foundingFaculty: text(notes, about.foundingFaculty, 'about.foundingFaculty', MAX_TITLE),
      cairoChapterFounded: text(notes, about.cairoChapterFounded, 'about.cairoChapterFounded', MAX_TITLE),
    },
    vision2027: {
      headline: text(notes, vision.headline, 'vision2027.headline', MAX_TITLE),
      quote: text(notes, vision.quote, 'vision2027.quote', MAX_TEXT),
      description: text(notes, vision.description, 'vision2027.description', MAX_TEXT),
      pillars: pillarRows.slice(0, MAX_ITEMS).map((rawPillar, idx) => {
        const pillar = (rawPillar ?? {}) as Record<string, unknown>;
        return {
          title: text(notes, pillar.title, `vision2027.pillars[${idx}].title`, MAX_TITLE),
          description: text(notes, pillar.description, `vision2027.pillars[${idx}].description`, MAX_TEXT),
          points: stringList(notes, pillar.points, `vision2027.pillars[${idx}].points`),
        };
      }),
    },
    contact: {
      email: text(notes, contact.email, 'contact.email', MAX_TITLE),
      phone: text(notes, contact.phone, 'contact.phone', MAX_TITLE),
      website: websiteUrl ?? '',
      location: text(notes, contact.location, 'contact.location', MAX_TEXT),
    },
    sharing: {
      title: text(notes, sharing.title, 'sharing.title', MAX_TITLE) || headline,
      description: text(notes, sharing.description, 'sharing.description', MAX_TEXT) || supporting,
    },
    sections: sections(notes, row.sections, 'sections'),
    navigation: links(notes, row.navigation, 'navigation'),
    footer: {
      blurb: text(notes, footer.blurb, 'footer.blurb', MAX_TEXT),
      copyright: text(notes, footer.copyright, 'footer.copyright', MAX_TITLE),
      links: links(notes, footer.links, 'footer.links'),
    },
    socials: socials(notes, row.socials, 'socials'),
    images: images(notes, row.images, 'images'),
  };

  return { doc, notes, recognized: DOCUMENT_GROUPS.some((group) => isPlainObject(row[group])) || row.documentVersion === DOCUMENT_VERSION };
}

/**
 * Carries an older cached document forward. The text the operator wrote stays exactly as it was;
 * what the old shape had no place for — sections, links, footer, socials, slots — arrives from the
 * `shipped` document, because the page cannot offer a header link it never stored. A social handle
 * with no URL behind it becomes a handle with no URL rather than an invented profile.
 *
 * Only a group the cached row genuinely does not carry is filled. An operator who saved a page with
 * the navigation emptied is holding `navigation: []`, which is a decision and stays one.
 *
 * `recognized` says whether the input was a page document at all. A cache written by hand or by an
 * unrelated caller has none of the four groups the site reads, and rewriting it would produce a
 * document of empty strings — a published blank page. The caller decides what to do with that.
 */
export type ShippedContentDefaults = Pick<
  WebsiteContentConfig,
  'sections' | 'navigation' | 'footer' | 'socials' | 'images'
>;

const GROUPS_THE_OLD_SHAPE_HAD_NO_ROOM_FOR = ['sections', 'navigation', 'footer', 'socials', 'images'] as const;

export function upgradeContentDocument(
  raw: unknown,
  shipped: ShippedContentDefaults
): { doc: WebsiteContentConfig; notes: string[]; recognized: boolean } {
  const row = (raw ?? {}) as Record<string, unknown>;
  const contact = (row.contact ?? {}) as Record<string, unknown>;
  const recognized = DOCUMENT_GROUPS.some((group) => isPlainObject(row[group])) || row.documentVersion === DOCUMENT_VERSION;

  const carried: Record<string, unknown> = { ...row };
  delete carried.documentVersion;

  GROUPS_THE_OLD_SHAPE_HAD_NO_ROOM_FOR.forEach((group) => {
    if (isAbsent(carried[group])) carried[group] = shipped[group];
  });

  const notes: string[] = [];
  const handle = typeof contact.socialHandle === 'string' ? contact.socialHandle.trim() : '';
  const hadSocials = Array.isArray(row.socials);
  const storedContact = (carried.contact ?? {}) as Record<string, unknown>;
  if (handle !== '') {
    const rest = { ...storedContact };
    delete rest.socialHandle;
    carried.contact = rest;
  }
  if (handle !== '' && !hadSocials) {
    notes.push(
      `The cached document held the handle “${handle}” with no link behind it, so it carried over as a handle the page prints rather than as a URL nobody confirmed.`
    );
    carried.socials = [{ id: 'social_cached', network: '', handle, url: '', visible: true }];
  }

  const upgraded = validateContentDocument(carried);
  return { doc: upgraded.doc, notes: [...notes, ...upgraded.notes], recognized };
}

/** Which of the document's slots still point at a given asset. Delete is refused while this is not empty. */
export function slotsUsingAsset(doc: WebsiteContentConfig, assetId: string): string[] {
  return Object.entries(doc.images ?? {})
    .filter(([, slot]) => slot?.assetId === assetId)
    .map(([slotId]) => slotId);
}

/** Every asset id the document currently points at, with the slots that use it. */
export function assetUsage(doc: WebsiteContentConfig): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  Object.entries(doc.images ?? {}).forEach(([slotId, slot]) => {
    const assetId = slot?.assetId;
    if (!assetId) return;
    usage.set(assetId, [...(usage.get(assetId) ?? []), slotId]);
  });
  return usage;
}

/** The sections in the order the operator set, minus the ones switched off. */
export function visibleSections(doc: WebsiteContentConfig): PublicSectionKey[] {
  const listed = [...(doc.sections ?? [])].sort((a, b) => a.order - b.order).filter((section) => section.visible);
  const known = new Set(listed.map((section) => section.key));
  return [...listed.map((section) => section.key), ...SECTION_KEYS.filter((key) => !known.has(key))];
}

export function hiddenSections(doc: WebsiteContentConfig): PublicSectionKey[] {
  return (doc.sections ?? []).filter((section) => !section.visible).map((section) => section.key);
}

export function visibleNavigation(doc: WebsiteContentConfig): ContentLink[] {
  return (doc.navigation ?? []).filter((link) => link.visible);
}

export function visibleFooterLinks(doc: WebsiteContentConfig): ContentLink[] {
  return (doc.footer?.links ?? []).filter((link) => link.visible);
}

export function visibleSocials(doc: WebsiteContentConfig): ContentSocial[] {
  return (doc.socials ?? []).filter((social) => social.visible);
}

export type ResolvedImage = { src: string; alt: string; caption?: string; overridden: boolean };

/**
 * What a slot draws. The asset store is asked for the id the document names; when it cannot answer
 * — an import from another device, a row the provider has not returned yet — the block falls back
 * to the asset shipped with the build rather than rendering nothing.
 */
export function resolveImage(
  doc: WebsiteContentConfig,
  slotId: string,
  fallback: { src: string; alt: string },
  assetById: (assetId: string) => { src: string; alt?: string; caption?: string } | undefined
): ResolvedImage {
  const slot = doc.images?.[slotId];
  const asset = slot?.assetId ? assetById(slot.assetId) : undefined;
  if (asset) {
    return {
      src: asset.src,
      alt: slot?.alt ?? asset.alt ?? fallback.alt,
      caption: slot?.caption ?? asset.caption,
      overridden: true,
    };
  }
  return { src: fallback.src, alt: slot?.alt ?? fallback.alt, caption: slot?.caption, overridden: false };
}
