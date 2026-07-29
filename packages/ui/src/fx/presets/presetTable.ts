/**
 * The preset table: which archetypes exist, what each starts from, and the shared variant axes.
 *
 * Hand-rolled validation rather than a schema library — the `ui` package has no zod, following
 * `choreo/bindings.ts`. Unlike that file, this one THROWS rather than dropping bad entries: a
 * half-loaded gallery would present a silently incomplete menu, whereas a dropped binding is
 * recoverable. Unlike `bindings.json`, this table must therefore NOT be parsed eagerly at module
 * load from a static import: `bindings.ts` uses `devError` precisely because it ships in the
 * production bundle. Parse this one lazily from the (DEV-only) gallery, so a throw can only ever
 * reach an author.
 */

/** Keys that must never be used to index into an object we then assign to: `out['__proto__'] = x` invokes
 *  the inherited prototype setter. Same guard, same reason, as `choreo/bindings.ts`. */
export const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** True for a plain object we can safely index into — excludes `null` and arrays. Copied from
 *  `choreo/bindings.ts`'s `isRecord`, which established this exact narrowing for the same reason. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

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
  if (!isRecord(raw)) throw new Error(`preset table: ${what} must be an object`);
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
  if (!isRecord(raw)) throw new Error('preset table: not an object');
  const t = raw;

  if (t.variantAxes !== undefined && !Array.isArray(t.variantAxes)) {
    throw new Error('preset table: variantAxes must be an array');
  }
  const axes: VariantAxis[] = (Array.isArray(t.variantAxes) ? t.variantAxes : []).map((a, i) => {
    if (!isRecord(a)) throw new Error(`preset table: variantAxes[${i}] must be an object`);
    const o = a;
    const id = str(o.id, `variantAxes[${i}] id`);
    if (UNSAFE_KEYS.includes(id)) throw new Error(`preset table: variantAxes[${i}] uses reserved id '${id}'`);
    return {
      id,
      label: str(o.label, `axis '${id}' label`),
      transform: numberMap(o.transform, `axis '${id}' transform`),
    };
  });
  const axisIds = new Set(axes.map((a) => a.id));
  if (axisIds.size !== axes.length) {
    const dupe = axes.map((a) => a.id).find((id, i) => axes.findIndex((a2) => a2.id === id) !== i);
    throw new Error(`preset table: duplicate variant axis id '${dupe}'`);
  }

  if (t.archetypes !== undefined && !Array.isArray(t.archetypes)) {
    throw new Error('preset table: archetypes must be an array');
  }
  const seen = new Set<string>();
  const archetypes: PresetArchetype[] = (Array.isArray(t.archetypes) ? t.archetypes : []).map((a, i) => {
    if (!isRecord(a)) throw new Error(`preset table: archetypes[${i}] must be an object`);
    const o = a;
    const id = str(o.id, `archetypes[${i}] id`);
    if (UNSAFE_KEYS.includes(id)) throw new Error(`preset table: archetypes[${i}] uses reserved id '${id}'`);
    if (seen.has(id)) throw new Error(`preset table: duplicate archetype id '${id}'`);
    seen.add(id);

    if (o.variants !== undefined && !Array.isArray(o.variants)) {
      throw new Error(`preset table: archetype '${id}' variants must be an array`);
    }
    const variants = (Array.isArray(o.variants) ? o.variants : []).map((v) => str(v, `archetype '${id}' variant`));
    for (const v of variants) {
      if (!axisIds.has(v)) throw new Error(`preset table: archetype '${id}' names undeclared axis '${v}'`);
    }

    const overrides: Record<string, VariantOverride> = {};
    if (o.overrides !== undefined) {
      if (!isRecord(o.overrides)) throw new Error(`preset table: archetype '${id}' overrides must be an object`);
      for (const [k, v] of Object.entries(o.overrides)) {
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
