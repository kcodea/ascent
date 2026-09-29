/**
 * The Stampede's textures, painted ONCE per session on 2D canvases and kept (about 700 KB of GPU memory on top of the
 * Blast's five and the Arcana ribbon strips, which it shares). Everything is white or grey, so every sprite tints it.
 *
 * THE SPIRIT BEAST (a side view, facing +X) is two parts on ONE box (256 x 128), each in three textures: the UPPER
 * head (skull, ear, brow, snout, flame-tipped mane at the back, the upper fangs) and the LOWER jaw (drawn closed, with
 * its fangs), so the scene can swing the lower jaw open about the hinge. Per part: a BODY (shaded top-lit, fur streaks
 * cut in, so a tint keeps its form), an EDGE (additive: the lit rim, the gleaming fangs, the eye and the brow) and a
 * GLOW (the blurred silhouette). The sprites anchor at the MOUTH (`HEAD_ANCHOR`); the lower jaw at the HINGE.
 *
 * THE JAWS (a front view: the signature chomp) are one upper jaw on a 256 x 128 box, fangs pointing down with their
 * tips at `JAW_TIP_Y`: two long canines, incisors between them, premolars to the sides. The lower jaw is the same
 * texture flipped, so the two rows clamp shut on the same line and interlock. Body, edge and glow again. The BITE
 * marks are the punctures those fangs leave (the same tooth layout), and a dust billow, a thick shockwave ring and a
 * soft disc finish the set. Bold, clean shapes (the owner's bar: "clean", never particle soup).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import type { HeroBeastTextures } from './heroBeastScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

// ─── the spirit beast (side view) ─────────────────────────────────────────────────────────────────────────────

/** The beast box: 256 x 128. The mouth anchor, the jaw hinge, the eye and where the mane streams from. */
export const HEAD_W = 256;
export const HEAD_H = 128;
export const HEAD_ANCHOR = { x: 192, y: 78 } as const;
export const HEAD_HINGE = { x: 140, y: 75 } as const;
export const HEAD_EYE = { x: 153, y: 47 } as const;
export const HEAD_MANE = { x: 50, y: 62 } as const;

/** The far ear, peeking behind the near one (painted first, darker). */
function farEarPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(70, 42); g.lineTo(78, 10); g.lineTo(96, 36);
  g.closePath();
}

/** The skull: a smooth nape (the mane streams off it), a tall ear, the brow, the stop, a wolf's snout, the lip, the ruff. */
function upperPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(28, 86);
  g.quadraticCurveTo(22, 58, 58, 42);
  g.lineTo(88, 34);
  // the near ear, tall and pointed
  g.lineTo(98, 2); g.lineTo(120, 32);
  // the brow, the stop, the snout, the nose
  g.quadraticCurveTo(144, 26, 162, 42);
  g.quadraticCurveTo(192, 46, 220, 52);
  g.quadraticCurveTo(236, 54, 236, 63);
  g.quadraticCurveTo(235, 72, 222, 73);
  // the upper lip back to the corner of the mouth
  g.quadraticCurveTo(176, 75, 138, 78);
  // the cheek ruff: two tufts, then the throat back to the nape
  g.lineTo(132, 100); g.lineTo(118, 90); g.lineTo(106, 106); g.lineTo(90, 92);
  g.quadraticCurveTo(58, 104, 28, 88);
  g.closePath();
}

function lowerPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(136, 75);
  g.lineTo(216, 75);
  g.quadraticCurveTo(222, 80, 216, 87);
  g.quadraticCurveTo(186, 98, 150, 99);
  g.quadraticCurveTo(134, 97, 130, 86);
  g.closePath();
}

/** A fang: from a base on the lip (x0..x1 at y0) to a tip, curving a touch backward. */
function fang(g: CanvasRenderingContext2D, x: number, w: number, y0: number, tipY: number, lean: number): void {
  g.moveTo(x - w, y0);
  g.quadraticCurveTo(x - w * 0.6, (y0 + tipY) / 2, x + lean, tipY);
  g.quadraticCurveTo(x + w * 0.8, (y0 + tipY) / 2, x + w, y0);
  g.closePath();
}

function upperFangs(g: CanvasRenderingContext2D): void {
  g.beginPath();
  fang(g, 208, 6, 72, 98, -2);
  fang(g, 186, 3.8, 74, 86, -1);
  fang(g, 221, 2.8, 72, 81, -1);
}

function lowerFangs(g: CanvasRenderingContext2D): void {
  g.beginPath();
  fang(g, 197, 5.5, 77, 52, -2);
  fang(g, 176, 3.6, 77, 64, -1);
}

