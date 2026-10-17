/**
 * SPECTATOR EMOTES (owner 2026-10-16: "add a feature that allows spectators to emote to players and they can see in the
 * top left where the spectators are"; R-SPECTATE-EMOTE-01).
 *
 * A spectator says an emote with the SAME menu, their own equipped emotes and the same 20 s cooldown as a player
 * (`emotes/emoteRuntime.ts` routes `sayEmote` here while a spectator sink is installed). It travels on the game's
 * existing spectate broadcast channel (the Versus room channel, or a live game's `lobbylive:<id>`) as one tiny event:
 * `{ e: emoteId, from: userId }`. No timestamp rides it: every clock used to judge it is the RECEIVER's own.
 *
 * WHO SEES IT. Everyone on the channel: the player being watched (it pops from that spectator's chip in their top-left
 * "Spectating" indicator) and every other spectator of the game (it pops from that spectator's chip in their own
 * top-left stands row). The speaker sees their own bubble at once, from their own chip.
 *
 * WHAT A RECEIVER REFUSES (the channel is a public broadcast: any subscriber can send on it, and Supabase Realtime
 * cannot rate-limit one sender's broadcasts server side, so the receiver is the guard):
 *  - a sender who is not in this client's stands (the watcher rows: Versus room members, live watcher rows). An
 *    unknown sender is held a moment (their row may simply not have been read yet) and dropped if it never appears;
 *  - a second emote from the same sender inside the cooldown (less a small allowance for network jitter), measured
 *    on the receiver's own clock;
 *  - more than `STANDS_BURST.max` spectator bubbles inside `STANDS_BURST.windowMs` (a full stands of 20 never floods
 *    the screen);
 *  - anything while "Spectator emotes" is off (Esc menu), or from a spectator muted by right-clicking their chip;
 *  - an unknown or retired emote id.
 */
import { create } from 'zustand';
import { emoteOf } from '@game/progression';
import { EMOTE_COOLDOWN_MS } from '@game/sim';
import { showEmoteBubble } from '../emotes/emoteBubble';
import { equippedEmotes } from '../emotes/emoteLoadout';
import { emoteNow, setSpectatorEmoteSink } from '../emotes/emoteRuntime';
import { useWatchers } from './watchers';

export const SPECTATOR_EMOTE_EVENT = 'spectate_emote';
/** The shortest gap a receiver accepts between two emotes from one spectator (the cooldown, less jitter). */
export const SPECTATOR_EMOTE_GAP_MS = EMOTE_COOLDOWN_MS - 2000;
/** At most `max` spectator bubbles in any `windowMs`, whoever sent them. */
export const STANDS_BURST = { max: 3, windowMs: 3000 } as const;
/** How long an emote from a sender not yet in the stands waits for their row. */
export const PENDING_MS = 3000;

/** The wire message. */
export interface SpectatorEmoteWire { e: string; from: string }

/** The bubble anchor key of a spectator's chip (`emoteBubble.placementFor`). */
export const watcherSeat = (id: string): string => `w:${id}`;

const ID = /^[A-Za-z0-9_:-]{1,64}$/;
/** Validate an inbound payload; null when it is not a well-formed spectator emote. Pure. */
export function parseSpectatorEmote(payload: unknown): SpectatorEmoteWire | null {
  const p = payload as Partial<SpectatorEmoteWire> | null;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.e !== 'string' || !/^[a-z0-9_]{1,64}$/.test(p.e)) return null;
  if (typeof p.from !== 'string' || !ID.test(p.from)) return null;
  return { e: p.e, from: p.from };
}

// ── the player's choices: the switch and the per-spectator mutes ────────────────────────────────────────────

const PREF_KEY = 'ascent.spectatorEmotes';
const MUTE_KEY = 'ascent.spectatorEmoteMutes';
const readOn = (): boolean => { try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; } };
const readMuted = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(MUTE_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(-100) : [];
  } catch { return []; }
};

/** "Spectator emotes" (default on) and the spectators muted on this device. A per-viewer convenience. */
export const useSpectatorEmotePrefs = create<{ on: boolean; muted: readonly string[] }>(() => ({
  on: typeof localStorage === 'undefined' ? true : readOn(),
  muted: typeof localStorage === 'undefined' ? [] : readMuted(),
}));

