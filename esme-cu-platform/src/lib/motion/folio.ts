import type * as Three from 'three';
import { isHeadlessDom, isLowPower, onPageVisibleChange, prefersReduced } from './env';
import { clampDt, stepSpring, type Spring } from './spring';

/**
 * FOLIO — a diagonal row of standing committee books, drawn in three.js and lifted by a pointer wave.
 *
 * Three is loaded by dynamic import, so a visitor who never reaches the departments section never
 * downloads a 3D engine, and a device that cannot give us a WebGL context (or asks for calm, or is
 * saving data) gets the CSS-3D row instead. Nothing here changes what is in the DOM: the books are a
 * picture of the committee list, and the list itself sits next to this canvas as real links.
 */

export type FolioItem = { id: string; name: string; code: string; accent: string };

export type FolioMount = {
  canvas: HTMLCanvasElement;
  host: HTMLElement;
  title: HTMLElement | null;
  items: FolioItem[];
  onOpen: (id: string) => void;
};

export type FolioHandle = { destroy: () => void };

const MIN_BOOKS = 12;
const CAMERA_LOOK: [number, number, number] = [-1.4, 0.05, -0.6];
const WAVE_SIGMA = 0.085;
const LIFT = 0.78;

/** At least a dozen books, however few committees exist, so the row overlaps and reads as a shelf. */
export function bookSequence(items: FolioItem[]): FolioItem[] {
  if (items.length === 0) return [];
  const count = Math.max(MIN_BOOKS, items.length * 2);
  return Array.from({ length: count }, (_, index) => items[index % items.length]);
}

