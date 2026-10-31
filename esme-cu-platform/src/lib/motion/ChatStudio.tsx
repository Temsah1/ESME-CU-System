import React, { useLayoutEffect, useRef } from 'react';
import { runStudio, type StudioLine } from './typing';

/**
 * The hero's chat studio — an applicant asks, the chapter replies, and the answers type themselves.
 *
 * Two independent threads share one engine and one clock, so the replies are not scripted to wait for
 * the questions. Every line renders a ghost copy of its finished text in the same grid cell, which is
 * what keeps the panel the same height from the first frame to the last: nothing below it ever moves.
 */

export type StudioMessage = { from: 'applicant' | 'chapter'; text: string };

const row = (message: StudioMessage) => (
  <div key={message.text} className={`flex ${message.from === 'chapter' ? 'justify-end' : 'justify-start'}`}>
    <div
      className={`chat-msg chat-line max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
        message.from === 'chapter'
          ? 'bg-[#F59A16]/15 border border-[#F59A16]/40 text-white'
          : 'bg-white/8 border border-white/15 text-slate-100'
      }`}
      aria-label={message.text}
    >
      <span className="block text-[10px] uppercase tracking-widest font-bold text-[#F59A16]/90 mb-1">
        {message.from === 'chapter' ? 'ESME CU' : 'Applicant'}
      </span>
      <span className="ai-t">
        {/* The ghost holds the space; the live span is what gets typed into it. It starts holding the
            finished text so a visitor whose script never ran still reads the conversation. */}
        <span className="ghost" aria-hidden="true">
          {message.text}
        </span>
        <span className="live" aria-hidden="true">
          {message.text}
        </span>
      </span>
      <span className="dots mt-1 text-[#F59A16]" aria-hidden="true" hidden>
        <i />
        <i />
        <i />
      </span>
    </div>
  </div>
);

export const ChatStudio: React.FC<{ messages: StudioMessage[]; heading?: string }> = ({
  messages,
  heading = 'Ask the chapter',
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const bubbles = Array.from(host.querySelectorAll<HTMLElement>('.chat-msg'));
    const lines: Record<'applicant' | 'chapter', StudioLine[]> = { applicant: [], chapter: [] };
    messages.forEach((message, index) => {
      const el = bubbles[index];
      const target = el?.querySelector<HTMLElement>('.live');
      if (!el || !target) return;
      target.textContent = '';
      lines[message.from].push({ el, target, text: message.text, dots: el.querySelector<HTMLElement>('.dots') });
    });
    // Both threads start from the same clock, so the replies are answering a question that is still
    // being typed — which is exactly how the exchange reads.
    const cancel = runStudio([lines.applicant, lines.chapter]);
    return cancel;
  }, [messages]);

  return (
    <div
      ref={hostRef}
      className="glass-card rounded-2xl border border-white/15 bg-white/8 p-4 shadow-2xl backdrop-blur-xl"
      data-par="10"
    >
      <div className="flex items-center gap-2 mb-3 pb-3 border-b border-white/10">
        <span className="w-2 h-2 rounded-full bg-[#F59A16]" aria-hidden="true" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-200">{heading}</span>
      </div>
      <div className="space-y-2.5">{messages.map(row)}</div>
    </div>
  );
};
