import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 3 (owner 2026-09-27): the COMBAT half of the Spirit + Dwarf runes, real `simulate()`.
 * The Shop half is `packages/sim/src/set3RuneDesignT3.test.ts`.
 *
 *   · Call and Answer: a Spirit's Rally and Shout fires each give the left-most hand minion +2/+2 (a hand buff).
 *   · the Anvil: a Dwarf's Attack gain also gives that much Health; a Health gain never re-fires it.
 *   · the Satchel: a card reaching the hand mid-fight gives the living Dwarves +1/+1.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'spirit', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const SPIRIT_RALLY = probe('dbg_t3c_srally', { attack: 1, health: 400, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyBuffSelf', params: { attack: 0, health: 1 } }] });
const SPIRIT_SHOUTER = probe('dbg_t3c_sshout', { attack: 1, health: 400, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyTriggerOwnShout' }, { on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 0, health: 1 } }] });
const NEU_RALLY = probe('dbg_t3c_nrally', { tribe: 'neutral', attack: 1, health: 400, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyBuffSelf', params: { attack: 0, health: 1 } }] });
const DWARF = probe('dbg_t3c_dwarf', { tribe: 'dwarf', attack: 1, health: 400 });
const ECHO_BUFF = probe('dbg_t3c_echo', { tribe: 'neutral', attack: 1, health: 1, effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 2, health: 0 } }] });
const ECHO_RUBY = probe('dbg_t3c_ruby', { tribe: 'neutral', attack: 1, health: 1, effects: [{ on: 'onDeath', do: 'deathrattleGetRubies', params: { count: 1 } }] });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [SPIRIT_RALLY, SPIRIT_SHOUTER, NEU_RALLY, DWARF, ECHO_BUFF, ECHO_RUBY]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, attack: number, health: number): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)] } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => bm(uid, 'sandbag', attack, health);
const HAND = [{ uid: 'h1', cardId: 'sandbag', attack: 1, health: 1, keywords: [], golden: false }, { uid: 'h2', cardId: 'sandbag', attack: 1, health: 1, keywords: [], golden: false }];
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, seed = 3) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'], questMods: mods, handMinions: HAND }), combatSide({ tier: 6 }));
type HB = Extract<CombatEvent, { type: 'handBuff' }>;
const handBuffs = (evs: readonly CombatEvent[]) => evs.filter((e): e is HB => e.type === 'handBuff');
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffsOn = (evs: readonly CombatEvent[], target: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.target === target);
const uid = (r: ReturnType<typeof fight>, i: number) => r.initial.player[i]!.uid;

describe('Rune of Call and Answer — combat', () => {
  it('each Spirit Rally gives the LEFT-MOST hand minion +2/+2, carried back permanently', () => {
    const r = fight([bm('s', SPIRIT_RALLY.id, 1, 400)], [foe('f', 1, 3000)], { runeCallAndAnswer: true });
    const hb = handBuffs(r.events);
    expect(hb.length).toBeGreaterThan(0);
    expect(hb.every((e) => e.uid === 'h1' && e.attack === 2 && e.health === 2)).toBe(true);
    expect(triggers(r.events, 'runeCallAndAnswer')).toHaveLength(hb.length);
    const sum = (r.playerHandBuffs ?? []).filter((b) => b.uid === 'h1').reduce((n, b) => n + b.attack, 0);
    expect(sum).toBe(2 * hb.length);
  });
  it('a Spirit that Rallies AND re-fires its Shout pays twice per swing; a non-Spirit pays nothing', () => {
    const r = fight([bm('s', SPIRIT_SHOUTER.id, 1, 400)], [foe('f', 1, 3000)], { runeCallAndAnswer: true });
    const swings = r.events.filter((e) => e.type === 'attack' && e.attacker === uid(r, 0)).length;
    expect(handBuffs(r.events).length).toBe(2 * swings);
    const n = fight([bm('s', NEU_RALLY.id, 1, 400)], [foe('f', 1, 3000)], { runeCallAndAnswer: true });
    expect(handBuffs(n.events)).toHaveLength(0);
  });
});

describe('Rune of the Anvil — combat', () => {
  it('a Dwarf that gains Attack also gains that much Health; a Health-only gain does not re-fire', () => {
    const r = fight([bm('e', ECHO_BUFF.id, 1, 1), bm('d', DWARF.id, 1, 400)], [foe('f', 5, 3000)], { runeAnvil: true });
    const d = uid(r, 1);
    expect(buffsOn(r.events, d).some((b) => b.attack === 2 && b.health === 0)).toBe(true);
    const anvil = buffsOn(r.events, d).filter((b) => b.source === 'Rune of the Anvil');
    expect(anvil).toHaveLength(1);
    expect([anvil[0]!.attack, anvil[0]!.health]).toEqual([0, 2]);
    const off = fight([bm('e', ECHO_BUFF.id, 1, 1), bm('d', DWARF.id, 1, 400)], [foe('f', 5, 3000)], {});
    expect(buffsOn(off.events, uid(off, 1)).filter((b) => b.source === 'Rune of the Anvil')).toHaveLength(0);
  });
});

describe('Rune of the Satchel — combat', () => {
  it('a card reaching the hand mid-fight (a Ruby from an Echo) gives the living Dwarves +1/+1', () => {
    const r = fight([bm('e', ECHO_RUBY.id, 1, 1), bm('d', DWARF.id, 1, 400)], [foe('f', 5, 3000)], { runeSatchel: true });
    expect(triggers(r.events, 'runeSatchel').length).toBeGreaterThanOrEqual(1);
    expect(buffsOn(r.events, uid(r, 1)).some((b) => b.source === 'Rune of the Satchel' && b.attack === 1 && b.health === 1)).toBe(true);
  });
});
