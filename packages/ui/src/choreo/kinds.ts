import type { CombatEvent } from '@game/core';

/**
 * Presentation KIND of a moment (choreographer phase 2) — a coarser label than the raw event type, keyed to
 * how the moment is authored/scored (see docs/combat-events.md + the spec's Score section). Derived from the
 * moment's PRIMARY (first) event. Purely additive metadata in phase 2: the clock still keys hold TIMES by the
 * primary event type for exact-reproduction; kinds become the hold key + score key in phases 3-4.
 */
export type MomentKind =
  | 'attackExchange'
  | 'damage' | 'shieldPop' | 'poisonTick'
  | 'death'
  | 'riseDeath'
  | 'scCast'
  | 'summon' | 'buffWave' | 'reborn' | 'ascend' | 'rally' | 'toHand' | 'maxGold' | 'improve'
  | 'keyword' | 'keywordLost' | 'hpGrant' | 'spellProgress' | 'reveal' | 'tribeAura';

export function momentKind(primary: CombatEvent): MomentKind {
  switch (primary.type) {
    case 'attack': return 'attackExchange';
    case 'dmg': return 'damage';
    case 'shield': case 'shieldUp': return 'shieldPop';
    case 'poison': case 'venomLost': return 'poisonTick';
    case 'death': return primary.rise ? 'riseDeath' : 'death';
    case 'sc': return 'scCast';
    case 'summon': return 'summon';
    case 'buff': return 'buffWave';
    case 'reborn': return 'reborn';
    case 'ascend': return 'ascend';
    case 'rally': return 'rally';
    case 'toHand': return 'toHand';
    case 'maxGold': return 'maxGold';
    case 'improve': return 'improve';
    case 'keyword': return 'keyword';
    case 'keywordLost': return 'keywordLost'; // Tauntbreaker strips Taunt/Rise — was unhandled → "cues is not iterable" crash
    case 'hpGrant': return 'hpGrant';
    case 'spellProgress': return 'spellProgress'; // Archmagus Guel's on-board spell tally tick
    case 'reveal': return 'reveal';
    case 'tribeAura': return 'tribeAura'; // a run-wide combat aura → the board aura-wash
    // Defensive: any future event type falls back to a quiet damage-style moment instead of crashing the replay
    // (momentKind must NEVER return undefined — `getScore()[undefined]` is not iterable).
    default: return 'damage';
  }
}
