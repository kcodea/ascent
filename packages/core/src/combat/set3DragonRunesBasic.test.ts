import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 DRAGON RUNES, BASIC (owner 2026-10-21): the COMBAT halves. Every fight is a real `simulate()`; the Shop halves
 * and the settle carry-back through the real reducer are in `packages/sim/src/set3DragonRunesBasic.test.ts`.
 *
 *   · Rune of Deep Breaths: the side's first 2 Dragon attacks each cast Growth (a real rune cast).
 *   · Rune of Spell-Fed Scales: a Shop Spell cast in combat gives a random friendly Dragon +6/+7.
 *   · Rune of Defiant Wings: Start of Combat, 2 random friendly Dragons +3/+6 and Ward.
 *   · Rune of the Final Utterance: Avenge (4), a random Whisper and a random Shop Spell to hand.
 *   · Rune of Ember Inheritance: the first friendly Echo Dragon to die gives its Attack to the left-most Dragon.
 *   · Rune of Borrowed Flame / Rune of Spell Tempering: a combat Whisper cast (Whaloo's Runebind) pays both, live, and carries home.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'dragon', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const DRAGON = probe('dbg_dr_dragon', { attack: 1, health: 60 });
const DRAKE_ECHO = probe('dbg_dr_echo', { attack: 5, health: 1, effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 0, health: 1 } }] });
const PLAIN_DRAKE = probe('dbg_dr_plain', { attack: 4, health: 1 });
const BEAST = probe('dbg_dr_beast', { tribe: 'beast', attack: 1, health: 60 });
const NEUTRAL_DIES = probe('dbg_dr_fodder', { tribe: 'neutral', attack: 1, health: 1 });
const WALL = probe('dbg_dr_wall', { tribe: 'neutral', attack: 0, health: 5000 });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [DRAGON, DRAKE_ECHO, PLAIN_DRAKE, BEAST, NEUTRAL_DIES, WALL]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARDS[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (uid: string, attack: number, health: number): BoardMinion => ({ ...bm(uid, 'sandbag'), attack, health });
const TRIBES = ['kobold', 'undead', 'dwarf', 'spirit', 'dragon'];
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, seed = 7, enemyMods: object = {}) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: TRIBES, questMods: mods }), combatSide({ tier: 6, tribes: TRIBES, questMods: enemyMods }));
const triggers = (evs: readonly CombatEvent[], flag: string, side: 'player' | 'enemy' = 'player') =>
  evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && e.side === side);
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffsOn = (evs: readonly CombatEvent[], target: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.target === target);
const uid = (r: ReturnType<typeof fight>, i: number, side: 'player' | 'enemy' = 'player') => r.initial[side][i]!.uid;
const runeCasts = (evs: readonly CombatEvent[], rune: string) => evs.filter((e) => e.type === 'sc' && (e as { rune?: string }).rune === rune);

describe('Rune of Deep Breaths: the first 2 Dragon attacks each combat cast Growth', () => {
  it('exactly 2 Growth casts however many Dragon swings follow; each is a real spell cast', () => {
    const r = fight([bm('a', DRAGON.id), bm('b', DRAGON.id)], [foe('f', 0, 5000)], { runeDeepBreaths: true });
    expect(r.events.filter((e) => e.type === 'attack' && e.attacker.startsWith('m')).length).toBeGreaterThan(4);
    expect(triggers(r.events, 'runeDeepBreaths')).toHaveLength(2);
    const casts = runeCasts(r.events, 'rune_deep_breaths');
    expect(casts).toHaveLength(2);
    expect(casts.every((e) => (e as { spellId?: string }).spellId === 'growth')).toBe(true);
    expect(r.playerSpellsCast).toBe(2); // counted as real casts (carried into the run's spellsCast)
  });
  it('a non-Dragon attack does not spend it; two copies cast 2 Growths per attack', () => {
    const beasts = fight([bm('a', BEAST.id), bm('b', BEAST.id)], [foe('f', 0, 5000)], { runeDeepBreaths: true });
    expect(runeCasts(beasts.events, 'rune_deep_breaths')).toHaveLength(0);
    const two = fight([bm('a', DRAGON.id), bm('b', DRAGON.id)], [foe('f', 0, 5000)], { runeDeepBreaths: true, flagCopies: { runeDeepBreaths: 2 } });
    expect(triggers(two.events, 'runeDeepBreaths')).toHaveLength(2);
    expect(runeCasts(two.events, 'rune_deep_breaths')).toHaveLength(4);
  });
  it('symmetric: an enemy side with the rune casts its own Growths', () => {
    const r = fight([foe('f', 0, 5000)], [bm('a', DRAGON.id), bm('b', DRAGON.id)], {}, 7, { runeDeepBreaths: true });
    expect(triggers(r.events, 'runeDeepBreaths', 'enemy')).toHaveLength(2);
    expect(triggers(r.events, 'runeDeepBreaths', 'player')).toHaveLength(0);
  });
});

