/**
 * The ONE rank-formatting helper (blueprint §8): every string a rank surface prints — the end screen, the
 * Title's Play card, Rankings rows, the Career card — comes from here, so no two surfaces can disagree about
 * an index → label, a points readout, or what a delta at a cap/floor says. Pure; no React, no store.
 */
import {
  isMedalGate, isPromotionReady, isUncapped, POINTS_PER_DIVISION, rankLabel, rankScalar,
  type RankPosition, type RankResult,
} from './types';

export { rankLabel, rankScalar } from './types';

/** "76 / 100", or the uncapped "130 RP" at Ascendant III. */
export function pointsText(pos: RankPosition): string {
  return isUncapped(pos.divisionIndex) ? `${pos.points} RP` : `${pos.points} / ${POINTS_PER_DIVISION}`;
}

/** A signed points delta: "+16 RP" / "−40 RP" / "0 RP". Uses a real minus sign. */
export function signedRp(n: number): string {
  if (n > 0) return `+${n} RP`;
  if (n < 0) return `−${Math.abs(n)} RP`;
  return '0 RP';
}

/** "VICTORY" for 1st, else the upper-case ordinal ("2ND", "3RD", "4TH"…). */
export function placementText(placement: number): string {
  if (placement === 1) return 'VICTORY';
  return ordinal(placement).toUpperCase();
}

/** 1st, 2nd, 3rd, 4th, 11th… */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** The gate line shown while a player sits on 100: which finish the NEXT rated game needs. */
export function gateText(pos: RankPosition): string {
  return isMedalGate(pos.divisionIndex)
    ? 'Promotion game ready. Finish 1st to advance.'
    : 'Promotion game ready. Finish top 4 to advance.';
}

/** The DEMOTION-gate line (owner 2026-09-20, every division since 2026-09-21): a loss that hit 0 makes the next
 *  rated game a demotion game — top 4 stays in the division, bottom 4 drops one division (out of the medal at a
 *  medal's lowest division). Names the DIVISION, which is what is at stake everywhere ("stay in Gold II"). */
export function demotionGateText(pos: RankPosition): string {
  return `Demotion game. Finish top 4 to stay in ${rankLabel(pos.divisionIndex)}.`;
}

/** The line a surface prints for a position on EITHER gate (`demotionReady` is the profile's STORED flag — a 0
 *  alone is ambiguous, since a division that was never lost from also reads 0, and is never derived). */
export function standingGateText(pos: RankPosition, demotionReady = false): string | null {
  if (isPromotionReady(pos)) return gateText(pos);
  if (demotionReady) return demotionGateText(pos);
  return null;
}

/** The primary delta line: the finish's award, signed (owner 2026-09-21: "just the +/- RP, the x/100, the bar
 *  and the rank"). No floor / cap / landing flavour: the bar and the points readout carry what actually moved.
 *  A 1st place that earned the LOBBY-STRENGTH bonus (owner 2026-09-22) prints the award and the bonus apart:
 *  "+40 RP +12 lobby". */
export function deltaText(r: RankResult): string {
  const bonus = r.strengthBonus ?? 0;
  return bonus > 0 ? `${signedRp(r.baseDelta - bonus)} +${bonus} lobby` : signedRp(r.baseDelta);
}

/** The resolve-beat outcome line — ONLY what the visuals don't already say (owner 2026-09-20). A promotion or
 *  demotion is told by the crest transition + the new label, so neither prints a line; the gate line stays
 *  (nothing else shows that the next game is a promotion game), as does a failed promotion (the retreat
 *  alone doesn't say it was one). Ascendant III's uncapped counter speaks for itself. */
export function outcomeText(r: RankResult): string | null {
  if (r.promoted || r.demoted) return null;
  if (r.promotionUnlocked) return gateText(r.after);
  // The rules' flag, never derived here: armed only by a loss that hit 0, in ANY division above Bronze I
  // (owner 2026-09-21; a promotion landing does NOT arm it). The line is the only thing that says the next
  // game is a demotion game.
  if (r.demotionUnlocked) return demotionGateText(r.after);
  if (r.wasPromotionGame && !r.promoted) {
    // Factual (blueprint §7: no punitive spectacle). Still on the gate if the loss was absorbed.
    return isPromotionReady(r.after) ? 'Promotion unsuccessful. Still promotion-ready.' : 'Promotion unsuccessful';
  }
  return null;
}

/** One sentence for the screen's live region, announced once when the sequence settles. */
export function announcement(placement: number, r: RankResult | null, submission: string): string {
  const place = placement === 1 ? 'Victory' : `Finished ${ordinal(placement)}`;
  if (!r) {
    if (submission === 'pending') return `${place}. Updating rank.`;
    if (submission === 'retryable') return `${place}. Rank update pending.`;
    if (submission === 'rejected') return `${place}. Rank update failed.`;
    return `${place}. Unrated.`;
  }
  // The live region is the one place a promotion / demotion is SAID — a screen reader can't see the crest change.
  const outcome = r.promoted ? `Promoted to ${rankLabel(r.after)}` : r.demoted ? `Demoted to ${rankLabel(r.after)}` : outcomeText(r)?.replace(/\.$/, '');
  return `${place}. ${deltaText(r)}. Now ${rankLabel(r.after)}, ${pointsText(r.after)}.${outcome ? ` ${outcome}.` : ''}`;
}

/** The fraction of a (capped) division bar a position fills — Ascendant III reads as full. */
export function barFraction(pos: RankPosition): number {
  if (isUncapped(pos.divisionIndex)) return 1;
  return Math.min(1, Math.max(0, pos.points / POINTS_PER_DIVISION));
}

/** The scalar as a small caption ("1076") for the Career card. */
export function scalarCaption(pos: RankPosition): string {
  return String(rankScalar(pos));
}
