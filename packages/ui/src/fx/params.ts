/**
 * A primitive's parameters are declared ONCE, here. The params type and the editor UI are both derived
 * from the same record, so it is impossible to add a parameter without a label, or to label a parameter
 * that does not exist — the failure mode that left two Trail tuner sliders blank for months.
 */
export type FxParamSpec =
  | { kind: 'slider'; label: string; group?: string; help?: string; min: number; max: number; step: number; default: number }
  | { kind: 'toggle'; label: string; group?: string; help?: string; default: boolean }
  | { kind: 'color'; label: string; group?: string; help?: string; default: number }
  | { kind: 'enum'; label: string; group?: string; help?: string; options: readonly string[]; default: string }
  | {
      kind: 'palette';
      label: string;
      group?: string;
      help?: string;
      /** Four 0xRRGGBB stops, rim → core. */
      default: readonly [number, number, number, number];
      /** Named presets a picker can seed the whole tuple from (id → tuple). */
      presets?: Record<string, readonly [number, number, number, number]>;
    }
  | {
      kind: 'curve';
      label: string;
      group?: string;
      help?: string;
      /** Control points [t, v], t & v in [0,1], sorted ascending by t. Sampled at normalized life
       *  (0 = birth, 1 = death) to yield a multiplier. At least 2 points. */
      default: readonly (readonly [number, number])[];
      presets?: Record<string, readonly (readonly [number, number])[]>;
    };

export type FxParamSpecs = Record<string, FxParamSpec>;

/** The params object a spec record describes. Derived — never hand-written alongside the specs.
 *  Enum params resolve to a union of their own `options` (not just the default), so a value that is
 *  valid at runtime is valid at compile time and nothing else is. Palette params resolve to a concrete
 *  mutable 4-number tuple (not `S[K]['default']`'s `readonly [...]`), so callers can index/spread it
 *  freely without fighting readonly-ness that the spec itself doesn't need at the value level. */
export type ParamsOf<S extends FxParamSpecs> = {
  [K in keyof S]: S[K] extends { kind: 'enum'; options: readonly (infer O)[] }
    ? O
    : S[K] extends { kind: 'palette' }
      ? [number, number, number, number]
      : S[K] extends { kind: 'curve' }
        ? [number, number][]
        : S[K]['default'];
};

export function defaultsOf<S extends FxParamSpecs>(specs: S): ParamsOf<S> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    // Palette defaults are arrays — copy so two instances (or two calls) never alias the same tuple and
    // mutate each other's colours through it. Curve defaults are nested arrays — deep-copy each [t, v] pair
    // for the same reason (a shallow spread would still alias the inner point arrays).
    if (spec.kind === 'palette') out[key] = [...spec.default];
    else if (spec.kind === 'curve') out[key] = spec.default.map((pt) => [pt[0], pt[1]]);
    else out[key] = spec.default;
  }
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
      case 'palette':
        if (
          Array.isArray(v) &&
          v.length === 4 &&
          v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 0xffffff)
        ) {
          out[key] = [...v]; // fresh array — never alias the caller's
        }
        break;
      case 'curve':
        if (
          Array.isArray(v) &&
          v.length >= 2 &&
          v.every(
            (pt) =>
              Array.isArray(pt) &&
              pt.length === 2 &&
              typeof pt[0] === 'number' &&
              Number.isFinite(pt[0]) &&
              typeof pt[1] === 'number' &&
              Number.isFinite(pt[1]),
          )
        ) {
          // Fresh normalized copy — clamp t & v to [0,1], sort ascending by t. Never alias the caller's
          // arrays (mirrors the palette case's discipline); the sampler relies on sorted-by-t input.
          const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
          out[key] = (v as [number, number][])
            .map((pt) => [clamp01(pt[0]), clamp01(pt[1])] as [number, number])
            .sort((a, b) => a[0] - b[0]);
        }
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
    if (spec.kind === 'palette') {
      if (spec.default.length !== 4) {
        problems.push(`'${key}': palette default must have exactly 4 stops (got ${spec.default.length})`);
      } else if (spec.default.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffffff)) {
        problems.push(`'${key}': palette default has a stop outside [0, 0xFFFFFF]`);
      }
    }
    if (spec.kind === 'curve') {
      const pts = spec.default;
      if (pts.length < 2) {
        problems.push(`'${key}': curve default must have at least 2 points (got ${pts.length})`);
      } else {
        const badPoint = pts.some(
          (pt) =>
            !Array.isArray(pt) ||
            pt.length !== 2 ||
            !Number.isFinite(pt[0]) ||
            !Number.isFinite(pt[1]) ||
            pt[0] < 0 ||
            pt[0] > 1 ||
            pt[1] < 0 ||
            pt[1] > 1,
        );
        if (badPoint) {
          problems.push(`'${key}': curve default has a point with t or v outside [0, 1]`);
        }
        let sorted = true;
        for (let i = 1; i < pts.length; i++) {
          if (pts[i][0] < pts[i - 1][0]) sorted = false;
        }
        if (!sorted) problems.push(`'${key}': curve default must be sorted ascending by t`);
      }
    }
  }
  return problems;
}
