import type { FxCatalogEntry } from './catalog';
import type { FxHue, FxMotion, FxUsage } from './catalog';

export type { FxCatalogEntry };

/**
 * The wiring facet, which used to be `'all' | 'bound' | 'unbound'`.
 *
 * `unbound` was retired rather than kept alongside the new values, deliberately: it selected fourteen defs of
 * which seven play constantly, so it answered a question nobody was asking. The three states it collapsed are
 * now separately selectable, and `unused` is the one an author actually wants — "what in here is dead?".
 */
export type FxUsageFilter = 'all' | FxUsage;

export interface FxFilter {
  search: string;
  hues: FxHue[];
  shapes: string[];
  motion: FxMotion | null;
  usage: FxUsageFilter;
}

export const EMPTY_FILTER: FxFilter = { search: '', hues: [], shapes: [], motion: null, usage: 'all' };

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
    // The files that fire it, so "which effects does Recruit play?" is a search rather than a code hunt.
    ...e.callSites,
  ]
    .join(' ')
    .toLowerCase();
}

/** Filters combine as AND; an empty facet list means "no constraint", not "match nothing". */
export function applyFilter(entries: FxCatalogEntry[], filter: FxFilter): FxCatalogEntry[] {
  const needle = filter.search.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.hues.length > 0 && !filter.hues.includes(e.facets.hue)) return false;
    if (filter.shapes.length > 0 && !filter.shapes.includes(e.facets.shape)) return false;
    if (filter.motion !== null && e.facets.motion !== filter.motion) return false;
    if (filter.usage !== 'all' && e.usage !== filter.usage) return false;
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
