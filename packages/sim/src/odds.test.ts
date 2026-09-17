import { describe, it, expect } from 'vitest';
import { CONFIG } from './config';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';
import { COMBAT_ODDS_SIMS, computeCombatOdds, createOddsProbe, type CombatOddsInput } from './odds';

/**
 * Determinism pin for the RESUMABLE odds probe (perf pass 2026-09-16): however the sims are sliced across
 * `step()` calls, the final `CombatOdds` must equal the one-shot `computeCombatOdds` byte for byte — the UI
 * now drives the probe in idle-time slices, and a slice boundary must never move a single percent.
 */

// A trimmed greedy bot (same shape as `packages/tools/src/perf.ts`) — enough to harvest real, growing boards.
const stat = (c: { attack: number; health: number }): number => c.attack + c.health;
function recruitStep(s: RunState): RunState {
  let n: RunState;
  if (s.board.length < CONFIG.boardMax && s.hand.length > 0) {
    const best = [...s.hand].sort((a, b) => stat(b) - stat(a))[0]!;
    n = reduce(s, { type: 'play', uid: best.uid });
    if (n !== s) return n;
  }
  if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost && (s.upgradeCost <= 3 || s.board.length >= 4)) {
    n = reduce(s, { type: 'upgrade' });
    if (n !== s) return n;
  }
  if (s.embers >= CONFIG.minionCost && s.board.length + s.hand.length < CONFIG.boardMax && s.shop[0]) {
    n = reduce(s, { type: 'buy', uid: s.shop[0].uid });
    if (n !== s) return n;
  }
  return reduce(s, { type: 'faceOmen' });
}

interface OddsSample { input: CombatOddsInput; seed: number; wave: number; boardSize: number }

/** Play a greedy run and collect the stashed odds input of every wave up to `maxWave`. (The `perf:odds`
 *  micro-benchmark in `packages/tools/src/perf-odds.ts` carries the same harvester.) */
function harvestOddsInputs(seed: number, maxWave: number): OddsSample[] {
  let s = createRun(seed, undefined, 'practice'); // practice = invulnerable, so the greedy bot survives to a full late board
  const out: OddsSample[] = [];
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && s.wave <= maxWave && steps++ < 20000) {
    if (s.runeforgeOffer) { s = reduce(s, { type: 'skipRuneforge' }); continue; }
    if (s.questOffer) { s = reduce(s, { type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) { s = reduce(s, { type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { s = reduce(s, { type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') {
      const lc = s.lastCombat;
      if (lc?.oddsInput && !lc.odds) out.push({ input: lc.oddsInput, seed: s.seed, wave: s.wave, boardSize: lc.oddsInput.player.length + lc.oddsInput.enemy.length });
      s = reduce(s, { type: 'resolveCombat' });
      continue;
    }
    const next = recruitStep(s);
    if (next === s) break; // wedged (nothing playable, End Turn refused) — keep what we have
    s = next;
  }
  return out;
}

describe('createOddsProbe — the chunked probe equals the one-shot probe', () => {
  const samples = [11, 42, 777].flatMap((seed) => harvestOddsInputs(seed, 12));
  it('harvests real matchups across seeds, waves and board sizes', () => {
    expect(samples.length).toBeGreaterThan(6);
    expect(Math.max(...samples.map((x) => x.wave))).toBeGreaterThanOrEqual(6);
    expect(new Set(samples.map((x) => x.boardSize)).size).toBeGreaterThan(2);
  });

  it.each([1, 7, 20, 33, 200])('slicing %i sims per step is byte-identical to computeCombatOdds', (n) => {
    for (const { input, seed, wave } of samples) {
      const oneShot = computeCombatOdds(input, seed, wave);
      const probe = createOddsProbe(input, seed, wave);
      let steps = 1;
      while (!probe.step(n)) steps++;
      expect(probe.done()).toBe(true);
      expect(probe.progress()).toBe(COMBAT_ODDS_SIMS);
      expect(steps).toBe(Math.ceil(COMBAT_ODDS_SIMS / n));
      expect(probe.result()).toEqual(oneShot);
    }
  });

  it('uneven slices (the deadline-driven UI pattern) still land on the same numbers', () => {
    const { input, seed, wave } = samples[samples.length - 1]!;
    const oneShot = computeCombatOdds(input, seed, wave);
    const probe = createOddsProbe(input, seed, wave);
    const plan = [3, 20, 20, 1, 60, 20, 20, 20, 20, 20, 999];
    for (const n of plan) if (probe.step(n)) break;
    expect(probe.done()).toBe(true);
    expect(probe.result()).toEqual(oneShot);
    expect(probe.step(20), 'further steps after done are no-ops').toBe(true);
    expect(probe.result()).toEqual(oneShot);
  });

  it('reports progress + a partial estimate that sums to 1 before it is done', () => {
    const { input, seed, wave } = samples[0]!;
    const probe = createOddsProbe(input, seed, wave);
    expect(probe.progress()).toBe(0);
    expect(probe.done()).toBe(false);
    probe.step(20);
    expect(probe.progress()).toBe(20);
    const partial = probe.result();
    expect(partial.win + partial.draw + partial.lose).toBeCloseTo(1, 9);
  });
});
