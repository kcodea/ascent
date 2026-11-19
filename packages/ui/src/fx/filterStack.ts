/**
 * The FILTER LAB — a whole stack of pixi.js post-process filters exposed on a primitive, the way `blurFilter.ts`
 * exposes just one. Each registered filter is OFF by default (a toggle), so an unused one allocates nothing and
 * costs no render-to-texture pass; turning it on reveals its amount slider, an over-effect-time curve on that
 * amount, and its own key knobs. Multiple enabled filters compose into `container.filters` in registry order.
 *
 * Built registry-driven so a new filter is one `FILTERS` entry, not a new hand-wired field. `blur` stays its
 * own always-on knob (`blurFilter.ts`, kept for the shared cross-primitive blur); this stack is the toggle-gated
 * EXTRAS layered on top of it, and the primitive hands BOTH into one `container.filters` write via `FilterStack`.
 *
 * PERF: every ENABLED filter is another full render-to-texture pass. Off = free. Left to the author (this is a
 * lab); real committed defs should keep the stack shallow.
 */
import { BlurFilter, type Container, type Filter } from 'pixi.js';
import { sampleCurve, CURVE_PRESETS, type CurvePoint } from './curve';
import { patchBlurPassClear } from './blurPassClear';
import type { FxParamSpec, FxParamSpecs } from './params';

/** A numeric, boolean, or colour knob beyond the primary amount. `prop` is the filter instance property it
 *  writes. */
export interface FxFilterKnob {
  name: string;                    // param-key suffix + label source
  label: string;
  prop: string;                    // instance property to set
  kind: 'slider' | 'toggle' | 'color';
  range?: [number, number, number]; // [min, max, default] for a slider
  step?: number;
  default?: boolean;               // for a toggle
  defaultColor?: number;           // 0xRRGGBB, for a color knob
  help?: string;
}

/** One filter the lab can layer on. `make` builds the pixi Filter; `amountProp` is the instance property the
 *  amount×curve envelope drives each frame; `knobs` are its other exposed controls. */
export interface FxFilterSpec {
  id: string;                      // camelCase, unique — the param-key prefix (e.g. 'advancedBloom')
  label: string;                   // human label + its param group
  make: () => Filter;
  amountProp: string;              // '' for an on/off-only filter (no amount slider/curve — e.g. grayscale)
  amount: [number, number, number]; // [min, max, default] for the amount slider
  amountStep?: number;
  knobs?: FxFilterKnob[];
  /** Increment `timeProp` (default `time`) by the frame's seconds while enabled — for filters that ANIMATE off
   *  an ever-advancing clock (godray rays, CRT roll, old-film flicker via `seed`, reflection waves, shockwave
   *  ripple) rather than a static amount. The amount×curve still drives `amountProp`. */
  animateTime?: boolean;
  timeProp?: string;
  help?: string;
}

const onKey = (id: string): string => `${id}On`;
const amtKey = (id: string): string => `${id}Amt`;
const curveKey = (id: string): string => `${id}Curve`;
const knobKey = (id: string, name: string): string => `${id}_${name}`;

/** The param that holds the composition order of the lab's filters (an `order` kind — see `params.ts`). */
export const FILTER_ORDER_KEY = 'filterOrder';

/** The always-on core Blur's id in a `filterOrder` — it is orderable like a registry filter, and FIRST by
 *  default (the pre-ordering behaviour). */
export const CORE_BLUR_ID = 'blur';

/**
 * The COMPLETE application order given a stored `filterOrder`: the stored ids first (in that order, ignoring
 * any that are neither the core blur nor in the registry), then the core blur if not yet placed, then every
 * remaining registry id in registry order. So an empty / missing / stale order is exactly `blur, registry…`
 * — the behaviour before ordering existed — and a saved order stays valid when filters are added to the
 * registry later (new ones append). Pixi applies `container.filters[0]` FIRST, so index 0 here processes the
 * raw layer and the next filter processes that result — "top → bottom" in the inspector.
 */
