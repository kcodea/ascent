/**
 * The Frost attack's textures, painted ONCE per session on 2D canvases and kept (about 700 KB of GPU memory on top of
 * the Blast's and Arcana's, which it shares: glow, spark, streak, ring, the ribbon strips and the glitter star).
 * Everything is white or grey, so every sprite and strip tints it.
 *
 * THE ICICLE is five textures painted on ONE box (192 x 48) with the TIP at the same spot (x 188, the middle), so five
 * sprites on one transform make one icicle, each tinted its own colour (the owner rejected flat cones and cylinders as
 * "obviously AI"):
 *  - the BODY: a faceted crystal spear, never a cone. Four long facets run to the point (a lit top facet, two mid
 *    facets, a darker underside), a cleavage sliver near the tip, and a jagged, broken crystal butt with two small spurs
 *    growing back off it. Each facet has its own grey and its own translucency, so one pale cyan tint reads as cut ice.
 *  - the CORE: the deeper glacier-blue heart along the spine, with hairline fractures and a few trapped bubbles.
 *  - the RIM: the frosty edge (a crisp outline, rime crystals clinging to it, thickest at the frosted butt).
 *  - the SPEC: the white-hot specular edge along the top and the upper ridge, with two glints.
 *  - the GLOW: the whole silhouette blurred (the cold aura on a dark board).
 *
 * The rest are line work and soft masses: three faceted shards, a six-armed snowflake, a hexagonal frost rune, a lumpy
 * snow puff, a frost fern (a dendrite with branches at 60 degrees, the way real frost grows), the nova's wave-front
 * band and its leading-edge line, a cracked ice sheet for the frozen ground, a faceted ice shell for the encasement, its
 * spreading cracks, and a rime ring for the frost creeping over a portrait's edge. Scatter is seeded, so every session
 * paints the same ice.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import type { HeroFrostTextures } from './heroFrostScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

// ─── the icicle ────────────────────────────────────────────────────────────────────────────────────────────────

/** The icicle box: 192 x 48, the tip at (188, 24). The scene anchors every icicle sprite at the tip. */
export const ICE_W = 192;
export const ICE_H = 48;
export const ICE_TIP_X = 188;
/** Tip to the back of the butt, in texture px (a sprite's length in px = this x its x scale). */
export const ICE_LEN_PX = 182;

type P = [number, number];
const CY = ICE_H / 2;
const TIP: P = [ICE_TIP_X, CY];
// The silhouette: widest a third of the way back, a jagged broken butt (slightly lopsided, like real ice).
const WT: P = [64, CY - 12.5], WB: P = [72, CY + 11];
const BUTT: P[] = [[27, CY - 11], [15, CY - 8], [21, CY - 4], [7, CY], [18, CY + 3.5], [11, CY + 7.5], [25, CY + 10]];
// Ridges running from the tip back to the butt (upper, main, lower).
const RU: P[] = [[66, CY - 6], [28, CY - 5]];
const RM: P[] = [[70, CY + 0.5], [20, CY]];
const RL: P[] = [[73, CY + 6], [24, CY + 5.5]];
// Two small crystal spurs growing back off the butt (a crystal cluster's silhouette, not a cone's).
const SPUR_T: P[] = [[40, CY - 11.5], [18, CY - 19], [30, CY - 10]];
const SPUR_B: P[] = [[44, CY + 10.5], [26, CY + 16], [36, CY + 9]];

function poly(g: CanvasRenderingContext2D, pts: readonly P[]): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}

const OUTLINE: P[] = [TIP, WT, ...BUTT, WB];

function silhouette(g: CanvasRenderingContext2D): void {
  poly(g, OUTLINE);
  g.fill();
  poly(g, SPUR_T); g.fill();
  poly(g, SPUR_B); g.fill();
}

