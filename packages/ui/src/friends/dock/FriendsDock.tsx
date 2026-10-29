/**
 * THE FRIENDS DOCK: ONE global dock, bottom left, on every screen (owner 2026-10-29: "Move the friends panel to the bottom
 * left, and then move the friends panel from the menu into the in game panel. Aka just have the in game friends
 * expand/collapse panel moved to the bottom left and be shown at all times in game through menus and in game etc. you
 * can then remove the friends area in the menus since it's redundant"; R-FRIENDS-DOCK-02, after R-FRIENDS-DOCK-01's
 * first in-game version: "It will expand upward and collapse back down ... Clicking out needs to close both menus
 * seamlessly so it isn't clunky.").
 *
 * WHERE: mounted ONCE in `Game` (never per screen), so it is the same instance on the title, every menu page, hero
 * select, every game mode, spectating and replays: open or closed, the tab and an open message all survive a screen
 * change. The button sits at the very bottom-left corner (`friendsDock.css` has the placement per framing, clear of the
 * in-game hero portrait, the side menu's Settings plaque and the title's footer links); the panels rise above it.
 *
 * THE PIECES:
 *  - `DockShell`: the corner button (online count, top right; unread messages + friend requests waiting, the red chip,
 *    top left), the open / close motion, and closing on a press outside or Escape. The panels mount only while open
 *    (closed = one button, no list read).
 *  - `FriendsPanel`: what the old Friends page did, in tabs (the Career page's `.cv2-tabs` pill): Friends (my handle to
 *    share, Add by handle, then every friend: online, in a game, then offline with last seen; a click opens the direct
 *    message, right-click / long press opens the friend menu, R-FRIENDS-MENU-01), Requests (incoming Accept / Decline /
 *    Block, sent Cancel) and Blocked (Unblock; only while someone is blocked).
 *  - `GuestPanel`: a guest (or no session) sees "Sign in to add friends." and the existing account panel.
 *  - `DmPanel`: the friend's header, Watch / Invite, and the conversation (R-DM-03), beside the list.
 *
 * A PRESS OUTSIDE closes both panels in one motion, and is CAUGHT: a transparent catcher under the panels takes it, so
 * the press that closes the dock never also buys, refreshes, ends the turn, starts a drag or presses a menu button. It
 * closes on pointerdown, so the dock is already collapsing by the time the finger lifts.
 *
 * COST: the online count is the presence beat's own answer and the unread counts the hub's (no call of their own); the
 * list is read only while the panel is open, on the shared 60 s loop (R-FRIENDS-05).
 */
