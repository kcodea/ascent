/**
 * Picking the v2 reference boards of one round (strength v2 design 2026-11-16, section 6.A).
 *
 * 40 boards: 28 evenly spaced by rank across the whole round, plus 12 evenly spaced inside the top 20% (the v1
 * reference bunched strong boards at the ceiling), and no player supplies more than 10 of the 40.
 */
export interface RefPickOptions { total: number; even: number; top: number; topShare: number; maxPerOwner: number }

export const REF_PICK_V2: RefPickOptions = { total: 40, even: 28, top: 12, topShare: 0.2, maxPerOwner: 10 };

/** `owners[i]` owns the i-th board, weakest to strongest. Returns the picked indices, ascending. */
export function pickReferenceIndices(owners: readonly (string | null)[], opts: RefPickOptions = REF_PICK_V2): number[] {
  const n = owners.length;
  if (n <= opts.total) return owners.map((_, i) => i);
  const targets: number[] = [];
  for (let i = 0; i < opts.even; i++) targets.push(Math.round((i * (n - 1)) / Math.max(1, opts.even - 1)));
  const start = Math.floor(n * (1 - opts.topShare));
  for (let j = 0; j < opts.top; j++) targets.push(Math.min(n - 1, Math.round(start + ((j + 0.5) * (n - start)) / opts.top)));
  const taken = new Set<number>();
  const perOwner = new Map<string, number>();
  const allowed = (i: number): boolean => {
    const o = owners[i];
    return o === null || o === undefined || (perOwner.get(o) ?? 0) < opts.maxPerOwner;
  };
  /** The nearest untaken index to `t` passing `ok` (lower index on a tie), or -1. */
  const nearest = (t: number, ok: (i: number) => boolean): number => {
    for (let d = 0; d < n; d++) {
      for (const i of d === 0 ? [t] : [t - d, t + d]) if (i >= 0 && i < n && !taken.has(i) && ok(i)) return i;
    }
    return -1;
  };
  for (const t of targets) {
    let pick = nearest(t, allowed);
    if (pick < 0) pick = nearest(t, () => true); // every remaining owner is at the cap
    if (pick < 0) break;
    taken.add(pick);
    const o = owners[pick];
    if (o !== null && o !== undefined) perOwner.set(o, (perOwner.get(o) ?? 0) + 1);
  }
  return [...taken].sort((a, b) => a - b);
}

/** The rounds that start a reference round. A round merges into the previous one when it, or that one so far, has
 *  fewer than `minBoards` real boards (the v1 builder's rule, with the v2 minimum of 40). */
export function referenceBuckets(boardsPerRound: ReadonlyMap<number, number>, minBoards = 40): number[] {
  const out: number[] = [];
  let lastCount = 0;
  for (const round of [...boardsPerRound.keys()].sort((a, b) => a - b)) {
    const count = boardsPerRound.get(round) ?? 0;
    if (out.length && (count < minBoards || lastCount < minBoards)) { lastCount += count; continue; }
    out.push(round);
    lastCount = count;
  }
  return out;
}
