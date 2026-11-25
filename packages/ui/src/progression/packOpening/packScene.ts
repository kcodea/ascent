/**
 * PACK OPENING: the Pixi scene (spec §3, §6, §11). The pack, the tear strip, the sleeve, the 5-card stack, the card
 * backs and the FIRST HALF of each flip (0 -> 90 degrees). A port of the owner-approved prototype
 * (docs/superpowers/specs/2026-11-23-pack-opening-prototype.html); the tear + sleeve physics are `peelModel.ts`'s, the
 * strip mesh is `stripMesh.ts`'s, the placeholder pictures `packTextures.ts`'s.
 *
 * Contract (the React shell, Task 7, owns everything else):
 *  - Lifecycle like `crateFx/crateFxPixi.ts`: one `Application` per opening, async init, `destroy()` safe at any moment
 *    (a late Application is destroyed on arrival). When Pixi is not allowed (`pixiAllowed()`), or init fails, every
 *    method is a no-op and the only event fired is `onUnavailable` (once; never after `destroy()`): the shell falls
 *    back to its reduced-motion path on it. When Pixi is not allowed it fires synchronously, inside `createPackScene`.
 *  - Events in order: `onPop` (the seal gave: ask the server now), `onStripFree` (the sleeve is live), `onSleeveDropped`,
 *    `onZoomed`, then `onFlipEdge` once per `flipTop`. Quick open fires the same events in the same order.
 *  - The scene CALLS `PackSounds` (pop, tear, crackle, rip, sleeveFree, slide, drop, whoosh, tease, flip, silence) but never
 *    creates or disposes it. The DOM beats (stamp, aether, summary) are the shell's.
 *  - Coordinates: the renderer is sized to the host in LAYOUT px (`resizeTo: host`, resolution x `stageScale()`); the
 *    pack is simulated in its BASE units (`PACK_GEOM`, 300 x 450) and the whole pack is scaled to fit the host. Pointer
 *    and `flipTop`'s point arrive in SCREEN px and `onFlipEdge` reports SCREEN px, converted through the canvas rect
 *    cached at pointerenter / pointerdown / flip start (never read per frame).
 *  - Clicks are not interpreted after the zoom: they bubble from the canvas to the host, where the shell decides to
 *    call `flipTop`.
 *  - The ticker stops once the stack has zoomed and nothing moves (no flip, crossfade, flecks, shake, breathing glow
 *    (Epic and up; Common / Rare glows are static), big-pull burst or pack aura still fading) and restarts on input, `flipTop`, `setBacks`, `quickOpen` and `resetSealed`.
 *  - No allocation per frame in the tear / sleeve loops: pooled flecks, reused points and in-place geometry buffers.
 */
import { Application, type Texture, type Ticker } from 'pixi.js';
import type { CrateRarity, PackLook } from '@game/progression';
import { stageScale } from '../../stage';
import { detachPixiDomEvents } from '../../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender, watchContextLoss } from '../../pixiAppSafety';
import { PIXI_ANTIALIAS } from '../../phoneArt';
import { phonePixiOptions, pixiAllowed } from '../../phoneDiag';
import { followStage } from '../../pixiStageFollow';
import { getDragFeel } from '../../dragFeel';
import {
  FLIP_LIFT, FLIP_LIFT_GUARANTEED, FLIP_PERSPECTIVE_PER_WIDTH, PILE_MAX_H, REVEAL_FACE_X,
  REVEAL_STACK_X, REVEAL_Y, REVEALED_SCALE, faceMoveEase, faceTurnEase, flipAngle, flipHalfMs, flipPoseAt, projectTurnedRect, type FlipPose,
} from './cardFlip';
import { getPackFeel, PACK_BASE_SIZE, type PackFeel } from './packFxConfig';
import { CARD_GLOW_TIERS, PACK_GLOW_TIERS, glowAlphaAt, packGlowRarity, type GlowTier } from './packGlow';
import type { PackSounds } from './packSounds';
import {
  teaseAt, teaseAuraLevel, teaseBeatFrames, teaseFrames, teaseGlowAlpha, teaseGlowFade, teaseGlowPop, teasePop, teaseRarityAt, teaseTremble,
  type TeaseAt,
} from './packTease';
import { AURA_COLORS, makeAura, type Aura } from './packAura';
import { AetherStream, type AetherProgress } from './packAether';
import {
  SPILL_LINE_V, SPILL_MIN_REACH, SPILL_PACK_HALF, makeMaskedGloss, makeMaskedSheen, makeSheen, makeSpill, makeStage, newHandling,
  stepHandling, type GlossFx, type Handling, type MaskedFx, type SheenFx, type SpillFx, type StageFx,
} from './packFx';
import { PILE_LEAN_PX, PILE_LEAN_RAD, PILE_RISE_PX, newPile, pileAtRest, pileEase, pileScale, type PileState } from './packPile';
import { cardRestX, cardRestY } from './packViews';
import { COSMETIC_RARITIES } from '@game/progression';
import { ANCIENT_GLOW_STOPS, BACK_LOGO, BURST_TEX, PACK_GEOM, TEX_RES, rarityTint } from './packTextures';
import { AURA_BURST, BURST, FACE_AMBIENT, FACE_PLATE_H, FLIP_CHARGE, bigPullTier, burstPoseAt, type BigPullTier, type BurstPose } from './bigPull';
import { holoShiftInto, packHoloStrength } from './packHolo';
import {
  buildPackViews, CARDS_Y, RIBBON_DY, RIBBON_HH, RIBBON_HW, wallInto, type SceneTextures, type Views,
} from './packViews';
import {
  newSleeve, newTear, releaseTear, stepSleeve, stepTear, type SleeveState, type TearState, type Vec3,
} from './peelModel';
import { projInto, unprojInto, type Pt, type StripSurface } from './stripMesh';
import {
  aimInto, glossBandInto, glossD, newGlossBand, newTilt, newTiltPose, setTiltPose, stepTilt, tiltEaseK, tiltInto,
  cornerCalm, tiltTargetInto, tiltedCornerHit, untiltInto,
} from './packTilt';

// ---------------------------------------------------------------- public contract

export interface PackSceneEvents {
  /** Pixi is not allowed here, or its init failed: nothing else will ever fire. The shell opens without the scene. */
  onUnavailable(): void;
  /** The seal gave: the shell sends the request now. */
  onPop(): void;
  /** The sleeve is live this instant. */
  onStripFree(): void;
  onSleeveDropped(): void;
  /** The stack is settled at the zoom. */
  onZoomed(): void;
  /**
   * The flipping card is edge-on (90 degrees). `screenRect` is the card's UNROTATED rect at that instant (its centre,
   * width and height as if facing the camera), in SCREEN px: the DOM face mounts there at rotateY(90deg).
   */
  onFlipEdge(index: number, screenRect: { left: number; top: number; width: number; height: number }): void;
}

export interface PackBack { rarity: CrateRarity; guaranteed: boolean }

export interface PackScene {
  /** The card backs, in flip order (null = plain pack-brand backs). Only the top card's back ever shows. */
  setBacks(backs: readonly PackBack[] | null): void;
  /**
   * Flip the top card's first half toward `toScreen` (SCREEN px): the featured slot's centre, right of the stack
   * (`REVEAL_FACE_X`), so the card turns over as it travels right. False while a flip is in flight, before `onZoomed`,
   * or when no card remains.
   */
  flipTop(toScreen: { x: number; y: number }): boolean;
  /** Scripted tear + sleeve over `feel.quickOpenMs` (the same events and sounds as a hand-driven opening). */
  quickOpen(): void;
  /** A short fade back to a fresh sealed pack with plain backs and input enabled (the failure path). */
  resetSealed(): void;
  setInputEnabled(on: boolean): void;
  /**
   * The end of the pack: the pack, the pile and the flip go, the stage stays lit, and an aura burns behind each given
   * card of the row (at most two: the best pulls), bursting once as it lights. `x` / `y` are a card's centre and `h` its
   * visible height, in SCREEN px. Call it with no spots first (the row is still dealing), then with them once it settled.
   */
  showSummary(spots: readonly SummarySpot[]): void;
  /**
   * The DOM face's turn really began: `startMs` is its transition's start on the document timeline and `durMs` its
   * length. The aura behind the face reads the same clock from here on, so it turns and travels with the face frame for
   * frame (owner 2026-11-25: "its still slightly off"). Until this arrives the aura waits edge-on.
   */
  faceTurnStarted(startMs: number, durMs: number): void;
  /**
   * A duplicate card of the summary row comes apart into Aether and flows into the medallion (packAether.ts). `from` is
   * the card (centre, width, height) and `to` the medallion's centre, in SCREEN px. `progress` hears how much of the
   * card the medallion has taken (0..1), at most once a frame, and `done` with the last mote; with no scene to draw it,
   * it is told at once that everything arrived.
   */
  aetherFlow(from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number }, progress: AetherProgress): void;
  /** The last Aether has landed: the medallion's aura bursts. */
  aetherBurst(): void;
  /** Scale the scene's clock (1 = real time, 0.25 = slow-mo). Dev-only (the Pack Lab); a no-op until Pixi is up. */
  setSpeed(mult: number): void;
  /** Safe at any moment, including before the async init resolves. */
  destroy(): void;
}

/** One card of the summary row to light: its centre and visible height (screen px), and its rarity. */
export interface SummarySpot { x: number; y: number; h: number; rarity: CrateRarity }

/**
 * Scale the px-valued feel knobs (tuned at `PACK_BASE_SIZE.w`) to a pack drawn `packW` wide. Pure; never mutates.
 * The scene itself simulates in the pack's BASE units and scales the drawn pack, so pointer travel is measured in base
 * units and these knobs already scale with the pack (equivalent to this at packW = the drawn width). This is for a
 * caller that works in rendered px (the Pack Lab's readouts, a future rendered-px simulation).
 */
export function scaleFeelPx(feel: PackFeel, packW: number): PackFeel {
  const k = packW / PACK_BASE_SIZE.w;
  return { ...feel, maxTearSpeed: feel.maxTearSpeed * k, sleeveGrip: feel.sleeveGrip * k, sleeveLetGo: feel.sleeveLetGo * k };
}

/** Only the current top card's back is visible: card `cardIndex` once `flipped` cards have gone. */
export const topBackVisible = (cardIndex: number, flipped: number): boolean => cardIndex === flipped;

export { FLIP_HALF_GUARANTEED_MS, FLIP_HALF_MS, FLIP_PERSPECTIVE_PER_WIDTH } from './cardFlip';

// ---------------------------------------------------------------- constants (pack base units, dt = 60 Hz frames)

const { W, H, BODY_H, CARD_W, CARD_H } = PACK_GEOM;
const FRAME_MS = 1000 / 60;
/** Pulled this far, the sleeve's rim is below the stack. */
const SLEEVE_CLEAR = CARDS_Y + CARD_H / 2 - H + 14;
/**
 * Half the zoomed back plus half the revealed face (`REVEALED_SCALE` x the back) fill at most this share of the gap
 * between their centres (`REVEAL_FACE_X - REVEAL_STACK_X`), so on a narrow theatre the piles never overlap; at 16:9 it
 * never binds.
 */
const REVEAL_FIT = 0.9;
/** Grab radius at the strip's corner, sealed / once started. */
const GRAB_R_SEALED = 45, GRAB_R_STARTED = 55;
/** The calm zone round the tear corner (base units): flat within NEAR (the grab ring and a margin), full tilt from FAR. */
const CALM_NEAR = 60, CALM_FAR = 170;
const DIM_TINT = 0xb8bccc;
/** The zoomed stack's slide aside on the first flip: the share of the way left covered per dt frame. */
const SIDE_EASE = 0.12;

/** The pack aura's fade-out per dt frame once the sleeve drops (linear, so it reaches 0 and the ticker can idle). */
const PACK_GLOW_FADE = 0.06;
/** resetSealed's fade, each way (dt units). */
const RESET_FADE = 10;
/** The backs crossfade (dt units). */
const XFADE = 18;
/** A cap on one frame's dt: a hitch never explodes a spring. */
const MAX_DT = 3;

const BASE = import.meta.env?.BASE_URL ?? '/';
/**
 * The sealed pack's size, as a share of what the fit allows (owner 2026-11-24: "can we make the pack size smaller? by
 * like 20%?"). Only the pack shrinks: the zoomed stack grows by 1 / PACK_SIZE more, so the cards land where they did.
 */
