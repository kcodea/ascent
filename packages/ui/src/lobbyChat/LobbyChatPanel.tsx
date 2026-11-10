/**
 * LOBBY CHAT (owner 2026-10-30; R-LOBBY-CHAT-01): in every game that has a lobby chat (a Versus room, a live lobby /
 * Practice game someone is watching), for the players and the stands alike.
 *
 *  - THE BUTTON: the chat medallion on the left edge (owner 2026-11-09: "can we use this instead of 'Lobby Chat'?";
 *    art frames/chat_medallion.webp) with the unread count on its corner (the DM red chip; Lobby and Team added up). Pressing it opens THE CHAT VIEW, as Enter or Y does (owner 2026-11-09: "clicking the lobby chat should
 *    open the new 'enter' chat experience. that window is outdated": the old movable side window is gone).
 *  - THE CHAT VIEW (`ChatView` below): the game dimmed and blurred, the history over the board, the bar under it.
 *  - THE SAME QUALITY OF LIFE AS THE DIRECT MESSAGES (R-LOBBY-CHAT-02), from the SAME components (`../chat/`): the
 *    message row (emotes inline, a reply's quote that jumps to and flashes the original) and the composer (the
 *    "Replying to" bar; its emote button is off for now).
 *  - ONLY IN A GAME (owner 2026-11-01, R-LOBBY-CHAT-CLOSE-01): nothing on the title or the menus (a Versus room between
 *    matches included). A Versus match's chat goes as its end gate shuts; a lobby game's when its socket closes at the end.
 *  - TEAM CHAT (owner 2026-11-01, R-LOBBY-CHAT-TEAM-01): a Duos / Ranked Duos player's view has two tabs, Lobby and
 *    Team, each with its own unread count. A spectator has no Team tab.
 *  - Each message names its sender in their own colour, with its time. Someone else's carries Reply and Mute (this game,
 *    my screen only); a muted count beside the tabs unmutes them all. The swear filter is the messages setting.
 *  - READ WHEN SEEN: what arrives while the view is open and the page is in front of me is never unread; a press in the
 *    view, typing and sending read the rest (the store's `noteLobbyChatSeen`).
 *  - A guest reads only: the bar says to sign in. The Settings switch hides the whole thing.
 *  - Keys typed in the bar never reach the game's shortcuts (the spectator's seat keys, emotes).
 *
 * COST: it subscribes to its own store only; a message re-renders the view, never the game, and each row is memoised
 * with stable props (a new message renders one row). Nothing reads layout on scroll beyond the shared game scrollbar's
 * one read. Cursors: the gauntlet's global rule (no plain cursor here, CLAUDE.md).
 */
import { memo, type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sfx } from '../sfx';
import { stageHost } from '../stage';
import { GameScroll } from '../GameScroll';
import { useFriendsPrefs } from '../friends/friendsPrefs';
import { ChatRow, chatTime, isTouchUi, useQuoteJump, type ChatQuote } from '../chat/ChatMessage';
import { ChatComposer, chatEmotePickerOpen } from '../chat/ChatComposer';
import { useGame } from '../store';
import {
  canReplyToLobby, LOBBY_CHAT_GUEST_TEXT, LOBBY_CHAT_MAX_CHARS, LOBBY_CHAT_TEAM_GONE_TEXT, lobbyChatTab, lobbyChatUnreadTotal, noteLobbyChatDraft, noteLobbyChatSeen, retryLobbyChat, sendLobbyChat,
  setLobbyChatFocus, setLobbyChatHushed, setLobbyChatMuted, setLobbyChatTab, useLobbyChat, type LobbyChatChannel, type ShownChatMsg,
} from './lobbyChatStore';
import '../friends/dm/dm.css';
import './lobbyChat.css';
import './chatView.css';
import { publicArt } from '../phoneArt';

const low = (s: string): string => s.toLowerCase();
/** The chat medallion art (base-URL relative: a root path 404s on itch). */
const CHAT_MEDALLION = publicArt('frames/chat_medallion.webp');

