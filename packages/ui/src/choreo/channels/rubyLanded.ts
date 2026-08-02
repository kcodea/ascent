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
 * ONCE — two detonations on the same card at the same instant is noise, not information.
 *
 * Pure, and deliberately so: it is the whole testable surface of this channel. `score.ts` holds the
 * scheduling, which needs a live Pixi renderer and cannot be tested here (no jsdom in this repo).
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export function rubiedUidsIn(moment: Moment, events: CombatEvent[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff' || e.ruby !== true) continue;
    if (seen.has(e.target)) continue;
    seen.add(e.target);
    order.push(e.target);
  }
  return order;
}

/**
 * Milliseconds between successive detonations in a board-wide play. Owner ruling 2026-08-01: mass Ruby plays
 * read as a sweep, not a single flash.
 *
 * Briefly raised to 130ms when the sweep didn't read, then returned to 60 on the owner's call (2026-08-02)
 * once the def's own layer timings moved — the separation the eye wants depends on how front-loaded the
 * effect is, so this number belongs to the composition, not to the code. If it ever needs to differ per
 * effect it should become a `stagger` field on the binding rather than a constant edited here.
 *
 * 60ms still does the job the stagger exists for at minimum: it keeps a seven-minion play from landing seven
 * 220-particle bursts inside one frame.
 */
export const RUBY_STAGGER_MS = 60;

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