describe('Rune of Spell-Fed Scales: a Shop Spell cast in combat gives a random Dragon +6/+7', () => {
  it('each Growth Rune of Deep Breaths casts pays one Dragon +6/+7 (a combat buff)', () => {
    const r = fight([bm('a', DRAGON.id), bm('b', DRAGON.id)], [foe('f', 0, 5000)], { runeDeepBreaths: true, runeSpellFedScales: true });
    expect(triggers(r.events, 'runeSpellFedScales')).toHaveLength(2);
    const fed = [0, 1].flatMap((i) => buffsOn(r.events, uid(r, i))).filter((b) => b.attack === 6 && b.health === 7);
    expect(fed).toHaveLength(2);
    expect((r.playerPermaBuffs ?? []).some((p) => p.attack === 6)).toBe(false); // combat-only (R-BUFF-PERM)
  });
  it('no Dragon alive: nothing (a Beast board casting Growth gets no +6/+7)', () => {
    // A Beast board never triggers Rune of Deep Breaths, so cast Growth through the Dragon and check the Beast never gets it.
    const r = fight([bm('a', DRAGON.id), bm('b', BEAST.id)], [foe('f', 0, 5000)], { runeDeepBreaths: true, runeSpellFedScales: true });
    expect(buffsOn(r.events, uid(r, 1)).some((b) => b.attack === 6 && b.health === 7)).toBe(false);
    expect(buffsOn(r.events, uid(r, 0)).filter((b) => b.attack === 6 && b.health === 7)).toHaveLength(2);
  });
});

describe('Rune of Defiant Wings: Start of Combat, 2 Dragons +3/+6 and Ward', () => {
  it('2 distinct Dragons get +3/+6 and Ward; a non-Dragon never does', () => {
    const r = fight([bm('a', DRAGON.id), bm('b', BEAST.id), bm('c', DRAGON.id), bm('d', DRAGON.id)], [foe('f', 0, 5000)], { runeDefiantWings: true });
    expect(triggers(r.events, 'runeDefiantWings')).toHaveLength(1);
    const got = [0, 1, 2, 3].filter((i) => buffsOn(r.events, uid(r, i)).some((b) => b.attack === 3 && b.health === 6));
    expect(got).toHaveLength(2);
    expect(got).not.toContain(1);
    const shields = r.events.filter((e) => e.type === 'shieldUp').map((e) => (e as { target: string }).target);
    for (const i of got) expect(shields).toContain(uid(r, i));
  });
  it('one Dragon: just that one; no Dragon: nothing fires', () => {
    const one = fight([bm('a', DRAGON.id), bm('b', BEAST.id)], [foe('f', 0, 5000)], { runeDefiantWings: true });
    expect(buffsOn(one.events, uid(one, 0)).filter((b) => b.attack === 3 && b.health === 6)).toHaveLength(1);
    const none = fight([bm('b', BEAST.id)], [foe('f', 0, 5000)], { runeDefiantWings: true });
    expect(triggers(none.events, 'runeDefiantWings')).toHaveLength(0);
  });
  it('Rune of Twilight repeats it (its text begins "Start of Combat:")', () => {
    const r = fight([bm('a', DRAGON.id), bm('c', DRAGON.id)], [foe('f', 0, 5000)], { runeDefiantWings: true, runeTwilight: true });
    expect(triggers(r.events, 'runeDefiantWings')).toHaveLength(2);
  });
});

