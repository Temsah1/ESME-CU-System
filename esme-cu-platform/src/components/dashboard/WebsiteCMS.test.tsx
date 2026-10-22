// @vitest-environment jsdom
/**
 * The content editor as a rendered surface.
 *
 * The store and the domain already answer "what may be published" (see `context/websiteContent.test.tsx`
 * and `domain/publishing.test.ts`). What is proved here is the form's own behaviour: that a typed
 * sentence stays a draft until Save, that a publish cannot be clicked over unsaved words, that the
 * rules the page applies are named before the operator saves rather than after, and that the picker
 * points a slot at a library asset rather than at an address somebody typed.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCE_WEBSITE_CONTENT } from '../../data/referenceContent';
import type { ContentRevision } from '../../domain/publishing';
import type { WebsiteContentConfig } from '../../types';
import type { AuthAdapter } from '../../auth/types';

const PASSWORD = 'Str0ng#Editor1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const APPLICANT = { fullName: 'Nada Officer', email: 'nada.officer@esme-cu.edu', username: 'nada.officer' };

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: AuthAdapter;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
  V2 = (await import('../../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

/** A Head holds `cms.content.write` but neither global settings nor publish. */
async function signInAHead() {
  const registered = await adapter.register({
    ...APPLICANT,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    acceptedPolicies: true,
  });
  if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
  const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
  if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
  const promoted = await adapter.assignRole(registered.receipt.reference, 'head');
  if (!promoted.ok) throw new Error(`promotion refused: ${promoted.error.code} — ${promoted.error.message}`);
  await adapter.signOut();
  await adapter.signIn(APPLICANT.email, PASSWORD);
}

async function renderCMS() {
  const [{ AppProvider }, auth, { WebsiteCMS }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./WebsiteCMS'),
    import('../../motion'),
    import('motion/react'),
  ]);

  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <Gate>
              <WebsiteCMS />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  await TL.waitFor(() => expect(TL.screen.getByRole('heading', { level: 1 })).toBeTruthy());
  return { user };
}

const openTab = async (user: ReturnType<typeof userEvent['setup']>, name: string) => {
  await user.click(TL.screen.getByRole('button', { name }));
};

const draft = () => JSON.parse(localStorage.getItem(`${V2}websiteContent`) ?? 'null') as WebsiteContentConfig | null;
const live = () => JSON.parse(localStorage.getItem(`${V2}publishedContent`) ?? 'null') as WebsiteContentConfig | null;
const history = () => JSON.parse(localStorage.getItem(`${V2}contentRevisions`) ?? 'null') as ContentRevision[] | null;

const isDisabled = (element: HTMLElement) => (element as HTMLButtonElement | HTMLInputElement).disabled === true;
const button = (name: RegExp | string) => TL.screen.getByRole('button', { name });
const status = () => TL.screen.getByRole('status');

