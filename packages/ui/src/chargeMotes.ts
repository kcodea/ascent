/**
 * End-of-turn CHARGE GLYPH motes — the white-hot energy that streams onto the charging glyph and gathers into the
 * mandala at completion. A light 2D-canvas particle engine (sprite-blitted, additive) driven by `ChargeGlyph`
 * (Recruit.tsx) each frame with the live charge (0→1). It runs on a canvas co-located with the glyph at z:0, so it
 * sits BEHIND the cards like the glyph itself (the main Pixi canvas is z110, over the cards — wrong layer here).
 *
 * The LOOK was tuned on `apps/web/public/fx/turn-glyph-motes-preview.html`; `CHARGE_MOTES_CFG` is the owner's
 * exported values. Since the tuned `flowSpeed` is 0, motes spawn on the lit glyph shape with no initial velocity
 * and are drawn to the centre by `centerPull` — so no tangent field is needed. The shape is sampled once at
 * runtime from `/fx/turn-glyph.svg` (same asset the CSS mask uses) → a list of on-shape points.
 *
 * PERF (north star): sprite-blit (one pre-baked radial-glow sprite via drawImage, NOT per-particle gradients),
 * `edgeBias` keeps the live count modest (most spawns rejected off the front), and it only runs during the last
 * ~20s of a recruit turn. Speeds/sizes scale with the glyph width so they hold at any board size (REF_W).
 */

export interface ChargeMotesCfg {
  rate: number; edgeBias: number;
  flowSpeed: number; speedVar: number; life: number; lifeVar: number; size: number; sizeVar: number;
  swirl: number; centerPull: number; trail: number;
  mandalaGlow: number; mandalaR: number; mandalaRamp: number;
  gatherSpeed: number; gatherBurst: number; flashSize: number; flashAlpha: number; flashMs: number;
  colorCore: string; colorMote: string; colorMandala: string; colorFlash: string;
}

/** Owner-tuned defaults (fx/turn-glyph-motes-preview.html → Copy Settings). */
export const CHARGE_MOTES_CFG: ChargeMotesCfg = {
  rate: 1080, edgeBias: 0.8,
  flowSpeed: 0, speedVar: 0.48, life: 2.25, lifeVar: 1, size: 3, sizeVar: 0.9,
  swirl: 20, centerPull: 680, trail: 0.9,
  mandalaGlow: 0.18, mandalaR: 0.08, mandalaRamp: 4,
  gatherSpeed: 575, gatherBurst: 500, flashSize: 700, flashAlpha: 1, flashMs: 480,
  colorCore: '#ffffff', colorMote: '#009dff', colorMandala: '#33c8ff', colorFlash: '#eafcff',
};

/** Glyph CSS width the preview values were tuned near — px quantities scale by (glyphCssW / REF_W). */
const REF_W = 1040;

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

interface Mote { x: number; y: number; vx: number; vy: number; px: number; py: number; seek: boolean; life: number; max: number; size: number; ph: number; mix: number; }

/** A pre-baked soft radial-glow sprite (white), tinted per-draw via a temp canvas is too slow — instead we bake one
 *  sprite per colour we need (core/mote blend endpoints) and cross-fade by alpha. Simpler: bake WHITE + draw with
 *  globalAlpha, then a colour wash. We keep it cheap: one white glow sprite, coloured via `filter` is slow too, so
 *  we bake a few tinted sprites up front. */
