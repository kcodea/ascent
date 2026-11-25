/**
 * THE PACK SHOP: the Pixi scene (spec docs/superpowers/specs/2026-11-25-pack-shop-design.md, section 4). One stage: the
 * opener's lit stage shader under everything, a shelf of packs across the upper half (five in view, the centre one on
 * the pedestal, `shopLayout.ts`), the counter line and the hand below it.
 *
 * Contract (the React shell owns everything else):
 *  - Lifecycle like the opener's scene (`packOpening/packScene.ts`): `createShopScene` returns at once and starts Pixi
 *    asynchronously; calls made before it is up are kept and applied when it is. When Pixi is not allowed
 *    (`pixiAllowed()`), or init fails, every method is a no-op and the only event fired is `onUnavailable` (once; never
 *    after `destroy()`); when Pixi is not allowed it fires synchronously, inside `createShopScene`.
 *  - Coordinates: the scene lays out in CANVAS px through `shopLayout(app.screen.width, app.screen.height)`. Pointer
 *    positions arrive and every reported rect leaves in SCREEN px, converted through the canvas rect cached on pointer
 *    enter and on resize (never read per frame). `rectOf` is measured from the scene's own numbers, never the DOM.
 *  - The shelf: a pool of `POOL` shelf packs (`shelfPack.ts`), each showing the offer whose index matches its slot
 *    modulo the pool, posed every frame from `shelfPoseInto` while the scroll eases to its whole-step target. Wheel, a
 *    drag on empty shelf space and `scrollBy` move the target. A tab change (`setShelf` with another shelf) slides the
 *    old rack out and the new one in with one overshoot. `onCentre` fires when the scroll settles on a new offer.
 *  - Hover (mouse / pen: touch has no hover): the pack under the pointer lifts, tilts toward it with the opener's tilt
 *    maths and gloss (`packTilt.ts`), and `onHover` reports it with its lifted rect. There is no hover while the rack moves
 *    (`hoverAllowed`), so a reported rect never goes stale; it is re-picked from the pointer's last place once settled.
 *  - The hand, the carry and the counter (`setHand`, `setAffordable`, `buySettled`, `onPickUp`, `onOverLine`, `onDrop`)
 *    are the next part: today those calls are only kept.
 *  - One ticker; no allocation per frame; a pack whose pose `alpha` is 0 is not drawn. The ticker idles when nothing
 *    moves only when there is no stage shader (a lit stage never stops: its dust keeps drifting).
 */
import { Application, CanvasSource, Container, Texture, type Ticker } from 'pixi.js';
import type { OwnedPack, PackOffer } from '@game/progression';
import { stageScale } from '../../stage';
import { detachPixiDomEvents } from '../../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from '../../pixiAppSafety';
import { PIXI_ANTIALIAS } from '../../phoneArt';
import { phonePixiOptions, pixiAllowed } from '../../phoneDiag';
import { followStage } from '../../pixiStageFollow';
import { getDragFeel } from '../../dragFeel';
import { AURA_COLORS } from '../packOpening/packAura';
import { makeStage, type StageFx } from '../packOpening/packFx';
import { packGlowRarity } from '../packOpening/packGlow';
import { PACK_GEOM, paintGlossBand } from '../packOpening/packTextures';
import { aimInto, newTilt, stepTilt, tiltEaseK, type TiltState } from '../packOpening/packTilt';
import { ShelfPack, liftPoseInto } from './shelfPack';
import { clampScroll, shelfPoseInto, shopLayout, type PackPose, type ShopLayout } from './shopLayout';
import type { ShopSounds } from './shopSounds';

// ---------------------------------------------------------------- public contract

export interface ScreenRect { left: number; top: number; width: number; height: number }

export interface ShopSceneEvents {
  /** Pixi is not allowed here, or its init failed: nothing else will ever fire. */
  onUnavailable(): void;
  /** The pack under the pointer changed; `rect` is the lifted pack's, in screen px (null with no pack). */
  onHover(offerId: string | null, rect: ScreenRect | null): void;
  /** The offer on the pedestal changed (null: an empty shelf). */
  onCentre(offerId: string | null): void;
  onPickUp(from: 'shelf' | 'hand', id: string): void;
  onOverLine(over: boolean): void;
  onDrop(action: 'buy' | 'play' | 'return', id: string, rect: ScreenRect): void;
}

