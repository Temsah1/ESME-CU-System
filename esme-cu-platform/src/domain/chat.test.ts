import { describe, expect, it } from 'vitest';
import {
  appendMessage,
  chatErrorSentence,
  checkMessageBody,
  conversationPreview,
  mergeMessagePage,
  normalizeContact,
  normalizeConversation,
  normalizeMessage,
  sortConversations,
  totalUnread,
  type ChatConversation,
  type ChatMessage,
} from './chat';

const conversationRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  kind: 'committee',
  title: 'Technical & Engineering',
  committee_id: 'comm_te',
  created_at: '2026-10-01T09:00:00.000Z',
  last_message_at: '2026-10-02T09:00:00.000Z',
  last_message_body: 'Hello team',
  last_message_sender_id: 'u2',
  last_message_sender: 'Nada Yehia',
  unread_count: 2,
  member_count: 7,
  ...over,
});

const messageRow = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  body: 'Hello team',
  created_at: '2026-10-02T09:00:00.000Z',
  sender_id: 'u2',
  sender_name: 'Nada Yehia',
  sender_role: 'member',
  sender_avatar: null,
  ...over,
});

const conversation = (over: Partial<ChatConversation> = {}): ChatConversation => ({
  id: 'c1',
  kind: 'committee',
  title: 'Technical & Engineering',
  committeeId: 'comm_te',
  createdAt: '2026-10-01T09:00:00.000Z',
  lastMessageAt: '2026-10-02T09:00:00.000Z',
  lastMessageBody: 'Hello team',
  lastMessageSenderId: 'u2',
  lastMessageSender: 'Nada Yehia',
  unreadCount: 2,
  memberCount: 7,
  ...over,
});

const message = (id: string, at: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  body: `Body ${id}`,
  createdAt: at,
  senderId: 'u1',
  senderName: 'Kareem Tamer',
  senderRole: 'super_admin',
  senderAvatar: null,
  ...over,
});

describe('conversation normalization', () => {
  it('keeps a well-formed row and trims its text', () => {
    expect(normalizeConversation(conversationRow({ title: '  T&E  ' }))).toMatchObject({
      id: 'c1',
      kind: 'committee',
      title: 'T&E',
      unreadCount: 2,
      memberCount: 7,
      committeeId: 'comm_te',
    });
  });

  it('drops a row whose unread figure is missing rather than calling it zero', () => {
    expect(normalizeConversation(conversationRow({ unread_count: null }))).toBeNull();
    expect(normalizeConversation(conversationRow({ unread_count: 'not a number' }))).toBeNull();
  });

  it('refuses an unknown kind and a row with no title', () => {
    expect(normalizeConversation(conversationRow({ kind: 'broadcast' }))).toBeNull();
    expect(normalizeConversation(conversationRow({ title: '   ' }))).toBeNull();
    expect(normalizeConversation(null)).toBeNull();
  });

  it('reads a direct thread with no committee', () => {
    const direct = normalizeConversation(
      conversationRow({ kind: 'direct', committee_id: null, title: 'Nada Yehia', unread_count: 0 })
    );
    expect(direct).toMatchObject({ kind: 'direct', committeeId: null, title: 'Nada Yehia', unreadCount: 0 });
  });
});

describe('message normalization', () => {
  it('keeps the sender and role the server returned', () => {
    expect(normalizeMessage(messageRow())).toMatchObject({
      id: 'm1',
      senderId: 'u2',
      senderName: 'Nada Yehia',
      senderRole: 'member',
    });
  });

  it('drops a row with no body, no timestamp or no sender name', () => {
    expect(normalizeMessage(messageRow({ body: '   ' }))).toBeNull();
    expect(normalizeMessage(messageRow({ created_at: 'not a date' }))).toBeNull();
    expect(normalizeMessage(messageRow({ sender_name: '' }))).toBeNull();
  });

  it('does not guess a role the server did not return', () => {
    expect(normalizeMessage(messageRow({ sender_role: 'wizard' }))?.senderRole).toBeNull();
  });
});

describe('contact normalization', () => {
  it('accepts the RPC column names and leaves role null when it is unknown', () => {
    expect(
      normalizeContact({ profile_id: 'u2', display_name: 'Nada Yehia', role: 'head', committee_name: 'T&E' })
    ).toMatchObject({ id: 'u2', name: 'Nada Yehia', role: 'head', committeeName: 'T&E' });
    expect(normalizeContact({ profile_id: 'u3', display_name: 'Ali', role: 'guest' })?.role).toBeNull();
  });

  it('drops a contact that cannot be named', () => {
    expect(normalizeContact({ profile_id: 'u3' })).toBeNull();
  });
});

