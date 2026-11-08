import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';

/**
 * R-EOT-HAND-FX-01 (owner report 2026-11-08, Round 16 replay): "the end of turn how the animation is wrongfully
 * targetting units in hand". The End-of-Turn consequence diff counted Rubies before the trigger on the BOARD
 * only, but compared after on board AND hand. So a hand card that already carried a Ruby read as "just got a
 * Ruby" on every End-of-Turn trigger: a fake rubyPlayed (gem burst) plus a cancelling statsChanged (tribe
 * tendril from the trigger to the hand card). The hand card's stats never changed; only the FX lied.
 */
const faceOmen = { type: 'faceOmen' } as const;

const rubied = { source: 'Ruby', attack: 8, health: 22, count: 1 };

function state(): RunState {
  const run = createRun(3, 'warden');
  return {
    ...run,
    phase: 'recruit',
    board: [
      { uid: 'asm', cardId: 'k_assembler', tribe: 'kobold', attack: 4, health: 3, keywords: [], golden: false },
      { uid: 'kob', cardId: 'k_assembler', tribe: 'kobold', attack: 4, health: 3, keywords: [], golden: false },
    ],
    hand: [
      { uid: 'held', cardId: 'k_assembler', tribe: 'kobold', attack: 12, health: 25, keywords: [], golden: false, buffs: [rubied] },
    ],
  } as unknown as RunState;
}

type Ev = { type: string; target?: { uid?: string; zone?: string } };

describe('End of Turn never aims a Ruby / stat FX at an untouched hand card (R-EOT-HAND-FX-01)', () => {
  it('gameplay is byte-identical with capture on and off', () => {
    const s = state();
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(reduce(s, faceOmen)));
  });

  it('the hand card keeps its stats (nothing really happened to it)', () => {
    const after = reduceWithPresentation(state(), faceOmen, true).state;
    const held = after.hand.find((c) => c.uid === 'held');
    expect(held?.attack).toBe(12);
    expect(held?.health).toBe(25);
  });

  it('emits no rubyPlayed or statsChanged for the hand card', () => {
    const { batch } = reduceWithPresentation(state(), faceOmen, true);
    const events = batch!.events as unknown as Ev[];
    const atHand = events.filter((e) => (e.type === 'rubyPlayed' || e.type === 'statsChanged') && e.target?.uid === 'held');
    expect(atHand).toEqual([]);
  });

  it('the board Kobolds the Assemblers really hit still get their rubyPlayed', () => {
    const { batch } = reduceWithPresentation(state(), faceOmen, true);
    const events = batch!.events as unknown as Ev[];
    const rubyUids = new Set(events.filter((e) => e.type === 'rubyPlayed').map((e) => e.target?.uid));
    expect(rubyUids.has('asm')).toBe(true);
    expect(rubyUids.has('kob')).toBe(true);
  });
});
