import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { deferAvengeAfterSummons } from './avengeOrder';

const attack = (a: string, d: string): CombatEvent => ({ type: 'attack', attacker: a, defender: d, swing: 0 } as CombatEvent);
const dmg = (target: string): CombatEvent => ({ type: 'dmg', target, amount: 1, remainingHp: 1 } as CombatEvent);
const death = (target: string): CombatEvent => ({ type: 'death', target, side: 'player' } as CombatEvent);
const summon = (uid: string): CombatEvent => ({ type: 'summon', minion: { uid, cardId: 't' }, side: 'player', index: 0 } as CombatEvent);
const reborn = (target: string): CombatEvent => ({ type: 'reborn', target, hp: 1, attack: 1, keywords: [] } as CombatEvent);
// Avenge-tagged payoffs (the sim stamps these `avenge:true`).
const avBuff = (target: string): CombatEvent => ({ type: 'buff', target, attack: 1, health: 1, source: 's', avenge: true } as CombatEvent);
const avGold = (): CombatEvent => ({ type: 'maxGold', target: 's', side: 'player', amount: 1, avenge: true } as CombatEvent);
const avSummon = (uid: string): CombatEvent => ({ type: 'summon', minion: { uid, cardId: 't' }, side: 'player', index: 0, avenge: true } as CombatEvent);
// A NON-avenge buff (e.g. a Deathrattle buff) — must never be touched by this pass.
const drBuff = (target: string): CombatEvent => ({ type: 'buff', target, attack: 1, health: 1, source: 's' } as CombatEvent);
const types = (es: CombatEvent[]): string[] => es.map((e) => e.type);

describe('deferAvengeAfterSummons — hold Avenge payoffs until after the death cascade summons', () => {
  it('slides an Avenge buff past a later death\'s summon (multi-death clash)', () => {
    // death(a)→summon(sa), death(b)→summon(sb) [Avenge threshold], death(c)→summon(sc)
    const evs = [attack('e', 'a'), dmg('a'), death('a'), summon('sa'), death('b'), summon('sb'), avBuff('x'), death('c'), summon('sc')];
    expect(types(deferAvengeAfterSummons(evs))).toEqual(
      ['attack', 'dmg', 'death', 'summon', 'death', 'summon', 'death', 'summon', 'buff'],
    );
  });

  it('slides an Avenge payoff past a deferred attack-on-summon token (Violet Whelp)', () => {
    // death(p) → [Avenge] → flush: summon(whelp) → attack(whelp) …
    const evs = [attack('p', 'e'), dmg('p'), death('p'), avGold(), summon('whelp'), attack('whelp', 'e'), dmg('e')];
    expect(types(deferAvengeAfterSummons(evs))).toEqual(
      ['attack', 'dmg', 'death', 'summon', 'maxGold', 'attack', 'dmg'],
    );
  });

  it('leaves an Avenge beat that already trails the summons untouched (same reference)', () => {
    const evs = [attack('e', 'a'), death('a'), summon('sa'), avBuff('x')];
    expect(deferAvengeAfterSummons(evs)).toBe(evs);
  });

  it('does nothing when no summon follows the Avenge in this exchange (same reference)', () => {
    const evs = [attack('e', 'a'), dmg('a'), death('a'), avGold()];
    expect(deferAvengeAfterSummons(evs)).toBe(evs);
  });

  it('never crosses an attack boundary into the next exchange', () => {
    // a summon in the NEXT exchange must not pull the Avenge forward
    const evs = [attack('e', 'a'), death('a'), avBuff('x'), attack('w', 'e'), summon('sw')];
    expect(deferAvengeAfterSummons(evs)).toBe(evs);
  });

  it('bails when the Avenge event\'s own target is reborn before the summon (fold-unsafe)', () => {
    // moving the buff past its own target\'s reborn (a base-stat reset) would change the folded stats
    const evs = [attack('e', 'a'), death('a'), avBuff('x'), reborn('x'), summon('sb')];
    expect(deferAvengeAfterSummons(evs)).toBe(evs);
  });

  it('does NOT reorder an Avenge summon (index-based board slot must be preserved)', () => {
    const evs = [attack('e', 'a'), death('a'), avSummon('sv'), death('b'), summon('sb')];
    expect(deferAvengeAfterSummons(evs)).toBe(evs);
  });

  it('leaves a non-Avenge (Deathrattle) buff untouched', () => {
    const evs = [attack('e', 'a'), death('a'), drBuff('x'), death('b'), summon('sb')];
    expect(deferAvengeAfterSummons(evs)).toBe(evs);
  });

  it('moves two Avenge payoffs together, preserving their relative order at the tail', () => {
    const evs = [attack('e', 'a'), death('a'), avBuff('x'), avGold(), death('b'), summon('sb')];
    const out = deferAvengeAfterSummons(evs);
    expect(types(out)).toEqual(['attack', 'death', 'death', 'summon', 'buff', 'maxGold']);
    expect((out[4] as { target: string }).target).toBe('x'); // buff('x') still before maxGold
  });

  it('hops over an unrelated unit\'s events but lands after the summon', () => {
    // avBuff('x') should pass dmg('other')/death('other')/summon and trail them
    const evs = [attack('e', 'a'), death('a'), avBuff('x'), dmg('other'), summon('sb'), death('other')];
    expect(types(deferAvengeAfterSummons(evs))).toEqual(
      ['attack', 'death', 'dmg', 'summon', 'buff', 'death'],
    );
  });
});
