/**
 * The public page as stored content, tested before anything renders it. Two things matter here:
 * a document that arrives from a form, an import or a hand-written cache entry still has to be
 * safe to publish, and upgrading an older browser must not lose a single sentence the operator
 * wrote. Every case below is a write the store could receive.
 */
import { describe, expect, it } from 'vitest';
import { REFERENCE_WEBSITE_CONTENT } from '../data/referenceContent';
import {
  DOCUMENT_VERSION,
  FIXED_IMAGE_SLOTS,
  PROTECTED_ASSETS,
  assetUsage,
  hiddenSections,
  isProtectedAsset,
  resolveImage,
  safeContentHref,
  slotsUsingAsset,
  upgradeContentDocument,
  validateContentDocument,
  visibleFooterLinks,
  visibleNavigation,
  visibleSections,
  visibleSocials,
} from './cms';

const heroText = {
  hero: { badge: 'Official Student Chapter', headline: 'Welcome to ESME CU', supportingMessage: 'Building the future.', ctaPrimary: 'Login', ctaSecondary: 'Join' },
};

describe('an address the page may follow', () => {
  it('keeps fragments, same-site paths and http(s) URLs', () => {
    expect(safeContentHref('#committees')).toBe('#committees');
    expect(safeContentHref('/magazine')).toBe('/magazine');
    expect(safeContentHref('https://esmecairo.com/about')).toBe('https://esmecairo.com/about');
    // Canonicalised, not echoed back: what is stored is what the browser requests.
    expect(safeContentHref('http://partner.EXAMPLE')).toBe('http://partner.example/');
  });

  it('refuses a scheme or host it cannot vouch for', () => {
    expect(safeContentHref('javascript:alert(1)')).toBeNull();
    expect(safeContentHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeContentHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeContentHref('//attacker.example/steal')).toBeNull();
    expect(safeContentHref('/\\attacker.example')).toBeNull();
    expect(safeContentHref('')).toBeNull();
  });
});

