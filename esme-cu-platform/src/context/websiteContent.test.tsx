// @vitest-environment jsdom
/**
 * The content document as the store writes it. An operator's draft has to survive a reload, keep
 * the parts of the page the form does not touch, and refuse a link the browser must not follow —
 * and none of that may depend on who opened the CMS screen. Every case below calls the store
 * directly, the way a hand-made request would, and asserts on what landed in storage.
 *
 * Publishing is the half that reaches a visitor, so it is tested as separately as the code keeps it:
 * a draft edit must not move the live page, a publish must move both the page and the history, and a
 * rollback must add an entry rather than erase one.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCE_WEBSITE_CONTENT } from '../data/referenceContent';
import type { WebsiteContentConfig } from '../types';
import type { AuthAdapter } from '../auth/types';
import { capabilitiesFor, type Role } from '../domain/roles';
import type { ContentRevision } from '../domain/publishing';

const PASSWORD = 'Str0ng#Content1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const MEMBER = { fullName: 'Sara Member', email: 'sara.member@esme-cu.edu', username: 'sara.member' };

type Store = {
  websiteContent: WebsiteContentConfig;
  publishedContent: WebsiteContentConfig;
  contentRevisions: ContentRevision[];
  unpublishedChanges: string[];
  currentUser: { role: string } | null;
  auditLogs: { action: string; details: string }[];
  updateWebsiteContent: (updates: Partial<WebsiteContentConfig>) => void;
  publishWebsiteContent: (label?: string) => { revision: ContentRevision; notes: string[]; unresolvedSlots: string[] };
  discardWebsiteDraft: () => { discarded: number };
  restoreContentRevision: (revisionId: string) => { revision: ContentRevision; notes: string[]; unresolvedSlots: string[] };
};

let TL: typeof import('@testing-library/react');
let V2: string;
let adapter: AuthAdapter;
let ctx: Store | null = null;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  V2 = (await import('../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  ctx = null;
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

  const { createLocalDevAdapter } = await import('../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

/** Registers and approves an account so a second session can be opened. */
async function signInAMember() {
  const registered = await adapter.register({ ...MEMBER, password: PASSWORD, confirmPassword: PASSWORD, acceptedPolicies: true });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
  const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
  if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
  await adapter.signOut();
  await adapter.signIn(MEMBER.email, PASSWORD);
}

/**
 * A Head holds `cms.content.write` but nothing that lets it publish. This is the session that proves
 * the two rights are actually separate rather than a single "CMS" checkbox.
 */
async function signInAHead() {
  const registered = await adapter.register({ ...MEMBER, password: PASSWORD, confirmPassword: PASSWORD, acceptedPolicies: true });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
  const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
  if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
  const promoted = await adapter.assignRole(registered.receipt.reference, 'head');
  if (!promoted.ok) throw new Error(`promotion refused: ${promoted.error.code} — ${promoted.error.message}`);
  await adapter.signOut();
  await adapter.signIn(MEMBER.email, PASSWORD);
}

async function mount() {
  const [{ AppProvider, useApp }, auth] = await Promise.all([import('../context/AppContext'), import('../auth/AuthProvider')]);
  const Probe: React.FC = () => {
    const value = useApp() as unknown as Store;
    React.useEffect(() => {
      ctx = value;
    }, [value]);
    return null;
  };
  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <auth.AuthProvider>
      <AppProvider>
        <Gate>
          <Probe />
        </Gate>
      </AppProvider>
    </auth.AuthProvider>
  );
  await TL.waitFor(() => {
    if (!ctx) throw new Error('the store has not rendered yet');
  });
}

const cached = () => JSON.parse(localStorage.getItem(`${V2}websiteContent`) ?? 'null') as WebsiteContentConfig | null;
const live = () => JSON.parse(localStorage.getItem(`${V2}publishedContent`) ?? 'null') as WebsiteContentConfig | null;
const history = () => JSON.parse(localStorage.getItem(`${V2}contentRevisions`) ?? 'null') as ContentRevision[] | null;

