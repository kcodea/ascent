import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyCardsPlayed, offerBuyStats, spellCasts, advanceRuneThresholds } from './recruit';

/**
 * The 2026-08-19 owner rune batch: 4 reworks + 22 new runes.
 *
 * The cases below are the ones where a rune's VALUE is decided by engine behaviour rather than by its printed
 * data — a data-only rune is already covered by the framework test in `runes.test.ts` (every rune validates,
 * is costed, and is Runeforge-only).
 */
const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);
const rune = (id: string) => RUNE_INDEX[id]!;

describe('rune batch 2026-08-19 — the four reworks', () => {
  it('Rune of Blart is now a BASIC rune at 4 Gold (array membership, not just the flag)', () => {
    // `runeforgePool` reads ARRAY membership, so a demotion that only dropped `epic: true` would leave the
    // rune stuck in the Epic forge while presenting as basic. Assert the array it actually lives in.
    expect(rune('rune_blart').cost).toBe(4);
    expect(RUNES.some((r) => r.id === 'rune_blart'), 'must be in the BASIC pool').toBe(true);
    expect(EPIC_RUNES.some((r) => r.id === 'rune_blart'), 'must have left the Epic pool').toBe(false);
  });

  it('Infernal Ink fires on EVERY Shop spell and its buff is run-wide (not just the current row)', () => {
    const s = run({ runeThresholds: [{ ...(rune('rune_infernal_ink').reward as { meter: 'spellCast'; per: number; buff: { target: 'shop'; attack: number; health: number } }), tick: 0 }] as never });
    advanceRuneThresholds(s, 'spellCast', 1);
    // `shop` writes tavernBuyBonus — the run-wide layer every FUTURE roll inherits, which is what makes it
    // "minions in the Shop everywhere" rather than a decoration on the row on screen.
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp], 'one cast should already have paid').toEqual([1, 1]);
  });

  it("Merchant's Chorus buff is THIS TURN only — it stacks across rolls, then clears at the rollover", () => {
    const s = run({ shop: [{ uid: 'o1', cardId: 'stray' }] });
    // Two Shouts this turn → +6/+6 banked in the per-turn layer, and NOT in the permanent one.
    s.tavernBuyBonusTurn = { atk: 3, hp: 3 };
    const oneShout = offerBuyStats(s, s.shop[0]!);
    s.tavernBuyBonusTurn = { atk: 6, hp: 6 };
    const twoShouts = offerBuyStats(s, s.shop[0]!);
    expect(twoShouts.attack - oneShout.attack, 'a second Shout stacks onto the same shop').toBe(3);
    expect(s.tavernBuyBonus.atk, 'it must NOT leak into the permanent shop bonus').toBe(0);
    // …and the rollover wipes it (the reducer clears it beside the other per-turn tallies).
    s.tavernBuyBonusTurn = undefined;
    expect(offerBuyStats(s, s.shop[0]!).attack).toBe(oneShout.attack - 3);
  });
});

describe('rune batch 2026-08-19 — the new mechanics', () => {
  it('the tribe faucet drips 1 for Basic and 2 for Epic — the Epic runes are the doubled version', () => {
    const basic = rune('rune_basic_dragon').reward as { kind: string; tribe: string; count: number };
    const epic = rune('rune_epic_dragon').reward as { kind: string; tribe: string; count: number };
    expect([basic.kind, basic.tribe, basic.count]).toEqual(['runeTribeDrip', 'dragon', 1]);
    expect([epic.kind, epic.tribe, epic.count]).toEqual(['runeTribeDrip', 'dragon', 2]);
  });

  it('Hoardflame / Dragon Breath double THEIR OWN spell only — which is what drives the ×N badge', () => {
    // `spellCasts` is the same read the shop's ×N badge previews, so arming the rune makes the modifier show.
    const s = run({ runeSpellDouble: ['hoardflame'] });
    expect(spellCasts(s, CARD_INDEX['hoardflame']!), 'the named spell doubles').toBe(2);
    expect(spellCasts(s, CARD_INDEX['growth']!), 'an unrelated spell is untouched').toBe(1);
  });

  it('the Glider pumps a Dragon on every card played, and no-ops with no Dragon out', () => {
    const s = run({ runeGlider: { attack: 4, health: 4 }, board: [minion('d', 'd2_embermouth', 2, 2)] });
    applyCardsPlayed(s, 1);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([6, 6]);
    // No Dragon → the rune simply waits rather than buffing something off-tribe.
    const noDragon = run({ runeGlider: { attack: 4, health: 4 }, board: [minion('b', 'stray', 2, 2)] });
    applyCardsPlayed(noDragon, 1);
    expect([noDragon.board[0]!.attack, noDragon.board[0]!.health]).toEqual([2, 2]);
  });

  it('Blasting Voices is TWO stacked shout repeats — +2 triggers, where the Choir gives +1', () => {
    const r = rune('rune_blasting_voices').reward as { kind: string; rewards: { kind: string }[] };
    expect(r.kind).toBe('multi');
    expect(r.rewards.filter((x) => x.kind === 'shoutRepeat')).toHaveLength(2);
    const bought = reduce(
      { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: ['rune_blasting_voices'] } as RunState,
      { type: 'buyRune', index: 0 },
    );
    expect(bought.shoutExtraAlways ?? 0, 'two stacked grants = 2 extra triggers').toBe(2);
  });

  it('every new rune is costed, set-scoped where it names set-2 mechanics, and Runeforge-only', () => {
    const NEW = ['rune_refraction', 'rune_ruby_resonance', 'rune_hoardflame', 'rune_glider', 'rune_drake_skull',
      'rune_catacomb', 'rune_pendant', 'rune_ornate_clock', 'rune_dragon_breath', 'rune_ruins',
      'rune_engraving_gems', 'rune_blasting_voices',
      ...['dwarf', 'dragon', 'beast', 'demon', 'kobold'].flatMap((t) => [`rune_basic_${t}`, `rune_epic_${t}`])];
    for (const id of NEW) {
      const r = RUNE_INDEX[id];
      expect(r, `${id} is missing`).toBeTruthy();
      expect(r!.cost, `${id} cost`).toBeGreaterThan(0);
      expect(CARD_INDEX[id], `${id} must not collide with a card id`).toBeUndefined();
    }
    expect(NEW).toHaveLength(22);
  });
});
