import { Container, RenderTexture, Sprite, Texture, type Filter, type Renderer } from 'pixi.js';
import { BlurFilter } from 'pixi.js';
import { listDefs } from './fxDefs';
import { FILTERS } from './filterRegistry';
import { CORE_BLUR_ID } from './filterStack';

/**
 * PRE-LINK THE FILTER PROGRAMS THE COMMITTED DEFS USE (gameplay perf pass 2026-10-09).
 *
 * `prewarmFxMaterials` links every PRIMITIVE's shader at load, but a def layer's FILTERS (Bloom, Glow, Advanced
 * Bloom, RGB split, motion blur … from `filterRegistry.ts`, plus the core Blur) compile their programs the first
 * time Pixi applies them. That link is a blocking `getProgramParameter(LINK_STATUS)`: measured on the prod build at
 * 97-132 ms inside ONE frame the first time a hand minion was dropped on the board (a Bloom on the landing FX,
 * `applyFilter` -> `_createProgramData`), i.e. a 0.1 s freeze the first time each filtered effect plays in a session.
 *
 * Each step here applies ONE filter kind to an 8 px sprite and renders it into a throwaway texture, which is all it
 * takes for Pixi to link (and cache, by source) every pass that filter has. One step per filter kind, so the
 * scheduler can spread them across macrotasks exactly like the primitive warm-up. The warmed filters are KEPT,
 * anchored per renderer: Pixi drops a program's data when its last user is destroyed, and freeing a compiled program
 * is the §3b trap (`docs/performance.md`).
 */
const warmAnchors = new WeakMap<Renderer, Filter[]>();

/** The filter ids at least one committed def switches on (`<id>On: true`), plus the core blur when any layer blurs. */
export function filterIdsInUse(defs: ReadonlyArray<{ layers?: ReadonlyArray<{ params?: unknown }> }> = listDefs()): string[] {
  const ids = new Set<string>();
  for (const def of defs) {
    for (const layer of def.layers ?? []) {
      const p = (layer.params ?? {}) as Record<string, unknown>;
      for (const f of FILTERS) if (p[`${f.id}On`] === true) ids.add(f.id);
      if (typeof p.blur === 'number' && p.blur > 0) ids.add(CORE_BLUR_ID);
    }
  }
  return [...ids];
}

function makeFilter(id: string): Filter | null {
  if (id === CORE_BLUR_ID) return new BlurFilter({ strength: 1, quality: 5 }); // the FilterStack's own core blur
  const spec = FILTERS.find((f) => f.id === id);
  return spec ? spec.make() : null;
}

/** One warm-up step per filter kind in use. Best-effort: a failed link just leaves that filter to link on first use. */
export function filterPrewarmSteps(renderer: Renderer | null): Array<() => void> {
  if (!renderer) return [];
  return filterIdsInUse().map((id) => (): void => {
    let rt: RenderTexture | null = null;
    let stage: Container | null = null;
    try {
      const filter = makeFilter(id);
      if (!filter) return;
      const list = warmAnchors.get(renderer) ?? [];
      list.push(filter);
      warmAnchors.set(renderer, list);
      stage = new Container();
      const sprite = new Sprite(Texture.WHITE);
      sprite.width = sprite.height = 8;
      sprite.filters = [filter];
      stage.addChild(sprite);
      rt = RenderTexture.create({ width: 16, height: 16 });
      renderer.render({ container: stage, target: rt });
    } catch (e) {
      if (import.meta.env.DEV) console.warn(`[fx] filter pre-warm (${id}) failed — its first use will link it:`, e);
    } finally {
      // The sprite + container + target go; the FILTER (and with it the linked program) stays anchored above.
      if (stage) { for (const c of stage.children) (c as Sprite).filters = []; stage.destroy({ children: true }); }
      rt?.destroy(true);
    }
  });
}
