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
 *    maths and gloss (`packTilt.ts`), its two neighbours lean away a touch, and `onHover` reports it with its lifted rect.
 *    There is no hover while the rack moves (`hoverAllowed`) or while a pack is held or travelling, so a reported rect
 *    never goes stale; it is re-picked from the pointer's last place once settled. A slow wave of light travels along the shelf at rest (`IDLE_AIM`).
 *  - The carry (spec 4.3 to 4.6): every decision goes through the drag state machine (`shopDrag.ts`). A press on a shelf
 *    or hand pack picks it up (`onPickUp`, the crinkle); it follows the pointer with the in-game drag feel (`dragFeel.ts`:
 *    the follow, the recentre and the travel dive), a shelf pack's price tag hangs behind it on a damped spring, and its
 *    place keeps a faint ghost of the pack. The counter line at `lineY` lights while `overLine` (`onOverLine` on each change). An
 *    unaffordable shelf pack carried below the line is pulled back toward it (`rubberY`). Shaking a held pack (three
 *    direction changes within 400 ms, `stepShake`) rattles its cards. Release maps through `release()` to
 *    `onDrop(action, id, rect)` (rect: the pack as drawn at that moment, screen px). `buy` holds the pack at its hand
 *    place with a shimmer until `buySettled(ok)`: ok sends it into the hand, not ok back to the shelf. `play` sends it to
 *    the pedestal, where it stays (the shelf fades) until `setVisible(true)` or the next pick-up. A lost pointer, a
 *    renderer resize, `setInputEnabled(false)` or `setVisible(false)` while holding calls `cancelHeld`: the pack returns
 *    to where it came from, reported as `onDrop('return', ...)`.
 *  - The hand: owned packs fan along the bottom (`handPoseInto`), more than seven stack into a counted pile at the fan's
 *    end (`handPile`); hover lifts one and its neighbours make room; a press on the pile takes its top pack. A purchase
 *    in flight holds a place at the fan's end for the pack on its way in. Each view is bound to ONE pack (`bindFan`):
 *    when the hand changes every pack glides to its new place and a pack new to the fan rises in from below; a hand
 *    that grew by more than one (a box) brings its packs in one after another (`staggerArrivals`), the box itself
 *    sinking into the hand. Hit tests always use the RESTING fan, never the eased poses.
 *  - Returns: a pack put back (above the line, or a hand pack off the pedestal) travels to its place, keeps the tilt it
 *    arrived with and sits down with a small bob (`settleDip`). No snap at arrival.
 *  - One ticker; no allocation per frame; a pack whose pose `alpha` is 0 is not drawn. The ticker idles when nothing
 *    moves only when there is no stage shader (a lit stage never stops: its dust keeps drifting), and always once the
 *    scene has faded out under the opener with no Aether in flight (`hiddenAsleep`); `setVisible(true)` wakes it.
 */
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture, type Ticker } from 'pixi.js';
import type { OwnedPack, PackOffer } from '@game/progression';
import { stageScale } from '../../stage';
import { detachPixiDomEvents } from '../../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from '../../pixiAppSafety';
import { PIXI_ANTIALIAS } from '../../phoneArt';
import { phonePixiOptions, pixiAllowed } from '../../phoneDiag';
import { followStage } from '../../pixiStageFollow';
import { getDragFeel } from '../../dragFeel';
import { AURA_COLORS } from '../packOpening/packAura';
import { AetherStream, type AetherProgress } from '../packOpening/packAether';
import { makeStage, type StageFx } from '../packOpening/packFx';
import { sealedPackCentre, sealedPackHeight } from '../packOpening/packScene';
import { packGlowRarity } from '../packOpening/packGlow';
import { PACK_GEOM, paintGlossBand } from '../packOpening/packTextures';
import { aimInto, newTilt, stepTilt, tiltEaseK, type TiltState } from '../packOpening/packTilt';
import { LIFT_GROW, ShelfPack, liftPoseInto } from './shelfPack';
import { LOOK_EASE, ShopBackdrop } from './shopBackdrop';
import {
  Placard, loadTexture, paintTray, placardBadge, placardCount,
} from './shopDressing';
import { AETHER_ICON_SRC } from '../AetherIcon';
import { arrived, buySettled, cancelHeld, moveHeld, newDrag, pickUp, release, zoneAt, type ShopDrag } from './shopDrag';
import { HAND_FAN_MAX, clampScroll, handPoseInto, shelfPoseInto, shopLayout, type PackPose, type ShopLayout } from './shopLayout';
import {
  SETTLE_DEPTH, SETTLE_FRAMES, arrivingPlaceHidden, bindFan, handFanInto, hiddenAsleep, inRotatedRect, newPointerVel,
  newShake, newSwing, parksOnArrival, pointerVelDecay, resetPointerVel, resetShake, rubberY, samplePointerVel, settleDip,
  softDead, staggerArrivals, stepShake, stepSwing, type HandFan,
} from './shopMotion';
import { startIndex } from './shopModel';
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
  /** A shelf pack the wallet does not cover (or sold out) was let go below the counter line: it goes back (`onDrop`). */
  onShort(offerId: string): void;
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
  /**
   * Aether streams from the wallet gem (`from`, screen px) into the pack `toId` (the one being bought, held at the hand,
   * or on the shelf / in the hand). `progress` hears the fraction landed and `done` exactly once; at once (1, true) with
   * no WebGL, no scene or an unknown pack.
   */
  payAether(from: ScreenRect, toId: string, progress: AetherProgress): void;
  /**
   * Aether comes IN to the wallet (a refund from the duplicates of a pack just opened): it streams up from the middle of
   * the stage, where the opening's Aether tally stood, into the wallet gem at `to` (SCREEN px). With no stream to draw,
   * `progress(1, true)` at once.
   */
  gainAether(to: ScreenRect, progress: AetherProgress): void;
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

/** A travelling pack's ease toward its target, per 60 Hz frame, and how close (canvas px) counts as arrived. */
const TRAVEL_EASE = 0.2;
const ARRIVE_PX = 0.75;
/** A held pack's size ease toward its carried size (the drag dive's `scale`), per 60 Hz frame. */
const HELD_SIZE_EASE = 0.3;
/** How far past the counter line (in the held pack's heights) an unaffordable pack can be pulled. */
const RUBBER_REACH = 0.22;
/** The buying shimmer: the gloss sweeps back and forth across the waiting pack (radians per frame), and how far up it hangs. */
const SHIMMER_RATE = 0.11;
const BUY_HANG = 0.18;
/** A hovered hand pack rises this share of its height; its neighbours make this much room (pack widths), at full lift. */
const HAND_RISE = 0.35;
const HAND_ROOM = 0.2;
/** A hovered shelf pack's two neighbours lean away (radians) and step aside (pack widths), at full lift. */
const LEAN_ROT = 0.012;
const LEAN_PUSH = 0.03;
/** A shelf place emptied by a pick-up fills back in at this ease (a restock), per 60 Hz frame. */
const RESTOCK_EASE = 0.12;
/** A taken pack's ghost on its place (alpha), and how far a restocked pack swells as it fills back in (its height). */
const GHOST = 0.2;
const RESTOCK_POP = 0.07;
/** The entrance: its ease per 60 Hz frame, how far the shelf drops in and the hand rises (canvas heights). */
const ENTER_EASE = 0.11;
const ENTER_DROP = 0.05;
const ENTER_RISE = 0.14;
/**
 * THE SHELF'S IDLE LIFE: one slow wave of light travels along the shelf (each pack turns a hair toward it, so its gloss
 * drifts). It replaced a per-pack scale "breath" with random phases, which read as jitter (owner 2026-11-25).
 */
const IDLE_AIM = 0.07;
const IDLE_RATE = 0.011;
const IDLE_PHASE = 0.7;
/**
 * The carried pack's dive: the aim is low-passed (per 60 Hz frame) and the first `DIVE_DEAD` canvas px / frame of speed
 * are taken off (a soft dead zone: a crawl never dives, and there is no step where a crawl becomes a move).
 */
const DIVE_EASE = 0.18;
const DIVE_DEAD = 0.6;
/**
 * The carried pack glides from where it was grabbed onto the pointer at this ease (per 60 Hz frame) at most: a pack is
 * far bigger than a card, so the in-game recentre (`dragFeel.recenter`) would throw it a pack's height in three frames.
 */
const PACK_RECENTER = 0.22;
/**
 * The counter line's pull on an unaffordable pack eases in and out (per 60 Hz frame), so it never jumps when the pack's
 * affordability changes under it.
 */
const RUBBER_EASE = 0.45;
/** The hanging price tag fades in at a pick-up and out at a drop, and a taken pack fades to its ghost (per 60 Hz frame). */
const TAG_FADE = 0.25;
/** A sold box sinks into the hand and fades (per 60 Hz frame) while its packs rise into the fan. */
const BOX_FADE = 0.16;
/** An acceleration below this (pack heights per frame^2) is noise: the tag is left to settle. */
const SWING_NOISE = 2e-4;
/**
 * THE HAND RE-FANS: each hand pack glides to its new place at this ease (per 60 Hz frame) when the hand changes, and
 * snaps once within `HAND_GLIDE_SETTLE` canvas px. A pack new to the fan rises in from this far below its place (its
 * own heights).
 */
