/**
 * RANK SCREEN FIXTURES — every state the post-game screen can show, as data (blueprint §3 acceptance rows +
 * owner decisions 2026-09-20: a won promotion lands at 0/100; a medal step needs 1st). Drives the DEV preview
 * (`RankScreenPreview`) and the jsdom tests, so the owner can review each variant without playing eight games
 * and a test can pin each one's text. No fixture is ever shown to a player outside DEV.
 */
import type { RankPosition, RankResult, RankSubmission } from './types';

export interface RankFixture {
  id: string;
  label: string;
  /** What the owner should see — folded into the DEV panel's hover hint. */
  expect: string;
  placement: number;
  submission: RankSubmission;
  result: RankResult | null;
  /** The profile's current position, for the states with no result yet (pending / retryable / rejected). */
  current: RankPosition | null;
  /** A truthful error for the rejected state. */
  error?: string;
}

const base = (over: Partial<RankResult> & Pick<RankResult, 'placement' | 'before' | 'after' | 'baseDelta'>): RankResult => {
  const appliedDelta = over.appliedDelta ?? (100 * over.after.divisionIndex + over.after.points) - (100 * over.before.divisionIndex + over.before.points);
  const higher = over.after.divisionIndex > over.before.divisionIndex || (over.after.divisionIndex === over.before.divisionIndex && over.after.points >= over.before.points);
  return {
    runId: `fixture-${over.placement}-${over.before.divisionIndex}-${over.before.points}`,
    seasonId: 3, rulesVersion: 1, revisionBefore: 10, revisionAfter: 11,
    appliedDelta,
    cappedPoints: Math.abs(over.baseDelta - appliedDelta),
    wasPromotionGame: false, promotionKind: null, requiredFinish: null, promotionUnlocked: false, promoted: false, demoted: false,
    highestAfter: higher ? { ...over.after } : { ...over.before },
    ...over,
  };
};

const pos = (divisionIndex: number, points: number): RankPosition => ({ divisionIndex, points });

