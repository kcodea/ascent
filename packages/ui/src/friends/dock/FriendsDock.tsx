/**
 * THE FRIENDS DOCK: ONE global dock, BOTTOM RIGHT, on every screen (owner 2026-10-29, R-FRIENDS-DOCK-05: "move the
 * friends thing to the bottom right instead i guess because this looks super sloppy how this looks. i want the friend
 * button to like expand into the list/collapse back down"; after R-FRIENDS-DOCK-02's bottom-left dock and
 * R-FRIENDS-DOCK-03 / -04's per-menu slots).
 *
 * WHERE: mounted ONCE in `Game` (never per screen), so it is the same instance on the title, every menu page, hero
 * select, every game mode, spectating and replays: open or closed, the tab and an open message all survive a screen
 * change. The button is the fourth square of the bottom-right corner row, one slot left of Rules (gear, Compendium,
 * Rules, Friends, right to left), wearing the same plaque at the same size on every screen (`friendsDock.css` has the
 * slot per framing). Where that row is covered it takes the corner itself (`dockCorner`): hero select, a side-menu
 * page and the in-game menu all lie over the whole row, and a phone's side-menu screens lift Rules and the Compendium to
 * the top.
 *
 * THE PIECES:
 *  - `DockShell`: the corner button (online count, top right; unread messages + friend requests waiting, the red chip,
 *    top left), the open / close motion, and closing on a press outside or Escape. The panel mounts only while open
 *    (closed = one button, no list read).
 *  - ONE PANEL that grows out of the button: its bottom-right corner sits on the button's, it rises up and to the left,
 *    and the button stays where it was as the right end of the panel's title bar (the bar runs along the panel's foot:
 *    "Friends", the online count, my handle, then the button, now showing a collapse chevron). Pressing it again sinks
 *    the panel back into the button.
 *  - `FriendsPanel`: what the old Friends page did, in tabs (the Career page's `.cv2-tabs` pill): Friends (Add by
 *    handle, then every friend: online, in a game, then offline with last seen; a click opens the chat window, right-
 *    click / long press opens the friend menu, R-FRIENDS-MENU-01), Requests (incoming Accept / Decline / Block, sent
 *    Cancel) and Blocked (Unblock; only while someone is blocked).
 *  - `GuestPanel`: a guest (or no session) sees "Sign in to add friends." and the existing account panel.
 *  - `ChatWindow` (`../dm/ChatWindow.tsx`, R-DM-CHAT-01 / -02): pressing a friend opens the chat window, one tab per
 *    conversation; the list collapses as it opens. It can be moved, resized and pinned open while playing.
 *
 * A PRESS OUTSIDE closes the list, and is CAUGHT: a transparent catcher under the panel takes it, so the press that
 * closes the dock never also buys, refreshes, ends the turn, starts a drag or presses a menu button. It closes on
 * pointerdown, so the dock is already collapsing by the time the finger lifts.
 *
 * MOTION: one-shot transform + opacity only (the panel scales out of the button's corner and back into it); nothing
 * loops, nothing is measured. COST: the online count is the presence beat's own answer and the unread counts the hub's
 * (no call of their own); the list is read only while the panel is open, on the shared 60 s loop (R-FRIENDS-05).
 */