describe('the document validator', () => {
  it('publishes the reference copy exactly as written', () => {
    const { doc, notes, recognized } = validateContentDocument(REFERENCE_WEBSITE_CONTENT);
    expect(recognized).toBe(true);
    expect(notes).toEqual([]);
    expect(doc).toEqual(REFERENCE_WEBSITE_CONTENT);
  });

  it('reports a value that is not a page document instead of publishing an empty one', () => {
    expect(validateContentDocument({ heroTitle: 'someone wrote this by hand' }).recognized).toBe(false);
    expect(validateContentDocument(null).recognized).toBe(false);
    expect(validateContentDocument([]).recognized).toBe(false);
    expect(validateContentDocument({ hero: {} }).recognized).toBe(false);
    expect(validateContentDocument({ documentVersion: DOCUMENT_VERSION }).recognized).toBe(true);
  });

  it('drops a nav link that points at javascript and keeps the ones that do not', () => {
    const { doc, notes } = validateContentDocument({
      ...heroText,
      navigation: [
        { id: 'a', label: 'Committees', href: '#committees', visible: true },
        { id: 'b', label: 'Free lunch', href: 'javascript:void(0)', visible: true },
        { id: 'c', label: 'Partner', href: 'http://partner.example', visible: true },
      ],
    });
    expect(doc.navigation.map((link) => link.id)).toEqual(['a', 'c']);
    expect(notes.join(' ')).toMatch(/will not follow/i);
    expect(visibleNavigation(doc).map((link) => link.href)).toEqual(['#committees', 'http://partner.example/']);
  });

  it('applies the same address rule to the footer links', () => {
    const { doc } = validateContentDocument({
      ...heroText,
      footer: {
        blurb: 'ESME CU Chapter',
        copyright: '© 2026 ESME CU Chapter.',
        links: [
          { id: 'f', label: 'Privacy', href: '/privacy', visible: true },
          { id: 'g', label: 'Script', href: 'javascript:void(0)', visible: true },
          { id: 'h', label: 'Back to the top', href: '#home', visible: false },
        ],
      },
    });
    expect(doc.footer.blurb).toBe('ESME CU Chapter');
    expect(doc.footer.links.map((link) => link.id)).toEqual(['f', 'h']);
    expect(visibleFooterLinks(doc).map((link) => link.id)).toEqual(['f']);
  });

  it('drops a link with no label rather than publishing an empty menu entry', () => {
    const { doc, notes } = validateContentDocument({ ...heroText, navigation: [{ id: 'x', label: '   ', href: '#about' }] });
    expect(doc.navigation).toEqual([]);
    expect(notes.join(' ')).toMatch(/no label/i);
  });

  it('keeps an unknown section out and appends the ones the document forgot', () => {
    const { doc, notes } = validateContentDocument({
      ...heroText,
      sections: [
        { key: 'home', visible: true, order: 0 },
        { key: 'careers', visible: true, order: 1 },
        { key: 'home', visible: false, order: 2 },
        { key: 'contact', visible: false, order: 3 },
      ],
    });
    expect(notes.join(' ')).toMatch(/not a section/i);
    expect(notes.join(' ')).toMatch(/repeats the/i);
    expect(doc.sections.map((section) => section.key)).toContain('about');
    expect(doc.sections.filter((section) => section.key === 'home')).toHaveLength(1);
    expect(doc.sections.every((section, index) => section.order === index)).toBe(true);
    // A section the document never mentioned is still rendered: hiding content by omission is refused.
    expect(visibleSections(doc)).toContain('about');
    expect(hiddenSections(doc)).toEqual(['contact']);
  });

  it('treats a section as visible unless the document says otherwise', () => {
    const { doc } = validateContentDocument({ ...heroText, sections: [{ key: 'about' }] });
    expect(doc.sections.find((section) => section.key === 'about')?.visible).toBe(true);
    expect(doc.sections.find((section) => section.key === 'vision')?.visible).toBe(true);
  });

  it('reports only what it refused, never what the document simply omitted', () => {
    expect(validateContentDocument({ hero: { headline: 'A season opener' } }).notes).toEqual([]);
    expect(validateContentDocument({ ...heroText, about: { story: 42 } }).notes.join(' ')).toMatch(/about.story is not a text field/i);
  });

  it('clips oversized text and says so', () => {
    const { doc, notes } = validateContentDocument({ ...heroText, hero: { ...heroText.hero, headline: 'x'.repeat(400) } });
    expect(doc.hero.headline).toHaveLength(200);
    expect(notes.join(' ')).toMatch(/longer than 200 characters/i);
  });

  it('refuses a contact website that is not a URL', () => {
    const { doc, notes } = validateContentDocument({
      ...heroText,
      contact: { email: 'a@b.test', phone: '1', website: 'javascript:alert(1)', location: 'Giza' },
    });
    expect(doc.contact.website).toBe('');
    expect(notes.join(' ')).toMatch(/not an http\(s\) address/i);
  });

  it('carries a social handle with no confirmed profile over as a handle', () => {
    const { doc, notes } = validateContentDocument({
      ...heroText,
      socials: [
        { id: 's1', network: 'Instagram', handle: '@ESME_Cairo', url: 'javascript:alert(1)', visible: true },
        { id: 's2', network: 'LinkedIn', handle: '', url: 'https://linkedin.com/company/esme-cu', visible: true },
        { id: 's3', network: '', handle: '', url: '', visible: true },
      ],
    });
    expect(doc.socials.map((social) => social.id)).toEqual(['s1', 's2']);
    expect(doc.socials[0].url).toBe('');
    expect(doc.socials[0].handle).toBe('@ESME_Cairo');
    expect(doc.socials[1].url).toBe('https://linkedin.com/company/esme-cu');
    expect(notes.join(' ')).toMatch(/neither a handle nor a usable link/i);
    expect(visibleSocials(doc)).toHaveLength(2);
  });

  it('stores plain text, so markup is never given a meaning', () => {
    const { doc } = validateContentDocument({
      ...heroText,
      about: { story: '<img src=x onerror=alert(1)>' },
    });
    expect(doc.about.story).toBe('<img src=x onerror=alert(1)>');
    expect(doc.about.objectives).toEqual([]);
  });

  it('keeps image slots but refuses to invent an asset id', () => {
    const { doc, notes } = validateContentDocument({
      ...heroText,
      images: { 'home.heroCard': { assetId: 'med_1', alt: 'The chapter team', caption: '' }, '  ': { assetId: 'med_2' } },
    });
    expect(doc.images['home.heroCard'].assetId).toBe('med_1');
    expect(doc.images['  ']).toBeUndefined();
    expect(notes.join(' ')).toMatch(/unnamed slot/i);
  });

  it('falls back to the hero copy for a share card with no title of its own', () => {
    const { doc } = validateContentDocument(heroText);
    expect(doc.sharing.title).toBe('Welcome to ESME CU');
    expect(doc.sharing.description).toBe('Building the future.');
  });
});

