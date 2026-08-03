/**
 * The RUBY-LANDED channel — which units had a Ruby played on them inside a moment, for the `rubied` fan-out.
 *
 * A Ruby reaches the combat log as an ordinary `buff` event: `applyRubyStats` routes through the same
 * `ctx.buff` as every other stat gain, because mechanically it IS one. The only thing distinguishing it is the
 * `ruby` flag the engine now stamps on that event — presentation metadata, never read by the sim. Without the
 * flag a Ruby cue would have to bind to `buffWave` and would then fire on all forty-odd other buff sources.
 *
 * Order is EVENT ORDER, de-duplicated: a card that plays Rubies board-wide (Frenzied Excavator, Ruby
 * Excavation) emits one event per recipient, left to right, and the caller staggers the cue down that list so
 * the play reads as a sweep. A unit hit twice in one moment (a Resonance Idol bounce landing back on it) fires
 * COUNT times: a unit that took two Rubies gets two gems, played as a STACK before the sweep moves on.
 *
 * Pure, and deliberately so: it is the whole testable surface of this channel. `score.ts` holds the
 * scheduling, which needs a live Pixi renderer and cannot be tested here (no jsdom in this repo).
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface RubyLand { uid: string; count: number; }

export function rubiedLandsIn(moment: Moment, events: CombatEvent[]): RubyLand[] {
  const byUid = new Map<string, RubyLand>();
  const order: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff' || e.ruby !== true) continue;
    const cur = byUid.get(e.target);
    // COUNTED, not collapsed. This used to fire once per unit however many Rubies landed, which made a gilded
    // Frenzied Excavator (two per minion) look identical to an ungilded one — the doubling silently erased at
    // the signal, two layers before the animation. Two Rubies on a body is two gems: see docs/fx-vocabulary.md,
    // a multiplier is a STACK. (A Resonance Idol bounce lands a genuine second Ruby too, and equally deserves
    // its second gem — the old comment here called that noise, and it was wrong.)
    if (cur) cur.count += 1;
    else { byUid.set(e.target, { uid: e.target, count: 1 }); order.push(e.target); }
  }
  return order.map((k) => byUid.get(k)!);
}

/**
 * Between RECIPIENTS in a cascade — the `gap`. Owner-set 100ms (2026-08-02), raised from 60 to leave room for
 * a legible `beat` beneath it: at 60 there was no separation left to spend on the stack.
 *
 * It also does the job the stagger existed for at minimum — keeping a seven-minion play from landing seven
 * 220-particle bursts inside one frame.
 *
 * Both numbers belong to the COMPOSITION rather than to the code: how much separation the eye needs depends on
 * how front-loaded the def is. If they ever need to differ per effect they should become binding fields.
 */
export const RUBY_GAP_MS = 100;

/** Between hits WITHIN one recipient's stack — the `beat`. Must stay clearly shorter than `gap`, or a cascade
 *  of 2-stacks reads as one long cascade of unrelated hits and the count is lost; that 2:1 ratio IS the
 *  information (docs/fx-vocabulary.md). Owner-set 2026-08-02: gap 100, beat 50. */
export const RUBY_BEAT_MS = 50;

/**
 * The def both call sites play — deliberately duplicated as a STRING LITERAL at each one rather than imported
 * from here, and this constant is documentation of that fact rather than the source of it.
 *
 * `directCalls.ts` builds the FX library's "played from code" map by scanning for a quoted id in the play call
 * (and that scan reads comments too, which is why this sentence describes the pattern instead of showing it); an id
 * reached through a constant is invisible to that scan and lands in the dynamic blind-spot list, where the def
 * renders as inert even though it plays constantly. Two literals that CI checks beat one constant it cannot
 * see. It is not in `bindings.json` because `kinds` holds one binding per moment kind and both kinds a Ruby
 * surfaces in (`buffWave`, `attackExchange`) already spend theirs on the self-buff cue.
 */
export const RUBY_LANDED_DEF = 'ruby-gem-apply';
