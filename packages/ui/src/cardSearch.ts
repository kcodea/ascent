import { CARD_INDEX, GIFTS, RUNES, EPIC_RUNES, poolFor, type SetId } from '@game/content';

/**
 * Card + rune search shared by the DEV Scene Builder and the player-facing God Mode panel (owner 2026-10-08).
 * Pure: no React, no store. Lists are the run's set pool (tokens excluded) plus Rubies and gifts, and the set's
 * runes / epic runes. Archived content is never listed (poolFor covers set manifests only).
 */
export type CardRow = { id: string; name: string; tier: number; spell: boolean; tribe: string; tribe2?: string; hay: string; kind?: 'ruby' | 'gift' };
export type RuneRow = { id: string; name: string; cost: number; epic: boolean; isNew: boolean; hay: string };

/** Everything a row can be matched on, lowercased once. Searching the card's TEXT (not just its name/tribe) is
 *  what makes keyword queries work — "avenge", "deathrattle", "taunt", "magnetic" all live in the rules text or
 *  the keyword list rather than the title. Effect trigger/factory ids go in too, so a mechanic can be found even
 *  when the printed text words it differently. */
export const hay = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' ').toLowerCase();

/** EVERY term must match (AND), so "avenge beast" narrows instead of widening. Each term is a plain substring
 *  test against the row's haystack. */
export const matches = (haystack: string, terms: string[]): boolean => terms.every((t) => haystack.includes(t));

/** Split a query on whitespace into lowercase terms. */
export const searchTerms = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

const cardCache = new Map<SetId, CardRow[]>();

/** The set pool's cards (tokens excluded), plus RUBIES + GIFTS (owner ask 2026-09-16): neither is drawable (Rubies
 *  are tokens, Gifts a card class outside every set manifest), so `pool.all` never lists them — but both are cast
 *  from the Shop row like a spell, so they list as spells, labelled by class (`kind`). Sorted tier, then name.
 *  Cached per set (the rows are immutable). */
export function cardRowsFor(setId: SetId): CardRow[] {
  const hit = cardCache.get(setId);
  if (hit) return hit;
  const pool = poolFor(setId);
  const row = (c: (typeof pool.all)[number], kind?: 'ruby' | 'gift'): CardRow => ({
    id: c.id, name: c.name, tier: c.tier ?? 0, spell: !!c.spell || kind !== undefined, tribe: c.tribe ?? 'neutral',
    ...(c.tribe2 ? { tribe2: c.tribe2 } : {}), kind,
    hay: hay(c.name, c.id, c.tribe, c.tribe2, c.text, (c.keywords ?? []).join(' '),
      (c.effects ?? []).map((e) => `${e.on} ${e.do}`).join(' '), kind ?? ''),
  });
  const rubies = Object.values(CARD_INDEX).filter((c) => c.ruby).map((c) => row(c, 'ruby'));
  const gifts = GIFTS.map((c) => row(c, 'gift'));
  const rows = [...pool.all.filter((c) => !c.token).map((c) => row(c)), ...rubies, ...gifts]
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  cardCache.set(setId, rows);
  return rows;
}

/** SET SCOPING (owner ask 2026-09-16): only the runes THIS set can forge — the same `sets` rule the Runeforge
 *  applies (`runeforgePool`: absent = every set). The tribe gate is deliberately NOT applied: a tribe-gated rune of
 *  the set is exactly what you come to test without rolling the tribe first. `isNew` marks the Set 3-original batch
 *  (`sets: ['set3']` alone) with a NEW tag; searching "new" lists them. Basic runes first, then epic; by name. */
export function runeRowsFor(setId: SetId): RuneRow[] {
  return [...RUNES, ...EPIC_RUNES]
    .filter((r) => !r.sets || r.sets.includes(setId))
    .map((r) => {
      const isNew = !!r.sets && r.sets.length === 1 && r.sets[0] === 'set3';
      return {
        id: r.id, name: r.name, cost: r.cost, epic: !!r.epic, isNew,
        hay: hay(r.name, r.id, r.text, r.reward?.kind, r.epic ? 'epic' : 'basic', isNew ? 'new' : ''),
      };
    })
    .sort((a, b) => Number(a.epic) - Number(b.epic) || a.name.localeCompare(b.name));
}

/** One list's filter: which tab (`spell`), the search terms, and the tier / tribe chips (multi-select; an empty chip
 *  set = no filter). Tribe chips do not apply to spells. */
export interface CardFilter { spell: boolean; terms: string[]; tiers: readonly number[]; tribes: readonly string[] }

/** Rows of the chosen kind that pass every chip group AND the search text. A dual-tribe minion matches either tribe. */
export function filterCards(rows: readonly CardRow[], f: CardFilter): CardRow[] {
  return rows.filter((r) => r.spell === f.spell
    && (f.tiers.length === 0 || f.tiers.includes(r.tier))
    && (f.spell || f.tribes.length === 0 || f.tribes.includes(r.tribe) || (!!r.tribe2 && f.tribes.includes(r.tribe2)))
    && matches(r.hay, f.terms));
}

/** The distinct minion tribes among `rows` (both tribes of a dual-tribe minion), alphabetical with `neutral` last. */
export function tribesIn(rows: readonly CardRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (!r.spell) { set.add(r.tribe); if (r.tribe2) set.add(r.tribe2); }
  return [...set].sort((a, b) => (a === 'neutral' ? 1 : b === 'neutral' ? -1 : a.localeCompare(b)));
}
