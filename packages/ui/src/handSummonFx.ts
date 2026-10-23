import type { CombatEvent, Side } from '@game/core';
import { handCardElement } from './handBuffFx';
import { cardFxScale } from './fx/cardScale';
import { getHandSummonConfig, type HandSummonConfig } from './handSummonConfig';
import { canPlayDefs, playDef } from './fx/playDef';
import { isPhone } from './deviceClass';
import { pixiFx, type PulseCfg } from './pixiFx';
import { sfx } from './sfx';
import { stageHost, toScreen, toStage } from './stage';

/**
 * SUMMONED FROM HAND (owner ask 2026-10-23: "build an animation for when a minion is summoned from hand").
 *
 * It reads as a SUMMON, not a card travelling a route (owner refinements the same day: "just showing that it came
 * from hand is what we want", then "it should land and have a small pulse ... smooth it out so it feels like a summon
 * and not a path the card took to get there"). A copy of the hand card starts exactly on it (same centre, size and fan
 * tilt, full opacity: no pop), lifts off, drifts a little toward the board and dissolves; meanwhile the minion
 * materialises AT its slot (the slot's FINAL rect, read with the arrival's slot-grow seeked to its end), lands a touch
 * large and settles 1.08 to 1, and one soft glow blooms under it. Ease-out throughout, no arc, no trail, no linear
 * travel; the copy only scales DOWN, so it stays crisp. The real hand card stays (greyed for the fight, as before).
 *
 * ONE animation for every source and both phases (R-HANDSUMMON-FX-01): a Spirit's hand-summon (Seedling Spirit's
 * Rally, Tide Caller's Echo) and Rune of the Waking Reserve, in combat AND in the Shop, for the player, a replay and a
 * spectator alike. The FROM point is a pluggable SOURCE per side (`setHandSummonSource`): the player's hand now; an
 * opponent hand anchor can register for `'enemy'` later without touching the flight.
 *
 * PRESENTATION ONLY. Nothing here decides an outcome or moves a beat. It keys off the moment the summoned body is
 * DRAWN (combat: it enters `visibleFrame`, so a Rally summon withheld by `summonHold` flies when its sparkle releases
 * it; Shop: the commit that grows `handCopiedThisTurn`), and only delays when that body's CARD becomes opaque.
 *
 * PERF (the north star): the copy is ONE cloned card node with one two-keyframe Web Animation, and the minion's
 * reveal is another, both over `transform` + `opacity` only (compositor). Rects are read ONCE, at launch. The landing
 * glow is one Pixi sprite (`flashBloom`). Nothing loops; every node, animation and timer is torn down by
 * `clearHandSummonFx`.
 */

/** One flight: the hand card a body came from, the board body it became, and whose hand it left (default player). */
export interface HandSummonFlight { handUid: string; boardUid: string; side?: Side; cardId?: string }

/** A hand card, reduced to what the origin match needs. */
export interface HandCardLike { uid: string; cardId: string; golden?: boolean; attack: number; health: number }

/**
 * THE MOTION (owner 2026-10-23: "use the lift and land animation, but smooth it out and make it overall less clunky
 * and way more seamless"). ONE continuous movement, no visible steps: the phases OVERLAP instead of chaining.
 *  - The copy of the hand card lifts off its slot and, without stopping, curves on toward the board slot, swelling a
 *    touch then shrinking as it dissolves (one cubic Bézier path, one easing, scale and opacity as smooth curves).
 *  - The minion forms IN its slot while the copy is still dissolving: it fades in from a little small, rises through a
 *    slight overshoot and eases back to rest (one curve, a single overshoot, not a separate bounce).
 *  - The copy is fully gone exactly when the minion is fully formed, and the minion starts to show before the copy
 *    starts to fade: never nothing on screen, never both solid.
 *  - The landing ring starts as the minion arrives, the board slot has finished opening before it shows.
 * Every curve is sampled densely into Web Animation keyframes (transform + opacity only), so position, scale and
 * opacity are continuous and their velocity has no visible kink at any phase boundary.
 */

/** At or above this playback speed (a Skip's turbo, a fast-forward) the flight is dropped: the stock pop reads. */
export const HAND_SUMMON_MAX_SPEED = 4;
/** Keyframe density: samples per curve. */
const SAMPLES = 24;
/** The lift glow: the Ascend flash's soft disc, pale. ONE Pixi sprite, so it fits every FX budget. */
const GLOW = { colorGlow: '#fff2cc', blend: 'screen' as const };

