/**
 * CHAT BUBBLES (owner 2026-11-06: "how it shows an elipses when someone's typing, then their typed text in a speech bubble
 * next to their name"; R-CHAT-BUBBLE-01). Each speaker's bubble sits beside their face: a spectator's rail row, or a
 * player's hero portrait, wherever the emote bubble for that face would go (`emoteBubble.placementFor`).
 *
 * A bubble is placed ONCE when it opens or its speech changes (one rect read, never per frame). Only `transform` and
 * `opacity` move: the pop is one-shot, and the three dots loop on opacity alone (docs/performance.md). Bubbles never cover
 * each other: a new one slides down its side until it clears the others. The text is plain React text, never markup, and
 * the reader's swear filter applies.
 */
import { memo, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { maskProfanity } from '../friends/dm/profanity';
import { placementFor } from '../emotes/emoteBubble';
import { PLAYER_SEAT } from '../emotes/emoteRuntime';
import { useFriendsPrefs } from '../friends/friendsPrefs';
import { stageHost, stageViewport } from '../stage';
import { useGame } from '../store';
import { chatSeatOf, MAX_CHAT_BUBBLES, useChatSpeech, type Speech } from './chatSpeech';
import { useLobbyChat } from './lobbyChatStore';
import './chatBubble.css';

const GAP = 6;

const ChatBubble = memo(function ChatBubble({ id, speech, me, staged, filter }: { id: string; speech: Speech; me: string | null; staged: boolean; filter: boolean }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const seat = chatSeatOf(id, speech.role, me);
    const at = seat ? placementFor(seat) : null;
    if (!at) { el.style.visibility = 'hidden'; return; }
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    // A hero portrait's emote eclipses its edge; words must not, so this one stands clear of it.
    const clear = seat === PLAYER_SEAT ? 56 : 0;
    const left = at.side === 'right' ? at.x + clear : at.x - w;
    let top = Math.max(GAP, at.y - h / 2);
    // Below every placed bubble this one would touch.
    const others = [...document.querySelectorAll<HTMLElement>('.chatbub')].filter((o) => o !== el && o.style.visibility === 'visible');
    for (let moved = true, pass = 0; moved && pass < MAX_CHAT_BUBBLES; pass++) {
      moved = false;
      for (const o of others) {
        const ol = o.offsetLeft, ot = o.offsetTop;
        if (ol < left + w && left < ol + o.offsetWidth && ot < top + h && top < ot + o.offsetHeight) { top = ot + o.offsetHeight + GAP; moved = true; }
      }
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.min(top, stageViewport().h - h - GAP))}px`;
    el.classList.toggle('right', at.side === 'right');
    el.classList.toggle('left', at.side === 'left');
    el.style.visibility = 'visible';
  }, [id, speech, me, staged]);
  return (
    <div ref={ref} className={`chatbub ${speech.kind}`} style={{ visibility: 'hidden' }} aria-hidden="true">
      {speech.kind === 'typing'
        ? <span className="chatbub-dots"><i /><i /><i /></span>
        : <span className="chatbub-text">{filter ? maskProfanity(speech.body ?? '') : speech.body}</span>}
    </div>
  );
});

export const ChatBubbleLayer = memo(function ChatBubbleLayer(): JSX.Element | null {
  const by = useChatSpeech((s) => s.by);
  const me = useLobbyChat((s) => s.me);
  const staged = useGame((s) => !!s.combatStaged);
  const filter = useFriendsPrefs((s) => s.filterMessages);
  const ids = Object.keys(by);
  if (ids.length === 0) return null;
  // A said line outranks an ellipsis when the screen is full.
  const shown = [...ids.filter((i) => by[i]!.kind === 'text'), ...ids.filter((i) => by[i]!.kind === 'typing')].slice(0, MAX_CHAT_BUBBLES);
  return createPortal(<>{shown.map((id) => <ChatBubble key={id} id={id} speech={by[id]!} me={me} staged={staged} filter={filter} />)}</>, stageHost());
});
