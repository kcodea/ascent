/**
 * A primitive's parameters are declared ONCE, here. The params type and the editor UI are both derived
 * from the same record, so it is impossible to add a parameter without a label, or to label a parameter
 * that does not exist — the failure mode that left two Trail tuner sliders blank for months.
 */

import { EMIT_POINTS_MAX } from './svgEmit';

/**
 * A dependency that decides whether a param is LIVE right now.
 *
 * A third of this workbench's params do nothing until some OTHER param moves — `turbScale` is dead while
 * `turbulence` is 0, the whole noise/texture group is dead while `erode` is 0, and so on. That was only ever
 * written in prose in each `help` string, which means the editor itself could not act on it: every one of
 * those controls looked exactly as live as a working one. Declaring it as DATA lets the inspector grey the
 * control out and say why, and lets `validateSpecs` catch a typo in the dependency's name.
 *
 * Clauses are ANDed, and at least one must be present (`validateSpecs` flags a bare `{ param }`). Evaluation
 * is `isParamEnabled`, which fails OPEN — a predicate it cannot evaluate leaves the control usable, because a
 * control wrongly locked out is strictly worse than one wrongly left live.
 *
 * NOTE: only fully-inert cases belong here. A param that still does *something* under the condition (e.g.
 * `plateau` still shapes the Glow halo once `fieldMix` reaches 1) must NOT declare a dependency — disabling
 * it would take away real reach. Those stay documented in `help`.
 */
export type FxParamDependency = {
  /** Another key in the SAME spec record. `validateSpecs` rejects a name that isn't one. */
  param: string;
  /** Live while the dependency is strictly `===` this. */
  is?: unknown;
  /** Live while the dependency is strictly `!==` this. */
  not?: unknown;
  /** Live while the dependency is a number strictly greater than this. */
  above?: number;
};

/**
 * The per-call axes a `playDef` caller can dial (`PlayDefOptions.scale` / `.intensity` / `.time`), and which
 * a param declares itself to respond to. See {@link FxParamMeta.axis} and `scaleDef.ts`.
 *
 * Three DIALS, four declarations: `time` has two, because the time axis is the only one whose quantities come
 * in both flavours. A param measured in milliseconds rides it directly (`'time'`, ×k); a param measured in
 * *per second* — whose PERIOD is the duration — has to ride it inversely (`'timeInverse'`, ×1/k) or the thing
 * it drives finishes at the same moment however far the rest of the effect is stretched. There is no
 * equivalent for `scale`, and deliberately so: `turbScale`/`noiseScale` are 1/px and would want exactly this
 * treatment, but nobody has asked for an inverse-geometry caller, and inventing one speculatively is how a
 * two-dial system becomes a six-dial one.
 */
export const FX_SCALE_AXES = ['scale', 'intensity', 'time', 'timeInverse'] as const;
export type FxScaleAxis = (typeof FX_SCALE_AXES)[number];

/** Fields every spec carries regardless of `kind`. Intersected onto the union below rather than repeated in
 *  all eight members — all three are optional, so every pre-existing spec stays valid untouched. */
