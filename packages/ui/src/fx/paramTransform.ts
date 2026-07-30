import type { FxParamSpecs } from './params';

/**
 * The ONE piece of arithmetic that multiplies a primitive's params and keeps the result legal.
 *
 * Two callers, both of which need EXACTLY this and must never drift from each other:
 *   • `presets/applyVariant.ts` — the authoring-time variant axes ("Bigger", "Faster") in the preset gallery.
 *   • `scaleDef.ts` — the per-call `scale` / `intensity` / `time` a `playDef` caller passes at runtime.
 * `applyVariant` had all of it inline first; this module is that logic lifted out unchanged so the runtime
 * path could reuse it rather than grow a second, subtly different copy of the clamp/snap/guard rules.
 *
 * Nothing here reads the primitive registry — the caller resolves the specs and hands them in. That keeps this
 * module free of the registry-read-ordering hazard documented in `fxDefs.ts` (a read that lands before the
 * primitives register caches every def stripped to zero layers).
 */

/** Keys that must never be used to index into an object we then assign to: `out['__proto__'] = x` invokes
 *  the inherited prototype setter. Lives here rather than in `presets/presetTable.ts` (which re-exports it
 *  for its existing importers) so the shipped `playDef` path doesn't drag the DEV-only preset parser into
 *  the main chunk just to read three strings. */
export const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * Clamp to the spec's range, then snap to its step, then round away the float dust the multiply left.
 *
 * The snap can land back OUTSIDE the range whenever `max - min` isn't a whole number of steps (min 0,
 * max 25, step 10: a clamped 25 snaps up to 30), so the range clamp is applied a second time AFTER the
 * snap. The result is then in-range but off-grid, which is the right trade: the range is what
 * `coerceParams` enforces on the way back IN (`params.ts` — it clamps sliders to `[min,max]` and never to
 * `step`), so an out-of-range value would be silently rewritten at load.
 *
 * Returns a non-finite number for a non-finite input rather than inventing one — the caller treats that
 * as a miss.
 */
export function settleParam(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

export interface ParamTransformResult {
  /** A FRESH params object — the input is never mutated. Key order is the input's. */
  params: Record<string, unknown>;
  /** Param names WRITTEN, in write order, duplicates kept (a key hit by both the transform and an override
   *  appears twice). "Written" is not "changed": a multiplier of 1 writes the value back identical and still
   *  lands here. The distinction that matters to a caller is written vs. not-written-at-all. */
  writes: string[];
}

/**
 * Multiply (then pin) one layer's params.
 *
 * Sliders only: every other param kind (`toggle`, `enum`, `color`, `palette`, `curve`, `shape`) has no
 * numeric range, so "multiply it" is undefined. Such a key is left EXACTLY as authored — never partially
 * applied — and is simply absent from `writes`. Same for arithmetic that doesn't land on a finite number:
 * writing `NaN` into a param while reporting it as applied would be this function claiming success as it
 * poisons the def, which is the exact failure it exists to make loud.
 *
 * `override` is applied AFTER `transform` (absolute pins win over multipliers) and is held to the same rules.
 */
export function transformParams(
  specs: FxParamSpecs | undefined,
  base: Record<string, unknown>,
  transform: Record<string, number>,
  override?: Record<string, number>,
): ParamTransformResult {
  const params: Record<string, unknown> = { ...base };
  const writes: string[] = [];

  const write = (key: string, next: number): void => {
    params[key] = next;
    writes.push(key);
  };

  for (const [key, mult] of Object.entries(transform)) {
    if (UNSAFE_KEYS.includes(key)) continue;
    const spec = specs?.[key];
    if (spec?.kind !== 'slider') continue;
    const current = params[key];
    // `typeof` for the COMPILER (`current` is `unknown`, and `Number.isFinite` is not a type predicate, so
    // without this the multiply won't narrow — TS18046), `Number.isFinite` for the VALUE. The value check
    // alone already rejects every non-number: unlike the global `isFinite`, `Number.isFinite` does not
    // coerce, so `Number.isFinite(true)` is false and a boolean never reaches `true * 2`. Both needed, for
    // different reasons.
    if (typeof current !== 'number' || !Number.isFinite(current)) continue;
    const next = settleParam(current * mult, spec.min, spec.max, spec.step);
    if (!Number.isFinite(next)) continue; // a NaN multiplier, or 0 × Infinity → not written
    write(key, next);
  }

  for (const [key, value] of Object.entries(override ?? {})) {
    if (UNSAFE_KEYS.includes(key)) continue;
    const spec = specs?.[key];
    if (spec?.kind !== 'slider') continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const next = settleParam(value, spec.min, spec.max, spec.step);
    if (!Number.isFinite(next)) continue;
    write(key, next);
  }

  return { params, writes };
}