function pageTexture(THREE: typeof import('three'), vertical: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#efe7d6';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#6b5335';
  ctx.lineWidth = 1;
  for (let i = 0; i < 256; i += 2) {
    ctx.globalAlpha = 0.05 + Math.random() * 0.12;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(i + 0.5, 0);
      ctx.lineTo(i + 0.5, 256);
    } else {
      ctx.moveTo(0, i + 0.5);
      ctx.lineTo(256, i + 0.5);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Cover art is drawn, not shipped: accent field, an ESME mark, and the committee's own name. */
function coverTexture(THREE: typeof import('three'), item: FolioItem, maxAnisotropy: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const base = new THREE.Color(item.accent);
  const gradient = ctx.createLinearGradient(0, 0, 256, 384);
  gradient.addColorStop(0, `rgb(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)})`);
  gradient.addColorStop(1, 'rgb(10,34,57)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 384);

  ctx.strokeStyle = 'rgba(245,154,22,.9)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(128, 64);
  ctx.lineTo(172, 132);
  ctx.lineTo(84, 132);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(128, 108, 58, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,.96)';
  ctx.font = '600 30px Newsreader, Georgia, serif';
  ctx.textAlign = 'center';
  const words = item.name.split(' ');
  let line = '';
  let y = 232;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > 210) {
      ctx.fillText(line, 128, y);
      y += 34;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, 128, y);

  ctx.font = '700 20px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#F59A16';
  ctx.fillText(item.code, 128, 348);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export async function mountFolio(mount: FolioMount): Promise<FolioHandle | null> {
  if (isHeadlessDom() || prefersReduced() || isLowPower()) return null;

  const THREE = await import('three');
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');

  let renderer: Three.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: mount.canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = environment.texture;

  const key = new THREE.DirectionalLight(0xfff3e4, 2.4);
  key.position.set(-4, 6, 6);
  const rim = new THREE.DirectionalLight(0xbfd2ff, 1.1);
  rim.position.set(6, 3, -4);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.12));

  const camera = new THREE.PerspectiveCamera(19.5, 1, 0.1, 100);
  camera.position.set(3.6, 2.15, 7.4);
  camera.lookAt(new THREE.Vector3(...CAMERA_LOOK));

  const size = () => {
    const box = mount.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    camera.fov = width < height || window.innerWidth <= 760 ? 40 : 19.5;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  size();

  const geometry = new THREE.BoxGeometry(1, 1.5, 0.2);
  const pagesH = pageTexture(THREE, false);
  const pagesV = pageTexture(THREE, true);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const textures: Three.Texture[] = [pagesH, pagesV].filter(Boolean) as Three.Texture[];

  const books = bookSequence(mount.items);
  const meshes: Three.Mesh[] = [];
  const springs: { lift: Spring; forward: Spring }[] = [];
  const screen = books.map(() => ({ x: 0, y: 0 }));
  const disposables: { dispose: () => void }[] = [geometry];

  books.forEach((item, index) => {
    const accent = new THREE.Color(item.accent);
    const side = accent.clone().multiplyScalar(0.62);
    const coverMap = coverTexture(THREE, item, maxAnisotropy);
    if (coverMap) textures.push(coverMap);
    const materials = [
      new THREE.MeshPhysicalMaterial({ map: pagesH ?? undefined, envMapIntensity: 0.55 }),
      new THREE.MeshPhysicalMaterial({ color: side, roughness: 0.55, clearcoat: 0.3, envMapIntensity: 0.55 }),
      new THREE.MeshPhysicalMaterial({ map: pagesV ?? undefined, envMapIntensity: 0.55 }),
      new THREE.MeshPhysicalMaterial({ map: pagesV ?? undefined, envMapIntensity: 0.55 }),
      new THREE.MeshPhysicalMaterial({
        map: coverMap ?? undefined,
        color: coverMap ? 0xffffff : accent,
        roughness: 0.42,
        clearcoat: 0.55,
        clearcoatRoughness: 0.35,
        envMapIntensity: 0.55,
      }),
      new THREE.MeshPhysicalMaterial({ color: side, roughness: 0.6, envMapIntensity: 0.55 }),
    ];
    materials.forEach((material) => disposables.push(material));

    const group = new THREE.Group();
    group.position.set(1.55 + index * -0.5, -1.12, 0.9 + index * -0.2);
    group.rotation.y = 0.32;
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.position.y = -3;
    group.add(mesh);
    scene.add(group);
    meshes.push(mesh);
    springs.push({ lift: { value: -3, velocity: 0 }, forward: { value: 0, velocity: 0 } });
  });

  if (mount.title) {
    mount.title.animate(
      [
        { opacity: 0, transform: 'translateY(4vh)', filter: 'blur(14px)' },
        { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
      ],
      { duration: 1400, delay: 150, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
    );
  }

  const pointer = { x: -1e4, y: -1e4, inside: false, coarse: window.matchMedia('(pointer: coarse)').matches };
  const onPointerMove = (event: PointerEvent) => {
    const box = mount.host.getBoundingClientRect();
    pointer.x = event.clientX - box.left;
    pointer.y = event.clientY - box.top;
    pointer.inside = true;
    lastMove = performance.now();
  };
  const onPointerLeave = () => {
    pointer.inside = false;
    pointer.x = -1e4;
    pointer.y = -1e4;
  };
  let lastMove = performance.now();
  const onWindowLeave = () => onPointerLeave();

  const onClick = (event: MouseEvent) => {
    const box = mount.host.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    screen.forEach((position, index) => {
      const distance = (position.x - x) ** 2 + (position.y - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    // Only a click that lands near a book opens something; the row is not a big invisible button.
    if (best >= 0 && bestDistance < 90 * 90) mount.onOpen(books[best].id);
  };

  mount.host.addEventListener('pointermove', onPointerMove);
  mount.host.addEventListener('pointerleave', onPointerLeave);
  mount.host.addEventListener('click', onClick);
  window.addEventListener('blur', onWindowLeave);

  const probe = new THREE.Vector3();
  const write = (index: number) => {
    const mesh = meshes[index];
    probe.set(0, 0.1, 0);
    mesh.localToWorld(probe);
    probe.project(camera);
    const box = rect;
    screen[index].x = ((probe.x + 1) / 2) * box.width;
    screen[index].y = ((1 - probe.y) / 2) * box.height;
  };

  let rect = mount.host.getBoundingClientRect();
  const onResize = () => {
    rect = mount.host.getBoundingClientRect();
    size();
  };
  window.addEventListener('resize', onResize);

  const startedAt = performance.now();
  let raf = 0;
  let last = performance.now();
  let onScreen = true;
  let pageVisible = !document.hidden;

  const frame = (time: number) => {
    const dt = clampDt((time - last) / 1000);
    last = time;
    const elapsed = (time - startedAt) / 1000;
    const sigma = Math.max(window.innerWidth, window.innerHeight) * WAVE_SIGMA;

    // Idle or coarse pointers get a virtual cursor that sweeps the row, so the wave is never static.
    const idle = elapsed - (lastMove - startedAt) / 1000 > 4;
    const virtual = pointer.coarse || !pointer.inside || idle;
    let cx = pointer.x;
    let cy = pointer.y;
    if (virtual) {
      const u = (Math.sin(elapsed * 0.45) + 1) / 2;
      const a = screen[Math.max(0, books.length - 3)] ?? screen[0];
      const b = screen[1] ?? a;
      cx = a.x + (b.x - a.x) * u;
      cy = a.y + (b.y - a.y) * u;
    }

    meshes.forEach((mesh, index) => {
      // A book stays below the stage until its turn, so the row rises back-to-front.
      const risen = elapsed > 0.25 + (meshes.length - index) * 0.035;
      write(index);
      const dx = screen[index].x - cx;
      const dy = (screen[index].y - cy) * 0.55;
      const influence = risen ? Math.exp(-(dx * dx + dy * dy) / (sigma * sigma)) : 0;
      const lift = LIFT * influence;
      const spring = springs[index];
      stepSpring(spring.lift, risen ? lift : -3, { k: 70, c: 12.5, subSteps: 4 }, dt);
      stepSpring(spring.forward, lift * 0.35, { k: 70, c: 12.5, subSteps: 4 }, dt);
      mesh.position.y = spring.lift.value;
      mesh.position.z = spring.forward.value;
      mesh.rotation.x = -spring.lift.velocity * 0.012;
    });

    renderer.render(scene, camera);
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
  const observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          onScreen = entries.some((entry) => entry.isIntersecting);
          if (onScreen) start();
          else stop();
        });
  observer?.observe(mount.host);
  const offVisibility = onPageVisibleChange((visible) => {
    pageVisible = visible;
    if (visible) start();
    else stop();
  });

  rect = mount.host.getBoundingClientRect();
  // One frame is drawn even before the observer reports: the shelf should exist the moment it is seen.
  frame(performance.now());
  start();

  return {
    destroy: () => {
      stop();
      observer?.disconnect();
      offVisibility();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onWindowLeave);
      mount.host.removeEventListener('pointermove', onPointerMove);
      mount.host.removeEventListener('pointerleave', onPointerLeave);
      mount.host.removeEventListener('click', onClick);
      textures.forEach((texture) => texture.dispose());
      disposables.forEach((item) => item.dispose());
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
