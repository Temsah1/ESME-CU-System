// @vitest-environment jsdom
/**
 * The Test-accounts card is a surface over two store methods, and both of them are guarded twice:
 * once by whether the control is rendered at all, and once by `guard()` inside the store. The first
 * case proves the seed writes real vault rows and the screen reports them; the second proves that a
 * session without `users.create` gets a refusal rather than a tester, with the control nowhere in
 * sight. The third proves the deletion is confirmed inside the page — `window.confirm` is asserted
 * never to have been called.
 */
import React, { useState } from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthAdapter } from '../../auth/types';
import type { User } from '../../types';

const PASSWORD = 'Str0ng#Fixtur31';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };
const APPLICANT = { fullName: 'Aya Student', email: 'aya.student@esme-cu.edu', username: 'aya.student' };
const TESTERS = ['test.head@esme.test', 'test.director@esme.test', 'test.member@esme.test'];

/** The local-dev vault is only addressed here by its key; the adapter keeps it private. */
const VAULT_KEY = 'ESME_CU_DEV_AUTH_V1';
type VaultRow = { id: string; email: string; username: string; role: string; status: string; provisioned?: string };
const vaultAccounts = (): VaultRow[] => {
  const raw = localStorage.getItem(VAULT_KEY);
  return raw ? (JSON.parse(raw) as { accounts: VaultRow[] }).accounts : [];
};

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
  // The default 1s for a `findBy…` is shorter than one seeded vault write takes when 42 workers
  // compete for 8 cores — see the note above the suites below.
  TL.configure({ asyncUtilTimeout: 12_000 });
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