/** NO EMOTE BUTTON in the lobby chat for now (owner 2026-11-09: "remove the ability to do emojis. we can revisit at a
 *  later point"). Flip to true to bring the picker back to the side panel and the chat view. Emote codes someone types
 *  by hand still show as pictures. */
const LOBBY_CHAT_EMOTES = false;

/**
 * THE CHAT KEY (owner 2026-11-09): in a game with a lobby chat, playing or watching, Enter or Y opens the CHAT VIEW
 * (`ChatView` below) with the cursor in its bar. Never while typing in another field, never with a modifier held, and
 * Enter is left to a control I reached with the keyboard (a focus ring showing), so keyboard play still presses buttons.
 */
export function isChatKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  const enter = e.key === 'Enter';
  if (!enter && e.key !== 'y' && e.key !== 'Y') return false;
  const t = e.target instanceof Element ? e.target : null;
  if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return false;
  if (enter && t?.closest('button, a, [role="button"], [tabindex]') && t.matches(':focus-visible')) return false;
  return true;
}

/**
 * WHO SAID WHAT (owner 2026-11-09: "make it easier to see who is typing what"): in the chat view each speaker gets
 * their own colour, kept for the whole game (handed out in the order people first speak, so a small lobby never
 * repeats one), and their name sits at the start of their message in it. Picked to read on the dark card; no red (that
 * is the failed-send colour).
 */
export const CHAT_SPEAKER_COLOURS = ['#f0d089', '#7fd4ff', '#9be58a', '#ff9ecf', '#c3a6ff', '#ffb36b', '#6fe3d0', '#f7f08a'] as const;
let speakerGame: string | null = null;
const speakerSlot = new Map<string, number>();
/** This speaker's colour in this game. */
export function chatSpeakerColour(gameKey: string | null, from: string): string {
  if (gameKey !== speakerGame) { speakerGame = gameKey; speakerSlot.clear(); }
  const id = low(from);
  let i = speakerSlot.get(id);
  if (i == null) { i = speakerSlot.size; speakerSlot.set(id, i); }
  return CHAT_SPEAKER_COLOURS[i % CHAT_SPEAKER_COLOURS.length]!;
}

