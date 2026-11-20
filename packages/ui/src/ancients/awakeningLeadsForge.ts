/**
 * THE AWAKENING LEADS THE RUNEFORGE (owner 2026-11-19, R-ANCIENT-ORDER-01): when the fight that opens a rune turn
 * fills the meter, the Ancient reveal plays BEFORE the rune select. Presentation only: which of the two the screen
 * shows first. The reducer's half is `ancientLeadsRuneforge` (the pick is answerable through the open forge).
 */
import { ancientLeadsRuneforge, type RunState } from '@game/sim';
import { useAwakenStage, type AwakenStage } from './ancientsFx';

type Decisions = Pick<RunState, 'discover' | 'questOffer' | 'powerOffer' | 'runeforgeOffer' | 'pendingTarget' | 'chooseOne' | 'scoutedNextOpponent'>;

/** The awakening (gate + offer) waits for this decision: any other open one, except a forge it leads. */
export function awakeningWaits(run: RunState): boolean {
  const d: Decisions = run;
  if (d.discover || d.questOffer || d.powerOffer || d.pendingTarget || d.chooseOne || d.scoutedNextOpponent?.length) return true;
  return !!d.runeforgeOffer && !ancientLeadsRuneforge(run);
}

/** The Runeforge waits for the awakening: while the offer it follows is unanswered, then while the pick's close
 *  (the chosen card's slam into the hero power) is still playing. A tuner demo (a negative seq) never holds it. */
export function awakeningHoldsForge(run: RunState, stage: { stage: AwakenStage; seq: number }): boolean {
  if (!run.runeforgeOffer) return false;
  return ancientLeadsRuneforge(run) || (stage.seq > 0 && stage.stage !== 'idle');
}

export function useAwakeningHoldsForge(run: RunState): boolean {
  return awakeningHoldsForge(run, useAwakenStage());
}