import { memo, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../Icon';
import { remoteEnabled } from '../../remoteBoards';
import { sfx } from '../../sfx';
import { isPreRun, useGame } from '../../store';
import { useVersus } from '../../versus/versusStore';
import { versusRoomRef } from '../../versus/versusRemote';
import {
  acceptRequest, addFriendByHandle, blockPlayer, cancelRequest, declineRequest, iAmPlaying, inviteFriend, unblockPlayer,
  useFriends, useFriendsListLoop,
} from '../friendsStore';
import { FINISH_FIRST, runFriendMenu } from '../friendsGo';
import { ConfirmButton, FriendGame, FriendPortrait, friendDetail, handleOf, sortFriends, statusText } from '../friendBits';
import { friendMenuEatsClick, friendMenuHandlers } from '../FriendMenu';
import type { Friend, FriendCard } from '../friendsRemote';
import { closeDm, closeDock, closeDockNow, openDm, setDockTab, swallowNextClick, toggleDock, useFriendsDock, type DockTab } from './dockStore';
import { DmConversation } from '../dm/DmConversation';
import { liveFriend, liveFriends, totalUnread, useDm } from '../dm/dmStore';
import '../friends.css';
import './friendsDock.css';

/** Every friend for the dock's list: online, then in a game, then offline (each by name). */
export function dockFriends(list: readonly Friend[] | null | undefined): Friend[] {
  return list ? sortFriends(list) : [];
}

/** The dock, on every screen. Nothing without a backend, or once the server said friends are not deployed. */
export function FriendsDock(): JSX.Element | null {
  const userId = useGame((s) => s.account.userId);
  const anonymous = useGame((s) => s.account.anonymous);
  const deployed = useFriends((s) => s.deployed);
  const guest = !userId || anonymous;
  // A different identity (a sign-in, a sign-out, a guest saved): whatever was open belonged to the other one.
  useEffect(() => { closeDockNow(); }, [userId, anonymous]);
  if (!remoteEnabled() || (!guest && !deployed)) return null;
  return <DockShell guest={guest} />;
}

/** The shell: button, panels, outside-press and Escape. */
export function DockShell({ conversation, guest = false }: { conversation?: (friend: Friend) => ReactNode; guest?: boolean } = {}): JSX.Element {
  const phase = useFriendsDock((s) => s.phase);
  const dmWith = useFriendsDock((s) => s.dmWith);
  const online = useFriends((s) => (guest ? 0 : s.inbox?.online ?? 0));
  const requests = useFriends((s) => (guest ? 0 : s.inbox?.incoming ?? 0));
  const unread = useDm((s) => (guest ? 0 : totalUnread(s.unread)));
  const open = phase !== 'closed';
  const waiting = unread + requests;

  // Escape closes both (capture: the same press must not also open the Esc menu underneath).
  useEffect(() => {
    if (phase !== 'open') return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeDock();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase]);

  const label = ['Friends',
    online > 0 ? `${online} online` : '',
    requests > 0 ? `${requests} friend ${requests === 1 ? 'request' : 'requests'}` : '',
    unread > 0 ? `${unread} unread ${unread === 1 ? 'message' : 'messages'}` : '',
  ].filter(Boolean).join(', ');

  return (
    <>
      {open && (
        <div className="fdock-catch" aria-hidden="true"
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); swallowNextClick(); closeDock(); }}
          onContextMenu={(e) => { e.preventDefault(); closeDock(); }} />
      )}
      {open && (
        <div className={`fdock-stack${phase === 'closing' ? ' closing' : ''}`}>
          {guest ? <GuestPanel /> : <FriendsPanel active={phase === 'open'} selected={dmWith} />}
          {!guest && dmWith && <DmPanel userId={dmWith} conversation={conversation} />}
        </div>
      )}
      <button type="button" className={`fdock-btn gtip${open ? ' on' : ''}`} data-tip={open ? undefined : 'Friends'}
        aria-label={label} aria-expanded={phase === 'open'}
        onClick={() => { sfx.pulse(); toggleDock(); }}>
        <Icon name="friends" />
        {online > 0 && <span className="fdock-count" aria-hidden="true">{online > 99 ? '99+' : online}</span>}
        {waiting > 0 && <span className="dm-unread" aria-hidden="true">{waiting > 99 ? '99+' : waiting}</span>}
      </button>
    </>
  );
}

/** A guest (or no session): one line and the existing account panel (owner scope 2026-10-26: friends are for accounts). */
function GuestPanel(): JSX.Element {
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  return (
    <section className="fdock-panel fdock-list fdock-guest vspanel" aria-label="Friends">
      <div className="fdock-head"><span className="fdock-title">Friends</span></div>
      <div className="fdock-empty">
        <div>Sign in to add friends.</div>
        <div className="fdock-emptysub">Friends need a saved account, so they can find you on any device.</div>
        <button type="button" className="lb-btn pressable fdock-signin" onClick={() => { sfx.pulse(); closeDockNow(); openAccountPanel(); }}>Sign in</button>
      </div>
    </section>
  );
}