/** Fur streaks cut into a body (swept back along the head), so the energy reads as fur, not a flat fill. */
function furCuts(g: CanvasRenderingContext2D, rows: [number, number, number, number][]): void {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.strokeStyle = 'rgba(0,0,0,0.42)'; g.lineCap = 'round'; g.lineWidth = 2;
  for (const [x0, y0, x1, y1] of rows) { g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 3, x1, y1); g.stroke(); }
  g.restore();
}

/** Fade a body out toward the nape, so the head melts into its streaming mane instead of ending in a hard edge. */
function fadeToNape(g: CanvasRenderingContext2D): void {
  g.save();
  g.globalCompositeOperation = 'destination-in';
  const f = g.createLinearGradient(20, 0, 90, 0);
  f.addColorStop(0, 'rgba(255,255,255,0.2)'); f.addColorStop(0.55, 'rgba(255,255,255,0.85)'); f.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = f; g.fillRect(0, 0, HEAD_W, HEAD_H);
  g.restore();
}

function paintHeadBody(part: 'upper' | 'lower'): HTMLCanvasElement | null {
  const k = canvas(HEAD_W, HEAD_H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 4, 0, 100);
  gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(0.45, 'rgb(215,215,215)'); gr.addColorStop(1, 'rgb(135,135,135)');
  if (part === 'upper') {
    g.fillStyle = 'rgb(150,150,150)';
    farEarPath(g); g.fill();
    g.fillStyle = gr;
    upperPath(g); g.fill();
    // the ear hollow and the eye socket, shadowed
    g.fillStyle = 'rgb(100,100,100)';
    g.beginPath(); g.moveTo(102, 28); g.lineTo(99, 10); g.lineTo(113, 31); g.closePath(); g.fill();
    g.beginPath(); g.ellipse(HEAD_EYE.x, HEAD_EYE.y, 11, 6, -0.3, 0, Math.PI * 2); g.fill();
    // the nose, dark
    g.fillStyle = 'rgb(45,45,45)';
    g.beginPath(); g.ellipse(230, 61, 7, 6, 0.2, 0, Math.PI * 2); g.fill();
    furCuts(g, [[52, 58, 90, 50], [58, 74, 100, 66], [120, 58, 160, 58], [150, 64, 196, 64], [172, 56, 210, 58], [86, 84, 118, 76]]);
    // a dark outline, so the silhouette reads on the light board too
    g.strokeStyle = 'rgba(30,30,30,0.9)'; g.lineWidth = 3; g.lineJoin = 'round';
    upperPath(g); g.stroke();
    fadeToNape(g);
  } else {
    g.fillStyle = gr;
    lowerPath(g); g.fill();
    furCuts(g, [[146, 90, 186, 86], [166, 94, 208, 84]]);
    g.strokeStyle = 'rgba(30,30,30,0.9)'; g.lineWidth = 3; g.lineJoin = 'round';
    lowerPath(g); g.stroke();
  }
  return k.c;
}

function paintHeadEdge(part: 'upper' | 'lower'): HTMLCanvasElement | null {
  const k = canvas(HEAD_W, HEAD_H); if (!k) return null;
  const g = k.g;
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.6; g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 3;
  if (part === 'upper') {
    // the lit rim along the top of the head (the light is above), the brow ridge and the snout line
    g.beginPath(); g.moveTo(120, 32); g.quadraticCurveTo(144, 26, 162, 42); g.quadraticCurveTo(192, 46, 220, 52); g.stroke();
    g.beginPath(); g.moveTo(98, 4); g.lineTo(88, 34); g.stroke();
    g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(138, 40); g.quadraticCurveTo(150, 36, 166, 44); g.stroke();
    // the eye: a fierce slanted almond, white-hot
    g.shadowBlur = 6; g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(HEAD_EYE.x - 9, HEAD_EYE.y + 3); g.quadraticCurveTo(HEAD_EYE.x - 1, HEAD_EYE.y - 5, HEAD_EYE.x + 9, HEAD_EYE.y - 3);
    g.quadraticCurveTo(HEAD_EYE.x + 1, HEAD_EYE.y + 4, HEAD_EYE.x - 9, HEAD_EYE.y + 3); g.fill();
    // energy streaks through the fur (the same sweep as the fur cuts, lit)
    g.shadowBlur = 2; g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,0.55)';
    for (const [x0, y0, x1, y1] of [[58, 60, 96, 52], [64, 76, 104, 68], [124, 60, 162, 60], [152, 66, 194, 66], [96, 86, 124, 78]] as const) {
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 3, x1, y1); g.stroke();
    }
    // the gleaming fangs
    g.shadowBlur = 4; g.fillStyle = 'rgba(255,255,255,0.97)';
    upperFangs(g); g.fill();
  } else {
    g.shadowBlur = 4; g.fillStyle = 'rgba(255,255,255,0.97)';
    lowerFangs(g); g.fill();
  }
  return k.c;
}

