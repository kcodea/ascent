/**
 * A CHAT MESSAGE, shared by every chat (the direct messages, R-DM-03, and the lobby chat, R-LOBBY-CHAT-02):
 *
 *  - THE BODY (`ChatBody`): its words (masked when the filter is on) with its emotes inline (R-DM-EMOTE-01: a
 *    `:emote_id:` token of the game's own set shows as its painted bubble, about a line high; a message of only a few
 *    emotes shows them bigger).
 *  - THE ROW (`ChatRow`): mine on the right, theirs on the left; an optional sender line above (the lobby's, where many
 *    people talk); the quote of the message it answers (R-DM-REPLY-01: pressing it jumps to the original and flashes it
 *    once, `useQuoteJump`); the meta line: Sending / the refusal with Retry / the time, then Reply (on hover; always on a
 *    touch screen), then the caller's own actions (Report, Mute).
 *
 * COST: the row is plain markup; each chat wraps it in its OWN memoised message with referentially stable props, so a
 * new message renders one row. Emote tokens are parsed once per body; a quote press does one lookup and one scroll.
 * Nothing loops (the flash is one-shot opacity).
 */
import { Fragment, memo, useCallback, useMemo, type ReactNode, type RefObject } from 'react';
import { sfx } from '../sfx';
import { emoteSrc } from '../emotes/emoteArt';
import { dmPieces, emoteName, emoteOnly } from '../friends/dm/chatEmotes';
import { maskProfanity } from '../friends/dm/profanity';
import '../friends/dm/dm.css';

/** "14:05", or "Oct 28, 14:05" for an older day. Takes an ISO string or epoch ms. */
export function chatTime(at: string | number, now = new Date()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

export const isTouchUi = (): boolean => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-touch-ui');

/** How long a quoted message flashes after its quote is pressed (one-shot). */
export const CHAT_FLASH_MS = 1_400;

/** A message body: its words (masked when the filter is on) with its emotes inline. */
export const ChatBody = memo(function ChatBody({ body, filter }: { body: string; filter: boolean }) {
  const pieces = useMemo(() => dmPieces(body), [body]);
  return (
    <>
      {pieces.map((p, i) => (typeof p === 'string'
        ? <Fragment key={i}>{filter ? maskProfanity(p) : p}</Fragment>
        : <img key={i} className="dm-emote" src={emoteSrc(p.emote)} alt={emoteName(p.emote)} draggable={false} decoding="sync" />))}
    </>
  );
});

/** A body that is only a few emotes shows them bigger. */
export const isSoloEmotes = (body: string): boolean => emoteOnly(dmPieces(body));

/** The quote above a reply: the message it answers (its id, to jump to it) and the start of what it said. */
export interface ChatQuote { id: string; body: string }

export interface ChatRowProps {
  /** The stored id (what a quote jumps to). */
  mid: string;
  mine: boolean;
  body: string;
  filter: boolean;
  state?: 'sending' | 'failed';
  error?: string;
  /** The time, already formatted. */
  time: string;
  /** A line above the bubble naming the sender (the lobby's). */
  sender?: ReactNode;
  quote: ChatQuote | null;
  quoteName: string;
  onQuote: (id: string) => void;
  /** Given: the message can be answered (shows Reply). */
  onReply?: () => void;
  /** Given: a failed send can go again (shows Retry). */
  onRetry?: () => void;
  className?: string;
  /** The chat's own actions after Reply (Report, Mute). */
  children?: ReactNode;
}

export function ChatRow({ mid, mine, body, filter, state, error, time, sender, quote, quoteName, onQuote, onReply, onRetry, className = '', children }: ChatRowProps): JSX.Element {
  const solo = isSoloEmotes(body);
  return (
    <div className={`dm-msg ${mine ? 'mine' : 'theirs'}${state ? ` ${state}` : ''}${className ? ` ${className}` : ''}`} data-mid={mid}>
      {sender}
      {quote && (
        <button type="button" className="dm-quote pressable" aria-label={`Replying to ${quoteName}. Show that message.`}
          onClick={() => { sfx.pulse(); onQuote(quote.id); }}>
          <span className="dm-quote-name">{quoteName}</span>
          <span className="dm-quote-body"><ChatBody body={quote.body} filter={filter} /></span>
        </button>
      )}
      <div className={`dm-bubble${solo ? ' solo' : ''}`}><ChatBody body={body} filter={filter} /></div>
      <div className="dm-meta">
        {state === 'sending' ? <span>Sending</span>
          : state === 'failed' ? (
            <>
              <span className="dm-err">{error}</span>
              {onRetry && <button type="button" className="dm-link pressable" onClick={() => { sfx.pulse(); onRetry(); }}>Retry</button>}
            </>
          ) : <span>{time}</span>}
        {onReply && (
          <button type="button" className="dm-link dm-reply pressable" aria-label="Reply to this message" onClick={() => { sfx.pulse(); onReply(); }}>Reply</button>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Pressing a quote: scroll its original (when it is loaded) to the middle of the list and flash it once. A stable
 * callback (one lookup, one scroll; restarted when pressed again).
 */
export function useQuoteJump(listRef: RefObject<HTMLElement>): (id: string) => void {
  return useCallback((target: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${target.replace(/["\\]/g, '')}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // A one-shot flash (opacity of an overlay): restarted when pressed again.
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    window.setTimeout(() => el.classList.remove('flash'), CHAT_FLASH_MS);
  }, [listRef]);
}
