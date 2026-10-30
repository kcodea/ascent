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
 * COST: messages are memoised and their props stay referentially stable (a new message renders one row); emote tokens
 * are parsed once per body; a quote press does one lookup and one scroll. Nothing loops (the flash is one-shot opacity).
 */
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DmReplyPreview } from '@game/versus-cf/hub';
import { GameScroll } from '../../GameScroll';
import { sfx } from '../../sfx';
import { useGame } from '../../store';
import { emoteSrc } from '../../emotes/emoteArt';
import { useEquippedEmotes } from '../../emotes/emoteLoadout';
import { useFriendsPrefs } from '../friendsPrefs';
import type { Friend } from '../friendsRemote';
import { handleOf } from '../friendBits';
import {
  canReplyTo, DM_MAX_CHARS, DM_RECONNECTING_TEXT, DM_UNAVAILABLE_TEXT, loadOlder, reportDm, retryDm, sendDm, useDm, type DmMsg,
} from './dmStore';
import { dmPieces, emoteName, emoteOnly, emoteToken } from './chatEmotes';
import { maskProfanity } from './profanity';
import './dm.css';

/** "14:05", or "Oct 28, 14:05" for an older day. */
export function dmTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

const isTouch = (): boolean => typeof document !== 'undefined' && document.documentElement.hasAttribute('data-touch-ui');

/** How long a quoted message flashes after its quote is pressed (one-shot). */
export const DM_FLASH_MS = 1_400;

/** The emote picker is open (the chat window's Escape leaves it to the picker). */
let pickerOpen = false;
export const dmEmotePickerOpen = (): boolean => pickerOpen;

