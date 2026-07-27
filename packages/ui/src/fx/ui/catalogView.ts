import type { FxCatalogEntry } from './catalog';
import type { FxHue, FxMotion } from './catalog';

export type { FxCatalogEntry };

export interface FxFilter {
  search: string;
  hues: FxHue[];
  shapes: string[];
  motion: FxMotion | null;
  bound: 'all' | 'bound' | 'unbound';
}

export const EMPTY_FILTER: FxFilter = { search: '', hues: [], shapes: [], motion: null, bound: 'all' };

/** Everything one entry can be matched against by the search box, lower-cased once per call. */
function searchableText(e: FxCatalogEntry): string {
  return [
    e.def.id,
    e.def.label ?? '',
    ...(e.def.tags ?? []),
    e.facets.shape,
    e.facets.hue,
    ...e.bindings.kinds,
    ...e.bindings.cards.map((c) => c.name),
  ]
    .join(' ')
    .toLowerCase();
}

const isBound = (e: FxCatalogEntry): boolean => e.bindings.kinds.length > 0 || e.bindings.cards.length > 0;

/** Filters combine as AND; an empty facet list means "no constraint", not "match nothing". */
export function applyFilter(entries: FxCatalogEntry[], filter: FxFilter): FxCatalogEntry[] {
  const needle = filter.search.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.hues.length > 0 && !filter.hues.includes(e.facets.hue)) return false;
    if (filter.shapes.length > 0 && !filter.shapes.includes(e.facets.shape)) return false;
    if (filter.motion !== null && e.facets.motion !== filter.motion) return false;
    if (filter.bound === 'bound' && !isBound(e)) return false;
    if (filter.bound === 'unbound' && isBound(e)) return false;
    if (needle !== '' && !searchableText(e).includes(needle)) return false;
    return true;
  });
}

export interface FxLookGroup {
  title: string;
  entries: FxCatalogEntry[];
}

/** Grouped by shape, then colour within each shape. Both sorts are alphabetical so the list does not
 *  reorder itself between renders — a library that shuffles is unusable for finding things twice. */
export function groupByLook(entries: FxCatalogEntry[]): FxLookGroup[] {
  const byShape = new Map<string, FxCatalogEntry[]>();
  for (const e of entries) {
    const key = e.facets.shape === '' ? '(empty)' : e.facets.shape;
    byShape.set(key, [...(byShape.get(key) ?? []), e]);
  }
  return [...byShape.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, list]) => ({
      title,
      entries: [...list].sort((a, b) => a.facets.hue.localeCompare(b.facets.hue) || a.def.id.localeCompare(b.def.id)),
    }));
}

export interface FxCardRow {
  cardId: string;
  name: string;
  tribe: string;
  /** The def explicitly bound to this card, or null = "uses whatever its moment kinds give it". */
  defId: string | null;
}

export interface FxTribeGroup {
  title: string;
  cards: FxCardRow[];
}

/** Grouped by tribe, then card name. Cards with NO bespoke effect are kept: a tribe that is entirely bare
 *  is the most useful thing this lens can tell you, and hiding unbound cards would hide it. */
export function groupByCard(cards: FxCardRow[]): FxTribeGroup[] {
  const byTribe = new Map<string, FxCardRow[]>();
  for (const c of cards) byTribe.set(c.tribe, [...(byTribe.get(c.tribe) ?? []), c]);
  return [...byTribe.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([title, list]) => ({ title, cards: [...list].sort((a, b) => a.name.localeCompare(b.name)) }));
}