type FxParamMeta = {
  /**
   * One of the ~5-7 params that actually carry this primitive's read. The inspector's default "Essentials"
   * tier shows only these, which is what turns a 43-control rail into a handful. Not a statement about
   * importance in the abstract: the test is "does moving this change what the effect LOOKS like at a glance".
   */
  essential?: boolean;
  /** What has to be true elsewhere in this spec record for the param to do anything. See {@link FxParamDependency}. */
  enabledWhen?: FxParamDependency;
  /**
   * Which per-call axis this param rides when a `playDef` caller passes `scale` / `intensity`.
   *
   * A def is a FIXED composition, but a caller often knows something the author cannot: how big the card is,
   * how much damage landed. These two multipliers are how that reaches the def, and this field is the only
   * declaration of which params they touch. Omitted (the default) means the param is deaf to both — which is
   * correct for the large majority, and is why `scale: 1` can be a genuine no-op rather than a re-snap of
   * every slider in the def.
   *
   *  - `'scale'` — GEOMETRY. Reserved for a param measured in pixels or in px-per-time (a size, an emission
   *    radius, an extent, a speed, an acceleration). Multiplying all of them together makes the same effect
   *    bigger while keeping its shape and its timing: positions ×k with the clock untouched implies velocity
   *    ×k and acceleration ×k. A param that is a RATIO (spread, drag, a `*Var` jitter fraction), a DURATION,
   *    or a spatial FREQUENCY (a noise scale is 1/px, so it would have to scale INVERSELY — which one
   *    multiplier cannot express) must NOT declare it.
   *  - `'intensity'` — QUANTITY. How many things there are: a particle count, an emission rate, a ring count.
   *    Nothing else — "more intense" must never be a licence to also brighten, lengthen or enlarge, or two
   *    callers dialling the same number get two unrelated effects.
   *  - `'time'` — a DURATION in milliseconds: a particle lifetime, a repeat interval. `time: 2` means the
   *    effect LASTS twice as long **at the same velocities**, so its particles travel twice as far. That is
   *    what makes it a different dial from `PlayDefOptions.speed`, which rescales the whole playback clock
   *    and therefore slows the motion down to cover the same ground. Because velocities are preserved, a
   *    px-per-second param (`speed`, `gravity`, ribbon `drain`, a spin rate) must NOT declare it — those are
   *    `scale`'s, and holding them still is the entire point.
   *  - `'timeInverse'` — a PER-SECOND rate whose period is the thing being stretched (shockwave `speed` is
   *    "expansions per second", so one expansion takes `1 / speed`). Multiplied by **1/time**, so the period
   *    lengthens with everything else. Only for a rate that IS the effect's clock: an animation rate that
   *    merely decorates the surface (texture `scroll`, ribbon `waveSpeed`) rides neither, for the same reason
   *    `scale` leaves the material alone.
   *
   * Only a `kind: 'slider'` param may declare an axis — no other kind has the `min`/`max`/`step` the
   * multiply needs to stay legal. `validateSpecs` rejects it anywhere else.
   *
   * **Scaling is CLAMPED, so it is not linear at the extremes.** Every axis param is held to its own slider
   * range: `scale: 10` on a `size` already near its `max` moves it to the max and no further, and the effect
   * grows far less than tenfold. That is deliberate (an out-of-range param is silently rewritten at load —
   * see `coerceParams`) but it means an author who wants real headroom on an axis must leave the base value
   * well below its ceiling. "I doubled scale and it barely changed" is almost always this.
   */
  axis?: FxScaleAxis;
};

export type FxParamSpec = FxParamMeta &
  ({ kind: 'slider'; label: string; group?: string; help?: string; min: number; max: number; step: number; default: number }
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
    }
  | {
      /**
       * A baked point cloud sampled off an imported SVG silhouette — the persisted payload behind
       * `emitShape: 'svg'`. Each entry is a normalized `[x, y]` in `[-1, 1]`, and a spawn picks one at
       * random (see `motion.ts`'s `'svg'` case). Authored not by dragging a slider but by the SVG baker
       * (`svgEmit.ts`), then it just lives in the def like any other value and round-trips through
       * `coerceParams`. Kept out of `curve`/`palette` because it is neither a 4-stop ramp nor a
       * sorted-by-t function: it is an unordered, unbounded-length set of coordinates.
       */
      kind: 'emitpoints';
      label: string;
      group?: string;
      help?: string;
      /** Baked, normalized ([-1,1]) spawn points. Defaults to `[]` — an empty cloud is an inert no-op,
       *  so a spec that declares this param but has nothing baked yet behaves exactly as before. */
      default: readonly (readonly [number, number])[];
    }
  | {
      kind: 'gradient';
      label: string;
      group?: string;
      help?: string;
      /** N stops (>=2), each { at: 0..1, color: 0xRRGGBB }. */
      default: readonly import('./gradient').GradientStop[];
      /** Where the target supports it. Default 'linear'. */
      gradType?: 'linear' | 'radial' | 'conic';
    });

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
        : S[K] extends { kind: 'emitpoints' }
          ? [number, number][]
          : S[K] extends { kind: 'shape' }
            ? string
            : S[K] extends { kind: 'gradient' }
              ? import('./gradient').GradientStop[]
              : S[K]['default'];
};

