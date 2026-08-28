/**
 * DOC BOT 2.0 WP D — the §10.1 isolated-case PLANNER (blueprint §10.1; docs/docbot2/work-package-plan.md WP D).
 *
 * Pure planning, no engine: for each ContentContract this module decides which of the §10.1 case templates
 * are APPLICABLE (driven by the contract's triggers/effects/tags — "applicability tags decide which cases
 * are meaningful"), which EXECUTABLE DRIVER instantiates each one, and — the honesty half (§4.3) — a TYPED
 * skip reason for every applicable case no driver can run yet. Nothing is ever silently complete: the sweep
 * report sums applicable/executed/skipped per template, and a skip always names its reason.
 *
 * Drivers (executed in contractOracle.ts, all through the REAL engine — §4.1):
 *  · combat-death-summon   — onDeath summon claims (deathrattleSummon / deathrattleSummonOverflowBuff /
 *                            curated 'summon'), counted off the authoritative combat event log.
 *  · avenge-threshold      — avenge triggers with a declared threshold; first avenge-stamped emission
 *                            ordinal vs the contract's threshold (the temporalWindow measurement, derived).
 *  · shop-battlecry-summon — battlecrySummon through the real reducer.
 *  · copy-policy           — stated copyPolicy.mode, via the checked-in QaScenarioV1 copy fixtures and the
 *                            reducer hero-power probe (the slice's xerox measurement, generalized).
 *
 * Everything else stays visible: curated slice subjects whose probes already gate in verticalSlice.test.ts
 * are 'covered-by-slice-oracle'; runes/quests/hero-powers point at their citing lanes; unmatched shapes are
 * 'no-driver-for-shape' — the WP D burn-down list, not a pass.
 */
import type { ContentContract } from '@game/rules/contracts/schema';

/** The §10.1 templates this planner reasons about (the WP D brief's minimum set). */
export type CaseTemplateId =
  | 'minimum-activation'
  | 'no-valid-target'
  | 'one-target'
  | 'multiple-targets'
  | 'plain'
  | 'gilded'
  | 'trigger-multiplier'
  | 'once-per-x-unused'
  | 'once-per-x-used';

export const CASE_TEMPLATES: readonly CaseTemplateId[] = [
  'minimum-activation', 'no-valid-target', 'one-target', 'multiple-targets',
  'plain', 'gilded', 'trigger-multiplier', 'once-per-x-unused', 'once-per-x-used',
];

export type DriverId = 'combat-death-summon' | 'avenge-threshold' | 'shop-battlecry-summon' | 'copy-policy' | 'gilded-shape';

/** Typed skip reasons (§4.3 — a skip is DATA, never silence). */
export type SkipReason =
  | 'no-driver-for-shape' // no executable driver understands this trigger/effect shape yet (the burn-down list)
  | 'covered-by-slice-oracle' // curated slice subject; its hand probe gates in verticalSlice.test.ts
  | 'covered-by-cited-lane' // an existing npm-test lane owns this surface (cited in the aspect table)
  | 'hero-power-behaviour-unextracted' // extractor claims identity/activation only; magnitude lives in reducer branches
  | 'board-cap-would-clip' // the 7-slot cap would truncate the measurement (ambiguous count)
  | 'gilded-not-declared' // contract states no gilded magnitude (authored goldenText → reshape, or none)
  | 'contract-states-no-targets' // no targets claim to compare against (extracted contracts rarely state one)
  | 'no-limit-declared' // no once-per-X limit stated on the contract
  // ── the 2026-08-28 gilding-kind skips: each names WHY this contract's gild is not a countable ×N ────────
  | 'gild-not-applicable' // R-GILD-02: the object can never BE gilded (spell / Ruby). Skipped WITH the reason.
  | 'gild-stated-by-golden-text' // 'reshape': the authored golden text IS the gilded form — the textOracle golden lane owns it
  | 'gild-shape-not-countable' // 'extra-proc' / 'gilded-token' whose observable this sweep cannot count yet
  | 'gild-shape-unresolved'; // the extractor could not derive a shape and refused to guess one (basis 'unresolved')

export interface PlannedCase {
  template: CaseTemplateId;
  driver: DriverId;
}

export interface SkippedCase {
  template: CaseTemplateId;
  reason: SkipReason;
  detail?: string;
}

export interface CasePlan {
  contractId: string;
  /** Cases a driver will execute through the real engine. */
  cases: PlannedCase[];
  /** Applicable cases no driver runs — each with its typed reason. */
  skipped: SkippedCase[];
}

/** Combat-side summon factories whose token count is countable off the event log (the extractor's
 *  SUMMON_FACTORIES minus the shop-side one, plus the curated intent-level 'summon'). */
const COMBAT_SUMMON_KINDS = new Set(['deathrattleSummon', 'deathrattleSummonOverflowBuff', 'summon']);

/** Curated slice subjects whose measurements live in verticalSlice.test.ts (gated in npm test) and are not
 *  re-driven here — the slice stays the oracle for these shapes until a generic driver subsumes each. */
