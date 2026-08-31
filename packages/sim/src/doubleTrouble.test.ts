import { describe, it, expect } from 'vitest';
import { type CardDef, combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * DOUBLE TROUBLE (set 3) — "When a Ruby is cast on another minion in combat, cast a Ruby on this."
 *
 * Three owner rulings shape it, and each gets a test:
 *
 *  1. **PER RUBY, not per cast** (2026-08-31): *"a ruby being cast is 1 ruby, so if 2 rubies are cast, that
 *     would be 2 rubies."* The engine applies N Rubies in ONE `playRubyOn` call, so the count — not the call —
 *     is the multiplier.
 *  2. **"Another minion" is a separation** (2026-08-31): a Ruby cast on THIS never triggers it, and two Double
 *     Troubles do not feed each other.
 *  3. **Permanence is inherited**: a Ruby cast off a permanent one is itself permanent.
 */
const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [] });

/** A synthetic source that plays `rubies` Rubies on its ADJACENT minions when it dies — the same driver the
 *  Resonance Idol tests use, so the Ruby arrives through the real `playRubyOn` chokepoint. */
const adjRattler = (rubies: number): CardDef => ({
  id: 'dt_rattler', name: 'DtRattler', tribe: 'kobold', tier: 2, attack: 1, health: 1, keywords: [],
  effects: [{ on: 'onDeath', do: 'deathrattlePlayRubiesAdjacent', params: { rubies } }], text: '',
});

type BuffEvent = { type: 'buff'; target: string; attack: number; health: number; source: string };
const rubyBuffs = (r: { events: readonly { type: string }[] }): BuffEvent[] =>
  (r.events as readonly BuffEvent[]).filter((e) => e.type === 'buff' && e.health > 0);

/** Total Ruby health granted to one combat slot — the cleanest read of "how many Rubies landed here". */
const rubyHealthOn = (r: { events: readonly { type: string }[] }, target: string): number =>
  rubyBuffs(r).filter((b) => b.target === target).reduce((n, b) => n + b.health, 0);

describe('Double Trouble', () => {
  /** Board: [DoubleTrouble, victim, rattler]. The rattler dies and Rubies its neighbour (the victim, m1). */
  const fight = (rubies: number, cards: Record<string, CardDef>) => simulate(
    [bm('k3_doubletrouble', 'DT', 8, 60), bm('sandbag', 'VIC', 1, 60), bm('dt_rattler', 'RAT', 1, 1)],
    [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(7), cards,
    combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
  );

  it('a Ruby on another minion casts one on Double Trouble', () => {
    const cards = { ...CARD_INDEX, dt_rattler: adjRattler(1) };
    const r = fight(1, cards);
    expect(rubyHealthOn(r, 'm1'), 'the victim took its Ruby').toBeGreaterThan(0);
    expect(rubyHealthOn(r, 'm0'), 'Double Trouble took one too').toBeGreaterThan(0);
  });

  it('PER RUBY: three Rubies on another minion pay three, not one', () => {
    // The ruling that makes this card what it is. `deathrattlePlayRubiesAdjacent` with `rubies: 3` is ONE
    // `playRubyOn` call carrying 3 — so a per-CALL reading would pay 1 and this asserts it pays 3.
    const one = fight(1, { ...CARD_INDEX, dt_rattler: adjRattler(1) });
    const three = fight(3, { ...CARD_INDEX, dt_rattler: adjRattler(3) });
    const paidForOne = rubyHealthOn(one, 'm0');
    const paidForThree = rubyHealthOn(three, 'm0');
    expect(paidForOne, 'the single-Ruby baseline landed').toBeGreaterThan(0);
    expect(paidForThree, 'three Rubies pay three times the one-Ruby amount').toBe(paidForOne * 3);
  });

  it('a Ruby cast on DOUBLE TROUBLE ITSELF does not trigger it', () => {
    // "Another minion" — the separation. Board order puts the rattler beside Double Trouble, so its Ruby
    // lands ON it; the payout must be exactly that one Ruby and no self-cast on top.
    const cards = { ...CARD_INDEX, dt_rattler: adjRattler(1) };
    const r = simulate(
      [bm('sandbag', 'OUT', 1, 60), bm('k3_doubletrouble', 'DT', 8, 60), bm('dt_rattler', 'RAT', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(7), cards,
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    const landed = rubyBuffs(r).filter((b) => b.target === 'm1');
    expect(landed.length, 'exactly the one Ruby the rattler played — no self-trigger on top').toBe(1);
  });

  it('two Double Troubles do not feed each other', () => {
    // The recursion guard, and the reason the self-Ruby is applied as STATS ONLY. Without it each one's
    // payout is "a Ruby on another minion" to the other, forever. Terminating at all is the assertion.
    const cards = { ...CARD_INDEX, dt_rattler: adjRattler(1) };
    const r = simulate(
      [bm('k3_doubletrouble', 'D1', 8, 60), bm('k3_doubletrouble', 'D2', 8, 60), bm('dt_rattler', 'RAT', 1, 1)],
      [{ cardId: 'sandbag', attack: 10, health: 400 }], makeRng(7), cards,
      combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }),
    );
    expect(r.result).toBeTruthy();
    expect(r.events.length, 'the fight terminated rather than ping-ponging').toBeLessThan(5000);
  });
});