/**
 * Per-SPECS split of "which keys are plain immutable defaults" vs "which need a fresh copy per instance",
 * computed once per specs object (they are module constants — `burst.ts`'s `SPECS`, etc.).
 *
 * PERF (audit 2026-09-01): `defaultsOf` walked every key of a ~210-key spec on EVERY layer spawn and
 * deep-copied ~40 curve/palette arrays — a 6-layer def fanned to 7 units was ~9,000 allocations in one frame.
 * The scalar defaults never change, so they are assembled once and spread; only the array-valued defaults
 * are copied per call, which preserves the no-aliasing guarantee documented below exactly.
 */
interface SpecsPlan {
  /** Every key whose default is a plain immutable value, with those defaults already assembled. */
  scalars: Record<string, unknown>;
  /** Keys whose defaults are arrays/objects and must be freshly copied per instance. */
  copied: ReadonlyArray<{ key: string; kind: 'palette' | 'curve' | 'emitpoints' | 'gradient' }>;
}
const specsPlans = new WeakMap<FxParamSpecs, SpecsPlan>();
function planOf(specs: FxParamSpecs): SpecsPlan {
  const hit = specsPlans.get(specs);
  if (hit) return hit;
  const scalars: Record<string, unknown> = {};
  const copied: Array<{ key: string; kind: 'palette' | 'curve' | 'emitpoints' | 'gradient' }> = [];
  for (const key of Object.keys(specs)) {
    const spec = specs[key]!;
    if (spec.kind === 'palette' || spec.kind === 'curve' || spec.kind === 'emitpoints' || spec.kind === 'gradient') {
      copied.push({ key, kind: spec.kind });
    } else {
      scalars[key] = spec.default;
    }
  }
  const plan = { scalars, copied };
  specsPlans.set(specs, plan);
  return plan;
}