export function resolveFilterOrder(order: readonly string[] | undefined, registry: readonly FxFilterSpec[]): string[] {
  const known = new Set<string>([CORE_BLUR_ID, ...registry.map((f) => f.id)]);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of order ?? []) {
    if (known.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  if (!seen.has(CORE_BLUR_ID)) out.push(CORE_BLUR_ID);
  for (const f of registry) if (!seen.has(f.id)) out.push(f.id);
  return out;
}

/** Generate the flat param specs for a registry — a toggle, an amount slider, an over-time curve, and each
 *  knob, all grouped under the filter's label and (except the toggle) gated on that toggle being on — plus
 *  the one `filterOrder` param the whole stack shares. */
export function filterLabSpecs(registry: readonly FxFilterSpec[]): FxParamSpecs {
  const out: Record<string, FxParamSpec> = {};
  out[FILTER_ORDER_KEY] = {
    kind: 'order', label: 'Filter order', default: [],
    help: 'Which enabled filters apply first. Top → bottom in the Filters panel: the first processes the raw layer, the next processes that result (an Outline then a Glow glows the outline; the reverse outlines the glow). Empty = the default order.',
  };
  for (const f of registry) {
    const group = f.label;
    const gate = { param: onKey(f.id), is: true } as const;
    out[onKey(f.id)] = { kind: 'toggle', label: `${f.label}`, group, default: false, help: f.help ?? `Enable the ${f.label} filter. Off costs nothing (no filter, no render pass).` };
    if (f.amountProp !== '') {
      out[amtKey(f.id)] = { kind: 'slider', label: 'Amount', group, min: f.amount[0], max: f.amount[1], step: f.amountStep ?? 0.01, default: f.amount[2], enabledWhen: gate, help: `How strong the ${f.label} filter is. Rides the ${f.label} / time graph over the effect's life.` };
      out[curveKey(f.id)] = { kind: 'curve', label: `${f.label} / time`, group, default: [[0, 1], [1, 1]], vMax: 1, presets: CURVE_PRESETS, enabledWhen: gate, help: `How the ${f.label} Amount ramps over the effect's life (0 = fires, 1 = finishes). Flat 1 = constant.` };
    }
    for (const k of f.knobs ?? []) {
      const help = k.help ?? `${k.label} — a ${f.label} filter control.`;
      if (k.kind === 'slider') {
        const r = k.range ?? [0, 1, 0];
        out[knobKey(f.id, k.name)] = { kind: 'slider', label: k.label, group, min: r[0], max: r[1], step: k.step ?? 0.01, default: r[2], enabledWhen: gate, help };
      } else if (k.kind === 'color') {
        out[knobKey(f.id, k.name)] = { kind: 'color', label: k.label, group, default: k.defaultColor ?? 0xffffff, enabledWhen: gate, help };
      } else {
        out[knobKey(f.id, k.name)] = { kind: 'toggle', label: k.label, group, default: k.default ?? false, enabledWhen: gate, help };
      }
    }
  }
  return out;
}

type P = Record<string, unknown>;
const num = (p: P, k: string, d = 0): number => (typeof p[k] === 'number' ? p[k] as number : d);
const bool = (p: P, k: string): boolean => p[k] === true;
const curveOf = (p: P, k: string): ReadonlyArray<CurvePoint> => (Array.isArray(p[k]) ? p[k] as CurvePoint[] : [[0, 1], [1, 1]]);

/**
 * Owns the live filter set on one primitive's container: the always-on core Blur (`blur`/`blurCurve` params)
 * plus every enabled registry filter. Call `frame(params, progress)` once per frame from `update()`; it lazily
 * builds each filter the frame it's first enabled, retimes amounts by their curves, and only rewrites
 * `container.filters` when the ACTIVE SET changes (adding/removing) — a plain retune touches no array.
 */
/** Filters applied across every live stack right now — the perf monitor's `fx:filters` counter. Each
 *  stack adds its delta when its active set changes, so the FX path pays one addition on a set change only. */
let activeFilterTotal = 0;
export function activeFilterCount(): number { return activeFilterTotal; }

/**
 * A spec's param keys, built ONCE (R-PERF-FX-FILTER-KEYS-01, perf pass 2026-11-18). `frame` runs for every live layer
 * on every frame and walks the whole registry (32 filters) asking "is this one on?". It used to build the
 * `<id>On` key string for each question: about 1.9 s of string building in a 40 s late fight for layers that mostly
 * carry no filter at all. The keys never change, so they are kept per spec and the walk is plain property reads.
 */
interface SpecKeys { on: string; amt: string; curve: string; time: string; knobs: readonly string[] }
const specKeys = new WeakMap<FxFilterSpec, SpecKeys>();
function keysOf(f: FxFilterSpec): SpecKeys {
  let k = specKeys.get(f);
  if (!k) {
    k = { on: onKey(f.id), amt: amtKey(f.id), curve: curveKey(f.id), time: f.timeProp ?? 'time', knobs: (f.knobs ?? []).map((kn) => knobKey(f.id, kn.name)) };
    specKeys.set(f, k);
  }
  return k;
}

/**
 * TIGHT FILTER AREAS (R-PERF-FX-FILTER-AREA-01, perf pass 2026-11-18).
 *
 * A particle layer's container has no measurable bounds (a ParticleContainer reports whatever `boundsArea` it is
 * given, and ours was effectively infinite), so every filter on a burst / emitter / smoke layer ran over the WHOLE
 * VIEWPORT: each pass of a Bloom or Glow on a 60 px spark burst filled 1920 x 1080 pixels. The particle primitives now
 * report the box their live particles occupy (`fitParticleBounds`, particleLayerPool.ts), and a filter only covers
 * that box plus its own reach.
 *
 * That is only the same picture when (a) the filter's result does not depend on where its area starts or how big it
 * is, and (b) the area is padded by as far as the filter spreads. `TIGHT_FILTERS` is the list of filters for which
 * (a) holds; its value is the padding the filter needs when it does not already set its own (Bloom has none: it is
 * an Alpha filter wrapping two blur passes). Any other filter on the stack, and any filter put on an ancestor by
 * something other than a tight stack, keeps the old whole-viewport area for that layer.
 */
type Rec = Record<string, unknown>;
const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(v) : 0);
const TIGHT_FILTERS: Readonly<Record<string, ((inst: Rec) => number) | null>> = {
  // Two BlurFilterPass runs of this strength; a pass reaches `1 + 2 x strength` px (Pixi's own padding for it).
  bloom: (f) => Math.ceil(3 * Math.max(n0(f.strengthX), n0(f.strengthY)) + 8),
  // Its inner Kawase blur knows its reach (`_updatePadding`); the fallback covers a build where the field moved.
  advancedBloom: (f) => {
    const inner = (f._blurFilter as Rec | undefined)?.padding;
    return Math.ceil((typeof inner === 'number' ? inner : 4 * n0(f.blur)) + 8);
  },
  rgbSplit: (f) => Math.ceil(Math.max(n0(f.redX), n0(f.redY), n0(f.greenX), n0(f.greenY), n0(f.blueX), n0(f.blueY)) + 2),
  // These set their own padding from their reach (Glow: distance, Kawase: its kernels, Motion Blur: its velocity,
  // Outline: thickness) or do not spread at all (the colour filters).
  glow: null, kawaseBlur: null, motionBlur: null, outline: null,
  colorOverlay: null, hslAdjustment: null, adjustment: null, colorReplace: null, grayscale: null,
};
/** Tight areas need Pixi's blur pass to clear its scratch texture (`blurPassClear.ts`). False = everything stays on the
 *  whole-viewport area, as before. */
