import { getHero } from '@game/sim';

/** One hero in a game list's hero filter: its id and how many of the loaded games it played. */
export interface HeroCount { id: string; n: number }

/**
 * The heroes a game list can be filtered by (owner ask 2026-10-18, the Recent Games "More" dropdown): every hero that
 * appears in the LOADED games, with its game count. Sorted by game count (most first), then by hero name, so the order
 * is stable between loads with the same counts. Rows with no hero are skipped.
 */
export function heroFilterCounts(rows: readonly { heroId?: string | null }[] | null | undefined): HeroCount[] {
  const n = new Map<string, number>();
  for (const r of rows ?? []) if (r.heroId) n.set(r.heroId, (n.get(r.heroId) ?? 0) + 1);
  const name = (id: string): string => getHero(id).name;
  return [...n.entries()]
    .map(([id, c]) => ({ id, n: c }))
    .sort((a, b) => b.n - a.n || name(a.id).localeCompare(name(b.id)));
}

/** The most heroes shown as their own chip before the rest go in the "More" dropdown. The row may show fewer: it keeps
 *  only as many as fit on one line beside "All heroes" and "More". */
export const HERO_CHIP_CAP = 8;
