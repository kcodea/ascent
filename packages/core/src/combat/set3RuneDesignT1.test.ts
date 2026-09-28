import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, soulFurnaceHealth, type BoardMinion, type CardDef, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 RUNE DESIGN PASS, TRANCHE 1 (owner 2026-09-27): the COMBAT half of the Undead runes. Every fight is a real
 * `simulate()`; the Shop half (and the settle carry-back through the real reducer) is
 * `packages/sim/src/set3RuneDesignT1.test.ts`.
 *
 *   · Rune of the Wake: an Undead Echo TRIGGER raises the Undead Aura +1 Attack (live + carried back).
 *   · Rune of the Soul Toll: Avenge (4) raises the Undead Aura +1 Attack; Rune of Fury doubles it.
 *   · Rune of the Second Wind: a risen body gains +2/+2 permanently (carried back as a permanent gain).
 *   · Rune of the Restless: a risen body's Echo triggers again.
 *   · Rune of the Soul Furnace: a mid-fight Aura Attack rise re-derives the Health term live, never carried back.
 */
const probe = (id: string, over: Partial<CardDef>): CardDef => ({ id, name: id, tribe: 'undead', tier: 1, attack: 1, health: 1, keywords: [], effects: [], text: '', ...over });
const ECHO_UNDEAD = probe('dbg_t1c_echo', { effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } }] });
const ECHO_NEUTRAL = probe('dbg_t1c_echo_n', { tribe: 'neutral', effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } }] });
const RISER = probe('dbg_t1c_rise', { attack: 2, health: 2, keywords: ['R'] });
const RISE_ECHO = probe('dbg_t1c_rise_echo', { attack: 2, health: 2, keywords: ['R'], effects: [{ on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } }] });
const WALL = probe('dbg_t1c_wall', { attack: 0, health: 500 });
const CARDS: Record<string, CardDef> = { ...CARD_INDEX };
for (const c of [ECHO_UNDEAD, ECHO_NEUTRAL, RISER, RISE_ECHO, WALL]) CARDS[c.id] = c;

const bm = (uid: string, cardId: string, attack: number, health: number, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], ...over } as unknown as BoardMinion);
const foe = (uid: string, attack: number, health: number): BoardMinion => bm(uid, 'sandbag', attack, health);
const fight = (mine: BoardMinion[], theirs: BoardMinion[], mods: object = {}, extra: object = {}, seed = 7) =>
  simulate(mine, theirs, makeRng(seed), CARDS, combatSide({ tier: 6, tribes: ['kobold', 'undead', 'dwarf', 'spirit', 'celestial'], questMods: mods, ...extra }), combatSide({ tier: 6 }));
