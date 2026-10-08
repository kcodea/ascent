/**
 * R-UNDERTOW-LANDED-01 at the run level (owner bug 2026-10-08: "rune of the undertow needs to work every round, i
 * think it's only working for 4 total uses"). Drives REAL recruit → combat → settle loops through the reducer, for
 * the player's own run and for a served snapshot that holds the rune, and checks the stacking rule.
 */
import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type RunState } from './state';
import { questCombatMods, reduce } from './reducer';
import type { BoardCard, BoardSnapshot } from './index';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Two 1/1 Nanons + five tanky Mechs: a full board where each Nanon death lands ONE Nanobot and overflows four. */
const overflowBoard = (): BoardCard[] => [
  card('n1', 'nanon', { attack: 1, health: 1 }), card('n2', 'nanon', { attack: 1, health: 1 }),
  ...Array.from({ length: 5 }, (_, i) => card(`d${i}`, 'drone', { attack: 1, health: 500 })),
];
const snap = (wave: number, minions: BoardSnapshot['minions'], questMods: BoardSnapshot['questMods'] = undefined): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: ['mech'], threat: 'glass', power: 500,
  minions, seed: 1, origin: 'self', ...(questMods ? { questMods } : {}),
});
const wall = (wave: number) => snap(wave, [{ cardId: 'sandbag', attack: 5, health: 3000, keywords: [] }]);
type Summon = Extract<CombatEvent, { type: 'summon' }>;
const nanobots = (s: RunState, side: 'player' | 'enemy') =>
  (s.lastCombat!.events as CombatEvent[]).filter((e): e is Summon => e.type === 'summon' && e.side === side && e.minion.cardId === 'nanobot');

function withUndertow(copies = 1): RunState {
  let s: RunState = { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 99 };
  for (let i = 0; i < copies; i++) s = reduce({ ...s, phase: 'recruit', runeforgeOffer: ['rune_undertow'] }, { type: 'buyRune', index: 0 });
  return s;
}

describe('R-UNDERTOW-LANDED-01: Rune of the Undertow works every round of a run', () => {
  it('player: three consecutive combats each Ward the Nanobots that land', () => {
    let s = withUndertow();
    for (let round = 0; round < 3; round++) {
      s = reduce({ ...s, phase: 'recruit', board: overflowBoard(), servedBoards: { [s.wave]: wall(s.wave) } }, { type: 'faceOmen' });
      const bots = nanobots(s, 'player');
      expect(bots.length, `round ${round}: Nanobots landed`).toBeGreaterThanOrEqual(2);
      expect(bots.slice(0, 4).every((b) => b.minion.keywords.includes('DS')), `round ${round}: every landed Nanobot (up to 4) is Warded`).toBe(true);
      s = reduce(s, { type: 'resolveCombat' });
      expect(s.questFlags?.runeUndertow, 'the run keeps the full budget').toBe(4);
    }
  });

  it('enemy: a served snapshot holding the rune gets a fresh 4 in every fight it is served', () => {
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 99 };
    const foeBoard = overflowBoard().map(({ cardId, attack, health, keywords }) => ({ cardId, attack, health, keywords }));
    for (let round = 0; round < 3; round++) {
      const served = snap(s.wave, foeBoard as BoardSnapshot['minions'], { runeUndertow: 4 });
      s = reduce({ ...s, phase: 'recruit', board: [card('w', 'sandbag', { attack: 5, health: 3000 })], servedBoards: { [s.wave]: served } }, { type: 'faceOmen' });
      const bots = nanobots(s, 'enemy');
      expect(bots.length, `round ${round}`).toBeGreaterThanOrEqual(2);
      expect(bots.slice(0, 4).every((b) => b.minion.keywords.includes('DS')), `round ${round}`).toBe(true);
      expect(served.questMods, 'the served snapshot is never spent').toEqual({ runeUndertow: 4 });
      s = reduce(s, { type: 'resolveCombat' });
    }
  });

  it('stacking: a second copy adds its 4 (budget 8), and combat reads the summed budget', () => {
    const one = withUndertow(1);
    const two = withUndertow(2);
    expect(one.questFlags?.runeUndertow).toBe(4);
    expect(two.questFlags?.runeUndertow).toBe(8);
    expect(questCombatMods(two).runeUndertow).toBe(8);
  });

  it('is deterministic: the same run replays the same fight', () => {
    const go = () => reduce({ ...withUndertow(), board: overflowBoard(), servedBoards: { 7: wall(7) } }, { type: 'faceOmen' });
    expect(JSON.stringify(go().lastCombat!.events)).toBe(JSON.stringify(go().lastCombat!.events));
  });
});
