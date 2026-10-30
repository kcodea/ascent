/**
 * VERSUS DUOS — THE PASS (R-DUOS-PASS-01, -05). Owner 2026-10-26: "can you make it look more like magic/pixi stream and
 * then a coalesce in hand? the flipping around just doesn't look great when it comes in. in the same vein, when a card
 * is dropped into the teammates portrait to pass, have it coalesce and turn into a stream that enters the hero
 * portrait and plays a simple little effect over the portrait". No card flips anywhere.
 *
 *  - SENDING (`playDrop`): where you let go, the card fades as its plate dissolves into arcane dust (the game's own
 *    `plateDissolve`, the look a played card's plate already has), and a teal Pixi STREAM leaves it and arcs into your
 *    teammate's bottom-right portrait (`duos-pass-send`: a ribbon with a little poof where it leaves, then a burst
 *    and a ripple over the portrait as it lands). The portrait pops as it catches it. One of your coins follows the
 *    card in from your Gold (the pass's 1 Gold).
 *  - RECEIVING (`playArrival`): the reverse. A stream leaves your teammate's portrait (`duos-pass-arrive`, the portrait
 *    pops as it lets go) and arcs over to the card's slot in your hand, and the card COALESCES there (the game's own
 *    `plateCoalesce`, the look a generated card already has) as the stream pours in. The hand opens the slot as the
 *    card is added (its usual make-room glide), and the card is held invisible until it forms.
 *
 * PERFORMANCE: the stream is one Pixi def play per pass (GPU, one-shot, budgeted like every def), pre-warmed when the
 * teammate portrait first mounts (`prewarmPassFx`: both defs once, invisible), so the first pass links no shader. The
 * card's fade is one transform / opacity animation on one cloned node; the coin likewise. Every rect is read once at
 * launch (the arrival re-reads its slot once more, at the coalesce, in case the hand moved). Nothing loops; every node
 * and timer is gone when the pass has landed.
 *
 * Every number and colour is the dev tuner's (`duosPassConfig.ts`, ✈ Duos Pass), read at each launch.
 */
import { canPlayDefs, playDef } from '../fx/playDef';
import { getDef } from '../fx/fxDefs';
import { gildArrivalMs } from '../gildTrailSources';
import { playPlateCoalesce } from '../plateCoalesce';
import { playPlateDissolve } from '../plateDissolve';
import { stageHost, toStage } from '../stage';
import { getDuosPassConfig, streamPalette } from './duosPassConfig';

interface Box { left: number; top: number; width: number; height: number }
interface Pt { x: number; y: number }

// ── Pure curves (the coin, the portrait pop) ──────────────────────────────────────────────────────────────────

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
/** Smootherstep on [a, b] (zero velocity AND acceleration at both ends). */
export function smoother(a: number, b: number, t: number): number {
  if (b <= a) return t >= b ? 1 : 0;
  const x = clamp01((t - a) / (b - a));
  return x * x * x * (x * (x * 6 - 15) + 10);
}
/** A CSS-style cubic-bezier timing function (x1, y1, x2, y2), solved numerically. */
export function cubicEase(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (s: number): number => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s: number): number => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  return (t: number): number => {
    const x = clamp01(t);
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (bx(mid) < x) lo = mid; else hi = mid; }
    return by((lo + hi) / 2);
  };
}
const bez3 = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, s: number): Pt => {
  const a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, c = 3 * (1 - s) * s * s, d = s ** 3;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
};
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const COIN_EASE = cubicEase(0.45, 0, 0.55, 1);
const SAMPLES = 32;

/** One sampled pose of the coin: where (px, from its start), size, opacity. */
export interface CoinPose { t: number; x: number; y: number; scale: number; opacity: number }

/** The coin (pure): from (0,0) to (dx, dy) on its own arc, shrinking to `end` and fading as it goes in. */
export function coinPoses(dx: number, dy: number, arcShare: number, end: number, samples = SAMPLES): CoinPose[] {
  const arc = Math.max(30, arcShare * Math.hypot(dx, dy));
  const p1 = { x: dx * 0.2, y: -arc * 1.3 };
  const p2 = { x: dx * 0.8, y: dy - arc * 0.5 };
  const out: CoinPose[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = COIN_EASE(t);
    const p = bez3({ x: 0, y: 0 }, p1, p2, { x: dx, y: dy }, u);
    out.push({ t, x: p.x, y: p.y, scale: 1 - (1 - end) * smoother(0.3, 1, u), opacity: 1 - smoother(0.82, 1, t) });
  }
  return out;
}
/** Transform + opacity keyframes for the coin. */
export const coinFrames = (poses: readonly CoinPose[]): Keyframe[] =>
  poses.map((p) => ({ transform: `translate(${r3(p.x)}px, ${r3(p.y)}px) scale(${r3(p.scale)})`, opacity: r3(p.opacity), offset: p.t }));