describe('the image slots the page owns', () => {
  it('lists a slot for every image on the public site and never the logo', () => {
    expect(FIXED_IMAGE_SLOTS.map((slot) => slot.id)).toEqual(
      expect.arrayContaining(['home.heroCard', 'about.campus', 'history.boardPoster', 'sharing.ogImage'])
    );
    expect(FIXED_IMAGE_SLOTS.some((slot) => slot.defaultSrc.includes('esme_logo'))).toBe(false);
    expect(PROTECTED_ASSETS).toContain('/branding/esme_logo.png');
    expect(isProtectedAsset('/branding/esme_logo.png')).toBe(true);
    expect(isProtectedAsset('/branding/esme_team_celebration.png')).toBe(false);
  });

  it('records which slots use an asset so a delete can be refused', () => {
    const doc = {
      ...REFERENCE_WEBSITE_CONTENT,
      images: { 'home.heroCard': { assetId: 'med_7' }, 'sharing.ogImage': { assetId: 'med_7' }, 'about.campus': { assetId: 'med_9' } },
    };
    expect(slotsUsingAsset(doc, 'med_7')).toEqual(['home.heroCard', 'sharing.ogImage']);
    expect(slotsUsingAsset(doc, 'med_deleted')).toEqual([]);
    expect([...assetUsage(doc).keys()].sort()).toEqual(['med_7', 'med_9']);
    expect(assetUsage(doc).get('med_7')).toEqual(['home.heroCard', 'sharing.ogImage']);
  });

  it('draws the bundled asset when no media row answers', () => {
    const doc = { ...REFERENCE_WEBSITE_CONTENT, images: { 'home.heroCard': { assetId: 'med_missing', alt: 'Team day' } } };
    const fallback = { src: '/branding/esme_team_celebration.png', alt: 'ESME team' };
    expect(resolveImage(doc, 'home.heroCard', fallback, () => undefined)).toEqual({
      src: '/branding/esme_team_celebration.png',
      alt: 'Team day',
      caption: undefined,
      overridden: false,
    });
    const resolved = resolveImage(doc, 'home.heroCard', fallback, (id) =>
      id === 'med_missing' ? { src: 'https://cdn.test/a.webp', alt: 'From the media row' } : undefined
    );
    expect(resolved).toEqual({ src: 'https://cdn.test/a.webp', alt: 'Team day', caption: undefined, overridden: true });
  });
});

