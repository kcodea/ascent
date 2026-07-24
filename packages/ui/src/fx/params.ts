/**
 * A primitive's parameters are declared ONCE, here. The params type and the editor UI are both derived
 * from the same record, so it is impossible to add a parameter without a label, or to label a parameter
 * that does not exist — the failure mode that left two Trail tuner sliders blank for months.
 */
export type FxParamSpec =
  | { kind: 'slider'; label: string; group?: string; help?: string; min: number; max: number; step: number; default: number }
  | { kind: 'toggle'; label: string; group?: string; help?: string; default: boolean }
  | { kind: 'color'; label: string; group?: string; help?: string; default: number }
  | { kind: 'enum'; label: string; group?: string; help?: string; options: readonly string[]; default: string };

export type FxParamSpecs = Record<string, FxParamSpec>;

/** The params object a spec record describes. Derived — never hand-written alongside the specs.
 *  Enum params resolve to a union of their own `options` (not just the default), so a value that is
 *  valid at runtime is valid at compile time and nothing else is. */
export type ParamsOf<S extends FxParamSpecs> = {
  [K in keyof S]: S[K] extends { kind: 'enum'; options: readonly (infer O)[] } ? O : S[K]['default'];
};

export function defaultsOf<S extends FxParamSpecs>(specs: S): ParamsOf<S> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(specs)) out[key] = specs[key].default;
  return out as ParamsOf<S>;
}

/** Merge caller-supplied values over the defaults. Values that fail their spec's type check are dropped
 *  in favour of the default, never parsed or converted. Never throws: a bad value in a saved def must
 *  degrade to the default rather than break the effect. */
export function coerceParams<S extends FxParamSpecs>(specs: S, raw: unknown): ParamsOf<S> {
  const out = defaultsOf(specs) as Record<string, unknown>;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out as ParamsOf<S>;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(specs)) {
    if (!(key in src)) continue;
    const spec = specs[key];
    const v = src[key];
    switch (spec.kind) {
      case 'slider':
      case 'color':
        if (typeof v === 'number' && Number.isFinite(v)) {
          out[key] = spec.kind === 'slider' ? Math.min(spec.max, Math.max(spec.min, v)) : v;
        }
        break;
      case 'toggle':
        if (typeof v === 'boolean') out[key] = v;
        break;
      case 'enum':
        if (typeof v === 'string' && spec.options.includes(v)) out[key] = v;
        break;
    }
  }
  return out as ParamsOf<S>;
}

/** Dev-time invariant: catch a spec that contradicts itself (a default outside its own range, an enum
 *  default not in its own options) at registration rather than as a silently wrong slider months later.
 *  Returns the problems rather than throwing, so the caller decides how loud to be. */
export function validateSpecs(specs: FxParamSpecs): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    if (spec.kind === 'slider') {
      if (spec.min > spec.max) problems.push(`'${key}': min ${spec.min} exceeds max ${spec.max}`);
      if (spec.default < spec.min || spec.default > spec.max) {
        problems.push(`'${key}': default ${spec.default} is outside [${spec.min}, ${spec.max}]`);
      }
    }
    if (spec.kind === 'enum' && !spec.options.includes(spec.default)) {
      problems.push(`'${key}': default '${spec.default}' is not one of its options`);
    }
  }
  return problems;
}