/** The portrait's pop (pure): one rise to `peak`, one small dip under rest, then still with no velocity left
 *  (sin(1.5 pi t) (1 - t)^2, normalised so its top is exactly `peak`). */
export function catchFrames(peak: number, samples = 24): Keyframe[] {
  const f = (t: number): number => Math.sin(1.5 * Math.PI * t) * (1 - t) ** 2;
  let top = 0;
  for (let i = 0; i <= 200; i++) top = Math.max(top, f(i / 200));
  const out: Keyframe[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    out.push({ transform: `scale(${r3(1 + ((peak - 1) * f(t)) / top)})`, offset: t });
  }
  return out;
}

/** When a pass def's stream lands (ms of the def's own clock): its landing layers, else the end of its travel. */
export const streamLandsAt = (id: 'duos-pass-send' | 'duos-pass-arrive'): number => gildArrivalMs(getDef(id), 0) || 400;

// ── The portrait ─────────────────────────────────────────────────────────────────────────────────────────────

/** The portrait that catches (or lets go of) a pass: a soft one-shot pop (transform only). */
export function catchPulse(el: Element | null): void {
  if (!el || !('animate' in el)) return;
  const c = getDuosPassConfig();
  (el as HTMLElement).animate(catchFrames(c.catchScale), { duration: c.catchMs, easing: 'linear' });
}

/** The teammate portrait a pass goes through: the bottom-right dock's disc (`[data-duos-mate]`). */
export function mateDoor(): HTMLElement | null {
  const dock = document.querySelector<HTMLElement>('[data-duos-mate]');
  return dock?.querySelector<HTMLElement>('.duosdock-disc') ?? dock;
}

const centreOf = (r: Box): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const camera = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

/** Both pass defs played once, invisible and silent, the first time the teammate portrait mounts: the stream's
 *  ribbon, bursts, ripple and filters link on that throwaway play, never on the first real pass. */
let warmed = false;
export function prewarmPassFx(): void {
  if (warmed || typeof window === 'undefined' || !canPlayDefs()) return;
  warmed = true;
  const at = { x: -400, y: -400 };
  const opts = { alpha: 0.001, muteSound: true, intensity: 0.1, recolor: streamPalette(), recolorGlow: true };
  playDef('duos-pass-send', { source: at, target: { x: -200, y: -400 }, camera: at }, opts);
  playDef('duos-pass-arrive', { source: at, target: { x: -200, y: -400 }, camera: at }, opts);
}

// ── SENDING ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The released card's copy, fading and shrinking a touch in place while its plate dissolves (transform / opacity,
 *  one node, removed when done). It sits in the drag card's own CSS context so it looks exactly like the drag card. */
function fadeCopy(face: HTMLElement, box: Box, zoom: number, ms: number, to: number): void {
  if (ms <= 0) return;
  const outer = document.createElement('div');
  outer.className = 'duoslob';
  outer.style.left = `${box.left}px`;
  outer.style.top = `${box.top}px`;
  outer.style.width = `${box.width}px`;
  outer.style.height = `${box.height}px`;
  const ctx = document.createElement('div');
  ctx.className = 'dragcard duoslob-dragctx';
  ctx.style.width = `${box.width / zoom}px`;
  ctx.style.height = `${box.height / zoom}px`;
  if (zoom !== 1) ctx.style.zoom = String(zoom);
  const f = face.cloneNode(true) as HTMLElement;
  f.removeAttribute('data-uid');
  ctx.appendChild(f);
  outer.appendChild(ctx);
  stageHost().appendChild(outer);
  const a = outer.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: `scale(${to})` }], { duration: ms, easing: 'cubic-bezier(0.4, 0, 0.7, 0.4)', fill: 'forwards' });
  const done = (): void => outer.remove();
  a.onfinish = done;
  a.oncancel = done;
}

