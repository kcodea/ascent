import type { FxDef, FxLayer } from '../def';

/**
 * The workbench's editable model of a single FX layer. A superset of `FxLayer` in editability terms: `life`
 * is `number | null` here (null = "runs to the def's full duration", i.e. `FxLayer.life` omitted), and the
 * anchor/primitive/timing are all directly mutable through the immutable array ops below.
 *
 * ALL of the workbench's layer-list arithmetic lives in THIS file, deliberately free of React and Pixi, so it
 * can be unit-tested headlessly (mirroring the fx package's pure-helper precedent — `def.ts`, `params.ts`).
 * The registry is injected as a `defaultParams` argument rather than imported, so this module stays pure.
 */
export interface EditorLayer {
  primitive: string;
  /** Authoring-only display label. A composition of three bursts is three rows reading "burst"; a name makes
   *  it "impact flash / embers / smoke". Absent = fall back to the primitive id, which is exactly the
   *  pre-naming behaviour, so an unnamed layer is an exact no-op (and serialises as an omission). */
  name?: string;
  anchor: FxLayer['anchor']; // reuse def.ts's anchor type
  at: number; // ms from effect start at which this layer spawns
  life: number | null; // ms this layer lives, or null = "runs to the def's full duration"
  /** Authoring-only: a muted layer is not spawned (and is killed if live) so ONE layer of a composition can
   *  be isolated without deleting — and therefore losing the tuning of — the others. Absent/`false` is the
   *  default and an exact no-op. Pushed to the running effect live via `FxPlayer.setLayerMuted`, so it is
   *  deliberately NOT part of `structureKey`. */
  muted?: boolean;
  /** Authoring-only: the positive counterpart of `muted` — isolate a layer by naming what you WANT rather
   *  than muting everything else one at a time. Once any layer is soloed, only soloed layers play (see
   *  `effectiveMuted`). Reaches the player through the very same `FxPlayer.setLayerMuted` call mute uses, so
   *  it is likewise NOT part of `structureKey`: soloing must not restart the other layers. */
  solo?: boolean;
  params: Record<string, unknown>;
}

/**
 * Deep-copy one param value. Params are plain JSON-ish data (`string | number | boolean`, plus the palette's
 * `number[]` and the curve's `number[][]`), and the nested ARRAYS are the reason this exists: a shallow
 * `{ ...params }` would leave the copy's palette/curve aliasing the original's, so editing one control point
 * on a duplicated layer would silently edit the layer it was duplicated from.
 */
function cloneParamValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneParamValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = cloneParamValue(v);
    return out;
  }
  return value; // primitives (and undefined/null) copy by value
}

/** A params object with every nested array/object copied — see `cloneParamValue`. */
function cloneParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = cloneParamValue(v);
  return out;
}

/** Build a fresh editor layer for a primitive id. `defaultParams` is the primitive's defaulted params
 *  (injected by the caller — keeps this file free of the registry). Anchor defaults to `'travel'`,
 *  `at` to 0, `life` to null (full duration). */
export function createEditorLayer(primitive: string, defaultParams: Record<string, unknown>): EditorLayer {
  return { primitive, anchor: 'travel', at: 0, life: null, params: { ...defaultParams } };
}

/** Append a layer. Returns a NEW array. */
export function addLayer(layers: EditorLayer[], layer: EditorLayer): EditorLayer[] {
  return [...layers, layer];
}

/**
 * Insert a COPY of the layer at `index` directly after it, so a tuned layer can be varied without
 * re-dialling every slider (which is what "Add layer" — always a defaults-only layer — forces).
 *
 * The copy is DEEP: `params` goes through `cloneParams`, so a palette or curve edited on the copy can never
 * write through to the original. Everything else (primitive, anchor, timing, muted) carries over, which is
 * the point — the copy is the same layer until you change it. Returns a NEW array; an out-of-range index is
 * a no-op that still returns a fresh array (matching `moveLayer`/`removeLayer`).
 */
export function duplicateLayer(layers: EditorLayer[], index: number): EditorLayer[] {
  const next = layers.slice();
  if (index < 0 || index >= layers.length) return next;
  const src = layers[index];
  next.splice(index + 1, 0, { ...src, params: cloneParams(src.params) });
  return next;
}

