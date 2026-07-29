/**
 * The preset table: which archetypes exist, what each starts from, and the shared variant axes.
 *
 * Hand-rolled validation rather than a schema library — the `ui` package has no zod, and
 * `choreo/bindings.ts` set the precedent for parsing a small authored JSON file this way.
 */

/** Keys that must never be used to index into an object we then assign to: `out['__proto__'] = x` invokes
 *  the inherited prototype setter. Same guard, same reason, as `choreo/bindings.ts`. */
export const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** Slider param name → multiplier. Applied to every layer that has that slider param. */
export type VariantTransform = Record<string, number>;

/** Slider param name → ABSOLUTE value. Applied after the transform, and wins. */
export type VariantOverride = Record<string, number>;

export interface VariantAxis {
  id: string;
  label: string;
  transform: VariantTransform;
}

export interface PresetArchetype {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  /** The def id this archetype starts from. Must exist in `fxDefs`. */
  base: string;
  /** Axis ids offered for this archetype. An axis omitted here simply isn't offered. */
  variants: string[];
  /** Per-variant absolute pins, for where a shared rule reads badly on this base. */
  overrides?: Record<string, VariantOverride>;
}

export interface PresetTable {
  version: number;
  archetypes: PresetArchetype[];
  variantAxes: VariantAxis[];
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`preset table: ${what} must be a non-empty string`);
  return v;
}

function numberMap(raw: unknown, what: string): Record<string, number> {
  if (raw === null || typeof raw !== 'object') throw new Error(`preset table: ${what} must be an object`);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (UNSAFE_KEYS.includes(k)) throw new Error(`preset table: ${what} uses reserved key '${k}'`);
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`preset table: ${what}.${k} must be a finite number`);
    }
    out[k] = v;
  }
  return out;
}

export function parsePresetTable(raw: unknown): PresetTable {
  if (raw === null || typeof raw !== 'object') throw new Error('preset table: not an object');
  const t = raw as Record<string, unknown>;

  const axes: VariantAxis[] = (Array.isArray(t.variantAxes) ? t.variantAxes : []).map((a) => {
    const o = a as Record<string, unknown>;
    return {
      id: str(o.id, 'axis id'),
      label: str(o.label, `axis '${String(o.id)}' label`),
      transform: numberMap(o.transform, `axis '${String(o.id)}' transform`),
    };
  });
  const axisIds = new Set(axes.map((a) => a.id));
  if (axisIds.size !== axes.length) throw new Error('preset table: duplicate variant axis id');

  const seen = new Set<string>();
  const archetypes: PresetArchetype[] = (Array.isArray(t.archetypes) ? t.archetypes : []).map((a) => {
    const o = a as Record<string, unknown>;
    const id = str(o.id, 'archetype id');
    if (seen.has(id)) throw new Error(`preset table: duplicate archetype id '${id}'`);
    seen.add(id);

    const variants = (Array.isArray(o.variants) ? o.variants : []).map((v) => str(v, `archetype '${id}' variant`));
    for (const v of variants) {
      if (!axisIds.has(v)) throw new Error(`preset table: archetype '${id}' names undeclared axis '${v}'`);
    }

    const overrides: Record<string, VariantOverride> = {};
    if (o.overrides !== undefined) {
      for (const [k, v] of Object.entries(o.overrides as Record<string, unknown>)) {
        if (UNSAFE_KEYS.includes(k)) throw new Error(`preset table: archetype '${id}' override uses reserved key '${k}'`);
        if (!axisIds.has(k)) throw new Error(`preset table: archetype '${id}' overrides undeclared axis '${k}'`);
        overrides[k] = numberMap(v, `archetype '${id}' override '${k}'`);
      }
    }

    return { id, label: str(o.label, `archetype '${id}' label`), icon: str(o.icon, `archetype '${id}' icon`),
             blurb: str(o.blurb, `archetype '${id}' blurb`), base: str(o.base, `archetype '${id}' base`),
             variants, ...(Object.keys(overrides).length > 0 ? { overrides } : {}) };
  });

  return { version: typeof t.version === 'number' ? t.version : 1, archetypes, variantAxes: axes };
}