export function defaultsOf<S extends FxParamSpecs>(specs: S): ParamsOf<S> {
  const plan = planOf(specs);
  const out: Record<string, unknown> = { ...plan.scalars };
  for (const { key } of plan.copied) {
    const spec = specs[key]!;
    // Palette defaults are arrays — copy so two instances (or two calls) never alias the same tuple and
    // mutate each other's colours through it. Curve defaults are nested arrays — deep-copy each [t, v] pair
    // for the same reason (a shallow spread would still alias the inner point arrays). Shape defaults are
    // plain strings — immutable, so the fall-through copy is correct as-is.
    if (spec.kind === 'palette') out[key] = [...spec.default];
    else if (spec.kind === 'curve') out[key] = spec.default.map((pt) => [pt[0], pt[1]]);
    // emitpoints defaults are nested arrays too — deep-copy each [x, y] so no two instances alias the
    // same point (mirrors the curve case). Usually `[]`, but deep-copy anyway for a non-empty default.
    else if (spec.kind === 'emitpoints') out[key] = spec.default.map((p) => [p[0], p[1]]);
    // gradient defaults are an array of stop objects — deep-copy each stop so no two instances alias the
    // same object (mirrors the palette/curve/emitpoints discipline above).
    else if (spec.kind === 'gradient') out[key] = spec.default.map((s) => ({ at: s.at, color: s.color }));
    // (the plan only lists the four array-valued kinds, so there is no scalar fall-through here)
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
      case 'emitpoints': {
        // A baked SVG cloud: keep only well-formed finite `[x, y]` pairs, clamp each to [-1,1], and cap
        // the count at EMIT_POINTS_MAX (a def from another machine could name any length; the render path
        // and memory budget assume the cap). Fresh nested arrays — never alias the caller's. Order is not
        // meaningful (a spawn picks a random index), so no sort. A bad value degrades to the empty default.
        const arr = Array.isArray(v) ? v : [];
        const pts: [number, number][] = [];
        for (const e of arr) {
          if (
            Array.isArray(e) &&
            e.length === 2 &&
            typeof e[0] === 'number' &&
            typeof e[1] === 'number' &&
            Number.isFinite(e[0]) &&
            Number.isFinite(e[1])
          ) {
            pts.push([Math.max(-1, Math.min(1, e[0])), Math.max(-1, Math.min(1, e[1]))]);
          }
          if (pts.length >= EMIT_POINTS_MAX) break;
        }
        out[key] = pts;
        break;
      }
      case 'gradient':
        if (Array.isArray(v) && v.length >= 2 && v.every((s) =>
          s && typeof s === 'object' && typeof (s as {at?: unknown}).at === 'number'
          && typeof (s as {color?: unknown}).color === 'number'
          && Number.isFinite((s as {at: number}).at) && (s as {color: number}).color >= 0
          && (s as {color: number}).color <= 0xffffff)) {
          out[key] = (v as {at: number; color: number}[]).map((s) => ({ at: Math.min(1, Math.max(0, s.at)), color: s.color }));
        }
        break;
    }
  }
  return out as ParamsOf<S>;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Editor derivations. Everything below is PURE (no React, no DOM, no localStorage) and lives here rather
 * than in `ui/Inspector.tsx` for one reason: the vitest include is `packages/**\/*.test.ts` on a node
 * environment, so a helper inside a `.tsx` cannot be unit-tested. The inspector keeps the hooks and the
 * markup; the rules about which params are live, which are shown, and how they group live here with the
 * specs they read.
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The group an unlabelled param falls into — matches the inspector's historical fallback heading. */
export const DEFAULT_PARAM_GROUP = 'General';

/**
 * Groups that stay COLLAPSED on first open even when they hold an essential param: the advanced material
 * tiers. This is the Shuriken lesson — the tools with the most parameters show the fewest at once — and it
 * is why 43 controls no longer land on you at once. Everything else opens.
 */
const ADVANCED_GROUPS: ReadonlySet<string> = new Set(['Texture', 'Noise', 'Physics']);

/**
 * Is this param live right now, given the sibling values it was declared to depend on?
 *
 * Fails OPEN in every ambiguous case (no `enabledWhen`, a dependency missing from `values`, a predicate with
 * no clauses): a control wrongly greyed out is a capability the author has silently lost, which is worse than
 * the status quo of a control that quietly does nothing. Clauses are ANDed.
 */
export function isParamEnabled(spec: FxParamSpec, values: Record<string, unknown>): boolean {
  const dep = spec.enabledWhen;
  if (dep === undefined) return true;
  if (!(dep.param in values)) return true; // can't evaluate → don't lock the control
  const v = values[dep.param];
  if (dep.is !== undefined && v !== dep.is) return false;
  if (dep.not !== undefined && v === dep.not) return false;
  if (dep.above !== undefined && (typeof v !== 'number' || !(v > dep.above))) return false;
  // Every declared clause held — and a predicate with NO clauses lands here too, which is the fail-open case
  // `validateSpecs` separately flags as a malformed spec.
  return true;
}

/** How a dependency's expected value reads in a sentence: booleans as on/off, everything else verbatim. */
function describeValue(v: unknown): string {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return String(v);
}

/**
 * Why a param is greyed out, phrased for the row that is greyed out ("Needs Turbulence above 0"), or `null`
 * when it is live. Takes the whole record because the reason has to name the DEPENDENCY'S label — the thing
 * the author has to go and move — not its key.
 */
