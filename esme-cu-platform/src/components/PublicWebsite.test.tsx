// @vitest-environment jsdom
/**
 * The public page read through the *published* document. The copy below is not the reference
 * constant and it is not the draft either: it is the page an operator put on the internet, so these
 * tests show that the site renders that document — the headline, the handle, the links, the blocks
 * that were switched off, the picture behind a slot and the card a pasted link shows — instead of a
 * second hardcoded page. And that an edit nobody published stays off the page a visitor reads.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCE_WEBSITE_CONTENT } from '../data/referenceContent';
import type { MediaAsset, WebsiteContentConfig } from '../types';

const HEADLINE = 'ESME CU opens recruitment for 2026-2027';
const SUPPORT = 'Materials engineering, taught by the industry that hires it.';
const LOCATION = 'Building A, Faculty of Engineering, Giza';
const HANDLE = '@ESMECairoChapter';
const UNPUBLISHED = 'A headline still sitting in the draft box';
const SHARE_TITLE = 'ESME CU — Cairo University Student Chapter';
const SHARE_COPY = 'Six committees, one faculty, and the industry that hires from it.';
const UPLOADED = '/media/corrosion-lab.png';

let TL: typeof import('@testing-library/react');
let V2: string;
let versionKey: string;
let currentVersion: string;

const published: WebsiteContentConfig = {
  ...REFERENCE_WEBSITE_CONTENT,
  hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: HEADLINE, supportingMessage: SUPPORT },
  contact: { ...REFERENCE_WEBSITE_CONTENT.contact, location: LOCATION },
  socials: [{ id: 'social_1', network: 'Instagram', handle: HANDLE, url: 'https://instagram.com/esme.cairo', visible: true }],
  sharing: { title: SHARE_TITLE, description: SHARE_COPY },
  footer: {
    blurb: 'ESME CU — Egyptian Society of Materials Engineers',
    copyright: '© 2027 ESME CU Chapter. Built by its members.',
    links: [
      { id: 'foot_recruitment', label: 'Apply', href: '#contact', visible: true },
      { id: 'foot_hidden', label: 'A page that was taken down', href: '#magazine', visible: false },
    ],
  },
  // Recruitment is the block that was switched off, and its nav entry goes with it.
  sections: REFERENCE_WEBSITE_CONTENT.sections.map((section) =>
    section.key === 'magazine' ? { ...section, visible: false } : section
  ),
  images: {
    'home.heroCard': { assetId: 'med_corrosion', alt: 'Members at the corrosion lab', caption: 'Field visit, March 2026' },
    // A slot naming a picture this device does not hold keeps the asset shipped with the build.
    'about.campus': { assetId: 'med_deleted_elsewhere', alt: 'The faculty building' },
    'sharing.ogImage': { assetId: 'med_corrosion' },
  },
};

/** A draft that was never published: different copy, and a block the live page still shows. */
const draft: WebsiteContentConfig = {
  ...published,
  hero: { ...published.hero, headline: UNPUBLISHED },
  sections: published.sections.map((section) => (section.key === 'events' ? { ...section, visible: false } : section)),
};

const libraryRow: MediaAsset = {
  id: 'med_corrosion',
  name: 'corrosion-lab.png',
  src: UPLOADED,
  kind: 'png',
  mime: 'image/png',
  bytes: 20_480,
  alt: 'Members at the corrosion lab',
  origin: 'library',
  addedAt: '2026-03-09T10:00:00.000Z',
  deviceOnly: true,
};

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  // jsdom has no IntersectionObserver, and a section that waits for the viewport never reveals
  // itself. Everything the page draws is reported as already on screen.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private readonly cb: (entries: { isIntersecting: boolean; intersectionRatio: number; target: Element }[]) => void;
      constructor(cb: (entries: { isIntersecting: boolean; intersectionRatio: number; target: Element }[]) => void) {
        this.cb = cb;
      }
      observe(target: Element) {
        this.cb([{ isIntersecting: true, intersectionRatio: 1, target }]);
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver
  );
  TL = await import('@testing-library/react');
  const keys = (await import('../storage/migrations')).STORAGE_KEYS;
  V2 = keys.v2;
  versionKey = keys.version;
  currentVersion = (await import('../storage/migrations')).TARGET_VERSION;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.head.querySelectorAll('meta[property], meta[name="description"]').forEach((tag) => tag.remove());
  document.title = 'esme-cu-platform';
  // The document is already current, so the module-level migration has nothing to rewrite.
  localStorage.setItem(versionKey, currentVersion);
  localStorage.setItem(`${V2}publishedContent`, JSON.stringify(published));
  localStorage.setItem(`${V2}websiteContent`, JSON.stringify(draft));
  localStorage.setItem(`${V2}mediaAssets`, JSON.stringify([libraryRow]));
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => TL.cleanup());

