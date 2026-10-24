import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { fireRallies } from './recruit';

/**
 * R-DEMON-DMG-DEATH-01 (owner 2026-10-13): "i think the echohorn dies before getting the buff which is 'true' but it
 * shouldnt die, and should actually get the buffs from rachel. if the damage is > the buff from rachel, then yea it
 * dies, but i think it's bugged."
 *
 * A pass (a Gasket Rally pass, a Fel Spikes volley) lands WHOLE, then its Demon-damage reactions (Rad Rachel and her
 * kind) buff, THEN deaths are checked. A minion the pass took to <=0 is still buffed and dies only if the damage beat
 * its Health after the buffs. Both sides identical; the Shop spray follows the same order.
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const wall = (n: number, hp = 40): BoardMinion[] => Array.from({ length: n }, () => bm('trainingdummy', 0, hp));
const sim = (p: BoardMinion[], e: BoardMinion[], seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
const died = (r: CombatResult, uid: string) => r.events.some((e) => e.type === 'death' && e.target === uid);
/** Did `uid` die between the first wave pass and the next swing (the spray's deferred deaths resolve right after it)? */
const diedToSpray = (r: CombatResult, uid: string): boolean => {
  const a = r.events.findIndex((e) => e.wave !== undefined);
  for (let i = a; i < r.events.length; i++) {
    const e = r.events[i]!;
    if (e.type === 'attack') return false;
    if (e.type === 'death' && e.target === uid) return true;
  }
  return false;
};
/** The first wave pass: its events. */
const firstPass = (r: CombatResult): CombatEvent[] => {
  const w = r.events.find((e) => e.wave !== undefined)?.wave;
  return r.events.filter((e) => e.wave === w);
};

describe('Fel Spikes volley: damage, then the reactions, then deaths', () => {
  // m0 Fel Spikes (Taunt, 1 HP: the enemy's 5-Attack swing kills it), m1 Echohorn 4/3, m2 Rad Rachel (0 Attack).
  const board = (echoHp: number) => [bm('dm_felspikes', 0, 1, { keywords: ['T'] }), bm('b2_echohorn', 0, echoHp), bm('dm_radrachel', 0, 40)];

  it('Echohorn 4/3 takes 4 but Rachel\'s buffs from the same volley land first: it survives', () => {
    // 4 enemies: the volley lands 4 enemy hits + 1 on Echohorn = 5 Rachel fires = +5 Health. 3 - 4 + 5 = 4.
    const r = sim(board(3), [bm('trainingdummy', 5, 40), ...wall(3)]);
    expect(died(r, 'm0'), 'Fel Spikes died and fired its volley').toBe(true);
    const pass = firstPass(r);
    expect(pass.some((e) => e.type === 'dmg' && e.target === 'm1' && e.amount === 4)).toBe(true);
    expect(pass.some((e) => e.type === 'buff' && e.target === 'm1' && e.source === 'm2'), 'Rachel buffed it').toBe(true);
    expect(diedToSpray(r, 'm1'), 'the volley does not kill it').toBe(false);
  });

  it('a hit bigger than the buffs still kills (Echohorn 4/1, one enemy: 2 fires = +2, 1 - 4 + 2 < 1)', () => {
    const r = sim(board(1), [bm('trainingdummy', 5, 40)]);
    expect(died(r, 'm0')).toBe(true);
    expect(firstPass(r).some((e) => e.type === 'buff' && e.target === 'm1'), 'buffed before its death check').toBe(true);
    expect(diedToSpray(r, 'm1')).toBe(true);
  });

  it('every hit of the volley lands before any reaction (whole pass, then reactions)', () => {
    const pass = firstPass(sim(board(3), [bm('trainingdummy', 5, 40), ...wall(3)]));
    const lastDmg = pass.map((e) => e.type).lastIndexOf('dmg');
    const firstBuff = pass.findIndex((e) => e.type === 'buff');
    expect(firstBuff).toBeGreaterThan(lastDmg);
  });

  it('side-neutral: the mirrored fight (enemy owns Fel Spikes) gives the mirrored outcome', () => {
    const a = sim(board(3), [bm('trainingdummy', 5, 40), ...wall(3)]);
    const b = sim([bm('trainingdummy', 5, 40), ...wall(3)], board(3));
    const echoA = a.initial.player[1]!.uid;
    const echoB = b.initial.enemy[1]!.uid;
    // Within the volley (the rest of the fight differs: who swings first is not mirrored by the board alone).
    expect(firstPass(a).some((e) => e.type === 'buff' && e.target === echoA)).toBe(true);
    expect(firstPass(b).some((e) => e.type === 'buff' && e.target === echoB)).toBe(true);
    expect(diedToSpray(a, echoA)).toBe(false);
    expect(diedToSpray(b, echoB)).toBe(false);
  });
});