export interface ShopScene {
  /** Replaces the rack (a tab change slides it). */
  setShelf(offers: readonly PackOffer[]): void;
  setHand(packs: readonly OwnedPack[]): void;
  setAffordable(ids: ReadonlySet<string>): void;
  scrollBy(steps: number): void;
  buySettled(ok: boolean): void;
  /** Measured from the scene's own numbers, never the DOM. Null when the pack is not in view. */
  rectOf(id: string): ScreenRect | null;
  setInputEnabled(on: boolean): void;
  /** The handoff to the opener. */
  setVisible(on: boolean, fadeMs: number): void;
  destroy(): void;
}

// ---------------------------------------------------------------- constants (dt = 60 Hz frames)

/** Shelf packs in the pool: enough for every index a fractional scroll can show (`shelfPoseInto` fades past 2.6). */
const POOL = 7;
const FRAME_MS = 1000 / 60;
/** A cap on one frame's dt: a hitch never jumps the rack. */
const MAX_DT = 3;
/** The scroll's ease toward its target, per 60 Hz frame. */
const SCROLL_EASE = 0.16;
/** Below this the scroll snaps to its target (so it settles exactly and `onCentre` can fire). */
const SCROLL_SETTLE = 0.002;
/** A hovered pack's lift ease, per 60 Hz frame, and its snap. */
const LIFT_EASE = 0.22;
const LIFT_SETTLE = 0.002;
/** A tab change: the old rack leaves (ease in) then the new one arrives (ease out with one overshoot), in dt frames. */
const SLIDE_OUT = 11;
const SLIDE_IN = 28;
/** How far the rack travels to leave, in canvas widths. */
const SLIDE_DIST = 1.1;
/** The arrival's overshoot (easeOutBack's constant: about 4% of the travel). */
const SLIDE_BACK = 1.0;
/** Wheel travel (px) per scroll step. */
const WHEEL_STEP = 60;
/** A pack's width over its height. */
const ASPECT = PACK_GEOM.W / (PACK_GEOM.H + PACK_GEOM.BODY_H);
/** The stage's energy at rest, and its slow breath. */
const STAGE_ENERGY = 0.34;

const SLIDE_NONE = 0, SLIDE_OUT_PHASE = 1, SLIDE_IN_PHASE = 2;

/**
 * Whether a pack may be hovered this frame. Never while the rack moves (a tab slide, a scroll drag, or the scroll still
 * easing to its target): a hovered pack's reported rect would go stale as it travels. Once the rack settles the scene
 * re-picks the hover from the pointer's last position (it need not move) and reports the settled rect.
 */
export function hoverAllowed(
  pointerOn: boolean, inputOn: boolean, shown: boolean, sliding: boolean, scrollDrag: boolean, scrolling: boolean,
): boolean {
  return pointerOn && inputOn && shown && !sliding && !scrollDrag && !scrolling;
}

const easeOutBack = (u: number): number => {
  const c3 = SLIDE_BACK + 1, v = u - 1;
  return 1 + c3 * v * v * v + SLIDE_BACK * v * v;
};

class ShopSceneImpl implements ShopScene {
  private app: Application | null = null;
  private destroyed = false;
  private resizeObs: ResizeObserver | null = null;
  private unavailableFired = false;

  // what the shell asked for (kept across init)
  private offers: readonly PackOffer[] = [];
  /** The rack waiting for the old one to slide out (a tab change in flight). */
  private pending: readonly PackOffer[] | null = null;
  /** Kept for the hand and the carry (the next part draws them). */
  private readonly kept: { hand: readonly OwnedPack[]; affordable: ReadonlySet<string>; buyOk: boolean | null } = {
    hand: [], affordable: new Set(), buyOk: null,
  };
  private inputOn = true;

  // the scene
  private L: ShopLayout = shopLayout(1, 1);
  private stage: StageFx | null = null;
  private bandTex: Texture | null = null;
  private rack: Container | null = null;
  private readonly packs: ShelfPack[] = [];
  /** Per pool slot: the offer index and id it shows (-1 / null: none), its eased aim and its lift. */
  private readonly slotIdx = new Int32Array(POOL).fill(-1);
  private readonly slotId: (string | null)[] = new Array<string | null>(POOL).fill(null);
  private readonly slotTilt: TiltState[] = Array.from({ length: POOL }, newTilt);
  private readonly slotLift = new Float64Array(POOL);
  private time = 0;
  private readonly tintTo = new Float32Array([0.6, 0.66, 0.78]);