/** Smoothstep on [a, b]: 0 before, 1 after, C1-continuous between. */
export function smooth(a: number, b: number, t: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** The path's progress easing: a gentle ease-in out of the hand, a long soft ease-out into the board. */
export function pathEase(t: number): number {
  return (1 - Math.cos(Math.PI * Math.pow(Math.min(1, Math.max(0, t)), 0.75))) / 2;
}

/** The copy's state at path time `t` (0..1). Screen px. */
export interface CopySample { t: number; x: number; y: number; scale: number; opacity: number }

/**
 * Pure: the copy's whole path. Starts EXACTLY on the hand card (scale 1, full opacity), lifts straight up first (the
 * Bézier's first control point sits above the hand), then curves on toward the slot. The fade window is given in path
 * time (`fadeFrom`..`fadeTo`), placed by the caller so it overlaps the minion forming.
 */
export function copyPath(
  from: { x: number; y: number }, slot: { x: number; y: number }, liftPx: number,
  c: Pick<HandSummonConfig, 'riseScale' | 'drift' | 'endScale'>, fadeFrom: number, fadeTo: number,
): CopySample[] {
  const end = { x: from.x + (slot.x - from.x) * c.drift, y: from.y + (slot.y - from.y) * c.drift - liftPx * 0.4 };
  const p1 = { x: from.x, y: from.y - liftPx * 1.5 };
  const p2 = { x: end.x - (slot.x - from.x) * 0.15, y: end.y + liftPx * 0.2 };
  const out: CopySample[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const s = pathEase(t);
    const a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, cc = 3 * (1 - s) * s * s, d = s ** 3;
    const x = a * from.x + b * p1.x + cc * p2.x + d * end.x;
    const y = a * from.y + b * p1.y + cc * p2.y + d * end.y;
    const swell = (c.riseScale - 1) * Math.sin(Math.PI * Math.min(1, t * 1.25)) ** 2;
    const scale = 1 + swell + (c.endScale - 1) * smooth(0.25, 1, t);
    const opacity = 1 - smooth(fadeFrom, fadeTo, t);
    out.push({ t, x, y, scale, opacity });
  }
  return out;
}

/**
 * Pure: the minion's forming curve over `u` (0..1): from `formFrom`, up through ONE slight overshoot to `overshoot`,
 * easing back to exactly 1 with zero velocity. g(u) = (1-u)^2 (q0 + q1 u); q1 is solved so the peak hits `overshoot`.
 */
export function formScale(formFrom: number, overshoot: number): (u: number) => number {
  const q0 = formFrom - 1;
  const want = Math.max(0, overshoot - 1);
  const g = (q1: number, u: number): number => (1 - u) ** 2 * (q0 + q1 * u);
  const peak = (q1: number): number => { let m = -Infinity; for (let i = 0; i <= 200; i++) m = Math.max(m, g(q1, i / 200)); return m; };
  let lo = 0, hi = 60;
  if (want > 0) for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (peak(mid) < want) lo = mid; else hi = mid; }
  const q1 = want > 0 ? (lo + hi) / 2 : -q0;
  return (u: number) => 1 + g(q1, Math.min(1, Math.max(0, u)));
}

/** Pure: how long (1x ms) one flight runs from launch to a settled minion. */
export function handSummonDurationMs(c: HandSummonConfig = getHandSummonConfig()): number {
  return Math.max(c.pathMs, c.appearAt + c.settleMs);
}

/**
 * WHERE A FLIGHT STARTS. A source resolves a hand uid to the element the ghost is cloned from, its screen centre, its
 * LAYOUT size (stage px, unaffected by transforms) and its resting tilt. Null = not on screen: no flight, the stock
 * summon plays. Registered per side: the player's hand is the default; the enemy has none yet (an opponent hand area
 * registers one with `setHandSummonSource('enemy', …)` while it is mounted: `OpponentHand.tsx`).
 */
export interface HandSummonOrigin {
  el: HTMLElement; cx: number; cy: number; w: number; h: number; rotateDeg: number;
  /** The VISIBLE width in screen px (a plated hand card's plate is wider than its box); defaults to the box. */
  visualW?: number;
}
export type HandSummonSource = (handUid: string) => HandSummonOrigin | null;

