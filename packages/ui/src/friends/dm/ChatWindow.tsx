/**
 * THE CHAT WINDOW (owner 2026-10-29, R-DM-CHAT-01: "the chat should open as a larger overlay in the center of the
 * screen, and should have tabs that hold all conversations"). Pressing a friend in the dock (or a new-message toast)
 * opens it on that friend; the friends list collapses, so one surface is up at a time.
 *
 *  - THE TABS, across the top: one per conversation, every friend I opened this session (in the order I opened them)
 *    and then every friend with unread messages. Each shows the friend's portrait, name and unread count, and has its
 *    own close. Closing a tab with unread messages reads them (I chose to put that conversation away). Closing the
 *    last tab closes the window.
 *  - THE CONVERSATION: the friend's header (portrait, name, live status, their game line), Watch / Invite, then the
 *    messages and the composer (`DmConversation`, R-DM-03), all much bigger than the old card beside the list.
 *  - CLOSING: the close button, Escape (capture: it never also opens the Esc menu), or a press on the veil around the
 *    window (caught: it never reaches the board or a menu button). In a game the veil barely dims: the game keeps
 *    running underneath.
 *
 * It lives in the dock's shell (`FriendsDock`), so it is the same one instance on every screen and survives a screen
 * change. Motion: one-shot transform + opacity on open; nothing loops. No cursor rules (the global gauntlet).
 */
import { memo, useEffect, useMemo, type ReactNode } from 'react';
import { sfx } from '../../sfx';
import { closeChatTab, closeDm, openDm, swallowNextClick, useFriendsDock } from '../dock/dockStore';
import { useFriendMenu } from '../FriendMenu';
import { FriendGame, FriendPortrait, handleOf, statusText } from '../friendBits';
import type { Friend } from '../friendsRemote';
import { useFriends, useFriendsListLoop } from '../friendsStore';
import { DmConversation } from './DmConversation';
import { liveFriend, markRead, useDm } from './dmStore';
import { FriendActions } from '../dock/FriendsDock';
import './dm.css';

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
  // Opened from a toast before any friends surface read the list: read it now (the shared loop, only while needed).
  useFriendsListLoop(!!dmWith && !friends);
  const tabs = useMemo(() => chatTabOrder(session, unread, friends), [session, unread, friends]);
  const active = dmWith ? friends?.find((f) => low(f.userId) === low(dmWith)) ?? null : null;
  const live = useMemo(() => (active ? liveFriend(active, peers) : null), [active, peers]);

  // Escape closes the window (capture: the same press must not also open the Esc menu underneath).
  useEffect(() => {
    if (!dmWith) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (useFriendMenu.getState().friend) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      closeDm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dmWith]);

  if (!dmWith) return null;
  const closeTab = (id: string): void => {
    sfx.pulse();
    if ((unread[low(id)] ?? 0) > 0) void markRead(id);
    closeChatTab(id, tabs);
  };
  return (
    <div className={`dmchat-veil${inGame ? ' ingame' : ''}`}
      onPointerDown={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); e.stopPropagation(); swallowNextClick(); closeDm(); }}
      onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); closeDm(); } }}>
      <section className="dmchat vspanel" role="dialog" aria-label="Messages">
        <div className="dmchat-top">
          <div className="dmchat-tabs" role="tablist" aria-label="Conversations">
            {tabs.map((id) => {
              const f = friends?.find((x) => x.userId === id);
              return f ? <ChatTab key={id} f={f} on={low(id) === low(dmWith)} unread={unread[low(id)] ?? 0} onClose={closeTab} /> : null;
            })}
          </div>
          <button type="button" className="fdock-x dmchat-close pressable" aria-label="Close messages" onClick={() => { sfx.pulse(); closeDm(); }}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {live ? <ChatPane f={live} conversation={conversation} /> : <div className="fdock-convo-empty dmchat-wait">{friends ? 'This conversation is not available.' : 'Finding your friends…'}</div>}
      </section>
    </div>
  );
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
function ChatPane({ f, conversation }: { f: Friend; conversation?: (friend: Friend) => ReactNode }): JSX.Element {
  return (
    <div className="dmchat-pane" aria-label={`Messages with ${handleOf(f)}`}>
      <header className={`fdock-dmhead dmchat-head fr-${f.status}`}>
        <span className="fdock-portrait"><FriendPortrait card={f} /></span>
        <span className="fr-who">
          <span className="fr-name">{handleOf(f)}</span>
          <span className="fr-status"><span className="fr-dot" aria-hidden="true" /><span className="fr-statustext">{statusText(f)}</span></span>
          {f.status === 'in_game' && f.game && <FriendGame game={f.game} />}
        </span>
        {/* Watch leaves for their game: the window steps aside first (capture, before the button's own handler, which
            this does not change). */}
        <div className="dmchat-actions" onClickCapture={(e) => {
          const b = (e.target as Element).closest('button');
          if (b && !b.disabled && b.getAttribute('aria-label')?.startsWith('Watch ')) closeDm();
        }}>
          <FriendActions f={f} compact />
        </div>
      </header>
      {conversation ? <div className="fdock-convo" role="log" aria-label="Conversation">{conversation(f)}</div> : <DmConversation friend={f} />}
    </div>
  );
}
