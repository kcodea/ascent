/**
 * THE FRIENDS PAGE (owner 2026-10-26: "yes to adding a friends list that shows online players, to simplify invites";
 * R-FRIENDS-01..04). A ladder page on the menu sidebar like Live Games (the `lb-` rows and buttons, the player's
 * portrait in their frame, `LbHeroFrame`), no new chrome:
 *  - the top bar: my own handle (to share) and Add by handle ("Name#1234");
 *  - Requests: incoming (Accept / Decline) and sent (Cancel), with a count;
 *  - Friends: online first, then in a game (with its mode and Watch when the game is watchable), then offline with
 *    last seen; Invite when I am in an open Versus room and they are online; Remove and Block (each asks once more);
 *  - Blocked: Unblock.
 * A guest sees one line, "Save your account to add friends", and the existing Save account panel.
 * The list is ONE batched read while the page is open (60 s, nothing while hidden; R-FRIENDS-05).
 */
import { memo, useState, type FormEvent } from 'react';
import { Icon } from '../Icon';
import { LbHeroFrame } from '../LadderBits';
import { MenuSidebar, SidebarHost } from '../MenuSidebar';
import { avatarSrc } from '../art';
import { remoteEnabled } from '../remoteBoards';
import { sfx } from '../sfx';
import { frameIdOf } from '../portraitFrame/PortraitFrame';
import { heroPortrait, opponentSkins } from '../skins/skins';
import { displayHandle, useGame } from '../store';
import { useVersus } from '../versus/versusStore';
import { versusRoomRef } from '../versus/versusRemote';
import type { RunCosmeticSnapshot } from '@game/progression';
import {
  acceptRequest, addFriendByHandle, blockPlayer, cancelRequest, declineRequest, friendsAccount, inviteFriend, lastSeenText,
  modeText, removeFriend, unblockPlayer, useFriends, useFriendsListLoop,
} from './friendsStore';
import { watchFriend } from './friendsGo';
import type { Friend, FriendCard } from './friendsRemote';
import './friends.css';

/** A card's recorded cosmetics (frame + favourite-hero skin) as a snapshot the portrait helpers read. */
export function cardSkins(c: Pick<FriendCard, 'favoriteHero' | 'frame' | 'skin'>): RunCosmeticSnapshot | null {
  if (!c.frame && !c.skin) return null;
  return {
    ...(c.frame ? { portraitFrame: c.frame } : {}),
    ...(c.skin && c.favoriteHero ? { heroSkinByHeroId: { [c.favoriteHero]: c.skin } } : {}),
  };
}

/** A friend's portrait in their frame: their chosen picture (through "Show opponent cosmetics", like the Leaderboard),
 *  else their favourite hero in its skin. */
export const FriendPortrait = memo(function FriendPortrait({ card }: { card: FriendCard }) {
  const showOpp = useGame((s) => s.showOpponentSkins);
  const skins = opponentSkins(showOpp, cardSkins(card));
  const art = (showOpp ? avatarSrc(card.avatar) : undefined) ?? heroPortrait(card.favoriteHero, skins);
  return <LbHeroFrame heroId={card.favoriteHero} art={art} frameId={frameIdOf(skins)} />;
});

export const handleOf = (c: Pick<FriendCard, 'author' | 'discriminator' | 'userId'>): string => displayHandle(c.author, c.discriminator, c.userId);

/** "Online" / "In a game: Ranked" / "Last seen 3 minutes ago". */
export function statusText(f: Pick<Friend, 'status' | 'mode' | 'lastSeen'>, now = Date.now()): string {
  if (f.status === 'online') {
    const m = f.mode === 'versus_room' ? 'In a Versus room' : f.mode === 'watching' || f.mode === 'replay' ? modeText(f.mode) : null;
    return m ? `Online: ${m}` : 'Online';
  }
  if (f.status === 'in_game') {
    const m = modeText(f.mode);
    return m ? `In a game: ${m}` : 'In a game';
  }
  return lastSeenText(f.lastSeen, now);
}

const ORDER = { online: 0, in_game: 1, offline: 2 } as const;
export function sortFriends(list: readonly Friend[]): Friend[] {
  return [...list].sort((a, b) => ORDER[a.status] - ORDER[b.status] || handleOf(a).localeCompare(handleOf(b)));
}