function paintHeadGlow(part: 'upper' | 'lower'): HTMLCanvasElement | null {
  const k = canvas(HEAD_W, HEAD_H); if (!k) return null;
  const g = k.g;
  // shadowBlur (not `ctx.filter`, which older Safari lacks): the silhouette plus a soft bloom round it.
  g.shadowColor = '#fff'; g.shadowBlur = 14;
  g.fillStyle = 'rgba(255,255,255,0.6)';
  if (part === 'upper') { farEarPath(g); g.fill(); upperPath(g); g.fill(); upperFangs(g); g.fill(); fadeToNape(g); } else { lowerPath(g); g.fill(); lowerFangs(g); g.fill(); }
  return k.c;
}

// ─── the jaws (front view) ────────────────────────────────────────────────────────────────────────────────────

export const JAW_W = 256;
export const JAW_H = 128;
/** Where the fang tips reach (the scene anchors the jaw here, so the two rows meet on one line). */
export const JAW_TIP_Y = 120;

/** The tooth row: position across (-1..1), length and half-width, in jaw px. Shared with the bite marks. */
export const TEETH: readonly { t: number; len: number; w: number }[] = [
  { t: -0.82, len: 13, w: 8 }, { t: -0.62, len: 20, w: 10 }, { t: -0.4, len: 40, w: 13 },
  { t: -0.14, len: 15, w: 9 }, { t: 0.14, len: 15, w: 9 },
  { t: 0.4, len: 40, w: 13 }, { t: 0.62, len: 20, w: 10 }, { t: 0.82, len: 13, w: 8 },
];
const gumY = (t: number): number => 84 - 14 * t * t;
const toothX = (t: number): number => JAW_W / 2 + t * 112;

function jawPath(g: CanvasRenderingContext2D): void {
  // A lip band along the gum line: thickest at the muzzle (the middle), thin at the corners of the mouth, with a
  // rounded snout bump on top. The fangs hang below it.
  g.beginPath();
  g.moveTo(toothX(-1.1), gumY(-1.1));
  // The top edge carries a few swept fur flames (licking up and outward), so the muzzle reads as a beast
  // made of energy, not a flat band.
  for (let i = 0; i <= 24; i++) {
    const t = -1.1 + (2.2 * i) / 24;
    const lick = i % 4 === 2 && Math.abs(t) > 0.25 ? 13 * (1 - 0.45 * t * t) : 0;
    g.lineTo(toothX(t) + Math.sign(t) * lick * 0.6, gumY(t) - (10 + 22 * Math.max(0, 1 - t * t)) - (Math.abs(t) < 0.3 ? 8 * (1 - Math.abs(t) / 0.3) : 0) - lick);
  }
  g.lineTo(toothX(1.1), gumY(1.1));
  for (let i = 0; i <= 24; i++) { const t = 1.1 - (2.2 * i) / 24; g.lineTo(toothX(t), gumY(t)); }
  g.closePath();
}

function jawTeeth(g: CanvasRenderingContext2D): void {
  g.beginPath();
  for (const th of TEETH) {
    const x = toothX(th.t), y0 = gumY(th.t) - 2;
    // fangs curve a little toward the middle of the mouth
    fang(g, x, th.w, y0, Math.min(JAW_TIP_Y, y0 + th.len + 2), -Math.sign(th.t) * th.w * 0.35);
  }
}

function paintJawBody(): HTMLCanvasElement | null {
  const k = canvas(JAW_W, JAW_H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 36, 0, 90);
  gr.addColorStop(0, 'rgb(150,150,150)'); gr.addColorStop(0.55, 'rgb(215,215,215)'); gr.addColorStop(1, 'rgb(255,255,255)');
  g.fillStyle = gr;
  jawPath(g); g.fill();
  // the nose on top of the muzzle, dark
  g.fillStyle = 'rgb(55,55,55)';
  g.beginPath(); g.moveTo(JAW_W / 2 - 12, 42); g.quadraticCurveTo(JAW_W / 2, 36, JAW_W / 2 + 12, 42); g.quadraticCurveTo(JAW_W / 2 + 5, 54, JAW_W / 2, 55);
  g.quadraticCurveTo(JAW_W / 2 - 5, 54, JAW_W / 2 - 12, 42); g.fill();
  // a dark outline round the band and every fang, so the bite reads on the light board too
  g.strokeStyle = 'rgba(40,40,40,0.85)'; g.lineWidth = 3; g.lineJoin = 'round';
  jawPath(g); g.stroke();
  jawTeeth(g); g.stroke();
  return k.c;
}

