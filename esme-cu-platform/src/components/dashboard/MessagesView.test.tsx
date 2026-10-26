// @vitest-environment jsdom
/**
 * The chat screen as a signed-in member sees it.
 *
 * The browser client is mocked so each test states what the server would have answered. A blocked
 * build must show no conversation at all; a ready build must show the rows the RPC returned, count
 * unread messages, page backwards without duplicating, and send only through the RPC.
 */
import React from 'react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../../types';

const chat = vi.hoisted(() => ({
  CHAT_PAGE_SIZE: 30,
  chatSourceFromEnv: vi.fn(),
  openChat: vi.fn(),
  readConversations: vi.fn(),
  loadMessagePage: vi.fn(),
  sendChatMessage: vi.fn(),
  loadContacts: vi.fn(),
  startDirectConversation: vi.fn(),
  markConversationRead: vi.fn(),
  subscribeToChat: vi.fn(),
}));

vi.mock('../../chat/chatClient', () => chat);

const PASSWORD = 'Str0ng#Chat1';
const ADMIN = { fullName: 'Kareem Tamer', email: 'kareem.tamer@example.test', username: 'temsah1' };

let TL: typeof import('@testing-library/react');
let userEvent: typeof import('@testing-library/user-event')['default'];
let V2: string;
let adapter: import('../../auth/types').AuthAdapter;

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

// `openChat` and `readConversations` hand the screen normalized domain rows, not raw RPC rows.
const conversation = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'committee',
  title: 'Technical & Engineering',
  committeeId: 'comm_te',
  createdAt: '2026-10-01T09:00:00.000Z',
  lastMessageAt: '2026-10-02T09:00:00.000Z',
  lastMessageBody: 'Hello team',
  lastMessageSenderId: 'usr_nada',
  lastMessageSender: 'Nada Yehia',
  unreadCount: 2,
  memberCount: 6,
  ...over,
});

const message = (id: string, at: string, body: string, senderId = 'usr_nada', senderName = 'Nada Yehia') => ({
  id,
  body,
  createdAt: at,
  senderId,
  senderName,
  senderRole: 'member',
  senderAvatar: null,
});

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
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.scrollIntoView = () => {};

  chat.chatSourceFromEnv.mockReset();
  chat.openChat.mockReset();
  chat.readConversations.mockReset();
  chat.loadMessagePage.mockReset();
  chat.sendChatMessage.mockReset();
  chat.loadContacts.mockReset();
  chat.startDirectConversation.mockReset();
  chat.markConversationRead.mockReset();
  chat.subscribeToChat.mockReset().mockReturnValue(() => {});
  chat.markConversationRead.mockResolvedValue(null);

  localStorage.setItem(`${V2}userProfiles`, JSON.stringify([account('usr_nada', 'Nada Yehia')]));
  const { createLocalDevAdapter } = await import('../../auth/localDevAdapter');
  adapter = createLocalDevAdapter();
  const boot = await adapter.bootstrapPrimaryAdmin({ ...ADMIN, password: PASSWORD, confirmPassword: PASSWORD });
  if (!boot.ok) throw new Error(`bootstrap refused: ${boot.error.code} — ${boot.error.message}`);
  await adapter.signIn(ADMIN.email, PASSWORD);
});

afterEach(() => TL.cleanup());

