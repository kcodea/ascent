/**
 * Effect-magnitude estimation for the balance bots (owner ask 2026-07-21 — "make better decisions, don't
 * default to random"). A card's KEYWORDS and stats were valued before; its EFFECTS were a flat nudge, so the
 * bot couldn't tell a +5/+5 Deathrattle from a +1/+1 one. This reads the effect params into a rough output
 * value, weighted by how often the trigger fires, so buys / Discover / Choose-One / quest picks all sharpen.
 *
 * Deliberately a heuristic over the param shapes (attack/health/count/tier/amount/…) — not a per-factory
 * model. It only needs to RANK options, and "bigger numbers, recurring triggers = more value" gets that right
 * far more often than a flat constant. Pure + deterministic.
 */
import type { EffectDef } from '@game/core';

/** How much a trigger multiplies an effect's worth: a recurring trigger (rally each attack, End of Turn each
 *  turn) is worth more than a one-shot Battlecry; a Deathrattle is a touch above a Battlecry (it fires on a
 *  death you often engineer). */
function triggerWeight(on: string): number {
  switch (on) {
    case 'onAttack': return 1.8;      // Rally — fires every time this attacks
    case 'endOfTurn': return 1.8;     // recurs every recruit turn
    case 'startOfCombat': return 1.3;
    case 'onKill': return 1.4;        // Slaughter
    case 'onDeath': return 1.2;       // Deathrattle / Echo
    case 'avenge': return 1.3;
    default: return 1;                // onPlay / Battlecry / Shout — one-shot
  }
}

/** The rough output magnitude of a single effect from its numeric params. */
function paramMagnitude(effect: EffectDef): number {
  const p = (effect.params ?? {}) as Record<string, number | undefined>;
  let m = 0;
  m += (p.attack ?? 0) + (p.health ?? 0);   // a stat grant (per target)
  m += (p.amount ?? 0);                       // a generic magnitude (buffs, damage, gold)
  m += (p.count ?? 0) * 2.5;                  // summons / multi-target — each ~a small body
  m += (p.tier ?? 0) * 1.5;                   // Discover / gain of a tier-N card
  m += (p.step ?? 0) * 1.5;                   // per-trigger improvement — scales over a game
  // A summon/discover/gain with no numbers still does SOMETHING — floor it so it isn't scored as zero.
  if (m === 0) m = 2;
  return m;
}

/** The total estimated value of a list of effects (trigger-weighted). Used for the effect term of a card's
 *  score and for ranking Discover / Choose-One options. */
export function effectsValue(effects: readonly EffectDef[]): number {
  let v = 0;
  for (const e of effects) v += paramMagnitude(e) * triggerWeight(e.on);
  return v;
}
