// @vitest-environment jsdom
/**
 * THE PLACEMENT TONES (owner 2026-10-13), verbatim: "apply this tone when ending the match in 5th through 8th place"
 * (his recording), then "use the start match tone we moved to when clicking the crystal if you placed 1st through
 * 4th" (the gate's cinematic hit).
 *
 * Pinned here: which place plays which clip on which fader; that the recording ships and both faders exist with a
 * name; which finished games get a tone; that it is timed to the doors parting; and that the combat screen sets it
 * off on both ways out of a last fight.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunState } from '@game/sim';
import { sfx } from './sfx';
import { CATEGORY_BUS, CATEGORY_GAINS, CATEGORY_LABEL } from './audio/config';
import { endGateRevealDelayMs, placementToneFor, playPlacementTone } from './placementTone';
import { rankedGateEndTimeline } from './rankedGate/rankedGateTiming';

afterEach(() => { vi.restoreAllMocks(); });

/** A finished lobby game whose seat was stamped `placement` (or, with none, has `alive` seats still standing). */
const ended = (placement: number | undefined, over: Record<string, unknown> = {}, alive = 3): RunState => ({
  phase: 'gameover', mode: 'lobby', resolve: 0,
  lobby: { seats: [{ id: 's0', alive: false, placement }, ...Array.from({ length: 7 }, (_, i) => ({ id: `s${i + 1}`, alive: i < alive }))] },
  ...over,
} as unknown as RunState);

describe('which place plays what', () => {
  it('1st to 4th play the gate\'s cinematic hit, on their own fader', () => {
    for (const place of [1, 2, 3, 4]) expect(sfx.placementToneOf(place), `place ${place}`).toEqual({ clip: 'gateintro', category: 'placehigh' });
  });

  it('5th to 8th play the owner\'s recorded tone', () => {
    for (const place of [5, 6, 7, 8]) expect(sfx.placementToneOf(place), `place ${place}`).toEqual({ clip: 'placelow', category: 'placelow' });
  });

  it('anything that is not a place plays nothing', () => {
    for (const place of [0, 9, -1, Number.NaN]) expect(sfx.placementToneOf(place)).toBeNull();
  });

  it('the recording ships, and each has a fader on the ui bus with a name', () => {
    expect(existsSync(join(__dirname, 'audio', 'placelow.mp3'))).toBe(true);
    expect(existsSync(join(__dirname, 'audio', 'gateintro.mp3'))).toBe(true);
    for (const cue of ['placelow', 'placehigh']) {
      expect(CATEGORY_GAINS[cue], cue).toBeGreaterThan(0);
      expect(CATEGORY_BUS[cue], cue).toBe('ui');
      expect(CATEGORY_LABEL[cue], cue).toMatch(/^End of match: /);
    }
    // The hit keeps the level it has under the crystal; it is a separate fader, so the two can be mixed apart.
    expect(CATEGORY_GAINS.placehigh).toBe(CATEGORY_GAINS.gateintro);
  });
});

describe('which finished games get a tone', () => {
  it('a ranked or a Practice game, by the place its end screen shows', () => {
    for (let place = 1; place <= 8; place++) {
      expect(placementToneFor(ended(place))).toBe(place);
      expect(placementToneFor(ended(place, { mode: 'practice' }))).toBe(place);
    }
  });

  it('with no stamped place it is the number still standing, as the end screen reads it', () => {
    expect(placementToneFor(ended(undefined, {}, 5))).toBe(5);
    expect(placementToneFor(ended(undefined, {}, 2))).toBe(2);
  });

  it('never the tutorial, the Gauntlet, a sandbox run, a game still going, or a run with no lobby', () => {
    expect(placementToneFor(ended(6, { mode: 'tutorial' }))).toBeNull();
    expect(placementToneFor(ended(6, { mode: 'gauntlet' }))).toBeNull();
    expect(placementToneFor(ended(6, { sandbox: true }))).toBeNull();
    expect(placementToneFor(ended(6, { phase: 'recruit' }))).toBeNull();
    expect(placementToneFor(ended(6, { phase: 'combat' }))).toBeNull();
    expect(placementToneFor(ended(6, { lobby: undefined }))).toBeNull();
  });
});

describe('when it plays', () => {
  it('behind the end-game gate it is timed to the doors starting to part', () => {
    const at = rankedGateEndTimeline();
    expect(endGateRevealDelayMs()).toBe(at.openAt - at.handoffAt);
    expect(endGateRevealDelayMs()).toBe(1180);
  });

  it('asks for the place\'s tone with the delay it is given, and for nothing when the game has none', () => {
    const play = vi.spyOn(sfx, 'placementTone').mockImplementation(() => {});
    expect(playPlacementTone(ended(7), 1180)).toBe(true);
    expect(playPlacementTone(ended(2))).toBe(true);
    expect(play.mock.calls).toEqual([[7, 1180], [2, 0]]);
    play.mockClear();
    expect(playPlacementTone(ended(7, { phase: 'recruit' }))).toBe(false);
    expect(playPlacementTone(ended(7, { mode: 'tutorial' }), 500)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it('the combat screen sets it off on both ways out of a last fight, and the gate warms the clip', () => {
    const recruit = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    // Behind the gate's doors, right after the held result is committed, delayed to the reveal.
    expect(recruit).toMatch(/commitPresentationAction\(\);\s*wipeExitRef\.current = false;[\s\S]{0,400}playPlacementTone\(useGame\.getState\(\)\.run, endGateRevealDelayMs\(\)\);/);
    // And at the blue sweep's full cover, for a game that ended without the gate.
    expect(recruit).toMatch(/else dispatch\(\{ type: 'resolveCombat' \}\);[\s\S]{0,400}if \(!sandboxReplay\) playPlacementTone\(useGame\.getState\(\)\.run\);/);
    expect(readFileSync(join(__dirname, 'sfx.ts'), 'utf8')).toMatch(/warmGate: [^\n]*'placelow'/);
  });
});