/** A button that asks once more before it acts (Remove, Block). */
function ConfirmButton({ label, confirm, onConfirm, disabled }: { label: string; confirm: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={`lb-btn lb-btn-ghost pressable fr-small${armed ? ' fr-armed' : ''}`} disabled={disabled}
      onClick={() => { sfx.pulse(); if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      onBlur={() => setArmed(false)}>
      {armed ? confirm : label}
    </button>
  );
}

function FriendRow({ f, inviteRoom }: { f: Friend; inviteRoom: string | null }) {
  const busy = useFriends((s) => !!s.busy[f.userId] || !!s.busy[`invite:${f.userId}`]);
  const sent = useFriends((s) => s.list?.sent.find((x) => x.to === f.userId && x.target === inviteRoom) ?? null);
  const [going, setGoing] = useState(false);
  const watchable = f.status === 'in_game' && !!f.watchId && (f.watchKind === 'live' || f.watchKind === 'versus');
  const invitable = !!inviteRoom && f.status === 'online' && f.mode !== 'versus_room';
  const inviteLabel = sent?.status === 'pending' ? 'Invited' : sent?.status === 'declined' ? 'Declined' : sent?.status === 'accepted' ? 'Joined' : 'Invite';
  return (
    <div className={`lb-row fr-row fr-${f.status}`}>
      <div className="lb-row-hero"><FriendPortrait card={f} /></div>
      <div className="fr-who">
        <div className="fr-name">{handleOf(f)}</div>
        <div className="fr-status"><span className="fr-dot" aria-hidden="true" />{statusText(f)}</div>
      </div>
      <div className="fr-actions">
        {watchable && (
          <button type="button" className="lb-btn pressable" disabled={going} aria-label={`Watch ${handleOf(f)}`}
            onClick={() => { sfx.pulse(); setGoing(true); void watchFriend(f).finally(() => setGoing(false)); }}>
            <Icon name="eye" />{going ? 'Joining…' : 'Watch'}
          </button>
        )}
        {invitable && (
          <button type="button" className="lb-btn pressable" disabled={busy || sent?.status === 'pending' || sent?.status === 'accepted'}
            aria-label={`Invite ${handleOf(f)} to your Versus room`}
            onClick={() => { sfx.pulse(); void inviteFriend(f.userId, 'versus_room', inviteRoom!); }}>
            {inviteLabel}
          </button>
        )}
        <ConfirmButton label="Remove" confirm="Remove?" disabled={busy} onConfirm={() => void removeFriend(f.userId)} />
        <ConfirmButton label="Block" confirm="Block?" disabled={busy} onConfirm={() => void blockPlayer(f.userId)} />
      </div>
    </div>
  );
}

function RequestRow({ c, incoming }: { c: FriendCard; incoming: boolean }) {
  const busy = useFriends((s) => !!s.busy[c.userId]);
  return (
    <div className="lb-row fr-row fr-request">
      <div className="lb-row-hero"><FriendPortrait card={c} /></div>
      <div className="fr-who">
        <div className="fr-name">{handleOf(c)}</div>
        <div className="fr-status">{incoming ? 'Wants to be friends' : 'Request sent'}</div>
      </div>
      <div className="fr-actions">
        {incoming ? (
          <>
            <button type="button" className="lb-btn pressable" disabled={busy} onClick={() => { sfx.pulse(); void acceptRequest(c.userId); }}>Accept</button>
            <button type="button" className="lb-btn lb-btn-ghost pressable" disabled={busy} onClick={() => { sfx.pulse(); void declineRequest(c.userId); }}>Decline</button>
            <ConfirmButton label="Block" confirm="Block?" disabled={busy} onConfirm={() => void blockPlayer(c.userId)} />
          </>
        ) : (
          <button type="button" className="lb-btn lb-btn-ghost pressable" disabled={busy} onClick={() => { sfx.pulse(); void cancelRequest(c.userId); }}>Cancel</button>
        )}
      </div>
    </div>
  );
}

function BlockedRow({ c }: { c: FriendCard }) {
  const busy = useFriends((s) => !!s.busy[c.userId]);
  return (
    <div className="lb-row fr-row fr-blocked">
      <div className="lb-row-hero"><FriendPortrait card={c} /></div>
      <div className="fr-who"><div className="fr-name">{handleOf(c)}</div><div className="fr-status">Blocked</div></div>
      <div className="fr-actions">
        <button type="button" className="lb-btn lb-btn-ghost pressable" disabled={busy} onClick={() => { sfx.pulse(); void unblockPlayer(c.userId); }}>Unblock</button>
      </div>
    </div>
  );
}

/** The Add by handle field (the top bar). */
function AddByHandle() {
  const [h, setH] = useState('');
  const busy = useFriends((s) => Object.keys(s.busy).some((k) => k.startsWith('handle:')));
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!h.trim() || busy) return;
    sfx.pulse();
    void addFriendByHandle(h).then((ok) => { if (ok) setH(''); });
  };
  return (
    <form className="fr-add" onSubmit={submit}>
      <input className="acctinput acctpanel-input fr-input" value={h} onChange={(e) => setH(e.target.value)} placeholder="Name#1234"
        aria-label="Add a friend by name and tag" maxLength={45} spellCheck={false} autoComplete="off" />
      <button type="submit" className="lb-btn pressable" disabled={busy || !h.trim()}>Add friend</button>
    </form>
  );
}

