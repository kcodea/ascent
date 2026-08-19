import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * The 2026-08-14 owner batch: five Demon balance changes, three new minions, and the Candlelight Toll Ruby fix.
 *
 * The five rebalances are asserted in `set2Demons.test.ts` (they edit tests that already existed there). What
 * lives HERE is the new content plus the two follow-on changes the batch forced — Rune of Blart moving with
 * Bob Blart, and Hellrider taking over the copy-don't-eat shape.
 */

const bm = (cardId: string, uid: string, attack = 2, health = 20, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const shop = (...ids: string[]) => ids.map((cardId, i) => ({ uid: `s${i}`, cardId }));
// The standard combat-test wall: fat enough that the fight runs to completion and the card under test survives
// long enough to fire. An under-tanked subject dies before its own Avenge threshold and reads as "never fired".
const wall = { cardId: 'sandbag', attack: 60, health: 40000 };

// ── GROBBUS (T4 Demon 5/5) — Avenge (3): get a random Demon ─────────────────────────────────────────────────
describe('Grobbus — Avenge (3) grants a random Demon', () => {
  // Three friendly deaths are needed, so the board is Grobbus plus three bodies that die to a big attacker.
  const fight = (golden = false) => simulate(
    [
      bm('dm_grobbus', 'G', 0, 9999, golden ? { golden: true } : {}),
      bm('sandbag', 'a', 0, 1), bm('sandbag', 'b', 0, 1), bm('sandbag', 'c', 0, 1),
    ],
    [wall],
    makeRng(7), CARD_INDEX, combatSide({ tier: 4, tribes: ['demon'] }), combatSide({ tier: 1 }),
  );

  it('the card is a T4 3/6 Demon with no keyword pill', () => {
    const def = CARD_INDEX['dm_grobbus']!;
    expect([def.tier, def.attack, def.health, def.tribe]).toEqual([4, 3, 6, 'demon']); // owner balance 2026-08-18
    expect(def.keywords, 'Avenge carries no pill, matching the other Avenge cards').toEqual([]);
    expect(poolFor('set2').all.some((c) => c.id === 'dm_grobbus'), 'buyable in set 2').toBe(true);
  });

  it('grants a real Demon to hand once three friends have died', () => {
    const granted = fight().playerHandGrants ?? [];
    expect(granted.length, 'three deaths should have paid out once').toBeGreaterThanOrEqual(1);
    for (const id of granted) {
      const def = CARD_INDEX[id]!;
      expect(def.tribe === 'demon' || def.tribe2 === 'demon', `${id} is not a Demon`).toBe(true);
      expect(def.spell ?? false, `${id} is a spell, not a minion`).toBe(false);
    }
  });

  it('golden grants twice as many', () => {
    expect((fight(true).playerHandGrants ?? []).length)
      .toBe((fight(false).playerHandGrants ?? []).length * 2);
  });
});

// ── TRANSCENDANT (T4 Dragon 3/4, Ward) — adjacent Dragons are Engraved ───────────────────────────────────────
// Owner respec 2026-08-18: Transcendant NO LONGER provides a buff of its own — its Start-of-Combat grant is gone,
// its keywords are just Ward (['DS'], no 'SC' pill), and effects is []. All it does now is the LIVE ADJACENCY
// AURA (unchanged in the engine): an adjacent Dragon keeps its IN-COMBAT stat-gains (carried back via
// `playerPermaBuffs`, `.engraved === true`), a far one does not. Because Transcendant supplies no gains itself,
// the coverage below drives the aura with an EXTERNAL in-combat gain source: `d2_cinderchef` (Rally: +1/+1 on
// each swing) placed adjacent to vs. far from a living Transcendant.
describe('Transcendant — adjacent Dragons are Engraved (aura only, no self-buff)', () => {
  // Layout: Cinderchef(adjacent) | Transcendant | Beast spacer | Cinderchef(far). Both chefs are Dragons that
  // swing every turn and gain +1/+1 via Rally; only the adjacent one's gains are Engraved. The enemy is a giant
  // 0-attack sandbag: it never dies (combat runs to the iteration guard) and never mutates the fight, so both
  // chefs rack up many identical Rally gains.
  const fight = (golden = false) => simulate(
    [
      bm('d2_cinderchef', 'CA', 3, 40000, { keywords: ['RL'] }),                       // adjacent to Transcendant
      bm('d2_transcendence', 'T', 0, 40000, golden ? { golden: true, keywords: ['DS'] } : { keywords: ['DS'] }),
      bm('pack', 'SP', 0, 40000),                                                       // a Beast spacer
      bm('d2_cinderchef', 'CF', 3, 40000, { keywords: ['RL'] }),                        // far from Transcendant
    ],
    [{ cardId: 'sandbag', attack: 0, health: 40000 }],
    makeRng(5), CARD_INDEX, combatSide({ tier: 4, tribes: ['dragon', 'beast'] }), combatSide({ tier: 1 }),
  );

  it('the card is a T4 3/4 Dragon with Ward only — no buff of its own', () => {
    const def = CARD_INDEX['d2_transcendence']!;
    expect([def.tier, def.attack, def.health, def.tribe]).toEqual([4, 3, 4, 'dragon']); // owner balance 2026-08-18
    expect(def.keywords, 'Ward only — the Start-of-Combat pill is gone').toEqual(['DS']);
    expect(def.effects ?? [], 'Transcendant no longer PROVIDES any effect of its own').toEqual([]);
    expect(poolFor('set2').all.some((c) => c.id === 'd2_transcendence'), 'buyable in set 2').toBe(true);
  });

  it('only the ADJACENT Dragon keeps its combat gains — Engrave is the difference', () => {
    // `playerPermaBuffs` is the carry-back for combat gains that stick; the aura is what earns an entry. Both
    // chefs gain the same +1/+1 per swing; only the one standing next to Transcendant carries it back.
    const perma = fight().playerPermaBuffs ?? [];
    const kept = new Map(perma.map((p) => [p.sourceUid, p]));
    expect(kept.has('CA'), 'the adjacent chef should have been Engraved').toBe(true);
    expect(kept.get('CA')!.attack, 'it kept real Rally gains').toBeGreaterThan(0);
    expect(kept.get('CA')!.engraved, 'the carry-back entry is flagged Engraved').toBe(true);
    expect(kept.has('CF'), 'the far chef gained the same +1/+1 but keeps nothing').toBe(false);
  });

  it('GOLDEN doubles every combat stat-gain its adjacent Dragon receives', () => {
    // Golden Transcendant doubles its adjacent Dragons' gains (the same `gainMult` golden Taurus grants), live
    // rather than stamped. Same rng + attack in both runs → identical swing count, so the kept total is exactly 2x.
    const plainKept = (fight(false).playerPermaBuffs ?? []).find((p) => p.sourceUid === 'CA')!;
    const goldenKept = (fight(true).playerPermaBuffs ?? []).find((p) => p.sourceUid === 'CA')!;
    expect(plainKept.attack, 'plain: each +1/+1 kept at face value').toBeGreaterThan(0);
    expect(goldenKept.attack, 'golden: the adjacent chef’s gains are doubled').toBe(plainKept.attack * 2);
    expect(goldenKept.engraved).toBe(true);
    // The doubling never widens WHO is engraved — the far chef still keeps nothing.
    expect((fight(true).playerPermaBuffs ?? []).some((p) => p.sourceUid === 'CF'), 'golden must not widen the Engrave').toBe(false);
  });
});

// ── DRUNKEN OAF (T4 Dwarf 4/4) — SoC: give a Dwarf +3/+3, repeated once per Ale cast this turn ──────────────
// (owner balance 2026-08-15: the per-grant rate rose +2/+2 → +3/+3; the REPEAT rule is unchanged.)
describe('Drunken Oaf — the repeat count is 1 + Ales cast this turn', () => {
  const fight = (ales: number, golden = false) => simulate(
    [
      bm('dw_oaf', 'O', 0, 9999, golden ? { golden: true } : {}),
      bm('dw_brunni', 'D1', 0, 9999), bm('dw_brunni', 'D2', 0, 9999),
    ],
    [{ cardId: 'sandbag', attack: 0, health: 40000 }],
    makeRng(11), CARD_INDEX, combatSide({ tier: 4, tribes: ['dwarf'], alesLastTurn: ales }), combatSide({ tier: 1 }),
  );
  // Only the Oaf's own +3/+3 grants — other Dwarves on the board have their own effects.
  const oafBuffs = (r: ReturnType<typeof simulate>, per = 3) =>
    (r.events.filter((e) => e.type === 'buff') as { source?: string; attack: number; health: number }[])
      .filter((b) => b.source === 'm0' && b.attack === per && b.health === per);

  it('the card is a T4 5/5 Dwarf', () => {
    const def = CARD_INDEX['dw_oaf']!;
    expect([def.tier, def.attack, def.health, def.tribe]).toEqual([4, 5, 5, 'dwarf']); // owner balance 2026-08-18
    expect(poolFor('set2').all.some((c) => c.id === 'dw_oaf'), 'buyable in set 2').toBe(true);
  });

  it('a dry turn still pays once — the base grant is not gated on Ales', () => {
    expect(oafBuffs(fight(0)).length).toBe(1);
  });

  it('N Ales means N+1 grants', () => {
    expect(oafBuffs(fight(1)).length).toBe(2);
    expect(oafBuffs(fight(3)).length).toBe(4);
    expect(oafBuffs(fight(5)).length).toBe(6);
  });

  it('golden doubles the per-grant size, NOT the number of repeats', () => {
    const g = fight(3, true);
    expect(oafBuffs(g, 6).length, 'four grants of +6/+6').toBe(4);
    expect(oafBuffs(g, 3).length, 'no +3/+3 grants survive on a golden').toBe(0);
  });

  it('the repeats can land on different Dwarves — each rep re-rolls its target (owner ruling)', () => {
    // With 2 eligible Dwarves and 6 reps, a seeded run must not put all six on one body. This is the
    // spread-the-love ruling; the alternative shape (pick once, stack everything) would show one target.
    const targets = new Set((fight(5).events.filter((e) => e.type === 'buff') as { source?: string; target: string }[])
      .filter((b) => b.source === 'm0').map((b) => b.target));
    expect(targets.size, 'every rep hit the same body — the target is not being re-rolled').toBeGreaterThan(1);
  });
});

// ── RUNE OF BLART — followed Bob Blart from copy to CONSUME ────────────────────────────────────────────────
describe('Rune of Blart — its clause moved with the card (2026-08-14)', () => {
  const base = (): RunState => ({
    ...createRun(5), phase: 'recruit',
    board: [minion('g', 'dm_gourmand', 6, 5)], hand: [],
    shop: shop('sandbag', 'alley', 'stray'),
  });

  it('without the rune, Bob Blart eats exactly the right-most', () => {
    const s = base();
    applyEndOfTurn(s);
    expect(s.shop.map((o) => o.uid)).toEqual(['s0', 's1']);
  });

  it('with the rune, he eats BOTH ends of the row', () => {
    const s: RunState = { ...base(), runeBlart: true };
    applyEndOfTurn(s);
    expect(s.shop.map((o) => o.uid), 'the left- and right-most offers should both be gone').toEqual(['s1']);
    expect(s.shopMinionsEaten, 'both eats count as real Consumes').toBe(2);
  });

  it('a one-minion shop is eaten once, not twice — no double-eating a corpse', () => {
    // The left-most is re-found AFTER the right-most is eaten; on a single-offer row there is nothing left.
    const s: RunState = { ...base(), runeBlart: true, shop: shop('sandbag') };
    applyEndOfTurn(s);
    expect(s.shop.length).toBe(0);
    expect(s.shopMinionsEaten).toBe(1);
  });

  it("the rune's printed text says Consume, matching what the card now does", () => {
    // The card-text rule cuts both ways: a rune that describes a mechanic the card no longer has is as wrong
    // as a stale number. It said "gain the stats of" while Blart copied; it must say Consume now.
    const rune = [...EPIC_RUNES, ...RUNES].find((r) => r.id === 'rune_blart')!;
    expect(rune.text).toContain('Consume');
    expect(rune.text, 'the copy-shape wording must be gone').not.toContain('gain the stats');
  });
});

// ── HELLRIDER — took over the copy-don't-eat shape ─────────────────────────────────────────────────────────
describe('Hellrider — copies the right-most every 4 refreshes, eating nothing', () => {
  it('the offer it copied is still buyable afterwards', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 99, freeRolls: 99,
      board: [minion('m', 'dm_maw', 8, 8)], hand: [], shop: shop('sandbag', 'alley', 'stray'),
    };
    const uidsBefore = s.shop.map((o) => o.uid);
    for (let i = 0; i < 4; i++) s = reduce(s, { type: 'roll' });
    expect(s.shop.length, 'the row must be intact').toBe(uidsBefore.length);
    expect(s.shopMinionsEaten ?? 0, 'no Consume may fire — Hellrider only copies').toBe(0);
    const rider = s.board.find((c) => c.uid === 'm')!;
    expect(rider.attack + rider.health, 'it should have copied on the 4th refresh').toBeGreaterThan(16);
  });
});
