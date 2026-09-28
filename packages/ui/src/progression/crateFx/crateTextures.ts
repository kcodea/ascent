/**
 * THE CRATE'S PAINTED TEXTURES (2026-09-28 redo). Every picture the opening uses is painted ONCE per theatre, on a
 * 2D canvas, when the theatre opens, and handed to Pixi as a texture. Nothing is redrawn per frame. Canvas 2D gives
 * what flat Pixi polygons cannot: layered gradients, bevels, grain, soft shadows and blurred light. Math.random is
 * fine here (presentation only).
 *
 * The chest is painted in TWO parts, the body and the domed lid, so the lid can blow off. Extra layers sit on top
 * of them additively and are tinted by rarity at run time: the seam light (the lid/body gap and the keyhole), and
 * the cracks (a web of fractures across the body that brightens through the charge). All are painted white so a
 * tint can colour them. Sizes are in texture px; the scene scales sprites to the crate's layout size.
 */

/** The chest's proportions, in units of its width. */
export const CHEST = { bodyH: 0.52, lidH: 0.34, lidOver: 0.03, seamY: 0 } as const;

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d context');
  return { c, g };
}

function rr(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Polished bronze across a band: dark edge, bright ridge, warm body, dark edge. */
function bronze(g: Ctx, x0: number, x1: number, vertical = true): CanvasGradient {
  const gr = vertical ? g.createLinearGradient(x0, 0, x1, 0) : g.createLinearGradient(0, x0, 0, x1);
  gr.addColorStop(0, '#3b2508');
  gr.addColorStop(0.14, '#8a5d1c');
  gr.addColorStop(0.3, '#f6d27a');
  gr.addColorStop(0.42, '#fff3c4');
  gr.addColorStop(0.58, '#c9953a');
  gr.addColorStop(0.85, '#7a4e16');
  gr.addColorStop(1, '#2c1a05');
  return gr;
}

function rivet(g: Ctx, x: number, y: number, r: number): void {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, '#fffbe6');
  gr.addColorStop(0.35, '#f0c864');
  gr.addColorStop(0.8, '#7a5118');
  gr.addColorStop(1, '#2a1a06');
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.arc(x + r * 0.2, y + r * 0.3, r * 1.05, 0, Math.PI * 2); g.fill();
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

/** Wood planks with grain, filling the current clip. `bend` curves the grain (the dome). */
function wood(g: Ctx, x: number, y: number, w: number, h: number, planks: number, bend = 0): void {
  const base = g.createLinearGradient(0, y, 0, y + h);
  base.addColorStop(0, '#8a5328');
  base.addColorStop(0.45, '#6a3c1a');
  base.addColorStop(1, '#3d210c');
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  const ph = h / planks;
  for (let i = 0; i < planks; i++) {
    const py = y + i * ph;
    // each plank a touch different in tone
    g.fillStyle = `rgba(${i % 2 ? '40,20,5' : '255,210,150'},${i % 2 ? 0.12 : 0.05})`;
    g.fillRect(x, py, w, ph);
    // grain: long thin wavy strokes
    g.lineWidth = Math.max(1, w / 500);
    for (let k = 0; k < 7; k++) {
      const gy = py + ph * (0.12 + Math.random() * 0.76);
      g.strokeStyle = `rgba(30,14,4,${0.18 + Math.random() * 0.2})`;
      g.beginPath();
      g.moveTo(x, gy);
      const segs = 6;
      for (let s = 1; s <= segs; s++) {
        const sx = x + (w * s) / segs;
        const curve = bend ? -bend * Math.sin((Math.PI * s) / segs) : 0;
        g.quadraticCurveTo(sx - w / segs / 2, gy + (Math.random() - 0.5) * ph * 0.18 + curve, sx, gy + curve * 0.8);
      }
      g.stroke();
    }
    // a knot now and then
    if (Math.random() < 0.5) {
      const kx = x + w * (0.15 + Math.random() * 0.7);
      const ky = py + ph * 0.5;
      const kg = g.createRadialGradient(kx, ky, 0, kx, ky, ph * 0.3);
      kg.addColorStop(0, 'rgba(25,10,2,0.55)');
      kg.addColorStop(1, 'rgba(25,10,2,0)');
      g.fillStyle = kg;
      g.beginPath(); g.ellipse(kx, ky, ph * 0.5, ph * 0.22, 0, 0, Math.PI * 2); g.fill();
    }
    // the gap between planks: a dark groove with a lit lip under it
    if (i > 0) {
      g.fillStyle = 'rgba(18,8,2,0.85)';
      g.fillRect(x, py - Math.max(1.5, h / 90), w, Math.max(2, h / 60));
      g.fillStyle = 'rgba(255,200,140,0.18)';
      g.fillRect(x, py + Math.max(1, h / 120), w, Math.max(1, h / 140));
    }
  }
}

/** The body: planked box, bronze bands with rivets, a bottom trim, the lock plate. Width W, height W * bodyH. */
export function paintChestBody(W: number): HTMLCanvasElement {
  const H = W * CHEST.bodyH;
  const pad = W * 0.02;
  const { c, g } = canvas(W + pad * 2, H + pad * 2);
  g.translate(pad, pad);
  const r = W * 0.03;
  // outline + fill
  g.save();
  rr(g, 0, 0, W, H, r);
  g.clip();
  wood(g, 0, 0, W, H, 3);
  // ambient occlusion: darker toward the sides and the base, a warm top light
  const side = g.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0, 'rgba(0,0,0,0.5)'); side.addColorStop(0.18, 'rgba(0,0,0,0)');
  side.addColorStop(0.82, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = side; g.fillRect(0, 0, W, H);
  const base = g.createLinearGradient(0, H * 0.55, 0, H);
  base.addColorStop(0, 'rgba(0,0,0,0)'); base.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  // corner brackets
  const cb = W * 0.1;
  for (const [x, y, sx, sy] of [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]] as const) {
    g.save();
    g.translate(x, y); g.scale(sx, sy);
    g.fillStyle = bronze(g, 0, cb * 0.6);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(cb, 0); g.lineTo(cb * 0.72, cb * 0.2); g.lineTo(cb * 0.2, cb * 0.2); g.lineTo(cb * 0.2, cb * 0.72); g.lineTo(0, cb); g.closePath(); g.fill();
    g.restore();
  }
  // two vertical bronze bands
  const bw = W * 0.085;
  for (const bx of [W * 0.2 - bw / 2, W * 0.8 - bw / 2]) {
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(bx + bw * 0.12, 0, bw, H); // cast shadow
    g.fillStyle = bronze(g, bx, bx + bw); g.fillRect(bx, 0, bw, H);
    g.fillStyle = 'rgba(255,245,200,0.5)'; g.fillRect(bx + bw * 0.06, 0, Math.max(1, bw * 0.05), H);
    for (const ry of [0.13, 0.5, 0.87]) rivet(g, bx + bw / 2, H * ry, bw * 0.17);
  }
  // bottom trim
  const th = H * 0.1;
  g.fillStyle = bronze(g, H - th, H, false); g.fillRect(0, H - th, W, th);
  g.fillStyle = 'rgba(255,240,190,0.45)'; g.fillRect(0, H - th, W, Math.max(1, th * 0.12));
  for (let i = 0; i < 9; i++) rivet(g, W * (0.06 + i * 0.11), H - th / 2, th * 0.2);
  g.restore();
  // lock plate: a bronze shield hanging from the seam, with an engraved border and a socket for the gem
  const pw = W * 0.2, ph = H * 0.58, px = W / 2 - pw / 2;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = W * 0.02; g.shadowOffsetY = W * 0.008;
  g.beginPath();
  g.moveTo(px, 0); g.lineTo(px + pw, 0); g.lineTo(px + pw, ph * 0.62);
  g.quadraticCurveTo(px + pw, ph * 0.86, W / 2, ph); g.quadraticCurveTo(px, ph * 0.86, px, ph * 0.62); g.closePath();
  g.fillStyle = bronze(g, px, px + pw); g.fill();
  g.restore();
  g.save();
  g.lineWidth = Math.max(1, W * 0.004); g.strokeStyle = 'rgba(60,34,6,0.9)';
  const inset = pw * 0.1;
  g.beginPath();
  g.moveTo(px + inset, inset * 0.6); g.lineTo(px + pw - inset, inset * 0.6); g.lineTo(px + pw - inset, ph * 0.6);
  g.quadraticCurveTo(px + pw - inset, ph * 0.8, W / 2, ph - inset); g.quadraticCurveTo(px + inset, ph * 0.8, px + inset, ph * 0.6); g.closePath();
  g.stroke();
  // the gem socket: a dark ring (the gem sprite sits on it)
  const gy = ph * 0.42, gr = pw * 0.27;
  const sock = g.createRadialGradient(W / 2, gy, gr * 0.3, W / 2, gy, gr * 1.25);
  sock.addColorStop(0, '#120a02'); sock.addColorStop(0.75, '#2a1804'); sock.addColorStop(1, 'rgba(42,24,4,0)');
  g.fillStyle = sock; g.beginPath(); g.arc(W / 2, gy, gr * 1.25, 0, Math.PI * 2); g.fill();
  // rune ticks around the socket
  g.strokeStyle = 'rgba(255,236,180,0.55)'; g.lineWidth = Math.max(1, W * 0.003);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * gr * 1.3, gy + Math.sin(a) * gr * 1.3); g.lineTo(W / 2 + Math.cos(a) * gr * 1.52, gy + Math.sin(a) * gr * 1.52); g.stroke();
  }
  g.restore();
  // outline + rim light along the top edge
  g.lineWidth = Math.max(2, W * 0.008); g.strokeStyle = '#150a03';
  rr(g, 0, 0, W, H, r); g.stroke();
  g.strokeStyle = 'rgba(255,225,170,0.35)'; g.lineWidth = Math.max(1, W * 0.004);
  g.beginPath(); g.moveTo(r, W * 0.004); g.lineTo(W - r, W * 0.004); g.stroke();
  return c;
}