describe('a draft written through the store', () => {
  it('keeps the copy, the sections and the slots of a page it only partly edited', async () => {
    await mount();
    ctx!.updateWebsiteContent({ hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: 'Registration is open until 30 November' } });

    await TL.waitFor(() => expect(cached()?.hero.headline).toBe('Registration is open until 30 November'));
    const doc = cached();
    expect(doc?.about.story).toBe(REFERENCE_WEBSITE_CONTENT.about.story);
    expect(doc?.sections).toEqual(REFERENCE_WEBSITE_CONTENT.sections);
    expect(doc?.navigation).toEqual(REFERENCE_WEBSITE_CONTENT.navigation);
    expect(doc?.documentVersion).toBe(2);
    expect(ctx!.auditLogs.some((log) => /Saved Website Content Draft/.test(log.action))).toBe(true);
  });

  it('drops a navigation link that points at javascript and records the refusal', async () => {
    await mount();
    ctx!.updateWebsiteContent({
      navigation: [
        { id: 'nav_home', label: 'Home', href: '#home', visible: true },
        { id: 'nav_deal', label: 'Free course', href: 'javascript:alert(1)', visible: true },
      ],
    });

    await TL.waitFor(() => expect(cached()?.navigation.map((link) => link.id)).toEqual(['nav_home']));
    const entry = ctx!.auditLogs.find((log) => log.action.includes('refused'));
    expect(entry?.details).toMatch(/will not follow/i);
    expect(entry?.action).toMatch(/1 field\(s\) refused/);
  });

  it('reads the saved document back on the next mount', async () => {
    await mount();
    ctx!.updateWebsiteContent({ footer: { ...REFERENCE_WEBSITE_CONTENT.footer, copyright: '© 2027 ESME CU Chapter.' } });
    await TL.waitFor(() => expect(cached()?.footer.copyright).toBe('© 2027 ESME CU Chapter.'));

    TL.cleanup();
    ctx = null;
    await mount();
    expect(ctx!.websiteContent.footer.copyright).toBe('© 2027 ESME CU Chapter.');
  });
});

describe('publishing the draft onto the live page', () => {
  /** The page a visitor sees only moves when someone with publish rights says so. */
  it('keeps a published copy apart from the edit an operator is still making', async () => {
    await mount();
    ctx!.updateWebsiteContent({ hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: 'Halfway through rewriting this' } });

    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['hero.headline']));
    expect(live()?.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
    expect(ctx!.publishedContent.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
  });

  it('moves the live page, files the revision and writes an audit row naming the fields', async () => {
    await mount();
    ctx!.updateWebsiteContent({ hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: 'Registration closed for this season' } });
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['hero.headline']));

    const published = ctx!.publishWebsiteContent('End of season');
    await TL.waitFor(() => expect(live()?.hero.headline).toBe('Registration closed for this season'));

    expect(published.revision).toMatchObject({ id: expect.any(String), label: 'End of season', changes: ['hero.headline'] });
    expect(published.notes).toEqual([]);
    expect(published.unresolvedSlots).toEqual([]);
    expect(ctx!.unpublishedChanges).toEqual([]);
    expect(history()?.[0]).toMatchObject({ label: 'End of season', actorName: ADMIN.fullName, changes: ['hero.headline'] });
    expect(ctx!.auditLogs.some((log) => log.action === 'Published Website Content' && log.details.includes('hero.headline'))).toBe(true);
  });

  it('refuses a publish with nothing to show for it, rather than filing an empty revision', async () => {
    await mount();
    await TL.waitFor(() => expect(ctx!.publishedContent.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline));
    const before = JSON.stringify(live());

    expect(() => ctx!.publishWebsiteContent('Accidental click')).toThrow(/Nothing to publish/);
    expect(JSON.stringify(live())).toBe(before);
    expect(ctx!.contentRevisions).toEqual([]);
  });

  it('will not let a hand-written cache put a javascript link on the page a visitor reads', async () => {
    await mount();
    const poisoned = JSON.parse(JSON.stringify(cached())) as WebsiteContentConfig;
    poisoned.navigation = [
      ...(poisoned.navigation ?? []),
      { id: 'nav_deal', label: 'Free course', href: 'javascript:alert(1)', visible: true },
    ];
    localStorage.setItem(`${V2}websiteContent`, JSON.stringify(poisoned));

    TL.cleanup();
    ctx = null;
    await mount();
    // The address is dropped while the cached draft is read, so it never reaches the publish step.
    expect(() => ctx!.publishWebsiteContent('From the poisoned cache')).toThrow(/Nothing to publish/);
    expect(JSON.stringify(ctx!.websiteContent)).not.toMatch(/javascript:/i);
    expect(JSON.stringify(live())).not.toMatch(/javascript:/i);
    expect(ctx!.contentRevisions).toEqual([]);
  });

  it('throws the draft away and leaves everything that is already live alone', async () => {
    await mount();
    ctx!.updateWebsiteContent({ hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: 'Copy the operator decided against' } });
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['hero.headline']));

    expect(ctx!.discardWebsiteDraft()).toEqual({ discarded: 1 });
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual([]));
    expect(ctx!.websiteContent.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
    expect(ctx!.auditLogs.some((log) => log.action === 'Discarded Website Draft')).toBe(true);

    // Nothing had been published, so the discard must not have created a page either.
    expect(live()?.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
  });

  it('rolls back to an earlier publish and keeps the one it overwrote in the history', async () => {
    await mount();
    ctx!.updateWebsiteContent({ hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: 'First thing the chapter shipped' } });
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['hero.headline']));
    const first = ctx!.publishWebsiteContent('First publish');
    await TL.waitFor(() => expect(ctx!.contentRevisions).toHaveLength(1));

    ctx!.updateWebsiteContent({ hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: 'A headline everyone hated' } });
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['hero.headline']));
    ctx!.publishWebsiteContent('Second publish');
    await TL.waitFor(() => expect(ctx!.contentRevisions).toHaveLength(2));

    const rolled = ctx!.restoreContentRevision(first.revision.id);
    await TL.waitFor(() => expect(live()?.hero.headline).toBe('First thing the chapter shipped'));

    expect(ctx!.contentRevisions).toHaveLength(3);
    expect(ctx!.contentRevisions.map((entry) => entry.label)).toEqual([
      expect.stringMatching(/^Restored the /),
      'Second publish',
      'First publish',
    ]);
    expect(ctx!.contentRevisions[0].id).toBe(rolled.revision.id);
    expect(ctx!.contentRevisions[2].id).toBe(first.revision.id);
    expect(ctx!.auditLogs.some((log) => log.action === 'Restored Website Revision')).toBe(true);
  });

  it('reads the live page and its history back after the tab closes', async () => {
    await mount();
    ctx!.updateWebsiteContent({ footer: { ...REFERENCE_WEBSITE_CONTENT.footer, blurb: 'Written before the reload' } });
    await TL.waitFor(() => expect(ctx!.unpublishedChanges).toEqual(['footer.blurb']));
    ctx!.publishWebsiteContent('Before reload');
    await TL.waitFor(() => expect(live()?.footer.blurb).toBe('Written before the reload'));
    expect(history()).toHaveLength(1);

    TL.cleanup();
    ctx = null;
    await mount();
    expect(ctx!.publishedContent.footer.blurb).toBe('Written before the reload');
    expect(ctx!.contentRevisions).toHaveLength(1);
    expect(ctx!.unpublishedChanges).toEqual([]);
  });
});