async function renderSite() {
  const [{ AppProvider }, { PublicWebsite }, { MotionConfig }, auth] = await Promise.all([
    import('../context/AppContext'),
    import('./PublicWebsite'),
    import('motion/react'),
    import('../auth/AuthProvider'),
  ]);
  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <AppProvider>
          <PublicWebsite onNavigateToDashboard={() => {}} onNavigateToJoin={() => {}} />
        </AppProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
}

const live = () => JSON.parse(localStorage.getItem(`${V2}publishedContent`) ?? 'null') as WebsiteContentConfig | null;

describe('the public site renders the published document', () => {
  it('prints the headline the page carries, not the one shipped with the build', async () => {
    await renderSite();
    // The headline is revealed word by word, so each word is its own element and the sentence is
    // carried by the group's accessible label. The words are joined by non-breaking spaces, which
    // is why the sentence is compared with whitespace normalised rather than as one text node.
    const reveal = await TL.screen.findByLabelText(HEADLINE);
    expect(reveal.closest('h1')).toBeTruthy();
    expect(reveal.textContent?.trim().split(/\s+/).join(' ')).toBe(HEADLINE);
    expect(reveal.textContent).not.toContain(REFERENCE_WEBSITE_CONTENT.hero.headline);
    expect(TL.screen.getByText(SUPPORT)).toBeTruthy();
  });

  it('keeps a draft nobody published off the page a visitor reads', async () => {
    await renderSite();
    await TL.screen.findByLabelText(HEADLINE);
    expect(TL.screen.queryByText(UNPUBLISHED)).toBeNull();
    // …and the block the draft switched off is still on the live page, because publish never ran.
    expect(document.getElementById('events')).toBeTruthy();
  });

  it('prints the location and the handle the document carries', async () => {
    await renderSite();
    expect(await TL.screen.findByText(LOCATION)).toBeTruthy();
    expect(TL.screen.getByText(HANDLE)).toBeTruthy();
    expect(TL.screen.queryByText(REFERENCE_WEBSITE_CONTENT.contact.location)).toBeNull();
  });

  it('draws the uploaded picture for a slot and the shipped asset for one it cannot resolve', async () => {
    await renderSite();
    const heroCard = await TL.screen.findByAltText('Members at the corrosion lab');
    expect(heroCard.getAttribute('src')).toBe(UPLOADED);
    // The slot's own caption is what the page prints over the picture.
    expect(TL.screen.getByText('Field visit, March 2026')).toBeTruthy();

    // A slot naming an asset this device does not hold falls back, and says so through the alt it keeps.
    const campus = TL.screen.getByAltText('The faculty building');
    expect(campus.getAttribute('src')).toBe('/history/xref_585.png');
  });

  it('lists the links the document shows and leaves out the block that was switched off', async () => {
    await renderSite();
    await TL.screen.findByLabelText(HEADLINE);
    const header = document.querySelector('nav');
    expect(header?.querySelector('a[href="#about"]')).toBeTruthy();
    expect(header?.querySelector('a[href="#magazine"]')).toBeNull();
    expect(document.getElementById('magazine')).toBeNull();
    expect(document.getElementById('about')).toBeTruthy();
  });

  it('prints the footer the document holds, links and all', async () => {
    await renderSite();
    expect(await TL.screen.findByText('ESME CU — Egyptian Society of Materials Engineers')).toBeTruthy();
    expect(TL.screen.getByText('© 2027 ESME CU Chapter. Built by its members.')).toBeTruthy();
    expect(TL.screen.getByRole('link', { name: 'Apply' })).toBeTruthy();
    expect(TL.screen.queryByText('A page that was taken down')).toBeNull();
  });

  it('writes the share card a pasted link shows from the published copy', async () => {
    await renderSite();
    await TL.screen.findByLabelText(HEADLINE);
    await TL.waitFor(() => expect(document.title).toBe(SHARE_TITLE));
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(SHARE_TITLE);
    expect(document.querySelector('meta[property="og:description"]')?.getAttribute('content')).toBe(SHARE_COPY);
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(UPLOADED);
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(SHARE_COPY);
  });

  it('holds the live document it read, slots and section switches included', async () => {
    await renderSite();
    await TL.waitFor(() => expect(live()?.hero.headline).toBe(HEADLINE));
    expect(live()?.sections).toEqual(published.sections);
    expect(live()?.socials).toEqual(published.socials);
    // The page never rewrites the live document, and reading it must not touch the draft either.
    expect(JSON.parse(localStorage.getItem(`${V2}websiteContent`) ?? 'null')).toEqual(draft);
    // A slot naming an asset this device has never held survives the round trip: the media table is
    // what turns it into a picture, not the cache.
    expect(live()?.images).toEqual(published.images);
  });
});
