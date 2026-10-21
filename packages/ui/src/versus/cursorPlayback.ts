/**
 * THE WATCHED HAND'S PLAYBACK CLOCK (owner 2026-10-20: "cursor tracking is janky sometimes ... i want them to be way
 * cleaner and smoother"; R-SPECTATE-SMOOTH-01). Pure: no DOM, no timers.
 *
 * Why it stuttered. Samples were stamped with the time they ARRIVED and drawn a fixed 100 ms behind. Realtime delivery
 * is bursty (two samples in one frame, then nothing for 150 ms), so the arrival stamps carried the network's jitter
 * straight into the motion: the hand sped up, stopped at the end of the buffer, then jumped. And 15 samples a second
 * drew a 15 Hz polygon of the path.
 *
 * Now each sample carries the SENDER's own clock (`ts`, its `performance.now()`), and a message carries up to three
 * points taken ~16 ms apart (a 60 Hz path at 20 messages a second). The receiver maps the sender's clock onto its own:
 *   - `base`: the smallest (arrival - sent) seen lately, i.e. the fastest delivery, so `sent + base` is when that moment
 *     would have arrived with no queueing at all;
 *   - `buffer`: how far behind that the hand is drawn: one send interval (the oldest point of a message is that much
 *     older than the message) plus the recent jitter (the 90th percentile of the delivery delay above `base`), clamped,
 *     and eased so a change never warps the motion.
 * The hand is interpolated between points at `now - buffer`, and when the data runs dry it keeps its last velocity for a
 * few frames (bounded) instead of stopping dead, then holds.
 */

/** A point on the SENDER's clock (`s`, ms) landed on this screen (`x`, `y`, screen px). */
export interface PlaybackPoint { s: number; x: number; y: number }

/** The sender's message interval (`spectateTap.CURSOR_TICK_MS`): the oldest point of a message is this much older. */
export const SEND_INTERVAL_MS = 50;
/** The buffer's bounds and its margin over the measured jitter. */
export const MIN_BUFFER_MS = 60;
export const MAX_BUFFER_MS = 240;
const MARGIN_MS = 12;
/** How many recent deliveries the clock remembers (about two seconds of messages). */
const WINDOW = 40;
/** How far past the newest point the hand keeps moving on its last velocity. */
export const EXTRAPOLATE_MS = 40;

export interface RemoteClock {
  /** Recent (arrival - sent) delays, oldest first. */
  delays: number[];
  /** The fastest recent delivery (arrival - sent), or NaN before the first sample. */
  base: number;
  /** How far behind the fastest-delivery timeline the hand is drawn (eased). */
  buffer: number;
}

export const newRemoteClock = (): RemoteClock => ({ delays: [], base: NaN, buffer: SEND_INTERVAL_MS + 40 });

/** A message arrived: `sent` on the sender's clock, `arrived` on ours. Updates `base` and the eased `buffer`. */
export function noteDelivery(c: RemoteClock, sent: number, arrived: number): void {
  const d = arrived - sent;
  if (!Number.isFinite(d)) return;
  c.delays.push(d);
  if (c.delays.length > WINDOW) c.delays.shift();
  const sorted = [...c.delays].sort((a, b) => a - b);
  c.base = sorted[0]!;
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]!;
  const target = Math.min(MAX_BUFFER_MS, Math.max(MIN_BUFFER_MS, SEND_INTERVAL_MS + (p90 - c.base) + MARGIN_MS));
  // Grow fast (a late packet is a visible stall), shrink slowly (a quiet spell should not tighten the slack at once).
  c.buffer += (target - c.buffer) * (target > c.buffer ? 0.35 : 0.04);
}

/** The SENDER-clock moment the hand should show at local time `now`. */
export const playbackTime = (c: RemoteClock, now: number): number => now - (Number.isFinite(c.base) ? c.base : 0) - c.buffer;

/** The local time at which playback reaches sender moment `s` (so an action lands as the drawn hand gets there). */
export const localTimeOf = (c: RemoteClock, s: number): number => s + (Number.isFinite(c.base) ? c.base : 0) + c.buffer;

/**
 * The point at sender moment `s` along `pts` (sorted by `s`): linear between neighbours, held before the first, and
 * carried on the last segment's velocity for up to `EXTRAPOLATE_MS` past the newest, then held. Pure, tested.
 */
export function pointAt(pts: readonly PlaybackPoint[], s: number): { x: number; y: number } | null {
  const n = pts.length;
  if (n === 0) return null;
  const first = pts[0]!;
  if (s <= first.s) return { x: first.x, y: first.y };
  const last = pts[n - 1]!;
  if (s >= last.s) {
    if (n < 2) return { x: last.x, y: last.y };
    const prev = pts[n - 2]!;
    const span = last.s - prev.s;
    if (span <= 0 || span > 120) return { x: last.x, y: last.y }; // a pause, not a motion: no velocity to carry
    const k = Math.min(s - last.s, EXTRAPOLATE_MS) / span;
    return { x: last.x + (last.x - prev.x) * k, y: last.y + (last.y - prev.y) * k };
  }
  // The newest points are where playback usually is: search from the end.
  for (let i = n - 1; i > 0; i--) {
    const a = pts[i - 1]!;
    if (a.s <= s) {
      const b = pts[i]!;
      const k = b.s === a.s ? 1 : (s - a.s) / (b.s - a.s);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return { x: first.x, y: first.y };
}

/** Insert a point keeping `pts` sorted by `s` (points usually arrive in order; a late one slots in), capped. */
export function addPoint(pts: PlaybackPoint[], p: PlaybackPoint, cap = 48): void {
  let i = pts.length;
  while (i > 0 && pts[i - 1]!.s > p.s) i--;
  if (i > 0 && pts[i - 1]!.s === p.s) pts[i - 1] = p;
  else pts.splice(i, 0, p);
  if (pts.length > cap) pts.splice(0, pts.length - cap);
}
