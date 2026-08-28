/**
 * CONTENT CONTRACT v1 — the FROZEN schema (Doc Bot 2.0 WP B; blueprint §6.3; docs/docbot2/*).
 *
 * Grown from the vertical slice's ContentContract v0 (packages/sim/src/docbot/slice/contentContract.ts,
 * quarantined prototype) by resolving every item on the slice's schema-friction list
 * (docs/devlog/2026-08-27-docbot2-vertical-slice.md — the 10 items). Where each item landed:
 *
 *  1. Hero-power identity      → the `hero:<heroId>` id namespace (helpers below); `contentType: 'hero-power'`.
 *  2. Amounts want formulas    → `AmountSpec` is a union: `const` (plain/gilded JSON) or `formula` with the
 *                                `AmountFormulaId` reference vocabulary (stat-of-source, offer-buy-stats, …).
 *  3. Threshold triggers       → DECIDED: thresholds live ON THE TRIGGER (`TriggerContract.threshold`) — one
 *                                home for Avenge (N), quest objectives, and every-N cadences. Counters that
 *                                merely accrue (no arming) are effects, not triggers.
 *  4. Multipliers first-class  → `MultiplierContract` mirrors CardDef.triggerMultiplier + `resolutionOnly`
 *                                (R-AVWIN-07's re-run-resolution-not-progress semantics).
 *  5. Copy policy, both ends   → `copyPolicy` (the copier's mode) AND `copySubject` (the copied subject's
 *                                "what of mine rides a copy" claim — the R-AVWIN-03/04 attribution home).
 *  6. Cardinality vocabulary   → `TargetContract.cardinality: 'all' | 'exactly' | 'up-to'`; the -1 sentinel
 *                                is gone (`count` is only meaningful for 'exactly'/'up-to').
 *  7. Phases derived           → `TriggerContract.phaseBasis` records HOW the phase claim was produced:
 *                                'derived:phaseRegistry' (the extractor read TRIGGER_PHASES/PHASE_EXCUSED)
 *                                vs 'authored' (a hand claim). Derived phases regenerate; they cannot drift.
 *  8. Shape-changing gilds     → `GildedDeltaContract` union. GROWN 2026-08-28 by the owner's four gilding
 *                                rulings (see the block above the union): 'multiply' (the ×factor baseline),
 *                                'gilded-token', 'reshape', 'extra-proc', 'not-applicable' (spells), plus the
 *                                retained 'none' / 'other'. Every claim carries a `basis` saying how it was
 *                                produced, so a derived shape can never masquerade as an owner ruling.
 *  9. textContract drift       → verbatim text is NEVER stored on a contract. `textContract.source: 'index'`
 *                                means the displayed-text leg is read from CARD_INDEX / RUNE_INDEX / QUEST_DEFS
 *                                / HEROES at check time; hand-authoring is reserved for `claims` ABOUT the text.
 * 10. corroborated is DERIVED  → `ContractReviewStatus` on disk is 'extracted' | 'needs-review' | 'approved'
 *                                | 'exception' — 'corroborated' exists only as `DerivedContractStatus`,
 *                                computed per run by the corroboration lane (exactly how `effectiveStatus`
 *                                derives rule status). A stored status can never hold a machine verdict.
 *
 * Doctrine carried over unchanged (§4.2/§4.3/§23): a contract states INTENT; extracted drafts are visibly
 * unreviewed (`reviewStatus: 'extracted'` + `extraction.confidence`); nothing is ever auto-approved; unstated
 * fields surface as unprobed, never as silent passes.
 *
 * Registry split (§4.6): curated contracts live in `contracts/curated/` (hand-maintained, never regenerated);
 * extracted drafts live in `contracts/extracted.generated.ts` (rewritten by `npm run contracts:extract`,
 * which must never emit an id the curated registry owns). `allContracts()` merges with curated winning.
 */

export const CONTENT_CONTRACT_SCHEMA_VERSION = 1;

