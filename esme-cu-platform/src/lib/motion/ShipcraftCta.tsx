import React, { useEffect, useRef, useState } from 'react';
import { canAnimate, prefersReduced } from './env';
import { onRevealed } from './reveal';
import { killTweens, LogoDraw, useGsap, type ScrollTween } from './petalyx';
import './shipcraft.css';

/**
 * SHIPCRAFT — the closing band and the footer that belongs to it.
 *
 * The entrance is one CSS sequence: the JavaScript only measures `--u` and moves the section from its
 * hidden start states to `.shipped`, so a page whose scripts never arrive shows the finished footer.
 * Stage order lives in `--s` on each element, which keeps the pill → headline → copy → button → panel →
 * columns rhythm readable in the markup instead of scattered across timeouts.
 */

export type ShipColumn = { heading: string; links: { label: string; href: string }[] };

export type ShipcraftCtaProps = {
  eyebrow: string;
  /** One entry per line — the lines rise one after another. */
  headline: string[];
  copy: string;
  applyLabel: string;
  onApply: () => void;
  loginLabel?: string;
  onLogin?: () => void;
  columns: ShipColumn[];
  blurb: string;
  copyright: string;
  legal?: string;
  footerLinks: { id: string; label: string; href: string }[];
  socials?: { id: string; label: string; href: string }[];
  newsletterLabel?: string;
  wordmark?: string;
};

/** The width the composition was drawn at; `--u` is the measured container divided by it. */
const DESIGN_WIDTH = 787;
const UNITS_BREAKPOINT = 900;

const HAND_PATH = 'M0 74 h44 c0 0 6-30 30-30 h6 c0 0 4-24 24-24 h6 c0 0 2-22 22-22 h10 c0 0 4 0 4 6 v46 c0 0 14-8 22-8 c14 0 16 10 8 18 l-24 24 c-14 14-32 22-52 22 H0 Z';

const Hand: React.FC<{ id: string }> = ({ id }) => (
  <svg viewBox="0 0 260 130" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0.85" y2="1">
        <stop offset="0" stopColor="#efe9e1" />
        <stop offset="0.42" stopColor="#c3b7ab" />
        <stop offset="0.72" stopColor="#8d8075" />
        <stop offset="1" stopColor="#5b5249" />
      </linearGradient>
    </defs>
    <path d={HAND_PATH} fill={`url(#${id})`} />
  </svg>
);

