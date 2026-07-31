import type { FxDef } from '../def';
import { transformParams } from '../paramTransform';
import { getPrimitive } from '../registry';
import type { VariantAxis, VariantOverride } from './presetTable';

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
 * Produce a variant of `base`.
 *
 * The per-layer arithmetic — sliders only, clamp, snap, clear the float dust, refuse a non-finite result —
 * lives in `paramTransform.ts`, shared verbatim with the runtime `scale`/`intensity` path (`scaleDef.ts`).
 * What stays here is the part that is specific to a VARIANT: walking every layer, and turning "nothing this
 * key could be applied to, on any layer" into the `missed` diagnostic an author reads.
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
    // Overrides are absolute pins applied AFTER the multipliers, so a base can override a rule that reads
    // badly on it — `transformParams` owns that ordering.
    const { params, writes } = transformParams(specs, layer.params, axis.transform, override);
    for (const key of writes) {
      applied.push(`${i}.${key}`);
      touched.add(key);
    }
    return { ...layer, params };
  });

  const declared = [...Object.keys(axis.transform), ...Object.keys(override ?? {})];
  const missed = [...new Set(declared.filter((k) => !touched.has(k)))];

  // The cast is the one spot the generic needs help: TS can't prove a spread of `T` is still a `T`. It is —
  // every own property of `base` is carried through, and only `layers` is replaced (by clones of its own).
  return { def: { ...base, layers } as T, applied, missed };
}
