/**
 * THE MAGICIAN'S PASS LINES (owner 2026-11-12, R-DUOS-MAGICIAN-01): "Come up with 5 different pass lines that he can
 * randomly say when triggering his hero power. The teammate should hear these lines too."
 *
 * When the Magic Hat sends a copy, the Magician says one of five lines (`audio/heroes/magician.pass1..5.mp3`), on his
 * own screen and on his teammate's.
 *
 * BOTH PLAYERS HEAR THE SAME LINE. The line is a pure function of the COPY'S UID (`hat<n>`, stamped once by the sender's
 * reducer): the sender reads it off its outbox entry, the teammate reads it off the pass row's card (the uid already
 * rides the wire with the card), and a watcher reads it off the watched run's outbox. No random call on any client,
 * nothing in run state, no wire field added.
 *
 * ONCE PER COPY. Every screen that shows the send calls `speakHatLine(uid)`; a uid already spoken is silent. That covers
 * a re-delivered row, a send seen twice on one screen (a teammate who watched the Magician's board and then gets the
 * row on their own), and the Scene Builder (both runs on one page). A copy that waits for hand room speaks when its row
 * arrives, never again when it lands (the landing does not call this). A reload's restore replays passes through the
 * reducer, not through these call sites, so it says nothing.
 *
 * PRESENTATION ONLY: module state, never in run state or on the wire.
 */
import { sfx } from '../sfx';

/** How many lines there are (`magician.pass1` .. `magician.pass5`). */
export const HAT_LINE_COUNT = 5;

/** The line (1..5) for the copy `uid`: a pure function of the uid (FNV-1a), the same on every screen. */
export function hatLineOf(uid: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) {
    h ^= uid.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % HAT_LINE_COUNT) + 1;
}

/** Copies already spoken on this screen (uid -> when). A new match starts the copies' uids over, so the transport and
 *  the Scene Builder clear it (`resetHatLines`); the age limit covers a watcher who moves from one match to another. */
const spoken = new Map<string, number>();
const SPOKEN_TTL_MS = 10 * 60 * 1000;
const nowMs = (): number => Date.now();

/** Say the line for the copy `uid`, once. Returns whether it spoke (false: no uid, or this copy already spoke here). */
export function speakHatLine(uid: unknown, now = nowMs()): boolean {
  if (typeof uid !== 'string' || !uid) return false;
  for (const [k, at] of spoken) if (now - at > SPOKEN_TTL_MS) spoken.delete(k);
  if (spoken.has(uid)) return false;
  spoken.set(uid, now);
  sfx.magicianPass(hatLineOf(uid));
  return true;
}

/** A new match (or a new Scene Builder rig): copies are numbered from the start again. */
export function resetHatLines(): void { spoken.clear(); }
