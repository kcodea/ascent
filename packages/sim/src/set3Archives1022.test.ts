/**
 * SET 3 ARCHIVES, owner 2026-10-22: "archive stellar chorus from set 3" and "archive shredder and jumpstart jules".
 *
 * - Stellar Chorus leaves Set 3 only. Its def stays in `SET3_SPELLS` because Set 4 still shares it by reference.
 * - Shredder and Jumpstart Jules were Set 3 only, so they moved to `cards/archive.ts` and belong to no set.
 *
 * Pinned here: out of every Set 3 draw (the pool, `runSpells`, the shop roll, the Spell Cart row), Stellar Chorus
 * still in Set 4, and OLD Set 3 saves, snapshots and combat replays holding any of the three still load and resolve.
 */
import { describe, it, expect } from 'vitest';
import { makeRng, simulate } from '@game/core';
import { ARCHIVED_CARDS, CARD_INDEX, SETS, poolFor, type SetId } from '@game/content';
import { createRun, reduce, sideFromSnapshot, type Action, type BoardCard, type RunState } from './index';
import { runSpells } from './spellPool';
import { rollShop, rollSpellShop } from './shop';
import { snapshotBoard } from './snapshot';
import { equipmentUsesLeft } from './equipment';

const CHORUS = 'stellarchorus';
const MINIONS = ['n3_shredder', 'n3_charger'] as const; // Shredder, Jumpstart Jules
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const set3 = (seed = 1, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(seed), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: [...SETS.set3.tribes], shop: [], spell: null,
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
/** A stored run is JSON: round-trip it the way a save does. */
const reload = (s: RunState): RunState => JSON.parse(JSON.stringify(s)) as RunState;
/** One full turn: combat, then the next Shop opens (End of Turn, then Start of Turn). */
const turn = (s: RunState): RunState => {
  for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = reduce(s, a);
  return s;
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
  it('Stellar Chorus is in no Set 3 pool, still resolves, and Set 4 still draws it', () => {
    const p3 = poolFor('set3');
    expect(p3.all.some((c) => c.id === CHORUS), 'out of set 3').toBe(false);
    expect(runSpells({ setId: 'set3', tribes: [...SETS.set3.tribes] }).some((c) => c.id === CHORUS)).toBe(false);
    expect(poolFor('set4').spells.some((c) => c.id === CHORUS), 'still a set-4 shared spell').toBe(true);
    expect(CARD_INDEX[CHORUS], 'still resolves by id').toBeTruthy();
  });

  it('Shredder and Jumpstart Jules are archived: in no set at all, and still resolve by id', () => {
    for (const id of MINIONS) {
      for (const setId of Object.keys(SETS) as SetId[]) expect(poolFor(setId).all.some((c) => c.id === id), `${id} in ${setId}`).toBe(false);
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} in the archive`).toBe(true);
      expect(CARD_INDEX[id], `${id} still resolves`).toBeTruthy();
    }
    expect(CARD_INDEX['n3_charger']!.name).toBe('Jumpstart Jules');
    expect(CARD_INDEX['n3_shredder']!.name).toBe('Shredder');
  });

  it('a Set 3 shop roll and Spell Cart row never offer any of the three (300 seeds)', () => {
    const gone = new Set<string>([CHORUS, ...MINIONS]);
    let offered = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = set3(seed);
      rollShop(s);
      offered += s.shop.filter((o) => gone.has(o.cardId)).length + (s.spell && gone.has(s.spell.cardId) ? 1 : 0);
      const cart = set3(seed);
      rollSpellShop(cart);
      offered += cart.shop.filter((o) => gone.has(o.cardId)).length;
    }
    expect(offered).toBe(0);
  });
});

describe('old Set 3 saves still load and resolve', () => {
  it('Stellar Chorus in hand still casts, and the buffed board snapshots and replays', () => {
    let s = reload(set3(5, { board: [body('t', 'stray')], hand: [spell('sp', CHORUS)], spellsThisTurn: 1 }));
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 't' } as Action);
    // +2/+2, improved by +3/+3 for the one spell already cast this turn = +5/+5.
    const t = s.board.find((c) => c.uid === 't')!;
    expect([t.attack, t.health]).toEqual([CARD_INDEX['stray']!.attack + 5, CARD_INDEX['stray']!.health + 5]);
    expect(s.hand.some((c) => c.uid === 'sp'), 'the spell was cast').toBe(false);
    expect(t.buffs?.some((b) => b.source === 'Stellar Chorus')).toBe(true);
    replays(s);
  });

  it('Stellar Chorus sitting in an old Shop can still be bought', () => {
    const s = reduce(reload(set3(6, { shop: [{ uid: 'o1', cardId: CHORUS }], hand: [] })), { type: 'buy', uid: 'o1' } as Action);
    expect(s.hand.some((c) => c.cardId === CHORUS)).toBe(true);
  });

  it('Jumpstart Jules still grants its Start of Turn charge, and Shredder still pays out at End of Turn', () => {
    // Frank holds an Equipment (Bloodpot). Jules on board: next turn has one more charge than without him.
    const plain = equipmentUsesLeft(turn(reload(set3(7, { hand: [], board: [body('f', 'e3_frank', { health: 400 })] }))));
    const jules = turn(reload(set3(7, { hand: [], board: [body('j', 'n3_charger'), body('f', 'e3_frank', { health: 400 })] })));
    expect(jules.phase).toBe('recruit');
    expect(equipmentUsesLeft(jules)).toBe(plain + 1);
    // Shredder with Frank's Equipment unused this turn: End of Turn gives every minion +2/+3.
    let s = reload(set3(8, { hand: [body('f', 'e3_frank', { health: 400 })], board: [body('sh', 'n3_shredder')] }));
    s = reduce(s, { type: 'play', uid: 'f', toIndex: 0 } as Action);
    const before = s.board.map((c) => [c.attack, c.health]);
    s = turn(s);
    const after = s.board.map((c) => [c.attack, c.health]);
    expect(after).toEqual(before.map(([a, h]) => [a! + 2, h! + 3]));
    replays(s);
  });

  it('a snapshot holding Shredder and Jules (an old Set 3 opponent board) replays', () => {
    const s = reload(set3(9, { board: [body('sh', 'n3_shredder'), body('j', 'n3_charger')] }));
    expect(snapshotBoard(s).minions.map((m) => m.cardId)).toEqual(['n3_shredder', 'n3_charger']);
    replays(s);
  });
});
