import type { CombatEvent } from '@game/core';

/**
 * Presentation KIND of a moment (choreographer phase 2) — a coarser label than the raw event type, keyed to
 * how the moment is authored/scored (see docs/combat-events.md + the spec's Score section). Derived from the
 * moment's PRIMARY (first) event. Purely additive metadata in phase 2: the clock still keys hold TIMES by the
 * primary event type for exact-reproduction; kinds become the hold key + score key in phases 3-4.
 */
export type MomentKind =
  | 'attackExchange'
  | 'impact'
  | 'death'
  | 'riseDeath'
  | 'scCast'
  | 'summon' | 'buffWave' | 'reborn' | 'ascend' | 'rally' | 'toHand' | 'maxGold' | 'improve'
  | 'keyword' | 'hpGrant' | 'reveal';

export function momentKind(primary: CombatEvent): MomentKind {
  switch (primary.type) {
    case 'attack': return 'attackExchange';
    case 'dmg': case 'shield': case 'shieldUp': case 'poison': case 'venomLost': return 'impact';
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
    case 'hpGrant': return 'hpGrant';
    case 'reveal': return 'reveal';
  }
}
