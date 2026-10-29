/**
 * THE CHAT WINDOW (owner 2026-10-29, R-DM-CHAT-01: "the chat should open as a larger overlay in the center of the
 * screen, and should have tabs that hold all conversations"; R-DM-CHAT-02: "let me move the chat panel around, resize
 * it, and pin it so that it stays while i play if i want it up"). Pressing a friend in the dock (or a new-message toast)
 * opens it on that friend; the friends list collapses, so one surface is up at a time.
 *
 *  - THE TABS, across the top: one per conversation, every friend I opened this session (in the order I opened them)
 *    and then every friend with unread messages. Each shows the friend's portrait, name and unread count, and has its
 *    own close. Closing a tab with unread messages reads them (I chose to put that conversation away). Closing the
 *    last tab closes the window.
 *  - THE CONVERSATION: the friend's header (portrait, name, live status, their game line), Watch / Invite, then the
 *    messages and the composer (`DmConversation`, R-DM-03), all much bigger than the old card beside the list.
 *  - MOVE: drag the tab strip or the conversation's header (a press that moves less than a few px is still a click on
 *    a tab or a button). RESIZE: the four edges and four corners. Both stay inside the screen, and the window is put back
 *    inside it when the screen shrinks. Where I leave it, its size and the pin are kept on this device
 *    (`chatWindowPrefs.ts`).
 *  - PIN: pinned, the window stays up while I play: no veil, Escape and a press outside leave it alone, the game takes
 *    every press outside its rect, and it rides through shop / combat and every screen change (it lives in the dock's
 *    shell, the one instance in `Game`). It sits under the Friends button, the dock's list and the toast, so they stay
 *    reachable. Unpinned is the overlay of R-DM-CHAT-01: the close button, Escape (capture: it never also opens the
 *    Esc menu) or a press on the veil (caught: it never reaches the board or a menu button) closes it; in a game the veil
 *    barely dims.
 *  - A PHONE keeps the full-screen window: no move, no resize, no pin (a pinned full-screen window would hide the game).
 *
 * COST: a drag moves the frame by `transform` only, written straight to the element (no React render, no layout read);
 * a resize draws a ghost outline and commits the size once, on release. Messages arriving re-render this window only,
 * never the game. Motion: one-shot transform + opacity on open; nothing loops. Cursors: the gauntlet (CLAUDE.md).
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from '../../Icon';
import { sfx } from '../../sfx';
import { onStageChange, stageViewport, toStage } from '../../stage';
import { closeChatTab, closeDm, openDm, swallowNextClick, useFriendsDock } from '../dock/dockStore';
import { useFriendMenu } from '../FriendMenu';
import { FriendGame, FriendPortrait, handleOf, statusText } from '../friendBits';
import type { Friend } from '../friendsRemote';
import { useFriends, useFriendsListLoop } from '../friendsStore';
import { DmConversation } from './DmConversation';
import { liveFriend, markRead, useDm } from './dmStore';
import { FriendActions } from '../dock/FriendsDock';
import {
  CHAT_EDGES, clampChatGeom, defaultChatGeom, moveChatGeom, resizeChatGeom, setChatGeom, setChatPinned, useChatWindow, type ChatEdge, type ChatGeom,
} from './chatWindowPrefs';
import './dm.css';

/** A phone: the full-screen window (dm.css), no move / resize / pin. Read from the stage's own flags (no layout read). */
const phoneChat = (): boolean => typeof document !== 'undefined'
  && document.documentElement.hasAttribute('data-touch-ui') && document.documentElement.hasAttribute('data-touch-small');

/** A press that travels this far (stage px) on the strip / header is a move, not a click. */
const MOVE_SLOP = 5;

const low = (s: string): string => s.toLowerCase();

/**
 * The window's tabs, in order: this session's conversations (as opened), then friends with unread messages not already
 * there. Only friends still on my list (a removed friend's tab goes).
 */
export function chatTabOrder(session: readonly string[], unread: Readonly<Record<string, number>>, friends: readonly Pick<Friend, 'userId'>[] | null | undefined): string[] {
  const known = new Map((friends ?? []).map((f) => [low(f.userId), f.userId]));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (id: string): void => {
    const k = low(id);
    const real = known.get(k);
    if (!real || seen.has(k)) return;
    seen.add(k);
    out.push(real);
  };
  session.forEach(add);
  Object.entries(unread).filter(([, n]) => n > 0).forEach(([id]) => add(id));
  return out;
}

