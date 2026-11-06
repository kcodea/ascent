/**
 * WHO IS SPEAKING RIGHT NOW (owner 2026-11-06: spectators' rail + chat bubbles; R-SPECTATE-RAIL-01, R-CHAT-BUBBLE-01).
 *
 * The short-lived state behind the chat bubbles and the spectator rail, by user id:
 *  - `by`: an ellipsis while someone types, then what they said in a bubble.
 *  - `awake`: a spectator's rail row is at full size (they are typing, spoke, or emoted), and for how long after.
 *
 * Its own store, so a keystroke elsewhere in the lobby re-renders the bubbles and the rail rows only, never the game. It
 * changes only on a chat or emote event, and nothing here runs per frame.
 */
import { create } from 'zustand';
import { PLAYER_SEAT } from '../emotes/emoteRuntime';

export type ChatSpeakerRole = 'player' | 'spectator';
export interface Speech {
  kind: 'typing' | 'text';
  role: ChatSpeakerRole;
  body?: string;
}

/** A typist who goes quiet is cleared after this long (a sender renews well inside it, and a dropped "stopped" ends here). */
export const CHAT_TYPING_TTL_MS = 5000;
/** How long a said line stays: a base, plus time to read it, up to the most. */
export const CHAT_BUBBLE_MIN_MS = 3200;
export const CHAT_BUBBLE_PER_CHAR_MS = 45;
export const CHAT_BUBBLE_MAX_MS = 8000;
/** A row stays at full size this long after its speaker's bubble goes. */
export const RAIL_AWAKE_TAIL_MS = 1500;
/** The most bubbles on screen at once. */
export const MAX_CHAT_BUBBLES = 6;

export const chatBubbleMs = (body: string): number =>
  Math.min(CHAT_BUBBLE_MAX_MS, CHAT_BUBBLE_MIN_MS + [...body].length * CHAT_BUBBLE_PER_CHAR_MS);

export const useChatSpeech = create<{ by: Readonly<Record<string, Speech>>; awake: Readonly<Record<string, true>> }>(() => ({ by: {}, awake: {} }));

const speechTimers = new Map<string, number>();
const awakeTimers = new Map<string, number>();

function dropSpeech(id: string): void {
  const t = speechTimers.get(id);
  if (t != null) window.clearTimeout(t);
  speechTimers.delete(id);
  const { by } = useChatSpeech.getState();
  if (!by[id]) return;
  const next = { ...by };
  delete next[id];
  useChatSpeech.setState({ by: next });
}

/** Hold `id`'s rail row at full size for `ms` (a later, longer call extends it). */
export function markRailAwake(id: string, ms: number): void {
  const t = awakeTimers.get(id);
  if (t != null) window.clearTimeout(t);
  const { awake } = useChatSpeech.getState();
  if (!awake[id]) useChatSpeech.setState({ awake: { ...awake, [id]: true } });
  awakeTimers.set(id, window.setTimeout(() => {
    awakeTimers.delete(id);
    const cur = useChatSpeech.getState().awake;
    const next = { ...cur };
    delete next[id];
    useChatSpeech.setState({ awake: next });
  }, ms));
}

function put(id: string, speech: Speech, ms: number): void {
  const t = speechTimers.get(id);
  if (t != null) window.clearTimeout(t);
  useChatSpeech.setState({ by: { ...useChatSpeech.getState().by, [id]: speech } });
  speechTimers.set(id, window.setTimeout(() => dropSpeech(id), ms));
  markRailAwake(id, ms + RAIL_AWAKE_TAIL_MS);
}

/** `id` started (or kept) typing, or stopped. A said line on show is never replaced by the next ellipsis' end. */
export function noteChatTyping(id: string, role: ChatSpeakerRole, on: boolean): void {
  const cur = useChatSpeech.getState().by[id];
  if (on) { if (cur?.kind !== 'text') put(id, { kind: 'typing', role }, CHAT_TYPING_TTL_MS); return; }
  if (cur?.kind === 'typing') dropSpeech(id);
}

/** `id` said `body`: it takes the place of their ellipsis. */
export function noteChatSaid(id: string, role: ChatSpeakerRole, body: string): void {
  put(id, { kind: 'text', role, body }, chatBubbleMs(body));
}

/** The game ended or the chat closed: everything goes at once. */
export function clearChatSpeech(): void {
  for (const t of speechTimers.values()) window.clearTimeout(t);
  for (const t of awakeTimers.values()) window.clearTimeout(t);
  speechTimers.clear();
  awakeTimers.clear();
  useChatSpeech.setState({ by: {}, awake: {} });
}

// ── whose face a bubble sits on ─────────────────────────────────────────────────────────────────

/** The Versus client's map from a user to the seat their face shows under on this screen: undefined = not a Versus game. */
let seatResolver: ((id: string) => string | null | undefined) | null = null;
export function setChatSeatResolver(fn: typeof seatResolver): void { seatResolver = fn; }

const WATCHER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The anchor key (`emoteBubble.placementFor`) of `id`'s face, or null when it is not on this screen. */
export function chatSeatOf(id: string, role: ChatSpeakerRole, me: string | null): string | null {
  if (typeof document !== 'undefined' && WATCHER_ID.test(id) && document.querySelector(`[data-watcher="${id}"]`)) return `w:${id}`;
  if (me && id.toLowerCase() === me.toLowerCase()) return PLAYER_SEAT;
  const seat = seatResolver?.(id);
  if (seat !== undefined) return seat;
  return role === 'player' ? PLAYER_SEAT : null; // a live game has one player, and their portrait is the one on screen
}