/**
 * SEND: the card you let go of (`from`: its centre in screen px and its visual size in stage px; `face` its card
 * element; `plate` its plate's screen box; `zoom` the drag card's lift zoom) dissolves where it is and streams into
 * the portrait at `to` (a screen box). `coin`: one coin follows it in from the HUD's Gold. `onLand` runs as the stream
 * lands.
 */
export function playDrop(opts: {
  from: { cx: number; cy: number; w: number; h: number };
  plate?: Box | null;
  to: Box; face: HTMLElement | null; coin: boolean; zoom?: number;
  onLand?: () => void;
}): void {
  if (typeof document === 'undefined' || typeof Element === 'undefined' || !('animate' in Element.prototype)) { opts.onLand?.(); return; }
  const c = getDuosPassConfig();
  const zoom = opts.zoom ?? 1;
  const w = opts.from.w || 120, h = opts.from.h || 170;
  const fx = toStage(opts.from.cx), fy = toStage(opts.from.cy);
  if (opts.face) fadeCopy(opts.face, { left: fx - w / 2, top: fy - h / 2, width: w, height: h }, zoom, c.sendFadeMs, c.sendFadeScale);
  // The dissolve's dust is built on the NEXT frame, not the release frame (which already carries the pass's own commit:
  // the card leaving the hand, the drag ending): its imprint fades in from nothing, so the frame's wait never shows.
  const plate = opts.plate;
  if (plate && plate.width > 0) requestAnimationFrame(() => playPlateDissolve(plate));

  const target = centreOf(opts.to);
  // The stream rises off the dissolving card, a little above its centre where the dust lifts (screen px).
  const source = { x: opts.from.cx, y: opts.from.cy - (opts.plate?.height ?? 0) * c.streamFromY };
  let landed = false;
  const land = (): void => { if (landed) return; landed = true; opts.onLand?.(); };
  if (canPlayDefs()) {
    window.setTimeout(() => {
      const retire = playDef('duos-pass-send', { source, target, camera: camera() }, { recolor: streamPalette(c), recolorGlow: true, speed: c.sendSpeed, onDone: land });
      if (!retire) { land(); return; }
      window.setTimeout(land, streamLandsAt('duos-pass-send') / Math.max(0.05, c.sendSpeed));
    }, c.streamDelay);
  } else {
    window.setTimeout(land, c.sendFadeMs);
  }

  if (opts.coin) {
    // The coin leaves YOUR Gold (the HUD's Gold pill and its own glyph) on its own, later, higher curve.
    const pill = document.querySelector('.goldpill');
    const pr = pill?.getBoundingClientRect();
    const gx = pr && pr.width > 0 ? toStage(pr.left + pr.width / 2) : fx;
    const gy = pr && pr.width > 0 ? toStage(pr.top + pr.height / 2) : fy;
    const coin = document.createElement('span');
    coin.className = 'duoslob-coin';
    const glyph = pill?.querySelector('svg');
    if (glyph) coin.appendChild(glyph.cloneNode(true));
    coin.style.left = `${gx - 14}px`;
    coin.style.top = `${gy - 14}px`;
    stageHost().appendChild(coin);
    const a = coin.animate(coinFrames(coinPoses(toStage(target.x) - gx, toStage(target.y) - gy, c.coinArc, c.coinEnd)), { duration: c.coinMs, delay: c.coinDelay, easing: 'linear', fill: 'both' });
    const gone = (): void => coin.remove();
    a.onfinish = gone;
    a.oncancel = gone;
  }
}

/**
 * A SPELL's pass (Handout, R-DUOS-CARDS-01): the minion `uid` (a Shop offer or one of your board minions) dissolves where
 * it stands and streams into the teammate portrait, the same send as a drag pass, with no coin (the spell paid). Call it
 * while the card's element is still on screen (the store commit, before React re-renders). One layout read.
 */
export function playSpellPass(uid: string): void {
  if (typeof document === 'undefined') return;
  const card = document.querySelector<HTMLElement>(`.card[data-uid="${uid}"]`);
  const door = mateDoor();
  if (!card || !door) return;
  const r = card.getBoundingClientRect();
  if (r.width <= 0) return;
  playDrop({
    from: { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: card.offsetWidth, h: card.offsetHeight },
    plate: plateBox(card), face: card, to: door.getBoundingClientRect(), coin: false, onLand: () => catchPulse(door),
  });
}