/** JSON-safe value (the comparator serializes structurally; no undefined, no functions). */
export type ContractJson = string | number | boolean | null | ContractJson[] | { [k: string]: ContractJson };

/**
 * STORED review status. NOTE: no 'corroborated' here — friction item 10. Machine corroboration is derived
 * per run (see `DerivedContractStatus` + the sim-side corroboration lane), never written to disk.
 */
export type ContractReviewStatus = 'extracted' | 'needs-review' | 'approved' | 'exception';

/** The derived view the reports print: stored statuses plus the machine-computed 'corroborated'. */
export type DerivedContractStatus = ContractReviewStatus | 'corroborated';

export type ContractContentType =
  | 'minion' | 'spell' | 'token' | 'gift' | 'henchman' // cards (CARD_INDEX)
  | 'rune' // RUNE basic/epic (RUNE_INDEX)
  | 'quest' // QUEST_DEFS
  | 'hero-power'; // HEROES — the `hero:<heroId>` namespace

// ── Friction 1: the hero-power id namespace ───────────────────────────────────────────────────────────────

export const HERO_POWER_ID_PREFIX = 'hero:';
export const heroPowerContentId = (heroId: string): string => `${HERO_POWER_ID_PREFIX}${heroId}`;
export const isHeroPowerContentId = (contentId: string): boolean => contentId.startsWith(HERO_POWER_ID_PREFIX);
/** The hero id inside a `hero:<heroId>` content id, or null when the id is not in the namespace. */
export const heroIdOfContentId = (contentId: string): string | null =>
  isHeroPowerContentId(contentId) ? contentId.slice(HERO_POWER_ID_PREFIX.length) : null;

// ── Friction 6: target cardinality vocabulary ─────────────────────────────────────────────────────────────

export type TargetCardinality = 'all' | 'exactly' | 'up-to';

export interface TargetContract {
  cardinality: TargetCardinality;
  /** Required for 'exactly'/'up-to'; meaningless (and forbidden by the validator) for 'all'. */
  count?: number;
  /** Scope vocabulary ('leftmost-friendly-echo', '2-other-friendly', 'all-shop-minions', …). */
  scope: string;
}

// ── Friction 2: amount formulas ───────────────────────────────────────────────────────────────────────────

/** The reference vocabulary for non-constant magnitudes. Grown deliberately — 'other' is the audited escape
 *  hatch, and every use of it must carry a description a human can act on. */
export type AmountFormulaId =
  | 'stat-of-source' // "give this minion's Attack" (Obsidian Drake)
  | 'offer-buy-stats' // "gains the eaten offer's bought stats" (Demon Agent)
  | 'per-n-counter' // scales with a run/combat counter, step per N (per-spell, per-summon, per-kill…)
  | 'per-gold-spent' // scales with Gold spent this turn
  | 'spell-power' // printed numbers fold run spell power
  | 'escalating' // grows each time it fires (escalating cast counts)
  | 'board-derived' // reads the live board (dominant tribe, count of X…)
  | 'other';

export type AmountSpec =
  | { kind: 'const'; plain: ContractJson; gilded?: ContractJson }
  | { kind: 'formula'; formula: AmountFormulaId; params?: Record<string, ContractJson>; description: string };

// ── Triggers (friction 3 + 7) ─────────────────────────────────────────────────────────────────────────────

export interface TriggerContract {
  /** The trigger vocabulary — content EffectDef `on` values where one exists ('onDeath', 'avenge', …);
   *  'objective:<event>' for quest objectives; 'heroPower' / activation-family ids for hero powers. */
  event: string;
  phase: 'shop' | 'combat' | 'both';
  /** HOW the phase claim was produced (friction 7): derived claims regenerate from phaseRegistry and cannot
   *  drift; authored claims are hand-owned. Absent = legacy/unknown (treated as authored). */
  phaseBasis?: 'derived:phaseRegistry' | 'authored';
  /** Friction 3 — thresholds live HERE: how many qualifying events arm one resolution (Avenge N, a quest
   *  objective's count, an every-N-turns cadence). */
  threshold?: number;
  note?: string;
}

