/**
 * THE LOBBY CHAT PANEL (owner 2026-10-30; R-LOBBY-CHAT-01): a small corner panel in every game that has a lobby chat
 * (a Versus room, a live lobby / Practice game someone is watching), for the players and the stands alike.
 *
 *  - COLLAPSED: one small "Lobby chat" button with the unread count (the DM red chip). EXPANDED: the messages and a
 *    composer, in the chat window's look (`dm.css`: the same bubbles, meta line, input and Send). The state is kept on
 *    this device.
 *  - Each message shows its sender's name (a player's in gold) and time. Someone else's carries Mute (this game, my
 *    screen only); a muted count in the header unmutes them all. The swear filter is the messages setting.
 *  - A guest reads only: the composer says to sign in. The Settings switch hides the whole thing.
 *  - Keys typed in the composer never reach the game's shortcuts (the spectator's seat keys, emotes); Escape leaves it.
 *
 * COST: it subscribes to its own store only; a message re-renders this panel, never the game. Motion: one-shot
 * transform + opacity on expand; nothing loops. Cursors: the gauntlet's global rule (no cursor here, CLAUDE.md).
 */
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { sfx } from '../sfx';
import { GameScroll } from '../GameScroll';
import { useFriendsPrefs } from '../friends/friendsPrefs';
import { DmBody, dmTime } from '../friends/dm/DmConversation';
import {
  LOBBY_CHAT_GUEST_TEXT, LOBBY_CHAT_MAX_CHARS, retryLobbyChat, sendLobbyChat, setLobbyChatMuted, setLobbyChatOpen, useLobbyChat, type ShownChatMsg,
} from './lobbyChatStore';
import '../friends/dm/dm.css';
import './lobbyChat.css';

const Message = memo(function Message({ m, mine, filter }: { m: ShownChatMsg; mine: boolean; filter: boolean }) {
  const at = new Date(m.at).toISOString();
  return (
    <div className={`dm-msg lchat-msg ${mine ? 'mine' : 'theirs'}${m.state ? ` ${m.state}` : ''}`}>
      {!mine && <div className={`lchat-name${m.role === 'player' ? ' player' : ''}`}>{m.name}</div>}
      {/* The DM body: words through the filter, chat emotes (`:id:`) inline (R-DM-EMOTE-01). */}
      <div className="dm-bubble"><DmBody body={m.body} filter={filter} /></div>
      <div className="dm-meta">
        {m.state === 'sending' ? <span>Sending</span>
          : m.state === 'failed' ? (
            <>
              <span className="dm-err">{m.error}</span>
              {m.cid && <button type="button" className="dm-link pressable" onClick={() => { sfx.pulse(); retryLobbyChat(m.cid!); }}>Retry</button>}
            </>
          ) : <span>{dmTime(at)}</span>}
        {!mine && !m.state && (
          <button type="button" className="dm-link dm-report pressable" aria-label={`Mute ${m.name} in this game`}
            onClick={() => { sfx.pulse(); setLobbyChatMuted(m.from, true); }}>
            Mute
          </button>
        )}
      </div>
    </div>
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
  const filter = useFriendsPrefs((s) => s.filterMessages);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const shown = msgs.filter((m) => !muted[m.from.toLowerCase()]);
  const mutedCount = Object.keys(muted).length;
  const last = shown[shown.length - 1];

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last?.id, last?.state, shown.length]);

  return (
    <section className="lchat vspanel" aria-label="Lobby chat">
      <header className="lchat-head">
        <span className="lchat-title">Lobby chat</span>
        {mutedCount > 0 && (
          <button type="button" className="dm-link lchat-unmute pressable" aria-label={`Unmute ${mutedCount} muted`}
            onClick={() => { sfx.pulse(); for (const id of Object.keys(muted)) setLobbyChatMuted(id, false); }}>
            {`${mutedCount} muted. Unmute`}
          </button>
        )}
        <button type="button" className="lchat-hide pressable" aria-label="Collapse lobby chat" onClick={() => { sfx.pulse(); setLobbyChatOpen(false); }}>
          <span aria-hidden="true">{'–'}</span>
        </button>
      </header>
      <GameScroll className="lchat-list" outerClassName="lchat-list-wrap" role="log" aria-label="Lobby chat messages" aria-live="polite" viewRef={listRef}
        onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
        {shown.length ? (
          <div className="dm-list">
            {shown.map((m) => <Message key={m.cid && m.from.toLowerCase() === me ? m.cid : m.id} m={m} mine={!!me && m.from.toLowerCase() === me} filter={filter} />)}
          </div>
        ) : <div className="lchat-empty">No messages yet. Say hi.</div>}
      </GameScroll>
      <Composer canSend={canSend} onSent={() => { atBottom.current = true; }} />
    </section>
  );
}

function Composer({ canSend, onSent }: { canSend: boolean; onSent: () => void }): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const left = LOBBY_CHAT_MAX_CHARS - [...text].length;
  const submit = (): void => {
    const err = sendLobbyChat(text);
    setError(err);
    if (!err && text.trim()) { setText(''); onSent(); sfx.pulse(); }
  };
  const label = canSend ? 'Message the lobby' : LOBBY_CHAT_GUEST_TEXT;
  return (
    <form className="fdock-compose dm-compose lchat-compose" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <span className="dm-field">
        <input className="acctinput fdock-input dm-input lchat-input" type="text" enterKeyHint="send" autoComplete="off" spellCheck
          disabled={!canSend} maxLength={LOBBY_CHAT_MAX_CHARS * 2} value={text} placeholder={label} aria-label={label}
          onChange={(e) => { setText(e.target.value); if (error) setError(null); }}
          // Typing is not playing: no key reaches the game's shortcuts. Escape leaves the field (and no more).
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') e.currentTarget.blur(); }}
          onKeyUp={(e) => e.stopPropagation()} />
        {canSend && left < 60 && <span className={`dm-count${left < 0 ? ' over' : ''}`} aria-live="polite">{left}</span>}
      </span>
      <button type="submit" className="lb-btn pressable dm-send" disabled={!canSend || !text.trim()}>Send</button>
      {error && <div className="dm-err dm-formerr" role="alert">{error}</div>}
    </form>
  );
}
