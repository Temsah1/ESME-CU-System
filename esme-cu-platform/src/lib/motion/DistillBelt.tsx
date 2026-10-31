import React, { useEffect, useRef } from 'react';
import { cappedDpr, isHeadlessDom, onPageVisibleChange, prefersReduced } from './env';
import { clampDt } from './spring';
import './distill.css';

/**
 * DISTILL — the six steps on a conveyor belt, cut in half by a scanner.
 *
 * One loop owns everything: the belt position, each card's clip and mask, the counter, the dissolve
 * particles and the sparks. It writes transforms only, never layout, and it reads its measurements once
 * per resize — a `getBoundingClientRect` inside a frame loop is how a belt like this drops to 30fps.
 */

export type ProcessStep = {
  title: string;
  body: string;
  /** The markup the step is made of, printed as the grey code on the left of the line. */
  html: string[];
  /** The note beside it. */
  meta: string[];
};

export const RECRUITMENT_PROCESS: ProcessStep[] = [
  {
    title: 'Apply',
    body: 'One form, six short steps. It saves as you go and tells you what is missing.',
    html: ['<form id="apply">', '  <field name="name" required>', '  <field name="year" required>', '  <field name="committee">', '</form>'],
    meta: ['// two minutes, honestly', '// one account per student'],
  },
  {
    title: 'Screening',
    body: 'Each answer is read by the committee it belongs to, not by one generalist.',
    html: ['for (answer of form) {', '  const owner = route(answer);', '  owner.read(answer);', '}'],
    meta: ['// no answer is unowned', '// three committees, one pass'],
  },
  {
    title: 'Review',
    body: 'A second reviewer checks the first one’s score before anything is decided.',
    html: ['if (scoreA - scoreB > 2) {', '  escalate(both);', '}'],
    meta: ['// disagreement is a feature'],
  },
  {
    title: 'Interview',
    body: 'Thirty minutes: one technical question, one honest one, no slide decks.',
    html: ['<panel>', '  <question type="technical" />', '  <question type="yourself" />', '</panel>'],
    meta: ['// two people in the room', '// notes go on the record'],
  },
  {
    title: 'Decision',
    body: 'The board agrees on one list and signs it. Nobody is left in the dark.',
    html: ['list.sort(byCommitteeNeed);', 'board.sign(list);', 'publish(list);'],
    meta: ['// one signature per name'],
  },
  {
    title: 'Welcome',
    body: 'Tools, a mentor, the workshop rules, and your first shift on the season plan.',
    html: ['<welcome>', '  <mentor name="…" />', '  <keys issued="true" />', '</welcome>'],
    meta: ['// onboarding starts day one'],
  },
];

const MOD = (value: number, n: number) => ((value % n) + n) % n;

/** The brief's integer hash: three ints in, one float out, no allocations. */
function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const PALETTE = ['#FF4A12', '#FF5A1F', '#FF6B2C', '#FF8A3D', '#FFB06A', '#FFD9B5', '#FFF3E6'];

const MINUS = '−';

const formatCount = (value: number) => {
  const absolute = Math.abs(value).toLocaleString('en-US');
  return value < 0 ? `${MINUS}${absolute}` : absolute;
};

type Props = {
  steps?: ProcessStep[];
  /** What the counter counts: the brief offers "Steps completed" or "Time saved". */
  label?: string;
};

