import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, spellAttackBonus, spellHealthBonus, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * Set 2's OWN neutral minions — the seven from the owner's 2026-07-25 roster that didn't already exist in set 1.
 * Six of them needed a brand-new effect primitive, so each gets real coverage rather than a shape assertion.
 */
const NEW_IDS = ['n2_tamer', 'n2_spellsword', 'n2_gravelight', 'n2_oathbound', 'n2_bellringer', 'n2_lastlight', 'n2_fatecarver'];

const bm = (cardId: string, uid: string, attack = 1, health = 1, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });
const card = (uid: string, cardId: string, attack = 1, health = 1): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });

describe('set 2 — its own neutral minions are wired into the set', () => {
  it('all seven are in set 2 and NOT in set 1', () => {
    const s2 = new Set(poolFor('set2').all.map((c) => c.id));
    const s1 = new Set(poolFor('set1').all.map((c) => c.id));
    for (const id of NEW_IDS) {
      expect(s2.has(id), `${id} in set 2`).toBe(true);
      expect(s1.has(id), `${id} absent from set 1`).toBe(false);
    }
  });

  it('match the roster tier/stats', () => {
    const spec = (id: string): string => { const c = CARD_INDEX[id]!; return `T${c.tier} ${c.attack}/${c.health}`; };
    expect(spec('n2_tamer')).toBe('T1 1/1');
    expect(spec('n2_spellsword')).toBe('T2 3/4');
    expect(spec('n2_gravelight')).toBe('T2 2/2');
    expect(spec('n2_oathbound')).toBe('T3 2/5');
    expect(spec('n2_bellringer')).toBe('T4 4/6');
    expect(spec('n2_lastlight')).toBe('T5 5/7');
    expect(spec('n2_fatecarver')).toBe('T6 5/10');
  });
});

describe('set 2 — Tamer', () => {
  it('Echo summons a 3/3 Whelp that attacks immediately', () => {
    const r = simulate([bm('n2_tamer', 'T', 1, 1)], [{ cardId: 'sandbag', attack: 5, health: 400 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 1 }));
    const summons = r.events.filter((e) => e.type === 'summon') as { minion: { cardId: string; attack: number; health: number } }[];
    expect(summons.length).toBe(1);
    expect(summons[0]!.minion.cardId).toBe('n2_whelp');
    expect([summons[0]!.minion.attack, summons[0]!.minion.health]).toEqual([3, 3]);
    // `attackOnSummon` on the token means it swings out of turn order: the Tamer was the only body and it just
    // died, so any attack AFTER the summon can only be the Whelp's.
    const summonIdx = r.events.findIndex((e) => e.type === 'summon');
    expect(r.events.slice(summonIdx).some((e) => e.type === 'attack')).toBe(true);
  });
});

describe('set 2 — Gravelight Acolyte', () => {
  it('Echo summons a random TIER 1 minion', () => {
    const r = simulate([bm('n2_gravelight', 'G', 2, 1)], [{ cardId: 'sandbag', attack: 5, health: 400 }],
      makeRng(7), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 1 }));
    // Assert the FIRST summon, not the count: the roll can legitimately CHAIN (it drew Tamer here, whose own
    // Echo then summons a Whelp), so a total-count assertion would fail for the right reasons.
    const summons = r.events.filter((e) => e.type === 'summon') as { minion: { cardId: string } }[];
    expect(summons.length).toBeGreaterThan(0);
    const def = CARD_INDEX[summons[0]!.minion.cardId]!;
    expect(def.tier).toBe(1);
    expect(def.token).not.toBe(true); // a real shop minion, not a token
  });
});

describe('set 2 — Oathbound Avenger', () => {
  it('Avenge (3) gives a random friendly +1/+3 AND Ward', () => {
    // Three friendly deaths are needed, so pad the board with fodder the enemy can chew through.
    const r = simulate([
      bm('n2_oathbound', 'OA', 2, 40),
      bm('stray', 'F1', 1, 1), bm('pup', 'F2', 1, 1), bm('babycub', 'F3', 1, 1),
    ], [{ cardId: 'sandbag', attack: 20, health: 400 }], makeRng(5), CARD_INDEX,
      combatSide({ tier: 3 }), combatSide({ tier: 1 }));
    const buffs = r.events.filter((e) => {
      const b = e as { type: string; attack?: number; health?: number };
      return b.type === 'buff' && b.attack === 1 && b.health === 3;
    });
    expect(buffs.length).toBeGreaterThan(0);          // the Avenge paid
    expect(r.events.some((e) => e.type === 'shieldUp')).toBe(true); // …and granted Ward
  });
});

describe('set 2 — Lastlight Marshal', () => {
  it('Start of Combat: left-most gains Flurry, right-most gains Ward', () => {
    const r = simulate([
      bm('stray', 'L', 2, 20),
      bm('n2_lastlight', 'LM', 5, 20),
      bm('pup', 'R', 2, 20),
    ], [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 5 }), combatSide({ tier: 1 }));
    // Ward shows as a shieldUp on the RIGHT-most (m2).
    const shields = r.events.filter((e) => e.type === 'shieldUp') as { target: string }[];
    expect(shields.some((s) => s.target === 'm2')).toBe(true);
    // Flurry on the LEFT-most means it strikes twice per turn — more attacks from m0 than from the others.
    const attacksBy = (uid: string): number =>
      r.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === uid).length;
    expect(attacksBy('m0')).toBeGreaterThan(attacksBy('m1'));
  });
});

describe('set 2 — Fatecarver', () => {
  it('doubles the stats of a minion summoned in combat', () => {
    // The Tamer's Whelp lands at 3/3; with Fatecarver out it should be buffed by another +3/+3.
    const r = simulate([
      bm('n2_fatecarver', 'FC', 5, 40),
      bm('n2_tamer', 'T', 1, 1),
    ], [{ cardId: 'sandbag', attack: 5, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const doubling = r.events.filter((e) => {
      const b = e as { type: string; attack?: number; health?: number; source?: string };
      return b.type === 'buff' && b.attack === 3 && b.health === 3 && b.source === 'm0';
    });
    expect(doubling.length).toBe(1); // exactly the Whelp, doubled once
  });

  it('does NOT double an ENEMY summon', () => {
    // The side guard, which IS reachable: the enemy's Tamer summons a Whelp, and our Fatecarver must ignore it.
    // (The self-guard in the same condition is defensive only — an initial-board minion fires no `onSummon`, so
    // it can't be exercised from here. Left in place deliberately: a Fatecarver summoned mid-combat would
    // otherwise double itself.)
    const r = simulate(
      [bm('n2_fatecarver', 'FC', 5, 60)],
      [{ cardId: 'n2_tamer', attack: 1, health: 1 }, { cardId: 'sandbag', attack: 0, health: 300 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    // The enemy Whelp arrives at 3/3; nothing sourced from our Fatecarver (m0) may buff it.
    const fromFatecarver = r.events.filter((e) => (e as { type: string; source?: string }).type === 'buff'
      && (e as { source?: string }).source === 'm0');
    expect(fromFatecarver).toEqual([]);
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
