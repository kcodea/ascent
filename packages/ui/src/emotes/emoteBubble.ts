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
 *  - `side: 'right'`: the bubble sits to the RIGHT of the portrait, its painted tail over the portrait's right edge
 *    (your portrait, bottom left; a spectator's plate in the top-left stands column).
 *  - `side: 'left'`: the speaker sits at the stage's RIGHT edge (a rail row, a Duos teammate row, the Versus foe block,
 *    the combat foe), so the bubble sits to the LEFT of the face, art as painted, its right end over the face's left
 *    edge.
 * Either way it is level with the portrait's middle, overlaps it by `PORTRAIT_ECLIPSE` of its width, is sized as a fixed
 * multiple of the portrait (`BUBBLE_TO_PORTRAIT`), and pops out of the edge that eclipses the portrait.
 *
 * NEVER ON TOP OF EACH OTHER (owner 2026-10-29: "emotes cover each other"). Every live bubble keeps its box. A new one
 * is slid up or down beside its anchor (`settleBubble`) until it clears every other live bubble; with no room it WAITS
 * (one per speaker, the latest wins) and goes up the moment a bubble leaves, or is dropped once stale. At most
 * `MAX_LIVE` bubbles show at once, and at most `MAX_WATCH_LIVE` of them from spectators.
 */
import { emoteOf } from '@game/progression';
import { phoneLayoutOn, screenScale, stageHost, stageViewport, toStage } from '../stage';
import { useGame } from '../store';
import { EMOTE_ASPECT, emoteSrc } from './emoteArt';
import { PLAYER_SEAT } from './emoteRuntime';

const POP_MS = 220;
const HOLD_MS = 2600;
const FADE_MS = 420;
/** The whole bubble, pop to gone. */
export const EMOTE_BUBBLE_MS = POP_MS + HOLD_MS + FADE_MS;

/**
 * SIZE AND FIT (owner 2026-10-29: "emotes should eclipse the players icon a bit more and be more vertically aligned and
 * sized appropriately to the portraits"; R-EMOTE-LAYOUT-01). Every bubble is sized from its speaker's portrait (a fixed
 * multiple of the portrait's width per surface, so a small rail face gets a proportionate bubble and the big hero
 * portrait a big one), sits level with the portrait's middle, and its near edge (the painted tail, or the frame's right
 * end) overlaps the portrait by `PORTRAIT_ECLIPSE` of its width.
 */
export const BUBBLE_TO_PORTRAIT = { self: 1.15, rail: 3.1, foe: 1.45, watch: 2.3 } as const;
export type BubbleSurface = keyof typeof BUBBLE_TO_PORTRAIT;
/** How much of the portrait's width the bubble's near edge covers. */
export const PORTRAIT_ECLIPSE = 0.3;
/** Never narrower than this (stage px), so the painted words stay readable beside a small face. */
export const MIN_BUBBLE_WIDTH = 170;
/** On a phone the stage is scaled far down, so every bubble is drawn this much larger to stay readable. */
export const PHONE_BUBBLE_SCALE = 1.2;
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
  /** Stage px. `x`: where the bubble's NEAR edge goes (its left edge for `right`, its right edge for `left`), already
   *  inside the portrait by the eclipse. `y`: the portrait's vertical middle, where the bubble's middle goes. */
  x: number;
  y: number;
  width: number;
  /** Which side of the portrait the bubble opens on. The art is never mirrored. */
  side: 'right' | 'left';
  /** How far (stage px, each way) the bubble may slide along its anchor to clear another bubble. */
  slide?: number;
}

/** A portrait's box in stage px. */
export interface PortraitRect { left: number; top: number; width: number; height: number }

/** The placement of a bubble beside `portrait` on `side`: sized from it, level with its middle, eclipsing its edge. Pure. */
export function fitToPortrait(portrait: PortraitRect, surface: BubbleSurface, side: 'right' | 'left', scale = 1): BubblePlacement {
  const width = Math.round(Math.max(MIN_BUBBLE_WIDTH, portrait.width * BUBBLE_TO_PORTRAIT[surface]) * scale);
  const eclipse = portrait.width * PORTRAIT_ECLIPSE;
  return {
    x: side === 'right' ? portrait.left + portrait.width - eclipse : portrait.left + eclipse,
    y: portrait.top + portrait.height / 2,
    width,
    side,
    slide: Math.round(width * EMOTE_ASPECT),
  };
}

