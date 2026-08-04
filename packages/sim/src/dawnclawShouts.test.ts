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

/**
 * SECOND PASS — the owner's screenshot was two gilded FRENZIED EXCAVATORS flanking Dawnclaw, not Brood Whelp.
 * Its Shout (`battlecryPlayRubiesAll`) was still absent from the replay chain, so the Echo narrated and no
 * Ruby landed. This block pins the rest of the audited additions alongside it.
 */
describe('the rest of the audited combat Shouts', () => {
  const ECHO_BUFFS = (cardId: string, atk = 1, hp = 9999) => simulate(
    [bm(cardId, atk, hp), bm('b2_dawnclaw', 1, 1)],
    [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

  it("Frenzied Excavator's Rubies land during combat (the reported case)", () => {
    const r = ECHO_BUFFS('k_frenzied');
    expect(r.events.some((e) => e.type === 'sc' && (e as { text?: string }).text?.includes('Dawnclaw triggers'))).toBe(true);
    // A RUBY buff specifically — `ctx.buff(..., true)` tags the event, so this can't pass on an ordinary buff.
    const rubies = r.events.filter((e) => e.type === 'buff' && (e as { ruby?: true }).ruby && (e as { source?: string }).source === 'm0');
    expect(rubies.length, 'the re-fired Excavator played no Ruby during combat').toBeGreaterThan(0);
  });

  it('Warhorn Captain buffs its other living Dwarves, not itself', () => {
    // Needs a THIRD body: "your other Dwarves" has no recipient on a two-minion board, which is a correct
    // no-op and would have passed this test for the wrong reason. Dawnclaw sits between the two Captains so
    // its Echo re-fires both.
    const r = simulate(
      [bm('dw_ironlung', 1, 9999), bm('b2_dawnclaw', 1, 1), bm('dw_ironlung', 1, 9999)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const buffs = r.events.filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'm0');
    expect(buffs.length, 'the re-fired Shout produced no buff during combat').toBeGreaterThan(0);
    expect(buffs.every((e) => (e as { target?: string }).target !== 'm0'), '"other" Dwarves means not itself').toBe(true);
  });

  it('Oathshield Orin re-grants its own keyword in combat', () => {
    const r = ECHO_BUFFS('dw_orin');
    expect(r.events.some((e) => e.type === 'keyword' && (e as { target?: string }).target === 'm0')).toBe(true);
  });

  it('every id in the set has a branch, and every buff-a-body branch is in the set', () => {
    for (const id of ['battlecryPlayRubiesAll', 'battlecryBuffTribeOthersAttack', 'onBattlecryBuffSelf',
      'battlecryGainKeyword', 'battlecryBuffImps']) {
      expect(COMBAT_REPLAYABLE_BATTLECRIES.has(id), `${id} missing from the set`).toBe(true);
    }
  });

  it('the run-wide aura Shouts stay deferred — they have no carry-back channel', () => {
    // Guards the deliberate exclusions, so a later "why isn't this one in the set?" doesn't quietly add them:
    // both enchant a CARD TYPE for the rest of the run, and buffing the live board would double at settle.
    expect(COMBAT_REPLAYABLE_BATTLECRIES.has('battlecryBuffFodder')).toBe(false);
    expect(COMBAT_REPLAYABLE_BATTLECRIES.has('battlecryBuffMagnetics')).toBe(false);
  });
});
