import { CARD_INDEX } from '@game/content';

/**
 * The Stage Builder's card search (DEV): every minion card an opponent may field (tokens included), with a
 * lowercased haystack to match on — the Scene Builder Library's `hay`/`matches` approach. Shared by the panel's
 * "add a minion" search, the board canvas's "+" picker and the unit editor's card swap.
 */

const hay = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' ').toLowerCase();

export type MinionRow = { id: string; name: string; tier: number; hay: string };

let rows: MinionRow[] | null = null;
/** Every non-spell card, sorted by tier then name. Built once. */
export const allMinions = (): MinionRow[] => (rows ??= Object.values(CARD_INDEX)
  .filter((c) => !c.spell)
  .map((c) => ({
    id: c.id, name: c.name, tier: c.tier ?? 0,
    hay: hay(c.name, c.id, c.tribe, c.tribe2, c.text, (c.keywords ?? []).join(' ')),
  }))
  .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)));

/** Space-separated terms, lowercased. */
export const searchTerms = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** The rows every term matches (none for an empty query). */
export function searchMinions(query: string): MinionRow[] {
  const terms = searchTerms(query);
  return terms.length ? allMinions().filter((c) => terms.every((t) => c.hay.includes(t))) : [];
}