/** A message body: its words (masked when the filter is on) with its emotes inline. */
export const DmBody = memo(function DmBody({ body, filter }: { body: string; filter: boolean }) {
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
const isSolo = (body: string): boolean => emoteOnly(dmPieces(body));

type Quote = Pick<DmReplyPreview, 'id' | 'from' | 'body'>;

const Message = memo(function Message({ m, mine, friendId, filter, quote, quoteName, onReply, onQuote }: {
  m: DmMsg; mine: boolean; friendId: string; filter: boolean; quote: Quote | null; quoteName: string;
  onReply: (m: DmMsg) => void; onQuote: (id: string) => void;
}) {
  const reported = useDm((s) => !!s.reported[m.id]);
  const [arm, setArm] = useState(false);
  const solo = isSolo(m.body);
  return (
    <div className={`dm-msg ${mine ? 'mine' : 'theirs'}${m.state ? ` ${m.state}` : ''}`} data-mid={m.id}>
      {quote && (
        <button type="button" className="dm-quote pressable" aria-label={`Replying to ${quoteName}. Show that message.`}
          onClick={() => { sfx.pulse(); onQuote(quote.id); }}>
          <span className="dm-quote-name">{quoteName}</span>
          <span className="dm-quote-body"><DmBody body={quote.body} filter={filter} /></span>
        </button>
      )}
      <div className={`dm-bubble${solo ? ' solo' : ''}`}><DmBody body={m.body} filter={filter} /></div>
      <div className="dm-meta">
        {m.state === 'sending' ? <span>Sending</span>
          : m.state === 'failed' ? (
            <>
              <span className="dm-err">{m.error}</span>
              {m.cid && (
                <button type="button" className="dm-link pressable" onClick={() => { sfx.pulse(); retryDm(friendId, m.cid!); }}>Retry</button>
              )}
            </>
          ) : <span>{dmTime(m.at)}</span>}
        {canReplyTo(m) && (
          <button type="button" className="dm-link dm-reply pressable" aria-label="Reply to this message" onClick={() => { sfx.pulse(); onReply(m); }}>Reply</button>
        )}
        {!mine && !m.state && (reported
          ? <span className="dm-reported">Reported</span>
          : (
            <button type="button" className={`dm-link dm-report pressable${arm ? ' armed' : ''}`} aria-label={arm ? 'Report this message? Press again to report.' : 'Report message'}
              onClick={() => { sfx.pulse(); if (arm) { setArm(false); void reportDm(m.id); } else setArm(true); }}
              onBlur={() => setArm(false)}>
              {arm ? 'Report?' : 'Report'}
            </button>
          ))}
      </div>
    </div>
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
    if (!isTouch()) inputRef.current?.focus({ preventScroll: true });
  }, []);
  const onQuote = useCallback((target: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${target.replace(/["\\]/g, '')}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // A one-shot flash (opacity of an overlay): restarted when pressed again.
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    window.setTimeout(() => el.classList.remove('flash'), DM_FLASH_MS);
  }, []);

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
      <Composer friend={friend} available={hub !== 'off'} input={inputRef} filter={filter}
        replyTo={replyTo} replyName={replyTo ? (replyTo.from === mine ? 'yourself' : name) : ''} onCancelReply={() => setReplyTo(null)}
        onSent={() => { atBottom.current = true; setReplyTo(null); }} />
    </>
  );
}

function Composer({ friend, available, input, filter, replyTo, replyName, onCancelReply, onSent }: {
  friend: Friend; available: boolean; input: RefObject<HTMLInputElement>; filter: boolean;
  replyTo: DmMsg | null; replyName: string; onCancelReply: () => void; onSent: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Ready to type the moment the panel opens on a friend (owner: "ready to type").
  useEffect(() => {
    setText('');
    setError(null);
    setPicking(false);
    if (available && !isTouch()) input.current?.focus({ preventScroll: true });
  }, [friend.userId, available]);
  const left = DM_MAX_CHARS - [...text].length;
  const submit = (): void => {
    const err = sendDm(friend.userId, text, replyTo);
    setError(err);
    if (!err && text.trim()) { setText(''); onSent(); sfx.pulse(); }
  };
  /** Put an emote's token where I am typing (a space either side when it touches a word). */
  const addEmote = (emote: string): void => {
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? at;
    const before = text.slice(0, at);
    const after = text.slice(end);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const tail = after && /^\s/.test(after) ? '' : ' ';
    const next = `${before}${lead}${emoteToken(emote)}${tail}${after}`;
    setText(next);
    if (error) setError(null);
    setPicking(false);
    const caret = before.length + lead.length + emoteToken(emote).length + tail.length;
    if (el && !isTouch()) {
      el.focus({ preventScroll: true });
      window.requestAnimationFrame(() => { try { el.setSelectionRange(caret, caret); } catch { /* not a text field any more */ } });
    }
  };
  return (
    <form className="fdock-compose dm-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {replyTo && (
        <div className="dm-replybar" role="status">
          <span className="dm-replybar-text">
            <span className="dm-replybar-name">{`Replying to ${replyName}`}</span>
            <span className="dm-replybar-body"><DmBody body={replyTo.body} filter={filter} /></span>
          </span>
          <button type="button" className="dmchat-tabx dm-replybar-x pressable" aria-label="Stop replying" onClick={() => { sfx.pulse(); onCancelReply(); }}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
      <span className="dm-field">
        <input ref={input} className="acctinput fdock-input dm-input" type="text" enterKeyHint="send" autoComplete="off" spellCheck
          disabled={!available} maxLength={DM_MAX_CHARS * 2} value={text}
          placeholder={available ? `Message ${handleOf(friend)}` : DM_UNAVAILABLE_TEXT}
          aria-label={available ? `Message ${handleOf(friend)}` : DM_UNAVAILABLE_TEXT}
          onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
          // Typing is not playing: no key reaches the game's shortcuts. Escape still closes the chat window (its capture listener).
          onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
          onKeyUp={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} />
        {available && left < 60 && <span className={`dm-count${left < 0 ? ' over' : ''}`} aria-live="polite">{left}</span>}
      </span>
      {available && <EmoteButton open={picking} onToggle={setPicking} onPick={addEmote} />}
      {/* Send (R-DM-CHAT-01): Enter does the same. */}
      <button type="submit" className="lb-btn pressable dm-send" disabled={!available || !text.trim()}>Send</button>
      {error && <div className="dm-err dm-formerr" role="alert">{error}</div>}
    </form>
  );
}

/** The art on the emote button: the starter every account owns. */
const PICKER_FACE = 'emote_zen_brian';

/** The composer's emote button and its compact picker (my emote menu, the in-game set; no cooldown in chat). */
function EmoteButton({ open, onToggle, onPick }: { open: boolean; onToggle: (v: boolean) => void; onPick: (id: string) => void }): JSX.Element {
  const emotes = useEquippedEmotes();
  const wrap = useRef<HTMLSpanElement>(null);
  // Open: Escape or a press outside closes it (capture, so Escape never also closes the chat window).
  useEffect(() => {
    if (!open) return undefined;
    pickerOpen = true;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onToggle(false);
    };
    const onDown = (e: PointerEvent): void => { if (!wrap.current?.contains(e.target as Node)) onToggle(false); };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      pickerOpen = false;
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);
  const face = emoteSrc(PICKER_FACE);
  return (
    <span className="dm-emotewrap" ref={wrap}>
      <button type="button" className={`dm-emotebtn pressable${open ? ' on' : ''}`} aria-label="Emotes" aria-expanded={open} aria-haspopup="menu"
        onClick={() => { sfx.pulse(); onToggle(!open); }}>
        {face && <img src={face} alt="" draggable={false} decoding="sync" />}
      </button>
      {open && (
        <div className="atip dm-emotes" role="menu" aria-label="Emotes">
          {emotes.length ? (
            <div className="dm-emotes-grid">
              {emotes.map((id) => {
                const src = emoteSrc(id);
                return src ? (
                  <button key={id} type="button" role="menuitem" className="emote-pick dm-emote-pick pressable" aria-label={`Add ${emoteName(id)}`}
                    onClick={() => { sfx.pulse(); onPick(id); }}>
                    <img src={src} alt="" draggable={false} decoding="sync" />
                  </button>
                ) : null;
              })}
            </div>
          ) : <span className="dm-emotes-none">No emotes yet.</span>}
        </div>
      )}
    </span>
  );
}