export function paramDisabledReason(
  specs: FxParamSpecs,
  key: string,
  values: Record<string, unknown>,
): string | null {
  const spec = specs[key];
  if (spec === undefined || isParamEnabled(spec, values)) return null;
  const dep = spec.enabledWhen;
  if (dep === undefined) return null;
  const depLabel = specs[dep.param]?.label ?? dep.param;
  const parts: string[] = [];
  if (dep.is !== undefined) parts.push(`${depLabel} ${describeValue(dep.is)}`);
  if (dep.not !== undefined) {
    parts.push(typeof dep.not === 'boolean' ? `${depLabel} ${describeValue(!dep.not)}` : `${depLabel} ≠ ${String(dep.not)}`);
  }
  if (dep.above !== undefined) parts.push(`${depLabel} above ${dep.above}`);
  return parts.length === 0 ? null : `Needs ${parts.join(' and ')}`;
}

/** Case-insensitive substring match of the search box against the label first, then the key (an author who
 *  knows the JSON reaches for `emitRadius` as readily as for "Emit radius"). An empty query matches all. */
export function matchesParamQuery(spec: FxParamSpec, key: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return spec.label.toLowerCase().includes(q) || key.toLowerCase().includes(q);
}

/**
 * Deep structural equality over JSON-serialisable values only (numbers, strings, booleans, arrays, and
 * plain objects nesting those) — exactly the shapes a param's value or default can take (palette/curve/
 * emitpoints/gradient payloads). Deliberately NOT a library: the domain is narrow enough that a few lines
 * here are cheaper than a dependency, and a param value can never contain a function, Date, Map, etc.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Has this param's live `value` diverged from its `dflt`? Scalars compare with `!==`; array/object payloads
 * (palette/curve/emitpoints/gradient) compare by deep structural equality, since two freshly-coerced copies
 * of the same default are never the same reference. `undefined` (a key absent from the live params object)
 * is treated as unchanged — coercion always backfills it FROM the default, so it equals the default by
 * definition.
 */
export function paramIsChanged(spec: FxParamSpec, value: unknown, dflt: unknown): boolean {
  if (value === undefined) return false;
  if (spec.kind === 'palette' || spec.kind === 'curve' || spec.kind === 'emitpoints' || spec.kind === 'gradient') {
    return !deepEqual(value, dflt);
  }
  return value !== dflt;
}

/**
 * The set of keys whose value differs from that spec's default, for one "changed from default" snapshot.
 * Coerces `values` once and takes `defaultsOf(specs)` once — cheap to call on every render, but the caller
 * (not this function) decides WHEN to call it and hands the result into `visibleParamKeys`'s `changed` option,
 * keeping that function pure and this one the only place that touches `coerceParams`/`defaultsOf`.
 */
export function changedParamKeys(specs: FxParamSpecs, values: Record<string, unknown>): Set<string> {
  const coerced = coerceParams(specs, values) as Record<string, unknown>;
  const defaults = defaultsOf(specs) as Record<string, unknown>;
  const out = new Set<string>();
  for (const key of Object.keys(specs)) {
    if (paramIsChanged(specs[key], coerced[key], defaults[key])) out.add(key);
  }
  return out;
}

/**
 * The keys the inspector should render, in DECLARATION order (never re-sorted — the spec order is the
 * authored reading order). `essentialsOnly` is the tier switch; `query` is the search box; `changedOnly`
 * (paired with the caller-supplied `changed` set) is the "show me what I touched" filter. All three AND
 * together — none of them widens what another has narrowed. A search is deliberately allowed to reach past
 * the Essentials tier: someone typing "turb" wants the turbulence controls whether or not they were
 * promoted; `changedOnly` does NOT get that exemption — it narrows the search results too, since "changed"
 * is itself the point of the filter, not something to look past.
 *
 * `changedOnly` does not compute the changed set itself — the caller passes `changed` (typically from
 * `changedParamKeys`) so this function stays pure and cheap to call on every keystroke/render.
 */