/** Remove the layer at `index`. Returns a NEW array. No-op (returns an equal-length new array) if it would
 *  empty the list — the workbench always stages at least one layer. */
export function removeLayer(layers: EditorLayer[], index: number): EditorLayer[] {
  if (layers.length <= 1) return layers.slice();
  return layers.filter((_, i) => i !== index);
}

/** Move the layer at `index` by `dir` (-1 = earlier, +1 = later). Returns a NEW array. Clamped at both ends
 *  (a no-op move still returns a fresh array). */
export function moveLayer(layers: EditorLayer[], index: number, dir: -1 | 1): EditorLayer[] {
  const next = layers.slice();
  const target = index + dir;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const tmp = next[index];
  next[index] = next[target];
  next[target] = tmp;
  return next;
}

/** Replace the primitive of the layer at `index`, resetting its params to `defaultParams` (the new
 *  primitive's defaults). Anchor and timing are preserved. Returns a NEW array. */
export function setLayerPrimitive(
  layers: EditorLayer[],
  index: number,
  primitive: string,
  defaultParams: Record<string, unknown>,
): EditorLayer[] {
  return layers.map((l, i) => (i === index ? { ...l, primitive, params: { ...defaultParams } } : l));
}

/**
 * Set the ANCHOR of the layer at `index` — which staged point the layer's head follows (`travel` = the
 * source→target arc, `target` = pinned to the target, …). Primitive, timing and params are preserved.
 * Returns a NEW array.
 *
 * Unlike `setLayerParam`/`setLayerTiming` this one legitimately MOVES `structureKey`, so the workbench
 * rebuilds the player: the anchor decides where a layer's head is fed from for its whole life, which isn't
 * something a live instance can be re-pointed at mid-flight without lying about where it has been.
 */
export function setLayerAnchor(
  layers: EditorLayer[],
  index: number,
  anchor: EditorLayer['anchor'],
): EditorLayer[] {
  return layers.map((l, i) => (i === index ? { ...l, anchor } : l));
}

/** Merge a single param key into the layer at `index`. Returns a NEW array with a NEW params object for
 *  that layer (never mutates the input). */
export function setLayerParam(layers: EditorLayer[], index: number, key: string, value: unknown): EditorLayer[] {
  return layers.map((l, i) => (i === index ? { ...l, params: { ...l.params, [key]: value } } : l));
}

/** Set the timing (`at` / `life`) of the layer at `index`. Returns a NEW array. */
export function setLayerTiming(layers: EditorLayer[], index: number, at: number, life: number | null): EditorLayer[] {
  return layers.map((l, i) => (i === index ? { ...l, at, life } : l));
}

/** Set the mute flag of the layer at `index`. Returns a NEW array. `false` is stored as an ABSENT `muted`
 *  rather than `muted: false`, so an untouched composition serialises byte-for-byte as it did before mute
 *  existed. */
export function setLayerMuted(layers: EditorLayer[], index: number, muted: boolean): EditorLayer[] {
  return layers.map((l, i) => {
    if (i !== index) return l;
    if (!muted) {
      const next = { ...l };
      delete next.muted;
      return next;
    }
    return { ...l, muted: true };
  });
}

/** Set the solo flag of the layer at `index`. Returns a NEW array. Off is an ABSENT `solo` for the same
 *  reason mute's off is an absent `muted`: the default has to serialise as an omission. */
export function setLayerSolo(layers: EditorLayer[], index: number, solo: boolean): EditorLayer[] {
  return layers.map((l, i) => {
    if (i !== index) return l;
    if (!solo) {
      const next = { ...l };
      delete next.solo;
      return next;
    }
    return { ...l, solo: true };
  });
}

/** Set (or clear) the authoring-only name of the layer at `index`. Returns a NEW array. An empty/whitespace
 *  name CLEARS the field rather than storing `''` — "no name" has exactly one representation, and clearing
 *  the rename box is how you go back to showing the primitive id. Trimmed; not length-capped here (the
 *  caller coerces through `coerceLayerName` on the way in from storage). */
export function setLayerName(layers: EditorLayer[], index: number, name: string): EditorLayer[] {
  const trimmed = name.trim();
  return layers.map((l, i) => {
    if (i !== index) return l;
    if (trimmed === '') {
      const next = { ...l };
      delete next.name;
      return next;
    }
    return { ...l, name: trimmed };
  });
}

