/**
 * THE EMOTE BUBBLE (owner spec 2026-10-13): "When the player uses an emote it bubbles up next to their own hero portrait.
 * Other seats' emotes bubble next to that seat's portrait on the lobby rail."
 *
 * One-shot and imperative, like the rail's damage float (`lobbyDamageFx.ts`): one `<img>` of the painted bubble is
 * appended to the stage host, placed ONCE from its anchor's rect (one layout read per bubble, never per frame), and
 * animated with WAAPI on transform + opacity only (compositor-only, docs/performance.md): it pops out of its anchor,
 * holds, drifts up a touch and fades, then removes itself. Nothing loops. A seat has at most one bubble: a new one
 * replaces it.
 *
 * WHERE IT SITS. The painted tail points DOWN-LEFT and the words are painted INTO the art, so the art is NEVER mirrored
 * (owner 2026-10-29: "mirrored emotes on the lobby rail come out backwards so text doesn't work"; R-EMOTE-LAYOUT-01).
 *  - `side: 'right'`: the bubble sits up and to the RIGHT of its anchor with the painted tail on it (your portrait,
 *    bottom left; a spectator's plate in the top-left stands column).
 *  - `side: 'left'`: the speaker sits at the stage's RIGHT edge (a rail row, the Versus foe block, the combat foe), so
 *    the bubble sits to the LEFT of the face, art as painted, its right edge against the face and its middle level with
 *    it; it pops out of that right edge.
 *
 * NEVER ON TOP OF EACH OTHER (owner 2026-10-29: "emotes cover each other"). Every live bubble keeps its box. A new one
 * is slid up or down beside its anchor (`settleBubble`) until it clears every other live bubble; with no room it WAITS
 * (one per speaker, the latest wins) and goes up the moment a bubble leaves, or is dropped once stale. At most
 * `MAX_LIVE` bubbles show at once, and at most `MAX_WATCH_LIVE` of them from spectators.
 */
import { emoteOf } from '@game/progression';
import { phoneLayoutOn, stageHost, stageViewport, toStage } from '../stage';
import { useGame } from '../store';
import { EMOTE_ASPECT, EMOTE_TAIL, emoteSrc } from './emoteArt';
import { PLAYER_SEAT } from './emoteRuntime';

const POP_MS = 220;
const HOLD_MS = 2600;
const FADE_MS = 420;
/** The whole bubble, pop to gone. */
export const EMOTE_BUBBLE_MS = POP_MS + HOLD_MS + FADE_MS;

/** Bubble widths in stage px: your own, a rail seat, the foe, a spectator's (owner 2026-10-29: "emotes are too" small). */
export const BUBBLE_WIDTH = { self: 340, rail: 236, foe: 270, watch: 232 } as const;
/** On a phone the stage is scaled far down, so every bubble is drawn this much larger to stay readable. */
export const PHONE_BUBBLE_SCALE = 1.25;
/** The highest a bubble's top edge may sit (stage px), and the breath kept off the stage's other edges. */
const MIN_TOP = 8;
const EDGE = 8;
/** At most this many bubbles on screen at once, and this many of them from spectators. */
export const MAX_LIVE = 9;
export const MAX_WATCH_LIVE = 3;
/** A waiting bubble that cannot go up within this long is dropped (it would arrive too late to mean anything). */
export const QUEUE_STALE_MS = 4000;
/** The painted art has a transparent margin; boxes are shrunk by this fraction per side before testing overlap. */
const OVERLAP_INSET = 0.06;

export interface BubblePlacement {
  /** Stage px of the anchor: the tail tip (`right`), or the middle of the face's left edge (`left`). */
  x: number;
  y: number;
  width: number;
  /** Which side of the anchor the bubble opens on. The art is never mirrored. */
  side: 'right' | 'left';
  /** How far (stage px, each way) the bubble may slide along its anchor to clear another bubble. */
  slide?: number;
}

export interface BubbleBox { left: number; top: number; width: number; height: number; originX: number; originY: number }

/** The box of a bubble placed at `p` (before any slide). Pure. */
export function bubbleBox(p: BubblePlacement): BubbleBox {
  const height = Math.round(p.width * EMOTE_ASPECT);
  if (p.side === 'left') {
    // Beside the face: right edge on the anchor, middle level with it; it pops out of that right edge.
    const top = Math.max(MIN_TOP, Math.round(p.y - height / 2));
    return { left: Math.round(p.x - p.width), top, width: p.width, height, originX: p.width, originY: height / 2 };
  }
  const tipX = EMOTE_TAIL.x * p.width;
  const tipY = EMOTE_TAIL.y * height;
  // Never above the stage's top edge: a bubble that would be is lowered (its tail then points a little below the face).
  const top = Math.max(MIN_TOP, Math.round(p.y - tipY));
  return { left: Math.round(p.x - tipX), top, width: p.width, height, originX: tipX, originY: tipY };
}

