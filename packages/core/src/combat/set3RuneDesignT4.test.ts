import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 4 (owner 2026-09-27): the COMBAT half of the hybrid runes, real `simulate()`.
 * The Shop / End of Turn / settle halves are `packages/sim/src/set3RuneDesignT4.test.ts`.
 *
 *   · the Gem Crypt: a risen body comes back with the Ruby stats it had (Shop Rubies + this fight's).
 *   · the Pallbearer: a friendly Undead death gives the left-most hand minion +2/+2 (a hand buff).
 *   · the Star Tap: a Dwarven Ale cast in combat banks +3/+3 for the Starform.
 *   · the Grim Toast: a non-Undead Dwarf gets the whole Undead Aura at seeding and on every live Aura rise.
 *   · the Gem Star: a combat Ruby cast feeds the Starform, capped by the turn's remaining count.
 *   · the Keepsake Gem: every combat Ruby cast also lands its stats on the left-most hand minion.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'kobold', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const RISER = probe('dbg_t4c_riser', { attack: 2, health: 2, keywords: ['R'] });
const UNDEAD = probe('dbg_t4c_undead', { tribe: 'undead', attack: 1, health: 1 });
const NEUTRAL = probe('dbg_t4c_neutral', { tribe: 'neutral', attack: 1, health: 1 });
const ALE_RALLY = probe('dbg_t4c_ale', { tribe: 'dwarf', attack: 1, health: 400, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId: 'wo_attack' } }] });
const RUBY_RALLY = probe('dbg_t4c_ruby', { attack: 1, health: 400, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyPlayRubiesTargets', params: { tribe: 'kobold', targets: 1, rubies: 1 } }] });
const DWARF = probe('dbg_t4c_dwarf', { tribe: 'dwarf', attack: 2, health: 400 });
const UNDEAD_DWARF = probe('dbg_t4c_udwarf', { tribe: 'dwarf', tribe2: 'undead', attack: 2, health: 400 });
const ECHO_UNDEAD = probe('dbg_t4c_echo', { tribe: 'undead', attack: 1, health: 1, effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 0, health: 1 } }] });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [RISER, UNDEAD, NEUTRAL, ALE_RALLY, RUBY_RALLY, DWARF, UNDEAD_DWARF, ECHO_UNDEAD]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => bm(uid, 'sandbag', attack, health);
const HAND = [{ uid: 'h1', cardId: 'sandbag', attack: 1, health: 1, keywords: [], golden: false }, { uid: 'h2', cardId: 'sandbag', attack: 1, health: 1, keywords: [], golden: false }];
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, extra: object = {}, seed = 3) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'], questMods: mods, handMinions: HAND, ...extra }), combatSide({ tier: 6 }));
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
type HB = Extract<CombatEvent, { type: 'handBuff' }>;
const handBuffs = (evs: readonly CombatEvent[]) => evs.filter((e): e is HB => e.type === 'handBuff');
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffsOn = (evs: readonly CombatEvent[], target: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.target === target);
type Reborn = Extract<CombatEvent, { type: 'reborn' }>;
const reborns = (evs: readonly CombatEvent[]) => evs.filter((e): e is Reborn => e.type === 'reborn');
const uid = (r: ReturnType<typeof fight>, i: number) => r.initial.player[i]!.uid;
const gain = (r: ReturnType<typeof fight>, source: string) => (r.playerStarformGain ?? []).find((g) => g.source === source);

describe('Rune of the Gem Crypt — combat', () => {
  it('a risen body comes back with its Shop Rubies (the printed 2/1 plus +3/+3)', () => {
    const withRuby = bm('r', RISER.id, 5, 5, { buffs: [{ source: 'Ruby', attack: 3, health: 3 }] } as Partial<BoardMinion>);
    const r = fight([withRuby], [foe('f', 50, 900)], { runeGemCrypt: true });
    const back = reborns(r.events);
    expect(back).toHaveLength(1);
    expect([back[0]!.attack, back[0]!.hp]).toEqual([2 + 3, 1 + 3]);
    expect(triggers(r.events, 'runeGemCrypt')).toHaveLength(1);
    const off = fight([bm('r', RISER.id, 5, 5, { buffs: [{ source: 'Ruby', attack: 3, health: 3 }] } as Partial<BoardMinion>)], [foe('f', 50, 900)], {});
    expect([reborns(off.events)[0]!.attack, reborns(off.events)[0]!.hp], 'without the rune: the printed body').toEqual([2, 1]);
  });
  it('a body with no Rubies rises as printed and the rune stays quiet', () => {
    const r = fight([bm('r', RISER.id, 2, 2)], [foe('f', 50, 900)], { runeGemCrypt: true });
    expect([reborns(r.events)[0]!.attack, reborns(r.events)[0]!.hp]).toEqual([2, 1]);
    expect(triggers(r.events, 'runeGemCrypt')).toHaveLength(0);
  });
});

