/**
 * THE PLACEMENT TONES (owner 2026-10-13). "apply this tone when ending the match in 5th through 8th place", with his
 * recording (`audio/placelow.mp3`, 3.1 s, its swell peaking half a second in); then "use the start match tone we
 * moved to when clicking the crystal if you placed 1st through 4th": the gate's cinematic hit (the `gateintro` clip),
 * on its own fader. So every finishing place has a sound; which one is `sfx.placementToneOf`.
 *
 * It is the sound of the RESULT, so it plays as the result comes into view:
 *   - a game that ends through the end-game gate (rankedGate/endGameGate.ts): as the doors start to part. The end
 *     screen was swapped in behind them a little earlier, so the tone is scheduled from that swap, on the audio
 *     clock, by `endGateRevealDelayMs`;
 *   - a game that ends through the blue sweep (reduced motion, or the gate's rare miss): at once, as the sweep
 *     lifts on the end screen.
 *
 * Only a lobby game that shows a placement: ranked and Practice. Not the tutorial, the Gauntlet (their own endings)
 * or a sandbox run. Quitting a match (an abandon) shows no end screen and plays nothing.
 */
import type { RunState } from '@game/sim';
import { finalPlacement } from './announcer';
import { rankedGateEndTimeline } from './rankedGate/rankedGateTiming';
import { sfx } from './sfx';

/** The placement a finished game's end screen shows, when it is one this module has a tone for; else null. */
export function placementToneFor(run: RunState): number | null {
  if (run.phase !== 'gameover') return null;
  if (run.mode !== 'lobby' && run.mode !== 'practice') return null;
  if (!run.lobby || run.sandbox === true) return null;
  const place = finalPlacement(run);
  return sfx.placementToneOf(place) ? place : null;
}

/** From the swap behind the end-game gate's shut doors to the moment they start to part. */
export function endGateRevealDelayMs(): number {
  const at = rankedGateEndTimeline();
  return Math.max(0, at.openAt - at.handoffAt);
}

/** Play the finished game's placement tone, `delayMs` from now. Nothing for a game with no tone. Returns whether
 *  one was asked for (the tests' handle; the caller needs nothing back). */
export function playPlacementTone(run: RunState, delayMs = 0): boolean {
  const place = placementToneFor(run);
  if (place === null) return false;
  sfx.placementTone(place, delayMs);
  return true;
}