export function visibleParamKeys(
  specs: FxParamSpecs,
  opts: { essentialsOnly: boolean; query?: string; changedOnly?: boolean; changed?: Set<string> },
): string[] {
  const query = opts.query ?? '';
  const searching = query.trim() !== '';
  return Object.keys(specs).filter((key) => {
    const spec = specs[key];
    if (opts.essentialsOnly && !searching && spec.essential !== true) return false;
    if (opts.changedOnly === true && !(opts.changed?.has(key) ?? false)) return false;
    return matchesParamQuery(spec, key, query);
  });
}

/** Bucket keys into their groups, both the groups and the keys inside them kept in declaration order. */
export function groupParamKeys(
  specs: FxParamSpecs,
  keys: readonly string[],
): { group: string; keys: string[] }[] {
  const out: { group: string; keys: string[] }[] = [];
  const index = new Map<string, { group: string; keys: string[] }>();
  for (const key of keys) {
    const group = specs[key]?.group ?? DEFAULT_PARAM_GROUP;
    let bucket = index.get(group);
    if (bucket === undefined) {
      bucket = { group, keys: [] };
      index.set(group, bucket);
      out.push(bucket);
    }
    bucket.keys.push(key);
  }
  return out;
}

/** First-open state per group: open if it holds an essential AND isn't one of the advanced material tiers. */
export function defaultOpenGroups(specs: FxParamSpecs): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    const group = spec.group ?? DEFAULT_PARAM_GROUP;
    const open = spec.essential === true && !ADVANCED_GROUPS.has(group);
    out[group] = (out[group] ?? false) || open;
  }
  return out;
}

/**
 * Fold a persisted open/closed map over the computed defaults. Total and defensive — `stored` comes from
 * `localStorage`, so it can be anything: only booleans, and only for groups this primitive actually has,
 * survive. A group the persisted map never heard of keeps its default (that's how a NEW group added to a
 * primitive later still opens correctly for someone with an old entry saved).
 */
export function mergeOpenGroups(
  defaults: Record<string, boolean>,
  stored: unknown,
): Record<string, boolean> {
  const out = { ...defaults };
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const [group, value] of Object.entries(stored as Record<string, unknown>)) {
    if (group in out && typeof value === 'boolean') out[group] = value;
  }
  return out;
}

/** Dev-time invariant: catch a spec that contradicts itself (a default outside its own range, an enum
 *  default not in its own options) at registration rather than as a silently wrong slider months later.
 *  Returns the problems rather than throwing, so the caller decides how loud to be. */
export function validateSpecs(specs: FxParamSpecs): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    // An `enabledWhen` that names a param which doesn't exist would silently disable its control FOREVER
    // (the dependency can never become true), so a typo here has to be loud. Same for a self-reference and
    // for a predicate with nothing to test — both mean the author declared a dependency that isn't one.
    const dep = spec.enabledWhen;
    if (dep !== undefined) {
      if (!(dep.param in specs)) {
        problems.push(`'${key}': enabledWhen names '${dep.param}', which is not a param in this spec`);
      } else if (dep.param === key) {
        problems.push(`'${key}': enabledWhen depends on itself`);
      }
      if (dep.is === undefined && dep.not === undefined && dep.above === undefined) {
        problems.push(`'${key}': enabledWhen must declare at least one of is/not/above`);
      }
    }
    // An `axis` on a non-slider is inert forever — `transformParams` refuses every other kind, since none of
    // them has the min/max/step the multiply needs. Silently ignoring it would leave an author believing a
    // param responds to `scale` when nothing will ever touch it.
    if (spec.axis !== undefined && spec.kind !== 'slider') {
      problems.push(`'${key}': axis '${spec.axis}' is only meaningful on a slider (this is a '${spec.kind}')`);
    }
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
