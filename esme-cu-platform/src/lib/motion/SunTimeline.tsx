import React, { useEffect, useRef, useState } from 'react';
import { SUN_FRAGMENT, SUN_VERTEX } from './sun-shader';
import { cappedDpr, isHeadlessDom, isLowPower, onPageVisibleChange, prefersReduced } from './env';
import { clampDt } from './spring';
import './sun.css';

/**
 * The recruitment journey as a scrubbable star.
 *
 * Ten stages, one ball that never changes size, and a page that is pure black so the halo can reach
 * exactly zero a short way off the limb. The stage *strings* are the chapter's; the ten LOOK tables
 * below belong to the shader and are not edited.
 *
 * Every interaction rule here serves one requirement: instantly responsive. A wheel tick, a dragged
 * pixel or a hover changes the state object, and the frame that follows draws it — there is no queue,
 * no debounce and no React render in the path.
 */

type Vec3 = [number, number, number];
type Look = {
  c0: Vec3;
  c1: Vec3;
  c2: Vec3;
  glow: Vec3;
  gI: number;
  freq: number;
  warp: number;
  cells: number;
  gas: number;
  shell: number;
  boil: number;
};

/** Stages 1..10, in order. Values verbatim from the brief. */
export const LOOK: Look[] = [
  { c0: [0.05, 0.01, 0.1], c1: [0.62, 0.12, 0.42], c2: [1.9, 0.85, 0.5], glow: [0.8, 0.25, 0.6], gI: 0.22, freq: 2.6, warp: 1.9, cells: 0, gas: 1, shell: 0, boil: 1 },
  { c0: [0.015, 0.004, 0], c1: [0.62, 0.05, 0.01], c2: [3, 1.1, 0.15], glow: [1.3, 0.2, 0.04], gI: 0.28, freq: 3.1, warp: 1.2, cells: 1, gas: 0, shell: 0, boil: 0.7 },
  { c0: [0.5, 0.05, 0], c1: [1.7, 0.48, 0.03], c2: [3.2, 2, 0.55], glow: [1.6, 0.5, 0.06], gI: 0.85, freq: 4.6, warp: 1.6, cells: 0.3, gas: 0, shell: 0, boil: 1.5 },
  { c0: [1, 0.26, 0.01], c1: [2.3, 1, 0.12], c2: [3.6, 2.9, 1.3], glow: [1.8, 0.68, 0.1], gI: 1, freq: 3.4, warp: 1.1, cells: 0, gas: 0, shell: 0, boil: 1.1 },
  { c0: [1.5, 0.72, 0.2], c1: [3, 2.1, 0.8], c2: [4.6, 4.3, 3.4], glow: [1.9, 1.2, 0.5], gI: 1.2, freq: 3.8, warp: 1.1, cells: 0, gas: 0, shell: 0, boil: 1.3 },
  { c0: [0.6, 0.1, 0.005], c1: [1.8, 0.5, 0.03], c2: [3, 1.5, 0.25], glow: [1.7, 0.42, 0.05], gI: 0.9, freq: 3, warp: 1.6, cells: 0.15, gas: 0, shell: 0, boil: 1.2 },
  { c0: [0.22, 0.008, 0.003], c1: [1.25, 0.1, 0.015], c2: [3, 0.95, 0.1], glow: [1.8, 0.16, 0.03], gI: 0.85, freq: 2, warp: 2.1, cells: 0.35, gas: 0, shell: 0, boil: 1.4 },
  { c0: [1.6, 0.8, 0.3], c1: [4, 3, 1.4], c2: [8, 7, 5.5], glow: [2.4, 1.6, 0.8], gI: 1.7, freq: 3.2, warp: 2, cells: 0, gas: 0, shell: 0, boil: 3 },
  { c0: [0.02, 0.09, 0.12], c1: [0.1, 0.7, 0.72], c2: [1.8, 0.42, 0.16], glow: [0.3, 0.7, 0.8], gI: 0.3, freq: 3.4, warp: 1.5, cells: 0, gas: 0.75, shell: 1, boil: 0.9 },
  { c0: [0.8, 1, 1.5], c1: [1.7, 2.1, 3], c2: [3.6, 4.2, 5.4], glow: [0.8, 1.2, 2.1], gI: 0.9, freq: 2.6, warp: 0.8, cells: 0, gas: 0, shell: 0, boil: 0.5 },
];

