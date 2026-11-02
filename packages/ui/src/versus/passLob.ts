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

// ── EVERY EFFECT SEND (R-DUOS-PASS-FLIGHT-01) ────────────────────────────────────────────────────────────────

/**
 * Owner 2026-11-01: "anytime a card passes something like this, or like disco, show the passing animation from the
 * source card into the teammate's portrait, just like we do for handout. from the discover selection, the card(s) that
 * is passed should fire that animation". Every card (or Gold) an effect sends my teammate streams from WHAT SENT IT
 * into their portrait, the same look as Handout's.
 *
 * WHERE IT STARTS (pure, `passFlightOf`), from the outbox entry and its presentation-only `src`:
 *  - a Discover option (`discover`): Matchmaker's pick, Disco's two other options, a Monstrocity picked from a Discover.
 *    The option card itself dissolves there (it leaves: the Discover closes) and streams in.
 *  - the card that left (a spell's or a sale's pass with no `src`: Handout, CueBee, Salesman of the Year): it dissolves
 *    where it stood (`playSpellPass`, unchanged).
 *  - the card that caused it and STAYS (`uid`: Antsy, Toot Toot, Bratworst Buck, Tribe Bundle, Share the Wealth): the
 *    stream leaves that card. Only when the gift IS that card (a Monstrocity copy) does a copy of its face dissolve
 *    there too: a random gift is the teammate's run's own pick, so this screen never knows its face.
 *  - a rune badge (`rune`: Shoutful Bounty, Echoing Results, Teammate Synergy) or the Equipment slot (`equip`: Gold
 *    Gifter).
 *  - IN COMBAT (`combatIdx`): the combat unit that sent it (the fight's `teamSend` event names it), on that beat; a rune
 *    meter's gift has no body, so its rune's badge, else my hero portrait.
 * A drag pass (no `via`, no `team`) already played its own drop. A team effect that is not a card or Gold (max Gold, a
 * discount, Broshake's buff, Playing Catch, a sale note) is not a send and plays nothing.
 */
export type PassFlight =
  | { at: 'discover'; index: number }
  | { at: 'card'; uid: string; leaves: boolean; face: boolean }
  | { at: 'rune'; id: string }
  | { at: 'equip'; id: string }
  | { at: 'unit'; uid: string | null; rune: string | null };

/** The outbox entry fields the mapping reads (a `DuosOutboxEntry`). */
export interface PassFlightEntry {
  card: { uid: string; cardId: string };
  via?: 'spell' | 'sale';
  team?: { kind: string; cardId?: string; randomSpell?: boolean; randomMinion?: boolean };
  combatIdx?: number;
  src?: { uid: string } | { discover: number } | { rune: string } | { equip: string };
}

/** Team effects that hand the teammate something (a card, Gold, a buff): the ones a stream carries. `buffLeftmost`:
 *  Buddy System's +3/+2 streams from its rune badge (Duos batch 2; Broshake's leaves with its spell, so it has no source). */
const SENDS = new Set(['gift', 'gold', 'tripleReward', 'buffLeftmost']);

/** Where a send's stream starts (pure). `combatUid`: the body the fight's `teamSend` named (combat entries only);
 *  `cardIdOf`: the cardId of a card on my run (to tell a Monstrocity copy from a random gift). Null = nothing to fly. */
export function passFlightOf(e: PassFlightEntry, combatUid?: string | null, cardIdOf?: (uid: string) => string | undefined): PassFlight | null {
  if (e.team && !SENDS.has(e.team.kind)) return null;
  if (!e.team && !e.via) return null; // a drag pass: its drop already played
  if (e.combatIdx != null) {
    const rune = e.team?.kind === 'gift' && !combatUid
      ? (e.team.randomSpell ? 'rune_shoutful_bounty' : e.team.randomMinion ? 'rune_echoing_results' : null)
      : null;
    return { at: 'unit', uid: combatUid ?? null, rune };
  }
  const src = e.src;
  if (src && 'discover' in src) return { at: 'discover', index: src.discover };
  if (src && 'rune' in src) return { at: 'rune', id: src.rune };
  if (src && 'equip' in src) return { at: 'equip', id: src.equip };
  if (src && 'uid' in src) {
    if (!e.team && src.uid === e.card.uid) return { at: 'card', uid: src.uid, leaves: true, face: true };
    const gift = e.team?.kind === 'gift' ? e.team.cardId : undefined;
    return { at: 'card', uid: src.uid, leaves: false, face: !!gift && cardIdOf?.(src.uid) === gift };
  }
  if (!e.team) return { at: 'card', uid: e.card.uid, leaves: true, face: true };
  return null;
}

