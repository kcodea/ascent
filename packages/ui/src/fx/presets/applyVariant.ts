import type { FxDef } from '../def';
import { getPrimitive } from '../registry';
import { UNSAFE_KEYS, type VariantAxis, type VariantOverride } from './presetTable';

export interface VariantResult {
  def: FxDef;
  /** Params WRITTEN, as `<layerIndex>.<param>`. Not necessarily *changed* — a multiplier of 1 writes the
   *  value back identical and still lands here. The distinction that matters is written vs `missed`. */
  applied: string[];
  /** Transform/override keys that reached no slider param they could apply to, on any layer. Covers a key
   *  no primitive declares, a key whose spec isn't a slider, and a key whose current value isn't a usable
   *  number — all three mean the same thing to an author: this part of the variant did nothing. */
  missed: string[];
}

/**
 * Clamp to the spec's range, then snap to its step, then round away the float dust the multiply left.
 *
 * The snap can land back OUTSIDE the range whenever `max - min` isn't a whole number of steps (min 0,
 * max 25, step 10: a clamped 25 snaps up to 30), so the range clamp is applied a second time AFTER the
 * snap. The result is then in-range but off-grid, which is the right trade: the range is what
 * `coerceParams` enforces on the way back IN (`params.ts` — it clamps sliders to `[min,max]` and never to
 * `step`), so an out-of-range value would be silently rewritten at load. `saveDef` itself validates
 * nothing but the id slug, so it is that load path, not Save, that this protects against.
 *
 * Returns a non-finite number for a non-finite input rather than inventing one — the caller treats that
 * as a miss.
 */
function settle(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

/**
 * Produce a variant of `base`.
 *
 * Sliders only: every other param kind (`toggle`, `enum`, `color`, `palette`, `curve`, `shape`) has no
 * numeric range, so "multiply it" is undefined. Such a key is reported in `missed` and the param is left
 * exactly as authored — never partially applied. Same for arithmetic that doesn't land on a finite number:
 * writing `NaN` into a param while reporting it in `applied` would be this function claiming success as it
 * poisons the def, which is the exact failure it exists to make loud.
 *
 * Generic over the def type so a richer def (`StoredFxDef`, carrying `version`/`seed`/`label`/`tags`) keeps
 * its type through the call. Those fields DO ride along at runtime via the spread, so erasing the return to
 * `FxDef` would hide from the caller that a variant inherits its base's `label` and `tags` — which the
 * library browser searches on.
 *
 * The base is never mutated; layers and their `params` are cloned.
 */
export function applyVariant<T extends FxDef>(
  base: T,
  axis: VariantAxis,
  override?: VariantOverride,
): Omit<VariantResult, 'def'> & { def: T } {
  const applied: string[] = [];
  const touched = new Set<string>();

  const layers = base.layers.map((layer, i) => {
    const specs = getPrimitive(layer.primitive)?.params;
    const params: Record<string, unknown> = { ...layer.params };

    const write = (key: string, next: number): void => {
      params[key] = next;
      applied.push(`${i}.${key}`);
      touched.add(key);
    };

    for (const [key, mult] of Object.entries(axis.transform)) {
      if (UNSAFE_KEYS.includes(key)) continue;
      const spec = specs?.[key];
      if (spec?.kind !== 'slider') continue;
      const current = params[key];
      // `typeof` AND finiteness, separately — neither implies the other. A boolean sitting in a slider
      // param would coerce straight through the multiply (`true * 2 === 2`) and be written as though it
      // had been authored that way; a NaN survives the arithmetic as a non-finite number.
      if (typeof current !== 'number' || !Number.isFinite(current)) continue;
      const next = settle(current * mult, spec.min, spec.max, spec.step);
      if (!Number.isFinite(next)) continue; // a NaN multiplier, or 0 × Infinity → falls into `missed`
      write(key, next);
    }

    // Absolute pins, applied AFTER the multipliers so a base can override a rule that reads badly on it.
    for (const [key, value] of Object.entries(override ?? {})) {
      if (UNSAFE_KEYS.includes(key)) continue;
      const spec = specs?.[key];
      if (spec?.kind !== 'slider') continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const next = settle(value, spec.min, spec.max, spec.step);
      if (!Number.isFinite(next)) continue;
      write(key, next);
    }

    return { ...layer, params };
  });

  const declared = [...Object.keys(axis.transform), ...Object.keys(override ?? {})];
  const missed = [...new Set(declared.filter((k) => !touched.has(k)))];

  // The cast is the one spot the generic needs help: TS can't prove a spread of `T` is still a `T`. It is —
  // every own property of `base` is carried through, and only `layers` is replaced (by clones of its own).
  return { def: { ...base, layers } as T, applied, missed };
}
