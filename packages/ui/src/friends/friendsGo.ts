/**
 * FRIENDS: going somewhere with a friend, through the EXISTING paths only (owner 2026-10-26; R-FRIENDS-04).
 *  - Accepting a Versus room invite opens Versus and joins the room (`joinRoom`, the room browser's own Join).
 *  - Watch on a friend in a ranked game: Live Games' own `watchLiveGame`. Watch on a friend in a Versus match: join
 *    their room in the stands (`joinRoom(..., 'spectator')`, every room is watchable, ruling 8).
 * `installFriendInvites` registers the built-in 'versus_room' invite handler (the Ranked Duos party registers its own).
 */
import { useGame } from '../store';
import { joinRoom, openVersus, useVersus } from '../versus/versusStore';
import { versusEnabled } from '../versus/versusFlag';
import { watchLiveGame } from '../live/liveWatch';
import { flashFriends, registerInviteHandler } from './friendsStore';
import type { Friend, FriendInvite } from './friendsRemote';

/** Open Versus and enter a room (as a player: into the room's hand, a seat one drag away; or in the stands). */
export async function goToVersusRoom(roomId: string, as: 'player' | 'spectator'): Promise<boolean> {
  if (!versusEnabled()) { flashFriends('Versus is not available on this build.'); return false; }
  const vs = useVersus.getState();
  if (vs.room && vs.room.id !== roomId) { flashFriends('Leave your Versus room first.'); return false; }
  const g = useGame.getState();
  g.goTo('menu'); // closes every ladder page, the Friends page included
  openVersus();
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

let installed = false;
/** Register the built-in invite handlers (once, at boot). */
export function installFriendInvites(): void {
  if (installed) return;
  installed = true;
  registerInviteHandler('versus_room', acceptVersusRoomInvite);
}
