import { FILTERS } from '../filterRegistry';
import { CORE_BLUR_ID, FILTER_ORDER_KEY, resolveFilterOrder } from '../filterStack';
import type { FxParamSpecs } from '../params';

/**
 * Partitions the Filter Lab's params under one master "Filters" group in the inspector, instead of one
 * top-level accordion group PER filter (30+ registry entries otherwise means 30+ groups competing with the
 * primitive's own for attention). Pure model, no React — `Inspector.tsx` renders off this.
 *
 * `onKey` mirrors `filterStack.ts`'s local `onKey(id) => \`${id}On\`` — not exported there, so replicated here
 * rather than reaching into that module's internals.
 */
const onKey = (id: string): string => `${id}On`;

/** Every registry filter's label — i.e. every `group` value `filterLabSpecs` assigns to a filter's params.
 *  Used to recognise "this group is a filter, fold it under the Filters master" vs. a primitive's own group. */
export const FILTER_GROUP_LABELS: ReadonlySet<string> = new Set(FILTERS.map((f) => f.label));

/** One filter row under the Filters master group. */
export interface FilterEntry {
  id: string;
  label: string;
  onKey: string;
  on: boolean;
  /** Every spec key grouped under this filter's label EXCEPT the toggle itself (rendered as the filter's own
   *  header row), in the specs' declared order. */
  paramKeys: string[];
}

/** Is `group` one of the registry filters' labels (as opposed to a primitive's own group, or `undefined`)? */
export function isFilterGroup(group: string | undefined): boolean {
  return group != null && FILTER_GROUP_LABELS.has(group);
}

/**
 * One `FilterEntry` per registry filter that actually has specs present in `specs` (a primitive's specs only
 * ever contain the filters `filterLabSpecs` generated for it, so most primitives won't have all of them).
 * Enabled filters float to the top; within each half the order is the layer's `filterOrder` (resolved
 * against the registry — see `resolveFilterOrder`), so the enabled rows read TOP → BOTTOM as the order the
 * filters are APPLIED, and toggling one on/off reorders the list exactly once, predictably.
 */
export function filterEntries(specs: FxParamSpecs, values: Record<string, unknown>): FilterEntry[] {
  const enabled: FilterEntry[] = [];
  const disabled: FilterEntry[] = [];
  const raw = values[FILTER_ORDER_KEY];
  const byId = new Map(FILTERS.map((f) => [f.id, f] as const));
  for (const id of resolveFilterOrder(Array.isArray(raw) ? (raw as string[]) : [], FILTERS)) {
    if (id === CORE_BLUR_ID) {
      // The core Blur is orderable like any filter but its knobs stay in the primitive's own Style group
      // (they are shared params, not lab params), so this row is a placeholder for ORDER only: no toggle
      // (it is "on" whenever Blur > 0) and no params of its own.
      if (!(CORE_BLUR_ID in specs)) continue;
      const on = (typeof values[CORE_BLUR_ID] === 'number' ? (values[CORE_BLUR_ID] as number) : 0) > 0;
      (on ? enabled : disabled).push({ id: CORE_BLUR_ID, label: 'Blur (core)', onKey: CORE_BLUR_ID, on, paramKeys: [] });
      continue;
    }
    const f = byId.get(id);
    if (f === undefined) continue;
    const key = onKey(f.id);
    if (!(key in specs)) continue;
    const paramKeys: string[] = [];
    for (const specKey of Object.keys(specs)) {
      if (specKey === key) continue;
      if (specs[specKey].group === f.label) paramKeys.push(specKey);
    }
    const on = values[key] === true;
    const entry: FilterEntry = { id: f.id, label: f.label, onKey: key, on, paramKeys };
    (on ? enabled : disabled).push(entry);
  }
  return [...enabled, ...disabled];
}

/** How many of these entries are enabled — the count the Filters master group's header badge shows. */
export function filterOnCount(entries: readonly FilterEntry[]): number {
  return entries.reduce((n, e) => n + (e.on ? 1 : 0), 0);
}

/**
 * The `filterOrder` to store after moving entry `id` one step up (`-1`) or down (`+1`) in the rendered
 * list. A move only happens between neighbours with the same on-state (the list is partitioned enabled-first,
 * so crossing the boundary would be invisible); otherwise the current order is returned unchanged. The
 * result is the FULL rendered id list, which `resolveFilterOrder` reproduces exactly — so what you see is
 * what gets stored, and what gets stored is what composes.
 */
export function moveFilter(entries: readonly FilterEntry[], id: string, dir: -1 | 1): string[] {
  const ids = entries.map((e) => e.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length || entries[i].on !== entries[j].on) return ids;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}
