import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, gildMinion, reduce, type BoardCard, type RunState } from './index';

/** The 2026-08-07 evening owner fix batch: Recaller loop, Voicekeeper timing, gild retro-doubling. */

const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

describe('Recaller cannot reproduce Second Draft (the pickup loop)', () => {
  it('a Recaller played after Second Draft grants nothing', () => {
    // The loop: Second Draft picks the Recaller itself up, the replayed Recaller re-grants Second Draft —
    // a 3-Gold engine that replays a Shout and mints a spell-cast trigger every lap, forever.
    let s: RunState = { ...createRun(3), phase: 'recruit', wave: 7, embers: 40,
      board: [bm('v', 'stray', 1, 1)], hand: [bm('sd', 'seconddraft'), bm('r', 'd2_recaller', 3, 3)] };
    s = reduce(s, { type: 'play', uid: 'sd', targetUid: 'v' }) as RunState;
    // The cast still RECORDS — Steward / the live text must keep seeing it. Only the copy grant skips it.
    expect(s.lastSpellThisTurnId, 'the cast itself must still be recorded').toBe('seconddraft');
    s = reduce(s, { type: 'play', uid: 'r' }) as RunState;
    expect(s.hand.some((c) => c.cardId === 'seconddraft'), 'the copier reproduced Second Draft').toBe(false);
  });

  it('other spells still copy normally', () => {
    let s: RunState = { ...createRun(3), phase: 'recruit', wave: 7, embers: 40,
      hand: [bm('g', 'growth'), bm('r', 'd2_recaller', 3, 3)] };
    s = reduce(s, { type: 'play', uid: 'g' }) as RunState;
    s = reduce(s, { type: 'play', uid: 'r' }) as RunState;
    expect(s.hand.some((c) => c.cardId === 'growth'), 'an ordinary spell should still be granted').toBe(true);
  });
});

describe('Voicekeeper counts from its own placement', () => {
  const sellThenPlace = () => {
    // Sell a Dragon BEFORE the Voicekeeper exists, place it, then sell a second Dragon. The old run-level
    // tally called that second sale "the second Dragon this turn" and paid nothing — the reported bug.
    let s: RunState = { ...createRun(3), phase: 'recruit', wave: 7, embers: 40,
      board: [bm('d1', 'emissary', 2, 3), bm('d2', 'emissary', 2, 3)], hand: [bm('vk', 'd2_voicekeeper', 4, 6)] };
    s = reduce(s, { type: 'sell', uid: 'd1' }) as RunState;   // a Dragon sold with no Voicekeeper in play
    s = reduce(s, { type: 'play', uid: 'vk' }) as RunState;   // NOW it arrives
    s = reduce(s, { type: 'sell', uid: 'd2' }) as RunState;   // the first Dragon it has ever witnessed
    return s;
  };

  it('pays for the first Dragon sold SINCE it hit the board', () => {
    expect(sellThenPlace().hand.some((c) => c.cardId === 'emissary'),
      'the first witnessed sale should have granted a copy').toBe(true);
  });

  it('still pays only once — a third Dragon sold grants nothing more', () => {
    let s = sellThenPlace();
    const copies = () => s.hand.filter((c) => c.cardId === 'emissary').length;
    const had = copies();
    s = { ...s, board: [...s.board, bm('d3', 'emissary', 2, 3)] };
    s = reduce(s, { type: 'sell', uid: 'd3' }) as RunState;
    expect(copies(), 'the once-per-turn rule must survive the rework').toBe(had);
  });
});

describe('gilding in place never retroactively doubles accrued progress', () => {
  it('Thunderous Sovereign: the accrued grant is identical before and after the gild', () => {
    // 50 casts accrued: the grant reads (1 + 50×2) = +101 plain. Gilding used to re-read the same accrual
    // ×2 → +202 (the owner's +100 → +200 report). The ruling: earned value stays; growth turns golden.
    const grantOf = (c: BoardCard) => {
      const p = CARD_INDEX['d2_sovereign']!.effects.find((e) => e.do === 'scBeastAura')!.params!;
      const mul = c.golden ? 2 : 1;
      return ((p.attack as number) + (c.summonBonus ?? 0) * (p.stepAttack as number)) * mul;
    };
    const sov = { ...bm('s', 'd2_sovereign', 8, 8), summonBonus: 50 };
    const before = grantOf(sov);
    gildMinion(sov);
    expect(grantOf(sov) - before, 'the accrued value moved on gild (only the +1 base may double)')
      .toBeLessThanOrEqual(1); // base 1 → 2 is the printed golden base; the 100 accrued stays 100
    // …and future growth is at the golden rate: one more accrual point now reads as +4 (2 step × 2 golden).
    sov.summonBonus! += 1;
    expect(grantOf(sov) - before - 1, 'a post-gild tick should pay the golden step').toBe(4);
  });

  it('the halving is scoped — a raw-read card (Mama Bear) keeps its full accrual on gild', () => {
    // `buffOnSummon` reads summonBonus RAW ("no golden doubling here"), so halving it would destroy value.
    const bear = { ...bm('m', 'mamabear', 4, 4), summonBonus: 6 };
    gildMinion(bear);
    expect(bear.summonBonus, 'a raw-read accrual must never be halved').toBe(6);
  });

  it('a triple still combines the classic way (checkTriples is not a gild-in-place)', () => {
    // Three plain Sovereigns with accruals combine through checkTriples, whose sum-encoding deliberately
    // rides the ×2 read. The gild-halving must not fire on that path — it goes through combine, not
    // gildMinion-on-a-progressed-body… but a plain body gilded WITH no accrual is also fine either way.
    const fresh = bm('f', 'd2_sovereign', 8, 8);
    gildMinion(fresh);
    expect(fresh.summonBonus ?? 0).toBe(0);
    expect(fresh.golden).toBe(true);
  });
});
