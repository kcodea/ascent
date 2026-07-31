import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion, type CardDef } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * Owner ask 2026-07-31 (screenshot: Taragosa casting Growths beside a Groveweaver): spells cast IN COMBAT must
 * advance the per-spell improvers PERMANENTLY — and under Rune of the Spellstone, combat Rubies count too.
 *
 * The accrual rides `summonBonus`, which `playerSummonBonus` already persists, so the whole feature is the
 * combat twin of `onSpellCastImproveSummon` plus a `castSpell` fire on the Ruby-play primitive.
 */
const caster: CardDef = { id: 'ci_caster', name: 'Caster', tribe: 'dragon', tier: 5, attack: 3, health: 40, keywords: [],
  effects: [{ on: 'onAttack', do: 'onAllyAttackCastGrowth', params: { attack: 1, health: 1 } }], text: '' };
const rubyPlayer: CardDef = { id: 'ci_ruby', name: 'RubySoC', tribe: 'kobold', tier: 3, attack: 2, health: 40, keywords: [],
  effects: [{ on: 'startOfCombat', do: 'scPlayRubies', params: { count: 1, tribe: 'kobold' } }], text: '' };
const cards = { ...CARD_INDEX, ci_caster: caster, ci_ruby: rubyPlayer };

describe('per-spell improvers advance from COMBAT casts', () => {
  it("a combat Growth cast permanently improves Groveweaver (carried back via playerSummonBonus)", () => {
    const p: BoardMinion[] = [
      { cardId: 'b2_groveweaver', attack: 3, health: 30, sourceUid: 'GW' },
      { cardId: 'ci_caster', attack: 3, health: 40 },
    ];
    const r = simulate(p, [{ cardId: 'drummer', attack: 0, health: 30 }], makeRng(3), cards,
      combatSide({ tier: 5, tribes: ['dragon', 'beast'] }), combatSide({ tier: 1 }));
    const gw = r.playerSummonBonus?.find((b) => b.sourceUid === 'GW');
    expect(gw, 'the combat cast did not improve Groveweaver permanently').toBeTruthy();
    expect(gw!.bonus).toBeGreaterThan(0);
  });

  it('under Rune of the Spellstone, a combat RUBY also counts as a spell cast', () => {
    const p: BoardMinion[] = [
      { cardId: 'b2_groveweaver', attack: 3, health: 30, sourceUid: 'GW' },
      { cardId: 'ci_ruby', attack: 2, health: 40 },
    ];
    const run = (mods: Record<string, boolean>) => simulate(p, [{ cardId: 'drummer', attack: 0, health: 20 }], makeRng(3), cards,
      combatSide({ tier: 5, tribes: ['kobold', 'beast'], questMods: mods }), combatSide({ tier: 1 }));
    const withStone = run({ runeSpellstone: true });
    expect(withStone.playerSummonBonus?.find((b) => b.sourceUid === 'GW')?.bonus ?? 0,
      'the Spellstone Ruby did not advance the improver').toBeGreaterThan(0);
    // WITHOUT the rune a Ruby is not a spell — the improver must stay untouched, or every Ruby-heavy fight
    // would grow Groveweaver with no rune involved.
    const without = run({});
    expect(without.playerSummonBonus?.find((b) => b.sourceUid === 'GW')).toBeUndefined();
  });
});

describe('Rune of Rallying — LEFT-MOST only (owner clarification 2026-07-31)', () => {
  it('with two Rally minions, only the left-most fires at Start of Combat', () => {
    const p: BoardMinion[] = [
      { cardId: 'philippe', attack: 4, health: 20 },
      { cardId: 'philippe', attack: 4, health: 20 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 60 }];
    const r = simulate(p, e, makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'], questMods: { runeRallying: true } }), combatSide());
    const pips = r.events.filter((ev) => ev.type === 'sc' && (ev as { text?: string }).text === 'Rally');
    expect(pips.length, 'both rallies fired — the rune must trigger only the left-most').toBe(1);
  });
});