export const PACK_SIZE = 0.87;
/** The torn lip's width over the wrapper's: its ends stay just inside the wrapper's sides. */
export const LIP_INSET = 0.975;
/** How much of the sealed pack's outer halo is drawn (0 = none: the pack's light stays behind the wrapper). */
export const PACK_HALO = 0;
/**
 * The stack's scale while it sits in the sleeve (owner 2026-11-24: "when crinkling the wrapper, the sides get squeezed and
 * the card side can be seen. increase the size of the wrapper only"): the wrapper is drawn larger (PACK_SIZE) and the
 * cards inside it this much smaller, so the cards are the size on screen they were and a squeezed or tilted wrapper
 * still covers them. The zoom takes the stack from this to its reveal size (unchanged).
 */
export const CARD_IN_SLEEVE = 0.92;
/** The stack's scale at full zoom, over its size in the sleeve: the `stackZoom` knob, made up for the smaller pack. */
export const stackZoomScale = (stackZoom: number): number => (1 + stackZoom) / PACK_SIZE;

/**
 * The scale the sealed pack is drawn at for a `w` x `h` host (pack base units to px). The one rule for the opener's
 * `layout` and for anything that must match the pack's drawn size (the pack shop's pedestal).
 */
export function sealedPackScale(w: number, h: number): number {
  const zf = 1 + getPackFeel().stackZoom;
  const kFit = ((REVEAL_FACE_X - REVEAL_STACK_X) * w * REVEAL_FIT) / (CARD_W * zf * (1 + REVEALED_SCALE) / 2);
  // the revealed face (REVEALED_SCALE x the zoomed back) is never taller than PILE_MAX_H of the host
  const kHigh = (PILE_MAX_H * h) / (CARD_H * zf * REVEALED_SCALE);
  // the fit sizes the ZOOMED CARDS; the pack itself is drawn PACK_SIZE of that, and the stack's zoom makes up the
  // difference (`stackZoomScale`), so shrinking the pack leaves the reveal's cards the size they were
  return Math.max(0.2, Math.min((h * 0.62) / PACK_BASE_SIZE.h, (w * 0.5) / PACK_BASE_SIZE.w, kFit, kHigh)) * PACK_SIZE;
}

/** The sealed pack's drawn height in px for a `w` x `h` host. */
export const sealedPackHeight = (w: number, h: number): number => sealedPackScale(w, h) * PACK_BASE_SIZE.h;

/** The sealed pack's centre in px for a `w` x `h` host: `layout` centres it on the host (the pack shop's handoff). */
export const sealedPackCentre = (w: number, h: number): { x: number; y: number } => ({ x: w / 2, y: h / 2 });

const CURSOR_GRAB = `url('${BASE}cursors/gauntlet_open.svg') 6 2, pointer`;
const CURSOR_HELD = `url('${BASE}cursors/hand_closed.svg') 13 12, grabbing`;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

type Phase = 'peel' | 'sleeve' | 'zoom' | 'end';

class PackSceneImpl implements PackScene {
  private app: Application | null = null;
  private v: Views | null = null;
  private tex: SceneTextures | null = null;
  private textures: Texture[] = [];
  private destroyed = false;
  private resizeObs: ResizeObserver | null = null;
  private readonly n: number;

  // what the shell asked for (kept across init)
  private backs: readonly PackBack[] | null = null;
  private inputOn = true;
  private pendingQuick = false;
  private speed = 1;

  // simulation
  private phase: Phase = 'peel';
  private tear: TearState = newTear();
  private sleeve: SleeveState = newSleeve();
  private time = 0;
  private prevT = 0.5;
  /** Foil torn that has not shed its spark yet (in sparks). */
  private sparkDebt = 0;
  private shake = 0;
  private popFired = false;
  private flying = false;
  private readonly fv = { x: 0, y: 0, r: 0 };
  private sleeveRot = 0;
  private rotDir = 1;
  private zoom = 0;
  private zoomV = 0;
  private zoomed = false;
  /** The zoomed stack's centre (pack base units): `REVEAL_STACK_X`, `REVEAL_Y` of the host. Set by `layout`. */
  private zoomTx = W / 2;
  /** The host's dead centre (pack base units): where the stack zooms to before the first reveal. Set by `layout`. */
  private zoomCx = W / 2;
  /** 0 = the zoomed stack sits dead centre, 1 = it has slid aside to `REVEAL_STACK_X`. Starts on the first flip. */
  private side = 0;
  private sideOn = false;
  private zoomTy = CARDS_Y;
  private glowReveal = 0;
  /** Cards flipped away so far (the top card is `flipped`). */
  private flipped = 0;

  // input (pack base units)
  private tearHeld = false;
  private sleeveHeld = false;
  private pointerId = -1;
  private hasCursor = false;
  private readonly cursor: Pt = { x: 0, y: 0 };
  private readonly grabOff: Pt = { x: 0, y: 0 };
  private readonly vel: Pt = { x: 0, y: 0 };
  private lastX = 0;
  private lastY = 0;
  private lastStamp = 0;
  private grabY = H + BODY_H * 0.55;
  private curY = 0;
  private readonly rect = { l: 0, t: 0, w: 0, h: 0, valid: false };

  // scratch (no per-frame allocation)
  private readonly pt: Pt = { x: 0, y: 0 };
  private readonly pt2: Pt = { x: 0, y: 0 };
  private readonly pt3: Pt = { x: 0, y: 0 };
  /** The body's vertices before the tilt (sized on first use): the back wall is laid from these. */
  private bodyFlat = new Float32Array(0);
  private readonly pt4: Pt = { x: 0, y: 0 }; // the tilt step's corner (never shared with the pointer handlers)
  private readonly target: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly tearInput: { held: boolean; target: Vec3 | null } = { held: false, target: null };
  private readonly sleeveInput = { held: false, want: 0, flickVy: 0 };

  // the flip's first half
  private readonly flip = {
    active: false, idx: 0, t: 0, dur: 1, c0x: 0, c0y: 0, tx: 0, ty: 0, scale: 1, lift: 0, ribbon: false,
  };
  // the rarity tease (packTease.ts): it builds while the pointer rests on the pile's top card, and eases away when it leaves
  private readonly tease = { live: false, t: 0, idx: 0, stage: -1, level: 0 };
  /** What the tease adds to the top card's pose this frame (read by `pileStep`, the one place the card is posed). */
  private teasePopV = 0;
  private teaseRotV = 0;
  private beatT = 0;
  // the pile under the hand (packPile.ts): the top card lifts, leans, sinks on a press
  private readonly pile: PileState = newPile();
  private pilePressed = false;
  private readonly pileC: Pt = { x: 0, y: 0 }; // the top card's centre in root units (written by `pileHit`)
  private cardSX = 0; // a card's rest scale (captured once, before any card is posed)
  private cardSY = 0;
  // the shader auras (packAura.ts): one under the pile (the tease), one that rides the turning card and lands with its face
  private auraPile: Aura | null = null;
  private auraFace: Aura | null = null;
  private faceAmbient = 0;
  private pileAmbient = 0; // the second aura's level on the summary (it lights the second-best pull)
  private summaryOn = false;
  /** The guaranteed seal's stamp, 0..1 (1 = down on the card). */
  private sealT = 1;
  private aether: AetherStream | null = null;
  /** One stage px in canvas px (the Aether motes are sized in stage px). */
  private aetherUnit = 1;
  // the presentation shaders (packFx.ts): the stage behind everything, the light from inside the
  // pack, the top card back's sheen; and what drives them
  private stage: StageFx | null = null;
  private spill: SpillFx | null = null;
  // the wrapper's idle sheen and gloss band, cut to the wrapper art (they replace the plain meshes when WebGL is up)
  private sheenOv: MaskedFx | null = null;
  private glossOv: GlossFx | null = null;
  private sheen: SheenFx | null = null;
  private readonly handling: Handling = newHandling();
  private packPressed = false; // a press on the sealed wrapper (a squeeze)
  private readonly squeeze = { a: 0, y: 0 };
  private stageEnergy = 0.3;
  private stageWash = 0;
  private spillLevel = 0;
  private haloFade = 1;
  private rimPinch = 0; // how far the wrapper's open end is drawn in (0..1 of its half width)
  private sheenLevel = 0;
  private readonly focus: Pt = { x: 0, y: 0 };
  private focusSet = false;
  private readonly land = { active: false, t: 0, dur: 1, x0: 0, y0: 0, h0: 1, x1: 0, y1: 0, h1: 1, t0: -1, durMs: 1, wait: 0 };
  private readonly teaseOut: TeaseAt = { stage: 0, k: 0 };
  /** The glow's alpha when the tease ended (0 = no glow to fade): it fades from here through the turn (`flipStep`). */
  private teaseGlowOut = 0;
  // the top card's back crossfade
  private readonly xf = { active: false, t: 0 };
  private glowFade = 1;
  /** The sealed pack's aura: its tier (packGlow.ts) and its fade (1 until the sleeve drops, then to 0). */
  private readonly packTier: GlowTier;
  private packGlowFade = 1;
  // quick open
  private readonly quick = { active: false, t: 0, tearDur: 1, sleeveDur: 1, T0: 0.5, sleeveStart: 0, dy0: 0, want: 0 };
  // resetSealed's fade
  private readonly reset = { active: false, t: 0, swapped: false };
  /** The big-pull light burst (bigPull.ts): its tier and its clock (ms, slow-mo scaled). */
  private readonly burst = { active: false, ms: 0, tier: 'legendary' as Exclude<BigPullTier, 'none'> };
  private readonly burstPose: BurstPose = { alpha: 0, scale: 1, rotation: 0, live: false };

  // the sealed pack's mouse tilt (the drag dive's, packTilt.ts) and the gloss band
  private readonly tilt = newTilt();
  /** Latched by the first grab of the tear (or quick open): the pack stays flat until resetSealed. */
  private tiltLocked = false;
  private hoverOn = false;
  private readonly hoverAim: Pt = { x: 0, y: 0 };
  private readonly hoverPt: Pt = { x: 0, y: 0 };
  private readonly tiltTgt = { rx: 0, ry: 0 };
  private readonly tiltPose = newTiltPose();
  private readonly band = newGlossBand();
  private readonly surface: StripSurface = { tilt: this.tiltPose, band: this.band, gloss: 0 };
  /** What the body meshes were last written with (rewrite only when one changes: the tilt idles once settled). */
  private readonly bodyKey = { rx: NaN, ry: NaN, D: NaN, sq: 0 };
  private readonly glossKey = { centre: NaN, halfWidth: NaN, slope: NaN };
  private readonly glowCorners = new Float64Array(8);
  /** The holo gradient's sample offset this frame (packHolo.ts `holoShiftInto`). */
  private readonly holoShift = { x: 0, y: 0 };

