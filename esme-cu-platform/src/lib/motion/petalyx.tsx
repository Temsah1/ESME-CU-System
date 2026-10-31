import React, { useEffect, useMemo, useRef, useState } from 'react';
import { canAnimate } from './env';
import { loadGsap, type GsapRuntime } from './gsap';
import { mountSmoothScroll } from './lenis';
import './petalyx.css';

/**
 * PETALYX — the GSAP half of the motion system.
 *
 * Everything here is scroll- or timeline-driven, so everything here shares one rule: the engine is
 * loaded lazily, and if it never loads (reduced motion, a device that asked to save data, a DOM
 * emulator with no layout) the markup underneath is already the finished page. The intro zoom is the
 * one piece that *hides* content, and it only ever runs once per session, in a real browser.
 */

type Cleanup = void | (() => void);
type GsapEffect = (rt: GsapRuntime) => Cleanup;

/** The slice of a GSAP tween this file needs, without importing the library's types into the bundle. */
export type ScrollTween = { kill: () => void; scrollTrigger?: { kill: () => void } | undefined };

export const killTweens = (tweens: (ScrollTween | false | null | undefined)[]): void => {
  tweens.forEach((tween) => {
    if (!tween) return;
    tween.scrollTrigger?.kill();
    tween.kill();
  });
};

