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

  it('the card is a T4 5/5 Demon with no keyword pill', () => {
    const def = CARD_INDEX['dm_grobbus']!;
    expect([def.tier, def.attack, def.health, def.tribe]).toEqual([4, 5, 5, 'demon']);
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

// ── TRANSCENDENCE (T4 Dragon 4/5, Ward) — SoC: Engrave adjacent Dragons, then buff your Dragons ─────────────
describe('Transcendence — Start of Combat Engraves adjacent Dragons, then buffs the flight', () => {
  // Layout: Dragon | Transcendence | Beast. The left neighbour is a Dragon (engraved + buffed), the right one
  // is not (buffed by nothing — it isn't a Dragon — and never engraved).
  const fight = (golden = false) => simulate(
    [
      bm('d2_orivax', 'L', 0, 9999),
      bm('d2_transcendence', 'T', 0, 9999, golden ? { golden: true } : {}),
      bm('pack', 'R', 0, 9999),
      bm('d2_orivax', 'F', 0, 9999), // a far-away Dragon: buffed, NOT engraved
    ],
    [{ cardId: 'sandbag', attack: 0, health: 40000 }],
    makeRng(5), CARD_INDEX, combatSide({ tier: 4, tribes: ['dragon', 'beast'] }), combatSide({ tier: 1 }),
  );

  it('the card is a T4 4/5 Dragon with Ward', () => {
    const def = CARD_INDEX['d2_transcendence']!;
    expect([def.tier, def.attack, def.health, def.tribe]).toEqual([4, 4, 5, 'dragon']);
    expect(def.keywords, 'Ward + the Start-of-Combat pill').toEqual(['DS', 'SC']);
    expect(poolFor('set2').all.some((c) => c.id === 'd2_transcendence'), 'buyable in set 2').toBe(true);
  });

  it('every Dragon gets +3/+3 — the Beast gets nothing', () => {
    // The sim renumbers minions by board position (m0 = L, m1 = Transcendence, m2 = R, m3 = F); only the
    // carry-back fields keep the authored `sourceUid`.
    const buffs = fight().events.filter((e) => e.type === 'buff') as
      { target: string; source: string; attack: number; health: number }[];
    const from = (uid: string) => buffs.filter((b) => b.source === 'm1' && b.target === uid);
    expect(from('m0').some((b) => b.attack === 3 && b.health === 3), 'the adjacent Dragon was not buffed').toBe(true);
    expect(from('m3').some((b) => b.attack === 3 && b.health === 3), 'the far Dragon was not buffed').toBe(true);
    expect(from('m2').length, 'the adjacent Beast must not be buffed — Dragons only').toBe(0);
  });

  it('only the ADJACENT Dragon keeps its gains — Engrave is the difference', () => {
    // `playerPermaBuffs` is the carry-back for combat gains that stick, and an EG carrier is what earns an entry.
    const perma = fight().playerPermaBuffs ?? [];
    const kept = new Set(perma.map((p) => p.sourceUid));
    expect(kept.has('L'), 'the adjacent Dragon should have been Engraved').toBe(true);
    expect(kept.has('F'), 'a far Dragon is buffed but NOT Engraved — it keeps nothing').toBe(false);
    expect(kept.has('R'), 'the Beast neighbour is off-tribe — never Engraved').toBe(false);
  });

  it('golden doubles the buff, not the Engrave', () => {
    const buffs = fight(true).events.filter((e) => e.type === 'buff') as { target: string; source: string; attack: number }[];
    expect(buffs.some((b) => b.source === 'm1' && b.target === 'm0' && b.attack === 6), 'golden should give +6/+6').toBe(true);
    const kept = new Set((fight(true).playerPermaBuffs ?? []).map((p) => p.sourceUid));
    expect(kept.has('F'), 'golden must not widen the Engrave beyond the neighbours').toBe(false);
  });
});

// ── DRUNKEN OAF (T4 Dwarf 4/4) — SoC: give a Dwarf +2/+2, repeated once per Ale cast this turn ──────────────
describe('Drunken Oaf — the repeat count is 1 + Ales cast this turn', () => {
  const fight = (ales: number, golden = false) => simulate(
    [
      bm('dw_oaf', 'O', 0, 9999, golden ? { golden: true } : {}),
      bm('dw_brunni', 'D1', 0, 9999), bm('dw_brunni', 'D2', 0, 9999),
    ],
    [{ cardId: 'sandbag', attack: 0, health: 40000 }],
    makeRng(11), CARD_INDEX, combatSide({ tier: 4, tribes: ['dwarf'], alesLastTurn: ales }), combatSide({ tier: 1 }),
  );
  // Only the Oaf's own +2/+2 grants — other Dwarves on the board have their own effects.
  const oafBuffs = (r: ReturnType<typeof simulate>, per = 2) =>
    (r.events.filter((e) => e.type === 'buff') as { source?: string; attack: number; health: number }[])
      .filter((b) => b.source === 'm0' && b.attack === per && b.health === per);

  it('the card is a T4 4/4 Dwarf', () => {
    const def = CARD_INDEX['dw_oaf']!;
    expect([def.tier, def.attack, def.health, def.tribe]).toEqual([4, 4, 4, 'dwarf']);
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
    expect(oafBuffs(g, 4).length, 'four grants of +4/+4').toBe(4);
    expect(oafBuffs(g, 2).length, 'no +2/+2 grants survive on a golden').toBe(0);
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