/** The faceted body: every facet its own grey and opacity (lit top, mid, mid-dark, dark underside), so one tint reads as cut ice. */
function paintIceBody(): HTMLCanvasElement | null {
  const k = canvas(ICE_W, ICE_H); if (!k) return null;
  const g = k.g;
  g.save();
  poly(g, OUTLINE); g.clip();
  const facets: [P[], number, number][] = [
    [[TIP, WT, BUTT[0]!, RU[1]!, RU[0]!], 255, 0.95],
    [[TIP, RU[0]!, RU[1]!, [16, CY - 2], RM[1]!, RM[0]!], 214, 0.72],
    [[TIP, RM[0]!, RM[1]!, [16, CY + 3], RL[1]!, RL[0]!], 168, 0.66],
    [[TIP, RL[0]!, RL[1]!, BUTT[BUTT.length - 1]!, WB], 118, 0.86],
  ];
  // The broken butt behind it all: a frosted grey.
  g.fillStyle = 'rgba(200,200,200,0.8)'; g.fillRect(0, 0, 40, ICE_H);
  for (const [pts, v, a] of facets) { g.fillStyle = `rgba(${v},${v},${v},${a})`; poly(g, pts); g.fill(); }
  // Along each facet the ice clears toward the point (thin ice is more transparent), then the tip itself is lit.
  g.globalCompositeOperation = 'destination-out';
  const clear = g.createLinearGradient(40, 0, ICE_TIP_X, 0);
  clear.addColorStop(0, 'rgba(0,0,0,0)'); clear.addColorStop(0.55, 'rgba(0,0,0,0.12)'); clear.addColorStop(1, 'rgba(0,0,0,0.05)');
  g.fillStyle = clear; g.fillRect(0, 0, ICE_W, ICE_H);
  g.globalCompositeOperation = 'source-over';
  // The cleavage sliver near the point (a flat face catching the light) and a second, darker one below it.
  g.fillStyle = 'rgba(255,255,255,0.9)'; poly(g, [TIP, [138, CY - 4.5], [150, CY - 0.5]]); g.fill();
  g.fillStyle = 'rgba(140,140,140,0.6)'; poly(g, [TIP, [150, CY - 0.5], [132, CY + 3.8]]); g.fill();
  // Facet edges: thin light lines where the faces meet.
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.9; g.lineJoin = 'round';
  for (const r of [RU, RM, RL]) { g.beginPath(); g.moveTo(TIP[0], TIP[1]); for (const [x, y] of r) g.lineTo(x, y); g.stroke(); }
  g.restore();
  // The spurs: small crystals of their own (a lit face and a dark face).
  for (const s of [SPUR_T, SPUR_B]) {
    g.fillStyle = 'rgba(235,235,235,0.9)'; poly(g, s); g.fill();
    g.fillStyle = 'rgba(150,150,150,0.7)'; poly(g, [s[0]!, s[1]!, [(s[0]![0] + s[2]![0]) / 2, (s[0]![1] + s[2]![1]) / 2]]); g.fill();
  }
  return k.c;
}

/** The deep core: the glacier-blue heart along the spine, hairline fractures and a few trapped bubbles. */
function paintIceCore(): HTMLCanvasElement | null {
  const k = canvas(ICE_W, ICE_H); if (!k) return null;
  const g = k.g;
  g.save();
  poly(g, OUTLINE); g.clip();
  g.shadowColor = '#fff'; g.shadowBlur = 3;
  const sp = g.createLinearGradient(20, 0, 170, 0);
  sp.addColorStop(0, 'rgba(255,255,255,0.95)'); sp.addColorStop(0.6, 'rgba(255,255,255,0.8)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp;
  g.beginPath();
  g.moveTo(22, CY - 3); g.quadraticCurveTo(60, CY - 6.5, 168, CY - 0.4); g.lineTo(168, CY + 0.6); g.quadraticCurveTo(66, CY + 6, 20, CY + 3.5);
  g.closePath(); g.fill();
  g.shadowBlur = 0;
  // Fractures: hairlines across the ice at a slant, and one long seam.
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 0.8;
  const cracks: [P, P][] = [[[48, CY - 9], [58, CY + 4]], [[84, CY - 6], [92, CY + 7]], [[112, CY - 3], [106, CY + 5]], [[62, CY + 2], [75, CY + 8]]];
  for (const [a, b] of cracks) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  g.beginPath(); g.moveTo(30, CY + 7); g.lineTo(70, CY + 3); g.lineTo(122, CY + 2.2); g.stroke();
  // Bubbles.
  g.lineWidth = 0.7;
  for (const [x, y, r] of [[54, CY - 2, 1.6], [79, CY + 2.5, 1.1], [98, CY - 1.5, 0.9], [44, CY + 4, 1.2]] as const) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  }
  g.restore();
  return k.c;
}

