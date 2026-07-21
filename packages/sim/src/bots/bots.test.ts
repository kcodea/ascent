import { describe, it, expect } from 'vitest';
import { BOTS } from './index';
import { createReportAccumulator, playAndRecordInto, computeBalanceReport, finalizeReport } from '../balanceReport';

/**
 * Guards for the balance bots (docs/bot-sims-handoff.md). Not balance assertions — those move with content —
 * but structural: every pilot must drive a full run to a terminal state (no infinite loop, no crash) and
 * produce a report. If a policy ever returns a stalling action, `playAndRecordInto`'s no-op safety net keeps
 * the loop alive, but a run that never reaches gameover/victory would blow the step cap and surface here.
 */
describe('balance bots', () => {
  it('exposes the four expected pilots', () => {
    expect(BOTS.map((b) => b.id).sort()).toEqual(['greedy', 'meta', 'midrange', 'tempo']);
  });

  for (const bot of BOTS) {
    it(`${bot.id} completes a run and produces a report`, () => {
      const acc = createReportAccumulator();
      // A couple of heroes × a couple of seeds — enough to exercise the turn engine + combat + overlays.
      for (const hero of ['warden', 'brackus']) {
        for (const seed of [1, 2]) playAndRecordInto(acc, seed, hero, bot);
      }
      const report = finalizeReport(acc, 2);
      // Every game credited exactly once to its hero (4 games here), win rate a real 0..100 (or -1 for n/a).
      const totalGames = report.heroes.reduce((n, h) => n + h.games, 0);
      expect(totalGames).toBe(4);
      for (const h of report.heroes) expect(h.winRate).toBeGreaterThanOrEqual(-1);
    });
  }

  it('is deterministic — the same games reproduce the same report', () => {
    const a = computeBalanceReport(2, BOTS[0]);
    const b = computeBalanceReport(2, BOTS[0]);
    expect(a.heroes.map((h) => `${h.id}:${h.wins}/${h.games}`)).toEqual(b.heroes.map((h) => `${h.id}:${h.wins}/${h.games}`));
  });
});
