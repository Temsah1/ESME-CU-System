// @vitest-environment jsdom
/**
 * The media library as a rendered surface.
 *
 * `domain/media.test.ts` already decides what a file is worth (its bytes, not its name) and what a
 * delete is allowed to do. Proved here is the screen that carries those rules to an operator: that
 * an accepted upload becomes a stored row and nothing before its description is written, that a
 * refusal is printed while the dialog is still open rather than after a failed write, that the slot
 * using a picture is named and blocks its deletion, that a replacement keeps the id the slots point
 * at, and that an account without cms.media.manage is handed a reading-only library.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCE_WEBSITE_CONTENT } from '../../data/referenceContent';
import type { MediaAsset, WebsiteContentConfig } from '../../types';
import type { AuditLogItem } from '../../types';

const PASSWORD = 'Str0ng#Librarian1';
const ADMIN = { fullName: 'Farida Nabil', email: 'farida.nabil@example.test', username: 'farida.admin' };
const APPLICANT = { fullName: 'Nada Officer', email: 'nada.officer@esme-cu.edu', username: 'nada.officer' };

/** A file whose first bytes carry a real PNG signature, long enough for `sniffKind` to read. */
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x45, 0x4f, 0x46, 0x0a, 0, 0, 0, 0, 0, 0]);

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: import('../../auth/types').AuthAdapter;
let objectUrls: number;

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  TL = await import('@testing-library/react');
  userEvent = (await import('@testing-library/user-event')).default;
  V2 = (await import('../../storage/migrations')).STORAGE_KEYS.v2;
});

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  objectUrls = 0;
  URL.createObjectURL = () => `blob:device/${(objectUrls += 1)}`;
  URL.revokeObjectURL = () => {};
  // jsdom never decodes a picture, so the size probe would only ever time out. This stands in for
  // the browser measuring the file, which is the case the screen stores.
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 1600;
    naturalHeight = 900;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);

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

afterEach(() => {
  TL.cleanup();
  vi.unstubAllGlobals();
});

const pngFile = (name = 'opening_night.png', bytes = PNG_HEAD) => new File([bytes], name, { type: 'image/png' });

/** A row exactly as a previous session would have left it in this browser's storage. */
const seededRow = (overrides: Partial<MediaAsset> = {}) => ({
  id: 'media_seed',
  name: 'stored_picture.png',
  src: 'blob:device/seed',
  kind: 'png',
  mime: 'image/png',
  bytes: 204800,
  width: 1600,
  height: 900,
  alt: 'Members at the opening night',
  origin: 'library',
  addedAt: '2026-01-01T00:00:00.000Z',
  deviceOnly: true,
  ...overrides,
});

const seed = (rows: unknown[], publishedSlot?: string) => {
  localStorage.setItem(`${V2}mediaAssets`, JSON.stringify(rows));
  if (publishedSlot) {
    const doc: WebsiteContentConfig = {
      ...REFERENCE_WEBSITE_CONTENT,
      images: { ...(REFERENCE_WEBSITE_CONTENT.images ?? {}), 'home.heroCard': { assetId: publishedSlot } },
    };
    localStorage.setItem(`${V2}publishedContent`, JSON.stringify(doc));
  }
};

const library = () => JSON.parse(localStorage.getItem(`${V2}mediaAssets`) ?? '[]') as MediaAsset[];
const audit = () => JSON.parse(localStorage.getItem(`${V2}auditLogs`) ?? '[]') as AuditLogItem[];

async function renderLibrary() {
  const [{ AppProvider }, auth, { MediaLibrary }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./MediaLibrary'),
    import('../../motion'),
    import('motion/react'),
  ]);

  const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    auth.useAuth().status === 'signed_in' ? <>{children}</> : null;
  const onNavigate = vi.fn();

  TL.render(
    <MotionConfig reducedMotion="never">
      <auth.AuthProvider>
        <motion.ToastProvider>
          <AppProvider>
            <Gate>
              <MediaLibrary onNavigate={onNavigate} />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  await TL.waitFor(() => expect(TL.screen.getByRole('heading', { level: 1 })).toBeTruthy());
  return { user, onNavigate };
}

/** Uploads a file and waits for the describe dialog to answer for it. */
async function uploadThrough(user: ReturnType<typeof userEvent['setup']>, input: HTMLElement, file: File) {
  await user.upload(input, file);
  await TL.screen.findByText('Describe this picture');
}

