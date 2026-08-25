import { matchesParamQuery, type FxParamSpecs } from '../params';
import type { EditorLayer } from './layerModel';

/**
 * The workbench's ⌘K command palette search model. Pure — no React, no DOM — so the ranking/matching rules
 * can be unit-tested headlessly (mirrors the `layerModel.ts` / `dragEdit.ts` precedent). The palette itself
 * just calls `buildCommands` on every keystroke and renders the result.
 */
export type CommandKind = 'layer' | 'param' | 'action';

export interface CommandItem {
  id: string;
  kind: CommandKind;
  label: string;
  hint?: string;
  layerIndex?: number;
  paramKey?: string;
  actionId?: string;
}

/** Everything `buildCommands` can search across, injected by the caller — keeps this file free of the
 *  registry and the editor's React state. */
export interface CommandSources {
  layers: readonly EditorLayer[];
  specsByPrimitive: Record<string, FxParamSpecs>;
  actions: readonly { id: string; label: string; hint?: string }[];
}

/** A layer's display label — its authored name, or the primitive id when unnamed (mirrors the row label the
 *  layer list itself falls back to). */
function layerLabel(layer: EditorLayer): string {
  return layer.name ?? layer.primitive;
}

/** Case-insensitive substring match against the layer's display name OR its primitive id, so "burst" finds
 *  every burst layer even when each has been renamed. `q` is already trimmed + lowercased by the caller. */
function layerMatches(layer: EditorLayer, q: string): boolean {
  return layerLabel(layer).toLowerCase().includes(q) || layer.primitive.toLowerCase().includes(q);
}

function layerCommand(layer: EditorLayer, index: number): CommandItem {
  return {
    id: `layer:${index}`,
    kind: 'layer',
    label: layerLabel(layer),
    // When the layer has an authored name the primitive id itself is otherwise invisible in the palette —
    // surface it as the hint. An unnamed layer's label already IS the primitive, so no hint is needed.
    hint: layer.name !== undefined ? layer.primitive : undefined,
    layerIndex: index,
  };
}

function actionCommand(action: { id: string; label: string; hint?: string }): CommandItem {
  return { id: `action:${action.id}`, kind: 'action', label: action.label, hint: action.hint, actionId: action.id };
}

/**
 * Build the palette's result list for `query`.
 *
 * Empty/whitespace query: actions first, then one jump per layer — no params (a param list with nothing
 * typed yet would just be every param of every layer, which is noise, not a starting point).
 *
 * Non-empty query: the union of matching layer jumps, matching param jumps (every param of every layer's
 * primitive spec, selection-agnostic — a param can be reached from the palette without first selecting its
 * layer), and matching actions — in that order. Params are grouped by `layerIndex` ascending, then `paramKey`
 * ascending, regardless of the specs' own declaration order, so the result is deterministic independent of
 * how a primitive happens to order its spec record.
 */
export function buildCommands(sources: CommandSources, query: string): CommandItem[] {
  const q = query.trim().toLowerCase();

  if (q === '') {
    const actions = sources.actions.map(actionCommand);
    const layers = sources.layers.map((layer, index) => layerCommand(layer, index));
    return [...actions, ...layers];
  }

  const layerItems = sources.layers
    .map((layer, index) => (layerMatches(layer, q) ? layerCommand(layer, index) : null))
    .filter((c): c is CommandItem => c !== null);

  const paramItems: CommandItem[] = [];
  sources.layers.forEach((layer, layerIndex) => {
    const specs = sources.specsByPrimitive[layer.primitive];
    if (specs === undefined) return;
    const layerName = layerLabel(layer);
    for (const key of Object.keys(specs)) {
      const spec = specs[key];
      if (!matchesParamQuery(spec, key, q)) continue;
      paramItems.push({
        id: `param:${layerIndex}:${key}`,
        kind: 'param',
        label: `${spec.label} · ${layerName}`,
        hint: spec.help,
        layerIndex,
        paramKey: key,
      });
    }
  });
  paramItems.sort((a, b) => {
    const byLayer = (a.layerIndex ?? 0) - (b.layerIndex ?? 0);
    if (byLayer !== 0) return byLayer;
    return (a.paramKey ?? '').localeCompare(b.paramKey ?? '');
  });

  const actionItems = sources.actions.filter((a) => a.label.toLowerCase().includes(q)).map(actionCommand);

  return [...layerItems, ...paramItems, ...actionItems];
}
