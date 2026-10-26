/**
 * The browser side of internal chat.
 *
 * The client holds the project URL and the publishable key, and calls only the RPCs in
 * `0018_chat.sql`; it never writes a table directly, because those tables have no write policy.
 * Realtime is a refresh signal, not a source of truth: an INSERT event causes the thread and the
 * conversation list to be re-read through the same authorized path as the first load.
 *
 * With no project configured the source is `blocked` and the screen says so. There is no
 * browser-local copy of a message — a conversation with no server behind it would be a
 * demonstration, not an internal chat.
 */
import { configurationProblems } from '../auth/supabaseAdapter';
import {
  chatErrorSentence,
  checkMessageBody,
  normalizeContact,
  normalizeConversation,
  normalizeMessage,
  type ChatContact,
  type ChatConversation,
  type ChatMessage,
} from '../domain/chat';

type Result = { data: unknown; error: unknown };

/** The small surface this module needs, so a test can answer without a network. */
export interface ChatClient {
  conversations(): Promise<Result>;
  ensureChannels(): Promise<Result>;
  contacts(): Promise<Result>;
  startDirect(profileId: string): Promise<Result>;
  messages(conversationId: string, before: string | null, limit: number): Promise<Result>;
  send(conversationId: string, body: string): Promise<Result>;
  markRead(conversationId: string): Promise<Result>;
  subscribe(onInsert: () => void): () => void;
}

export type ChatSource =
  | { status: 'ready'; client: ChatClient }
  | { status: 'blocked'; missing: string[] }
  | { status: 'error'; message: string };

export const CHAT_PAGE_SIZE = 30;

type ClientEnv = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string };

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const raw = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
  const parts = [raw?.message, raw?.details, raw?.hint].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== ''
  );
  if (parts.length > 0) return parts.join(' — ');
  if (typeof raw?.code === 'string') return raw.code;
  return 'The chat service did not answer.';
}

function rowsOf(data: unknown): unknown[] {
  return Array.isArray(data) ? data : data === null || data === undefined ? [] : [data];
}

/** Builds the real client only when both public variables are present and well formed. */
export async function chatSourceFromEnv(env: ClientEnv = import.meta.env as ClientEnv): Promise<ChatSource> {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  const missing = [!url ? 'VITE_SUPABASE_URL' : null, !key ? 'VITE_SUPABASE_ANON_KEY' : null].filter(
    (entry): entry is string => entry !== null
  );
  if (missing.length > 0 || !url || !key) return { status: 'blocked', missing };

  const problems = configurationProblems(url, key);
  if (problems.length > 0) return { status: 'error', message: problems.join(' ') };

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    const call = async (rpc: PromiseLike<Result>): Promise<Result> => rpc;
    const client: ChatClient = {
      conversations: () => call(supabase.rpc('esme_chat_conversations_for_me')),
      ensureChannels: () => call(supabase.rpc('esme_ensure_committee_channels')),
      contacts: () => call(supabase.rpc('esme_chat_contacts')),
      startDirect: (profileId) => call(supabase.rpc('esme_start_direct_conversation', { p_other: profileId })),
      messages: (conversationId, before, limit) =>
        call(
          supabase.rpc('esme_chat_messages_page', {
            p_conversation: conversationId,
            p_before: before,
            p_limit: limit,
          })
        ),
      send: (conversationId, body) =>
        call(supabase.rpc('esme_send_chat_message', { p_conversation: conversationId, p_body: body })),
      markRead: (conversationId) => call(supabase.rpc('esme_mark_chat_read', { p_conversation: conversationId })),
      subscribe(onInsert) {
        const channel = supabase
          .channel(`esme-chat-${Math.random().toString(36).slice(2, 10)}`)
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'esme_chat_messages' },
            () => onInsert()
          )
          .subscribe();
        return () => {
          void supabase.removeChannel(channel);
        };
      },
    };
    return { status: 'ready', client };
  } catch (error) {
    return { status: 'error', message: messageOf(error) };
  }
}

export type ChatLoad =
  | { state: 'blocked'; missing: string[] }
  | { state: 'error'; message: string }
  | { state: 'ready'; conversations: ChatConversation[]; rejectedRows: number };

/**
 * Opens the screen: ensures the committee channels this account may reach exist, then reads the
 * conversation list. A schema that has not been applied is reported as such, not as zero threads.
 */
export async function openChat(source: ChatSource): Promise<ChatLoad> {
  if (source.status === 'blocked') return { state: 'blocked', missing: source.missing };
  if (source.status === 'error') return { state: 'error', message: source.message };

  const ensured = await source.client.ensureChannels();
  if (ensured.error) return { state: 'error', message: chatErrorSentence(messageOf(ensured.error)) };

  return readConversations(source);
}

