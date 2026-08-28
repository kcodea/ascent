/**
 * DOC BOT 2.0 WP D — CONTRACT VERIFICATION AT SCALE (blueprint §9.1/§10.1; work-package-plan.md WP D).
 *
 * Generalizes the vertical slice's 13 hand probes into a DERIVED sweep over the whole contract registry
 * (901 today): `planCases` (isolatedCases.ts) decides which §10.1 templates apply per contract, the drivers
 * here execute every planned case through the REAL engine — `simulate()` for combat, `createRun`/`reduce`
 * for shop, `runQaScenario` for the checked-in copy fixtures — and the frozen comparator (`checkContract`)
 * judges expected-vs-observed. Nothing re-implements card behaviour (§4.1); every number is counted off the
 * authoritative event log or a reducer state transition.
 *
 * AUTHORITY HONESTY (§6.1 drives the finding class): a mismatch against an APPROVED contract is
 * verified-bug-grade ('verified-mechanical-bug', severity error); a mismatch against an 'extracted' /
 * 'needs-review' draft is corroboration-grade ONLY — a DISAGREEMENT between two machine readings of the
 * same implementation ('questionable-interaction', severity question). The oracle never promotes a draft.
 *
 * ASPECT TABLE (deliverable 2 — existing lanes become citable): each contract's row joins
 *  · the WP B corroboration aspects (phase/text/runtime — corroborateContracts, reused not re-implemented);
 *  · the 'direct-suite' aspect this sweep executes;
 *  · CITED aspects — temporal/order/invariant/conservation/magnitude/economy/rune/hero lanes that already
 *    gate this contract's family in `npm test`. Citations are listed evidence, and deliberately EXCLUDED
 *    from the derived-status fold: a family-level lane must never blanket-'corroborate' 888 drafts (§4.3).
 *
 * SAMPLING (runtime budget): the PR gate runs a deterministic sample — contracts whose id-hash lands in the
 * current rotation (itself derived from the executed-candidate id list, so it moves when content moves and
 * never depends on wall clock). The full sweep runs behind `npm run docbot:contracts` and the nightly.
 *
 * Sabotage (§4.5): the comparator and the metamorphic laws are data-in/data-out, so contractOracle.test.ts
 * doctors a contract amount, a gilded delta, and a reorder measurement and proves each is detected.
 */
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
// Static JSON import (never node:fs): this module rides @game/sim's public entrypoint into the web bundle,
// so fixture loading must be bundler-safe (the D-2 trap contractExtract.ts documents).
import plainCopyFixtureJson from './scenarios/avenge-window-plain-copy.json';
import { CARD_INDEX } from '@game/content';
import {
  checkContract, contractStableStringify,
  deriveContractStatus,
  type ContentContract, type ContractAspectVerdict, type ContractMismatch, type ContractObservation,
  type DerivedContractStatus,
} from '@game/rules/contracts/schema';
import { createRun } from '../state';
import { reduce } from '../reducer';
import { parseQaScenario, runQaScenario } from '../qaScenario';
import { corroborateContracts, type CorroborationSources } from './contractCorroboration';
import {
  CASE_TEMPLATES, planCases, avengeTrigger, battlecrySummonEffect, deathSummonEffect, gildedTokenClaim,
  type CasePlan, type CaseTemplateId,
} from './isolatedCases';
import { checkMetamorphic, type MetamorphicCheck, type VariantRelation } from './variantDiff';
import { makeFinding, type DocbotFinding } from './findings';

export const CONTRACT_LANE = 'contract-oracle';

// ── fixture helpers (the slice's combat harness pattern) ──────────────────────────────────────────────────

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });

type Sim = ReturnType<typeof simulate>;

function fight(player: BoardMinion[], enemy: BoardMinion[], mods: Record<string, unknown> = {}, seed = 1): Sim {
  return simulate(player, enemy, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods } as never),
    combatSide({ tier: 1 }));
}

/** Player-side summon EVENTS of one token id, off the authoritative log. */
const summonEventsOf = (r: Sim, cardId: string): Array<{ golden?: boolean }> =>
  r.events.filter((e) => e.type === 'summon'
    && (e as { side?: string }).side !== 'enemy'
    && (e as { minion?: { cardId?: string } }).minion?.cardId === cardId)
    .map((e) => (e as { minion: { golden?: boolean } }).minion);

/** Player-side summon count of one token id, off the authoritative log. */
const summonsOf = (r: Sim, cardId: string): number => summonEventsOf(r, cardId).length;

/** Side-death ordinal at the first avenge-stamped emission attributed to `srcCard` — null when the source
 *  never observably fired. The temporalWindow read, derived: deaths counted as death events pass. */
