import { useRef } from 'react';
import type { RunState } from '@game/sim';

/**
 * THE RUN AS A COMBAT UNIT READS IT (R-PERF-COMBAT-PREVIEW-01, perf 2026-11-18).
 *
 * A combat `Unit` prints its text from ~35 run fields (the tier, the tallies, the rune flags ...). All of them are
 * frozen for the fight. What does move mid-fight is the handful of display-only previews the replay publishes
 * (`fxSpellPowerPreview` and friends): each publish makes a new `run` object, and a unit subscribed to the whole run
 * re-rendered for every one of them (all 14 units and their Cards, 11-14 times a late fight), though most units print
 * none of those numbers.
 *
 * `runSansPreviews` returns an object whose IDENTITY only changes when something other than a preview changed, and
 * which carries NO preview value at all (they read as absent, never as stale). A unit subscribes to that for the
 * frozen fields and reads each preview it prints through its own primitive selector on the live run, so it re-renders
 * only when a number it shows really moved.
 */
export const COMBAT_PREVIEW_KEYS = [
  'fxSpellPowerPreview', 'fxEscalationPreview', 'fxSpellsCastPreview', 'fxFriendlyDeathPreview',
  'fxBladeAttacksPreview', 'fxScoutPreview', 'fxConductorPreview',
] as const satisfies readonly (keyof RunState)[];

const PREVIEW = new Set<string>(COMBAT_PREVIEW_KEYS);

/** Same run apart from the preview fields? A shallow, by-identity compare of every other top-level field. */
function sameButPreviews(a: RunState, b: RunState): boolean {
  const ra = a as unknown as Record<string, unknown>, rb = b as unknown as Record<string, unknown>;
  for (const k in ra) if (!PREVIEW.has(k) && ra[k] !== rb[k]) return false;
  for (const k in rb) if (!(k in ra) && !PREVIEW.has(k) && rb[k] !== undefined) return false;
  return true;
}

let lastIn: RunState | null = null;
let lastOut: RunState | null = null;

export function runSansPreviews(run: RunState): RunState {
  if (run === lastIn) return lastOut!;
  if (lastIn && lastOut && sameButPreviews(lastIn, run)) { lastIn = run; return lastOut; }
  lastIn = run;
  let has = false;
  for (const k of COMBAT_PREVIEW_KEYS) if (run[k] !== undefined) { has = true; break; }
  if (!has) { lastOut = run; return run; }
  const out = { ...run };
  for (const k of COMBAT_PREVIEW_KEYS) delete out[k];
  lastOut = out;
  return out;
}

/** Value equality for a view field: primitives by `Object.is`; arrays, Sets and plain objects by their own entries
 *  (`depth` levels down), so a field rebuilt with the same content each beat counts as unchanged. */
export function sameValue(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (depth <= 0 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], bb[i], depth - 1)) return false;
    return true;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  for (const k in ra) if (!sameValue(ra[k], rb[k], depth - 1)) return false;
  for (const k in rb) if (!(k in ra) && rb[k] !== undefined) return false;
  return true;
}

/** `next` if it differs from `prev` in any field's VALUE, else `prev` itself (so a memo'd child keeps its props).
 *  `depth` = how many levels below the top-level fields are compared by value (2 covers a view's arrays of rows). */
export function keepIfSame<T>(prev: T | null | undefined, next: T, depth = 2): T {
  return prev !== null && prev !== undefined && sameValue(prev, next, depth + 1) ? prev : next;
}

/**
 * The same reference for as long as the VALUE is unchanged (docs/performance.md: keep per-beat props referentially
 * stable). The replay's folds hand back a fresh object every beat; most beats change nothing in most of them, and a
 * fresh object is a store write, a subscriber pass and a re-render of whatever reads it. A ref written during render
 * is safe here: the kept value is equal to the one passed in, so a discarded render changes nothing.
 */
export function useStableValue<T>(next: T, depth = 2): T {
  const ref = useRef(next);
  ref.current = keepIfSame(ref.current, next, depth);
  return ref.current;
}
