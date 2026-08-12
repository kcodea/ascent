/**
 * Tunable parameters for the weighted card-drag feel (the floating `.dragcard` in Recruit). A dragged card
 * lags slightly behind the cursor (weight) and tilts in 3D toward its motion (a perspective lean, à la the
 * PixiJS perspective-mesh example) — both driven off the SAME signal: the gap between the cursor (target) and
 * the card's smoothed render position. Bigger gap ⇒ faster motion ⇒ more lean; when the cursor stops the gap
 * closes and the card settles flat. Held in one mutable, localStorage-persisted config so the feel can be
 * dialed by eye via the DEV Drag tuner (`DragTuner.tsx`); Recruit's drag rAF reads `getDragFeel()` each frame.
 */
export interface DragFeel {
  /** Catch-up fraction per 60 fps frame toward the cursor (1 = instant/no lag; lower = heavier/laggier). */
  follow: number;
  /** Degrees of dive per px/frame of card travel — ONE uniform gain for both axes (so N/S dives as hard as
   *  E/W). The card pitches so its LEADING edge dips toward the board in the direction it's moving. Replaces
   *  the old per-axis `tiltPerPx · hLean` / `tiltPerPx · vLean` lean. */
  tiltGain: number;
  /** Velocity smoothing for the dive: EMA rate of the card's per-frame travel (1 = no smoothing — the dive
   *  tracks raw movement and snaps flat the instant the cursor stops; lower = a softer build and settle). */
  tiltEase: number;
  /** Max tilt (deg) — clamps the dive so a fast fling can't over-rotate. */
  tiltMax: number;
  /** CSS perspective (px) for the 3D dive — smaller = stronger foreshortening / a deeper corner pinch. */
  perspective: number;
  /** Hold scale — how much the card grows while lifted (the 'off the table' size). */
  scale: number;
  /** A fixed 2D angle (deg) while held; 0 = sits flat like a card on the table. */
  staticRotate: number;
  /** Pixels the pointer must move before a click becomes a drag. */
  threshold: number;
  /** Glide speed as the card recentres onto the cursor (per 60 fps frame; lower = slower slide). */
  recenter: number;
  /** Pixels the pointer must drag from the grab point before the recentre onto the cursor begins. */
  recenterAfter: number;
  /** HAND drag grab point — where the cursor sits on a card lifted FROM THE HAND, as a fraction of the card's
   *  (compact) height: 0 = top edge, 0.5 = centre, 1 = bottom edge. Shop/board drags always ride centred; this
   *  moves ONLY the hand anchor, so a fanned hand card can hang from a lower point (near its stat badges) rather
   *  than from mid-art. Drop/insertion math is unchanged — this is purely where the floating card sits. */
  handGrabY: number;
  /** How fast an invalid drop springs back to its slot (ms). */
  snapMs: number;
  /** Duration of the Mech 'absorb' slide on a magnetic merge (ms). */
  magSlideMs: number;
  magWeldLeadMs: number;
  /** Vertical drag distance (px) before the row closes up behind a lifted card — when you pull a board
   *  minion (or shop offer) up/down out of its slot this far, the others slide in to fill the gap. */
  collapseY: number;
  /** Hand hover-pop FLOOR, as a fraction of the card height (--ch). Together with `handPop` it sets the pop:
   *  `translateY(--ch · (handFloor − handPop))`. This value is the resting line; higher = the card sits lower
   *  (bottom nearer the play-field floor). Reflected to the `--hand-floor` CSS var. */
  handFloor: number;
  /** Hand hover-pop LIFT, as a fraction of the card height (--ch). Replaces the old `-100%` self-height term:
   *  since the info panel went absolute (out of flow), the card element's height no longer includes it, so a
   *  `-100%` lift shrank and the pop went DOWNWARD — this fixed multiple of --ch is height-independent (every
   *  card is the same compact height anyway). Higher = pops further UP. Reflected to `--hand-pop`. */
  handPop: number;
  /** DRAG SHADOW — while a card is lifted (`.dragcard`), its grounding shadow (`.cshadow`) grows/softens/drops
   *  to read as further OFF the table (a higher object casts a bigger, softer, more-offset, lighter shadow).
   *  Reflected to `--dsh-*` CSS vars; applied by `.dragcard .cshadow` in styles.css. */
  /** Shadow scale while dragging (bigger = higher off the table). */
  shGrow: number;
  /** Shadow downward offset while dragging, px (further from the card = higher). */
  shLift: number;
  /** Shadow blur while dragging, px (softer = higher). */
  shBlur: number;
  /** Shadow opacity while dragging (lighter = higher/airier). */
  shFade: number;
}