function firstAvengeFireOrdinal(r: Sim, srcCard: string): number | null {
  let deaths = 0;
  for (const e of r.events) {
    if (e.type === 'death' && (e as { side?: string }).side === 'player') deaths += 1;
    if ((e as { avenge?: boolean }).avenge && (e as { srcCard?: string }).srcCard === srcCard) return deaths;
  }
  return null;
}

const loadFixture = (json: unknown, id: string) => {
  const { scenario, errors } = parseQaScenario(JSON.stringify(json));
  if (!scenario) throw new Error(`fixture ${id} invalid: ${errors.join(' · ')}`);
  return scenario;
};

// ── deterministic sampling (rotating by content-id hash; never wall clock) ────────────────────────────────

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The rotation index for a candidate id list: deterministic for a given content state, and it MOVES when
 *  content moves — so successive content changes walk the sample across the pool without any clock. */
export const sampleRotation = (ids: readonly string[], mod: number): number =>
  mod <= 1 ? 0 : fnv1a([...ids].sort().join('|')) % mod;

export const inSample = (contentId: string, mod: number, rotation: number): boolean =>
  mod <= 1 || fnv1a(contentId) % mod === rotation;

// ── report shapes ─────────────────────────────────────────────────────────────────────────────────────────

export interface ExecutedCase {
  contractId: string;
  template: CaseTemplateId;
  driver: string;
  /** One human-verifiable line: the fixture and what was counted. */
  evidence: string;
  /** Present when the case fired nothing observable (recorded, never a silent pass — §4.3). */
  unobserved?: string;
}

export interface ContractSweepRow {
  contractId: string;
  stored: ContentContract['reviewStatus'];
  /** Folded from corroboration + direct-suite ONLY (citations never promote a draft). */
  derived: DerivedContractStatus;
  aspects: ContractAspectVerdict[];
  /** Family-level lane citations — evidence the reader can follow, excluded from the fold. */
  citedAspects: ContractAspectVerdict[];
  sampled: boolean;
}

export interface TemplateTotals {
  applicable: number;
  executed: number;
  skipped: number;
}

export interface ContractSweepReport {
  contractsTotal: number;
  sampled: number;
  rotation: number;
  sampleMod: number;
  rows: ContractSweepRow[];
  plans: CasePlan[];
  executed: ExecutedCase[];
  observations: ContractObservation[];
  mismatches: ContractMismatch[];
  metamorphic: MetamorphicCheck[];
  /** Once-per-X latch checks (xerox-style), each with its verdict. */
  limitChecks: Array<{ contractId: string; limit: string; ok: boolean; detail: string }>;
  /** Typed skip reasons + 'sampled-out-this-rotation' for executable contracts outside this run's sample. */
  skippedByReason: Record<string, number>;
  templateTotals: Record<CaseTemplateId, TemplateTotals>;
  statusTotals: Record<DerivedContractStatus, number>;
  findings: DocbotFinding[];
}

// ── lane citations (deliverable 2: existing lanes as citable aspects — consumed, never re-implemented) ────

const MAGNITUDE_FACTORIES = new Set(['spellBuffTarget', 'battlecryBuffTarget', 'deathrattleSummon']);
const ORDER_TRIGGERS = new Set(['endOfTurn', 'startOfCombat', 'onDeath', 'onAttack']);
const CARD_TYPES = new Set(['minion', 'spell', 'token', 'gift', 'henchman']);

/** Family-level citations: each names the npm-test lane that gates this contract's family. These are
 *  evidence pointers — 'agree' here means "the cited lane is green in the gating suite", a family claim,
 *  which is why they are EXCLUDED from the per-contract derived-status fold. */
export function laneCitations(c: ContentContract): ContractAspectVerdict[] {
  const cites: ContractAspectVerdict[] = [];
  const cite = (aspect: string, detail: string): void => { cites.push({ aspect, verdict: 'agree', detail }); };
  if (CARD_TYPES.has(c.contentType)) {
    cite('global-invariants', 'cited: conservationLaws.test.ts + invariantFuzz.test.ts gate universal invariants (family-level, not a per-object probe)');
    if ((c.triggers ?? []).some((t) => ORDER_TRIGGERS.has(t.event))) {
      cite('resolution-order', 'cited: orderGoldens.test.ts pins resolution order for this trigger family');
    }
    if ((c.triggers ?? []).some((t) => t.event === 'avenge') || (c.tags ?? []).some((t) => t === 'multiplier:avenge' || t.startsWith('trigger:avenge'))) {
      cite('temporal-window', 'cited: temporalWindow.test.ts gates the R-AVWIN family (KNOWN_VIOLATIONS R-AVWIN-02/10 pinned; release-blocked by this sweep)');
    }
    if ((c.effects ?? []).some((e) => MAGNITUDE_FACTORIES.has(e.kind))) {
      cite('magnitude', 'cited: magnitudeOracle.test.ts proves grants EQUAL params for this factory');
    }
  }
  if (c.contentType === 'quest') cite('reward-magnitude', 'cited: economyScan.test.ts verifies every quest reward magnitude');
  if (c.contentType === 'rune') cite('reward-behaviour', 'cited: runeRewardDifferential.test.ts + runeSwallowScan own the rune reward surface');
  if (c.contentType === 'hero-power') cite('activation', 'cited: heroPowerLane.test.ts + heroPowerStagers.test.ts drive every live power to activation');
  return cites;
}