  constructor(
    private readonly host: HTMLElement,
    private readonly look: PackLook,
    cardCount: number,
    private readonly sounds: PackSounds,
    private readonly events: PackSceneEvents,
  ) {
    this.n = clamp(Math.round(cardCount) || 1, 1, 5);
    this.packTier = PACK_GLOW_TIERS[packGlowRarity(look)];
  }

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
      guardAppRender(app, 'packScene');
      watchContextLoss(app, 'packScene');
      if (this.destroyed) { destroyPixiApp(app); return; }
      this.app = app;
      this.build(app);
    } catch (e) {
      console.error('[packScene] pixi init failed; the shell falls back to the reduced-motion opening:', e);
      if (app && this.app !== app) { try { destroyPixiApp(app); } catch { /* half-built */ } }
      const wanted = !this.destroyed;
      this.teardown();
      if (wanted) this.unavailable();
    }
  }

  /** Tell the shell there will be no scene (once; the shell's handler is guarded, but never fire twice). */
  private unavailableFired = false;
  private unavailable(): void {
    if (this.unavailableFired) return;
    this.unavailableFired = true;
    this.events.onUnavailable();
  }

  private build(app: Application): void {
    const built = buildPackViews(this.look, this.n, (t) => { this.textures.push(t); });
    this.tex = built.tex;
    this.v = built.views;
    app.stage.addChild(built.views.root);
    // the auras sit just over the painted burst, under the pack and the flipping card
    const webgl = (app.renderer as { name?: string }).name === 'webgl';
    this.auraFace = makeAura(webgl);
    this.auraPile = makeAura(webgl);
    if (this.auraFace) built.views.root.addChildAt(this.auraFace.mesh, 1);
    if (this.auraPile) built.views.root.addChildAt(this.auraPile.mesh, 1);
    // the Aether stream: over everything else in the scene
    this.aether = new AetherStream(webgl, app.renderer.resolution);
    app.stage.addChild(this.aether.root);
    // the presentation shaders: the stage under everything; the spill between the
    // stack and the sleeve front; the sheen over the stack
    const vw = built.views;
    const pc = AURA_COLORS[packGlowRarity(this.look)];
    this.stage = makeStage(webgl);
    if (this.stage) { app.stage.addChildAt(this.stage.mesh, 0); this.stage.mesh.visible = true; this.stage.u.uTint.set(pc[0]); }
    // the wrapper's highlights, cut to the art's own shape: they take the plain sheen / gloss meshes' place
    this.sheenOv = makeMaskedSheen(webgl, vw.body, vw.body.texture, vw.sheen.texture);
    if (webgl) vw.strip.maskSpecToArt(); // the strip's highlight, cut to its art the same way
    this.glossOv = makeMaskedGloss(webgl, vw.body, vw.body.texture, vw.gloss.texture);
    for (const [ov, plain] of [[this.sheenOv, vw.sheen], [this.glossOv, vw.gloss]] as const) {
      if (!ov) continue;
      ov.mesh.position.copyFrom(plain.position); ov.mesh.scale.copyFrom(plain.scale);
      vw.sleeveFront.addChildAt(ov.mesh, vw.sleeveFront.getChildIndex(plain));
      plain.visible = false;
    }
    if (this.glossOv) { const g3 = this.glossOv.u.uGeom; g3[0] = W; g3[1] = H; g3[2] = BODY_H; }
    this.spill = makeSpill(webgl);
    if (this.spill) {
      this.spill.u.uTint.set(pc[0]); this.spill.u.uHot.set(pc[2]);
      vw.pack.addChildAt(this.spill.mesh, vw.pack.getChildIndex(vw.sleeveFront));
    }
    this.sheen = makeSheen(webgl);
    if (this.sheen) { vw.cardsC.addChild(this.sheen.mesh); vw.cardsC.addChild(vw.backLogo); }

    const canvas = app.canvas;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'auto';
    canvas.style.touchAction = 'none'; // a finger drag tears, it never scrolls
    canvas.addEventListener('pointerenter', this.onEnter);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('lostpointercapture', this.onUp);
    this.host.appendChild(canvas);

    app.renderer.on('resize', this.layout);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => { this.app?.queueResize(); });
      this.resizeObs.observe(this.host);
    }
    this.layout();
    this.resetState();
    app.ticker.add(this.tick);
    if (this.pendingQuick) { this.pendingQuick = false; this.quickOpen(); }
  }

  faceTurnStarted(startMs: number, durMs: number): void {
    const L = this.land;
    if (!L.active || L.t0 >= 0 || !(durMs > 0) || !Number.isFinite(startMs)) return;
    L.t0 = startMs; L.durMs = durMs;
  }

  aetherFlow(from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number }, progress: AetherProgress): void {
    const app = this.app, ae = this.aether;
    if (!app || !ae || this.destroyed) { progress(1, true); return; }
    this.cacheRect();
    if (!this.rect.valid) { progress(1, true); return; }
    const sx = app.screen.width / this.rect.w, sy = app.screen.height / this.rect.h;
    this.aetherUnit = Math.max(0.2, stageScale() * sx);
    ae.emit((from.x - this.rect.l) * sx, (from.y - this.rect.t) * sy, from.w * sx, from.h * sy,
      (to.x - this.rect.l) * sx, (to.y - this.rect.t) * sy, this.aetherUnit, progress);
    this.wake();
  }

  aetherBurst(): void {
    // nothing in the scene: the card aura is card-shaped, so behind the round gem it read as a square, off centre
    // (owner 2026-11-25). The medallion's own rings (AetherTally.tsx) are centred on the gem by construction.
  }

  showSummary(spots: readonly SummarySpot[]): void {
    const v = this.v, app = this.app;
    if (!v || !app || this.destroyed) return;
    this.summaryOn = true;
    // the opening's own pieces leave the stage
    v.pack.visible = false; v.flipLayer.visible = false; v.burst.visible = false;
    this.flip.active = false; this.land.active = false; this.burst.active = false;
    this.cacheRect();
    const auras = [this.auraFace, this.auraPile];
    for (let i = 0; i < auras.length; i++) {
      const a = auras[i], s = spots[i];
      if (!a) continue;
      if (!s || !this.rect.valid) { a.off(); if (i === 0) this.faceAmbient = 0; else this.pileAmbient = 0; continue; }
      const sx = app.screen.width / this.rect.w, sy = app.screen.height / this.rect.h, k = v.root.scale.x;
      a.setRarity(s.rarity);
      a.tier = Math.max(0, COSMETIC_RARITIES.indexOf(s.rarity));
      a.place(((s.x - this.rect.l) * sx - v.root.x) / k, ((s.y - this.rect.t) * sy - v.root.y) / k, (s.h * sy) / k);
      a.level = 0;
      const amb = Math.max(0.3, FACE_AMBIENT[s.rarity]) * (i === 0 ? 1 : 0.8);
      if (i === 0) this.faceAmbient = amb; else this.pileAmbient = amb;
      const burst = AURA_BURST[s.rarity] * 0.42; // a small burst: the row is close-packed
      if (burst > 0) a.fireBurst(burst);
    }
    this.wake();
  }

  setSpeed(mult: number): void {
    this.speed = Number.isFinite(mult) ? clamp(mult, 0.05, 4) : 1;
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
    this.v = null;
    this.tex = null;
    if (!app) return; // pre-init: init()'s "still wanted?" check destroys the late Application
    const canvas = app.canvas;
    canvas.removeEventListener('pointerenter', this.onEnter);
    canvas.removeEventListener('pointerleave', this.onLeave);
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onUp);
    canvas.removeEventListener('lostpointercapture', this.onUp);
    app.renderer.off('resize', this.layout);
    app.ticker.remove(this.tick);
    app.ticker.stop();
    for (const t of this.textures) t.destroy(true);
    this.textures = [];
    destroyPixiApp(app); // never releases Pixi's shared global pools (pixiAppSafety.ts)
  }

  private wake(): void {
    const app = this.app;
    if (app && !this.destroyed && !app.ticker.started) app.ticker.start();
  }

  private emit(name: string, fn: () => void): void {
    try { fn(); } catch (e) { console.error(`[packScene] ${name} handler threw:`, e); }
  }

  /**
   * Fit the pack (and the zoomed stack) to the host; the pack centred, the zoomed stack at `REVEAL_STACK_X` so the face
   * can land at `REVEAL_FACE_X` beside it. Runs on every renderer resize, so the stack follows the host.
   */
  private readonly layout = (): void => {
    const app = this.app, v = this.v;
    if (!app || !v) return;
    const w = app.screen.width, h = app.screen.height;
    const k = sealedPackScale(w, h);
    v.root.scale.set(k);
    v.root.x = Math.round(w / 2 - (W / 2) * k);
    v.root.y = Math.round(h / 2 - (PACK_BASE_SIZE.h / 2) * k);
    if (this.stage) {
      this.stage.mesh.position.set(w / 2, h / 2); this.stage.mesh.scale.set(w / 2, h / 2);
      this.stage.u.uAspect = w / Math.max(1, h);
    }
    this.zoomTx = (REVEAL_STACK_X * w - v.root.x) / k;
    this.zoomCx = (0.5 * w - v.root.x) / k;
    this.zoomTy = (REVEAL_Y * h - v.root.y) / k;
    if (this.zoom !== 0 || this.zoomV !== 0) this.placeZoomedStack();
    this.rect.valid = false;
    if (!app.ticker.started) app.render();
  };

  /**
   * The stack along its zoom: from its rest in the sleeve to dead centre, with the spring's overshoot; then, from the
   * first flip, aside to the reveal spot (`REVEAL_STACK_X`) so the revealed pile has room on the right.
   */
  private placeZoomedStack(): void {
    const v = this.v;
    if (!v) return;
    const e = Math.min(1.2, this.zoom);
    const tx = this.zoomCx + (this.zoomTx - this.zoomCx) * this.side;
    v.cardsC.x = W / 2 + (tx - W / 2) * e;
    v.cardsC.y = CARDS_Y + (this.zoomTy - CARDS_Y) * e;
  }

  // ---------------------------------------------------------------- the shell's calls

  setBacks(backs: readonly PackBack[] | null): void {
    this.backs = backs ? backs.slice() : null;
    if (!this.v) return; // applied at build
    // the top card is showing (the strip has started to come off): crossfade with a shimmer; otherwise swap
    this.showTop(this.tear.started);
  }

  flipTop(toScreen: { x: number; y: number }): boolean {
    const v = this.v, app = this.app;
    if (!v || !app || !this.zoomed || this.flip.active || this.flipped >= this.n || this.reset.active) return false;
    this.cacheRect();
    if (!this.rect.valid) return false;
    const idx = this.flipped;
    const card = v.cards[idx]!;
    this.sideOn = true; // the first reveal: the stack slides aside as the card flips out to the right
    const b = this.backs?.[idx];
    const f = this.flip;
    f.idx = idx;
    f.t = 0;
    f.dur = flipHalfMs(b?.rarity, !!b?.guaranteed) / FRAME_MS;
    f.lift = b?.guaranteed ? FLIP_LIFT_GUARANTEED : FLIP_LIFT;
    f.scale = v.cardsC.scale.x;
    f.c0x = v.pack.x + v.cardsC.x + card.x * f.scale;
    f.c0y = v.pack.y + v.cardsC.y + card.y * f.scale;
    const sx = app.screen.width / this.rect.w, sy = app.screen.height / this.rect.h;
    f.tx = ((toScreen.x - this.rect.l) * sx - v.root.x) / v.root.scale.x;
    f.ty = ((toScreen.y - this.rect.t) * sy - v.root.y) / v.root.scale.y;
    f.ribbon = !!b?.guaranteed;
    // a click turns the card at once; whatever glow the hover built fades out through the turn (flipStep)
    const ts = this.tease;
    // (with the shader aura the light goes WITH the card; the painted glow would stay behind it, flat)
    this.teaseGlowOut = !this.auraFace && ts.live && v.glow.visible ? v.glow.alpha : 0;
    ts.live = false; ts.t = 0; ts.stage = -1; ts.level = 0;
    this.pilePressed = false;
    // the aura goes with the card: the tease's wisps (or a fresh charge) ride the turn, in the card's own colour
    const af = this.auraFace, ap = this.auraPile;
    if (af) {
      if (ap && ap.level > 0.02) af.copyFrom(ap); else { af.level = 0; }
      af.burstT = -1;
      ap?.off();
      if (b) { af.setRarity(b.rarity); af.tier = Math.max(0, COSMETIC_RARITIES.indexOf(b.rarity)); } else af.level = 0;
      this.faceAmbient = 0;
      this.land.active = false;
    }
    this.beginFlip();
    return true;
  }

  /** The turn itself (the flip's first half): the card leaves the stack as the flipper, and the next card comes up. */
  private beginFlip(): void {
    const v = this.v;
    if (!v) return;
    const f = this.flip, idx = f.idx;
    const card = v.cards[idx]!;
    const b = this.backs?.[idx];
    f.active = true;
    f.t = 0;
    v.flipper.texture = this.xf.active ? v.fade.texture : card.texture; // mid-crossfade: the back it is becoming
    v.flipper.visible = true;
    v.flipRibbon.visible = f.ribbon;
    card.visible = false;
    this.xf.active = false;
    v.fade.visible = false;
    v.flash.visible = false;
    v.flash.tint = 0xffffff; // the tease may have tinted it
    this.setFlipCorners(0);
    // the next card comes up under it
    this.flipped = idx + 1;
    const gx = v.glow.x, gy = v.glow.y;
    this.showTop(true);
    // the tease's glow stays where the card was and fades out as it turns away (flipStep)
    if (this.teaseGlowOut > 0) {
      v.glow.position.set(gx, gy);
      v.glow.alpha = this.teaseGlowOut;
      v.glow.visible = true;
    }
    this.sounds.flip(b?.rarity ?? 'common', !!b?.guaranteed);
    this.wake();
  }

  /** Is (x, y) (root units) on the pile's top card? Writes the card's centre to `pileC`. Arithmetic only. */
  private pileHit(x: number, y: number): boolean {
    const v = this.v;
    if (!v || !this.zoomed || this.flipped >= this.n) return false;
    const i = this.flipped, s = v.cardsC.scale.x;
    const cx = v.pack.x + v.cardsC.x + cardRestX(i) * s, cy = v.pack.y + v.cardsC.y + cardRestY(i) * s;
    this.pileC.x = cx; this.pileC.y = cy;
    return Math.abs(x - cx) <= (CARD_W / 2) * s && Math.abs(y - cy) <= (CARD_H / 2) * s;
  }

  /** Is the pointer (mouse / pen; touch has no hover) resting on the pile's top card? */
  private overPile(): boolean {
    return this.hoverOn && this.pileHit(this.hoverPt.x, this.hoverPt.y);
  }

  /**
   * One frame of the tease. While the pointer rests on the pile's top card, the aura behind it climbs the rarity ladder
   * to the card's own colour and holds there; the card pops as each step lands (with its sound) and wobbles a little
   * more each step; from Legendary up it trembles and beats like a heart while it is held. When the pointer leaves, it
   * all eases away and the next hover builds again. The card itself is posed by `pileStep` (this only says how much).
   * Only colours change at a step; alpha, scale and uniforms per frame. A click turns the card whatever this is doing.
   */
  private teaseStep(dt: number, feel: PackFeel): void {
    const v = this.v, tex = this.tex;
    const ts = this.tease, aura = this.auraPile;
    this.teasePopV = 0; this.teaseRotV = 0;
    if (!v || !tex) return;
    const idx = this.flipped;
    const card = v.cards[idx], b = this.backs?.[idx];
    const dur = b ? teaseFrames(b.rarity, feel.tease) : 0;
    // (never while a card is turning or its face is still landing: one reveal at a time holds the eye)
    const on = dur > 0 && !!card && !this.flip.active && !this.land.active && !this.reset.active && this.overPile();
    if (!ts.live) {
      if (!on) return;
      ts.live = true; ts.t = 0; ts.idx = idx; ts.stage = -1; ts.level = 0; this.beatT = 0;
    }
    if (!card || !b || ts.idx !== idx) { // the card under the tease is gone (a reset): drop it
      ts.live = false; ts.level = 0; v.glow.visible = false; aura?.off();
      return;
    }
    if (on) ts.t = Math.min(dur, ts.t + dt);
    ts.level += ((on ? 1 : 0) - ts.level) * Math.min(1, 0.22 * dt);
    if (!on && ts.level < 0.02) {
      v.glow.visible = false; aura?.off();
      if (!this.xf.active) v.flash.visible = false;
      v.flash.tint = 0xffffff;
      ts.live = false; ts.level = 0;
      return;
    }
    const at = teaseAt(b.rarity, ts.t, feel.tease, this.teaseOut);
    const r = teaseRarityAt(at.stage);
    this.pileHit(0, 0); // refresh the pile's centre (the stack may be sliding aside)
    if (at.stage !== ts.stage) {
      ts.stage = at.stage;
      const ancient = r === 'ancient';
      v.glow.texture = ancient ? tex.glowAncient : tex.glowWhite;
      v.glow.tint = ancient ? 0xffffff : rarityTint(r);
      v.glow.position.set(cardRestX(idx), cardRestY(idx));
      v.glow.visible = true;
      aura?.setRarity(r);
      this.beatT = 0;
      this.sounds.tease(at.stage);
      v.flash.tint = ancient ? 0xffffff : rarityTint(r);
    }
    // the light inside shows on the card's own back too: a tinted glare that breathes (never during a back crossfade)
    if (!this.xf.active) {
      v.flash.visible = true;
      v.flash.position.set(cardRestX(idx), cardRestY(idx));
      v.flash.alpha = (0.04 + 0.025 * at.stage) * ts.level * (0.6 + 0.4 * Math.sin(this.time * 0.21)) + 0.1 * this.pile.beat * ts.level;
    }
    // the heartbeat of a held big tease
    const every = teaseBeatFrames(at.stage);
    if (on && every > 0 && ts.t >= dur) {
      this.beatT += dt;
      if (this.beatT >= every) { this.beatT = 0; this.pile.beat = 1; this.sounds.heartbeat(at.stage); }
    }
    const beat = this.pile.beat, knob = Math.min(1, feel.cardGlow);
    // with the shader aura the painted glow is only its soft bed
    v.glow.alpha = teaseGlowAlpha(at.stage, at.k) * knob * ts.level * (aura ? 0.6 : 1);
    v.glow.scale.set((CARD_GLOW_TIERS[r].size / TEX_RES) * (teaseGlowPop(at.k) + 0.07 * beat));
    if (aura) {
      aura.tier = at.stage;
      aura.level = Math.min(1, teaseAuraLevel(at.stage, at.k) * knob * ts.level + 0.22 * beat * ts.level);
      aura.place(this.pileC.x, this.pileC.y, CARD_H * FACE_PLATE_H * v.cardsC.scale.x); // the VISIBLE plate, not the art box
    }
    this.teasePopV = teasePop(at.stage, at.k) * ts.level;
    this.teaseRotV = teaseTremble(at.stage, this.time) * ts.level;
  }

  /**
   * The pile under the hand (packPile.ts), and the ONE place the top card is posed: it lifts and leans toward a resting
   * pointer, sinks under a press, and takes the tease's pop and tremble on top. Runs every frame once the stack has zoomed.
   */
  private pileStep(dt: number, feel: PackFeel): void {
    const v = this.v;
    if (!v) return;
    if (this.cardSX === 0) { const c0 = v.cards[this.n - 1]!; this.cardSX = c0.scale.x; this.cardSY = c0.scale.y; }
    this.teaseStep(dt, feel);
    const idx = this.flipped, card = v.cards[idx];
    const over = !this.reset.active && this.overPile();
    let nx = 0, ny = 0;
    if (over) {
      const s = v.cardsC.scale.x;
      nx = (this.hoverPt.x - this.pileC.x) / ((CARD_W / 2) * s);
      ny = (this.hoverPt.y - this.pileC.y) / ((CARD_H / 2) * s);
    }
    const p = pileEase(this.pile, over, this.pilePressed && !!card, nx, ny, dt);
    if (!card) return;
    const k = pileScale(p) + this.teasePopV;
    card.scale.set(this.cardSX * k, this.cardSY * k);
    card.rotation = p.lx * PILE_LEAN_RAD * p.lift + this.teaseRotV;
    card.x = cardRestX(idx) + p.lx * PILE_LEAN_PX * p.lift;
    card.y = cardRestY(idx) + p.ly * PILE_LEAN_PX * p.lift - PILE_RISE_PX * p.lift;
    if (v.ribbon.visible) {
      // THE SEAL: it is stamped onto the card as that card comes to the top (large and turned, then down onto the
      // card), and breathes a little there; it rides the card's pose.
      if (this.sealT < 1) this.sealT = Math.min(1, this.sealT + dt / SEAL_STAMP_FRAMES);
      const e = 1 - Math.pow(1 - this.sealT, 3);
      const size = (1 + SEAL_STAMP * (1 - e)) * (1 + SEAL_PULSE * Math.sin(this.time * SEAL_PULSE_RATE) * e);
      v.ribbon.position.set(card.x, card.y + RIBBON_DY * k);
      v.ribbon.rotation = card.rotation - SEAL_TURN * (1 - e);
      v.ribbon.scale.set((k * size) / TEX_RES);
    }
    if (v.fade.visible) { v.fade.position.copyFrom(card.position); v.fade.rotation = card.rotation; }
  }

  /**
   * The presentation shaders' frame (packFx.ts). The stage follows the pack, then the pile; the wrapper is heard to crinkle where the
   * hand is and remembers it; light spills from the opening and from the sleeve's mouth; the top card back shimmers.
   * Uniforms only.
   */
  private fxStep(dt: number): void {
    const v = this.v, app = this.app;
    if (!v || !app) return;
    const sec = this.time / 60, k = v.root.scale.x;
    const w = Math.max(1, app.screen.width), h = Math.max(1, app.screen.height);
    const sealed = this.phase === 'peel' && !this.tear.started;
    const sl = this.sleeve;

    // THE STAGE: its light follows the pack, then the pile
    const st = this.stage;
    if (st) {
      const fx = this.zoom > 0 ? v.pack.x + v.cardsC.x : W / 2;
      const fy = this.zoom > 0 ? v.pack.y + v.cardsC.y : (H + BODY_H) / 2;
      const tx = this.summaryOn ? 0 : ((v.root.x + fx * k) / w) * 2 - 1;
      const ty = this.summaryOn ? -0.2 : ((v.root.y + fy * k) / h) * 2 - 1;
      const f = this.focus;
      if (!this.focusSet) { f.x = tx; f.y = ty; this.focusSet = true; }
      const e = Math.min(1, 0.12 * dt);
      f.x += (tx - f.x) * e; f.y += (ty - f.y) * e;
      // brightest while the pack is being opened, calmer once the cards are out
      const energyTo = this.summaryOn ? 0.5 : sealed ? 0.34 + 0.1 * Math.sin(this.time * 0.03) : this.phase === 'peel' || this.phase === 'sleeve' ? 0.75 : 0.18;
      this.stageEnergy += (energyTo - this.stageEnergy) * Math.min(1, 0.06 * dt);
      this.stageWash *= Math.pow(0.968, dt);
      if (this.stageWash < 0.003) this.stageWash = 0;
      const u = st.u;
      u.uTime = sec; u.uEnergy = this.stageEnergy; u.uWash = this.stageWash; u.uFocus[0] = f.x; u.uFocus[1] = f.y;
    }

    // THE WRAPPER UNDER THE HAND: where it is held, how hard, and how crumpled it has become
    const hd = this.handling;
    let gripTo = 0, gx = hd.px, gy = hd.py;
    if (this.phase === 'peel' && !this.flying) {
      if (this.tear.started) {
        if (this.tearHeld) { gripTo = 0.85; gx = this.tear.T / W; gy = 0.03; }
      } else if (this.hoverOn && this.hoverPt.x > 0 && this.hoverPt.x < W && this.hoverPt.y > H && this.hoverPt.y < H + BODY_H) {
        gripTo = this.packPressed ? 1 : 0.3;
        gx = this.hoverPt.x / W; gy = (this.hoverPt.y - H) / BODY_H;
      }
    } else if (this.phase === 'sleeve') {
      if (sl.falling) hd.wear += (0.8 - hd.wear) * Math.min(1, 0.08 * dt); // it crumples as it falls away
      else if (this.sleeveHeld) { gripTo = 1; gx = 0.5; gy = Math.max(0.05, Math.min(0.95, (this.grabY - H) / BODY_H)); }
    }
    const worked = stepHandling(hd, gripTo, gx, gy, dt);
    if (worked > 0.0004) this.sounds.handle(worked * 9);
    const sqz = this.squeeze;
    const sqTo = this.packPressed && sealed ? 1 : 0;
    sqz.a += (sqTo - sqz.a) * Math.min(1, 0.3 * dt);
    if (Math.abs(sqTo - sqz.a) < 0.002) sqz.a = sqTo;
    if (sqTo > 0) sqz.y = Math.max(220, (this.hoverPt.y - H) * TEX_RES);
    if (sealed && sqz.a !== this.bodyKey.sq) this.syncBody(false);
    // the wrapper's highlights (cut to the art): the plain meshes' levels, and the band's place
    const so = this.sheenOv, go = this.glossOv;
    if (so) { so.mesh.alpha = v.sheen.alpha; so.mesh.visible = v.sheen.alpha > 0.002; }
    if (go) {
      go.mesh.alpha = v.gloss.alpha; go.mesh.visible = v.gloss.alpha > 0.002;
      const b = this.band, ub = go.u.uBand;
      ub[0] = b.centre; ub[1] = Math.max(0.001, b.halfWidth); ub[2] = b.slope; ub[3] = b.cy;
    }

    // THE LIGHT INSIDE: out of the opening as the strip comes off, out of the sleeve's mouth as the cards slide out
    const sp = this.spill;
    if (sp) {
      const opening = this.phase === 'peel' && this.tear.started;
      const mouth = this.phase === 'sleeve' && !sl.falling;
      const to = opening || mouth ? 1 : 0;
      this.spillLevel += (to - this.spillLevel) * Math.min(1, (to ? 0.12 : 0.07) * dt);
      if (this.spillLevel < 0.004 && !to) this.spillLevel = 0;
      const on = this.spillLevel > 0;
      sp.mesh.visible = on;
      if (on) {
        // the light sits ON the wrapper's open end: it rides the sleeve, and trails with its rim exactly as the torn lip does
        const lineY = H + (this.phase === 'peel' ? 0 : sl.dy - sl.lag);
        // the light climbs all the way to the top of the screen, fading the whole way
        const reach = Math.max(SPILL_MIN_REACH, lineY + v.root.y / k);
        const hw = ((W / 2) / SPILL_PACK_HALF) * (1 - this.rimPinch), hh = reach / (1 + SPILL_LINE_V);
        sp.mesh.position.set(W / 2, lineY - SPILL_LINE_V * hh);
        sp.mesh.scale.set(hw, hh);
        const u = sp.u;
        u.uTime = sec; u.uOpen = opening ? Math.min(1, this.tear.T / W) : 1;
        u.uReach = reach; u.uLineY = lineY;
        u.uLine = reach / 2.4; // a hot line about 2.4 units thick, however far the light reaches
        u.uLevel = this.spillLevel * (0.6 + 0.4 * this.packTier.size / PACK_GLOW_TIERS.ancient.size);
      }
    }

    // THE BACK SHEEN: on the stack's top card once the cards are out
    const sh = this.sheen;
    if (sh) {
      const card = this.phase === 'peel' ? undefined : v.cards[this.flipped];
      const to = card && card.visible ? 1 : 0;
      this.sheenLevel += (to - this.sheenLevel) * Math.min(1, 0.1 * dt);
      const on = !!card && this.sheenLevel > 0.01;
      sh.mesh.visible = on;
      const lg = v.backLogo, lw = lg.texture.width;
      lg.visible = on && lw > 1;
      if (on && card) {
        const ks = this.cardSX !== 0 ? card.scale.x / this.cardSX : 1;
        sh.mesh.position.copyFrom(card.position);
        sh.mesh.rotation = card.rotation;
        sh.mesh.scale.set((CARD_W / 2) * ks, (CARD_H / 2) * ks);
        // the logo over the sheen: exactly on the painted one (the window's centre, a hair under the card's)
        if (lg.visible) {
          const r = card.rotation, dy = BACK_LOGO.dy * ks;
          lg.position.set(card.position.x - Math.sin(r) * dy, card.position.y + Math.cos(r) * dy);
          lg.rotation = r;
          lg.scale.set((BACK_LOGO.w * ks) / lw);
        }
        const u = sh.u, p = this.pile;
        u.uTime = sec; u.uLevel = this.sheenLevel; u.uAim[0] = p.lx * p.lift; u.uAim[1] = p.ly * p.lift;
      }
    }
  }

  /** The auras' frame: the face aura follows its face to the slot and settles to its ambient level; uniforms written. */
  private auraStep(dt: number): void {
    const af = this.auraFace, ap = this.auraPile;
    const sec = dt / 60, time = this.time / 60;
    if (af) {
      const L = this.land;
      if (L.active) {
        // the DOM face's own curves: it travels on MOVE_EASE and turns from edge-on to flat on TURN_EASE, with the same
        // perspective; the aura takes the same pose every frame. It reads the face's OWN clock (the document timeline,
        // from the transition's real start): the face mounts a frame or two after the edge, so a clock started at the
        // edge ran ahead of it. Until the face reports, the aura waits edge-on; a face that never reports (no scene
        // handoff) lets the aura run on the scene's clock after a short wait.
        let u: number;
        if (L.t0 >= 0) u = Math.min(1, Math.max(0, (timelineNow() - L.t0) / L.durMs));
        else if ((L.wait += dt) < LAND_WAIT_FRAMES) u = 0;
        else { L.t += dt; u = Math.min(1, L.t / L.dur); }
        const e = faceMoveEase(u);
        const hh = L.h0 + (L.h1 - L.h0) * e;
        if (u >= 1) { L.active = false; af.place(L.x1, L.y1, L.h1); }
        else {
          af.placeTurned(L.x0 + (L.x1 - L.x0) * e, L.y0 + (L.y1 - L.y0) * e, hh, -(Math.PI / 2) * (1 - faceTurnEase(u)),
            FLIP_PERSPECTIVE_PER_WIDTH * (hh / FACE_PLATE_H) * (CARD_W / CARD_H));
        }
      }
      if (!this.flip.active) {
        af.level += (this.faceAmbient - af.level) * Math.min(1, 0.045 * dt);
        if (Math.abs(this.faceAmbient - af.level) < 0.004) af.level = this.faceAmbient;
      }
      af.update(sec, time);
    }
    if (ap && this.summaryOn) {
      ap.level += (this.pileAmbient - ap.level) * Math.min(1, 0.045 * dt);
      if (Math.abs(this.pileAmbient - ap.level) < 0.004) ap.level = this.pileAmbient;
    }
    ap?.update(sec, time);
  }

  quickOpen(): void {
    if (this.destroyed) return;
    if (!this.v) { this.pendingQuick = true; return; }
    if (this.reset.active || this.quick.active || this.phase === 'zoom' || this.phase === 'end') return;
    if (this.phase === 'sleeve' && this.sleeve.falling) return;
    this.releaseHolds();
    this.tiltLocked = true; // opening: the tilt eases flat and stays flat
    const total = Math.max(1, getPackFeel().quickOpenMs / FRAME_MS);
    const q = this.quick;
    q.active = true;
    q.t = 0;
    q.tearDur = total * 0.45;
    q.sleeveDur = total * 0.35;
    q.T0 = this.tear.T;
    q.sleeveStart = 0;
    q.dy0 = 0;
    q.want = 0;
    this.wake();
  }

  resetSealed(): void {
    if (this.destroyed) return;
    this.pendingQuick = false;
    this.backs = null;
    if (!this.v) return; // still sealed
    this.releaseHolds();
    this.quick.active = false;
    this.sounds.silence();
    const r = this.reset;
    r.active = true;
    r.t = 0;
    r.swapped = false;
    this.wake();
  }

  setInputEnabled(on: boolean): void {
    this.inputOn = on;
    if (!on) this.releaseHolds();
  }

  // ---------------------------------------------------------------- state

  /** Back to a fresh sealed pack (init and resetSealed's swap). */
  private resetState(): void {
    const v = this.v;
    if (!v) return;
    this.phase = 'peel';
    this.tear = newTear();
    this.sleeve = newSleeve();
    this.prevT = this.tear.T; this.sparkDebt = 0;
    this.shake = 0;
    this.popFired = false;
    this.flying = false;
    this.sleeveRot = 0;
    this.zoom = 0;
    this.zoomV = 0;
    this.zoomed = false;
    this.side = 0;
    this.sideOn = false;
    this.glowReveal = 0;
    this.packGlowFade = 1;
    v.packGlow.visible = true;
    this.flipped = 0;
    this.flip.active = false;
    this.tease.live = false; this.tease.level = 0; this.tease.t = 0; this.tease.stage = -1;
    this.teaseGlowOut = 0;
    this.auraPile?.off(); this.auraFace?.off();
    this.summaryOn = false; this.pileAmbient = 0;
    v.pack.visible = true; v.flipLayer.visible = true;
    const hd = this.handling; hd.grip = 0; hd.wear = 0; hd.px = 0.5; hd.py = 0.5;
    this.haloFade = 1;
    this.packPressed = false; this.squeeze.a = 0; this.stageWash = 0; this.spillLevel = 0; this.sheenLevel = 0; this.focusSet = false;
    if (this.spill) this.spill.mesh.visible = false;
    if (this.sheen) this.sheen.mesh.visible = false;
    v.backLogo.visible = false;
    this.faceAmbient = 0; this.land.active = false;
    this.pilePressed = false;
    const pl = this.pile; pl.lift = 0; pl.press = 0; pl.lx = 0; pl.ly = 0; pl.beat = 0;
    if (this.cardSX !== 0) {
      for (let i = 0; i < this.n; i++) {
        const c = v.cards[i]!;
        c.scale.set(this.cardSX, this.cardSY); c.rotation = 0; c.position.set(cardRestX(i), cardRestY(i));
      }
    }
    v.ribbon.rotation = 0; v.fade.rotation = 0;
    this.xf.active = false;
    this.quick.active = false;
    this.burst.active = false;
    v.burst.visible = false;
    this.tearHeld = false;
    this.sleeveHeld = false;
    this.hasCursor = false;
    this.tiltLocked = false; // sealed again: the tilt comes back
    v.cardsC.visible = true;
    const flap = v.strip.view;
    flap.alpha = 1; flap.rotation = 0; flap.scale.set(1); flap.pivot.set(0, 0); flap.position.set(0, 0); flap.visible = true;
    v.pack.position.set(0, 0);
    v.sleeveFront.position.set(0, 0); v.sleeveFront.rotation = 0; v.sleeveFront.alpha = 1; v.sleeveFront.visible = true;
    v.sleeveBack.position.set(0, 0); v.sleeveBack.rotation = 0; v.sleeveBack.alpha = 1; v.sleeveBack.visible = true;
    v.lining.visible = true; v.lining.alpha = 1;
    v.lip.view.y = 0;
    v.lip.update(0);
    v.shadow.alpha = 0;
    v.sheen.alpha = 0;
    v.pinch.visible = true;
    v.cardsC.position.set(W / 2, CARDS_Y);
    v.cardsC.scale.set(CARD_IN_SLEEVE);
    this.bodyKey.rx = NaN; // the body meshes are rewritten (with the current tilt) on the next frame
    this.writeBody(false);
    v.flecks.clear();
    this.aether?.clear();
    v.flipper.visible = false;
    v.flipRibbon.visible = false;
    v.fade.visible = false;
    v.flash.visible = false;
    this.showTop(false);
    const feel = getPackFeel();
    v.strip.compute(this.tear.T, this.tear.hand, feel.peelAngle, feel.pinchTwist, feel.highlight, feel.perspective, this.time, this.surface);
  }

  /** Every card wears the one neutral back (owner 2026-11-24): a back never tells its rarity. */
  private backTex(): Texture {
    return this.tex!.plain;
  }

  /**
   * Dress the stack for the current top card: it shows the neutral back at full brightness (and the guaranteed ribbon),
   * every card under it the dimmed back. No glow at rest: the rarity glow belongs to the tease (`teaseStep`). `animated` crossfades the top back with a short shimmer.
   */
  private showTop(animated: boolean): void {
    const v = this.v, tex = this.tex;
    if (!v || !tex) return;
    const top = this.flipped;
    for (let i = 0; i < this.n; i++) {
      const c = v.cards[i]!;
      if (i < top) { c.visible = false; continue; }
      c.visible = true;
      if (!topBackVisible(i, top)) { c.texture = tex.plain; c.tint = DIM_TINT; }
    }
    const { glow, fade, flash, ribbon, cardsC } = v;
    if (top >= this.n) {
      glow.visible = false; ribbon.visible = false; fade.visible = false; flash.visible = false; this.xf.active = false;
      return;
    }
    const card = v.cards[top]!;
    card.tint = 0xffffff;
    const target = this.backTex();
    // the decorations sit around the top card in z order: glow under it, crossfade + shimmer + ribbon over it
    cardsC.removeChild(glow, fade, flash, ribbon);
    const at = cardsC.getChildIndex(card);
    cardsC.addChildAt(glow, at);
    cardsC.addChildAt(fade, at + 2);
    cardsC.addChildAt(flash, at + 3);
    cardsC.addChildAt(ribbon, at + 4);
    glow.position.copyFrom(card.position);
    fade.position.copyFrom(card.position);
    flash.position.copyFrom(card.position);
    ribbon.position.set(card.x, card.y + RIBBON_DY);
    const b = this.backs?.[top];
    glow.visible = false; // at rest a back gives nothing away; the tease lights it
    const sealed = !!b?.guaranteed;
    if (sealed && !ribbon.visible) { this.sealT = 0; this.sounds.stamp(); } // the seal is stamped on as this card comes up
    ribbon.visible = sealed;
    if (animated && card.texture !== target) {
      fade.texture = target;
      fade.width = CARD_W; fade.height = CARD_H;
      fade.alpha = 0; fade.visible = true;
      flash.alpha = 0; flash.visible = true;
      this.xf.active = true;
      this.xf.t = 0;
      this.glowFade = 0;
      ribbon.alpha = 0;
      this.wake();
    } else {
      card.texture = target;
      fade.visible = false; flash.visible = false;
      this.xf.active = false;
      this.glowFade = 1;
      ribbon.alpha = 1;
    }
  }

  // ---------------------------------------------------------------- input

  private cacheRect(): void {
    const app = this.app;
    if (!app) return;
    const r = app.canvas.getBoundingClientRect();
    this.rect.l = r.left; this.rect.t = r.top; this.rect.w = r.width; this.rect.h = r.height;
    this.rect.valid = r.width > 0 && r.height > 0;
  }

  /** A pointer event's position in pack base units (written to `out`). False when there is no usable rect. */
  private toPack(e: PointerEvent, out: Pt): boolean {
    const app = this.app, v = this.v;
    if (!app || !v) return false;
    if (!this.rect.valid) this.cacheRect(); // only after a resize invalidated it, never per frame
    if (!this.rect.valid) return false;
    const sx = app.screen.width / this.rect.w, sy = app.screen.height / this.rect.h;
    out.x = ((e.clientX - this.rect.l) * sx - v.root.x) / v.root.scale.x;
    out.y = ((e.clientY - this.rect.t) * sy - v.root.y) / v.root.scale.y;
    return true;
  }

  /** The held corner of the strip on the pack plane (written to `out`). */
  private edgeScreen(out: Pt): Pt {
    const h = this.tear.hand;
    return projInto(out, h.x, h.y, h.z, getPackFeel().perspective);
  }

  private inSleeveGrab(p: Pt, pad: number): boolean {
    const dy = this.sleeve.dy;
    return !this.sleeve.falling && p.x > -pad && p.x < W + pad && p.y > H + dy + 24 && p.y < H + dy + BODY_H;
  }

  private setCursor(c: string): void {
    const app = this.app;
    if (app && app.canvas.style.cursor !== c) app.canvas.style.cursor = c;
  }

  private readonly onEnter = (): void => { this.cacheRect(); };

  /** The pointer left the stage: the tilt and the gloss ease back to rest. */
  private readonly onLeave = (): void => { this.hoverOn = false; this.pilePressed = false; this.packPressed = false; };

  /** A mouse / pen position over the stage, for the sealed tilt and the gloss (touch has no hover). */
  private trackHover(e: PointerEvent): void {
    if (e.pointerType === 'touch' || !this.toPack(e, this.hoverPt)) return;
    aimInto(this.hoverAim, this.hoverPt.x, this.hoverPt.y, W, H + BODY_H);
    this.hoverOn = true;
    if (this.zoomed && this.overPile()) this.wake(); // the tease builds while the pointer rests on the pile
    if (this.phase === 'peel') this.wake(); // (the ticker runs throughout the peel today; this keeps the tilt live if that changes)
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.v || !this.app || !this.inputOn || this.quick.active || this.reset.active) return;
    if (this.tearHeld || this.sleeveHeld) return; // one hand at a time
    this.cacheRect();
    const p = this.pt;
    if (!this.toPack(e, p)) return;
    if (this.zoomed) {
      // a press on the pile: the top card sinks under it (the click that follows turns it)
      if (this.pileHit(p.x, p.y)) { this.pilePressed = true; this.sounds.press(); this.wake(); }
      return;
    }
    if (this.phase === 'sleeve') {
      if (!this.inSleeveGrab(p, 10)) return;
      this.sleeveHeld = true;
      this.grabY = p.y - this.sleeve.dy;
      this.curY = p.y;
    } else if (this.phase === 'peel') {
      if (this.tear.done || this.flying) return;
      const c = this.edgeScreen(this.pt2);
      // hit-test the corner where the tilt DRAWS it (the pinch ring), not where the flat pack has it
      if (!tiltedCornerHit(p.x, p.y, c.x, c.y, this.tiltPose, this.tear.started ? GRAB_R_STARTED : GRAB_R_SEALED, this.pt3)) {
        // not the corner: a press on the sealed wrapper squeezes it (its sides draw in, and it is heard to crinkle)
        if (!this.tear.started && p.x > 0 && p.x < W && p.y > H && p.y < H + BODY_H) {
          this.packPressed = true;
          this.sounds.squeeze();
          this.wake();
        }
        return;
      }
      this.tearHeld = true;
      this.tiltLocked = true; // the opening has begun: the tilt eases flat and stays flat
      // the hand lives in FLAT pack space: the pointer goes through the inverse tilt, so the corner stays under the
      // finger while the tilt eases flat (and exactly once it has)
      const f = untiltInto(this.pt3, p.x, p.y, this.tiltPose);
      this.grabOff.x = c.x - f.x; this.grabOff.y = c.y - f.y;
      this.cursor.x = p.x; this.cursor.y = p.y; // raw: the tear un-tilts it every frame at the CURRENT pose
      this.hasCursor = true;
    } else return;
    this.pointerId = e.pointerId;
    try { this.app.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    this.lastX = p.x; this.lastY = p.y; this.lastStamp = e.timeStamp;
    this.vel.x = 0; this.vel.y = 0;
    this.setCursor(CURSOR_HELD);
    e.preventDefault();
    this.wake();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.v || !this.app) return;
    this.trackHover(e);
    const held = this.tearHeld || this.sleeveHeld;
    if (!held) {
      if (!this.inputOn || this.quick.active || this.reset.active || e.pointerType === 'touch') return;
      const p = this.pt;
      if (!this.toPack(e, p)) return;
      let grab = false;
      if (this.phase === 'sleeve') grab = this.inSleeveGrab(p, 0);
      else if (this.phase === 'peel' && !this.tear.done && !this.flying) {
        const c = this.edgeScreen(this.pt2);
        grab = tiltedCornerHit(p.x, p.y, c.x, c.y, this.tiltPose, GRAB_R_SEALED, this.pt3);
      }
      this.setCursor(grab ? CURSOR_GRAB : '');
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    const p = this.pt;
    if (!this.toPack(e, p)) return;
    const dtf = Math.max(1, e.timeStamp - this.lastStamp) / 16.7;
    this.vel.x = ((p.x - this.lastX) / dtf) * 0.5 + this.vel.x * 0.5;
    this.vel.y = ((p.y - this.lastY) / dtf) * 0.5 + this.vel.y * 0.5;
    this.lastX = p.x; this.lastY = p.y; this.lastStamp = e.timeStamp;
    this.cursor.x = p.x; this.cursor.y = p.y;
    this.curY = p.y;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.pilePressed) { this.pilePressed = false; this.wake(); }
    this.packPressed = false;
    if (e.pointerId !== this.pointerId) return;
    this.releaseHolds();
  };

  /** Let go of whatever is held (the next tick's model step turns a sleeve release into a drop or a slide back). */
  private releaseHolds(): void {
    if (this.tearHeld) { this.tearHeld = false; releaseTear(this.tear); }
    this.sleeveHeld = false;
    this.pointerId = -1;
    this.setCursor('');
  }

  // ---------------------------------------------------------------- the beats

  private firePop(): void {
    if (this.popFired) return;
    this.popFired = true;
    this.shake = 4;
    this.handling.wear = Math.min(0.42, this.handling.wear + 0.08);
    this.sounds.pop();
    this.emit('onPop', () => this.events.onPop());
  }

  /** The strip ripped free: it flies off with the hand's velocity and the sleeve is live this instant. */
  private rip(): void {
    const v = this.v!;
    this.tear.done = true;
    this.tearHeld = false;
    this.flying = true;
    const c = v.strip.centroid(this.pt2);
    const flap = v.strip.view;
    flap.pivot.set(c.x, c.y);
    flap.position.set(c.x, c.y);
    this.fv.x = clamp(this.vel.x * 0.9 + 6, 4, 22);
    this.fv.y = Math.min(-6, this.vel.y * 0.9 - 9);
    this.fv.r = 0.05 + Math.random() * 0.05;
    this.shake = 7;
    this.sounds.rip();
    this.handling.wear = Math.min(0.42, this.handling.wear + 0.1);
    v.flecks.spawn(10, W - 4, H); // a few more as the strip lets go (the line has already shed its own)
    this.phase = 'sleeve';
    v.cardsC.visible = true; v.sleeveBack.visible = true; // never left hidden by the tilt (see tick)
    this.setCursor('');
    this.emit('onStripFree', () => this.events.onStripFree());
  }

  private onDrop(): void {
    this.sleeveHeld = false;
    this.rotDir = Math.random() < 0.5 ? -1 : 1;
    this.shake = 3;
    this.sounds.drop();
    this.sounds.slide(0);
    this.setCursor('');
    this.emit('onSleeveDropped', () => this.events.onSleeveDropped());
  }

  // ---------------------------------------------------------------- the frame

  private readonly tick = (tk: Ticker): void => {
    const v = this.v, app = this.app;
    if (!v || !app) return;
    const dt = Math.min(MAX_DT, tk.deltaTime) * this.speed;
    this.time += dt;
    const feel = getPackFeel(); // read every frame: the Pack Lab tunes live

    if (this.reset.active) {
      const r = this.reset;
      r.t += dt;
      if (!r.swapped) {
        v.root.alpha = Math.max(0, 1 - r.t / RESET_FADE);
        if (r.t < RESET_FADE) return; // frozen while it fades out: nothing fires
        this.resetState();
        r.swapped = true;
        r.t = 0;
        this.inputOn = true;
      } else {
        v.root.alpha = Math.min(1, r.t / RESET_FADE);
        if (r.t >= RESET_FADE) r.active = false;
      }
    }

    this.tiltStep(dt, feel);
    if (this.quick.active) this.quickStep(dt, feel);
    if (this.phase === 'peel' && !this.flying) this.peelStep(dt, feel);
    else if (this.flying) this.flyStep(dt);
    if (this.phase !== 'peel') this.sleeveStep(dt, feel);

    this.cardsStep(dt);
    this.packGlowStep(dt, feel);
    this.holoStep(feel);
    if (this.zoomed) this.pileStep(dt, feel);
    if (this.flip.active) this.flipStep(dt);
    if (this.burst.active) this.burstStep(dt, feel);
    this.auraStep(dt);
    this.fxStep(dt);
    v.flecks.step(dt);
    this.aether?.step(dt);

    if (this.shake > 0.05) {
      v.pack.x = (Math.random() - 0.5) * this.shake;
      v.pack.y = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.82, dt);
    } else { v.pack.x = 0; v.pack.y = 0; this.shake = 0; }

    // idle once the stack has zoomed and nothing moves (the render of this frame still runs)
    if (this.phase === 'end' && !this.flip.active && !this.tease.live && !this.overPile() && pileAtRest(this.pile) && !this.pilePressed
      && !this.auraFace?.live && !this.auraPile?.live && !this.xf.active && v.flecks.count === 0 && !this.aether?.count && this.shake === 0
      && (!this.sideOn || this.side === 1) && !this.reset.active && !this.flying && this.glowReveal === 1 && this.packGlowFade === 0
      && !this.burst.active && !this.stage) { // (a lit stage never stops: its dust keeps drifting)
      app.ticker.stop();
    }
  };

  /** The tear: the model step (or the quick open's script), sound, flecks, the strip mesh, the lip and the shadow. */
  private peelStep(dt: number, feel: PackFeel): void {
    const v = this.v!;
    const tear = this.tear;
    if (!this.quick.active) {
      const holding = this.tearHeld && this.hasCursor;
      if (holding) {
        // the finger in flat pack space at this frame's tilt (identity once settled), plus the grab offset
        const f = untiltInto(this.pt3, this.cursor.x, this.cursor.y, this.tiltPose);
        const u = unprojInto(this.pt2, f.x + this.grabOff.x, f.y + this.grabOff.y, tear.hand.z, feel.perspective);
        this.target.x = u.x;
        this.target.y = u.y;
        this.target.z = feel.edgeTowardCamera * Math.min(1, tear.T / 50);
      }
      this.tearInput.held = this.tearHeld;
      this.tearInput.target = holding ? this.target : null;
      const r = stepTear(tear, this.tearInput, feel, W, dt, this.time);
      if (r.popped) this.firePop();
    }

    // sound + flecks follow the tear speed
    const speed = Math.max(0, (tear.T - this.prevT) / Math.max(dt, 0.001));
    // (nothing sounds before the pop: the audio graph must not start before a user gesture)
    if (tear.started) { this.sounds.tear(tear.done ? 0 : speed); this.sounds.crackle(speed, dt); }
    // THE SPARKS FOLLOW THE TEAR LINE (owner 2026-11-25: "they kinda poof up in sections"): one for every so much foil torn,
    // each at its own place along the stretch torn this frame, never a clump at the tear's head. A fast tear sheds the same
    // sparks per inch as a slow one.
    if (tear.started && tear.T > this.prevT) {
      const from = this.prevT, len = tear.T - from;
      this.sparkDebt += len / (W / TEAR_SPARKS);
      const n = Math.floor(this.sparkDebt);
      if (n > 0) {
        this.sparkDebt -= n;
        for (let i = 0; i < n; i++) v.flecks.spawn(1, from + len * ((i + Math.random()) / n), H);
      }
    }
    this.prevT = tear.T;

    v.strip.compute(tear.T, tear.hand, feel.peelAngle, feel.pinchTwist, feel.highlight, feel.perspective, this.time, this.surface);
    this.syncBody(false);
    // the tilt warps the pack's front only: the back wall and the stack, hidden behind it while sealed, would peek past a
    // receding edge, so they sit out while it tilts (the sealed pack covers them anyway)
    const behind = this.tiltPose.flat || tear.started;
    if (v.sleeveBack.visible !== behind) v.sleeveBack.visible = behind;
    if (v.cardsC.visible !== behind) v.cardsC.visible = behind;
    const sh = v.strip.shadow;
    v.shadow.alpha = sh.alpha;
    if (sh.alpha > 0) { v.shadow.position.set(sh.x, sh.y); v.shadow.width = sh.w; v.shadow.height = sh.h; }
    v.lip.update(tear.T);

    // the sealed pack's idle shimmer and the pinch cue (opacity only); both go once the seal pops
    const sealed = !tear.started;
    v.sheen.alpha += ((sealed ? 0.3 + 0.2 * Math.sin(this.time * 0.035) : 0) - v.sheen.alpha) * Math.min(1, 0.2 * dt);
    v.pinch.visible = sealed && this.inputOn && !this.quick.active;
    if (v.pinch.visible) {
      const c = this.edgeScreen(this.pt2);
      c.x += 6; c.y += 6;
      if (!this.tiltPose.flat) tiltInto(c, c.x, c.y, 0, this.tiltPose);
      v.pinch.position.set(c.x, c.y);
      v.pinch.alpha = 0.45 + 0.4 * Math.sin(this.time * 0.09);
    }

    if (tear.done) this.rip();
  }

  /** The ripped strip flies off, spinning and fading. */
  private flyStep(dt: number): void {
    const v = this.v!;
    const flap = v.strip.view;
    flap.x += this.fv.x * dt; flap.y += this.fv.y * dt; this.fv.y += 0.55 * dt; flap.rotation += this.fv.r * dt;
    flap.scale.set(flap.scale.x + 0.006 * dt);
    flap.alpha = Math.max(0, flap.alpha - 0.012 * dt);
    v.shadow.alpha = Math.max(0, v.shadow.alpha - 0.05 * dt);
    v.sheen.alpha = Math.max(0, v.sheen.alpha - 0.05 * dt);
    // the pack's inside behind the strip goes with it, quickly (the tear takes the pack's top off)
    v.lining.alpha = Math.max(0, 1 - (1 - flap.alpha) * 4);
    if (v.lining.alpha <= 0) v.lining.visible = false;
    if (flap.alpha <= 0) { this.flying = false; flap.visible = false; v.lining.visible = false; }
  }

  /** The sleeve (model step + the body deform), its drop, and the stack's zoom spring. */
  private sleeveStep(dt: number, feel: PackFeel): void {
    const v = this.v!;
    const sl = this.sleeve;
    if (this.phase === 'sleeve') {
      const inp = this.sleeveInput;
      inp.held = this.sleeveHeld;
      inp.want = this.quick.active ? this.quick.want : Math.max(0, this.curY - this.grabY);
      inp.flickVy = this.vel.y;
      const wasFalling = sl.falling;
      const r = stepSleeve(sl, inp, feel, SLEEVE_CLEAR, dt);
      if (r.brokeFree) { this.shake = 2.5; this.sounds.sleeveFree(); }
      if (sl.falling && !wasFalling) this.onDrop();
      if (sl.falling) {
        this.sleeveRot += 0.0035 * sl.vy * dt * this.rotDir;
        const a = Math.max(0, 1 - Math.max(0, sl.dy - SLEEVE_CLEAR) / 420);
        v.sleeveFront.alpha = a; v.sleeveBack.alpha = a;
        if (sl.dy > SLEEVE_CLEAR && this.zoom === 0 && this.zoomV === 0) { this.zoomV = 0.02; this.sounds.whoosh(); }
        if (a <= 0) { this.phase = 'zoom'; v.sleeveFront.visible = false; v.sleeveBack.visible = false; }
      } else this.sounds.slide(this.sleeveHeld && sl.freed ? Math.abs(r.speed) : 0);
      this.writeBody(true);
      v.sleeveFront.y = sl.dy; v.sleeveBack.y = sl.dy;
      v.sleeveFront.rotation = this.sleeveRot; v.sleeveBack.rotation = this.sleeveRot;
      v.cardsC.y = CARDS_Y + sl.card;
    }
    if (this.zoomV !== 0 || this.zoom !== 0) {
      if (!this.zoomed) {
        // the freed stack springs toward the camera
        this.zoomV += (1 - this.zoom) * 0.11 * dt; this.zoomV *= Math.pow(0.8, dt); this.zoom += this.zoomV * dt;
        if (this.phase === 'zoom' && Math.abs(1 - this.zoom) < 0.003 && Math.abs(this.zoomV) < 0.002) {
          this.zoom = 1; this.zoomV = 0;
          this.phase = 'end';
          this.zoomed = true;
          this.emit('onZoomed', () => this.events.onZoomed());
        }
      }
      v.cardsC.scale.set(CARD_IN_SLEEVE + (stackZoomScale(feel.stackZoom) - CARD_IN_SLEEVE) * this.zoom);
      if (this.sideOn && this.side < 1) {
        // ease aside over about the first flip (smooth out, no overshoot)
        this.side += (1 - this.side) * (1 - Math.pow(1 - SIDE_EASE, dt));
        if (1 - this.side < 0.002) this.side = 1;
      }
      this.placeZoomedStack(); // zooms to dead centre, then slides aside from the first flip
    }
  }

  /** While sealed: rewrite the body meshes only when the tilt (or its depth) has changed since the last write. */
  private syncBody(deform: boolean): void {
    const k = this.bodyKey, t = this.tilt, D = this.tiltPose.D;
    if (k.rx === t.rx && k.ry === t.ry && k.D === D && k.sq === this.squeeze.a) return; // settled: nothing to write, the tilt idles
    this.writeBody(deform);
  }

  /**
   * The sleeve front, in place: squeezed in at the fingers and its rim trailing as it rubs the cards (`deform`, the
   * sleeve phase), then the sealed tilt (packTilt.ts) when it is not flat. The sheen and the gloss share the result, so
   * they stretch and tilt with it.
   */
  private writeBody(deform: boolean): void {
    const v = this.v!;
    const pos = v.body.geometry.positions, base = v.bodyBase;
    if (pos.length !== base.length) return;
    const sl = this.sleeve, pose = this.tiltPose, p = this.pt3;
    if (this.bodyFlat.length !== pos.length) this.bodyFlat = new Float32Array(pos.length); // once
    const flat = this.bodyFlat;
    const gy = (this.grabY - H) * TEX_RES;
    const half = (W * TEX_RES) / 2;
    const sq = this.squeeze, sqOn = !deform && sq.a > 0.001;
    for (let k = 0; k < pos.length; k += 2) {
      const bx = base[k]!, by = base[k + 1]!;
      let x = bx, y = by;
      if (sqOn) {
        // a squeeze on the sealed wrapper: its sides draw in a little around the hand
        const q = (by - sq.y) / 210;
        x = half + (bx - half) * (1 - 0.05 * sq.a * Math.exp(-(q * q)));
      }
      if (deform) {
        const above = gy > 0 ? Math.max(0, 1 - by / gy) : 0; // 1 at the rim, 0 at the fingers
        const q = (by - gy) / 170;
        const pinch = sl.pinch * Math.exp(-(q * q));
        x = half + (bx - half) * (1 - pinch); // squeezed in where you hold it
        y = by - sl.lag * 2 * above * above; // the rim trails, rubbing on the cards
      }
      flat[k] = x; flat[k + 1] = y; // the body before the tilt: the back wall follows this (it never tilts)
      if (!pose.flat) {
        tiltInto(p, x / TEX_RES, H + y / TEX_RES, 0, pose);
        x = p.x * TEX_RES;
        y = (p.y - H) * TEX_RES;
      }
      pos[k] = x;
      pos[k + 1] = y;
    }
    v.body.geometry.getBuffer('aPosition').update();
    const wp = v.wall.geometry.positions;
    if (wp.length === pos.length) { wallInto(wp, flat); v.wall.geometry.getBuffer('aPosition').update(); }
    const sp = v.sheen.geometry.positions, gp = v.gloss.geometry.positions;
    if (sp.length === pos.length) { sp.set(pos); v.sheen.geometry.getBuffer('aPosition').update(); }
    if (gp.length === pos.length) { gp.set(pos); v.gloss.geometry.getBuffer('aPosition').update(); }
    for (const ov of [this.sheenOv, this.glossOv]) {
      const og = ov?.mesh.geometry;
      if (og && og.positions.length === pos.length) { og.positions.set(pos); og.getBuffer('aPosition').update(); }
    }
    // the holo sheen rides the wrapper's own shape: tilt, squeeze and the sleeve's pinch alike
    const hg = v.holo?.body.geometry;
    if (hg && hg.positions.length === pos.length) { hg.positions.set(pos); hg.getBuffer('aPosition').update(); }
    // the torn lip follows the wrapper's open end: it trails with the rim, and narrows with it when the sleeve is pinched
    // near the top (owner 2026-11-24: "when pinching near the top, the edge doesnt connect to the edge of the bag")
    const rq = gy / 170;
    this.rimPinch = deform ? sl.pinch * Math.exp(-(rq * rq)) : 0;
    const lipK = (1 - this.rimPinch) * LIP_INSET;
    v.lip.view.scale.x = lipK;
    v.lip.view.x = (W / 2) * (1 - lipK);
    if (deform) v.lip.view.y = -sl.lag;
    this.bodyKey.rx = this.tilt.rx; this.bodyKey.ry = this.tilt.ry; this.bodyKey.D = pose.D; this.bodyKey.sq = sq.a;
  }

  /**
   * The sealed pack's mouse tilt (the drag dive's numbers, read live from dragFeel.ts) and the gloss band. The tilt's
   * target is flat once the opening has begun; the band follows the eased aim always. The gloss uvs are rewritten only
   * when the band moved.
   */
  private tiltStep(dt: number, feel: PackFeel): void {
    const v = this.v!;
    const df = getDragFeel();
    const sealed = this.phase === 'peel' && !this.tiltLocked;
    const ax = this.hoverOn ? this.hoverAim.x : 0, ay = this.hoverOn ? this.hoverAim.y : 0;
    // reaching for the tear corner settles the pack flat under the hand (packTilt.ts cornerCalm)
    let calm = 1;
    if (sealed && this.hoverOn) {
      const c = this.edgeScreen(this.pt4);
      calm = cornerCalm(this.hoverPt.x, this.hoverPt.y, c.x, c.y, CALM_NEAR, CALM_FAR);
    }
    tiltTargetInto(this.tiltTgt, ax, ay, df.tiltMax, feel.packTilt, sealed, calm);
    stepTilt(this.tilt, ax, ay, this.tiltTgt.rx, this.tiltTgt.ry, tiltEaseK(df.tiltEase, dt * FRAME_MS));
    // the drag dive's CSS perspective (stage px) in pack base units: the pack is drawn at root.scale px per unit
    const D = df.perspective / Math.max(0.05, v.root.scale.x);
    setTiltPose(this.tiltPose, this.tilt.rx, this.tilt.ry, W / 2, (H + BODY_H) / 2, D);
    const t = this.tilt;
    glossBandInto(this.band, feel.gloss, feel.glossSharpness, t.ax, t.ay, t.rx, t.ry, df.tiltMax, W, H + BODY_H);
    this.surface.gloss = feel.gloss;
    v.gloss.alpha = this.band.alpha;
    const gk = this.glossKey, b = this.band;
    if (gk.centre !== b.centre || gk.halfWidth !== b.halfWidth || gk.slope !== b.slope) {
      const base = v.bodyBase, uv = v.gloss.geometry.uvs;
      if (uv.length === base.length) {
        for (let k = 0; k < base.length; k += 2) {
          uv[k] = 0.5 + 0.5 * glossD(b, base[k]! / TEX_RES, H + base[k + 1]! / TEX_RES); // fixed to the wrapper: stretches with it
          uv[k + 1] = 0.5;
        }
        v.gloss.geometry.getBuffer('aUV').update();
      }
      gk.centre = b.centre; gk.halfWidth = b.halfWidth; gk.slope = b.slope;
    }
  }

  /** The quick open's scripted drag: the tear, then the sleeve. The drop and the zoom are the usual physics. */
  private quickStep(dt: number, feel: PackFeel): void {
    const q = this.quick, tear = this.tear;
    q.t += dt;
    if (this.phase === 'peel' && !this.flying) {
      if (!tear.started) { tear.started = true; this.firePop(); }
      const u = Math.min(1, q.t / q.tearDur), e = u * u * (3 - 2 * u);
      tear.T = Math.max(tear.T, q.T0 + (W - q.T0) * e);
      const h = tear.hand, T = tear.T;
      h.x = T * 1.45; h.y = -T * 0.3; h.z = Math.min(T * 0.5, feel.edgeTowardCamera); // within reach: |h - (T,0,0)| < T
      if (u >= 1) {
        tear.done = true;
        this.vel.x = 10; this.vel.y = -5; // the flap's throw
        q.sleeveStart = q.t;
      }
    } else if (this.phase === 'sleeve' && !this.sleeve.falling) {
      if (q.sleeveStart === 0) { q.sleeveStart = q.t; q.dy0 = this.sleeve.dy; } // the tear was done by hand
      this.sleeveHeld = true;
      this.grabY = H + BODY_H * 0.55;
      this.vel.y = 12;
      q.want = q.dy0 + ((q.t - q.sleeveStart) / q.sleeveDur) * SLEEVE_CLEAR * 1.4;
    } else if (this.sleeve.falling || this.phase === 'zoom' || this.phase === 'end') {
      q.active = false;
    }
  }

  /**
   * The sealed pack's aura: its tier's alpha (Epic and up breathe) x the `packGlow` knob, riding the sleeve, and fading
   * out once the sleeve drops so it never fights the stack. Hidden (and no longer touched) once faded.
   */
  private packGlowStep(dt: number, feel: PackFeel): void {
    const v = this.v!;
    const g = v.packGlow;
    if (!g.visible) return;
    const live = this.phase === 'peel' || (this.phase === 'sleeve' && !this.sleeve.falling);
    if (!live) this.packGlowFade = Math.max(0, this.packGlowFade - PACK_GLOW_FADE * dt);
    if (this.packGlowFade === 0) { g.visible = false; g.alpha = 0; return; }
    // once the strip is off, the halo (the SEALED pack's outline) no longer fits the wrapper: it bows out, and the
    // light from inside is the pack's glow from there on
    this.haloFade += ((this.phase === 'peel' && !this.flying ? 1 : 0) - this.haloFade) * Math.min(1, 0.12 * dt);
    // the halo is drawn at PACK_HALO of its strength (0: nothing shows past the wrapper's edge on any pack, owner
    // 2026-11-24: "reduce that on all card packs so its fully behind the card"); the stage pools the pack's colour behind it
    g.alpha = glowAlphaAt(this.packTier, this.time, feel.packGlow) * this.packGlowFade * this.haloFade * PACK_HALO;
    // its corners: the tier's size about the pack's centre (riding the sleeve), through the sealed tilt
    const s = this.packTier.size, hw = v.packGlowHalf.w * s, hh = v.packGlowHalf.h * s;
    const cx = W / 2, cy = (H + BODY_H) / 2 + (this.phase === 'peel' ? 0 : this.sleeve.dy);
    const c = this.glowCorners, p = this.pt3;
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const x = cx + (i === 1 || i === 2 ? hw : -hw), y = cy + (i >= 2 ? hh : -hh);
      if (this.tiltPose.flat) { p.x = x; p.y = y; } else tiltInto(p, x, y, 0, this.tiltPose);
      if (c[i * 2] !== p.x || c[i * 2 + 1] !== p.y) { c[i * 2] = p.x; c[i * 2 + 1] = p.y; changed = true; }
    }
    if (changed) g.setCorners(c[0]!, c[1]!, c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!);
  }

  /**
   * The pack's holo (packHoloMesh.ts): its strength (tier x the `holo` knob x the aura's fade, so it goes with the aura
   * as the sleeve drops) and its gradient offset (the eased aim, the tilt, the tear, the sleeve). Uniforms only; hidden
   * until the shine mask loads and once faded (the idle condition already waits for the aura's fade).
   */
  private holoStep(feel: PackFeel): void {
    const h = this.v!.holo;
    if (!h) return;
    const s = h.ready ? packHoloStrength(this.look, feel.holo) * this.packGlowFade : 0;
    const on = s > 0.001;
    if (h.body.visible !== on) { h.body.visible = on; h.strip.visible = on; }
    if (!on) return;
    const t = this.tilt, o = this.holoShift;
    holoShiftInto(o, t.ax, t.ay, t.rx, t.ry, this.tear.T / W, this.phase === 'peel' ? 0 : this.sleeve.dy);
    const u = h.uniforms;
    u.uStrength = s;
    u.uShift[0] = o.x;
    u.uShift[1] = o.y;
  }

  /** The top back's crossfade + shimmer (the rarity glow belongs to the tease, `teaseStep`). */
  private cardsStep(dt: number): void {
    const v = this.v!;
    const xf = this.xf;
    if (xf.active) {
      xf.t += dt;
      const p = Math.min(1, xf.t / XFADE);
      v.fade.alpha = p;
      v.flash.alpha = Math.sin(Math.PI * p) * 0.55;
      this.glowFade = p;
      v.ribbon.alpha = p;
      if (p >= 1) {
        xf.active = false;
        const card = v.cards[this.flipped];
        if (card) card.texture = v.fade.texture;
        v.fade.visible = false;
        v.flash.visible = false;
      }
    }
    const reveal = this.phase === 'zoom' || this.phase === 'end' || this.sleeve.falling ? 1 : 0;
    this.glowReveal += (reveal - this.glowReveal) * Math.min(1, 0.1 * dt);
    if (Math.abs(reveal - this.glowReveal) < 0.002) this.glowReveal = reveal;
  }

  /** The flip's first half: 0 -> 90 degrees about the vertical axis with perspective, moving half way to its slot. */
  private flipStep(dt: number): void {
    const f = this.flip, v = this.v!, app = this.app!;
    f.t += dt;
    const p = Math.min(1, f.t / f.dur);
    this.setFlipCorners(p);
    if (this.teaseGlowOut > 0) v.glow.alpha = teaseGlowFade(this.teaseGlowOut, p);
    const af = this.auraFace, fb = this.backs?.[f.idx];
    if (af && fb) {
      // light gathers behind the turning card, in its own colour
      // (it turns with the card: it narrows as the card goes edge-on, so the light stays on the card's edges)
      af.placeTurned(this.pose.cx, this.pose.cy, CARD_H * FACE_PLATE_H * this.pose.s, flipAngle(p), FLIP_PERSPECTIVE_PER_WIDTH * CARD_W * this.pose.s);
      const charge = FLIP_CHARGE[fb.rarity] * p * p * Math.min(1, getPackFeel().bigPull);
      if (charge > af.level) af.level = charge;
    }
    if (p < 1) return;
    if (af && fb) {
      // the face shows: the aura follows it to the slot, bursts, and settles behind it
      const L = this.land;
      L.active = true; L.t = 0; L.dur = f.dur; L.t0 = -1; L.wait = 0;
      L.x0 = this.pose.cx; L.y0 = this.pose.cy; L.h0 = CARD_H * FACE_PLATE_H * this.pose.s;
      L.x1 = f.tx; L.y1 = f.ty; L.h1 = CARD_H * f.scale * REVEALED_SCALE * FACE_PLATE_H;
      const k = AURA_BURST[fb.rarity] * Math.min(1.2, getPackFeel().bigPull);
      if (k > 0) af.fireBurst(k);
      this.faceAmbient = FACE_AMBIENT[fb.rarity] * Math.min(1, getPackFeel().bigPull);
    }
    f.active = false;
    if (this.teaseGlowOut > 0) { this.teaseGlowOut = 0; v.glow.visible = false; }
    v.flipper.visible = false;
    v.flipRibbon.visible = false;
    const { cx, cy, s } = flipPoseAt(f, 1, this.pose);
    const hw = (CARD_W / 2) * s, hh = (CARD_H / 2) * s;
    const k = v.root.scale.x;
    // the rect cached at flip start (a resize mid-flip only marks it stale)
    const toScreen = this.rect.w > 0 ? this.rect.w / app.screen.width : 1;
    const left = this.rect.l + (v.root.x + (cx - hw) * k) * toScreen;
    const top = this.rect.t + (v.root.y + (cy - hh) * k) * toScreen;
    const rect = { left, top, width: hw * 2 * k * toScreen, height: hh * 2 * k * toScreen };
    const idx = f.idx;
    // a big pull: the light burst blooms behind where the face lands (the slot the flip was heading for)
    const b = this.backs?.[idx];
    const tier = b ? bigPullTier(b.rarity) : 'none';
    if (tier !== 'none') this.startBurst(tier, f.tx, f.ty);
    this.emit('onFlipEdge', () => this.events.onFlipEdge(idx, rect));
  }

  /** Start the big-pull burst at (x, y) in root units; dressed once here, only alpha / scale / rotation per frame. */
  private startBurst(tier: Exclude<BigPullTier, 'none'>, x: number, y: number): void {
    const v = this.v, tex = this.tex;
    if (!v || !tex || !(getPackFeel().bigPull > 0)) return;
    const bu = this.burst;
    bu.active = true;
    bu.ms = 0;
    bu.tier = tier;
    const ancient = tier === 'ancient';
    v.burst.position.set(x, y);
    v.burstBloom.tint = rarityTint(tier);
    v.burstRays.texture = tex.burstRays[tier];
    // Ancient's two tones: a pink ring over a cyan bloom, and a smaller cyan ring turning the other way
    v.burstRays.tint = ancient ? parseInt(ANCIENT_GLOW_STOPS[2].slice(1), 16) : rarityTint(tier);
    v.burstRays2.visible = ancient;
    v.burstRays2.texture = tex.burstRays.legendary;
    v.burstRays2.tint = rarityTint('ancient');
    // the stage takes the big pull's colour for a moment, from where the face lands
    if (this.stage && this.app) {
      const st = this.stage, app = this.app, ac = AURA_COLORS[tier];
      this.stageWash = 1;
      st.u.uWashTint.set(ac[0]);
      st.u.uWashAt[0] = ((v.root.x + x * v.root.scale.x) / Math.max(1, app.screen.width)) * 2 - 1;
      st.u.uWashAt[1] = ((v.root.y + y * v.root.scale.y) / Math.max(1, app.screen.height)) * 2 - 1;
    }
    // with the shader aura the painted ray rings stand down (the aura draws the rays); the soft bloom stays under it
    if (this.auraFace) { v.burstRays.visible = false; v.burstRays2.visible = false; }
    v.burst.visible = true;
    this.burstStep(0, getPackFeel());
  }

  /** One frame of the burst (dt in 60 Hz frames, already slow-mo scaled). */
  private burstStep(dt: number, feel: PackFeel): void {
    const v = this.v!, bu = this.burst;
    bu.ms += dt * FRAME_MS;
    const spec = BURST[bu.tier];
    const p = burstPoseAt(spec, bu.ms, feel.bigPull, this.burstPose);
    if (!p.live) { bu.active = false; v.burst.visible = false; return; }
    const bloomK = (spec.bloomSize * CARD_H * p.scale) / BURST_TEX;
    const rayK = (spec.raySize * CARD_H * p.scale) / BURST_TEX;
    v.burstBloom.alpha = p.alpha;
    v.burstBloom.scale.set(bloomK);
    v.burstRays.alpha = p.alpha * 0.8;
    v.burstRays.scale.set(rayK);
    v.burstRays.rotation = p.rotation;
    if (v.burstRays2.visible) {
      v.burstRays2.alpha = p.alpha * 0.6;
      v.burstRays2.scale.set(rayK * 0.72);
      v.burstRays2.rotation = -p.rotation * 1.4;
    }
  }

  private readonly pose: FlipPose = { cx: 0, cy: 0, s: 1 };
  private readonly corners = new Float64Array(8);

  /** Project the card (and its ribbon) at progress p onto the flip meshes' corners. */
  private setFlipCorners(p: number): void {
    const v = this.v!, f = this.flip, c = this.corners;
    const { cx, cy, s } = flipPoseAt(f, p, this.pose);
    const ang = flipAngle(p);
    const D = FLIP_PERSPECTIVE_PER_WIDTH * CARD_W * s;
    projectTurnedRect(c, cx, cy, s, ang, D, -CARD_W / 2, -CARD_H / 2, CARD_W / 2, CARD_H / 2);
    v.flipper.setCorners(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    if (f.ribbon) {
      projectTurnedRect(c, cx, cy, s, ang, D, -RIBBON_HW, RIBBON_DY - RIBBON_HH, RIBBON_HW, RIBBON_DY + RIBBON_HH);
      v.flipRibbon.setCorners(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    }
  }
}


/** Sparks shed along a whole tear, edge to edge. */
const TEAR_SPARKS = 80;

/** The guaranteed seal: how long its stamp takes (frames), how much larger and how far turned it starts, and its breath. */
const SEAL_STAMP_FRAMES = 22;
const SEAL_STAMP = 0.9;
const SEAL_TURN = 0.5;
const SEAL_PULSE = 0.025;
const SEAL_PULSE_RATE = 0.06;

/** How long the aura waits edge-on for the DOM face to report its turn before it runs on the scene's clock (frames). */
const LAND_WAIT_FRAMES = 15;
/** The document timeline's time (ms): the clock CSS transitions are sampled on, fixed for a frame. */
const timelineNow = (): number => {
  const t = typeof document !== 'undefined' ? document.timeline?.currentTime : null;
  return typeof t === 'number' ? t : performance.now();
};

/**
 * Build the scene in `host` (an absolutely-positionable element the shell sizes). Returns at once; Pixi starts
 * asynchronously, and calls made before it is up are kept (`setBacks`, `quickOpen`, `setInputEnabled`).
 */
export function createPackScene(
  host: HTMLElement, look: PackLook, cardCount: number, sounds: PackSounds, events: PackSceneEvents,
): PackScene {
  const scene = new PackSceneImpl(host, look, cardCount, sounds, events);
  void scene.init();
  return scene;
}
