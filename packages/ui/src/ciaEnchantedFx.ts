/**
 * CIA'S ENCHANTED FOIL — the persistent card treatment (handoff: cia-enchanted-foil-fx-handoff.md).
 *
 * Replaces the looping CSS rings with a living holographic foil rendered through the ONE shared Pixi
 * application. Per the handoff's performance constraints this file never creates an `Application`, never puts
 * a canvas inside a card, and allocates nothing per frame: every texture is built once at first use, glints
 * are pooled, and the updater is disposed the moment the last enchanted offer goes away.
 *
 * The DOM stays authoritative for layout and hit-testing. We read one `getBoundingClientRect()` per enchanted
 * card per frame (the handoff explicitly allows one; there is at most one enchanted offer today) and place the
 * Pixi container in viewport pixels to match. Nothing here is interactive — the shared canvas is already
 * `pointer-events: none`, and no child opts back in.
 *
 * Scope: this is Phase 1-2 (idle treatment + tuner). The purchase streak and third-card payout (Phases 3-4)
 * are one-shot EVENTS with their own authored FX ids and are deliberately not implemented here — see the
 * handoff's "Mike's FX Workflow" section, which requires those timings stay authored rather than hardcoded.
 */
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { pixiFx } from './pixiFx';
import { getHeroFxConfig } from './heroFxConfig';

/** Design-pixel basis the tuner's sizes are authored against (matches the CSS `--u` convention). */
const U = 1;

/* ── Textures (built once, reused forever) ───────────────────────────────────────────────────────────── */

let foilTex: Texture | null = null;
let sweepTex: Texture | null = null;
let haloTex: Texture | null = null;
let glintTex: Texture | null = null;
let sealTex: Texture | null = null;

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (ctx) draw(ctx);
  return Texture.from(cv);
}

/** A crystalline gold/teal/white wash. Drifts under the mask; never seen as a full rainbow sheet. */
function makeFoil(): Texture {
  return canvasTex(256, 256, (c) => {
    const g = c.createLinearGradient(0, 256, 256, 0);
    g.addColorStop(0.00, 'rgba(255, 205, 110, 0.00)');
    g.addColorStop(0.18, 'rgba(255, 219, 150, 0.85)');
    g.addColorStop(0.34, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.50, 'rgba(120, 235, 225, 0.85)');
    g.addColorStop(0.66, 'rgba(255, 255, 255, 0.80)');
    g.addColorStop(0.82, 'rgba(255, 205, 110, 0.75)');
    g.addColorStop(1.00, 'rgba(255, 205, 110, 0.00)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    // Faceting: a few soft diagonal bands so it reads as crystal rather than a smooth ramp.
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      c.save();
      c.translate(128, 128);
      c.rotate((-35 * Math.PI) / 180);
      c.globalAlpha = 0.10 + (i % 3) * 0.05;
      c.fillStyle = i % 2 ? '#9ff3e8' : '#ffe6b0';
      c.fillRect(-180 + i * 46, -180, 10 + (i % 3) * 6, 360);
      c.restore();
    }
  });
}

/** The travelling band: a narrow white-hot leading edge with a wider, dimmer gold/teal body behind it. */
function makeSweep(): Texture {
  return canvasTex(128, 8, (c) => {
    const g = c.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0.00, 'rgba(255, 210, 120, 0.00)');
    g.addColorStop(0.55, 'rgba(150, 240, 230, 0.45)');
    g.addColorStop(0.82, 'rgba(255, 255, 255, 1.00)'); // the hot edge, deliberately near the front
    g.addColorStop(0.92, 'rgba(255, 240, 200, 0.60)');
    g.addColorStop(1.00, 'rgba(255, 210, 120, 0.00)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 8);
  });
}

/** A SEGMENTED contour — gold with teal-white highlights, broken into arcs so it reads as enchanted script. */
function makeHalo(): Texture {
  const S = 256;
  return canvasTex(S, S, (c) => {
    c.translate(S / 2, S / 2);
    c.lineCap = 'round';
    const segs = 14;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / segs * 0.55; // broken: each arc covers just over half its slot
      c.beginPath();
      c.strokeStyle = i % 3 === 0 ? 'rgba(190, 255, 245, 0.95)' : 'rgba(255, 206, 120, 0.9)';
      c.lineWidth = i % 3 === 0 ? 3 : 2;
      c.arc(0, 0, S / 2 - 8, a0, a1);
      c.stroke();
    }
  });
}

