/**
 * The BOUNCE channel — which cross-target RE-CASTS happened inside a moment, for the `ruby-bounce` /
 * `spell-bounce` ribbon (owner ask 2026-09-15).
 *
 * A bounce is a spell or Ruby that lands a SECOND time on a DIFFERENT body because of where the first cast
 * landed: Trouble's self-Ruby off a Ruby cast elsewhere, Candle Conduit's extra landing, a Resonance Idol /
 * Reflector spread. In combat it reaches the log as an ordinary `buff` event carrying `bounce` provenance —
 * `from` = the uid the ORIGINAL cast landed on, `kind` = which family — stamped by the engine exactly like the
 * `ruby` flag: presentation metadata the sim never reads. A same-target recast (Mirrorwing "casts again",
 * Resonance's extra Ruby on the same body) carries no `bounce` and never reaches this channel; the owner is
 * authoring a separate cue for those.
 *
 * Order is EVENT ORDER, grouped per (from → to) pair and COUNTED: a doubled hop (a gilded Trouble taking two
 * Rubies off one landing) is one group with count 2, which the caller walks as a STACK — two ribbons on that
 * pair before the sweep moves on — so the multiplier is visible at the signal (docs/fx-vocabulary.md).
 *
 * Pure, like `rubyLanded.ts`: the whole testable surface. `score.ts` holds the scheduling.
 */
import type { BounceKind, CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface BounceHop {
  /** The unit the ORIGINAL cast landed on — the ribbon's source. */
  from: string;
  /** The bounce recipient — the ribbon's target. */
  to: string;
  kind: BounceKind;
  /** How many times this exact hop fired in the moment. */
  count: number;
}

export function bouncesIn(moment: Moment, events: CombatEvent[]): BounceHop[] {
  const byKey = new Map<string, BounceHop>();
  const order: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff' || !e.bounce) continue;
    // The sim already drops same-body hops at the stamp; this guard is belt-and-braces for a hand-built log.
    if (e.bounce.from === e.target) continue;
    const key = `${e.bounce.kind}:${e.bounce.from}>${e.target}`;
    const cur = byKey.get(key);
    if (cur) cur.count += 1;
    else { byKey.set(key, { from: e.bounce.from, to: e.target, kind: e.bounce.kind, count: 1 }); order.push(key); }
  }
  return order.map((k) => byKey.get(k)!);
}

/** The def a hop plays. Two literals live at the play sites (see `directCalls.ts` on why a constant is not the
 *  source); this is the one place the kind → def rule is written down for tests. */
export const BOUNCE_DEF: Record<BounceKind, string> = { ruby: 'ruby-bounce', spell: 'spell-bounce' };
