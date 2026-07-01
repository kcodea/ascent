import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult, MinionSnapshot } from '@game/core';
import { accumulateContribution, runMvp, tallyCombat, topMechanic, type RunDamage, type RunProcs } from './contribution';

const snap = (uid: string, cardId: string, name: string): MinionSnapshot => ({ uid, cardId, name, tribe: 'neutral', attack: 1, health: 1, keywords: [] });
const result = (events: CombatEvent[], player: MinionSnapshot[], enemy: MinionSnapshot[] = []): CombatResult => ({
  events, result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player, enemy },
});

describe('tallyCombat (combat contribution)', () => {
  it('credits blows to their dealer in a simultaneous exchange (retaliation counts, damage soaked does not)', () => {
    const r = result(
      [
        // Player attacks: gnash strikes the omen for 6, the omen hits back for 2 (soaked — not credited).
        { type: 'attack', attacker: 'p1', defender: 'e1', swing: 0 }, // `swing` is a windfury flag, not damage
        { type: 'dmg', target: 'e1', amount: 6, remainingHp: 0 },
        { type: 'dmg', target: 'p1', amount: 2, remainingHp: 5 },
        // Enemy attacks: the omen strikes gnash for 3 (not credited), gnash RETALIATES for 4 (credited).
        { type: 'attack', attacker: 'e1', defender: 'p1', swing: 0 },
        { type: 'dmg', target: 'p1', amount: 3, remainingHp: 2 },
        { type: 'dmg', target: 'e1', amount: 4, remainingHp: 0 },
      ],
      [snap('p1', 'gnash', 'Gnasher')],
      [snap('e1', 'omen', 'Omen')],
    );
    const { damage } = tallyCombat(r);
    expect(damage['gnash']).toEqual({ name: 'Gnasher', damage: 10 }); // 6 struck + 4 retaliated
    expect(damage['omen']).toBeUndefined();
  });

  it('counts player-side mechanic procs (SC / Rally / Summon / Rise / Ward / Echo)', () => {
    const summoned = snap('p2', 'pup', 'Pup');
    const r = result(
      [
        { type: 'sc', source: 'p1', text: 'x' },
        { type: 'rally', source: 'p1', target: 'p1' },
        { type: 'summon', minion: summoned, side: 'player', index: 1 },
        { type: 'reborn', target: 'p1', hp: 1, attack: 1, keywords: [] },
        { type: 'shieldUp', target: 'p1' },
        { type: 'death', target: 'p3', side: 'player' }, // Sporeling has an Echo (onDeath)
        { type: 'sc', source: 'e1', text: 'y' }, // enemy SC — not counted
      ],
      [snap('p1', 'gnash', 'Gnasher'), snap('p3', 'spore', 'Sporeling')],
      [snap('e1', 'omen', 'Omen')],
    );
    const { procs } = tallyCombat(r);
    expect(procs).toMatchObject({ 'Start of Combat': 1, Rally: 1, Summon: 1, Rise: 1, Ward: 1, Echo: 1 });
  });
});

describe('accumulate + derive MVP / top mechanic', () => {
  it('accumulates across combats and picks the MVP + most-triggered mechanic', () => {
    const runDamage: RunDamage = {};
    const runProcs: RunProcs = {};
    accumulateContribution(runDamage, runProcs, { damage: { gnash: { name: 'Gnasher', damage: 10 } }, procs: { Summon: 2 } });
    accumulateContribution(runDamage, runProcs, { damage: { gnash: { name: 'Gnasher', damage: 8 }, alley: { name: 'Alleycat', damage: 5 } }, procs: { Summon: 1, Echo: 5 } });
    expect(runDamage['gnash'].damage).toBe(18);
    expect(runMvp(runDamage)).toEqual({ name: 'Gnasher', damage: 18 });
    expect(topMechanic(runProcs)).toEqual({ name: 'Echo', count: 5 }); // Echo 5 > Summon 3
  });

  it('returns null for empty tallies', () => {
    expect(runMvp({})).toBeNull();
    expect(topMechanic(undefined)).toBeNull();
  });
});
