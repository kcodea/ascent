import type { AncientId } from '@game/sim';
import { canPlayDefs, playDef } from '../fx/playDef';
import { getDef } from '../fx/fxDefs';
import { gildArrivalMs } from '../gildTrailSources';
import { stageHost, toStage } from '../stage';
import { ancientColor, getAncientsConfig, type AncientsFullConfig } from './ancientsConfig';
import { notePickRelease, prefersReducedMotion } from './ancientsFx';
import { ancientPickBurst, ancientTrailPalette, warmRevealFx } from './ancientsSmoke';
import { playCue } from './ancientsSound';

/**
 * THE PICK → COLLAPSE → TRIPLE TRAIL → SLAM (owner 2026-09-27: "after selection, i dont want the black circle to go
 * back to the hero power, id rather the screen fade back and give more emphasis on the choice slamming the hero power",
 * then, reviewing the first pass: "do not use the art square to send to the hero power. collapse it into the same
 * pixi style effect we use for when the player gets a triple"). The research behind the numbers is in
 * docs/devlog/2026-09-27-ancient-pick-research.md. One continuous motion:
 *
 *   0           CLICK. The backdrop, the banner and the other Ancients fade off (`pickFadeMs`); the Shop fades back in.
 *               The chosen card's text fades, and its art PINCHES into a bright core of its colour (`collapseMs`,
 *               ease-in: a hair of swell, then fastest at the end), a glow gathering to its centre.
 *   launch      Near the end of the pinch (`trailAt`) the TRIPLE's trail takes over: the shop's own `gild-trail` def
 *               (the gild's poof, its arcing ribbon and its landing burst), recoloured to the Ancient, from the core to
 *               the hero power. The card is gone as the poof blooms. The triple's woosh plays (`pickWoosh`).
 *   contact     The trail lands (the def's own arrival, × `trailTime`): the triple's landing burst, the seal cue
 *               (`pickSeal`, the triple's impact clip), a light bloom on the hero power, and the power SQUASHES in and
 *               holds: the hit-stop (`hitStopMs`). The music's duck lets go here.
 *   release     The power springs back (a small overshoot), a crisp ring (`ancient-pick-impact`), a trauma shake +
 *               punch-zoom on the board art (`.boardbg`, never `.app`), and the split's crack opens (`AncientSplit`).
 *
 * Perf: every rect is read ONCE, at the click. DOM motion is WAAPI transform / opacity (and the individual `translate`
 * / `scale` properties), all one-shot; the flash and the core glow are static gradients whose opacity animates.
 * Nothing loops. Rects are SCREEN px (Pixi takes them as-is); a value written into CSS goes through `toStage`.
 * Reduced motion: the card fades, then a small burst and the sound; no collapse, trail, shake, zoom, squash or flash.
 */

/** When each step lands, in ms from the click. `end` is when the whole pick has played (the gate goes idle). */
export interface PickTimeline { fade: number; launch: number; contact: number; release: number; end: number }

/** The triple trail's own flight (its landing layers' `at`), before `trailTime`. 420 ms as authored. */
function trailFlightMs(): number {
  return gildArrivalMs(getDef('gild-trail'), 0) || 420;
}

export function pickTimeline(c: AncientsFullConfig = getAncientsConfig(), reduced = prefersReducedMotion()): PickTimeline {
  if (reduced) return { fade: 200, launch: 0, contact: 200, release: 200, end: 260 };
  const launch = Math.round(Math.max(0, c.collapseMs) * Math.min(1, Math.max(0, c.trailAt)));
  const contact = launch + Math.round(trailFlightMs() * Math.max(0.05, c.trailTime));
  const release = contact + Math.max(0, c.hitStopMs);
  return { fade: c.pickFadeMs, launch, contact, release, end: Math.max(c.pickFadeMs, c.collapseMs, release) + 60 };
}

interface HpBox { x: number; y: number; w: number; el: HTMLElement }
/** The hero-power button's centre + width (screen px). Read once per pick. */
function hpBox(): HpBox | null {
  const el = document.querySelector<HTMLElement>('.statusbar .heropanel .heropowerbtn');
  const r = el?.getBoundingClientRect();
  return el && r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, el } : null;
}

const anim = (el: Element | null | undefined, k: Keyframe[], o: KeyframeAnimationOptions): Animation | null =>
  el && typeof (el as HTMLElement).animate === 'function' ? (el as HTMLElement).animate(k, o) : null;

/**
 * Collapse the clicked Ancient card (`card`, the `.anc-card` button) into the triple's trail and slam it into the hero
 * power. Called from the offer's click, BEFORE the pick is dispatched, so the measurements are of the card where it was
 * clicked. Notes the release time for the split. Returns the timeline it is playing.
 */
