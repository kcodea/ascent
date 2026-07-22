import { describe, it, expect } from 'vitest';
import { createRun, reduce, type RunState } from './index';

/**
 * Djinn's Cadence — "Trigger all friendly End of Turn effects."
 *
 * A player's End-of-Turn engine has TWO halves, and the natural end of turn (`applyEndOfTurn`) fires both:
 * each board minion's `endOfTurn` effects, AND `questRecurringEndOfTurn` — the quest/rune-granted recurring
 * rewards (Echoing Roar, The Hoard Wakes, Blueprint Cache, Rune of Spending/Action, …).
 *
 * Cadence used to fire only the board half, so it silently skipped whatever the player had built out of
 * quests and runes (owner ruling 2026-07-22). These pin that it covers both.
 */
const djinn = (patch: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'djinn'), phase: 'recruit', hand: [], board: [], ...patch }) as RunState;

describe("Djinn's Cadence triggers quest/rune End of Turn effects", () => {
  it('fires a quest-granted recurring End of Turn', () => {
    // The Hoard Wakes conjures a random Battlecry minion to hand — an observable payout.
    const s = djinn({ questRecurringEndOfTurn: ['grantRandomShout'] });
    const after = reduce(s, { type: 'heroPower' });
    expect(after.hand.length).toBeGreaterThan(0);
  });

  it('fires even with an EMPTY board — the power is no longer a no-op there', () => {
    // The regression: with nothing on board, every `replayEndOfTurn` returned false, so the action bailed
    // before the quest/rune half ever ran and the charge was never even spent.
    const s = djinn({ questRecurringEndOfTurn: ['grantRandomShout'] });
    expect(s.board).toHaveLength(0);
    const after = reduce(s, { type: 'heroPower' });
    expect(after).not.toBe(s); // the action was NOT rejected
    expect(after.hand.length).toBeGreaterThan(0);
    expect(after.heroReady).toBe(false); // the once-per-turn charge was spent, as on any successful activation
  });

  it('counts the quest/rune fires toward the endOfTurn objective (Parliament of Flame)', () => {
    // A replayed End of Turn is still an End-of-Turn TRIGGER, so these procs must advance the objective
    // exactly as the board half does.
    const s = djinn({ questRecurringEndOfTurn: ['grantRandomShout', 'grantRandomAttachments'] });
    const after = reduce(s, { type: 'heroPower' });
    expect(after.lastEotFires).toBe(2); // one proc per recurring effect
  });

  it('is still a no-op when the player has NO End of Turn effects at all', () => {
    const s = djinn();
    const after = reduce(s, { type: 'heroPower' });
    expect(after).toBe(s); // rejected outright — no charge spent
  });
});