describe('Rune of the Pallbearer — combat', () => {
  it('every friendly Undead death gives the LEFT-MOST hand minion +2/+2; a non-Undead death pays nothing', () => {
    const r = fight([bm('u', UNDEAD.id, 1, 1), bm('n', NEUTRAL.id, 1, 1)], [foe('f', 50, 900)], { runePallbearer: true });
    const hb = handBuffs(r.events);
    expect(hb).toHaveLength(1);
    expect([hb[0]!.uid, hb[0]!.attack, hb[0]!.health]).toEqual(['h1', 2, 2]);
    expect(triggers(r.events, 'runePallbearer')).toHaveLength(1);
    const two = fight([bm('u', UNDEAD.id, 1, 1)], [foe('f', 50, 900)], { runePallbearer: true, flagCopies: { runePallbearer: 2 } });
    expect(handBuffs(two.events).map((e) => [e.attack, e.health])).toEqual([[4, 4]]);
  });
});

describe('Rune of the Star Tap — combat', () => {
  it('each Dwarven Ale cast in combat banks +3/+3 for the Starform', () => {
    const r = fight([bm('a', ALE_RALLY.id, 1, 400)], [foe('f', 1, 3000)], { runeStarTap: true });
    const fires = triggers(r.events, 'runeStarTap').length;
    expect(fires).toBeGreaterThan(0);
    expect(gain(r, 'Rune of the Star Tap')).toEqual({ source: 'Rune of the Star Tap', attack: 3 * fires, health: 3 * fires });
    const off = fight([bm('a', ALE_RALLY.id, 1, 400)], [foe('f', 1, 3000)], {});
    expect(gain(off, 'Rune of the Star Tap')).toBeUndefined();
  });
});

describe('Rune of the Grim Toast — combat', () => {
  it('a non-Undead Dwarf starts the fight with the whole Undead Aura (Lantern + buy Attack, Health); an Undead Dwarf is not paid twice', () => {
    const aura = { undeadAtk: 3, undeadHp: 2, undeadBuyAtk: 1 };
    const r = fight([bm('d', DWARF.id, 2, 400), bm('ud', UNDEAD_DWARF.id, 2, 400)], [foe('f', 0, 900)], { runeGrimToast: true }, aura);
    const d = r.initial.player[0]!;
    expect([d.attack, d.health]).toEqual([2 + 3 + 1, 400 + 2]);
    // The Undead Dwarf takes the Aura as an Undead (Lantern + Health; its buy slice is baked at buy), exactly once.
    const ud = r.initial.player[1]!;
    expect([ud.attack, ud.health]).toEqual([2 + 3, 400 + 2]);
    const off = fight([bm('d', DWARF.id, 2, 400)], [foe('f', 0, 900)], {}, aura);
    expect([off.initial.player[0]!.attack, off.initial.player[0]!.health], 'without the rune: nothing').toEqual([2, 400]);
  });
  it('a live Aura rise (the Wake off an Undead Echo) reaches the living Dwarves mid-fight', () => {
    const r = fight([bm('e', ECHO_UNDEAD.id, 1, 1), bm('d', DWARF.id, 2, 400)], [foe('f', 5, 900)], { runeGrimToast: true, runeWake: true });
    expect(triggers(r.events, 'runeWake')).toHaveLength(1);
    expect(buffsOn(r.events, uid(r, 1)).filter((b) => b.source === 'Rune of the Grim Toast').map((b) => [b.attack, b.health])).toEqual([[1, 0]]);
  });
});

describe('Rune of the Gem Star — combat', () => {
  it('a combat Ruby feeds the Starform its stats, only while the turn has casts left', () => {
    const r = fight([bm('k', RUBY_RALLY.id, 1, 400)], [foe('f', 1, 3000)], { runeGemStar: true, gemStarLeft: 2 });
    expect(triggers(r.events, 'runeGemStar')).toHaveLength(2);
    expect(gain(r, 'Rune of the Gem Star')).toEqual({ source: 'Rune of the Gem Star', attack: 2, health: 2 });
    const spent = fight([bm('k', RUBY_RALLY.id, 1, 400)], [foe('f', 1, 3000)], { runeGemStar: true, gemStarLeft: 0 });
    expect(gain(spent, 'Rune of the Gem Star'), 'the Shop already used all 4').toBeUndefined();
  });
});

describe('Rune of the Keepsake Gem — combat', () => {
  it('every combat Ruby cast also lands its stats on the left-most hand minion, and nothing loops', () => {
    const r = fight([bm('k', RUBY_RALLY.id, 1, 400)], [foe('f', 1, 3000)], { runeKeepsakeGem: true });
    const casts = triggers(r.events, 'runeKeepsakeGem').length;
    expect(casts).toBeGreaterThan(0);
    const hb = handBuffs(r.events);
    expect(hb).toHaveLength(casts);
    expect(hb.every((e) => e.uid === 'h1' && e.attack === 1 && e.health === 1)).toBe(true);
    // Each swing casts exactly one Ruby: the relay is not itself a cast, so it never re-triggers the rune.
    const swings = r.events.filter((e) => e.type === 'attack' && e.attacker === uid(r, 0)).length;
    expect(casts).toBe(swings);
  });
  it('an empty hand: nothing', () => {
    const r = fight([bm('k', RUBY_RALLY.id, 1, 400)], [foe('f', 1, 3000)], { runeKeepsakeGem: true }, { handMinions: [] });
    expect(handBuffs(r.events)).toHaveLength(0);
    expect(triggers(r.events, 'runeKeepsakeGem')).toHaveLength(0);
  });
});
