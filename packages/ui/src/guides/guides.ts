/**
 * GUIDES: the build guides the lobby rail and the Compendium show.
 *
 * Since 2026-10-12 a guide is a SERVER ROW (guidesStore.ts loads them; spec:
 * docs/superpowers/specs/2026-10-11-community-guides-design.md). The eleven built-in guides (guides.bundled.ts) are
 * the offline fallback, turned into the same `Guide` shape here as `GUIDES`.
 *
 * WHICH GUIDES SHOW (owner rulings 2026-10-09 and 2026-10-11): a guide shows in a set when that set is in its
 * `sets`, and only when its tribe is in this lobby. Neutral guides always show. `pairsWith` is display only: a
 * second tribe chip the card wears when that tribe is also in the lobby; it never decides visibility.
 *
 * A CARD THAT LEFT (owner 2026-10-11: "lets grey out the card and say 'missing or removed'"): a guide keeps a card
 * that was archived or removed. `guideMissingIds` names them so the portrait row can grey them out.
 */
import type { Tribe } from '@game/core';
import { SETS, poolFor, type SetId } from '@game/content';
import { TEAM_BYLINE, guideSetsFor, type GuideRecord, type SetFacts } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';

export interface Guide {
  /** Stable for React keys and the rail's "open guide" memory: the built-in slug when there is one, else the row id. */
  id: string;
  /** The server row's id; null for a built-in copy that has no row. Writes address the guide by this. */
  rowId: string | null;
  /** The sets this guide shows in. */
  sets: readonly SetId[];
  /** The tribes this guide is for. Empty = a neutral guide (always shown). */
  tribes: readonly Tribe[];
  /** A crossover tribe, shown as a second chip when it is also in the lobby. Never gates visibility. */
  pairsWith?: readonly Tribe[];
  /** The card whose ART stands for this guide on its row. Any card id with art, tokens and spells included. */
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: readonly string[];
  enablers: readonly string[];
  /** Other cards the body names. Not shown as portraits; only their names in the body become hoverable. */
  mentions?: readonly string[];
  /** Body words that stand for a card under a shorter name. Word -> card id. */
  aliases?: Readonly<Record<string, string>>;
  /** The "by" line. `Team Ascent` on every official guide. */
  byline: string;
  official: boolean;
  published: boolean;
  hidden: boolean;
  authorId: string | null;
  /** The row's revision (0 for a built-in copy). A save sends back the one it loaded. */
  revision: number;
  /** Position among official guides (the built-in data order, then creation order). */
  order: number;
  forkedTitle?: string;
  forkedByline?: string;
}

/** The Guides view's display mode: SIMPLE = the normal-width rail, portraits only; FULL = the wide rail + write-up. */
export type GuidesMode = 'simple' | 'full';

export const PLACEHOLDER_BODY = 'Guide coming soon.';

const SET_IDS = Object.keys(SETS) as SetId[];
const KNOWN_SETS: ReadonlySet<string> = new Set(SET_IDS);
const KNOWN_TRIBES: ReadonlySet<string> = new Set(SET_IDS.flatMap((s) => SETS[s].tribes));

const poolIds = new Map<SetId, ReadonlySet<string>>();
/** Every card id in a set's pool (tokens included), memoized. */
export function poolIdsFor(setId: SetId): ReadonlySet<string> {
  let ids = poolIds.get(setId);
  if (!ids) {
    ids = new Set(poolFor(setId).all.map((c) => c.id));
    poolIds.set(setId, ids);
  }
  return ids;
}

const SET_FACTS: readonly SetFacts[] = SET_IDS.map((id) => ({ id, cardIds: poolIdsFor(id), tribes: SETS[id].tribes }));

