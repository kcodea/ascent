/**
 * VERSUS SPECTATING — the PLAYER's side of the live extras (owner 2026-10-14): what the player just did, and where their
 * hand is. Both run ONLY while someone is in the stands; with nobody watching nothing here listens, times or sends.
 *
 *  - ACTION TAGS: each committed shop action becomes a tiny tag (`{ t, uid, index, drag }`) that rides the next
 *    spectator delta, so the spectator plays the same animation and cue instead of guessing from a diff. A drag-driven
 *    action carries the drag's recorded path (the replay recorder's own trace, `replay/dragTrace.ts`).
 *  - THE CURSOR: the pointer as WINDOW FRACTIONS (the replay drag-path convention, so it lands on the same spot of the
 *    spectator's stage at any size), plus the card being dragged, on the room's broadcast channel at about 15 Hz,
 *    coalesced to the latest sample per tick. The pointer is read from the move event's own fields (no layout read),
 *    the send runs on a timer off the render path, and a backgrounded or idle tab sends one "hide" and then nothing.
 */
import type { Action, DragPath, VersusSeat } from '@game/sim';
import { dragStore } from '../dragStore';
import { DRAG_CAUSES, takeDragTrace } from '../replay/dragTrace';

export const SPECTATE_CURSOR_EVENT = 'spectate_cursor';

/** One committed action, as the spectator replays it. */
export interface SpectatorAct {
  t: Action['type'];
  uid?: string;
  index?: number;
  /** A drag-driven action: the pointer path the player's card travelled (window fractions, real duration). */
  drag?: DragPath;
}

/** One cursor sample. `hide` = the player's tab went to the background or the hand went idle. */
export interface CursorSample {
  seat: VersusSeat;
  x: number;
  y: number;
  /** The card in the player's hand right now (its uid, the zone it was picked from, its card id). */
  drag?: { uid: string; source: string; cardId: string } | null;
  hide?: true;
}

/** The actions a spectator replays (everything else is bookkeeping it does not need to see). */
const TAGGED: ReadonlySet<string> = new Set([
  'buy', 'sell', 'play', 'roll', 'freeze', 'upgrade', 'reposition', 'reorderShop', 'reorderHand', 'heroPower',
  'activateEquipment', 'discover', 'chooseOne', 'buyRune', 'pickPower', 'battlecryTarget', 'faceOmen',
]);
const MAX_ACTS = 24;
export const CURSOR_TICK_MS = 66;
export const CURSOR_IDLE_MS = 4000;

let watching = false;
let acts: SpectatorAct[] = [];

/** Record a committed action for the stands (a no-op when nobody watches). */
export function tapAct(action: Action): void {
  if (!watching || !TAGGED.has(action.type)) return;
  const a = action as { uid?: unknown; index?: unknown };
  const drag = DRAG_CAUSES.has(action.type) ? takeDragTrace() : null;
  acts.push({
    t: action.type,
    ...(typeof a.uid === 'string' ? { uid: a.uid } : {}),
    ...(typeof a.index === 'number' ? { index: a.index } : {}),
    ...(drag ? { drag } : {}),
  });
  if (acts.length > MAX_ACTS) acts.splice(0, acts.length - MAX_ACTS);
}

/** Take the tags gathered since the last spectator message. */
export function takeActs(): SpectatorAct[] {
  const out = acts;
  acts = [];
  return out;
}

// ── the cursor ─────────────────────────────────────────────────────────────────────────────────────────────

let send: ((event: string, payload: unknown) => void) | null = null;
let seat: VersusSeat | null = null;
let timer: number | null = null;
let cx = 0;
let cy = 0;
let movedAt = 0;
let moved = false;
let lastDragKey = '';
let hidden = false;

const onMove = (e: PointerEvent): void => { cx = e.clientX; cy = e.clientY; movedAt = performance.now(); moved = true; };

function tick(): void {
  if (!send || !seat) return;
  const drag = dragStore.get().drag;
  const dragNow = drag && drag.active && !drag.ghost ? { uid: drag.uid, source: drag.source, cardId: drag.view.cardId ?? '' } : null;
  const dragKey = dragNow ? `${dragNow.uid}|${dragNow.source}` : '';
  const idle = !dragNow && performance.now() - movedAt > CURSOR_IDLE_MS;
  if (document.visibilityState === 'hidden' || idle) {
    if (!hidden) { hidden = true; send(SPECTATE_CURSOR_EVENT, { seat, x: 0, y: 0, hide: true } satisfies CursorSample); }
    return;
  }
  if (!moved && dragKey === lastDragKey && !hidden) return;
  moved = false;
  hidden = false;
  lastDragKey = dragKey;
  const w = window.innerWidth || 1, h = window.innerHeight || 1;
  const sample: CursorSample = { seat, x: Math.round((cx / w) * 1000) / 1000, y: Math.round((cy / h) * 1000) / 1000, drag: dragNow };
  send(SPECTATE_CURSOR_EVENT, sample);
}

/**
 * Turn the live extras on (someone is watching this player) or off. Idempotent; called whenever the stands change.
 */
export function setSpectatorTap(on: boolean, mySeat: VersusSeat | null, sender: ((event: string, payload: unknown) => void) | null): void {
  const want = on && !!mySeat && !!sender;
  send = sender;
  seat = mySeat;
  if (want === watching) return;
  watching = want;
  if (want) {
    movedAt = performance.now();
    window.addEventListener('pointermove', onMove, { passive: true });
    timer = window.setInterval(tick, CURSOR_TICK_MS);
  } else {
    window.removeEventListener('pointermove', onMove);
    if (timer != null) window.clearInterval(timer);
    timer = null;
    acts = [];
    hidden = false;
    lastDragKey = '';
  }
}

/** For the tests. */
export const spectatorTapOn = (): boolean => watching;
