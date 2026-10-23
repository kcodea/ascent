/**
 * REPLAY V2 — PLAYING THE RECORDED SPECTATOR STREAM (owner 2026-10-22: "is our replay as good as spectating is?
 * spectating seems basically perfect now... would love to keep them both maintained"; R-REPLAY-PLAYBACK-01).
 *
 * A replay recorded with a stream (`ReplayV2.stream`, R-REPLAY-STREAM-01) holds the SAME cursor messages the live
 * spectator sender broadcast. This module plays them through the watch screen's own pipeline: each message goes into
 * `spectate.ts`'s cursor feed (`ingestCursor`), whose clock is the replay frames' clock (`setCursorFeedClock`), and
 * `SpectatorCursor` draws the hand, the held card with its drop gap, the aim line and the drop spring-back, and opens
 * the hover previews (`spectatorHover.ts`), exactly as it does live. So one pipeline maintains both.
 *
 * Feeding: every `FEED_MS` while a replay with a stream is on screen, the messages up to a small fixed lead ahead of the
 * replay clock go into the feed (recorded data has no network jitter, so a fixed lead replaces the live jitter buffer).
 * The hand is drawn AT the replay clock, so it honours pause and the speed slider for free, and an action's frame (its
 * commit, on the same clock) lands as the drawn hand gets there.
 *
 * Seeking: the feed is cleared and rebuilt at the target: the last message at or before it sets the hand's state at
 * once (held card, aim, hover, hidden; no pick-up cue, no drop verdict) and the points just before it seed the path.
 *
 * IN THE FIGHT TOO, AND THE EMOTES (owner 2026-10-22: "i dont think spectators can see player mouse behavior in combat
 * (or emotes)"; R-SPECTATE-COMBATCURSOR-01, R-REPLAY-EMOTE-01): the hand is fed through combat frames as well (a stream
 * recorded before 2026-10-22 simply has no combat messages), and each recorded emote is delivered through the game's
 * emote seam (`deliverEmote`) when the replay clock reaches it, so it pops from the same portrait it did live. One the
 * clock skipped past (a seek, a jump) is never played late.
 *
 * Old replays (no stream) never come here: they keep the 20 Hz cursor trail and the drag ghost flights.
 *
 * Cost: one 30 ms timer while a stream replay is on screen; per tick a clock read and a compare, plus the messages it
 * feeds (20 a second at 1x: the live receiver's own work per message). Segments are decoded lazily, once each.
 */
import { create } from 'zustand';
import {
  EV_OVERLAY, EV_SKIP, OV_DISCOVER, OV_FORGE, OV_POWER, OV_QUEST, decodeStreamEmotes, decodeStreamEvents, decodeStreamSegment, isReplayStream,
  type RecordedCursorBody, type ReplayStream, type StreamSegment,
} from '@game/sim';
import { deliverEmote } from '../emotes/emoteTransport';
import { cursorFeed, ingestCursor, resetCursorFeed, setCursorFeedClock } from '../versus/spectate';
import { watchLocalHover } from '../versus/spectatorHover';

/** The feed tick (ms of real time). */
export const FEED_MS = 30;
/** How far ahead of the replay clock messages are fed (ms of replay time at 1x; scaled by the speed). */
export const FEED_LEAD_MS = 120;
/** A seek seeds the hand's path with the points this far before the target. */
export const SEEK_SEED_MS = 300;
/** A recorded emote the clock passed more than this long ago (replay ms) is dropped, never popped late. */
export const EMOTE_LATE_MS = 1500;

/** What Recruit applies from the stream: the recorded overlay minimize state, and a Skip of the fight on screen. */
export interface ReplayStreamUi {
  /** The minimized overlays at the replay's current moment (null: nothing recorded yet, leave them alone). */
  overlay: { discover: boolean; power: boolean; quest: boolean; forge: boolean } | null;
  /** Skip the fight of `wave` (`n` bumps per request; Recruit performs it once that fight plays). */
  skip: { wave: number; n: number } | null;
}
export const useReplayStream = create<ReplayStreamUi>(() => ({ overlay: null, skip: null }));

