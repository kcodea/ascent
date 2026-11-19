/**
 * KEEP THE LOBBY'S IDENTITY ACROSS SHOP ACTIONS (R-PERF-LOBBY-STABLE-01, perf pass 2026-11-18).
 *
 * The reducer deep-clones the run on every dispatch, so `run.lobby` is a new object after every buy, sell, roll and
 * reorder, although the table itself only changes when a round settles. `LobbyPanel` is `memo`'d on that prop, so
 * its memo never held: all eight seat rows (faces, frames, slices, the rail view, the pairing walk over every past
 * encounter) were rebuilt on every action, and on every mid-fight preview dispatch with the rail slid away.
 *
 * `useStableLobby` hands back the PREVIOUS lobby object while a cheap signature of everything the reducer can change
 * in it is unchanged. The reducer writes the lobby in exactly three places (`settleLobbyRound`, the player's seat
 * taking a fight's damage, and the end-of-run placement), and each moves a field the signature reads: the round, the
 * encounter list, a seat's Resolve / Armor / alive / placement. The scout intel a settle records is in it too.
 *
 * A VERSUS run's lobby is a DISPLAY lobby rebuilt outside the reducer from the server's record (`versusLobby`,
 * `versusGroupLobby`, the spectator's `lobbyFor`); those already keep their identity until something changes, and
 * carry fields this signature does not read, so they pass straight through.
 */
import { useRef } from 'react';
import type { RunLobby } from '@game/sim';

/** Everything the reducer can change in a lobby, as one string. Pure, exported for its test. */
export function lobbySignature(lobby: RunLobby): string {
  let s = `${lobby.round}|${lobby.finished ? 1 : 0}|${lobby.encounters.length}|${lobby.seats.length}`;
  if (lobby.forcedOpponent) s += `|f${lobby.forcedOpponent.round}:${lobby.forcedOpponent.seatId}`;
  if (lobby.duosFirstIds) s += `|d${lobby.duosFirstIds.join(',')}`;
  for (const seat of lobby.seats) {
    const i = seat.intel;
    s += `|${seat.id},${seat.heroId},${seat.label},${seat.kind},${seat.alive ? 1 : 0},${seat.resolve},${seat.armor},${seat.placement ?? ''},${seat.eliminatedRound ?? ''},${seat.invulnerable ? 1 : 0}`;
    if (i) s += `,i${i.round}:${i.tier}:${i.triples}:${i.topTribe ?? ''}:${i.topTribeCount ?? ''}`;
  }
  // The newest round's encounters: a settle marks them fought and stamps their outcome.
  const e = lobby.encounters;
  for (let k = Math.max(0, e.length - 4); k < e.length; k++) {
    const x = e[k]!;
    s += `|${x.round}${x.a}${x.b}${x.fought ? 1 : 0}${x.outcome}${x.damageToA},${x.damageToB}`;
  }
  return s;
}

/** The same lobby object for as long as its signature holds (see the file header). `passthrough` = a display lobby
 *  built outside the reducer (Versus): returned as given. */
export function useStableLobby<L extends RunLobby | null | undefined>(lobby: L, passthrough: boolean): L {
  const ref = useRef<{ lobby: RunLobby; sig: string } | null>(null);
  if (!lobby || passthrough) { ref.current = null; return lobby; }
  const prev = ref.current;
  if (prev && prev.lobby === lobby) return lobby;
  const sig = lobbySignature(lobby);
  if (prev && prev.sig === sig) return prev.lobby as L;
  ref.current = { lobby, sig };
  return lobby;
}
