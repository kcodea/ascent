/**
 * PACK OPENING: the pure tear + sleeve model (spec §3). A port of the tuned prototype's ticker
 * (docs/superpowers/specs/2026-11-23-pack-opening-prototype.html): the tear branch, `keepInReach`, `easeTo`,
 * `sleeveTick` and `dropSleeve`. State only; the strip curve (`buildCurve` / `solveK`), sound, flecks, shake and the
 * mesh deform stay in the scene.
 *
 * Every rate is scaled by `dt` (Pixi `ticker.deltaTime`, 1 = one 60 Hz frame). The step functions MUTATE their state
 * and return a module-level result object that is REUSED on the next call: read it immediately, never keep it.
 * No allocation per frame.
 */
import type { PackFeel } from './packFxConfig';

export interface Vec3 { x: number; y: number; z: number }

/**
 * The tear. `T` = the tear front in pack px from the strip's left. `hand` = the held corner of the strip in 3D
 * (x right, y down, z toward the camera), relative to the strip's top-left; the foil hangs from (T, 0, 0) to it.
 */
export interface TearState { T: number; started: boolean; done: boolean; held: boolean; hand: Vec3; tension: number }

export interface TearStepResult { popped: boolean; ripped: boolean; advanced: number }

/** The seal pops once the pull passes this (px). */
const POP_TENSION = 30;
/** Ease rate of the corner toward its rest pose when nobody holds it. */
const REST_FOLLOW = 0.08;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function newTear(): TearState {
  return { T: 0.5, started: false, done: false, held: false, hand: { x: 0, y: 0, z: 0 }, tension: 0 };
}

/** The foil can't stretch: the corner stays within the peeled length T of the tear front. */
function keepInReach(s: TearState): void {
  const h = s.hand;
  const dx = h.x - s.T, d = Math.hypot(dx, h.y, h.z);
  if (d > s.T) { const k = s.T / d; h.x = s.T + dx * k; h.y *= k; h.z *= k; }
}

const tearResult: TearStepResult = { popped: false, ripped: false, advanced: 0 };

/**
 * One frame of the tear. `input.target` is the 3D point the held corner reaches for (the scene unprojects the cursor
 * and sets z = feel.edgeTowardCamera * min(1, T / 50)); ignored when not held. `catchPhase` is the scene's running
 * time (dt units), which drives the fibre-catch stutter. Returns the REUSED result object.
 */
export function stepTear(
  s: TearState, input: { held: boolean; target: Vec3 | null }, feel: PackFeel, width: number, dt: number,
  catchPhase: number,
): TearStepResult {
  const r = tearResult;
  r.popped = false; r.ripped = false; r.advanced = 0;
  if (s.done) { s.held = false; return r; }
  s.held = input.held;
  const prevT = s.T;
  const holding = s.held && input.target !== null;

  // where the corner reaches: the hand, the let-go pose (the flap stands up toward you and sags), or the seal
  let tx = 0, ty = 0, tz = 0;
  if (holding && input.target) { tx = input.target.x; ty = input.target.y; tz = input.target.z; }
  else if (s.started) { tx = s.T * 0.7; ty = -s.T * 0.25; tz = s.T * 0.85; }
  const f = Math.min(1, (s.held ? feel.edgeFollowsHand : REST_FOLLOW) * dt);
  const h = s.hand;
  h.x += (tx - h.x) * f; h.y += (ty - h.y) * f; h.z += (tz - h.z) * f;

  if (!s.started) {
    // the seal holds: the corner stretches a few px with the pull, then pops
    s.tension = holding ? Math.hypot(Math.max(0, tx), Math.min(0, ty)) : 0;
    s.T = 0.5 + Math.min(10, s.tension * 0.3);
    keepInReach(s);
    if (s.tension > POP_TENSION) { s.started = true; r.popped = true; }
  } else {
    // Only a HELD pull ALONG the tear line opens it; pulled back the other way the foil goes taut and holds.
    // (tearsStraightUp lets a straight-up pull creep it a little.) Deviation from the prototype: it also advanced
    // while the released corner swung to its rest pose; the model advances only while held (no creep on let-go).
    if (holding) {
      const chord = Math.hypot(h.x - s.T, h.y, h.z);
      const along = clamp01(feel.tearsStraightUp + (h.x - s.T) / Math.max(1, chord));
      if (chord > s.T * feel.slackBeforeTear && along > 0) {
        const caught = 1 - feel.fibreCatch
          * (0.5 + 0.5 * Math.sin(catchPhase * 0.9) * Math.sin(catchPhase * 0.37 + 1.3)) * 0.85;
        s.T = Math.min(width,
          s.T + Math.min((chord - s.T * feel.slackBeforeTear) * along * caught, feel.maxTearSpeed * along * dt));
      }
    }
    keepInReach(s);
    if (s.T >= width - 1) { s.done = true; s.held = false; r.ripped = true; }
  }
  r.advanced = s.T - prevT;
  return r;
}