/** Runs an effect once GSAP has arrived, and tears it down if the component goes first. */
export function useGsap(make: GsapEffect, deps: React.DependencyList): void {
  useEffect(() => {
    let alive = true;
    let dispose: Cleanup;
    loadGsap().then((rt) => {
      if (!alive || !rt) return;
      dispose = make(rt);
    });
    return () => {
      alive = false;
      if (typeof dispose === 'function') dispose();
    };
    // The caller owns this list — it is the same contract useEffect takes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ------------------------------------------------------------------ (b) frosted squares */

/** The 15 positions the brief lists, as [x%, y%]. Centre squares (40<x<60) are the small ones. */
const SQUARES: [number, number][] = [
  [3, 64], [3, 71], [6.5, 71], [10, 71], [3, 78], [-1, 70], [45.5, 76], [49, 80], [49, 76], [52.5, 76],
  [86, 58], [86, 67], [82, 76], [89.5, 76], [86, 84],
];

const random = (min: number, max: number) => min + Math.random() * (max - min);

export const GlassSquares: React.FC<{ field?: boolean }> = ({ field = true }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const squares = useMemo(
    () => SQUARES.map(([x, y], index) => ({ x, y, index, centre: x > 40 && x < 60 })),
    []
  );
  // Fixed at mount: a re-roll on every render would move the decoration under the reader's eye.
  const grid = useMemo(
    () =>
      Array.from({ length: 18 }, () => {
        const col = Math.floor(random(0, 30));
        const row = Math.floor(random(0, 6));
        return { left: col * 48 - 10, top: row * 48 + 6 };
      }),
    []
  );

  useGsap(
    ({ gsap }) => {
      const host = hostRef.current;
      if (!host) return;
      const tweens = gsap.utils
        .toArray<HTMLElement>(host.querySelectorAll('.glass-sq'))
        .map((square) =>
          gsap.to(square, {
            opacity: 0.15,
            duration: 0.9,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inOut',
            delay: random(0, 3),
            repeatDelay: random(1, 4),
          })
        );
      const gridTweens = gsap.utils
        .toArray<HTMLElement>(host.querySelectorAll('.sq-field i'))
        .map((cell) =>
          gsap.fromTo(
            cell,
            { opacity: 0 },
            {
              opacity: 1,
              duration: 1.2,
              yoyo: true,
              repeat: -1,
              delay: random(0, 4),
              repeatDelay: random(0, 3),
            }
          )
        );
      return () => [...tweens, ...gridTweens].forEach((tween) => tween.kill());
    },
    []
  );

  return (
    <div ref={hostRef} className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {squares.map((square) => (
        <span
          key={square.index}
          className={`glass-sq ${square.centre ? 'centre' : 'outer'}`}
          style={{ left: `${square.x}%`, top: `${square.y}%` }}
        />
      ))}
      {field && (
        <div className="sq-field">
          {grid.map((cell, index) => (
            <i key={index} style={{ left: `${cell.left}px`, top: `${cell.top}px` }} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ (a) page intro */

const INTRO_KEY = 'esme.intro.shown';

/**
 * The one-time zoom that opens the landing page.
 *
 * Order matters and is the brief's: Lenis is stopped so the visitor cannot scroll out from under the
 * timeline, the page scales up from .9, the nav and hero words follow, the decoration drifts in last,
 * and only then is smooth scroll handed back and the scroll animations built — otherwise a scrubbed
 * parallax would measure a page that is still mid-transform.
 */
export function usePageIntro(appRef: React.RefObject<HTMLElement | null>, onReady: () => void): void {
  useEffect(() => {
    let alreadyShown = false;
    try {
      alreadyShown = sessionStorage.getItem(INTRO_KEY) === '1';
    } catch {
      alreadyShown = false;
    }
    if (!canAnimate() || alreadyShown) {
      onReady();
      return;
    }
    try {
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* a private window that refuses storage simply gets the intro again next visit */
    }

    let backdrop: HTMLDivElement | null = null;
    let revert: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const rt = await loadGsap();
      const app = appRef.current;
      if (cancelled || !rt || !app) {
        onReady();
        return;
      }
      const { gsap } = rt;
      document.body.classList.add('intro');
      backdrop = document.createElement('div');
      backdrop.className = 'intro-backdrop';
      document.body.append(backdrop);
      void mountSmoothScroll().then((scroll) => scroll?.stop());

      const words = Array.from(app.querySelectorAll<HTMLElement>('.split .w > span'));
      const nav = app.querySelector<HTMLElement>('[data-intro="nav"]');
      const shapes = Array.from(app.querySelectorAll<HTMLElement>('[data-intro="shape"]'));
      const squares = Array.from(app.querySelectorAll<HTMLElement>('.glass-sq'));

      gsap.set(app, { scale: 0.9, borderRadius: 28, transformOrigin: '50% 50vh' });
      gsap.set(words, { opacity: 0, y: 24, filter: 'blur(10px)' });
      if (nav) gsap.set(nav, { opacity: 0, y: -16 });

      const tl = gsap.timeline({
        delay: 0.25,
        onComplete: () => {
          document.body.classList.remove('intro');
          gsap.set(app, { clearProps: 'all' });
          backdrop?.remove();
          backdrop = null;
          revert = null;
          void mountSmoothScroll().then((scroll) => scroll?.start());
          onReady();
        },
      });
      tl.fromTo(app, { scale: 0.9, borderRadius: 28 }, { scale: 1, borderRadius: 0, duration: 1.4, ease: 'expo.inOut' });
      if (nav) tl.to(nav, { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out' }, '-=.5');
      tl.to(words, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1, stagger: 0.07, ease: 'power3.out' }, '-=.7');
      if (shapes.length) {
        tl.fromTo(
          shapes,
          { x: (i) => (i % 2 === 0 ? -120 : 120), opacity: 0 },
          { x: 0, opacity: 1, duration: 1.6, ease: 'power3.out', stagger: 0.06 },
          0.4
        );
      }
      if (squares.length) {
        tl.fromTo(
          squares,
          { opacity: 0, scale: 0.6 },
          { opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(2)', stagger: { each: 0.05, from: 'random' } },
          '-=1'
        );
      }
      revert = () => {
        tl.kill();
        document.body.classList.remove('intro');
        backdrop?.remove();
        void mountSmoothScroll().then((scroll) => scroll?.start());
      };
    })();

    return () => {
      cancelled = true;
      revert?.();
    };
    // One shot by design: the intro is a once-per-session event, so a later change to the host
    // element or the callback must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* ------------------------------------------------------------------ (c) hero parallax */

export function useHeroParallax(heroRef: React.RefObject<HTMLElement | null>, ready: boolean): void {
  useGsap(
    ({ gsap, ScrollTrigger }) => {
      const hero = heroRef.current;
      if (!hero || !ready) return;
      const headline = hero.querySelector<HTMLElement>('.split, h1');
      const media = hero.querySelector<HTMLElement>('[data-par="media"]');
      const triggers = [
        headline &&
          gsap.to(headline, {
            yPercent: -60,
            ease: 'none',
            scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
          }),
        ...Array.from(hero.querySelectorAll<HTMLElement>('[data-par]'))
          .filter((el) => el.dataset.par && !Number.isNaN(Number(el.dataset.par)))
          .map((el) =>
            gsap.to(el, {
              y: Number(el.dataset.par) * 2,
              ease: 'none',
              scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
            })
          ),
        media &&
          gsap.to(media, {
            yPercent: 8,
            ease: 'none',
            scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
          }),
      ].filter(Boolean) as ScrollTween[];
      return () => {
        killTweens(triggers);
        ScrollTrigger.refresh();
      };
    },
    [ready]
  );
}

/* ------------------------------------------------------------------ (d) pinned tickets */

export type StatTicket = { label: string; to: number; decimals?: number; suffix?: string };

const formatValue = (value: number, decimals = 0, suffix = '') =>
  `${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

export const PinnedStats: React.FC<{ items: StatTicket[]; art?: React.ReactNode }> = ({ items, art }) => {
  const stageRef = useRef<HTMLElement | null>(null);
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useGsap(({ gsap, ScrollTrigger }) => {
    const stage = stageRef.current;
    if (!stage) return;
    const cards = Array.from(stage.querySelectorAll<HTMLElement>('.ticket'));
    const band = stage.querySelector<HTMLElement>('.frosted-band');
    const illustration = stage.querySelector<HTMLElement>('.pin-art');
    const values = valueRefs.current.filter(Boolean) as HTMLSpanElement[];
    const write = (p: number) => {
      items.forEach((item, index) => {
        const el = values[index];
        if (el) el.textContent = formatValue(item.to * p, item.decimals, item.suffix);
      });
    };

    const match = gsap.matchMedia();
    match.add('(min-width: 901px)', () => {
      const tweens: ScrollTween[] = [
        gsap.from(cards, { y: 40, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: stage, start: 'top 70%' } }),
      ];
      const proxy = { p: 0 };
      tweens.push(
        gsap.to(proxy, {
          p: 1,
          ease: 'none',
          scrollTrigger: { trigger: stage, start: 'top top', end: '+=120%', pin: true, scrub: 1 },
          onUpdate: () => write(proxy.p),
        })
      );
      if (illustration) {
        tweens.push(
          gsap.fromTo(
            illustration,
            { yPercent: 75 },
            { yPercent: 6, ease: 'none', scrollTrigger: { trigger: stage, start: 'top top', end: '+=120%', scrub: 1 } }
          )
        );
      }
      if (band) {
        tweens.push(
          gsap.fromTo(band, { opacity: 0 }, { opacity: 1, ease: 'none', scrollTrigger: { trigger: stage, start: 'top 60%', end: '+=120%', scrub: 1 } })
        );
      }
      return () => killTweens(tweens);
    });
    match.add('(max-width: 900px)', () => {
      const counter = { p: 0 };
      const tweens: ScrollTween[] = [
        gsap.from(cards, { y: 30, opacity: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out', scrollTrigger: { trigger: stage, start: 'top 85%' } }),
        gsap.to(counter, {
          p: 1,
          duration: 2,
          ease: 'power2.out',
          onUpdate: () => write(counter.p),
          scrollTrigger: { trigger: stage, start: 'top 80%' },
        }),
      ];
      if (illustration) {
        tweens.push(
          gsap.fromTo(
            illustration,
            { yPercent: 40 },
            { yPercent: 0, ease: 'none', scrollTrigger: { trigger: stage, start: 'top bottom', end: 'top top', scrub: true } }
          )
        );
      }
      return () => killTweens(tweens);
    });
    return () => {
      match.revert();
      ScrollTrigger.refresh();
    };
  }, [items]);

  return (
    <section ref={stageRef} className="pin-stage py-20">
      <div className="relative">
        <div className="pin-art absolute inset-x-0 -bottom-8 flex justify-center pointer-events-none" aria-hidden="true">
          {art}
        </div>
        <div className="tickets relative">
          {items.map((item, index) => (
            <div className="ticket" key={item.label}>
              <span
                className="ticket-value"
                ref={(el) => {
                  valueRefs.current[index] = el;
                }}
              >
                {formatValue(item.to, item.decimals, item.suffix)}
              </span>
              <span className="ticket-label">{item.label}</span>
            </div>
          ))}
        </div>
        <div className="frosted-band" style={{ top: 'calc(50% - 60px)' }} aria-hidden="true" />
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------ (e) hover accordion */

export type AccordionStep = { label: string; title: string; body: string };

export const HoverAccordion: React.FC<{ steps: AccordionStep[] }> = ({ steps }) => {
  const [active, setActive] = useState(0);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useGsap(({ gsap, ScrollTrigger }) => {
    const row = rowRef.current;
    if (!row) return;
    const isNarrow = window.matchMedia('(max-width: 760px)').matches;
    const targets = Array.from(row.querySelectorAll<HTMLElement>(isNarrow ? '.acc-body' : '.acc-panel'));
    const tween = gsap.from(targets, {
      y: isNarrow ? 40 : 120,
      opacity: 0,
      duration: isNarrow ? 0.9 : 1.1,
      stagger: isNarrow ? 0.1 : 0.12,
      ease: 'power3.out',
      scrollTrigger: { trigger: row, start: isNarrow ? 'top 85%' : 'top 60%' },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
      ScrollTrigger.refresh();
    };
  }, [steps.length]);

  return (
    <div ref={rowRef} className="acc" data-rv="">
      {steps.map((step, index) => (
        <button
          type="button"
          key={step.label}
          className={`acc-panel ${index === active ? 'is-active' : ''}`}
          onMouseEnter={() => setActive(index)}
          onFocus={() => setActive(index)}
          onClick={() => setActive(index)}
          tabIndex={0}
          aria-label={step.title}
          aria-expanded={index === active}
        >
          <span className="acc-num" aria-hidden="true">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="acc-rail" aria-hidden="true">
            {step.label}
          </span>
          <span className="acc-body">
            <span className="step">
              <span className="step-shape" aria-hidden="true" />
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ (g) falling accents */

/** Eighteen small accents, each with its own lane, speed and negative delay so the band starts full. */
export const FallingAccents: React.FC<{ count?: number }> = ({ count = 18 }) => {
  const accents = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: random(0, 100),
        dx: random(-80, 80),
        duration: random(9, 18),
        delay: -random(0, 15),
        scale: random(0.6, 1.4),
      })),
    [count]
  );
  if (!canAnimate()) return null;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      {accents.map((accent, index) => (
        <span
          key={index}
          className="fall"
          style={
            {
              left: `${accent.left}%`,
              '--dx': `${accent.dx}px`,
              animationDuration: `${accent.duration}s`,
              animationDelay: `${accent.delay}s`,
              transform: `scale(${accent.scale})`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ (h) footer logo draw */

const MARK_PATH = 'M32 12 L52 44 L12 44 Z';
const RING_PATH = 'M32 4 a28 28 0 1 1 -0.1 0';

export const LogoDraw: React.FC<{ size?: number; className?: string }> = ({ size = 64, className = '' }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const paths = Array.from(svg.querySelectorAll<SVGPathElement>('.draw'));
    paths.forEach((path) => {
      if (typeof path.getTotalLength !== 'function') return;
      path.style.setProperty('--len', String(path.getTotalLength()));
    });
  }, []);

  useGsap(({ gsap, ScrollTrigger }) => {
    const svg = svgRef.current;
    if (!svg) return;
    const dots = Array.from(svg.querySelectorAll<SVGCircleElement>('circle'));
    const mark = svg.querySelector<SVGPathElement>('.mark');
    const ring = svg.querySelector<SVGPathElement>('.ring');
    const trigger = ScrollTrigger.create({
      trigger: svg,
      start: 'top 92%',
      once: true,
      onEnter: () => {
        const tl = gsap.timeline();
        tl.to(dots, { y: -8, duration: 0.25, yoyo: true, repeat: 3, ease: 'sine.inOut', stagger: 0.08 })
          .to(dots, { x: (index) => (index - 1) * -12, duration: 0.45, ease: 'power3.inOut' }, '+=0.1')
          .to(dots.slice(1), { opacity: 0, duration: 0.1 }, '-=.1');
        if (mark) tl.to(mark, { strokeDashoffset: 0, duration: 0.6, ease: 'power3.out' }, '-=.05');
        if (dots[0]) tl.to(dots[0], { attr: { r: 5.5 }, ease: 'back.out(3)' }, '<');
        if (ring) tl.to(ring, { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' }, '-=.3');
      },
    });
    return () => trigger.kill();
  }, []);

  return (
    <svg
      ref={svgRef}
      className={`logo-draw ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="ESME mark"
    >
      <circle className="d1" cx="20" cy="44" r="3.5" />
      <circle className="d2" cx="32" cy="44" r="3.5" />
      <circle className="d3" cx="44" cy="44" r="3.5" />
      <path className="draw mark" d={MARK_PATH} />
      <path className="draw ring" d={RING_PATH} />
    </svg>
  );
};

/* ------------------------------------------------------------------ (f) headings on scroll */

/**
 * Words lift out of a blur as the section reaches the viewport.
 *
 * This is the scroll-side twin of the CSS split used above the fold: the same `.split` markup, driven
 * by ScrollTrigger instead of the reveal observer, so a heading never sits hidden behind a threshold
 * the observer has already passed.
 */
export function useWordRevealOnScroll(ref: React.RefObject<HTMLElement | null>, ready: boolean): void {
  useGsap(({ gsap, ScrollTrigger }) => {
    const host = ref.current;
    if (!host || !ready) return;
    const tweens = Array.from(host.querySelectorAll<HTMLElement>('.split')).map((heading) => {
      const words = Array.from(heading.querySelectorAll<HTMLElement>('.w > span'));
      heading.classList.add('in');
      return gsap.fromTo(
        words,
        { opacity: 0, y: 22, filter: 'blur(8px)' },
        {
          opacity: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.9,
          stagger: 0.06,
          ease: 'power3.out',
          scrollTrigger: { trigger: heading, start: 'top 80%' },
        }
      );
    });
    const reveals = Array.from(host.querySelectorAll<HTMLElement>('[data-reveal]')).map((el) =>
      gsap.fromTo(
        el,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 85%' } }
      )
    );
    const all = [...tweens, ...reveals];
    return () => {
      all.forEach((tween) => tween.scrollTrigger?.kill() ?? tween.kill());
      ScrollTrigger.refresh();
    };
  }, [ready]);
}

/** The CTA band: its background rises with the scroll and the card settles at "top 60%". */
export function useCtaScroll(ref: React.RefObject<HTMLElement | null>, ready: boolean): void {
  useGsap(({ gsap, ScrollTrigger }) => {
    const host = ref.current;
    if (!host || !ready) return;
    const background = host.querySelector<HTMLElement>('[data-cta="background"]');
    const card = host.querySelector<HTMLElement>('[data-cta="card"]');
    const tweens = [
      background &&
        gsap.fromTo(
          background,
          { yPercent: -12 },
          {
            yPercent: 0,
            ease: 'none',
            scrollTrigger: { trigger: host, start: 'top bottom', end: 'bottom bottom', scrub: true },
          }
        ),
      card &&
        gsap.fromTo(
          card,
          { y: 80, scale: 0.94, opacity: 0, filter: 'blur(10px)' },
          { y: 0, scale: 1, opacity: 1, filter: 'blur(0px)', duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: host, start: 'top 60%' } }
        ),
    ].filter(Boolean) as ScrollTween[];
    return () => {
      killTweens(tweens);
      ScrollTrigger.refresh();
    };
  }, [ready]);
}