/** The domed lid, bottom edge flat (it sits on the body's top edge). Width W * (1 + 2 * lidOver). */
export function paintChestLid(W: number): HTMLCanvasElement {
  const LW = W * (1 + CHEST.lidOver * 2);
  const LH = W * CHEST.lidH;
  const pad = W * 0.02;
  const { c, g } = canvas(LW + pad * 2, LH + pad * 2);
  g.translate(pad, pad);
  const dome = (): void => {
    g.beginPath();
    g.moveTo(0, LH);
    g.lineTo(0, LH * 0.42);
    g.bezierCurveTo(0, -LH * 0.08, LW, -LH * 0.08, LW, LH * 0.42);
    g.lineTo(LW, LH);
    g.closePath();
  };
  g.save();
  dome(); g.clip();
  wood(g, 0, 0, LW, LH, 3, LH * 0.25);
  // curved surface: a bright top, dark flanks
  const hi = g.createRadialGradient(LW / 2, LH * 0.05, LW * 0.05, LW / 2, LH * 0.3, LW * 0.62);
  hi.addColorStop(0, 'rgba(255,220,170,0.28)'); hi.addColorStop(0.5, 'rgba(255,220,170,0)'); hi.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = hi; g.fillRect(0, 0, LW, LH);
  // bands continue over the dome
  const bw = W * 0.085;
  for (const cx of [W * 0.2 + W * CHEST.lidOver, W * 0.8 + W * CHEST.lidOver]) {
    const bx = cx - bw / 2;
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(bx + bw * 0.12, 0, bw, LH);
    g.fillStyle = bronze(g, bx, bx + bw); g.fillRect(bx, 0, bw, LH);
    g.fillStyle = 'rgba(255,245,200,0.5)'; g.fillRect(bx + bw * 0.06, 0, Math.max(1, bw * 0.05), LH);
    rivet(g, cx, LH * 0.62, bw * 0.17);
  }
  // front rim band along the lid's lower edge
  const rh = LH * 0.2;
  g.fillStyle = bronze(g, LH - rh, LH, false); g.fillRect(0, LH - rh, LW, rh);
  g.fillStyle = 'rgba(255,240,190,0.5)'; g.fillRect(0, LH - rh, LW, Math.max(1, rh * 0.1));
  for (let i = 0; i < 10; i++) rivet(g, LW * (0.05 + i * 0.1), LH - rh / 2, rh * 0.18);
  g.restore();
  // outline + rim light along the dome
  g.lineWidth = Math.max(2, W * 0.008); g.strokeStyle = '#150a03';
  dome(); g.stroke();
  g.save();
  g.beginPath();
  g.moveTo(LW * 0.06, LH * 0.3);
  g.bezierCurveTo(LW * 0.1, -LH * 0.02, LW * 0.9, -LH * 0.02, LW * 0.94, LH * 0.3);
  g.strokeStyle = 'rgba(255,230,180,0.55)'; g.lineWidth = Math.max(1.5, W * 0.006); g.stroke();
  g.restore();
  return c;
}