describe('the composer rule', () => {
  it('trims the edges and preserves the author’s line breaks', () => {
    expect(checkMessageBody('  first line\nsecond  ')).toEqual({ ok: true, body: 'first line\nsecond' });
  });

  it('refuses an empty or whitespace-only send', () => {
    expect(checkMessageBody('   \n  ')).toEqual({ ok: false, reason: 'A message cannot be empty.' });
  });

  it('refuses more than 4000 characters after trimming', () => {
    const check = checkMessageBody(` ${'x'.repeat(4001)} `);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('4,000');
    expect(checkMessageBody('x'.repeat(4000)).ok).toBe(true);
  });
});

describe('paging a thread', () => {
  it('turns a newest-first page into an ascending thread', () => {
    const page = [message('m3', '2026-10-02T10:00:00.000Z'), message('m2', '2026-10-02T09:00:00.000Z')];
    const merged = mergeMessagePage([], page, 30);
    expect(merged.messages.map((row) => row.id)).toEqual(['m2', 'm3']);
    expect(merged.hasMore).toBe(false);
  });

  it('reports more to load only when the server filled the page', () => {
    const page = [message('m1', '2026-10-02T09:00:00.000Z'), message('m2', '2026-10-02T10:00:00.000Z')];
    expect(mergeMessagePage([], page, 2).hasMore).toBe(true);
  });

  it('deduplicates a message that arrived during a second request', () => {
    const existing = [message('m1', '2026-10-02T09:00:00.000Z'), message('m2', '2026-10-02T10:00:00.000Z')];
    const page = [message('m2', '2026-10-02T10:00:00.000Z'), message('m0', '2026-10-02T08:00:00.000Z')];
    const merged = mergeMessagePage(existing, page, 30);
    expect(merged.messages.map((row) => row.id)).toEqual(['m0', 'm1', 'm2']);
  });

  it('appends a sent message once', () => {
    const existing = [message('m1', '2026-10-02T09:00:00.000Z')];
    const sent = message('m2', '2026-10-02T10:00:00.000Z');
    expect(appendMessage(existing, sent).map((row) => row.id)).toEqual(['m1', 'm2']);
    expect(appendMessage(appendMessage(existing, sent), sent)).toHaveLength(2);
  });
});

describe('the list summary', () => {
  it('orders by the most recent message, falling back to the creation date', () => {
    const rows = [
      conversation({ id: 'old', lastMessageAt: '2026-10-01T09:00:00.000Z' }),
      conversation({ id: 'new', lastMessageAt: '2026-10-03T09:00:00.000Z' }),
      conversation({ id: 'silent', lastMessageAt: null, createdAt: '2026-10-02T09:00:00.000Z' }),
    ];
    expect(sortConversations(rows).map((row) => row.id)).toEqual(['new', 'silent', 'old']);
  });

  it('names the author of the last message and marks the actor’s own', () => {
    expect(conversationPreview(conversation(), 'u1')).toBe('Hello team');
    expect(conversationPreview(conversation({ lastMessageSenderId: 'u1' }), 'u1')).toBe('You: Hello team');
    expect(conversationPreview(conversation({ lastMessageBody: null }), 'u1')).toBe('No messages yet');
  });

  it('adds every unread count', () => {
    expect(totalUnread([conversation({ unreadCount: 2 }), conversation({ id: 'c2', unreadCount: 0 })])).toBe(2);
  });
});

describe('error sentences', () => {
  it('names the missing migration instead of showing a raw PostgREST code', () => {
    expect(chatErrorSentence('PGRST202: schema_missing')).toContain('0018_chat.sql');
    expect(chatErrorSentence('relation "esme_chat_messages" 42P01')).toContain('0018_chat.sql');
  });

  it('explains a refusal without pretending anything was written', () => {
    expect(chatErrorSentence('ESME_OUTSIDE_COMMITTEE: outside')).toContain('nothing was written');
    expect(chatErrorSentence('ESME_FORBIDDEN: nope')).toContain('refused the request');
    expect(chatErrorSentence('ESME_BAD_MESSAGE: empty')).toContain('4,000');
  });

  it('keeps an unknown message rather than replacing it with a generic sentence', () => {
    expect(chatErrorSentence('some provider detail')).toBe('some provider detail');
  });
});