export const SLICE_COVERED_IDS: ReadonlySet<string> = new Set([
  'sylus', 'zyff', 'deathsayer', 'anubis', 'dm_butcher', 'dm_agent', 'd2_recaller', 'rune_fury',
]);

const BOARD_CAP = 7;

const hasTrigger = (c: ContentContract, event: string): boolean =>
  (c.triggers ?? []).some((t) => t.event === event);

/** The combat-death summon effect of a contract, when exactly one is stated (ambiguous shapes skip). */
export function deathSummonEffect(c: ContentContract): { index: number; cardId: string; plain: number; gilded?: number } | null {
  if (!hasTrigger(c, 'onDeath')) return null;
  const idx = (c.effects ?? []).findIndex((e) => COMBAT_SUMMON_KINDS.has(e.kind) && e.summons);
  if (idx < 0) return null;
  const s = (c.effects ?? [])[idx]!.summons!;
  return { index: idx, cardId: s.cardId, plain: s.count.plain, ...(s.count.gilded !== undefined ? { gilded: s.count.gilded } : {}) };
}

export function battlecrySummonEffect(c: ContentContract): { index: number; cardId: string; plain: number; gilded?: number } | null {
  const idx = (c.effects ?? []).findIndex((e) => e.kind === 'battlecrySummon' && e.summons);
  if (idx < 0) return null;
  const s = (c.effects ?? [])[idx]!.summons!;
  return { index: idx, cardId: s.cardId, plain: s.count.plain, ...(s.count.gilded !== undefined ? { gilded: s.count.gilded } : {}) };
}

/**
 * The gilded-token claim this sweep can DRIVE (owner rulings 2026-08-28): a contract whose gild changes the
 * summoned token's IDENTITY rather than the count. It is countable off the combat event log exactly when the
 * source fires through a driveable trigger — an onDeath body that dies, or an avenge threshold we can feed.
 */
export function gildedTokenClaim(c: ContentContract): { cardId: string; count: number; via: 'onDeath' | 'avenge' } | null {
  const g = c.gildedDelta;
  if (g?.kind !== 'gilded-token' || !g.token.cardId) return null;
  const via = hasTrigger(c, 'onDeath') ? 'onDeath' : (avengeTrigger(c) ? 'avenge' : null);
  if (!via) return null;
  return { cardId: g.token.cardId, count: g.token.count ?? 1, via };
}

export function avengeTrigger(c: ContentContract): { index: number; threshold: number } | null {
  const idx = (c.triggers ?? []).findIndex((t) => t.event === 'avenge' && typeof t.threshold === 'number');
  if (idx < 0) return null;
  return { index: idx, threshold: (c.triggers ?? [])[idx]!.threshold! };
}

const CARD_TYPES = new Set(['minion', 'spell', 'token', 'gift', 'henchman']);

