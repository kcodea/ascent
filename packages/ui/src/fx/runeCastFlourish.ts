/**
 * THE RUNE CAST FLOURISH (owner 2026-09-24, verbatim): *"yeah the runes that repeat casts should use the rune-cast
 * visual. can we do anything to add a bit of flair to this? like some sort of short flash/pixi effect/make it
 * smoother and cleaner with a bit of a 'magic' element to it? nothing crazy."*
 *
 * Every spell a RUNE casts (the Gilded Ledger / Spell Market / Recurrence family, and the repeat runes: Shared
 * Pour, Astral Draft, Distillation, Shared Reflection, Hoardflame, Dragon Breath, the Bottomless Cask) now reads
 * as the rune ACTIVATING and SENDING the spell out:
 *
 *   1. the rune's badge pulses (a Web Animations transform swell on `.questbadges .runebadge`: compositor-only,
 *      one-shot, no layout read beyond the one node measure the cast already makes);
 *   2. `rune-cast-flourish` plays on the node: a soft glyph flash, a thin sigil ring, a few diamond sparks;
 *   3. for a spell whose own effect plays ONCE somewhere (Growth on the board, a combat caster), `rune-cast-mote`
 *      travels from the node to that point (a thin comet with a little dust, a sparkle on arrival) and the spell's
 *      effect waits for it to land. A spell whose visual already TRAVELS from the node (a trail, an Ale's volley)
 *      gets no mote; its trails leave a short `leadMs` after the flash instead, so the rune visibly releases them.
 *
 * Both defs are ordinary workbench defs (fx/defs/*.json), so the owner can reshape them there. The timings and
 * sizes are knobs in the Cast Preview tuner's "Rune cast flourish" group (`castPreviewConfig.ts`).
 *
 * Cost: at most ~24 particles, one ribbon and two rings per cast, all pooled by the FX runtime; one
 * `getBoundingClientRect` per cast (the node), none per frame.
 */
import { getCastPreviewConfig, runeCastFlourishLook, type RuneCastFlourishLook } from '../castPreviewConfig';
import { canPlayDefs, playDef } from './playDef';

type Point = { x: number; y: number };

export const RUNE_CAST_FLOURISH_DEF = 'rune-cast-flourish';
export const RUNE_CAST_MOTE_DEF = 'rune-cast-mote';
/** The mote def's authored flight (its travel layers' `travelMs`); the tuner's `moteMs` rescales the play to it. */
export const RUNE_CAST_MOTE_AUTHORED_MS = 280;
/** A mote shorter than this has nowhere to go (the effect lands on the node itself): skip it. */
const MIN_MOTE_PX = 24;

/** The rune's badge on the rail (`data-source-id`), or null. The first match: a duplicated rune pulses its first copy. */
export function nodeOf(runeId: string): Element | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`.questbadges .runebadge[data-source-id="${runeId}"]`);
}

export function centreOf(el: Element | null): Point | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The badge swell: a transform-only Web Animation (compositor), one-shot. A no-op where WAAPI is missing (jsdom). */
export function pulseRuneBadge(el: Element | null, look: RuneCastFlourishLook = runeCastFlourishLook(getCastPreviewConfig())): boolean {
  if (!el || look.pulse <= 0 || look.pulseMs <= 0) return false;
  const anim = (el as HTMLElement).animate as HTMLElement['animate'] | undefined;
  if (typeof anim !== 'function') return false;
  const peak = 1 + look.pulse;
  anim.call(el, [
    { transform: 'scale(1)', offset: 0 },
    { transform: `scale(${peak})`, offset: 0.3, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
    { transform: 'scale(1)', offset: 1 },
  ], { duration: look.pulseMs, easing: 'ease-out' });
  return true;
}

export interface RuneCastFlourishPlay {
  /** Where the rune's node is (the spell's source), or null when the rune is not on screen. */
  node: Point | null;
  /** How long after the flourish starts the spell's own visual should start, ms. 0 = right away. */
  leadMs: number;
  /** True when a mote was launched (the spell's single effect should land at `aim`, after `leadMs`). */
  mote: boolean;
}

/**
 * Fire the flourish for ONE cast by `runeId`. `aim` is where the spell's own single effect lands (null = the spell's
 * visuals travel from the node themselves, or there are none). Returns where the node is and how long the caller
 * should hold the spell's visual so it reads as released by the rune. Off (or no node on screen): lead 0, nothing
 * played, so rune casts look exactly as they did before the flourish.
 */
export function playRuneCastFlourish(runeId: string, aim: Point | null = null): RuneCastFlourishPlay {
  const el = nodeOf(runeId);
  return playRuneCastFlourishAt(centreOf(el), el, aim);
}

/** The flourish from an explicit node point (and its badge element, when there is one to pulse). The tuner's
 *  "Preview test" uses it with a stand-in spot when no rune is on screen. */
export function playRuneCastFlourishAt(node: Point | null, el: Element | null, aim: Point | null = null): RuneCastFlourishPlay {
  const look = runeCastFlourishLook(getCastPreviewConfig());
  if (!node) return { node: null, leadMs: 0, mote: false };
  if (!look.on) return { node, leadMs: 0, mote: false };
  pulseRuneBadge(el, look);
  if (!canPlayDefs()) return { node, leadMs: 0, mote: false };
  const camera = typeof window === 'undefined' ? node : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  playDef('rune-cast-flourish', { source: node, target: node, cursor: node, camera }, { scale: look.flashSize });
  const far = aim !== null && Math.hypot(aim.x - node.x, aim.y - node.y) >= MIN_MOTE_PX;
  if (!far || !aim) return { node, leadMs: look.leadMs, mote: false };
  playDef('rune-cast-mote', { source: node, target: aim, cursor: node, camera }, {
    scale: look.moteSize,
    speed: RUNE_CAST_MOTE_AUTHORED_MS / Math.max(1, look.moteMs),
  });
  return { node, leadMs: look.moteMs, mote: true };
}

/** The per-moment repeat gap (Recurrence's "twice": two casts by one rune in one moment), from the tuner. */
export function runeCastRepeatGapMs(): number {
  return runeCastFlourishLook(getCastPreviewConfig()).repeatMs;
}

/** The trail-release lead for a rune's per-buff visuals (0 while the flourish is off). */
export function runeCastTrailLeadMs(): number {
  const look = runeCastFlourishLook(getCastPreviewConfig());
  return look.on ? look.leadMs : 0;
}

/** Run `fn` after `ms` (now when 0). Fire-and-forget, like every spell-cast visual: never blocks a beat. */
export function afterMs(ms: number, fn: () => void): void {
  if (ms <= 0) { fn(); return; }
  setTimeout(fn, ms);
}