/**
 * THE DOCKED RAIL (owner 2026-11-01: "emotes on the rail are massive and look bad"; R-EMOTE-RAIL-DOCKED-01). On the
 * Docked rail the seat is a wide slice and its portrait art spans most of it, so a bubble sized off that art (3.1x its
 * width) came out bigger than three slices. A docked seat's bubble is sized off the SLICE instead: its height is
 * `DOCK_BUBBLE_TO_SLICE` of the slice's height (so it tracks the rail's scale on every screen, and neighbouring seats'
 * bubbles fit side by side without sliding), its width follows from the art's aspect. Where the whole game is drawn
 * small (a phone), it never drops below `DOCK_MIN_SCREEN_H` screen px tall, so the painted words stay readable. It sits
 * level with the slice's middle, wholly OUTSIDE the rail toward the board: its right end stops just short of the slice's
 * left edge, and moves
 * further left past anything else of the rail's column beside it (a Duos teammate's slice, the round slice, the Refresh
 * pill, the End Turn gem, the Gold coin the slices are cut round), so it never covers a seat, hero art, the placement
 * column or a board button. At these sizes the 512 px art is always drawn smaller than its source, so it stays crisp.
 */
export const DOCK_BUBBLE_TO_SLICE = 1.15;
/** The shortest a docked bubble is drawn ON SCREEN (CSS px), whatever the game's scale: a phone's rail is tiny. */
export const DOCK_MIN_SCREEN_H = 36;
/** The breath between a docked bubble's right end and whatever it stands beside, as a fraction of its height. */
export const DOCK_GAP = 0.04;

/** The placement of a docked rail seat's bubble: beside `slice`, left of it and of every `obstacle` in its band. Pure. */
export function fitBesideSlice(slice: PortraitRect, obstacles: readonly PortraitRect[], minHeight = 0): BubblePlacement {
  const height = Math.round(Math.max(slice.height * DOCK_BUBBLE_TO_SLICE, minHeight));
  const width = Math.round(height / EMOTE_ASPECT);
  const gap = Math.max(2, Math.round(height * DOCK_GAP));
  let x = slice.left - gap;
  // The bubble is a touch taller than its slice. A piece that only reaches into that overhang (the Refresh pill's foot over
  // the top slice, the coin's rim under the last) nudges it down or up within it, rather than sending it off to the left.
  let top = slice.top + slice.height / 2 - height / 2;
  for (const o of obstacles) {
    if (!(o.left < x && o.left + o.width > x - width) || !(o.top < top + height && o.top + o.height > top)) continue;
    if (o.top + o.height <= slice.top + 1) top = Math.max(top, o.top + o.height);
    else if (o.top >= slice.top + slice.height - 1) top = Math.min(top, o.top - height);
  }
  top = Math.min(Math.max(top, slice.top + slice.height - height), slice.top);
  const bottom = top + height;
  const y = top + height / 2;
  // Walk the right end left past anything in the bubble's band that it would cover (a few boxes, settles in a pass or two).
  for (let moved = true, pass = 0; moved && pass < 8; pass++) {
    moved = false;
    for (const o of obstacles) {
      const inBand = o.top < bottom && o.top + o.height > top;
      const covered = o.left < x && o.left + o.width > x - width;
      if (inBand && covered && o.left - gap < x) { x = o.left - gap; moved = true; }
    }
  }
  return { x, y, width, side: 'left', slide: Math.round(height / 2) };
}

export interface BubbleBox { left: number; top: number; width: number; height: number; originX: number; originY: number }

/** The box of a bubble placed at `p` (before any slide): its middle level with `y`, its near edge on `x`. It pops
 *  out of that near edge. Pure. */
