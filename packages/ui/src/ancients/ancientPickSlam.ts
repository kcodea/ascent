import type { AncientId } from '@game/sim';
import { stageHost, toStage } from '../stage';
import { ancientColor, getAncientsConfig, type AncientsFullConfig } from './ancientsConfig';
import { notePickRelease, prefersReducedMotion } from './ancientsFx';
import { ancientPickBurst } from './ancientsSmoke';
import { playCue } from './ancientsSound';

/**
 * THE PICK → SLAM (owner 2026-09-27: "after selection, i dont want the black circle to go back to the hero power, id
 * rather the screen fade back and give more emphasis on the choice slamming the hero power. can you add a slight pixi
 * burst and maybe some screen react for emphasis?"). The research behind every number here is in
 * docs/devlog/2026-09-27-ancient-pick-research.md. One clean arc, anticipation → impact → follow-through:
 *
 *   0 ms        CLICK. The backdrop, the banner and the two other Ancients fade off (`pickFadeMs`); the chosen card's
 *               text fades, and its art LIFTS, pulling slightly back from the hero power (`pickLiftMs`, ease-out).
 *   lift        THE FLIGHT. It accelerates into the hero power (ease-in: fastest at contact), shrinking to the
 *               button's size (`pickFlightMs`). The backdrop has cleared before it lands, so the target is in view.
 *   contact     IMPACT FRAME. The seal cue (`pickSeal`) and a light bloom on the hero power (`impactFlash`); the card
 *               is HELD squashed against it: the hit-stop (`hitStopMs`).
 *   release     The card is absorbed; the Pixi burst (`ancient-pick-impact`: a ring + a few sparks in the Ancient's
 *               colour), a trauma shake + punch-zoom on the board art (`.boardbg`, never `.app`), the hero power's
 *               recoil, and the split's crack opens (`AncientSplit`, the follow-through).
 *
 * Perf: every rect is read ONCE, at the click. Motion is WAAPI transform / opacity (and the individual `translate` /
 * `scale` properties), all one-shot; the flash is a static gradient whose opacity is animated. Nothing loops.
 * Coordinates: rects are SCREEN px (Pixi takes them as-is); a value written into CSS goes through `toStage`.
 * Reduced motion: no lift, flight, shake, zoom, recoil or flash: the card fades, then a small burst and the sound.
 */

/** When each step lands, in ms from the click. `end` is when the whole pick has played (the gate goes idle). */
export interface PickTimeline { fade: number; contact: number; release: number; end: number }

/** How long the absorbed card takes to vanish into the hero power after the release. */
const ABSORB_MS = 90;

export function pickTimeline(c: AncientsFullConfig = getAncientsConfig(), reduced = prefersReducedMotion()): PickTimeline {
  if (reduced) return { fade: 200, contact: 200, release: 200, end: 260 };
  const contact = Math.max(0, c.pickLiftMs) + Math.max(0, c.pickFlightMs);
  const release = contact + Math.max(0, c.hitStopMs);
  return { fade: c.pickFadeMs, contact, release, end: Math.max(c.pickFadeMs, release + ABSORB_MS) };
}

interface HpBox { x: number; y: number; w: number; el: HTMLElement }
/** The hero-power button's centre + width (screen px). Read once per pick. */
function hpBox(): HpBox | null {
  const el = document.querySelector<HTMLElement>('.statusbar .heropanel .heropowerbtn');
  const r = el?.getBoundingClientRect();
  return el && r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, el } : null;
}

/**
 * Fly the clicked Ancient card (`card`, the `.anc-card` button) into the hero power and play the slam. Called from the
 * offer's click, BEFORE the pick is dispatched, so the measurements are of the card at rest where the player clicked.
 * Notes the release time for the split. Returns the timeline it is playing.
 */