// ── drivers ───────────────────────────────────────────────────────────────────────────────────────────────

interface DriverCtx {
  obs: (contractId: string, path: string, observed: ContractObservation['observed'], evidence: string) => void;
  executed: ExecutedCase[];
  metamorphic: MetamorphicCheck[];
  limitChecks: ContractSweepReport['limitChecks'];
}

const FILLER = (): BoardMinion => bm('sandbag', 0, 50);

function driveDeathSummon(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const d = deathSummonEffect(c)!;
  const templates = new Set(plan.cases.filter((x) => x.driver === 'combat-death-summon').map((x) => x.template));
  const body = (golden: boolean): BoardMinion => bm(c.contentId, golden ? 2 : 1, golden ? 2 : 1, { keywords: ['T'], ...(golden ? { golden: true } : {}) });
  const measure = (golden: boolean, mods: Record<string, unknown> = {}, board?: BoardMinion[]): number =>
    summonsOf(fight(board ?? [body(golden)], [bm('sandbag', 5, 4000)], mods), d.cardId);

  if (templates.has('plain')) {
    const n = measure(false);
    ctx.obs(c.contentId, `effects.${d.index}.summons.count.plain`, n,
      `combat: ${c.contentId} (Taunt) died to a 5-attack enemy; ${n} × '${d.cardId}' counted off the event log`);
    ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: 'combat-death-summon', evidence: `counted ${n} '${d.cardId}' summons` });
    ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: 'combat-death-summon', evidence: 'one death is the minimum activation of an onDeath summon' });

    // §9.3 law 1 — irrelevant reorder: two inert 0-attack bystanders, source first vs source last.
    ctx.metamorphic.push(checkMetamorphic('irrelevant-reorder-invariance', c.contentId,
      `summon count with inert bystanders, source leftmost vs rightmost`,
      () => measure(false, {}, [body(false), FILLER(), FILLER()]),
      () => measure(false, {}, [FILLER(), FILLER(), body(false)])));

    // §9.3 law 2 — non-applicable rune: rune_fury multiplies AVENGE resolution only; an onDeath summon
    // must not move under it.
    ctx.metamorphic.push(checkMetamorphic('non-applicable-rune-no-op', c.contentId,
      'summon count with Rune of Fury (avenge-family multiplier) armed vs absent',
      () => measure(false),
      () => measure(false, { runeFury: true })));
  }

  if (templates.has('gilded')) {
    const n = measure(true);
    ctx.obs(c.contentId, `effects.${d.index}.summons.count.gilded`, n, `same fixture, gilded body: ${n} × '${d.cardId}'`);
    ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: 'combat-death-summon', evidence: `counted ${n} gilded summons` });
    // §9.3 law 3 — gilded-delta satisfaction, now against whichever COUNT RELATION the declared shape
    // implies (owner rulings 2026-08-28): 'multiply' × its factor, 'extra-proc' × (1 + extra) resolutions,
    // 'gilded-token' EQUAL (the identity changes, the number does not). 'reshape' / 'not-applicable' state
    // no count relation at all and are deliberately left to their own lanes.
    const rel = gildedCountRelation(c.gildedDelta);
    if (rel) {
      ctx.metamorphic.push(checkMetamorphic('gilded-delta-satisfaction', c.contentId,
        `${rel.detail} (declared '${c.gildedDelta!.kind}' delta)`,
        () => measure(false), () => measure(true), rel.relation));
    }
  }

  if (templates.has('trigger-multiplier')) {
    // Sylus (deathrattle-family, +1 resolution): doubled token count, R-MULT-01.
    ctx.metamorphic.push(checkMetamorphic('multiplier-resolution-only', c.contentId,
      `summon count with Sylus (deathrattle ×2) on board vs without`,
      () => measure(false),
      () => summonsOf(fight([body(false), bm('sylus', 1, 7)], [bm('sandbag', 5, 4000)]), d.cardId),
      { kind: 'times', factor: 2 }, ['R-MULT-01']));
    ctx.executed.push({ contractId: c.contentId, template: 'trigger-multiplier', driver: 'combat-death-summon', evidence: 'Sylus variant diff (×2 expected)' });
  }
}

// ── the gilding kinds (owner rulings 2026-08-28) ─────────────────────────────────────────────────────────

