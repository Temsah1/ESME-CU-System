/**
 * The rules the chat screen can decide without a server.
 *
 * Everything here is derived from what an RPC returned: a conversation's unread count is the number
 * of messages after `last_read_at`, a message page is merged by id rather than concatenated, and a
 * malformed row is dropped and counted instead of being rendered with a guessed field. The screen
 * keeps the same three-state honesty as the rest of the workspace: ready, blocked, error.
 */
import type { Role } from '../types';

export type ChatConversationKind = 'committee' | 'direct';

export type ChatConversation = {
  id: string;
  kind: ChatConversationKind;
  title: string;
  committeeId: string | null;
  createdAt: string | null;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  lastMessageSenderId: string | null;
  lastMessageSender: string | null;
  unreadCount: number;
  memberCount: number;
};

export type ChatMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderId: string;
  senderName: string;
  senderRole: Role | null;
  senderAvatar: string | null;
};

export type ChatContact = {
  id: string;
  name: string;
  role: Role | null;
  committeeId: string | null;
  committeeName: string | null;
};

type Raw = Record<string, unknown>;

const ROLES = new Set<Role>(['super_admin', 'high_board', 'moderator', 'director', 'head', 'member']);

function record(value: unknown): Raw | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function iso(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function count(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function role(value: unknown): Role | null {
  return typeof value === 'string' && ROLES.has(value as Role) ? (value as Role) : null;
}

/** A row without its id, title or unread figure cannot be described; the caller counts it. */
export function normalizeConversation(value: unknown): ChatConversation | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.id);
  const title = text(raw.title);
  const kind = raw.kind === 'committee' || raw.kind === 'direct' ? raw.kind : null;
  const unreadCount = count(raw.unread_count);
  if (!id || !title || !kind || unreadCount === null) return null;

  return {
    id,
    kind,
    title,
    committeeId: text(raw.committee_id),
    createdAt: iso(raw.created_at),
    lastMessageAt: iso(raw.last_message_at),
    lastMessageBody: text(raw.last_message_body),
    lastMessageSenderId: text(raw.last_message_sender_id),
    lastMessageSender: text(raw.last_message_sender),
    unreadCount,
    memberCount: count(raw.member_count) ?? 0,
  };
}

export function normalizeMessage(value: unknown): ChatMessage | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.id);
  const body = text(raw.body);
  const createdAt = iso(raw.created_at);
  const senderId = text(raw.sender_id);
  const senderName = text(raw.sender_name);
  if (!id || !body || !createdAt || !senderId || !senderName) return null;

  return {
    id,
    body,
    createdAt,
    senderId,
    senderName,
    senderRole: role(raw.sender_role),
    senderAvatar: text(raw.sender_avatar),
  };
}

export function normalizeContact(value: unknown): ChatContact | null {
  const raw = record(value);
  if (!raw) return null;
  const id = text(raw.profile_id) ?? text(raw.id);
  const name = text(raw.display_name) ?? text(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    role: role(raw.role),
    committeeId: text(raw.committee_id),
    committeeName: text(raw.committee_name),
  };
}

export type MessageBodyCheck = { ok: true; body: string } | { ok: false; reason: string };

export const MAX_MESSAGE_LENGTH = 4000;

/** Trims the edges and preserves the author's line breaks. An empty send is refused, not shown. */
export function checkMessageBody(value: string): MessageBodyCheck {
  const body = value.trim();
  if (body.length === 0) return { ok: false, reason: 'A message cannot be empty.' };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: `A message is limited to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.` };
  }
  return { ok: true, body };
}

function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);
  if (at !== bt) return at - bt;
  return a.id.localeCompare(b.id);
}

/**
 * Merges one page returned newest-first into the ascending thread already on screen.
 *
 * The RPC pages by `created_at`; a message inserted between two requests can therefore repeat.
 * Deduplicating by id keeps the thread readable and makes "load earlier" safe to press twice.
 */
export function mergeMessagePage(
  existing: ChatMessage[],
  page: ChatMessage[],
  limit: number
): { messages: ChatMessage[]; hasMore: boolean } {
  const byId = new Map<string, ChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of page) byId.set(message.id, message);
  return {
    messages: [...byId.values()].sort(compareMessages),
    hasMore: page.length >= limit,
  };
}

export function appendMessage(existing: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const row of existing) byId.set(row.id, row);
  byId.set(message.id, message);
  return [...byId.values()].sort(compareMessages);
}

export function sortConversations(conversations: ChatConversation[]): ChatConversation[] {
  return [...conversations].sort((a, b) => {
    const at = a.lastMessageAt ? Date.parse(a.lastMessageAt) : a.createdAt ? Date.parse(a.createdAt) : 0;
    const bt = b.lastMessageAt ? Date.parse(b.lastMessageAt) : b.createdAt ? Date.parse(b.createdAt) : 0;
    return bt - at;
  });
}

export function conversationPreview(conversation: ChatConversation, actorId: string | undefined): string {
  if (!conversation.lastMessageBody) return 'No messages yet';
  const mine = actorId !== undefined && conversation.lastMessageSenderId === actorId;
  return mine ? `You: ${conversation.lastMessageBody}` : conversation.lastMessageBody;
}

export function totalUnread(conversations: ChatConversation[]): number {
  return conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
}

/**
 * A Postgres or gateway message mapped to a sentence an operator can act on. An unknown error is
 * kept as-is rather than replaced by "something went wrong", which would hide the one clue a
 * deployment needs.
 */
export function chatErrorSentence(message: string): string {
  if (message.includes('PGRST202') || message.includes('schema_missing') || message.includes('42P01')) {
    return 'The chat tables are not present in this project yet. Apply supabase/migrations/0018_chat.sql.';
  }
  if (message.includes('ESME_OUTSIDE_COMMITTEE') || message.includes('ESME_FORBIDDEN')) {
    return 'Your role does not reach that conversation. The server refused the request; nothing was written.';
  }
  if (message.includes('ESME_BAD_MESSAGE')) {
    return 'The server refused the message because it is empty or longer than 4,000 characters.';
  }
  if (message.includes('ESME_SELF_TARGET')) return 'Choose another member to message.';
  if (message.includes('ESME_INACTIVE_ACCOUNT')) return 'That account is not active, so it cannot chat.';
  if (message.includes('ESME_NOT_FOUND')) return 'That member is not in the directory.';
  if (message.toLowerCase().includes('failed to fetch') || message.toLowerCase().includes('network')) {
    return 'The chat service could not be reached. Nothing was sent.';
  }
  return message;
}
