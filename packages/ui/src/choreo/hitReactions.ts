import { presentationPolicyFor, type CombatEvent } from '@game/core';

/**
 * HIT REACTIONS GET THEIR OWN BEAT, AT THE HIT (R-DEMON-DMG-BEATS-01, owner 2026-10-11), AND EVERY TRIGGER FIRE IS ITS
 * OWN TICK (R-DEMON-DMG-BEATS-02, owner 2026-10-13).
 *
 *   *"when a minion is buffed from dmg dealt by demons, it should have its beat happen in real time. for example,
 *   with gasket, when gasket winds up and rally procs, damaging the units it does, rad rachel's tendrils should go
 *   out THEN, before the gasket's attack goes off."* (2026-10-11)
 *
 *   *"every trigger of the effect should get its own beat, like every volley from fel spikes, every rally trigger
 *   from gasket. the buffs should per tick if possible."* (2026-10-13)
 *
 * A wave pass (Gasket's Rally, a Fel Spikes volley) is ONE moment: every event of the pass shares its wave id. The
 * reactions its hits fire (Rad Rachel / Ruinous Lord / Impossible Todd buffing on a Demon's landed hit, Rune of Ruins)
 * carry that id too, and `deferClashBuffs` has slid every one of them (buffs AND the auras / rune pulses / hand buffs
 * they emit, see `isReactionTailEvent`) to the pass's tail. This returns where that tail starts so the compiler can
 * make it its own `buffWave` moment: the pass lands, THEN the reactions, THEN the next pass or the swing.
 *
 * 2026-10-13: the tail used to be recognised as trailing `buff` events only. Impossible Todd's Imp aura (`tribeAura`)
 * and Rune of Ruins' pulse (`questTrigger`) fire on every hit too, so the tail was never pure buffs and the reactions
 * folded back into the pass: no tendril, no roll, the held numbers snapped in at the next beat (the "instant chunks").
 *
 * Presentation only: a contiguous split of a slice the replay already reordered, so the folded frame at the end of the
 * pass is unchanged. Returns -1 when nothing splits.
 */
export function hitReactionStart(events: readonly CombatEvent[], start: number, end: number): number {
  let j = end;
  while (j > start && isReactionTailEvent(events[j - 1]!)) j--;
  if (j === end || j === start) return -1; // no trailing reactions, or no hit in front of them
  for (let k = j; k < end; k++) {
    const e = events[k]!;
    if (e.type === 'buff' && e.key !== undefined && presentationPolicyFor(e.key)?.policy === 'ownBeat') return j;
  }
  return -1;
}

/**
 * The HIT side of a wave pass: what the volley itself did (damage, Ward pops, deaths, the bodies those deaths or a
 * Pummel payout summon, a keyword the hit stripped). Everything else in a pass is something a REACTION emitted (a buff,
 * a Todd Imp aura, a Rune of Ruins pulse, a hand buff, an improve) and belongs to the reaction tail. Listed here rather
 * than imported from `combatBeats.ts` (which imports this module) so there is no import cycle: it is `RESULT_TYPES`
 * plus the action and arrival types.
 */
const HIT_SIDE = new Set<CombatEvent['type']>([
  'dmg', 'shield', 'wardDowngrade', 'shieldUp', 'poison', 'venomLost', 'death', 'keyword', 'pummelTrigger',
  'summon', 'reborn', 'attack', 'rally', 'shout', 'sc',
]);

/** Does `e` belong to a pass's REACTION tail (as opposed to the volley itself)? See `HIT_SIDE`. */
export function isReactionTailEvent(e: CombatEvent): boolean {
  return !HIT_SIDE.has(e.type);
}

/** Base-speed (1x) gap between a pass landing and its reaction beat starting: the hit reads first. */
export const HIT_REACTION_LEAD_MS = 200;

/** Base-speed (1x) minimum the LAST tick of a reaction chain stays on screen before the next beat (the next pass, the
 *  parked swing's strike, the next attack): the tendril's flight (`tendril-trail-<tribe>`, 210 ms) plus enough of the
 *  badge roll that the new numbers are visibly landing before anything else moves. A one-tick chain holds exactly this. */
export const HIT_REACTION_READ_MS = 640;

/**
 * THE TICK: one trigger fire's slot in a chain (owner 2026-10-13: "160 ms per tick, ~1.6 s cap per chain ... we can
 * try that and adjust if needed"). THE one place to tune both. A chain of `n` fires plays one fire every
 * `REACTION_TICK_MS`, compressed so the whole chain (first tick to last) never spans more than `REACTION_CHAIN_CAP_MS`.
 * Read by the beat clock (`holdMs`), the Fel Spikes spike schedule and volley hold (`useCombatReplay`), and the FX/roll
 * scheduler, all through `reactionTickStrideMs` / `reactionChainMs`, so they can never disagree.
 */
export const REACTION_TICK_MS = 160;
export const REACTION_CHAIN_CAP_MS = 1600;

/** Base-speed (1x) spacing between consecutive ticks of an `n`-tick chain. */
export function reactionTickStrideMs(n: number): number {
  if (n <= 1) return 0;
  return Math.min(REACTION_TICK_MS, REACTION_CHAIN_CAP_MS / (n - 1));
}

/** Base-speed (1x) time a chain of `n` ticks keeps the stage: the last tick starts `(n - 1) x stride` in and then reads
 *  for `HIT_REACTION_READ_MS`. `n <= 1` is the single-beat read exactly as before the chain existed. */
