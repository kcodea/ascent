import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, reduceWithPresentation, type RunState } from './index';
import type { CardGrantedConsequence, SourceTriggerEvent } from '@game/core';

/**
 * Owner report 2026-08-14: Black Belt Brian's card (from a Discover) doesn't come in "in real-time" — it
 * snaps into the hand at the combat hand-off. An End-of-Turn Discover AUTO-resolves (`autoResolveEotDiscovers`)
 * outside any beat scope, so it emitted no `cardGranted` and the projection/coalesce path never saw it.
 *
 * The fix wraps the auto-grant in a `system:eotDiscover:grant` beat so the card emits `cardGranted` and
 * materialises during End-of-Turn playback like a shop conjure. This asserts the EMISSION half; the on-beat
 * coalesce is a UI concern verified live.
 */
const faceOmen = { type: 'faceOmen' } as const;

// [Brian, Moira, Brian]: at End of Turn Moira replays both neighbours' Discover Battlecries (auto-resolved).
const state = (): RunState => ({
  ...createRun(1, 'warden'), phase: 'recruit', tier: 5, hand: [],
  board: [
    { uid: 'a', cardId: 'blackbelt', tribe: 'neutral', attack: 3, health: 5, keywords: [], golden: false },
    { uid: 'm', cardId: 'b2_moira', tribe: 'beast', attack: 3, health: 5, keywords: [], golden: false },
    { uid: 'b', cardId: 'blackbelt', tribe: 'neutral', attack: 3, health: 5, keywords: [], golden: false },
  ],
} as RunState);

describe('End-of-Turn Discover auto-grant emits cardGranted on its own beat', () => {
  it('gameplay is byte-identical to plain reduce (capture on)', () => {
    const s = state();
    expect(JSON.stringify(reduceWithPresentation(s, faceOmen, true).state)).toBe(JSON.stringify(reduce(s, faceOmen)));
  });

  it('emits a cardGranted per auto-resolved Discover, on a system:eotDiscover beat', () => {
    const { batch } = reduceWithPresentation(state(), faceOmen, true);
    const grants = batch!.events.filter((e): e is CardGrantedConsequence => e.type === 'cardGranted');
    expect(grants.length, 'both re-fired Brians granted a card, each emitting cardGranted').toBeGreaterThanOrEqual(2);
    expect(grants.every((g) => CARD_INDEX[g.cardId]?.spell), 'Brian discovers spells').toBe(true);

    const discoverBeats = batch!.events.filter(
      (e): e is SourceTriggerEvent => e.type === 'sourceTrigger' && e.source.id === 'eotDiscover',
    );
    expect(discoverBeats.length, 'each auto-grant got its own discover beat').toBeGreaterThanOrEqual(2);
    expect(discoverBeats.every((b) => b.policy === 'ownBeat')).toBe(true);
  });
});