const TIGHT_READY = patchBlurPassClear();
/** Containers whose filters, this frame, all keep their look in a tight area (see `filterAreaMode`). */
const tightContainers = new WeakSet<Container>();

/**
 * How the particle layer `pc` must report its bounds this frame: `'none'` when nothing above it is filtered (the
 * bounds are never read), `'tight'` when every filtered ancestor is a tight stack, `'full'` otherwise (some filter
 * needs the whole viewport, exactly as before).
 */
export function filterAreaMode(pc: Container): 'none' | 'tight' | 'full' {
  if (!TIGHT_READY) return 'full';
  let found = false;
  for (let a: Container | null = pc.parent; a; a = a.parent) {
    const fl = a.filters as readonly Filter[] | null | undefined;
    if (!fl || fl.length === 0) continue;
    if (!tightContainers.has(a)) return 'full';
    found = true;
  }
  return found ? 'tight' : 'none';
}

/** One id→spec map per registry (every stack of the shipped registry shares it, instead of building its own). */
const byIdCache = new WeakMap<readonly FxFilterSpec[], ReadonlyMap<string, FxFilterSpec>>();
function byIdOf(registry: readonly FxFilterSpec[]): ReadonlyMap<string, FxFilterSpec> {
  let m = byIdCache.get(registry);
  if (!m) { m = new Map(registry.map((f) => [f.id, f] as const)); byIdCache.set(registry, m); }
  return m;
}
/** Shared empties for the common "no filter on this layer" frame, so it allocates nothing. Never written to. */
const NO_FILTERS: Filter[] = [];
const NO_IDS: string[] = [];

export class FilterStack {
  private readonly instances = new Map<string, Filter>();
  private activeCount = 0;
  private safe = false;
  private coreBlur: BlurFilter | null = null;
  private activeKey = ''; // identity of the current container.filters set, to skip no-op rewrites
  // The resolved application order (core blur + registry, as ids), recomputed only when the stored
  // `filterOrder` changes (compared by its joined string — an array param is a fresh copy on every coerce,
  // so identity would never hit).
  private orderSig = '';
  private ordered: readonly string[];
  private readonly byId: ReadonlyMap<string, FxFilterSpec>;
  /** `ordered` resolved to specs (null = the core blur's place), rebuilt with it. */
  private orderedSpecs: readonly (FxFilterSpec | null)[] = [];
  /** The `filterOrder` array last resolved, by identity: a layer hands the same params object every frame. */
  private orderRef: unknown = this;

