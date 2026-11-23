import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, SET3_UNDEAD_RUNES, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 NEW-CONCEPT RUNES, UNDEAD (owner review 2026-11-23): the COMBAT halves. Every fight is a real `simulate()`; the
 * Shop halves (and the settle carry-back through the real reducer) are `packages/sim/src/set3UndeadRunes.test.ts`.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'undead', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const RISER = probe('dbg_s3u_rise', { attack: 2, health: 2, keywords: ['R'] });
const UNDEAD = probe('dbg_s3u_undead', { attack: 1, health: 1 });
const NEUTRAL = probe('dbg_s3u_neutral', { tribe: 'neutral', attack: 1, health: 1 });
const WALL = probe('dbg_s3u_wall', { tribe: 'neutral', attack: 0, health: 5000 });
const UNDEAD_WALL = probe('dbg_s3u_uwall', { attack: 0, health: 5000 });
/** Echo: summon two Skeletons (dying on a full board frees ONE slot, so the second one overflows). */
const DOUBLE_SUMMONER = probe('dbg_s3u_summoner', { tribe: 'neutral', attack: 1, health: 1, effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'u3_skeleton', count: 2 } }] });
const ECHO_UNDEAD = probe('dbg_s3u_echo', { effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 0, health: 0 } }] });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [RISER, UNDEAD, NEUTRAL, WALL, UNDEAD_WALL, DOUBLE_SUMMONER, ECHO_UNDEAD]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => bm(uid, 'sandbag', attack, health);
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, extra: object = {}, seed = 7) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'], questMods: mods, ...extra }), combatSide({ tier: 6 }));
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
type Summon = Extract<CombatEvent, { type: 'summon' }>;
const summons = (evs: readonly CombatEvent[], cardId: string, side = 'player') =>
  evs.filter((e): e is Summon => e.type === 'summon' && e.side === side && e.minion.cardId === cardId);
const rises = (evs: readonly CombatEvent[]) => evs.filter((e) => e.type === 'reborn').length;

describe('Grave Tithe: the 3rd friendly Rise of a combat banks 2 Gold next turn (once per combat)', () => {
  const three = () => [bm('a', RISER.id, 2, 2), bm('b', RISER.id, 2, 2), bm('c', RISER.id, 2, 2), bm('w', WALL.id, 0, 5000)];
  it('three Rises pay 2 Gold once, on its own trigger', () => {
    const r = fight(three(), [foe('f', 5, 9000)], { runeGraveTithe: true });
    expect(rises(r.events)).toBe(3);
    expect(triggers(r.events, 'runeGraveTithe')).toHaveLength(1);
    expect(r.playerBonusGold ?? 0).toBe(SET3_UNDEAD_RUNES.graveTitheGold);
    expect(r.events.some((e) => e.type === 'bonusGold' && e.side === 'player' && e.amount === 2)).toBe(true);
  });
  it('without the rune nothing is banked; two Rises are not enough; five Rises still pay once; two copies pay 4', () => {
    expect(fight(three(), [foe('f', 5, 9000)], {}).playerBonusGold ?? 0).toBe(0);
    const two = fight([bm('a', RISER.id, 2, 2), bm('b', RISER.id, 2, 2), bm('w', WALL.id, 0, 5000)], [foe('f', 5, 9000)], { runeGraveTithe: true });
    expect(rises(two.events)).toBe(2);
    expect(two.playerBonusGold ?? 0).toBe(0);
    const five = fight([...three(), bm('d', RISER.id, 2, 2), bm('e', RISER.id, 2, 2)], [foe('f', 5, 9000)], { runeGraveTithe: true });
    expect(rises(five.events)).toBe(5);
    expect(five.playerBonusGold ?? 0).toBe(2);
    expect(fight(three(), [foe('f', 5, 9000)], { runeGraveTithe: true, flagCopies: { runeGraveTithe: 2 } }).playerBonusGold ?? 0).toBe(4);
  });
});

describe('Dead Weight: an Overflow raises the Undead Aura +2 Attack', () => {
  const full = () => [bm('s', DOUBLE_SUMMONER.id, 1, 1), ...[1, 2, 3, 4, 5].map((i) => bm(`u${i}`, UNDEAD.id, 0, 5000)), bm('w', UNDEAD_WALL.id, 0, 5000)];
  it('the overflowed Skeleton raises the Aura (live on the Undead, carried back)', () => {
    const r = fight(full(), [foe('f', 5, 9000)], { runeDeadWeight: true });
    const n = triggers(r.events, 'runeDeadWeight').length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(r.playerUndeadAuraGain?.attack).toBe(2 * n);
  });
  it('without the rune the Overflow raises nothing; two copies raise +4 per Overflow', () => {
    expect(fight(full(), [foe('f', 5, 9000)], {}).playerUndeadAuraGain?.attack ?? 0).toBe(0);
    const two = fight(full(), [foe('f', 5, 9000)], { runeDeadWeight: true, flagCopies: { runeDeadWeight: 2 } });
    expect(two.playerUndeadAuraGain?.attack).toBe(4 * triggers(two.events, 'runeDeadWeight').length);
  });
});

