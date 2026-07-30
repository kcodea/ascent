import raw from './presets.json';
import { parsePresetTable, type PresetTable } from './presetTable';

let cached: PresetTable | null = null;

/**
 * The shipped table, parsed once on FIRST USE and cached.
 *
 * Deliberately lazy: `parsePresetTable` THROWS on a malformed file (see its header comment), which is safe
 * only because the parse never runs unless the DEV-only gallery asks for it. A top-level
 * `const TABLE = parsePresetTable(raw)` would turn a bad JSON edit into a hard crash at module load for
 * every player — the exact reason `choreo/bindings.ts` uses `devError` instead of throwing.
 */
export function presetTable(): PresetTable {
  if (cached === null) cached = parsePresetTable(raw);
  return cached;
}

export { applyVariant, type VariantResult } from './applyVariant';
export type { PresetTable, PresetArchetype, VariantAxis, VariantOverride } from './presetTable';
