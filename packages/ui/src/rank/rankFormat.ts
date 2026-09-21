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

/** "76 / 100", or the uncapped "130 RP" at Ascendant I. */
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
    ? 'Promotion game ready — finish 1st to advance'
    : 'Promotion game ready — finish top 4 to advance';
}

/** The primary delta line: the ACTUAL movement, and the floor reading when nothing could be lost. A WON
 *  promotion is the one case that prints the finish's base award instead: the owner's rule lands the new
 *  division at 0 / 100, so the "actual" scalar movement is 0 — and a big "0 RP" over a promotion reads as a
 *  bug, not a rule. The detail line beneath states the reset in words. */
export function deltaText(r: RankResult): string {
  if (r.promoted) return signedRp(r.baseDelta);
  const floored = r.appliedDelta === 0 && r.baseDelta < 0 && r.after.divisionIndex === 0 && r.after.points === 0;
  if (floored) return '0 RP · Bronze floor';
  return signedRp(r.appliedDelta);
}

/** A secondary detail when the award was capped/floored ("base +40 · capped at the gate") or a promotion
 *  reset the bar ("promotion — Gold I starts at 0 / 100"), else null. */
export function cappedDetail(r: RankResult): string | null {
  if (r.promoted) return `promotion — ${rankLabel(r.after)} starts at ${pointsText(r.after)}`;
  if (r.appliedDelta === r.baseDelta) return null;
  if (r.baseDelta > 0) return `base ${signedRp(r.baseDelta)} · capped at the gate`;
  if (r.after.divisionIndex === 0 && r.after.points === 0) return `base ${signedRp(r.baseDelta)} · Bronze floor`;
  return `base ${signedRp(r.baseDelta)}`;
}

/** The resolve-beat outcome line (null when nothing beyond the delta happened). */
export function outcomeText(r: RankResult): string | null {
  if (r.promoted) return `Promoted to ${rankLabel(r.after)}`;
  if (r.demoted) return `Demoted to ${rankLabel(r.after)}`;
  if (r.promotionUnlocked) return gateText(r.after);
  if (r.wasPromotionGame && !r.promoted) {
    // A failed promotion — factual (blueprint §7: no punitive spectacle). Still on the gate if the loss was
    // absorbed; otherwise say where it retreated to.
    return isPromotionReady(r.after) ? 'Promotion unsuccessful — still promotion-ready' : 'Promotion unsuccessful';
  }
  if (isUncapped(r.after.divisionIndex)) return 'Ascendant I · uncapped';
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
  const outcome = outcomeText(r);
  return `${place}. ${deltaText(r)}. Now ${rankLabel(r.after)}, ${pointsText(r.after)}.${outcome ? ` ${outcome}.` : ''}`;
}

/** The fraction of a (capped) division bar a position fills — Ascendant I reads as full. */
export function barFraction(pos: RankPosition): number {
  if (isUncapped(pos.divisionIndex)) return 1;
  return Math.min(1, Math.max(0, pos.points / POINTS_PER_DIVISION));
}

/** The scalar as a small caption ("1076") for the Career card. */
export function scalarCaption(pos: RankPosition): string {
  return String(rankScalar(pos));
}
