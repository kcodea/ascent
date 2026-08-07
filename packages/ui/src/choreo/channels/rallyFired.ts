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
  /**
   * The uids each proc SUMMONED, indexed by proc order within this pair (so `delivered.length === count`).
   *
   * Carried so the sparkle can deliver them rather than trail them: the frame commits a summon the instant
   * the moment becomes current, which puts the cub on the board ahead of the effect that procced it (owner
   * report 2026-08-05). `fx/summonHold.ts` withholds these; the cue releases each proc's own litter on its
   * own land, so a gilded double proc shows one set per sparkle instead of both on the first.
   *
   * Empty for a proc that summoned nothing — most Echoes don't (a stat grant, a card to hand). An empty
   * array is not the same as "no proc", which is why this is per-proc rather than one flat list.
   */
  delivered: string[][];
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
    // What THIS proc summoned: the CONTIGUOUS run of `summon` events immediately after it. `deathrattleSummon`
    // runs synchronously inside the proc loop, so a proc's summons are adjacent to it in the log — and the
    // contiguity is what keeps the attribution honest. Anything else intervening ENDS the run, so an unrelated
    // on-attack summon later in the same wind-up is left unattributed rather than guessed onto this proc (it
    // would be withheld, and nothing would be scheduled to release it).
    const delivered: string[] = [];
    for (let j = i + 1; j < moment.end; j++) {
      const n = events[j];
      if (!n || n.type !== 'summon') break;
      delivered.push(n.minion.uid);
    }
    const key = pairKey(e.source, e.target);
    const cur = byPair.get(key);
    if (cur) { cur.count += 1; cur.delivered.push(delivered); }
    else {
      byPair.set(key, { source: e.source, target: e.target, count: 1, delivered: [delivered] });
      order.push(key);
    }
  }
  return order.map((k) => byPair.get(k)!);
}

/**
 * A rally-summoner's OWN on-attack summons in a moment — Errand Fiend's imps — attributed by the summon
 * event's `source`.
 *
 * The counterpart to `ralliesFiredIn`'s `delivered`, and DISJOINT from it by construction: `delivered` holds
 * a procced ALLY's Echo summons (whose `source` is that ally), while these are the attacker summoning
 * DIRECTLY on its own swing (`source === attacker`). So a unit that both Rallies an ally and summons on
 * attack keeps each set on its own release, and neither path ever withholds the other's units.
 *
 * Presentation-only, exactly like the rally cubs: the summon has already happened in the sim: this only
 * decides which uids the frame withholds so they can arrive AFTER the attacker's yellow Rally pulse instead
 * of at the top of the wind-up (owner ask 2026-08-06). No `rally` event is involved — that event means
 * "a Rally triggered an ally's Echo", which an on-attack summoner does not do, so emitting one would print a
 * false "triggers its own Echo" line in the floats, procs tab and contribution tally.
 */
export function attackSummonUids(moment: Moment, events: CombatEvent[], attacker: string): string[] {
  const out: string[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type === 'summon' && e.source === attacker) out.push(e.minion.uid);
  }
  return out;
}

/**
 * Between distinct rallier→ally PAIRS in a cascade — the `gap`.
 *
 * 240, which is NOT the Ruby cue's 100: it is derived from the `beat` below rather than chosen, because the
 * 2:1 ratio is what carries the count (docs/fx-vocabulary.md, and `beatExceedsGap` in fx/land.ts reports the
 * violation). The owner raised the beat to 120 on 2026-08-04 after watching a gilded Echohorn, so the gap had
 * to move with it — at the old 100 the beat would have EXCEEDED the gap and a cascade of 2-stacks would read
 * as one long cascade of unrelated hits.
 *
 * More than one pair in a single moment needs a board carrying two ralliers that swing in the same exchange,
 * so this is the rarer of the two numbers; the `beat` is the one that does the visible work.
 */
export const RALLY_GAP_MS = 240;

/** Between repeats WITHIN one pair — the `beat`. Owner-set 120 (2026-08-04, up from 50): at 50 a gilded
 *  Echohorn's two procs read as one thicker detonation rather than two, which is exactly the count this
 *  spacing exists to preserve. Must stay clearly shorter than `gap` — see the note there. */
export const RALLY_BEAT_MS = 120;

/**
 * How long the attacker's yellow Rally pulse gets to read BEFORE the sparkle fires at the ally.
 *
 * The owner's sequencing call (2026-08-04): *"the rally token should pulse, then the target link goes off
 * after."* Without it both land together — the lunge fires `onRallyPulse` at the top of the wind-up and this
 * cue fired at the moment's start — so the beat read as one event rather than as cause and effect.
 *
 * 200ms sits inside the wind-up's 440ms Rally hold (`RALLY_PAUSE_MS` in engine.ts), which is the window the
 * lunge deliberately opens so a Rally can be read before the strike. That leaves ~240ms of hold after the
 * sparkle starts and before contact, so the whole exchange still reads as one beat. Deliberately NOT imported
 * from engine.ts: engine imports `score.ts`, so the dependency would close a cycle — if that 440 is ever
 * retuned, this number wants a look.
 */
export const RALLY_PULSE_READ_MS = 200;

/**
 * When the first sparkle lands, measured from the moment's start.
 *
 * Takes the wind-up duration as an ARGUMENT rather than reading `lungeConfig` itself, so this module stays
 * pure and testable (the repo has no jsdom) — and so the value tracks the LIVE wind-up, which is tunable at
 * runtime, instead of being frozen into the static score table at module load.
 */
export function rallyLeadMs(windupDurSec: number): number {
  return windupDurSec * 1000 + RALLY_PULSE_READ_MS;
}