// ── RECEIVING ────────────────────────────────────────────────────────────────────────────────────────────────

/** Hand cards whose entrance is a pass (no generic generated-card coalesce for them: the pass plays its own). */
const arriving = new Set<string>();
export const isPassArrival = (uid: string): boolean => arriving.has(uid);

const plateBox = (card: HTMLElement): DOMRect => (card.querySelector<HTMLElement>('.cardplate:not(.plate-interior)') ?? card).getBoundingClientRect();
const hideCard = (card: HTMLElement): void => { card.style.setProperty('opacity', '0', 'important'); };
const showCard = (card: HTMLElement): void => { card.style.removeProperty('opacity'); };

/**
 * RECEIVE onto the hand card `target`: a stream leaves the portrait at `from` (a screen box), arcs to the card's plate
 * and the card coalesces there as it lands. The card is kept invisible until its coalesce takes over.
 */
export function playEmerge(opts: { from: Box; target: HTMLElement; onLand?: () => void }): void {
  const card = opts.target;
  const c = getDuosPassConfig();
  hideCard(card);
  let formed = false;
  const form = (): void => {
    if (formed) return;
    formed = true;
    showCard(card); // the coalesce hides it again itself (with !important) and shows it as it resolves
    if (card.isConnected) {
      const r = plateBox(card);
      if (r.width > 0) playPlateCoalesce(r, card);
    }
    opts.onLand?.();
  };
  if (!canPlayDefs()) { form(); return; }
  const r = plateBox(card);
  const retire = playDef('duos-pass-arrive', { source: centreOf(opts.from), target: centreOf(r), camera: camera() }, { recolor: streamPalette(c), recolorGlow: true, speed: c.recvSpeed, onDone: form });
  if (!retire) { form(); return; }
  window.setTimeout(form, Math.max(0, streamLandsAt('duos-pass-arrive') / Math.max(0.05, c.recvSpeed) - c.coalesceLead));
}

/** A teammate's pass just landed in MY hand as `uid`: a stream leaves their portrait (bottom right) and the card
 *  coalesces in its slot as it lands. */
export function playArrival(uid: string): void {
  if (typeof document === 'undefined') return;
  // The hand's own "a card was added" coalesce stands down for this card: the pass plays its own, timed to the stream.
  // Registered before React renders the card (the store's update renders on a later microtask), so the hand sees it.
  arriving.add(uid);
  window.setTimeout(() => arriving.delete(uid), 5000);
  const findTarget = (): HTMLElement | null => document.querySelector<HTMLElement>(`.row.hand .card[data-uid="${uid}"]`);
  // The card renders by the next frame: hide it before that frame paints (no flash); launch on the frame after, when
  // its slot is final (the neighbours' make-room glide has started from their own rests).
  const hideNow = (): HTMLElement | null => { const t = findTarget(); if (t) hideCard(t); return t; };
  hideNow();
  requestAnimationFrame(() => {
    hideNow();
    requestAnimationFrame(() => {
      const t = hideNow();
      const door = mateDoor();
      if (!t) return;
      if (!door) { showCard(t); return; }
      catchPulse(door);
      playEmerge({ from: door.getBoundingClientRect(), target: t });
    });
  });
}

// ── DEV: the ✈ Duos Pass tuner's ▶ buttons ────────────────────────────────────────────────────────────────────

/** Plays the send from your first hand card into the teammate portrait (the card itself stays: a copy dissolves). */
export function previewDrop(): boolean {
  const card = document.querySelector<HTMLElement>('.row.hand .card[data-uid]');
  const door = mateDoor();
  if (!card || !door) return false;
  const r = card.getBoundingClientRect();
  playDrop({
    from: { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: card.offsetWidth, h: card.offsetHeight },
    plate: plateBox(card), face: card, to: door.getBoundingClientRect(), coin: true, onLand: () => catchPulse(door),
  });
  return true;
}

/** Plays the arrival onto your first hand card (hidden, then coalesced as the stream lands). */
export function previewArrival(): boolean {
  const card = document.querySelector<HTMLElement>('.row.hand .card[data-uid]');
  const uid = card?.getAttribute('data-uid');
  if (!uid || !mateDoor()) return false;
  playArrival(uid);
  return true;
}