  // the rack's motion
  private scroll = 0;
  private target = 0;
  private centreKnown = false;
  private centreId: string | null = null;
  private readonly slide = { phase: SLIDE_NONE, t: 0, from: 0 };
  private rackX = 0;
  private readonly fade = { alpha: 1, to: 1, rate: 1 };

  // input (canvas px)
  private readonly rect = { l: 0, t: 0, w: 0, h: 0, valid: false };
  private pointerOn = false;
  private readonly pointer = { x: 0, y: 0 };
  private readonly scrollDrag = { active: false, id: -1, startX: 0, startTarget: 0 };
  private wheelAcc = 0;
  private hoverSlot = -1;
  private hoverId: string | null = null;
  private readonly hoverAim = { x: 0, y: 0 };

  // scratch (no per-frame allocation)
  private readonly pose: PackPose = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
  private readonly lifted: PackPose = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };

  constructor(
    private readonly host: HTMLElement,
    private readonly events: ShopSceneEvents,
    private readonly sounds: ShopSounds,
  ) {}

  // ---------------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    if (this.destroyed) return;
    if (!pixiAllowed()) { this.unavailable(); return; } // no Pixi: every method stays a no-op
    let app: Application | null = null;
    try {
      const res = Math.min(window.devicePixelRatio || 1, 2) * stageScale();
      app = new Application();
      await app.init(phonePixiOptions({
        resizeTo: this.host,
        backgroundAlpha: 0,
        antialias: PIXI_ANTIALIAS,
        autoDensity: true,
        resolution: res,
        preference: 'webgl',
        powerPreference: 'high-performance',
      }, stageScale())); // phone policy (phoneDiag.ts)
      detachPixiDomEvents(app); // our own native pointer listeners below; no Pixi EventSystem
      followStage(app);
      guardAppRender(app, 'shopScene');
      watchContextLoss(app, 'shopScene');
      if (this.destroyed) { destroyPixiApp(app); return; }
      this.app = app;
      this.build(app);
    } catch (e) {
      console.error('[shopScene] pixi init failed; the shell falls back to the scene-less shop:', e);
      if (app && this.app !== app) { try { destroyPixiApp(app); } catch { /* half-built */ } }
      const wanted = !this.destroyed;
      this.teardown();
      if (wanted) this.unavailable();
    }
  }

  private unavailable(): void {
    if (this.unavailableFired) return;
    this.unavailableFired = true;
    this.events.onUnavailable();
  }

  private build(app: Application): void {
    const webgl = (app.renderer as { name?: string }).name === 'webgl';
    this.stage = makeStage(webgl);
    if (this.stage) { app.stage.addChildAt(this.stage.mesh, 0); this.stage.mesh.visible = true; this.stage.u.uTint.set(this.tintTo); }
    this.bandTex = new Texture({ source: new CanvasSource({ resource: paintGlossBand() }) });
    const rack = new Container();
    for (let s = 0; s < POOL; s++) {
      const p = new ShelfPack(webgl, this.bandTex);
      this.packs.push(p);
      rack.addChild(p.view);
    }
    this.rack = rack;
    app.stage.addChild(rack);
    app.stage.alpha = this.fade.alpha;
    app.stage.visible = this.fade.alpha > 0;

    const canvas = app.canvas;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = this.fade.to > 0 ? 'auto' : 'none';
    canvas.style.touchAction = 'none'; // a finger drag scrolls the rack, never the page
    canvas.addEventListener('pointerenter', this.onEnter);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('lostpointercapture', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.host.appendChild(canvas);

    app.renderer.on('resize', this.layout);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => { this.app?.queueResize(); });
      this.resizeObs.observe(this.host);
    }
    this.layout();
    app.ticker.add(this.tick);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teardown();
  }

  private teardown(): void {
    this.destroyed = true;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    const app = this.app;
    this.app = null;
    if (!app) return; // pre-init: init()'s "still wanted?" check destroys the late Application
    const canvas = app.canvas;
    canvas.removeEventListener('pointerenter', this.onEnter);
    canvas.removeEventListener('pointerleave', this.onLeave);
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onUp);
    canvas.removeEventListener('lostpointercapture', this.onUp);
    canvas.removeEventListener('wheel', this.onWheel);
    app.renderer.off('resize', this.layout);
    app.ticker.remove(this.tick);
    app.ticker.stop();
    for (const p of this.packs) p.destroy();
    this.packs.length = 0;
    this.rack = null;
    this.bandTex?.destroy(true);
    this.bandTex = null;
    this.stage = null;
    destroyPixiApp(app); // never releases Pixi's shared global pools (pixiAppSafety.ts)
  }

  private wake(): void {
    const app = this.app;
    if (app && !this.destroyed && !app.ticker.started) app.ticker.start();
  }

  private emit(name: string, fn: () => void): void {
    try { fn(); } catch (e) { console.error(`[shopScene] ${name} handler threw:`, e); }
  }

  private readonly layout = (): void => {
    const app = this.app;
    if (!app) return;
    const w = app.screen.width, h = app.screen.height;
    this.L = shopLayout(w, h);
    if (this.stage) {
      this.stage.mesh.position.set(w / 2, h / 2); this.stage.mesh.scale.set(w / 2, h / 2);
      const u = this.stage.u;
      u.uAspect = w / Math.max(1, h);
      u.uFocus[0] = 0; u.uFocus[1] = (this.L.shelfY / Math.max(1, h)) * 2 - 1; // the spotlight falls on the pedestal
    }
    this.cacheRect();
    this.wake();
  };

  // ---------------------------------------------------------------- the shell's calls

  setShelf(offers: readonly PackOffer[]): void {
    if (this.destroyed) return;
    const next = offers.slice();
    const current = this.pending ?? this.offers;
    const sameShelf = current.length > 0 && next.length > 0 && current[0]!.shelf === next[0]!.shelf;
    if (this.pending && sameShelf) { this.pending = next; return; } // the arriving shelf, updated mid-slide
    if (!this.app || sameShelf || (this.offers.length === 0 && next.length === 0)) {
      this.replaceRack(next, sameShelf);
      return;
    }
    // a tab change: the old rack slides out, then the new one in
    this.pending = next;
    const sl = this.slide;
    if (sl.phase !== SLIDE_OUT_PHASE) { sl.phase = SLIDE_OUT_PHASE; sl.t = 0; sl.from = this.rackX; }
    this.endScrollDrag();
    this.sounds.rack();
    this.wake();
  }

  setHand(packs: readonly OwnedPack[]): void {
    if (this.destroyed) return;
    this.kept.hand = packs.slice();
  }

  setAffordable(ids: ReadonlySet<string>): void {
    if (this.destroyed) return;
    this.kept.affordable = new Set(ids);
  }

  buySettled(ok: boolean): void {
    if (this.destroyed) return;
    this.kept.buyOk = ok;
  }

  scrollBy(steps: number): void {
    if (this.destroyed) return;
    const n = Math.round(steps);
    if (!n) return;
    this.target = clampScroll(this.target + n, this.offers.length);
    if (!this.app) this.scroll = this.target;
    this.wake();
  }

  rectOf(id: string): ScreenRect | null {
    const app = this.app;
    if (!app || this.destroyed) return null;
    const i = this.offers.findIndex((o) => o.offerId === id);
    if (i < 0) return null;
    const p = shelfPoseInto(this.pose, this.L, i, this.scroll);
    if (p.alpha <= 0) return null;
    p.x += this.rackX;
    const s = this.slotId.indexOf(id);
    return this.screenRect(liftPoseInto(this.lifted, p, s >= 0 ? this.slotLift[s]! : 0));
  }

  setInputEnabled(on: boolean): void {
    if (this.destroyed) return;
    this.inputOn = on;
    if (!on) this.endScrollDrag();
    this.wake(); // the hover drops (or comes back) on the next frame
  }

  setVisible(on: boolean, fadeMs: number): void {
    if (this.destroyed) return;
    const f = this.fade;
    f.to = on ? 1 : 0;
    f.rate = fadeMs > 0 ? FRAME_MS / fadeMs : 1;
    const app = this.app;
    if (!app) { f.alpha = f.to; return; }
    app.canvas.style.pointerEvents = on ? 'auto' : 'none';
    if (!on) { this.pointerOn = false; this.endScrollDrag(); }
    this.wake();
  }

  /** Swap the rack's offers in place. `keepCentre`: the same shelf updated, so the pedestal keeps its offer. */
  private replaceRack(next: readonly PackOffer[], keepCentre: boolean): void {
    const centre = keepCentre ? this.offers[Math.round(this.target)]?.offerId : undefined;
    this.offers = next;
    const kept = centre === undefined ? -1 : next.findIndex((o) => o.offerId === centre);
    this.target = kept >= 0 ? kept : keepCentre ? clampScroll(this.target, next.length) : 0;
    if (!keepCentre || !this.app) this.scroll = this.target;
    this.slotId.fill(null); // rebind every slot (a look may have changed under the same id)
    this.wake();
  }

  // ---------------------------------------------------------------- the frame

  private readonly tick = (tk: Ticker): void => {
    const app = this.app;
    if (!app) return;
    const dt = Math.min(MAX_DT, tk.deltaTime);
    this.time += dt;
    let moving = this.slideStep(dt);
    if (this.scrollStep(dt)) moving = true;
    this.hoverStep();
    if (this.rackStep(dt)) moving = true;
    if (this.fadeStep(dt)) moving = true;
    this.stageStep(dt);
    if (!moving && !this.stage) app.ticker.stop(); // (a lit stage never stops: its dust keeps drifting)
  };

  /** A tab change in flight: the old rack leaves to the left, the new one arrives from the right and overshoots once. */
  private slideStep(dt: number): boolean {
    const sl = this.slide;
    if (sl.phase === SLIDE_NONE) return false;
    const dist = this.L.w * SLIDE_DIST;
    sl.t += dt;
    if (sl.phase === SLIDE_OUT_PHASE) {
      const u = Math.min(1, sl.t / SLIDE_OUT);
      this.rackX = sl.from + (-dist - sl.from) * u * u;
      if (u >= 1) {
        this.replaceRack(this.pending ?? [], false);
        this.pending = null;
        sl.phase = SLIDE_IN_PHASE; sl.t = 0;
        this.rackX = dist;
      }
    } else {
      const u = Math.min(1, sl.t / SLIDE_IN);
      this.rackX = dist * (1 - easeOutBack(u));
      if (u >= 1) { this.rackX = 0; sl.phase = SLIDE_NONE; }
    }
    return true;
  }

  /** Ease the scroll to its whole-step target; once settled (and no tab change is in flight) report a new centre. */
  private scrollStep(dt: number): boolean {
    let moving = false;
    if (this.scroll !== this.target) {
      this.scroll += (this.target - this.scroll) * (1 - Math.pow(1 - SCROLL_EASE, dt));
      if (Math.abs(this.target - this.scroll) < SCROLL_SETTLE) this.scroll = this.target;
      moving = true;
    }
    if (this.scroll === this.target && this.slide.phase === SLIDE_NONE) {
      const offer = this.offers[this.target];
      const id = offer?.offerId ?? null;
      if (!this.centreKnown || id !== this.centreId) {
        this.centreKnown = true;
        this.centreId = id;
        if (offer) this.tintTo.set(AURA_COLORS[packGlowRarity(offer.look)][0]);
        this.emit('onCentre', () => this.events.onCentre(id));
      }
    }
    return moving;
  }

  /** Which pack is under the pointer (as drawn: with its current lift), and the pointer's aim over it. */
  private hoverStep(): void {
    let slot = -1;
    // (positional, not an options object: this runs every frame and allocates nothing)
    if (hoverAllowed(this.pointerOn, this.inputOn, this.fade.to > 0, this.slide.phase !== SLIDE_NONE, this.scrollDrag.active,
      this.scroll !== this.target)) {
      slot = this.packAt(this.pointer.x, this.pointer.y);
      if (slot >= 0) {
        const q = this.lifted; // posed by packAt for the hit
        const k = q.h / (PACK_GEOM.H + PACK_GEOM.BODY_H);
        aimInto(this.hoverAim, (this.pointer.x - q.x) / k + PACK_GEOM.W / 2, (this.pointer.y - q.y) / k + (PACK_GEOM.H + PACK_GEOM.BODY_H) / 2,
          PACK_GEOM.W, PACK_GEOM.H + PACK_GEOM.BODY_H);
      }
    }
    const id = slot >= 0 ? this.slotId[slot]! : null;
    this.hoverSlot = slot;
    if (id === this.hoverId) return;
    this.hoverId = id;
    if (slot >= 0) this.rack?.setChildIndex(this.packs[slot]!.view, POOL - 1); // a lifted pack draws over its neighbours
    let rect: ScreenRect | null = null;
    if (slot >= 0) {
      const p = shelfPoseInto(this.pose, this.L, this.slotIdx[slot]!, this.scroll);
      p.x += this.rackX;
      rect = this.screenRect(liftPoseInto(this.lifted, p, 1));
    }
    this.emit('onHover', () => this.events.onHover(id, rect));
  }

  /** The pool slot whose pack (as drawn) holds canvas point (x, y), or -1. Leaves that pack's lifted pose in `lifted`. */
  private packAt(x: number, y: number): number {
    for (let s = 0; s < POOL; s++) {
      const i = this.slotIdx[s]!;
      if (i < 0 || this.slotId[s] === null) continue;
      const p = shelfPoseInto(this.pose, this.L, i, this.scroll);
      if (p.alpha <= 0) continue;
      p.x += this.rackX;
      const q = liftPoseInto(this.lifted, p, this.slotLift[s]!);
      if (Math.abs(x - q.x) <= (q.h * ASPECT) / 2 && Math.abs(y - q.y) <= q.h / 2) return s;
    }
    return -1;
  }

  /** Bind each pool slot to its offer, ease its lift and tilt, and pose it. True while anything moves. */
  private rackStep(dt: number): boolean {
    const offers = this.offers, count = offers.length, L = this.L;
    const base = Math.floor(this.scroll) - (POOL >> 1);
    const k = tiltEaseK(getDragFeel().tiltEase, dt * FRAME_MS);
    const kl = 1 - Math.pow(1 - LIFT_EASE, dt);
    let moving = false;
    for (let s = 0; s < POOL; s++) {
      const pack = this.packs[s]!;
      const i = base + ((((s - base) % POOL) + POOL) % POOL); // the index this slot shows: i = s (mod POOL)
      const tilt = this.slotTilt[s]!;
      if (i < 0 || i >= count) {
        if (this.slotIdx[s] !== -1 || this.slotId[s] !== null) { this.slotIdx[s] = -1; this.slotId[s] = null; }
        tilt.ax = 0; tilt.ay = 0; this.slotLift[s] = 0;
        pack.view.visible = false;
        continue;
      }
      const offer = offers[i]!;
      if (this.slotId[s] !== offer.offerId) {
        pack.setLook(offer.look);
        this.slotId[s] = offer.offerId;
        tilt.ax = 0; tilt.ay = 0; this.slotLift[s] = 0;
      }
      this.slotIdx[s] = i;
      const p = shelfPoseInto(this.pose, L, i, this.scroll);
      p.x += this.rackX;
      const hovered = s === this.hoverSlot;
      if (stepTilt(tilt, hovered ? this.hoverAim.x : 0, hovered ? this.hoverAim.y : 0, 0, 0, k)) moving = true;
      const liftTo = hovered ? 1 : 0;
      let lift = this.slotLift[s]!;
      if (lift !== liftTo) {
        lift += (liftTo - lift) * kl;
        if (Math.abs(liftTo - lift) < LIFT_SETTLE) lift = liftTo;
        this.slotLift[s] = lift;
        moving = true;
      }
      pack.pose(p, tilt.ax, tilt.ay, lift);
    }
    return moving;
  }

  private fadeStep(dt: number): boolean {
    const f = this.fade, app = this.app!;
    if (f.alpha === f.to) return false;
    f.alpha = f.to > f.alpha ? Math.min(f.to, f.alpha + f.rate * dt) : Math.max(f.to, f.alpha - f.rate * dt);
    app.stage.alpha = f.alpha;
    app.stage.visible = f.alpha > 0;
    return true;
  }

  /** The stage's clock, its slow breath and its pool of light easing to the pedestal pack's colour. Uniforms only. */
  private stageStep(dt: number): void {
    const st = this.stage;
    if (!st) return;
    const u = st.u;
    u.uTime = this.time / 60;
    u.uEnergy = STAGE_ENERGY + 0.1 * Math.sin(this.time * 0.03);
    const tint = u.uTint, to = this.tintTo, e = Math.min(1, 0.06 * dt);
    for (let c = 0; c < 3; c++) tint[c] = tint[c]! + (to[c]! - tint[c]!) * e;
  }

  // ---------------------------------------------------------------- input

  private cacheRect(): void {
    const app = this.app;
    if (!app) return;
    const r = app.canvas.getBoundingClientRect();
    this.rect.l = r.left; this.rect.t = r.top; this.rect.w = r.width; this.rect.h = r.height;
    this.rect.valid = r.width > 0 && r.height > 0;
  }

  /** A pose (canvas px) as a screen rect. */
  private screenRect(q: PackPose): ScreenRect | null {
    const app = this.app;
    if (!app) return null;
    if (!this.rect.valid) this.cacheRect(); // only when the last measure was unusable, never per frame
    if (!this.rect.valid) return null;
    const sx = this.rect.w / Math.max(1, app.screen.width), sy = this.rect.h / Math.max(1, app.screen.height);
    const w = q.h * ASPECT;
    return { left: this.rect.l + (q.x - w / 2) * sx, top: this.rect.t + (q.y - q.h / 2) * sy, width: w * sx, height: q.h * sy };
  }

  /** A pointer event's position in canvas px (into `this.pointer`). False when there is no usable rect. */
  private toCanvas(e: PointerEvent): boolean {
    const app = this.app;
    if (!app) return false;
    if (!this.rect.valid) this.cacheRect();
    if (!this.rect.valid) return false;
    this.pointer.x = ((e.clientX - this.rect.l) * app.screen.width) / this.rect.w;
    this.pointer.y = ((e.clientY - this.rect.t) * app.screen.height) / this.rect.h;
    return true;
  }

  private readonly onEnter = (): void => { this.cacheRect(); };

  private readonly onLeave = (): void => { this.pointerOn = false; this.wake(); };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.app || !this.toCanvas(e)) return;
    const d = this.scrollDrag;
    if (d.active && e.pointerId === d.id) {
      // whole steps: the rack follows the drag a pack at a time
      const steps = Math.round((d.startX - this.pointer.x) / Math.max(1, this.L.slotStep));
      this.target = clampScroll(d.startTarget + steps, this.offers.length);
      this.wake();
      return;
    }
    this.pointerOn = e.pointerType !== 'touch'; // touch has no hover
    if (this.pointerOn) this.wake();
  };

  private readonly onDown = (e: PointerEvent): void => {
    const app = this.app;
    if (!app || !this.inputOn || this.slide.phase !== SLIDE_NONE || this.scrollDrag.active) return;
    this.cacheRect();
    if (!this.toCanvas(e)) return;
    const { x, y } = this.pointer;
    if (y >= this.L.lineY || this.packAt(x, y) >= 0) return; // a pack (picked up in the next part) or below the counter
    const d = this.scrollDrag;
    d.active = true; d.id = e.pointerId; d.startX = x; d.startTarget = this.target;
    try { app.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    e.preventDefault();
    this.wake();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.scrollDrag.active && e.pointerId === this.scrollDrag.id) this.endScrollDrag();
  };

  private endScrollDrag(): void {
    this.scrollDrag.active = false;
    this.scrollDrag.id = -1;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.app || !this.inputOn || this.slide.phase !== SLIDE_NONE) return;
    e.preventDefault(); // the wheel scrolls the rack, never the page
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const delta = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * 400 : raw;
    this.wheelAcc += delta;
    if (Math.abs(this.wheelAcc) < WHEEL_STEP) return;
    this.scrollBy(Math.sign(this.wheelAcc));
    this.wheelAcc = 0;
  };
}

export function createShopScene(host: HTMLElement, events: ShopSceneEvents, sounds: ShopSounds): ShopScene {
  const scene = new ShopSceneImpl(host, events, sounds);
  void scene.init();
  return scene;
}
