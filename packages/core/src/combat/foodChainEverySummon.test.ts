import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type Keyword } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-SUMMON-RECLAIM-01 — Rune of the Food Chain ("The first minion you summon in combat gains the stats of your
 * left-most Demon") fires for EVERY way a minion is summoned mid-fight, on both sides.
 *
 * Owner bug 2026-10-16: "rune of the food chain should work with soren's hero power resummon, and anything that
 * summons a minion in combat basically." Soren's Reclaim brought its copy back through `flushResummons`, which
 * inserted the body directly and skipped the shared "summoned in combat" grant helper, so the rune never saw it.
 */
type Summon = Extract<CombatEvent, { type: 'summon' }>;
type Reborn = Extract<CombatEvent, { type: 'reborn' }>;
type Side = 'player' | 'enemy';
const DEMON_HP = 77; // a 0/77 Demon: its Health is unmistakable on the body that eats it
const demon = (): BoardMinion => ({ cardId: 'dm_clerk', attack: 0, health: DEMON_HP, keywords: [] } as unknown as BoardMinion);
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const TRIBES = ['demon', 'mech', 'dragon', 'undead', 'spirit', 'beast'];

/** Run `mine` as the given side against a slow wall; the rune (when `rune`) sits on `mine`'s side. */
function fight(mine: BoardMinion[], side: Side, rune: boolean, extra: object = {}, seed = 3) {
  const own = combatSide({ tier: 6, tribes: TRIBES, questMods: rune ? { runeFoodChain: true } : {}, ...extra });
  const wall = [foe(1, 500)];
  return side === 'player'
    ? simulate(mine, wall, makeRng(seed), CARD_INDEX, own, combatSide({ tier: 6 }))
    : simulate(wall, mine, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), own);
}
const summons = (evs: CombatEvent[], side: Side, cardId: string): Summon[] =>
  evs.filter((e): e is Summon => e.type === 'summon' && e.side === side && e.minion.cardId === cardId);
const pulses = (evs: CombatEvent[], side: Side) =>
  evs.filter((e) => e.type === 'questTrigger' && e.flag === 'runeFoodChain' && e.side === side);

describe('R-SUMMON-RECLAIM-01: Soren\'s Reclaim resummon is a combat summon (Food Chain feeds it)', () => {
  for (const side of ['player', 'enemy'] as const) {
    it(`the Reclaimed copy eats the left-most Demon (${side} side)`, () => {
      const board = [demon(), bm('sandbag', { attack: 2, health: 2, resummon: true })];
      const r = fight(board, side, true);
      const copies = summons(r.events, side, 'sandbag');
      expect(copies, 'the Reclaim copy returns').toHaveLength(1);
      expect(copies[0]!.minion.health, 'the copy lands with the Demon\'s Health on its first frame').toBe(2 + DEMON_HP);
      // The rune pulses once, on the copy's own beat (before the summon event that shows the fed body).
      const p = pulses(r.events, side);
      expect(p).toHaveLength(1);
      expect(r.events.indexOf(p[0]!)).toBeLessThan(r.events.indexOf(copies[0]!));
      // Control: no rune, plain copy.
      expect(summons(fight(board, side, false).events, side, 'sandbag')[0]!.minion.health).toBe(2);
    });
  }

  it('one chance per combat: a Reclaim that ate it leaves a later Echo summon plain', () => {
    // The Reclaim lands first (Start of Combat); the Nanon dies later and its Nanobot arrives without the Demon.
    const board = [demon(), bm('sandbag', { attack: 2, health: 2, resummon: true }), bm('nanon', { attack: 1, health: 1 })];
    const r = fight(board, 'player', true, {}, 5);
    expect(summons(r.events, 'player', 'sandbag')[0]!.minion.health).toBe(2 + DEMON_HP);
    const bots = summons(r.events, 'player', 'nanobot');
    expect(bots.length, 'the Nanon must die for this to mean anything').toBeGreaterThanOrEqual(1);
    expect(bots.every((b) => b.minion.health < DEMON_HP)).toBe(true);
    expect(pulses(r.events, 'player')).toHaveLength(1);
  });

  it('is deterministic: the same seed replays the same log', () => {
    const board = [demon(), bm('sandbag', { attack: 2, health: 2, resummon: true })];
    expect(JSON.stringify(fight(board, 'player', true, {}, 9).events)).toBe(JSON.stringify(fight(board, 'player', true, {}, 9).events));
  });
});

describe('Food Chain on the other combat summon sources, both sides (each was already on the shared seam)', () => {
  const handMinion = (uid: string, cardId: string, over: Partial<{ attack: number; health: number }> = {}) => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords] as Keyword[], golden: false, ...over };
  };
  for (const side of ['player', 'enemy'] as const) {
    it(`an Echo (Deathrattle) token summon (${side})`, () => {
      const board = [demon(), bm('nanon', { attack: 1, health: 1 })];
      const bot = summons(fight(board, side, true).events, side, 'nanobot')[0];
      expect(bot).toBeDefined();
      expect(bot!.minion.health - CARD_INDEX['nanobot']!.health).toBeGreaterThanOrEqual(DEMON_HP - 5);
      const bare = summons(fight(board, side, false).events, side, 'nanobot')[0]!;
      expect(bare.minion.health).toBe(CARD_INDEX['nanobot']!.health);
    });

    it(`a Rise return (${side})`, () => {
      const board = [demon(), bm('u3_poochy')];
      const rb = fight(board, side, true).events.filter((e): e is Reborn => e.type === 'reborn');
      expect(rb).toHaveLength(1);
      expect(rb[0]!.hp).toBeGreaterThanOrEqual(DEMON_HP);
      const bare = fight(board, side, false).events.filter((e): e is Reborn => e.type === 'reborn');
      expect(bare[0]!.hp).toBeLessThan(DEMON_HP);
    });

    it(`a Spirit hand-summon (${side})`, () => {
      const hand = [handMinion('h1', 'sandbag', { attack: 4, health: 4 })];
      const board = [demon(), bm('sp3_dreamtide', { attack: 1, health: 1 })];
      const fed = summons(fight(board, side, true, { handMinions: hand }).events, side, 'sandbag')[0];
      expect(fed, 'Tide Caller\'s Echo summons the hand minion').toBeDefined();
      expect(fed!.minion.health - 4).toBeGreaterThanOrEqual(DEMON_HP - 5);
      expect(summons(fight(board, side, false, { handMinions: hand }).events, side, 'sandbag')[0]!.minion.health).toBe(4);
    });
  }
});
