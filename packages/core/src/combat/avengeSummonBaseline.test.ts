/**
 * AVENGE COUNTS FROM ARRIVAL (owner report 2026-08-24).
 *
 * A minion SUMMONED mid-combat must not inherit the side's running friendly-death tally. Before the fix an
 * Avenge body summoned onto a board that had already lost minions read the full count and fired on arrival —
 * Bullseye/Mammoth rolling a 7/7 Solaris that instantly Warded + struck, or a summoned Dunkey immediately
 * summoning an Armadiyo. It is the same rule a Rise already used (`avengeBaseline`): everything before the
 * body existed is not its progress. `placeSummon` now stamps the baseline, so a summon counts from 0.
 *
 * Scenario, fully deterministic on seed 1: four 1/1 fodder around a fragile Bullseye die to a single tanky
 * enemy; Bullseye's Echo summons ONE 7/7 Solaris (Avenge 4) from a pool forced to just `b2_solaris`. The
 * Solaris arrives at the 3rd friendly death and the fight ends at the 6th — so with a fresh baseline it never
 * reaches four deaths of its own and never Wards. With the old count-from-zero it saw the 4th side-death land
 * one after it arrived and Warded on the spot.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '../index';
import { CARD_INDEX } from '@game/content';

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];

function summonedSolarisWards(seed: number): { summoned: number; wards: number; summonAtDeath: number } {
  const player: BoardMinion[] = [
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
    { cardId: 'b2_bullseye', attack: 1, health: 2 }, // Echo: summon a random Beast at 7/7 → forced to Solaris
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
    { cardId: 'b2_packstrider', attack: 1, health: 1 },
  ];
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 2, health: 400 }];
  const r = simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, poolIds: ['b2_solaris'] }), combatSide({ tier: 1 }));
  const solaris = new Set<string>();
  let deaths = 0, wards = 0, summonAtDeath = -1;
  for (const e of r.events) {
    if (e.type === 'death' && e.side === 'player' && !e.rise) deaths++;
    if (e.type === 'summon' && (e as { minion?: { cardId?: string; uid: string } }).minion?.cardId === 'b2_solaris') {
      const m = (e as { minion: { uid: string } }).minion; solaris.add(m.uid); if (summonAtDeath < 0) summonAtDeath = deaths;
    }
    if (e.type === 'shieldUp' && solaris.has((e as { target?: string }).target ?? '')) wards++;
  }
  return { summoned: solaris.size, wards, summonAtDeath };
}

describe('a summoned Avenge minion counts deaths from its own arrival', () => {
  it('a 7/7 Solaris summoned mid-fight does not Ward on arrival', () => {
    const { summoned, wards, summonAtDeath } = summonedSolarisWards(1);
    // Guard the scenario itself, so a content/targeting change that stops summoning Solaris fails LOUDLY here
    // rather than turning the real assertion into a vacuous pass.
    expect(summoned, 'the scenario must actually summon a Solaris').toBe(1);
    expect(summonAtDeath, 'it must arrive after deaths have already accrued — that is the whole bug window').toBeGreaterThan(0);
    expect(wards, 'the summoned Solaris must NOT inherit the death tally and Ward immediately').toBe(0);
  });
});
