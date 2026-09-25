/**
 * THE ANNOUNCER'S IN-FIGHT MOMENTS — `announcerCombat.ts`, the pure fold over a replay's event log (owner
 * 2026-09-25: the in-fight lines play "At the moment"). Hand-built logs, the fields the sim stamps.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, Keyword, MinionSnapshot } from '@game/core';
import { COMBAT_MOMENT_THRESHOLDS as T, finalMoments, newCombatScan, scanCombat, type FrameAt } from './announcerCombat';

const snap = (uid: string, keywords: Keyword[] = [], cardId = 'x', attack = 2, health = 2): MinionSnapshot =>
  ({ uid, cardId, name: uid, tribe: 'neutral', attack, health, keywords }) as MinionSnapshot;
const board = (player: MinionSnapshot[], enemy: MinionSnapshot[]) => ({ player, enemy });
/** Fold the whole log, return every moment. */
const all = (initial: ReturnType<typeof board>, events: CombatEvent[], frameAt?: FrameAt) => scanCombat(newCombatScan(initial), events, events.length, frameAt);

describe('the in-fight moments', () => {
  it('FirstBlood only when the fight\'s FIRST death is theirs', () => {
    const b = board([snap('p1')], [snap('e1')]);
    expect(all(b, [{ type: 'death', target: 'e1', side: 'enemy' }])).toContain('firstBlood');
    expect(all(b, [{ type: 'death', target: 'p1', side: 'player' }, { type: 'death', target: 'e1', side: 'enemy' }])).not.toContain('firstBlood');
  });
  it('Overkill: one player hit of 50+ on an enemy', () => {
    const b = board([snap('p1')], [snap('e1')]);
    expect(all(b, [{ type: 'dmg', target: 'e1', amount: T.overkill, remainingHp: 0, source: 'p1' }])).toContain('overkill');
    expect(all(b, [{ type: 'dmg', target: 'p1', amount: 80, remainingHp: 0, source: 'e1' }])).not.toContain('overkill');
    expect(all(b, [{ type: 'dmg', target: 'e1', amount: T.overkill - 1, remainingHp: 0, source: 'p1' }])).not.toContain('overkill');
  });
  it('ExecuteKill / ExecuteKing by the Health the enemy had before the proc hit', () => {
    const b = board([snap('p1', ['V'])], [snap('e1')]);
    const exec = (before: number): CombatEvent[] => [
      { type: 'dmg', target: 'e1', amount: 2, remainingHp: before - 2, source: 'p1' }, { type: 'poison', target: 'e1' },
    ];
    expect(all(b, exec(60))).toEqual(['executeKill']);
    expect(all(b, exec(120))).toEqual(['executeKing', 'executeKill']);
    expect(all(b, exec(30))).toEqual([]);
  });
  it('WardBreak: a friendly Ward pops on a hit that would have killed (the foe hits for its Health or more)', () => {
    const b = board([snap('p1', ['DS'], 'x', 2, 3)], [snap('e1', [], 'x', 5, 5)]);
    const log: CombatEvent[] = [{ type: 'attack', attacker: 'e1', defender: 'p1', swing: 1 }, { type: 'shield', target: 'p1' }];
    const frame = (foeAttack: number): FrameAt => () => ({ player: [{ uid: 'p1', attack: 2, health: 3 }], enemy: [{ uid: 'e1', attack: foeAttack, health: 5 }] });
    expect(all(b, log, frame(5))).toContain('wardBreak');
    expect(all(b, log, frame(2))).not.toContain('wardBreak');
    expect(all(b, log)).not.toContain('wardBreak'); // no frame source: no verdict
  });
  it('Rebirth vs Rise, for the player\'s own minion only', () => {
    const b = board([snap('p1')], [snap('e1')]);
    expect(all(b, [{ type: 'reborn', target: 'p1', hp: 2, attack: 2, keywords: [], rebirth: true }])).toEqual(['rebirth']);
    expect(all(b, [{ type: 'reborn', target: 'p1', hp: 2, attack: 2, keywords: [] }])).toEqual(['riseBack']);
    expect(all(b, [{ type: 'reborn', target: 'e1', hp: 2, attack: 2, keywords: [] }])).toEqual([]);
  });
  it('AvengeBig at the 3rd Avenge fire (distinct steps); EchoChain at the 5th Echo; the enemy\'s do not count', () => {
    const b = board([snap('p1')], [snap('e1')]);
    const avenge = (step: number, src: string): CombatEvent => ({ type: 'buff', target: src, attack: 1, health: 1, source: src, avenge: true, step });
    expect(all(b, [avenge(1, 'p1'), avenge(1, 'p1'), avenge(2, 'p1')])).not.toContain('avengeBig');
    expect(all(b, [avenge(1, 'p1'), avenge(2, 'p1'), avenge(3, 'p1')])).toContain('avengeBig');
    expect(all(b, [avenge(1, 'e1'), avenge(2, 'e1'), avenge(3, 'e1')])).not.toContain('avengeBig');
    const echo = (step: number): CombatEvent => ({ type: 'summon', minion: snap(`t${step}`), side: 'player', index: 0, source: 'p1', key: 'factory:summon:onDeath', step });
    expect(all(b, [1, 2, 3, 4].map(echo))).not.toContain('echoChain');
    expect(all(b, [1, 2, 3, 4, 5].map(echo))).toContain('echoChain');
  });
  it('SummonSwarm at the 10th player summon; TauntWall at the 5th attack into a friendly Taunt', () => {
    const b = board([snap('p1', ['T'])], [snap('e1')]);
    const summon = (i: number): CombatEvent => ({ type: 'summon', minion: snap(`s${i}`), side: 'player', index: 0 });
    expect(all(b, Array.from({ length: T.summon - 1 }, (_, i) => summon(i)))).not.toContain('summonSwarm');
    expect(all(b, Array.from({ length: T.summon }, (_, i) => summon(i)))).toContain('summonSwarm');
    const into = (): CombatEvent => ({ type: 'attack', attacker: 'e1', defender: 'p1', swing: 1 });
    expect(all(b, Array.from({ length: T.taunt }, into))).toContain('tauntWall');
    expect(all(board([snap('p1')], [snap('e1')]), Array.from({ length: T.taunt }, into))).not.toContain('tauntWall');
  });
  it('Flurry: the same Flurry minion kills with two swings back to back', () => {
    const b = board([snap('p1', ['W'])], [snap('e1'), snap('e2')]);
    const log: CombatEvent[] = [
      { type: 'attack', attacker: 'p1', defender: 'e1', swing: 1 }, { type: 'death', target: 'e1', side: 'enemy' },
      { type: 'attack', attacker: 'p1', defender: 'e2', swing: 2 }, { type: 'death', target: 'e2', side: 'enemy' },
    ];
    expect(all(b, log)).toContain('flurry');
    expect(all(board([snap('p1')], [snap('e1'), snap('e2')]), log)).not.toContain('flurry'); // no Flurry keyword
  });
  it('Pummel on a player payout only', () => {
    const b = board([snap('p1')], [snap('e1')]);
    expect(all(b, [{ type: 'pummelTrigger', source: 'p1', side: 'player', marker: 'm' }])).toEqual(['pummel']);
    expect(all(b, [{ type: 'pummelTrigger', source: 'e1', side: 'enemy', marker: 'm' }])).toEqual([]);
  });
  it('LastStand: once one friendly minion is left, its 3rd kill', () => {
    const b = board([snap('p1'), snap('p2')], [snap('e1'), snap('e2'), snap('e3')]);
    const kill = (e: string): CombatEvent[] => [{ type: 'attack', attacker: 'p1', defender: e, swing: 1 }, { type: 'death', target: e, side: 'enemy' }];
    const alone: CombatEvent[] = [{ type: 'death', target: 'p2', side: 'player' }];
    expect(all(b, [...alone, ...kill('e1'), ...kill('e2'), ...kill('e3')])).toContain('lastStand');
    expect(all(b, [...kill('e1'), ...kill('e2'), ...kill('e3')])).not.toContain('lastStand'); // p2 still standing
  });
  it('SameCardDuel when both opening boards hold the same tier 6 minion (handed out on the first scan)', () => {
    const t6 = Object.values(CARD_INDEX).find((d) => d.tier === T.duelTier && !d.spell && !d.token)!;
    const t1 = Object.values(CARD_INDEX).find((d) => d.tier === 1 && !d.spell && !d.token)!;
    expect(all(board([snap('p1', [], t6.id)], [snap('e1', [], t6.id)]), [])).toEqual(['sameCardDuel']);
    expect(all(board([snap('p1', [], t1.id)], [snap('e1', [], t1.id)]), [])).toEqual([]);
  });
  it('folds through the cursor only, and hands each moment out once', () => {
    const b = board([snap('p1')], [snap('e1')]);
    const log: CombatEvent[] = [{ type: 'attack', attacker: 'p1', defender: 'e1', swing: 1 }, { type: 'death', target: 'e1', side: 'enemy' }];
    const scan = newCombatScan(b);
    expect(scanCombat(scan, log, 1)).toEqual([]);
    expect(scanCombat(scan, log, 2)).toEqual(['firstBlood']);
    expect(scanCombat(scan, log, 2)).toEqual([]);
  });
  it('ClutchWin / NarrowLoss from the final frame (a unit at 0 Health does not count as standing)', () => {
    const u = (health: number) => ({ uid: 'u', attack: 1, health });
    expect(finalMoments('win', { player: [u(3), u(0)], enemy: [] })).toEqual(['clutchWin']);
    expect(finalMoments('win', { player: [u(4)], enemy: [] })).toEqual([]);
    expect(finalMoments('win', { player: [u(2), u(2)], enemy: [] })).toEqual([]);
    expect(finalMoments('lose', { player: [], enemy: [u(1)] })).toEqual(['narrowLoss']);
    expect(finalMoments('draw', { player: [], enemy: [] })).toEqual([]);
  });
});
