import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Ryme re-firing Wayfinder's Battlecry in combat.
 *
 * Ryme's Deathrattle triggers an adjacent minion's Battlecry. Wayfinder's Battlecry is a Discover ("a minion
 * from a tribe you don't control"), which can't open its interactive 1-of-3 peek mid-combat — so, like every
 * other Discover-Shout, it grants a RANDOM matching minion to hand instead.
 *
 * The bug (owner report 2026-07-22, "wayfinder's shout did not proc from ryme"): Wayfinder passes the SENTINEL
 * `tribe: 'uncontrolled'`, and the combat grant filtered for a card whose literal tribe equals `'uncontrolled'`
 * — no card has that, so the pool was empty and NOTHING was granted. The proc silently no-op'd.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon'];

/** Ryme (Undead) adjacent to a DELIBERATELY TANKY Wayfinder, against one big attacker. Ryme dies to combat
 *  retaliation while Wayfinder (100 health) outlives it — so Ryme's Deathrattle fires with Wayfinder still a
 *  living adjacent neighbour, and re-triggers its Battlecry. (Wayfinder must survive PAST Ryme, or it's no
 *  longer an eligible neighbour when the Deathrattle looks — the trap the first draft of this test fell into.) */
const board: BoardMinion[] = [
  { cardId: 'wayfinder', attack: 1, health: 100, keywords: [] },
  { cardId: 'ryme', attack: 5, health: 3, keywords: [] },
];
const bigEnemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 10, health: 400 }];

const fight = (seed: number, tribes = ALL_TRIBES) =>
  simulate(board, bigEnemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes }), combatSide({ tier: 6 }));

describe("Ryme re-fires Wayfinder's Discover Shout", () => {
  it('grants a minion to hand instead of silently doing nothing', () => {
    // A few seeds — the grant is random, but it must ALWAYS produce a card (the bug produced none, every seed).
    for (const seed of [1, 2, 3, 7, 42]) {
      const r = fight(seed);
      expect(r.playerHandGrants?.length, `seed ${seed}: Wayfinder's Shout granted nothing`).toBeGreaterThan(0);
    }
  });

  it("grants from a tribe the player does NOT control (never Undead — Ryme's own tribe — nor neutral)", () => {
    // Board tribes present: Undead (Ryme). Wayfinder is neutral. So the uncontrolled set is
    // {beast, dragon, mech, demon}; the grant must come from there.
    const uncontrolled = new Set(['beast', 'dragon', 'mech', 'demon']);
    for (const seed of [1, 2, 3, 7, 42]) {
      for (const id of fight(seed).playerHandGrants ?? []) {
        const def = CARD_INDEX[id]!;
        const ok = uncontrolled.has(def.tribe) || (def.tribe2 && uncontrolled.has(def.tribe2)) || def.universalTribe;
        expect(ok, `seed ${seed}: granted ${id} (${def.tribe}), which the player controls or is neutral`).toBeTruthy();
      }
    }
  });

  it('emits a toHand event so the replay shows the card flying in', () => {
    const r = fight(1);
    expect(r.events.some((e) => e.type === 'toHand' && e.side === 'player')).toBe(true);
  });
});
