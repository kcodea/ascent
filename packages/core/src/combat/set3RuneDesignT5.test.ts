import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 5 (owner 2026-09-27): the COMBAT half of Rune of Unity (the prototype) and the Heavy
 * Hand, real `simulate()`. The Shop half is `packages/sim/src/set3RuneDesignT5.test.ts`.
 *
 *   · Unity: while the side NATURALLY controls every active type, its minions count as every type (a Celestial-only
 *     Rally buff reaches a Dwarf); a death that breaks the full house withdraws the grant; a Unity body takes the
 *     whole Undead Aura once.
 *   · the Heavy Hand: damage counts double toward Pummel; the per-combat cap still binds.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'kobold', tier: 1, attack: 1, health: 400, keywords: [], effects: [], text: '', ...over });
const RALLIER = probe('dbg_t5c_rally', { keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyTribeAura', params: { tribe: 'celestial', attack: 1, health: 0 } }] });
const D = probe('dbg_t5c_d', { tribe: 'dwarf' });
const U = probe('dbg_t5c_u', { tribe: 'undead' });
const S = probe('dbg_t5c_s', { tribe: 'spirit' });
const C = probe('dbg_t5c_c', { tribe: 'celestial' });
const FRAIL_C = probe('dbg_t5c_fc', { tribe: 'celestial', attack: 1, health: 1 });
const PUMMEL = probe('dbg_t5c_pummel', { tribe: 'dwarf', attack: 3, health: 400, effects: [{ on: 'passive', do: 'dealtDamageGoldNextTurn', params: { every: 6, gold: 3 } }] });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [RALLIER, D, U, S, C, FRAIL_C, PUMMEL]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack: CARDS[cardId]!.attack, health: CARDS[cardId]!.health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => ({ uid, sourceUid: uid, cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const TRIBES = ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'] as const;
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, extra: object = {}, seed = 3) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: [...TRIBES], questMods: mods, ...extra }), combatSide({ tier: 6 }));
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
const uid = (r: ReturnType<typeof fight>, i: number) => r.initial.player[i]!.uid;
const buffsFrom = (evs: readonly CombatEvent[], target: string, source: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.target === target && e.source === source);

describe('Rune of Unity — combat (prototype)', () => {
  const house = () => [bm('r', RALLIER.id), bm('d', D.id), bm('u', U.id), bm('s', S.id), bm('c', C.id)];
  it('a full house: every minion counts as every type, so a Celestial-only Rally buff reaches the Dwarf', () => {
    const r = fight(house(), [foe('f', 1, 5000)], { runeUnity: true });
    expect(triggers(r.events, 'runeUnity').length).toBeGreaterThan(0);
    expect(buffsFrom(r.events, uid(r, 1), uid(r, 0)).length).toBeGreaterThan(0);
    const off = fight(house(), [foe('f', 1, 5000)], {});
    expect(buffsFrom(off.events, uid(off, 1), uid(off, 0)), 'no rune: a Dwarf is not a Celestial').toHaveLength(0);
  });
  it('four types: nothing (the rune cannot make its own full house)', () => {
    const r = fight([bm('r', RALLIER.id), bm('d', D.id), bm('u', U.id), bm('s', S.id)], [foe('f', 1, 5000)], { runeUnity: true });
    expect(triggers(r.events, 'runeUnity')).toHaveLength(0);
    expect(buffsFrom(r.events, uid(r, 1), uid(r, 0))).toHaveLength(0);
  });
  it('the only Celestial dies: the grant is withdrawn, and the Rally stops reaching the Dwarf', () => {
    const r = fight([bm('r', RALLIER.id), bm('d', D.id), bm('u', U.id), bm('s', S.id), bm('c', FRAIL_C.id)], [foe('f', 5, 5000)], { runeUnity: true });
    const cUid = uid(r, 4);
    const death = r.events.findIndex((e) => e.type === 'death' && e.target === cUid);
    expect(death).toBeGreaterThan(-1);
    const before = r.events.slice(0, death);
    const after = r.events.slice(death);
    expect(buffsFrom(before, uid(r, 1), uid(r, 0)).length, 'the Dwarf was a Celestial while the house stood').toBeGreaterThan(0);
    expect(buffsFrom(after, uid(r, 1), uid(r, 0)), 'and is not once it broke').toHaveLength(0);
  });
  it('a Unity body takes the whole Undead Aura once (Lantern + buy Attack, Health); a natural Undead is not paid twice', () => {
    const aura = { undeadAtk: 3, undeadHp: 2, undeadBuyAtk: 1 };
    const r = fight(house(), [foe('f', 0, 5000)], { runeUnity: true }, aura);
    const dwarf = r.initial.player[1]!;
    expect([dwarf.attack, dwarf.health]).toEqual([1 + 4, 400 + 2]);
    const undead = r.initial.player[2]!;
    expect([undead.attack, undead.health], 'the natural Undead: its usual Lantern fold only').toEqual([1 + 3, 400 + 2]);
  });
});

describe('Rune of the Heavy Hand — combat', () => {
  it('3 damage counts as 6 toward Pummel (6): it pays; without the rune it does not', () => {
    const on = fight([bm('p', PUMMEL.id)], [foe('f', 0, 5000)], { runeHeavyHand: true });
    const off = fight([bm('p', PUMMEL.id)], [foe('f', 0, 5000)], {});
    const pays = (r: ReturnType<typeof fight>) => r.events.filter((e) => e.type === 'pummelTrigger').length;
    // One fight is many swings; the (Once per combat) cap binds either way, so compare the FIRST payout's timing.
    const firstPay = (r: ReturnType<typeof fight>) => r.events.findIndex((e) => e.type === 'pummelTrigger');
    const firstSwing = (r: ReturnType<typeof fight>) => r.events.findIndex((e) => e.type === 'attack');
    expect(pays(on)).toBe(1);
    expect(pays(off)).toBe(1);
    const swingsBefore = (r: ReturnType<typeof fight>) => r.events.slice(0, firstPay(r)).filter((e) => e.type === 'attack').length;
    expect(firstSwing(on)).toBeGreaterThan(-1);
    expect(swingsBefore(on), 'pays on the first 3-damage hit').toBe(1);
    expect(swingsBefore(off), 'needs two hits without the rune').toBe(2);
    expect(triggers(on.events, 'runeHeavyHand').length).toBeGreaterThan(0);
  });
});
