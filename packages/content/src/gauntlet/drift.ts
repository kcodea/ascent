import { CARD_INDEX } from '../index';
import { cardRevision } from '../revisions';
import type { GauntletStage } from './types';

export interface GauntletDrift { round: number; index: number; cardId: string }

/** Minions whose card definition changed since the board was saved (their `cardVersion` no longer matches).
 *  Informational — the Stage Builder and Doc Bot surface it; it never fails CI. Unknown cards are
 *  `validateStage`'s job, not this one's. */
export function stageDrift(stage: GauntletStage): GauntletDrift[] {
  const out: GauntletDrift[] = [];
  stage.rounds.forEach((r, i) => r.board.forEach((m, index) => {
    const def = CARD_INDEX[m.cardId];
    if (def && cardRevision(def) !== m.cardVersion) out.push({ round: i + 1, index, cardId: m.cardId });
  }));
  return out;
}
