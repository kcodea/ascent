import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, spellAttackBonus, spellHealthBonus, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * Set 2's OWN neutral minions — the five still in the game from the owner's 2026-07-25 roster (Aeon Acolyte
 * and Fatecarver were cut on 2026-07-26) that didn't already exist in set 1.
 * Each needed a brand-new effect primitive, so each gets real coverage rather than a shape assertion.
 */
// Four now: Aeon Acolyte and Fatecarver went 2026-07-26, Oathbound Avenger 2026-07-31 (owner).
const NEW_IDS = ['n2_spellsword', 'n2_bellringer', 'n2_lastlight']; // Tamer removed (owner 2026-08-02)

const bm = (cardId: string, uid: string, attack = 1, health = 1, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });
const card = (uid: string, cardId: string, attack = 1, health = 1): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });

describe('set 2 — its own neutral minions are wired into the set', () => {
  it('all are in set 2 and NOT in set 1', () => {
    const s2 = new Set(poolFor('set2').all.map((c) => c.id));
    const s1 = new Set(poolFor('set1').all.map((c) => c.id));
    for (const id of NEW_IDS) {
      expect(s2.has(id), `${id} in set 2`).toBe(true);
      expect(s1.has(id), `${id} absent from set 1`).toBe(false);
    }
  });

  it('match the roster tier/stats', () => {
    const spec = (id: string): string => { const c = CARD_INDEX[id]!; return `T${c.tier} ${c.attack}/${c.health}`; };
    expect(spec('n2_spellsword')).toBe('T2 3/4');
    expect(spec('n2_bellringer')).toBe('T4 4/6');
    expect(spec('n2_lastlight')).toBe('T3 3/2'); // owner 2026-07-31
  });
});



describe('set 2 — Lastlight', () => {
  // Swept across seeds on purpose: with THREE eligible bodies and two grants, a non-distinct pick only
  // collides on some seeds — the first version of this test passed on seed 3 against a broken implementation.
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('Echo: two OTHER friendly minions gain Ward when it dies (seed %i)', (seed) => {
    // A 1-health Marshal dies to the first swing; the sandbag hits hard enough to kill it outright.
    const r = simulate([
      bm('n2_lastlight', 'LM', 1, 1),
      bm('stray', 'A', 2, 20),
      bm('pup', 'B', 2, 20),
      bm('sandbag', 'C', 2, 20),
    ], [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(seed), CARD_INDEX,
      combatSide({ tier: 5 }), combatSide({ tier: 1 }));

    const shielded = new Set(
      (r.events.filter((e) => e.type === 'shieldUp') as { target: string }[]).map((s) => s.target),
    );
    expect(shielded.size, 'exactly two minions get Ward — distinct picks, not two rolls').toBe(2);
    expect(shielded.has('m0'), 'never itself — it is the one that died').toBe(false);
  });

  it('grants no more Wards than there are eligible bodies', () => {
    // Only ONE other minion alive, so the second grant has nowhere to go rather than double-shielding it.
    const r = simulate([
      bm('n2_lastlight', 'LM', 1, 1),
      bm('stray', 'A', 2, 20),
    ], [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 5 }), combatSide({ tier: 1 }));
    expect(r.events.filter((e) => e.type === 'shieldUp').length).toBe(1);
  });
});


describe('set 2 — Coppercoat Spellsword', () => {
  it('Choose One raises run-wide spell power on the picked axis only', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [card('cs', 'n2_spellsword', 3, 4)] };
    const a0 = spellAttackBonus(s); const h0 = spellHealthBonus(s);
    s = reduce(s, { type: 'play', uid: 'cs' });
    expect(s.chooseOne?.cardId).toBe('n2_spellsword'); // it prompts
    s = reduce(s, { type: 'chooseOne', index: 0 });    // the Attack option
    expect(spellAttackBonus(s) - a0).toBe(1);
    expect(spellHealthBonus(s) - h0).toBe(0);
  });

  it('the Health option raises Health only', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [card('cs', 'n2_spellsword', 3, 4)] };
    const a0 = spellAttackBonus(s); const h0 = spellHealthBonus(s);
    s = reduce(s, { type: 'play', uid: 'cs' });
    s = reduce(s, { type: 'chooseOne', index: 1 });
    expect(spellHealthBonus(s) - h0).toBe(1);
    expect(spellAttackBonus(s) - a0).toBe(0);
  });
});

describe('set 2 — Bellringer Voss', () => {
  /** Run `applyEndOfTurn` n times, returning the state after. */
  const endTurns = (s: RunState, n: number): RunState => {
    let cur = s;
    for (let i = 0; i < n; i++) { const next = { ...cur, hand: [...cur.hand], board: [...cur.board] }; applyEndOfTurn(next); cur = next; }
    return cur;
  };

  it('conjures a plain copy of the LEFT neighbour, every 2 turns', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [card('left', 'stray'), card('bv', 'n2_bellringer', 4, 6)],
      hand: [],
    };
    const after1 = endTurns(s, 1);
    expect(after1.hand.length, 'nothing on turn 1 — the cadence is every 2').toBe(0);
    const after2 = endTurns(s, 2);
    expect(after2.hand.map((c) => c.cardId)).toEqual(['stray']); // the left neighbour, copied
  });

  it('the copy is PLAIN — buffs on the original are not carried', () => {
    const buffed = { ...card('left', 'stray'), attack: 9, health: 9 };
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [buffed, card('bv', 'n2_bellringer', 4, 6)],
      hand: [],
    };
    const after = endTurns(s, 2);
    const copy = after.hand.find((c) => c.cardId === 'stray')!;
    const base = CARD_INDEX['stray']!;
    expect([copy.attack, copy.health]).toEqual([base.attack, base.health]);
    expect(copy.golden).toBe(false);
  });

  it('does nothing with no minion to its left', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [card('bv', 'n2_bellringer', 4, 6), card('right', 'stray')],
      hand: [],
    };
    expect(endTurns(s, 2).hand.length).toBe(0); // left-most has no left neighbour
  });
});