describe('upgrading a cached document', () => {
  it('keeps every word of the copy the operator wrote', () => {
    const v1 = {
      hero: { badge: 'Official Student Chapter • Cairo University', headline: 'Welcome to ESME CU Chapter', supportingMessage: 'Empowering Engineering Students.', ctaPrimary: 'Login to Dashboard', ctaSecondary: 'Join ESME' },
      about: { title: 'About ESME', story: 'Founded in 2009.', purpose: 'Qualifying students.', objectives: ['Bridge the gap'], values: ['Be Positive Valuable'], foundedYear: '2009', foundingFaculty: 'FPME', cairoChapterFounded: '2015' },
      vision2027: { headline: 'Vision 2026–2027', quote: 'A quote.', description: 'A description.', pillars: [{ title: 'Technical', description: 'Workshops', points: ['NDT'] }] },
      contact: { email: 'a@b.test', phone: '+20', website: 'https://esmecairo.com', socialHandle: '@ESME_Cairo', location: 'Giza' },
    };
    const { doc, notes, recognized } = upgradeContentDocument(v1, REFERENCE_WEBSITE_CONTENT);

    expect(recognized).toBe(true);
    expect(doc.hero).toEqual(v1.hero);
    expect(doc.about).toEqual(v1.about);
    expect(doc.vision2027).toEqual(v1.vision2027);
    expect(doc.contact).toEqual({ email: 'a@b.test', phone: '+20', website: 'https://esmecairo.com/', location: 'Giza' });
    expect(doc.contact.website).toBe('https://esmecairo.com/');
    expect(doc.sections.map((section) => section.key)).toEqual([
      'home', 'about', 'vision', 'history', 'appreciation', 'committees', 'events', 'magazine', 'insights', 'contact',
    ]);
    expect(doc.sections.every((section) => section.visible)).toBe(true);
    expect(doc.images).toEqual({});
    expect(doc.sharing).toEqual({ title: 'Welcome to ESME CU Chapter', description: 'Empowering Engineering Students.' });
    expect(doc.socials.map((social) => social.handle)).toEqual(['@ESME_Cairo']);
    expect(notes.join(' ')).toMatch(/no link behind it/i);
  });

  /**
   * The pre-CMS document had no field for the header links or the footer copy — the page drew them
   * from the build. Filling them with nothing left an upgraded browser with a header of one link and
   * a footer of one line, and the CMS then counted both as the operator's own edit waiting to be
   * published. Absence in an old cache is not a decision to remove.
   */
  it('carries the shipped navigation and footer into a document that had no room for them', () => {
    const { doc } = upgradeContentDocument(
      { hero: { headline: 'Welcome to ESME CU Chapter' } },
      REFERENCE_WEBSITE_CONTENT
    );

    expect(doc.navigation).toEqual(REFERENCE_WEBSITE_CONTENT.navigation);
    expect(visibleNavigation(doc).map((link) => link.href)).toEqual([
      '#home', '#about', '#vision', '#history', '#appreciation', '#committees', '#events', '#magazine', '#insights', '#contact',
    ]);
    expect(doc.footer.blurb).toBe(REFERENCE_WEBSITE_CONTENT.footer.blurb);
    expect(doc.footer.copyright).toBe(REFERENCE_WEBSITE_CONTENT.footer.copyright);
  });

  it('leaves an emptied navigation alone, because that one is a decision', () => {
    const { doc } = upgradeContentDocument(
      { ...REFERENCE_WEBSITE_CONTENT, navigation: [], footer: { ...REFERENCE_WEBSITE_CONTENT.footer, blurb: '', copyright: '' } },
      REFERENCE_WEBSITE_CONTENT
    );

    expect(doc.navigation).toEqual([]);
    expect(doc.footer.copyright).toBe('');
  });

  it('does not re-upgrade a document that already has socials', () => {
    const { doc, notes } = upgradeContentDocument(
      {
        ...upgradeContentDocument({ hero: { headline: 'x' } }, REFERENCE_WEBSITE_CONTENT).doc,
        contact: { socialHandle: '@Stale' },
        socials: [{ id: 's', network: 'Instagram', handle: '@Real', url: 'https://instagram.com/esme.cairo', visible: true }],
      },
      REFERENCE_WEBSITE_CONTENT
    );
    expect(doc.socials.map((social) => social.handle)).toEqual(['@Real']);
    expect(notes.join(' ')).not.toMatch(/no link behind it/i);
  });

  it('leaves a cache entry that is not a document alone rather than publishing blanks', () => {
    const { recognized, doc } = upgradeContentDocument({ heroTitle: 'ESME CU' }, REFERENCE_WEBSITE_CONTENT);
    expect(recognized).toBe(false);
    expect(doc.hero.headline).toBe('');
  });

  it('is stable: upgrading the reference copy changes nothing', () => {
    const { doc, recognized } = upgradeContentDocument(REFERENCE_WEBSITE_CONTENT, REFERENCE_WEBSITE_CONTENT);
    expect(recognized).toBe(true);
    expect(doc).toEqual(REFERENCE_WEBSITE_CONTENT);
  });
});