// ── Effects ───────────────────────────────────────────────────────────────────────────────────────────────

export interface SummonContract {
  cardId: string;
  count: { plain: number; gilded?: number };
}

export interface EffectContract {
  /** What the effect does. Extracted contracts use the factory id ('deathrattleSummon'); curated contracts
   *  may use intent-level kinds ('summon', 'give-own-attack') — the oracle compares stated fields only. */
  kind: string;
  amount?: AmountSpec;
  targets?: TargetContract;
  summons?: SummonContract;
  /** Content ids this effect references (granted cards, cast spells, transform targets…). */
  refs?: string[];
  note?: string;
}

// ── Friction 8: gilded deltas ─────────────────────────────────────────────────────────────────────────────

/**
 * OWNER RULINGS 2026-08-28 (the four REVISE decisions on q-conv-family-avenge / -castPayoff / -echo /
 * -spellCast). Verbatim, in the owner's words:
 *
 *  · avenge     — "in some cases it summons more minions when gilded, in other cases it summons a gilded
 *                  token instead. dunkey for example summons a gilded armadiyo, whereas gilded gemstorm
 *                  instigator would proc an additional time (double its rubies)"
 *  · castPayoff — "some versions double their numbers, some versions double their payoff or be unique. for
 *                  example, gilded baal doubles its consume quantity, but high king mykel goes from 1
 *                  adjacent to both adjacent minions."
 *  · echo       — "i would say most of the time a gilded echo doubles its value, but like said previously,
 *                  in some cases it summons a gilded token instead. i think doubling the output is the safe
 *                  baseline with outliers being other behavior"
 *  · spellCast  — "spells cannot be gilded"
 *
 * Read as a shape vocabulary: DOUBLING THE OUTPUT IS THE SAFE BASELINE ('multiply', factor 2 — the ×factor
 * kind), with three sanctioned outlier shapes and one inapplicability:
 *
 *  · 'multiply'       — the ×factor baseline: the gild multiplies printed magnitudes (factor 2 everywhere today).
 *  · 'gilded-token'   — SAME count, GILDED token identity (Dunkey → a gilded Armadiyo; engine signal:
 *                       the summon factory's `goldenTokens` param, or a golden text that names "Gilded <X>").
 *  · 'reshape'        — the gild changes the effect's SHAPE, not its number (High King Mykel: one adjacent
 *                       Shout → BOTH adjacent). The authored golden text IS the statement of the gilded form;
 *                       `goldenTextSource` points at it (friction 9 forbids storing the string itself).
 *  · 'extra-proc'     — an EXTRA RESOLUTION rather than bigger printed numbers (Gemstorm Instigator: the gild
 *                       procs an additional time — 2 Rubies twice, printed as 4).
 *  · 'not-applicable' — the object can never BE gilded, so the whole gilding aspect is inapplicable. Spells
 *                       (and Rubies) are the owner-ruled case: R-GILD-02 below; `checkTriples` skips them.
 *  · 'none'           — gilding is possible but changes nothing (retained; today only reached by hand).
 *  · 'other'          — the audited escape hatch. `basis: 'unresolved'` is its honest use: the extractor SAW
 *                       an authored golden text it could not resolve into a shape and refused to guess one
 *                       (the gap is listed in `extraction.unparsed` as 'gildedDelta.shape').
 */
export type GildedDeltaKind =
  | 'multiply' | 'gilded-token' | 'reshape' | 'extra-proc' | 'not-applicable' | 'none' | 'other';

/** HOW the shape claim was produced — the same honesty device as `TriggerContract.phaseBasis` (friction 7).
 *  Derived bases regenerate from the defs and cannot drift; authored/owner-ruling bases are hand-owned. */
