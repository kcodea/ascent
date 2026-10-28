/**
 * INVITE FRIENDS from a Versus room (owner scope 2026-10-26, R-FRIENDS-04): the room's "Invite friends" opens this panel
 * (the room's own `.vsveil` + `.vspanel`, like Room options). Online friends get Invite (the server checks they are
 * online and the room is open); friends in a game or offline are listed without it. Below, "In this room": the other
 * members who are not friends yet, with Add friend (the players you are playing with). The friends list is read while
 * the panel is open (the shared 60 s loop, R-FRIENDS-05).
 */
import { sfx } from '../sfx';
import { versusRoomRef, type VersusRoom } from '../versus/versusRemote';
import { inviteFriend, relationOf, useFriends, useFriendsListLoop } from './friendsStore';
import { FriendPortrait, handleOf, sortFriends, statusText } from './FriendsPage';
import { AddFriendButton } from './AddFriendButton';
import '../versus/versus.css';
import './friends.css';

export function RoomInvitePanel({ room, me, onClose }: { room: VersusRoom; me: string | null; onClose: () => void }) {
  useFriendsListLoop(true);
  const list = useFriends((s) => s.list);
  const flash = useFriends((s) => s.flash);
  const busy = useFriends((s) => s.busy);
  const inRoom = new Set(room.members.map((m) => m.userId));
  const friends = list ? sortFriends(list.friends).filter((f) => !inRoom.has(f.userId)) : [];
  const others = room.members.filter((m) => m.userId !== me && (!list || relationOf(m.userId, { list }) !== 'friend'));
  const open = room.status === 'open';
  // RANKED DUOS (phase 3): a party's invite is a `duos_party` invite (the notice reads "invites you to their Ranked
  // Duos party"); every other room's is `versus_room`.
  const kind = room.options?.mode === 'ranked_duos' ? 'duos_party' as const : 'versus_room' as const;
  // THE CUTOVER (R-VERSUS-CF-CUTOVER-01): a Cloudflare room's invite names its host (`cf:<id>`).
  const target = versusRoomRef(room);
  return (
    <div className="vsveil" role="dialog" aria-label="Invite friends" onClick={onClose}>
      <div className="vspanel fr-roompanel" onClick={(e) => e.stopPropagation()}>
        <div className="vspanel-title">Invite friends</div>
        {!open && <div className="vspanel-body">Invites open again when this match ends.</div>}
        {flash && <div className="fr-flash fr-flash-inline" role="status">{flash}</div>}
        <div className="fr-roomlist">
          {!list ? <div className="vspanel-body">Finding your friends…</div>
            : friends.length === 0 ? <div className="vspanel-body">No friends to invite yet. Add friends from the Friends page.</div>
            : friends.map((f) => {
              const sent = list.sent.find((x) => x.to === f.userId && x.target === target);
              const label = sent?.status === 'pending' ? 'Invited' : sent?.status === 'declined' ? 'Declined' : 'Invite';
              return (
                <div key={f.userId} className={`fr-roomrow fr-${f.status}`}>
                  <FriendPortrait card={f} />
                  <div className="fr-who"><div className="fr-name">{handleOf(f)}</div><div className="fr-status"><span className="fr-dot" aria-hidden="true" />{statusText(f)}</div></div>
                  {open && f.status === 'online' && f.mode !== 'versus_room' && (
                    <button type="button" className="vsplate" disabled={!!busy[`invite:${f.userId}`] || sent?.status === 'pending'}
                      onClick={() => { sfx.pulse(); void inviteFriend(f.userId, kind, target); }}>{label}</button>
                  )}
                </div>
              );
            })}
        </div>
        {others.length > 0 && (
          <>
            <div className="fr-sh fr-sh-panel">In this room</div>
            <div className="fr-roomlist">
              {others.map((m) => (
                <div key={m.userId} className="fr-roomrow">
                  <div className="fr-who"><div className="fr-name">{m.displayName || 'Player'}</div></div>
                  <AddFriendButton userId={m.userId} />
                </div>
              ))}
            </div>
          </>
        )}
        <div className="vspanel-actions">
          <button type="button" className="vsplate" onClick={() => { sfx.pulse(); onClose(); }}>Close</button>
        </div>
      </div>
    </div>
  );
}
