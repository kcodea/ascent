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
 * Between distinct rallier→ally PAIRS in a cascade — the `gap`. Must stay clear of `RALLY_PROC_STRIDE_MS`,
 * or two pairs would interleave and "two minions rallied" would read as one minion rallying repeatedly.
 *
 * Effectively unreachable, and kept only because the cascade is written generically: every Rally is an
 * `onAttack` trigger and one exchange has one attacker, so a moment cannot contain two different ralliers.
 * Sized at 2× the stride to hold the ratio the vocabulary asks for rather than tuned by eye.
 */
export const RALLY_GAP_MS = 640;

/** The visual gap between one proc's sparkle and the NEXT proc's pulse. Owner-set 120 (2026-08-04, up from
 *  50): at 50 a gilded Echohorn's two procs read as one thicker detonation rather than two. */
export const RALLY_BEAT_MS = 120;

/**
 * How long the attacker's yellow Rally pulse gets to read BEFORE the sparkle fires at the ally.
 *
 * The owner's sequencing call (2026-08-04): *"the rally token should pulse, then the target link goes off
 * after."* Without it both land together — the lunge fires `onRallyPulse` at the top of the wind-up and this
 * cue fired at the moment's start — so the beat read as one event rather than as cause and effect.
 *
 * 200ms sits inside the wind-up's Rally hold (`RALLY_PAUSE_MS` in engine.ts), which is the window the lunge
 * deliberately opens so a Rally can be read before the strike. Deliberately NOT imported from engine.ts:
 * engine imports `score.ts`, so the dependency would close a cycle — if that pause is ever retuned by hand,
 * this number wants a look.
 */
export const RALLY_PULSE_READ_MS = 200;

/**
 * One proc's whole slot: its pulse, the beat the pulse needs to read, its sparkle, then the gap before the
 * next proc's pulse. This is the `beat` the cascade schedules on now.
 *
 * It grew from `RALLY_BEAT_MS` alone when the owner asked for the medallion to pulse ONCE PER PROC rather
 * than once for the whole Rally (2026-08-05). Before that a repeat only had to fit a sparkle; now it has to
 * fit a pulse→sparkle pair, so a proc costs the read time as well as the gap.
 */
export const RALLY_PROC_STRIDE_MS = RALLY_PULSE_READ_MS + RALLY_BEAT_MS;

/**
 * How many times `attackerUid` procced a Rally inside this moment — i.e. how many times its medallion will
 * pulse, and therefore how long the wind-up has to hold to fit them all.
 *
 * ONLY ECHOHORN can return more than 1 today, and that is a property of the sim rather than of this scan:
 * `rallyProcLeftmostEcho` logs its `rally` event INSIDE the repeat loop, while `rallyProcDeathrattle`
 * (Deathsayer) logs once OUTSIDE it — so a golden Deathsayer with two Sylus does six procs and still emits
 * a single event. If that inconsistency is ever settled the other way, Deathsayer inherits the multi-pulse
 * and the longer wind-up automatically, which is worth knowing before "fixing" it.
 */
export function rallyProcsFor(moment: Moment, events: CombatEvent[], attackerUid: string | null): number {
  if (attackerUid === null) return 0;
  let n = 0;
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e && e.type === 'rally' && e.source === attackerUid) n++;
  }
  return n;
}

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