const Message = memo(function Message({ m, mine, me, filter, onReply, onQuote, who, quoteWho }: {
  m: ShownChatMsg; mine: boolean; me: string | null; filter: boolean; onReply: (m: ShownChatMsg) => void; onQuote: (id: string) => void;
  /** The chat view: the speaker's colour, and their name inline at the start of the message. */
  who?: string;
  /** The chat view: the colour of whoever said the message this one replies to (owner 2026-11-09: the quote was
   *  "miscoloring the original chatter's color"). */
  quoteWho?: string;
}) {
  const quote: ChatQuote | null = m.reply ?? null;
  const quoteName = m.reply ? (me && low(m.reply.from) === me ? 'You' : m.reply.name) : '';
  return (
    <ChatRow mid={m.id} mine={mine} body={m.body} filter={filter} state={m.state} error={m.error} time={chatTime(m.at)} className="lchat-msg"
      sender={who || mine ? undefined : <div className={`lchat-name${m.role === 'player' ? ' player' : ''}`}>{m.name}</div>}
      lead={who ? <span className="cview-who">{`${mine ? 'You' : m.name}:`}</span> : undefined}
      style={who ? ({ '--who': who, ...(quoteWho ? { '--quote-who': quoteWho } : {}) } as CSSProperties) : undefined}
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
  // CLOSED OFF THE GAME SCREEN (owner 2026-11-01: "lobby chat should close after games end"; R-LOBBY-CHAT-CLOSE-01):
  // the chat belongs to a game on screen (the shop, the fight, Hero Select, the watch screen). The title,
  // the menus and a Versus room between matches never show it, even while the room's socket stays open.
  const inGame = useGame((s) => !s.showTitle);
  const unread = useLobbyChat(lobbyChatUnreadTotal);
  const focus = useLobbyChat((s) => s.focus);
  const hushed = useLobbyChat((s) => s.hushed);
  const live = show && inGame;
  useEffect(() => {
    if (!live) { setLobbyChatFocus(false); return undefined; }
    const onKey = (e: KeyboardEvent): void => {
      // The view is up but the cursor is not in a field (a guest's bar cannot take it): Enter leaves it.
      if (useLobbyChat.getState().focus) {
        if (e.key === 'Enter' && !e.repeat && !(e.target instanceof Element && e.target.closest('input, textarea'))) {
          e.preventDefault();
          setLobbyChatFocus(false);
        }
        return;
      }
      if (!isChatKey(e)) return;
      e.preventDefault();
      setLobbyChatFocus(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [live]);
  if (!live) return null;
  // The button hides while the view is up (one way in, one chat on screen).
  if (focus) return <ChatView />;
  return (
    <button type="button" className={`lchat-pill${hushed ? ' hushed' : ''}`}
      aria-label={hushed ? 'Open lobby chat (bubbles muted; right-click to unmute)' : unread ? `Open lobby chat, ${unread} new` : 'Open lobby chat'}
      onClick={() => { sfx.pulse(); setLobbyChatFocus(true); }}
      onContextMenu={(e) => { e.preventDefault(); sfx.pulse(); setLobbyChatHushed(!hushed); }}>
      <img className="lchat-medallion" src={CHAT_MEDALLION} alt="" draggable={false} decoding="sync" />
      {hushed && <span className="lchat-hush" aria-hidden="true" />}
      {unread > 0 && !hushed && <span className="dm-unread lchat-pill-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

/**
 * THE CHAT VIEW (owner 2026-11-09, from his mock-up: "the green area should be darkened and blurred, the pink should be
 * the chat history, and the red should be the chat bar"). Enter (or Y) opens it, playing or watching:
 *  - the game behind is dimmed and blurred (a press on it leaves the view);
 *  - the tab's history sits over the middle of the board (reply, mute and emotes as in the side panel);
 *  - the bar sits under it with the cursor already in it. Enter sends AND leaves (owner 2026-11-09: "have enter SEND, AND
 *    exit the window"; a send that is refused stays, to show why); Enter with nothing typed leaves; Escape leaves
 *    (capture, so it never also opens the Esc menu; an open emote picker closes first).
 * Where it sits, how dark and how blurred: the dev menu's "Chat Bubbles" panel ("Chat view").
 * COST: one backdrop blur over the game while the view is up, nothing after. Motion: a one-shot fade + rise.
 */
function ChatView(): JSX.Element {
  const tab = useLobbyChat(lobbyChatTab);
  const hushed = useLobbyChat((s) => s.hushed);
  const hasTeam = useLobbyChat((s) => s.team && s.teamAvailable);
  const msgs = useLobbyChat((s) => (tab === 'team' ? s.teamMsgs : s.msgs));
  const me = useLobbyChat((s) => s.me);
  const muted = useLobbyChat((s) => s.muted);
  const mutedCount = Object.keys(muted).length;
  const canSend = useLobbyChat((s) => (tab === 'team' ? s.teamCanSend : s.canSend));
  const lobbyCanSend = useLobbyChat((s) => s.canSend);
  const lobbyUnread = useLobbyChat((s) => s.unread);
  const teamUnread = useLobbyChat((s) => s.teamUnread);
  const filter = useFriendsPrefs((s) => s.filterMessages);
  const gameKey = useLobbyChat((s) => s.gameKey);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const [replyTo, setReplyTo] = useState<ShownChatMsg | null>(null);
  useEffect(() => { setReplyTo(null); atBottom.current = true; }, [tab]);
  const shown = useMemo(() => msgs.filter((m) => !muted[low(m.from)]), [msgs, muted]);
  const last = shown[shown.length - 1];
  const close = useCallback(() => setLobbyChatFocus(false), []);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.state, shown.length, tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || chatEmotePickerOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const onReply = useCallback((m: ShownChatMsg) => {
    setReplyTo(m);
    if (!isTouchUi()) inputRef.current?.focus({ preventScroll: true });
  }, []);
  const onQuote = useQuoteJump(listRef);

  return createPortal(
    <div className="cview-root" onPointerDownCapture={noteLobbyChatSeen}>
      <div className="cview-veil" aria-hidden="true" onPointerDown={close} />
      <section className="cview" aria-label="Chat">
          <div className="cview-head">
            {hasTeam && (
              <div className="cv2-tabs lchat-tabs cview-tabs" role="tablist" aria-label="Chat">
                {([['lobby', 'Lobby', lobbyUnread], ['team', 'Team', teamUnread]] as [LobbyChatChannel, string, number][]).map(([id, label, n]) => (
                  <button key={id} type="button" role="tab" className={`cv2-tab pressable${tab === id ? ' on' : ''}`} aria-selected={tab === id}
                    aria-label={n ? `${label} chat, ${n} new` : `${label} chat`}
                    onClick={() => { if (tab !== id) { sfx.pulse(); setLobbyChatTab(id); inputRef.current?.focus({ preventScroll: true }); } }}>
                    {label}
                    {n > 0 && <span className="dm-unread lchat-unread" aria-hidden="true">{n > 99 ? '99+' : n}</span>}
                  </button>
                ))}
              </div>
            )}
            {mutedCount > 0 && (
              <button type="button" className="dm-link lchat-unmute cview-unmute pressable" aria-label={`Unmute ${mutedCount} muted`}
                onClick={() => { sfx.pulse(); for (const id of Object.keys(muted)) setLobbyChatMuted(id, false); }}>
                {`${mutedCount} muted. Unmute`}
              </button>
            )}
            {/* THE MUTE SWITCH, here too (owner 2026-11-09: "lets add a mute option here too, just in case"): the chat
                button's right-click (bubbles, typing dots, pops and the count off), as a labelled switch. */}
            <button type="button" className={`cview-hush${hushed ? ' on' : ''}`} aria-pressed={hushed}
              aria-label={hushed ? 'Chat muted. Unmute' : 'Mute chat'}
              onClick={() => { sfx.pulse(); setLobbyChatHushed(!hushed); }}>
              <span className="cview-hush-icon" aria-hidden="true">
                <img src={CHAT_MEDALLION} alt="" draggable={false} decoding="sync" />
                {hushed && <span className="lchat-hush" />}
              </span>
              {hushed ? 'Chat muted' : 'Mute chat'}
            </button>
          </div>
        <GameScroll className="cview-list" outerClassName="cview-list-wrap" role="log" aria-label="Chat messages" aria-live="polite" viewRef={listRef}
          onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
          {shown.length ? (
            <div className="dm-list">
              {shown.map((m) => {
                const mine = !!me && low(m.from) === me;
                return <Message key={m.cid && mine ? m.cid : m.id} m={m} mine={mine} me={me} filter={filter} onReply={onReply} onQuote={onQuote}
                  who={chatSpeakerColour(gameKey, m.from)} quoteWho={m.reply ? chatSpeakerColour(gameKey, m.reply.from) : undefined} />;
              })}
            </div>
          ) : <div className="lchat-empty cview-empty">{tab === 'team' ? 'Only your teammate sees this. Say hi.' : 'No messages yet. Say hi.'}</div>}
        </GameScroll>
        <ChatComposer available={canSend} autoFocus resetKey={tab}
          placeholder={canSend ? (tab === 'team' ? 'Message your team' : 'Message the lobby') : tab === 'team' && lobbyCanSend ? LOBBY_CHAT_TEAM_GONE_TEXT : LOBBY_CHAT_GUEST_TEXT}
          maxChars={LOBBY_CHAT_MAX_CHARS} input={inputRef} filter={filter}
          reply={replyTo ? { name: me && low(replyTo.from) === me ? 'yourself' : replyTo.name, body: replyTo.body } : null}
          onCancelReply={() => setReplyTo(null)}
          send={(text) => sendLobbyChat(text, replyTo, tab)} onSent={close}
          onType={noteLobbyChatSeen} onDraft={(text) => noteLobbyChatDraft(text, tab)}
          onEmptySubmit={close} escape="pass" emotes={LOBBY_CHAT_EMOTES} className="cview-bar" inputClassName="cview-input" />
      </section>
    </div>,
    stageHost(),
  );
}
