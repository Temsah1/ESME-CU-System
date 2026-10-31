import React, { useEffect, useRef, useState } from 'react';
import { bookSequence, mountFolio, type FolioItem } from './folio';
import './folio.css';

/**
 * The departments row.
 *
 * Three.js draws the books; this component only decides which of the two pictures the visitor gets
 * and keeps the accessible copy of the list next to it. The hidden list is not a fallback for the
 * fallback: it is how a keyboard or a screen reader reaches a committee, on every device.
 */

type Props = {
  items: FolioItem[];
  /** Follows a book click — the same thing the hidden list's link does. */
  onOpen: (id: string) => void;
  title?: string;
};

export const FolioRow: React.FC<Props> = ({ items, onOpen, title = 'Committees' }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const openRef = useRef(onOpen);
  const [mode, setMode] = useState<'canvas' | 'fallback' | 'pending'>('pending');

  // Kept in step after paint, never during it: a book click reads the latest handler, and the
  // shelf is not rebuilt when the parent passes a fresh closure.
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas || items.length === 0) return;
    let disposed = false;
    let handle: Awaited<ReturnType<typeof mountFolio>>;
    void mountFolio({
      canvas,
      host,
      title: titleRef.current,
      items,
      onOpen: (id) => openRef.current(id),
    }).then((next) => {
      if (disposed) {
        next?.destroy();
        return;
      }
      handle = next;
      setMode(next ? 'canvas' : 'fallback');
    });
    return () => {
      disposed = true;
      handle?.destroy();
    };
  }, [items]);

  const books = bookSequence(items);

  return (
    <div className="folio" ref={hostRef}>
      <span ref={titleRef} className="folio-title" aria-hidden="true">
        {title}
      </span>
      <canvas ref={canvasRef} aria-hidden="true" hidden={mode !== 'canvas'} />
      {mode === 'fallback' && (
        <div className="folio-fallback" aria-hidden="true">
          {books.map((book, index) => (
            <div
              key={`${book.id}-${index}`}
              className="folio-card"
              style={{ '--folio-accent': book.accent } as React.CSSProperties}
            >
              <span>{book.code}</span>
              <strong>{book.name}</strong>
            </div>
          ))}
        </div>
      )}
      <ul className="sr-only">
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#committee-${item.id}`} onClick={(event) => { event.preventDefault(); onOpen(item.id); }}>
              {item.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};
