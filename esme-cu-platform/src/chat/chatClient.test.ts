import { describe, expect, it, vi } from 'vitest';
import type { ChatClient } from './chatClient';
import {
  CHAT_PAGE_SIZE,
  chatSourceFromEnv,
  loadContacts,
  loadMessagePage,
  markConversationRead,
  openChat,
  readConversations,
  sendChatMessage,
  startDirectConversation,
  subscribeToChat,
} from './chatClient';

const UUID = '11111111-1111-4111-8111-111111111111';

const conversationRow = {
  id: 'c1',
  kind: 'committee',
  title: 'Technical & Engineering',
  committee_id: 'comm_te',
  created_at: '2026-10-01T09:00:00.000Z',
  last_message_at: null,
  last_message_body: null,
  last_message_sender_id: null,
  last_message_sender: null,
  unread_count: 0,
  member_count: 4,
};

const messageRow = {
  id: 'm1',
  body: 'Hello',
  created_at: '2026-10-02T09:00:00.000Z',
  sender_id: 'u2',
  sender_name: 'Nada Yehia',
  sender_role: 'member',
  sender_avatar: null,
};

function fakeClient(overrides: Partial<ChatClient> = {}): ChatClient {
  return {
    conversations: vi.fn().mockResolvedValue({ data: [conversationRow], error: null }),
    ensureChannels: vi.fn().mockResolvedValue({ data: 1, error: null }),
    contacts: vi.fn().mockResolvedValue({ data: [], error: null }),
    startDirect: vi.fn().mockResolvedValue({ data: UUID, error: null }),
    messages: vi.fn().mockResolvedValue({ data: [messageRow], error: null }),
    send: vi.fn().mockResolvedValue({ data: [messageRow], error: null }),
    markRead: vi.fn().mockResolvedValue({ data: null, error: null }),
    subscribe: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe('the configured provider', () => {
  it('is blocked, with both variable names, when the build has no project', async () => {
    const source = await chatSourceFromEnv({});
    expect(source).toEqual({ status: 'blocked', missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] });
  });

  it('refuses a malformed URL and a secret key instead of creating a client', async () => {
    expect(await chatSourceFromEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'pk' })).toMatchObject({
      status: 'error',
    });
    const secret = await chatSourceFromEnv({
      VITE_SUPABASE_URL: 'https://demo.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_secret_Hunter2',
    });
    expect(secret.status).toBe('error');
    if (secret.status === 'error') expect(secret.message).toContain('secret API key');
  });

  it('builds a ready client for a well-formed project URL and publishable key', async () => {
    const source = await chatSourceFromEnv({
      VITE_SUPABASE_URL: 'https://demo.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_demo',
    });
    expect(source.status).toBe('ready');
  });
});

describe('opening the screen', () => {
  it('passes a blocked source straight through and calls nothing', async () => {
    expect(await openChat({ status: 'blocked', missing: ['VITE_SUPABASE_URL'] })).toEqual({
      state: 'blocked',
      missing: ['VITE_SUPABASE_URL'],
    });
  });

  it('ensures the channels before it reads the list, and drops an unreadable row', async () => {
    const order: string[] = [];
    const client = fakeClient({
      ensureChannels: vi.fn(async () => {
        order.push('ensure');
        return { data: 2, error: null };
      }),
      conversations: vi.fn(async () => {
        order.push('conversations');
        return { data: [conversationRow, { id: 'broken' }], error: null };
      }),
    });

    const load = await openChat({ status: 'ready', client });
    expect(order).toEqual(['ensure', 'conversations']);
    expect(load).toMatchObject({ state: 'ready', rejectedRows: 1 });
    if (load.state === 'ready') expect(load.conversations.map((row) => row.id)).toEqual(['c1']);
  });

  it('reports an unapplied schema as a missing migration, not as an empty inbox', async () => {
    const client = fakeClient({
      ensureChannels: vi.fn().mockResolvedValue({ data: null, error: { message: 'schema_missing' } }),
    });
    const load = await openChat({ status: 'ready', client });
    expect(load.state).toBe('error');
    if (load.state === 'error') expect(load.message).toContain('0018_chat.sql');
  });

  it('maps a list read failure to a sentence', async () => {
    const client = fakeClient({
      conversations: vi.fn().mockResolvedValue({ data: null, error: { message: 'ESME_FORBIDDEN: nope' } }),
    });
    const load = await readConversations({ status: 'ready', client });
    expect(load.state).toBe('error');
    if (load.state === 'error') expect(load.message).toContain('refused the request');
  });
});

