import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import type { AuraChangedConsequence, ShopChangedConsequence, FodderEatenConsequence } from '@game/core';

/**
 * End-of-Turn presentation gaps the owner reported 2026-08-14:
 *   1. Bob Blart's `consumeShopRightmost` removed a Shop minion but emitted NO consequence — so the offer only
 *      vanished at commit, with no consume animation on the beat.
 *   2. Deepvein Tender's `rubyStatGain` ("your Rubies gain +1 Health"), re-fired by Moira at End of Turn,
 *      raised run-wide ruby strength but emitted nothing — so the proc showed no beat at all.
 *
 * These assert the EMISSION half (gameplay unchanged; the right consequences now ride the batch). The render
 * half (offer leaves the row on its beat, the ruby flourish plays) is wired in Recruit.tsx off these events.
 */
const faceOmen = { type: 'faceOmen' } as const;

function recruit(over: Partial<RunState>): RunState {
  const run = createRun(3, 'warden');
  return { ...run, phase: 'recruit', ...over } as RunState;
}

describe('Bob Blart — a consumed Shop minion emits its departure + the meal', () => {
  const state = () => recruit({
    board: [{ uid: 'blart', cardId: 'dm_gourmand', tribe: 'demon', attack: 6, health: 5, keywords: [], golden: false }],
    shop: [{ uid: 'off1', cardId: 'stray' }],
  } as Partial<RunState>);

  it('gameplay is byte-identical with capture on and off', () => {
    const s = state();
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });

  it('emits shopChanged:consumed for the eaten offer (so it can leave the row on the beat)', () => {
    const { batch } = reduceWithPresentation(state(), faceOmen, true);
    const consumed = batch!.events.find(
      (e): e is ShopChangedConsequence => e.type === 'shopChanged' && e.change === 'consumed',
    );
    expect(consumed, 'the eaten offer emitted a consumed departure').toBeTruthy();
    expect(consumed!.target.uid).toBe('off1');
    expect(consumed!.target.cardId).toBe('stray');
  });

  it('emits the meal (fodderEaten) carrying the eater + stats, for the crumble choreography', () => {
    const { batch } = reduceWithPresentation(state(), faceOmen, true);
    const meal = batch!.events.find(
      (e): e is FodderEatenConsequence => e.type === 'fodderEaten' && e.eaterUid === 'blart',
    );
    expect(meal, 'the consume emitted a meal for Blart').toBeTruthy();
    expect(meal!.fodderId).toBe('stray');
  });
});

describe('Deepvein via Moira — a ruby-strength rise emits its own aura', () => {
  // Moira (index 0) triggers adjacent Shouts at End of Turn; Deepvein (index 1, adjacent) is a `rubyStatGain`
  // Shout ("your Rubies gain +1 Health"). Before the fix this raised rubyBonus silently.
  const state = () => recruit({
    board: [
      { uid: 'moira', cardId: 'b2_moira', tribe: 'beast', attack: 6, health: 4, keywords: [], golden: false },
      { uid: 'deep', cardId: 'k_deepvein', tribe: 'kobold', attack: 2, health: 3, keywords: [], golden: false },
    ],
  } as Partial<RunState>);

  it('gameplay is byte-identical with capture on and off', () => {
    const s = state();
    const plain = reduce(s, faceOmen);
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(plain));
  });

  it('raises run-wide ruby strength (the effect still resolves)', () => {
    const { state: after } = reduceWithPresentation(state(), faceOmen, true);
    expect((after.rubyBonus?.health ?? 0)).toBeGreaterThan(0);
  });

  it("emits auraChanged aura:'ruby' so the proc has a beat to show", () => {
    const { batch } = reduceWithPresentation(state(), faceOmen, true);
    const ruby = batch!.events.find(
      (e): e is AuraChangedConsequence => e.type === 'auraChanged' && e.aura === 'ruby',
    );
    expect(ruby, 'the ruby-strength rise emitted its aura').toBeTruthy();
    expect((ruby!.health ?? 0)).toBeGreaterThan(0);
  });
});
