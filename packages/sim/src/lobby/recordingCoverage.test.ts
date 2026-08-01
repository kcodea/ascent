import { describe, it, expect } from 'vitest';
import { autoplayRun } from '../snapshot';

/**
 * Recordings must SPAN the run — the invariant behind lobby performance.
 *
 * Owner report 2026-07-31 ("very poor performance in lobby mode"): when Set 2 went live, `autoplayRun` — the
 * greedy recorder every bot seat's snapshots come from — silently broke in two ways. It didn't know the
 * Runeforge (universal on turns 6/9 as of this patch), so `faceOmen` no-opped against the open modal and the
 * recording ended at wave 5; and its play branch blindly replayed `hand[0]`, so an unplayable card (a targeted
 * set-2 spell with no legal target, a Ruby on an empty board) spun the loop to its step guard and returned an
 * EMPTY recording. Either way every hybrid seat fell through to its live beam-search bot from round 1, and
 * each End Combat replayed seven bot advances on the main thread — a hitch that grew with wave depth
 * (measured ~100→800ms per round by round 7; single digits with recordings intact).
 *
 * These tests pin the two failure shapes under the CURRENT active set, whatever it is: a recording never comes
 * back empty, and it always clears the first Runeforge wave. If a future rule adds another turn-blocking modal
 * the recorder doesn't know, this fails before the lobby turns to mush.
 */
describe('autoplayRun recordings survive the current ruleset', () => {
  // The three seat configs the perf regression was measured on, plus a spread of seeds.
  const cases: Array<[number, string]> = [
    [101, 'gildmaster'], // recorded to wave 0 during the regression
    [102, 'brackus'], //   wave 0
    [103, 'baggerben'], // wave 5 — wedged on the turn-6 Runeforge
    [7, 'drakko'],
  ];

  it('a recording is never empty', () => {
    for (const [seed, hero] of cases) {
      const snaps = autoplayRun(seed, hero);
      expect(snaps.length, `${hero}#${seed}: empty recording — the seat would fall back to a live bot`).toBeGreaterThan(0);
    }
  });

  it('a recording clears the first Runeforge wave (turn 6)', () => {
    for (const [seed, hero] of cases) {
      const snaps = autoplayRun(seed, hero);
      const last = snaps[snaps.length - 1]!.wave;
      expect(last, `${hero}#${seed}: recording died at wave ${last} — wedged on a turn-blocking modal?`).toBeGreaterThanOrEqual(7);
    }
  });
});
