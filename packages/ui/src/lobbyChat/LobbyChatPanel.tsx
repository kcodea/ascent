/**
 * THE LOBBY CHAT PANEL (owner 2026-10-30; R-LOBBY-CHAT-01): a small panel in every game that has a lobby chat (a Versus
 * room, a live lobby / Practice game someone is watching), for the players and the stands alike.
 *
 *  - COLLAPSED: one small "Lobby chat" button with the unread count (the DM red chip). EXPANDED: the messages and a
 *    composer. The state is kept on this device.
 *  - THE SAME QUALITY OF LIFE AS THE DIRECT MESSAGES (owner 2026-10-30, R-LOBBY-CHAT-02: "lobby chat needs the same
 *    quality of life that dm's have"), from the SAME components (`../chat/`): the message row (emotes inline, a reply's
 *    quote that jumps to and flashes the original), the composer (the emote picker, the "Replying to" bar), and the
 *    window frame (move by the header, resize from the gold grips, its own remembered place and size on this device,
 *    pin). Pinned (the default, today's behaviour) it stays up while I play; unpinned, a press outside it folds it back
 *    to the button. Its default place is today's: the left edge, between Tavern Up and the emote wheel.
 *  - Each message shows its sender's name (a player's in gold) and time. Someone else's carries Reply and Mute (this
 *    game, my screen only); a muted count in the header unmutes them all. The swear filter is the messages setting.
 *  - READ WHEN SEEN: what arrives while the panel is open and the page is in front of me is never unread; a press or
 *    focus in the panel, typing and sending read the rest (the store's `noteLobbyChatSeen`).
 *  - A guest reads only: the composer says to sign in. The Settings switch hides the whole thing.
 *  - Keys typed in the composer never reach the game's shortcuts (the spectator's seat keys, emotes); Escape leaves it.
 *  - A PHONE keeps the compact panel at its fixed place: no move, no resize, no pin. Emotes and replies work there.
 *
 * COST: it subscribes to its own store only; a message re-renders this panel, never the game, and each row is memoised
 * with stable props (a new message renders one row). A drag writes the frame's transform only; nothing reads layout on
 * scroll beyond the shared game scrollbar's one read. Motion: one-shot transform + opacity on expand; nothing loops.
 * Cursors: the gauntlet's global rule (no plain cursor here, CLAUDE.md).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../sfx';
import { GameScroll } from '../GameScroll';
import { useFriendsPrefs } from '../friends/friendsPrefs';
import { ChatRow, chatTime, isTouchUi, useQuoteJump, type ChatQuote } from '../chat/ChatMessage';
import { ChatComposer } from '../chat/ChatComposer';
import { ChatFrame, ChatPinButton, phoneChat } from '../chat/ChatFrame';
import { createChatPrefs, type ChatGeom, type ChatLimits } from '../chat/chatGeom';
import {
  canReplyToLobby, LOBBY_CHAT_GUEST_TEXT, LOBBY_CHAT_MAX_CHARS, noteLobbyChatSeen, retryLobbyChat, sendLobbyChat, setLobbyChatMuted, setLobbyChatOpen, useLobbyChat,
  type ShownChatMsg,
} from './lobbyChatStore';
import '../friends/dm/dm.css';
import './lobbyChat.css';

/** The panel's size limits: small enough to sit beside the board, big enough to read a conversation. */
export const LOBBY_CHAT_LIMITS: ChatLimits = { minW: 200, minH: 170, maxW: 720, maxH: 900, margin: 8 };

/** Today's place (R-LOBBY-CHAT-01): the left edge, 30% down, up to 272 x 270. */
export function defaultLobbyChatGeom(vw: number, vh: number): ChatGeom {
  return { x: 12, y: Math.round(vh * 0.3), w: Math.round(Math.max(200, Math.min(272, vw * 0.17))), h: Math.round(Math.min(270, vh * 0.29)) };
}

/** Where I left the panel on this device; pinned until I unpin it (today's panel stays up while I play). */
export const lobbyChatPrefs = createChatPrefs('ascent.lobbyChatWindow.v1', true);

const low = (s: string): string => s.toLowerCase();

const Message = memo(function Message({ m, mine, me, filter, onReply, onQuote }: {
  m: ShownChatMsg; mine: boolean; me: string | null; filter: boolean; onReply: (m: ShownChatMsg) => void; onQuote: (id: string) => void;
}) {
  const quote: ChatQuote | null = m.reply ?? null;
  const quoteName = m.reply ? (me && low(m.reply.from) === me ? 'You' : m.reply.name) : '';
  return (
    <ChatRow mid={m.id} mine={mine} body={m.body} filter={filter} state={m.state} error={m.error} time={chatTime(m.at)} className="lchat-msg"
      sender={mine ? undefined : <div className={`lchat-name${m.role === 'player' ? ' player' : ''}`}>{m.name}</div>}
      quote={quote} quoteName={quoteName} onQuote={onQuote}
      onReply={canReplyToLobby(m) ? () => onReply(m) : undefined}
      onRetry={m.cid ? () => retryLobbyChat(m.cid!) : undefined}>
      {!mine && !m.state && (
        <button type="button" className="dm-link dm-report pressable" aria-label={`Mute ${m.name} in this game`}
          onClick={() => { sfx.pulse(); setLobbyChatMuted(m.from, true); }}>
          Mute
        </button>
      )}
    </ChatRow>
  );
});