/** The player's hand: the mounted hand card with that uid. */
export const playerHandSource: HandSummonSource = (uid) => {
  const el = handCardElement(uid);
  if (!el) return null;
  const r = el.getBoundingClientRect(); // the tilted card's bounding box: its centre IS the card's centre
  if (r.width <= 0) return null;
  const rot = parseFloat(getComputedStyle(el).getPropertyValue('--fan-rot')) || 0;
  const plate = el.querySelector<HTMLElement>('.cardplate')?.getBoundingClientRect();
  const w = el.offsetWidth || toStage(r.width);
  return {
    el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w, h: el.offsetHeight || toStage(r.height), rotateDeg: rot,
    visualW: Math.max(toScreen(w), plate?.width ?? 0),
  };
};

const sources: Partial<Record<Side, HandSummonSource>> = { player: playerHandSource };

/** Register (or clear, with null) the source a side's hand-summons fly from. Returns the previous one. */
export function setHandSummonSource(side: Side, src: HandSummonSource | null): HandSummonSource | undefined {
  const prev = sources[side];
  if (src) sources[side] = src; else delete sources[side];
  return prev;
}

/** How far back from a `summon` a Rune of the Waking Reserve trigger may sit (its twilight pulse, nextStep). */
const WAKING_LOOKBACK = 6;

/**
 * Pure: one side's combat summons that came OUT OF THE HAND, board uid → the hand card uid it came from (`side`
 * defaults to the player; the enemy's are matched against the foe's recorded starting hand, R-OPP-HAND-01).
 *
 *  - A Spirit's hand-summon stamps `fromHandUid` on its `summon` (the same field that greys the hand card).
 *  - Rune of the Waking Reserve copies the highest-stat hand minion but deliberately leaves the card UNMARKED (no
 *    `fromHandUid`, so it does not grey). Its summon follows the rune's `questTrigger`; the ghost then flies from the
 *    hand card with the summoned body's id (gilding matched first, then the highest Attack + Health, the rune's own
 *    pick rule). No hand card of that id on screen → no ghost, the stock summon plays.
 *
 * The enemy's hand is drawn face down (`OpponentHand`), which registers the `'enemy'` source.
 */
export function combatHandSummonOrigins(events: readonly CombatEvent[], hand: readonly HandCardLike[], side: Side = 'player'): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e?.type !== 'summon' || e.side !== side) continue;
    if (e.fromHandUid) { out.set(e.minion.uid, e.fromHandUid); continue; }
    let waking = false;
    for (let j = i - 1; j >= 0 && j >= i - WAKING_LOOKBACK; j--) {
      const p = events[j];
      if (!p || p.type === 'summon') break;
      if (p.type === 'questTrigger' && p.flag === 'runeWakingReserve' && p.side === side) { waking = true; break; }
    }
    if (!waking) continue;
    const same = hand.filter((h) => h.cardId === e.minion.cardId);
    if (same.length === 0) continue;
    const gild = same.filter((h) => !!h.golden === !!e.minion.golden);
    const pool = gild.length ? gild : same;
    const top = pool.reduce((a, b) => (b.attack + b.health > a.attack + a.health ? b : a));
    out.set(e.minion.uid, top.uid);
  }
  return out;
}

/**
 * Pure: the Shop's hand-summons in one commit. A hand card newly in `handCopiedThisTurn` (the Shop twin's once-per-turn
 * latch, written only by `summonCopyFromHandShop`) paired with the NEW board body of the same card id. Board uids that
 * End-of-Turn playback already drew (`alreadyShown`) are skipped: the body is on screen, there is nothing to fly.
 */
export function shopHandSummonFlights(
  prevCopied: readonly string[], copied: readonly string[],
  prevBoard: ReadonlySet<string>, board: readonly { uid: string; cardId: string }[],
  hand: readonly { uid: string; cardId: string }[], alreadyShown: ReadonlySet<string> = new Set(),
): HandSummonFlight[] {
  const before = new Set(prevCopied);
  const fresh = board.filter((c) => !prevBoard.has(c.uid) && !alreadyShown.has(c.uid));
  const used = new Set<string>();
  const out: HandSummonFlight[] = [];
  for (const handUid of copied) {
    if (before.has(handUid)) continue;
    const card = hand.find((h) => h.uid === handUid);
    if (!card) continue;
    const body = fresh.find((c) => c.cardId === card.cardId && !used.has(c.uid));
    if (!body) continue;
    used.add(body.uid);
    out.push({ handUid, boardUid: body.uid, cardId: body.cardId });
  }
  return out;
}

/** Pure: the launch offset (ms, before speed) of the i-th flight drawn on one frame. */
export function handSummonLaunchAt(i: number, c: HandSummonConfig = getHandSummonConfig()): number {
  return i * c.staggerMs;
}

