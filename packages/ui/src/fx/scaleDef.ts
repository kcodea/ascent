import type { FxDef } from './def';
import type { FxParamSpecs } from './params';
import { transformParams } from './paramTransform';
import { getPrimitive } from './registry';

/**
 * The runtime half of per-call sizing: turn a caller's `scale` / `intensity` into a param multiplier map and
 * apply it to a def about to play.
 *
 * ── why this exists ──────────────────────────────────────────────────────────────────────────────────────
 * A def is a fixed composition, which is most of its value — what the author committed is what plays. But a
 * whole class of effects can't be expressed that way, because the CALLER knows something the author cannot:
 * how wide the card is, how much damage landed, how thick this particular caller wants the cloud. Nine
 * hand-written `pixiFx` effects were blocked on exactly that (`dust`, `deathrattle`, `shatterAt`,
 * `rebornSummon`, `impact`, `impactDust`, `impactPulse`, `critImpact`, `refreshBlast`). Two multipliers, on
 * params that opt in by declaring an `axis` (see `params.ts`), unblock the ones that only needed magnitude.
 *
 * ── what it deliberately is NOT ──────────────────────────────────────────────────────────────────────────
 * Not a per-call parameter channel. A caller cannot reach an arbitrary param; it can only say "bigger" and
 * "more". Anything finer belongs in a separate def, because a def that four callers each bend differently is
 * no longer a committed composition. Nor does it carry DIRECTION — `impact`/`critImpact` also want a launch
 * angle, and the right shape for that is an aim mode on `burst` derived from the anchors `playDef` already
 * receives, not a per-call angle. That is a separate piece of plumbing (see `burst.ts`'s `BURST_AIM_MODES`).
 *
 * ── the two things that make it safe ─────────────────────────────────────────────────────────────────────
 *  1. **1 is an EXACT no-op.** Not "multiplies by 1.0 and re-snaps" — the def object is returned by identity,
 *     untouched, so every existing caller and every seeded replay is byte-for-byte what it was.
 *  2. **Determinism is preserved.** `scale` only ever touches geometry (sizes, radii, speeds), never a count,
 *     so a seeded `burst` draws the exact same random sequence in the exact same order at any scale — the
 *     particles are simply bigger and faster. `intensity` DOES change counts, and therefore changes how many
 *     draws are taken; that is inherent to "more particles" and is why the two axes are separate.
 */

export interface FxScaleAxes {
  /** Geometric multiplier: sizes, emission radii, extents, speeds. Default 1. */
  scale?: number;
  /** Quantity multiplier: particle counts, emission rates, ring counts. Default 1. */
  intensity?: number;
}

/**
 * A caller-supplied axis value → a usable multiplier.
 *
 * `undefined`, non-finite (`NaN`/`Infinity`) and ≤ 0 all fall back to **1**. Deliberate, and the same
 * treatment `PlayDefOptions.speed` already gives its own bad input: a zero or negative scale is caller
 * error (it would collapse an effect to nothing, or invert it), and silently playing the def at its authored
 * size is the failure mode a player can live with. Note the two guards are not redundant — `NaN > 0` is
 * false, but `Infinity > 0` is true, so the finiteness check is what stops `Infinity` (which would multiply
 * every axis param straight to its `max` and then also poison `0 × Infinity` into a NaN).
 */
export function normalizeAxis(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * PURE: the param-name → multiplier map one primitive's specs imply for these axes.
 *
 * Params multiplied by exactly 1 are omitted rather than written back identically — that is what lets the
 * caller skip a layer entirely (and so keep its `params` object by identity) when only one axis is in play.
 * Non-sliders are skipped here as well as inside `transformParams`; the belt is cheap and the braces are
 * what `validateSpecs` enforces at registration.
 */
export function axisTransform(specs: FxParamSpecs, scale: number, intensity: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    if (spec.kind !== 'slider' || spec.axis === undefined) continue;
    const mult = spec.axis === 'scale' ? scale : intensity;
    if (mult !== 1) out[key] = mult;
  }
  return out;
}

/**
 * Apply `scale` / `intensity` to a def, returning a new def (the input is never mutated).
 *
 * Returns the input BY IDENTITY when neither axis is in play — the exact-no-op contract above. Generic over
 * the def type so a richer def (`StoredFxDef`) keeps its `version`/`seed`/`label`/`tags` through the call,
 * for the same reason `applyVariant` is.
 *
 * Reads the primitive registry (for each layer's specs). That read is safe HERE and would not be earlier:
 * `fxDefs.ts` caches its parsed index on first read and drops layers whose primitive is unregistered, so
 * nothing may touch either registry before `playDef` has passed `canPlayDefs()`. This runs inside `playDef`,
 * after its `getDef`. A layer whose primitive is somehow unknown is passed through untouched rather than
 * dropped — dropping is `coerceDef`'s job, not a scaling function's.
 */
export function scaleDef<T extends FxDef>(def: T, axes: FxScaleAxes): T {
  const scale = normalizeAxis(axes.scale);
  const intensity = normalizeAxis(axes.intensity);
  if (scale === 1 && intensity === 1) return def;

  let changed = false;
  const layers = def.layers.map((layer) => {
    const specs = getPrimitive(layer.primitive)?.params;
    if (specs === undefined) return layer;
    const transform = axisTransform(specs, scale, intensity);
    if (Object.keys(transform).length === 0) return layer;
    const { params, writes } = transformParams(specs, layer.params, transform);
    if (writes.length === 0) return layer;
    changed = true;
    return { ...layer, params };
  });
  // Nothing in this def declares an axis (or every axis param held a non-numeric value) — hand the caller
  // back exactly what it passed in, rather than a fresh object that differs from it in nothing.
  if (!changed) return def;
  // The cast is the one spot the generic needs help: TS can't prove a spread of `T` is still a `T`. It is —
  // every own property of `def` is carried through, and only `layers` is replaced (by clones of its own).
  return { ...def, layers } as T;
}