describe('draft, save and publish from the form', () => {
  it('stores a typed headline as a draft and leaves the live page on the words it had', async () => {
    const { user } = await renderCMS();
    const HEADLINE = 'Applications open until 30 November';
    const field = TL.screen.getByLabelText('Headline');

    await user.clear(field);
    await user.type(field, HEADLINE);

    // Typing is not saving: nothing has reached the store yet.
    expect(draft()?.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
    expect(isDisabled(button(/Publish live page/))).toBe(true);
    expect(status().textContent).toMatch(/Save the draft first/);

    await user.click(button(/Save draft/));
    await TL.waitFor(() => expect(draft()?.hero.headline).toBe(HEADLINE));

    expect(live()?.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
    expect(TL.screen.getByText('1 field(s) waiting to publish')).toBeTruthy();
    expect(history()).toEqual([]);
  });

  it('publishes the saved draft onto the page, labels the revision and lists it in the history', async () => {
    const { user } = await renderCMS();
    const HEADLINE = 'The chapter is now recruiting';

    await user.type(TL.screen.getByLabelText('Headline'), HEADLINE);
    await user.click(button(/Save draft/));
    await TL.waitFor(() => expect(draft()?.hero.headline).toContain(HEADLINE));

    const publish = button(/Publish live page/);
    await TL.waitFor(() => expect(isDisabled(publish)).toBe(false));
    await user.type(TL.screen.getByLabelText('Note for the publish history'), 'Opening recruitment');
    await user.click(publish);

    await TL.waitFor(() => expect(live()?.hero.headline).toBe(`${REFERENCE_WEBSITE_CONTENT.hero.headline}${HEADLINE}`));
    expect(history()).toHaveLength(1);
    expect(history()?.[0]).toMatchObject({ label: 'Opening recruitment', actorName: ADMIN.fullName, changes: ['hero.headline'] });
    expect(TL.screen.getByText('Live page matches the draft')).toBeTruthy();

    await openTab(user, 'History');
    // Exact text: the live-page card above names the same revision, and only the history row prints
    // this string on its own.
    await TL.screen.findByText(`${ADMIN.fullName} — “Opening recruitment”`);
    expect(TL.screen.getByText('live now')).toBeTruthy();
  });

  it('throws an unpublished draft away without touching what is already live', async () => {
    const { user } = await renderCMS();
    expect(TL.screen.getByText('Live page matches the draft')).toBeTruthy();
    expect(isDisabled(button(/Discard draft/))).toBe(true);

    await user.type(TL.screen.getByLabelText('Headline'), '!');
    await user.click(button(/Save draft/));
    await TL.waitFor(() => expect(TL.screen.getByText('1 field(s) waiting to publish')).toBeTruthy());

    await user.click(button(/Discard draft/));
    await TL.waitFor(() => expect(draft()?.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline));
    expect(live()?.hero.headline).toBe(REFERENCE_WEBSITE_CONTENT.hero.headline);
  });
});

describe('the rules the page applies, shown before the save', () => {
  it('names an address the page will not follow while it is still being typed', async () => {
    const { user } = await renderCMS();
    await openTab(user, 'Links');

    const address = TL.screen.getAllByLabelText('Address')[0];
    await user.clear(address);
    await user.type(address, 'javascript:alert(1)');

    // The refusal is printed before the write, not discovered after it.
    await TL.screen.findByText(/will not follow/i);
    await user.click(button(/Save draft/));

    await TL.waitFor(() => expect(draft()?.navigation.find((link) => link.id === 'nav_home')).toBeUndefined());
    expect(JSON.stringify(draft())).not.toMatch(/javascript:/i);
    expect(JSON.stringify(live())).not.toMatch(/javascript:/i);
  });

  it('switches a block off in the draft, and only a publish puts that on the page', async () => {
    const { user } = await renderCMS();
    await openTab(user, 'Blocks');

    const magazine = TL.screen.getByRole('switch', { name: 'Scientific magazine' }) as HTMLInputElement;
    expect(magazine.checked).toBe(true);
    await user.click(magazine);
    await user.click(button(/Save draft/));

    await TL.waitFor(() => expect(draft()?.sections.find((section) => section.key === 'magazine')?.visible).toBe(false));
    expect(live()?.sections.find((section) => section.key === 'magazine')?.visible).toBe(true);

    const publish = button(/Publish live page/);
    await TL.waitFor(() => expect(isDisabled(publish)).toBe(false));
    await user.click(publish);
    await TL.waitFor(() => expect(live()?.sections.find((section) => section.key === 'magazine')?.visible).toBe(false));
  });
});

describe('image slots', () => {
  it('points a slot at a library asset by id and lets it go back to the bundled file', async () => {
    const { user } = await renderCMS();
    await openTab(user, 'Images');

    await TL.screen.findByText('Hero card photo');
    expect(TL.screen.getAllByRole('button', { name: /^Choose a picture for/ })).toHaveLength(7);

    await user.click(button('Choose a picture for Hero card photo'));
    const dialog = await TL.screen.findByRole('dialog');
    await user.click(TL.within(dialog).getByRole('button', { name: /board_poster_2025_2026/ }));

    // The choice is still only in the form until the draft is saved.
    expect(draft()?.images?.['home.heroCard']).toBeUndefined();

    await user.click(button(/Save draft/));
    await TL.waitFor(() => expect(draft()?.images?.['home.heroCard']?.assetId).toBe('bund_3'));
    expect(draft()?.images?.['home.heroCard']?.alt).toBe('Board of the 2025-2026 academic year');

    // Back to the file that ships with the build; the words written on the slot stay.
    await user.click(button('Use the bundled asset for Hero card photo'));
    await user.click(button(/Save draft/));
    await TL.waitFor(() => expect(draft()?.images?.['home.heroCard']?.assetId).toBeUndefined());
    expect(draft()?.images?.['home.heroCard']?.alt).toBe('Board of the 2025-2026 academic year');
  });
});

describe('an account that may read the page but not change it', () => {
  it('gets a disabled form, no publish, and a reason naming the capability it lacks', async () => {
    await signInAHead();
    const { user } = await renderCMS();

    await TL.screen.findByText(/cms\.settings\.global/);
    // The whole editor sits inside a disabled fieldset, which is what a browser enforces; jsdom does
    // not propagate a fieldset's disabled state to its inputs, so the group itself is asserted here.
    const editor = TL.screen.getByRole('group', { name: 'Public website content editor' }) as HTMLFieldSetElement;
    expect(editor.disabled).toBe(true);
    expect(isDisabled(button(/Save draft/))).toBe(true);
    expect(isDisabled(button(/Publish live page/))).toBe(true);
    expect(status().textContent).toMatch(/cms\.content\.publish/);

    await openTab(user, 'History');
    expect(isDisabled(button(/Open the live page/))).toBe(false);
  });
});