const DEFAULTS: DragFeel = {
  follow: 1,        // owner-tuned 2026-08-12: instant catch-up — the card rides exactly on the cursor
  tiltGain: 7,      // owner-tuned 2026-08-12: uniform dive gain (one gain, both axes)
  tiltEase: 0.4,    // owner-tuned 2026-08-12: eased dive build/settle off the smoothed travel
  tiltMax: 16,      // owner-tuned 2026-08-12: the dive ceiling
  perspective: 600, // owner-tuned 2026-08-12: foreshortening / corner-pinch depth (was 4000)
  scale: 1.21,      // clearly lifted off the table
  staticRotate: 0,  // owner-tuned 2026-08-10: sits flat while held (was -1.5)
  threshold: 0,     // drag engages immediately
  recenter: 1,      // owner-tuned 2026-08-10: instant glide onto the cursor (was 0.28)
  recenterAfter: 0, // recentre immediately
  handGrabY: 1,     // owner-tuned 2026-08-10: a hand card hangs from its bottom edge
  snapMs: 110,
  magSlideMs: 390,
  magWeldLeadMs: 130,
  collapseY: 50,    // owner-tuned 2026-08-10: lift a bit more before the row fills the gap (was 20)
  handFloor: 0,     // owner-tuned 2026-07-20: no floor offset — the pop lift alone places the card
  handPop: 0.53,    // owner-tuned 2026-08-11: a stronger upward pop (× --ch)
  shGrow: 1.08,     // owner-tuned: shadow a touch bigger than the card face while lifted
  shLift: 18,       // owner-tuned: shadow drops below the lifted card
  shBlur: 11,       // owner-tuned: softer than the resting 9px, but still tight
  shFade: 0.54,     // owner-tuned: noticeably lighter than the resting solid shadow
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const DRAG_RANGES: Record<keyof DragFeel, [number, number, number]> = {
  follow: [0.1, 1, 0.02],
  tiltGain: [0, 5, 0.05],
  tiltEase: [0.02, 1, 0.02],
  tiltMax: [0, 60, 0.5],
  perspective: [200, 3000, 25],
  scale: [1, 1.3, 0.01],
  staticRotate: [-8, 8, 0.5],
  threshold: [0, 30, 1],
  recenter: [0.02, 1, 0.02],
  recenterAfter: [0, 500, 5],
  handGrabY: [0, 1, 0.02],
  snapMs: [40, 400, 10],
  magSlideMs: [100, 600, 10],
  magWeldLeadMs: [0, 300, 10],
  collapseY: [0, 200, 5],
  handFloor: [0, 1.5, 0.01],
  handPop: [0, 3, 0.01],
  shGrow: [0.8, 1.6, 0.01],
  shLift: [0, 80, 1],
  shBlur: [0, 50, 1],
  shFade: [0, 1, 0.02],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const DRAG_DESC: Record<keyof DragFeel, string> = {
  follow: 'How fast the card catches up to the cursor. Lower = heavier/laggier; 1 = instant (no lag).',
  tiltGain: 'Degrees of dive per px/frame of travel — one uniform gain for both axes; the leading edge dips toward the board.',
  tiltEase: 'Velocity smoothing for the dive. 1 = no smoothing (tracks raw travel, snaps flat on stop); lower = a softer build and settle.',
  tiltMax: 'Ceiling on the dive (degrees) so a fast fling can’t over-rotate.',
  perspective: 'CSS 3D depth (px). Smaller = stronger foreshortening / a deeper corner pinch.',
  scale: 'How much the card grows while held — the “lifted off the table” size.',
  staticRotate: 'A fixed 2D angle (deg) while held. 0 = sits flat like a card on the table.',
  threshold: 'Pixels the pointer must move before a click turns into a drag.',
  recenter: 'How fast the card glides to sit centred on the cursor (per frame; lower = slower slide).',
  recenterAfter: 'Pixels you must drag from the grab point before the card starts recentring onto the cursor.',
  handGrabY: 'Where a card lifted FROM HAND hangs from the cursor (fraction of card height; 0.5 = centre, higher = lower/nearer the stat badges). Hand only — shop and board always ride centred.',
  snapMs: 'How fast an invalid drop springs back to its slot (milliseconds).',
  magSlideMs: 'Duration of the Mech “absorb” slide when a Magnetic minion merges (milliseconds).',
  magWeldLeadMs: 'How early (ms before the slide ends) the weld commits, so the ring OVERLAPS the tail of the slide instead of starting after it. 0 = the old back-to-back timing.',
  collapseY: 'Vertical distance (px) you must lift a card out of its row before the others slide in to fill the gap.',
  handFloor: 'Where a hovered hand card’s BOTTOM lands (× card height). Works against the pop lift. Higher = the card sits lower.',
  handPop: 'How far a hovered hand card POPS UP (× card height). Height-independent lift (replaces the old -100% self-height term). Higher = pops further up.',
  shGrow: 'Drag shadow SIZE while a card is lifted (scale). Bigger = the card reads as higher off the table.',
  shLift: 'Drag shadow OFFSET below the lifted card (px). Further = higher off the table.',
  shBlur: 'Drag shadow SOFTNESS while lifted (blur px). Softer = higher off the table.',
  shFade: 'Drag shadow OPACITY while lifted. Lower = a lighter, airier shadow (reads as higher/further).',
};

const KEY = 'ascent.dragfeel';

/**
 * Bump this WHENEVER you change `DEFAULTS` — it is what makes tuned values shareable.
 *
 * The problem it solves (owner 2026-07-26): two devs on dev servers, "identical" tuner settings, visibly
 * different feel. In dev the localStorage override WINS over the shipped defaults, so syncing main gets you
 * the new code and none of the new feel — your stale save keeps shadowing it, silently and forever.
 *
 * With a version stamp, a save from an older `DEFAULTS` is discarded on load, so pulling main is all it takes
 * for everyone to be on the same physics. The workflow is then:
 *
 *   1. tune by eye → **Copy values** in the tuner
 *   2. paste over `DEFAULTS` below and bump this number
 *   3. PR → merge → everyone syncs; their stale overrides self-clear and the new feel is live
 *
 * Forget the bump and step 3 silently doesn't happen for anyone who has ever touched the tuner — which is the
 * exact bug this comment exists to prevent, so `dragFeel.test.ts` fails if `DEFAULTS` changes without it.
 */
export const DRAG_DEFAULTS_VERSION = 6;

/** Shape actually written to localStorage: the values plus the defaults-version they were tuned against. */
type SavedDragFeel = Partial<DragFeel> & { __v?: number };

let cfg: DragFeel = (() => {
  // DEV-ONLY localStorage override: the tuner's saved tweaks must never beat the shipped DEFAULTS in a
  // production build (they did — a player/dev with stale 'ascent.dragfeel' got old drag physics over what's
  // on main; owner report 2026-07-21). Prod always runs the baked defaults.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as SavedDragFeel | null;
    if (!saved || typeof saved !== 'object') return { ...DEFAULTS };
    // A save tuned against an OLDER defaults version is stale: main has moved on and the whole point of the
    // bump is that main wins. Drop it (and clear it, so the tuner doesn't keep reporting an override).
    if (saved.__v !== DRAG_DEFAULTS_VERSION) {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      return { ...DEFAULTS };
    }
    const values: SavedDragFeel = { ...saved };
    delete values.__v; // the stamp is bookkeeping, not a tunable
    return { ...DEFAULTS, ...values };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** True when this machine is running a LOCAL tuner override rather than the values on main. Surfaced in the
 *  tuner so "why does mine feel different?" is answerable at a glance instead of by console archaeology. */
export function hasLocalDragOverride(): boolean {
  try {
    return import.meta.env.DEV && localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function getDragFeel(): DragFeel {
  return cfg;
}
/** Reflect the CSS-driven feel values (currently just the hand-pop) onto the document root, so pure-CSS rules
 *  like `.row.hand .card:hover` pick up the current/tuned value live. */
export function applyDragFeelVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--hand-floor', String(cfg.handFloor));
  root.setProperty('--hand-pop', String(cfg.handPop));
  // Drag shadow — consumed by `.dragcard .cshadow` (and the dev preview) in styles.css.
  root.setProperty('--dsh-grow', String(cfg.shGrow));
  root.setProperty('--dsh-lift', `${cfg.shLift}px`);
  root.setProperty('--dsh-blur', `${cfg.shBlur}px`);
  root.setProperty('--dsh-fade', String(cfg.shFade));
}
export function setDragValue(key: keyof DragFeel, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyDragFeelVars();
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...cfg, __v: DRAG_DEFAULTS_VERSION }));
  } catch {
    /* ignore */
  }
}
export function resetDragFeel(): void {
  cfg = { ...DEFAULTS };
  applyDragFeelVars();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
// Reflect the persisted/default vars onto :root at load, so the hand-pop is right before any tuning happens.
applyDragFeelVars();