/**
 * The COUNT relation a declared gilded shape implies, or null when the shape makes no claim about counts.
 * This is the one place the oracle translates the owner's shape vocabulary into a checkable law:
 *  · 'multiply'       → ×factor          (the safe baseline: "doubling the output")
 *  · 'extra-proc'     → ×(1 + extra)     (Gemstorm: the gild buys one EXTRA resolution of the same payload)
 *  · 'gilded-token'   → equal            (Dunkey: the token's IDENTITY changes, its count does not)
 *  · 'reshape'        → null             — the authored golden text states the gilded form (textOracle owns it)
 *  · 'not-applicable' → null             — R-GILD-02; the aspect is skipped WITH its reason, never passed
 *  · 'none' / 'other' → null
 */
export function gildedCountRelation(g: ContentContract['gildedDelta']): { relation: VariantRelation; detail: string } | null {
  if (!g) return null;
  if (g.kind === 'multiply') return { relation: { kind: 'times', factor: g.factor }, detail: `gilded count must be plain × ${g.factor}` };
  if (g.kind === 'extra-proc') {
    return { relation: { kind: 'times', factor: 1 + g.extra }, detail: `gilded output must be plain × ${1 + g.extra} (one payload plus ${g.extra} extra proc)` };
  }
  if (g.kind === 'gilded-token') return { relation: { kind: 'equal' }, detail: 'gilded count must EQUAL plain — the gild changes the token identity, not the number' };
  return null;
}

/**
 * The 'gilded-token' driver: a gild that summons the SAME number of a GILDED token (owner 2026-08-28 —
 * "dunkey for example summons a gilded armadiyo"). Two claims, both counted off the authoritative log:
 * the count must not move, and every summon the GILDED body makes must itself carry golden. A plain body
 * summoning golden tokens is just as much a violation as a gilded body summoning plain ones.
 */
function driveGildedShape(c: ContentContract, ctx: DriverCtx): void {
  const claim = gildedTokenClaim(c);
  if (!claim) return;
  const body = (golden: boolean): BoardMinion =>
    bm(c.contentId, golden ? 2 : 1, claim.via === 'avenge' ? 400 : 1, { keywords: ['T'], ...(golden ? { golden: true } : {}) });
  const board = (golden: boolean): BoardMinion[] => claim.via === 'avenge'
    ? [body(golden), ...Array.from({ length: 5 }, () => bm('b2_packstrider', 1, 1))]
    : [body(golden)];
  const run = (golden: boolean) => summonEventsOf(fight(board(golden), [bm('sandbag', claim.via === 'avenge' ? 2 : 5, 4000)]), claim.cardId);

  const plain = run(false);
  const gilded = run(true);
  const fixture = claim.via === 'avenge'
    ? '5 feeder deaths in front of the source (Avenge fed)'
    : 'the Taunt source died to a 5-attack enemy';

  ctx.executed.push({
    contractId: c.contentId, template: 'gilded', driver: 'gilded-shape',
    evidence: `${fixture}: plain summoned ${plain.length} × '${claim.cardId}' (${plain.filter((m) => m.golden).length} gilded), `
      + `gilded body summoned ${gilded.length} (${gilded.filter((m) => m.golden).length} gilded)`,
    ...(plain.length === 0 && gilded.length === 0
      ? { unobserved: `no '${claim.cardId}' summon fired in either fixture — the gilded-token claim is RECORDED unverified, not passed` }
      : {}),
  });
  if (plain.length === 0 && gilded.length === 0) return;

  const countHeld = gilded.length === plain.length;
  const allGilded = gilded.length > 0 && gilded.every((m) => m.golden === true);
  const nonePlainGilded = plain.every((m) => m.golden !== true);
  const ok = countHeld && allGilded && nonePlainGilded;
  ctx.limitChecks.push({
    contractId: c.contentId,
    limit: 'gilded-token-identity',
    ok,
    detail: ok
      ? `${fixture}: both bodies summoned ${plain.length} × '${claim.cardId}'; only the gilded body's tokens carry golden (the identity changed, the count did not)`
      : [
          countHeld ? '' : `the count MOVED: plain ${plain.length} → gilded ${gilded.length} (a gilded-token gild must not change the number — declare 'multiply' if it does)`,
          allGilded ? '' : `the gilded body summoned ${gilded.filter((m) => m.golden).length}/${gilded.length} GILDED '${claim.cardId}' — the contract claims every one is gilded`,
          nonePlainGilded ? '' : `the PLAIN body already summoned a gilded '${claim.cardId}' — then the gild is not what makes the token gilded`,
        ].filter(Boolean).join(' · '),
  });

  // The count law, stated as a metamorphic check so it rides the same finding plumbing as every other law.
  const rel = gildedCountRelation(c.gildedDelta);
  if (rel) {
    ctx.metamorphic.push(checkMetamorphic('gilded-delta-satisfaction', c.contentId,
      `${rel.detail} (declared 'gilded-token' delta)`,
      () => plain.length, () => gilded.length, rel.relation));
  }
}

