/**
 * SET 3 ARCHIVES, owner 2026-10-23: "archive these dragons from set 3: * gatherer * whisp".
 *
 * Whisp (`d4_whisp`) and Gatherer (`d3_gatherer`) were Set 3 only, so they moved to `cards/archive.ts` and belong to no
 * set. (Whispwarder, `d3_whispwarder`, is a different card and stays.)
 *
 * Pinned here: out of every set's pool and every Set 3 draw (the shop roll, the Spell Cart row), and OLD Set 3 saves,
 * snapshots and combat replays holding either still load and resolve: Whisp still echoes a Whisper cast on a Dragon,
 * Gatherer still gets a random Dragon on Rally.
 */
import { describe, it, expect } from 'vitest';
import { makeRng, simulate } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { createRun, reduce, sideFromSnapshot, type Action, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { fireRallies } from './recruit';
import { rollShop, rollSpellShop } from './shop';
import { snapshotBoard } from './snapshot';

const GONE = ['d4_whisp', 'd3_gatherer'] as const; // Whisp, Gatherer
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const set3 = (seed = 1, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(seed), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: [...SETS.set3.tribes], shop: [], spell: null,
    hand: [], pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
/** A stored run is JSON: round-trip it the way a save does. */
const reload = (s: RunState): RunState => JSON.parse(JSON.stringify(s)) as RunState;
const isDragon = (id: string): boolean => {
  const d = CARD_INDEX[id];
  return !!d && (d.tribe === 'dragon' || d.tribe2 === 'dragon' || !!d.universalTribe);
};
/** A quiet wall, so a fight never kills the board. */
const quiet: BoardSnapshot = { v: 1, wave: 1, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 300, keywords: [] }], seed: 1, origin: 'self' };
/** One full turn: combat, then the next Shop opens (End of Turn, then Start of Turn). */
const turn = (s: RunState): RunState => {
  s = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: { ...quiet, wave: s.wave } } } as RunState;
  for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = reduce(s, a);
  return { ...s, runeforgeOffer: undefined } as RunState;
};
/** Snapshot a board and replay one combat twice: it must resolve and be deterministic. */
const replays = (s: RunState): void => {
  const snap = snapshotBoard(s);
  const side = sideFromSnapshot(snap, 6, poolFor('set3').all.map((c) => c.id));
  const foes = [{ cardId: 'sandbag', attack: 0, health: 200, keywords: [] }] as never;
  const empty = sideFromSnapshot({ ...snap, minions: [] }, 1, []);
  const a = simulate(snap.minions, foes, makeRng(9), CARD_INDEX, side, empty);
  const b = simulate(snap.minions, foes, makeRng(9), CARD_INDEX, side, empty);
  expect(a.events.length).toBeGreaterThan(0);
  expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
};

describe('out of Set 3', () => {
  it('Whisp and Gatherer are archived: in no set at all, and still resolve by id; Whispwarder stays', () => {
    for (const id of GONE) {
      for (const setId of Object.keys(SETS) as SetId[]) expect(poolFor(setId).all.some((c) => c.id === id), `${id} in ${setId}`).toBe(false);
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} in the archive`).toBe(true);
      expect(CARD_INDEX[id], `${id} still resolves`).toBeTruthy();
    }
    expect(CARD_INDEX['d4_whisp']!.name).toBe('Whisp');
    expect(CARD_INDEX['d3_gatherer']!.name).toBe('Gatherer');
    expect(poolFor('set3').buyable.some((c) => c.id === 'd3_whispwarder'), 'Whispwarder is a different card').toBe(true);
  });

  it('a Set 3 shop roll and Spell Cart row never offer either (300 seeds)', () => {
    const gone = new Set<string>(GONE);
    let offered = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = set3(seed);
      rollShop(s);
      offered += s.shop.filter((o) => gone.has(o.cardId)).length;
      const cart = set3(seed);
      rollSpellShop(cart);
      offered += cart.shop.filter((o) => gone.has(o.cardId)).length;
    }
    expect(offered).toBe(0);
  });

  it('a Set 3 Rally Dragon grant never hands out either (Gatherer on an old board, 50 seeds)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = reload(set3(seed, { board: [body('g', 'd3_gatherer')] }));
      fireRallies(s);
      for (const c of s.hand) expect(GONE as readonly string[], c.cardId).not.toContain(c.cardId);
    }
  });
});

describe('old Set 3 saves still load and resolve', () => {
  it('Whisp still echoes a Whisper cast on a Dragon (a full cast on itself)', () => {
    let s = turn(reload(set3(7, { board: [body('t', 'd4_tolan'), body('w', 'd4_whisp')] })));
    const rb = s.hand.find((c) => c.cardId === 'w4_runebind')!;
    expect(rb, 'Tolan granted its Runebind').toBeTruthy();
    const before = s.spellsCast;
    s = reduce(s, { type: 'play', uid: rb.uid, targetUid: 't' } as Action);
    const w = s.board.find((c) => c.uid === 'w')!;
    expect(w.attack).toBeGreaterThan(CARD_INDEX['d4_whisp']!.attack);
    expect(s.spellsCast).toBe(before + 2); // the cast and Whisp's echo
    replays(s);
  });

  it('Gatherer still gets a random Dragon on a Shop-phase Rally', () => {
    const s = reload(set3(8, { board: [body('g', 'd3_gatherer')] }));
    fireRallies(s);
    expect(s.hand).toHaveLength(1);
    expect(isDragon(s.hand[0]!.cardId)).toBe(true);
  });

  it('a snapshot holding Whisp and Gatherer (an old Set 3 opponent board) replays', () => {
    const s = reload(set3(9, { board: [body('w', 'd4_whisp'), body('g', 'd3_gatherer')] }));
    expect(snapshotBoard(s).minions.map((m) => m.cardId)).toEqual(['d4_whisp', 'd3_gatherer']);
    replays(s);
  });
});