/** The panel: header, tabs, body. Reads the list while `active` (the shared loop: nothing while closed or hidden). */
export function FriendsPanel({ active, selected }: { active: boolean; selected: string | null }): JSX.Element {
  useFriendsListLoop(active);
  const tab = useFriendsDock((s) => s.tab);
  const list = useFriends((s) => s.list);
  const failed = useFriends((s) => s.listFailed);
  const flash = useFriends((s) => s.flash);
  const peers = useDm((s) => s.peers);
  const unread = useDm((s) => s.unread);
  const discriminator = useGame((s) => s.account.discriminator);
  const playerName = useGame((s) => s.playerName);
  const friends = useMemo(() => dockFriends(liveFriends(list?.friends, peers)), [list, peers]);
  const online = friends.filter((f) => f.status !== 'offline').length;
  const requests = (list?.incoming.length ?? 0) + (list?.outgoing.length ?? 0);
  const blocked = list?.blocked.length ?? 0;
  const myHandle = discriminator && playerName ? `${playerName}#${discriminator}` : null;
  // Blocked shows as a tab only while someone is in it (or it is the tab already open).
  const tabs: { id: DockTab; label: string; count?: number }[] = [
    { id: 'friends', label: 'Friends' },
    { id: 'requests', label: 'Requests', count: list?.incoming.length ?? 0 },
    ...(blocked > 0 || tab === 'blocked' ? [{ id: 'blocked' as const, label: 'Blocked' }] : []),
  ];

  let body: JSX.Element;
  if (!list) body = <div className="fdock-empty">{failed ? 'Friends are not available right now.' : 'Finding your friends…'}</div>;
  else if (tab === 'requests') {
    body = requests === 0
      ? <div className="fdock-empty">No friend requests.</div>
      : (
        <div className="fdock-rows" role="list" aria-label="Friend requests">
          {list.incoming.map((c) => <RequestRow key={c.userId} c={c} incoming />)}
          {list.outgoing.map((c) => <RequestRow key={c.userId} c={c} incoming={false} />)}
        </div>
      );
  } else if (tab === 'blocked') {
    body = blocked === 0
      ? <div className="fdock-empty">Nobody is blocked.</div>
      : <div className="fdock-rows" role="list" aria-label="Blocked players">{list.blocked.map((c) => <BlockedRow key={c.userId} c={c} />)}</div>;
  } else {
    body = friends.length === 0
      ? <div className="fdock-empty">No friends yet.<div className="fdock-emptysub">Add one by name and tag, like Name#1234.</div></div>
      : (
        <div className="fdock-rows" role="list" aria-label="Friends">
          {friends.map((f) => <DockRow key={f.userId} f={f} selected={selected === f.userId} unread={unread[f.userId.toLowerCase()] ?? 0} />)}
        </div>
      );
  }
  return (
    <section className="fdock-panel fdock-list vspanel" aria-label="Friends">
      <div className="fdock-head">
        <span className="fdock-title">Friends</span>
        {list && <span className="fdock-sub">{`${online} online`}</span>}
        {myHandle && <span className="fdock-me" aria-label={`You are ${myHandle}. Share it so friends can add you.`}>{myHandle}</span>}
      </div>
      <div className="cv2-tabs fdock-tabs" role="tablist" aria-label="Friends view">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className={`cv2-tab${tab === t.id ? ' on' : ''}`} aria-selected={tab === t.id}
            onClick={() => { if (tab !== t.id) { sfx.pulse(); setDockTab(t.id); } }}>
            {t.label}
            {t.count ? <span className="fr-count" aria-label={`${t.count} waiting`}>{t.count}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'friends' && list && <AddByHandle />}
      {flash && <div className="fr-flash fdock-flash" role="status">{flash}</div>}
      {body}
    </section>
  );
}

/** Add by handle ("Name#1234"), the old Friends page's top bar field. */
function AddByHandle(): JSX.Element {
  const [h, setH] = useState('');
  const busy = useFriends((s) => Object.keys(s.busy).some((k) => k.startsWith('handle:')));
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (!h.trim() || busy) return;
    sfx.pulse();
    void addFriendByHandle(h).then((ok) => { if (ok) setH(''); });
  };
  return (
    <form className="fdock-add" onSubmit={submit}>
      <input className="acctinput acctpanel-input fr-input fdock-addinput" value={h} onChange={(e) => setH(e.target.value)} placeholder="Name#1234"
        aria-label="Add a friend by name and tag" maxLength={45} spellCheck={false} autoComplete="off" />
      <button type="submit" className="lb-btn pressable fr-small" disabled={busy || !h.trim()}>Add friend</button>
    </form>
  );
}

