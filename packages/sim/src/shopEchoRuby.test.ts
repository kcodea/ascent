import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * Echoes triggered in the SHOP (Funeral on Loan, Ossuary Rite, Deathsayer, Rune of the Reliquary, a Gravetwin
 * copy) run through `RECRUIT_FACTORIES`. An `onDeath` effect with only a COMBAT factory is therefore silently
 * inert there — the card is destroyed and nothing happens (owner report 2026-08-03: a borrowed Geode Guardian
 * summoned nothing).
 */

const borrowed = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 1, health: 2, keywords: [], golden: false, borrowed: true } as never);

describe('Geode Guardian borrowed from Funeral on Loan', () => {
  it('summons two Taunted Golems carrying Rubies', () => {
    const s: RunState = { ...createRun(4), board: [], hand: [borrowed('g', 'k_geode')], embers: 20 };
    const after = reduce(reduce(s, { type: 'play', uid: 'g' }), { type: 'resolveShopDeath' });
    expect(after.board.some((c) => c.uid === 'g'), 'the borrowed body is destroyed on play').toBe(false);
    const golems = after.board.filter((c) => c.cardId === 'gemheart-shard');
    expect(golems.length, 'the Echo must summon two Golems').toBe(2);
    for (const g of golems) {
      expect(g.keywords, 'each Golem has Taunt').toContain('T');
      const base = CARD_INDEX['gemheart-shard']!;
      expect(g.attack + g.health, 'each carries a Ruby').toBeGreaterThan(base.attack + base.health);
    }
  });

  it('fires the Ruby-LANDED cue, so the animation plays', () => {
    // The cue is derived by the reducer from the 'Ruby' buff-count delta, so it needs no wiring here — but it
    // is exactly what the owner asked to see, so pin that it actually reaches the UI channel.
    const s: RunState = { ...createRun(4), board: [], hand: [borrowed('g', 'k_geode')], embers: 20 };
    const after = reduce(reduce(s, { type: 'play', uid: 'g' }), { type: 'resolveShopDeath' });
    expect(after.rubyLandedFx?.length, 'no Ruby-landed cue → no animation').toBeGreaterThan(0);
    expect(after.rubyLandedFxSeq ?? 0).toBeGreaterThan(0);
  });
});

describe('Faultline Scrapper borrowed from Funeral on Loan', () => {
  it('raises the run Ruby strength', () => {
    const s: RunState = { ...createRun(4), board: [], hand: [borrowed('f', 'k_faultline')], embers: 20 };
    const before = s.rubyBonus?.attack ?? 0;
    const after = reduce(reduce(s, { type: 'play', uid: 'f' }), { type: 'resolveShopDeath' });
    expect(after.rubyBonus?.attack ?? 0, 'the Echo must raise Ruby Attack').toBe(before + 1);
  });

  it('fires the Ruby-POWER cue, so the flourish plays', () => {
    const s: RunState = { ...createRun(4), board: [], hand: [borrowed('f', 'k_faultline')], embers: 20 };
    const after = reduce(reduce(s, { type: 'play', uid: 'f' }), { type: 'resolveShopDeath' });
    expect(after.rubyPowerFxAtk ?? 0, 'no Ruby-power cue → no flourish').toBeGreaterThan(0);
    expect(after.rubyPowerFxSeq ?? 0).toBeGreaterThan(0);
  });

  it('a GOLDEN borrowed Scrapper doubles the gain', () => {
    const g: BoardCard = { ...borrowed('f', 'k_faultline'), golden: true };
    const s: RunState = { ...createRun(4), board: [], hand: [g], embers: 20 };
    const after = reduce(reduce(s, { type: 'play', uid: 'f' }), { type: 'resolveShopDeath' });
    expect(after.rubyBonus?.attack ?? 0).toBe((s.rubyBonus?.attack ?? 0) + 2);
  });
});