export function ChatWindow({ inGame = false, conversation }: { inGame?: boolean; conversation?: (friend: Friend) => ReactNode }): JSX.Element | null {
  const dmWith = useFriendsDock((s) => s.dmWith);
  const session = useFriendsDock((s) => s.chatTabs);
  const friends = useFriends((s) => s.list?.friends ?? null);
  const unread = useDm((s) => s.unread);
  const peers = useDm((s) => s.peers);
  const saved = useChatWindow((s) => s.geom);
  const pinPref = useChatWindow((s) => s.pinned);
  const phone = phoneChat();
  const pinned = pinPref && !phone;
  // Opened from a toast before any friends surface read the list: read it now (the shared loop, only while needed).
  useFriendsListLoop(!!dmWith && !friends);
  const tabs = useMemo(() => chatTabOrder(session, unread, friends), [session, unread, friends]);
  const active = dmWith ? friends?.find((f) => low(f.userId) === low(dmWith)) ?? null : null;
  const live = useMemo(() => (active ? liveFriend(active, peers) : null), [active, peers]);

  // The view the window keeps inside: read on open and on a stage change (a window resize, a rotation), never per frame.
  const [view, setView] = useState(stageViewport);
  useEffect(() => {
    if (!dmWith) return undefined;
    setView(stageViewport());
    return onStageChange(() => setView(stageViewport()));
  }, [dmWith]);
  const geom = useMemo(() => clampChatGeom(saved ?? defaultChatGeom(view.w, view.h), view.w, view.h), [saved, view]);

  // Escape closes the unpinned window (capture: the same press must not also open the Esc menu underneath). Pinned, it
  // is left alone: Escape is the game's again.
  useEffect(() => {
    if (!dmWith || pinned) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (useFriendMenu.getState().friend) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeDm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dmWith, pinned]);

  // MOVE / RESIZE: one gesture at a time, held in a ref (no state while the pointer moves).
  const frame = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; edge: ChatEdge | null; sx: number; sy: number; start: ChatGeom; live: boolean; el: Element; last: ChatGeom | null } | null>(null);
  const begin = (e: ReactPointerEvent, edge: ChatEdge | null): void => {
    // A press that never became a drag (released outside the window) is simply replaced.
    if (phone || e.button !== 0 || gesture.current?.live) return;
    if (!edge && (e.target as Element).closest('input, textarea, .dmchat-rs')) return;
    gesture.current = { id: e.pointerId, edge, sx: e.clientX, sy: e.clientY, start: geom, live: false, el: e.currentTarget, last: null };
    if (edge) { e.preventDefault(); e.stopPropagation(); goLive(e.pointerId); }
  };
  const goLive = (pointerId: number): void => {
    const g = gesture.current!;
    g.live = true;
    try { g.el.setPointerCapture(pointerId); } catch { /* the pointer already went */ }
    frame.current?.classList.add(g.edge ? 'sizing' : 'moving');
    const gh = ghost.current;
    if (g.edge && gh) place(gh, g.start, true);
  };
  const onMove = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = toStage(e.clientX - g.sx);
    const dy = toStage(e.clientY - g.sy);
    if (!g.live) {
      if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) return;
      goLive(e.pointerId);
    }
    if (g.edge) {
      g.last = resizeChatGeom(g.start, g.edge, dx, dy, view.w, view.h);
      if (ghost.current) place(ghost.current, g.last, true);
    } else {
      g.last = moveChatGeom(g.start, dx, dy, view.w, view.h);
      if (frame.current) frame.current.style.transform = `translate(${g.last.x}px, ${g.last.y}px)`;
    }
  };
  const end = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.live) return;
    try { g.el.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    frame.current?.classList.remove('moving', 'sizing');
    if (ghost.current) ghost.current.classList.remove('on');
    // The release must not also press the tab or button the drag began on.
    swallowNextClick();
    if (g.last && e.type === 'pointerup') setChatGeom(g.last);
    if (frame.current) frame.current.style.transform = '';
  };

  if (!dmWith) return null;
  const closeTab = (id: string): void => {
    sfx.pulse();
    if ((unread[low(id)] ?? 0) > 0) void markRead(id);
    closeChatTab(id, tabs);
  };
  const pos = { '--dmx': `${geom.x}px`, '--dmy': `${geom.y}px`, '--dmw': `${geom.w}px`, '--dmh': `${geom.h}px` } as CSSProperties;
  const drag = phone ? {} : { onPointerDown: (e: ReactPointerEvent) => begin(e, null) };
  return (
    <>
      {!pinned && (
        <div className={`dmchat-veil${inGame ? ' ingame' : ''}`}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); swallowNextClick(); closeDm(); }}
          onContextMenu={(e) => { e.preventDefault(); closeDm(); }} />
      )}
      <div ref={frame} className={`dmchat-at${pinned ? ' pinned' : ''}${phone ? ' phone' : ''}`} style={pos}
        onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        <section className="dmchat vspanel" role="dialog" aria-label="Messages">
          <div className="dmchat-top" {...drag}>
            <div className="dmchat-tabs" role="tablist" aria-label="Conversations">
              {tabs.map((id) => {
                const f = friends?.find((x) => x.userId === id);
                return f ? <ChatTab key={id} f={f} on={low(id) === low(dmWith)} unread={unread[low(id)] ?? 0} onClose={closeTab} /> : null;
              })}
            </div>
            {!phone && (
              <button type="button" className={`fdock-x dmchat-pin pressable gtip gtip-down gtip-end${pinned ? ' on' : ''}`} aria-pressed={pinned}
                data-tip={pinned ? 'Unpin' : 'Pin open while you play'}
                aria-label={pinned ? 'Unpin the chat' : 'Pin the chat open while you play'}
                onClick={() => { sfx.pulse(); setChatPinned(!pinned); }}>
                <Icon name="pin" />
              </button>
            )}
            <button type="button" className="fdock-x dmchat-close pressable" aria-label="Close messages" onClick={() => { sfx.pulse(); closeDm(); }}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {live ? <ChatPane f={live} conversation={conversation} pinned={pinned} drag={drag} /> : <div className="fdock-convo-empty dmchat-wait">{friends ? 'This conversation is not available.' : 'Finding your friends…'}</div>}
        </section>
        {!phone && CHAT_EDGES.map((edge) => (
          <div key={edge} className={`dmchat-rs dmchat-rs-${edge}`} aria-hidden="true" onPointerDown={(e) => begin(e, edge)} />
        ))}
      </div>
      {!phone && <div ref={ghost} className="dmchat-ghost" aria-hidden="true" />}
    </>
  );
}

