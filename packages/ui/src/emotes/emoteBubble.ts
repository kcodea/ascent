/**
 * THE EMOTE BUBBLE (owner spec 2026-10-13): "When the player uses an emote it bubbles up next to their own hero portrait.
 * Other seats' emotes bubble next to that seat's portrait on the lobby rail."
 *
 * One-shot and imperative, like the rail's damage float (`lobbyDamageFx.ts`): one `<img>` of the painted bubble is
 * appended to the stage host, placed ONCE from its anchor's rect (one layout read per bubble, never per frame), and
 * animated with WAAPI on transform + opacity only (compositor-only, docs/performance.md): it pops out of the tail, holds,
 * drifts up a touch and fades, then removes itself. Nothing loops. A seat has at most one bubble: a new one replaces it.
 *
 * WHERE IT SITS. The painted tail points DOWN-LEFT, so the art reads right when the bubble sits up and to the RIGHT of
 * the speaker. Your portrait is bottom-left, so your bubble rises from its top-right corner, art as painted. The rail
 * runs down the stage's RIGHT edge (and the combat foe's portrait sits top-right), so there the bubble must open to the
 * LEFT of the face: the art is MIRRORED so its tail still points at the face (the art has no text, so a mirror reads
 * fine; a hand-painted left-facing variant can replace it later). In combat the rail is slid away, so a seat's emote
 * shows only when that seat is the foe you are fighting (beside the foe portrait); any other seat's is dropped.
 */
import { emoteOf } from '@game/progression';
import { stageHost, toStage } from '../stage';
import { useGame } from '../store';
import { EMOTE_ASPECT, EMOTE_TAIL, emoteSrc } from './emoteArt';
import { PLAYER_SEAT } from './emoteRuntime';

const POP_MS = 220;
const HOLD_MS = 2600;
const FADE_MS = 420;
/** The whole bubble, pop to gone. */
export const EMOTE_BUBBLE_MS = POP_MS + HOLD_MS + FADE_MS;

/** Bubble widths in stage px: your own, a rail seat, the combat foe. */
const WIDTH = { self: 300, rail: 200, foe: 230, watch: 190 } as const;
/** The highest a bubble's top edge may sit (stage px). */
const MIN_TOP = 8;

export interface BubblePlacement {
  /** Stage px of the tail tip. */
  x: number;
  y: number;
  width: number;
  /** Mirrored (opens to the left of the speaker). */
  flip: boolean;
}

/** The box (left, top, width, height) of a bubble whose tail tip lands on (x, y). Pure. */
export function bubbleBox(p: BubblePlacement): { left: number; top: number; width: number; height: number; originX: number; originY: number } {
  const height = Math.round(p.width * EMOTE_ASPECT);
  const tipX = (p.flip ? 1 - EMOTE_TAIL.x : EMOTE_TAIL.x) * p.width;
  const tipY = EMOTE_TAIL.y * height;
  // Never above the stage's top edge: a bubble that would be is lowered (its tail then points a little below the face).
  const top = Math.max(MIN_TOP, Math.round(p.y - tipY));
  return { left: Math.round(p.x - tipX), top, width: p.width, height, originX: tipX, originY: tipY };
}

/** The seat id of the foe the player is fighting (null outside a lobby fight). Set by the director each combat. */
let currentFoe: string | null = null;
export function setEmoteFoe(seatId: string | null): void { currentFoe = seatId; }

