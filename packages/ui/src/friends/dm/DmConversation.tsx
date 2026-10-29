/**
 * THE CONVERSATION (R-DM-03): the direct message panel's message list and composer, in the dock's `.vspanel` look.
 *
 *  - The list: my messages on the right, my friend's on the left, each with its time; the last 50 on open, "Show older"
 *    for the page before. Sending shows "Sending"; a refusal shows its reason with Retry. Their messages carry a small
 *    Report (asks once more before it reports). The filter (Settings, on by default) masks swear words as I read them.
 *  - The composer: Enter (or Send) sends, focused the moment the panel opens (not on a touch screen, where it would throw the
 *    keyboard up over the game). Keys typed here never reach the game's own shortcuts (Tab, emotes, ...); Escape still
 *    closes the dock.
 *  - No hub (this build has no Worker, or I am a guest): the composer says messages are not available right now.
 *    The hub reconnecting: a line says the messages will send when it is back.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sfx } from '../../sfx';
import { useGame } from '../../store';
import { useFriendsPrefs } from '../friendsPrefs';
import type { Friend } from '../friendsRemote';
import { handleOf } from '../friendBits';
import {
  DM_MAX_CHARS, DM_RECONNECTING_TEXT, DM_UNAVAILABLE_TEXT, loadOlder, reportDm, retryDm, sendDm, useDm, type DmMsg,
} from './dmStore';
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

const Message = memo(function Message({ m, mine, friendId, filter }: { m: DmMsg; mine: boolean; friendId: string; filter: boolean }) {
  const reported = useDm((s) => !!s.reported[m.id]);
  const [arm, setArm] = useState(false);
  const body = filter ? maskProfanity(m.body) : m.body;
  return (
    <div className={`dm-msg ${mine ? 'mine' : 'theirs'}${m.state ? ` ${m.state}` : ''}`}>
      <div className="dm-bubble">{body}</div>
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
  const atBottom = useRef(true);
  const msgs = convo?.msgs ?? [];
  const last = msgs[msgs.length - 1];

  // Stay pinned to the newest message while I am at the bottom (a new one, or the first page arriving).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.state, msgs.length]);

  let body: JSX.Element;
  if (convo && !convo.loaded && convo.loading) body = <div className="fdock-convo-empty">Loading messages…</div>;
  else if (convo?.failed && !convo.loaded) body = <div className="fdock-convo-empty">Messages could not be loaded.</div>;
  else if (!msgs.length) body = <div className="fdock-convo-empty">{`No messages yet. Say hi to ${handleOf(friend)}.`}</div>;
  else {
    body = (
      <div className="dm-list">
        {convo?.hasOlder && (
          <button type="button" className="dm-older dm-link pressable" disabled={convo?.loading} onClick={() => { sfx.pulse(); atBottom.current = false; void loadOlder(id); }}>
            {convo?.loading ? 'Loading…' : 'Show older messages'}
          </button>
        )}
        {msgs.map((m) => <Message key={m.cid ?? m.id} m={m} mine={m.from === mine} friendId={id} filter={filter} />)}
      </div>
    );
  }
  return (
    <>
      <div className="fdock-convo" role="log" aria-label="Conversation" aria-live="polite" ref={listRef}
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {body}
      </div>
      {hub === 'down' && <div className="dm-status" role="status">{DM_RECONNECTING_TEXT}</div>}
      <Composer friend={friend} available={hub !== 'off'} onSent={() => { atBottom.current = true; }} />
    </>
  );
}

function Composer({ friend, available, onSent }: { friend: Friend; available: boolean; onSent: () => void }): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // Ready to type the moment the panel opens on a friend (owner: "ready to type").
  useEffect(() => {
    setText('');
    setError(null);
    if (available && !isTouch()) input.current?.focus({ preventScroll: true });
  }, [friend.userId, available]);
  const left = DM_MAX_CHARS - [...text].length;
  const submit = (): void => {
    const err = sendDm(friend.userId, text);
    setError(err);
    if (!err && text.trim()) { setText(''); onSent(); sfx.pulse(); }
  };
  return (
    <form className="fdock-compose dm-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
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
      {/* Send (R-DM-CHAT-01): Enter does the same. */}
      <button type="submit" className="lb-btn pressable dm-send" disabled={!available || !text.trim()}>Send</button>
      {error && <div className="dm-err dm-formerr" role="alert">{error}</div>}
    </form>
  );
}