type Rect = Pick<BubbleBox, 'left' | 'top' | 'width' | 'height'>;
/** Whether two bubble boxes overlap (their painted parts, not their transparent margins). Pure. */
export function bubblesOverlap(a: Rect, b: Rect): boolean {
  const ia = OVERLAP_INSET * a.width, ib = OVERLAP_INSET * b.width;
  const ja = OVERLAP_INSET * a.height, jb = OVERLAP_INSET * b.height;
  return a.left + ia < b.left + b.width - ib && b.left + ib < a.left + a.width - ia
    && a.top + ja < b.top + b.height - jb && b.top + jb < a.top + a.height - ja;
}

/**
 * Where a new bubble goes so it covers no other live bubble: its own spot, else slid along its anchor (down, up, further
 * down, further up, in steps of a quarter of its height, up to `slide` each way), kept inside the stage's height. Null
 * when no spot within reach is clear (the caller waits). Pure.
 */
export function settleBubble(p: BubblePlacement, taken: readonly Rect[], stageH: number): BubbleBox | null {
  const base = bubbleBox(p);
  const step = Math.max(8, Math.round(base.height / 4));
  const reach = Math.max(0, p.slide ?? base.height);
  const offsets = [0];
  for (let d = step; d <= reach; d += step) offsets.push(d, -d);
  for (const dy of offsets) {
    const top = Math.min(Math.max(MIN_TOP, base.top + dy), Math.max(MIN_TOP, stageH - EDGE - base.height));
    const box: BubbleBox = { ...base, top, originY: base.originY + (base.top - top) };
    if (!taken.some((t) => bubblesOverlap(box, t))) return box;
  }
  return null;
}

/** The seat id of the foe the player is fighting (null outside a lobby fight). Set by the director each combat. */
let currentFoe: string | null = null;
export function setEmoteFoe(seatId: string | null): void { currentFoe = seatId; }

/** A bubble width for this screen (larger on a phone, where the stage is scaled far down). */
const widthOf = (kind: keyof typeof BUBBLE_WIDTH): number => Math.round(BUBBLE_WIDTH[kind] * (phoneLayoutOn() ? PHONE_BUBBLE_SCALE : 1));

/** Where a seat's bubble goes right now, or null when its face is not on screen. One rect read. */
export function placementFor(seat: string): BubblePlacement | null {
  if (typeof document === 'undefined') return null;
  // A SPECTATOR (`w:<their id>`, R-SPECTATE-EMOTE-01): their plate in the top-left stands column (the player's
  // "Spectating" indicator, or a spectator's own column), or the "+N" chip when theirs is folded into it. The column
  // sits top LEFT, so the bubble opens up and to the right of the plate's portrait, art as painted (clamped under the
  // stage's top edge), and slides down the column rather than cover another spectator's bubble.
  if (seat.startsWith('w:')) {
    const id = seat.slice(2);
    if (!WATCHER_ID.test(id)) return null;
    // Their portrait ring when it is drawn, else the plate (or the "+N" chip).
    const plate = document.querySelector(`[data-watcher="${id}"]`) ?? document.querySelector('.vsspec .vswatch-more');
    const ring = plate?.querySelector('.portring')?.getBoundingClientRect();
    const r = ring && ring.width ? ring : plate?.getBoundingClientRect();
    if (!r || !r.width) return null;
    // The bubble starts just past the stands column (so it never covers a name plate), level with the portrait, its
    // tail pointing back at it.
    const col = plate?.closest('.vsspec-seats')?.getBoundingClientRect();
    const edge = toStage(col && col.width ? Math.max(col.right, r.right) : r.right);
    const width = widthOf('watch');
    return { x: edge + 4 + EMOTE_TAIL.x * width, y: toStage(r.top + r.height * 0.62), width, side: 'right', slide: Math.round(width * EMOTE_ASPECT) };
  }
  if (seat === PLAYER_SEAT) {
    const el = document.querySelector('.statusbar .hero .f');
    const r = el?.getBoundingClientRect();
    if (!r || !r.width) return null;
    // The tail lands on the portrait's upper-right shoulder.
    const width = widthOf('self');
    return { x: toStage(r.right - r.width * 0.3), y: toStage(r.top - r.height * 0.04), width, side: 'right', slide: Math.round(width * EMOTE_ASPECT * 0.5) };
  }
  const st = useGame.getState();
  if (!st.combatStaged) {
    const face = SEAT_ID.test(seat) ? document.querySelector(`.lobbyseat[data-seat="${seat}"] .lobbyface`) : null;
    const r = face?.getBoundingClientRect();
    // Beside the row, to the LEFT of its face, level with it; it slides up or down the rail to clear a neighbour's.
    if (r && r.width) {
      const width = widthOf('rail');
      return { x: toStage(r.left - 4), y: toStage(r.top + r.height / 2), width, side: 'left', slide: Math.round(width * EMOTE_ASPECT) };
    }
    // VERSUS has no rail in the shop (owner bug 2026-10-16: "emotes arent showing in the recruit phase of versus"; the
    // opponent's emote looked for a rail row that is never drawn and was dropped). The opponent's block stands where
    // the rail would (`VersusFoe`, its face carries the seat id), so the bubble opens to the left of that portrait,
    // exactly as beside the combat foe.
    const disc = SEAT_ID.test(seat) ? document.querySelector(`.vsfoe-face[data-seat="${seat}"] .vsfoe-disc`) : null;
    const d = disc?.getBoundingClientRect();
    if (d && d.width) return foeSide(d);
    return null;
  }
  // Combat: only the foe has a face on screen.
  const body = currentFoe === seat ? document.querySelector('.combatopp-body') : null;
  if (!body) return null;
  const r = body.getBoundingClientRect();
  if (!r.width) return null;
  return foeSide(r);
}