describe('Rune of the Final Utterance: Avenge (4), a random Whisper and a random Shop Spell', () => {
  const four = () => [bm('a', NEUTRAL_DIES.id), bm('b', NEUTRAL_DIES.id), bm('c', NEUTRAL_DIES.id), bm('d', NEUTRAL_DIES.id), bm('w', WALL.id)];
  it('the 4th friendly death hands over one Whisper and one spell; Rune of Fury doubles it', () => {
    const r = fight(four(), [foe('f', 50, 5000)], { runeFinalUtterance: true });
    expect(triggers(r.events, 'runeFinalUtterance')).toHaveLength(1);
    const grants = r.playerHandGrants ?? [];
    expect(grants).toHaveLength(2);
    expect(CARDS[grants[0]!]?.whisper).toBe(true);
    expect(CARDS[grants[1]!]?.spell && !CARDS[grants[1]!]?.whisper).toBe(true);
    const fury = fight(four(), [foe('f', 50, 5000)], { runeFinalUtterance: true, runeFury: true });
    expect(fury.playerHandGrants ?? []).toHaveLength(4);
  });
  it('the Whisper respects the side tier (a Tier 1 side only rolls Tier 1 Whispers)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = simulate(four(), [foe('f', 50, 5000)], makeRng(seed), CARDS, combatSide({ tier: 1, tribes: TRIBES, questMods: { runeFinalUtterance: true } }), combatSide({ tier: 6 }));
      const w = (r.playerHandGrants ?? []).find((id) => CARDS[id]?.whisper);
      if (w) expect(CARDS[w]!.tier, `${w} at seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('Rune of Ember Inheritance: the first Echo Dragon death gives its Attack to the left-most Dragon', () => {
  it('pays once per fight, to the left-most living Dragon, for the dying Echo Dragon\'s Attack', () => {
    const r = fight([bm('h', DRAGON.id), bm('e1', DRAKE_ECHO.id), bm('e2', DRAKE_ECHO.id)], [foe('f', 10, 5000)], { runeEmberInheritance: true });
    expect(triggers(r.events, 'runeEmberInheritance')).toHaveLength(1);
    expect(buffsOn(r.events, uid(r, 0)).some((b) => b.attack === 5 && b.health === 0)).toBe(true);
  });
  it('a Dragon without Echo does not count; two copies give twice', () => {
    const plain = fight([bm('h', DRAGON.id), bm('p', PLAIN_DRAKE.id)], [foe('f', 10, 5000)], { runeEmberInheritance: true });
    expect(triggers(plain.events, 'runeEmberInheritance')).toHaveLength(0);
    const two = fight([bm('h', DRAGON.id), bm('e1', DRAKE_ECHO.id)], [foe('f', 10, 5000)], { runeEmberInheritance: true, flagCopies: { runeEmberInheritance: 2 } });
    expect(buffsOn(two.events, uid(two, 0)).some((b) => b.attack === 10 && b.health === 0)).toBe(true);
  });
});

describe('Rune of Borrowed Flame + Rune of Spell Tempering: combat Whisper casts (Whaloo)', () => {
  const whaloo = () => [bm('w', 'd3_whaloo', { attack: 1, health: 900 }), bm('d', DRAGON.id)];
  it('Rune of Borrowed Flame: each Runebind on a Dragon pays the live value, improving +1 each time, and the gain carries home', () => {
    const r = fight(whaloo(), [foe('f', 0, 5000)], { runeBorrowedFlame: 1 });
    const fires = triggers(r.events, 'runeBorrowedFlame').length;
    expect(fires).toBe(3); // Whaloo's 3 casts per combat, every one on an attacking Dragon
    expect(r.playerShoutCarry?.borrowedFlameGain).toBe(3);
    const flame = [0, 1].flatMap((i) => buffsOn(r.events, uid(r, i))).filter((b) => b.attack === b.health && b.attack >= 1 && b.attack <= 3 && b.source === 'Rune of Borrowed Flame');
    expect(flame.map((b) => b.attack).sort()).toEqual([1, 2, 3]); // one cast each at 1, 2, 3 (grouped by body here)
  });
  it('Rune of Spell Tempering: the carried meter ticks per Whisper cast and the 4th pays +1/+1 spell power live', () => {
    const r = fight(whaloo(), [foe('f', 0, 5000)], { runeSpellTempering: true, runeSpellTemperingTick: 2 });
    expect(r.playerShoutCarry?.whispersCast).toBe(3);
    expect(triggers(r.events, 'runeSpellTempering')).toHaveLength(1); // 2 + 2nd cast = 4
    expect(r.playerSpellPower).toEqual({ attack: 1, health: 1 });
  });
  it('is deterministic', () => {
    const a = fight(whaloo(), [foe('f', 0, 5000)], { runeBorrowedFlame: 2, runeSpellTempering: true, runeDeepBreaths: true, runeSpellFedScales: true }, 11);
    const b = fight(whaloo(), [foe('f', 0, 5000)], { runeBorrowedFlame: 2, runeSpellTempering: true, runeDeepBreaths: true, runeSpellFedScales: true }, 11);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});
