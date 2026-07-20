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
  /** Degrees of tilt per px of lag-gap — how hard the card leans into its motion. */
  tiltPerPx: number;
  /** Max tilt (deg) — clamps the lean so a fast fling can't over-rotate. */
  tiltMax: number;
  /** Horizontal lean into the drag direction. Magnitude = how much; SIGN = which way (flip if left/right feel
   *  backwards); 0 = no horizontal lean. */
  hLean: number;
  /** Vertical lean into the drag direction. Magnitude = how much; SIGN = which way (flip if up/down feel
   *  backwards); 0 = no vertical lean. */
  vLean: number;
  /** CSS perspective (px) for the 3D tilt — smaller = stronger foreshortening. */
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
  follow: 0.6,      // catch-up per frame (tuned by eye)
  tiltPerPx: 0.6,   // strong lean per px of lag
  tiltMax: 20,      // generous tilt ceiling
  hLean: 0.3,       // lean into horizontal motion
  vLean: -0.2,      // lean into vertical motion
  perspective: 1550,// gentle 3D depth
  scale: 1.21,      // clearly lifted off the table
  staticRotate: -1.5,// a slight fixed tilt while held
  threshold: 0,     // drag engages immediately
  recenter: 0.18,   // glide speed onto the cursor
  recenterAfter: 400,// only begin recentring after a longer drag from the grab point
  snapMs: 110,
  magSlideMs: 390,
  magWeldLeadMs: 130,
  collapseY: 20,    // lift only a little before the row fills the gap
  handFloor: 0,     // owner-tuned 2026-07-20: no floor offset — the pop lift alone places the card
  handPop: 0.22,    // owner-tuned 2026-07-20: a modest upward pop (× --ch); replaces the old -100% self-height term
  shGrow: 1.08,     // owner-tuned: shadow a touch bigger than the card face while lifted
  shLift: 18,       // owner-tuned: shadow drops below the lifted card
  shBlur: 11,       // owner-tuned: softer than the resting 9px, but still tight
  shFade: 0.54,     // owner-tuned: noticeably lighter than the resting solid shadow
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const DRAG_RANGES: Record<keyof DragFeel, [number, number, number]> = {
  follow: [0.1, 1, 0.02],
  tiltPerPx: [0, 0.6, 0.01],
  tiltMax: [0, 20, 0.5],
  hLean: [-1, 1, 0.1],
  vLean: [-1, 1, 0.1],
  perspective: [200, 1600, 50],
  scale: [1, 1.3, 0.01],
  staticRotate: [-8, 8, 0.5],
  threshold: [0, 30, 1],
  recenter: [0.02, 1, 0.02],
  recenterAfter: [0, 500, 5],
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
  tiltPerPx: 'Degrees of 3D lean per pixel the card trails the cursor. Higher = leans harder when moving.',
  tiltMax: 'Ceiling on the tilt (degrees) so a fast fling can’t over-rotate.',
  hLean: 'Lean into left/right motion. Magnitude = how much; flip the SIGN if left/right feel backwards; 0 = off.',
  vLean: 'Lean into up/down motion. Magnitude = how much; flip the SIGN if up/down feel backwards; 0 = off.',
  perspective: 'CSS 3D depth (px). Smaller = stronger foreshortening / more dramatic tilt.',
  scale: 'How much the card grows while held — the “lifted off the table” size.',
  staticRotate: 'A fixed 2D angle (deg) while held. 0 = sits flat like a card on the table.',
  threshold: 'Pixels the pointer must move before a click turns into a drag.',
  recenter: 'How fast the card glides to sit centred on the cursor (per frame; lower = slower slide).',
  recenterAfter: 'Pixels you must drag from the grab point before the card starts recentring onto the cursor.',
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
export const DRAG_KEYS = Object.keys(DEFAULTS) as (keyof DragFeel)[];

const KEY = 'ascent.dragfeel';
let cfg: DragFeel = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<DragFeel>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

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
    localStorage.setItem(KEY, JSON.stringify(cfg));
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
