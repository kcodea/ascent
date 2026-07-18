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
  | 'keyword' | 'keywordLost' | 'hpGrant' | 'spellProgress' | 'reveal'
  | 'trigger';

/**
 * EXHAUSTIVE event→kind map (2026-07-18 pacing audit): `Record<CombatEvent['type'], …>` so adding a new
 * event type to the `CombatEvent` union WITHOUT deciding its presentation kind is a COMPILE ERROR — the
 * old switch's `default: 'damage'` silently gave new mechanics accidental pacing. `death` is refined to
 * `riseDeath` by the `rise` flag in `momentKind` below.
 */
const EVENT_KIND: Record<CombatEvent['type'], MomentKind> = {
  attack: 'attackExchange',
  dmg: 'damage',
  shield: 'shieldPop', shieldUp: 'shieldPop',
  poison: 'poisonTick', venomLost: 'poisonTick',
  death: 'death',
  sc: 'scCast',
  summon: 'summon',
  buff: 'buffWave',
  reborn: 'reborn',
  ascend: 'ascend',
  rally: 'rally',
  toHand: 'toHand',
  maxGold: 'maxGold',
  improve: 'improve',
  keyword: 'keyword',
  keywordLost: 'keywordLost', // Tauntbreaker strips Taunt/Rise — was unhandled → "cues is not iterable" crash
  hpGrant: 'hpGrant',
  spellProgress: 'spellProgress', // Archmagus Guel's on-board spell tally tick
  reveal: 'reveal',
  questTrigger: 'trigger', questComplete: 'trigger', // quest/rune badge pulses — their own (tunable) kind
};

export function momentKind(primary: CombatEvent): MomentKind {
  if (primary.type === 'death') return primary.rise ? 'riseDeath' : 'death';
  // Legacy saved replays could carry an event type this build no longer knows — quiet damage-style beat.
  return EVENT_KIND[primary.type] ?? 'damage';
}
