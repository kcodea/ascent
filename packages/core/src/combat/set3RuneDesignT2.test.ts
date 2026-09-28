import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 2 (owner 2026-09-27): the COMBAT half of the Celestial runes, real `simulate()`.
 * The Shop half and the settle landing of the banked Starform growth are `packages/sim/src/set3RuneDesignT2.test.ts`.
 *
 *   · the Heralding Star: a Celestial Shout fire banks +3/+3 for the Starform (the Shop token: carried back).
 *   · the Starsong: a Celestial Shout fire gives the living Celestials +2/+2.
 *   · Stellar Echoes: the grafted "Echo: give your Starform +2/+2" banks on death; a SUMMONED Celestial is grafted.
 *   · the Guiding Star: a Celestial Echo casts a Star Crash (a real cast) on a random living friendly Celestial.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'celestial', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
// Rally: trigger its own Shout (+1/+1 to adjacent) — a Celestial Shout fire on every swing.
const SHOUTER = probe('dbg_t2c_shouter', { attack: 1, health: 400, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyTriggerOwnShout' }, { on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 1, health: 1 } }] });
const NEUTRAL_SHOUTER = probe('dbg_t2c_nshouter', { tribe: 'neutral', attack: 1, health: 400, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyTriggerOwnShout' }, { on: 'onPlay', do: 'battlecryBuffAdjacent', params: { attack: 1, health: 1 } }] });
const CEL = probe('dbg_t2c_cel', { attack: 0, health: 400 });
const FRAIL_CEL = probe('dbg_t2c_frail', { attack: 1, health: 1 });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [SHOUTER, NEUTRAL_SHOUTER, CEL, FRAIL_CEL]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => bm(uid, 'sandbag', attack, health);
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, seed = 5) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'], questMods: mods }), combatSide({ tier: 6 }));
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
const shouts = (evs: readonly CombatEvent[], uid: string) => evs.filter((e) => e.type === 'shout' && e.target === uid);
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffsOn = (evs: readonly CombatEvent[], target: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.target === target);
const uid = (r: ReturnType<typeof fight>, i: number) => r.initial.player[i]!.uid;
const gain = (r: ReturnType<typeof fight>, source: string) => (r.playerStarformGain ?? []).find((g) => g.source === source);

describe('Rune of the Heralding Star — combat', () => {
  it('every Celestial Shout fire banks +3/+3 for the Starform; a non-Celestial Shout banks nothing', () => {
    const r = fight([bm('s', SHOUTER.id, 1, 400), bm('c', CEL.id, 0, 400)], [foe('f', 1, 3000)], { runeHeraldingStar: true });
    const fires = shouts(r.events, uid(r, 0)).length;
    expect(fires).toBeGreaterThan(0);
    expect(triggers(r.events, 'runeHeraldingStar')).toHaveLength(fires);
    expect(gain(r, 'Rune of the Heralding Star')).toEqual({ source: 'Rune of the Heralding Star', attack: 3 * fires, health: 3 * fires });
    const n = fight([bm('s', NEUTRAL_SHOUTER.id, 1, 400)], [foe('f', 1, 3000)], { runeHeraldingStar: true });
    expect(n.playerStarformGain).toBeUndefined();
  });
});

describe('Rune of the Starsong — combat', () => {
  it('every Celestial Shout fire gives the living Celestials +2/+2', () => {
    const r = fight([bm('s', SHOUTER.id, 1, 400), bm('g', 'sandbag', 0, 400), bm('c', CEL.id, 0, 400)], [foe('f', 1, 3000)], { runeStarsong: true });
    // Count the fires while the Celestial wall still stands (the long fight eventually kills it).
    const cDeath = r.events.findIndex((e) => e.type === 'death' && e.target === uid(r, 2));
    const alive = cDeath < 0 ? r.events : r.events.slice(0, cDeath);
    const fires = triggers(alive, 'runeStarsong').length;
    expect(fires).toBeGreaterThan(0);
    expect(fires).toBe(shouts(alive, uid(r, 0)).length);
    expect(buffsOn(alive, uid(r, 2)).filter((b) => b.attack === 2 && b.health === 2)).toHaveLength(fires);
    expect(buffsOn(r.events, uid(r, 1)).filter((b) => b.attack === 2 && b.health === 2), 'a non-Celestial gets nothing').toHaveLength(0);
  });
});

describe('Rune of Stellar Echoes — combat', () => {
  const GRAFT = { on: 'onDeath' as const, do: 'deathrattleBuffStarform' as const, params: { attack: 2, health: 2, fixed: true } };
  it('a board Celestial carrying the Shop graft banks +2/+2 when it dies; a Gilded one the same', () => {
    const r = fight([bm('a', FRAIL_CEL.id, 1, 1, { grantedEffects: [GRAFT] } as never)], [foe('f', 10, 100)], { runeStellarEchoes: true });
    expect(gain(r, 'Rune of Stellar Echoes')).toMatchObject({ attack: 2, health: 2 });
    const g = fight([bm('a', FRAIL_CEL.id, 2, 2, { golden: true, grantedEffects: [GRAFT] } as never)], [foe('f', 10, 100)], { runeStellarEchoes: true });
    expect(gain(g, 'Rune of Stellar Echoes')).toMatchObject({ attack: 2, health: 2 });
  });
  it('without the graft or the flag, nothing is banked', () => {
    const r = fight([bm('a', FRAIL_CEL.id, 1, 1)], [foe('f', 10, 100)], {});
    expect(r.playerStarformGain).toBeUndefined();
  });
});

describe('Rune of the Guiding Star — combat', () => {
  it('a Celestial Echo casts a Star Crash on a living friendly Celestial (a real cast)', () => {
    const r = fight([bm('a', FRAIL_CEL.id, 1, 1, { grantedEffects: [{ on: 'onDeath', do: 'deathrattleBuffStarform', params: { attack: 2, health: 2, fixed: true } }] } as never), bm('c', CEL.id, 0, 400)], [foe('f', 10, 3000)], { runeGuidingStar: true });
    expect(triggers(r.events, 'runeGuidingStar').length).toBeGreaterThanOrEqual(1);
    // Star Crash: +5/+7 on the Celestial it aims at.
    expect(buffsOn(r.events, uid(r, 1)).some((b) => b.attack === 5 && b.health === 7)).toBe(true);
    expect(r.events.some((e) => e.type === 'sc' && e.rune === 'rune_guiding_star')).toBe(true);
    expect(r.playerSpellsCast, 'the cast counts as a spell').toBeGreaterThanOrEqual(1);
  });
  it('the Falling Embers Star Crash bonus folds into the combat cast (+1/+1 → 6/8)', () => {
    const r = fight([bm('a', FRAIL_CEL.id, 1, 1, { grantedEffects: [{ on: 'onDeath', do: 'deathrattleBuffStarform', params: { attack: 2, health: 2, fixed: true } }] } as never), bm('c', CEL.id, 0, 400)], [foe('f', 10, 3000)], { runeGuidingStar: true, starCrashBonus: { attack: 1, health: 1 } });
    expect(buffsOn(r.events, uid(r, 1)).some((b) => b.attack === 6 && b.health === 8)).toBe(true);
  });
  it('a Celestial with no Echo casts nothing', () => {
    const r = fight([bm('a', FRAIL_CEL.id, 1, 1), bm('c', CEL.id, 0, 400)], [foe('f', 10, 3000)], { runeGuidingStar: true });
    expect(triggers(r.events, 'runeGuidingStar')).toHaveLength(0);
  });
});

describe('Rune of the Meteor Storm — combat (owner pick 2026-09-27, fills the Event Horizon slot)', () => {
  const GRAFT = { on: 'onDeath' as const, do: 'deathrattleBuffStarform' as const, params: { attack: 2, health: 2, fixed: true } };
  const board = () => [bm('a', FRAIL_CEL.id, 1, 1, { grantedEffects: [GRAFT] } as never), bm('c', CEL.id, 0, 400), bm('d', SHOUTER.id, 1, 400)];
  it('a Star Crash cast in combat (the Guiding Star) is cast again on a DIFFERENT friendly Celestial, once (no loop)', () => {
    const base = fight(board(), [foe('f', 10, 3000)], { runeGuidingStar: true });
    const r = fight(board(), [foe('f', 10, 3000)], { runeGuidingStar: true, runeMeteorStorm: true });
    const crash = (x: ReturnType<typeof fight>) => x.events.filter((e): e is Buff => e.type === 'buff' && e.attack === 5 && e.health === 7);
    expect(triggers(r.events, 'runeMeteorStorm')).toHaveLength(1);
    expect(r.events.filter((e) => e.type === 'sc' && e.rune === 'rune_meteor_storm')).toHaveLength(1);
    // Each Star Crash lands twice (aimed + random friend): the Guiding Star's cast plus exactly ONE Meteor Storm echo.
    expect(crash(r).length).toBe(crash(base).length + 2);
    expect((r.playerSpellsCast ?? 0) - (base.playerSpellsCast ?? 0), 'the echo is a real cast').toBe(1);
  });
  it('no other friendly Celestial: nothing', () => {
    const r = fight([bm('a', FRAIL_CEL.id, 1, 1, { grantedEffects: [GRAFT] } as never), bm('c', CEL.id, 0, 400)], [foe('f', 10, 3000)], { runeGuidingStar: true, runeMeteorStorm: true });
    expect(triggers(r.events, 'runeMeteorStorm')).toHaveLength(0);
  });
});