export const RANK_FIXTURES: readonly RankFixture[] = [
  {
    id: 'gain', label: 'Gain', expect: 'Gold II 60 → 76, bar fills, +16 RP',
    placement: 3, submission: 'confirmed', current: null,
    result: base({ placement: 3, before: pos(7, 60), after: pos(7, 76), baseDelta: 16 }),
  },
  {
    id: 'loss', label: 'Loss', expect: 'Gold II 60 → 44, bar drains, −16 RP',
    placement: 6, submission: 'confirmed', current: null,
    result: base({ placement: 6, before: pos(7, 60), after: pos(7, 44), baseDelta: -16 }),
  },
  {
    id: 'gate', label: 'Gate unlocked', expect: 'Gold II 88 → 100 (base +40 capped to +12), endpoint glows, "Promotion game ready — finish top 4"',
    placement: 1, submission: 'confirmed', current: null,
    result: base({ placement: 1, before: pos(7, 88), after: pos(7, 100), baseDelta: 40, promotionUnlocked: true }),
  },
  {
    id: 'gate-medal', label: 'Gate unlocked (medal)', expect: 'Gold I 94 → 100, "finish 1st to advance" (the next step is Platinum)',
    placement: 4, submission: 'confirmed', current: null,
    result: base({ placement: 4, before: pos(8, 94), after: pos(8, 100), baseDelta: 6, promotionUnlocked: true }),
  },
  {
    id: 'promo-won', label: 'Promotion won', expect: 'Gold II 100 → Gold I 0: full old bar, crest/tier transition, new bar from 0, +16 RP — no outcome line (the visuals say it)',
    placement: 3, submission: 'confirmed', current: null,
    result: base({ placement: 3, before: pos(7, 100), after: pos(8, 0), baseDelta: 16, appliedDelta: 0, wasPromotionGame: true, promotionKind: 'division', requiredFinish: 4, promoted: true }),
  },
  {
    id: 'promo-medal', label: 'Medal promotion won', expect: 'Gold I 100 → Platinum III 0: crest changes medal, medal fanfare',
    placement: 1, submission: 'confirmed', current: null,
    result: base({ placement: 1, before: pos(8, 100), after: pos(9, 0), baseDelta: 40, appliedDelta: 0, wasPromotionGame: true, promotionKind: 'medal', requiredFinish: 1, promoted: true }),
  },
  {
    id: 'promo-failed', label: 'Promotion failed', expect: 'Gold II 100 → 60: bar retreats from full, −40 RP, "Promotion unsuccessful"',
    placement: 8, submission: 'confirmed', current: null,
    result: base({ placement: 8, before: pos(7, 100), after: pos(7, 60), baseDelta: -40, wasPromotionGame: true, promotionKind: 'division', requiredFinish: 4 }),
  },
  {
    id: 'demotion', label: 'Demotion', expect: 'Gold II 10 → Gold III 70: drain to 0, crest/tier transition, previous bar retreats from 100 to 70, −40 RP — no outcome line',
    placement: 8, submission: 'confirmed', current: null,
    result: base({ placement: 8, before: pos(7, 10), after: pos(6, 70), baseDelta: -40, demoted: true }),
  },
  // ── The MEDAL-DEMOTION GATE (owner 2026-09-20) ──
  {
    id: 'demo-gate', label: 'Demotion game set up', expect: 'Gold III 10 → 0 (base −40 clamps at the medal floor, −10 RP): "Demotion game — finish top 4 to stay in Gold"',
    placement: 8, submission: 'confirmed', current: null,
    result: base({ placement: 8, before: pos(6, 10), after: pos(6, 0), baseDelta: -40, demotionUnlocked: true }),
  },
  {
    id: 'demo-lost', label: 'Demotion game lost', expect: 'Gold III 0 → Silver I: bar sits at 0, crest transitions down a MEDAL, Silver I bar shows the landing points (60 here — the rules agent owns the number)',
    placement: 7, submission: 'confirmed', current: null,
    result: base({ placement: 7, before: pos(6, 0), after: pos(5, 60), baseDelta: -28, wasDemotionGame: true, demoted: true }),
  },
  {
    id: 'demo-escape', label: 'Demotion game escaped', expect: 'Gold III 0 → 16 (top 4 from 0): the normal fill, no gate line',
    placement: 3, submission: 'confirmed', current: null,
    result: base({ placement: 3, before: pos(6, 0), after: pos(6, 16), baseDelta: 16, wasDemotionGame: true }),
  },
  {
    id: 'floor', label: 'Bronze floor', expect: 'Bronze III 10 → 0 shows −10 RP (the actual loss) with "base −40 · Bronze floor"',
    placement: 8, submission: 'confirmed', current: null,
    result: base({ placement: 8, before: pos(0, 10), after: pos(0, 0), baseDelta: -40 }),
  },
  {
    id: 'floor-zero', label: 'Bronze floor (at 0)', expect: 'Bronze III 0 → 0: "0 RP · Bronze floor"',
    placement: 7, submission: 'confirmed', current: null,
    result: base({ placement: 7, before: pos(0, 0), after: pos(0, 0), baseDelta: -28 }),
  },
  {
    id: 'ascendant', label: 'Ascendant I (uncapped)', expect: 'Ascendant I 90 → 130: uncapped RP counter in place of x/100, no false promotion, no outcome line',
    placement: 1, submission: 'confirmed', current: null,
    result: base({ placement: 1, before: pos(17, 90), after: pos(17, 130), baseDelta: 40 }),
  },
  {
    id: 'pending', label: 'Pending', expect: 'Placement + current crest, "Updating rank…", Continue usable',
    placement: 2, submission: 'pending', current: pos(7, 60), result: null,
  },
  {
    id: 'retryable', label: 'Retryable', expect: '"Rank update pending" + Retry + Continue',
    placement: 2, submission: 'retryable', current: pos(7, 60), result: null,
  },
  {
    id: 'rejected', label: 'Rejected', expect: 'A truthful error with the reason; no "Unrated" mislabel',
    placement: 5, submission: 'rejected', current: pos(7, 60), result: null,
    error: 'The server rejected this result: season 2 rules are no longer accepted. Update the game to rank this run.',
  },
  {
    id: 'unrated', label: 'Unrated (practice)', expect: 'Placement + "Unrated", no rank movement',
    placement: 4, submission: 'unrated', current: null, result: null,
  },
];

export const fixtureById = (id: string): RankFixture | undefined => RANK_FIXTURES.find((f) => f.id === id);