/** The frosty rim: a crisp outline and rime crystals clinging to it, thickest at the frosted butt. */
function paintIceRim(): HTMLCanvasElement | null {
  const k = canvas(ICE_W, ICE_H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(7);
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 1.3; g.lineJoin = 'round';
  poly(g, OUTLINE); g.stroke();
  g.lineWidth = 1; poly(g, SPUR_T); g.stroke(); poly(g, SPUR_B); g.stroke();
  // Rime: tiny crystals along the outline, denser toward the butt.
  g.fillStyle = '#fff';
  for (let s = 0; s < OUTLINE.length; s++) {
    const [x0, y0] = OUTLINE[s]!, [x1, y1] = OUTLINE[(s + 1) % OUTLINE.length]!;
    const L = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / (L || 1), ny = (x1 - x0) / (L || 1);
    for (let d = 0; d < L; d += 3) {
      const x = x0 + ((x1 - x0) * d) / L, y = y0 + ((y1 - y0) * d) / L;
      const dens = x < 60 ? 0.75 : x < 120 ? 0.3 : 0.08;
      if (rnd() > dens) continue;
      const off = (rnd() - 0.4) * 2.2;
      const sz = 0.5 + rnd() * (x < 60 ? 1.3 : 0.7);
      g.globalAlpha = 0.55 + rnd() * 0.45;
      g.beginPath(); g.arc(x + nx * off, y + ny * off, sz, 0, Math.PI * 2); g.fill();
    }
  }
  // The frosted, broken butt: a veil of rime.
  g.globalAlpha = 0.45;
  g.save(); poly(g, OUTLINE); g.clip();
  const fr = g.createLinearGradient(6, 0, 46, 0);
  fr.addColorStop(0, 'rgba(255,255,255,1)'); fr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fr; g.fillRect(0, 0, 50, ICE_H);
  g.restore();
  g.globalAlpha = 1;
  return k.c;
}

/** The specular edge: a white-hot line along the top edge and the upper ridge, and two glints. */
function paintIceSpec(): HTMLCanvasElement | null {
  const k = canvas(ICE_W, ICE_H); if (!k) return null;
  const g = k.g;
  g.lineCap = 'round';
  const line = (a: P, b: P, w: number, a0: number, a1: number): void => {
    const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
    gr.addColorStop(0, `rgba(255,255,255,${a0})`); gr.addColorStop(1, `rgba(255,255,255,${a1})`);
    g.strokeStyle = gr; g.lineWidth = w;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  };
  line([60, CY - 11.6], [ICE_TIP_X - 1, CY - 0.4], 1.8, 0.35, 1);
  line([96, CY - 3.8], [ICE_TIP_X - 3, CY - 0.2], 1.1, 0, 0.9);
  line([138, CY - 4.2], [150, CY - 0.6], 1.2, 0.9, 0.6);
  const glint = (x: number, y: number, r: number): void => {
    const gl = g.createRadialGradient(x, y, 0, x, y, r);
    gl.addColorStop(0, 'rgba(255,255,255,1)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl; g.fillRect(x - r, y - r, r * 2, r * 2);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(x - r * 1.4, y); g.lineTo(x, y - 0.6); g.lineTo(x + r * 1.4, y); g.lineTo(x, y + 0.6); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + 0.6, y); g.lineTo(x, y + r); g.lineTo(x - 0.6, y); g.closePath(); g.fill();
  };
  glint(98, CY - 9.3, 4.5);
  glint(160, CY - 2.2, 3.5);
  return k.c;
}

/** The icicle's glow: the whole silhouette, blurred. */
function paintIceGlow(): HTMLCanvasElement | null {
  const k = canvas(ICE_W, ICE_H); if (!k) return null;
  const g = k.g;
  g.shadowColor = '#fff'; g.shadowBlur = 9;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  silhouette(g);
  return k.c;
}

// ─── shards, flakes and the rune ───────────────────────────────────────────────────────────────────────────────

/** A shard: an irregular crystal fragment, two facets (lit and dark) and a crisp white edge. */
function paintShard(D: number, pts: readonly P[]): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const S = (p: P): P => [p[0] * D, p[1] * D];
  const ps = pts.map(S);
  g.fillStyle = 'rgba(210,210,210,0.85)'; poly(g, ps); g.fill();
  // The lit facet: from the first vertex to the middle of the far edge.
  const mid: P = [(ps[2]![0] + ps[3 % ps.length]![0]) / 2, (ps[2]![1] + ps[3 % ps.length]![1]) / 2];
  g.fillStyle = 'rgba(255,255,255,0.95)'; poly(g, [ps[0]!, ps[1]!, ps[2]!, mid]); g.fill();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = D * 0.04; g.lineJoin = 'round';
  poly(g, ps); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = D * 0.025;
  g.beginPath(); g.moveTo(ps[0]![0], ps[0]![1]); g.lineTo(mid[0], mid[1]); g.stroke();
  return k.c;
}

/** A six-armed snowflake: each arm with two pairs of branches at 60 degrees, a small hexagon at the heart. */
function paintFlake(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.03;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const ux = Math.cos(a), uy = Math.sin(a);
    g.lineWidth = D * 0.04;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c + ux * D * 0.45, c + uy * D * 0.45); g.stroke();
    g.lineWidth = D * 0.03;
    for (const [at, len] of [[0.2, 0.15], [0.32, 0.11]] as const) {
      const bx = c + ux * D * at, by = c + uy * D * at;
      for (const s of [-1, 1]) {
        const b = a + s * (Math.PI / 3);
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * D * len, by + Math.sin(b) * D * len); g.stroke();
      }
    }
  }
  g.lineWidth = D * 0.03;
  g.beginPath();
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI * 2; const x = c + Math.cos(a) * D * 0.08, y = c + Math.sin(a) * D * 0.08; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
  return k.c;
}

