/**
 * DOC BOT — DETERMINISTIC PAIRWISE COVERING ARRAY (handoff §8.1).
 *
 * A strength-2 covering array: a small set of rows over N categorical dimensions such that EVERY pair of
 * levels from every pair of dimensions appears together in at least one row — without testing the full
 * Cartesian product. The construction is a classic seeded-greedy build and is FULLY deterministic (no
 * randomness at all, not even seeded): rows, order and coverage are a pure function of the dimension list,
 * so the emitted array is stable across runs/machines and safe to assert against.
 *
 * Construction: while any (dimI=a, dimJ=b) pair is uncovered, seed a new row with the FIRST uncovered pair
 * in canonical order (dimension index, then level index), then fill every other dimension with the level
 * that covers the most still-uncovered pairs against the already-assigned dimensions (ties broken by level
 * index). Every row therefore covers at least its seed pair, which no earlier row covers — termination and
 * the sabotage property ("dropping the last row must break all-pairs coverage") both follow by construction.
 */

export interface Dimension {
  readonly name: string;
  readonly levels: readonly string[];
}

export type CoveringRow = Readonly<Record<string, string>>;

export interface CoveringArrayResult {
  rows: CoveringRow[];
  /** rowsCovered[i] = the pairs row i was the FIRST to cover, as "dimA=a × dimB=b" strings. Union over all
   *  rows = every pair — the per-scenario coverage report the handoff asks for. */
  rowsCovered: string[][];
  /** Total number of distinct dimension-level pairs that must be covered. */
  totalPairs: number;
  /** Size of the full Cartesian product the array replaces. */
  cartesianSize: number;
}

const pairKey = (i: number, a: number, j: number, b: number): string => `${i}:${a}|${j}:${b}`;

function pairLabel(dims: readonly Dimension[], i: number, a: number, j: number, b: number): string {
  return `${dims[i]!.name}=${dims[i]!.levels[a]} × ${dims[j]!.name}=${dims[j]!.levels[b]}`;
}

/** Generate the pairwise covering array. Pure + deterministic — same dims in, same rows out, always. */
export function pairwiseCoveringArray(dims: readonly Dimension[]): CoveringArrayResult {
  if (dims.length < 2) throw new Error('pairwiseCoveringArray needs at least two dimensions');
  for (const d of dims) if (d.levels.length === 0) throw new Error(`dimension ${d.name} has no levels`);

  // All pairs, in canonical order (the order also drives seed selection).
  const uncovered = new Set<string>();
  const orderedPairs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      for (let a = 0; a < dims[i]!.levels.length; a++) {
        for (let b = 0; b < dims[j]!.levels.length; b++) {
          orderedPairs.push([i, a, j, b]);
          uncovered.add(pairKey(i, a, j, b));
        }
      }
    }
  }
  const totalPairs = uncovered.size;
  const cartesianSize = dims.reduce((n, d) => n * d.levels.length, 1);

  const rows: CoveringRow[] = [];
  const rowsCovered: string[][] = [];

  while (uncovered.size > 0) {
    // Seed: the first still-uncovered pair in canonical order.
    const seed = orderedPairs.find(([i, a, j, b]) => uncovered.has(pairKey(i, a, j, b)))!;
    const [si, sa, sj, sb] = seed;
    const assigned = new Map<number, number>([[si, sa], [sj, sb]]);

    // Fill the remaining dimensions greedily.
    for (let k = 0; k < dims.length; k++) {
      if (assigned.has(k)) continue;
      let best = 0;
      let bestGain = -1;
      for (let lv = 0; lv < dims[k]!.levels.length; lv++) {
        let gain = 0;
        for (const [dk, dv] of assigned) {
          const [i, a, j, b] = dk < k ? [dk, dv, k, lv] : [k, lv, dk, dv];
          if (uncovered.has(pairKey(i, a, j, b))) gain++;
        }
        if (gain > bestGain) { bestGain = gain; best = lv; }
      }
      assigned.set(k, best);
    }

    // Record the row + strike its newly covered pairs.
    const row: Record<string, string> = {};
    for (let k = 0; k < dims.length; k++) row[dims[k]!.name] = dims[k]!.levels[assigned.get(k)!]!;
    const newly: string[] = [];
    for (let i = 0; i < dims.length; i++) {
      for (let j = i + 1; j < dims.length; j++) {
        const key = pairKey(i, assigned.get(i)!, j, assigned.get(j)!);
        if (uncovered.delete(key)) newly.push(pairLabel(dims, i, assigned.get(i)!, j, assigned.get(j)!));
      }
    }
    rows.push(row);
    rowsCovered.push(newly);
  }

  return { rows, rowsCovered, totalPairs, cartesianSize };
}

/** Every (dim-pair, level-pair) combination NOT covered by `rows` — empty iff the array is pairwise-complete.
 *  This is the independent verifier the sweep asserts with (and the sabotage test breaks on purpose). */
export function uncoveredPairs(dims: readonly Dimension[], rows: readonly CoveringRow[]): string[] {
  const covered = new Set<string>();
  for (const row of rows) {
    for (let i = 0; i < dims.length; i++) {
      for (let j = i + 1; j < dims.length; j++) {
        const a = dims[i]!.levels.indexOf(row[dims[i]!.name]!);
        const b = dims[j]!.levels.indexOf(row[dims[j]!.name]!);
        if (a >= 0 && b >= 0) covered.add(pairKey(i, a, j, b));
      }
    }
  }
  const missing: string[] = [];
  for (let i = 0; i < dims.length; i++) {
    for (let j = i + 1; j < dims.length; j++) {
      for (let a = 0; a < dims[i]!.levels.length; a++) {
        for (let b = 0; b < dims[j]!.levels.length; b++) {
          if (!covered.has(pairKey(i, a, j, b))) missing.push(pairLabel(dims, i, a, j, b));
        }
      }
    }
  }
  return missing;
}
