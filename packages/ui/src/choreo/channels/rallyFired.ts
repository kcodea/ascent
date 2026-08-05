/**
 * The RALLY-FIRED channel — which Rallies fired inside a moment, and between which pair of units.
 *
 * WHY THIS EXISTS RATHER THAN A PLAIN BINDING. Every Rally in the game is an `onAttack` trigger, and
 * `simulate.ts` emits the `rally` event immediately after the `attack` event that provoked it. `compileMoments`
 * ABSORBS that run into the attacker's wind-up (`absorbIntoWindup` in compile.ts), so a real Rally never
 * reaches the choreographer as a `rally`-KIND moment — it arrives inside an `attackExchange` one whose primary
 * event is the attack. The `fxDef` cue resolves ONE binding per moment off that primary, so it would have asked
 * for `attackExchange` at the attacker and anchored the def to the DEFENDER, not to the ally whose effect the
 * Rally actually fired. That is also why the `rally` kind binding sat unreachable — authored, committed, and
 * never once played (owner report 2026-08-04).
 *
 * So the scan is per EVENT, not per moment, and it carries BOTH ends: a Rally is genuinely two-ended (the
 * rallier → the ally it procs), which is the property that made it the odd one out in the binding table.
 *
 * COUNTED, exactly like `rubiedLandsIn` and for the same reason: a gilded Echohorn fires its target's Echo
 * twice (the `mul(self)` loop in `rallyProcLeftmostEcho`) and Elderhorn's Hunt grant stacks more procs on top.
 * Collapsing them would erase the multiplier at the signal, two layers before the animation — the defect that
 * once made a gilded Frenzied Excavator indistinguishable from an ungilded one.
 *
 * Pure, and deliberately so: it is the whole testable surface of this channel. `score.ts` holds the
 * scheduling, which needs a live Pixi renderer and cannot be tested here (no jsdom in this repo).
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface RallyFired {
  /** The unit whose Rally fired — the card whose binding decides what plays. */
  source: string;
  /** The ally whose effect it procced — where the def lands. */
  target: string;
  /** How many times this exact pair fired in this moment (gilded / Elderhorn multipliers). */
  count: number;
}

/**
 * Pair key separator. NUL is the right choice because it cannot occur in a uid, where a `-` or a space could
 * — but it is written as an ESCAPE and never as a literal control character in the source. A raw NUL byte
 * makes git treat the whole module as binary, at which point this file has no reviewable diff.
 */
const SEP = '\u0000';
const pairKey = (source: string, target: string): string => `${source}${SEP}${target}`;

export function ralliesFiredIn(moment: Moment, events: CombatEvent[]): RallyFired[] {
  const byPair = new Map<string, RallyFired>();
  const order: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'rally') continue;
    const key = pairKey(e.source, e.target);
    const cur = byPair.get(key);
    if (cur) cur.count += 1;
    else {
      byPair.set(key, { source: e.source, target: e.target, count: 1 });
      order.push(key);
    }
  }
  return order.map((k) => byPair.get(k)!);
}

/**
 * Between distinct rallier→ally PAIRS in a cascade — the `gap`. Matched to the Ruby cue's 100ms (see
 * `RUBY_GAP_MS`), which is the owner-tuned separation for "these are different recipients" at this board scale.
 * More than one pair in a single moment needs a board carrying two ralliers that swing in the same exchange, so
 * this is the rarer of the two numbers; the `beat` below is the one that does the visible work.
 */
export const RALLY_GAP_MS = 100;

/** Between repeats WITHIN one pair — the `beat`. Must stay clearly shorter than `gap` or the count is lost
 *  (docs/fx-vocabulary.md); the same 2:1 ratio the Ruby cascade uses. This is what makes a gilded Echohorn's
 *  double proc read as TWO detonations on that ally rather than one brighter one. */
export const RALLY_BEAT_MS = 50;