/** The frost rune: a thin outer circle, a bold hexagon, a snowflake inscribed, a rotated inner hexagon and rime dots. */
function paintRune(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.02;
  const hex = (r: number, off: number, w: number): void => {
    g.lineWidth = w; g.beginPath();
    for (let i = 0; i <= 6; i++) { const a = off + (i / 6) * Math.PI * 2; const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  };
  g.lineWidth = D * 0.012; g.beginPath(); g.arc(c, c, D * 0.46, 0, Math.PI * 2); g.stroke();
  hex(D * 0.41, -Math.PI / 2, D * 0.03);
  hex(D * 0.2, 0, D * 0.018);
  // Twelve ticks round the outer circle (long on the hexagon's corners).
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
    const r0 = D * (i % 2 ? 0.43 : 0.415), r1 = D * 0.47;
    g.lineWidth = D * (i % 2 ? 0.01 : 0.016);
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
  // The inscribed snowflake: arms to the hexagon's corners with branches.
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    const ux = Math.cos(a), uy = Math.sin(a);
    g.lineWidth = D * 0.016;
    g.beginPath(); g.moveTo(c + ux * D * 0.05, c + uy * D * 0.05); g.lineTo(c + ux * D * 0.38, c + uy * D * 0.38); g.stroke();
    g.lineWidth = D * 0.012;
    for (const [at, len] of [[0.26, 0.07], [0.33, 0.045]] as const) {
      const bx = c + ux * D * at, by = c + uy * D * at;
      for (const s of [-1, 1]) {
        const b = a + s * (Math.PI / 3);
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * D * len, by + Math.sin(b) * D * len); g.stroke();
      }
    }
    g.beginPath(); g.arc(c + Math.cos(a + Math.PI / 6) * D * 0.3, c + Math.sin(a + Math.PI / 6) * D * 0.3, D * 0.012, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A snow puff: a lumpy billow (overlapping soft lobes), bright on top, never a perfect disc. */
function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(31);
  const c = D / 2;
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = D * (0.05 + rnd() * 0.17);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r * 0.8;
    const R = D * (0.16 + rnd() * 0.13);
    const gr = g.createRadialGradient(x, y - R * 0.25, 0, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.55, 'rgba(236,236,236,0.45)'); gr.addColorStop(1, 'rgba(210,210,210,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/**
 * A frost fern: a dendrite growing from its root at the LEFT middle (x 3) to the right, with branches at 60 degrees
 * that shorten toward the tip, and twigs off the longest branches (the way window frost grows).
 */
export const FERN_W = 128;
export const FERN_H = 64;
function paintFern(): HTMLCanvasElement | null {
  const k = canvas(FERN_W, FERN_H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(11);
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 1.5;
  const cy = FERN_H / 2;
  const L = FERN_W - 8;
  const stem = (t: number): P => [3 + L * t, cy + Math.sin(t * 2.6) * 2.2];
  g.lineWidth = 2;
  g.beginPath(); for (let i = 0; i <= 24; i++) { const [x, y] = stem(i / 24); if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
  for (let i = 1; i < 14; i++) {
    const t = i / 14;
    const [bx, by] = stem(t);
    const len = (1 - t) * 26 + 4 + rnd() * 3;
    for (const s of [-1, 1]) {
      const a = s * (Math.PI / 3) * (0.85 + rnd() * 0.3);
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      g.lineWidth = 1.4 * (1 - t * 0.5);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
      if (len > 12) {
        for (const tt of [0.45, 0.72]) {
          const tx = bx + (ex - bx) * tt, ty = by + (ey - by) * tt;
          const tl = len * (1 - tt) * 0.55;
          for (const s2 of [-1, 1]) {
            const b = a + s2 * (Math.PI / 3);
            g.lineWidth = 0.9;
            g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + Math.cos(b) * tl, ty + Math.sin(b) * tl); g.stroke();
          }
        }
      }
    }
  }
  return k.c;
}

// ─── the nova ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The nova's wave-front band: U runs ALONG the front (its two ends fade), V ACROSS it, from the leading edge (v 0, a
 * bright rime line) back into a wind-swept frost wall that fades behind (streaks along the travel, rime dots).
 */
function paintNovaBody(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(5);
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(255,255,255,0.95)'); v.addColorStop(0.06, 'rgba(255,255,255,0.85)'); v.addColorStop(0.2, 'rgba(240,240,240,0.55)');
  v.addColorStop(0.55, 'rgba(225,225,225,0.25)'); v.addColorStop(1, 'rgba(210,210,210,0)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  // Wind-swept streaks, back from the front edge.
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W, l = H * (0.2 + rnd() * 0.7), a = 0.25 + rnd() * 0.5;
    const gr = g.createLinearGradient(0, 0, 0, l);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = gr; g.lineWidth = 0.6 + rnd() * 1.4;
    g.beginPath(); g.moveTo(x, rnd() * H * 0.1); g.lineTo(x + (rnd() - 0.5) * 6, l); g.stroke();
  }
  g.fillStyle = '#fff';
  for (let i = 0; i < 90; i++) {
    const y = Math.pow(rnd(), 1.8) * H;
    g.globalAlpha = 0.4 + rnd() * 0.6;
    g.beginPath(); g.arc(rnd() * W, y, 0.5 + rnd() * 1.2, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.16, 'rgba(255,255,255,1)'); h.addColorStop(0.84, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = h; g.fillRect(0, 0, W, H);
  return k.c;
}

/** The nova's leading edge: a thin line of biting cold light (v near 0.3) in a soft bell, the ends fading. */
function paintNovaEdge(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.2, 'rgba(255,255,255,0.5)'); v.addColorStop(0.32, 'rgba(255,255,255,1)');
  v.addColorStop(0.44, 'rgba(255,255,255,0.5)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.2, 'rgba(255,255,255,1)'); h.addColorStop(0.8, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = h; g.fillRect(0, 0, W, H);
  return k.c;
}

/**
 * The frozen ground: a sheet of ice along the nova's path (U along it, V across). Feathered, rime-thick edges, a
 * translucent middle, and a network of white cracks (long jagged seams along the path, short ones branching off).
 */
function paintSheet(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(23);
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.1, 'rgba(255,255,255,0.7)'); v.addColorStop(0.24, 'rgba(235,235,235,0.42)');
  v.addColorStop(0.5, 'rgba(220,220,220,0.32)'); v.addColorStop(0.76, 'rgba(235,235,235,0.42)'); v.addColorStop(0.9, 'rgba(255,255,255,0.7)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  // Long seams along the sheet.
  for (let s = 0; s < 5; s++) {
    let x = rnd() * 40, y = H * (0.25 + rnd() * 0.5);
    g.lineWidth = 1 + rnd() * 0.8; g.globalAlpha = 0.55 + rnd() * 0.35;
    g.beginPath(); g.moveTo(x, y);
    while (x < W) {
      x += 14 + rnd() * 30; y = Math.min(H * 0.85, Math.max(H * 0.15, y + (rnd() - 0.5) * 22));
      g.lineTo(x, y);
      if (rnd() < 0.45) {
        // A branch crack.
        const bx = x, by = y, a = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.9), l = 10 + rnd() * 26;
        g.moveTo(bx, by); g.lineTo(bx + Math.cos(a) * l, by + Math.sin(a) * l); g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  // Rime crystals thick at the edges.
  g.fillStyle = '#fff';
  for (let i = 0; i < 420; i++) {
    const e = rnd() < 0.5 ? rnd() * 0.18 : 1 - rnd() * 0.18;
    g.globalAlpha = 0.4 + rnd() * 0.6;
    g.beginPath(); g.arc(rnd() * W, e * H, 0.6 + rnd() * 1.3, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  // Fade in at the hero's end (U 0).
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.06, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = h; g.fillRect(0, 0, W, H);
  return k.c;
}

/** The ice shell over an encased portrait: faceted like a cut gem (a hexagonal crown, a ring of facets), bright edges, a clear middle. */
function paintShell(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(17);
  const c = D / 2, R = D * 0.47;
  const ring = (r: number, n: number, off: number): P[] => Array.from({ length: n }, (_, i) => { const a = off + (i / n) * Math.PI * 2; return [c + Math.cos(a) * r, c + Math.sin(a) * r] as P; });
  const inner = ring(R * 0.34, 6, -Math.PI / 2);
  const mid = ring(R * 0.72, 12, -Math.PI / 2 + Math.PI / 12);
  const outer = ring(R, 12, -Math.PI / 2);
  g.lineJoin = 'round';
  const facet = (pts: P[], lit: number, a: number): void => { g.fillStyle = `rgba(${lit},${lit},${lit},${a})`; poly(g, pts); g.fill(); };
  // The crown: the clearest ice, over the face.
  facet(inner, 250, 0.16);
  for (let i = 0; i < 12; i++) {
    const a = inner[Math.floor(i / 2) % 6]!, b = inner[Math.floor((i + 1) / 2) % 6]!;
    const lit = 150 + Math.round(rnd() * 105);
    facet([a, mid[i]!, mid[(i + 1) % 12]!, b].filter((p, j, arr) => j === 0 || p !== arr[j - 1]), lit, 0.2 + rnd() * 0.18);
    facet([mid[i]!, outer[(i + 1) % 12]!, mid[(i + 1) % 12]!], 150 + Math.round(rnd() * 105), 0.35 + rnd() * 0.25);
    facet([mid[i]!, outer[i]!, outer[(i + 1) % 12]!], 140 + Math.round(rnd() * 115), 0.45 + rnd() * 0.25);
  }
  // A light from the top-left: the upper-left facets brighter.
  const sh = g.createLinearGradient(c - R, c - R, c + R, c + R);
  sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(120,120,120,0.2)');
  g.fillStyle = sh; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  // Edges.
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = D * 0.006;
  poly(g, inner); g.stroke();
  for (let i = 0; i < 12; i++) {
    g.beginPath(); g.moveTo(mid[i]![0], mid[i]![1]); g.lineTo(outer[i]![0], outer[i]![1]); g.lineTo(mid[(i + 11) % 12]![0], mid[(i + 11) % 12]![1]); g.stroke();
    g.beginPath(); g.moveTo(mid[i]![0], mid[i]![1]); g.lineTo(inner[Math.floor(i / 2) % 6]![0], inner[Math.floor(i / 2) % 6]![1]); g.stroke();
  }
  poly(g, mid); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = D * 0.014;
  g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
  // Rime on the rim.
  g.fillStyle = '#fff';
  for (let i = 0; i < 160; i++) {
    const a = rnd() * Math.PI * 2, r = R * (0.9 + rnd() * 0.12);
    g.globalAlpha = 0.4 + rnd() * 0.6;
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, D * (0.003 + rnd() * 0.006), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  return k.c;
}

/** The encasement's cracks: jagged fractures radiating from a point just off the middle, branching as they go. */
function paintCracks(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(29);
  const c = D / 2;
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.008;
  const ox = c + D * 0.04, oy = c - D * 0.03;
  for (let i = 0; i < 9; i++) {
    let a = (i / 9) * Math.PI * 2 + (rnd() - 0.5) * 0.4;
    let x = ox, y = oy;
    const reach = D * (0.34 + rnd() * 0.12);
    g.lineWidth = D * 0.012;
    g.beginPath(); g.moveTo(x, y);
    let d = 0;
    while (d < reach) {
      const st = D * (0.035 + rnd() * 0.05);
      a += (rnd() - 0.5) * 0.7; x += Math.cos(a) * st; y += Math.sin(a) * st; d += st;
      g.lineTo(x, y);
      if (rnd() < 0.35 && d < reach * 0.8) {
        const b = a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6), l = D * (0.04 + rnd() * 0.07);
        g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); g.moveTo(x, y);
      }
    }
    g.stroke();
  }
  // The impact star at the origin.
  g.lineWidth = D * 0.008;
  for (let i = 0; i < 6; i++) { const a = rnd() * Math.PI * 2; g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + Math.cos(a) * D * 0.05, oy + Math.sin(a) * D * 0.05); g.stroke(); }
  return k.c;
}

/** The rime ring: frost crystals round a portrait's edge (radius 0.46 of the box), bristling inward. */
function paintRime(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(41);
  const c = D / 2, R = D * 0.46;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.006;
  g.lineWidth = D * 0.008; g.globalAlpha = 0.8;
  g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const l = D * (0.01 + Math.pow(rnd(), 2) * 0.06);
    const r0 = R * (0.99 + rnd() * 0.04);
    const x = c + Math.cos(a) * r0, y = c + Math.sin(a) * r0;
    const b = a + Math.PI + (rnd() - 0.5) * 0.9;
    g.globalAlpha = 0.45 + rnd() * 0.5;
    g.lineWidth = D * (0.003 + rnd() * 0.004);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); g.stroke();
    if (l > D * 0.035) {
      const mx = x + Math.cos(b) * l * 0.5, my = y + Math.sin(b) * l * 0.5;
      for (const s of [-1, 1]) { const bb = b + s * (Math.PI / 3); g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(bb) * l * 0.35, my + Math.sin(bb) * l * 0.35); g.stroke(); }
    }
  }
  g.globalAlpha = 1;
  return k.c;
}

let cached: HeroFrostTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (Frost then skips Pixi). */
export function heroFrostTextures(): HeroFrostTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const painted = {
    iceBody: paintIceBody(), iceCore: paintIceCore(), iceRim: paintIceRim(), iceSpec: paintIceSpec(), iceGlow: paintIceGlow(),
    shardA: paintShard(40, [[0.12, 0.2], [0.9, 0.35], [0.62, 0.82], [0.25, 0.7]]),
    shardB: paintShard(40, [[0.5, 0.06], [0.82, 0.62], [0.42, 0.94], [0.2, 0.5]]),
    shardC: paintShard(40, [[0.08, 0.5], [0.7, 0.12], [0.94, 0.46], [0.55, 0.62]]),
    flake: paintFlake(64), rune: paintRune(192), puff: paintPuff(96), fern: paintFern(),
    novaBody: paintNovaBody(128, 64), novaEdge: paintNovaEdge(128, 32), sheet: paintSheet(512, 128),
    shell: paintShell(256), cracks: paintCracks(256), rime: paintRime(256),
  };
  if (!base || Object.values(painted).some((c) => !c)) return null;
  const t = Object.fromEntries(Object.entries(painted).map(([k, c]) => [k, tex(c!)])) as Record<keyof typeof painted, Texture>;
  cached = { ...base, ...t };
  return cached;
}