// ── runtime ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ghosts = new Set<HTMLElement>();
const anims = new Set<Animation>();
const timers = new Set<ReturnType<typeof setTimeout>>();
/** Board uids whose body is still waiting on its flight: the stock arrival dust and summon sound stand down for them
 *  (the landing plays both). Cleared when the minion has settled, or by the teardown. */
const inFlight = new Set<string>();
/** `performance.now()` when the last running flight settles: the combat clock waits for it (`handSummonRemainingMs`). */
let settlesAt = 0;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Is this board body's arrival owned by a hand-summon flight right now? */
export function isHandSummonInFlight(uid: string): boolean {
  return inFlight.has(uid);
}

/** How long (real ms) until every running flight has landed and settled; 0 when none runs. The combat clock holds
 *  the next beat at least this long, so no swing starts over a minion that is still arriving. */
export function handSummonRemainingMs(): number {
  return inFlight.size ? Math.max(0, settlesAt - nowMs()) : 0;
}

/** The card element of a drawn board body (combat `.unit` or Shop `.card`), or null. */
function boardCardOf(el: Element | null): HTMLElement | null {
  if (!el) return null;
  if (el.classList.contains('card')) return el as HTMLElement;
  return el.querySelector<HTMLElement>('.card');
}

/** CSS mount animations that pop the arriving card in: finished up front, the landing IS its entrance. */
const POPS = new Set(['cardpop', 'summonpop', 'handpop']);

/**
 * The body's FINAL slot rect. A combat arrival grows its slot in (`summonexpand` on the unit), so the rect at launch
 * is not where it ends. Seek that animation to its end, read once, seek back: one forced layout, no visible frame
 * (this runs in a layout effect, before paint).
 */
function finalRectOf(card: HTMLElement, unit: Element | null): DOMRect {
  const grow = unit && unit !== card
    ? unit.getAnimations().filter((a) => (a as { animationName?: string }).animationName === 'summonexpand')
    : [];
  const saved = grow.map((a) => a.currentTime);
  for (const a of grow) {
    const end = a.effect?.getComputedTiming().endTime;
    if (typeof end === 'number' && Number.isFinite(end)) a.currentTime = Math.max(0, end - 1);
  }
  const r = card.getBoundingClientRect();
  grow.forEach((a, i) => { a.currentTime = saved[i] ?? 0; });
  return r;
}

/** Options for one launch. `ownSound`: the landing plays the summon sound (false when the beat already played it). */
export interface HandSummonLaunchOpts { speed?: number; ownSound?: (f: HandSummonFlight) => boolean }

/**
 * Launch the flights (call it in a LAYOUT effect, after the commit that drew the bodies and before paint, so a body
 * is hidden on its very first frame). `findBoardEl` resolves a board uid to its element; `speed` is the playback
 * multiplier (1 in the Shop). A flight whose origin or body is not on screen is skipped, and that body keeps the
 * stock arrival: degrading never hides a minion.
 */
export function launchHandSummonFlights(
  flights: readonly HandSummonFlight[], findBoardEl: (uid: string) => Element | null, opts: HandSummonLaunchOpts = {},
): void {
  if (flights.length === 0 || typeof document === 'undefined') return;
  const spd = opts.speed && opts.speed > 0 ? opts.speed : 1;
  if (spd >= HAND_SUMMON_MAX_SPEED) return;
  const c = getHandSummonConfig(); // read LIVE, so a tuner change applies to the very next summon
  const ready: { f: HandSummonFlight; from: HandSummonOrigin; card: HTMLElement; to: DOMRect }[] = [];
  for (const f of flights) {
    const from = sources[f.side ?? 'player']?.(f.handUid) ?? null;
    const unit = findBoardEl(f.boardUid);
    const card = boardCardOf(unit);
    if (!from || !card) continue;
    for (const a of card.getAnimations()) if (POPS.has((a as { animationName?: string }).animationName ?? '')) a.finish();
    const to = finalRectOf(card, unit);
    if (to.width <= 0) continue;
    // The slot finishes OPENING before the minion shows in it: the arrival's grow-in is hurried to end by `appearAt`,
    // so nothing on the board shuffles after the minion has appeared.
    if (unit && unit !== card) {
      for (const a of unit.getAnimations()) {
        if ((a as { animationName?: string }).animationName !== 'summonexpand') continue;
        const end = a.effect?.getComputedTiming().endTime;
        const cur = typeof a.currentTime === 'number' ? a.currentTime : 0;
        const left = typeof end === 'number' ? end - cur : 0;
        const budget = Math.max(1, c.appearAt / spd);
        if (left > budget) a.playbackRate = left / budget;
      }
    }
    ready.push({ f, from, card, to });
  }
  // Left to right by the body's slot, so a pair drawn together reads in board order.
  ready.sort((a, b) => a.to.left - b.to.left);
  ready.forEach((r, i) => launchOne(r.f, r.from, r.card, r.to, handSummonLaunchAt(i, c) / spd, spd, opts.ownSound?.(r.f) ?? true, c));
}