function bakeGlow(size: number, rgb: [number, number, number]): HTMLCanvasElement {
  const s = Math.max(4, Math.ceil(size));
  const c = document.createElement('canvas'); c.width = c.height = s * 2;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s, s, 0, s, s, s);
  grd.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
  grd.addColorStop(0.4, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.5)`);
  grd.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  g.fillStyle = grd; g.beginPath(); g.arc(s, s, s, 0, Math.PI * 2); g.fill();
  return c;
}

export class ChargeMotes {
  private ctx: CanvasRenderingContext2D;
  private cfg: ChargeMotesCfg;
  private shape: Array<{ nx: number; ny: number }> = [];
  private ready = false;
  private motes: Mote[] = [];
  private emitAcc = 0;
  private wasComplete = false;
  private flashT0 = 0;
  private now = 0;
  // baked sprites (24px base, scaled per-draw): the hot core + the cyan tail + the mandala + the flash
  private sprCore!: HTMLCanvasElement;
  private sprMote!: HTMLCanvasElement;
  private sprMandala!: HTMLCanvasElement;
  private sprFlash!: HTMLCanvasElement;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, cfg: ChargeMotesCfg = CHARGE_MOTES_CFG) {
    this.ctx = canvas.getContext('2d')!;
    this.cfg = cfg;
    this.rebakeSprites();
    void this.loadShape();
  }

  setCfg(cfg: ChargeMotesCfg): void { this.cfg = cfg; this.rebakeSprites(); }

  private rebakeSprites(): void {
    this.sprCore = bakeGlow(24, hexToRgb(this.cfg.colorCore));
    this.sprMote = bakeGlow(24, hexToRgb(this.cfg.colorMote));
    this.sprMandala = bakeGlow(48, hexToRgb(this.cfg.colorMandala));
    this.sprFlash = bakeGlow(64, hexToRgb(this.cfg.colorFlash));
  }

  private async loadShape(): Promise<void> {
    try {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}fx/turn-glyph.svg`;
      await img.decode();
      const w = 300, h = 118;
      const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
      const g = oc.getContext('2d')!; g.drawImage(img, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h).data;
      const pts: Array<{ nx: number; ny: number }> = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]! > 40) pts.push({ nx: x / w, ny: y / h });
      this.shape = pts;
      this.ready = pts.length > 0;
    } catch {
      this.ready = false; // SVG unavailable → engine stays inert (the CSS glyph still charges)
    }
  }

  /** Reset transient state (call when a fresh charge session starts). */
  reset(): void { this.motes.length = 0; this.emitAcc = 0; this.wasComplete = false; this.flashT0 = 0; }

  /** Size the backing store to the on-screen box (CSS px) at the device ratio; draw in CSS px via a scale. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
  }

  /**
   * Advance + draw one frame. The canvas is centred on the glyph; `glyphCssW` is the glyph's on-screen width in CSS
   * px (drives geometry + the scale of every px quantity). Mote/mandala/flash all live within the (larger) canvas.
   */
  frame(charge: number, glyphCssW: number, glyphCssH: number, dtMs: number): void {
    const ctx = this.ctx, dpr = this.dpr;
    const cssW = this.canvas.width / dpr, cssH = this.canvas.height / dpr;
    const cx = cssW / 2, cy = cssH / 2;             // glyph centre = canvas centre
    const k = glyphCssW / REF_W;                    // px-quantity scale
    const dt = Math.min(0.05, dtMs / 1000);
    this.now += dtMs;
    const now = this.now, cfg = this.cfg;
    const complete = charge >= 0.999;
    const f = charge * 0.5;                           // both-sides-in lit fraction

    // reset the drawing transform to CSS-px space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // completion edge → gather burst + flash + redirect live motes inward
    if (complete && !this.wasComplete && this.ready) {
      this.flashT0 = now;
      for (const p of this.motes) { p.seek = true; p.life = Math.max(p.life, 0.4); p.max = Math.max(p.max, 0.4); }
      for (let i = 0; i < cfg.gatherBurst; i++) this.spawn((Math.random() * this.shape.length) | 0, cx, cy, glyphCssW, glyphCssH, 'gather', k);
    }
    this.wasComplete = complete;

    // emit while charging, on the lit shape, biased to the leading front
    if (!complete && charge > 0.002 && this.ready) {
      this.emitAcc += cfg.rate * dt; let n = Math.floor(this.emitAcc); this.emitAcc -= n; let tries = n * 6;
      while (n > 0 && tries-- > 0) {
        const si = (Math.random() * this.shape.length) | 0; const nx = this.shape[si]!.nx;
        if (!(nx <= f || nx >= 1 - f)) continue;
        if (cfg.edgeBias > 0) { const side = nx < 0.5 ? f : 1 - f; const near = 1 - Math.min(1, Math.abs(nx - side) / 0.14); if (Math.random() > 1 + (near - 1) * cfg.edgeBias) continue; }
        this.spawn(si, cx, cy, glyphCssW, glyphCssH, 'flow', k); n--;
      }
    }

    // advance
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const p = this.motes[i]!; p.life -= dt; if (p.life <= 0) { this.motes.splice(i, 1); continue; }
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy) || 1;
      if (p.seek) { const spd = cfg.gatherSpeed * k; p.vx = (dx / d) * spd; p.vy = (dy / d) * spd; if (d < 0.02 * glyphCssW) p.life = Math.min(p.life, 0.06); }
      else { const pull = cfg.centerPull * k; p.vx += (dx / d) * pull * dt; p.vy += (dy / d) * pull * dt; if (d < 0.025 * glyphCssW) p.life = Math.min(p.life, 0.1); }
      const sw = p.seek ? 0 : Math.sin(p.ph + (1 - p.life / p.max) * 8) * cfg.swirl * k;
      p.x += (p.vx + p.px * sw) * dt; p.y += (p.vy + p.py * sw) * dt;
    }

    // trail: fade toward TRANSPARENT (destination-out) so the board shows through; else clear
    if (cfg.trail > 0) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${1 - cfg.trail})`; ctx.fillRect(0, 0, cssW, cssH); }
    else ctx.clearRect(0, 0, cssW, cssH);
    ctx.globalCompositeOperation = 'lighter';

    // mandala light-up
    const glow = Math.pow(charge, cfg.mandalaRamp) * cfg.mandalaGlow;
    if (glow > 0.002) this.blit(this.sprMandala, cx, cy, cfg.mandalaR * glyphCssW, Math.min(1, glow));

    // motes: cross-fade core→tail by age via two alpha passes on the baked sprites
    for (const p of this.motes) {
      const t = 1 - p.life / p.max, a = 1 - t * t, r = p.size * (1 - 0.4 * t);
      const tailMix = t * (0.5 + 0.5 * p.mix);       // 0 = hot core, 1 = cyan tail
      this.blit(this.sprCore, p.x, p.y, r, a * (1 - tailMix));
      this.blit(this.sprMote, p.x, p.y, r, a * tailMix);
    }

    // completion flash — expanding, fading bloom at centre
    if (this.flashT0) { const kf = (now - this.flashT0) / cfg.flashMs; if (kf >= 1) this.flashT0 = 0;
      else this.blit(this.sprFlash, cx, cy, cfg.flashSize * k * (0.25 + 0.75 * kf), cfg.flashAlpha * (1 - kf) * (1 - kf)); }

    ctx.globalCompositeOperation = 'source-over';
  }

  private spawn(si: number, cx: number, cy: number, gw: number, gh: number, mode: 'flow' | 'gather', k: number): void {
    const sp = this.shape[si]; if (!sp) return;
    const x = cx + (sp.nx - 0.5) * gw, y = cy + (sp.ny - 0.5) * gh;
    let vx = 0, vy = 0;
    if (mode === 'gather') { const dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1; const spd = this.cfg.gatherSpeed * k; vx = (dx / d) * spd; vy = (dy / d) * spd; }
    else if (this.cfg.flowSpeed > 0) { const dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy) || 1; const spd = this.cfg.flowSpeed * k * (1 - this.cfg.speedVar * Math.random()); vx = (dx / d) * spd; vy = (dy / d) * spd; }
    const gather = mode === 'gather';
    this.motes.push({ x, y, vx, vy, px: 0, py: 0, seek: gather,
      life: this.cfg.life * (1 - this.cfg.lifeVar * Math.random()) * (gather ? 1.6 : 1), max: this.cfg.life * (gather ? 1.6 : 1),
      size: this.cfg.size * k * (1 - this.cfg.sizeVar * Math.random()), ph: Math.random() * 6.28, mix: Math.random() });
    // perpendicular (for swirl) — set after we know a heading; with flowSpeed 0 the tangent is irrelevant, use a random perp
    const m = this.motes[this.motes.length - 1]!;
    const ang = Math.random() * Math.PI * 2; m.px = Math.cos(ang); m.py = Math.sin(ang);
  }

  private blit(spr: HTMLCanvasElement, x: number, y: number, r: number, alpha: number): void {
    if (r <= 0 || alpha <= 0) return;
    const ctx = this.ctx; ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  get isReady(): boolean { return this.ready; }
}