interface Seg { seg: StreamSegment; msgs: RecordedCursorBody[] | null }
let segs: Seg[] = [];
/** Every screen event, in clock order. */
let events: { t: number; code: number; value: number }[] = [];
let clock: (() => number) | null = null;
let speedOf: () => number = () => 1;
/** Every recorded emote, in clock order, and the next one to deliver. */
let emotes: { t: number; seat: string; id: string }[] = [];
let ei = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** The next message to feed: segment index + message index. */
let si = 0;
let mi = 0;
/** The overlay event index applied so far. */
let oi = -1;
let skipSeq = 0;
let skipTimer: ReturnType<typeof setTimeout> | null = null;

const msgsOf = (s: Seg): RecordedCursorBody[] => (s.msgs ??= decodeStreamSegment(s.seg));
const bitsToOverlay = (v: number): NonNullable<ReplayStreamUi['overlay']> => ({
  discover: (v & OV_DISCOVER) !== 0, power: (v & OV_POWER) !== 0, quest: (v & OV_QUEST) !== 0, forge: (v & OV_FORGE) !== 0,
});

/** Does this recording carry a playable stream? */
export const hasPlayableStream = (stream: unknown): stream is ReplayStream => isReplayStream(stream) && stream.segs.some((g) => g.n > 0);

/**
 * Start playing a replay's stream. `replayClock` is the replay frames' clock now (`replayClockMs`); `speed` the playback
 * speed; `sound` the viewer's Sounds toggle (the pick-up's touch). Returns false (and plays nothing) when the recording
 * has no usable stream.
 */
export function startStreamPlayback(stream: unknown, replayClock: () => number, speed: () => number, sound: () => boolean = () => true): boolean {
  stopStreamPlayback();
  if (!hasPlayableStream(stream)) return false;
  segs = [...stream.segs].sort((a, b) => a.t0 - b.t0).map((seg) => ({ seg, msgs: null }));
  events = segs.flatMap((s) => decodeStreamEvents(s.seg)).sort((a, b) => a.t - b.t);
  emotes = segs.flatMap((s) => decodeStreamEmotes(s.seg)).sort((a, b) => a.t - b.t);
  clock = replayClock;
  speedOf = speed;
  setCursorFeedClock(() => (clock ? clock() : 0), sound);
  watchLocalHover(true); // the viewer's own rune hover wins on their screen (R-SPECTATE-RUNEHOVER-01)
  seekStream(replayClock());
  timer = setInterval(tick, FEED_MS);
  return true;
}

/** Stop and forget the stream (the replay ended or another one started). */
export function stopStreamPlayback(): void {
  if (timer) clearInterval(timer);
  timer = null;
  if (skipTimer) clearTimeout(skipTimer);
  skipTimer = null;
  if (clock) {
    resetCursorFeed();
    setCursorFeedClock(null);
    watchLocalHover(false);
  }
  clock = null;
  segs = [];
  events = [];
  emotes = [];
  si = 0; mi = 0; oi = -1; ei = 0;
  useReplayStream.setState({ overlay: null, skip: null });
}

/** Is a stream playing? */
export const streamPlaying = (): boolean => clock !== null;

/** Feed the messages due by `upTo` (replay clock). */
function feedUpTo(upTo: number, now: number): void {
  while (si < segs.length) {
    const list = msgsOf(segs[si]!);
    const m = list[mi];
    if (!m) { si += 1; mi = 0; continue; }
    if (m.ts > upTo) break;
    ingestCursor(m, now);
    mi += 1;
  }
}

/** Apply the overlay events up to `t` (replay clock). */
function applyOverlayUpTo(t: number): void {
  let latest = -1;
  for (let i = oi + 1; i < events.length && events[i]!.t <= t; i++) if (events[i]!.code === EV_OVERLAY) latest = i;
  // advance the cursor past every event at or before t (skips are scheduled by the fight, not here)
  while (oi + 1 < events.length && events[oi + 1]!.t <= t) oi += 1;
  if (latest >= 0) useReplayStream.setState({ overlay: bitsToOverlay(events[latest]!.value) });
}

