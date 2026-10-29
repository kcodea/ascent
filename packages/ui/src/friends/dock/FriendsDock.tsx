/**
 * THE IN-GAME FRIENDS DOCK (owner 2026-10-29: "I want to add a friends list button in game that shows online friends and
 * their status. It can go in the bottom right. It will expand upward and collapse back down, and it will be how we add
 * direct message chats as an overlay. If you click a player, a dm opens with them as an overlay. Clicking out needs to
 * close both menus seamlessly so it isn't clunky."; R-FRIENDS-DOCK-01).
 *
 * THREE PIECES, so messaging slots in later without touching the shell:
 *  - `DockShell` (this component): the corner button with its online count, the open / close motion, and closing on a
 *    press outside or Escape. The panels mount only while open (closed = one button).
 *  - `DockFriendList`: the ONLINE friends (online or in a game) with their live status, the Friends page's own status
 *    line and game chips, Watch where it can. A click opens the direct message; right-click / long press opens the
 *    friend menu (R-FRIENDS-MENU-01).
 *  - `DmPanel`: the friend's header (portrait, name, status), the existing Watch / Invite actions, and the conversation
 *    (`dm/DmConversation.tsx`: the messages and the composer, R-DM-03). A `conversation` override is kept for tests.
 *
 * DIRECT MESSAGES (owner 2026-10-29: "In game messaging should be direct messages through the friends list, click a
 * friend and a chat overlay pops up"; R-DM-03): the button carries the unread count (a red chip, top left), a row its
 * friend's, and the list also shows an OFFLINE friend who has unread messages. On a MENU (no game on screen) there is
 * no button: the Friends page's Message opens the same message panel on its own (`openDm`), closed the same way.
 *
 * WHERE: one slot left of Rules in the corner row (gear, Compendium, Rules, Friends: right to left), in every game
 * screen (lobby, Practice, every Versus mode, Ranked Duos, watching a game or a replay). Accounts only (a guest has no
 * friends). The online count is the presence beat's own answer (no extra call); the list is read only while the dock is
 * open, on the Friends page's loop and pace (R-FRIENDS-05).
 *
 * A PRESS OUTSIDE closes both panels in one motion, and is CAUGHT: a transparent catcher under the panels takes it, so
 * the press that closes the dock never also buys, refreshes, ends the turn or starts a drag (the shop clock is running
 * and those are one-click Gold spends; an accidental spend is worse than one extra click). It closes on pointerdown, so
 * the dock is already collapsing by the time the finger lifts.
 */
import { memo, useEffect, useMemo, type ReactNode } from 'react';
import { Icon } from '../../Icon';
import { sfx } from '../../sfx';
import { isPreRun, useGame } from '../../store';
import { useVersus } from '../../versus/versusStore';
import { versusRoomRef } from '../../versus/versusRemote';
import { friendsAccount, iAmPlaying, inviteFriend, useFriends, useFriendsListLoop } from '../friendsStore';
import { FINISH_FIRST, runFriendMenu } from '../friendsGo';
import { FriendGame, FriendPortrait, friendDetail, handleOf, sortFriends, statusText } from '../FriendsPage';
import { friendMenuEatsClick, friendMenuHandlers } from '../FriendMenu';
import type { Friend } from '../friendsRemote';
import { closeDm, closeDock, closeDockNow, openDm, swallowNextClick, toggleDock, useFriendsDock } from './dockStore';
import { DmConversation } from '../dm/DmConversation';
import { liveFriend, liveFriends, totalUnread, useDm } from '../dm/dmStore';
import '../friends.css';
import './friendsDock.css';

/** Online friends first by status (online, then in a game), then by name: the dock lists nobody offline, except a
 *  friend with unread messages (`unread`), so a message that arrived while they were away can still be opened. */
export function onlineFriends(list: readonly Friend[] | null | undefined, unread: Record<string, number> = {}): Friend[] {
  return list ? sortFriends(list).filter((f) => f.status !== 'offline' || (unread[f.userId.toLowerCase()] ?? 0) > 0) : [];
}