/** A stone pedestal: an ellipse top face and a short drum, seen from slightly above. Width W. */
export function paintPedestal(W: number): HTMLCanvasElement {
  const top = W * 0.16, drum = W * 0.1;
  const { c, g } = canvas(W, top + drum + W * 0.02);
  const cx = W / 2, cy = top / 2;
  // the drum (side)
  const side = g.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0, '#0d1220'); side.addColorStop(0.3, '#2a3450'); side.addColorStop(0.55, '#3a4666'); side.addColorStop(1, '#0b0f1b');
  g.fillStyle = side;
  g.beginPath(); g.ellipse(cx, cy + drum, W / 2, top / 2, 0, 0, Math.PI); g.lineTo(0, cy); g.ellipse(cx, cy, W / 2, top / 2, 0, Math.PI, 0, true); g.closePath(); g.fill();
  // the bronze lip where face meets drum
  g.strokeStyle = 'rgba(214,168,82,0.8)'; g.lineWidth = Math.max(1.5, W * 0.006);
  g.beginPath(); g.ellipse(cx, cy + W * 0.004, W / 2 - 1, top / 2 - 1, 0, 0, Math.PI); g.stroke();
  // the top face
  const face = g.createRadialGradient(cx, cy - top * 0.15, W * 0.02, cx, cy, W / 2);
  face.addColorStop(0, '#5a6a8e'); face.addColorStop(0.6, '#34405e'); face.addColorStop(1, '#1c2338');
  g.fillStyle = face; g.beginPath(); g.ellipse(cx, cy, W / 2, top / 2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(1, W * 0.003);
  g.beginPath(); g.ellipse(cx, cy, W / 2 - W * 0.01, top / 2 - W * 0.004, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  return c;
}

/** The rune ring engraved in the pedestal face, in perspective. White, additive, tinted at run time. */
export function paintRuneRing(W: number): HTMLCanvasElement {
  const top = W * 0.16;
  const { c, g } = canvas(W, top);
  const cx = W / 2, cy = top / 2;
  g.shadowColor = '#fff'; g.shadowBlur = W * 0.012;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  for (const [k, lw] of [[0.86, 0.006], [0.68, 0.004]] as const) {
    g.lineWidth = W * lw;
    g.beginPath(); g.ellipse(cx, cy, (W / 2) * k, (top / 2) * k, 0, 0, Math.PI * 2); g.stroke();
  }
  // rune glyphs between the rings: small strokes around the ellipse
  g.lineWidth = W * 0.004;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const rx = (W / 2) * 0.77, ry = (top / 2) * 0.77;
    const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
    const s = W * 0.012;
    g.beginPath();
    if (i % 3 === 0) { g.moveTo(x - s, y - s * 0.4); g.lineTo(x, y + s * 0.4); g.lineTo(x + s, y - s * 0.4); }
    else if (i % 3 === 1) { g.moveTo(x, y - s * 0.5); g.lineTo(x, y + s * 0.5); g.moveTo(x - s * 0.6, y); g.lineTo(x + s * 0.6, y); }
    else { g.arc(x, y, s * 0.45, 0, Math.PI * 2); }
    g.stroke();
  }
  return c;
}