import { memo, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { GameScroll } from '../../GameScroll';
import { Icon } from '../../Icon';
import { remoteEnabled } from '../../remoteBoards';
import { sfx } from '../../sfx';
import { anyPageOpen, isPreRun, useGame } from '../../store';
import { useVersus } from '../../versus/versusStore';
import { versusRoomRef } from '../../versus/versusRemote';
import {
  acceptRequest, addFriendByHandle, blockPlayer, cancelRequest, declineRequest, iAmPlaying, inviteFriend, unblockPlayer,
  useFriends, useFriendsListLoop,
} from '../friendsStore';
import { FINISH_FIRST, runFriendMenu } from '../friendsGo';
import { ActivityDetail, ConfirmButton, FriendGame, FriendPortrait, friendDetail, handleOf, sortFriends, statusText } from '../friendBits';
import { friendMenuEatsClick, friendMenuHandlers, useFriendMenu } from '../FriendMenu';
import type { Friend, FriendCard } from '../friendsRemote';
import { closeDock, closeDockNow, openDm, setDockTab, swallowNextClick, toggleDock, useFriendsDock, type DockTab } from './dockStore';
import { ChatWindow } from '../dm/ChatWindow';
import { liveFriends, totalUnread, useDm } from '../dm/dmStore';
import '../friends.css';
import './friendsDock.css';

type GameState = ReturnType<typeof useGame.getState>;

/** Every friend for the dock's list: online, then in a game, then offline (each by name). */
export function dockFriends(list: readonly Friend[] | null | undefined): Friend[] {
  return list ? sortFriends(list) : [];
}

/**
 * Which slot of the corner row the button takes (friendsDock.css): '' = slot 3, left of Rules; 'corner' = slot 0, the
 * corner itself, while something lies over the whole row (hero select, a side-menu page, the in-game menu). One string,
 * so the dock re-renders only when it changes.
 */
export const dockCorner = (s: Pick<GameState, 'showCareer' | 'showRankings' | 'showLeaderboard' | 'showRecentGames' | 'showLiveGames' | 'showCollection' | 'settingsOpen' | 'showPatchNotes' | 'gameMenuOpen' | 'heroChoices'>): '' | 'corner' =>
  (anyPageOpen(s) || s.gameMenuOpen || s.heroChoices !== null ? 'corner' : '');

/** Whether the dock's button is on screen: a backend, and either a guest or a server with friends deployed. */
function useDockShown(): boolean {
  const guest = useGame((s) => !s.account.userId || s.account.anonymous);
  const deployed = useFriends((s) => s.deployed);
  return remoteEnabled() && (guest || deployed);
}

/**
 * THE DEV CORNER SQUARES (DEV only, R-DEV-CORNER-01): the corner-row slot of the FIRST dev square (the dev tuner; the
 * minimized Scene Builder takes the next one). They queue up left of Friends: slot 4 beside it, 3 when there is no
 * Friends button, and down at the corner with it (1, or 0 without it) where the row is covered (`dockCorner`).
 */
export const devCornerSlot = (dockShown: boolean, corner: '' | 'corner'): number => (corner ? 0 : 3) + (dockShown ? 1 : 0);

/** `devCornerSlot` for the live screen (styles.css `.cornerdev` reads it as `--cd-slot`). */
export function useDevCornerSlot(): number {
  const shown = useDockShown();
  const corner = useGame(dockCorner);
  return devCornerSlot(shown, corner);
}

/** The dock, on every screen. Nothing without a backend, or once the server said friends are not deployed. */
export function FriendsDock(): JSX.Element | null {
  const userId = useGame((s) => s.account.userId);
  const anonymous = useGame((s) => s.account.anonymous);
  const guest = !userId || anonymous;
  // In a run (or a replay / a watched game) the chat's veil barely dims (the game keeps running underneath).
  const inGame = useGame((s) => !isPreRun(s) || s.replaying);
  const slot = useGame(dockCorner);
  const shown = useDockShown();
  // A different identity (a sign-in, a sign-out, a guest saved): whatever was open belonged to the other one.
  useEffect(() => { closeDockNow(); }, [userId, anonymous]);
  if (!shown) return null;
  return <DockShell guest={guest} inGame={inGame} slot={slot} />;
}

/** The shell: the corner button, the panel that grows out of it, outside-press and Escape. */
export function DockShell({ conversation, guest = false, inGame = false, slot = '' }: { conversation?: (friend: Friend) => ReactNode; guest?: boolean; inGame?: boolean; slot?: '' | 'corner' } = {}): JSX.Element {
  const phase = useFriendsDock((s) => s.phase);
  const dmWith = useFriendsDock((s) => s.dmWith);
  const online = useFriends((s) => (guest ? 0 : s.inbox?.online ?? 0));
  const requests = useFriends((s) => (guest ? 0 : s.inbox?.incoming ?? 0));
  const unread = useDm((s) => (guest ? 0 : totalUnread(s.unread)));
  const open = phase !== 'closed';
  const waiting = unread + requests;
  const corner = slot ? ` ${slot}` : '';

  // Escape closes the list (capture: the same press must not also open the Esc menu underneath).
  useEffect(() => {
    if (phase !== 'open') return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // The friend menu over the dock takes this Escape (its own listener closes just it): the dock stays open.
      if (useFriendMenu.getState().friend) return;
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
        <div className={`fdock-stack${phase === 'closing' ? ' closing' : ''}${corner}`}>
          {guest ? <GuestPanel /> : <FriendsPanel active={phase === 'open'} selected={dmWith} />}
        </div>
      )}
      {!guest && <ChatWindow inGame={inGame} conversation={conversation} />}
      {/* The button: closed, the corner square with its counts; open, the right end of the panel's title bar showing a
          collapse chevron (the panel grows out of it and sinks back into it). */}
      <button type="button" className={`fdock-btn gtip${open ? ' on' : ''}${corner}`} data-tip={open ? undefined : 'Friends'}
        aria-label={phase === 'open' ? `${label}. Collapse` : label} aria-expanded={phase === 'open'}
        onClick={() => { sfx.pulse(); toggleDock(); }}>
        <Icon name={phase === 'open' ? 'chevron' : 'friends'} />
        {!open && (online > 0 || waiting > 0) && (
          <span className="fdock-chips" aria-hidden="true">
            {online > 0 && <span className="fdock-count">{online > 99 ? '99+' : online}</span>}
            {waiting > 0 && <span className="dm-unread">{waiting > 99 ? '99+' : waiting}</span>}
          </span>
        )}
      </button>
    </>
  );
}