/** A clone of the origin card's own render, in a positioned wrapper on the stage (not yet animated). */
function makeGhost(from: HandSummonOrigin): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'handsummon-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  const clone = from.el.cloneNode(true) as HTMLElement;
  clone.removeAttribute('data-uid'); // never let a selector for the real hand card find the ghost
  clone.classList.remove('spent', 'popin', 'dimmed', 'locked');
  ghost.appendChild(clone);
  ghost.style.width = `${from.w}px`;
  ghost.style.height = `${from.h}px`;
  // The hand zone sizes its cards with its own `--ch` / `--cw` / `--ccw`; the clone leaves that zone, so it carries
  // them along (one computed-style read, at launch).
  const hcs = getComputedStyle(from.el);
  for (const v of ['--ch', '--cw', '--ccw']) {
    const val = hcs.getPropertyValue(v);
    if (val) ghost.style.setProperty(v, val);
  }
  stageHost().appendChild(ghost);
  ghosts.add(ghost);
  return ghost;
}

function track(a: Animation, done?: () => void): void {
  anims.add(a);
  const end = (): void => { anims.delete(a); done?.(); };
  a.addEventListener('finish', end);
  a.addEventListener('cancel', end);
}

function later(ms: number, fn: () => void): void {
  const t = setTimeout(() => { timers.delete(t); fn(); }, Math.max(0, ms));
  timers.add(t);
}

function launchOne(f: HandSummonFlight, from: HandSummonOrigin, card: HTMLElement, to: DOMRect, delay: number, spd: number, ownSound: boolean, c: HandSummonConfig): void {
  const path = c.pathMs / spd;
  const appear = c.appearAt / spd;
  const settle = c.settleMs / spd;
  const appearAt = delay + appear;
  inFlight.add(f.boardUid);
  settlesAt = Math.max(settlesAt, nowMs() + delay + Math.max(path, appear + settle));

  // ── THE MINION FORMS in its slot: fades in from a little small, through one slight overshoot, back to rest ──
  const cs = getComputedStyle(card);
  const base = cs.transform && cs.transform !== 'none' ? ` ${cs.transform}` : '';
  const form = formScale(c.formFrom, c.overshoot);
  const solidAt = 0.4; // share of the settle by which the minion is fully opaque
  const formKf: Keyframe[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    formKf.push({ offset: u, opacity: smooth(0, solidAt, u), transform: `scale(${form(u).toFixed(4)})${base}` });
  }
  track(card.animate(formKf, { duration: settle, delay: appearAt, fill: 'backwards', easing: 'linear' }), () => inFlight.delete(f.boardUid));
  const tc = { x: to.left + to.width / 2, y: to.top + to.height / 2 };
  // The landing starts AS the minion arrives (a quarter into its forming), not after it.
  later(appearAt + settle * 0.22, () => {
    if (c.dust && canPlayDefs()) playDef('landing-dust', { source: tc, target: tc }, { scale: cardFxScale(to.width), uids: { source: f.boardUid, target: f.boardUid } });
    if (c.pulseSize > 0 || c.pulseCore > 0) pixiFx.pulse(tc.x, tc.y, landPulse(to.width, spd, c));
    if (ownSound && c.sound) sfx.summon(f.cardId);
  });

  // ── THE COPY: lifts off the hand slot and curves on toward the board, dissolving as the minion forms ──
  const { w, h } = from;
  const ghost = makeGhost(from);
  // Its fade OVERLAPS the forming: it starts to fade a little after the minion starts to show, and is gone exactly
  // when the minion is solid. Expressed in path time.
  const total = Math.max(path, appear + settle * solidAt);
  const fadeFrom = Math.min(0.95, (appear + settle * 0.08) / total);
  const fadeTo = Math.min(1, (appear + settle * solidAt) / total);
  const samples = copyPath({ x: from.cx, y: from.cy }, tc, toScreen(h) * c.riseHeight, c, fadeFrom, fadeTo);
  const kf: Keyframe[] = samples.map((p) => ({
    offset: p.t,
    opacity: +p.opacity.toFixed(4),
    // centred on the point; screen px → stage px at the write (stage.ts). The hand's fan tilt eases out over the lift.
    transform: `translate(${(toStage(p.x) - w / 2).toFixed(2)}px, ${(toStage(p.y) - h / 2).toFixed(2)}px) rotate(${(from.rotateDeg * (1 - smooth(0, 0.35, p.t))).toFixed(3)}deg) scale(${p.scale.toFixed(4)})`,
  }));
  track(ghost.animate(kf, { duration: total, delay, fill: 'both', easing: 'linear' }), () => { ghosts.delete(ghost); ghost.remove(); });
  if (c.liftGlow > 0) later(delay, () => pixiFx.flashBloom(from.cx, from.cy - toScreen(h) * c.riseHeight * 0.6, { ...GLOW, flashAlpha: c.liftGlow, flashMs: 320 / spd, flashSize: toScreen(w) * 0.6 }));

  // The card LEAVES its hand slot: the real hand card is hidden under the copy and fades back in (greyed in combat)
  // as the copy clears it, so the two are never seen half-transparent on top of each other.
  if (from.el.isConnected && typeof from.el.animate === 'function') {
    const clear = total * 0.3;
    const back = 160 / spd;
    track(from.el.animate([
      { offset: 0, opacity: 0 },
      { offset: clear / (clear + back), opacity: 0, easing: 'ease-in-out' },
      { offset: 1, opacity: 1 },
    ], { duration: clear + back, delay, fill: 'backwards' }));
  }
}