const triggers = (evs: readonly CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffsOn = (evs: readonly CombatEvent[], target: string) => evs.filter((e): e is Buff => e.type === 'buff' && e.target === target);
/** Echo triggers that fired from a given combat uid (the forced-Echo `rally` cue, or the body's death). */
const uid = (r: ReturnType<typeof fight>, i: number) => r.initial.player[i]!.uid;

describe('Rune of the Wake — combat', () => {
  it('an Undead Echo trigger raises the Undead Aura +1 Attack: the living Undead feel it now and the gain is carried back', () => {
    const r = fight([bm('e', ECHO_UNDEAD.id, 1, 1), bm('w', WALL.id, 0, 500)], [foe('f', 5, 900)], { runeWake: true });
    expect(triggers(r.events, 'runeWake')).toHaveLength(1);
    expect(r.playerUndeadAuraGain?.attack).toBe(1);
    // The Undead wall felt the +1 Attack live (beside the Echo's own +1/+1).
    expect(buffsOn(r.events, uid(r, 1)).some((b) => b.attack === 1 && b.health === 0)).toBe(true);
  });
  it('a non-Undead Echo does nothing; two copies pay +2', () => {
    const n = fight([bm('e', ECHO_NEUTRAL.id, 1, 1), bm('w', WALL.id, 0, 500)], [foe('f', 5, 900)], { runeWake: true });
    expect(triggers(n.events, 'runeWake')).toHaveLength(0);
    expect(n.playerUndeadAuraGain?.attack ?? 0).toBe(0);
    const two = fight([bm('e', ECHO_UNDEAD.id, 1, 1), bm('w', WALL.id, 0, 500)], [foe('f', 5, 900)], { runeWake: true, flagCopies: { runeWake: 2 } });
    expect(two.playerUndeadAuraGain?.attack).toBe(2);
  });
});

describe('Rune of the Soul Toll — combat', () => {
  const four = () => [bm('a', ECHO_NEUTRAL.id, 1, 1), bm('b', ECHO_NEUTRAL.id, 1, 1), bm('c', ECHO_NEUTRAL.id, 1, 1), bm('d', ECHO_NEUTRAL.id, 1, 1), bm('w', WALL.id, 0, 5000)];
  it('Avenge (4): the fourth friendly death raises the Undead Aura +1 Attack', () => {
    const r = fight(four(), [foe('f', 50, 5000)], { runeSoulToll: true });
    expect(triggers(r.events, 'runeSoulToll').length).toBeGreaterThanOrEqual(1);
    expect(r.playerUndeadAuraGain?.attack).toBe(triggers(r.events, 'runeSoulToll').length);
  });
  it('Rune of Fury doubles it (an Avenge)', () => {
    const base = fight(four(), [foe('f', 50, 5000)], { runeSoulToll: true });
    const fury = fight(four(), [foe('f', 50, 5000)], { runeSoulToll: true, runeFury: true });
    expect(fury.playerUndeadAuraGain?.attack).toBe(2 * (base.playerUndeadAuraGain?.attack ?? 0));
  });
});

describe('Rune of the Second Wind — combat', () => {
  it('a risen body gains +2/+2 and the gain is permanent (carried back on its board card)', () => {
    const r = fight([bm('r', RISER.id, 2, 2), bm('w', WALL.id, 0, 500)], [foe('f', 3, 900)], { runeSecondWind: true });
    expect(r.events.some((e) => e.type === 'reborn')).toBe(true);
    expect(triggers(r.events, 'runeSecondWind')).toHaveLength(1);
    expect(buffsOn(r.events, uid(r, 0)).some((b) => b.attack === 2 && b.health === 2)).toBe(true);
    const perma = (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'r');
    expect(perma.reduce((n, p) => n + p.attack, 0)).toBe(2);
    expect(perma.reduce((n, p) => n + p.health, 0)).toBe(2);
  });
  it('without the rune the Rise returns printed and nothing carries back', () => {
    const r = fight([bm('r', RISER.id, 2, 2), bm('w', WALL.id, 0, 500)], [foe('f', 3, 900)], {});
    expect((r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'r')).toHaveLength(0);
  });
});

describe('Rune of the Restless — combat', () => {
  it('a risen body triggers its Echo again: the wall gets the Echo twice (death + Rise)', () => {
    const count = (mods: object) => {
      const r = fight([bm('r', RISE_ECHO.id, 2, 2), bm('w', WALL.id, 0, 500)], [foe('f', 3, 900)], mods);
      const firstRise = r.events.findIndex((e) => e.type === 'reborn');
      // The window from the first death to just after the first Rise's follow-ups (before the risen body dies again).
      const nextDeath = r.events.findIndex((e, i) => i > firstRise && e.type === 'death' && e.side === 'player');
      const win = r.events.slice(0, nextDeath < 0 ? undefined : nextDeath);
      return { r, echoes: buffsOn(win, uid(r, 1)).filter((b) => b.attack === 1 && b.health === 1).length };
    };
    expect(count({}).echoes).toBe(1);
    const withRune = count({ runeRestless: true });
    expect(triggers(withRune.r.events, 'runeRestless').length).toBeGreaterThanOrEqual(1);
    expect(withRune.echoes).toBe(2);
  });
});

describe('Rune of the Soul Furnace — combat', () => {
  it('a mid-fight Aura Attack rise re-derives the Health term live; the delta is never carried back', () => {
    // Seeded like the run seeds it: Aura Attack 9, Health term ceil(9/2) = 5 already inside undeadHp.
    const seeded = { undeadAtk: 9, undeadHp: soulFurnaceHealth(9, 1) };
    const r = fight([bm('e', ECHO_UNDEAD.id, 1, 1), bm('w', WALL.id, 0, 500)], [foe('f', 5, 900)], { runeWake: true, runeSoulFurnace: true }, seeded);
    // The Wake takes the Aura to 10: ceil(10/2) = 5, no change. A second Wake (two copies) takes it to 11 → 6.
    expect(buffsOn(r.events, uid(r, 1)).filter((b) => b.health > 0 && b.attack === 0)).toHaveLength(0);
    const r2 = fight([bm('e', ECHO_UNDEAD.id, 1, 1), bm('w', WALL.id, 0, 500)], [foe('f', 5, 900)], { runeWake: true, runeSoulFurnace: true, flagCopies: { runeWake: 2 } }, seeded);
    expect(buffsOn(r2.events, uid(r2, 1)).some((b) => b.attack === 0 && b.health === 1)).toBe(true);
    expect(r2.playerUndeadAuraGain?.attack).toBe(2);
    expect(r2.playerUndeadAuraGain?.health ?? 0, 'the derived term is the run\'s to re-derive, not a carry-back').toBe(0);
  });
  it('without the rune the Aura rise gives no Health', () => {
    const r = fight([bm('e', ECHO_UNDEAD.id, 1, 1), bm('w', WALL.id, 0, 500)], [foe('f', 5, 900)], { runeWake: true, flagCopies: { runeWake: 2 } }, { undeadAtk: 9 });
    expect(buffsOn(r.events, uid(r, 1)).some((b) => b.attack === 0 && b.health > 0)).toBe(false);
  });
});