export function LobbyChatPanel(): JSX.Element | null {
  const show = useLobbyChat((s) => s.enabled && s.available && s.company);
  const open = useLobbyChat((s) => s.open);
  const unread = useLobbyChat((s) => s.unread);
  if (!show) return null;
  if (!open) {
    return (
      <button type="button" className="lchat-pill pressable" aria-label={unread ? `Open lobby chat, ${unread} new` : 'Open lobby chat'}
        onClick={() => { sfx.pulse(); setLobbyChatOpen(true); }}>
        <span>Lobby chat</span>
        {unread > 0 && <span className="dm-unread">{unread > 99 ? '99+' : unread}</span>}
      </button>
    );
  }
  return <OpenPanel />;
}

function OpenPanel(): JSX.Element {
  const msgs = useLobbyChat((s) => s.msgs);
  const me = useLobbyChat((s) => s.me);
  const muted = useLobbyChat((s) => s.muted);
  const canSend = useLobbyChat((s) => s.canSend);
  const unread = useLobbyChat((s) => s.unread);
  const filter = useFriendsPrefs((s) => s.filterMessages);
  const pinPref = lobbyChatPrefs.use((s) => s.pinned);
  const phone = phoneChat();
  const pinned = pinPref && !phone;
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const frameEl = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const [replyTo, setReplyTo] = useState<ShownChatMsg | null>(null);
  const shown = useMemo(() => msgs.filter((m) => !muted[low(m.from)]), [msgs, muted]);
  const mutedCount = Object.keys(muted).length;
  const last = shown[shown.length - 1];

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.state, shown.length]);

  // Unpinned: a press anywhere outside folds the panel back to its button (the press still reaches the game).
  useEffect(() => {
    if (pinned || phone) return undefined;
    const onDown = (e: PointerEvent): void => {
      if (frameEl.current?.contains(e.target as Node)) return;
      setLobbyChatOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [pinned, phone]);

  const onReply = useCallback((m: ShownChatMsg) => {
    setReplyTo(m);
    if (!isTouchUi()) inputRef.current?.focus({ preventScroll: true });
  }, []);
  const onQuote = useQuoteJump(listRef);
  const setFrame = useCallback((el: HTMLDivElement | null) => { frameEl.current = el; }, []);

  return (
    <ChatFrame prefs={lobbyChatPrefs} limits={LOBBY_CHAT_LIMITS} defaultGeom={defaultLobbyChatGeom} phone={phone} pinned={pinned} className="dmchat-at lchat-at"
      frameRef={setFrame} frameProps={{ onPointerDownCapture: noteLobbyChatSeen, onFocusCapture: noteLobbyChatSeen }}>
      {(drag) => (
        <section className="lchat vspanel" aria-label="Lobby chat">
          <header className="lchat-head" {...drag}>
            <span className="lchat-title">Lobby chat</span>
            {unread > 0 && <span className="dm-unread lchat-unread" aria-label={`${unread} new`}>{unread > 99 ? '99+' : unread}</span>}
            {mutedCount > 0 && (
              <button type="button" className="dm-link lchat-unmute pressable" aria-label={`Unmute ${mutedCount} muted`}
                onClick={() => { sfx.pulse(); for (const id of Object.keys(muted)) setLobbyChatMuted(id, false); }}>
                {`${mutedCount} muted. Unmute`}
              </button>
            )}
            <span className="lchat-tools">
              {!phone && <ChatPinButton pinned={pinned} onToggle={lobbyChatPrefs.setPinned} what="the lobby chat" className="lchat-pin" />}
              <button type="button" className="lchat-hide pressable" aria-label="Collapse lobby chat" onClick={() => { sfx.pulse(); setLobbyChatOpen(false); }}>
                <span aria-hidden="true">{'–'}</span>
              </button>
            </span>
          </header>
          <GameScroll className="lchat-list" outerClassName="lchat-list-wrap" role="log" aria-label="Lobby chat messages" aria-live="polite" viewRef={listRef}
            onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
            {shown.length ? (
              <div className="dm-list">
                {shown.map((m) => {
                  const mine = !!me && low(m.from) === me;
                  return <Message key={m.cid && mine ? m.cid : m.id} m={m} mine={mine} me={me} filter={filter} onReply={onReply} onQuote={onQuote} />;
                })}
              </div>
            ) : <div className="lchat-empty">No messages yet. Say hi.</div>}
          </GameScroll>
          <ChatComposer available={canSend} placeholder={canSend ? 'Message the lobby' : LOBBY_CHAT_GUEST_TEXT} maxChars={LOBBY_CHAT_MAX_CHARS} input={inputRef} filter={filter}
            reply={replyTo ? { name: me && low(replyTo.from) === me ? 'yourself' : replyTo.name, body: replyTo.body } : null}
            onCancelReply={() => setReplyTo(null)}
            send={(text) => sendLobbyChat(text, replyTo)} onSent={() => { atBottom.current = true; setReplyTo(null); }} onType={noteLobbyChatSeen}
            escape="blur" className="lchat-compose" inputClassName="lchat-input" />
        </section>
      )}
    </ChatFrame>
  );
}
