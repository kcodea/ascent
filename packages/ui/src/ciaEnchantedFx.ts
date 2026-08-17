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
import { Container, Sprite, Texture } from 'pixi.js';
import { pixiFx } from './pixiFx';
import { getHeroFxConfig } from './heroFxConfig';

/** Design-pixel basis the tuner's sizes are authored against (matches the CSS `--u` convention). */
const U = 1;

/* ── Textures (built once, reused forever) ───────────────────────────────────────────────────────────── */

/**
 * The colour-bearing textures, cached per (warm, cool) pair.
 *
 * They bake their gradients rather than being tinted at draw time, because a holographic surface needs TWO
 * tones interleaved — a single `tint` multiply can only push everything toward one colour and would flatten
 * exactly the interplay that makes it read as foil. Rebuilt only when the owner moves a colour picker, so the
 * steady-state cost is unchanged.
 */
interface ColorTextures { foil: Texture; sweep: Texture; halo: Texture; glint: Texture; seal: Texture }
const colorCache = new Map<string, ColorTextures>();

/** `#rrggbb` → `r, g, b` for use inside an `rgba()` string. */
function rgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Texture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (ctx) draw(ctx);
  return Texture.from(cv);
}

/** A crystalline gold/teal/white wash. Drifts under the mask; never seen as a full rainbow sheet. */
function makeFoil(A: string, B: string): Texture {
  return canvasTex(256, 256, (c) => {
    const g = c.createLinearGradient(0, 256, 256, 0);
    g.addColorStop(0.00, `rgba(${A}, 0.00)`);
    g.addColorStop(0.18, `rgba(${A}, 0.85)`);
    g.addColorStop(0.34, 'rgba(255, 255, 255, 0.95)');
    g.addColorStop(0.50, `rgba(${B}, 0.85)`);
    g.addColorStop(0.66, 'rgba(255, 255, 255, 0.80)');
    g.addColorStop(0.82, `rgba(${A}, 0.75)`);
    g.addColorStop(1.00, `rgba(${A}, 0.00)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    // Faceting: a few soft diagonal bands so it reads as crystal rather than a smooth ramp.
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      c.save();
      c.translate(128, 128);
      c.rotate((-35 * Math.PI) / 180);
      c.globalAlpha = 0.10 + (i % 3) * 0.05;
      c.fillStyle = i % 2 ? `rgb(${B})` : `rgb(${A})`;
      c.fillRect(-180 + i * 46, -180, 10 + (i % 3) * 6, 360);
      c.restore();
    }
  });
}

/** The travelling band: a narrow white-hot leading edge with a wider, dimmer gold/teal body behind it. */
function makeSweep(A: string, B: string): Texture {
  return canvasTex(128, 8, (c) => {
    const g = c.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0.00, `rgba(${A}, 0.00)`);
    g.addColorStop(0.55, `rgba(${B}, 0.45)`);
    g.addColorStop(0.82, 'rgba(255, 255, 255, 1.00)'); // the hot edge, deliberately near the front
    g.addColorStop(0.92, `rgba(${A}, 0.60)`);
    g.addColorStop(1.00, `rgba(${A}, 0.00)`);
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 8);
  });
}

/** A SEGMENTED contour — gold with teal-white highlights, broken into arcs so it reads as enchanted script. */
function makeHalo(A: string, B: string): Texture {
  const S = 256;
  return canvasTex(S, S, (c) => {
    c.translate(S / 2, S / 2);
    c.lineCap = 'round';
    const segs = 14;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / segs * 0.55; // broken: each arc covers just over half its slot
      c.beginPath();
      c.strokeStyle = i % 3 === 0 ? `rgba(${B}, 0.95)` : `rgba(${A}, 0.9)`;
      c.lineWidth = i % 3 === 0 ? 3 : 2;
      c.arc(0, 0, S / 2 - 8, a0, a1);
      c.stroke();
    }
  });
}

/** A four-point diamond spark. Pre-blurred by construction (a soft radial), so no live blur filter is needed. */
function makeGlint(A: string, B: string): Texture {
  const S = 64;
  return canvasTex(S, S, (c) => {
    const g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, `rgba(${B}, 0.55)`);
    g.addColorStop(1, `rgba(${A}, 0)`);
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
function makeSeal(A: string, B: string): Texture {
  const S = 64;
  return canvasTex(S, S, (c) => {
    c.translate(S / 2, S / 2);
    c.rotate(Math.PI / 4);
    const g = c.createLinearGradient(-20, -20, 20, 20);
    g.addColorStop(0, `rgba(${A}, 1)`);
    g.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    g.addColorStop(1, `rgba(${B}, 1)`);
    c.fillStyle = g;
    c.fillRect(-15, -15, 30, 30);
    c.strokeStyle = 'rgba(120, 80, 20, 0.55)';
    c.lineWidth = 2.5;
    c.strokeRect(-15, -15, 30, 30);
  });
}

/**
 * The foil's alpha MASK, cached per SHAPE.
 *
 * The panel's roundness and edge softness are now tunable, so the texture depends on them — it is keyed and
 * reused rather than rebuilt per frame. `radius`/`feather` are fractions of the short side, so one square
 * texture stretches correctly to any art window.
 *
 * The feather is what stops it reading as a pane of glass laid ON the card: the alpha ramps to nothing before
 * the edge, so there is no boundary to see.
 */
const maskCache = new Map<string, Texture>();
function maskFor(radiusFrac: number, featherFrac: number): Texture {
  const key = `${radiusFrac.toFixed(2)}|${featherFrac.toFixed(2)}`;
  const hit = maskCache.get(key);
  if (hit) return hit;
  const S = 256;
  const f = Math.max(1, Math.round(featherFrac * S * 0.5));
  const r = Math.max(0, Math.round(radiusFrac * S));
  const tex = canvasTex(S, S, (c) => {
    // Build the alpha as a stack of concentric rounded rects at rising alpha — a soft ramp inward from the
    // edge, which is cheaper and more predictable than blurring a hard shape.
    const steps = Math.max(1, f);
    for (let i = 0; i < steps; i++) {
      const k = i / steps;              // 0 at the outer edge → 1 at the solid core
      const inset = f * (1 - k);
      c.fillStyle = `rgba(255,255,255,${(1 / steps) * 1.6})`;
      c.beginPath();
      c.roundRect(inset, inset, S - inset * 2, S - inset * 2, Math.max(0, r - inset * 0.5));
      c.fill();
    }
  });
  maskCache.set(key, tex);
  return tex;
}

/** Build (or reuse) the texture set for the current colour pair, and remember it as the live set. */
function ensureTextures(): ColorTextures {
  const cfg = getHeroFxConfig();
  const key = `${cfg.ciaColorA}|${cfg.ciaColorB}`;
  let set = colorCache.get(key);
  if (!set) {
    const A = rgb(cfg.ciaColorA), B = rgb(cfg.ciaColorB);
    set = { foil: makeFoil(A, B), sweep: makeSweep(A, B), halo: makeHalo(A, B), glint: makeGlint(A, B), seal: makeSeal(A, B) };
    colorCache.set(key, set);
  }
  return set;
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
  mask: Sprite;
  glints: Sprite[];
  /** Per-glint life in ms; <= 0 means parked. */
  glintLife: number[];
  t: number;        // ms since this offer's treatment began — drives every cycle
  w: number;        // last measured card size, in viewport px
  h: number;
  ax: number;       // art-window centre + size, relative to the card centre, in viewport px
  ay: number;
  aw: number;
  ah: number;
  fx: number;       // the FITTED foil box (art window + the tuner's fit dials)
  fy: number;
  fw: number;
  fh: number;
  /** The fit dials this offer was last laid out for — a change re-runs `layout` without a resize. */
  fitKey: string;
  /** Frames the anchor element has been missing. A bought card unmounts, so this retires the treatment even
   *  if the uid sync has not landed yet — otherwise the foil hangs in the shop after a purchase. */
  missing: number;
  hover: number;    // 0..1 eased hover weight
}

function buildOffer(uid: string): Offer {
  const t = ensureTextures();
  const root = new Container();
  root.eventMode = 'none'; // never a hit target — the DOM owns interaction

  const halo = new Sprite(t.halo);
  halo.anchor.set(0.5);
  halo.blendMode = 'add';

  const clipped = new Container();
  clipped.eventMode = 'none';
  const mask = new Sprite(Texture.WHITE); // real shape assigned on first layout, from the tuner's dials
  mask.anchor.set(0.5);
  const foil = new Sprite(t.foil);
  foil.anchor.set(0.5);
  foil.blendMode = 'add';
  const sweep = new Sprite(t.sweep);
  sweep.anchor.set(0.5);
  sweep.blendMode = 'add';
  clipped.addChild(mask, foil, sweep);
  clipped.mask = mask;

  const glints: Sprite[] = [];
  const glintLife: number[] = [];
  const glintBox = new Container();
  glintBox.eventMode = 'none';
  for (let i = 0; i < GLINT_POOL; i++) {
    const g = new Sprite(t.glint);
    g.anchor.set(0.5);
    g.blendMode = 'add';
    g.visible = false;
    glints.push(g);
    glintLife.push(0);
    glintBox.addChild(g);
  }

  const seal = new Sprite(t.seal);
  seal.anchor.set(0.5);
  seal.blendMode = 'add';

  root.addChild(halo, clipped, glintBox, seal);
  return { uid, root, halo, foil, sweep, seal, mask, glints, glintLife, t: 0, w: 0, h: 0, ax: 0, ay: 0, aw: 0, ah: 0, fx: 0, fy: 0, fw: 0, fh: 0, fitKey: '', missing: 0, hover: 0 };
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
    const dead: string[] = [];
    for (const o of this.offers.values()) {
      // ── anchor: the DOM card is authoritative ──
      const el = document.querySelector(`.card.enchanted[data-uid="${CSS.escape(o.uid)}"]`);
      const r = el?.getBoundingClientRect();
      if (!el || !r || r.width === 0) {
        // The card is gone — bought, rerolled, or the shop unmounted. Retire the treatment OURSELVES rather
        // than waiting for the uid sync: buying an enchanted card left its foil hanging in the shop, because
        // the offer is spliced out and the sync can land a frame or more later (owner report 2026-08-17).
        o.root.visible = false;
        if (++o.missing >= 2) dead.push(o.uid);
        continue;
      }
      o.missing = 0;
      // While this card is being DRAGGED the source stays put but dimmed and a ghost follows the pointer, so
      // a foil sitting on the source reads as being left behind (owner report 2026-08-17). Hide for the drag.
      if (el.classList.contains('dragsrc')) { o.root.visible = false; continue; }
      o.root.visible = true;
      o.root.position.set(r.left + r.width / 2, r.top + r.height / 2);
      // The ART WINDOW is what the foil sits on, and it moves with frame/compact/tribe treatment — so measure
      // it rather than deriving it from a fraction of the card. Falls back to the card box if the node is
      // ever absent, which keeps the effect alive on any future card shape that has no `.art`.
      const artEl = el.querySelector('.art');
      const ar = artEl?.getBoundingClientRect();
      const nax = ar ? ar.left + ar.width / 2 - (r.left + r.width / 2) : 0;
      const nay = ar ? ar.top + ar.height / 2 - (r.top + r.height / 2) : 0;
      const naw = ar?.width || r.width * 0.86;
      const nah = ar?.height || r.height * 0.56;
      const fitKey = `${cfg.ciaFitX}|${cfg.ciaFitY}|${cfg.ciaFitW}|${cfg.ciaFitH}|${cfg.ciaFitRadius}|${cfg.ciaFeather}|${cfg.ciaSealSize}|${cfg.ciaHaloInset}|${cfg.ciaSweepWidth}|${cfg.ciaSweepAngle}|${cfg.ciaColorA}|${cfg.ciaColorB}`;
      const resized = r.width !== o.w || r.height !== o.h || naw !== o.aw || nah !== o.ah
        || nax !== o.ax || nay !== o.ay || fitKey !== o.fitKey;
      o.fitKey = fitKey;
      o.w = r.width; o.h = r.height;
      o.ax = nax; o.ay = nay; o.aw = naw; o.ah = nah;

      // Hover eases in/out so nothing snaps; the DOM owns the hover state, we only read it.
      const hovered = el.matches(':hover');
      const target = hovered ? 1 : 0;
      o.hover += (target - o.hover) * Math.min(1, dtMs / 120);

      if (resized) this.layout(o, cfg);
      if (reduced) { this.stillFrame(o, cfg); continue; }

      o.t += dtMs;
      this.animate(o, cfg, dtMs);
    }
    // Retire outside the iteration so we never mutate the map mid-loop.
    for (const uid of dead) this.remove(uid);
    if (dead.length && this.offers.size === 0) this.stop();
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
    // The mask is fitted to the MEASURED art window (`o.ax/ay/aw/ah`), not to a fraction of the card. The
    // card is a shield silhouette whose art region moves with frame, compact mode and tribe treatment, so a
    // hardcoded fraction was wrong for every variant (owner report 2026-08-17).
    // FIT dials: the measured art window is the starting point, not the final answer — the visible art is a
    // different shape per frame treatment, so the owner nudges/scales from here.
    const fw = o.aw * cfg.ciaFitW;
    const fh = o.ah * cfg.ciaFitH;
    const fx = o.ax + cfg.ciaFitX * U;
    const fy = o.ay + cfg.ciaFitY * U;
    o.fx = fx; o.fy = fy; o.fw = fw; o.fh = fh;
    o.mask.texture = maskFor(cfg.ciaFitRadius, cfg.ciaFeather);
    o.mask.width = fw;
    o.mask.height = fh;
    o.mask.position.set(fx, fy);

    // Foil is oversized so it can drift without ever exposing its own edge inside the mask.
    o.foil.width = fw * 1.8;
    o.foil.height = fh * 1.8;
    o.foil.position.set(fx, fy);

    o.sweep.width = fw * cfg.ciaSweepWidth * 4;
    o.sweep.height = Math.hypot(fw, fh) * 1.4;
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
    o.foil.position.set(o.fx, o.fy);
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
      const span = Math.hypot(o.fw, o.fh) * 0.85;
      const ang = (cfg.ciaSweepAngle * Math.PI) / 180;
      // Travels bottom-left → top-right along the sweep angle.
      o.sweep.position.set(o.fx + Math.cos(ang) * (-span + 2 * span * k), o.fy + Math.sin(ang) * (span - 2 * span * k));
      o.sweep.alpha = Math.sin(k * Math.PI) * boost; // in and out within the pass
      // 4) GLINTS ride the active sweep.
      this.spawnGlints(o, cfg, k);
    } else {
      o.sweep.visible = false;
    }

    // Zeroed layers are skipped rather than drawn transparent — an invisible sprite still costs a draw call,
    // and the owner's tune switches three of them off entirely (2026-08-17).
    o.halo.visible = cfg.ciaHaloOpacity > 0;
    o.seal.visible = cfg.ciaSealSize > 0;
    if (!o.halo.visible && !o.seal.visible && cfg.ciaGlintCount <= 0) {
      // Foil + sweep only. Park any glint still lit from a previous setting first — skipping the ageing loop
      // below would otherwise freeze it on screen when the count is turned back down to zero.
      for (let i = 0; i < o.glints.length; i++) {
        if (o.glintLife[i]! <= 0) continue;
        o.glintLife[i] = 0;
        o.glints[i]!.visible = false;
      }
      return;
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
      g.position.set(o.fx + (k - 0.5) * o.fw * 0.9 + jitter * o.fw * 0.18, o.fy + jitter * o.fh * 0.55);
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
