import { describe, it, expect } from 'vitest';
import { BOTS, BOT_BY_ID } from './index';
import { createRun, type RunState, type BoardCard } from '../state';
import { createReportAccumulator, playAndRecordInto, computeBalanceReport, finalizeReport } from '../balanceReport';

/**
 * Guards for the balance bots (docs/bot-sims-handoff.md). Not balance assertions — those move with content —
 * but structural: every pilot must drive a full run to a terminal state (no infinite loop, no crash) and
 * produce a report. If a policy ever returns a stalling action, `playAndRecordInto`'s no-op safety net keeps
 * the loop alive, but a run that never reaches gameover/victory would blow the step cap and surface here.
 */
describe('balance bots', () => {
  it('exposes the five expected pilots', () => {
    expect(BOTS.map((b) => b.id).sort()).toEqual(['explorer', 'greedy', 'meta', 'midrange', 'tempo']);
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

  // ---- Spell usage (owner ask 2026-07-21: "bots should use spells"). The root cause wasn't valuation — the
  //      tavern's spell offer lives in `state.spell`, a dedicated slot SEPARATE from `state.shop`, and the turn
  //      engine only ever read `state.shop`. Bots literally never saw a spell and bought ~0.00 per run.
  const mk = (over: Partial<RunState>): RunState => ({
    ...createRun(1), phase: 'recruit', heroReady: false, shop: [], hand: [], ...over,
  } as RunState);
  const body = (uid: string): BoardCard =>
    ({ uid, cardId: 'alley', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false });

  it('buys the tavern SPELL-SLOT offer (state.spell), not just state.shop', () => {
    const s = mk({
      // Gold is deliberately just enough for the 2-cost spell and NOT a tier-up, so the assertion isolates
      // "the bot can see state.spell" from "the bot values this spell over upgrading" (Growth dropped to
      // +1/+1 in the 2026-07-21 balance pass, so it no longer out-values a tier-up on its own).
      embers: 2,
      board: [body('b1'), body('b2'), body('b3'), body('b4'), body('b5'), body('b6'), body('b7')],
      spell: { uid: 'sp1', cardId: 'growth' }, // Growth: +1/+1 across a FULL board — 14 stats for 2 Gold
    });
    const midrange = BOT_BY_ID['midrange']!;
    expect(midrange.act(s)).toEqual({ type: 'buy', uid: 'sp1' });
  });

  it('does NOT buy a board-wide spell into an empty board (it would be a dead card)', () => {
    const s = mk({ embers: 10, board: [], spell: { uid: 'sp1', cardId: 'growth' } });
    expect(BOT_BY_ID['midrange']!.act(s)).not.toEqual({ type: 'buy', uid: 'sp1' });
  });

  it('casts a spell from hand even when the BOARD is full (a spell needs no board slot)', () => {
    // The play step used to sit entirely behind `board.length < boardMax`, so a full-board bot stopped casting.
    const full = Array.from({ length: 7 }, (_, i) => body(`f${i}`));
    const s = mk({
      embers: 0, board: full,
      hand: [{ uid: 'h1', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    expect(BOT_BY_ID['midrange']!.act(s)).toEqual({ type: 'play', uid: 'h1' });
  });

  it("Darah's Swap trades away the WORST body, not the best", () => {
    // `displace` swaps a friendly minion for a random shop minion, so aiming it at your keeper destroys value.
    // The engine used to point every targeted power at the highest-scoring minion — actively harmful here.
    const strong: BoardCard = { uid: 'keep', cardId: 'gnash', tribe: 'beast', attack: 9, health: 9, keywords: [], golden: false };
    const weak: BoardCard = { uid: 'chaff', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false };
    // Needs a shop minion to swap INTO, and 0 Gold so the bot reaches the late-power step without buying.
    const s = mk({
      heroId: 'darah', heroReady: true, wave: 3, embers: 0, tier: 2,
      board: [strong, weak], shop: [{ uid: 'o1', cardId: 'pack' }],
    });
    const a = BOT_BY_ID['midrange']!.act(s);
    expect(a).toEqual({ type: 'heroPower', uid: 'chaff' });
  });

  it('is deterministic — the same games reproduce the same report', () => {
    const a = computeBalanceReport(2, BOTS[0]);
    const b = computeBalanceReport(2, BOTS[0]);
    expect(a.heroes.map((h) => `${h.id}:${h.wins}/${h.games}`)).toEqual(b.heroes.map((h) => `${h.id}:${h.wins}/${h.games}`));
  });
});