export function playPickSlam(card: HTMLElement, id: AncientId): PickTimeline {
  const c = getAncientsConfig();
  const reduced = prefersReducedMotion();
  const t = pickTimeline(c, reduced);
  const hp = hpBox();
  notePickRelease(performance.now() + t.release);
  const color = ancientColor(id);

  if (reduced || !hp) {
    anim(card, [{ opacity: 1 }, { opacity: 0 }], { duration: t.contact, easing: 'ease-out', fill: 'forwards' });
    window.setTimeout(() => { impactContact(hp, c, true); impactRelease(hp, color, c, true); }, t.contact);
    return t;
  }

  // ONE layout read: the art frame (what collapses) and the card (its transform origin), where it was clicked.
  const frame = card.querySelector<HTMLElement>('.anc-art-frame') ?? card;
  const fr = frame.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const base = getComputedStyle(card).transform; // the hover lift it is wearing: the collapse starts from it, no jump
  const pre = base && base !== 'none' ? `${base} ` : '';
  const core = { x: fr.left + fr.width / 2, y: fr.top + fr.height / 2 };
  card.style.transformOrigin = `${toStage(core.x - cr.left)}px ${toStage(core.y - cr.top)}px`;
  card.style.pointerEvents = 'none';

  // THE PINCH: a hair of swell (the breath before it goes), then an accelerating implosion to a point. It never reads
  // as a shrinking square (owner 2026-09-27: "do not use the art square"): the frame's corners are rounded off into a
  // disc by a one-shot clip while the core's light floods it, so what shrinks is a ball of the Ancient's colour, and
  // it is gone just after the trail's poof blooms over it.
  const T = Math.max(1, c.collapseMs);
  const goneAt = Math.min(1, (t.launch + 30) / T);
  anim(card, [
    { offset: 0, transform: `${pre}scale(1)`, opacity: 1, easing: 'cubic-bezier(0.3, 0, 0.6, 1)' },
    { offset: 0.15, transform: `${pre}scale(1.03)`, opacity: 1, easing: 'cubic-bezier(0.6, 0, 0.95, 0.35)' },
    { offset: Math.max(0.2, goneAt * 0.85), transform: `${pre}scale(0.22)`, opacity: 1, easing: 'linear' },
    { offset: goneAt, transform: `${pre}scale(0.12)`, opacity: 0 },
    { offset: 1, transform: `${pre}scale(0.12)`, opacity: 0 },
  ], { duration: T, fill: 'forwards' });
  anim(frame, [
    { clipPath: 'circle(71% at 50% 50%)', easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
    { clipPath: 'circle(48% at 50% 50%)', offset: 0.3, easing: 'ease-in' }, // round early: never a clipped square
    { clipPath: 'circle(38% at 50% 50%)', offset: 0.6 },
    { clipPath: 'circle(30% at 50% 50%)' },
  ], { duration: T, fill: 'forwards' });
  // The text is not what collapses: it goes first, quickly.
  card.querySelectorAll('.anc-cardx-name, .anc-cardx-rulebar, .anc-cardx-rule').forEach((el) =>
    anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: Math.max(60, T * 0.45), easing: 'ease-out', fill: 'forwards' }));
  // THE CORE: light gathering to the centre of the art (a static radial gradient in the Ancient's colour whose opacity
  // rises as it pinches), so the card turns into the bright point the trail leaves from.
  if (c.coreGlow > 0) {
    const glow = document.createElement('span');
    glow.className = 'anc-collapse-core';
    glow.setAttribute('aria-hidden', 'true');
    frame.appendChild(glow);
    anim(glow, [
      { opacity: 0, transform: 'scale(1.6)' },
      { opacity: c.coreGlow, transform: 'scale(1)', offset: 0.5 },
      { opacity: c.coreGlow, transform: 'scale(0.9)' },
    ], { duration: T, easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'forwards' });
  }

  window.setTimeout(() => launchTrail(core, hp, color, c), t.launch);
  window.setTimeout(() => impactContact(hp, c, false), t.contact);
  window.setTimeout(() => impactRelease(hp, color, c, false), t.release);
  return t;
}

/** THE TRIPLE'S TRAIL, from the core to the hero power: the shop gild's own def (poof, arc, landing), recoloured to the
 *  Ancient. Its sound layers are muted (they are on the ducked combat bus); the same clips play as the pick's cues. */
function launchTrail(from: { x: number; y: number }, hp: HpBox, color: string, c: AncientsFullConfig): void {
  playCue('pickWoosh');
  if (!canPlayDefs()) return;
  playDef('gild-trail', { source: from, target: { x: hp.x, y: hp.y }, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }, {
    index: 0, time: Math.max(0.05, c.trailTime), intensity: Math.max(0, c.trailIntensity), recolor: ancientTrailPalette(color), recolorGlow: true, muteSound: true,
  });
}

/** The ▶ Awaken demo and any pick with no card: the impact alone, on the hero power, now. */
export function playPickImpactNow(id: AncientId): void {
  const c = getAncientsConfig();
  const reduced = prefersReducedMotion();
  const hp = hpBox();
  impactContact(hp, c, reduced);
  impactRelease(hp, ancientColor(id), c, reduced);
}