const LAST = 9;
const PER = 4;
const N = LAST * PER + 1; // 37
const START = 3;

export type JourneyStage = { when: string; label: string; sentence: string };

/** The strings that change; the ten LOOK tables above do not. */
export const RECRUITMENT_JOURNEY: JourneyStage[] = [
  { when: 'Every spring', label: 'Announcement', sentence: 'The chapter says who it is looking for.' },
  { when: 'Week one', label: 'Applications open', sentence: 'The form goes live for the whole faculty.' },
  { when: 'Open now', label: 'Application', sentence: 'You tell us who you are and where you want to work.' },
  { when: 'Week two', label: 'Screening', sentence: 'Every answer is read by the committee it belongs to.' },
  { when: 'Week three', label: 'Review', sentence: 'A second reviewer checks the first one’s score.' },
  { when: 'Week four', label: 'Interview', sentence: 'Thirty minutes, one technical question, one honest one.' },
  { when: 'Week five', label: 'Decision', sentence: 'The board agrees on a list and signs it.' },
  { when: 'Week six', label: 'Offer', sentence: 'You are told, in writing, that a seat has your name.' },
  { when: 'First meeting', label: 'Onboarding', sentence: 'Tools, mentors and the rules of the workshop.' },
  { when: 'Welcome', label: 'Welcome to ESME', sentence: 'You are part of the chapter from here on.' },
];

const cloneLook = (look: Look): Look => ({
  ...look,
  c0: [...look.c0] as Vec3,
  c1: [...look.c1] as Vec3,
  c2: [...look.c2] as Vec3,
  glow: [...look.glow] as Vec3,
});

const SCALARS = ['gI', 'freq', 'warp', 'cells', 'gas', 'shell', 'boil'] as const;
const COLORS = ['c0', 'c1', 'c2', 'glow'] as const;

type Props = {
  stages?: JourneyStage[];
  /** Re-labels the "applications open" stage with the live cycle window when one is known. */
  openStageWhen?: string;
  /** Where the applicant goes when they follow the journey to its end. */
  onApply?: () => void;
};