const DockRow = memo(function DockRow({ f, selected, unread }: { f: Friend; selected: boolean; unread: number }) {
  const tip = friendDetail(f);
  const menu = friendMenuHandlers(f);
  return (
    <div role="listitem" className={`fdock-row fr-${f.status}${selected ? ' sel' : ''}`}>
      <div role="button" tabIndex={0} className="fdock-rowmain" aria-pressed={selected}
        aria-label={unread > 0 ? `Message ${handleOf(f)}, ${unread} unread` : `Message ${handleOf(f)}`}
        {...menu}
        onClick={() => { if (friendMenuEatsClick()) return; sfx.pulse(); openDm(f.userId); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sfx.pulse(); openDm(f.userId); } }}>
        <span className="fdock-portrait"><FriendPortrait card={f} /></span>
        <span className="fr-who">
          <span className="fr-name">{handleOf(f)}</span>
          <span className="fr-detail" data-tip={tip ?? undefined}>
            <span className="fr-status"><span className="fr-dot" aria-hidden="true" /><span className="fr-statustext">{statusText(f)}</span></span>
            {f.status === 'in_game' && f.game && <FriendGame game={f.game} />}
          </span>
        </span>
        {unread > 0 && <span className="dm-unread" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </div>
      <FriendActions f={f} compact />
    </div>
  );
});

/** An incoming request (Accept / Decline / Block, which asks once more) or a sent one (Cancel). */
function RequestRow({ c, incoming }: { c: FriendCard; incoming: boolean }): JSX.Element {
  const busy = useFriends((s) => !!s.busy[c.userId]);
  return (
    <div role="listitem" className="fdock-row fdock-cardrow fr-request">
      <span className="fdock-portrait"><FriendPortrait card={c} /></span>
      <span className="fr-who">
        <span className="fr-name">{handleOf(c)}</span>
        <span className="fr-status">{incoming ? 'Wants to be friends' : 'Request sent'}</span>
      </span>
      <div className="fdock-actions compact">
        {incoming ? (
          <>
            <button type="button" className="lb-btn pressable fr-small" disabled={busy} onClick={() => { sfx.pulse(); void acceptRequest(c.userId); }}>Accept</button>
            <button type="button" className="lb-btn lb-btn-ghost pressable fr-small" disabled={busy} onClick={() => { sfx.pulse(); void declineRequest(c.userId); }}>Decline</button>
            <ConfirmButton label="Block" confirm="Block?" disabled={busy} onConfirm={() => void blockPlayer(c.userId)} />
          </>
        ) : (
          <button type="button" className="lb-btn lb-btn-ghost pressable fr-small" disabled={busy} onClick={() => { sfx.pulse(); void cancelRequest(c.userId); }}>Cancel</button>
        )}
      </div>
    </div>
  );
}

function BlockedRow({ c }: { c: FriendCard }): JSX.Element {
  const busy = useFriends((s) => !!s.busy[c.userId]);
  return (
    <div role="listitem" className="fdock-row fdock-cardrow fr-blocked">
      <span className="fdock-portrait"><FriendPortrait card={c} /></span>
      <span className="fr-who"><span className="fr-name">{handleOf(c)}</span><span className="fr-status">Blocked</span></span>
      <div className="fdock-actions compact">
        <button type="button" className="lb-btn lb-btn-ghost pressable fr-small" disabled={busy} onClick={() => { sfx.pulse(); void unblockPlayer(c.userId); }}>Unblock</button>
      </div>
    </div>
  );
}

