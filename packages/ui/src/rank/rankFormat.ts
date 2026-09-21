/**
 * The ONE rank-formatting helper (blueprint §8): every string a rank surface prints — the end screen, the
 * Title's Play card, Rankings rows, the Career card — comes from here, so no two surfaces can disagree about
 * an index → label, a points readout, or what a delta at a cap/floor says. Pure; no React, no store.
 */
import {
  isMedalGate, isPromotionReady, isUncapped, medalOf, POINTS_PER_DIVISION, rankLabel, rankScalar,
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
    ? 'Promotion game ready. Finish 1st to advance.'
    : 'Promotion game ready. Finish top 4 to advance.';
}

/** The DEMOTION-gate line (owner 2026-09-20): a loss clamped at 0 on a medal floor makes the next rated game a
 *  demotion game — top 4 stays in the medal, bottom 4 drops to the previous medal's I. */
export function demotionGateText(pos: RankPosition): string {
  return `Demotion game. Finish top 4 to stay in ${medalOf(pos.divisionIndex)}.`;
}

/** The line a surface prints for a position on EITHER gate (`demotionReady` is the profile's STORED flag — a 0
 *  at a medal floor alone is ambiguous, since a won medal promotion also lands on 0, and is never derived). */
export function standingGateText(pos: RankPosition, demotionReady = false): string | null {
  if (isPromotionReady(pos)) return gateText(pos);
  if (demotionReady) return demotionGateText(pos);
  return null;
}

/** The primary delta line: the ACTUAL movement, and the floor reading when nothing could be lost. A WON
 *  promotion is the one case that prints the finish's base award instead: the owner's rule lands the new
 *  division at 10 / 100 (2026-09-21; it was 0), so the "actual" scalar movement is the +10 landing cushion
 *  whatever the finish — and a "+10 RP" over a 1st-place promotion reads as a bug, not a rule. The crest
 *  transition + new label + 10 / 100 say the rest (owner 2026-09-20). */
export function deltaText(r: RankResult): string {
  if (r.promoted) return signedRp(r.baseDelta);
  // A lost demotion game moves a whole medal (Gold III 0 → Silver I 60 is +60 on the scalar): print the
  // finish's award — the crest transition says the rest.
  if (r.demoted && r.wasDemotionGame) return signedRp(r.baseDelta);
  const floored = r.appliedDelta === 0 && r.baseDelta < 0 && r.after.divisionIndex === 0 && r.after.points === 0;
  if (floored) return '0 RP · Bronze floor';
  return signedRp(r.appliedDelta);
}

/** A secondary detail ONLY when the delta alone would mislead: the award was capped at the gate or floored
 *  ("base +40 RP · capped at the gate"). A promotion's landing needs no words — the new bar reads 10 / 100
 *  (owner 2026-09-20; landing 10 since 2026-09-21). */
export function cappedDetail(r: RankResult): string | null {
  if (r.promoted || (r.demoted && r.wasDemotionGame)) return null;
  if (r.appliedDelta === r.baseDelta) return null;
  if (r.baseDelta > 0) return `base ${signedRp(r.baseDelta)} · capped at the gate`;
  if (r.after.divisionIndex === 0 && r.after.points === 0) return `base ${signedRp(r.baseDelta)} · Bronze floor`;
  if (r.demotionUnlocked && r.baseDelta < 0) return `base ${signedRp(r.baseDelta)} · clamped at the ${medalOf(r.after.divisionIndex)} floor`;
  return `base ${signedRp(r.baseDelta)}`;
}

/** The resolve-beat outcome line — ONLY what the visuals don't already say (owner 2026-09-20). A promotion or
 *  demotion is told by the crest transition + the new label, so neither prints a line; the gate line stays
 *  (nothing else shows that the next game is a promotion game), as does a failed promotion (the retreat
 *  alone doesn't say it was one). Ascendant I's uncapped counter speaks for itself. */
export function outcomeText(r: RankResult): string | null {
  if (r.promoted || r.demoted) return null;
  if (r.promotionUnlocked) return gateText(r.after);
  // The rules' flag, never derived here: armed only by a loss clamped at 0 on a medal floor (a medal
  // promotion landing on the new medal's III does NOT arm it).
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
  const outcome = r.promoted ? `Promoted to ${rankLabel(r.after)}` : r.demoted ? `Demoted to ${rankLabel(r.after)}` : outcomeText(r);
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