export type GildedDeltaBasis =
  | 'derived:default' // no authored golden text — the object inherits the ×2 baseline
  | 'derived:golden-text' // a plain-vs-golden text diff resolved the shape
  | 'derived:token-id' // the summon factory gilds its token (`goldenTokens`), or the golden text names "Gilded <X>"
  | 'derived:ungildable' // the object can never be gilded (spell / Ruby / noTriple)
  | 'owner-ruling' // an owner ruling names this shape (the 2026-08-28 gilding rulings)
  | 'authored' // hand-authored on a curated contract
  | 'unresolved'; // the shape could NOT be derived — never guessed; listed in extraction.unparsed

/** The gilded token's identity claim. `count` is the GILDED count — for a true 'gilded-token' gild it equals
 *  the plain count (the identity changes, the number does not). */
export interface GildedTokenContract {
  cardId: string;
  count?: number;
}

interface GildedDeltaCommon {
  description: string;
  basis?: GildedDeltaBasis;
  /** Friction 9: the authored gilded text is EVIDENCE for a reshape/gilded-token/extra-proc claim, but the
   *  string is never stored — this names where the checker reads it (CARD_INDEX[contentId].goldenText). */
  goldenTextSource?: 'index:goldenText';
}

export type GildedDeltaContract =
  | (GildedDeltaCommon & { kind: 'multiply'; factor: number }) // the ×factor baseline (owner: "doubling the output is the safe baseline")
  | (GildedDeltaCommon & { kind: 'gilded-token'; token: GildedTokenContract }) // same count, gilded token identity
  | (GildedDeltaCommon & { kind: 'reshape'; effects?: EffectContract[] }) // the gild changes the SHAPE (Mykel: 1 adjacent → both)
  | (GildedDeltaCommon & { kind: 'extra-proc'; extra: number }) // one extra resolution, not a bigger number (Gemstorm)
  | (GildedDeltaCommon & { kind: 'not-applicable'; reason: string }) // spells/Rubies/ungildable — skipped WITH a reason
  | (GildedDeltaCommon & { kind: 'none' }) // gild possible, changes nothing
  | (GildedDeltaCommon & { kind: 'other' }); // audited escape hatch (basis 'unresolved' is its honest use)

/** R-GILD-02's machine face: a content type the engine can never gild. `checkTriples` skips spells and
 *  Rubies (packages/sim/src/reducer.ts), so their gilding aspect is inapplicable, not unprobed. */
export const GILD_INAPPLICABLE_TYPES: ReadonlySet<ContractContentType> = new Set(['spell']);

// ── Friction 5: copy semantics, both ends ─────────────────────────────────────────────────────────────────

/** The COPIER's claim, in the R-COPY-01/02 vocabulary. */
export interface CopyPolicyContract {
  mode: 'plain' | 'exact';
  note?: string;
}

/** The copied SUBJECT's claim: what of this object's per-instance state rides a copy of it, and what is
 *  shed. This is where R-AVWIN-03/04-shaped rulings attach — to the card whose counters are at stake. */
export interface CopySubjectContract {
  /** Per-instance state that RIDES an exact copy ('accrued-counters', 'gilding', 'granted-keywords', …). */
  rides?: string[];
  /** Per-instance state a copy SHEDS even when exact (windows already consumed, once-per-combat latches…). */
  sheds?: string[];
  note?: string;
}

// ── Friction 4: multipliers first-class ───────────────────────────────────────────────────────────────────

export interface MultiplierContract {
  families: string[];
  extra: number;
  stacks: boolean;
  /** R-AVWIN-07: the multiplier re-runs RESOLUTION, never progress counting. Stated only where ruled/known. */
  resolutionOnly?: boolean;
}

// ── Friction 9: the text leg is read from the indexes, never duplicated ──────────────────────────────────

export interface TextClaimContract {
  /** A claim ABOUT the printed text ("names the spell it casts", "prints the live counter"), not the text. */
  claim: string;
  basis?: string;
}

export interface TextContract {
  /** 'index' — the verbatim displayed text is resolved from CARD_INDEX / RUNE_INDEX / QUEST_DEFS / HEROES
   *  at check time by contentId. This is the only source; contracts never store the string. */
  source: 'index';
  claims?: TextClaimContract[];
}

