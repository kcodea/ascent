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
      /** Control points [t, v], t in [0,1] and v in [0, vMax], sorted ascending by t. Sampled at normalized
       *  life (0 = birth, 1 = death) to yield a multiplier. At least 2 points. */
      default: readonly (readonly [number, number])[];
      /** Upper bound for a control point's value (default 1). Above 1 lets the curve act as a multiplier
       *  that can EXCEED the base value — e.g. a smoke billow that grows past its base size, or a ribbon
       *  that bulges in the middle — instead of one that can only ever reduce it. Omitted ⇒ 1, so every
       *  existing curve param is unaffected. The HORIZONTAL axis (t) is always normalized to [0,1]. */
      vMax?: number;
      presets?: Record<string, readonly (readonly [number, number])[]>;
    }
  | {
      /**
       * A particle silhouette picked from the RUNTIME shape library (`shapeLibrary.ts`): the built-in
       * `SHAPE_NAMES` plus whatever art the owner has imported on this machine. Deliberately NOT an `enum`
       * — an enum's `options` are fixed at spec-declaration time, and the whole point here is that the set
       * of valid ids grows when a user imports a PNG/SVG. The value is just the id string; validity is a
       * runtime question the render path already answers (an unknown id falls back to a built-in).
       */
      kind: 'shape';
      label: string;
      group?: string;
      help?: string;
      /** A shape id — a built-in `SHAPE_NAMES` entry (imports can't be a default: they don't exist yet). */
      default: string;
    };

export type FxParamSpecs = Record<string, FxParamSpec>;

/** The params object a spec record describes. Derived — never hand-written alongside the specs.
 *  Enum params resolve to a union of their own `options` (not just the default), so a value that is
 *  valid at runtime is valid at compile time and nothing else is. Palette params resolve to a concrete
 *  mutable 4-number tuple (not `S[K]['default']`'s `readonly [...]`), so callers can index/spread it
 *  freely without fighting readonly-ness that the spec itself doesn't need at the value level. Shape params
 *  resolve to plain `string` — the opposite of enum's narrowing, and on purpose: the valid ids are a runtime
 *  registry (built-ins + the user's imports), so narrowing to the declared default would make every custom
 *  shape a type error. */
export type ParamsOf<S extends FxParamSpecs> = {
  [K in keyof S]: S[K] extends { kind: 'enum'; options: readonly (infer O)[] }
    ? O
    : S[K] extends { kind: 'palette' }
      ? [number, number, number, number]
      : S[K] extends { kind: 'curve' }
        ? [number, number][]
        : S[K] extends { kind: 'shape' }
          ? string
          : S[K]['default'];
};

export function defaultsOf<S extends FxParamSpecs>(specs: S): ParamsOf<S> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    // Palette defaults are arrays — copy so two instances (or two calls) never alias the same tuple and
    // mutate each other's colours through it. Curve defaults are nested arrays — deep-copy each [t, v] pair
    // for the same reason (a shallow spread would still alias the inner point arrays). Shape defaults are
    // plain strings — immutable, so the fall-through copy is correct as-is.
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
      case 'shape':
        // Any non-empty string is accepted — unlike `enum`, the valid set is a RUNTIME registry
        // (`shapeLibrary.ts`: built-ins + this browser's imports). A saved def may legitimately name a
        // custom shape that hasn't been imported here (a def shared from another machine), and rejecting it
        // would silently and PERMANENTLY rewrite the def to the default the first time it round-trips.
        // Keeping the id is safe: `getShapeTextureById` already falls back to a built-in for an unknown id.
        if (typeof v === 'string' && v !== '') out[key] = v;
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
          // Fresh normalized copy — clamp t to [0,1] and v to [0, vMax], sort ascending by t. Never alias
          // the caller's arrays (mirrors the palette case's discipline); the sampler relies on sorted-by-t
          // input. `vMax` defaults to 1, so a spec that omits it clamps exactly as it always has; a spec
          // that opts in (e.g. 2) lets the curve exceed the base value instead of only reducing it. The
          // t axis is normalized-by-definition and is NOT affected by vMax.
          const vMax = spec.vMax ?? 1;
          const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
          const clampV = (n: number): number => (n < 0 ? 0 : n > vMax ? vMax : n);
          out[key] = (v as [number, number][])
            .map((pt) => [clamp01(pt[0]), clampV(pt[1])] as [number, number])
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
    // A shape default can't be checked against a fixed list (the registry is runtime), but an EMPTY default
    // is always wrong: `coerceParams` rejects '' as a value, so such a spec could never hold its own default.
    if (spec.kind === 'shape' && spec.default === '') {
      problems.push(`'${key}': shape default must be a non-empty shape id`);
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
      // An omitted vMax means 1 — the historical bound, so every pre-existing curve spec validates
      // identically. A declared vMax must be a usable upper bound: non-finite or <= 0 would make the
      // whole value axis degenerate (nothing but 0 could ever be stored).
      if (spec.vMax !== undefined && (!Number.isFinite(spec.vMax) || spec.vMax <= 0)) {
        problems.push(`'${key}': curve vMax must be a finite number greater than 0 (got ${spec.vMax})`);
      }
      const vMax = spec.vMax !== undefined && Number.isFinite(spec.vMax) && spec.vMax > 0 ? spec.vMax : 1;
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
            pt[1] > vMax,
        );
        if (badPoint) {
          problems.push(`'${key}': curve default has a point with t outside [0, 1] or v outside [0, ${vMax}]`);
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
