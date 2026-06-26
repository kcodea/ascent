/**
 * Board SYNTHESIS — "print" competitive boards by recombining + mutating REAL captured boards, validated
 * against the wave-relative rating.
 *
 * The smart bot can't build strong high-wave boards: it has to survive a whole run and plays greedily (no
 * positioning, naive sequencing), so its high-wave output is mediocre and the pool goes thin + weak up there.
 * Real captured boards CAN reach those strengths — so instead of asking the bot to *earn* a board through
 * play, we take a real board, swap in minions seen on OTHER real boards at the same wave, nudge stats for a
 * strength dial, and KEEP it only if `simulate` (via `rateBoardForWave`) says it lands at/above the target
 * band. That makes "competitive" empirical (it actually wins fights), stays coherent (anchored in real boards
 * + real minions — the data on what players actually build), and lets us bulk up the thin, strong high-wave
 * cells the bot leaves empty. Tagged `origin:'synthetic'`.
 *
 * Deterministic (seeded rng). Tool-time only (used by `npm run pool`); not on any runtime path.
 */
import { makeRng, type BoardMinion, type Rng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { BoardSnapshot } from './snapshot';
import { opponentBoard } from './opponents';
import { rateBoardForWave, ratingBand, type WaveLadders } from './rating';

const power = (b: BoardMinion[]): number => b.reduce((s, m) => s + m.attack + m.health, 0);

/** A stable identity for a board's minion set, so identical variants (and re-emitted real boards) dedupe. */
const signature = (b: BoardMinion[]): string =>
  b.map((m) => `${m.cardId}:${m.attack}/${m.health}:${(m.keywords ?? []).slice().sort().join('')}${m.golden ? 'g' : ''}`).sort().join(',');

/**
 * Mutate a board into a fresh variant: recombine (swap 0–2 minions for `donors` — minions seen on real boards
 * at this wave) then nudge every minion's stats by a shared ×0.8–1.3 factor (a strength dial). Returns a NEW
 * `BoardMinion[]` (never mutates the input). Stays coherent because it's anchored in a real board + real
 * minions; opponents only need to be the right STRENGTH, not buildable, and the rating validates that.
 */
export function mutateBoard(board: BoardMinion[], donors: BoardMinion[], rng: Rng): BoardMinion[] {
  const out = board.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] }));
  if (donors.length > 0) {
    const swaps = rng.int(3); // 0, 1, or 2 minion swaps
    for (let i = 0; i < swaps && out.length > 0; i++) {
      const d = donors[rng.int(donors.length)]!;
      out[rng.int(out.length)] = { ...d, keywords: [...(d.keywords ?? [])] };
    }
  }
  const factor = 0.8 + rng.next() * 0.5; // ×0.8–1.3 strength dial
  for (const m of out) {
    m.attack = Math.max(1, Math.round(m.attack * factor));
    m.health = Math.max(1, Math.round(m.health * factor));
  }
  return out;
}

export interface SynthOptions {
  /** Reject synthetic boards whose wave-relative band is below this (keep them competitive). */
  floorBand: number;
  /** Stamp on every synthetic board (e.g. the bake's patch / date). */
  patch?: string;
  capturedAt?: string;
}

/**
 * Synthesize up to `count` validated boards for `wave` by mutating the real boards `reals` (the real captured
 * boards AT this wave). Each candidate must be servable (every cardId still exists) and rate at or above
 * `opts.floorBand`; duplicates (by minion signature, including the seed reals) are skipped. Deterministic for
 * a given `seed`. Returns boards tagged `origin:'synthetic'` with a baked wave-relative `rating`; gives up
 * after a bounded number of attempts if the cell just can't be filled (e.g. only one weak real board to draw
 * from).
 */
export function synthesizeForWave(
  reals: BoardSnapshot[],
  wave: number,
  ladders: WaveLadders,
  count: number,
  seed: number,
  opts: SynthOptions,
): BoardSnapshot[] {
  if (reals.length === 0 || count <= 0) return [];
  const rng = makeRng(seed);
  const donors = reals.flatMap((b) => opponentBoard(b));
  const seen = new Set(reals.map((b) => signature(opponentBoard(b)))); // never re-emit a real board verbatim
  const out: BoardSnapshot[] = [];
  for (let attempt = 0; out.length < count && attempt < count * 30; attempt++) {
    const base = reals[rng.int(reals.length)]!;
    const minions = mutateBoard(opponentBoard(base), donors, rng);
    if (minions.length === 0 || !minions.every((m) => !!CARD_INDEX[m.cardId])) continue;
    const sig = signature(minions);
    if (seen.has(sig)) continue;
    const rating = +rateBoardForWave(minions, wave, ladders, base.tier).toFixed(3);
    if (ratingBand(rating) < opts.floorBand) continue; // not competitive enough → drop
    seen.add(sig);
    out.push({
      ...base,
      minions,
      power: power(minions),
      rating,
      origin: 'synthetic',
      author: undefined,
      patch: opts.patch ?? base.patch,
      capturedAt: opts.capturedAt ?? base.capturedAt,
    });
  }
  return out;
}