describe('a Start-of-Combat trigger of the Fel Spikes Echo: the same order (bug report 4657b2d2)', () => {
  // Spots' Start of Combat triggers the left-most Echo (Fel Spikes) without a death. m0 Echohorn 4/3 takes the volley's 4;
  // Rad Rachel's buffs from that same volley land before its death check, so it lives and takes its first swing.
  const board = (rachel: boolean) => [bm('b2_echohorn', 4, 3, { keywords: ['RL'] }), bm('dm_felspikes', 0, 40, { keywords: ['T'] }),
    bm('b2_spots', 0, 40, { keywords: ['SC'] }), rachel ? bm('dm_radrachel', 0, 40) : bm('dm_clerk', 0, 40)];

  it('Echohorn survives the SoC-triggered volley on Rachel\'s buffs from it', () => {
    const r = sim(board(true), wall(5));
    const pass = firstPass(r);
    expect(pass[0]?.key, 'the volley is the Start-of-Combat trigger').toContain('startOfCombat');
    expect(pass.some((e) => e.type === 'dmg' && e.target === 'm0' && e.amount === 4 && e.remainingHp === 0)).toBe(true);
    expect(pass.some((e) => e.type === 'buff' && e.target === 'm0' && e.source === 'm3'), 'Rachel buffed it').toBe(true);
    expect(diedToSpray(r, 'm0'), 'the volley does not kill it').toBe(false);
  });

  it('without a reactor the same SoC volley still kills it', () => {
    expect(diedToSpray(sim(board(false), wall(5)), 'm0')).toBe(true);
  });
});

describe('Gasket Rally pass: the same order', () => {
  it('Echohorn 4/2 takes Gasket\'s 2 and survives on Rachel\'s buffs from the same pass', () => {
    const r = sim([bm('dm_gasket', 7, 30, { keywords: ['RL'] }), bm('b2_echohorn', 0, 2), bm('dm_radrachel', 0, 40)], wall(3), 7);
    const pass = firstPass(r);
    expect(pass.some((e) => e.type === 'dmg' && e.target === 'm1' && e.amount === 2)).toBe(true);
    expect(diedToSpray(r, 'm1')).toBe(false);
  });

  it('without a reactor it still dies to the pass (the rule only adds the buffs, it never saves a body by itself)', () => {
    const r = sim([bm('dm_gasket', 7, 30, { keywords: ['RL'] }), bm('b2_echohorn', 0, 2), bm('dm_clerk', 0, 40)], wall(3), 7);
    expect(diedToSpray(r, 'm1')).toBe(true);
  });
});

describe('the Shop spray follows the same order', () => {
  const bc = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra } as BoardCard;
  };
  it('a forced Gasket Rally in the Shop: Echohorn at 2 Health survives on Rachel\'s permanent buffs', () => {
    const state = { ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, hand: [],
      board: [bc('g', 'dm_gasket'), bc('e', 'b2_echohorn', { health: 2 }), bc('n', 'trainingdummy', { health: 2 }), bc('r', 'dm_radrachel')] } as RunState;
    fireRallies(state);
    const echo = state.board.find((c) => c.uid === 'e');
    expect(echo, 'Echohorn is still on the board').toBeDefined();
    // 2 landed hits (Echohorn + the dummy) = +2 Health each: 2 - 2 + 2 = 2.
    expect(echo!.health).toBe(2);
  });
});
