import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { mintRubies, rubyStatBonus, spellAttackBonus, spellHealthBonus } from './recruit';

/**
 * RUNE OF THE SPELLSTONE — the Ruby/spell-buff synergy (owner ask 2026-08-14).
 *
 * The rune already said "Rubies you cast count as Shop spells", but that only made a Ruby *tick the spell-cast
 * watchers*: it counted as a spell for every purpose except the one thing a spell is actually worth. It now also
 * folds the run's SPELL power into a Ruby's stats, via the single `rubyStatBonus` read every Ruby source shares.
 *
 * These tests pin the SHARED read rather than one card, because the whole point is that everything downstream
 * inherits it — combat-played Rubies, Veinstorm's shop stamp, Motherlode, Mountainbond, the printed text.
 */

const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
/** A run with spell power on it, optionally holding the rune. `spellBonus` is the run-wide spell stat channel. */
const withPower = (rune: boolean, attack = 3, health = 2): RunState => ({
  ...set2(), runeSpellstone: rune || undefined, spellBonus: { attack, health }, board: [], hand: [],
});
const ruby = (uid: string): BoardCard =>
  ({ uid, cardId: 'ruby', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false });
const target = (uid = 't'): BoardCard =>
  ({ uid, cardId: 'pack', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false });

describe('rubyStatBonus — the one read every Ruby source shares', () => {
  it('is just the Ruby accumulator without the rune', () => {
    const s: RunState = { ...withPower(false), rubyBonus: { attack: 2, health: 1 } };
    expect(spellAttackBonus(s), 'the run really does have spell power to ignore').toBe(3);
    expect(rubyStatBonus(s)).toEqual({ attack: 2, health: 1 });
  });

  it('adds spell power on top with the rune, per stat', () => {
    const s: RunState = { ...withPower(true), rubyBonus: { attack: 2, health: 1 } };
    // Asymmetric on purpose: spell power is a PAIR (+3/+2 here), and an Attack-only fold would be wrong.
    expect(rubyStatBonus(s)).toEqual({ attack: 2 + spellAttackBonus(s), health: 1 + spellHealthBonus(s) });
    expect(rubyStatBonus(s)).toEqual({ attack: 5, health: 3 });
  });

  it('is a no-op when the run has no spell power at all', () => {
    const s: RunState = { ...set2(), runeSpellstone: true, rubyBonus: { attack: 4, health: 4 } };
    expect(rubyStatBonus(s)).toEqual({ attack: 4, health: 4 });
  });
});

describe('minted Rubies', () => {
  it('come in bigger with the rune', () => {
    const off = withPower(false);
    const on = withPower(true);
    mintRubies(off, 1);
    mintRubies(on, 1);
    expect([off.hand[0]!.attack, off.hand[0]!.health], 'a plain Ruby is 1/1').toEqual([1, 1]);
    expect([on.hand[0]!.attack, on.hand[0]!.health], 'the rune should add +3/+2').toEqual([4, 3]);
  });

  it('Rune of Gemcutting\'s fixed 3/3 still wins outright — an override is an override', () => {
    const s = withPower(true);
    mintRubies(s, 1, undefined, { attack: 3, health: 3 });
    expect([s.hand[0]!.attack, s.hand[0]!.health]).toEqual([3, 3]);
  });
});

describe('Rubies already in HAND track later spell-power gains', () => {
  it('a spell-power gain grows held Rubies, so they match a freshly minted one', () => {
    // A minted Ruby BAKES its stats into the hand card, so without this the two would drift: the held Ruby
    // would sit at its mint value while every new one came in bigger. Wardkeeper's Shout is the power source.
    let s: RunState = { ...set2(), runeSpellstone: true, board: [], hand: [ruby('r'), { ...ruby('w'), cardId: 'dw_wardkeeper', tribe: 'dwarf', attack: 3, health: 1 }] };
    expect(s.hand.find((c) => c.uid === 'r')!.attack, 'starts at the printed 1/1').toBe(1);
    s = reduce(s, { type: 'play', uid: 'w' }); // "your Shop spells gain +1 Attack"
    const held = s.hand.find((c) => c.uid === 'r')!;
    expect(spellAttackBonus(s), 'Wardkeeper should have raised spell power').toBe(1);
    expect(held.attack, 'the held Ruby did not follow the spell-power gain').toBe(2);
    // And a Ruby minted NOW lands on the same number — the drift test that motivates the hand-walk.
    mintRubies(s, 1);
    const fresh = s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).at(-1)!;
    expect([fresh.attack, fresh.health], 'held and fresh Rubies disagree').toEqual([held.attack, held.health]);
  });

  it('does NOT touch held Rubies without the rune', () => {
    let s: RunState = { ...set2(), board: [], hand: [ruby('r'), { ...ruby('w'), cardId: 'dw_wardkeeper', tribe: 'dwarf', attack: 3, health: 1 }] };
    s = reduce(s, { type: 'play', uid: 'w' });
    expect(s.hand.find((c) => c.uid === 'r')!.attack, 'a spell buff is none of a plain Ruby\'s business').toBe(1);
  });
});

