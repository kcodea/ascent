/**
 * The Quake's textures, painted ONCE per session on 2D canvases and kept (a few hundred KB of GPU memory in all). The
 * light textures (glow, spark, ring, streak, beam) are the Blast's own, shared; the ground ones are painted here.
 * Everything is white or grayscale, so every sprite tints it (the side colour, the chasm, the dust, the rock).
 *
 * Bold, clean shapes (owner bar 2026-09-28, "thicker and cleaner"), with a hand-painted feel (owner, same day: "i dont
 * like the cylinder/cones ... can you please add some more polish"): seven seeded, irregular rock SHARDS and four rock
 * chunks with lit and shadow faces, painted grain, a rim highlight and a bold outline; a soft lumpy dust puff.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroBlastTextures } from '../heroBlast/heroBlastTextures';
import type { HeroQuakeTextures } from './heroQuakeScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** A crack strip's cross-section: a bar along +X, crisp (the chasm, the lip) or soft (the magma seam, its glow). A strip
 *  mesh samples its middle column, so only the profile ACROSS the width matters. */
function paintCapsule(W: number, H: number, soft: boolean): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  if (soft) {
    // A soft bar: bright along the middle, feathered top, bottom and ends (the magma glow around a seam).
    const v = g.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-in';
    const h = g.createLinearGradient(0, 0, W, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.2, 'rgba(255,255,255,1)');
    h.addColorStop(0.8, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h; g.fillRect(0, 0, W, H);
    return k.c;
  }
  // A crisp bar: solid across the middle, feathered over ~2 px at each edge so a thin crack still anti-aliases.
  const v = g.createLinearGradient(0, 0, 0, H);
  const e = 2 / H;
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(e, 'rgba(255,255,255,1)');
  v.addColorStop(1 - e, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  return k.c;
}

/** A rock chunk: an irregular faceted polygon, lit from the top left, with a thick dark outline. Grayscale. */
function paintRock(D: number, seed: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  let s = seed;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = 7;
  const cx = D / 2, cy = D / 2, R = D * 0.4;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const r = R * (0.72 + rnd() * 0.28);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  const path = (): void => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); };
  // Base (the mid tone), then the lit facet (top left) and the shadow facet (bottom right), clipped to the chunk.
  path(); g.fillStyle = '#9a9086'; g.fill();
  g.save(); path(); g.clip();
  g.fillStyle = '#e9e2d8';
  g.beginPath(); g.moveTo(cx - R * 1.2, cy - R * 1.2); g.lineTo(cx + R * 0.5, cy - R * 1.2); g.lineTo(cx + R * 0.05, cy + R * 0.05); g.lineTo(cx - R * 1.2, cy + R * 0.3); g.closePath(); g.fill();
  g.fillStyle = '#4c443d';
  g.beginPath(); g.moveTo(cx + R * 1.2, cy - R * 0.1); g.lineTo(cx + R * 1.2, cy + R * 1.2); g.lineTo(cx - R * 0.5, cy + R * 1.2); g.lineTo(cx + R * 0.05, cy + R * 0.05); g.closePath(); g.fill();
  g.restore();
  g.save(); path(); g.clip(); grain(g, D, D, rnd, 24); g.restore();
  // A warm rim highlight on the lit upper-left edge, then the outline.
  g.save(); path(); g.clip();
  g.strokeStyle = 'rgba(255,246,226,0.8)'; g.lineWidth = D * 0.07;
  g.beginPath(); pts.forEach((p, i) => { if (p.x < cx + R * 0.2 && p.y < cy + R * 0.2) { if (i) g.lineTo(p.x + D * 0.03, p.y + D * 0.03); else g.moveTo(p.x + D * 0.03, p.y + D * 0.03); } }); g.stroke();
  g.restore();
  path(); g.lineJoin = 'round'; g.lineWidth = D * 0.07; g.strokeStyle = '#17110c'; g.stroke();
  return k.c;
}