describe('reading a thread', () => {
  it('normalizes a page and counts a malformed row', async () => {
    const client = fakeClient({
      messages: vi.fn().mockResolvedValue({ data: [messageRow, { id: 'bad' }], error: null }),
    });
    const page = await loadMessagePage({ status: 'ready', client }, 'c1', null);
    expect(page).toMatchObject({ ok: true, rejectedRows: 1 });
    if (page.ok) expect(page.messages[0]).toMatchObject({ id: 'm1', senderName: 'Nada Yehia' });
    expect(client.messages).toHaveBeenCalledWith('c1', null, CHAT_PAGE_SIZE);
  });

  it('sends the oldest held timestamp as the cursor', async () => {
    const client = fakeClient();
    await loadMessagePage({ status: 'ready', client }, 'c1', '2026-10-01T09:00:00.000Z', 10);
    expect(client.messages).toHaveBeenCalledWith('c1', '2026-10-01T09:00:00.000Z', 10);
  });

  it('refuses to call a provider that is not configured', async () => {
    const page = await loadMessagePage({ status: 'blocked', missing: ['VITE_SUPABASE_URL'] }, 'c1', null);
    expect(page.ok).toBe(false);
  });
});

describe('sending', () => {
  it('validates before it calls the server', async () => {
    const client = fakeClient();
    const result = await sendChatMessage({ status: 'ready', client }, 'c1', '   ');
    expect(result.ok).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('returns the normalized row the server wrote', async () => {
    const client = fakeClient();
    const result = await sendChatMessage({ status: 'ready', client }, 'c1', '  Hello  ');
    expect(client.send).toHaveBeenCalledWith('c1', 'Hello');
    expect(result).toMatchObject({ ok: true, message: { id: 'm1', body: 'Hello' } });
  });

  it('keeps the server’s refusal and never claims the write landed', async () => {
    const client = fakeClient({
      send: vi.fn().mockResolvedValue({ data: null, error: { message: 'ESME_OUTSIDE_COMMITTEE: outside' } }),
    });
    const result = await sendChatMessage({ status: 'ready', client }, 'c1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('nothing was written');
  });

  it('does not call an accepted-but-unreadable row a sent message', async () => {
    const client = fakeClient({ send: vi.fn().mockResolvedValue({ data: [{ id: 'x' }], error: null }) });
    const result = await sendChatMessage({ status: 'ready', client }, 'c1', 'Hello');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('cannot read');
  });
});

describe('contacts and direct threads', () => {
  it('normalizes the people the server allows this account to reach', async () => {
    const client = fakeClient({
      contacts: vi.fn().mockResolvedValue({
        data: [{ profile_id: 'u2', display_name: 'Nada Yehia', role: 'head', committee_name: 'T&E' }],
        error: null,
      }),
    });
    const result = await loadContacts({ status: 'ready', client });
    expect(result).toMatchObject({ ok: true, rejectedRows: 0 });
    if (result.ok) expect(result.contacts[0]).toMatchObject({ id: 'u2', name: 'Nada Yehia' });
  });

  it('accepts only a conversation id the server actually returned', async () => {
    const client = fakeClient();
    expect(await startDirectConversation({ status: 'ready', client }, 'u2')).toEqual({
      ok: true,
      conversationId: UUID,
    });

    const bad = fakeClient({ startDirect: vi.fn().mockResolvedValue({ data: 'not-a-uuid', error: null }) });
    expect((await startDirectConversation({ status: 'ready', client: bad }, 'u2')).ok).toBe(false);
  });

  it('maps a refusal to the committee sentence', async () => {
    const client = fakeClient({
      startDirect: vi.fn().mockResolvedValue({ data: null, error: { message: 'ESME_OUTSIDE_COMMITTEE: outside' } }),
    });
    const result = await startDirectConversation({ status: 'ready', client }, 'u9');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('does not reach');
  });
});

describe('read receipts and realtime', () => {
  it('reports a failed read receipt without changing anything locally', async () => {
    const client = fakeClient({
      markRead: vi.fn().mockResolvedValue({ data: null, error: { message: 'ESME_FORBIDDEN: nope' } }),
    });
    expect(await markConversationRead({ status: 'ready', client }, 'c1')).toContain('refused the request');
    expect(await markConversationRead({ status: 'blocked', missing: [] }, 'c1')).toBeNull();
  });

  it('subscribes only when a provider exists and returns its cleanup', () => {
    const cleanup = vi.fn();
    const client = fakeClient({ subscribe: vi.fn().mockReturnValue(cleanup) });
    const off = subscribeToChat({ status: 'ready', client }, () => {});
    expect(client.subscribe).toHaveBeenCalled();
    off();
    expect(cleanup).toHaveBeenCalled();

    const blockedOff = subscribeToChat({ status: 'blocked', missing: [] }, () => {});
    expect(typeof blockedOff).toBe('function');
  });
});