/** Watch (when their game can be watched) and Invite (when I am in an open Versus room): the old Friends page's rules. */
export function FriendActions({ f, compact }: { f: Friend; compact?: boolean }): JSX.Element | null {
  const inviteRoom = useVersus((s) => (s.room && s.room.status === 'open' ? versusRoomRef(s.room) : null));
  const inviteKind = useVersus((s) => (s.room?.options?.mode === 'ranked_duos' ? 'duos_party' as const : 'versus_room' as const));
  const busy = useFriends((s) => !!s.busy[`invite:${f.userId}`]);
  const sent = useFriends((s) => s.list?.sent.find((x) => x.to === f.userId && x.target === inviteRoom) ?? null);
  // Watching from inside my OWN game would abandon it, so Watch waits until it is over (watching someone, I may
  // switch). The two store reads only re-render the row when that can change.
  const inRun = useGame((s) => !isPreRun(s) || s.replaying);
  const roomStatus = useVersus((s) => s.room?.status ?? null);
  const playing = (inRun || roomStatus === 'in_game') && iAmPlaying();
  const watchable = f.status === 'in_game' && !!f.watchId && (f.watchKind === 'live' || f.watchKind === 'versus');
  const invitable = !!inviteRoom && f.status === 'online' && f.mode !== 'versus_room';
  if (!watchable && !invitable) return null;
  const inviteLabel = sent?.status === 'pending' ? 'Invited' : sent?.status === 'declined' ? 'Declined' : sent?.status === 'accepted' ? 'Joined' : 'Invite';
  return (
    <div className={`fdock-actions${compact ? ' compact' : ''}`}>
      {watchable && (
        <button type="button" className={`lb-btn pressable fr-small${playing ? ' gtip' : ''}`} disabled={playing}
          data-tip={playing ? FINISH_FIRST : undefined} aria-label={playing ? `Watch ${handleOf(f)}. ${FINISH_FIRST}` : `Watch ${handleOf(f)}`}
          onClick={(e) => { e.stopPropagation(); sfx.pulse(); closeDock(); void runFriendMenu('spectate', f); }}>
          <Icon name="eye" />Watch
        </button>
      )}
      {invitable && (
        <button type="button" className="lb-btn pressable fr-small" disabled={busy || sent?.status === 'pending' || sent?.status === 'accepted'}
          aria-label={`Invite ${handleOf(f)} to your room`}
          onClick={(e) => { e.stopPropagation(); sfx.pulse(); void inviteFriend(f.userId, inviteKind, inviteRoom!); }}>
          {inviteLabel}
        </button>
      )}
    </div>
  );
}

/**
 * THE DIRECT MESSAGE PANEL (beside the list). The friend's header and actions are live from the list (with the hub's
 * live presence over it); the conversation is the messages and the composer (R-DM-03). `conversation` replaces the
 * whole conversation (tests).
 */
export function DmPanel({ userId, conversation }: { userId: string; conversation?: (friend: Friend) => ReactNode }): JSX.Element | null {
  const listed = useFriends((s) => s.list?.friends.find((x) => x.userId === userId) ?? null);
  const peers = useDm((s) => s.peers);
  // The panel can open before any friends surface read the list (a toast on a menu): read it now.
  useFriendsListLoop(!listed);
  const f = useMemo(() => (listed ? liveFriend(listed, peers) : null), [listed, peers]);
  if (!f) return null;
  return (
    <section className="fdock-panel fdock-dm vspanel" aria-label={`Messages with ${handleOf(f)}`}>
      <header className={`fdock-dmhead fr-${f.status}`}>
        <span className="fdock-portrait"><FriendPortrait card={f} /></span>
        <span className="fr-who">
          <span className="fr-name">{handleOf(f)}</span>
          <span className="fr-status"><span className="fr-dot" aria-hidden="true" /><span className="fr-statustext">{statusText(f)}</span></span>
          {f.status === 'in_game' && f.game && <FriendGame game={f.game} />}
        </span>
        <button type="button" className="fdock-x pressable" aria-label="Close messages" onClick={() => { sfx.pulse(); closeDm(); }}>
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <FriendActions f={f} />
      {conversation ? <div className="fdock-convo" role="log" aria-label="Conversation">{conversation(f)}</div> : <DmConversation friend={f} />}
    </section>
  );
}
