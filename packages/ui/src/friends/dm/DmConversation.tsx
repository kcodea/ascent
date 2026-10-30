/**
 * THE CONVERSATION (R-DM-03): the direct message panel's message list and composer, in the dock's `.vspanel` look.
 *
 *  - The list: my messages on the right, my friend's on the left, each with its time; the last 50 on open, "Show older"
 *    for the page before. Sending shows "Sending"; a refusal shows its reason with Retry. Their messages carry a small
 *    Report (asks once more before it reports). The filter (Settings, on by default) masks swear words as I read them.
 *  - EMOTES (R-DM-EMOTE-01): a `:emote_id:` token of the game's own set shows as its painted bubble, small and inline
 *    (about a line high); a message of only emotes shows them a little bigger. The composer's emote button opens a
 *    compact picker of my emote menu (the in-game set) that drops the token in where I am typing.
 *  - REPLIES (R-DM-REPLY-01): every stored message has a Reply (on hover; always shown on a touch screen). The composer
 *    then shows "Replying to <name>" with the start of that message and a close; the sent message carries a small quote
 *    above it, and pressing the quote scrolls to the original (when it is loaded) and flashes it once.
 *  - The composer: Enter (or Send) sends, focused the moment the panel opens (not on a touch screen, where it would throw the
 *    keyboard up over the game). Keys typed here never reach the game's own shortcuts (Tab, emotes, ...); Escape still
 *    closes the dock (or, first, the emote picker).
 *  - No hub (a page the hub would refuse, or I am a guest): the composer says messages are not available right now.
 *    The hub reconnecting: a line says the messages will send when it is back.
 *
 * The row, the body, the composer (with its emote picker and reply bar) and the quote jump are the shared chat parts
 * (`../../chat/`), which the lobby chat uses too (R-LOBBY-CHAT-02); this file is the DM store's side of them.
 *
 * COST: messages are memoised and their props stay referentially stable (a new message renders one row); emote tokens
 * are parsed once per body; a quote press does one lookup and one scroll. Nothing loops (the flash is one-shot opacity).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DmReplyPreview } from '@game/versus-cf/hub';
import { GameScroll } from '../../GameScroll';
import { sfx } from '../../sfx';
import { useGame } from '../../store';
import { ChatBody, ChatRow, chatTime, CHAT_FLASH_MS, isTouchUi, useQuoteJump } from '../../chat/ChatMessage';
import { ChatComposer, chatEmotePickerOpen } from '../../chat/ChatComposer';
import { useFriendsPrefs } from '../friendsPrefs';
import type { Friend } from '../friendsRemote';
import { handleOf } from '../friendBits';
import {
  canReplyTo, DM_MAX_CHARS, DM_RECONNECTING_TEXT, DM_UNAVAILABLE_TEXT, loadOlder, reportDm, retryDm, sendDm, useDm, type DmMsg,
} from './dmStore';
import './dm.css';

/** "14:05", or "Oct 28, 14:05" for an older day (the shared chat time). */
export const dmTime = (iso: string, now = new Date()): string => chatTime(iso, now);

/** How long a quoted message flashes after its quote is pressed (one-shot). */
export const DM_FLASH_MS = CHAT_FLASH_MS;

/** The emote picker is open (the chat window's Escape leaves it to the picker). */
export const dmEmotePickerOpen = chatEmotePickerOpen;

/** A message body: its words (masked when the filter is on) with its emotes inline (the shared chat body). */
export const DmBody = ChatBody;

type Quote = Pick<DmReplyPreview, 'id' | 'from' | 'body'>;

