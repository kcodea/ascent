/**
 * THE END OF A GAME (owner 2026-11-27): "gates close with a crystal forming again. you click it to shatter and play the same portal
 * style animation that takes you to a brand new post game screen. closing that out shows you at the main menu".
 *
 * So the fight that ends a lobby game (ranked, Practice) leaves through the ENTRY gate rather than the old end gate: the doors shut,
 * the end screen is swapped in behind them, the crystal forms and waits for the player's press, and the press plays the location
 * reveal's travel as a JOURNEY (no name, no parchments: `JOURNEY_REST`) to TERYS GATE (owner 2026-11-27: "use this for the
 * returning art", then "Rename it to Terys Gate"), whose leaving wave washes the post-game screen in. That screen stands at the
 * Gate, blurred and alive, as hero select stands at a game's own place.
 *
 * THE HOLD: the end screen is mounted behind the doors, so its own sequence (the rank celebration) waits for the wave to reach it,
 * through `usePostGameHeld`. The hold is always let go, by the arrival or, whatever happens, by the gate's end.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { RunState } from '@game/sim';
import type { RankedGateOptions } from '../rankedGate/rankedGateController';
import { mountAtmosphere } from './atmosphereGl';
import { arriveScreen, type ArriveFrom } from './heroArrive';
import { locationArt, resultBand, TERYS_GATE, TERYS_GATE_BY_RESULT, type LocationDef } from './locations';
import { playerLobbySeat } from '@game/sim';
import { standAt } from './placeAmbience';
import { holdPostGame, isPostGameHeld, subscribePostGameHold } from './postGameHold';

// ── the hold (postGameHold.ts) ──────────────────────────────────────────────────────────────────────────────────────────────
export { holdPostGame } from './postGameHold';
/** Is the journey still on its way to the post-game screen? */
export const usePostGameHeld = (): boolean => useSyncExternalStore(subscribePostGameHold, isPostGameHeld, () => false);

// ── where the journey goes ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Where a finished run stands: Terys Gate, for every game, in its result's colours (gold, green, red). Null is kept for a mode that
 *  should not travel. */
export function postGameLocation(run: Pick<RunState, 'lobby'>): LocationDef | null {
  const lobby = run.lobby;
  if (!lobby) return TERYS_GATE;
  const seat = playerLobbySeat(lobby);
  const place = seat.placement ?? lobby.seats.filter((x) => x.alive).length;
  return TERYS_GATE_BY_RESULT[resultBand(place)];
}

/** What rises into place as the wave reaches the post-game screen. */
const PIECES = '.rankend-place, .rankend-rank, .rankend-status, .rankend-scoring, .rankend-actions, .rankend-secondary, .acctxp, .endplace, .endmmr, .endboardlabel, .endboard, .endplay, .rankend-details';

/**
 * The gate's journey for a finished run: the entry gate's `reveal` option. `onArrive` runs as the wave starts to wash the screen
 * in (the placement tone). Null: the end gate opens as it always did.
 */
export function postGameJourney(run: Pick<RunState, 'lobby'>, onArrive: () => void): RankedGateOptions['reveal'] | null {
  const loc = postGameLocation(run);
  if (!loc) return null;
  const arrive = (from: ArriveFrom): void => {
    holdPostGame(false);
    try { onArrive(); } catch (err) { console.warn('[postGame] arrival', err); }
    arriveScreen(from, '.endscreen', PIECES);
  };
  return { location: () => loc, request: () => ({ location: loc, tribes: [], arrive }) };
}

// ── the ground ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The place, blurred and alive, behind the post-game screen (hero select's ground, without its hero). */
export function PostGameGround({ location }: { location: LocationDef }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => (ref.current ? mountAtmosphere(ref.current, location) : undefined), [location]);
  // The place goes on sounding under the results (R-LOCATION-09's ambience, handed over by the journey), until the menu.
  useEffect(() => standAt(), []);
  return <div className="hs-location pg-location" ref={ref} aria-hidden="true" style={{ backgroundImage: `url(${locationArt(location.id, 'blur')})` }} />;
}
