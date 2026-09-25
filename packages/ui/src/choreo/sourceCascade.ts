/**
 * SOURCE CASCADE — when several minions fire the same kind of authored buff effect in one beat, they fire one
 * after another, LEFT-MOST FIRST, instead of all at once (owner ask 2026-09-24, two King Oonas: *"i would love
 * it if we could have the left-most oona fire first, then the next oona fires 200 ms later, and so on"*).
 *
 * Pure: the caller supplies each source's on-screen x (so the order is what the player SEES, on either side of
 * the board) and which casts take part. Returns each participating source's rank — 0 fires immediately, rank
 * `k` fires `k * SOURCE_CASCADE_MS` later. Every cast from one source shares its rank, so a minion buffing
 * several units still fires at all of them together (a def's own per-recipient `stagger` still applies).
 */
export const SOURCE_CASCADE_MS = 200;

export function sourceCascadeRanks<C extends { source: string }>(
  casts: readonly C[],
  xOf: (uid: string) => number | null,
  takesPart: (c: C) => boolean,
): Map<string, number> {
  const seen: { uid: string; x: number | null; order: number }[] = [];
  for (const c of casts) {
    if (!takesPart(c) || seen.some((s) => s.uid === c.source)) continue;
    seen.push({ uid: c.source, x: xOf(c.source), order: seen.length });
  }
  // Left to right by screen x. A source with no measurable position keeps its log order, after the measured ones.
  seen.sort((a, b) => (a.x === null ? 1 : 0) - (b.x === null ? 1 : 0) || (a.x ?? 0) - (b.x ?? 0) || a.order - b.order);
  return new Map(seen.map((s, i) => [s.uid, i]));
}