export function reactionChainMs(n: number): number {
  return Math.max(0, n - 1) * reactionTickStrideMs(n) + HIT_REACTION_READ_MS;
}

/** One trigger fire round's slice of a moment: a contiguous event range (its buffs and whatever else it emitted). */
export interface ReactionTick { start: number; end: number }

/**
 * Split a reaction run (`[start, end)`, already contiguous) into its TICKS, one per trigger-fire round. The UI derives
 * fires from the log alone (no engine stamp): a FIRE is a run of `buff` events sharing (effect key, source) whose
 * targets do not repeat; a TICK is one round of fires, and a new one starts the moment a fire identity that already
 * fired in the current tick fires again (the engine emits each hit's reactions in the same reactor order: hit 1 →
 * Rachel, Lord; hit 2 → Rachel, Lord; ...), or the same fire hits a target it already hit (a repeat). Non-buff events
 * (a Todd aura, a rune pulse) ride the tick they fall in. A run with no buffs is one tick.
 */
export function reactionTicks(events: readonly CombatEvent[], start: number, end: number): ReactionTick[] {
  const ticks: ReactionTick[] = [];
  let tickStart = start;
  let fired = new Set<string>();
  let curId: string | null = null;
  let curTargets = new Set<string>();
  for (let i = start; i < end; i++) {
    const e = events[i]!;
    if (e.type !== 'buff') continue;
    const id = `${e.key ?? ''}|${e.source}`;
    if (id === curId && !curTargets.has(e.target)) { curTargets.add(e.target); continue; }
    // A new fire. The same identity again (a repeat) or one this tick already had → the next tick starts here.
    if (fired.has(id) && i > tickStart) {
      ticks.push({ start: tickStart, end: i });
      tickStart = i;
      fired = new Set<string>();
    }
    curId = id;
    curTargets = new Set([e.target]);
    fired.add(id);
  }
  ticks.push({ start: tickStart, end });
  return ticks;
}

/** May a moment's buffs play as a per-fire chain? A SPELL's buffs never do: Dragonflame's presentation is the
 *  reference the owner called "perfect already" (2026-10-13), so a cast keeps its one-shot authored column. A Ruby is
 *  told by its gem cascade (`rubyFx`), not by tendrils. */
export function chainEligible(events: readonly CombatEvent[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const e = events[i]!;
    if (e.type === 'buff' && (e.spellId !== undefined || e.ruby)) return false;
  }
  return true;
}

/** How many ticks a moment's reaction run plays as (1 when it is not a chain). */
export function chainTickCount(events: readonly CombatEvent[], start: number, end: number): number {
  return chainEligible(events, start, end) ? reactionTicks(events, start, end).length : 1;
}

/** Particles one stock buff tendril spawns (`tendril-trail*.json`: a 72-shard and a 136-shard burst) and how long it
 *  stays on screen (the def's `duration`, ~0.9-1.07 s). Pinned rather than read from the def so this stays pure. */
const TENDRIL_PARTICLES = 208;
const TENDRIL_LIFE_MS = 1070;
/** How many tendril RIBBONS a chain may keep alive at once. A ribbon is a shader mesh, so its cost is per ribbon, not
 *  per particle; this is about what one summed reaction beat drew before the chain existed (a Gilded 7v7 pass with
 *  Rachel + the Lord drew 8-11). Measured 2026-10-13 (devlog): ribbons on every tick of a 7-tick x 10-tendril Gasket
 *  chain doubled the FX tick (mean 0.76 → 1.6 ms) and put ticks over 6.25 ms; inside this budget it stays as before. */
export const CHAIN_RIBBON_BUDGET = 12;
/** The live-particle budget for a chain's tendril bursts (same reasoning, about one summed beat's load). */
export const CHAIN_PARTICLE_BUDGET = 2400;

export interface ChainTendrilPlan {
  /** Draw tendrils on EVERY tick (true), or only on the first (false: the first tick shows who each reactor buffs,
   *  later ticks are told by their badge steps alone). */
  everyTick: boolean;
  /** Burst `intensity` (0.1..1) for every tendril the chain draws; ribbons are never thinned. */
  intensity: number;
}

/**
 * PURE: how a chain whose ticks draw `castsPerTick` tendrils each, `strideMs` (1x) apart, draws them inside the perf
 * bar (>160 fps at all times). Every tick gets its tendrils when the ribbons alive at once fit `CHAIN_RIBBON_BUDGET`
 * (a cleaving Demon's 3 hits, a gilded Echohorn's 2 procs, a small pass); a wide pass draws its full fan on the first
 * tick only and steps the numbers per tick. Bursts are thinned to `CHAIN_PARTICLE_BUDGET` either way.
 */
export function chainTendrilPlan(castsPerTick: readonly number[], strideMs: number): ChainTendrilPlan {
  const widest = Math.max(0, ...castsPerTick);
  if (widest === 0 || castsPerTick.length <= 1) return { everyTick: true, intensity: 1 };
  const alive = strideMs > 0 ? Math.min(castsPerTick.length, Math.ceil(TENDRIL_LIFE_MS / strideMs)) : castsPerTick.length;
  const everyTick = widest * alive <= CHAIN_RIBBON_BUDGET;
  const drawnAlive = everyTick ? widest * alive : widest;
  return { everyTick, intensity: Math.max(0.1, Math.min(1, CHAIN_PARTICLE_BUDGET / (TENDRIL_PARTICLES * drawnAlive))) };
}
