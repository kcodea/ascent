import type { FxDef } from './def';

/**
 * Per-call PALETTE recolor: swap the `palette` param on every palette-bearing layer of a def about to play,
 * so one committed composition can fire in a caller-chosen colour.
 *
 * ── what this is, and the line it does NOT cross ──────────────────────────────────────────────────────────
 * A UNIFORM, whole-def colour swap — the same 4-stop rim→core palette written onto every layer that carries
 * one. It is deliberately in the family of `scaleDef`'s `scale`/`intensity`: a global axis the CALLER knows
 * and the author cannot ("play this composition in THIS colour"). It is NOT the per-call parameter channel
 * `scaleDef`'s header rules out — a caller cannot reach an arbitrary param on a specific layer through here,
 * it can only say "this palette, everywhere". Anything finer stays a separate def.
 *
 * Why palettes specifically: an FX primitive's colour comes from its `palette` param (four rim→core stops,
 * see `palettes.ts` / the `tintMode: 'palette'` path in `particleMaterial.ts`), so recolouring a
 * burst / shockwave / emitter IS replacing that array. A layer with no `palette` (a fixed-colour filter, or a
 * `tintMode: 'texture'` layer that keeps its art's own rgb) is left untouched.
 *
 * Exact no-op contract, matching `scaleDef`: an absent/empty palette — or a def with no palette-bearing
 * layer — returns the input BY IDENTITY, so the object is not copied and every existing caller and seeded
 * replay is byte-for-byte unchanged. Generic over the def type so a `StoredFxDef` keeps its
 * `version`/`seed`/`label`/`tags` through the call (same reason `scaleDef`/`applyVariant` are). The base is
 * never mutated; only the layers that change are cloned.
 */
export function recolorDef<T extends FxDef>(def: T, palette: readonly number[] | undefined): T {
  if (!palette || palette.length === 0) return def;
  const stops = [...palette];
  let changed = false;
  const layers = def.layers.map((layer) => {
    if (!Array.isArray((layer.params as { palette?: unknown }).palette)) return layer;
    changed = true;
    return { ...layer, params: { ...layer.params, palette: [...stops] } };
  });
  // No palette-bearing layer touched → the recolor did nothing; hand back the input untouched.
  return changed ? ({ ...def, layers } as T) : def;
}