/** The landing ring: a small cut of the game's own self-buff pulse (`PULSE_PRESETS.default`: white ring, warm core,
 *  gold sparks), sized to the card. Sparks are dropped on phones (the FX budget). */
function landPulse(cardW: number, spd: number, c: HandSummonConfig): PulseCfg {
  return {
    style: 'ring', blend: 'add',
    ringCount: c.pulseSize > 0 ? 1 : 0, ringSize: cardW * c.pulseSize, ringWidth: 7, ringSpeed: 1, ringMs: c.pulseMs / spd, ringStaggerMs: 0,
    ringAlpha: c.pulseAlpha,
    coreFlashSize: cardW * c.pulseCore, coreFlashMs: (c.pulseMs * 1.05) / spd,
    sparkCount: isPhone() ? 0 : Math.round(c.pulseSparks), sparkSpeed: 200, sparkLife: (c.pulseMs * 1.4) / spd, sparkSize: 5,
    holdMs: 0,
    colorRing: '#ffffff', colorCore: '#fff3b0', colorSpark: '#fef08a',
  };
}

/**
 * DEV PREVIEW (the 🃏 Hand Summon tuner): play the current look on whatever is on screen, with no real summon. The
 * first `n` hand cards fly to the right-most `n` board minions (each of those hides and re-forms in place). Returns
 * how many flights it launched; 0 when there is no hand card or no board minion to use.
 */
export function previewHandSummon(n = 1): number {
  if (typeof document === 'undefined') return 0;
  const hand = [...document.querySelectorAll<HTMLElement>('[data-zone="hand"] .card[data-uid]')];
  const board = [...document.querySelectorAll<HTMLElement>('[data-zone="warband"] [data-uid]')]
    .filter((el) => el.classList.contains('unit') || (el.classList.contains('card') && !el.closest('.unit')));
  const k = Math.min(n, hand.length, board.length);
  if (k === 0) return 0;
  const targets = board.slice(board.length - k);
  const flights: HandSummonFlight[] = [];
  for (let i = 0; i < k; i++) {
    const t = targets[i]!;
    flights.push({ handUid: hand[i]!.dataset.uid!, boardUid: t.dataset.uid!, cardId: t.dataset.card ?? hand[i]!.dataset.card });
  }
  const byUid = new Map(targets.map((el) => [el.dataset.uid!, el]));
  launchHandSummonFlights(flights, (uid) => byUid.get(uid) ?? null);
  return k;
}

/** Tear every flight down: ghosts removed, reveals cancelled (the card snaps visible), timers dropped. A seek, a Skip,
 *  a phase flip or an unmount calls it, so a stranded flight can never hide a minion. */
export function clearHandSummonFx(): void {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  for (const a of [...anims]) a.cancel();
  anims.clear();
  for (const g of ghosts) g.remove();
  ghosts.clear();
  inFlight.clear();
  settlesAt = 0;
}