// ── §4.2: extraction provenance ──────────────────────────────────────────────────────────────────────────

export interface ContractExtraction {
  /** The tool + version that produced this draft ('contracts-extract@1'). Curated contracts omit this. */
  extractor: string;
  /** How much of the object the extractor could parse into structured claims. 'low' = little beyond
   *  identity; anything unparsed is LISTED, never silently complete (§4.3). */
  confidence: 'high' | 'medium' | 'low';
  /** What the extractor saw but could not parse ('avengeImproveSummon.mode', …). */
  unparsed?: string[];
}

// ── Parked WIP surfaces (owner triage 2026-08-28) ────────────────────────────────────────────────────────

/**
 * A stamp saying "the owner has declared this surface unfinished — the contract EXISTS, it still counts in
 * every inventory, and the lanes keep measuring it, but nothing here may be read as INTENT."
 *
 * Deliberately a field rather than a `reviewStatus` value: parking is orthogonal to review (a parked draft
 * is still an extracted draft), and a stored status must never hold a machine verdict. The registry of
 * parked classes lives in `@game/rules/parked`; un-parking is one edit there.
 */
export interface ParkedContract {
  /** The `ParkedClass.id` that parked this contract ('orbit', 'celestial', …). */
  classId: string;
  /** Always 'parked-wip' — the single machine-readable reason string every lane cites. */
  reason: 'parked-wip';
  /** The owner's own words for WHY. */
  why: string;
  /** ISO date the owner parked the class. */
  since: string;
}

// ── The contract ─────────────────────────────────────────────────────────────────────────────────────────

export interface ContentContract {
  /** Identity — the only required fields. */
  contentId: string;
  contentType: ContractContentType;
  revision: number;
  reviewStatus: ContractReviewStatus;

  extraction?: ContractExtraction;
  setIds?: string[];
  tier?: number;
  tribes?: string[];
  keywords?: string[];
  tags?: string[];
  triggers?: TriggerContract[];
  effects?: EffectContract[];
  gildedDelta?: GildedDeltaContract;
  persistence?: Array<'combat-only' | 'permanent' | 'run-wide' | 'this-turn'>;
  copyPolicy?: CopyPolicyContract;
  copySubject?: CopySubjectContract;
  multiplier?: MultiplierContract;
  textContract?: TextContract;
  relatedRuleIds?: string[];
  /** Set when this contract's subject belongs to an owner-parked WIP class — see `ParkedContract`. */
  parked?: ParkedContract;
  notes?: string;
}

// ── Structural validation (the registry integrity test runs this over every stored contract) ─────────────

export function contractErrors(c: ContentContract): string[] {
  const errors: string[] = [];
  const id = c.contentId || '(blank)';
  if (!c.contentId) errors.push('blank contentId');
  if ((c.reviewStatus as string) === 'corroborated') {
    errors.push(`${id}: 'corroborated' is a DERIVED status (friction item 10) — it must never be stored`);
  }
  if (c.contentType === 'hero-power' && !isHeroPowerContentId(c.contentId)) {
    errors.push(`${id}: hero-power contracts must use the '${HERO_POWER_ID_PREFIX}<heroId>' namespace`);
  }
  if (c.contentType !== 'hero-power' && isHeroPowerContentId(c.contentId)) {
    errors.push(`${id}: the '${HERO_POWER_ID_PREFIX}' namespace is reserved for contentType 'hero-power'`);
  }
  for (const e of c.effects ?? []) {
    const t = e.targets;
    if (!t) continue;
    if (t.cardinality === 'all' && t.count !== undefined) {
      errors.push(`${id}: effect '${e.kind}' targets cardinality 'all' must not carry a count (the -1 sentinel is retired)`);
    }
    if (t.cardinality !== 'all' && (t.count === undefined || t.count < 0)) {
      errors.push(`${id}: effect '${e.kind}' targets cardinality '${t.cardinality}' needs a non-negative count`);
    }
  }
  for (const e of c.effects ?? []) {
    if (e.amount?.kind === 'formula' && e.amount.formula === 'other' && !e.amount.description.trim()) {
      errors.push(`${id}: effect '${e.kind}' uses amount formula 'other' with no description`);
    }
  }
  errors.push(...gildedDeltaErrors(c));
  return errors;
}

