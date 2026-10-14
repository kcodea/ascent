import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { cascade, scheduleLands } from '../fx/land';
import { rubiedLandsIn, RUBY_BEAT_MS, RUBY_GAP_MS } from './channels/rubyLanded';
import { prefoldedShareOf } from './clashOrder';

/**
 * WHICH OF A MOMENT'S STAT CHANGES DOES A CUE DELIVER? (R-REALTIME-STATS-01, owner 2026-10-14)
 *
 *   *"can you make sure our buffs update in real time in combat? i believe ive seen some that dont, like veinstorm
 *   but im sure there are others."*
 *
 * The replay HOLDS every buffed unit's pre-beat number the moment its beat starts (the layout effect in
 * `useCombatReplay`), so the FX can deliver the change: a tendril or a self-buff pulse rolls it in on its strike.
 * Only three kinds of moment run a deliverer:
 *
 *   - `buffWave` / `shout`: the `buffCast` (tendril) and `buffSelf` (pulse) cues roll every NON-Ruby buff;
 *   - `attackExchange`: the wind-up rolls its absorbed buffs, Rubies included (`windupRubyUids`).
 *
 * Anything else was withheld with nobody to hand it over, and simply sat at the old number until the NEXT beat's
 * release-first pass (or the hold's TTL) snapped it in. That is the "updates late" the owner saw, in two shapes:
 *
 *   1. A RUBY in a buff wave or a Shout (an Avenge Gemstorm, a Shout that casts Rubies, a combat Veinstorm-style
 *      Ruby cast): the `rubyFx` cue plays the gem and CLAIMS the hold, but the authored `ruby-gem-apply` def carries
 *      no number, so nothing rolls it.
 *   2. A buff that rides a moment of another kind: a wave pass whose reactions are not split off (`damage` kind), a
 *      summon / death / narration moment that a buff trails inside the same wave.
 *
 * This returns those uids, so the replay can roll them on the moment's own clock (`AUTHORED_BUFF_ROLL_MS`, the same
 * lead the wind-up gives a Ruby). Pure and headless: `realtimeStatsAudit.test.ts` sweeps it over thousands of fights.
 */
export function undeliveredBuffUids(moment: Pick<Moment, 'start' | 'end' | 'kind' | 'ticks'>, events: readonly CombatEvent[]): string[] {
  if (moment.kind === 'attackExchange') return [];
  const cued = moment.kind === 'buffWave' || moment.kind === 'shout';
  // uid -> does a cue deliver at least one of its buffs this moment? (A unit with a Ruby AND a plain buff is rolled
  // whole by the plain buff's tendril: the hold is one delta for the whole beat.)
  const seen = new Map<string, boolean>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type !== 'buff') continue;
    const pre = prefoldedShareOf(e); // already on the badge (see `deferClashBuffs`): nothing is withheld for it
    if (pre === 'all' || (e.attack === 0 && (e.health === 0 || pre === 'health'))) continue;
    const delivered = cued && !e.ruby;
    seen.set(e.target, (seen.get(e.target) ?? false) || delivered);
  }
  const out: string[] = [];
  for (const [uid, delivered] of seen) if (!delivered) out.push(uid);
  return out;
}

/**
 * WHEN to roll each undelivered unit in (ms from the moment's start, already divided by the replay speed): a Ruby
 * on the gem's own land (the `rubyFx` cascade, first gem on that unit) plus the authored-buff lead, so the number
 * ticks as its gem bursts; anything else at the lead alone. One entry per uid, in log order.
 */
export function undeliveredRollPlan(
  moment: Pick<Moment, 'start' | 'end' | 'kind' | 'ticks'>,
  events: readonly CombatEvent[],
  speed: number,
  leadMs: number,
): { uid: string; atMs: number }[] {
  const uids = undeliveredBuffUids(moment, events);
  if (uids.length === 0) return [];
  const s = speed > 0 ? speed : 1;
  const firstLand = new Map<string, number>();
  for (const l of scheduleLands(cascade(rubiedLandsIn(moment as Moment, events as CombatEvent[])), { gap: RUBY_GAP_MS, beat: RUBY_BEAT_MS, speed: s })) {
    if (!firstLand.has(l.uid)) firstLand.set(l.uid, l.at);
  }
  return uids.map((uid) => ({ uid, atMs: (firstLand.get(uid) ?? 0) + leadMs / s }));
}
