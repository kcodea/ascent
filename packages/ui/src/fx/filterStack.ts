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

/** Generate the flat param specs for a registry — a toggle, an amount slider, an over-time curve, and each
 *  knob, all grouped under the filter's label and (except the toggle) gated on that toggle being on. */
export function filterLabSpecs(registry: readonly FxFilterSpec[]): FxParamSpecs {
  const out: Record<string, FxParamSpec> = {};
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
/** A registry entry with its param keys resolved ONCE — see `FilterStack.frame`. */
interface KeyedFilterSpec {
  spec: FxFilterSpec;
  on: string;
  amt: string;
  curve: string;
  knobs: ReadonlyArray<{ knob: NonNullable<FxFilterSpec['knobs']>[number]; key: string }>;
}

/** Keys per registry, computed once per registry object. The registry is a module constant, so this is one
 *  allocation for the life of the page instead of one per instance per frame. */
const keyedRegistries = new WeakMap<readonly FxFilterSpec[], readonly KeyedFilterSpec[]>();
function keyedRegistryOf(registry: readonly FxFilterSpec[]): readonly KeyedFilterSpec[] {
  const hit = keyedRegistries.get(registry);
  if (hit) return hit;
  const out = registry.map((spec) => ({
    spec,
    on: onKey(spec.id),
    amt: amtKey(spec.id),
    curve: curveKey(spec.id),
    knobs: (spec.knobs ?? []).map((knob) => ({ knob, key: knobKey(spec.id, knob.name) })),
  }));
  keyedRegistries.set(registry, out);
  return out;
}

export class FilterStack {
  private readonly instances = new Map<string, Filter>();
  private coreBlur: BlurFilter | null = null;
  private activeKey = ''; // identity of the current container.filters set, to skip no-op rewrites
  private readonly keyed: readonly KeyedFilterSpec[];

  constructor(private readonly container: Container, registry: readonly FxFilterSpec[]) {
    this.keyed = keyedRegistryOf(registry);
  }

  /**
   * Called once per frame from every particle/mesh primitive's `update()`.
   *
   * PERF (audit 2026-09-01): this used to allocate two arrays and ~31 template strings (one `<id>On` per
   * registry entry) on EVERY call — ~34 objects per instance per frame, ~330k allocations/s across a busy
   * board at 240 Hz — while not one committed def enables a single lab filter. The keys are now resolved once
   * per registry, and the common case (no blur, nothing enabled) returns before allocating anything.
   */
  frame(params: P, progress: number, dtSec: number): void {
    const blurBase = num(params, 'blur');

    // FAST PATH — nothing enabled. Keep the container's filters clear (once) and leave.
    if (blurBase <= 0 && !this.anyEnabled(params)) {
      if (this.activeKey !== '') { this.container.filters = []; this.activeKey = ''; }
      return;
    }

    const active: Filter[] = [];
    let key = '';

    // Core blur first (shared always-on knob), same semantics as blurFilter.ts.
    if (blurBase > 0) {
      if (!this.coreBlur) this.coreBlur = new BlurFilter({ strength: 0, quality: 5 });
      this.coreBlur.strength = Math.max(0, blurBase * sampleCurve(curveOf(params, 'blurCurve'), progress));
      active.push(this.coreBlur);
      key = 'blur';
    }

    for (const kf of this.keyed) {
      if (!bool(params, kf.on)) continue;
      const f = kf.spec;
      let inst = this.instances.get(f.id);
      if (!inst) { inst = f.make(); this.instances.set(f.id, inst); }
      const rec = inst as unknown as Record<string, number | boolean>;
      if (f.amountProp !== '') {
        rec[f.amountProp] = Math.max(0, num(params, kf.amt, f.amount[2]) * sampleCurve(curveOf(params, kf.curve), progress));
      }
      if (f.animateTime) rec[f.timeProp ?? 'time'] = num(rec, f.timeProp ?? 'time') + dtSec;
      for (const { knob: k, key: kk } of kf.knobs) {
        rec[k.prop] = k.kind === 'toggle'
          ? bool(params, kk)
          : num(params, kk, k.kind === 'color' ? (k.defaultColor ?? 0xffffff) : (k.range?.[2] ?? 0));
      }
      active.push(inst);
      key = key === '' ? f.id : `${key},${f.id}`;
    }

    if (key !== this.activeKey) {
      this.container.filters = active.length ? active : [];
      this.activeKey = key;
    }
  }

  /** Is any registry filter switched on in `params`? A plain loop over precomputed keys — no allocation. */
  private anyEnabled(params: P): boolean {
    for (const kf of this.keyed) if (params[kf.on] === true) return true;
    return false;
  }

  destroy(): void {
    this.container.filters = [];
    this.activeKey = '';
    if (this.coreBlur) { this.coreBlur.destroy(); this.coreBlur = null; }
    for (const inst of this.instances.values()) inst.destroy();
    this.instances.clear();
  }
}