  /** `tight`: this stack filters a particle layer (or a group of them), whose area follows its particles: see
   *  `TIGHT_FILTERS`. Off (the default) for every other primitive, whose containers measure themselves. */
  constructor(private readonly container: Container, private readonly registry: readonly FxFilterSpec[], private readonly tight = false) {
    this.byId = byIdOf(registry);
    this.ordered = resolveFilterOrder([], registry);
    this.orderedSpecs = this.specsOf(this.ordered);
  }

  private specsOf(ids: readonly string[]): (FxFilterSpec | null)[] {
    const out: (FxFilterSpec | null)[] = [];
    for (const id of ids) {
      if (id === CORE_BLUR_ID) out.push(null);
      else { const f = this.byId.get(id); if (f) out.push(f); }
    }
    return out;
  }

  /** The application order in the params' `filterOrder` — see `resolveFilterOrder`. */
  private orderedIds(params: P): readonly string[] {
    const raw = params[FILTER_ORDER_KEY];
    if (raw === this.orderRef) return this.ordered; // the same array as last frame: nothing to re-read
    this.orderRef = raw;
    const order = Array.isArray(raw) ? (raw as string[]) : [];
    const sig = order.join('|');
    if (sig !== this.orderSig) {
      this.orderSig = sig;
      this.ordered = resolveFilterOrder(order, this.registry);
      this.orderedSpecs = this.specsOf(this.ordered);
    }
    return this.ordered;
  }

  frame(params: P, progress: number, dtSec: number): void {
    let active: Filter[] = NO_FILTERS;
    let keyParts: string[] = NO_IDS;

    this.orderedIds(params);
    const tight = this.tight;
    let safe = tight;
    for (const f of this.orderedSpecs) {
      if (f === null) {
        // The shared always-on blur knob, same semantics as blurFilter.ts — orderable like the rest.
        const blurBase = num(params, 'blur');
        if (blurBase <= 0) continue;
        if (!this.coreBlur) this.coreBlur = new BlurFilter({ strength: 0, quality: 5 });
        this.coreBlur.strength = Math.max(0, blurBase * sampleCurve(curveOf(params, 'blurCurve'), progress));
        (active === NO_FILTERS ? (active = []) : active).push(this.coreBlur);
        (keyParts === NO_IDS ? (keyParts = []) : keyParts).push(CORE_BLUR_ID);
        continue;
      }
      const keys = keysOf(f);
      if (params[keys.on] !== true) continue;
      let inst = this.instances.get(f.id);
      if (!inst) { inst = f.make(); this.instances.set(f.id, inst); }
      const rec = inst as unknown as Record<string, number | boolean>;
      if (f.amountProp !== '') {
        rec[f.amountProp] = Math.max(0, num(params, keys.amt, f.amount[2]) * sampleCurve(curveOf(params, keys.curve), progress));
      }
      if (f.animateTime) rec[keys.time] = num(rec, keys.time) + dtSec;
      const knobs = f.knobs;
      if (knobs) {
        for (let i = 0; i < knobs.length; i++) {
          const k = knobs[i]!;
          rec[k.prop] = k.kind === 'toggle'
            ? bool(params, keys.knobs[i]!)
            : num(params, keys.knobs[i]!, k.kind === 'color' ? (k.defaultColor ?? 0xffffff) : (k.range?.[2] ?? 0));
        }
      }
      if (tight) {
        const reach = TIGHT_FILTERS[f.id];
        if (reach === undefined) safe = false;
        else if (reach !== null) (inst as unknown as { padding: number }).padding = reach(rec);
      }
      (active === NO_FILTERS ? (active = []) : active).push(inst);
      (keyParts === NO_IDS ? (keyParts = []) : keyParts).push(f.id);
    }
    if (safe !== this.safe) {
      this.safe = safe;
      if (safe) tightContainers.add(this.container); else tightContainers.delete(this.container);
    }

    const key = keyParts === NO_IDS ? '' : keyParts.join(',');
    if (key !== this.activeKey) {
      this.container.filters = active.length ? active : [];
      this.activeKey = key;
      activeFilterTotal += active.length - this.activeCount;
      this.activeCount = active.length;
    }
  }

  destroy(): void {
    // The container may already be gone: the FX budget (`fxBudget.trim` → `retire` → `killAllLive`) can retire a
    // play AFTER its scene tore the container down, and Pixi's `filters` setter walks the destroyed container's
    // null effects list ("Cannot read properties of null (reading 'indexOf')" — owner crash report 2026-09-19).
    // A destroyed container has no filters left to clear; only our own bookkeeping still needs releasing.
    if (!this.container.destroyed) this.container.filters = [];
    this.activeKey = '';
    tightContainers.delete(this.container);
    this.safe = false;
    activeFilterTotal -= this.activeCount;
    this.activeCount = 0;
    if (this.coreBlur) { this.coreBlur.destroy(); this.coreBlur = null; }
    for (const inst of this.instances.values()) inst.destroy();
    this.instances.clear();
  }
}