/**
 * The gilding leg of the validator (owner rulings 2026-08-28). Each new kind carries the one field that
 * makes it checkable, and R-GILD-02 ("spells are never gilded") is enforced structurally in BOTH directions:
 * a spell must state 'not-applicable', and no other type may borrow the spell reason.
 */
export function gildedDeltaErrors(c: ContentContract): string[] {
  const errors: string[] = [];
  const id = c.contentId || '(blank)';
  const g = c.gildedDelta;
  if (!g) {
    if (GILD_INAPPLICABLE_TYPES.has(c.contentType)) {
      errors.push(`${id}: a '${c.contentType}' contract must state gildedDelta 'not-applicable' (R-GILD-02: spells are never gilded) — an absent claim reads as unprobed`);
    }
    return errors;
  }
  if (!g.description.trim()) errors.push(`${id}: gildedDelta '${g.kind}' with no description`);
  switch (g.kind) {
    case 'multiply':
      if (!(g.factor > 0)) errors.push(`${id}: gildedDelta 'multiply' needs a positive factor`);
      break;
    case 'gilded-token':
      if (!g.token?.cardId?.trim()) errors.push(`${id}: gildedDelta 'gilded-token' needs token.cardId — the gilded identity IS the claim`);
      if (g.token?.count !== undefined && g.token.count < 0) errors.push(`${id}: gildedDelta 'gilded-token' token.count must be non-negative`);
      break;
    case 'extra-proc':
      if (!Number.isInteger(g.extra) || g.extra < 1) errors.push(`${id}: gildedDelta 'extra-proc' needs an integer extra ≥ 1 (how many EXTRA resolutions the gild buys)`);
      break;
    case 'not-applicable':
      if (!g.reason.trim()) errors.push(`${id}: gildedDelta 'not-applicable' needs a reason — an inapplicable aspect is SKIPPED WITH ITS REASON, never silently passed`);
      break;
    case 'other':
      if (g.basis !== 'unresolved' && !g.description.trim()) {
        errors.push(`${id}: gildedDelta 'other' with no description — use multiply/gilded-token/reshape/extra-proc/not-applicable, or describe it`);
      }
      break;
    default:
      break;
  }
  // R-GILD-02, both directions.
  if (GILD_INAPPLICABLE_TYPES.has(c.contentType) && g.kind !== 'not-applicable') {
    errors.push(`${id}: a '${c.contentType}' contract states gildedDelta '${g.kind}' — R-GILD-02 rules that spells are never gilded (owner, 2026-08-28), so the only legal claim is 'not-applicable'`);
  }
  // The reverse direction is narrowed to the types that can NEVER carry a spell body — a 'token' or 'gift'
  // legitimately IS a spell (spell-token ids like `copycat` are `spell: true` AND `token: true`, and
  // cardContentType resolves token first), so only a minion/henchman borrowing the spell excuse is a defect.
  if ((c.contentType === 'minion' || c.contentType === 'henchman') && g.kind === 'not-applicable' && /\bspell\b/i.test(g.reason)) {
    errors.push(`${id}: gildedDelta 'not-applicable' cites the spell reason on a '${c.contentType}' — R-GILD-02 covers spells only; state the real reason`);
  }
  // 'unresolved' is only honest when the gap is ALSO on the visible queue (§4.3).
  if (g.basis === 'unresolved' && !(c.extraction?.unparsed ?? []).includes('gildedDelta.shape')) {
    errors.push(`${id}: gildedDelta basis 'unresolved' must list 'gildedDelta.shape' in extraction.unparsed — an unresolved shape is a VISIBLE gap, never a silent one`);
  }
  if (c.parked) {
    if (c.parked.reason !== 'parked-wip') errors.push(`${id}: parked stamp must cite reason 'parked-wip', not '${c.parked.reason}'`);
    if (!c.parked.classId.trim()) errors.push(`${id}: parked stamp names no class id`);
    if (!c.parked.why.trim()) errors.push(`${id}: parked stamp carries no owner wording (the record of WHY)`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.parked.since)) errors.push(`${id}: parked stamp needs an ISO 'since' date`);
    if (c.reviewStatus === 'approved') errors.push(`${id}: a parked contract can never be 'approved' — parking means no ruling exists`);
  }
  if (c.gildedDelta && (c.gildedDelta.kind === 'other') && !c.gildedDelta.description.trim()) {
    errors.push(`${id}: gildedDelta 'other' with no description — use multiply/reshape/none or describe it`);
  }
  return errors;
}