const Message = memo(function Message({ m, mine, friendId, filter, quote, quoteName, onReply, onQuote }: {
  m: DmMsg; mine: boolean; friendId: string; filter: boolean; quote: Quote | null; quoteName: string;
  onReply: (m: DmMsg) => void; onQuote: (id: string) => void;
}) {
  const reported = useDm((s) => !!s.reported[m.id]);
  const [arm, setArm] = useState(false);
  return (
    <ChatRow mid={m.id} mine={mine} body={m.body} filter={filter} state={m.state} error={m.error} time={dmTime(m.at)}
      quote={quote} quoteName={quoteName} onQuote={onQuote}
      onReply={canReplyTo(m) ? () => onReply(m) : undefined}
      onRetry={m.cid ? () => retryDm(friendId, m.cid!) : undefined}>
      {!mine && !m.state && (reported
        ? <span className="dm-reported">Reported</span>
        : (
          <button type="button" className={`dm-link dm-report pressable${arm ? ' armed' : ''}`} aria-label={arm ? 'Report this message? Press again to report.' : 'Report message'}
            onClick={() => { sfx.pulse(); if (arm) { setArm(false); void reportDm(m.id); } else setArm(true); }}
            onBlur={() => setArm(false)}>
            {arm ? 'Report?' : 'Report'}
          </button>
        ))}
    </ChatRow>
  );
});

export function DmConversation({ friend }: { friend: Friend }): JSX.Element {
  const id = friend.userId.toLowerCase();
  const convo = useDm((s) => s.convos[id]);
  const hub = useDm((s) => s.hub);
  const filter = useFriendsPrefs((s) => s.filterMessages);
  const mine = (useGame((s) => s.account.userId) ?? '').toLowerCase();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const [replyTo, setReplyTo] = useState<DmMsg | null>(null);
  const msgs = convo?.msgs ?? [];
  const last = msgs[msgs.length - 1];
  const name = handleOf(friend);
  const available = hub !== 'off';

  // A reply belongs to its conversation.
  useEffect(() => { setReplyTo(null); }, [id]);

  // Stay pinned to the newest message while I am at the bottom (a new one, or the first page arriving).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.state, msgs.length]);

  // Messages by id, for a reply whose quote the store did not send (my own, still sending): the loaded original.
  const byId = useMemo(() => {
    const m = new Map<string, DmMsg>();
    for (const x of msgs) m.set(x.id, x);
    return m;
  }, [msgs]);

  const onReply = useCallback((m: DmMsg) => {
    setReplyTo(m);
    if (!isTouchUi()) inputRef.current?.focus({ preventScroll: true });
  }, []);
  const onQuote = useQuoteJump(listRef);

  let body: JSX.Element;
  if (convo && !convo.loaded && convo.loading) body = <div className="fdock-convo-empty">Loading messages…</div>;
  else if (convo?.failed && !convo.loaded) body = <div className="fdock-convo-empty">Messages could not be loaded.</div>;
  else if (!msgs.length) body = <div className="fdock-convo-empty">{`No messages yet. Say hi to ${name}.`}</div>;
  else {
    body = (
      <div className="dm-list">
        {convo?.hasOlder && (
          <button type="button" className="dm-older dm-link pressable" disabled={convo?.loading} onClick={() => { sfx.pulse(); atBottom.current = false; void loadOlder(id); }}>
            {convo?.loading ? 'Loading…' : 'Show older messages'}
          </button>
        )}
        {msgs.map((m) => {
          const quote: Quote | null = m.reply ?? (m.replyTo ? byId.get(m.replyTo) ?? null : null);
          return (
            <Message key={m.cid ?? m.id} m={m} mine={m.from === mine} friendId={id} filter={filter}
              quote={quote} quoteName={quote ? (quote.from === mine ? 'You' : name) : ''} onReply={onReply} onQuote={onQuote} />
          );
        })}
      </div>
    );
  }
  return (
    <>
      <GameScroll className="fdock-convo" outerClassName="fdock-convo-wrap" role="log" aria-label="Conversation" aria-live="polite" viewRef={listRef}
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {body}
      </GameScroll>
      {hub === 'down' && <div className="dm-status" role="status">{DM_RECONNECTING_TEXT}</div>}
      <ChatComposer available={available} placeholder={available ? `Message ${name}` : DM_UNAVAILABLE_TEXT} maxChars={DM_MAX_CHARS} input={inputRef} filter={filter}
        reply={replyTo ? { name: replyTo.from === mine ? 'yourself' : name, body: replyTo.body } : null} onCancelReply={() => setReplyTo(null)}
        send={(text) => sendDm(friend.userId, text, replyTo)} onSent={() => { atBottom.current = true; setReplyTo(null); }}
        escape="pass" resetKey={friend.userId} autoFocus />
    </>
  );
}