/** Beside a foe portrait (the Versus block or the combat foe): to its LEFT, level with its upper half. */
function foeSide(r: DOMRect): BubblePlacement {
  const width = widthOf('foe');
  return { x: toStage(r.left + r.width * 0.06), y: toStage(r.top + r.height * 0.36), width, side: 'left', slide: Math.round(width * EMOTE_ASPECT * 0.5) };
}

interface LiveBubble { el: HTMLElement; box: BubbleBox }
const live = new Map<string, LiveBubble>();
/** Bubbles waiting for room: one per speaker (the latest wins), oldest first. */
let waiting: { seat: string; emoteId: string; at: number }[] = [];
/** A lobby seat id ("s0".."s7"): the only shape that is ever put into a selector. */
const SEAT_ID = /^[A-Za-z0-9_-]{1,32}$/;
/** A watcher id (a user id, or an anonymous `anon:N`): the only shape put into a `data-watcher` selector. */
const WATCHER_ID = /^[A-Za-z0-9_-]{1,64}$|^anon:[0-9]{1,3}$/;
const isWatcher = (seat: string): boolean => seat.startsWith('w:');
const now = (): number => Date.now();

/**
 * Show `emoteId` beside `seat`. Returns whether it was taken: it went up, or it waits for room beside its speaker
 * (false: unknown / retired emote, no art, no face on screen).
 */
export function showEmoteBubble(seat: string, emoteId: string): boolean {
  if (typeof document === 'undefined' || !emoteOf(emoteId)) return false;
  const src = emoteSrc(emoteId);
  const at = src ? placementFor(seat) : null;
  if (!src || !at) return false;
  // A speaker's new bubble replaces their old one (and anything of theirs still waiting).
  takeDown(seat);
  waiting = waiting.filter((w) => w.seat !== seat);
  const box = roomFor(seat, at);
  if (!box) {
    waiting.push({ seat, emoteId, at: now() });
    if (waiting.length > MAX_LIVE) waiting.shift();
    return true;
  }
  raise(seat, src, at, box);
  return true;
}

/** A clear box for `seat`'s bubble right now, or null (no room, or the on-screen caps are full). */
function roomFor(seat: string, at: BubblePlacement): BubbleBox | null {
  if (live.size >= MAX_LIVE) return null;
  if (isWatcher(seat) && [...live.keys()].filter(isWatcher).length >= MAX_WATCH_LIVE) return null;
  return settleBubble(at, [...live.values()].map((b) => b.box), stageViewport().h);
}

function takeDown(seat: string): void {
  const cur = live.get(seat);
  if (!cur) return;
  live.delete(seat);
  cur.el.remove();
}

/** A bubble left: the oldest waiting ones that now fit go up (stale ones are dropped). */
function admitWaiting(): void {
  const t = now();
  const keep: typeof waiting = [];
  for (const w of waiting) {
    if (t - w.at > QUEUE_STALE_MS) continue;
    const src = emoteSrc(w.emoteId);
    const at = src ? placementFor(w.seat) : null;
    if (!src || !at) continue;
    const box = roomFor(w.seat, at);
    if (box) raise(w.seat, src, at, box);
    else keep.push(w);
  }
  waiting = keep;
}

function raise(seat: string, src: string, at: BubblePlacement, box: BubbleBox): void {
  // The host carries the pop, scaled from its anchor (the tail tip, or the edge against the face). The art inside is
  // never mirrored: the words are painted into it.
  const el = document.createElement('div');
  el.className = `emote-bubble ${at.side}${seat === PLAYER_SEAT ? ' self' : ''}${isWatcher(seat) ? ' watch' : ''}`;
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
  live.set(seat, { el, box });
  let gone = false;
  const done = (): void => {
    if (gone) return;
    gone = true;
    el.remove();
    if (live.get(seat)?.el === el) { live.delete(seat); admitWaiting(); }
  };
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
}

/** Take every bubble down at once (a new run, leaving the game), and forget every waiting one. */
export function clearEmoteBubbles(): void {
  waiting = [];
  const all = [...live.values()];
  live.clear();
  for (const b of all) b.el.remove();
}
