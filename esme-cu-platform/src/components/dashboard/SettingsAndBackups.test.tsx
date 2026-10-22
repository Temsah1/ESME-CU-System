// @vitest-environment jsdom
/**
 * The settings screen's danger zone. Two things are proved here: the write is confirmed inside the
 * page rather than by `window.confirm`, and the store refuses it for an account that lacks the
 * capability even when something calls it directly — a hidden button is not an authorization.
 */
import React, { useState } from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../../auth/types';
import type { Committee, User } from '../../types';

const PASSWORD = 'Str0ng#Settngs1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const APPLICANT = { fullName: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };

const account = (id: string, name: string, over: Partial<User> = {}): User => ({
  id,
  name,
  email: `${id}@esme.test`,
  username: id,
  role: 'member',
  status: 'active',
  committeeId: 'comm_te',
  totalPoints: 0,
  approvedTasksCount: 0,
  joinedDate: '2026-01-01',
  lastActive: 'Just now',
  ...over,
});

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: AuthAdapter;
let confirmSpy: ReturnType<typeof vi.spyOn>;

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
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([account('usr_nada', 'Nada Yehia')]));

  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => {
  TL.cleanup();
  confirmSpy.mockRestore();
});

/** A committee row this browser cached that the reference set does not hold. */
async function cacheCustomCommittee() {
  const { REFERENCE_COMMITTEES } = await import('../../data/referenceContent');
  const custom = { ...REFERENCE_COMMITTEES[0], id: 'comm_custom', name: 'Standards Review Group' } as Committee;
  localStorage.setItem(`${V2}committees`, JSON.stringify([...REFERENCE_COMMITTEES, custom]));
}

const cachedCommitteeIds = () =>
  (JSON.parse(localStorage.getItem(`${V2}committees`) ?? '[]') as Committee[]).map((c) => c.id);

async function renderSettings() {
  const [{ AppProvider }, auth, { SettingsAndBackups }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./SettingsAndBackups'),
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
              <SettingsAndBackups />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  return { user };
}

describe('the danger zone for an account that holds the backup capability', () => {
  it('confirms in the page, and a refusal writes nothing', async () => {
    await cacheCustomCommittee();
    const { user } = await renderSettings();

    await user.click(await TL.screen.findByRole('button', { name: 'Clear Local Cache' }));
    expect(confirmSpy).not.toHaveBeenCalled();

    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Clear this browser');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Keep the cache' }));
    expect(cachedCommitteeIds()).toContain('comm_custom');
  });

  it('replaces the cached edits with the reference set once the confirmation is accepted', async () => {
    await cacheCustomCommittee();
    const { user } = await renderSettings();

    await user.click(await TL.screen.findByRole('button', { name: 'Clear Local Cache' }));
    const dialog = await TL.screen.findByRole('dialog');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Clear Local Cache' }));

    await TL.waitFor(() => expect(cachedCommitteeIds()).not.toContain('comm_custom'));
    expect(TL.screen.getByText('Local cache cleared. Reference content reloaded.')).toBeTruthy();
  });
});

describe('the danger zone for an account without the backup capability', () => {
  it('shows no reset control, and the store refuses the call anyway', async () => {
    const registered = await adapter.register({
      ...APPLICANT,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptedPolicies: true,
    });
    if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
    const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
    if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);
    await adapter.signOut();
    await adapter.signIn(APPLICANT.email, PASSWORD);

    const { AppProvider, useApp } = await import('../../context/AppContext');
    const auth = await import('../../auth/AuthProvider');
    const { SettingsAndBackups } = await import('./SettingsAndBackups');
    const motion = await import('../../motion');
    const { MotionConfig } = await import('motion/react');

    /** Calls the store the way a hand-made request would, with the screen's controls nowhere in sight. */
    const DirectCall: React.FC = () => {
      const { resetLocalCache } = useApp();
      const [outcome, setOutcome] = useState('not called');
      return (
        <>
          <button onClick={() => { try { resetLocalCache(); setOutcome('the cache was cleared'); } catch (e) { setOutcome(e instanceof Error ? e.message : 'refused'); } }}>
            Call reset from the store
          </button>
          <p data-testid="outcome">{outcome}</p>
        </>
      );
    };

    const Gate: React.FC<{ children: React.ReactNode }> = ({ children }) =>
      auth.useAuth().status === 'signed_in' ? <>{children}</> : null;

    TL.render(
      <MotionConfig reducedMotion="never">
        <auth.AuthProvider>
          <motion.ToastProvider>
            <AppProvider>
              <Gate>
                <SettingsAndBackups />
                <DirectCall />
              </Gate>
            </AppProvider>
          </motion.ToastProvider>
        </auth.AuthProvider>
      </MotionConfig>
    );
    const user = await userEvent.setup();

    await TL.waitFor(() => expect(TL.screen.getByTestId('outcome').textContent).toBe('not called'));
    expect(TL.screen.queryByRole('button', { name: 'Clear Local Cache' })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: 'Download State JSON' })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: 'Restore Snapshot' })).toBeNull();

    await cacheCustomCommittee();
    await user.click(TL.screen.getByRole('button', { name: 'Call reset from the store' }));
    await TL.waitFor(() =>
      expect((TL.screen.getByTestId('outcome') as HTMLElement).textContent).toContain('backups.manage')
    );
    expect(cachedCommitteeIds()).toContain('comm_custom');
  });
});
