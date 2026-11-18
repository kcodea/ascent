import { RAPID_ACTIONS, shopActionPressure, shopInputRapid } from './actionPressure';
import { RAPID_FX } from './rapidConfig';

/**
 * HOW AN EFFECT PLAYS WHILE THE PLAYER'S INPUT IS RAPID (R-PERF-APM-01).
 *
 * At normal speed a recipient's trail or burst has played out long before the next action buffs it again. At four to
 * eight actions a second every board minion is buffed several times a second by the same sources, and each fire
 * stacked a fresh copy of the same effect on the same card: measured on Karwind's board (`npm run perf:apm`), 19 to
 * 22 effects alive on average, 34 at peak, their per-frame simulation and draw the largest script cost of the turn.
 *
 * While input is rapid (`fx/actionPressure.ts`), `playDef` therefore plays a one-shot effect in a short form:
 *
 *   ONE COPY PER RECIPIENT. A play with no key of its own gets one: who it lands on. `fxBudget.admit` already knows
 *   what to do with a key (the hand-buff rule of 2026-10-22): a second fire of the same effect on the same key inside
 *   `coalesceMs` is the same moment and spawns nothing; a later one retires the play it replaces and starts fresh.
 *
 *   IN STEP WITH THE INPUT. It plays faster and carries fewer particles the faster the player acts (`speed`,
 *   `intensity`): at three actions a second exactly as authored, at five or more at the caps in `RAPID_FX`. A faster
 *   play is a shorter one, so the number alive at once stays about where a slower turn has it.
 *
 * Never touched: a play the caller sequences on (`onDone`), a loop or a follow (caller-owned), and a play that
 * already has its own `dedupeKey`. And nothing at all at up to two actions a second.
 */

/** The anchors and uids `playDef` was called with, as far as the key needs them. */
interface PlayTarget {
  uids?: { source?: string | null; target?: string | null };
  target?: { x: number; y: number };
  source?: { x: number; y: number };
}

/** The short form for one play: see the header. */
export interface RapidPlay {
  /** The dedupe key (`RAPID_FX.dedupe`), or undefined when the play has nowhere to key on. */
  key?: string;
  coalesceMs: number;
  /** Playback rate multiplier, 1 or more. */
  speed: number;
  /** Particle quantity multiplier, 1 or less. */
  intensity: number;
}

/**
 * The short form for a play fired now, or `null` when input is not rapid (the play is as authored).
 * The key is the recipient's uid when the play names one; else where it lands, on a 16 px grid (the Gold pill's
 * coins, a button's dust), so two fires on the same spot are one moment and fires on different cards never share one.
 */
export function rapidPlay(t: PlayTarget, now?: number): RapidPlay | null {
  if (!shopInputRapid(now)) return null;
  const pressure = shopActionPressure(now);
  let key: string | undefined;
  if (RAPID_FX.dedupe) {
    const uid = t.uids?.target;
    const p = t.target ?? t.source;
    key = uid ? `rapid:${uid}` : p ? `rapid@${Math.round(p.x / 16)},${Math.round(p.y / 16)}` : undefined;
  }
  return {
    key,
    coalesceMs: RAPID_FX.coalesceMs,
    speed: Math.max(1, Math.min(RAPID_FX.maxSpeed, pressure / RAPID_ACTIONS)),
    intensity: Math.min(1, Math.max(RAPID_FX.minIntensity, RAPID_ACTIONS / pressure)),
  };
}
