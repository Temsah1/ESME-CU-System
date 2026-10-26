import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Hash,
  LoaderCircle,
  MessageSquare,
  Plus,
  Search,
  Send,
  TriangleAlert,
  Users,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { EmptyState } from '../EmptyState';
import { ROLE_LABELS } from '../../domain/roles';
import {
  checkMessageBody,
  conversationPreview,
  mergeMessagePage,
  sortConversations,
  totalUnread,
  type ChatContact,
  type ChatConversation,
  type ChatMessage,
} from '../../domain/chat';
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
  type ChatLoad,
  type ChatSource,
} from '../../chat/chatClient';

/**
 * Internal chat, stored in the chapter database.
 *
 * Committee channels are opened only for committees the account's `tasks.read` reaches; a direct
 * thread is opened only with a profile the directory already exposes. The browser holds no copy of
 * a message: with no project configured the screen says so instead of pretending a local list is a
 * conversation. Realtime only triggers a re-read, so the SELECT policy decides every row shown.
 */

const formatWhen = (value: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const roleLabel = (contact: ChatContact): string => (contact.role ? ROLE_LABELS[contact.role] : 'Member');

const Alert: React.FC<{ tone: 'amber' | 'rose'; title: string; children: React.ReactNode }> = ({
  tone,
  title,
  children,
}) => (
  <div
    role="alert"
    className={`rounded-2xl border p-4 flex items-start gap-3 ${
      tone === 'amber'
        ? 'border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10'
        : 'border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10'
    }`}
  >
    <TriangleAlert
      className={`w-4 h-4 shrink-0 mt-0.5 ${tone === 'amber' ? 'text-amber-600' : 'text-rose-600'}`}
      aria-hidden
    />
    <div className="text-xs space-y-1 min-w-0">
      <p className={`font-bold ${tone === 'amber' ? 'text-amber-900 dark:text-amber-200' : 'text-rose-900 dark:text-rose-200'}`}>
        {title}
      </p>
      <div className={tone === 'amber' ? 'text-amber-800 dark:text-amber-300' : 'text-rose-800 dark:text-rose-300'}>
        {children}
      </div>
    </div>
  </div>
);

const ConversationButton: React.FC<{
  conversation: ChatConversation;
  selected: boolean;
  actorId: string | undefined;
  onSelect: (id: string) => void;
}> = ({ conversation, selected, actorId, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(conversation.id)}
    aria-current={selected ? 'true' : undefined}
    className={`w-full text-left px-3 py-3 rounded-xl border transition ${
      selected
        ? 'border-[#123B60] bg-[#123B60] text-white shadow-sm'
        : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
    }`}
  >
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex w-7 h-7 rounded-lg items-center justify-center shrink-0 ${
          selected ? 'bg-white/15 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
        }`}
      >
        {conversation.kind === 'committee' ? (
          <Hash className="w-3.5 h-3.5" aria-hidden />
        ) : (
          <MessageSquare className="w-3.5 h-3.5" aria-hidden />
        )}
      </span>
      <span className="text-xs font-bold truncate flex-1">{conversation.title}</span>
      {conversation.unreadCount > 0 && (
        <span
          aria-label={`${conversation.unreadCount} unread`}
          className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#F59A16] text-white"
        >
          {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
        </span>
      )}
    </div>
    <div className={`mt-1.5 flex items-baseline gap-2 ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
      <span className="text-[11px] truncate flex-1">{conversationPreview(conversation, actorId)}</span>
      <span className="text-[10px] shrink-0">{formatWhen(conversation.lastMessageAt)}</span>
    </div>
  </button>
);

const MessageBubble: React.FC<{ message: ChatMessage; mine: boolean }> = ({ message, mine }) => (
  <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-[85%] sm:max-w-[70%] ${mine ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
      {!mine && (
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 px-1">
          {message.senderName}
          {message.senderRole ? ` · ${ROLE_LABELS[message.senderRole]}` : ''}
        </span>
      )}
      <div
        className={`rounded-2xl px-3.5 py-2 text-xs whitespace-pre-wrap break-words ${
          mine
            ? 'bg-[#123B60] text-white rounded-br-md'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-md'
        }`}
      >
        {message.body}
      </div>
      <time
        dateTime={message.createdAt}
        className="text-[10px] text-slate-400 px-1"
        title={new Date(message.createdAt).toLocaleString()}
      >
        {formatWhen(message.createdAt)}
      </time>
    </div>
  </div>
);

export const MessagesView: React.FC = () => {
  const { currentUser } = useApp();
  const [source, setSource] = useState<ChatSource | null>(null);
  const [load, setLoad] = useState<ChatLoad | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [threadBusy, setThreadBusy] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ChatContact[] | null>(null);
  const [contactsBusy, setContactsBusy] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [startingWith, setStartingWith] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const nextSource = await chatSourceFromEnv();
      if (!alive) return;
      setSource(nextSource);
      const next = await openChat(nextSource);
      if (!alive) return;
      setLoad(next);
      if (next.state === 'ready' && next.conversations.length > 0) {
        setSelectedId(sortConversations(next.conversations)[0].id);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refreshConversations = useCallback(
    async (nextSource: ChatSource | null) => {
      if (!nextSource) return;
      const next = await readConversations(nextSource);
      setLoad(next);
      if (next.state === 'ready' && selectedRef.current === null && next.conversations.length > 0) {
        setSelectedId(sortConversations(next.conversations)[0].id);
      }
    },
    []
  );

  // Opening a thread reads one page, marks it read, then re-reads the list so the badge matches.
  useEffect(() => {
    if (!source || source.status !== 'ready' || !selectedId) return;
    let alive = true;
    setThreadBusy(true);
    setMessages([]);
    setHasMore(false);
    setError(null);
    void (async () => {
      const page = await loadMessagePage(source, selectedId, null, CHAT_PAGE_SIZE);
      if (!alive) return;
      if (page.ok) {
        // The RPC answers newest-first; the thread on screen runs oldest-first.
        const merged = mergeMessagePage([], page.messages, CHAT_PAGE_SIZE);
        setMessages(merged.messages);
        setHasMore(merged.hasMore);
      } else {
        setError(page.message);
      }
      await markConversationRead(source, selectedId);
      if (!alive) return;
      await refreshConversations(source);
      if (alive) setThreadBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [refreshConversations, selectedId, source]);

  // Realtime is a signal to re-read. The new row is not trusted until the RPC returns it.
  useEffect(() => {
    if (!source || source.status !== 'ready') return;
    return subscribeToChat(source, () => {
      void (async () => {
        const id = selectedRef.current;
        if (id) {
          const page = await loadMessagePage(source, id, null, CHAT_PAGE_SIZE);
          if (page.ok) {
            setMessages((current) => mergeMessagePage(current, page.messages, CHAT_PAGE_SIZE).messages);
            await markConversationRead(source, id);
          }
        }
        // The list is re-read last so a new row — in this thread or another — updates its preview.
        await refreshConversations(source);
      })();
    });
  }, [refreshConversations, source]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  const conversations = useMemo(
    () => (load?.state === 'ready' ? sortConversations(load.conversations) : []),
    [load]
  );
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle));
  }, [conversations, query]);
  const unread = totalUnread(conversations);

  const choose = (id: string) => {
    setSelectedId(id);
    setContacts(null);
    setContactsError(null);
  };

  const loadEarlier = async () => {
    if (!source || !selectedId || messages.length === 0) return;
    setLoadingEarlier(true);
    const page = await loadMessagePage(source, selectedId, messages[0].createdAt, CHAT_PAGE_SIZE);
    setLoadingEarlier(false);
    if (!page.ok) {
      setError(page.message);
      return;
    }
    const merged = mergeMessagePage(messages, page.messages, CHAT_PAGE_SIZE);
    setMessages(merged.messages);
    setHasMore(merged.hasMore);
  };

  const submit = async () => {
    if (!source || !selectedId || sending) return;
    const checked = checkMessageBody(draft);
    if (!checked.ok) {
      setError(checked.reason);
      return;
    }
    setSending(true);
    setError(null);
    const result = await sendChatMessage(source, selectedId, checked.body);
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDraft('');
    setMessages((current) => mergeMessagePage(current, [result.message], CHAT_PAGE_SIZE).messages);
    await refreshConversations(source);
  };

  const openContacts = async () => {
    if (!source) return;
    setContacts([]);
    setContactsBusy(true);
    setContactsError(null);
    const result = await loadContacts(source);
    setContactsBusy(false);
    if (!result.ok) {
      setContactsError(result.message);
      return;
    }
    setContacts(result.contacts);
  };

  const startDirect = async (contact: ChatContact) => {
    if (!source || startingWith) return;
    setStartingWith(contact.id);
    const result = await startDirectConversation(source, contact.id);
    if (!result.ok) {
      setStartingWith(null);
      setContactsError(result.message);
      return;
    }
    await refreshConversations(source);
    setStartingWith(null);
    choose(result.conversationId);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white">Messages</h1>
          <p className="text-xs text-slate-500">
            Internal chat stored in the chapter database. Committee channels and direct threads only.
          </p>
        </div>
        {unread > 0 && (
          <span className="text-[11px] font-bold text-[#F59A16]" aria-label={`${unread} unread messages`}>
            {unread} unread
          </span>
        )}
      </div>

      {load?.state === 'blocked' && (
        <Alert tone="amber" title="Chat is blocked in this build">
          <p>
            No project is configured, so no conversation can be read or written: this build does not
            hold {load.missing.join(', ')}. The page keeps no local copy of a message, because one
            device's list would not be an internal chat.
          </p>
          <p className="font-mono text-[11px] mt-1">VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY</p>
        </Alert>
      )}

      {load?.state === 'error' && (
        <Alert tone="rose" title="The conversation list could not be read">
          <p>{load.message}</p>
        </Alert>
      )}

      {error && (
        <Alert tone="rose" title="The last action did not complete">
          <p>{error}</p>
          <button type="button" onClick={() => setError(null)} className="mt-1 font-bold underline">
            Dismiss
          </button>
        </Alert>
      )}

      {load?.state === 'ready' && (
        <div className="grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-4 min-h-[30rem]">
          <section
            aria-label="Conversations"
            className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden flex-col min-h-[30rem] max-h-[70vh] ${
              selected ? 'hidden lg:flex' : 'flex'
            }`}
          >
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 space-y-2 shrink-0">
              <div className="flex items-center gap-2">
                <label className="relative flex-1">
                  <span className="sr-only">Search conversations</span>
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search conversations"
                    className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={openContacts}
                  className="p-2 rounded-lg bg-[#123B60] text-white hover:bg-[#0A2239]"
                  aria-label="New direct message"
                  title="New direct message"
                >
                  <Plus className="w-4 h-4" aria-hidden />
                </button>
              </div>

              {contacts !== null && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-2 max-h-56 overflow-y-auto">
                  <div className="flex items-center justify-between px-1 pb-1.5">
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200">People you can message</span>
                    <button
                      type="button"
                      onClick={() => setContacts(null)}
                      className="text-[10px] font-bold text-slate-500 hover:underline"
                      aria-label="Close contact list"
                    >
                      Close
                    </button>
                  </div>
                  {contactsBusy && (
                    <p className="text-[11px] text-slate-500 px-1 py-2 inline-flex items-center gap-1.5">
                      <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden /> Reading the directory…
                    </p>
                  )}
                  {contactsError && <p className="text-[11px] text-rose-600 px-1 py-2">{contactsError}</p>}
                  {!contactsBusy && !contactsError && contacts.length === 0 && (
                    <p className="text-[11px] text-slate-500 px-1 py-2">
                      No reachable contact. A member can message their own committee; leadership reaches
                      the committees it oversees.
                    </p>
                  )}
                  {!contactsBusy &&
                    contacts.map((contact) => (
                      <button
                        key={contact.id}
                        type="button"
                        onClick={() => void startDirect(contact)}
                        disabled={startingWith !== null}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100">
                          {contact.name}
                        </span>
                        <span className="block text-[10px] text-slate-500">
                          {roleLabel(contact)}
                          {contact.committeeName ? ` · ${contact.committeeName}` : ''}
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {filtered.length === 0 && (
                <p className="text-xs text-slate-500 p-3">
                  {conversations.length === 0
                    ? 'No conversation yet. A committee channel appears when your account belongs to a committee; a direct thread starts from the + button.'
                    : 'No conversation matches that search.'}
                </p>
              )}
              {filtered.map((conversation) => (
                <ConversationButton
                  key={conversation.id}
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  actorId={currentUser?.id}
                  onSelect={choose}
                />
              ))}
            </div>
          </section>

          <section
            aria-label={selected ? `Conversation ${selected.title}` : 'Conversation'}
            className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex-col min-h-[30rem] max-h-[70vh] overflow-hidden ${
              selected ? 'flex' : 'hidden lg:flex'
            }`}
          >
            {!selected ? (
              <div className="flex-1 flex items-center justify-center p-6">
                <EmptyState
                  title="Choose a conversation"
                  description="Committee channels and direct threads are listed on the left. Nothing is shared until a message is sent through the server."
                />
              </div>
            ) : (
              <>
                <div className="px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft className="w-4 h-4" aria-hidden />
                  </button>
                  <span className="inline-flex w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 items-center justify-center shrink-0">
                    {selected.kind === 'committee' ? (
                      <Hash className="w-4 h-4" aria-hidden />
                    ) : (
                      <MessageSquare className="w-4 h-4" aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{selected.title}</p>
                    <p className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                      <Users className="w-3 h-3" aria-hidden />
                      {selected.kind === 'committee' ? `Committee channel · ${selected.memberCount} members` : 'Direct message'}
                    </p>
                  </div>
                </div>

                <div role="log" aria-label="Messages" className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-3">
                  {hasMore && (
                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => void loadEarlier()}
                        disabled={loadingEarlier}
                        className="text-[11px] font-bold text-[#123B60] dark:text-[#F59A16] hover:underline disabled:opacity-50"
                      >
                        {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
                      </button>
                    </div>
                  )}
                  {threadBusy && messages.length === 0 && (
                    <p className="text-xs text-slate-500 text-center inline-flex w-full justify-center items-center gap-1.5">
                      <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden /> Reading the thread…
                    </p>
                  )}
                  {!threadBusy && messages.length === 0 && (
                    <p className="text-xs text-slate-500 text-center">No messages yet. Say hello.</p>
                  )}
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} mine={message.senderId === currentUser?.id} />
                  ))}
                  <div ref={threadEndRef} />
                </div>

                <form
                  className="border-t border-slate-100 dark:border-slate-800 p-3 space-y-1 shrink-0"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                  }}
                >
                  <label className="sr-only" htmlFor="chat-composer">
                    Message {selected.title}
                  </label>
                  <div className="flex items-end gap-2">
                    <textarea
                      id="chat-composer"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          void submit();
                        }
                      }}
                      rows={2}
                      maxLength={4000}
                      placeholder="Write a message…"
                      className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={sending || draft.trim().length === 0}
                      className="px-3 py-2.5 rounded-xl bg-[#123B60] text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {sending ? (
                        <LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Send className="w-3.5 h-3.5" aria-hidden />
                      )}
                      Send
                    </button>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Enter sends · Shift+Enter adds a line</span>
                    <span>{draft.length}/4000</span>
                  </div>
                </form>
              </>
            )}
          </section>
        </div>
      )}

      {load === null && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-xs text-slate-500 inline-flex items-center gap-2">
          <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden />
          Reading the conversations your account belongs to…
        </div>
      )}
    </div>
  );
};

export default MessagesView;