/** CONTACT: the seal cue, the light bloom, and the hero power squashing in (held through the hit-stop). */
function impactContact(hp: HpBox | null, c: AncientsFullConfig, reduced: boolean): void {
  playCue('pickSeal');
  if (reduced || !hp) return;
  if (c.recoil > 0) {
    // One animation for the whole hit: squash in fast, HOLD through the hit-stop, spring back past 1, settle.
    const r = c.recoil, hold = Math.max(0, c.hitStopMs), back = Math.max(160, c.shakeMs);
    const total = 50 + hold + back;
    anim(hp.el, [
      { scale: '1', easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' },
      { scale: String(1 - r), offset: 50 / total },
      { scale: String(1 - r), offset: (50 + hold) / total, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' },
      { scale: '1' },
    ], { duration: total });
  }
  if (c.impactFlash <= 0) return;
  const d = toStage(hp.w) * 2.6;
  const el = document.createElement('div');
  el.className = 'anc-impact-flash';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { left: `${toStage(hp.x)}px`, top: `${toStage(hp.y)}px`, width: `${d}px`, height: `${d}px` });
  stageHost().appendChild(el);
  const a = anim(el, [
    // Born at full size: a halo round the power the moment the trail hits it.
    { opacity: c.impactFlash, transform: 'translate(-50%, -50%) scale(1)' },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1.3)' },
  ], { duration: c.impactFlashMs, easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'forwards' });
  if (!a) { el.remove(); return; }
  a.onfinish = () => el.remove();
  a.oncancel = () => el.remove();
}

/** RELEASE: the crisp ring and the board's shake + punch-zoom. */
function impactRelease(hp: HpBox | null, color: string, c: AncientsFullConfig, reduced: boolean): void {
  if (!hp) return;
  ancientPickBurst(color, { x: hp.x, y: hp.y }, reduced ? c.burstScale * 0.7 : c.burstScale, reduced ? 0.6 : 1);
  if (!reduced) boardShake(hp, c);
}

/** Smooth 1-D value noise in [-1, 1] (cosine-interpolated random lattice): continuous, so the shake reads as a
 *  camera, not a jitter (Eiserloh). Presentation-only randomness (Math.random is banned in core/content/sim only). */
function smoothNoise(cells: number): (t: number) => number {
  const lattice = Array.from({ length: cells + 2 }, () => Math.random() * 2 - 1);
  return (t: number): number => {
    const p = Math.max(0, t) * cells, i = Math.floor(p), f = p - i;
    const w = (1 - Math.cos(f * Math.PI)) / 2;
    return lattice[i]! * (1 - w) + lattice[Math.min(i + 1, cells + 1)]! * w;
  };
}

/**
 * THE SCREEN REACT: a trauma shake that decays with trauma SQUARED (Eiserloh), plus a punch-zoom toward the hero
 * power, on the board ART only. `.boardbg` layers are fixed leaves, so moving them moves nothing else, and NEVER
 * `.app` (see gateLayout.test.ts). Baked into one linear WAAPI animation up front: no per-frame JS, no layout reads.
 */
function boardShake(hp: HpBox, c: AncientsFullConfig): void {
  if (c.shakeMs <= 0 || (c.shakePx <= 0 && c.punchZoom <= 0)) return;
  const nx = smoothNoise(8), ny = smoothNoise(8);
  const N = 18;
  const frames: Keyframe[] = [];
  for (let f = 0; f <= N; f++) {
    const t = f / N;
    const k = (1 - t) * (1 - t); // trauma², trauma decaying linearly to 0
    frames.push(f === N
      ? { translate: '0px 0px', scale: '1' }
      : { translate: `${(c.shakePx * k * nx(t)).toFixed(2)}px ${(c.shakePx * k * ny(t)).toFixed(2)}px`, scale: (1 + c.punchZoom * k).toFixed(4) });
  }
  const origin = `${toStage(hp.x)}px ${toStage(hp.y)}px`;
  document.querySelectorAll<HTMLElement>('.boardbg').forEach((el) => {
    el.style.transformOrigin = origin;
    const a = anim(el, frames, { duration: c.shakeMs, easing: 'linear' });
    if (a) a.onfinish = () => { el.style.transformOrigin = ''; };
  });
}

/** Play the pick's Pixi once, invisibly (alpha ~0), while the offer sits settled, so the real one pays no first-play
 *  cost on the pick (measured 2026-09-27: a cold first play landed ~250 ms late in headless Chrome). */
export function warmPickBurst(): void {
  if (!canPlayDefs()) return;
  // Far off screen: even at alpha ~0 the trail's bloom filter left a visible dot on the hero power (pass W1).
  const at = { x: -4000, y: -4000 };
  ancientPickBurst('#ffffff', at, 1, 1, 0.001); // not 0: a fully transparent container may be skipped, not drawn
  playDef('gild-trail', { source: at, target: at, camera: at }, { alpha: 0.001, muteSound: true, intensity: 0.1 });
  warmRevealFx(); // and the reveal's spark + burst
}