export function playPickSlam(card: HTMLElement, id: AncientId): PickTimeline {
  const c = getAncientsConfig();
  const reduced = prefersReducedMotion();
  const t = pickTimeline(c, reduced);
  const hp = hpBox();
  notePickRelease(performance.now() + t.release);
  const anim = (el: Element | null | undefined, k: Keyframe[], o: KeyframeAnimationOptions): void => {
    if (el && typeof (el as HTMLElement).animate === 'function') (el as HTMLElement).animate(k, o);
  };

  if (reduced || !hp) {
    anim(card, [{ opacity: 1 }, { opacity: 0 }], { duration: t.contact, easing: 'ease-out', fill: 'forwards' });
    window.setTimeout(() => { impactContact(hp, c, reduced); impactRelease(id, hp, c, reduced); }, t.contact);
    return t;
  }

  // ONE layout read: the art frame (what flies) and the card (its transform origin), at rest where it was clicked.
  const frame = card.querySelector('.anc-art-frame') ?? card;
  const fr = frame.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  const base = getComputedStyle(card).transform; // the hover lift it is wearing; the flight starts from it, no jump
  const pre = base && base !== 'none' ? `${base} ` : '';
  const fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2;
  const dx = toStage(hp.x - fx), dy = toStage(hp.y - fy);
  const len = Math.hypot(dx, dy) || 1;
  const lift = 14; // design px back along the line, away from the hero power: the wind-up
  const lx = (-dx / len) * lift, ly = (-dy / len) * lift - 6;
  const s = hp.w / Math.max(1, fr.width); // the art lands at the button's size
  card.style.transformOrigin = `${toStage(fx - cr.left)}px ${toStage(fy - cr.top)}px`;
  card.style.pointerEvents = 'none';
  const total = t.release + ABSORB_MS;
  const at = (ms: number): number => Math.min(1, Math.max(0, ms / total));
  const tf = (x: number, y: number, k: number): string => `${pre}translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${k.toFixed(4)})`;
  anim(card, [
    { offset: 0, transform: tf(0, 0, 1), opacity: 1, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    // Anticipation: up and back, a touch bigger.
    { offset: at(c.pickLiftMs), transform: tf(lx, ly, 1.05), opacity: 1, easing: 'cubic-bezier(0.55, 0, 0.9, 0.35)' },
    // Contact: fastest here (ease-in), at the button's size.
    { offset: at(t.contact), transform: tf(dx, dy, s), opacity: 1, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' },
    // Hit-stop: held against the power, pressed in slightly.
    { offset: at(t.release), transform: tf(dx, dy, s * 0.93), opacity: 1, easing: 'ease-in' },
    // Absorbed.
    { offset: 1, transform: tf(dx, dy, s * 0.72), opacity: 0 },
  ], { duration: total, fill: 'forwards' });
  // The text is not part of what lands: it fades as the art lifts.
  card.querySelectorAll('.anc-cardx-name, .anc-cardx-rulebar, .anc-cardx-rule').forEach((el) =>
    anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: Math.max(80, c.pickLiftMs + 40), easing: 'ease-out', fill: 'forwards' }));
  window.setTimeout(() => impactContact(hp, c, false), t.contact);
  window.setTimeout(() => impactRelease(id, hp, c, false), t.release);
  return t;
}

/** The ▶ Awaken demo and any pick with no flight: the impact alone, on the hero power, now. */
export function playPickImpactNow(id: AncientId): void {
  const c = getAncientsConfig();
  const reduced = prefersReducedMotion();
  const hp = hpBox();
  impactContact(hp, c, reduced);
  impactRelease(id, hp, c, reduced);
}

/** CONTACT: the seal cue and the light bloom on the hero power. */
function impactContact(hp: HpBox | null, c: AncientsFullConfig, reduced: boolean): void {
  playCue('pickSeal');
  if (reduced || !hp || c.impactFlash <= 0) return;
  const d = toStage(hp.w) * 2.6;
  const el = document.createElement('div');
  el.className = 'anc-impact-flash';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, { left: `${toStage(hp.x)}px`, top: `${toStage(hp.y)}px`, width: `${d}px`, height: `${d}px` });
  stageHost().appendChild(el);
  if (typeof el.animate !== 'function') { el.remove(); return; }
  const a = el.animate([
    // Born at full size, so it reads as a halo AROUND the card pressed on the power (the card sits above it).
    { opacity: c.impactFlash, transform: 'translate(-50%, -50%) scale(1)' },
    { opacity: 0, transform: 'translate(-50%, -50%) scale(1.3)' },
  ], { duration: c.impactFlashMs, easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'forwards' });
  a.onfinish = () => el.remove();
  a.oncancel = () => el.remove();
}

/** RELEASE: the burst, the board's shake + punch-zoom, the hero power's recoil. */
function impactRelease(id: AncientId, hp: HpBox | null, c: AncientsFullConfig, reduced: boolean): void {
  if (!hp) return;
  ancientPickBurst(ancientColor(id), { x: hp.x, y: hp.y }, reduced ? c.burstScale * 0.7 : c.burstScale, reduced ? 0.6 : 1);
  if (reduced) return;
  if (c.recoil > 0 && typeof hp.el.animate === 'function') {
    const r = c.recoil;
    hp.el.animate([
      { scale: '1' }, { scale: String(1 - r), offset: 0.22 }, { scale: String(1 + r * 0.35), offset: 0.6 }, { scale: '1' },
    ], { duration: Math.max(200, c.shakeMs + 40), easing: 'ease-out' });
  }
  boardShake(hp, c);
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
    if (typeof el.animate !== 'function') return;
    el.style.transformOrigin = origin;
    const a = el.animate(frames, { duration: c.shakeMs, easing: 'linear' });
    a.onfinish = () => { el.style.transformOrigin = ''; };
  });
}

/** Play the impact burst once, invisibly (alpha ~0), while the offer sits settled, so the real one has no first-play
 *  cost on the impact frame (measured 2026-09-27: a cold first play landed ~250 ms late in headless Chrome). */
export function warmPickBurst(): void {
  const hp = hpBox();
  if (hp) ancientPickBurst('#ffffff', { x: hp.x, y: hp.y }, 1, 1, 0.001); // not 0: a fully transparent container may be skipped, not drawn
}