describe('an account with no content capability', () => {
  it('cannot write the document, and nothing changes when it tries', async () => {
    await signInAMember();
    await mount();
    const before = JSON.stringify(cached());

    let outcome = 'none';
    try {
      ctx!.updateWebsiteContent({ hero: { ...REFERENCE_WEBSITE_CONTENT.hero, headline: 'Written by someone with no right to' } });
      outcome = 'accepted';
    } catch (error) {
      outcome = error instanceof Error ? error.message : 'threw';
    }

    expect(outcome).toMatch(/cms\.settings\.global/);
    expect(JSON.stringify(cached())).toBe(before);
    expect(ctx!.websiteContent.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
  });

  /**
   * Publish is the write that reaches a visitor, so it is refused on its own capability. Without
   * this, a role that may draft page copy would be able to put it on the internet.
   */
  it('cannot publish, whatever else it may do with content', async () => {
    await signInAMember();
    await mount();
    const before = JSON.stringify(live());

    expect(() => ctx!.publishWebsiteContent('Not mine to ship')).toThrow(/cms\.content\.publish/);
    expect(() => ctx!.restoreContentRevision('rev_whatever')).toThrow(/cms\.content\.publish/);
    expect(JSON.stringify(live())).toBe(before);
    expect(ctx!.contentRevisions).toEqual([]);
  });

  it('refuses a Head that may write content but was never given the right to publish it', async () => {
    await signInAHead();
    await mount();
    const granted = capabilitiesFor(ctx!.currentUser!.role as Role);

    expect(granted).toContain('cms.content.write');
    expect(granted).not.toContain('cms.content.publish');

    const before = JSON.stringify(live());
    expect(() => ctx!.publishWebsiteContent('Shipped over someone else’s shoulder')).toThrow(/cms\.content\.publish/);
    expect(JSON.stringify(live())).toBe(before);
    expect(ctx!.contentRevisions).toEqual([]);
  });
});