/** Where a seat's bubble goes right now, or null when its face is not on screen. One rect read. */
export function placementFor(seat: string): BubblePlacement | null {
  if (typeof document === 'undefined') return null;
  // A SPECTATOR (`w:<their id>`, R-SPECTATE-EMOTE-01): their chip in the top-left stands (the player's "Spectating"
  // indicator, or a spectator's own row), or the "+N" chip when theirs is folded into it. The chips sit top LEFT, so
  // the bubble opens up and to the right, art as painted (clamped under the stage's top edge).
  if (seat.startsWith('w:')) {
    const id = seat.slice(2);
    if (!WATCHER_ID.test(id)) return null;
    // The tail lands on the chip's lower-right end (past the name), so the bubble rises beside the plate, not over it.
    const el = document.querySelector(`[data-watcher="${id}"]`) ?? document.querySelector('.vsspec .vswatch-more');
    const r = el?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return { x: toStage(r.right - 4), y: toStage(r.bottom), width: WIDTH.watch, flip: false };
  }
  if (seat === PLAYER_SEAT) {
    const el = document.querySelector('.statusbar .hero .f');
    const r = el?.getBoundingClientRect();
    if (!r || !r.width) return null;
    // The tail lands on the portrait's upper-right shoulder.
    return { x: toStage(r.right - r.width * 0.3), y: toStage(r.top - r.height * 0.04), width: WIDTH.self, flip: false };
  }
  const st = useGame.getState();
  if (!st.combatStaged) {
    const face = SEAT_ID.test(seat) ? document.querySelector(`.lobbyseat[data-seat="${seat}"] .lobbyface`) : null;
    const r = face?.getBoundingClientRect();
    // The tail lands on the face's left edge, low, so the bubble sits beside the row rather than over the rows above.
    if (r && r.width) return { x: toStage(r.left + r.width * 0.08), y: toStage(r.top + r.height * 0.85), width: WIDTH.rail, flip: true };
    // VERSUS has no rail in the shop (owner bug 2026-10-16: "emotes arent showing in the recruit phase of versus"; the
    // opponent's emote looked for a rail row that is never drawn and was dropped). The opponent's block stands where
    // the rail would (`VersusFoe`, its face carries the seat id), so the bubble opens to the left of that portrait,
    // exactly as beside the combat foe.
    const disc = SEAT_ID.test(seat) ? document.querySelector(`.vsfoe-face[data-seat="${seat}"] .vsfoe-disc`) : null;
    const d = disc?.getBoundingClientRect();
    if (d && d.width) return { x: toStage(d.left + d.width * 0.12), y: toStage(d.top + d.height * 0.32), width: WIDTH.foe, flip: true };
    return null;
  }
  // Combat: only the foe has a face on screen.
  const body = currentFoe === seat ? document.querySelector('.combatopp-body') : null;
  if (!body) return null;
  const r = body.getBoundingClientRect();
  if (!r.width) return null;
  return { x: toStage(r.left + r.width * 0.12), y: toStage(r.top + r.height * 0.32), width: WIDTH.foe, flip: true };
}

/** The seat id of the foe the player is fighting (null outside a lobby fight). Set by the director each combat. */

const live = new Map<string, HTMLElement>();
/** A lobby seat id ("s0".."s7"): the only shape that is ever put into a selector. */
const SEAT_ID = /^[A-Za-z0-9_-]{1,32}$/;
/** A watcher id (a user id, or an anonymous `anon:N`): the only shape put into a `data-watcher` selector. */
const WATCHER_ID = /^[A-Za-z0-9_-]{1,64}$|^anon:[0-9]{1,3}$/;

/** Show `emoteId` beside `seat`. Returns whether a bubble went up (false: unknown / retired emote, no art, no face). */
export function showEmoteBubble(seat: string, emoteId: string): boolean {
  if (typeof document === 'undefined' || !emoteOf(emoteId)) return false;
  const src = emoteSrc(emoteId);
  const at = src ? placementFor(seat) : null;
  if (!src || !at) return false;
  live.get(seat)?.remove();
  const box = bubbleBox(at);
  // The host carries the pop (scaled from the tail tip); the art inside it carries the static mirror (about its own
  // centre), so a flipped bubble stays on the side the box was computed for.
  const el = document.createElement('div');
  el.className = `emote-bubble${at.flip ? ' flip' : ''}${seat === PLAYER_SEAT ? ' self' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  el.dataset.seat = seat;
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.style.transformOrigin = `${box.originX}px ${box.originY}px`;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.decoding = 'sync';
  el.appendChild(img);
  stageHost().appendChild(el);
  live.set(seat, el);
  const done = (): void => { el.remove(); if (live.get(seat) === el) live.delete(seat); };
  const total = EMOTE_BUBBLE_MS;
  try {
    const anim = el.animate([
      { transform: 'translateY(6px) scale(0.35)', opacity: 0, easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)' },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: POP_MS / total, easing: 'linear' },
      { transform: 'translateY(-3px) scale(1)', opacity: 1, offset: (POP_MS + HOLD_MS) / total, easing: 'ease-in' },
      { transform: 'translateY(-12px) scale(0.96)', opacity: 0 },
    ], { duration: total, easing: 'linear', fill: 'backwards' });
    anim.onfinish = done;
    anim.oncancel = done;
  } catch {
    // WAAPI unavailable (a test DOM): show it plainly, then take it down on a timer. Never strand a bubble.
    window.setTimeout(done, total);
  }
  return true;
}

/** Take every bubble down at once (a new run, leaving the game). */
export function clearEmoteBubbles(): void {
  for (const el of live.values()) el.remove();
  live.clear();
}