function paintJawEdge(): HTMLCanvasElement | null {
  const k = canvas(JAW_W, JAW_H); if (!k) return null;
  const g = k.g;
  g.shadowColor = '#fff'; g.shadowBlur = 3;
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2; g.lineJoin = 'round';
  jawPath(g); g.stroke();
  g.shadowBlur = 5; g.fillStyle = 'rgba(255,255,255,0.98)';
  jawTeeth(g); g.fill();
  return k.c;
}

function paintJawGlow(): HTMLCanvasElement | null {
  const k = canvas(JAW_W, JAW_H); if (!k) return null;
  const g = k.g;
  g.shadowColor = '#fff'; g.shadowBlur = 9;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  jawPath(g); g.fill(); jawTeeth(g); g.fill();
  return k.c;
}

/**
 * The bite marks (256 x 256, the jaw's own scale across): the punctures the two fang rows leave either side of the
 * middle line, the canines deepest, the lower row offset half a tooth (the rows interlock).
 */
export const BITE_D = 256;
export const BITE_ROW_Y = 22;
function paintBite(): HTMLCanvasElement | null {
  const k = canvas(BITE_D, BITE_D); if (!k) return null;
  const g = k.g;
  const c = BITE_D / 2;
  const rnd = seededRng(5150);
  g.fillStyle = '#fff';
  for (const row of [-1, 1]) {
    for (const th of TEETH) {
      if (Math.abs(th.t) > 0.8) continue;
      const x = c + th.t * 112 + (row > 0 ? 9 : 0);
      const deep = th.len / 40;
      const y = c + row * (BITE_ROW_Y + 4 * (1 - deep)) - row * th.t * th.t * 10;
      const r = 2.6 + 4.6 * deep;
      // a puncture: a teardrop pointing into the bite (the way the fang drove), with a nick either side
      g.beginPath();
      g.moveTo(x - r, y);
      g.quadraticCurveTo(x, y - row * r * 2.6, x + r, y);
      g.arc(x, y, r, 0, Math.PI, row < 0);
      g.fill();
      if (deep > 0.5) {
        for (let s = 0; s < 3; s++) {
          const a = rnd() * Math.PI * 2;
          g.beginPath(); g.arc(x + Math.cos(a) * r * 2, y + Math.sin(a) * r * 2, 0.8 + rnd() * 1.4, 0, Math.PI * 2); g.fill();
        }
      }
    }
  }
  return k.c;
}

// ─── the seasoning ────────────────────────────────────────────────────────────────────────────────────────────

/** A dust billow: overlapping lumps lit from the top left (a cloud of kicked-up earth, not a gradient disc). */
function paintDust(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(7717);
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.6, r = D * (0.1 + rnd() * 0.1);
    lumps.push([D / 2 + Math.cos(a) * r, D / 2 + Math.sin(a) * r * 0.8, D * (0.15 + rnd() * 0.08)]);
  }
  lumps.push([D / 2, D / 2, D * 0.2]);
  lumps.sort((p, q) => p[1] - q[1]).reverse();
  for (const [x, y, rr] of lumps) {
    const gr = g.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.05, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(210,210,210,0.8)');
    gr.addColorStop(0.9, 'rgba(160,160,160,0.55)'); gr.addColorStop(1, 'rgba(150,150,150,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A soft-edged solid disc (the tint over a face): even across the middle, feathered over the outer tenth. */
function paintDisc(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.82, 'rgba(255,255,255,1)'); gr.addColorStop(0.92, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

/** A THICK shockwave ring: clear inside, a dense band at 0.8 of the radius, a soft falloff outside. */
function paintShock(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)');
  gr.addColorStop(0.77, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.84, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

let cached: HeroBeastTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBeastTextures(): HeroBeastTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const hu = paintHeadBody('upper'), hl = paintHeadBody('lower'), eu = paintHeadEdge('upper'), el = paintHeadEdge('lower');
  const gu = paintHeadGlow('upper'), gl = paintHeadGlow('lower');
  const jb = paintJawBody(), je = paintJawEdge(), jg = paintJawGlow();
  const bite = paintBite(), dust = paintDust(128), disc = paintDisc(128), shock = paintShock(256);
  if (!base || !hu || !hl || !eu || !el || !gu || !gl || !jb || !je || !jg || !bite || !dust || !disc || !shock) return null;
  cached = {
    ...base,
    headUpper: tex(hu), headLower: tex(hl), headUpperEdge: tex(eu), headLowerEdge: tex(el), headUpperGlow: tex(gu), headLowerGlow: tex(gl),
    jaw: tex(jb), jawEdge: tex(je), jawGlow: tex(jg), bite: tex(bite), dust: tex(dust), disc: tex(disc), shock: tex(shock),
  };
  return cached;
}