async function renderMessages() {
  const [{ AppProvider }, auth, { MessagesView }, motion, { MotionConfig }] = await Promise.all([
    import('../../context/AppContext'),
    import('../../auth/AuthProvider'),
    import('./MessagesView'),
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
              <MessagesView />
            </Gate>
          </AppProvider>
        </motion.ToastProvider>
      </auth.AuthProvider>
    </MotionConfig>
  );
  return userEvent.setup();
}

function readySource() {
  chat.chatSourceFromEnv.mockResolvedValue({ status: 'ready', client: {} });
}

describe('with no project configured', () => {
  it('says chat is blocked and renders no conversation or composer', async () => {
    chat.chatSourceFromEnv.mockResolvedValue({
      status: 'blocked',
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });
    chat.openChat.mockResolvedValue({
      state: 'blocked',
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    });

    await renderMessages();

    expect(await TL.screen.findByText('Chat is blocked in this build')).toBeTruthy();
    expect(TL.screen.getByText(/does not\s+hold VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY/)).toBeTruthy();
    expect(TL.screen.queryByRole('log')).toBeNull();
    expect(TL.screen.queryByPlaceholderText('Write a message…')).toBeNull();
  });
});

describe('with a configured project', () => {
  beforeEach(() => {
    readySource();
    chat.openChat.mockResolvedValue({ state: 'ready', conversations: [conversation()], rejectedRows: 0 });
    chat.readConversations.mockResolvedValue({ state: 'ready', conversations: [conversation()], rejectedRows: 0 });
    chat.loadMessagePage.mockResolvedValue({
      ok: true,
      messages: [message('m2', '2026-10-02T09:00:00.000Z', 'Second'), message('m1', '2026-10-02T08:00:00.000Z', 'First')],
      rejectedRows: 0,
    });
    chat.sendChatMessage.mockResolvedValue({
      ok: true,
      rejected: false,
      message: message('m3', '2026-10-02T10:00:00.000Z', 'A new note', 'usr_admin', 'Kareem Tamer'),
    });
  });

  it('shows the unread count, then the thread in ascending order', async () => {
    await renderMessages();

    expect(await TL.screen.findByRole('button', { name: /Technical & Engineering/ })).toBeTruthy();
    expect(TL.screen.getByLabelText('2 unread')).toBeTruthy();
    expect(TL.screen.getByText(/Committee channel · 6 members/)).toBeTruthy();

    const log = await TL.screen.findByRole('log');
    const bodies = TL.within(log)
      .getAllByText(/^(First|Second)$/)
      .map((node) => node.textContent);
    expect(bodies).toEqual(['First', 'Second']);
    expect(chat.markConversationRead).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('sends through the RPC, clears the composer and shows the stored row', async () => {
    const user = await renderMessages();
    const composer = await TL.screen.findByLabelText(/Message Technical & Engineering/);
    await user.type(composer, 'A new note');
    await user.click(TL.screen.getByRole('button', { name: /^Send$/ }));

    expect(chat.sendChatMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'A new note');
    expect(await TL.screen.findByText('A new note')).toBeTruthy();
    expect((composer as HTMLTextAreaElement).value).toBe('');
  });

  it('pages backwards without repeating a message', async () => {
    const newestFirst = Array.from({ length: 30 }, (_, index) =>
      message(
        `m${30 - index}`,
        new Date(Date.UTC(2026, 9, 2, 12, 0, 0) - index * 60_000).toISOString(),
        `Body ${30 - index}`
      )
    );
    chat.loadMessagePage
      .mockResolvedValueOnce({ ok: true, messages: newestFirst, rejectedRows: 0 })
      .mockResolvedValueOnce({
        ok: true,
        messages: [message('m0', '2026-10-02T11:30:00.000Z', 'Oldest body')],
        rejectedRows: 0,
      });

    const user = await renderMessages();
    const earlier = await TL.screen.findByRole('button', { name: 'Load earlier messages' });
    await user.click(earlier);

    expect(await TL.screen.findByText('Oldest body')).toBeTruthy();
    expect(TL.screen.getAllByText('Body 30')).toHaveLength(1);
    expect(TL.screen.queryByRole('button', { name: 'Load earlier messages' })).toBeNull();
    expect(chat.loadMessagePage).toHaveBeenLastCalledWith(
      expect.anything(),
      'c1',
      expect.any(String),
      chat.CHAT_PAGE_SIZE
    );
  });

  it('re-reads the thread when realtime reports a new row', async () => {
    let onInsert: (() => void) | null = null;
    chat.subscribeToChat.mockImplementation((_source: unknown, callback: () => void) => {
      onInsert = callback;
      return () => {};
    });
    chat.loadMessagePage
      .mockResolvedValueOnce({
        ok: true,
        messages: [message('m1', '2026-10-02T08:00:00.000Z', 'First')],
        rejectedRows: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        messages: [message('m9', '2026-10-02T09:30:00.000Z', 'From realtime')],
        rejectedRows: 0,
      });

    await renderMessages();
    await TL.screen.findByText('First');
    expect(onInsert).not.toBeNull();

    await TL.act(async () => {
      onInsert?.();
    });

    expect(await TL.screen.findByText('From realtime')).toBeTruthy();
    expect(chat.readConversations).toHaveBeenCalledTimes(2);
  });
});

describe('a member with no committee peers', () => {
  it('can still open the page and is told why the contact list is empty', async () => {
    readySource();
    chat.openChat.mockResolvedValue({ state: 'ready', conversations: [conversation({ unreadCount: 0 })], rejectedRows: 0 });
    chat.readConversations.mockResolvedValue({
      state: 'ready',
      conversations: [conversation({ unreadCount: 0 })],
      rejectedRows: 0,
    });
    chat.loadMessagePage.mockResolvedValue({ ok: true, messages: [], rejectedRows: 0 });
    chat.loadContacts.mockResolvedValue({ ok: true, contacts: [], rejectedRows: 0 });

    const user = await renderMessages();
    await user.click(await TL.screen.findByRole('button', { name: 'New direct message' }));

    expect(await TL.screen.findByText(/No reachable contact/)).toBeTruthy();
    expect(TL.screen.getByText('People you can message')).toBeTruthy();
  });
});
