import type { FxDef, FxLayer } from './def';
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
 *     draws are taken; that is inherent to "more particles" and is why the two axes are separate. `time`'s
 *     position is stated in full on {@link FxScaleAxes.time}.
 *
 * ── why `time` is not just "params" ──────────────────────────────────────────────────────────────────────
 * `scale` and `intensity` are pure param transforms. `time` is NOT, and cannot be: two things are called
 * "life" in this system, and they have to move together.
 *
 *   • `FxLayer.life` — the layer's WINDOW: how long the layer exists, in ms from its `at`.
 *   • a primitive's `params.life` — one PARTICLE's lifetime.
 *
 * `playDef` fires via `fireOnce`, and `player.ts`'s rule for that pass is: a layer that DECLARES a `life` is
 * bounded by that window (only an undeclared one is allowed to run past `def.duration` to true completion).
 * Thirteen of the shipped defs declare layer windows — `damage-burst`'s "hot core" is a 240ms particle inside
 * a 320ms window — so multiplying `params.life` alone would push particles past a window that did not move,
 * and they would be cut off mid-flight with no error anywhere. So `timeDef` rescales the def's whole temporal
 * FRAME: every layer's `at`, `life` and `travelMs`, the def's `duration`, and the duration params, together.
 * `bow` is left alone (a spatial fraction, not a time).
 */

export interface FxScaleAxes {
  /** Geometric multiplier: sizes, emission radii, extents, speeds. Default 1. */
  scale?: number;
  /** Quantity multiplier: particle counts, emission rates, ring counts. Default 1. */
  intensity?: number;
  /**
   * Temporal multiplier: the effect lasts this many times longer, **at the same velocities**. Default 1.
   *
   * Distinct from `PlayDefOptions.speed`, which rescales the playback CLOCK — at `speed: 0.5` particles also
   * move at half speed and cover the same ground. At `time: 2` they keep their px/sec and therefore travel
   * twice as far before they die. Both are legitimate; they are different effects, and the hand-written
   * `impactDust`/`impactPulse` per-call `life` multipliers were the second one.
   *
   * **What it moves:** every layer's `at`, `life` and `travelMs`; `def.duration`; and every param declaring
   * `axis: 'time'` (a duration in ms) or `axis: 'timeInverse'` (a per-second rate whose period is the thing
   * being stretched — see `FxParamMeta.axis`).
   *
   * **What it does NOT move:** velocities and accelerations (`speed`, `gravity`, ribbon `drain`) — that is
   * the whole distinction from `speed`. Nor `rate` on `emitter`/`smoke`, which is discussed below because it
   * is the one genuinely arguable case.
   *
   * ── `rate` (particles per second) — the deliberate decision ─────────────────────────────────────────────
   * `rate` is **off this axis**, and stays where it is on `intensity`. Three reasons, in order of weight:
   *
   *  1. **A param has ONE axis.** `rate` already declares `axis: 'intensity'` — it is the literal "how many"
   *     dial for a continuous emitter. Putting it on `time` as well would need `axis` to become a list, and
   *     the two callers would then fight over the same slider.
   *  2. **Dividing it would contradict the dial's own meaning.** `time: 2` means "the same effect, for twice
   *     as long". A plume that runs twice as long at half the emission rate is not that — it is a *thinner*
   *     plume, and at `rate`'s `min` of 5 it would clamp out of usefulness quickly.
   *  3. It leaves the consequence honest and stateable: for `emitter`/`smoke`, a one-shot's emit window IS
   *     `params.life` (see `withinEmitWindow`), so `time: k` emits ≈ k× as many motes. That is the same
   *     shape as `intensity` — the stream is the SAME stream, continued, so the motes that were already
   *     there are byte-identical — and it is inherent to "it runs for longer".
   *
   * A caller that wants longer-but-not-denser passes `intensity: 1 / time` alongside; nothing else can
   * express it, and nothing else should try to.
   *
   * **The determinism guarantee that IS structural**: `time` reaches no `count` param. `burst` emits its
   * whole wave at t=0 and draws exactly 7 values per particle (`burst.test.ts` guards the count textually),
   * so a seeded burst draws the identical sequence in the identical order at any `time`. That is the case
   * locked seeds depend on, and it holds by construction, not by measurement.
   */
  time?: number;
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
export function axisTransform(
  specs: FxParamSpecs,
  scale: number,
  intensity: number,
  time = 1,
): Record<string, number> {
  // `1 / time` rather than a second normalise: `time` has already been through `normalizeAxis`, so it is a
  // finite number strictly greater than 0 and the reciprocal is finite and positive too.
  const mults: Record<string, number> = { scale, intensity, time, timeInverse: 1 / time };
  const out: Record<string, number> = {};
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    if (spec.kind !== 'slider' || spec.axis === undefined) continue;
    const mult = mults[spec.axis];
    if (mult !== 1) out[key] = mult;
  }
  return out;
}

