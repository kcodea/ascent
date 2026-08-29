/**
 * "A CARD ADDED TO YOUR HAND" FIRES IN COMBAT TOO (owner report 2026-08-29).
 *
 * *"gangplank doesnt trigger when cards are added to hand in combat … cards added to hand is an effect in
 * recruit + shop and should trigger effects that track them in all places."*
 *
 * The shop half has fired from a hand uid-diff since 2026-08-26, and the combat CARRY-BACK went through that
 * diff at settle — so the stats did eventually arrive, which makes this easy to misread as cosmetic. It was
 * not: the payout landed on the recruit board AFTER the fight, too late to affect the fight that earned it.
 * `onGainCard` simply had no combat factory, so `registerEffect` never subscribed it and the bus never
 * carried the event.
 *
 * These run the real `simulate()` and assert the buff appears in the EVENT LOG — during the fight.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';

const bm = (cardId: string, attack: number, health: number): BoardMinion =>
  ({ cardId, attack, health } as BoardMinion);

/** Every buff the log records against a body of `cardId`, summed over attack + health. */
function buffTotal(events: readonly CombatEvent[], initial: readonly { uid: string; cardId: string }[], cardId: string): number {
  const uids = new Set(initial.filter((m) => m.cardId === cardId).map((m) => m.uid));
  return events.reduce((n, e) => {
    const ev = e as unknown as { type: string; target?: string; attack?: number; health?: number };
    if (ev.type !== 'buff' || !ev.target || !uids.has(ev.target)) return n;
    return n + (ev.attack ?? 0) + (ev.health ?? 0);
  }, 0);
}

/** Pillager's Deathrattle grants a Gold Pouch to hand — a real in-combat `grantToHand`. */
const GRANTER = 'pillager';

describe('a card reaching hand MID-COMBAT fires its reactors', () => {
  it('fixture guard: the granter really does grant to hand on death', () => {
    expect(CARD_INDEX[GRANTER]?.effects.some((e) => e.do === 'deathrattleGrantCardToHand')).toBe(true);
  });

  it('Gangplank pays out DURING the fight, not only at settle', () => {
    const r = simulate(
      [bm('dw_gangplank', 3, 9999), bm(GRANTER, 1, 1)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect(r.events.some((e) => (e as { type: string }).type === 'toHand'),
      'a card really did reach hand mid-fight').toBe(true);
    // +1/+2 on a random friendly Dwarf — Gangplank is the only one here, so it is its own recipient.
    expect(buffTotal(r.events, r.initial.player, 'dw_gangplank'),
      'Gangplank paid out in-combat').toBeGreaterThan(0);
  });

  it('the ENEMY board does not react to a card reaching YOUR hand', () => {
    // `onGainCard` is a bus broadcast and the bus reaches BOTH sides, so this is the guard that keeps
    // "your hand" meaning the owner's.
    const r = simulate(
      [bm(GRANTER, 1, 1)],
      [bm('dw_gangplank', 50, 9999)], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    expect(r.events.some((e) => (e as { type: string }).type === 'toHand'),
      'the player still gained the card').toBe(true);
    expect(buffTotal(r.events, r.initial.enemy, 'dw_gangplank'),
      'the enemy Gangplank stayed out of it').toBe(0);
  });

  it('a Ruby minted in combat counts as a card reaching hand', () => {
    // The shop half has fired per mint since 2026-08-26; combat now matches it.
    const r = simulate(
      // Tunnelcharger Rikk's Rally mints 3 Rubies when it attacks — the simplest live `ctx.grantRubies`.
      [bm('dw_gangplank', 3, 9999), bm('k_tunnelcharger', 3, 9999)],
      [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 4 }));
    const rubies = r.events.filter((e) => {
      const ev = e as unknown as { type: string; cardId?: string };
      return ev.type === 'toHand' && ev.cardId === 'ruby';
    }).length;
    expect(rubies, 'fixture guard: a Ruby was minted mid-fight').toBeGreaterThan(0);
    expect(buffTotal(r.events, r.initial.player, 'dw_gangplank'),
      'and Gangplank saw it arrive').toBeGreaterThan(0);
  });
});