// ── The comparator (unchanged in spirit from v0: probes record, the comparator judges) ───────────────────

/** Deterministic stringify with sorted object keys, so structural equality is order-insensitive. */
export function contractStableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(contractStableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, x]) => `${JSON.stringify(k)}:${contractStableStringify(x)}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** One engine measurement, addressed at a contract field by dotted path. */
export interface ContractObservation {
  contractId: string;
  /** Dotted path into the ContentContract ('effects.0.summons.count.plain', 'copyPolicy.mode', …). */
  path: string;
  observed: ContractJson;
  /** How the value was measured — fixture + counted evidence, one human-verifiable line. */
  evidence: string;
}

export interface ContractMismatch {
  contractId: string;
  path: string;
  expected: ContractJson;
  observed: ContractJson;
  evidence: string;
}

const valueAtPath = (root: unknown, path: string): unknown => {
  let v: unknown = root;
  for (const seg of path.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[seg];
  }
  return v;
};

/** Compare every observation against the contract it addresses. A path the contract does not state is a
 *  mismatch too (expected null) — an observation of an unstated field means the contract is incomplete,
 *  which must surface, not pass (§4.3). */
export function checkContract(contract: ContentContract, observations: readonly ContractObservation[]): ContractMismatch[] {
  const mismatches: ContractMismatch[] = [];
  for (const o of observations.filter((x) => x.contractId === contract.contentId)) {
    const expected = (valueAtPath(contract, o.path) ?? null) as ContractJson;
    if (contractStableStringify(expected) !== contractStableStringify(o.observed)) {
      mismatches.push({ contractId: contract.contentId, path: o.path, expected, observed: o.observed, evidence: o.evidence });
    }
  }
  return mismatches;
}

// ── Friction 10: the derived status (the corroboration lane's verdict shape) ─────────────────────────────

export interface ContractAspectVerdict {
  /** The aspect of the contract this verdict covers ('phase-reachability', 'text-stat-amounts', …). */
  aspect: string;
  verdict: 'agree' | 'disagree' | 'uncovered';
  /** Why (for 'uncovered': what would cover it; for 'disagree': the two sides). */
  detail?: string;
}

/**
 * Derive the reportable status from the stored one plus this run's aspect verdicts — exactly the
 * `effectiveStatus` pattern. Owner-ruled statuses ('approved'/'exception') are never moved by machines;
 * a stored 'needs-review' stays until re-extraction clears it; an 'extracted' contract reads
 * 'corroborated' only when at least one aspect is covered and no covered aspect disagrees, and
 * 'needs-review' the moment any aspect disagrees. Per-aspect honesty: corroboration is a claim about the
 * COVERED aspects only — the verdict list rides along wherever the status is shown.
 */
export function deriveContractStatus(
  stored: ContractReviewStatus,
  aspects: readonly ContractAspectVerdict[],
): DerivedContractStatus {
  if (stored !== 'extracted') return stored;
  if (aspects.some((a) => a.verdict === 'disagree')) return 'needs-review';
  if (aspects.some((a) => a.verdict === 'agree')) return 'corroborated';
  return 'extracted';
}
