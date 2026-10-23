/**
 * REPLAY V2 — THE SPECTATOR STREAM RECORDER (owner 2026-10-22: "is our replay as good as spectating is? spectating
 * seems basically perfect now... would love to keep them both maintained"; R-REPLAY-STREAM-01).
 *
 * While a run records a replay, this subscribes to the SAME cursor messages the live spectator sender broadcasts
 * (`versus/cursorSource.ts`, one builder for both) and stores them in the replay (`ReplayV2.stream`), together with the
 * two screen events that are not cursor messages: the shop overlays' minimize state and the fight's Skip. Each message
 * is put on the replay frames' clock (`clockAt`, the store's own clock), so the stream and the frames are one timeline.
 *
 * IN COMBAT TOO, AND THE EMOTES (owner 2026-10-22: "i dont think spectators can see player mouse behavior in combat (or
 * emotes) which would be nice to see"; R-REPLAY-EMOTE-01, R-SPECTATE-COMBATCURSOR-01). The hand is recorded through the
 * fight as well as the shop (the live stands get it in both), and every emote shown on the player's screen (their own,
 * and the seats they faced) is recorded at the moment it popped, so a replay shows it at the same moment.
 *
 * Storage: one segment per round (`@game/sim` `replayStream.ts`), columnar, delta-coded and packed. A round's segment is
 * sealed once the round has moved on, so the per-round draft write and the run-end upload read the closed segments by
 * reference and seal only the open one.
 *
 * Cost on the player's frames: nothing per pointer move (the source writes into a fixed pool). Per message (at most
 * 20 a second while the hand moves): one clock read, a few integer pushes, and a short JSON compare of the held card /
 * aim (the sender already does the same). No layout read of its own.
 */
import {
  EV_OVERLAY, EV_SKIP, STREAM_RUN_MAX_MSGS, encodeStreamEmote, encodeStreamEvent, encodeStreamMessage, newStreamEncoder, overlayBitsOf,
  sealStreamSegment, shiftStreamSegment, streamMessageCount,
  type ReplayStream, type StreamCursorBody, type StreamEncoder, type StreamSegment,
} from '@game/sim';
import type { EmoteMessage } from '@game/sim';
import { subscribeEmotes } from '../emotes/emoteTransport';
import { subscribeCursor } from '../versus/cursorSource';

/** What the recorder asks the store (installed by the store; the recorder never imports it). */
export interface StreamRecorderHooks {
  /** The replay frames' clock at `performance.now()` time `perfMs`. */
  clockAt(perfMs: number): number;
  /** Whether the run on screen records a replay now, its round, and whether it is in the shop (informational: cursor
   *  messages and emotes are recorded in the shop and the fight alike since 2026-10-22). Null = record nothing. */
  recording(): { wave: number; shop: boolean } | null;
}

let hooks: StreamRecorderHooks | null = null;
/** Closed segments, in clock order (immutable). */
let segs: StreamSegment[] = [];
/** The open segment's encoder. */
let enc: StreamEncoder | null = null;
/** Messages recorded across the run (the run cap). */
let total = 0;

export function installStreamRecorder(h: StreamRecorderHooks | null): void {
  hooks = h;
}

/** The encoder for `wave`, opening a new segment (closing the old one) when the round moved on. */
function encoderFor(wave: number, t: number): StreamEncoder {
  if (enc && enc.seg.w === wave) return enc;
  closeOpen();
  enc = newStreamEncoder(wave, t);
  return enc;
}

function closeOpen(): void {
  if (enc && (enc.seg.n > 0 || enc.seg.e?.length || enc.seg.em?.length)) segs.push(sealStreamSegment(enc));
  enc = null;
}

const onBody = (body: StreamCursorBody): void => {
  const r = hooks?.recording();
  if (!r) return;
  const t = hooks!.clockAt(typeof body.ts === 'number' ? body.ts : performance.now());
  if (encodeStreamMessage(encoderFor(r.wave, t), body, t, total >= STREAM_RUN_MAX_MSGS)) total += 1;
};

/** A lobby seat id (`s0` the player, `s1`..`s7` the table): the only emotes a replay keeps (a spectator's `w:` chip
 *  bubble is not part of the game). */
const SEAT = /^s[0-9]{1,2}$/;
/** An emote popped on the player's screen: record it at this moment (R-REPLAY-EMOTE-01). */
const onEmote = (m: EmoteMessage): void => {
  if (!SEAT.test(m.seat) || typeof m.emoteId !== 'string' || m.emoteId.length > 64) return;
  const r = hooks?.recording();
  if (!r) return;
  const t = hooks!.clockAt(performance.now());
  encodeStreamEmote(encoderFor(r.wave, t), t, m.seat, m.emoteId);
};

/** Record the cursor stream and the emotes while the returned stop is not called (the live run screen mounts it, in the
 *  shop and the fight alike). */
export function startStreamCapture(): () => void {
  const offCursor = subscribeCursor(onBody);
  const offEmotes = subscribeEmotes(onEmote);
  return () => { offCursor(); offEmotes(); };
}

/** The shop overlays' minimize state changed (`spectateTap.tapOverlay`, already de-duplicated there). */
export function noteStreamOverlay(min: { discover: boolean; power: boolean; quest: boolean; forge: boolean }): void {
  const r = hooks?.recording();
  if (!r) return;
  const t = hooks!.clockAt(performance.now());
  encodeStreamEvent(encoderFor(r.wave, t), t, EV_OVERLAY, overlayBitsOf(min));
}

/** The player skipped the fight on screen (`spectateTap.tapSkipCombat`). */
export function noteStreamSkip(): void {
  const r = hooks?.recording();
  if (!r) return;
  const t = hooks!.clockAt(performance.now());
  encodeStreamEvent(encoderFor(r.wave, t), t, EV_SKIP);
}

/** A new run: start empty (or from a resumed draft's restored segments). */
export function resetStream(restored: readonly StreamSegment[] = []): void {
  segs = restored.slice();
  enc = null;
  total = streamMessageCount(segs);
}

/** A resumed run: move what this session recorded along the clock by `offsetMs`, and put the restored rounds in front. */
export function prependStream(restored: readonly StreamSegment[], offsetMs: number): void {
  segs = [...restored, ...segs.map((g) => shiftStreamSegment(g, offsetMs))];
  if (enc && offsetMs) {
    enc.seg.t0 += offsetMs;
    enc.seg.t1 += offsetMs;
    enc.lastT += offsetMs;
  }
  total += streamMessageCount(restored);
}

/** Every segment so far: the closed ones by reference (sealed once, immutable), the open one sealed as a copy (it keeps
 *  growing). Called once per round boundary and at run end, never per message. */
export function takeStreamSegments(): StreamSegment[] {
  if (!enc || (enc.seg.n === 0 && !enc.seg.e?.length && !enc.seg.em?.length)) return segs.slice();
  return [...segs, sealStreamSegment(enc)];
}

/** The replay's stream (`ReplayV2.stream`), or null when nothing was recorded. */
export function takeStream(): ReplayStream | null {
  const all = takeStreamSegments();
  return all.length ? { v: 1, segs: all } : null;
}
