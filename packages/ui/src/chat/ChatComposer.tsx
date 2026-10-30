/**
 * A CHAT COMPOSER, shared by every chat (the direct messages, R-DM-03, and the lobby chat, R-LOBBY-CHAT-02):
 *
 *  - The field and Send: Enter (or Send) sends. Keys typed here never reach the game's own shortcuts (Tab, emotes, seat
 *    keys, ...). Escape is the caller's choice: `escape="pass"` lets it through (the DM window's own capture listener
 *    closes the window), `escape="blur"` just leaves the field.
 *  - THE EMOTE BUTTON (R-DM-EMOTE-01): a compact picker of my emote menu (the in-game set; no cooldown in chat) that drops
 *    the `:emote_id:` token in where I am typing. Escape or a press outside closes it first.
 *  - THE REPLY BAR (R-DM-REPLY-01): "Replying to <name>" with the start of that message and a close, above the field.
 *  - A count of characters left once I am near the limit; the refusal under the field.
 *
 * The caller owns the store: `send(text)` answers null when the message went (or there was nothing to send), else the
 * sentence to show. `resetKey` clears the field (a new conversation); `autoFocus` focuses it on open and on a new key
 * (never on a touch screen, where it would throw the keyboard up over the game).
 *
 * COST: local state only; one render per keystroke of the composer itself, never the list or the game.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { sfx } from '../sfx';
import { emoteSrc } from '../emotes/emoteArt';
import { useEquippedEmotes } from '../emotes/emoteLoadout';
import { emoteName, emoteToken } from '../friends/dm/chatEmotes';
import { ChatBody, isTouchUi } from './ChatMessage';
import '../friends/dm/dm.css';

/** An emote picker is open (a chat window's Escape leaves it to the picker). */
let pickerOpen = false;
export const chatEmotePickerOpen = (): boolean => pickerOpen;

export interface ChatComposerProps {
  available: boolean;
  /** The field's placeholder and label (what it says when it cannot send, too). */
  placeholder: string;
  maxChars: number;
  input: RefObject<HTMLInputElement>;
  filter: boolean;
  /** The message being answered: its sender's name as the bar says it, and its body. */
  reply: { name: string; body: string } | null;
  onCancelReply: () => void;
  send: (text: string) => string | null;
  onSent: () => void;
  /** Something was typed (the lobby reads its unread when I type). */
  onType?: () => void;
  escape: 'pass' | 'blur';
  resetKey?: string;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
}

export function ChatComposer({
  available, placeholder, maxChars, input, filter, reply, onCancelReply, send, onSent, onType, escape, resetKey, autoFocus = false, className = '', inputClassName = '',
}: ChatComposerProps): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // A new conversation starts clean (and, when asked, ready to type: owner "ready to type").
  useEffect(() => {
    setText('');
    setError(null);
    setPicking(false);
    if (autoFocus && available && !isTouchUi()) input.current?.focus({ preventScroll: true });
  }, [resetKey, available]);
  const left = maxChars - [...text].length;
  const submit = (): void => {
    const err = send(text);
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
    onType?.();
    const caret = before.length + lead.length + emoteToken(emote).length + tail.length;
    if (el && !isTouchUi()) {
      el.focus({ preventScroll: true });
      window.requestAnimationFrame(() => { try { el.setSelectionRange(caret, caret); } catch { /* not a text field any more */ } });
    }
  };
  return (
    <form className={`fdock-compose dm-compose${className ? ` ${className}` : ''}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {reply && (
        <div className="dm-replybar" role="status">
          <span className="dm-replybar-text">
            <span className="dm-replybar-name">{`Replying to ${reply.name}`}</span>
            <span className="dm-replybar-body"><ChatBody body={reply.body} filter={filter} /></span>
          </span>
          <button type="button" className="dmchat-tabx dm-replybar-x pressable" aria-label="Stop replying" onClick={() => { sfx.pulse(); onCancelReply(); }}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      )}
      <span className="dm-field">
        <input ref={input} className={`acctinput fdock-input dm-input${inputClassName ? ` ${inputClassName}` : ''}`} type="text" enterKeyHint="send" autoComplete="off" spellCheck
          disabled={!available} maxLength={maxChars * 2} value={text} placeholder={placeholder} aria-label={placeholder}
          onChange={(e) => { setText(e.target.value); if (error) setError(null); onType?.(); }}
          // Typing is not playing: no key reaches the game's shortcuts.
          onKeyDown={(e) => {
            if (e.key !== 'Escape') { e.stopPropagation(); return; }
            if (escape === 'blur') { e.stopPropagation(); e.currentTarget.blur(); }
          }}
          onKeyUp={(e) => { if (e.key !== 'Escape' || escape === 'blur') e.stopPropagation(); }} />
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