/** Light rays: `n` soft wedges from the centre. White; tinted and rotated at run time. Size D x D. */
export function paintRays(D: number, n: number): HTMLCanvasElement {
  const { c, g } = canvas(D, D);
  const cx = D / 2;
  // soft edges: the wedges are painted through a blur, so no ray has a hard side
  g.filter = `blur(${Math.round(D / 90)}px)`;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const half = (Math.PI / n) * (i % 2 ? 0.28 : 0.45);
    const len = cx * (i % 2 ? 0.8 : 1);
    const grad = g.createRadialGradient(cx, cx, 0, cx, cx, len);
    grad.addColorStop(0, 'rgba(255,255,255,0.75)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(cx, cx); g.arc(cx, cx, len, a - half, a + half); g.closePath(); g.fill();
  }
  return c;
}

/** A soft round glow (radial gradient). Size D. */
export function paintGlow(D: number): HTMLCanvasElement {
  const { c, g } = canvas(D, D);
  const gr = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.22, 'rgba(255,255,255,0.6)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return c;
}

/** A spark: a hot core with a soft halo and a faint 4-point glint. Size D. */
export function paintSpark(D: number): HTMLCanvasElement {
  const { c, g } = canvas(D, D);
  const r = D / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(r - D * 0.02, 0, D * 0.04, D); g.fillRect(0, r - D * 0.02, D, D * 0.04);
  return c;
}