export async function readConversations(source: ChatSource): Promise<ChatLoad> {
  if (source.status === 'blocked') return { state: 'blocked', missing: source.missing };
  if (source.status === 'error') return { state: 'error', message: source.message };

  const result = await source.client.conversations();
  if (result.error) return { state: 'error', message: chatErrorSentence(messageOf(result.error)) };

  let rejectedRows = 0;
  const conversations = rowsOf(result.data).flatMap((row) => {
    const conversation = normalizeConversation(row);
    if (conversation) return [conversation];
    rejectedRows++;
    return [];
  });
  return { state: 'ready', conversations, rejectedRows };
}

export type ChatPage =
  | { ok: true; messages: ChatMessage[]; rejectedRows: number }
  | { ok: false; message: string };

export async function loadMessagePage(
  source: ChatSource,
  conversationId: string,
  before: string | null,
  limit: number = CHAT_PAGE_SIZE
): Promise<ChatPage> {
  if (source.status !== 'ready') {
    return { ok: false, message: source.status === 'blocked' ? 'The chat provider is not configured.' : source.message };
  }

  const result = await source.client.messages(conversationId, before, limit);
  if (result.error) return { ok: false, message: chatErrorSentence(messageOf(result.error)) };

  let rejectedRows = 0;
  const messages = rowsOf(result.data).flatMap((row) => {
    const message = normalizeMessage(row);
    if (message) return [message];
    rejectedRows++;
    return [];
  });
  return { ok: true, messages, rejectedRows };
}

export type ChatSend =
  | { ok: true; message: ChatMessage; rejected: boolean }
  | { ok: false; message: string };

export async function sendChatMessage(
  source: ChatSource,
  conversationId: string,
  body: string
): Promise<ChatSend> {
  const checked = checkMessageBody(body);
  if (!checked.ok) return { ok: false, message: checked.reason };
  if (source.status !== 'ready') {
    return { ok: false, message: source.status === 'blocked' ? 'The chat provider is not configured.' : source.message };
  }

  const result = await source.client.send(conversationId, checked.body);
  if (result.error) return { ok: false, message: chatErrorSentence(messageOf(result.error)) };

  const first = rowsOf(result.data)[0];
  const message = normalizeMessage(first);
  if (!message) {
    // The write may have succeeded even when the returned row is unreadable. Saying "sent" would
    // claim a row this screen cannot see; the caller refreshes the thread instead.
    return { ok: false, message: 'The server accepted the message but returned a row this screen cannot read.' };
  }
  return { ok: true, message, rejected: false };
}

export type ContactLoad =
  | { ok: true; contacts: ChatContact[]; rejectedRows: number }
  | { ok: false; message: string };

export async function loadContacts(source: ChatSource): Promise<ContactLoad> {
  if (source.status !== 'ready') {
    return { ok: false, message: source.status === 'blocked' ? 'The chat provider is not configured.' : source.message };
  }
  const result = await source.client.contacts();
  if (result.error) return { ok: false, message: chatErrorSentence(messageOf(result.error)) };

  let rejectedRows = 0;
  const contacts = rowsOf(result.data).flatMap((row) => {
    const contact = normalizeContact(row);
    if (contact) return [contact];
    rejectedRows++;
    return [];
  });
  return { ok: true, contacts, rejectedRows };
}

export type DirectStart =
  | { ok: true; conversationId: string }
  | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function startDirectConversation(source: ChatSource, profileId: string): Promise<DirectStart> {
  if (source.status !== 'ready') {
    return { ok: false, message: source.status === 'blocked' ? 'The chat provider is not configured.' : source.message };
  }
  const result = await source.client.startDirect(profileId);
  if (result.error) return { ok: false, message: chatErrorSentence(messageOf(result.error)) };

  const id = typeof result.data === 'string' ? result.data : null;
  if (!id || !UUID.test(id)) {
    return { ok: false, message: 'The server did not return a conversation id, so the thread cannot be opened.' };
  }
  return { ok: true, conversationId: id };
}

/** Marks a thread read; a refusal changes nothing locally, so the next read re-derives the count. */
export async function markConversationRead(source: ChatSource, conversationId: string): Promise<string | null> {
  if (source.status !== 'ready') return null;
  const result = await source.client.markRead(conversationId);
  return result.error ? chatErrorSentence(messageOf(result.error)) : null;
}

/** Subscribes to message inserts. Returns a cleanup function even when no provider exists. */
export function subscribeToChat(source: ChatSource, onInsert: () => void): () => void {
  if (source.status !== 'ready') return () => {};
  return source.client.subscribe(onInsert);
}