function driveAvengeThreshold(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const av = avengeTrigger(c)!;
  const templates = new Set(plan.cases.filter((x) => x.driver === 'avenge-threshold').map((x) => x.template));
  const feeders = Math.min(5, av.threshold + 1);
  const board = (): BoardMinion[] => [bm(c.contentId, 1, 400), ...Array.from({ length: feeders }, () => bm('b2_packstrider', 1, 1))];
  const measure = (mods: Record<string, unknown> = {}): number | null =>
    firstAvengeFireOrdinal(fight(board(), [bm('sandbag', 2, 4000)], mods), c.contentId);

  if (templates.has('minimum-activation')) {
    const ordinal = measure();
    if (ordinal === null) {
      ctx.executed.push({
        contractId: c.contentId, template: 'minimum-activation', driver: 'avenge-threshold',
        evidence: `${feeders} feeder deaths staged`,
        unobserved: 'no avenge-stamped emission attributed to this source — the effect may act without emitting (recorded, not passed)',
      });
    } else {
      ctx.obs(c.contentId, `triggers.${av.index}.threshold`, ordinal,
        `combat: source present from the start (baseline 0), ${feeders} sequential feeder deaths; first avenge-stamped emission at side-death ${ordinal}`);
      ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: 'avenge-threshold', evidence: `first fire at side-death ${ordinal}` });

      if (templates.has('trigger-multiplier')) {
        // R-AVWIN-07: rune_fury doubles RESOLUTION, never progress — the first-fire ordinal must not move.
        ctx.metamorphic.push(checkMetamorphic('multiplier-resolution-only', c.contentId,
          'first avenge-fire ordinal with Rune of Fury armed vs absent (resolution doubles, progress must not)',
          () => measure() ?? -1, () => measure({ runeFury: true }) ?? -1, { kind: 'equal' }, ['R-AVWIN-07']));
        ctx.executed.push({ contractId: c.contentId, template: 'trigger-multiplier', driver: 'avenge-threshold', evidence: 'rune_fury ordinal-invariance diff' });
      }
    }
  }
}

function driveShopBattlecrySummon(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const b = battlecrySummonEffect(c)!;
  const templates = new Set(plan.cases.filter((x) => x.driver === 'shop-battlecry-summon').map((x) => x.template));
  const playCount = (golden: boolean): number => {
    const s = createRun(21, 'aster', 'ascent', 9, 'set1');
    s.embers = 10;
    s.hand = [{ uid: 'h1', cardId: c.contentId, tribe: CARD_INDEX[c.contentId]?.tribe ?? 'neutral', attack: golden ? 2 : 1, health: golden ? 2 : 1, keywords: [], golden }];
    const after = reduce(s, { type: 'play', uid: 'h1' });
    return after.board.filter((x) => x.cardId === b.cardId).length;
  };
  if (templates.has('plain')) {
    const n = playCount(false);
    ctx.obs(c.contentId, `effects.${b.index}.summons.count.plain`, n, `reducer: playing ${c.contentId} put ${n} × '${b.cardId}' on the board`);
    ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: 'shop-battlecry-summon', evidence: `${n} '${b.cardId}' on board after play` });
    ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: 'shop-battlecry-summon', evidence: 'one play is the minimum activation' });
  }
  if (templates.has('gilded')) {
    const n = playCount(true);
    ctx.obs(c.contentId, `effects.${b.index}.summons.count.gilded`, n, `reducer: playing gilded ${c.contentId} put ${n} × '${b.cardId}' on the board`);
    ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: 'shop-battlecry-summon', evidence: `${n} gilded summons` });
  }
}