export function FriendsDock(): JSX.Element | null {
  const inGame = useGame((s) => !isPreRun(s) || s.replaying);
  const isAccount = useGame((s) => !!s.account.userId && !s.account.anonymous) && friendsAccount();
  const deployed = useFriends((s) => s.deployed);
  // On a menu, the message panel opened from the Friends page (no button, no list).
  const menuDm = useFriendsDock((s) => s.phase !== 'closed' && !!s.dmWith);
  const show = isAccount && deployed && (inGame || menuDm);
  // The screen went away under an open dock (the game ended, a sign-out): it is closed when it next appears.
  useEffect(() => { if (!show) closeDockNow(); }, [show]);
  // Entering or leaving a game closes a panel that belonged to the other screen.
  useEffect(() => { closeDockNow(); }, [inGame]);
  if (!show) return null;
  return <DockShell menu={!inGame} />;
}

/** The shell: button, panels, outside-press and Escape. */
export function DockShell({ conversation, menu = false }: { conversation?: (friend: Friend) => ReactNode; menu?: boolean } = {}): JSX.Element {
  const phase = useFriendsDock((s) => s.phase);
  const dmWith = useFriendsDock((s) => s.dmWith);
  const online = useFriends((s) => s.inbox?.online ?? 0);
  const unread = useDm((s) => totalUnread(s.unread));
  const open = phase !== 'closed';

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

  return (
    <>
      {open && (
        <div className={`fdock-catch${menu ? ' menu' : ''}`} aria-hidden="true"
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); swallowNextClick(); closeDock(); }}
          onContextMenu={(e) => { e.preventDefault(); closeDock(); }} />
      )}
      {open && (
        <div className={`fdock-stack${phase === 'closing' ? ' closing' : ''}${menu ? ' menu' : ''}`}>
          {dmWith && <DmPanel userId={dmWith} conversation={conversation} />}
          {!menu && <DockFriendList active={phase === 'open'} selected={dmWith} />}
        </div>
      )}
      {!menu && (
        <button type="button" className={`fdock-btn gtip${open ? ' on' : ''}`} data-tip={open ? undefined : 'Friends'}
          aria-label={`Friends${online > 0 ? `, ${online} online` : ''}${unread > 0 ? `, ${unread} unread ${unread === 1 ? 'message' : 'messages'}` : ''}`}
          aria-expanded={phase === 'open'}
          onClick={() => { sfx.pulse(); toggleDock(); }}>
          <Icon name="friends" />
          {online > 0 && <span className="fdock-count" aria-hidden="true">{online > 99 ? '99+' : online}</span>}
          {unread > 0 && <span className="dm-unread" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}
    </>
  );
}

/** The online friends list. Reads the list while `active` (the shared loop: nothing while closed or hidden). */
export function DockFriendList({ active, selected }: { active: boolean; selected: string | null }): JSX.Element {
  useFriendsListLoop(active);
  const list = useFriends((s) => s.list);
  const failed = useFriends((s) => s.listFailed);
  const flash = useFriends((s) => s.flash);
  const peers = useDm((s) => s.peers);
  const unread = useDm((s) => s.unread);
  const friends = onlineFriends(liveFriends(list?.friends, peers), unread);
  let body: JSX.Element;
  if (!list) body = <div className="fdock-empty">{failed ? 'Friends are not available right now.' : 'Finding your friends…'}</div>;
  else if (friends.length === 0) body = <div className="fdock-empty">{list.friends.length === 0 ? 'No friends yet. Add them from the Friends page.' : 'No friends online.'}</div>;
  else body = <div className="fdock-rows" role="list">{friends.map((f) => <DockRow key={f.userId} f={f} selected={selected === f.userId} unread={unread[f.userId.toLowerCase()] ?? 0} />)}</div>;
  return (
    <section className="fdock-panel fdock-list vspanel" aria-label="Friends online">
      <div className="fdock-head">
        <span className="fdock-title">Friends</span>
        <span className="fdock-sub">{`${friends.filter((f) => f.status !== 'offline').length} online`}</span>
      </div>
      {flash && <div className="fr-flash fdock-flash" role="status">{flash}</div>}
      {body}
    </section>
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

/** Watch (when their game can be watched) and Invite (when I am in an open Versus room): the Friends page's own rules. */
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