describe('Rank and File: summoned Footmen and Spear Wardens have Taunt', () => {
  it('a Footman Captain\'s Footman lands with Taunt, and keeps it on its Rise return', () => {
    const board = () => [bm('c', 'deathlesshand', 4, 1), bm('w', WALL.id, 0, 5000)];
    const r = fight(board(), [foe('f', 5, 9000)], { runeRankAndFile: true });
    const fm = summons(r.events, 'footman');
    expect(fm.length).toBeGreaterThanOrEqual(1);
    expect(fm[0]!.minion.keywords).toContain('T');
    const back = r.events.find((e) => e.type === 'reborn' && e.target === fm[0]!.minion.uid);
    if (back && back.type === 'reborn') expect(back.keywords).toContain('T');
    const off = fight(board(), [foe('f', 5, 9000)], {});
    expect(summons(off.events, 'footman')[0]!.minion.keywords).not.toContain('T');
  });
  it('a Night Watch Spear Warden lands with Taunt; a Skeleton does not', () => {
    const r = fight([bm('u', UNDEAD.id, 1, 1), bm('v', UNDEAD.id, 1, 1), bm('w', WALL.id, 0, 5000)], [foe('f', 5, 9000)], { runeRankAndFile: true, runeNightWatch: true, runeBonePile: true });
    expect(summons(r.events, 'knit')[0]!.minion.keywords).toContain('T');
    expect(summons(r.events, 'u3_skeleton')[0]!.minion.keywords).not.toContain('T');
  });
});

