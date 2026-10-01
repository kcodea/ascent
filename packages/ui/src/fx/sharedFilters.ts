import { Container } from 'pixi.js';
import type { FxDef, FxSlot } from './def';
import { fxFilterIds, fxMakeFilterStack, type FxFilterStackHandle } from './fxRuntime';

/**
 * SHARED FILTER GROUPS: one post-process pass for many plays of the same def (perf report 2026-09-30).
 *
 * A def layer's filters (Bloom, Glow, …) live on that layer's own container, so every play pays its own
 * render-to-texture pass per filter, and a seamless loop pays it again for every cycle still draining. The
 * persistent milestone-badge loops (`milestoneBadgeFx.ts`: two filters, ~4 cycles alive at once) made that
 * 8 passes per badge: a late-game board of 7 units over 5,000 Attack and Health held 14 loops and 42 filtered
 * containers, and the FX tick measured 16.1 ms on the dev build, 2.9 ms with the filters stripped.
 *
 * A play that opts in (`PlayDefOptions.shareFilters`) and whose filters are TIME-INVARIANT (every filter curve
 * flat, the same filter params on every filtered layer: `sharedFilterParams`) is drawn with its per-layer
 * filters OFF (`stripFilters`), inside a group container that carries the def's filters ONCE. Bloom is a blur
 * plus an add, so filtering the union equals filtering each play and summing wherever the plays do not overlap
 * (and badges sit on different cards); Glow differs only where two halos overlap. The pass count stops
 * scaling with the number of plays.
 *
 * Anything else (a filter curve that animates, layers with different filters) is declined and the play runs
 * exactly as before.
 */

type P = Record<string, unknown>;

/** A filter param key belongs to the lab registry (`<id>On` / `<id>Amt` / `<id>Curve` / `<id>_<knob>`), the
 *  core blur (`blur` / `blurCurve`) or the order (`filterOrder`). */
function isFilterKey(key: string, ids: readonly string[]): boolean {
  if (key === 'blur' || key === 'blurCurve' || key === 'filterOrder') return true;
  for (const id of ids) {
    if (key === `${id}On` || key === `${id}Amt` || key === `${id}Curve` || key.startsWith(`${id}_`)) return true;
  }
  return false;
}

function hasActiveFilter(params: P, ids: readonly string[]): boolean {
  if (typeof params.blur === 'number' && params.blur > 0) return true;
  return ids.some((id) => params[`${id}On`] === true);
}

const isFlat = (curve: unknown): boolean => {
  if (!Array.isArray(curve) || curve.length === 0) return true;
  const v0 = (curve[0] as unknown[])[1];
  return curve.every((pt) => Array.isArray(pt) && pt[1] === v0);
};

/**
 * PURE: the filter params every filtered layer of `def` shares, when the def can be drawn through ONE shared
 * stack; otherwise null. Null for a def with no filters (nothing to share), for layers whose filters differ,
 * and for any active filter whose amount curve is not flat (an animated filter must stay per play).
 */
export function sharedFilterParams(def: Pick<FxDef, 'layers'>, ids: readonly string[] = fxFilterIds()): P | null {
  if (ids.length === 0) return null;
  let shared: P | null = null;
  let sig = '';
  for (const layer of def.layers) {
    const params = layer.params as P;
    // A toggle ON for a filter outside `ids` (one that animates off its own clock) cannot share a stack.
    for (const k of Object.keys(params)) {
      if (k.endsWith('On') && params[k] === true && !ids.includes(k.slice(0, -2))) return null;
    }
    if (!hasActiveFilter(params, ids)) continue;
    const sub: P = {};
    for (const k of Object.keys(params)) if (isFilterKey(k, ids)) sub[k] = params[k];
    for (const id of ids) if (sub[`${id}On`] === true && !isFlat(sub[`${id}Curve`])) return null;
    if (typeof sub.blur === 'number' && sub.blur > 0 && !isFlat(sub.blurCurve)) return null;
    const s = JSON.stringify(sub, Object.keys(sub).sort());
    if (shared === null) { shared = sub; sig = s; } else if (s !== sig) return null;
  }
  return shared;
}

/** PURE: `def` with every layer's filters switched OFF (toggles false, core blur 0). Nothing else changes. */
export function stripFilters<T extends Pick<FxDef, 'layers'>>(def: T, ids: readonly string[] = fxFilterIds()): T {
  const layers = def.layers.map((layer) => {
    const params = layer.params as P;
    if (!hasActiveFilter(params, ids)) return layer;
    const next: P = { ...params };
    for (const id of ids) if (next[`${id}On`] === true) next[`${id}On`] = false;
    if (typeof next.blur === 'number' && next.blur > 0) next.blur = 0;
    return { ...layer, params: next };
  });
  return { ...def, layers } as T;
}

interface Group {
  readonly host: Container;
  readonly stack: FxFilterStackHandle;
  readonly unmount: () => void;
  refs: number;
}

const groups = new Map<string, Group>();

/** A play's seat in a shared group: mount its container on `host`, and `release` exactly once when it retires. */
export interface FilterGroupSeat {
  readonly host: Container;
  release(): void;
}

/**
 * Join (creating on first use) the shared filter group `key` on `slot`, whose filters are `params`. Returns
 * null when the FX runtime cannot build a stack (the primitives are not loaded), so the caller falls back.
 */
export function joinFilterGroup(
  key: string,
  slot: FxSlot,
  params: P,
  mount: (c: Container, slot: FxSlot) => () => void,
): FilterGroupSeat | null {
  const gk = `${slot}|${key}`;
  let g = groups.get(gk);
  if (!g) {
    const host = new Container();
    const stack = fxMakeFilterStack(host);
    if (!stack) { host.destroy(); return null; }
    stack.frame(params, 0, 0); // time-invariant (checked by `sharedFilterParams`): one write, never re-run
    g = { host, stack, unmount: mount(host, slot), refs: 0 };
    groups.set(gk, g);
  }
  g.refs++;
  const group = g;
  let released = false;
  return {
    host: group.host,
    release: () => {
      if (released) return;
      released = true;
      group.refs--;
      if (group.refs > 0) return;
      if (groups.get(gk) === group) groups.delete(gk);
      group.stack.destroy();
      group.unmount();
      if (!group.host.destroyed) group.host.destroy({ children: false });
    },
  };
}

/** Live groups, for tests and the DEV console. */
export function filterGroupCount(): number {
  return groups.size;
}
