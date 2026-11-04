/**
 * THE ONE FRIENDS LIST of the app shell (party home prototype, DEV only). Docked on the party home's right at desktop
 * size; a drawer from the nav's Friends button everywhere else (menu pages, phones). It replaces the old bottom-left
 * Friends button on the menus (hidden under the shell; the in-game dock is untouched).
 *
 * Rows are kit rail slices (`PhRow`): the portrait bleeds in from the right, the name and status sit left. A friend
 * already in your party says "In party"; Invite shows only where the current mode takes a party (the party home
 * registers what Invite does, shellStore `invite`). Pressing a friend opens the existing chat window. Guests and
 * builds without the online service get one clear line instead of a dead list.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { avatarSrc, heroThumb } from '../../art';
import { Icon } from '../../Icon';
import { remoteEnabled } from '../../remoteBoards';
import { heroPortrait, opponentSkins } from '../../skins/skins';
import { sfx } from '../../sfx';
import { useGame } from '../../store';
import { cardSkins, handleOf, sortFriends, statusText } from '../../friends/friendBits';
import { addFriendByHandle, friendsAccount, inviteFriend, useFriends, useFriendsListLoop } from '../../friends/friendsStore';
import { liveFriends, useDm } from '../../friends/dm/dmStore';
import { openDm } from '../../friends/dock/dockStore';
import { isDuosParty, useVersus } from '../../versus/versusStore';
import { versusRoomRef } from '../../versus/versusRemote';
import { PhButton, PhChip, PhEmpty, PhRow } from '../kit';
import { sampleFriends } from '../sample';
import { usePartyDemo, usePartyRoom } from '../partyHomeFlag';
import { setFriendsOpen, usePhShell } from './shellStore';

export function PhFriends({ docked, picker = false, embedded = false }: { docked: boolean; picker?: boolean; embedded?: boolean }): JSX.Element {
  const sampleRoomOn = usePartyRoom();
  const partyDemo = usePartyDemo();
  const demo = partyDemo || sampleRoomOn; // the sample room shows the sample friends too: no backend
  const account = friendsAccount();
  const live = remoteEnabled() && account && !demo;
  useFriendsListLoop(live);
  const list = useFriends((s) => s.list);
  const failed = useFriends((s) => s.listFailed);
  const flash = useFriends((s) => s.flash);
  const busy = useFriends((s) => Object.keys(s.busy).some((k) => k.startsWith('invite:')));
  const peers = useDm((s) => s.peers);
  const sent = useFriends((s) => s.list?.sent ?? null);
  const room = useVersus((s) => s.room);
  const showOpp = useGame((s) => s.showOpponentSkins);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const invite = usePhShell((s) => s.invite);
  const pulse = usePhShell((s) => s.friendsPulse);
  const sampleInvites = usePhShell((s) => s.sampleInvites);
  const friends = useMemo(() => (demo ? sampleFriends() : sortFriends(liveFriends(list?.friends, peers) ?? [])), [demo, list, peers]);
  // The drawer closes on Escape (the docked list has nothing to close).
  useEffect(() => {
    if (docked) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setFriendsOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [docked]);
  const online = friends.filter((f) => f.status !== 'offline').length;
  // THE CONTEXT: a Versus room you hold (its members are "In room", Invite goes into the room), else the party.
  const versusRoom = room && !isDuosParty(room) && room.status === 'open' ? room : null;
  const target = room ? versusRoomRef(room) : null;
  const roomMembers = versusRoom ? versusRoom.members.map((m) => m.userId) : [];

  let body: JSX.Element;
  if (!demo && !remoteEnabled()) body = <PhEmpty title="Friends are offline" sub="The online service is not connected on this build, so invites are off." />;
  else if (!demo && !account) body = <PhEmpty title="Sign in to invite friends" sub="Friends and invites need a saved account." action={<PhButton variant="primary" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</PhButton>} />;
  else if (!demo && !list) body = <PhEmpty title={failed ? 'Friends are not available right now' : 'Finding your friends'} />;
  else if (friends.length === 0) body = <PhEmpty title="No friends yet" sub="Add one by name and tag, like Name#1234." />;
  else {
    body = (
      <div className="ph-frows" role="list">
        {friends.map((f) => {
          const inRoom = roomMembers.includes(f.userId);
          const inParty = !versusRoom && invite.members.includes(f.userId);
          const s = target ? sent?.find((x) => x.to === f.userId && x.target === target) : undefined;
          const invited = s?.status === 'pending' || (demo && sampleInvites.includes(f.userId));
          const label = invited ? 'Invited' : s?.status === 'declined' ? 'Declined' : 'Invite';
          const art = heroThumb((showOpp ? avatarSrc(f.avatar) : undefined) ?? heroPortrait(f.favoriteHero, opponentSkins(showOpp, cardSkins(f))));
          const right = inRoom ? <PhChip tone="teal">In room</PhChip>
            : inParty ? <PhChip tone="teal">In party</PhChip>
            : versusRoom && f.status === 'online'
              ? <PhButton variant="primary" size="s" disabled={busy || invited} aria-label={`Invite ${handleOf(f)} to your room`}
                  onClick={() => { sfx.pulse(); void inviteFriend(f.userId, 'versus_room', versusRoomRef(versusRoom)); }}>{label}</PhButton>
            : invite.can && invite.send && f.status === 'online'
              ? <PhButton variant="primary" size="s" disabled={busy || invited} aria-label={`Invite ${handleOf(f)} to ${invite.modeLabel}`}
                  onClick={() => invite.send?.(f)}>{label}</PhButton>
              : undefined;
          return (
            <PhRow key={f.userId} className={`ph-friend f-${f.status}`} lead={<span className="ph-fportrait">{art && <img src={art} alt="" draggable={false} decoding="sync" />}</span>} title={f.author ?? handleOf(f)}
              sub={<span className="ph-fstatus"><i aria-hidden="true" />{statusText(f)}</span>}
              onClick={demo ? undefined : () => { sfx.pulse(); openDm(f.userId); }} label={`Message ${handleOf(f)}`} right={right} />
          );
        })}
      </div>
    );
  }

  return (
    <>
    {!docked && <div className="ph-fcatch" aria-hidden="true" onPointerDown={() => setFriendsOpen(false)} />}
    <aside className={`ph-friends${picker || embedded ? ' picker' : docked ? ' docked' : ' drawer'}${embedded ? ' embedded' : ''}`} aria-label="Friends">
      {/* The one-shot "look here" outline (an open seat was pressed): keyed, so each press replays it. */}
      {pulse > 0 && <span key={pulse} className="ph-fpulse" aria-hidden="true" />}
      <div className="ph-fhead">
        <span className="ph-ftitle">Friends</span>
        {(demo || (live && list)) && <span className="ph-fcount">{online} online</span>}
        {!docked && (
          <button type="button" className="ph-iconbtn ph-fclose" aria-label="Close friends" onClick={() => { sfx.pulse(); setFriendsOpen(false); }}>
            <Icon name="chevron" />
          </button>
        )}
      </div>
      {(live || demo) && <AddFriend disabled={demo} />}
      {(embedded || picker) && invite.reason && <div className="ph-fnote">{invite.reason}</div>}
      {flash && !demo && <div className="ph-fflash" role="status">{flash}</div>}
      {body}
      {versusRoom && <div className="ph-fnote">Invites go to your Versus room, {versusRoom.name}.</div>}
    </aside>
    </>
  );
}

function AddFriend({ disabled }: { disabled: boolean }): JSX.Element {
  const [h, setH] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const busy = useFriends((s) => Object.keys(s.busy).some((k) => k.startsWith('handle:')));
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (disabled || busy) return;
    if (!h.trim()) { ref.current?.focus(); return; } // an empty Add points at the field instead of looking dead
    sfx.pulse();
    void addFriendByHandle(h).then((ok) => { if (ok) setH(''); });
  };
  return (
    <form className="ph-fadd" onSubmit={submit}>
      <input ref={ref} className="ph-finput" value={h} onChange={(e) => setH(e.target.value)} placeholder="Add a friend: Name#1234"
        aria-label="Add a friend by name and tag" maxLength={45} spellCheck={false} autoComplete="off" disabled={disabled} />
      <PhButton type="submit" disabled={disabled || busy}>Add</PhButton>
    </form>
  );
}