/** Is ANY layer soloed? The switch that flips solo from "no-op" to "only these play". */
export function anySolo(layers: readonly EditorLayer[]): boolean {
  return layers.some((l) => l.solo === true);
}

/**
 * The mute state actually pushed to the player for ONE layer — the whole solo/mute policy, as a pure
 * function of three booleans so it can be checked exhaustively.
 *
 * Standard mixing-desk semantics: **mute always wins**, and while anything is soloed everything that isn't
 * soloed is silenced. With no solos anywhere this is exactly `muted`, i.e. today's behaviour unchanged.
 */
export function effectiveMuted(muted: boolean, solo: boolean, anySoloOn: boolean): boolean {
  if (muted) return true;
  return anySoloOn && !solo;
}

/** `effectiveMuted` for a whole composition, index-aligned with `layers`. Solo is a GLOBAL condition (one
 *  soloed layer silences every other), so this is computed for the list, never per layer in isolation. */
export function effectiveMutes(layers: readonly EditorLayer[]): boolean[] {
  const soloing = anySolo(layers);
  return layers.map((l) => effectiveMuted(l.muted === true, l.solo === true, soloing));
}

/** A signature of the STRUCTURE only — primitive, anchor and order — NOT params, and deliberately NOT
 *  timing, and deliberately NOT `muted`/`solo` (both pushed live via `FxPlayer.setLayerMuted` — isolating
 *  one layer must not restart, and therefore re-roll, all the others), and deliberately NOT `name` (a label
 *  changes nothing about what renders at all).
 *  The workbench keys its player-rebuild effect off this, so only a change the player genuinely
 *  cannot absorb live (add/remove/reorder/primitive-swap/anchor-swap) respawns the effect.
 *
 *  `at`/`life` used to live here and were the reason every step of the At/Life sliders tore the whole
 *  effect down and re-fired it — restarting the effect mid-drag (so you can't judge the change) and
 *  re-rolling a ribbon's noise seed on each respawn (so the LOOK changed while you were tuning TIMING).
 *  They're now pushed live via `FxPlayer.setLayerTiming`, exactly as params go via `setLayerParams`. */
export function structureKey(layers: EditorLayer[]): string {
  return layers.map((l) => `${l.primitive}:${l.anchor}`).join('|');
}

/**
 * The composition duration that exactly contains every layer — the loop trimmed to the effects, with no
 * dead time at the end and nothing cut off. Pure; the caller decides whether to apply it.
 *
 * `null` means "can't fit", and the caller should disable the control rather than guess:
 *  - No layers at all.
 *  - Every layer has `life === null`. A full-life layer runs to whatever the duration happens to be, so it
 *    can't tell you what the duration should be — fitting to those alone is circular.
 *
 * Full-life layers still constrain the result when finite ones exist: a layer starting at 900ms would never
 * play in a 500ms loop, so the fit is held at or above the latest such start plus one step. The result is
 * rounded UP to `step` and clamped to `[min, max]`, so it stays a value the duration dial can actually
 * represent and never trims a layer short to reach it.
 */
export function fitDurationToLayers(
  layers: EditorLayer[],
  bounds: { min: number; max: number; step: number },
): number | null {
  let latestFiniteEnd = -1;
  let latestFullLifeStart = -1;
  for (const l of layers) {
    if (l.life === null) latestFullLifeStart = Math.max(latestFullLifeStart, l.at);
    else latestFiniteEnd = Math.max(latestFiniteEnd, l.at + l.life);
  }
  if (latestFiniteEnd < 0) return null;
  const needed = Math.max(latestFiniteEnd, latestFullLifeStart + bounds.step);
  const snapped = Math.ceil(needed / bounds.step) * bounds.step;
  return Math.min(bounds.max, Math.max(bounds.min, snapped));
}

/** Build the `FxDef` the player consumes from the editor layers. `life = null` maps to `FxLayer.life`
 *  omitted (undefined); params pass through by reference (the player treats the def as read-only). */
export function toDef(id: string, durationMs: number, layers: EditorLayer[]): FxDef {
  return {
    id,
    duration: durationMs,
    layers: layers.map((l) => ({
      primitive: l.primitive,
      anchor: l.anchor,
      at: l.at,
      life: l.life ?? undefined,
      params: l.params,
    })),
  };
}
