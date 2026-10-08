import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-FOODCHAIN-LANDED-01 — Rune of the Food Chain ("The first minion you summon in combat gains the stats of your
 * left-most Demon") is spent only by the first summon that actually LANDS on the board.
 *
 * Owner ruling 2026-10-08: "this should only work on first actual summon on board, not an overflow". A summon lost
 * to the 7-slot cap used to spend the one chance, so the first body that really landed came in plain.
 */
type Summon = Extract<CombatEvent, { type: 'summon' }>;
const DEMON_HP = 77; // a 0/77 Demon: its stats are unmistakable on the body that eats them
/**
 * A FULL 7-wide board: Deathsayer's Rally fires the left-most Deathrattle (the summoner, still alive) while every
 * slot is taken, so those first summons all overflow. The summoner then dies, and its Deathrattle lands ONE body
 * in the freed slot: that is the first ACTUAL summon.
 */
const board = (summoner: BoardMinion): BoardMinion[] => [
  { cardId: 'deathsayer', attack: 3, health: 50 }, summoner, { cardId: 'dm_clerk', attack: 0, health: DEMON_HP },
  ...Array.from({ length: 4 }, () => ({ cardId: 'sandbag', attack: 0, health: 100 })),
].map((m) => ({ keywords: [], ...m })) as unknown as BoardMinion[];
const fight = (summoner: BoardMinion, mods: object, seed = 5) =>
  simulate(board(summoner), [{ cardId: 'omen', attack: 10, health: 400, keywords: [] } as unknown as BoardMinion], makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['demon', 'mech', 'dragon'], questMods: mods }), combatSide({ tier: 6 }));
const landed = (r: ReturnType<typeof simulate>, cardId: string): Summon[] =>
  r.events.filter((e): e is Summon => e.type === 'summon' && e.side === 'player' && e.minion.cardId === cardId);

describe('R-FOODCHAIN-LANDED-01: Rune of the Food Chain feeds the first summon that LANDS', () => {
  it('an inline overflow (full board) does not spend it; the first landed Nanobot eats the Demon', () => {
    const nanon = { cardId: 'nanon', attack: 1, health: 1 } as unknown as BoardMinion;
    const r = fight(nanon, { runeFoodChain: true });
    const bots = landed(r, 'nanobot');
    expect(bots.length, 'the Nanon death lands one Nanobot').toBeGreaterThanOrEqual(1);
    const base = CARD_INDEX['nanobot']!.health;
    expect(bots[0]!.minion.health - base, 'the first LANDED body gains the Demon\'s Health').toBeGreaterThanOrEqual(DEMON_HP);
    // Control: without the rune the same Nanobot lands plain.
    const bare = landed(fight(nanon, {}), 'nanobot');
    expect(bare[0]!.minion.health).toBeLessThan(DEMON_HP);
  });

  it('a DEFERRED (attack-on-summon) body that took it and then overflowed hands it back', () => {
    // A golden Twilight Whelp: the Rally queues two Whelps on a full board (both overflow when they land), then its
    // real death lands one Whelp in the freed slot. That Whelp is the first actual summon.
    const tw = { cardId: 'twilightwhelp', attack: 1, health: 1, golden: true } as unknown as BoardMinion;
    const r = fight(tw, { runeFoodChain: true });
    const whelps = landed(r, 'whelpling');
    expect(whelps.length).toBeGreaterThanOrEqual(1);
    expect(whelps[0]!.minion.health - CARD_INDEX['whelpling']!.health).toBe(DEMON_HP);
    expect(whelps.slice(1).every((w) => w.minion.health < DEMON_HP), 'only the first landed body is fed').toBe(true);
  });

  it('still ONE chance per combat: later landed summons get nothing', () => {
    const nanon = { cardId: 'nanon', attack: 1, health: 1 } as unknown as BoardMinion;
    const fed = landed(fight(nanon, { runeFoodChain: true }), 'nanobot').filter((b) => b.minion.health >= DEMON_HP);
    expect(fed.length).toBe(1);
  });

  it('is deterministic: the same seed replays the same log', () => {
    const tw = { cardId: 'twilightwhelp', attack: 1, health: 1, golden: true } as unknown as BoardMinion;
    expect(JSON.stringify(fight(tw, { runeFoodChain: true }, 9).events)).toBe(JSON.stringify(fight(tw, { runeFoodChain: true }, 9).events));
  });
});
