/**
 * Wave-relative board strength rating + power bands (the curation / QA strength framework).
 *
 * A board's strength only means something RELATIVE TO ITS WAVE: a 7-wide board that's strong at wave 3 is
 * weak at wave 15. So we rate a board by its win-rate against a CALIBRATION LADDER of reference boards built
 * for that wave — real, synergy-aware boards spanning weak → strong CURRENT play (the smart bot at rising
 * fidelity). Because the ladder scales with the wave, the rating never saturates: the old fixed-gauntlet
 * `rateBoard` maxed out at 1.0 by ~wave 8, which hid the fact that high-wave boards had gone weak after a
 * balance patch. Re-running the bot per patch self-recalibrates (the ladder reflects the live card set).
 *
 * Deterministic (fixed bot seeds + a fixed combat seed), so `npm run pool` bakes stable ratings + bands.
 * Used for pool CURATION / QA only — live matchmaking still uses Σ(atk+hp) power (see `opponents.ts`).
 */
import { simulate, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { buildBootstrapPool, type BoardSnapshot } from './snapshot';
import { opponentBoard } from './opponents';

const RATING_SEED = 0x9e3779b1; // fixed → combat tie-breaks are reproducible

// Calibration plan: run the smart bot across a few fixed seeds × rising fidelity (random play → near-optimal).
// Each run yields a board at every wave it reaches; grouped by wave they form that wave's weak → strong ladder.
const LADDER_SEEDS = [1, 7, 42, 101, 777];
const LADDER_FIDELITIES = [0.2, 0.4, 0.6, 0.8, 1.0];
const LADDER_PER_WAVE = 8; // cap each wave's ladder to ~this many boards, spread across the power range

/** wave → that wave's calibration ladder (a set of reference boards spanning weak → strong play). */
export type WaveLadders = Map<number, BoardMinion[][]>;

const power = (b: BoardMinion[]): number => b.reduce((s, m) => s + m.attack + m.health, 0);

/** Keep up to `cap` boards from `list`, evenly spread across the Σ(atk+hp) power range (not clustered). */
function spreadByPower(list: BoardMinion[][], cap: number): BoardMinion[][] {
  if (list.length <= cap) return list;
  const sorted = [...list].sort((a, b) => power(a) - power(b));
  const out: BoardMinion[][] = [];
  for (let i = 0; i < cap; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / (cap - 1))]!);
  return out;
}

/**
 * Build per-wave reference ladders from the smart bot — boards spanning weak → strong CURRENT play at each
 * wave. Deterministic. Call ONCE and reuse across many `rateBoardForWave` calls (it runs the bot, so it is
 * NOT cheap). `seeds`/`fidelities` default to the calibration plan; tests pass a smaller set for speed.
 *
 * `extra` (the imported REAL captured boards) is folded in too: real boards reach strengths — and waves —
 * the bot can't, so they give the high-wave ladders a real CEILING. Without them the bot tops out below
 * skilled play and every real board beats it → ratings saturate at band 7 past ~wave 9.
 */
export function buildWaveLadders(
  seeds: number[] = LADDER_SEEDS,
  fidelities: number[] = LADDER_FIDELITIES,
  extra: BoardSnapshot[] = [],
): WaveLadders {
  const byWave: WaveLadders = new Map();
  const add = (wave: number, board: BoardMinion[]): void => {
    // A ladder reference is fought via `simulate`, which throws on an unknown cardId — so a single stale
    // `extra` board (captured under an old card set) would break ALL ratings. Skip unservable boards.
    if (board.length === 0 || !board.every((m) => !!CARD_INDEX[m.cardId])) return;
    (byWave.get(wave) ?? byWave.set(wave, []).get(wave)!).push(board);
  };
  for (const fidelity of fidelities) {
    for (const s of buildBootstrapPool(seeds, () => ({ fidelity }))) add(s.wave, opponentBoard(s));
  }
  for (const s of extra) add(s.wave, opponentBoard(s));
  for (const [wave, boards] of byWave) byWave.set(wave, spreadByPower(boards, LADDER_PER_WAVE));
  return byWave;
}

/** The ladder for `wave`, falling back to the nearest available wave (sparse high waves the bot can't reach). */
function ladderFor(ladders: WaveLadders, wave: number): BoardMinion[][] {
  const exact = ladders.get(wave);
  if (exact && exact.length) return exact;
  let best: BoardMinion[][] = [];
  let bestDist = Infinity;
  for (const [w, boards] of ladders) {
    const d = Math.abs(w - wave);
    if (boards.length > 0 && d < bestDist) { best = boards; bestDist = d; }
  }
  return best;
}

/**
 * Rate a board 0..1 by the fraction of ITS WAVE's calibration ladder it beats (draw = 0.5). Pass `ladders`
 * from `buildWaveLadders()` (built once). 0 = loses to every reference board for its wave (weak FOR the
 * wave); 1 = beats them all (strong FOR the wave). Empty board / no ladder → 0. `tier` only affects
 * loss-damage (irrelevant to win/loss), passed through for completeness.
 */
export function rateBoardForWave(board: BoardMinion[], wave: number, ladders: WaveLadders, tier = 6): number {
  if (board.length === 0) return 0;
  const ladder = ladderFor(ladders, wave);
  if (ladder.length === 0) return 0;
  let score = 0;
  for (const ref of ladder) {
    const { result } = simulate(board, ref, makeRng(RATING_SEED), CARD_INDEX, 0, 0, tier);
    score += result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  }
  return score / ladder.length;
}

/** Number of power bands the 0..1 rating is bucketed into (0 = weak-for-wave … BAND_COUNT-1 = strong-for-wave). */
export const BAND_COUNT = 8;

/** The band index (0..BAND_COUNT-1) for a wave-relative rating — a coarse strength bucket. */
export function ratingBand(rating: number): number {
  return Math.min(BAND_COUNT - 1, Math.max(0, Math.floor(rating * BAND_COUNT)));
}