/** A streak: a long soft line (pulled energy, flying embers). +X aligned. */
export function paintStreak(L: number): HTMLCanvasElement {
  const H = Math.max(4, L / 8);
  const { c, g } = canvas(L, H);
  const gr = g.createLinearGradient(0, 0, L, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(L / 2, H / 2, L / 2, H / 2, 0, 0, Math.PI * 2); g.fill();
  return c;
}

/** A thin bright ring with a feathered edge. Size D (ring radius D * 0.42). */
export function paintRing(D: number, width = 0.035): HTMLCanvasElement {
  const { c, g } = canvas(D, D);
  const r = D * 0.42;
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.04;
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = D * width;
  g.beginPath(); g.arc(D / 2, D / 2, r, 0, Math.PI * 2); g.stroke();
  return c;
}

/** A gold coin face with a rim and an embossed star. Size D. */
export function paintCoin(D: number): HTMLCanvasElement {
  const { c, g } = canvas(D, D);
  const r = D * 0.46, cx = D / 2;
  const gr = g.createRadialGradient(cx - r * 0.35, cx - r * 0.35, r * 0.1, cx, cx, r);
  gr.addColorStop(0, '#fff6c8'); gr.addColorStop(0.4, '#f5c64e'); gr.addColorStop(0.85, '#a8741a'); gr.addColorStop(1, '#5a3a08');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(90,58,8,0.9)'; g.lineWidth = D * 0.05;
  g.beginPath(); g.arc(cx, cx, r * 0.78, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,245,200,0.85)';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr2 = i % 2 ? r * 0.22 : r * 0.5;
    g.lineTo(cx + Math.cos(a) * rr2, cx + Math.sin(a) * rr2);
  }
  g.closePath(); g.fill();
  return c;
}

/** Wood and bronze shards for the burst: `n` variants, each on its own canvas. */
export function paintShards(size: number, n: number): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < n; i++) {
    const metal = i % 3 === 2;
    const w = size * (0.6 + Math.random() * 0.5), h = size * (metal ? 0.25 : 0.32);
    const { c, g } = canvas(w + 4, h + 4);
    g.translate(2, 2);
    g.beginPath();
    g.moveTo(0, h * 0.2); g.lineTo(w * 0.35, 0); g.lineTo(w, h * 0.15); g.lineTo(w * 0.85, h); g.lineTo(w * 0.2, h * 0.9); g.closePath();
    if (metal) g.fillStyle = bronze(g, 0, h, false);
    else {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#9a6232'); gr.addColorStop(1, '#4a2810');
      g.fillStyle = gr;
    }
    g.fill();
    g.strokeStyle = 'rgba(20,8,2,0.9)'; g.lineWidth = 1.5; g.stroke();
    out.push(c);
  }
  return out;
}

/** A soft horizontal bar of light, bright in the middle, fading to both ends and to both edges (the seam light).
 *  White; tinted and stretched at run time. */
export function paintSeamBar(L: number): HTMLCanvasElement {
  const H = Math.max(8, Math.round(L / 8));
  const { c, g } = canvas(L, H);
  const along = g.createLinearGradient(0, 0, L, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)');
  along.addColorStop(0.12, 'rgba(255,255,255,0.75)');
  along.addColorStop(0.5, 'rgba(255,255,255,1)');
  along.addColorStop(0.88, 'rgba(255,255,255,0.75)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = along;
  g.fillRect(0, 0, L, H);
  // fade across the bar: a hot thin core, soft above and below
  g.globalCompositeOperation = 'destination-in';
  const across = g.createLinearGradient(0, 0, 0, H);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.42, 'rgba(0,0,0,0.9)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(0.58, 'rgba(0,0,0,0.9)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, L, H);
  return c;
}

/**
 * The keyhole's light mask, cut from the owner's body art: white where the keyhole's dark opening is, fading at
 * its edges, clear elsewhere. `img` is the loaded body; `box` is the keyhole's box in the body's `srcW` space.
 * Returns the canvas (sized to the box in the IMAGE's px) or null without a 2D canvas.
 */
export function cutKeyholeMask(img: CanvasImageSource & { width: number; height: number }, srcW: number, box: { x0: number; y0: number; x1: number; y1: number }): HTMLCanvasElement | null {
  const k = img.width / srcW;
  const x = Math.floor(box.x0 * k), y = Math.floor(box.y0 * k);
  const w = Math.max(1, Math.ceil((box.x1 - box.x0) * k)), h = Math.max(1, Math.ceil((box.y1 - box.y0) * k));
  try {
    const { c, g } = canvas(w, h);
    g.drawImage(img, x, y, w, h, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = (px[i]! + px[i + 1]! + px[i + 2]!) / 3;
      const a = px[i + 3]! / 255;
      // the opening is the dark part of the lock: fully lit under ~40, fading out by ~95
      const m = Math.max(0, Math.min(1, (95 - lum) / 55)) * a;
      px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = Math.round(m * 255);
    }
    g.putImageData(d, 0, 0);
    return c;
  } catch {
    return null;
  }
}
