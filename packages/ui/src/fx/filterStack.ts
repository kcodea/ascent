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

export class FilterStack {
  private readonly instances = new Map<string, Filter>();
  private activeCount = 0;
  private coreBlur: BlurFilter | null = null;
  private activeKey = ''; // identity of the current container.filters set, to skip no-op rewrites
  // The resolved application order (core blur + registry, as ids), recomputed only when the stored
  // `filterOrder` changes (compared by its joined string — an array param is a fresh copy on every coerce,
  // so identity would never hit).
  private orderSig = '';
  private ordered: readonly string[];
  private readonly byId: ReadonlyMap<string, FxFilterSpec>;

  constructor(private readonly container: Container, private readonly registry: readonly FxFilterSpec[]) {
    this.byId = new Map(registry.map((f) => [f.id, f] as const));
    this.ordered = resolveFilterOrder([], registry);
  }

  /** The application order in the params' `filterOrder` — see `resolveFilterOrder`. */
  private orderedIds(params: P): readonly string[] {
    const raw = params[FILTER_ORDER_KEY];
    const order = Array.isArray(raw) ? (raw as string[]) : [];
    const sig = order.join('|');
    if (sig !== this.orderSig) {
      this.orderSig = sig;
      this.ordered = resolveFilterOrder(order, this.registry);
    }
    return this.ordered;
  }

  frame(params: P, progress: number, dtSec: number): void {
    const active: Filter[] = [];
    const keyParts: string[] = [];

    for (const id of this.orderedIds(params)) {
      if (id === CORE_BLUR_ID) {
        // The shared always-on blur knob, same semantics as blurFilter.ts — orderable like the rest.
        const blurBase = num(params, 'blur');
        if (blurBase <= 0) continue;
        if (!this.coreBlur) this.coreBlur = new BlurFilter({ strength: 0, quality: 5 });
        this.coreBlur.strength = Math.max(0, blurBase * sampleCurve(curveOf(params, 'blurCurve'), progress));
        active.push(this.coreBlur);
        keyParts.push(CORE_BLUR_ID);
        continue;
      }
      const f = this.byId.get(id);
      if (f === undefined) continue;
      if (!bool(params, onKey(f.id))) continue;
      let inst = this.instances.get(f.id);
      if (!inst) { inst = f.make(); this.instances.set(f.id, inst); }
      const rec = inst as unknown as Record<string, number | boolean>;
      if (f.amountProp !== '') {
        rec[f.amountProp] = Math.max(0, num(params, amtKey(f.id), f.amount[2]) * sampleCurve(curveOf(params, curveKey(f.id)), progress));
      }
      if (f.animateTime) rec[f.timeProp ?? 'time'] = num(rec, f.timeProp ?? 'time') + dtSec;
      for (const k of f.knobs ?? []) {
        rec[k.prop] = k.kind === 'toggle'
          ? bool(params, knobKey(f.id, k.name))
          : num(params, knobKey(f.id, k.name), k.kind === 'color' ? (k.defaultColor ?? 0xffffff) : (k.range?.[2] ?? 0));
      }
      active.push(inst);
      keyParts.push(f.id);
    }

    const key = keyParts.join(',');
    if (key !== this.activeKey) {
      this.container.filters = active.length ? active : [];
      this.activeKey = key;
      activeFilterTotal += active.length - this.activeCount;
      this.activeCount = active.length;
    }
  }

  destroy(): void {
    this.container.filters = [];
    this.activeKey = '';
    activeFilterTotal -= this.activeCount;
    this.activeCount = 0;
    if (this.coreBlur) { this.coreBlur.destroy(); this.coreBlur = null; }
    for (const inst of this.instances.values()) inst.destroy();
    this.instances.clear();
  }
}
