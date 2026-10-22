// @vitest-environment jsdom
/**
 * The front door for a visitor who asked their device for reduced motion.
 *
 * Found by clicking through the running site on a machine that reports
 * `prefers-reduced-motion: reduce`: the Login button changed the app's own `mode` state — proved
 * from the React fiber at the time — and the screen never swapped, because the whole app sits
 * inside `<AnimatePresence mode="wait">` and the waiting child never finishes its exit animation
 * when motion is reduced. The visitor stays on the home page with the click having "worked".
 *
 * So this file does not test the animation. It tests that the next screen arrives.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, TARGET_VERSION } from './storage/migrations';

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];

beforeAll(async () => {
  vi.stubGlobal('crypto', webcrypto);
  // jsdom has no IntersectionObserver, and a section that waits for the viewport never reveals
  // itself — the page would fail to render for the wrong reason.
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
  userEvent = (await import('@testing-library/user-event')).default;
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(STORAGE_KEYS.version, TARGET_VERSION);
  // Vitest runs with DEV=false, which would send the app to the "authentication is not
  // configured" screen. The documented local development adapter is what a developer's browser
  // actually uses, so this scenario runs against it — no provider is contacted.
  vi.stubEnv('DEV', true);
  // The device in this scenario asks for reduced motion for everything, not just animations.
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion: reduce/.test(query) || query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
});

afterEach(() => TL.cleanup());

async function renderApp() {
  const { App } = await import('./App');
  TL.render(<App />);
  const user = await userEvent.setup();
  await TL.waitFor(() => expect(TL.screen.getByRole('heading', { level: 1 })).toBeTruthy());
  return { user };
}

/**
 * The home page headline is drawn word by word by `WordReveal`, so no single text node holds the
 * whole sentence — the page is found by the name its heading announces, not by a text match.
 */
const heading = (name: RegExp | string) => TL.screen.queryByRole('heading', { level: 1, name });

describe('a visitor with reduced motion', () => {
  it('reaches the workspace from the navigation', async () => {
    const { user } = await renderApp();
    expect(heading(/Welcome to ESME CU Chapter/)).toBeTruthy();

    await user.click(TL.screen.getByRole('button', { name: 'Login' }));

    await TL.screen.findByText(/Member & board workspace|First administrator setup/);
    expect(heading(/Welcome to ESME CU Chapter/)).toBeNull();
  });

  it('reaches the application form from the navigation', async () => {
    const { user } = await renderApp();

    await user.click(TL.screen.getByRole('button', { name: /Join ESME/ }));

    await TL.screen.findByText('Join ESME CU Student Chapter');
    expect(heading(/Welcome to ESME CU Chapter/)).toBeNull();
  });

  it('comes back to the public page from the application form', async () => {
    const { user } = await renderApp();
    await user.click(TL.screen.getByRole('button', { name: /Join ESME/ }));
    await TL.screen.findByText('Join ESME CU Student Chapter');

    await user.click(TL.screen.getByRole('button', { name: /Back to Website/ }));

    await TL.screen.findByRole('heading', { level: 1, name: /Welcome to ESME CU Chapter/ });
  });

  it('switches the archived periods when the year tabs are clicked', async () => {
    const { user } = await renderApp();
    const milestone = await TL.screen.findByText('Foundation & First Conference');
    expect(milestone).toBeTruthy();

    await user.click(TL.screen.getByRole('button', { name: /2017:2018/ }));

    await TL.waitFor(() =>
      expect(TL.screen.queryByText('Foundation & First Conference')).toBeNull()
    );
  });
});