const Arrow = () => (
  <svg className="arrow" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
    <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Check = () => (
  <svg className="check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <path d="M4 13l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * A local-only "you're on the list" acknowledgement.
 *
 * Nothing is sent anywhere: the arrow swapping to a drawn check for 1.5s is the whole behaviour, and
 * wiring it to a real endpoint would take it outside what this animation pass is allowed to touch.
 */
const Newsletter: React.FC<{ label: string }> = ({ label }) => {
  const [sent, setSent] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  return (
    <form
      className={`ship-news${sent ? ' sent' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        setSent(true);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setSent(false), 1500);
      }}
    >
      <label className="sr-only" htmlFor="ship-news-email">
        {label}
      </label>
      <input id="ship-news-email" type="email" autoComplete="email" placeholder={label} />
      <button type="submit" aria-label={sent ? 'Subscribed' : `Send ${label}`}>
        <Arrow />
        <Check />
      </button>
    </form>
  );
};

export const ShipcraftCta: React.FC<ShipcraftCtaProps> = ({
  eyebrow,
  headline,
  copy,
  applyLabel,
  onApply,
  loginLabel,
  onLogin,
  columns,
  blurb,
  copyright,
  legal,
  footerLinks,
  socials = [],
  newsletterLabel = 'Get recruitment updates',
  wordmark = 'ESME',
}) => {
  const sectionRef = useRef<HTMLElement | null>(null);
  const wordRef = useRef<HTMLSpanElement | null>(null);

  // (a) staged entrance — one class, one observer, straight from the reveal system.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (prefersReduced() || !canAnimate()) {
      el.classList.add('shipped');
      return;
    }
    return onRevealed(el, () => el.classList.add('shipped'));
  }, []);

  // (b) `--u` — the section scales with its own width, not the viewport's.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = (width: number) => {
      if (width >= UNITS_BREAKPOINT) el.style.setProperty('--u', `${(width / DESIGN_WIDTH).toFixed(4)}px`);
      else el.style.removeProperty('--u');
    };
    apply(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // (c) the wordmark sinks off the bottom across the last viewport of scroll.
  useGsap(({ gsap, ScrollTrigger }) => {
    const section = sectionRef.current;
    const word = wordRef.current;
    if (!section || !word) return;
    const tween: ScrollTween = gsap.fromTo(
      word,
      { yPercent: 0 },
      {
        yPercent: 18,
        ease: 'none',
        scrollTrigger: { trigger: section, start: 'top bottom', end: 'bottom bottom', scrub: true },
      }
    );
    return () => {
      killTweens([tween]);
      ScrollTrigger.refresh();
    };
  }, []);

  let stage = 0;
  const next = () => ({ '--s': String(stage++) }) as React.CSSProperties;

  return (
    <section ref={sectionRef} className="ship" aria-labelledby="ship-headline">
      <div className="ship-cta">
        <div>
          <span className="ship-pill s-in" style={next()}>
            {eyebrow}
          </span>
          <h2 id="ship-headline" className="ship-head">
            {headline.map((line, index) => (
              <span key={`${line}-${index}`} className="s-in" style={next()}>
                {line}
              </span>
            ))}
          </h2>
          <p className="ship-copy s-in" style={next()}>
            {copy}
          </p>
          <div className="s-in" style={next()}>
            <button type="button" className="ship-button" onClick={onApply}>
              {applyLabel}
              <Arrow />
            </button>
            {onLogin && loginLabel && (
              <button type="button" className="ship-login" onClick={onLogin}>
                {loginLabel}
              </button>
            )}
          </div>
        </div>

        <div className="ship-editor s-in" style={next()}>
          <span className="bar short" />
          <span className="bar accent" />
          <span className="bar" />
          <span className="bar" style={{ width: '78%' }} />
          <span className="bar short" />
          <div className="code">{`const cycle = {\n  open:   '${eyebrow}',\n  review: 'committee',\n  offer:  true,\n}`}</div>
        </div>
      </div>

      <div className="ship-foot">
        <div className="ship-col s-in" style={next()}>
          <div className="ship-brand">
            <LogoDraw size={44} />
            <p>{blurb}</p>
          </div>
          {footerLinks.length > 0 && (
            <nav aria-label="Footer links" className="ship-legal">
              {footerLinks.map((link) => (
                <a key={link.id} href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          )}
          {socials.length > 0 && (
            <div className="ship-social">
              {socials.map((social) => (
                <a key={social.id} href={social.href} aria-label={social.label} rel="noreferrer" target="_blank">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              ))}
            </div>
          )}
        </div>

        {columns.map((column) => (
          <div key={column.heading} className="ship-col s-in" style={next()}>
            <h4>{column.heading}</h4>
            <ul>
              {column.links.map((link) => (
                <li key={link.label}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="ship-col s-in" style={next()}>
          <h4>{newsletterLabel}</h4>
          <Newsletter label="Email address" />
        </div>
      </div>

      <div className="ship-hands" aria-hidden="true">
        <span className="ship-hand left s-in" style={next()}>
          <span className="ship-float">
            <Hand id="ship-hand-l" />
          </span>
        </span>
        <span className="ship-hand right s-in" style={next()}>
          <span className="ship-float">
            <Hand id="ship-hand-r" />
          </span>
        </span>
      </div>

      <div className="ship-base">
        <span>{copyright}</span>
        {legal && <span>{legal}</span>}
      </div>

      {/* Three layers, because one transform each: the box clips, `.s-in` rises, `.sink` is the scrub. */}
      <div className="ship-word" aria-hidden="true">
        <span className="s-in" style={next()}>
          <span ref={wordRef} className="sink">
            {wordmark}
          </span>
        </span>
      </div>
    </section>
  );
};
