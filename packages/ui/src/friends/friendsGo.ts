/**
 * FRIENDS: going somewhere with a friend, through the EXISTING paths only (owner 2026-10-26; R-FRIENDS-04).
 *  - Accepting a Versus room invite opens Versus and joins the room (`joinRoom`, the room browser's own Join).
 *  - Watch on a friend in a ranked game: Live Games' own `watchLiveGame`. Watch on a friend in a Versus match: join
 *    their room in the stands (`joinRoom(..., 'spectator')`, every room is watchable, ruling 8).
 * `installFriendInvites` registers the built-in 'versus_room' invite handler (the Ranked Duos party registers its own).
 */
import { useGame } from '../store';
import { isDuosParty, joinRoom, leaveRoom, openVersus, useVersus } from '../versus/versusStore';
import { versusEnabled } from '../versus/versusFlag';
import { watchLiveGame } from '../live/liveWatch';
import { flashFriends, registerInviteHandler } from './friendsStore';
import type { Friend, FriendInvite } from './friendsRemote';

/** Open Versus and enter a room (as a player: into the room's hand, a seat one drag away; or in the stands). */
export async function goToVersusRoom(roomId: string, as: 'player' | 'spectator', area: 'versus' | 'duos' = 'versus'): Promise<boolean> {
  if (!versusEnabled()) { flashFriends('Versus is not available on this build.'); return false; }
  let vs = useVersus.getState();
  // A party invite while I wait in my own party (nothing started there, so leaving is free): swap parties
  // (R-RANKED-DUOS-SPLIT-01). Any other room I hold stays mine until I leave it.
  if (area === 'duos' && vs.room && vs.room.id !== roomId && isDuosParty(vs.room) && vs.room.status === 'open') {
    await leaveRoom();
    vs = useVersus.getState();
  }
  if (vs.room && vs.room.id !== roomId) { flashFriends(isDuosParty(vs.room) ? 'Leave your party first.' : 'Leave your Versus room first.'); return false; }
  const g = useGame.getState();
  g.goTo('menu'); // closes every ladder page, the Friends page included
  openVersus(area);
  if (vs.room?.id === roomId) return true;
  await joinRoom(roomId, as);
  return useVersus.getState().room?.id === roomId;
}

export async function acceptVersusRoomInvite(invite: FriendInvite): Promise<void> {
  await goToVersusRoom(invite.target, 'player');
}

/** Watch a friend's game, when it is watchable. Resolves true when the watch started. */
export async function watchFriend(f: Partial<Pick<Friend, 'watchKind' | 'watchId'>>): Promise<boolean> {
  if (!f.watchId) return false;
  if (f.watchKind === 'live') {
    const ok = await watchLiveGame(f.watchId);
    if (ok) useGame.setState({ showLiveGames: false });
    return ok;
  }
  if (f.watchKind === 'versus') return goToVersusRoom(f.watchId, 'spectator');
  return false;
}

/** RANKED DUOS (phase 3): accepting a party invite opens the Duos play area and takes the party's free seat. */
export async function acceptDuosPartyInvite(invite: FriendInvite): Promise<void> {
  await goToVersusRoom(invite.target, 'player', 'duos');
}

let installed = false;
/** Register the built-in invite handlers (once, at boot). */
export function installFriendInvites(): void {
  if (installed) return;
  installed = true;
  registerInviteHandler('versus_room', acceptVersusRoomInvite);
  registerInviteHandler('duos_party', acceptDuosPartyInvite);
}
