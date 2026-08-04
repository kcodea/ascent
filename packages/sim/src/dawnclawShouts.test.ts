import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { COMBAT_REPLAYABLE_BATTLECRIES, combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

const bm = (cardId: string, attack: number, health: number): BoardMinion => ({ cardId, attack, health } as BoardMinion);

/**
 * Dawnclaw / Ryme re-fire an adjacent minion's Shout IN COMBAT. Only the Shouts in
 * `COMBAT_REPLAYABLE_BATTLECRIES` resolve there; the rest defer to settle and replay through their recruit
 * factory. A Shout that BUFFS A LIVING BODY but is missing from that set therefore produced a narration and
 * no visible effect — the buff landed after the fight it was meant to win (owner report 2026-08-04).
 */
describe('Dawnclaw re-fires a neighbour Shout', () => {
  it('a stat-buff Shout (Brood Whelp) now lands DURING combat', () => {
    // Brood Whelp's Shout is `battlecryBuffTarget`. Dawnclaw has 1 HP and Taunt, so it eats the first swing
    // and dies with its neighbour still alive — which is what the Echo needs.
    const r = simulate(
      [bm('d2_broodwhelp', 1, 9999), bm('b2_dawnclaw', 1, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    const scs = r.events.filter((e) => e.type === 'sc').map((e) => (e as { text?: string }).text);
    expect(scs.some((t) => t?.includes('Dawnclaw triggers')), 'the Echo did not re-fire the Shout').toBe(true);
    // The proof that matters: a buff SOURCED FROM THE NEIGHBOUR (m0) — the re-fired Shout itself. A loose
    // "any buff happened" assertion passes without the fix, because the enemy dummy buffs itself every swing.
    const fromShout = r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'm0');
    expect(fromShout.length, 'the re-fired Shout produced no buff during combat — it deferred to settle')
      .toBeGreaterThan(0);
  });

  it('an ECONOMY Shout still defers to settle rather than doing nothing', () => {
    const r = simulate(
      [bm('dw_pimm', 1, 9999), bm('b2_dawnclaw', 1, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect(r.playerDeferredBattlecries, 'an economy Shout must be carried back to settle')
      .toEqual(expect.arrayContaining([expect.objectContaining({ cardId: 'dw_pimm' })]));
  });

  it('does nothing when the neighbour is already dead — not a bug, just no one to trigger', () => {
    // Worth pinning because it is the shape that LOOKS like a failure: a fragile neighbour dies first, so by
    // the time Dawnclaw's Echo runs there is no living Shout beside it.
    const r = simulate(
      [bm('d2_broodwhelp', 1, 1), bm('b2_dawnclaw', 1, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    const scs = r.events.filter((e) => e.type === 'sc').map((e) => (e as { text?: string }).text);
    expect(scs.some((t) => t?.includes('Dawnclaw triggers'))).toBe(false);
  });

  it('battlecryBuffTarget is registered as combat-replayable', () => {
    expect(COMBAT_REPLAYABLE_BATTLECRIES.has('battlecryBuffTarget')).toBe(true);
  });
});
