import type { Container } from 'pixi.js';
import type { FormationData } from './damageFormation';
import type { FormationConfig } from './formationConfig';
import type { Pt } from './easing';

/**
 * What every hero attack runner takes (every style shares it, so `Recruit.tsx`, the tuners and the Collection
 * sandbox call either the same way). The total and the blow are handed in, already decided by the engine; a runner
 * only decides WHEN on screen they happen.
 */
export interface HeroAttackOptions {
  /** What the shared damage formation builds on screen before the attack (every number the engine's). */
  formation: FormationData;
  /** The formation's tuned values (default: the shared config). Tests and tuners pass their own. */
  formationCfg?: FormationConfig;
  /** THE blow, as the engine decided it. */
  total: number;
  /**
   * The blow KNOCKS THE STRUCK PLAYER OUT (owner ask 2026-09-29): the attack always plays its Tier IV ("Huge")
   * version, whatever `total` is. Read off the engine's state by `heroStrikeKnockout`; every style's plan takes its
   * tier from `attackTier` (`tiers.ts`), which applies it. The number shown and the consequence are unchanged.
   */
  knockout?: boolean;
  /** Whose blow: sets the colour language (yours gold, theirs red). */
  side?: 'player' | 'opp';
  /** Centres of the striking and the struck hero (screen px, or host px in `local` space). */
  attacker: Pt;
  defender: Pt;
  /** The struck portrait's radius (the hit flash covers it). */
  defenderRadius?: number;
  /** The striking portrait's radius (default: the struck one's). */
  attackerRadius?: number;
  /** Playback speed (combat speed x the tuner's slow motion). */
  speed?: number;
  reduced?: boolean;
  /** The consequence: fired exactly once, on the impact beat (or by `finish()` if it never got there). */
  onImpact: () => void;
  /** The sequence is over (not fired by `cancel()`). */
  onDone?: () => void;
  /** The portraits (transform only; restored after). */
  attackerEl?: HTMLElement | null;
  defenderEl?: HTMLElement | null;
  // ── seams (tests, the Collection sandbox) ──
  frames?: (fn: (dtMs: number) => void) => () => void;
  mount?: (c: Container) => () => void;
  host?: HTMLElement | null;
  camera?: HTMLElement | null;
  sound?: boolean;
  safety?: boolean;
  /** `local`: every point is in the HOST's own px (a sandbox box), not screen px. */
  space?: 'screen' | 'local';
  /** Pixi size multiplier (default: the stage scale). A small sandbox box draws smaller. */
  pixiScale?: number;
}

/** What every hero attack runner returns. */
export interface HeroAttackHandle {
  /** Sequence ms elapsed (at speed; the clock never pauses). */
  elapsed(): number;
  readonly impacted: boolean;
  readonly done: boolean;
  /** Jump to the end: land the blow if it has not landed, clean up, fire onDone. */
  finish(): void;
  /** Stop and clean up WITHOUT landing (leaving the fight mid-sequence, as Classic's timers are cleared). */
  cancel(): void;
}