describe('Bone Pile: Start of Combat, a Skeleton for every 2 Undead you control', () => {
  const undead = (n: number) => Array.from({ length: n }, (_, i) => bm(`u${i}`, UNDEAD.id, 0, 5000));
  it('4 Undead -> 2 Skeletons, 3 -> 1, neutrals do not count, 2 copies double it', () => {
    expect(summons(fight(undead(4), [foe('f', 1, 9000)], { runeBonePile: true }).events, 'u3_skeleton')).toHaveLength(2);
    expect(summons(fight(undead(3), [foe('f', 1, 9000)], { runeBonePile: true }).events, 'u3_skeleton')).toHaveLength(1);
    expect(summons(fight([...undead(1), bm('n', NEUTRAL.id, 0, 5000), bm('m', NEUTRAL.id, 0, 5000)], [foe('f', 1, 9000)], { runeBonePile: true }).events, 'u3_skeleton')).toHaveLength(0);
    expect(summons(fight(undead(2), [foe('f', 1, 9000)], { runeBonePile: true, flagCopies: { runeBonePile: 2 } }).events, 'u3_skeleton')).toHaveLength(2);
    expect(summons(fight(undead(4), [foe('f', 1, 9000)], {}).events, 'u3_skeleton')).toHaveLength(0);
  });
  it('a Start of Combat rune: Rune of Twilight repeats it', () => {
    const r = fight(undead(2), [foe('f', 1, 9000)], { runeBonePile: true, runeTwilight: true });
    expect(summons(r.events, 'u3_skeleton').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Second Burial: a friendly minion that already Rose dies -> a Skeleton with its Attack', () => {
  it('the Rise death does not count; the risen body\'s death leaves a Skeleton at its Attack', () => {
    const r = fight([bm('r', RISER.id, 6, 2), bm('w', WALL.id, 0, 5000)], [foe('f', 9, 9000)], { runeSecondBurial: true });
    expect(rises(r.events)).toBe(1);
    const sk = summons(r.events, 'u3_skeleton');
    expect(sk).toHaveLength(1);
    expect(triggers(r.events, 'runeSecondBurial')).toHaveLength(1);
    // The risen body returns at its printed 2 Attack (Rise), so the Skeleton is raised from 1 to 2.
    expect(sk[0]!.minion.attack).toBe(2);
  });
  it('without the rune, or a body that never Rose: no Skeleton', () => {
    expect(summons(fight([bm('r', RISER.id, 6, 2), bm('w', WALL.id, 0, 5000)], [foe('f', 9, 9000)], {}).events, 'u3_skeleton')).toHaveLength(0);
    expect(summons(fight([bm('u', UNDEAD.id, 6, 2), bm('w', WALL.id, 0, 5000)], [foe('f', 9, 9000)], { runeSecondBurial: true }).events, 'u3_skeleton')).toHaveLength(0);
  });
});

describe('Night Watch: Start of Combat, a Spear Warden with double its bonus', () => {
  const wardenBonus = { knit: { attack: 4, health: 2 } };
  it('the Warden lands at its printed body + TWICE the run\'s Warden enchant', () => {
    const r = fight([bm('w', WALL.id, 0, 5000)], [foe('f', 1, 9000)], { runeNightWatch: true }, { cardBuffs: wardenBonus });
    const w = summons(r.events, 'knit');
    expect(w).toHaveLength(1);
    expect(triggers(r.events, 'runeNightWatch')).toHaveLength(1);
    const k = CARD_INDEX['knit']!;
    // The summon event shows the body as it landed (printed + one enchant); the rune's second helping follows it.
    const buff = r.events.find((e) => e.type === 'buff' && e.target === w[0]!.minion.uid && e.attack === 4 && e.health === 2);
    expect(w[0]!.minion.attack + (buff ? 4 : 0)).toBe(k.attack + 8);
  });
  it('a Spear Warden death this fight pays the Night Watch Warden twice', () => {
    const r = fight([bm('k', 'knit', 4, 1), bm('w', WALL.id, 0, 5000)], [foe('f', 5, 9000)], { runeNightWatch: true });
    const nw = summons(r.events, 'knit')[0]!.minion.uid;
    const pays = r.events.filter((e) => e.type === 'buff' && e.target === nw && e.attack === 4 && e.health === 2);
    expect(pays.length).toBeGreaterThanOrEqual(2);
    expect(pays.length % 2).toBe(0);
  });
  it('without the rune, no Warden', () => {
    expect(summons(fight([bm('w', WALL.id, 0, 5000)], [foe('f', 1, 9000)], {}).events, 'knit')).toHaveLength(0);
  });
});

describe('Requiem: an Undead Aura rise gives your Undead +1/+1 permanently (5 times per turn)', () => {
  const echoes = (n: number) => [...Array.from({ length: n }, (_, i) => bm(`e${i}`, ECHO_UNDEAD.id, 1, 1)), bm('w', UNDEAD_WALL.id, 0, 5000)];
  it('each Wake Aura rise pays the living Undead +1/+1, carried back permanently', () => {
    const r = fight(echoes(2), [foe('f', 5, 9000)], { runeWake: true, runeRequiem: true, requiemLeft: 5 });
    expect(triggers(r.events, 'runeWake')).toHaveLength(2);
    expect(triggers(r.events, 'runeRequiem')).toHaveLength(2);
    const perma = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'w');
    expect(perma.reduce((n, p) => n + p.attack, 0)).toBe(2);
    expect(perma.reduce((n, p) => n + p.health, 0)).toBe(2);
  });
  it('the turn\'s budget caps it (requiemLeft), and no rune means no grant', () => {
    const capped = fight(echoes(3), [foe('f', 5, 9000)], { runeWake: true, runeRequiem: true, requiemLeft: 1 });
    expect(triggers(capped.events, 'runeWake')).toHaveLength(3);
    expect(triggers(capped.events, 'runeRequiem')).toHaveLength(1);
    const none = fight(echoes(2), [foe('f', 5, 9000)], { runeWake: true });
    expect((none.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'w')).toHaveLength(0);
  });
});

describe('Undying Legion: Avenge (5), get a random Undead and summon it from hand', () => {
  const five = () => [...[1, 2, 3, 4, 5].map((i) => bm(`n${i}`, NEUTRAL.id, 1, 1)), bm('w', WALL.id, 0, 5000)];
  it('the 5th friendly death grants a random Undead and summons a copy from hand (the card stays in hand)', () => {
    const r = fight(five(), [foe('f', 50, 9000)], { runeUndyingLegion: true });
    expect(triggers(r.events, 'runeUndyingLegion')).toHaveLength(1);
    const grants = r.playerHandGrants ?? [];
    expect(grants).toHaveLength(1);
    const d = CARD_INDEX[grants[0]!]!;
    expect(d.tribe === 'undead' || d.tribe2 === 'undead' || !!d.universalTribe, `${d.id} is Undead`).toBe(true);
    const fromHand = r.events.filter((e): e is Summon => e.type === 'summon' && e.side === 'player' && !!e.fromHandUid);
    expect(fromHand).toHaveLength(1);
    expect(fromHand[0]!.minion.cardId).toBe(d.id);
  });
  it('Rune of Fury repeats it; four deaths or no rune do nothing', () => {
    const fury = fight(five(), [foe('f', 50, 9000)], { runeUndyingLegion: true, runeFury: true });
    const isUndead = (id: string) => { const d = CARD_INDEX[id]!; return d.tribe === 'undead' || d.tribe2 === 'undead' || !!d.universalTribe; };
    expect(triggers(fury.events, 'runeUndyingLegion')).toHaveLength(1);
    expect((fury.playerHandGrants ?? []).filter(isUndead).length).toBeGreaterThanOrEqual(2); // a summoned copy's own Echo may add more
    expect(fury.events.filter((e) => e.type === 'summon' && e.side === 'player' && !!e.fromHandUid)).toHaveLength(2);
    const four = fight(five().slice(0, 4), [foe('f', 50, 9000)], { runeUndyingLegion: true }); // no wall: four deaths end it
    expect(four.playerHandGrants ?? []).toHaveLength(0);
    expect(fight(five(), [foe('f', 50, 9000)], {}).playerHandGrants ?? []).toHaveLength(0);
  });
});