const HAND_GLIDE = 0.16;
const HAND_GLIDE_SETTLE = 0.2;
const HAND_RISE_FROM = 1.3;
/** A box's packs arrive one after another, this far apart (60 Hz frames: about 70 ms), the first after a beat. */
const BOX_STAGGER = 70 / FRAME_MS;
const BOX_FIRST = 4;
/** The counter line: resting, while a pack is carried, and its ease; the lit glow eases at the same rate. */
const LINE_REST = 0.14;
const LINE_HELD = 0.4;
const LINE_EASE = 0.2;
const LINE_COLOR = 0xffd27a;

/** The shelf fades out while a played pack goes to the pedestal, per 60 Hz frame. */
const RACK_FADE_EASE = 0.15;
/** The price tag's text and the pile's count, as shares of a shelf / hand pack's height. */
const TAG_FONT = 0.075;
/**
 * THE PRICE TAGS: where the twine is tied (a share of the pack's height in from its top-left corner), how far the tag
 * hangs out to the left at rest (radians, clockwise), and the knot acceleration under which it does not stir.
 */
const TAG_INSET = 0.035;
const TAG_REST = 0.3;
const TAG_ACC_DEAD = 0.00002;
const PILE_FONT = 0.16;
const FONT = 'Outfit, sans-serif';
const ZERO_RECT: ScreenRect = { left: 0, top: 0, width: 0, height: 0 };

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
/** `k` per 60 Hz frame as a step over `dt` frames (frame-rate independent). */
const easeK = (k: number, dt: number): number => (k >= 1 ? 1 : 1 - Math.pow(1 - k, dt));

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
  private hand: readonly OwnedPack[] = [];
  private affordable: ReadonlySet<string> = new Set();
  private inputOn = true;

  // the scene
  private L: ShopLayout = shopLayout(1, 1);
  /** Where the opener draws its sealed pack on this canvas (a played pack ends there, so the handoff has no jump). */
  private sealed = { x: 0, y: 0, h: 0 };
  private stage: StageFx | null = null;
  private bandTex: Texture | null = null;
  private rack: Container | null = null;
  // the dressing (shopDressing.ts): the hand's light and a price tag (`Placard`) hanging off each shelf slot's pack
  private tray: Sprite | null = null;
  /** The room in layers (shopBackdrop.ts): the wall and the counter under the packs, the foreground over them. */
  private backdrop: ShopBackdrop | null = null;
  private readonly placards: Placard[] = [];
  private readonly dressTex: Texture[] = [];
  /** The shelf's price tags (in front of the packs): they ride the entrance and fade with the rack. */
  private placardLayer: Container | null = null;
  /** The offer each slot's placard was last written for (offers are immutable quotes): rewritten only on a change. */
  private readonly placardOf: (PackOffer | null)[] = new Array<PackOffer | null>(POOL).fill(null);
  /** Per pool slot: when its returned pack began to sit down (scene frames; -1: not settling). */
  private readonly slotSettle = new Float64Array(POOL).fill(-1);
  /** THE ENTRANCE (0..1): the shelf drops into place and the hand rises, at first show and on every return. */
  private enter = 0;
  /** The price tags' scale for this canvas (`layout`). */
  private placardK = 1;
  /** Per pool slot: its tag's swing, and its knot's last x and speed (the rack moving under it sets it swinging). */
  private readonly tagSwing = Array.from({ length: POOL }, () => newSwing());
  private readonly tagX = new Float64Array(POOL).fill(NaN);
  private readonly tagV = new Float64Array(POOL);
  /** The carried pack's own tag, and the offer it was last written for. */
  private heldTag: Placard | null = null;
  private heldTagOf: PackOffer | null = null;
  private readonly packs: ShelfPack[] = [];
  /** Per pool slot: the offer index and id it shows (-1 / null: none), its eased aim and its lift. */
  private readonly slotIdx = new Int32Array(POOL).fill(-1);
  private readonly slotId: (string | null)[] = new Array<string | null>(POOL).fill(null);
  private readonly slotTilt: TiltState[] = Array.from({ length: POOL }, newTilt);
  private readonly slotLift = new Float64Array(POOL);
  /** Per pool slot: its eased lean away from a hovered neighbour (-1..1) and its restock fade (0..1). */
  private readonly slotLean = new Float64Array(POOL);
  private readonly slotShow = new Float64Array(POOL).fill(1);
  private time = 0;

  // the hand: a pool of HAND_FAN_MAX views, each bound to ONE PACK (`bindFan`) and shown at that pack's fan place (place
  // j shows hand pack j; the last is the pile's top), so a pack keeps its own motion when its place changes
  private handLayer: Container | null = null;
  private readonly handPacks: ShelfPack[] = [];
  /** Per view: the pack it shows (null: free), its hover lift, its eased place (x, y, rotation), aim and settle start. */
  private readonly handViewId: (string | null)[] = new Array<string | null>(HAND_FAN_MAX).fill(null);
  private readonly handLift = new Float64Array(HAND_FAN_MAX);
  private readonly hx = new Float64Array(HAND_FAN_MAX);
  private readonly hy = new Float64Array(HAND_FAN_MAX);
  private readonly hr = new Float64Array(HAND_FAN_MAX);
  private readonly hAimX = new Float64Array(HAND_FAN_MAX);
  private readonly hAimY = new Float64Array(HAND_FAN_MAX);
  private readonly hSettle = new Float64Array(HAND_FAN_MAX).fill(-1);
  /** Fan place -> view (-1: none), and the views bound fresh by the last `bindFan`. */
  private readonly placeView = new Int32Array(HAND_FAN_MAX).fill(-1);
  private readonly viewFresh = new Uint8Array(HAND_FAN_MAX);
  /** False when the hand or its fan changed: the views are rebound on the next frame. */
  private handBound = false;
  /** Whether a hand has been shown yet (the first one stands in place: the entrance raises it). */
  private handShown = false;
  /** Packs waiting their turn to arrive (a box's packs come in one by one): pack id -> scene time (frames). */
  private readonly arrivals = new Map<string, number>();
  /** The pile's count as last written. */
  private pileN = -1;
  /** The place under the pointer (-1: none). */
  private handHover = -1;
  private pileText: Text | null = null;
  private readonly fan: HandFan = { places: 0, shown: 0, piled: 0 };
  /** The (hand size, reserve) the fan was last computed for; -1 forces a recompute. */
  private fanKey = -1;

  // the carry
  private readonly drag: ShopDrag = newDrag();
  private heldPack: ShelfPack | null = null;
  /** The Aether stream out of the wallet: above the packs, stepped in the one ticker. Null without WebGL. */
  private aether: AetherStream | null = null;
  private readonly held = {
    pointerId: -1, touch: false, from: 'shelf' as 'shelf' | 'hand',
    /** The dive's aim, low-passed. */
    aimX: 0, aimY: 0,
    /** Where it is drawn (canvas px) and its height and rotation. */
    x: 0, y: 0, h: 0, rot: 0,
    /** Its height when picked up (it is carried at the drag dive's `scale` of this). */
    srcH: 0,
    /** The offset from the pointer to the pack's centre, easing to 0 (the recentre). */
    ax: 0, ay: 0,
    /** The smoothed travel per frame (the dive) and last frame's (the tag's push). */
    vx: 0, vy: 0, pvx: 0,
    /** The hand's size when the purchase was dropped (a place is held at the fan's end until the hand grows). */
    buyN: 0,
    /** The counter line's eased pull (canvas px, added to y), the tag's eased alpha and the pack's own alpha. */
    rub: 0, tagA: 0, alpha: 1,
    /** The purchase is a box (`contains > 1`): its packs rise into the fan one by one, the box itself sinks and fades. */
    box: false,
  };
  /** The pointer's velocity while a pack is held, from its coalesced samples (`shopMotion.ts`). */
  private readonly vel = newPointerVel();
  /** A pointer sample in canvas px (scratch). */
  private readonly sample = { x: 0, y: 0 };
  /** A played pack resting on the pedestal after its travel (the shell hides the scene). */
  private parkedId: string | null = null;
  /** `setVisible(true)` landed while a played pack was still travelling: it must not park when it arrives. */
  private shownAgain = false;
  private rackAlpha = 1;
  private readonly shake = newShake();
  private readonly swing = newSwing();
  private readonly lastMove = { x: 0, y: 0 };
  private tag: Container | null = null;
  private tagPlate: Graphics | null = null;
  private tagText: Text | null = null;
  private lineBase: Graphics | null = null;
  private lineLit: Graphics | null = null;
  private readonly line = { base: LINE_REST, lit: 0 };
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
  /** Where the pack last hit by `packAt` RESTS (no lift, no lean): the stable frame its hover aim is measured in. */
  private readonly rest = { x: 0, y: 0, h: 0 };
  private readonly goal: PackPose = { x: 0, y: 0, h: 0, rot: 0, alpha: 0 };
  private readonly heldPose: PackPose = { x: 0, y: 0, h: 0, rot: 0, alpha: 1 };

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
    // THE DRESSING: the hand's pool of light, and (further down) the price placards
    const tex = (c: HTMLCanvasElement): Texture => { const t = new Texture({ source: new CanvasSource({ resource: c }) }); this.dressTex.push(t); return t; };
    this.backdrop = new ShopBackdrop();
    app.stage.addChild(this.backdrop.back);
    this.tray = new Sprite(tex(paintTray()));
    this.tray.anchor.set(0.5);
    app.stage.addChild(this.tray);
    const rack = new Container();
    for (let s = 0; s < POOL; s++) {
      const p = new ShelfPack(webgl, this.bandTex);
      this.packs.push(p);
      rack.addChild(p.view);
    }
    this.rack = rack;
    app.stage.addChild(rack);
    // every pack's price tag hangs off its top-left corner, in FRONT of the packs
    const cards = new Container();
    for (let s = 0; s < POOL; s++) {
      const pl = new Placard(Texture.EMPTY, FONT);
      this.placards.push(pl);
      cards.addChild(pl.view);
    }
    this.placardLayer = cards;
    app.stage.addChild(cards);
    loadTexture(AETHER_ICON_SRC, () => !this.destroyed, (t) => {
      this.dressTex.push(t);
      for (const pl of this.placards) pl.setGem(t);
      this.heldTag?.setGem(t);
      this.placardOf.fill(null); this.heldTagOf = null;
      this.wake();
    });

    // the counter line: a thin rule (dim at rest, brighter while carrying) and its glow (lit while over the line)
    this.lineBase = new Graphics();
    this.lineLit = new Graphics();
    this.lineLit.alpha = 0;
    app.stage.addChild(this.lineBase, this.lineLit);

    const hand = new Container();
    for (let j = 0; j < HAND_FAN_MAX; j++) {
      const p = new ShelfPack(webgl, this.bandTex);
      this.handPacks.push(p);
      hand.addChild(p.view);
    }
    this.pileText = new Text({ text: '', style: { fontFamily: FONT, fontSize: 24, fontWeight: '700', fill: 0xffffff } });
    this.pileText.anchor.set(0.5, 1);
    this.pileText.visible = false;
    hand.addChild(this.pileText);
    this.handLayer = hand;
    app.stage.addChild(hand);

    // the held pack, its price tag tied to its top-left corner (drawn over it)
    this.heldPack = new ShelfPack(webgl, this.bandTex);
    app.stage.addChild(this.heldPack.view);
    this.heldTag = new Placard(Texture.EMPTY, FONT);
    app.stage.addChild(this.heldTag.view);
    app.stage.addChild(this.backdrop.front); // the foreground: nearer than anything on the counter

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
    this.aether = new AetherStream(webgl, app.renderer.resolution);
    app.stage.addChild(this.aether.root);
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
    for (const p of this.handPacks) p.destroy();
    this.handPacks.length = 0;
    this.heldPack?.destroy();
    this.heldPack = null;
    this.aether?.clear();
    this.aether = null;
    for (const pl of this.placards) pl.destroy();
    this.placards.length = 0;
    this.tray = null; this.placardLayer = null;
    this.backdrop?.destroy(); this.backdrop = null;
    for (const t of this.dressTex) t.destroy(true);
    this.dressTex.length = 0;
    this.rack = null;
    this.handLayer = null;
    this.pileText = null;
    this.heldTag?.destroy(); this.heldTag = null; this.heldTagOf = null;
    this.lineBase = null; this.lineLit = null;
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
    const resized = w !== this.L.w || h !== this.L.h;
    this.L = shopLayout(w, h);
    const sc = sealedPackCentre(w, h);
    this.sealed.x = sc.x; this.sealed.y = sc.y; this.sealed.h = sealedPackHeight(w, h);
    if (this.stage) {
      this.stage.mesh.position.set(w / 2, h / 2); this.stage.mesh.scale.set(w / 2, h / 2);
      const u = this.stage.u;
      u.uAspect = w / Math.max(1, h);
      u.uFocus[0] = 0; u.uFocus[1] = (this.L.shelfY / Math.max(1, h)) * 2 - 1; // the spotlight falls on the pedestal
    }
    this.dress();
    this.drawLine();
    if (this.pileText) this.pileText.style.fontSize = Math.max(10, PILE_FONT * this.L.handPackH);
    this.cacheRect();
    if (resized) this.cancelHold(); // a resize while holding: the pack returns to where it came from
    this.wake();
  };

  /** Place the dressing for this canvas (on a resize only). */
  private dress(): void {
    const L = this.L, w = L.w;
    this.backdrop?.layout(L);
    if (this.tray) {
      this.tray.position.set(w / 2, L.handY);
      this.tray.width = Math.min(w, L.handPackH * ASPECT * 9); this.tray.height = L.handPackH * 1.7;
    }
    // a tag's size: its price is this share of a shelf pack's height
    this.placardK = (TAG_FONT * L.packH) / 34;
  }

  /** The counter line across the canvas at `lineY` (redrawn only on a resize). */
  private drawLine(): void {
    const base = this.lineBase, lit = this.lineLit, L = this.L;
    if (!base || !lit) return;
    base.clear().rect(0, L.lineY - 1, L.w, 2).fill({ color: LINE_COLOR, alpha: 1 });
    lit.clear()
      .rect(0, L.lineY - 12, L.w, 24).fill({ color: LINE_COLOR, alpha: 0.06 })
      .rect(0, L.lineY - 6, L.w, 12).fill({ color: LINE_COLOR, alpha: 0.12 })
      .rect(0, L.lineY - 2, L.w, 4).fill({ color: LINE_COLOR, alpha: 0.55 })
      .rect(0, L.lineY - 1, L.w, 2).fill({ color: 0xffffff, alpha: 0.9 });
  }

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
    const prev = this.hand;
    this.hand = packs.slice();
    // a hand that grew by more than one pack (a box): the new packs arrive one after another, each rising into its place
    if (this.app && this.handShown && this.enter >= 1) {
      const had = new Set(prev.map((p) => p.packId));
      staggerArrivals(had, this.hand, this.time + BOX_FIRST, BOX_STAGGER, this.arrivals);
    }
    if (this.arrivals.size > 0) {
      const has = new Set(this.hand.map((p) => p.packId));
      for (const id of [...this.arrivals.keys()]) if (!has.has(id)) this.arrivals.delete(id);
    }
    this.fanKey = -1;
    this.handBound = false;
    this.wake();
  }

  setAffordable(ids: ReadonlySet<string>): void {
    if (this.destroyed) return;
    this.affordable = new Set(ids);
    if (this.isHeld()) this.overLineFrom(this.pointer.x, this.pointer.y); // the line may light (or go dark) under the held pack
  }

  buySettled(ok: boolean): void {
    if (this.destroyed) return;
    const was = this.drag.phase;
    buySettled(this.drag, ok);
    if (was !== 'buying') return;
    if (ok) this.sounds.till(); else this.sounds.refuse();
    this.wake();
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
    // the held, travelling or parked pack: where it is drawn
    if ((this.drag.phase !== 'idle' && this.drag.id === id) || this.parkedId === id) return this.screenRect(this.heldPose);
    const i = this.offerIndexOf(id);
    if (i >= 0) {
      const p = shelfPoseInto(this.pose, this.L, i, this.scroll);
      if (p.alpha <= 0) return null;
      p.x += this.rackX;
      const s = this.slotId.indexOf(id);
      return this.screenRect(liftPoseInto(this.lifted, p, s >= 0 ? this.slotLift[s]! : 0));
    }
    const j = this.handIndexOf(id);
    if (j < 0) return null;
    this.syncFan();
    const place = Math.min(j, this.fan.shown);
    if (place >= this.fan.places) return null;
    return this.screenRect(this.handPlacePose(place));
  }

  gainAether(to: ScreenRect, progress: AetherProgress): void {
    const app = this.app, ae = this.aether;
    if (!app || !ae || this.destroyed) { progress(1, true); return; }
    if (!this.rect.valid) this.cacheRect();
    if (!this.rect.valid) { progress(1, true); return; }
    const sx = app.screen.width / this.rect.w, sy = app.screen.height / this.rect.h;
    const unit = Math.max(0.2, stageScale() * sx);
    const L = this.L, src = L.handPackH * 0.5;
    // from where the opener's tally stood (lower middle of the stage)
    ae.emit(L.w / 2, L.h * 0.8, src, src, (to.left + to.width / 2 - this.rect.l) * sx, (to.top + to.height / 2 - this.rect.t) * sy, unit, progress, 'point');
    this.wake();
  }

  payAether(from: ScreenRect, toId: string, progress: AetherProgress): void {
    const app = this.app, ae = this.aether;
    if (!app || !ae || this.destroyed) { progress(1, true); return; }
    const to = this.rectOf(toId);
    if (!to) { progress(1, true); return; }
    if (!this.rect.valid) this.cacheRect();
    if (!this.rect.valid) { progress(1, true); return; }
    // screen px to canvas px (the stream draws in the canvas's own px)
    const sx = app.screen.width / this.rect.w, sy = app.screen.height / this.rect.h;
    const unit = Math.max(0.2, stageScale() * sx);
    ae.emit((from.left + from.width / 2 - this.rect.l) * sx, (from.top + from.height / 2 - this.rect.t) * sy, from.width * sx, from.height * sy,
      (to.left + to.width / 2 - this.rect.l) * sx, (to.top + to.height / 2 - this.rect.t) * sy, unit, progress, 'point');
    this.wake();
  }

  setInputEnabled(on: boolean): void {
    if (this.destroyed) return;
    this.inputOn = on;
    if (!on) { this.endScrollDrag(); this.cancelHold(); }
    this.wake(); // the hover drops (or comes back) on the next frame
  }

  setVisible(on: boolean, fadeMs: number): void {
    if (this.destroyed) return;
    const f = this.fade;
    f.to = on ? 1 : 0;
    f.rate = fadeMs > 0 ? FRAME_MS / fadeMs : 1;
    const app = this.app;
    if (on) {
      this.parkedId = null; // back from the opener: the played pack leaves the pedestal, the shelf returns
      if (f.alpha < 1) this.enter = 0; // and the shop sets itself up again: the shelf settles, the hand rises
      if (this.drag.phase === 'toPedestal') this.shownAgain = true; // (still on its way: it must not park on arrival)
    }
    if (!app) { f.alpha = f.to; return; }
    app.canvas.style.pointerEvents = on ? 'auto' : 'none';
    if (!on) { this.pointerOn = false; this.endScrollDrag(); this.cancelHold(); }
    this.wake();
  }

  /** Swap the rack's offers in place. `keepCentre`: the same shelf updated, so the pedestal keeps its offer. */
  private replaceRack(next: readonly PackOffer[], keepCentre: boolean): void {
    const centre = keepCentre ? this.offers[Math.round(this.target)]?.offerId : undefined;
    this.offers = next;
    const kept = centre === undefined ? -1 : next.findIndex((o) => o.offerId === centre);
    this.target = kept >= 0 ? kept : keepCentre ? clampScroll(this.target, next.length) : startIndex(next);
    if (!keepCentre || !this.app) this.scroll = this.target;
    this.slotId.fill(null); // rebind every slot (a look may have changed under the same id)
    this.wake();
  }

  // ---------------------------------------------------------------- the frame

  private readonly tick = (tk: Ticker): void => {
    const app = this.app;
    if (!app) return;
    // hidden under the opener: nothing here can be seen, so nothing is stepped or drawn until something wakes it
    if (hiddenAsleep(this.fade.alpha, this.fade.to, this.aether?.count ?? 0)) { app.ticker.stop(); return; }
    const dt = Math.min(MAX_DT, tk.deltaTime);
    this.time += dt;
    let moving = this.slideStep(dt);
    if (this.scrollStep(dt)) moving = true;
    this.hoverStep();
    this.handHoverStep();
    if (this.rackStep(dt)) moving = true;
    if (this.handStep(dt)) moving = true;
    if (this.heldStep(dt)) moving = true;
    if (this.lineStep(dt)) moving = true;
    if (this.fadeStep(dt)) moving = true;
    if (this.enterStep(dt)) moving = true;
    this.stageStep(dt);
    if (this.backdrop?.step(easeK(LOOK_EASE, dt))) moving = true;
    if (this.aether?.count) { this.aether.step(dt); moving = true; }
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
    // (and none while a pack is held or travelling: its neighbours would light up under it)
    if (this.drag.phase === 'idle' && this.parkedId === null && hoverAllowed(this.pointerOn, this.inputOn, this.fade.to > 0,
      this.slide.phase !== SLIDE_NONE, this.scrollDrag.active, this.scroll !== this.target)) {
      slot = this.packAt(this.pointer.x, this.pointer.y);
      if (slot >= 0) {
        const q = this.rest; // where the pack rests (packAt): a stable frame for the aim
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
    if (this.rackAlpha < 1) return -1; // the shelf is fading for (or back from) a played pack: nothing on it can be taken
    // STICKY: the hovered pack keeps the pointer while it is over where the pack rests OR where it is drawn lifted
    const hs = this.hoverSlot;
    if (hs >= 0 && this.slotHit(hs, x, y, true)) return hs;
    for (let s = 0; s < POOL; s++) if (s !== hs && this.slotHit(s, x, y, false)) return s;
    return -1;
  }

  /**
   * Whether pool slot `s`'s pack holds (x, y): tested at its RESTING place (no lift, no lean), and for the hovered pack
   * (`sticky`) at its lifted place too. On a hit, leaves the resting pose in `rest` and the drawn pose in `lifted`.
   */
  private slotHit(s: number, x: number, y: number, sticky: boolean): boolean {
    const i = this.slotIdx[s]!;
    if (i < 0 || this.slotId[s] === null) return false;
    const p = shelfPoseInto(this.pose, this.L, i, this.scroll);
    if (p.alpha <= 0) return false;
    p.x += this.rackX;
    const r = this.rest;
    r.x = p.x; r.y = p.y; r.h = p.h;
    let hit = Math.abs(x - p.x) <= (p.h * ASPECT) / 2 && Math.abs(y - p.y) <= p.h / 2;
    // as drawn (rackStep): leaning away from a hovered neighbour, lifted
    const lean = this.slotLean[s]!;
    p.rot += lean * LEAN_ROT;
    p.x += lean * LEAN_PUSH * p.h * ASPECT;
    const q = liftPoseInto(this.lifted, p, this.slotLift[s]!);
    if (!hit && sticky) hit = inRotatedRect(x, y, q.x, q.y, q.h * ASPECT, q.h, q.rot);
    return hit;
  }

  /** Bind each pool slot to its offer, ease its lift and tilt, and pose it. True while anything moves. */
  private rackStep(dt: number): boolean {
    const offers = this.offers, count = offers.length, L = this.L;
    const base = Math.floor(this.scroll) - (POOL >> 1);
    const k = tiltEaseK(getDragFeel().tiltEase, dt * FRAME_MS);
    const kl = easeK(LIFT_EASE, dt), kr = easeK(RESTOCK_EASE, dt), ks = easeK(TAG_FADE, dt);
    // the hovered pack's offer index (its neighbours lean away from it)
    const hi = this.hoverSlot >= 0 ? this.slotIdx[this.hoverSlot]! : -1;
    // the pack taken off the shelf leaves its place empty until it is back (or bought: then a fresh one restocks it)
    const ph = this.drag.phase;
    const takenId = ph === 'heldShelf' || ph === 'buying' || ph === 'toShelf' || ph === 'toHand' ? this.drag.id : null;
    let moving = count > 0; // the shelf's idle wave of light never rests
    for (let s = 0; s < POOL; s++) {
      const pack = this.packs[s]!;
      const i = base + ((((s - base) % POOL) + POOL) % POOL); // the index this slot shows: i = s (mod POOL)
      const tilt = this.slotTilt[s]!;
      if (i < 0 || i >= count) {
        if (this.slotIdx[s] !== -1 || this.slotId[s] !== null) { this.slotIdx[s] = -1; this.slotId[s] = null; }
        tilt.ax = 0; tilt.ay = 0; this.slotLift[s] = 0; this.slotLean[s] = 0;
        pack.view.visible = false;
        this.placards[s]!.view.visible = false; this.tagX[s] = NaN;
        continue;
      }
      const offer = offers[i]!;
      if (this.slotId[s] !== offer.offerId) {
        pack.setLook(offer.look);
        this.slotId[s] = offer.offerId;
        tilt.ax = 0; tilt.ay = 0; this.slotLift[s] = 0; this.slotLean[s] = 0; this.slotSettle[s] = -1;
      }
      this.slotIdx[s] = i;
      const taken = offer.offerId === takenId;
      // A TAKEN PACK LEAVES ITS GHOST (owner 2026-11-25: "instead of a grey box, lets just have a faded ghost of the card pack
      // in that spot"): the place keeps a faint copy of the pack while it is carried or bought. When it is restocked the
      // ghost fills back in with a small pop, then sits down.
      let show = this.slotShow[s]!;
      if (taken) {
        if (show !== GHOST) { show += (GHOST - show) * ks; if (Math.abs(GHOST - show) < LIFT_SETTLE) show = GHOST; this.slotShow[s] = show; moving = true; }
      } else if (show < 1) {
        show += (1 - show) * kr;
        if (show > 0.995) { show = 1; this.slotSettle[s] = this.time; }
        this.slotShow[s] = show;
        moving = true;
      }
      const p = shelfPoseInto(this.pose, L, i, this.scroll);
      p.x += this.rackX;
      const shelfAlpha = p.alpha;
      p.alpha *= show;
      if (!taken && show < 1) {
        // the restock's pop: it swells past its size as it fills in, feet on the same line
        const grow = RESTOCK_POP * Math.sin(Math.PI * Math.max(0, (show - GHOST) / (1 - GHOST))) * p.h;
        p.h += grow; p.y -= grow / 2;
      }
      // lean away from a hovered neighbour, eased
      const leanTo = hi >= 0 && (i === hi - 1 || i === hi + 1) ? Math.sign(i - hi) : 0;
      let lean = this.slotLean[s]!;
      if (lean !== leanTo) {
        lean += (leanTo - lean) * kl;
        if (Math.abs(leanTo - lean) < LIFT_SETTLE) lean = leanTo;
        this.slotLean[s] = lean;
      }
      p.rot += lean * LEAN_ROT;
      p.x += lean * LEAN_PUSH * p.h * ASPECT;
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
      // its price tag (rewritten only when the offer changed)
      const pl = this.placards[s]!;
      if (this.placardOf[s] !== offer) {
        this.placardOf[s] = offer;
        const count = placardCount(offer.contains), badge = placardBadge(offer.badge);
        if (offer.soldOut) pl.set('Sold out', 'sold', count, badge);
        else if (offer.price <= 0) pl.set('Free', 'free', count, badge);
        else pl.set(String(offer.price), 'price', count, badge);
      }
      // the tag hangs off the pack's top-left corner (as drawn: lifted), askew, and swings as the rack moves under it.
      // A taken pack's ghost wears none: the carried pack has its own.
      const tagA = shelfAlpha * Math.max(0, (show - GHOST) / (1 - GHOST));
      pl.view.visible = tagA > 0.01;
      if (pl.view.visible) {
        const q = liftPoseInto(this.lifted, p, lift);
        const kx = q.x - (q.h * ASPECT) / 2 + q.h * TAG_INSET, ky = q.y - q.h / 2 + q.h * TAG_INSET;
        const sw = this.tagSwing[s]!;
        const v = Number.isNaN(this.tagX[s]!) ? 0 : (kx - this.tagX[s]!) / Math.max(dt, 1e-3);
        const acc = (v - this.tagV[s]!) / Math.max(dt, 1e-3) / Math.max(1, q.h);
        this.tagX[s] = kx; this.tagV[s] = v;
        if (stepSwing(sw, Math.abs(acc) < TAG_ACC_DEAD ? 0 : acc, dt)) moving = true;
        pl.view.alpha = tagA;
        pl.view.position.set(kx, ky);
        pl.view.rotation = TAG_REST + sw.a;
        pl.view.scale.set(this.placardK * Math.sqrt(q.h / Math.max(1, L.packH)));
      } else this.tagX[s] = NaN;
      // a pack just put back sits down: a small bob into its place
      const st = this.slotSettle[s]!;
      if (st >= 0) {
        const u = (this.time - st) / SETTLE_FRAMES;
        if (u >= 1) this.slotSettle[s] = -1; else p.y += SETTLE_DEPTH * p.h * settleDip(u);
        moving = true;
      }
      // the shelf's idle wave of light, gone as the pack lifts
      pack.pose(p, tilt.ax + this.idleAim(i, lift), tilt.ay, lift);
    }
    // the shelf fades while a played pack goes to the pedestal, and comes back with the scene
    const rackTo = ph === 'toPedestal' || this.parkedId !== null ? 0 : 1;
    if (this.rackAlpha !== rackTo) {
      this.rackAlpha += (rackTo - this.rackAlpha) * easeK(RACK_FADE_EASE, dt);
      if (Math.abs(rackTo - this.rackAlpha) < LIFT_SETTLE) this.rackAlpha = rackTo;
      if (this.rack) { this.rack.alpha = this.rackAlpha; this.rack.visible = this.rackAlpha > 0; }
      // the dressing leaves with the shelf: only the played pack stays, on its way to the opener
      const ra = this.rackAlpha;
      if (this.tray) this.tray.alpha = ra;
      this.backdrop?.setAlpha(ra);
      if (this.placardLayer) this.placardLayer.alpha = ra;
      if (this.handLayer) this.handLayer.alpha = ra;
      if (this.lineBase) this.lineBase.visible = ra > 0.02;
      moving = true;
    }
    return moving;
  }

  /** The shelf's idle wave of light on offer `i`'s pack (an aim added to its tilt), gone as the pack lifts. */
  private idleAim(i: number, lift: number): number {
    return IDLE_AIM * Math.sin(this.time * IDLE_RATE - i * IDLE_PHASE) * (1 - lift);
  }

  // ---------------------------------------------------------------- the hand

  /** Recompute the fan when the hand's size or the purchase's reserved place changed (allocates; not per frame). */
  private syncFan(): void {
    const n = this.hand.length, ph = this.drag.phase;
    const reserve = (ph === 'buying' || ph === 'toHand') && n <= this.held.buyN && !this.held.box ? 1 : 0;
    const key = n * 2 + reserve;
    if (key === this.fanKey) return;
    this.fanKey = key;
    handFanInto(this.fan, n, reserve);
    this.handBound = false; // the places moved: rebind (each pack keeps its view and glides to its new place)
  }

  /**
   * Bind the fan's places to the pool of views BY PACK (`bindFan`): a pack keeps its view, so when the hand changes it
   * glides from where it is to its new place. A pack new to the fan rises in from below (or, during the entrance and at
   * the first hand, simply stands at its place: the hand layer itself is rising). Then the views are put in place order.
   */
  private bindHandViews(): void {
    this.handBound = true;
    const f = this.fan, count = Math.min(f.places, this.hand.length), L = this.L;
    bindFan(this.handViewId, this.placeView, this.viewFresh, this.hand, count);
    const snap = !this.handShown || this.enter < 1;
    for (let j = 0; j < count; j++) {
      const v = this.placeView[j]!;
      if (!this.viewFresh[v]) continue;
      this.viewFresh[v] = 0;
      this.handPacks[v]!.setLook(this.hand[j]!.look);
      this.handLift[v] = 0; this.hAimX[v] = 0; this.hAimY[v] = 0; this.hSettle[v] = -1;
      const p = handPoseInto(this.pose, L, j, f.places);
      this.hx[v] = p.x; this.hr[v] = snap ? p.rot : 0;
      this.hy[v] = snap ? p.y : p.y + HAND_RISE_FROM * p.h;
    }
    if (count > 0) this.handShown = true;
    const layer = this.handLayer;
    if (layer) {
      for (let j = 0; j < count; j++) layer.setChildIndex(this.handPacks[this.placeView[j]!]!.view, j);
      const hv = this.handHover;
      if (hv >= 0 && hv < count) layer.setChildIndex(this.handPacks[this.placeView[hv]!]!.view, HAND_FAN_MAX - 1);
    }
  }

  /** The hover lift of the pack at hand place `j` (0 with no pack there). */
  private liftAt(j: number): number {
    const v = j >= 0 && j < HAND_FAN_MAX ? this.placeView[j]! : -1;
    return v >= 0 ? this.handLift[v]! : 0;
  }

  /**
   * Hand place `j` as drawn now: where its pack has glided to (its view's eased pose; the resting place with no view),
   * the room made around a hovered pack, its own hover lift and any settle.
   */
  private handPlacePose(j: number): PackPose {
    const p = handPoseInto(this.pose, this.L, j, this.fan.places);
    const v = j < HAND_FAN_MAX ? this.placeView[j]! : -1;
    if (v >= 0) {
      p.x = this.hx[v]!; p.y = this.hy[v]!; p.rot = this.hr[v]!;
      const st = this.hSettle[v]!;
      if (st >= 0) p.y += SETTLE_DEPTH * p.h * settleDip((this.time - st) / SETTLE_FRAMES);
    }
    const hv = this.handHover;
    if (hv >= 0 && j !== hv) p.x += Math.sign(j - hv) * HAND_ROOM * p.h * ASPECT * this.liftAt(hv);
    const lift = this.liftAt(j);
    p.y -= HAND_RISE * p.h * lift;
    p.rot *= 1 - lift;
    return liftPoseInto(this.lifted, p, lift);
  }

  /** Whether the pack `id` is still waiting its turn to arrive (a box's packs come in one by one). */
  private pendingArrival(id: string): boolean {
    if (this.arrivals.size === 0) return false;
    const t = this.arrivals.get(id);
    return t !== undefined && this.time < t;
  }

  /** Whether hand place `j`'s pack is out of the fan (held, travelling, waiting on the pedestal, or arriving). */
  private handPlaceHidden(j: number): boolean {
    const n = this.hand.length;
    if (j >= n) return true; // a reserved place
    const id = this.hand[j]!.packId, ph = this.drag.phase;
    if (id === this.parkedId || this.pendingArrival(id)) return true;
    if (id === this.drag.id && (ph === 'heldHand' || ph === 'toHandBack' || ph === 'toPedestal')) return true;
    // a purchase waiting or on its way in: the hand already holds it, the held pack is drawn instead
    return !this.held.box && arrivingPlaceHidden(ph, n, this.held.buyN, j, this.fan.places);
  }

  /**
   * The hand place under canvas point (x, y), or -1, in draw order topmost first: the raised (hovered) pack, then the
   * rest from the last place down (the resting fan is drawn in index order, `raiseHand`). Tested as drawn: rotated.
   */
  private handAt(x: number, y: number): number {
    this.syncFan();
    const hv = this.handHover;
    if (hv >= 0 && this.handPlaceHit(hv, x, y, true)) return hv;
    for (let j = this.fan.places - 1; j >= 0; j--) if (j !== hv && this.handPlaceHit(j, x, y, false)) return j;
    return -1;
  }

  /**
   * Tested where the pack RESTS in the fan (never where a hover has pushed it: the neighbours making room slid under
   * the pointer and stole the hover, back and forth). The hovered pack (`sticky`) also holds the pointer over where it
   * is drawn raised, and over the gap its rise leaves under it.
   */
  private handPlaceHit(j: number, x: number, y: number, sticky: boolean): boolean {
    if (j >= this.fan.places || this.handPlaceHidden(j)) return false;
    const p = handPoseInto(this.pose, this.L, j, this.fan.places);
    const w = p.h * ASPECT;
    let hit = inRotatedRect(x, y, p.x, p.y, w, p.h, p.rot);
    if (!hit && sticky) {
      const rise = HAND_RISE * p.h * this.liftAt(j);
      hit = Math.abs(x - p.x) <= (w * (1 + LIFT_GROW)) / 2 && y <= p.y + p.h / 2 && y >= p.y - p.h / 2 - rise - p.h * LIFT_GROW;
    }
    return hit;
  }

  /**
   * Draw hand place `j`'s pack over its neighbours (-1: none), first putting the previously raised one back at its own
   * place's index, so the resting fan is always drawn in place order (the pile's count stays on top of all).
   */
  private raiseHand(prev: number, j: number): void {
    const layer = this.handLayer;
    if (!layer) return;
    const pv = prev >= 0 ? this.placeView[prev]! : -1, jv = j >= 0 ? this.placeView[j]! : -1;
    if (pv >= 0) layer.setChildIndex(this.handPacks[pv]!.view, prev);
    if (jv >= 0) layer.setChildIndex(this.handPacks[jv]!.view, HAND_FAN_MAX - 1);
  }

  private handHoverStep(): void {
    let j = -1;
    if (this.drag.phase === 'idle' && this.parkedId === null && hoverAllowed(this.pointerOn, this.inputOn, this.fade.to > 0,
      this.slide.phase !== SLIDE_NONE, this.scrollDrag.active, false) && this.pointer.y > this.L.lineY) {
      j = this.handAt(this.pointer.x, this.pointer.y);
    }
    if (j === this.handHover) return;
    const prev = this.handHover;
    this.handHover = j;
    this.raiseHand(prev, j);
  }

  /**
   * Ease each fan place's pack (keyed by pack: `bindHandViews`) to its resting place, ease its hover lift, settle and
   * aim, and pose it; place the pile's count. Hit tests never read these eased poses: they use the resting fan.
   */
  private handStep(dt: number): boolean {
    this.syncFan();
    if (!this.handBound) this.bindHandViews();
    const f = this.fan, L = this.L, count = Math.min(f.places, this.hand.length);
    const kl = easeK(LIFT_EASE, dt), kg = easeK(HAND_GLIDE, dt), ka = easeK(TRAVEL_EASE, dt);
    let moving = false;
    for (let v = 0; v < HAND_FAN_MAX; v++) {
      if (this.handViewId[v] !== null) continue;
      this.handPacks[v]!.view.visible = false;
      this.handLift[v] = 0;
    }
    for (let j = 0; j < count; j++) {
      const v = this.placeView[j]!;
      const liftTo = j === this.handHover ? 1 : 0;
      let lift = this.handLift[v]!;
      if (lift !== liftTo) {
        lift += (liftTo - lift) * kl;
        if (Math.abs(liftTo - lift) < LIFT_SETTLE) lift = liftTo;
        this.handLift[v] = lift;
        moving = true;
      }
    }
    let pending = 0;
    for (let j = 0; j < count; j++) {
      const v = this.placeView[j]!, id = this.hand[j]!.packId;
      const rest = handPoseInto(this.pose, L, j, f.places);
      const waiting = this.pendingArrival(id);
      if (!waiting && this.arrivals.size > 0 && this.arrivals.has(id)) this.arrivals.delete(id); // its turn: it rises
      const hidden = waiting || this.handPlaceHidden(j);
      if (waiting) {
        // below its place until its turn comes
        this.hx[v] = rest.x; this.hy[v] = rest.y + HAND_RISE_FROM * rest.h; this.hr[v] = 0;
        moving = true;
      } else if (hidden) {
        // out of the fan (held, travelling, parked): kept at its place, so it is there when it shows again
        this.hx[v] = rest.x; this.hy[v] = rest.y; this.hr[v] = rest.rot;
      } else {
        const dx = rest.x - this.hx[v]!, dy = rest.y - this.hy[v]!, dr = rest.rot - this.hr[v]!;
        if (dx !== 0 || dy !== 0 || dr !== 0) {
          if (Math.abs(dx) < HAND_GLIDE_SETTLE && Math.abs(dy) < HAND_GLIDE_SETTLE && Math.abs(dr) < 1e-4) {
            this.hx[v] = rest.x; this.hy[v] = rest.y; this.hr[v] = rest.rot;
          } else {
            this.hx[v] = this.hx[v]! + dx * kg; this.hy[v] = this.hy[v]! + dy * kg; this.hr[v] = this.hr[v]! + dr * kg;
          }
          moving = true;
        }
      }
      const st = this.hSettle[v]!;
      if (st >= 0) { if (this.time - st >= SETTLE_FRAMES) this.hSettle[v] = -1; moving = true; }
      let ax = this.hAimX[v]!, ay = this.hAimY[v]!;
      if (ax !== 0 || ay !== 0) {
        ax -= ax * ka; ay -= ay * ka;
        if (Math.abs(ax) < 0.002) ax = 0;
        if (Math.abs(ay) < 0.002) ay = 0;
        this.hAimX[v] = ax; this.hAimY[v] = ay;
        moving = true;
      }
      const q = this.handPlacePose(j);
      if (hidden) q.alpha = 0;
      // (the lift is already in q: pose it unlifted)
      this.handPacks[v]!.pose(q, ax, ay, 0);
    }
    // the piled packs still waiting their turn (their arrivals are dropped once due: the pile draws only its top)
    if (this.arrivals.size > 0 && f.piled > 0) {
      for (let i = f.shown; i < this.hand.length; i++) {
        const id = this.hand[i]!.packId;
        if (this.pendingArrival(id)) pending++;
        else if (i > f.shown && this.arrivals.has(id)) this.arrivals.delete(id);
      }
    }
    // the pile's count: the piled packs that have arrived (rewritten only when it changes)
    const t = this.pileText;
    if (t) {
      let shown = f.piled - pending;
      if (shown < 0) shown = 0;
      if (shown !== this.pileN) {
        this.pileN = shown;
        t.visible = shown > 0;
        if (shown > 0) t.text = `+${shown}`;
      }
      if (t.visible) {
        const q = this.handPlacePose(f.shown);
        t.position.set(q.x, q.y - q.h / 2);
      }
    }
    return moving;
  }

  // ---------------------------------------------------------------- the carry

  private isHeld(): boolean {
    return this.drag.phase === 'heldShelf' || this.drag.phase === 'heldHand';
  }

  private offerIndexOf(id: string): number {
    const o = this.offers;
    for (let i = 0; i < o.length; i++) if (o[i]!.offerId === id) return i;
    return -1;
  }

  private handIndexOf(id: string): number {
    const h = this.hand;
    for (let i = 0; i < h.length; i++) if (h[i]!.packId === id) return i;
    return -1;
  }

  /** Pick up the pack at shelf slot / hand place `at` (posed for the hit in `lifted`, as drawn). */
  private startHold(e: PointerEvent, from: 'shelf' | 'hand', at: number): void {
    const app = this.app;
    const offer = from === 'shelf' ? this.offers[this.slotIdx[at]!] : undefined;
    const owned = from === 'hand' ? this.hand[at] : undefined;
    const id = offer?.offerId ?? owned?.packId;
    const look = offer?.look ?? owned?.look;
    if (!app || !id || !look || !this.heldPack) return;
    if (!pickUp(this.drag, from, id)) return;
    this.parkedId = null;
    this.shownAgain = false;
    const H = this.held, q = from === 'shelf' ? this.lifted : this.handPlacePose(at); // the shelf hit left its pose in `lifted`
    H.pointerId = e.pointerId; H.touch = e.pointerType === 'touch'; H.from = from;
    H.x = q.x; H.y = q.y; H.h = q.h; H.rot = q.rot;
    H.srcH = this.L.packH; // carried at shelf pack size, wherever it came from (a pedestal-sized pack hid the stage)
    H.ax = q.x - this.pointer.x; H.ay = q.y - this.pointer.y;
    H.vx = 0; H.vy = 0; H.pvx = 0; H.rub = 0; H.tagA = 0; H.alpha = 1; H.box = false;
    // the pack starts tilted exactly as it was drawn (its hover tilt and the idle wave), so the dive takes over smoothly
    if (from === 'shelf') {
      const t = this.slotTilt[at]!;
      H.aimX = t.ax + this.idleAim(this.slotIdx[at]!, this.slotLift[at]!); H.aimY = t.ay;
    } else {
      const v = this.placeView[at]!;
      H.aimX = v >= 0 ? this.hAimX[v]! : 0; H.aimY = v >= 0 ? this.hAimY[v]! : 0;
    }
    resetPointerVel(this.vel, this.pointer.x, this.pointer.y, e.timeStamp);
    this.heldPose.x = q.x; this.heldPose.y = q.y; this.heldPose.h = q.h; this.heldPose.rot = q.rot;
    this.lastMove.x = this.pointer.x; this.lastMove.y = this.pointer.y;
    resetShake(this.shake);
    this.swing.a = 0; this.swing.v = 0;
    this.heldPack.setLook(look);
    if (offer) this.dressTag(offer);
    try { app.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    e.preventDefault();
    this.sounds.pickUp();
    this.emit('onPickUp', () => this.events.onPickUp(from, id));
    this.wake();
  }

  /** Write the carried pack's tag for its offer (on a pick-up: never per frame). */
  private dressTag(offer: PackOffer): void {
    const tag = this.heldTag;
    if (!tag || this.heldTagOf === offer) return;
    this.heldTagOf = offer;
    const count = placardCount(offer.contains), badge = placardBadge(offer.badge);
    if (offer.soldOut) tag.set('Sold out', 'sold', count, badge);
    else if (offer.price <= 0) tag.set('Free', 'free', count, badge);
    else tag.set(String(offer.price), 'price', count, badge);
  }

  /** A held pointer moved: shake to listen, and whether the counter line is lit under it. */
  private heldMove(e: PointerEvent): void {
    const p = this.pointer;
    if (stepShake(this.shake, p.x - this.lastMove.x, p.y - this.lastMove.y, e.timeStamp)) this.sounds.shake();
    this.lastMove.x = p.x; this.lastMove.y = p.y;
    this.overLineFrom(p.x, p.y);
    this.wake();
  }

  private overLineFrom(x: number, y: number): void {
    const d = this.drag, was = d.overLine;
    moveHeld(d, zoneAt(this.L, x, y), d.id !== null && this.affordable.has(d.id));
    if (d.overLine === was) return;
    if (d.overLine) this.sounds.overLine();
    const over = d.overLine;
    this.emit('onOverLine', () => this.events.onOverLine(over));
  }

  /** The pointer let go of the held pack: `release()` decides, the shell hears it. */
  private releaseHeld(): void {
    const d = this.drag, id = d.id;
    if (!id || !this.isHeld()) return;
    const fromShelf = d.phase === 'heldShelf', wasOver = d.overLine;
    const zone = zoneAt(this.L, this.pointer.x, this.pointer.y);
    const action = release(d, zone, this.affordable.has(id));
    this.endHold(wasOver);
    if (action === 'none') return;
    if (action === 'buy') {
      this.held.buyN = this.hand.length;
      const o = this.offers[this.offerIndexOf(id)];
      this.held.box = !!o && o.contains > 1;
    }
    else if (action === 'play') this.sounds.play();
    const short = action === 'return' && fromShelf && zone === 'hand'; // carried across but not affordable
    if (short) this.sounds.refuse();
    const rect = this.screenRect(this.heldPose) ?? ZERO_RECT;
    this.emit('onDrop', () => this.events.onDrop(action, id, rect));
    if (short) this.emit('onShort', () => this.events.onShort(id));
    this.wake();
  }

  /** A held pack goes back where it came from (a lost pointer, a resize, input off, the scene hidden). */
  private cancelHold(): void {
    const d = this.drag, id = d.id;
    if (!id || !this.isHeld()) return;
    const wasOver = d.overLine;
    const action = cancelHeld(d);
    this.endHold(wasOver);
    if (action !== 'return') return;
    const rect = this.screenRect(this.heldPose) ?? ZERO_RECT;
    this.emit('onDrop', () => this.events.onDrop('return', id, rect));
    this.wake();
  }

  private endHold(wasOver: boolean): void {
    const app = this.app, pid = this.held.pointerId;
    this.held.pointerId = -1;
    if (app && pid >= 0) { try { if (app.canvas.hasPointerCapture(pid)) app.canvas.releasePointerCapture(pid); } catch { /* gone */ } }
    if (wasOver) this.emit('onOverLine', () => this.events.onOverLine(false));
  }

  /**
   * Where the held or travelling pack is headed this frame, into `goal` (canvas px). False when its place is gone (the
   * offer left the shelf, the pack left the hand): it then arrives where it is.
   */
  private goalInto(g: PackPose): boolean {
    const d = this.drag, L = this.L, H = this.held, df = getDragFeel();
    switch (d.phase) {
      case 'heldShelf':
      case 'heldHand': {
        // (the counter line's pull on an unaffordable pack is eased on top of this in `heldStep`)
        g.x = this.pointer.x + H.ax; g.y = this.pointer.y + H.ay;
        g.h = H.srcH * df.scale; g.rot = (df.staticRotate * Math.PI) / 180;
        return true;
      }
      case 'buying':
      case 'toHand': {
        if (H.box) {
          // a box goes to the middle of the hand: it hangs there while the purchase settles, then sinks into the tray
          g.x = L.w / 2; g.h = L.handPackH; g.rot = 0;
          g.y = d.phase === 'buying' ? L.handY - BUY_HANG * g.h : L.handY + 0.3 * g.h;
          return true;
        }
        this.syncFan();
        const f = this.fan;
        if (f.places <= 0) return false;
        handPoseInto(g, L, f.places - 1, f.places);
        if (d.phase === 'buying') g.y -= BUY_HANG * g.h; // it hangs just above its place while the purchase settles
        return true;
      }
      case 'toHandBack': {
        const j = d.id === null ? -1 : this.handIndexOf(d.id);
        if (j < 0) return false;
        this.syncFan();
        handPoseInto(g, L, Math.min(j, this.fan.shown), this.fan.places);
        return true;
      }
      case 'toShelf': {
        const i = d.id === null ? -1 : this.offerIndexOf(d.id);
        if (i < 0) return false;
        shelfPoseInto(g, L, i, this.scroll);
        g.x += this.rackX;
        return true;
      }
      case 'toPedestal':
      case 'idle':
        // the opener's sealed pose: it grows on its way, so the opener's canvas crossfades over it with no jump
        g.x = this.sealed.x; g.y = this.sealed.y; g.h = this.sealed.h; g.rot = 0;
        return true;
    }
  }

  /** The held or travelling pack: follow, travel, the dive, and the tag's swing. */
  private heldStep(dt: number): boolean {
    const hp = this.heldPack, d = this.drag, H = this.held;
    if (!hp) return false;
    const parked = d.phase === 'idle' && this.parkedId !== null;
    if (d.phase === 'idle' && !parked) {
      hp.view.visible = false;
      if (this.heldTag) this.heldTag.view.visible = false;
      return false;
    }
    const df = getDragFeel(), g = this.goal, L = this.L;
    const held = this.isHeld();
    const found = this.goalInto(g);
    if (!found) { g.x = H.x; g.y = H.y; g.h = H.h; g.rot = H.rot; }
    // the counter line's pull on an unaffordable shelf pack below it (rubberY is smooth at the line), eased
    const rubTo = d.phase === 'heldShelf' && d.id !== null && !this.affordable.has(d.id)
      ? rubberY(g.y, L.lineY, RUBBER_REACH * H.h) - g.y : 0;
    if (H.rub !== rubTo) {
      H.rub += (rubTo - H.rub) * easeK(RUBBER_EASE, dt);
      if (Math.abs(rubTo - H.rub) < 0.05) H.rub = rubTo;
    }
    if (held) g.y += H.rub;
    let k: number, kh: number;
    if (held) {
      const follow = H.touch ? Math.max(df.follow, 0.9) : df.follow; // a finger never trails (as Recruit.tsx)
      k = easeK(follow, dt);
      kh = easeK(HELD_SIZE_EASE, dt);
      const kc = easeK(Math.min(df.recenter, PACK_RECENTER), dt);
      H.ax -= H.ax * kc; H.ay -= H.ay * kc;
    } else {
      k = easeK(TRAVEL_EASE, dt);
      kh = k;
    }
    const sx = (g.x - H.x) * k, sy = (g.y - H.y) * k;
    H.x += sx; H.y += sy;
    H.h += (g.h - H.h) * kh;
    H.rot += (g.rot - H.rot) * kh;
    // THE DIVE: the leading edge leans down into the motion. Held, the motion is the POINTER'S, measured from its own
    // timestamped samples (smooth whatever the event rate); travelling, it is the pack's own eased travel.
    const idt = 1 / Math.max(dt, 1e-3);
    if (held) {
      const dec = pointerVelDecay(this.vel, performance.now());
      H.vx = this.vel.vx * dec; H.vy = this.vel.vy * dec;
    } else {
      const ek = easeK(df.tiltEase, dt);
      H.vx += (sx * idt - H.vx) * ek;
      H.vy += (sy * idt - H.vy) * ek;
    }
    let accel = ((H.vx - H.pvx) * idt) / Math.max(1, H.h); // pack heights per frame^2, whatever the frame rate
    if (Math.abs(accel) < SWING_NOISE) accel = 0;
    H.pvx = H.vx;
    const gain = df.tiltMax > 0 ? df.tiltGain / df.tiltMax : 0;
    const kd = easeK(DIVE_EASE, dt);
    H.aimX += (clamp1(softDead(H.vx, DIVE_DEAD) * gain) - H.aimX) * kd;
    H.aimY += (clamp1(softDead(H.vy, DIVE_DEAD) * gain) - H.aimY) * kd;
    if (Math.abs(H.aimX) < 0.002) H.aimX = 0;
    if (Math.abs(H.aimY) < 0.002) H.aimY = 0;
    let aimX = H.aimX, aimY = H.aimY;
    if (d.phase === 'buying') aimX = 0.9 * Math.sin(this.time * SHIMMER_RATE); // the shimmer: the gloss sweeps while it waits
    if (parked) { aimX = 0; aimY = 0; }
    // a sold box sinks into the hand and fades while its packs rise into the fan
    const alphaTo = H.box && d.phase === 'toHand' ? 0 : 1;
    if (H.alpha !== alphaTo) {
      H.alpha += (alphaTo - H.alpha) * easeK(BOX_FADE, dt);
      if (Math.abs(alphaTo - H.alpha) < 0.01) H.alpha = alphaTo;
    }

    const arrivedNow = !held && d.phase !== 'buying' && !parked
      && (!found || (Math.abs(g.x - H.x) < ARRIVE_PX && Math.abs(g.y - H.y) < ARRIVE_PX && Math.abs(g.h - H.h) < ARRIVE_PX));
    if (arrivedNow && found) { H.x = g.x; H.y = g.y; H.h = g.h; H.rot = g.rot; }
    const P = this.heldPose;
    P.x = H.x; P.y = H.y; P.h = H.h; P.rot = H.rot; P.alpha = H.alpha;
    hp.pose(P, aimX, aimY, 0);

    // the price tag hangs from the pack's bottom, behind it, on its spring: it fades in at a pick-up and out at a drop
    const tag = this.heldTag?.view;
    if (tag) {
      const tagTo = d.phase === 'heldShelf' ? 1 : 0;
      if (H.tagA !== tagTo) {
        H.tagA += (tagTo - H.tagA) * easeK(TAG_FADE, dt);
        if (Math.abs(tagTo - H.tagA) < 0.01) H.tagA = tagTo;
      }
      tag.visible = H.tagA > 0 && H.from === 'shelf';
      if (tag.visible) {
        stepSwing(this.swing, Math.abs(accel) < TAG_ACC_DEAD ? 0 : accel, dt);
        tag.alpha = H.tagA;
        tag.position.set(H.x - (H.h * ASPECT) / 2 + H.h * TAG_INSET, H.y - H.h / 2 + H.h * TAG_INSET);
        tag.rotation = TAG_REST + this.swing.a;
        tag.scale.set(this.placardK * Math.sqrt(H.h / Math.max(1, this.L.packH)));
      }
    }

    if (arrivedNow) this.finishTravel();
    return true;
  }

  /** A travelling pack reached its place: the state machine goes idle; a played pack stays on the pedestal. */
  private finishTravel(): void {
    const d = this.drag, ph = d.phase, id = d.id;
    arrived(d);
    const shownAgain = this.shownAgain;
    this.shownAgain = false;
    if (parksOnArrival(ph, shownAgain)) { this.parkedId = id; return; }
    if (ph === 'toHand') this.sounds.land();
    const H = this.held;
    if (ph === 'toShelf' && id !== null) {
      const s = this.slotId.indexOf(id);
      if (s >= 0) {
        // back in its place: no restock fade; it keeps the tilt it arrived with (easing to rest) and sits down
        this.slotShow[s] = 1;
        const t = this.slotTilt[s]!;
        t.ax = H.aimX - this.idleAim(this.slotIdx[s]!, 0); t.ay = H.aimY;
        this.slotSettle[s] = this.time;
      }
    }
    if ((ph === 'toHandBack' || (ph === 'toHand' && !H.box)) && id !== null) {
      // into its fan place (a bought pack: the fan's last), the same way: it keeps its arrival tilt and sits down
      const v = ph === 'toHand' ? this.viewAtPlace(this.fan.places - 1) : this.handViewId.indexOf(id);
      if (v >= 0) { this.hAimX[v] = H.aimX; this.hAimY[v] = H.aimY; this.hSettle[v] = this.time; }
    }
    // (the held pack stays drawn THIS frame, posed exactly on its place: the rack and the hand were posed earlier in
    // the tick with the place still empty, so hiding it now left one empty frame. The next frame shows the place's own
    // pack and `heldStep` hides this one.)
    this.fanKey = -1; // the reserved place (if any) is released
  }

  /** The view showing fan place `j`'s pack (-1: none). */
  private viewAtPlace(j: number): number {
    return j >= 0 && j < HAND_FAN_MAX ? this.placeView[j]! : -1;
  }

  /** The counter line: dim at rest, brighter while a pack is carried, its glow lit while over the line. */
  private lineStep(dt: number): boolean {
    const base = this.lineBase, lit = this.lineLit;
    if (!base || !lit) return false;
    const held = this.isHeld();
    // (no line while a hand pack is carried or played: the line is where a SHELF pack is bought; owner 2026-11-25)
    const ph = this.drag.phase;
    const playing = ph === 'heldHand' || ph === 'toHandBack' || ph === 'toPedestal' || this.parkedId !== null;
    const baseTo = playing ? 0 : held ? LINE_HELD : LINE_REST, litTo = this.drag.overLine ? 1 : 0;
    const ln = this.line;
    if (ln.base === baseTo && ln.lit === litTo) return false;
    const k = easeK(LINE_EASE, dt);
    ln.base += (baseTo - ln.base) * k;
    ln.lit += (litTo - ln.lit) * k;
    if (Math.abs(baseTo - ln.base) < LIFT_SETTLE) ln.base = baseTo;
    if (Math.abs(litTo - ln.lit) < LIFT_SETTLE) ln.lit = litTo;
    base.alpha = ln.base;
    lit.alpha = ln.lit;
    lit.visible = ln.lit > 0;
    return true;
  }

  /** The entrance's frame: eased, then exact. Offsets only (the layers' y), so hit tests settle with it. */
  private enterStep(dt: number): boolean {
    if (this.enter >= 1) return false;
    this.enter += (1 - this.enter) * easeK(ENTER_EASE, dt);
    if (1 - this.enter < 0.002) this.enter = 1;
    const o = 1 - this.enter, h = this.L.h;
    if (this.rack) this.rack.y = -ENTER_DROP * h * o;
    if (this.placardLayer) { this.placardLayer.y = ENTER_DROP * 0.5 * h * o; this.placardLayer.alpha = this.rackAlpha * this.enter; }
    if (this.handLayer) this.handLayer.y = ENTER_RISE * h * o;
    return true;
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
    if (!this.toCanvasXY(e.clientX, e.clientY)) return false;
    this.pointer.x = this.sample.x; this.pointer.y = this.sample.y;
    return true;
  }

  /** A client position in canvas px (into `this.sample`). False when there is no usable rect. */
  private toCanvasXY(clientX: number, clientY: number): boolean {
    const app = this.app;
    if (!app) return false;
    if (!this.rect.valid) this.cacheRect();
    if (!this.rect.valid) return false;
    this.sample.x = ((clientX - this.rect.l) * app.screen.width) / this.rect.w;
    this.sample.y = ((clientY - this.rect.t) * app.screen.height) / this.rect.h;
    return true;
  }

  private readonly onEnter = (): void => { this.cacheRect(); };

  private readonly onLeave = (): void => { this.pointerOn = false; this.backdrop?.rest(); this.wake(); };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.app) return;
    const held = this.isHeld();
    if (held && e.pointerId !== this.held.pointerId) return; // a second finger never moves the held pack
    if (!this.toCanvas(e)) return;
    this.backdrop?.lookAt(this.pointer.x, this.pointer.y); // the room looks where the pointer is
    if (held) {
      // every sample the pointer took since the last event (a fast mouse sends several per frame), each with its time
      const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
      if (list && list.length > 0) {
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!;
          if (this.toCanvasXY(c.clientX, c.clientY)) samplePointerVel(this.vel, this.sample.x, this.sample.y, c.timeStamp);
        }
      } else samplePointerVel(this.vel, this.pointer.x, this.pointer.y, e.timeStamp);
      this.heldMove(e);
      return;
    }
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
    if (!app || !this.inputOn || this.slide.phase !== SLIDE_NONE || this.scrollDrag.active || this.drag.phase !== 'idle') return;
    if (e.button > 0) return; // the main button (or a touch / pen contact) only
    this.cacheRect();
    if (!this.toCanvas(e)) return;
    const { x, y } = this.pointer;
    if (y >= this.L.lineY) {
      const j = this.handAt(x, y);
      if (j >= 0) this.startHold(e, 'hand', j);
      return;
    }
    const s = this.packAt(x, y);
    if (s >= 0) { this.startHold(e, 'shelf', s); return; }
    const d = this.scrollDrag;
    d.active = true; d.id = e.pointerId; d.startX = x; d.startTarget = this.target;
    try { app.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    e.preventDefault();
    this.wake();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.isHeld() && e.pointerId === this.held.pointerId) {
      // a release decides; a cancel or a lost capture (the pointer went away) sends the pack back
      if (e.type === 'pointerup') { this.toCanvas(e); this.releaseHeld(); } else this.cancelHold();
      return;
    }
    if (this.scrollDrag.active && e.pointerId === this.scrollDrag.id) this.endScrollDrag();
  };

  private endScrollDrag(): void {
    this.scrollDrag.active = false;
    this.scrollDrag.id = -1;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.app || !this.inputOn || this.slide.phase !== SLIDE_NONE) return;
    e.preventDefault(); // the wheel scrolls the rack, never the page
    if (this.isHeld()) return; // the rack stays put under a held pack (its place keeps its ghost)
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