/** The built-in guides as `Guide`s: each shows in the set it was written for, plus any set all of its cards are in. */
export const GUIDES: readonly Guide[] = BUNDLED_GUIDE_DATA.map((d, i) => {
  const { set, ...rest } = d;
  const carried = guideSetsFor(rest, SET_FACTS) as SetId[];
  return {
    ...rest,
    rowId: null,
    sets: carried.includes(set) ? carried : [set, ...carried],
    byline: TEAM_BYLINE,
    official: true,
    published: true,
    hidden: false,
    authorId: null,
    revision: 0,
    order: i,
  };
});

/**
 * A server row as the UI draws it. Null for a guide this build cannot place: one for a tribe it has never heard of
 * (an older client must not show it as Neutral, in every lobby). An unknown set id or crossover tribe is dropped
 * from the guide; an unknown card id is kept and greys out (`guideMissingIds`).
 */
export function toGuide(r: GuideRecord): Guide | null {
  if (r.tribes.some((t) => !KNOWN_TRIBES.has(t))) return null;
  const pairsWith = r.pairsWith.filter((t) => KNOWN_TRIBES.has(t)) as Tribe[];
  return {
    id: r.slug ?? r.id,
    rowId: r.id,
    sets: r.sets.filter((s): s is SetId => KNOWN_SETS.has(s)),
    tribes: r.tribes as Tribe[],
    pairsWith: pairsWith.length ? pairsWith : undefined,
    iconCard: r.iconCard,
    title: r.title,
    tagline: r.tagline,
    body: r.body,
    core: r.core,
    enablers: r.enablers,
    mentions: r.mentions.length ? r.mentions : undefined,
    aliases: Object.keys(r.aliases).length ? r.aliases : undefined,
    byline: r.byline,
    official: r.official,
    published: r.published,
    hidden: r.hidden,
    authorId: r.authorId,
    revision: r.revision,
    order: r.sortOrder,
    forkedTitle: r.forkedTitle ?? undefined,
    forkedByline: r.forkedByline ?? undefined,
  };
}

/** A tribe's INK for text and accents: its `--t-<tribe>` token, except Dragon (white, so the rune cards' warm coral)
 *  and Neutral (the rune cards' soft gold). Owner ask 2026-10-09: "color the tribe names so they stand out". */
export function tribeInk(t: Tribe): string {
  if (t === 'dragon') return '#ff8a6a';
  if (t === 'neutral') return '#e8c27a';
  return `var(--t-${t})`;
}

/**
 * The guides this game shows, from `list` (the store's, or the built-in ones): the set's, and only tribes in this
 * lobby (neutral always). A tribe's guides stay together: tribes come in the order each FIRST appears in the list,
 * Neutral last, and each tribe's guides in list order. So today's order is unchanged, and a guide the team adds
 * later for an existing tribe lands beside that tribe's others.
 */
export function guidesFor(setId: SetId | undefined, tribes: readonly Tribe[], list: readonly Guide[] = GUIDES): Guide[] {
  const set = setId ?? 'set1';
  const shown = list.filter((g) => g.sets.includes(set) && (g.tribes.length === 0 || g.tribes.some((t) => tribes.includes(t))));
  const firstSeen = new Map<string, number>();
  for (const g of shown) {
    const key = g.tribes[0] ?? '';
    const at = firstSeen.get(key);
    if (at === undefined || g.order < at) firstSeen.set(key, g.order);
  }
  const rank = (g: Guide): number => (g.tribes.length === 0 ? Number.MAX_SAFE_INTEGER : firstSeen.get(g.tribes[0]!)!);
  return [...shown].sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.id.localeCompare(b.id));
}

const NO_MISSING: ReadonlySet<string> = new Set();
/** The Core, Enabler and mentioned cards of `guide` that are not in `setId`'s pool (archived, moved, or gone). */
export function guideMissingIds(guide: Guide, setId: SetId | undefined): ReadonlySet<string> {
  const pool = poolIdsFor(setId ?? 'set1');
  const out = [...guide.core, ...guide.enablers, ...(guide.mentions ?? [])].filter((id) => !pool.has(id));
  return out.length ? new Set(out) : NO_MISSING;
}
