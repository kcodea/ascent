import { useVersus } from '../versus/versusStore';
import { revealEntries, revealLayoutFor, shouldPlayLobbyReveal, type RevealRunSlice } from './lobbyRevealModel';
import { lobbyReveal, lobbyRevealEnabled } from './lobbyRevealStore';

/**
 * Start the reveal for THIS run, if it qualifies (`shouldPlayLobbyReveal`). Reads the Versus match only for the stage's
 * layout (a Duos match pairs teammates; a group match is never the 1v1 duel). Returns whether it began.
 */
export function beginLobbyRevealFor(run: RevealRunSlice | null | undefined, opts: { replaying?: boolean; spectator?: boolean; force?: boolean } = {}): boolean {
  const enabled = opts.force ? true : lobbyRevealEnabled();
  if (!shouldPlayLobbyReveal(run, { replaying: opts.replaying, enabled }) && !(opts.force && run?.lobby && run.lobby.seats.length >= 2)) return false;
  const seats = run!.lobby!.seats;
  const vs = useVersus.getState().match;
  const layout = revealLayoutFor(run!.mode, seats.length, { duos: !!vs?.group?.duos, group: !!vs?.group });
  const entries = revealEntries(seats, layout);
  lobbyReveal.begin({ entries, layout, spectator: opts.spectator === true });
  return lobbyReveal.isActive();
}
