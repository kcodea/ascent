import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, poolOf, reduce, type BoardCard, type RunState, type ShopCard } from './index';
import { offerBuyStats } from './recruit';

/**
 * RUNE OF THE EMBERS RESOLVES LAST (owner Kevin 2026-10-18: "this rune should happen after all buffs are applied
 * etc, like veinstorm, stat buffs etc etc").
 *
 * "When you refresh, double the Health of the right-most minion in the Shop." The refresh pins the right-most
 * minion; the doubling is the post-buff phase the `reduce` action boundary runs after everything else the action
 * did. So every refresh lands FINAL Health = 2 × (base + every additive shop buff), never 2 × base + a buff that
 * arrived after the doubling.
 */

const isMinion = (o: ShopCard): boolean => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; };
const rightmost = (s: RunState): ShopCard => { const m = s.shop.filter(isMinion); return m[m.length - 1]!; };
const embersHp = (o: ShopCard): number => o.buffs?.find((b) => b.source === 'Rune of the Embers')?.health ?? 0;
const rubyHp = (o: ShopCard): number => o.buffs?.find((b) => b.source === 'Ruby')?.health ?? 0;
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

/** A tier-6 run holding Rune of the Embers, with one board minion of `tribe` for Sigil of Kinship to read. */
function embersRun(over: Partial<RunState> = {}, tribe?: string): RunState {
  const base = createRun(3);
  const t = tribe ?? base.tribes[0]!;
  const kin = poolOf(base).buyable.find((c) => !c.spell && !c.ruby && (c.tribe === t || c.tribe2 === t))!;
  return {
    ...base, phase: 'recruit', tier: 6, embers: 30, freeRolls: 0,
    runeEmbers: true, ownedRunes: ['rune_embers'],
    board: [{ uid: 'm1', cardId: kin.id, tribe: kin.tribe, attack: kin.attack, health: kin.health, keywords: [], golden: false }],
    ...over,
  } as RunState;
}

/** The right-most minion's Health with Embers' own doubling taken back out — what every additive buff made it. */
function preDouble(s: RunState): number {
  const o = rightmost(s);
  return offerBuyStats(s, o).health - embersHp(o);
}

/** The one invariant: the final Health is exactly twice the fully-buffed Health. */
function expectDoubledFinal(s: RunState): ShopCard {
  const o = rightmost(s);
  expect(embersHp(o), 'Embers landed on the right-most').toBeGreaterThan(0);
  expect(offerBuyStats(s, o).health, 'final Health = 2 × (base + buffs)').toBe(2 * preDouble(s));
  expect(s.embersPending, 'the per-action pin never outlives the action').toBeUndefined();
  return o;
}

const castSigil = (s: RunState): RunState =>
  reduce(reduce({ ...s, hand: [spell('sp', 'sigilkinship')] }, { type: 'play', uid: 'sp', targetUid: 'm1' }), { type: 'resolveShopDeath' });

describe('Rune of the Embers doubles the FINAL Health, after every other shop buff of the refresh', () => {
  it('+ Veinstorm: the banked Rubies are inside the doubling (2 × (base + Rubies))', () => {
    const s = reduce(embersRun({ veinstormRubies: { atk: 2, hp: 3 } }), { type: 'roll' });
    const o = expectDoubledFinal(s);
    expect(rubyHp(o), 'the Veinstorm stamp landed on the doubled offer').toBe(3);
    expect(preDouble(s)).toBe(CARD_INDEX[o.cardId]!.health + 3);
  });

  it('+ another rune\'s shop buff landing LATER in the same action (Sigil of Kinship + Rune of Infernal Ink)', () => {
    // Infernal Ink pays when the Shop spell is CAST — after the Sigil's refresh already ran. The old order doubled
    // first, so the right-most read 2h + 1; it must read 2 × (h + 1).
    const ink = RUNE_INDEX['rune_infernal_ink']!.reward as Record<string, unknown>;
    const s0 = embersRun({ runeThresholds: [{ ...ink, sourceId: 'rune_infernal_ink', tick: 0 }] as never });
    const s = castSigil(s0);
    expect(s.tavernBuyBonus.hp, 'Infernal Ink paid on the cast').toBe(s0.tavernBuyBonus.hp + 1);
    const o = expectDoubledFinal(s);
    expect(preDouble(s), 'the Ink +1 is inside the doubling').toBe(CARD_INDEX[o.cardId]!.health + s.tavernBuyBonus.hp);
  });

  it('+ a tribe shop buff (Beast buy-aura) on a Sigil of Kinship Beast row', () => {
    const s = castSigil(embersRun({ beastBuyHp: 4, tribes: ['beast', 'demon', 'dragon', 'undead', 'mech'] } as Partial<RunState>, 'beast'));
    const o = expectDoubledFinal(s);
    const d = CARD_INDEX[o.cardId]!;
    expect(d.tribe === 'beast' || d.tribe2 === 'beast', 'the Sigil served a Beast row').toBe(true);
    expect(preDouble(s), 'the Beast aura is inside the doubling').toBe(d.health + 4 + s.tavernBuyBonus.hp);
  });

  it('+ a run-wide Shop buff (the permanent Shop channel) on an ordinary refresh', () => {
    const s = reduce(embersRun({ tavernBuyBonus: { atk: 5, hp: 6 } }), { type: 'roll' });
    const o = expectDoubledFinal(s);
    expect(preDouble(s)).toBe(CARD_INDEX[o.cardId]!.health + 6);
  });

  it("Pete's contraband replaces the right-most AFTER the refresh: the replacement is the one doubled", () => {
    // The old order doubled the old right-most, then Pete swapped it out, so the doubling was simply lost.
    const s = reduce(embersRun({ heroId: 'pete', refreshCount: 2 } as Partial<RunState>), { type: 'roll' });
    const o = rightmost(s);
    expect(o.contraband, 'the contraband path ran').toBe(true);
    expectDoubledFinal(s);
  });

  it('only the right-most is doubled, and a refresh without the rune changes nothing', () => {
    const s = reduce(embersRun(), { type: 'roll' });
    const mins = s.shop.filter(isMinion);
    for (const o of mins.slice(0, -1)) expect(embersHp(o), 'only the right-most').toBe(0);
    const off = reduce(embersRun({ runeEmbers: undefined, ownedRunes: [] }), { type: 'roll' });
    expect(off.shop.some((o) => embersHp(o) > 0)).toBe(false);
  });

  it('is deterministic: the same run and action land the same row, byte for byte', () => {
    const a = reduce(embersRun({ veinstormRubies: { atk: 1, hp: 2 } }), { type: 'roll' });
    const b = reduce(embersRun({ veinstormRubies: { atk: 1, hp: 2 } }), { type: 'roll' });
    expect(a.shop).toEqual(b.shop);
    expect(a.rngCursor).toBe(b.rngCursor);
  });
});