export function setSpectatorEmotesOn(on: boolean): void {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* storage unavailable: lasts this session */ }
  useSpectatorEmotePrefs.setState({ on });
}
export const isSpectatorMuted = (id: string): boolean => useSpectatorEmotePrefs.getState().muted.includes(id);
/** Mute (or unmute) one spectator's emotes on this device. */
export function toggleSpectatorMute(id: string): boolean {
  if (!ID.test(id)) return false;
  const cur = useSpectatorEmotePrefs.getState().muted;
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-100);
  try { localStorage.setItem(MUTE_KEY, JSON.stringify(next)); } catch { /* storage unavailable: lasts this session */ }
  useSpectatorEmotePrefs.setState({ muted: next });
  return next.includes(id);
}

// ── receiving ───────────────────────────────────────────────────────────────────────────────────────────────

/** My own id while I am a spectator (my echo is ignored: my bubble went up when I said it). */
let me: string | null = null;
const lastFrom = new Map<string, number>();
let recent: number[] = [];
let pending: { m: SpectatorEmoteWire; at: number }[] = [];
/** Asked when an emote arrives from someone not in the stands yet (a live spectator re-reads its fellows). */
let onUnknown: (() => void) | null = null;

const known = (id: string): boolean => useWatchers.getState().list.some((w) => w.id === id);

function accept(m: SpectatorEmoteWire, now: number): boolean {
  const prefs = useSpectatorEmotePrefs.getState();
  if (!prefs.on || prefs.muted.includes(m.from) || !emoteOf(m.e)) return false;
  const last = lastFrom.get(m.from);
  if (last != null && now - last < SPECTATOR_EMOTE_GAP_MS) return false;
  recent = recent.filter((t) => now - t < STANDS_BURST.windowMs);
  if (recent.length >= STANDS_BURST.max) return false;
  // Nothing on screen to pop from (the indicator is not mounted): nothing shown, so nothing is counted either.
  if (!showEmoteBubble(watcherSeat(m.from), m.e)) return false;
  lastFrom.set(m.from, now);
  recent.push(now);
  return true;
}

/** The channel's `spectate_emote` handler. Returns whether a bubble was accepted. Never throws. */
export function receiveSpectatorEmote(payload: unknown, now: number = emoteNow()): boolean {
  const m = parseSpectatorEmote(payload);
  if (!m || m.from === me) return false;
  if (!known(m.from)) {
    pending = pending.filter((p) => now - p.at < PENDING_MS && p.m.from !== m.from).concat({ m, at: now }).slice(-4);
    onUnknown?.();
    return false;
  }
  return accept(m, now);
}

// The stands changed: an emote held for a sender who has just appeared goes up (if it is still fresh) once their chip
// has rendered, so the flush waits a tick past the list change.
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function flushPending(): void {
  flushTimer = null;
  const now = emoteNow();
  const keep: typeof pending = [];
  for (const p of pending) {
    if (now - p.at >= PENDING_MS) continue;
    if (known(p.m.from)) accept(p.m, now);
    else keep.push(p);
  }
  pending = keep;
}
useWatchers.subscribe((s, prev) => {
  if (s.list === prev.list || pending.length === 0 || flushTimer != null) return;
  flushTimer = setTimeout(flushPending, 0);
});

/** Listen for unknown senders (null: stop). */
export function onUnknownSpectatorEmote(fn: (() => void) | null): void { onUnknown = fn; }

// ── saying one (as a spectator) ─────────────────────────────────────────────────────────────────────────────

/**
 * I am spectating: emotes I say go out on `send` (the spectate channel) as me (`myId`), and pop from my own chip.
 * The cooldown and the menu are the player's own (`emoteRuntime.sayEmote`); only my equipped emotes go out.
 */
export function installSpectatorEmotes(myId: string, send: (event: string, payload: unknown) => void): void {
  me = myId;
  setSpectatorEmoteSink((emoteId) => {
    if (!equippedEmotes().includes(emoteId)) return false;
    const wire: SpectatorEmoteWire = { e: emoteId, from: myId };
    send(SPECTATOR_EMOTE_EVENT, wire);
    showEmoteBubble(watcherSeat(myId), emoteId);
    return true;
  });
}

/** No longer spectating: emotes are a player's again. */
export function uninstallSpectatorEmotes(): void {
  me = null;
  setSpectatorEmoteSink(null);
  onUnknown = null;
}

/** Tests: forget every throttle, hold and mute. */
export function resetSpectatorEmotesForTests(): void {
  me = null;
  lastFrom.clear();
  recent = [];
  pending = [];
  if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null; }
  onUnknown = null;
  setSpectatorEmoteSink(null);
  useSpectatorEmotePrefs.setState({ on: true, muted: [] });
}