const button = (name: RegExp | string) => TL.screen.getByRole('button', { name });
const isDisabled = (element: HTMLElement) => (element as HTMLButtonElement | HTMLInputElement).disabled === true;

describe('filing a picture', () => {
  it('stores the row only once the picture has been described, and marks the bytes as this device’s', async () => {
    const { user } = await renderLibrary();
    const upload = TL.screen.getByLabelText('Upload a picture to the media library');

    await uploadThrough(user, upload, pngFile());
    // Chosen but not described: the dialog holds it, the store has nothing.
    expect(library()).toEqual([]);
    expect(isDisabled(button(/Add to library/))).toBe(true);
    await TL.screen.getByRole('alert');

    await user.type(TL.screen.getByLabelText('What the picture shows'), 'The 2026 recruitment board');
    await user.click(button(/Add to library/));

    await TL.waitFor(() => expect(library()).toHaveLength(1));
    expect(library()[0]).toMatchObject({
      name: 'opening_night.png',
      src: 'blob:device/1',
      kind: 'png',
      bytes: PNG_HEAD.length,
      width: 1600,
      height: 900,
      alt: 'The 2026 recruitment board',
      origin: 'library',
      deviceOnly: true,
    });
    expect(TL.screen.getByText('The 2026 recruitment board')).toBeTruthy();
    const card = TL.screen.getByText('opening_night.png').closest('li') as HTMLElement;
    expect(TL.within(card).getByText(/1600×900/).textContent).toMatch(/upload · this device only/);
    expect(audit().some((entry) => entry.action === 'Added Media Asset')).toBe(true);
  });

  it('refuses a document renamed to .png while the dialog is still open, and files nothing', async () => {
    const { user } = await renderLibrary();

    await uploadThrough(user, TL.screen.getByLabelText('Upload a picture to the media library'), pngFile('report.png', PDF_HEAD));

    await TL.screen.getByRole('alert');
    await user.type(TL.screen.getByLabelText('What the picture shows'), 'Whatever it is');
    expect(await TL.screen.findByText(/bytes do not start with/i)).toBeTruthy();
    expect(isDisabled(button(/Add to library/))).toBe(true);

    expect(library()).toEqual([]);
    expect(audit().some((entry) => entry.action === 'Added Media Asset')).toBe(false);
  });

  it('accepts a picture that carries no information once it is called decoration', async () => {
    const { user } = await renderLibrary();

    await uploadThrough(user, TL.screen.getByLabelText('Upload a picture to the media library'), pngFile('texture.png'));
    await user.click(TL.screen.getByRole('switch', { name: 'This picture is decoration' }));
    await user.click(button(/Add to library/));

    await TL.waitFor(() => expect(library()).toHaveLength(1));
    expect(library()[0]).toMatchObject({ name: 'texture.png', alt: '', decorative: true });
  });

  it('swaps the file behind an id, so every slot that pointed there still does', async () => {
    seed([seededRow()]);
    const { user } = await renderLibrary();

    await user.upload(
      TL.screen.getByLabelText('Choose a file to replace stored_picture.png'),
      pngFile('second_attempt.png')
    );
    await TL.screen.findByText('Replace a picture');
    expect(TL.screen.getByText(/stands in for stored_picture\.png/)).toBeTruthy();

    await user.type(TL.screen.getByLabelText('What the picture shows'), 'The same board, re-shot');
    await user.click(button(/Replace in place/));

    await TL.waitFor(() => expect(library()[0]?.name).toBe('second_attempt.png'));
    expect(library()).toHaveLength(1);
    // The id is what a slot names, so a replacement must not mint a new one.
    expect(library()[0]).toMatchObject({ id: 'media_seed', src: 'blob:device/1', alt: 'The same board, re-shot' });
  });
});