// ── FROM THE RELEASE POINT (R-DUOS-PASS-RELEASE-01) ──────────────────────────────────────────────────────────

/**
 * Owner 2026-11-01: "can spells like broshake/tribe bundle etc show the animation from the release point instead of
 * from hand?" A spell's send names the spell (`src: { uid }`), and inside the cast's commit that uid is still the hand
 * slot it was dragged out of, so the stream used to leave the hand. Now the drop notes WHERE the player let go (the
 * floating drag card's box, read once at the release: `noteCastRelease`), and a send whose source is that card streams
 * from there instead.
 *
 *  - A SPELL leaves (`leaves`): its face fades and its plate dissolves where it was let go, and the stream rises off
 *    it. A cast plays no dissolve of its own, so this is the only one.
 *  - A MINION played by drag (a Shout that sends) stays: the stream alone leaves the release point. Its plate already
 *    dissolves there (the `played` presentation), so nothing dissolves twice.
 *
 * PRESENTATION ONLY: one module record, never in run state or on the wire. Keyed by the card's uid, it expires after
 * `RELEASE_TTL_MS` (a click cast, a keyboard cast, the Scene Builder, a restore note nothing and keep today's source).
 * The face dissolves once: a cast that sends twice streams twice from the point, the second without a face.
 */
export interface CastRelease {
  uid: string;
  /** The release box: centre in screen px, visual size (layout size times the lift zoom) in stage px. */
  cx: number; cy: number; w: number; h: number; zoom: number;
  plate: Box | null;
  face: HTMLElement | null;
  /** The card is gone from the run after this (a spell): its face dissolves at the point. */
  leaves: boolean;
  at: number;
}
export const RELEASE_TTL_MS = 1500;
let lastRelease: CastRelease | null = null;
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Note where `uid` was let go (call it on the drop, BEFORE the dispatch, while the drag card is still mounted). One
 *  layout read. `pointer` and `size` (stage px) stand in when no drag card is up (a targeted spell's aim). */
export function noteCastRelease(uid: string, opts: { pointer: Pt; size: { w: number; h: number }; leaves: boolean }, now = nowMs()): void {
  if (typeof document === 'undefined') return;
  const dc = document.querySelector<HTMLElement>('.dragcard');
  const dr = dc?.getBoundingClientRect();
  const zoom = parseFloat(dc?.style.zoom || '1') || 1;
  const live = !!dc && !!dr && dr.width > 0;
  lastRelease = {
    uid,
    cx: live ? dr.left + dr.width / 2 : opts.pointer.x,
    cy: live ? dr.top + dr.height / 2 : opts.pointer.y,
    w: live ? dc.offsetWidth * zoom : opts.size.w,
    h: live ? dc.offsetHeight * zoom : opts.size.h,
    zoom: live ? zoom : 1,
    plate: live && opts.leaves ? dc.querySelector<HTMLElement>('.cardplate:not(.plate-interior)')?.getBoundingClientRect() ?? null : null,
    face: live && opts.leaves ? dc.querySelector<HTMLElement>('.dragshrink > .card') ?? dc.querySelector<HTMLElement>('.card') : null,
    leaves: opts.leaves,
    at: now,
  };
}

/** The release noted for `uid`, if it is fresh. Its face and plate are handed out once (a second send streams bare). */
export function takeCastRelease(uid: string, now = nowMs()): CastRelease | null {
  const r = lastRelease;
  if (!r || r.uid !== uid) return null;
  if (now - r.at > RELEASE_TTL_MS) { lastRelease = null; return null; }
  const out = { ...r };
  r.face = null;
  r.plate = null;
  return out;
}

/** Forget the noted release (tests). */
export function clearCastRelease(): void { lastRelease = null; }

/** A send's stream from a noted release point into the teammate portrait (no layout read but the portrait's). */
function streamFromRelease(rel: CastRelease, face: boolean): boolean {
  const door = mateDoor();
  if (!door) return false;
  const showFace = (rel.leaves || face) ? rel.face : null;
  playDrop({
    from: { cx: rel.cx, cy: rel.cy, w: rel.w, h: rel.h }, zoom: rel.zoom,
    plate: showFace ? rel.plate : null, face: showFace, to: door.getBoundingClientRect(), coin: false, onLand: () => catchPulse(door),
  });
  return true;
}

/** A send's stream from `el` into the teammate portrait: the card's own face dissolving there when `face` (a copy: the
 *  element itself is left alone), else the stream alone. One layout read per element, at launch. */
function streamFrom(el: HTMLElement, face: boolean): boolean {
  const door = mateDoor();
  if (!door) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0) return false;
  const card = face ? (el.closest<HTMLElement>('.card') ?? el) : null;
  playDrop({
    from: { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: el.offsetWidth, h: el.offsetHeight },
    plate: card ? plateBox(card) : null, face: card, to: door.getBoundingClientRect(), coin: false, onLand: () => catchPulse(door),
  });
  return true;
}

