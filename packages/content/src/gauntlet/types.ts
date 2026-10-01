import type { Keyword, Tribe } from '@game/core';

/** Rounds in every Gauntlet stage. */
export const GAUNTLET_ROUNDS = 10;
/** Most minions an authored board may hold (the game's board size). */
export const GAUNTLET_BOARD_MAX = 7;

/** `draft` stages are still being authored: the Gauntlet screen shows them as "Coming soon" and may hold empty
 *  boards. `ready` stages are playable and must field a board every round. */
export type GauntletStageStatus = 'draft' | 'ready';

/** One authored opponent minion. Stats are the authored line, not the card's printed stats. */
export interface GauntletMinion {
  cardId: string;
  attack: number;
  health: number;
  golden?: boolean;
  /** Keywords granted ON TOP of the card's printed keywords. */
  addedKeywords?: Keyword[];
  /** `cardRevision` of the card when this minion was saved — drives the "changed since saved" warning. */
  cardVersion: string;
}

export interface GauntletRound {
  /** Opponent tavern tier this round (1–6). Absent = `GAUNTLET_DEFAULT_TIERS` in @game/sim. */
  tier?: number;
  board: GauntletMinion[];
}

export interface GauntletStage {
  number: number;
  name: string;
  /** Shown on the in-run opponent portrait. */
  opponentName: string;
  /** The card whose art is the opponent's portrait (shop foe, combat, recap, "Now Facing"). Absent = the tribe emblem. */
  portraitCardId?: string;
  tribe?: Exclude<Tribe, 'neutral'>;
  status: GauntletStageStatus;
  runes: { round6?: string; round9?: string };
  /** Exactly `GAUNTLET_ROUNDS` entries; index = round − 1. */
  rounds: GauntletRound[];
}