/** The resize outline at a geometry (transform + size on one empty box; nothing else lays out). */
function place(el: HTMLElement, g: ChatGeom, on: boolean): void {
  el.style.transform = `translate(${g.x}px, ${g.y}px)`;
  el.style.width = `${g.w}px`;
  el.style.height = `${g.h}px`;
  if (on) el.classList.add('on');
}

const ChatTab = memo(function ChatTab({ f, on, unread, onClose }: { f: Friend; on: boolean; unread: number; onClose: (id: string) => void }) {
  const name = handleOf(f);
  return (
    <div className={`dmchat-tab fr-${f.status}${on ? ' on' : ''}`}>
      <button type="button" role="tab" className="dmchat-tabmain" aria-selected={on}
        aria-label={unread > 0 ? `${name}, ${unread} unread` : name}
        onClick={() => { if (!on) { sfx.pulse(); openDm(f.userId); } }}>
        <span className="dmchat-tabportrait"><FriendPortrait card={f} /><span className="fr-dot" aria-hidden="true" /></span>
        <span className="dmchat-tabname">{name}</span>
        {unread > 0 && <span className="dm-unread" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <button type="button" className="dmchat-tabx pressable" aria-label={`Close the conversation with ${name}`} onClick={() => onClose(f.userId)}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
});

/** One conversation: the friend's header and actions, then the messages and the composer. */
function ChatPane({ f, conversation, pinned, drag }: { f: Friend; conversation?: (friend: Friend) => ReactNode; pinned: boolean; drag: { onPointerDown?: (e: ReactPointerEvent) => void } }): JSX.Element {
  return (
    <div className="dmchat-pane" aria-label={`Messages with ${handleOf(f)}`}>
      <header className={`fdock-dmhead dmchat-head fr-${f.status}`} {...drag}>
        <span className="fdock-portrait"><FriendPortrait card={f} /></span>
        <span className="fr-who">
          <span className="fr-name">{handleOf(f)}</span>
          <span className="fr-status"><span className="fr-dot" aria-hidden="true" /><span className="fr-statustext">{statusText(f)}</span></span>
          {f.status === 'in_game' && f.game && <FriendGame game={f.game} />}
        </span>
        {/* Watch leaves for their game: the unpinned window steps aside first (capture, before the button's own handler,
            which this does not change). A pinned one comes along. */}
        <div className="dmchat-actions" onClickCapture={(e) => {
          const b = (e.target as Element).closest('button');
          if (!pinned && b && !b.disabled && b.getAttribute('aria-label')?.startsWith('Watch ')) closeDm();
        }}>
          <FriendActions f={f} compact />
        </div>
      </header>
      {conversation ? <div className="fdock-convo" role="log" aria-label="Conversation">{conversation(f)}</div> : <DmConversation friend={f} />}
    </div>
  );
}