export const DistillBelt: React.FC<Props> = ({ steps = RECRUITMENT_PROCESS, label = 'Steps completed' }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const beltRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const numRef = useRef<HTMLSpanElement | null>(null);
  const pctRef = useRef<HTMLSpanElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const codeRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    const belt = beltRef.current;
    const canvas = canvasRef.current;
    if (!host || !belt || !canvas) return;
    const cards = cardRefs.current.filter(Boolean) as HTMLDivElement[];
    const codes = codeRefs.current.filter(Boolean) as HTMLDivElement[];
    if (cards.length !== steps.length || codes.length !== steps.length) return;

    const reduced = prefersReduced();
    const ctx = isHeadlessDom() ? null : canvas.getContext('2d');

    // cw / ch / gap are CSS tokens; the only honest way to read them is to measure a real box.
    let cw = 0;
    let ch = 0;
    let gap = 0;
    let Lx = 0;
    let dpr = 1;
    const measure = () => {
      const box = belt.getBoundingClientRect();
      cw = cards[0].getBoundingClientRect().width;
      ch = cards[0].getBoundingClientRect().height;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--gap)';
      host.append(probe);
      gap = probe.getBoundingClientRect().width;
      probe.remove();
      Lx = window.innerWidth / 2;
      dpr = cappedDpr('2d');
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    measure();

    const state = {
      off: window.innerWidth / 2 - 0.62 * cw,
      vel: 0,
      hover: 0,
      hovered: false,
      dragging: false,
      dragLast: 0,
      dragTime: 0,
      shown: 0,
      crossing: -1,
    };
    type Spark = { x: number; y: number; vx: number; vy: number; size: number; life: number; colour: string };
    const sparks: Spark[] = [];
    const span = () => cw + gap;
    const period = () => span() * steps.length;
    const xOf = (index: number) => MOD(state.off + index * span() + span(), period()) - span();

    const onPointerEnter = () => {
      state.hovered = true;
    };
    const onPointerLeave = () => {
      if (!state.dragging) state.hovered = false;
    };
    const onPointerDown = (event: PointerEvent) => {
      state.dragging = true;
      state.dragLast = event.clientX;
      state.dragTime = performance.now();
      belt.classList.add('dragging');
      belt.setPointerCapture(event.pointerId);
      draw(0);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!state.dragging) return;
      const now = performance.now();
      const dx = event.clientX - state.dragLast;
      state.off += dx;
      const elapsed = Math.max(8, now - state.dragTime);
      state.vel = (dx / elapsed) * 1000 * 0.8 + state.vel * 0.2;
      state.dragLast = event.clientX;
      state.dragTime = now;
      draw(0);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!state.dragging) return;
      state.dragging = false;
      belt.classList.remove('dragging');
      if (belt.hasPointerCapture(event.pointerId)) belt.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      state.vel += -event.deltaX * 6;
      draw(0);
    };

    /** Per card: how far its left edge has travelled past the line. */
    const cutOf = (x: number) => Math.min(Math.max(Lx - x, 0), cw);

    const layout = () => {
      let crossing = -1;
      let progress = 0;
      cards.forEach((card, index) => {
        const code = codes[index];
        const x = xOf(index);
        const cut = cutOf(x);
        const move = `translate3d(${x.toFixed(2)}px,0,0)`;
        card.style.transform = move;
        code.style.transform = move;
        if (cut > 0) {
          const clip = `inset(0 0 0 ${cut.toFixed(2)}px round 0 1.6vw 1.6vw 0)`;
          const fade = `linear-gradient(90deg,transparent ${cut.toFixed(2)}px,#000 ${(cut + 26).toFixed(2)}px)`;
          card.style.setProperty('clip-path', clip);
          card.style.setProperty('-webkit-clip-path', clip);
          card.style.setProperty('mask-image', fade);
          card.style.setProperty('-webkit-mask-image', fade);
          const codeClip = `inset(0 ${(cw - cut).toFixed(2)}px 0 0)`;
          code.style.setProperty('clip-path', codeClip);
          code.style.setProperty('-webkit-clip-path', codeClip);
          code.style.visibility = 'visible';
          if (cut > 0 && cut < cw && x + cw > Lx) {
            crossing = index;
            progress = cut / cw;
          }
        } else {
          card.style.setProperty('clip-path', 'none');
          card.style.setProperty('-webkit-clip-path', 'none');
          card.style.setProperty('mask-image', 'none');
          card.style.setProperty('-webkit-mask-image', 'none');
          code.style.visibility = 'hidden';
        }
      });
      return { crossing, progress };
    };

    const draw = (dt: number) => {
      const { crossing, progress } = layout();
      const total = steps.length;
      if (crossing === -1) {
        state.crossing = -1;
      } else if (crossing !== state.crossing) {
        // A new card takes over the counter: it snaps rather than sliding backwards to meet it.
        state.crossing = crossing;
        state.shown = Math.round(total * progress);
      } else {
        state.shown += (Math.round(total * progress) - state.shown) * (1 - Math.exp(-dt * 14));
      }
      const target = Math.max(0, Math.min(total, Math.round(state.shown)));
      if (numRef.current) numRef.current.textContent = formatCount(target);
      if (pctRef.current) {
        const percent = Math.round((((state.crossing < 0 ? 0 : state.crossing) + progress) / total) * 100);
        pctRef.current.textContent = `${Math.max(0, Math.min(100, percent))}% done`;
      }

      if (!ctx) return;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      ctx.clearRect(0, 0, width, height);
      const top = 70;
      const R = 0.3 * cw;
      const time = performance.now() / 1000;

      cards.forEach((_, index) => {
        const x = xOf(index);
        const cut = cutOf(x);
        if (cut <= 0 || x + cw <= Lx) return;

        // 1. Haze: the air between the line and the card's right edge.
        const hazeWidth = Math.max(0, Math.min(150, x + cw - Lx));
        if (hazeWidth > 0) {
          const grad = ctx.createLinearGradient(Lx, 0, Lx + 150, 0);
          grad.addColorStop(0, 'rgba(255,96,40,.42)');
          grad.addColorStop(1, 'rgba(255,96,40,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(Lx, top, hazeWidth, ch);
        }

        // 2. Particles fixed to the card's own surface, so they travel with it.
        const columns = Math.ceil(cw / 3);
        const rows = Math.ceil(ch / 3);
        for (let gx = 0; gx <= columns; gx += 1) {
          const sx = x + gx * 3;
          const d = sx - Lx;
          if (d < 0 || d > R) continue;
          const p = Math.pow(1 - d / R, 1.7);
          for (let row = -5; row <= rows + 5; row += 1) {
            const inside = row >= 0 && row < rows;
            let likelihood: number;
            if (inside) {
              likelihood = p * 0.92;
            } else {
              const outside = row < 0 ? -row : row - (rows - 1);
              likelihood = p * 0.16 * Math.max(0, 1 - outside / 5);
            }
            if (hash(gx, row, index) >= likelihood) continue;
            // Twinkle: a quarter of the lit grid is switched off each ninth of a second.
            if (!reduced && hash(gx, row, Math.floor(time * 9) + 97) < 0.22) continue;
            const h2 = hash(row, gx, index + 31);
            const near = sx - Lx < 10;
            const colour = PALETTE[near ? 4 + Math.floor(h2 * 3) : Math.floor(h2 * h2 * 7)];
            const jitterX = reduced ? 0 : (hash(gx, row + 1, index) - 0.5) * 1.6;
            const jitterY = reduced ? 0 : (hash(gx + 1, row, index) - 0.5) * 1.6;
            const size = 1.1 + h2 * 1.7;
            ctx.fillStyle = colour;
            ctx.fillRect(sx + jitterX, top + row * 3 + jitterY, size, size);
          }
        }
      });

      // 3. Sparks thrown off the line, carried by the belt's own velocity.
      if (!reduced && ctx) {
        for (let i = 0; i < 3; i += 1) {
          if (Math.random() > 0.7) continue;
          const cardIndex = Math.floor(Math.random() * steps.length);
          const cardX = xOf(cardIndex);
          if (cardX + cw <= Lx) continue;
          sparks.push({
            x: Lx + Math.random() * 30,
            y: top - 10 + Math.random() * (ch + 20),
            vx: -30 + Math.random() * 70 + state.vel * 0.6,
            vy: (Math.random() - 0.5) * 50,
            size: 0.8 + Math.random() * 1.8,
            life: 0.3 + Math.random() * 0.8,
            colour: PALETTE[Math.floor(Math.random() * PALETTE.length)],
          });
        }
        for (let i = sparks.length - 1; i >= 0; i -= 1) {
          const spark = sparks[i];
          spark.life -= dt;
          if (spark.life <= 0) {
            sparks.splice(i, 1);
            continue;
          }
          spark.x += spark.vx * dt;
          spark.y += spark.vy * dt;
          ctx.globalAlpha = Math.min(1, spark.life * 2.2);
          ctx.fillStyle = spark.colour;
          ctx.fillRect(spark.x, spark.y, spark.size, spark.size);
        }
        ctx.globalAlpha = 1;
      }
    };

    const auto = reduced ? 0 : -0.075 * window.innerWidth;
    let raf = 0;
    let last = performance.now();
    let onScreen = true;
    let pageVisible = !document.hidden;

    const frame = (time: number) => {
      const dt = clampDt((time - last) / 1000);
      last = time;
      if (!state.dragging) {
        state.hover += ((state.hovered ? 1 : 0) - state.hover) * (1 - Math.exp(-dt * 4));
        const targetVelocity = auto * (1 - 0.65 * state.hover);
        state.vel += (targetVelocity - state.vel) * (1 - Math.exp(-dt * 2.2));
        state.off += state.vel * dt;
      }
      draw(dt);
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (raf || !onScreen || !pageVisible) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    belt.addEventListener('pointerenter', onPointerEnter);
    belt.addEventListener('pointerleave', onPointerLeave);
    belt.addEventListener('pointerdown', onPointerDown);
    belt.addEventListener('pointermove', onPointerMove);
    belt.addEventListener('pointerup', onPointerUp);
    belt.addEventListener('pointercancel', onPointerUp);
    belt.addEventListener('wheel', onWheel, { passive: false });
    const onResize = () => {
      measure();
      draw(0);
    };
    window.addEventListener('resize', onResize);

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            if (onScreen) start();
            else stop();
          });
    observer?.observe(host);
    const offVisibility = onPageVisibleChange((visible) => {
      pageVisible = visible;
      if (visible) start();
      else stop();
    });

    if (reduced || isHeadlessDom()) {
      // One card parked mid-crossing, drawn once. The belt still drags: see onPointerMove.
      state.off = Lx - 0.5 * cw - 2 * span();
      draw(0);
    } else {
      draw(0);
      start();
    }

    return () => {
      stop();
      observer?.disconnect();
      offVisibility();
      window.removeEventListener('resize', onResize);
      belt.removeEventListener('pointerenter', onPointerEnter);
      belt.removeEventListener('pointerleave', onPointerLeave);
      belt.removeEventListener('pointerdown', onPointerDown);
      belt.removeEventListener('pointermove', onPointerMove);
      belt.removeEventListener('pointerup', onPointerUp);
      belt.removeEventListener('pointercancel', onPointerUp);
      belt.removeEventListener('wheel', onWheel);
    };
  }, [steps]);

  return (
    <div className="distill" ref={hostRef}>
      <div className="badge" aria-live="off">
        <span className="label">{label}</span>
        <span className="pill">
          <span className="num" ref={numRef}>
            0
          </span>
          <span className="pct" ref={pctRef}>
            0% done
          </span>
        </span>
      </div>
      <div className="scan" aria-hidden="true">
        <i />
        <b />
      </div>
      <div className="belt" ref={beltRef} aria-hidden="true">
        <div className="codes">
          {steps.map((step, index) => (
            <div
              className="code"
              key={`code-${step.title}`}
              ref={(el) => {
                codeRefs.current[index] = el;
              }}
            >
              <span className="html">{step.html.map((line, i) => `${i + 1}  ${line}`).join('\n')}</span>
              <span className="meta">{step.meta.map((line, i) => `${i + 1}  ${line}`).join('\n')}</span>
            </div>
          ))}
        </div>
        <div className="cards">
          {steps.map((step, index) => (
            <div
              className="card"
              key={step.title}
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
            >
              <span className="stripe" />
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <span className="rail">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span>ESME · {step.title}</span>
              </span>
            </div>
          ))}
        </div>
        <canvas className="fx" ref={canvasRef} />
      </div>
      <p className="sr-only">
        {steps.map((step) => `${step.title}: ${step.body}`).join(' ')}
      </p>
    </div>
  );
};