function driveCopyPolicy(c: ContentContract, plan: CasePlan, ctx: DriverCtx, semanticRevision?: string): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === 'copy-policy').map((x) => x.template));
  if (!templates.has('one-target')) return;

  if (c.contentId === 'hero:xerox') {
    // The slice's reducer probe, kept verbatim in spirit: an EXACT copy carries gilding + accrued counters.
    const s = createRun(13, 'xerox', 'ascent', 9, 'set1');
    s.embers = 10;
    s.board = [{ uid: 'k1', cardId: 'kennel', tribe: 'beast', attack: 2, health: 6, keywords: ['SC'], golden: true, summonBonus: 2 }];
    const after = reduce(s, { type: 'heroPower', uid: 'k1' });
    const copy = after.board.find((x) => x.uid !== 'k1');
    const exact = copy?.golden === true && copy?.summonBonus === 2;
    ctx.obs(c.contentId, 'copyPolicy.mode', exact ? 'exact' : (copy ? 'plain' : 'no-copy-observed'),
      `reducer heroPower on a gilded Kennelmaster (summonBonus 2): copy ${copy ? `golden=${copy.golden} summonBonus=${copy.summonBonus}` : 'absent'}`);
    ctx.executed.push({ contractId: c.contentId, template: 'one-target', driver: 'copy-policy', evidence: 'reducer probe: instance state rides the copy' });

    if (templates.has('once-per-x-used')) {
      const again = reduce(after, { type: 'heroPower', uid: 'k1' });
      const ok = again.board.length === after.board.length;
      ctx.limitChecks.push({
        contractId: c.contentId, limit: 'once-per-game', ok,
        detail: ok ? 'second heroPower produced no second copy (latch holds)' : `second heroPower grew the board ${after.board.length} → ${again.board.length} — the once-per-game latch is broken`,
      });
      ctx.executed.push({ contractId: c.contentId, template: 'once-per-x-unused', driver: 'copy-policy', evidence: 'first use produced the copy (unused state acts)' });
      ctx.executed.push({ contractId: c.contentId, template: 'once-per-x-used', driver: 'copy-policy', evidence: 'second use refused (used state latches)' });
    }
    return;
  }

  // Plain-copy subjects ride the checked-in QaScenarioV1 fixture (n2_bellringer today).
  if (c.copyPolicy?.mode === 'plain') {
    const result = runQaScenario(loadFixture(plainCopyFixtureJson, 'avenge-window-plain-copy'), { semanticRevision });
    ctx.obs(c.contentId, 'copyPolicy.mode', result.ok ? 'plain' : 'NOT-plain',
      'fixture avenge-window-plain-copy: the copied minion reaches hand with no instance state while the source keeps its counters');
    ctx.executed.push({ contractId: c.contentId, template: 'one-target', driver: 'copy-policy', evidence: 'QaScenarioV1 fixture avenge-window-plain-copy' });
  }
}

// ── the sweep ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ContractSweepOptions {
  contracts: readonly ContentContract[];
  /** 1 (default) = full sweep; N samples ~1/N of the driver-executable contracts (planning + corroboration
   *  + citations always cover ALL contracts — only engine execution is sampled). */
  sampleMod?: number;
  corroboration?: CorroborationSources;
  semanticRevision?: string;
}