/**
 * PURE: one millisecond quantity stretched by the time axis, with the float dust cleared.
 *
 * Six decimals is `settleParam`'s own rounding, borrowed for the same reason: `100 * 1.1` is
 * `110.00000000000001`, and a def's timings are read back by the workbench and diffed against the file. There
 * is no clamp here and there must not be — unlike a slider, a layer window has no declared range, and
 * inventing one would silently truncate exactly the effects this exists to stop truncating.
 */
export function scaleMs(ms: number, time: number): number {
  return Number((ms * time).toFixed(6));
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
  const time = normalizeAxis(axes.time);
  if (scale === 1 && intensity === 1 && time === 1) return def;

  let changed = false;
  const layers = def.layers.map((layer) => {
    // The layer's WINDOW moves with the time axis whatever its primitive is — including a primitive that
    // isn't registered, whose params we decline to touch below. A window is the player's arithmetic, not the
    // primitive's, so it is knowable here either way.
    const timed = time === 1 ? layer : scaleLayerTiming(layer, time);
    if (timed !== layer) changed = true;
    const specs = getPrimitive(layer.primitive)?.params;
    if (specs === undefined) return timed;
    const transform = axisTransform(specs, scale, intensity, time);
    if (Object.keys(transform).length === 0) return timed;
    const { params, writes } = transformParams(specs, timed.params, transform);
    if (writes.length === 0) return timed;
    changed = true;
    return { ...timed, params };
  });
  // Nothing in this def declares an axis (or every axis param held a non-numeric value) — hand the caller
  // back exactly what it passed in, rather than a fresh object that differs from it in nothing.
  if (!changed && time === 1) return def;
  // The cast is the one spot the generic needs help: TS can't prove a spread of `T` is still a `T`. It is —
  // every own property of `def` is carried through, and only `layers`/`duration` are replaced.
  return { ...def, duration: time === 1 ? def.duration : scaleMs(def.duration, time), layers } as T;
}

/**
 * PURE: one layer's SCHEDULE stretched by the time axis — `at`, `life` and `travelMs`, the three fields of
 * `FxLayer` measured in milliseconds. Returns the input by identity when nothing moves, so `scaleDef`'s
 * change tracking stays exact.
 *
 * `bow` is deliberately absent: it is a fraction of the source→target span (a shape), not a time. `primitive`,
 * `anchor` and `params` are not this function's business — the params go through `transformParams`.
 *
 * Verified against `FxLayer` in `def.ts` rather than assumed; if a fourth ms-valued field is ever added
 * there, it belongs here and `scaleDef.test.ts`'s field census is what will fail until it is.
 */
function scaleLayerTiming<L extends FxLayer>(layer: L, time: number): L {
  const at = scaleMs(layer.at, time);
  const life = layer.life === undefined ? undefined : scaleMs(layer.life, time);
  const travelMs = layer.travelMs === undefined ? undefined : scaleMs(layer.travelMs, time);
  if (at === layer.at && life === layer.life && travelMs === layer.travelMs) return layer;
  const out = { ...layer, at };
  if (life !== undefined) out.life = life;
  if (travelMs !== undefined) out.travelMs = travelMs;
  return out;
}