async function renderTools(directSeed = false) {
  const [{ AppProvider, useApp }, auth, { ModeratorTools }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./ModeratorTools'),
    import('../../motion'),
    import('motion/react'),
  ]);

  /** Calls the store the way a hand-made request would, with the screen's controls nowhere in sight. */
  const DirectSeed: React.FC = () => {
    const { seedTestAccounts } = useApp();
    const [outcome, setOutcome] = useState('not called');
    return (
      <>
        <button
          onClick={() => {
            void seedTestAccounts().then(
              (report) => setOutcome(report.refusal ? `refused: ${report.refusal}` : 'the seed ran'),
              (error) => setOutcome(error instanceof Error ? error.message : 'refused')
            );
          }}
        >
          Call the seed from the store
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
              <ModeratorTools />
              {directSeed ? <DirectSeed /> : null}
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  const user = await userEvent.setup();
  return { user };
}

/**
 * These three suites each perform several PBKDF2 derivations at 210,000 iterations — the same work
 * a real sign-in does — and the full run starts one worker per file, so the wall clock per case is
 * a fraction of what it measures in isolation. The default 5s was exceeded by a case that passes
 * alone; the budget is stated here instead of leaving the timing to chance.
 */
describe('seeding from the screen', { timeout: 25_000 }, () => {
  it('writes the three fixtures to the vault and reports what it created', async () => {
    const { user } = await renderTools();

    // Every fixture starts unseeded; the card says so before anything is pressed.
    const seed = await TL.screen.findByRole('button', { name: 'Seed or reset test accounts' });
    expect(TL.screen.queryAllByText(/not seeded/)).toHaveLength(3);

    await user.click(seed);
    await TL.screen.findByText('3 account(s) affected');

    expect(TL.screen.getByText(/created · test\.head@esme\.test/)).toBeTruthy();
    expect(TL.screen.getByText(/created · test\.director@esme\.test/)).toBeTruthy();
    expect(TL.screen.getByText(/created · test\.member@esme\.test/)).toBeTruthy();
    expect(TL.screen.queryAllByText(/not seeded/)).toHaveLength(0);

    const seeded = vaultAccounts().filter((a) => TESTERS.includes(a.email));
    expect(seeded.map((a) => a.role).sort()).toEqual(['director', 'head', 'member']);
    expect(seeded.every((a) => a.status === 'active' && a.provisioned === 'test-fixture')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('prints the committee name rather than an id this workspace does not hold', async () => {
    const { user } = await renderTools();
    await user.click(await TL.screen.findByRole('button', { name: 'Seed or reset test accounts' }));
    await TL.screen.findByText('3 account(s) affected');

    const { REFERENCE_COMMITTEES } = await import('../../data/referenceContent');
    const te = REFERENCE_COMMITTEES.find((c) => c.id === 'comm_te')?.name;
    expect(TL.screen.getAllByText(/committee: /).some((node) => node.textContent === `committee: ${te}`)).toBe(true);
  });
});

describe('deleting from the screen', { timeout: 25_000 }, () => {
  it('confirms in the page, and backing out removes nothing', async () => {
    const { user } = await renderTools();
    await user.click(await TL.screen.findByRole('button', { name: 'Seed or reset test accounts' }));
    await TL.screen.findByText('3 account(s) affected');

    await user.click(TL.screen.getByRole('button', { name: 'Delete test accounts' }));
    expect(confirmSpy).not.toHaveBeenCalled();

    const dialog = await TL.screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Delete the seeded test accounts?');
    for (const email of TESTERS) expect(dialog.textContent).toContain(email);

    await user.click(TL.within(dialog).getByRole('button', { name: 'Keep them' }));
    await TL.waitFor(() => expect(TL.screen.queryByRole('dialog')).toBeNull());
    expect(vaultAccounts().filter((a) => TESTERS.includes(a.email))).toHaveLength(3);
    expect(TL.screen.queryAllByText(/not seeded/)).toHaveLength(0);
  });

  it('removes exactly the three testers and leaves every other account alone', async () => {
    const registered = await adapter.register({
      ...APPLICANT,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptedPolicies: true,
    });
    if (!registered.ok) throw new Error(`registration refused: ${registered.failure.code} — ${registered.failure.message}`);
    const approved = await adapter.decideRegistration(registered.receipt.reference, 'approve', { committeeId: 'comm_te' });
    if (!approved.ok) throw new Error(`approval refused: ${approved.error.code} — ${approved.error.message}`);

    const { user } = await renderTools();
    await user.click(await TL.screen.findByRole('button', { name: 'Seed or reset test accounts' }));
    await TL.screen.findByText('3 account(s) affected');

    await user.click(TL.screen.getByRole('button', { name: 'Delete test accounts' }));
    const dialog = await TL.screen.findByRole('dialog');
    await user.click(TL.within(dialog).getByRole('button', { name: 'Delete the three testers' }));

    await TL.screen.findByText('3 account(s) affected');
    expect(TL.screen.getAllByText(/deleted · test\./)).toHaveLength(3);
    expect(TL.screen.queryAllByText(/not seeded/)).toHaveLength(3);

    const remaining = vaultAccounts().map((a) => a.email);
    expect(remaining).toContain(ADMIN.email);
    expect(remaining).toContain(APPLICANT.email);
    expect(remaining.filter((email) => TESTERS.includes(email))).toHaveLength(0);
  });
});

describe('a session that cannot open accounts', { timeout: 25_000 }, () => {
  it('shows no seed control, and the store refuses the call anyway', async () => {
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

    const { user } = await renderTools(true);
    await TL.screen.findByText('Test accounts');

    expect(TL.screen.queryByRole('button', { name: 'Seed or reset test accounts' })).toBeNull();
    expect(TL.screen.queryByRole('button', { name: 'Delete test accounts' })).toBeNull();
    // The word itself is in a <code> element, so the matcher reads the sentence around it.
    expect(TL.screen.getByText(/Seeding opens accounts/)).toBeTruthy();

    await user.click(TL.screen.getByRole('button', { name: 'Call the seed from the store' }));
    await TL.waitFor(() =>
      expect((TL.screen.getByTestId('outcome') as HTMLElement).textContent).toContain('users.create')
    );
    expect(vaultAccounts().filter((a) => TESTERS.includes(a.email))).toHaveLength(0);
  });
});
