import { FILTERS } from '../filterRegistry';
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
 * Enabled filters float to the top; within each half, order is stable by registry order — so toggling a
 * filter on/off reorders the list exactly once, predictably, rather than jumping around some other sort.
 */
export function filterEntries(specs: FxParamSpecs, values: Record<string, unknown>): FilterEntry[] {
  const enabled: FilterEntry[] = [];
  const disabled: FilterEntry[] = [];
  for (const f of FILTERS) {
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
