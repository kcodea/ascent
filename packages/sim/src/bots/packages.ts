/**
 * Synergy packages for the EXPLORER bot (owner ask 2026-07-21). A normal pilot converges on whatever wins;
 * the explorer instead COMMITS to one archetype for the whole run and builds toward it — so build-around
 * cards (Consume, Deathrattle chains, Mech attachments, Dragon spells) get piloted by something that actually
 * wants them, and stop reading as "0% pick, no data".
 *
 * "Tries new things" without RNG: the sim is deterministic, so variety comes from ACROSS games. The package
 * is chosen from the run's own active tribes, rotated by the run seed — so over a seeded sweep the explorer
 * pilots every archetype the game offers, one commitment per run.
 */
import type { RunState } from '../state';
import type { CardDef } from '@game/core';

export interface BotPackage {
  id: string;
  name: string;
  /** Extra score for a card that fits this package (0 if off-package). Big for the core tribe, medium for the
   *  archetype's enabler/payoff mechanic. */
  fits(def: CardDef): number;
}

/** The mechanic each tribe builds around — a card carrying it fits the package even off-tribe (a Fodder token
 *  feeds a Demon-Consume build; a Deathrattle body feeds Undead; a Magnetic part feeds Mech). */
const MECHANIC_BONUS: Record<string, (def: CardDef) => number> = {
  beast: () => 0, // Beast is simply go-wide — the tribe match carries it
  demon: (def) => (def.keywords.includes('CN') || def.keywords.includes('FD') ? 7 : 0), // Consume / Fodder
  undead: (def) => (def.effects.some((e) => e.on === 'onDeath') ? 7 : 0),               // Deathrattle / Echo
  mech: (def) => (def.keywords.includes('M') ? 7 : 0),                                   // Magnetic / Attachment
  dragon: (def) => (def.spell ? 6 : 0),                                                  // spell payoffs
};

/** Build the package for a target tribe: a strong bonus for on-tribe cards, plus the tribe's enabler mechanic. */
function packageFor(tribe: string): BotPackage {
  const mech = MECHANIC_BONUS[tribe] ?? (() => 0);
  return {
    id: `pkg_${tribe}`,
    name: `${tribe[0]!.toUpperCase()}${tribe.slice(1)} synergy`,
    fits: (def) => {
      let v = mech(def);
      if (def.tribe === tribe || def.tribe2 === tribe || def.universalTribe) v += 10;
      return v;
    },
  };
}

/**
 * The package the explorer commits to THIS run: one of the run's own active tribes, chosen by the run seed so
 * the choice is stable within a game and rotates across games. Falls back to a Beast package if a run somehow
 * has no tribes.
 */
export function pickPackage(state: RunState): BotPackage {
  const tribes = state.tribes.filter((t) => t !== 'neutral');
  if (tribes.length === 0) return packageFor('beast');
  return packageFor(tribes[state.seed % tribes.length]!);
}
