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

/** A borrowed Geode carrying +2/+2 of Rubies — its Echo Golem (owner Ruby batch 2026-09-24) carries them. */
const rubiedGeode = (): BoardCard =>
  ({ ...borrowed('g', 'k_geode'), attack: 6, health: 5, buffs: [{ source: 'Ruby', attack: 2, health: 2, count: 2 }] } as never);

describe('Geode Guardian borrowed from Funeral on Loan', () => {
  it("summons ONE Taunted Golem carrying this minion's Rubies (owner Ruby batch 2026-09-24)", () => {
    const s: RunState = { ...createRun(4), board: [], hand: [rubiedGeode()], embers: 20 };
    const after = reduce(reduce(s, { type: 'play', uid: 'g' }), { type: 'resolveShopDeath' });
    expect(after.board.some((c) => c.uid === 'g'), 'the borrowed body is destroyed on play').toBe(false);
    const golems = after.board.filter((c) => c.cardId === 'gemheart-shard');
    expect(golems.length, 'the Echo summons one Golem').toBe(1);
    expect(golems[0]!.keywords, 'the Golem has Taunt').toContain('T');
    expect([golems[0]!.attack, golems[0]!.health], "1/1 + the Geode's +2/+2 of Rubies").toEqual([3, 3]);
  });

  it('fires the Ruby-LANDED cue, so the animation plays', () => {
    // The cue is derived by the reducer from the 'Ruby' buff-count delta, so it needs no wiring here — but it
    // is exactly what the owner asked to see, so pin that it actually reaches the UI channel.
    const s: RunState = { ...createRun(4), board: [], hand: [rubiedGeode()], embers: 20 };
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