export const SunTimeline: React.FC<Props> = ({ stages = RECRUITMENT_JOURNEY, openStageWhen }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const ticksRef = useRef<HTMLDivElement | null>(null);
  /** null while the first frame decides, then true for the shader and false for the CSS ball. */
  const [mode, setMode] = useState<'gl' | 'static' | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const caption = captionRef.current;
    const track = trackRef.current;
    const ticksHost = ticksRef.current;
    if (!root || !canvas || !caption || !track || !ticksHost) return;

    const reduced = prefersReduced();
    const gl = isHeadlessDom() || isLowPower() ? null : canvas.getContext('webgl', { antialias: false, alpha: false });

    let program: WebGLProgram | null = null;
    let cleanupProgram: { gl: WebGLRenderingContext; program: WebGLProgram; buffer: WebGLBuffer } | null = null;
    const u: Record<string, WebGLUniformLocation | null> = {};
    if (gl) {
      const shader = (type: number, source: string) => {
        const handle = gl.createShader(type)!;
        gl.shaderSource(handle, source);
        gl.compileShader(handle);
        return handle;
      };
      program = gl.createProgram()!;
      gl.attachShader(program, shader(gl.VERTEX_SHADER, SUN_VERTEX));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, SUN_FRAGMENT));
      gl.linkProgram(program);
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(program, 'a');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

      for (const name of ['res', 'sc', 'rad', 'cy', 'fade', 't', 'evo', 'rot', 'blur', 'starX', 'freq', 'warp', 'cells', 'gas', 'shell', 'gI', 'flick', 'c0', 'c1', 'c2', 'glow']) {
        u[name] = gl.getUniformLocation(program, name);
      }
      cleanupProgram = { gl, program, buffer };
    }
    setMode(program ? 'gl' : 'static');

    const copy = stages.map((stage, index) => ({
      ...stage,
      when: index === 1 && openStageWhen ? openStageWhen : stage.when,
    }));

    const tickNodes: HTMLElement[] = [];
    ticksHost.replaceChildren();
    for (let j = 0; j < N; j += 1) {
      const tick = document.createElement('i');
      tickNodes.push(tick);
      ticksHost.append(tick);
    }
    const heights = new Array<number>(N).fill(0.28);
    const ends = Array.from(track.querySelectorAll<HTMLElement>('.sun-ends span'));

    const state = {
      x: START / LAST,
      stage: START,
      omega: 14, // the page opens on a whip
      rot: 0,
      evo: 0,
      starX: 0,
      blur: 0,
      lastInput: 0,
      hover: -1,
      dragX: null as number | null,
      dragLast: 0,
      nextAuto: 5000,
      cur: cloneLook(LOOK[START]),
    };

    // Rects are read on resize and on scroll, never inside the frame loop.
    let trackLeft = 0;
    let trackWidth = 1;
    let size = { w: 1, h: 1, sc: 1 };
    const measure = () => {
      const box = root.getBoundingClientRect();
      const bar = track.getBoundingClientRect();
      trackLeft = bar.left;
      trackWidth = bar.width || 1;
      const dpr = cappedDpr('webgl');
      size = {
        w: Math.max(1, Math.round(box.width * dpr)),
        h: Math.max(1, Math.round(box.height * dpr)),
        sc: Math.min(1, (box.width / Math.max(1, box.height)) * 1.5),
      };
      canvas.width = size.w;
      canvas.height = size.h;
      if (gl) gl.viewport(0, 0, size.w, size.h);
    };
    measure();

    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const px = (clientX: number) => clamp((clientX - trackLeft) / trackWidth);

    let line: HTMLElement | null = null;
    const setCaption = (index: number) => {
      const stage = copy[index] ?? copy[0];
      const next = document.createElement('div');
      next.className = 'line off';
      const heading = document.createElement('span');
      heading.className = 'when';
      heading.textContent = stage.when;
      const body = document.createElement('p');
      const bold = document.createElement('b');
      bold.textContent = stage.label;
      body.append(bold, document.createTextNode(stage.sentence));
      next.append(heading, body);
      caption.append(next);
      // Reading the offset forces layout: without it, adding and removing `.off` in one frame is a no-op.
      void next.offsetHeight;
      next.classList.remove('off');
      const previous = line;
      line = next;
      if (previous) {
        previous.classList.add('off');
        window.setTimeout(() => previous.remove(), 240);
      }
      track.setAttribute('aria-valuenow', String(index));
      track.setAttribute('aria-valuetext', `${stage.label} — ${stage.sentence}`);
      ends.forEach((end, endIndex) => end.classList.toggle('on', (endIndex === 0 && index === 0) || (endIndex === 1 && index === LAST)));
    };
    setCaption(START);

    const now = () => performance.now();
    const t0 = now();
    /** Everything that tracks time does so in milliseconds since the hero mounted. */
    const elapsed = () => now() - t0;

    const moveTo = (nx: number, at: number) => {
      const next = clamp(nx);
      state.omega += (next - state.x) * 150;
      state.x = next;
      state.lastInput = at;
    };

    const paint = (elapsed: number, dt: number) => {
      const f = (rate: number) => 1 - Math.exp(-dt * rate);
      const target = LOOK[state.stage];
      const step = f(reduced ? 60 : 13);
      for (const key of SCALARS) state.cur[key] += (target[key] - state.cur[key]) * step;
      for (const key of COLORS) {
        for (let i = 0; i < 3; i += 1) state.cur[key][i] += (target[key][i] - state.cur[key][i]) * step;
      }

      const spin = reduced ? 0 : 0.22 + state.omega;
      state.blur = Math.min(1.4, Math.abs(state.omega) * 0.1);
      if (!reduced) {
        state.rot += spin * dt;
        state.evo += dt * state.cur.boil * (1 + Math.abs(state.omega) * 0.1);
        state.starX += state.omega * dt * 0.012;
      }

      if (gl && program) {
        gl.useProgram(program);
        gl.uniform2f(u.res!, size.w, size.h);
        gl.uniform1f(u.sc!, size.sc);
        gl.uniform1f(u.rad!, 0.17);
        gl.uniform1f(u.cy!, 0.13);
        gl.uniform1f(u.fade!, Math.min(1, elapsed / 500));
        gl.uniform1f(u.t!, elapsed / 1000);
        gl.uniform1f(u.evo!, state.evo);
        gl.uniform1f(u.rot!, state.rot);
        gl.uniform1f(u.blur!, state.blur);
        gl.uniform1f(u.starX!, state.starX);
        gl.uniform1f(u.freq!, state.cur.freq);
        gl.uniform1f(u.warp!, state.cur.warp);
        gl.uniform1f(u.cells!, state.cur.cells);
        gl.uniform1f(u.gas!, state.cur.gas);
        gl.uniform1f(u.shell!, state.cur.shell);
        gl.uniform1f(u.gI!, state.cur.gI);
        gl.uniform1f(u.flick!, 1 + 0.1 * Math.sin((elapsed / 1000) * 2.1) + 0.06 * Math.sin((elapsed / 1000) * 5.3));
        gl.uniform3f(u.c0!, ...state.cur.c0);
        gl.uniform3f(u.c1!, ...state.cur.c1);
        gl.uniform3f(u.c2!, ...state.cur.c2);
        gl.uniform3f(u.glow!, ...state.cur.glow);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      const active = state.x * (N - 1);
      const bellAt = (state.hover >= 0 ? state.hover : state.x) * (N - 1);
      const tickStep = f(22);
      for (let j = 0; j < N; j += 1) {
        const q = j - bellAt;
        const bell = Math.exp((-q * q) / 5.5);
        const on = Math.exp(-((j - active) * (j - active)) / 0.22);
        const goal = Math.max((j % 4 ? 0.17 : 0.28) + bell * 0.55, on);
        heights[j] += (goal - heights[j]) * tickStep;
        tickNodes[j].style.transform = `scaleY(${heights[j].toFixed(3)})`;
        tickNodes[j].style.opacity = (0.3 + bell * 0.35 + on * 0.6).toFixed(3);
      }
    };

    /** One step of the machine: autoplay is skipped, a stage change still swaps the caption. */
    const advance = (elapsed: number, dt: number, allowAutoplay: boolean) => {
      if (allowAutoplay && !reduced && elapsed - state.lastInput > 5000 && elapsed > state.nextAuto) {
        const i = Math.round(state.x * LAST);
        state.x = ((i + 1) % (LAST + 1)) / LAST;
        state.omega += 9;
        state.nextAuto = elapsed + 2600;
      }
      const stage = Math.round(state.x * LAST);
      if (stage !== state.stage) {
        state.omega += state.omega >= 0 ? 7 : -7;
        state.stage = stage;
        setCaption(stage);
      }
      state.omega *= Math.exp(-dt * 3.6);
      paint(elapsed, dt);
    };

    const looping = Boolean(program) && !reduced;
    /** Outside the loop — reduced motion, or the CSS ball — a frame is drawn only when asked for. */
    const kick = () => {
      if (looping) return;
      const dt = 1 / 60;
      const stage = Math.round(state.x * LAST);
      if (stage !== state.stage) {
        state.stage = stage;
        setCaption(stage);
      }
      state.omega *= Math.exp(-dt * 3.6);
      paint(elapsed(), dt);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 0.012 : 0.00075;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      moveTo(state.x + delta * scale, elapsed());
      kick();
    };
    const onTrackMove = (event: PointerEvent) => {
      state.hover = px(event.clientX);
      if (event.pointerType === 'mouse' && state.dragX === null) {
        moveTo(state.hover, elapsed());
        kick();
      } else if (!looping) {
        kick();
      }
    };
    const onTrackLeave = () => {
      state.hover = -1;
      kick();
    };
    const onPointerDown = (event: PointerEvent) => {
      state.dragX = event.clientX;
      state.dragLast = event.clientX;
      if (track.contains(event.target as Node)) {
        moveTo(px(event.clientX), elapsed());
        kick();
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (state.dragX === null) return;
      if (track.contains(event.target as Node)) moveTo(px(event.clientX), elapsed());
      else moveTo(state.x + (event.clientX - state.dragLast) / Math.min(window.innerWidth, 900), elapsed());
      state.dragLast = event.clientX;
      kick();
    };
    const onPointerUp = () => {
      state.dragX = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      moveTo((Math.round(state.x * LAST) + direction) / LAST, elapsed());
      kick();
    };
    const onResize = () => {
      measure();
      kick();
    };

    // The wheel is taken on the hero, not on the window: a visitor who scrolls past the star has to
    // keep scrolling, or the animation has hijacked the rest of the page.
    root.addEventListener('wheel', onWheel, { passive: false });
    track.addEventListener('pointermove', onTrackMove);
    track.addEventListener('pointerleave', onTrackLeave);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    track.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);

    let raf = 0;
    let last = now();
    let onScreen = true;
    let pageVisible = typeof document === 'undefined' ? true : !document.hidden;

    const frame = (time: number) => {
      const dt = clampDt((time - last) / 1000);
      last = time;
      advance(time - t0, dt, true);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf || !looping || !onScreen || !pageVisible) return;
      last = now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            if (onScreen && pageVisible) start();
            else stop();
          });
    observer?.observe(root);
    const offVisibility = onPageVisibleChange((visible) => {
      pageVisible = visible;
      if (visible && onScreen) start();
      else stop();
    });

    // The first frame is drawn whether or not a loop is allowed to run: the ball is the hero.
    paint(0, 1 / 60);
    start();

    return () => {
      stop();
      observer?.disconnect();
      offVisibility();
      root.removeEventListener('wheel', onWheel);
      track.removeEventListener('pointermove', onTrackMove);
      track.removeEventListener('pointerleave', onTrackLeave);
      track.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize', onResize);
      if (cleanupProgram) {
        cleanupProgram.gl.deleteProgram(cleanupProgram.program);
        cleanupProgram.gl.deleteBuffer(cleanupProgram.buffer);
      }
    };
  }, [openStageWhen, stages]);

  return (
    <div ref={rootRef} className={`sun-hero ${mode === 'static' ? 'sun-static' : ''}`.trim()}>
      {mode === 'static' && <div className="sun-fallback" aria-hidden="true" />}
      <canvas ref={canvasRef} aria-hidden="true" hidden={mode === 'static'} />
      <div ref={captionRef} className="sun-caption" />
      <div
        ref={trackRef}
        className="sun-track"
        role="slider"
        tabIndex={0}
        aria-label="Recruitment journey"
        aria-valuemin={0}
        aria-valuemax={LAST}
        aria-valuenow={START}
      >
        <div ref={ticksRef} className="sun-ticks" aria-hidden="true" />
        <div className="sun-ends">
          <span>{stages[0]?.label}</span>
          <span>{stages[LAST]?.label}</span>
        </div>
      </div>
      <div className="sun-seam" aria-hidden="true" />
    </div>
  );
};