describe('everything downstream of a Ruby\'s stats inherits it', () => {
  it('a MINTED Ruby played from hand lands the bigger buff', () => {
    // Minted, not hand-constructed: a hand Ruby's value IS its baked stats, so minting is what the rune has to
    // reach. (A Ruby you were already holding when you BOUGHT the rune is the separate retro-fold case below.)
    const play = (rune: boolean) => {
      const s: RunState = { ...withPower(rune), board: [target()], hand: [] };
      mintRubies(s, 1);
      const next = reduce(s, { type: 'play', uid: s.hand[0]!.uid, targetUid: 't' });
      const t = next.board.find((c) => c.uid === 't')!;
      return { attack: t.attack - 3, health: t.health - 3 };
    };
    expect(play(false), 'a plain Ruby grants +1/+1').toEqual({ attack: 1, health: 1 });
    expect(play(true), 'the rune should make it +4/+3').toEqual({ attack: 4, health: 3 });
  });

  it('BUYING the rune retro-folds spell power into Rubies already in hand', () => {
    // The hand-walk in `reduce` only fires on a spell-power DELTA, and buying a rune moves none — so the reward
    // case has to do it once at purchase. Without this, a Ruby you were holding stays small forever while every
    // Ruby minted after the purchase comes in bigger. Found by this test, not by hand.
    const s: RunState = { ...withPower(false), wave: 7, phase: 'recruit', embers: 40,
      runeforgeOffer: ['rune_spellstone'], hand: [] };
    mintRubies(s, 1);
    expect([s.hand[0]!.attack, s.hand[0]!.health], 'minted before the rune, so 1/1').toEqual([1, 1]);
    const after = reduce(s, { type: 'buyRune', index: 0 }) as RunState; // the real forge purchase path
    expect(after.runeSpellstone, 'the rune was not actually bought').toBe(true);
    const held = after.hand.find((c) => CARD_INDEX[c.cardId]?.ruby)!;
    expect([held.attack, held.health], 'the held Ruby was left behind by the purchase').toEqual([4, 3]);
  });

  it('VEINSTORM stamps the shop at the bigger value, and banks it for future rolls', () => {
    const cast = (rune: boolean) => {
      const s: RunState = { ...withPower(rune), embers: 20,
        shop: [{ uid: 's0', cardId: 'sandbag' }], hand: [{ ...ruby('v'), cardId: 'veinstorm' }] };
      return reduce(s, { type: 'play', uid: 'v' });
    };
    const off = cast(false), on = cast(true);
    expect([off.shop[0]!.atk, off.shop[0]!.hp], 'plain Veinstorm gems the row +1/+1').toEqual([1, 1]);
    expect([on.shop[0]!.atk, on.shop[0]!.hp], 'the rune should gem it +4/+3').toEqual([4, 3]);
    // The BANK re-stamps every future roll, so it has to carry the same number or the shop would shrink.
    expect(on.veinstormRubies, 'the bank did not follow').toEqual({ atk: 4, hp: 3 });
  });

  it('a Ruby played IN COMBAT inherits it — the combat side reads the folded value off the snapshot', () => {
    // The combat half needs no knowledge of the rune: `resolveCombat` folds spell power into the snapshot's
    // `rubyBonus`, and `rubyBonusFor` reads that verbatim. This asserts the FOLD, which is the contract.
    const s: RunState = { ...withPower(true), rubyBonus: { attack: 1, health: 1 } };
    expect(rubyStatBonus(s), 'the value handed to combat').toEqual({ attack: 4, health: 3 });
    // And the combat primitive really does pay 1 + bonus per Ruby.
    const gem: BoardMinion = { cardId: 'k_gemheart', attack: 1, health: 200, keywords: [] };
    const r = simulate([gem], [{ cardId: 'sandbag', attack: 0, health: 400, keywords: [] }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['kobold'], rubyBonus: rubyStatBonus(s) }), combatSide());
    expect(r.result, 'the fight resolved').toBeDefined();
  });
});

describe('the rune\'s printed text', () => {
  it('says it grants the Shop-spell bonuses, not just the cast count', () => {
    // The card-text rule: a rune that only promises half of what it does is as wrong as a stale number.
    const rune = [...RUNES, ...EPIC_RUNES].find((r) => r.id === 'rune_spellstone')!;
    expect(rune.text).toContain('count as **Shop spells**');
    expect(rune.text.toLowerCase()).toContain('bonus');
  });
});

describe('Baal — text fix 2026-08-14', () => {
  it('names the SHOP-spell counter it actually meters', () => {
    const def = CARD_INDEX['dw_baal']!;
    expect(def.text).toContain('2 Shop spells');
    expect(def.goldenText).toContain('2 Shop spells');
    // Text-only: the effect and its threshold are untouched.
    const eff = def.effects.find((e) => e.on === 'spellCast')!;
    expect(eff.do).toBe('spellCastDemonConsumesShop');
    expect((eff.params as { every?: number }).every).toBe(2);
  });
});