/** A four-point diamond spark. Pre-blurred by construction (a soft radial), so no live blur filter is needed. */
function makeGlint(): Texture {
  const S = 64;
  return canvasTex(S, S, (c) => {
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(210,255,250,0.55)');
    g.addColorStop(1, 'rgba(255,215,140,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = 'rgba(255,255,255,0.95)';
    // The four-point star: two slim crossed diamonds.
    c.beginPath(); c.moveTo(S / 2, 2); c.lineTo(S / 2 + 4, S / 2); c.lineTo(S / 2, S - 2); c.lineTo(S / 2 - 4, S / 2); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(2, S / 2); c.lineTo(S / 2, S / 2 - 4); c.lineTo(S - 2, S / 2); c.lineTo(S / 2, S / 2 + 4); c.closePath(); c.fill();
  });
}

/** The enchanted SEAL — a small non-text mark near the top, tying the card to Cia's 3-card progress. */
function makeSeal(): Texture {
  const S = 64;
  return canvasTex(S, S, (c) => {
    c.translate(S / 2, S / 2);
    c.rotate(Math.PI / 4);
    const g = c.createLinearGradient(-20, -20, 20, 20);
    g.addColorStop(0, 'rgba(255, 226, 160, 1)');
    g.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    g.addColorStop(1, 'rgba(130, 240, 228, 1)');
    c.fillStyle = g;
    c.fillRect(-15, -15, 30, 30);
    c.strokeStyle = 'rgba(120, 80, 20, 0.55)';
    c.lineWidth = 2.5;
    c.strokeRect(-15, -15, 30, 30);
  });
}

function ensureTextures(): void {
  foilTex ??= makeFoil();
  sweepTex ??= makeSweep();
  haloTex ??= makeHalo();
  glintTex ??= makeGlint();
  sealTex ??= makeSeal();
}

/* ── One enchanted offer's display tree ──────────────────────────────────────────────────────────────── */

const GLINT_POOL = 4; // pooled up front; `glintCount` only controls how many are LIT, never how many exist

interface Offer {
  uid: string;
  root: Container;
  halo: Sprite;
  foil: Sprite;
  sweep: Sprite;
  seal: Sprite;
  mask: Graphics;
  glints: Sprite[];
  /** Per-glint life in ms; <= 0 means parked. */
  glintLife: number[];
  t: number;        // ms since this offer's treatment began — drives every cycle
  w: number;        // last measured card size, in viewport px
  h: number;
  hover: number;    // 0..1 eased hover weight
}

function buildOffer(uid: string): Offer {
  ensureTextures();
  const root = new Container();
  root.eventMode = 'none'; // never a hit target — the DOM owns interaction

  const halo = new Sprite(haloTex!);
  halo.anchor.set(0.5);
  halo.blendMode = 'add';

  const clipped = new Container();
  clipped.eventMode = 'none';
  const mask = new Graphics();
  const foil = new Sprite(foilTex!);
  foil.anchor.set(0.5);
  foil.blendMode = 'add';
  const sweep = new Sprite(sweepTex!);
  sweep.anchor.set(0.5);
  sweep.blendMode = 'add';
  clipped.addChild(mask, foil, sweep);
  clipped.mask = mask;

  const glints: Sprite[] = [];
  const glintLife: number[] = [];
  const glintBox = new Container();
  glintBox.eventMode = 'none';
  for (let i = 0; i < GLINT_POOL; i++) {
    const g = new Sprite(glintTex!);
    g.anchor.set(0.5);
    g.blendMode = 'add';
    g.visible = false;
    glints.push(g);
    glintLife.push(0);
    glintBox.addChild(g);
  }

  const seal = new Sprite(sealTex!);
  seal.anchor.set(0.5);
  seal.blendMode = 'add';

  root.addChild(halo, clipped, glintBox, seal);
  return { uid, root, halo, foil, sweep, seal, mask, glints, glintLife, t: 0, w: 0, h: 0, hover: 0 };
}

function destroyOffer(o: Offer): void {
  o.root.parent?.removeChild(o.root);
  o.root.destroy({ children: true }); // textures are shared + reused, so they are NOT destroyed here
}

/* ── The controller ──────────────────────────────────────────────────────────────────────────────────── */

class CiaEnchantedFx {
  private root: Container | null = null;
  private offers = new Map<string, Offer>();
  private disposeMount: (() => void) | null = null;
  private disposeUpdate: (() => void) | null = null;
  /** The uids the UI says are enchanted right now. Diffed against `offers` on each sync. */
  private wanted: string[] = [];

  /** Tell the controller which offer uids are currently enchanted. Cheap + idempotent; call on shop changes. */
  sync(uids: readonly string[]): void {
    this.wanted = [...uids];
    for (const uid of this.wanted) if (!this.offers.has(uid)) this.add(uid);
    for (const uid of [...this.offers.keys()]) if (!this.wanted.includes(uid)) this.remove(uid);
    if (this.offers.size > 0) this.start();
    else this.stop();
  }

  private add(uid: string): void {
    if (!this.root) {
      this.root = new Container();
      this.root.eventMode = 'none';
    }
    const o = buildOffer(uid);
    this.root.addChild(o.root);
    this.offers.set(uid, o);
  }

  private remove(uid: string): void {
    const o = this.offers.get(uid);
    if (!o) return;
    destroyOffer(o);
    this.offers.delete(uid);
  }

  private start(): void {
    if (!this.root || this.disposeMount) return;
    this.disposeMount = pixiFx.mountLayer(this.root, 'over');
    this.disposeUpdate = pixiFx.addUpdater((dt) => this.update(dt));
    // Only now do we suppress the CSS fallback — if Pixi never came up, the rings keep playing.
    document.documentElement.classList.add('pixi-enchanted-ready');
  }

  /** Tear everything down once the last enchanted card is gone: no idle updater, no lingering sprites. */
  private stop(): void {
    this.disposeUpdate?.(); this.disposeUpdate = null;
    this.disposeMount?.(); this.disposeMount = null;
    document.documentElement.classList.remove('pixi-enchanted-ready');
    for (const uid of [...this.offers.keys()]) this.remove(uid);
    this.root?.destroy({ children: true });
    this.root = null;
  }

  /** Full teardown for unmount — same as `stop`, named for the hook's cleanup so intent reads clearly. */
  dispose(): void { this.stop(); }

  private update(dtMs: number): void {
    const cfg = getHeroFxConfig();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    for (const o of this.offers.values()) {
      // ── anchor: the DOM card is authoritative ──
      const el = document.querySelector(`.card.enchanted[data-uid="${CSS.escape(o.uid)}"]`);
      if (!el) { o.root.visible = false; continue; } // retire quietly; `sync` does the real removal
      const r = el.getBoundingClientRect();
      if (r.width === 0) { o.root.visible = false; continue; }
      o.root.visible = true;
      o.root.position.set(r.left + r.width / 2, r.top + r.height / 2);
      const resized = r.width !== o.w || r.height !== o.h;
      o.w = r.width; o.h = r.height;

      // Hover eases in/out so nothing snaps; the DOM owns the hover state, we only read it.
      const hovered = el.matches(':hover');
      const target = hovered ? 1 : 0;
      o.hover += (target - o.hover) * Math.min(1, dtMs / 120);

      if (resized) this.layout(o, cfg);
      if (reduced) { this.stillFrame(o, cfg); continue; }

      o.t += dtMs;
      this.animate(o, cfg, dtMs);
    }
  }

  /** Re-measure-dependent work — only on a size change, never per frame. */
  private layout(o: Offer, cfg: ReturnType<typeof getHeroFxConfig>): void {
    const { w, h } = o;
    // Halo sits just outside the card silhouette.
    const inset = cfg.ciaHaloInset * U;
    o.halo.width = w - inset * 2;
    o.halo.height = h - inset * 2;

    // MASK (first-prototype shape, per the handoff): the art window plus a narrow frame contour — never a
    // full opaque rectangle, which would tint the rules text and hurt readability.
    o.mask.clear();
    const artH = h * 0.60; // the art window occupies the card's top ~60% (see `.art` in styles.css)
    o.mask.roundRect(-w / 2 + w * 0.055, -h / 2 + h * 0.03, w * 0.89, artH, Math.min(w, h) * 0.08).fill(0xffffff);
    // The frame contour: a thin ring around the whole card so the foil catches its edges too.
    o.mask.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.10).stroke({ width: Math.max(2, w * 0.035), color: 0xffffff });

    // Foil is oversized so it can drift without exposing an edge.
    o.foil.width = w * 1.9;
    o.foil.height = h * 1.9;

    o.sweep.width = w * cfg.ciaSweepWidth * 4;
    o.sweep.height = Math.hypot(w, h) * 1.25;
    o.sweep.rotation = (cfg.ciaSweepAngle * Math.PI) / 180;

    const ss = cfg.ciaSealSize * U;
    o.seal.width = ss; o.seal.height = ss;
    o.seal.position.set(0, -h / 2 + ss * 0.55);
  }

  /** Reduced motion: an unmistakable but STATIC treatment — contour + seal, no drift, sweep or sparkle. */
  private stillFrame(o: Offer, cfg: ReturnType<typeof getHeroFxConfig>): void {
    o.halo.rotation = 0;
    o.halo.alpha = cfg.ciaHaloOpacity;
    o.foil.alpha = cfg.ciaFoilOpacity * 0.8;
    o.foil.position.set(0, 0);
    o.sweep.visible = false;
    o.seal.alpha = 1;
    for (const g of o.glints) g.visible = false;
  }

  private animate(o: Offer, cfg: ReturnType<typeof getHeroFxConfig>, dtMs: number): void {
    const boost = 1 + (cfg.ciaHoverBoost - 1) * o.hover;

    // 1) FOIL — a slow drift, so it reads as reflected light rather than a scrolling texture.
    const fp = Math.max(0.1, cfg.ciaFoilPeriod) * 1000;
    const fa = (o.t / fp) * Math.PI * 2;
    o.foil.position.set(Math.cos(fa) * o.w * 0.10, Math.sin(fa * 0.7) * o.h * 0.10);
    o.foil.rotation = Math.sin(fa * 0.5) * 0.06;
    o.foil.alpha = cfg.ciaFoilOpacity * boost;

    // 2) SWEEP — one pass per period, fully faded before the next begins.
    const sp = Math.max(0.2, cfg.ciaSweepPeriod) * 1000;
    const sd = Math.max(0.05, cfg.ciaSweepDuration) * 1000;
    const phase = o.t % sp;
    if (phase < sd) {
      const k = phase / sd;                    // 0 → 1 across the visible pass
      o.sweep.visible = true;
      const span = Math.hypot(o.w, o.h) * 0.85;
      const ang = (cfg.ciaSweepAngle * Math.PI) / 180;
      // Travels bottom-left → top-right along the sweep angle.
      o.sweep.position.set(Math.cos(ang) * (-span + 2 * span * k), Math.sin(ang) * (span - 2 * span * k));
      o.sweep.alpha = Math.sin(k * Math.PI) * boost; // in and out within the pass
      // 4) GLINTS ride the active sweep.
      this.spawnGlints(o, cfg, k);
    } else {
      o.sweep.visible = false;
    }

    // 3) HALO — a slow rotation of the segmented contour.
    const hp = Math.max(0.5, cfg.ciaHaloPeriod) * 1000;
    o.halo.rotation = (o.t / hp) * Math.PI * 2;
    o.halo.alpha = cfg.ciaHaloOpacity * boost;

    // SEAL — three subtle pulses per idle cycle, tying the card to Cia's 3-card progress.
    o.seal.alpha = 0.72 + 0.28 * Math.abs(Math.sin((o.t / (hp / 3)) * Math.PI));

    // Age the pooled glints.
    for (let i = 0; i < o.glints.length; i++) {
      if (o.glintLife[i]! <= 0) continue;
      o.glintLife[i] = o.glintLife[i]! - dtMs;
      const g = o.glints[i]!;
      if (o.glintLife[i]! <= 0) { g.visible = false; continue; }
      const k = o.glintLife[i]! / 420;
      g.alpha = Math.sin(k * Math.PI) * boost;
      g.rotation += dtMs * 0.004;
    }
  }

  /** Light up to `glintCount` pooled sparks along the sweep. Never allocates — the pool is fixed. */
  private spawnGlints(o: Offer, cfg: ReturnType<typeof getHeroFxConfig>, k: number): void {
    const want = Math.min(GLINT_POOL, Math.round(cfg.ciaGlintCount));
    let lit = 0;
    for (let i = 0; i < o.glints.length; i++) if (o.glintLife[i]! > 0) lit++;
    if (lit >= want) return;
    // Deterministic placement from the sweep phase + slot index — no RNG, so replays look identical.
    for (let i = 0; i < o.glints.length && lit < want; i++) {
      if (o.glintLife[i]! > 0) continue;
      const g = o.glints[i]!;
      const jitter = ((i * 37) % 100) / 100 - 0.5;
      g.position.set((k - 0.5) * o.w * 0.9 + jitter * o.w * 0.18, jitter * o.h * 0.55);
      const gs = cfg.ciaGlintSize * U * 2;
      g.width = gs; g.height = gs;
      g.visible = true;
      g.alpha = 0;
      o.glintLife[i] = 420;
      lit++;
    }
  }
}

export const ciaEnchantedFx = new CiaEnchantedFx();