/** A dust puff: a soft lumpy cloud (a few overlapping soft circles), white, feathered to nothing at its rim. */
function paintDust(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const blobs: [number, number, number][] = [[0.5, 0.55, 0.36], [0.34, 0.5, 0.26], [0.66, 0.48, 0.27], [0.5, 0.36, 0.26], [0.42, 0.64, 0.22], [0.6, 0.64, 0.22]];
  for (const [x, y, r] of blobs) {
    const gr = g.createRadialGradient(x * D, y * D, 0, x * D, y * D, r * D);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/** A thick soft ring (the dust shockwave rolling out from a slam): a feathered donut. */
function paintDustRing(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const r = D / 2;
  // A clear middle (so a ring started around a portrait never washes over the face), a thick soft band outside.
  const gr = k.g.createRadialGradient(r, r, r * 0.6, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

/** The scorched crater: a dark donut (clear in the middle, so the portrait is never covered) with a ragged rim. */
function paintScorch(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2;
  const gr = g.createRadialGradient(r, r, r * 0.3, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.38, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

/**
 * THE BOULDER (tiers I-III): one big faceted chunk, the hero element of the throw. Nine facets lit from the top left
 * (a bright face, two mid faces, a shadowed underside), a few dark fracture lines, and a THICK dark outline so it reads
 * as a bold silhouette on any board. Grayscale, tinted at draw.
 */
function paintBoulder(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  let s = 91;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const cx = D / 2, cy = D / 2, R = D * 0.42;
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.35;
    const r = R * (0.82 + rnd() * 0.18);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.92 };
  });
  const c = { x: cx - R * 0.12, y: cy - R * 0.14 }; // the facet apex, up-left (the lit side)
  const shade = (i: number): string => {
    const mid = (Math.atan2((pts[i]!.y + pts[(i + 1) % n]!.y) / 2 - cy, (pts[i]!.x + pts[(i + 1) % n]!.x) / 2 - cx));
    const light = 0.5 - 0.5 * Math.cos(mid - (-Math.PI * 0.75)); // 1 facing the light (up-left), 0 away
    const v = Math.round(62 + 180 * (1 - light));
    return `rgb(${v},${v - 4},${v - 10})`;
  };
  for (let i = 0; i < n; i++) {
    g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(pts[i]!.x, pts[i]!.y); g.lineTo(pts[(i + 1) % n]!.x, pts[(i + 1) % n]!.y); g.closePath();
    g.fillStyle = shade(i); g.fill();
  }
  // A few fracture lines across the faces.
  g.strokeStyle = 'rgba(28,20,14,0.75)'; g.lineWidth = D * 0.018; g.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = rnd() * Math.PI * 2, r0 = R * 0.15, r1 = R * (0.55 + rnd() * 0.3);
    g.beginPath(); g.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0);
    g.lineTo(c.x + Math.cos(a + 0.25) * r1 * 0.6, c.y + Math.sin(a + 0.25) * r1 * 0.6);
    g.lineTo(c.x + Math.cos(a - 0.1) * r1, c.y + Math.sin(a - 0.1) * r1); g.stroke();
  }
  const outline = (): void => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); };
  g.save(); outline(); g.clip(); grain(g, D, D, rnd, 160);
  g.strokeStyle = 'rgba(255,246,226,0.85)'; g.lineWidth = D * 0.045;
  g.beginPath(); pts.slice(5).concat(pts.slice(0, 2)).forEach((p, i) => (i ? g.lineTo(p.x + D * 0.02, p.y + D * 0.02) : g.moveTo(p.x + D * 0.02, p.y + D * 0.02))); g.stroke();
  g.restore();
  outline(); g.lineJoin = 'round'; g.lineWidth = D * 0.06; g.strokeStyle = '#140d08'; g.stroke();
  return k.c;
}

/** Hand-painted texture on a stone face: soft speckles (light and dark) and two faint strata lines, clipped by the
 *  caller. Seeded, so every variant keeps its own grain. */