export function bubbleBox(p: BubblePlacement): BubbleBox {
  const height = Math.round(p.width * EMOTE_ASPECT);
  // Never above the stage's top edge: a bubble that would be is lowered (it then pops from a little above its middle).
  const top = Math.max(MIN_TOP, Math.round(p.y - height / 2));
  const left = p.side === 'right' ? Math.round(p.x) : Math.round(p.x - p.width);
  return { left, top, width: p.width, height, originX: p.side === 'right' ? 0 : p.width, originY: Math.round(p.y - top) };
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

/** What a docked rail bubble must not cover: every slice of the rail's column, and the board pieces the slices are cut
 *  round (the Refresh pill, the End Turn gem, the Gold coin; the same three `useDockedRail` measures). */
const DOCK_OBSTACLES = '.lobbyrail.lrv-docked .lobbyseat[data-seat], .lobbyrailhead.lrv-docked, .rfbwrap, .etb-base, .goldpill';

/** A portrait rect (screen px) in stage px. */
const stageRect = (r: DOMRect): PortraitRect => ({ left: toStage(r.left), top: toStage(r.top), width: toStage(r.width), height: toStage(r.height) });
/** The fit for this screen (a phone draws every bubble a little larger). */
const fit = (r: DOMRect, surface: BubbleSurface, side: 'right' | 'left'): BubblePlacement =>
  fitToPortrait(stageRect(r), surface, side, phoneLayoutOn() ? PHONE_BUBBLE_SCALE : 1);

/** Where a seat's bubble goes right now, or null when its face is not on screen. One rect read. */
export function placementFor(seat: string): BubblePlacement | null {
  if (typeof document === 'undefined') return null;
  // A SPECTATOR (`w:<their id>`, R-SPECTATE-EMOTE-01): their plate in the top-left stands column (the player's
  // "Spectating" indicator, or a spectator's own column), or the "+N" chip when theirs is folded into it. The column
  // sits top LEFT, so the bubble opens to the RIGHT of the plate's portrait, eclipsing its right edge, level with it,
  // and slides along the column rather than cover another spectator's bubble.
  if (seat.startsWith('w:')) {
    const id = seat.slice(2);
    if (!WATCHER_ID.test(id)) return null;
    // Their portrait ring when it is drawn, else the plate (or the "+N" chip).
    const plate = document.querySelector(`[data-watcher="${id}"]`) ?? document.querySelector('.vsspec .vswatch-more');
    const ring = plate?.querySelector('.portring')?.getBoundingClientRect();
    const r = ring && ring.width ? ring : plate?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return fit(r, 'watch', 'right');
  }
  if (seat === PLAYER_SEAT) {
    const r = document.querySelector('.statusbar .hero .f')?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return fit(r, 'self', 'right');
  }
  const st = useGame.getState();
  if (!st.combatStaged) {
    // A DOCKED rail slice (every mode's rail since #2504, a Duos teammate's slice too): beside the slice, sized off it.
    const slice = SEAT_ID.test(seat) ? document.querySelector(`.lobbyrail.lrv-docked .lobbyseat[data-seat="${seat}"]`)?.getBoundingClientRect() : undefined;
    if (slice && slice.width) {
      const obstacles = [...document.querySelectorAll(DOCK_OBSTACLES)].map((el) => el.getBoundingClientRect()).filter((r) => r.width).map(stageRect);
      return fitBesideSlice(stageRect(slice), obstacles, DOCK_MIN_SCREEN_H / Math.max(0.05, screenScale()));
    }
    // A Gem rail row (the fallback where the rail cannot dock): to the LEFT of its face, eclipsing its left edge, level with it.
    const r = SEAT_ID.test(seat) ? document.querySelector(`.lobbyseat[data-seat="${seat}"] .lobbyface`)?.getBoundingClientRect() : undefined;
    if (r && r.width) return fit(r, 'rail', 'left');
    // VERSUS has no rail in the shop (owner bug 2026-10-16: "emotes arent showing in the recruit phase of versus"; the
    // opponent's emote looked for a rail row that is never drawn and was dropped). The opponent's block stands where
    // the rail would (`VersusFoe`, its face carries the seat id), so the bubble opens to the left of that portrait,
    // exactly as beside the combat foe.
    const d = SEAT_ID.test(seat) ? document.querySelector(`.vsfoe-face[data-seat="${seat}"] .vsfoe-disc`)?.getBoundingClientRect() : undefined;
    if (d && d.width) return fit(d, 'foe', 'left');
    return null;
  }
  // Combat: only the foe has a face on screen.
  const body = currentFoe === seat ? document.querySelector('.combatopp-body') : null;
  const r = body?.getBoundingClientRect();
  if (!r || !r.width) return null;
  return fit(r, 'foe', 'left');
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