/** Plan the applicable §10.1 cases for one contract. Pure — the oracle executes the plan. */
export function planCases(c: ContentContract): CasePlan {
  const cases: PlannedCase[] = [];
  const skipped: SkippedCase[] = [];
  const skip = (template: CaseTemplateId, reason: SkipReason, detail?: string): void => {
    skipped.push({ template, reason, ...(detail ? { detail } : {}) });
  };

  // ── copy-policy: any contract STATING a copy mode (both card and hero-power shapes) ─────────────────────
  if (c.copyPolicy) {
    cases.push({ template: 'one-target', driver: 'copy-policy' });
    if ((c.tags ?? []).includes('once-per-game')) {
      cases.push({ template: 'once-per-x-unused', driver: 'copy-policy' });
      cases.push({ template: 'once-per-x-used', driver: 'copy-policy' });
    } else {
      skip('once-per-x-unused', 'no-limit-declared');
    }
    return { contractId: c.contentId, cases, skipped };
  }

  // ── non-card types ride their citing lanes (consumed as aspects, not re-driven) ─────────────────────────
  if (c.contentType === 'hero-power') {
    skip('minimum-activation', 'hero-power-behaviour-unextracted',
      'activation is driven by heroPowerLane/heroPowerStagers (cited); magnitude claims need WP E/H curation first');
    return { contractId: c.contentId, cases, skipped };
  }
  if (c.contentType === 'rune') {
    skip('minimum-activation', 'covered-by-cited-lane', 'runeRewardDifferential + runeSwallowScan own the rune reward surface');
    return { contractId: c.contentId, cases, skipped };
  }
  if (c.contentType === 'quest') {
    skip('minimum-activation', 'covered-by-cited-lane', 'economyScan verifies every quest reward magnitude; objective counting is trajectory work (WP F)');
    return { contractId: c.contentId, cases, skipped };
  }

  if (SLICE_COVERED_IDS.has(c.contentId)) {
    skip('minimum-activation', 'covered-by-slice-oracle', 'hand probe gates in verticalSlice.test.ts (npm test)');
    return { contractId: c.contentId, cases, skipped };
  }

  if (!CARD_TYPES.has(c.contentType)) return { contractId: c.contentId, cases, skipped };

  const death = deathSummonEffect(c);
  const bc = battlecrySummonEffect(c);
  const av = avengeTrigger(c);

  if (death) {
    // plain minimum-activation fits the cap whenever the tokens alone fit (the source dies, freeing its slot).
    if (death.plain <= BOARD_CAP) cases.push({ template: 'minimum-activation', driver: 'combat-death-summon' }, { template: 'plain', driver: 'combat-death-summon' });
    else skip('plain', 'board-cap-would-clip', `${death.plain} tokens > ${BOARD_CAP} slots`);
    // A 'gilded-token' claim is about the token's IDENTITY, which only the gilded-shape driver reads — it
    // owns the gilded template for those contracts (the block at the bottom plans it).
    if (gildedTokenClaim(c)) { /* gilded template belongs to the gilded-shape driver */ }
    else if (death.gilded === undefined) skip('gilded', 'gilded-not-declared', c.gildedDelta?.kind === 'reshape' ? 'authored goldenText (reshape) — the gilded form is text-stated, not a countable factor' : undefined);
    else if (death.gilded <= BOARD_CAP) cases.push({ template: 'gilded', driver: 'combat-death-summon' });
    else skip('gilded', 'board-cap-would-clip', `${death.gilded} gilded tokens > ${BOARD_CAP} slots`);
    // trigger-multiplier (Sylus, deathrattle family): doubled tokens + the surviving multiplier body must fit.
    if (death.plain * 2 + 1 <= BOARD_CAP) cases.push({ template: 'trigger-multiplier', driver: 'combat-death-summon' });
    else skip('trigger-multiplier', 'board-cap-would-clip', `${death.plain * 2} doubled tokens + Sylus > ${BOARD_CAP} slots`);
  }

  if (av) {
    cases.push({ template: 'minimum-activation', driver: 'avenge-threshold' });
    // rune_fury doubles avenge RESOLUTION only (R-AVWIN-07) — the threshold ordinal must not move.
    cases.push({ template: 'trigger-multiplier', driver: 'avenge-threshold' });
  }

  if (bc) {
    if (bc.plain + 1 <= BOARD_CAP) cases.push({ template: 'minimum-activation', driver: 'shop-battlecry-summon' }, { template: 'plain', driver: 'shop-battlecry-summon' });
    else skip('plain', 'board-cap-would-clip');
    if (bc.gilded === undefined) skip('gilded', 'gilded-not-declared');
    else cases.push({ template: 'gilded', driver: 'shop-battlecry-summon' });
  }

  if (cases.length === 0 && skipped.length === 0) {
    skip('minimum-activation', 'no-driver-for-shape',
      `triggers [${(c.triggers ?? []).map((t) => t.event).join(', ') || 'none'}] · effects [${(c.effects ?? []).map((e) => e.kind).join(', ') || 'none'}]`);
  }

  // ── the gilding aspect (owner rulings 2026-08-28) ──────────────────────────────────────────────────────
  // The summon drivers above already own the 'gilded' template wherever they measure a gilded COUNT — that
  // IS the 'multiply' shape, and the plain ×2 baseline is left exactly as it was. What is NEW here is every
  // OTHER declared shape: each gets its own executable case or its own TYPED skip, so an inapplicable or
  // text-stated gild is skipped WITH ITS REASON instead of sitting in the pool as unresolved noise (§4.3).
  const gildedOwned = cases.some((x) => x.template === 'gilded') || skipped.some((x) => x.template === 'gilded');
  const g = c.gildedDelta;
  if (!gildedOwned && g && g.kind !== 'multiply') {
    if (gildedTokenClaim(c)) cases.push({ template: 'gilded', driver: 'gilded-shape' });
    else if (g.kind === 'not-applicable') skip('gilded', 'gild-not-applicable', g.reason);
    else if (g.kind === 'reshape') {
      skip('gilded', 'gild-stated-by-golden-text',
        'the gild changes the SHAPE, not a number — the authored goldenText states the gilded form and the textOracle golden lane verifies it');
    } else if (g.kind === 'extra-proc') {
      skip('gilded', 'gild-shape-not-countable',
        `owner-ruled extra-proc (+${g.extra} resolution): an extra proc and a doubled printed number are indistinguishable in this sweep's countable measurements`);
    } else if (g.kind === 'gilded-token') {
      skip('gilded', 'gild-shape-not-countable', 'gilded-token claim, but no onDeath/avenge trigger this sweep can drive to a summon');
    } else if (g.kind === 'other' && g.basis === 'unresolved') {
      skip('gilded', 'gild-shape-unresolved', 'the extractor could not derive a gilded shape and refused to guess one — see extraction.unparsed');
    } else if (g.kind === 'none') skip('gilded', 'gild-not-applicable', g.description);
  }

  // Target-cardinality templates need a stated targets claim to compare against.
  const statesTargets = (c.effects ?? []).some((e) => e.targets);
  if (!statesTargets && cases.length > 0) {
    skip('no-valid-target', 'contract-states-no-targets');
    skip('one-target', 'contract-states-no-targets');
    skip('multiple-targets', 'contract-states-no-targets');
  }

  return { contractId: c.contentId, cases, skipped };
}