export function runContractSweep(opts: ContractSweepOptions): ContractSweepReport {
  const { contracts } = opts;
  const sampleMod = opts.sampleMod ?? 1;
  const semanticRevision = opts.semanticRevision ?? 'dev';

  const plans = contracts.map(planCases);
  const planIndex = new Map(plans.map((p) => [p.contractId, p]));
  const executableIds = plans.filter((p) => p.cases.length > 0).map((p) => p.contractId);
  const rotation = sampleRotation(executableIds, sampleMod);

  const observations: ContractObservation[] = [];
  const ctx: DriverCtx = {
    obs: (contractId, path, observed, evidence) => observations.push({ contractId, path, observed, evidence }),
    executed: [],
    metamorphic: [],
    limitChecks: [],
  };

  const sampledIds = new Set<string>();
  for (const c of contracts) {
    const plan = planIndex.get(c.contentId)!;
    if (plan.cases.length === 0) continue;
    // Approved contracts are NEVER sampled out — the WP D exit gate (every approved contract has an
    // executable direct suite) must hold on every gate run, not one rotation in N.
    if (c.reviewStatus !== 'approved' && !inSample(c.contentId, sampleMod, rotation)) continue;
    sampledIds.add(c.contentId);
    const drivers = new Set(plan.cases.map((x) => x.driver));
    if (drivers.has('combat-death-summon')) driveDeathSummon(c, plan, ctx);
    if (drivers.has('avenge-threshold')) driveAvengeThreshold(c, plan, ctx);
    if (drivers.has('shop-battlecry-summon')) driveShopBattlecrySummon(c, plan, ctx);
    if (drivers.has('copy-policy')) driveCopyPolicy(c, plan, ctx, semanticRevision);
    if (drivers.has('gilded-shape')) driveGildedShape(c, ctx);
  }

  // Compare every observation against its contract (the frozen comparator judges — §4.5).
  const mismatches: ContractMismatch[] = [];
  const byId = new Map(contracts.map((c) => [c.contentId, c]));
  const obsByContract = new Map<string, ContractObservation[]>();
  for (const o of observations) {
    if (!obsByContract.has(o.contractId)) obsByContract.set(o.contractId, []);
    obsByContract.get(o.contractId)!.push(o);
  }
  for (const [id, obs] of obsByContract) {
    const c = byId.get(id);
    if (c) mismatches.push(...checkContract(c, obs));
  }

  // WP B corroboration reused as-is (playScan runs once inside).
  const corr = corroborateContracts(contracts, opts.corroboration ?? {});
  const corrById = new Map(corr.rows.map((r) => [r.contractId, r]));

  // Assemble rows: corroboration aspects + the direct-suite aspect fold; citations listed separately.
  const rows: ContractSweepRow[] = [];
  const statusTotals: Record<string, number> = {};
  const mismatchIds = new Set(mismatches.map((m) => m.contractId));
  const metaFailIds = new Set(ctx.metamorphic.filter((m) => !m.diff.ok).map((m) => m.contractId));
  const limitFailIds = new Set(ctx.limitChecks.filter((l) => !l.ok).map((l) => l.contractId));
  for (const c of contracts) {
    const plan = planIndex.get(c.contentId)!;
    const sampled = sampledIds.has(c.contentId);
    const direct: ContractAspectVerdict = !sampled
      ? {
          aspect: 'direct-suite', verdict: 'uncovered',
          detail: plan.cases.length === 0
            ? `no executable case: ${plan.skipped.map((s) => s.reason).join(', ') || 'nothing applicable'}`
            : 'executable but outside this run\'s deterministic sample (full sweep: npm run docbot:contracts)',
        }
      : (mismatchIds.has(c.contentId) || metaFailIds.has(c.contentId) || limitFailIds.has(c.contentId))
        ? { aspect: 'direct-suite', verdict: 'disagree', detail: 'direct execution disagreed with a stated claim (see mismatches/metamorphic/limitChecks)' }
        : { aspect: 'direct-suite', verdict: 'agree', detail: `${plan.cases.length} isolated case(s) executed through the real engine` };
    const aspects = [...(corrById.get(c.contentId)?.aspects ?? []), direct];
    const derived = deriveContractStatus(c.reviewStatus, aspects);
    statusTotals[derived] = (statusTotals[derived] ?? 0) + 1;
    rows.push({ contractId: c.contentId, stored: c.reviewStatus, derived, aspects, citedAspects: laneCitations(c), sampled });
  }

  // Template totals + skip histogram (the honesty counters).
  const templateTotals = Object.fromEntries(CASE_TEMPLATES.map((t) => [t, { applicable: 0, executed: 0, skipped: 0 }])) as Record<CaseTemplateId, TemplateTotals>;
  const skippedByReason: Record<string, number> = {};
  // "Executed" is counted from what the drivers actually RAN — never from the plan (a planned case a
  // driver could not observably run at runtime is a skip, not an execution).
  const ranCases = new Set(ctx.executed.map((e) => `${e.contractId}|${e.template}`));
  for (const p of plans) {
    const sampled = sampledIds.has(p.contractId);
    for (const pc of p.cases) {
      templateTotals[pc.template].applicable += 1;
      if (ranCases.has(`${p.contractId}|${pc.template}`)) templateTotals[pc.template].executed += 1;
      else {
        templateTotals[pc.template].skipped += 1; // still counted, never hidden
        skippedByReason[sampled ? 'runtime-unobserved' : 'sampled-out-this-rotation']
          = (skippedByReason[sampled ? 'runtime-unobserved' : 'sampled-out-this-rotation'] ?? 0) + 1;
      }
    }
    for (const s of p.skipped) {
      templateTotals[s.template].applicable += 1;
      templateTotals[s.template].skipped += 1;
      skippedByReason[s.reason] = (skippedByReason[s.reason] ?? 0) + 1;
    }
  }

  const findings = buildSweepFindings({ contracts: byId, mismatches, metamorphic: ctx.metamorphic, limitChecks: ctx.limitChecks, semanticRevision });

  return {
    contractsTotal: contracts.length,
    sampled: sampledIds.size,
    rotation,
    sampleMod,
    rows,
    plans,
    executed: ctx.executed,
    observations,
    mismatches,
    metamorphic: ctx.metamorphic,
    limitChecks: ctx.limitChecks,
    skippedByReason,
    templateTotals,
    statusTotals: statusTotals as ContractSweepReport['statusTotals'],
    findings,
  };
}

// ── findings (deliverable 4: class per §6.1 authority level; fingerprinted; typed) ────────────────────────