const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const esc = (s: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'));
const runeEl = (id: string): HTMLElement | null =>
  q(`.questbadges .runebadge[data-source-id="${esc(id)}"]`) ?? q(`.statusbar .heropowerbtn[data-hero-rune="${esc(id)}"]`);

/** The element a flight starts from right now, or null (pure over the DOM). */
export function passFlightEl(f: PassFlight): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  switch (f.at) {
    case 'discover': return q(`.discover-ov.dce .disc-cards > .disc-slot:nth-child(${f.index + 1}) .card`);
    case 'card': return q(`.card[data-uid="${esc(f.uid)}"]`) ?? q(`.unit[data-uid="${esc(f.uid)}"]`);
    case 'rune': return runeEl(f.id);
    case 'equip': return q('.equipslot .heropowerbtn');
    case 'unit': return (f.uid ? q(`.unit[data-uid="${esc(f.uid)}"]`) : null) ?? (f.rune ? runeEl(f.rune) : null) ?? q('.statusbar .hero .f');
  }
}

/**
 * Play one send's stream into the teammate portrait. Call it inside the commit that queued it (the source is still on
 * screen: a Discover option, the card that left) or, in combat, at its `teamSend` beat. Returns whether it played.
 */
export function playPassFlight(f: PassFlight | null): boolean {
  if (!f || typeof document === 'undefined') return false;
  // A card the player just let go of (a spell cast or a minion played by drag): it streams from where they let go.
  if (f.at === 'card') { const rel = takeCastRelease(f.uid); if (rel) return streamFromRelease(rel, f.face); }
  if (f.at === 'card' && f.leaves) { playSpellPass(f.uid); return true; }
  const el = passFlightEl(f);
  if (!el) return false;
  return streamFrom(el, f.at === 'discover' || (f.at === 'card' && f.face));
}

/** IN COMBAT: the body each of my fight's `teamSend` beats named (carry index -> uid), noted by the combat sync as the
 *  replay reaches them, read when the held entry ships on that beat. */
const combatSenders = { wave: -1, uid: new Map<number, string | null>() };
export function noteTeamSendSources(wave: number, events: readonly { type: string; side?: string; member?: number; idx?: number; uid?: string }[], through: number, member: number): void {
  if (combatSenders.wave !== wave) { combatSenders.wave = wave; combatSenders.uid = new Map(); }
  const end = Math.min(through, events.length);
  for (let i = 0; i < end; i++) {
    const e = events[i]!;
    if (e.type === 'teamSend' && e.side === 'player' && e.member === member && e.idx != null && !combatSenders.uid.has(e.idx)) combatSenders.uid.set(e.idx, e.uid ?? null);
  }
}

/** Sends already flown (a network retry ships an entry again: it streams once). */
const flown = new Set<string>();

/** One outbox entry of `run` (mine, on screen) is being sent now: stream it from its source, once. */
export function playEntryFlight(e: PassFlightEntry & { seq: number; wave: number }, run: { seed: number; hand: readonly { uid: string; cardId: string }[]; board: readonly { uid: string; cardId: string }[]; shop: readonly { uid: string; cardId: string }[] }): boolean {
  const key = `${run.seed}:${e.seq}`;
  if (flown.has(key)) return false;
  const combatUid = e.combatIdx != null && combatSenders.wave === e.wave ? combatSenders.uid.get(e.combatIdx) ?? null : null;
  const cardIdOf = (uid: string): string | undefined =>
    (run.hand.find((c) => c.uid === uid) ?? run.board.find((c) => c.uid === uid) ?? run.shop.find((c) => c.uid === uid))?.cardId;
  const f = passFlightOf(e, combatUid, cardIdOf);
  if (!f) return false;
  flown.add(key);
  return playPassFlight(f);
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