/** Let go of the corner (pointerup, pointercancel, released off-canvas). Idempotent. */
export function releaseTear(s: TearState): void {
  s.held = false;
}

/**
 * The sleeve pull. `dy` = how far the sleeve has slid down (px); `card` / `cardV` = the stack's friction ride + bounce;
 * `lag` = the rim trailing as it rubs the cards and `pinch` = the squeeze at the fingers (both drive the mesh deform).
 */
export interface SleeveState {
  dy: number; held: boolean; freed: boolean; falling: boolean; vy: number; card: number; cardV: number; lag: number;
  pinch: number;
}

export interface SleeveStepResult { brokeFree: boolean; dropped: boolean; speed: number }
export interface SleeveReleaseResult { dropped: boolean }

/** A downward pointer speed (px/frame) above this on release counts as a flick. */
const FLICK_VY = 9;

export function newSleeve(): SleeveState {
  return { dy: 0, held: false, freed: false, falling: false, vy: 0, card: 0, cardV: 0, lag: 0, pinch: 0 };
}

function dropSleeve(s: SleeveState, vy: number): void {
  s.held = false; s.falling = true; s.vy = vy;
}

const releaseResult: SleeveReleaseResult = { dropped: false };

/**
 * Let go of the sleeve. Past the let-go distance, or flicked down, it drops away at the throw's speed; otherwise it
 * will slide back up. Idempotent (a second call, or a call while not held, does nothing). Returns the REUSED result.
 */
export function releaseSleeve(s: SleeveState, flickVy: number, feel: PackFeel): SleeveReleaseResult {
  const r = releaseResult;
  r.dropped = false;
  if (!s.held) return r;
  s.held = false;
  if (s.dy > feel.sleeveLetGo || flickVy > FLICK_VY) { dropSleeve(s, Math.max(flickVy * 0.8, 5)); r.dropped = true; }
  return r;
}

const sleeveResult: SleeveStepResult = { brokeFree: false, dropped: false, speed: 0 };

/**
 * One frame of the sleeve. `want` = how far the hand has pulled down from its grab point (px, >= 0); `flickVy` = the
 * pointer's current downward speed (px/frame). `clearDy` = the slide at which the rim is below the stack. A step with
 * `held: false` while the sleeve is held is treated as a release. Returns the REUSED result object.
 */
export function stepSleeve(
  s: SleeveState, input: { held: boolean; want: number; flickVy: number }, feel: PackFeel, clearDy: number, dt: number,
): SleeveStepResult {
  const r = sleeveResult;
  r.brokeFree = false; r.dropped = false; r.speed = 0;
  if (s.held && !input.held) r.dropped = releaseSleeve(s, input.flickVy, feel).dropped;
  else if (input.held && !s.falling) s.held = true;

  const prevDy = s.dy;
  if (s.falling) {
    s.vy += 0.9 * dt; s.dy += s.vy * dt;
  } else if (s.held) {
    const want = Math.max(0, input.want);
    if (!s.freed) {
      // the sleeve grips the cards: it stretches a few px with the pull, then breaks free
      const g = Math.min(want, 6 + Math.max(0, want - 6) * 0.12);
      s.dy += (g - s.dy) * Math.min(1, 0.4 * dt);
      if (want > feel.sleeveGrip) { s.freed = true; r.brokeFree = true; }
    } else s.dy += (want - s.dy) * Math.min(1, feel.sleeveFollows * dt);
    if (s.dy > clearDy) { dropSleeve(s, Math.max(input.flickVy * 0.8, 6)); r.dropped = true; }
  } else s.dy += (0 - s.dy) * Math.min(1, 0.12 * dt); // let go early: it slides back up
  const speed = (s.dy - prevDy) / Math.max(dt, 0.001);
  r.speed = speed;

  // friction: the cards ride down a touch with the sleeve until it breaks free, then settle back with a bounce
  const cardT = s.freed || s.falling ? 0 : Math.min(7, s.dy * 0.6);
  s.cardV += (cardT - s.card) * 0.25 * dt; s.cardV *= Math.pow(0.72, dt); s.card += s.cardV * dt;
  s.lag += ((s.held ? Math.min(20, Math.max(0, speed) * 2.2) * feel.sleeveRimDrag : 0) - s.lag) * Math.min(1, 0.25 * dt);
  s.pinch += ((s.held ? feel.sleeveFingerPinch : 0) - s.pinch) * Math.min(1, 0.2 * dt);
  return r;
}