/** A guest (or no session): one line and the existing account panel (owner scope 2026-10-26: friends are for accounts). */
function GuestPanel(): JSX.Element {
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  return (
    <section className="fdock-panel fdock-list fdock-guest vspanel" aria-label="Friends">
      <div className="fdock-empty">
        <div>Sign in to add friends.</div>
        <div className="fdock-emptysub">Friends need a saved account, so they can find you on any device.</div>
        <button type="button" className="lb-btn pressable fdock-signin" onClick={() => { sfx.pulse(); closeDockNow(); openAccountPanel(); }}>Sign in</button>
      </div>
      <PanelBar />
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
        <GameScroll className="fdock-rows" outerClassName="fdock-rows-wrap" role="list" aria-label="Friend requests">
          {list.incoming.map((c) => <RequestRow key={c.userId} c={c} incoming />)}
          {list.outgoing.map((c) => <RequestRow key={c.userId} c={c} incoming={false} />)}
        </GameScroll>
      );
  } else if (tab === 'blocked') {
    body = blocked === 0
      ? <div className="fdock-empty">Nobody is blocked.</div>
      : <GameScroll className="fdock-rows" outerClassName="fdock-rows-wrap" role="list" aria-label="Blocked players">{list.blocked.map((c) => <BlockedRow key={c.userId} c={c} />)}</GameScroll>;
  } else {
    body = friends.length === 0
      ? <div className="fdock-empty">No friends yet.<div className="fdock-emptysub">Add one by name and tag, like Name#1234.</div></div>
      : (
        <GameScroll className="fdock-rows" outerClassName="fdock-rows-wrap" role="list" aria-label="Friends">
          {friends.map((f) => <DockRow key={f.userId} f={f} selected={selected === f.userId} unread={unread[f.userId.toLowerCase()] ?? 0} />)}
        </GameScroll>
      );
  }
  return (
    <section className="fdock-panel fdock-list vspanel" aria-label="Friends">
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
      <PanelBar>
        {list && <span className="fdock-sub">{`${online} online`}</span>}
        {myHandle && <span className="fdock-me" aria-label={`You are ${myHandle}. Share it so friends can add you.`}>{myHandle}</span>}
      </PanelBar>
    </section>
  );
}

/** The panel's title bar, along its foot: the title and its details, then the room the corner button sits in. */
function PanelBar({ children }: { children?: ReactNode }): JSX.Element {
  return (
    <div className="fdock-head fdock-bar">
      <span className="fdock-title">Friends</span>
      {children}
      <span className="fdock-btnroom" aria-hidden="true" />
    </div>
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
            {f.status === 'online' && f.activity && <ActivityDetail activity={f.activity} />}
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