describe('searching the library', () => {
  it('narrows by name and description, and says so when nothing matches', async () => {
    seed([seededRow({ name: 'kickoff_2026.png', alt: 'Kickoff evening on campus' })]);
    const { user } = await renderLibrary();

    expect(TL.screen.getByText(/1 upload\(s\), 200 KB here/)).toBeTruthy();

    await user.type(TL.screen.getByLabelText('Search the media library'), 'kickoff');
    await TL.waitFor(() => expect(TL.screen.queryByText('board_poster_2025_2026.png')).toBeNull());
    expect(TL.screen.getByText('kickoff_2026.png')).toBeTruthy();

    await user.clear(TL.screen.getByLabelText('Search the media library'));
    await user.type(TL.screen.getByLabelText('Search the media library'), 'nothing-called-this');
    await TL.screen.findByText(/No file name, description, caption or type contains/);

    await user.click(button(/Clear the search/));
    await TL.waitFor(() => expect(TL.screen.getByText('board_poster_2025_2026.png')).toBeTruthy());
  });

  it('filters to what this device holds and to what ships with the build', async () => {
    seed([seededRow()]);
    const { user } = await renderLibrary();

    await user.click(button(/^Uploads$/));
    expect(TL.screen.getByText('stored_picture.png')).toBeTruthy();
    expect(TL.screen.queryByText('esme_logo.png')).toBeNull();

    await user.click(button(/^Ships with the build$/));
    await TL.waitFor(() => expect(TL.screen.queryByText('stored_picture.png')).toBeNull());
    expect(TL.screen.getByText('esme_logo.png')).toBeTruthy();
  });
});

describe('deleting a picture', () => {
  it('names the slot that still points at it and refuses the delete', async () => {
    seed([seededRow()], 'media_seed');
    const { user } = await renderLibrary();

    expect(TL.screen.getByText(/Used by 1 slot\(s\): Hero card photo/)).toBeTruthy();

    const card = TL.screen.getByText('stored_picture.png').closest('li') as HTMLElement;
    await user.click(TL.within(card).getByRole('button', { name: /^Delete/ }));

    await TL.screen.findByText('stored_picture.png cannot be deleted yet');
    expect(await TL.screen.findByText(/1 content slot\(s\) still use it: home\.heroCard/)).toBeTruthy();
    expect(TL.screen.queryByRole('button', { name: /Delete from this device/ })).toBeNull();

    expect(library()).toHaveLength(1);
  });

  it('deletes an upload nothing points at and writes the removal to the audit trail', async () => {
    seed([seededRow()]);
    const { user } = await renderLibrary();

    const card = TL.screen.getByText('stored_picture.png').closest('li') as HTMLElement;
    await user.click(TL.within(card).getByRole('button', { name: /^Delete/ }));
    await TL.screen.findByText('Delete stored_picture.png?');
    await user.click(button(/Delete from this device/));

    await TL.waitFor(() => expect(library()).toEqual([]));
    expect(audit().some((entry) => entry.action === 'Deleted Media Asset')).toBe(true);
  });

  it('will not delete or replace the official logo', async () => {
    const { user } = await renderLibrary();

    const card = TL.screen.getByText('esme_logo.png').closest('li') as HTMLElement;
    expect(TL.within(card).getByText(/Protected — the official logo/)).toBeTruthy();
    expect(isDisabled(TL.within(card).getByLabelText('Choose a file to replace esme_logo.png'))).toBe(true);

    await user.click(TL.within(card).getByRole('button', { name: /^Delete/ }));
    await TL.screen.findByText('esme_logo.png cannot be deleted yet');
    expect(await TL.screen.findByText(/protected bundled asset/i)).toBeTruthy();
    expect(TL.screen.queryByRole('button', { name: /Delete from this device/ })).toBeNull();
  });
});

describe('an account that may not change the library', () => {
  it('gets a reading-only grid', async () => {
    const registered = await adapter.register({
      ...APPLICANT,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptedPolicies: true,
    });
    if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
    const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
    if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
    await adapter.assignRole(registered.receipt.reference, 'head');
    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);

    seed([seededRow()]);
    await renderLibrary();

    expect(isDisabled(TL.screen.getByLabelText('Upload a picture to the media library'))).toBe(true);
    const card = TL.screen.getByText('stored_picture.png').closest('li') as HTMLElement;
    expect(isDisabled(TL.within(card).getByRole('button', { name: /^Delete/ }))).toBe(true);
    expect(isDisabled(TL.within(card).getByLabelText('Choose a file to replace stored_picture.png'))).toBe(true);
    expect(TL.within(card).getByText(/can read the library but not change it/)).toBeTruthy();
    expect(library()).toHaveLength(1);
  });
});
