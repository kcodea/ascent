/**
 * R-RISE-06 (owner 2026-10-12): "rise rises a 'fresh copy' of something, but that is a combat only thing. the recruit
 * phase would still have the original copy with all its stacks."
 *
 * The combat readout must print the risen fresh copy's RESET value (the sim resets `summonBonus` at the Rise,
 * R-RISE-01). Before this, `computeFrame` overwrote the risen body's stats but left its `summonBonus`, so a risen
 * Kennelmaster's card text still showed the original's stacks in combat. The Shop card (the board card) keeps the
 * stacks; that half is pinned in packages/sim/src/riseKeepsBoardStacks1012.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type MinionSnapshot } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { computeFrame } from './useCombatReplay';

const namesOf = (initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] }, events: CombatEvent[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const m of [...initial.player, ...initial.enemy]) names.set(m.uid, m.name);
  for (const e of events) if (e.type === 'summon') names.set(e.minion.uid, e.minion.name);
  return names;
};

describe('a risen Kennelmaster reads its reset value in combat (R-RISE-06)', () => {
  it('holds its 5 stacks before the Rise and reads 0 on the beat it returns', () => {
    const player: BoardMinion[] = [{ cardId: 'kennel', attack: 4, health: 1, sourceUid: 'K', golden: true, keywords: ['SC', 'R'], summonBonus: 5 }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 90000, keywords: [] }];
    const r = simulate(player, enemy, makeRng(1), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const uid = r.initial.player[0]!.uid;
    const at = r.events.findIndex((e) => e.type === 'reborn' && e.target === uid);
    expect(at).toBeGreaterThan(0);
    const names = namesOf(r.initial, r.events);
    const died = r.events.findIndex((e) => e.type === 'death' && e.target === uid);
    const beforeRise = computeFrame(r.initial, r.events, died, died, names).player.find((u) => u.uid === uid)!;
    expect(beforeRise.summonBonus).toBe(5);
    const risen = computeFrame(r.initial, r.events, at + 1, at, names).player.find((u) => u.uid === uid)!;
    expect(risen.summonBonus).toBe(0);
    // The Shop card is untouched by the fresh copy: the carry-back reports the original's 5.
    expect(r.playerSummonBonus).toEqual([{ sourceUid: 'K', bonus: 5 }]);
  });
});