/** Pop the recorded emotes the clock has reached (R-REPLAY-EMOTE-01); one passed long ago is skipped, not played late. */
function deliverEmotesUpTo(t: number): void {
  while (ei < emotes.length && emotes[ei]!.t <= t) {
    const e = emotes[ei++]!;
    if (t - e.t > EMOTE_LATE_MS) continue;
    deliverEmote({ emoteId: e.id, seat: e.seat, phase: 'shop', offsetMs: 0, round: 0 });
  }
}

function tick(): void {
  if (!clock) return;
  const now = performance.now();
  const t = clock();
  applyOverlayUpTo(t);
  deliverEmotesUpTo(t);
  feedUpTo(t + FEED_LEAD_MS * Math.max(1, speedOf()), now);
  // A held hand (or a paused replay) keeps the overlay drawn: the feed's own staleness check only knows the wire.
  if (!cursorFeed.hidden && cursorFeed.pts.length) cursorFeed.lastAt = now;
}

/**
 * Rebuild the hand at replay time `t` (a seek, a round rail click, the start): the feed is cleared, the last message at
 * or before `t` sets the state at once, the points of the `SEEK_SEED_MS` before it seed the path, and feeding continues
 * from there. The overlay state is the latest recorded one at or before `t`. Deterministic: the same `t` always rebuilds
 * the same feed, whatever played before.
 */
export function seekStream(t: number): void {
  if (!clock) return;
  if (skipTimer) { clearTimeout(skipTimer); skipTimer = null; }
  resetCursorFeed();
  const now = performance.now();
  // The last message at or before t, across segments.
  let ls = -1;
  let lm = -1;
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i]!.seg;
    if (g.t0 > t) break;
    const list = msgsOf(segs[i]!);
    let lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid]!.ts <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    if (ans >= 0) { ls = i; lm = ans; }
  }
  if (ls >= 0) {
    const list = msgsOf(segs[ls]!);
    let from = lm;
    while (from > 0 && list[from - 1]!.ts >= t - SEEK_SEED_MS) from -= 1;
    for (let i = from; i < lm; i++) ingestCursor({ ...list[i]!, de: undefined }, now, true);
    ingestCursor(list[lm]!, now, true);
    si = ls;
    mi = lm + 1;
  } else {
    si = 0;
    mi = 0;
  }
  // The overlay state at t: the latest overlay event at or before it (none: leave the screen's own state alone).
  oi = -1;
  let latest = -1;
  for (let i = 0; i < events.length && events[i]!.t <= t; i++) { oi = i; if (events[i]!.code === EV_OVERLAY) latest = i; }
  useReplayStream.setState({ overlay: latest >= 0 ? bitsToOverlay(events[latest]!.value) : null, skip: null });
  // The emotes from here on (one already popped before the target is not popped again).
  ei = 0;
  while (ei < emotes.length && emotes[ei]!.t <= t) ei += 1;
}

/**
 * A fight frame just went on screen (played into, not scrubbed past). When the recorded player skipped it, the replay
 * skips at the same point: `fromMs` / `toMs` bound the fight on the replay clock (its frame and the next one), and the
 * skip is requested after the recorded delay at the current speed. Recruit performs it once the fight is playing.
 */
export function streamFightShown(wave: number, fromMs: number, toMs: number): void {
  if (!clock) return;
  if (skipTimer) { clearTimeout(skipTimer); skipTimer = null; }
  const ev = events.find((e) => e.code === EV_SKIP && e.t >= fromMs && e.t < toMs);
  if (!ev) return;
  const wait = Math.max(0, ev.t - fromMs) / Math.max(0.5, speedOf());
  skipTimer = setTimeout(() => {
    skipTimer = null;
    skipSeq += 1;
    useReplayStream.setState({ skip: { wave, n: skipSeq } });
  }, wait);
}

/** For the tests: the next message to feed. */
export const streamCursorPos = (): { si: number; mi: number } => ({ si, mi });
