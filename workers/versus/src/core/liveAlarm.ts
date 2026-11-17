/**
 * WHEN A LIVE HOST'S ALARM NEXT FIRES (R-SESSION-ALARM-01). Pure: the Durable Object (`liveHost.ts` `rearm`) gathers the
 * clocks, this picks the alarm.
 *
 * The bug it closes (usage audit 2026-11-17: the hub's GameSession took ~7.5 requests a second per game, ~13.8M a month
 * against 1M included, and never hibernated): once a session game ended and every socket was gone, the live part's
 * "forget me" clock was already in the past (`LiveCore.nextAt` answers `activeAt` for an ended game). The alarm fired at
 * once, the live part was idle, but the SESSION still kept its state for its 30-minute memory (`keepsState`), so nothing
 * was forgotten and the same past time was armed again: an alarm loop for up to 30 minutes after every game.
 *
 * So: the live part's idle clock counts only when the host may actually forget itself (the host's own clock, `extra`,
 * covers the rest: the session's forget time is in it), the ended game's "let go of the sockets" clock counts only while
 * a socket is still connected and it is still ahead, and a re-arm from inside the alarm is never sooner than
 * `LIVE_ALARM_FLOOR_MS` (a backstop: any clock that stays in the past costs one wake a second, never a tight loop).
 */

/** A re-arm from inside the alarm waits at least this long. */
export const LIVE_ALARM_FLOOR_MS = 1_000;
/** An ended game lets go of anyone still connected this long after the end. */
export const LIVE_END_LINGER_MS = 2 * 60_000;

export interface LiveAlarmInput {
  now: number;
  /** The host's own clock (the session's flushes and forget time), or null. */
  extra: number | null;
  /** The gone player's grace (the game then ends as abandoned), or null. */
  grace: number | null;
  /** The live part's idle forget, or null. It acts only when the host may forget itself. */
  idle: number | null;
  /** The host keeps state beyond the live game (the idle forget cannot run yet). */
  keepsState: boolean;
  /** The watch record reporter's clock, or null. */
  reporter: number | null;
  /** The Live Games listing's clock, or null. */
  listing: number | null;
  /** Each live socket's stale check. */
  stale: number[];
  /** When the game ended, or null. */
  endedAt: number | null;
  /** Live sockets connected. */
  sockets: number;
  /** This re-arm runs inside the alarm handler. */
  fromAlarm: boolean;
}

/** The alarm to arm, or null (nothing is due: the object may sleep with no alarm). */
export function liveAlarmAt(i: LiveAlarmInput): number | null {
  const due: number[] = [];
  if (i.extra != null) due.push(i.extra);
  if (i.grace != null) due.push(i.grace);
  if (i.idle != null && !i.keepsState) due.push(i.idle);
  if (i.reporter != null) due.push(i.reporter);
  if (i.listing != null) due.push(i.listing);
  due.push(...i.stale);
  if (i.endedAt != null && i.sockets > 0) {
    const letGo = i.endedAt + LIVE_END_LINGER_MS;
    if (letGo > i.now) due.push(letGo);
  }
  if (!due.length) return null;
  const floor = i.fromAlarm ? i.now + LIVE_ALARM_FLOOR_MS : i.now;
  return Math.max(floor, Math.min(...due));
}