function grain(g: CanvasRenderingContext2D, W: number, H: number, rnd: () => number, n: number): void {
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.6 + rnd() * 1.8;
    g.fillStyle = rnd() < 0.55 ? `rgba(20,14,8,${(0.1 + rnd() * 0.16).toFixed(3)})` : `rgba(255,248,232,${(0.08 + rnd() * 0.14).toFixed(3)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(30,20,12,0.16)'; g.lineWidth = Math.max(1, W * 0.02);
  for (let i = 0; i < 2; i++) {
    const y0 = H * (0.35 + 0.25 * i + (rnd() - 0.5) * 0.1);
    g.beginPath(); g.moveTo(0, y0); g.lineTo(W * 0.4, y0 + (rnd() - 0.5) * H * 0.05); g.lineTo(W, y0 + (rnd() - 0.5) * H * 0.08); g.stroke();
  }
}

/**
 * A ROCK SHARD (owner 2026-09-28, on the first spikes: "i dont like the cylinder/cones you put in here, it looks pretty
 * sloppy and obviously ai"): a jagged, IRREGULAR stone blade, tip up, base on the bottom edge (drawn with anchor
 * (0.5, 1) so it grows out of the ground). Every variant is seeded: its own lean, a broken shoulder on some, jagged
 * flanks, a kinked ridge splitting a LIT face from a SHADOW face, chipped facets near the tip, painted grain, a warm rim
 * highlight down the lit edge, a darkened foot (grounding) and a thick dark outline. Grayscale, tinted at draw.
 */
function paintShard(W: number, H: number, seed: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  let s = seed;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  type P = { x: number; y: number };
  const pad = W * 0.06;
  const lean = (rnd() - 0.5) * W * 0.3;
  const tipY = H * (0.03 + rnd() * 0.1);
  // Some tips are BROKEN (a short slanted break), not needles.
  const broken = rnd() < 0.45;
  const tipL: P = { x: W * 0.5 + lean - (broken ? W * (0.08 + rnd() * 0.06) : 0), y: tipY + (broken ? H * 0.05 * rnd() : 0) };
  const tipR: P = broken ? { x: tipL.x + W * (0.14 + rnd() * 0.08), y: tipY + H * (0.03 + rnd() * 0.06) } : { x: tipL.x + W * 0.06, y: tipY + H * 0.02 };
  const bl: P = { x: pad + rnd() * W * 0.08, y: H - 2 }, br: P = { x: W - pad - rnd() * W * 0.08, y: H - 2 };
  // Jagged flanks: 3-5 points each, alternating in and out (notches and ledges, never a straight side).
  const flank = (a: P, b: P, out: number): P[] => {
    const n = 3 + Math.floor(rnd() * 3);
    let flip = rnd() < 0.5 ? 1 : -1;
    return Array.from({ length: n }, (_, q) => {
      const u = (q + 1) / (n + 1) + (rnd() - 0.5) * 0.08;
      flip = -flip;
      // Ledges stick out, notches cut in shallow, and both shrink toward the tip (no needle, no bottle waist).
      const j = (flip > 0 ? 0.06 + rnd() * 0.08 : -(0.01 + rnd() * 0.03)) * W * out * (out < 0 ? 1 - 0.65 * u : 0.35 + 0.65 * u);
      return { x: a.x + (b.x - a.x) * u + j, y: a.y + (b.y - a.y) * u };
    });
  };
  const left = flank(bl, tipL, -1);
  const right = flank(tipR, br, 1);
  const foot = [0.75, 0.5, 0.25].map((u) => ({ x: bl.x + (br.x - bl.x) * u, y: H - 2 - rnd() * H * 0.025 }));
  const poly: P[] = [bl, ...left, tipL, tipR, ...right, br, ...foot];
  const path = (): void => { g.beginPath(); poly.forEach((p, q) => (q ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); };
  // THREE faces split by two kinked ridges from the tip: a lit left face, a mid front face, a shadowed right face.
  const top: P = { x: (tipL.x + tipR.x) / 2, y: (tipL.y + tipR.y) / 2 };
  const ridge = (u: number): P[] => {
    const b = { x: bl.x + (br.x - bl.x) * u, y: H };
    const m = { x: (top.x + b.x) / 2 + (rnd() - 0.5) * W * 0.14, y: top.y + (b.y - top.y) * (0.4 + rnd() * 0.2) };
    return [top, m, b];
  };
  const r1 = ridge(0.3 + rnd() * 0.1), r2 = ridge(0.62 + rnd() * 0.12);
  const face = (a: P[], b: P[], fill: CanvasGradient | string): void => {
    g.beginPath(); a.forEach((p, q) => (q ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); [...b].reverse().forEach((p) => g.lineTo(p.x, p.y)); g.closePath();
    g.fillStyle = fill; g.fill();
  };
  const grad = (c0: string, c1: string, c2: string): CanvasGradient => {
    const gr = g.createLinearGradient(0, 0, W * 0.2, H);
    gr.addColorStop(0, c0); gr.addColorStop(0.5, c1); gr.addColorStop(1, c2);
    return gr;
  };
  g.save(); path(); g.clip();
  const farL = [{ x: top.x, y: top.y }, { x: -W, y: H * 0.3 }, { x: -W, y: H + 2 }];
  const farR = [{ x: top.x, y: top.y }, { x: 2 * W, y: H * 0.3 }, { x: 2 * W, y: H + 2 }];
  face(farL, r1, grad('#fffaf0', '#e2d8c9', '#9a8f82'));   // lit
  face(r1, r2, grad('#d6cbbc', '#a99d8f', '#6a6056'));      // mid
  face(r2, farR, grad('#7d7369', '#554b42', '#2b231d'));    // shadow
  // Chipped planes near the top (light catching broken edges) and a few darker pits.
  for (let q = 0; q < 3; q++) {
    const cx = top.x + (rnd() - 0.6) * W * 0.3, cy = top.y + H * (0.1 + rnd() * 0.35);
    g.fillStyle = q < 2 ? `rgba(255,250,240,${(0.3 + rnd() * 0.3).toFixed(2)})` : 'rgba(30,20,12,0.35)';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + W * (0.1 + rnd() * 0.08), cy + H * 0.03); g.lineTo(cx + W * 0.02, cy + H * (0.06 + rnd() * 0.05)); g.closePath(); g.fill();
  }
  grain(g, W, H, rnd, 170);
  // A hairline fracture across the lit and mid faces.
  g.strokeStyle = 'rgba(40,26,16,0.5)'; g.lineWidth = W * 0.02;
  const fy = H * (0.4 + rnd() * 0.3);
  g.beginPath(); g.moveTo(W * 0.1, fy); g.lineTo(W * 0.32, fy - H * 0.04); g.lineTo(W * 0.5, fy + H * 0.015); g.lineTo(W * 0.62, fy - H * 0.02); g.stroke();
  // The ridges: soft dark folds between the faces.
  g.strokeStyle = 'rgba(40,28,18,0.35)'; g.lineWidth = W * 0.025;
  for (const r of [r1, r2]) { g.beginPath(); r.forEach((p, q) => (q ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); }
  // A darkened foot: the shard grounds into the dirt.
  const ft = g.createLinearGradient(0, H * 0.75, 0, H);
  ft.addColorStop(0, 'rgba(20,12,6,0)'); ft.addColorStop(1, 'rgba(20,12,6,0.6)');
  g.fillStyle = ft; g.fillRect(0, H * 0.75, W, H * 0.25);
  g.restore();
  // Rim highlight down the lit flank, then a bold outline (thicker at the foot, like an inked stroke).
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,246,226,0.85)'; g.lineWidth = W * 0.045;
  g.beginPath(); [bl, ...left, tipL].forEach((p, q) => (q ? g.lineTo(p.x + W * 0.035, p.y + 1) : g.moveTo(p.x + W * 0.035, p.y))); g.stroke();
  path(); g.lineWidth = W * 0.06; g.strokeStyle = '#140d08'; g.stroke();
  return k.c;
}

let cached: HeroQuakeTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the Quake then skips Pixi). */
export function heroQuakeTextures(): HeroQuakeTextures | null {
  if (cached) return cached;
  const light = heroBlastTextures();
  const crack = paintCapsule(8, 32, false), seamGlow = paintCapsule(64, 32, true);
  const rocks = [paintRock(48, 7), paintRock(48, 19), paintRock(48, 43), paintRock(48, 71)];
  const dust = paintDust(96), dustRing = paintDustRing(192), scorch = paintScorch(192);
  const boulder = paintBoulder(128);
  const shards = [11, 23, 37, 51, 67, 83, 97, 113].map((sd) => paintShard(96, 192, sd));
  if (!light || !crack || !seamGlow || rocks.some((r) => !r) || !dust || !dustRing || !scorch || !boulder || shards.some((x) => !x)) return null;
  cached = {
    ...light,
    crack: tex(crack), seamGlow: tex(seamGlow), rocks: rocks.map((r) => tex(r!)), dust: tex(dust), dustRing: tex(dustRing), scorch: tex(scorch),
    boulder: tex(boulder), shards: shards.map((x) => tex(x!)),
  };
  return cached;
}
