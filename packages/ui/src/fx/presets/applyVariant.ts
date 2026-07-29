import type { FxDef } from '../def';
import { getPrimitive } from '../registry';
import { UNSAFE_KEYS, type VariantAxis, type VariantOverride } from './presetTable';

export interface VariantResult {
  def: FxDef;
  /** Params actually changed, as `<layerIndex>.<param>`. */
  applied: string[];
  /** Transform/override keys that matched no SLIDER param on any layer. An authoring error, not a no-op. */
  missed: string[];
}

/**
 * Clamp to the spec's range, then snap to its step, then round away the float dust the multiply left.
 *
 * The snap can land back OUTSIDE the range whenever `max - min` isn't a whole number of steps (min 0,
 * max 25, step 10: a clamped 25 rounds up to 30), so the range clamp is applied a second time AFTER the
 * snap. The result is then in-range but off-grid, which is the right trade: the range is what Save
 * validates, the grid is only what the slider prefers.
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
 * exactly as authored — never partially applied.
 *
 * The base is never mutated; layers and their `params` are cloned.
 */
export function applyVariant(base: FxDef, axis: VariantAxis, override?: VariantOverride): VariantResult {
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
      if (typeof current !== 'number') continue;
      write(key, settle(current * mult, spec.min, spec.max, spec.step));
    }

    // Absolute pins, applied AFTER the multipliers so a base can override a rule that reads badly on it.
    for (const [key, value] of Object.entries(override ?? {})) {
      if (UNSAFE_KEYS.includes(key)) continue;
      const spec = specs?.[key];
      if (spec?.kind !== 'slider') continue;
      write(key, settle(value, spec.min, spec.max, spec.step));
    }

    return { ...layer, params };
  });

  const declared = [...Object.keys(axis.transform), ...Object.keys(override ?? {})];
  const missed = [...new Set(declared.filter((k) => !touched.has(k)))];

  return { def: { ...base, layers }, applied, missed };
}
