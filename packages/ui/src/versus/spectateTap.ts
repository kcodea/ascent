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
import type { Action, DragPath, EotRecord, VersusSeat } from '@game/sim';
import { liveAim } from '../aimState';
import { dragStore } from '../dragStore';
import { DRAG_CAUSES, takeDragTrace } from '../replay/dragTrace';

export const SPECTATE_CURSOR_EVENT = 'spectate_cursor';

/** One committed action, as the spectator replays it. */
export interface SpectatorAct {
  /** The action, or `endTurn`: the End Turn press (tapped when it is PREPARED, so the stands play its beats in step). */
  t: Action['type'] | 'endTurn';
  uid?: string;
  index?: number;
  /** An aimed spell's target (the spectator plays its cast FX at the same minion). */
  targetUid?: string;
  /** A drag-driven action: the pointer path the player's card travelled (window fractions, real duration). */
  drag?: DragPath;
  /** `endTurn`: the End-of-Turn batch the player's screen is playing (the replay recorder's record), when any. */
  eot?: Pick<EotRecord, 'batch' | 'lassoFx'>;
}

/** One cursor sample. `hide` = the player's tab went to the background or the hand went idle. */
export interface CursorSample {
  seat: VersusSeat;
  x: number;
  y: number;
  /** The card in the player's hand right now (its uid, the zone it was picked from, its card id). */
  drag?: { uid: string; source: string; cardId: string } | null;
  /** A live AIM LINE on the player's screen (a spell cast, the hero power, Equipment, a Battlecry): where it starts
   *  (window fractions), whether it is on a target, and its effect when not the default. */
  aim?: { x: number; y: number; on: boolean; def?: string } | null;
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
  const a = action as { uid?: unknown; index?: unknown; targetUid?: unknown };
  const drag = DRAG_CAUSES.has(action.type) ? takeDragTrace() : null;
  acts.push({
    t: action.type,
    ...(typeof a.uid === 'string' ? { uid: a.uid } : {}),
    ...(typeof a.index === 'number' ? { index: a.index } : {}),
    ...(typeof a.targetUid === 'string' ? { targetUid: a.targetUid } : {}),
    ...(drag ? { drag } : {}),
  });
  if (acts.length > MAX_ACTS) acts.splice(0, acts.length - MAX_ACTS);
  wake?.();
}

/** The End Turn press, the moment it is PREPARED (its beats start playing on the player's screen): the stands play
 *  the press and the same recorded beats in step, then the fight. `eot` is null for a turn with no End-of-Turn beats. */
export function tapEndTurn(eot: Pick<EotRecord, 'batch' | 'lassoFx'> | null): void {
  if (!watching) return;
  acts.push({ t: 'endTurn', ...(eot ? { eot: { batch: eot.batch, ...(eot.lassoFx ? { lassoFx: eot.lassoFx } : {}) } } : {}) });
  if (acts.length > MAX_ACTS) acts.splice(0, acts.length - MAX_ACTS);
  wake?.();
}

/** Tags waiting for the next publish (the publisher sends them even when nothing visible changed). */
export const hasPendingActs = (): boolean => acts.length > 0;

/** Take the tags gathered since the last spectator message. */
export function takeActs(): SpectatorAct[] {
  const out = acts;
  acts = [];
  return out;
}

// ── the cursor ─────────────────────────────────────────────────────────────────────────────────────────────

let send: ((event: string, payload: unknown) => void) | null = null;
/** The publisher's own schedule: a tag asks for a publish (an End Turn press changes nothing visible by itself). */
let wake: (() => void) | null = null;
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
  const a = liveAim.current;
  const w0 = window.innerWidth || 1, h0 = window.innerHeight || 1;
  const aimNow = a ? { x: Math.round((a.from.x / w0) * 1000) / 1000, y: Math.round((a.from.y / h0) * 1000) / 1000, on: a.onTarget, ...(a.defId ? { def: a.defId } : {}) } : null;
  const dragKey = `${dragNow ? `${dragNow.uid}|${dragNow.source}` : ''}|${aimNow ? `${aimNow.x},${aimNow.y},${aimNow.on},${aimNow.def ?? ''}` : ''}`;
  const idle = !dragNow && !aimNow && performance.now() - movedAt > CURSOR_IDLE_MS;
  if (document.visibilityState === 'hidden' || idle) {
    if (!hidden) { hidden = true; send(SPECTATE_CURSOR_EVENT, { seat, x: 0, y: 0, hide: true } satisfies CursorSample); }
    return;
  }
  if (!moved && dragKey === lastDragKey && !hidden) return;
  moved = false;
  hidden = false;
  lastDragKey = dragKey;
  const w = window.innerWidth || 1, h = window.innerHeight || 1;
  const sample: CursorSample = { seat, x: Math.round((cx / w) * 1000) / 1000, y: Math.round((cy / h) * 1000) / 1000, drag: dragNow, aim: aimNow };
  send(SPECTATE_CURSOR_EVENT, sample);
}

/**
 * Turn the live extras on (someone is watching this player) or off. Idempotent; called whenever the stands change.
 */
export function setSpectatorTap(on: boolean, mySeat: VersusSeat | null, sender: ((event: string, payload: unknown) => void) | null, publish?: () => void): void {
  const want = on && !!mySeat && !!sender;
  send = sender;
  wake = want ? publish ?? null : null;
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