export function FriendsPage(): JSX.Element | null {
  const show = useGame((s) => s.showFriends);
  const account = useGame((s) => s.account);
  const playerName = useGame((s) => s.playerName);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const isAccount = show && friendsAccount();
  useFriendsListLoop(isAccount);
  const list = useFriends((s) => s.list);
  const failed = useFriends((s) => s.listFailed);
  const deployed = useFriends((s) => s.deployed);
  const flash = useFriends((s) => s.flash);
  // INVITE TO MY VERSUS ROOM: only while I am in a room that is open (between matches).
  const inviteRoom = useVersus((s) => (s.room && s.room.status === 'open' ? versusRoomRef(s.room) : null));
  if (!show) return null;

  // My handle to share (accounts only: a guest cannot be added).
  const myHandle = isAccount && account.discriminator && playerName ? `${playerName}#${account.discriminator}` : null;
  const requests = (list?.incoming.length ?? 0) + (list?.outgoing.length ?? 0);
  const friends = list ? sortFriends(list.friends) : [];
  const online = friends.filter((f) => f.status !== 'offline').length;

  let body: JSX.Element;
  if (!remoteEnabled()) {
    body = <div className="lbempty lb-state"><Icon name="gear" /><div>Friends are unavailable. No backend configured.</div></div>;
  } else if (!account.userId || account.anonymous) {
    // ACCOUNTS ONLY (owner scope 2026-10-26): a guest gets the existing Save account panel.
    body = (
      <div className="lbempty lb-state fr-guest">
        <Icon name="friends" />
        <div>Save your account to add friends.</div>
        <div className="lb-state-sub">Friends need a saved account, so they can find you again on any device.</div>
        <button type="button" className="lb-btn pressable" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Save account</button>
      </div>
    );
  } else if (!deployed) {
    body = <div className="lbempty lb-state"><Icon name="friends" /><div>Friends are not available yet.</div></div>;
  } else if (!list) {
    body = <div className="lbempty lb-state loading"><span className="lb-spin" aria-hidden /><div>{failed ? 'Friends are not available right now.' : 'Finding your friends…'}</div></div>;
  } else {
    body = (
      <>
        {requests > 0 && (
          <section className="fr-section" aria-label="Friend requests">
            <div className="fr-sh">Requests <span className="fr-count">{requests}</span></div>
            <div className="lb-rows">
              {list.incoming.map((c) => <RequestRow key={c.userId} c={c} incoming />)}
              {list.outgoing.map((c) => <RequestRow key={c.userId} c={c} incoming={false} />)}
            </div>
          </section>
        )}
        <section className="fr-section" aria-label="Friends">
          <div className="fr-sh">Friends{friends.length > 0 && <span className="fr-sub">{online} online</span>}</div>
          {friends.length === 0 ? (
            <div className="lbempty lb-state fr-empty">
              <Icon name="friends" />
              <div>No friends yet.</div>
              <div className="lb-state-sub">Add one by name and tag, like Name#1234, or from a player's Career page.</div>
            </div>
          ) : (
            <div className="lb-rows">{friends.map((f) => <FriendRow key={f.userId} f={f} inviteRoom={inviteRoom} />)}</div>
          )}
        </section>
        {list.blocked.length > 0 && (
          <section className="fr-section" aria-label="Blocked players">
            <div className="fr-sh">Blocked</div>
            <div className="lb-rows">{list.blocked.map((c) => <BlockedRow key={c.userId} c={c} />)}</div>
          </section>
        )}
      </>
    );
  }

  return (
    <SidebarHost className="lbpage lb-ladder fr-page">
      <MenuSidebar current="friends" />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="friends" />
          <div>
            <div className="esch disp">Friends</div>
            <div className="lbsub">{myHandle ? `You are ${myHandle}. Share it so friends can add you.` : 'See who is online and invite them to your Versus room.'}</div>
          </div>
        </div>
        {isAccount && deployed && <AddByHandle />}
      </div>
      {flash && <div className="fr-flash" role="status">{flash}</div>}
      <div className="lbscroll">{body}</div>
    </SidebarHost>
  );
}