function buildSweepFindings(input: {
  contracts: Map<string, ContentContract>;
  mismatches: readonly ContractMismatch[];
  metamorphic: readonly MetamorphicCheck[];
  limitChecks: ContractSweepReport['limitChecks'];
  semanticRevision: string;
}): DocbotFinding[] {
  const findings: DocbotFinding[] = [];
  const authority = (id: string): 'approved' | 'draft' => (input.contracts.get(id)?.reviewStatus === 'approved' ? 'approved' : 'draft');
  const classed = (id: string) => (authority(id) === 'approved'
    ? { class: 'verified-mechanical-bug' as const, severity: 'error' as const, confidence: 'strong' as const }
    : { class: 'questionable-interaction' as const, severity: 'question' as const, confidence: 'strong' as const });

  for (const m of input.mismatches) {
    const k = classed(m.contractId);
    findings.push(makeFinding({
      lane: CONTRACT_LANE,
      contentIds: [m.contractId],
      ruleIds: input.contracts.get(m.contractId)?.relatedRuleIds ?? [],
      expectationKind: `contract-path:${m.path}`,
      expected: m.expected,
      observed: m.observed,
      severity: k.severity,
      confidence: k.confidence,
      title: authority(m.contractId) === 'approved'
        ? `APPROVED contract violated: ${m.contractId} · ${m.path}`
        : `extracted contract disagrees with the engine: ${m.contractId} · ${m.path}`,
      summary: `${m.evidence}. Contract states ${contractStableStringify(m.expected)}, the engine measured ${contractStableStringify(m.observed)}. `
        + (authority(m.contractId) === 'approved'
          ? 'The contract is owner-approved — this is verified-bug-grade (§6.1).'
          : 'The contract is an unreviewed draft — this is a DISAGREEMENT between two machine readings, corroboration-grade only (§6.1); it queues the contract for review, it does not convict the engine.'),
      class: k.class,
      provenance: { lane: CONTRACT_LANE },
      semanticRevision: input.semanticRevision,
      contractIds: [m.contractId],
    }));
  }

  for (const mc of input.metamorphic.filter((x) => !x.diff.ok)) {
    const k = classed(mc.contractId);
    findings.push(makeFinding({
      lane: CONTRACT_LANE,
      contentIds: [mc.contractId],
      ruleIds: mc.ruleIds ?? [],
      expectationKind: `metamorphic:${mc.law}`,
      expected: mc.diff.relation.kind === 'times' ? { base: mc.diff.base, expectedVariant: mc.diff.base * mc.diff.relation.factor } : { base: mc.diff.base, expectedVariant: mc.diff.base },
      observed: { variant: mc.diff.variant },
      severity: k.severity,
      confidence: k.confidence,
      title: `metamorphic law '${mc.law}' broken on ${mc.contractId}`,
      summary: `${mc.detail}: base ${mc.diff.base}, variant ${mc.diff.variant} (expected ${mc.diff.relation.kind === 'times' ? `×${mc.diff.relation.factor}` : 'unchanged'}).`,
      class: k.class,
      provenance: { lane: CONTRACT_LANE },
      semanticRevision: input.semanticRevision,
      contractIds: [mc.contractId],
    }));
  }

  for (const l of input.limitChecks.filter((x) => !x.ok)) {
    const k = classed(l.contractId);
    findings.push(makeFinding({
      lane: CONTRACT_LANE,
      contentIds: [l.contractId],
      ruleIds: [],
      expectationKind: `limit:${l.limit}`,
      expected: 'latched after use',
      observed: 'acted again',
      severity: k.severity,
      confidence: k.confidence,
      title: `${l.limit} limit broken on ${l.contractId}`,
      summary: l.detail,
      class: k.class,
      provenance: { lane: CONTRACT_LANE },
      semanticRevision: input.semanticRevision,
      contractIds: [l.contractId],
    }));
  }

  return findings;
}

// ── deliverable 5: approved-rule violations surface as RELEASE BLOCKERS ───────────────────────────────────

/** Derive the release-blocker findings from the rules registry itself: every APPROVED rule whose
 *  `currentBehaviour` note records a live violation (the temporalWindow KNOWN_VIOLATIONS discipline writes
 *  exactly this marker). Severity 'critical', status 'known' — pinned and visible until the engine is fixed,
 *  per the §18 WP D exit gate. The caller passes `allRules()` (the registry never rides @game/sim's
 *  entrypoint toward the web bundle). */
export function releaseBlockerFindings(
  rules: ReadonlyArray<{ id: string; title: string; effective: string; currentBehaviour?: string }>,
  semanticRevision = 'dev',
): DocbotFinding[] {
  return rules
    .filter((r) => (r.effective === 'approved' || r.effective === 'revised') && /^VIOLATED/.test(r.currentBehaviour ?? ''))
    .map((r) => makeFinding({
      lane: CONTRACT_LANE,
      contentIds: [],
      ruleIds: [r.id],
      expectationKind: 'approved-rule-violation',
      expected: 'engine conforms to the approved rule',
      observed: 'engine violates the approved rule (pinned)',
      severity: 'critical',
      confidence: 'proven',
      status: 'known',
      title: `RELEASE BLOCKER — approved rule ${r.id} is violated by the engine: ${r.title}`,
      summary: `${r.currentBehaviour} — approved-rule violations are release blockers per the WP D exit gate: `
        + 'fixed, or pinned and visible in every nightly until fixed. The pin lives in temporalWindow '
        + 'KNOWN_VIOLATIONS; deleting it without the engine fix fails that suite loudly.',
      class: 'verified-mechanical-bug',
      provenance: { lane: CONTRACT_LANE },
      semanticRevision,
    }));
}
