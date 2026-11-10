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
import { sfx } from '../sfx';

export type ChatSpeakerRole = 'player' | 'spectator';
export interface Speech {
  kind: 'typing' | 'text';
  role: ChatSpeakerRole;
  body?: string;
  /** Who said it, when the key is not their id (the second and third bubble of a long message). */
  speaker?: string;
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
  markRailAwake(speech.speaker ?? id, ms + RAIL_AWAKE_TAIL_MS);
}

// ── a long message, as more than one bubble (owner 2026-11-09: "i need the long message to appear as two bubbles") ──
/** One bubble holds about this much (four lines at its widest); a longer message splits into more bubbles. */
export const CHAT_BUBBLE_PART_CHARS = 80;
/** At most this many bubbles for one message. */
export const CHAT_BUBBLE_MAX_PARTS = 3;
/** Each further bubble pops in this long after the one before it (each with its own pop). */
export const CHAT_BUBBLE_PART_GAP_MS = 220;
/** The key of a message's `i`th bubble (the first is the speaker's own id, so their ellipsis turns into it). */
export const chatPartKey = (id: string, i: number): string => (i === 0 ? id : `${id}~${i}`);

/**
 * Split `body` into the bubbles it is shown as: one when it fits, else even parts broken at the space nearest each cut
 * (a word, or an emote's `:token:`, is never broken unless it is longer than a whole bubble). Pure.
 */
export function splitChatBody(body: string): string[] {
  const chars = [...body];
  if (chars.length <= CHAT_BUBBLE_PART_CHARS) return [body];
  const parts = Math.min(CHAT_BUBBLE_MAX_PARTS, Math.ceil(chars.length / CHAT_BUBBLE_PART_CHARS));
  const out: string[] = [];
  let from = 0;
  for (let k = 1; k < parts; k++) {
    const target = Math.round((chars.length * k) / parts);
    let cut = -1;
    for (let d = 0; d <= 24 && cut < 0; d++) {
      if (chars[target - d] === ' ' && target - d > from) cut = target - d;
      else if (chars[target + d] === ' ') cut = target + d;
    }
    if (cut < 0) cut = target;
    out.push(chars.slice(from, cut).join('').trim());
    from = cut;
  }
  out.push(chars.slice(from).join('').trim());
  return out.filter(Boolean);
}

/** The later bubbles of a speaker's last message, still to pop in. */
const partTimers = new Map<string, number[]>();
function clearParts(id: string): void {
  for (const t of partTimers.get(id) ?? []) window.clearTimeout(t);
  partTimers.delete(id);
  for (let i = 1; i < CHAT_BUBBLE_MAX_PARTS; i++) dropSpeech(chatPartKey(id, i));
}

/** `id` started (or kept) typing, or stopped. A said line on show is never replaced by the next ellipsis' end. */
export function noteChatTyping(id: string, role: ChatSpeakerRole, on: boolean): void {
  const cur = useChatSpeech.getState().by[id];
  if (on) { if (cur?.kind !== 'text') put(id, { kind: 'typing', role }, CHAT_TYPING_TTL_MS); return; }
  if (cur?.kind === 'typing') dropSpeech(id);
}

/**
 * `id` said `body`: it takes the place of their ellipsis. A long one shows as more than one bubble, each popping in a
 * beat after the last, with its own pop (`mine`: my first pop already played as I sent it). Every bubble of one
 * message stays as long as the whole message needs to be read.
 */
export function noteChatSaid(id: string, role: ChatSpeakerRole, body: string, mine = false): void {
  clearParts(id);
  const parts = splitChatBody(body);
  const ms = Math.min(CHAT_BUBBLE_MAX_MS * parts.length, chatBubbleMs(body) + (parts.length - 1) * 2500);
  put(id, { kind: 'text', role, body: parts[0] ?? body }, ms);
  if (!mine) sfx.chatPop();
  const timers: number[] = [];
  parts.slice(1).forEach((part, j) => {
    const i = j + 1;
    timers.push(window.setTimeout(() => {
      put(chatPartKey(id, i), { kind: 'text', role, body: part, speaker: id }, ms - i * CHAT_BUBBLE_PART_GAP_MS);
      sfx.chatPop();
    }, i * CHAT_BUBBLE_PART_GAP_MS));
  });
  if (timers.length) partTimers.set(id, timers);
}

/** The game ended or the chat closed: everything goes at once. */
export function clearChatSpeech(): void {
  for (const t of speechTimers.values()) window.clearTimeout(t);
  for (const t of awakeTimers.values()) window.clearTimeout(t);
  for (const ts of partTimers.values()) for (const t of ts) window.clearTimeout(t);
  partTimers.clear();
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
