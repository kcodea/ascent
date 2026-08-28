/**
 * DOC BOT 2.0 — the deterministic ContentContract extractor (WP B; blueprint §6.3 extraction tooling).
 *
 * Produces one DRAFT contract (`reviewStatus: 'extracted'`) for EVERY active content object:
 *  · cards — everything in ALL_CARDS except the archive (drawable minions + spells + tokens + gifts +
 *    henchmen + enemy filler);
 *  · runes — basic + epic stock (ARCHIVED_RUNES skipped);
 *  · quests — QUEST_DEFS;
 *  · hero powers — HEROES, in the `hero:<heroId>` namespace (friction item 1).
 *
 * HONESTY DOCTRINE (§4.2/§4.3): the extractor reads def data + factory params — the IMPLEMENTATION — so
 * every draft is a GUESS about intent, visibly marked with `extraction.confidence` and never auto-approved.
 * Anything it sees but cannot parse is LISTED in `extraction.unparsed`, never silently complete. Verbatim
 * printed text is never copied into a contract (friction 9): `textContract.source: 'index'` says the
 * displayed-text leg resolves from the indexes at check time.
 *
 * DETERMINISM: pure function of the registries — no dates, no randomness, stable sort by contentId.
 * Running it twice must produce byte-identical output (pinned in contractExtract.test.ts).
 *
 * CURATED EXCLUSION (§4.6): ids owned by contracts/curated/ are never emitted — the generated registry can
 * never overwrite a hand-authored contract (belt), and `allContracts()` merges curated-wins (braces).
 */
import {
  ALL_CARDS, ARCHIVED_CARDS, CARD_INDEX, EPIC_RUNES, GIFT_IDS, QUEST_DEFS, RUNES, SETS,
} from '@game/content';
import type { CardDef } from '@game/core';
// Deliberately the DEEP subpaths, not '@game/rules/contracts': the merged index pulls the whole extracted
// registry (one draft per active object), which must never ride @game/sim's entrypoint toward the web
// bundle (the D-2 trap the slice's semanticRevision hit first).
import {
  heroPowerContentId,
  type AmountSpec, type ContentContract, type ContractContentType, type ContractExtraction,
  type EffectContract, type GildedDeltaContract, type TriggerContract,
} from '@game/rules/contracts/schema';
import { CURATED_CONTRACT_IDS } from '@game/rules/contracts/curated';
// The parked registry is a LEAF module (zero imports) — safe at runtime on this side of the boundary.
import { PARKED_REASON, parkedClassOf } from '@game/rules/parked';
import { HEROES } from '../heroes';
import { PHASE_EXCUSED, TRIGGER_PHASES } from './phaseRegistry';
import { POWER_FAMILY } from './heroPowerFamilies';

export const EXTRACTOR_ID = 'contracts-extract@1';

/** Factories whose params carry a summoned token id + count with the standard gilded doubling. Mirrors the
 *  content index's TOKEN_REF_EFFECTS (kept in sync by refIntegrity — the ids must resolve either way). */
const SUMMON_FACTORIES = new Set(['deathrattleSummon', 'battlecrySummon', 'onFriendDeathSummon', 'deathrattleSummonOverflowBuff']);

const sortByContentId = (a: ContentContract, b: ContentContract): number => (a.contentId < b.contentId ? -1 : 1);

// ── gilded-shape derivation (owner rulings 2026-08-28) ────────────────────────────────────────────────────
//
// The owner's rule: DOUBLING THE OUTPUT IS THE SAFE BASELINE, with three sanctioned outlier shapes
// (gilded-token, reshape, extra-proc) and one inapplicability (spells are never gilded). The extractor
// DERIVES the shape where the defs actually say it and refuses to guess where they don't:
//
//   1. spell / Ruby            → 'not-applicable'  (R-GILD-02; `checkTriples` skips both — engine-confirmed)
//   2. noTriple                → 'none'            (the card never combines into a golden at all)
//   3. an owner ruling names it → that shape       (GILD_SHAPE_RULINGS, basis 'owner-ruling')
//   4. `goldenTokens` param    → 'gilded-token'    (the factory gilds the token it summons — Void Panther,
//                                                   T-Rex, Chicken Brawl; the strongest signal there is)
//   5. no goldenText           → 'multiply' ×2     (the baseline, basis 'derived:default')
//   6. goldenText that names "Gilded/Golden <X>" the plain text does not → 'gilded-token' (Dunkey, Muster General)
//   7. goldenText whose NUMBER SKELETON matches the plain text and whose numbers are each ×1 or ×2, with at
//      least one doubled → 'multiply' ×2 (the authored text merely WRITES OUT the doubling — wolvesden)
//   8. goldenText with a different skeleton → 'reshape' (the authored text IS the statement of the gilded
//      form; the checker reads it from CARD_INDEX at check time — friction 9 forbids storing the string)
//   9. anything else (skeleton matches but the numbers are neither equal nor doubled) → UNRESOLVED:
//      kind 'other', basis 'unresolved', and 'gildedDelta.shape' pushed onto extraction.unparsed. Never a
//      guessed shape, never a silent pass (§4.3).
//
// 'extra-proc' is DELIBERATELY NOT derivable: an extra resolution and a doubled printed number are the same
// text. It enters only through an owner ruling (step 3).

/** Shapes the OWNER named directly. Each carries the ruling verbatim, because no text/param diff can produce
 *  it — the printed diff for an extra proc is identical to the printed diff for a doubled number. */
const GILD_SHAPE_RULINGS: Readonly<Record<string, GildedDeltaContract>> = {
  k_gemstorm: {
    kind: 'extra-proc',
    extra: 1,
    basis: 'owner-ruling',
    goldenTextSource: 'index:goldenText',
    description: 'owner ruling 2026-08-28 (q-conv-family-avenge): "gilded gemstorm instigator would proc an '
      + 'additional time (double its rubies)" — one EXTRA resolution of the same 2-Ruby payload, which the '
      + 'gilded text prints as 4 Rubies',
  },
  b2_moonhowl: {
    kind: 'extra-proc',
    extra: 1,
    basis: 'owner-ruling',
    goldenTextSource: 'index:goldenText',
    description: 'owner ruling 2026-08-28 (q-conv-trigger-buy): "Moonhowl for example adds an instance of '
      + 'the effect, and does not double the amount granted" — the gild buys a SECOND teach per turn '
      + '("Twice per turn"), not a bigger grant; one Mage-Pup each time either way',
  },
  dw_brisbane: {
    kind: 'reshape',
    basis: 'owner-ruling',
    goldenTextSource: 'index:goldenText',
    description: 'owner ruling 2026-08-28 (q-conv-family-castPayoff): "high king mykel goes from 1 adjacent '
      + 'to both adjacent minions" — the gild changes the SHAPE of the target set, not a printed number',
  },
  dw_baal: {
    kind: 'multiply',
    factor: 2,
    basis: 'owner-ruling',
    goldenTextSource: 'index:goldenText',
    description: 'owner ruling 2026-08-28 (q-conv-family-castPayoff): "gilded baal doubles its consume '
      + 'quantity" — the baseline ×2, named by the owner as the contrast case to Mykel\'s reshape',
  },
};

const plainText = (s: string | undefined): string => (s ?? '').replace(/\*\*/g, '');
/** The text with every run of digits replaced — two texts share a skeleton when only their NUMBERS differ. */
const numberSkeleton = (s: string | undefined): string => plainText(s).replace(/\d+/g, '#');
const numbersOf = (s: string | undefined): number[] => (plainText(s).match(/\d+/g) ?? []).map(Number);

/** The "Gilded <X>" / "Golden <X>" the gilded text introduces and the plain text does not, resolved to a
 *  card id off the effects' own token refs (never a guess from a bare name). */
function gildedTokenIntroduced(def: CardDef): string | null {
  const gold = plainText(def.goldenText);
  const plain = plainText(def.text);
  if (!/\b(gilded|golden)\b/i.test(gold) || /\b(gilded|golden)\b/i.test(plain)) return null;
  for (const e of def.effects) {
    const p = e.params as Record<string, unknown> | undefined;
    for (const key of ['tokenId', 'cardId']) {
      const ref = p?.[key];
      if (typeof ref === 'string' && CARD_INDEX[ref]) return ref;
    }
  }
  return null;
}

/** Factories whose summon COUNT is structurally pinned regardless of gilding — the overflow shape summons a
 *  board-filling number and pays the remainder as stats, so the gild moves the stats, never the count.
 *  Engine-measured 2026-08-28: plain and gilded Nanon both summon 5 Nanobots. */
const COUNT_PINNED_FACTORIES = new Set(['deathrattleSummonOverflowBuff']);

/** Does this effect's summon count stay put when the body is gilded? `fixed` pins it, `goldenTokens` gilds
 *  the token INSTEAD of doubling it, and the overflow factory pins it structurally. */
const countIsPinned = (doId: string, p: Record<string, unknown> | undefined): boolean =>
  p?.fixed === true || p?.goldenTokens === true || COUNT_PINNED_FACTORIES.has(doId);

/** The gilded-token signal the FACTORY carries: `goldenTokens` gilds the summoned token instead of doubling
 *  the count (arena.ts `summonTokens`). Returns the token id + its pinned count. */
function goldenTokensEffect(def: CardDef): { cardId: string; count: number } | null {
  for (const e of def.effects) {
    const p = e.params as Record<string, unknown> | undefined;
    if (p?.goldenTokens === true && typeof p.tokenId === 'string' && CARD_INDEX[p.tokenId]) {
      return { cardId: p.tokenId, count: typeof p.count === 'number' ? p.count : 1 };
    }
  }
  return null;
}

/** A summon whose count is pinned while the rest of the body's numbers may still double — the PARTIAL gild
 *  (Amun Rab: 7 Imps stay 7 while +5/+5 becomes +10/+10). No single factor describes such a gild. */
function pinnedSummonEffect(def: CardDef): { cardId: string; count: number } | null {
  for (const e of def.effects) {
    const p = e.params as Record<string, unknown> | undefined;
    if (!countIsPinned(e.do, p)) continue;
    const ref = typeof p?.tokenId === 'string' ? p.tokenId : undefined;
    if (ref && CARD_INDEX[ref]) return { cardId: ref, count: typeof p?.count === 'number' ? p.count : 1 };
  }
  return null;
}

/** Derive one card's gilded shape. `unparsed` is appended to when the shape cannot be resolved. */
export function deriveGildedDelta(def: CardDef, unparsed: string[]): GildedDeltaContract {
  const d = def as CardDef & { ruby?: boolean };
  if (def.spell || d.ruby) {
    return {
      kind: 'not-applicable',
      reason: def.spell ? 'spell — spells are never gilded (owner ruling 2026-08-28, R-GILD-02)' : 'Ruby — Rubies never combine into a golden',
      basis: 'derived:ungildable',
      description: 'R-GILD-02: checkTriples skips spells and Rubies, so this object can never BE gilded — '
        + 'the whole gilding aspect is inapplicable, and every gilded probe against it is skipped WITH this reason',
    };
  }
  if (def.noTriple) {
    return { kind: 'none', basis: 'derived:ungildable', description: 'noTriple — this card never combines into a golden' };
  }
  const ruled = GILD_SHAPE_RULINGS[def.id];
  if (ruled) return ruled;

  const factoryToken = goldenTokensEffect(def);
  if (factoryToken) {
    return {
      kind: 'gilded-token',
      token: factoryToken,
      basis: 'derived:token-id',
      ...(def.goldenText ? { goldenTextSource: 'index:goldenText' as const } : {}),
      description: `the summon factory carries goldenTokens — a gilded body summons the SAME ${factoryToken.count} × '${factoryToken.cardId}', gilded`,
    };
  }
  const pinned = pinnedSummonEffect(def);
  if (!def.goldenText) {
    if (pinned) {
      unparsed.push('gildedDelta.shape');
      return {
        kind: 'other', basis: 'unresolved',
        description: `the summon count of '${pinned.cardId}' is pinned (fixed / overflow) so the gild is not a uniform ×2, `
          + 'and there is no authored gilded text to state what it IS — no shape could be derived (§4.3)',
      };
    }
    return { kind: 'multiply', factor: 2, basis: 'derived:default', description: 'default gilded doubling of printed numbers (the owner\'s safe baseline)' };
  }
  const textToken = gildedTokenIntroduced(def);
  if (textToken) {
    return {
      kind: 'gilded-token',
      token: { cardId: textToken, count: 1 },
      basis: 'derived:token-id',
      goldenTextSource: 'index:goldenText',
      description: `the authored gilded text names a Gilded '${textToken}' the plain text does not — the gild changes the token's IDENTITY, not the count`,
    };
  }
  if (pinned) {
    // A PARTIAL gild: the summon count stays put while the magnitudes double (Amun Rab 7 Imps + double buff,
    // Nanon's overflow). No single factor describes it, so the authored golden text IS the statement.
    return {
      kind: 'reshape', basis: 'derived:golden-text', goldenTextSource: 'index:goldenText',
      description: `a PARTIAL gild: the ${pinned.count} × '${pinned.cardId}' summon count is pinned while the rest of the `
        + 'printed numbers double, so no single factor describes it — the authored gilded text (read from CARD_INDEX '
        + 'at check time) is the statement of the gilded form',
    };
  }
  if (numberSkeleton(def.text) === numberSkeleton(def.goldenText)) {
    const p = numbersOf(def.text);
    const g = numbersOf(def.goldenText);
    const cleanDouble = p.length === g.length && p.every((n, i) => g[i] === n || g[i] === n * 2) && p.some((n, i) => n > 0 && g[i] === n * 2);
    if (cleanDouble) {
      return {
        kind: 'multiply', factor: 2, basis: 'derived:golden-text', goldenTextSource: 'index:goldenText',
        description: 'the authored gilded text WRITES OUT the ×2 baseline — same sentence, doubled numbers',
      };
    }
    if (p.length === g.length && p.every((n, i) => g[i] === n)) {
      // The gilded text repeats the plain body verbatim: the printed EFFECT does not change, so the only
      // thing the gild does is the universal base-stat doubling — the baseline, restated.
      return {
        kind: 'multiply', factor: 2, basis: 'derived:golden-text', goldenTextSource: 'index:goldenText',
        description: 'the authored gilded text repeats the plain body unchanged — nothing in the printed effect '
          + 'moves, so the gild is the base-stat ×2 baseline and nothing more',
      };
    }
    unparsed.push('gildedDelta.shape');
    return {
      kind: 'other', basis: 'unresolved', goldenTextSource: 'index:goldenText',
      description: 'authored gilded text shares the plain text\'s sentence but its numbers are neither equal nor '
        + 'doubled — no shape could be derived, and the extractor does not guess one (§4.3)',
    };
  }
  return {
    kind: 'reshape', basis: 'derived:golden-text', goldenTextSource: 'index:goldenText',
    description: 'authored goldenText overrides the ×2 number-doubling default — the gilded form is stated by '
      + 'the text (read from CARD_INDEX at check time), not derivable as a factor',
  };
}

/** shop/combat/both for one (trigger, factory) pair, per the phase registry (friction 7 — derived, not
 *  hand-stamped). Returns a note when the derivation is uncertain. */
function derivePhase(on: string, doId: string, combatOnly: boolean | undefined): { phase: TriggerContract['phase']; note?: string } {
  if (combatOnly) return { phase: 'combat', note: 'data-level combatOnly gate on the effect' };
  const home = TRIGGER_PHASES[on];
  if (!home) return { phase: 'both', note: `trigger '${on}' not in TRIGGER_PHASES — phase unknown` };
  if (home === 'recruit') return { phase: 'shop' };
  if (home === 'combat') return { phase: 'combat' };
  const excuse = PHASE_EXCUSED[doId];
  if (excuse && excuse.kind !== 'needs-triage') {
    return excuse.phase === 'combat'
      ? { phase: 'shop', note: `combat side excused: ${excuse.kind}` }
      : { phase: 'combat', note: `recruit side excused: ${excuse.kind}` };
  }
  if (excuse) return { phase: 'both', note: 'phase excuse is needs-triage — reachability unruled' };
  return { phase: 'both' };
}

/** Classify one factory's params into amount / refs / unparsed. */
function extractParams(doId: string, params: Record<string, unknown> | undefined, opts: { skipNumeric?: string[] } = {}): {
  amount?: AmountSpec; refs?: string[]; unparsed: string[];
} {
  const numeric: Record<string, number> = {};
  const refs: string[] = [];
  const unparsed: string[] = [];
  for (const [k, v] of Object.entries(params ?? {})) {
    if (typeof v === 'number' && !(opts.skipNumeric ?? []).includes(k)) numeric[k] = v;
    else if (typeof v === 'number') { /* consumed elsewhere (e.g. avenge threshold) */ }
    else if (typeof v === 'string' && CARD_INDEX[v]) refs.push(v);
    else unparsed.push(`${doId}.${k}`);
  }
  const keys = Object.keys(numeric).sort();
  const amount: AmountSpec | undefined = keys.length
    ? { kind: 'const', plain: Object.fromEntries(keys.map((k) => [k, numeric[k]!])) }
    : undefined;
  return { ...(amount ? { amount } : {}), ...(refs.length ? { refs: [...refs].sort() } : {}), unparsed };
}

function confidenceOf(effects: EffectContract[], unparsed: string[]): ContractExtraction['confidence'] {
  if (effects.length === 0) return 'high'; // vanilla body: identity + stats are the whole story
  const parsed = effects.filter((e) => e.amount ?? e.refs ?? e.summons ?? e.targets).length;
  if (unparsed.length === 0 && parsed === effects.length) return 'high';
  return parsed > 0 ? 'medium' : 'low';
}

const GIFT_ID_SET: ReadonlySet<string> = new Set(GIFT_IDS);

function cardContentType(def: CardDef): ContractContentType {
  if (GIFT_ID_SET.has(def.id)) return 'gift';
  if (def.henchman) return 'henchman';
  if (def.token) return 'token';
  if (def.spell) return 'spell';
  return 'minion';
}

function extractCard(def: CardDef): ContentContract {
  const unparsed: string[] = [];
  const triggers: TriggerContract[] = [];
  const effects: EffectContract[] = [];
  const seenTriggers = new Set<string>();

  for (const e of def.effects) {
    const { phase, note } = derivePhase(e.on, e.do, e.combatOnly);
    const params = e.params as Record<string, unknown> | undefined;
    const threshold = e.on === 'avenge' && typeof params?.count === 'number' ? params.count : undefined;
    const tKey = `${e.on}|${phase}|${threshold ?? ''}`;
    if (!seenTriggers.has(tKey)) {
      seenTriggers.add(tKey);
      triggers.push({
        event: e.on, phase, phaseBasis: 'derived:phaseRegistry',
        ...(threshold !== undefined ? { threshold } : {}),
        ...(note ? { note } : {}),
      });
    }
    const ex = extractParams(e.do, params, { skipNumeric: threshold !== undefined ? ['count'] : [] });
    unparsed.push(...ex.unparsed);
    if (e.align) unparsed.push(`${e.do}.align:${e.align}`);
    const summonable = SUMMON_FACTORIES.has(e.do) && typeof params?.tokenId === 'string' && typeof params?.count === 'number';
    // The gilded COUNT is only the plain × 2 when the gild really is a number-doubler: authored goldenText
    // states its own gilded form, `fixed` pins the count, and `goldenTokens` gilds the token INSTEAD of
    // doubling it (owner rulings 2026-08-28 — the gilded-token shape). Any of those and the count is unstated.
    const countDoubles = !def.goldenText && !countIsPinned(e.do, params);
    effects.push({
      kind: e.do,
      ...(ex.amount ? { amount: ex.amount } : {}),
      ...(ex.refs ? { refs: ex.refs } : {}),
      ...(summonable
        ? {
            summons: {
              cardId: params!.tokenId as string,
              count: { plain: params!.count as number, ...(countDoubles ? { gilded: (params!.count as number) * 2 } : {}) },
            },
          }
        : {}),
    });
  }

  const gildedDelta: GildedDeltaContract = deriveGildedDelta(def, unparsed);

  const setIds = (Object.values(SETS) as { id: string; own: readonly CardDef[] }[])
    .filter((s) => s.own.some((c) => c.id === def.id)).map((s) => s.id).sort();
  const tribes = [def.tribe, ...(def.tribe2 ? [def.tribe2] : [])];
  const tags = [
    `tier:${def.tier}`,
    ...(def.universalTribe ? ['universal-tribe'] : []),
    ...(def.imp ? ['imp'] : []),
    ...(def.celestial ? ['celestial'] : []),
    ...(def.rewardSpell ? ['reward-spell'] : []),
  ];
  if (def.triggerMultiplier) tags.push(...def.triggerMultiplier.families.map((f) => `multiplier:${f}`));
  const sortedUnparsed = [...new Set(unparsed)].sort();

  // Owner-parked WIP surface (2026-08-28): the contract is still emitted and still counted — it just carries
  // a visible stamp saying nothing here may be read as intent. Un-parking is one edit in @game/rules/parked.
  const parkedClass = parkedClassOf({
    tribes,
    flags: def.celestial ? ['celestial'] : [],
    triggers: triggers.map((t) => t.event),
  });

  return {
    contentId: def.id,
    contentType: cardContentType(def),
    revision: 1,
    reviewStatus: 'extracted',
    extraction: { extractor: EXTRACTOR_ID, confidence: confidenceOf(effects, sortedUnparsed), ...(sortedUnparsed.length ? { unparsed: sortedUnparsed } : {}) },
    ...(setIds.length ? { setIds } : {}),
    tier: def.tier,
    tribes,
    ...(def.keywords.length ? { keywords: [...def.keywords] } : {}),
    ...(tags.length ? { tags } : {}),
    ...(triggers.length ? { triggers } : {}),
    ...(effects.length ? { effects } : {}),
    gildedDelta,
    ...(def.triggerMultiplier
      ? { multiplier: {
        families: [...def.triggerMultiplier.families],
        ...(def.triggerMultiplier.factor !== undefined
          ? { factor: def.triggerMultiplier.factor }
          : { extra: def.triggerMultiplier.extra }),
        stacks: !!def.triggerMultiplier.stacks,
      } }
      : {}),
    textContract: { source: 'index' },
    ...(parkedClass
      ? { parked: { classId: parkedClass.id, reason: PARKED_REASON, why: parkedClass.why, since: parkedClass.since } }
      : {}),
  };
}

/** Flatten a quest/rune reward tree ({kind:'multi', rewards:[…]} nests) into leaf rewards. */
function leafRewards(reward: unknown): Record<string, unknown>[] {
  const r = reward as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return [];
  if (r.kind === 'multi' && Array.isArray(r.rewards)) return (r.rewards as unknown[]).flatMap(leafRewards);
  return [r];
}

function extractReward(reward: unknown, unparsed: string[]): EffectContract[] {
  return leafRewards(reward).map((leaf) => {
    const kind = `reward:${String(leaf.kind ?? 'unknown')}`;
    const numeric: Record<string, number> = {};
    const refs: string[] = [];
    for (const [k, v] of Object.entries(leaf)) {
      if (k === 'kind') continue;
      if (typeof v === 'number') numeric[k] = v;
      else if (typeof v === 'string' && CARD_INDEX[v]) refs.push(v);
      else if (Array.isArray(v) && v.every((x) => typeof x === 'string' && CARD_INDEX[x])) refs.push(...(v as string[]));
      else unparsed.push(`${kind}.${k}`);
    }
    const keys = Object.keys(numeric).sort();
    return {
      kind,
      ...(keys.length ? { amount: { kind: 'const' as const, plain: Object.fromEntries(keys.map((k) => [k, numeric[k]!])) } } : {}),
      ...(refs.length ? { refs: [...refs].sort() } : {}),
    };
  });
}

interface RuneLike { id: string; name: string; cost: number; text?: string; reward?: unknown; sets?: string[] }

function extractRune(rune: RuneLike, forge: 'basic' | 'epic'): ContentContract {
  const unparsed: string[] = [];
  const effects = extractReward(rune.reward, unparsed);
  const sortedUnparsed = [...new Set(unparsed)].sort();
  return {
    contentId: rune.id,
    contentType: 'rune',
    revision: 1,
    reviewStatus: 'extracted',
    extraction: { extractor: EXTRACTOR_ID, confidence: confidenceOf(effects, sortedUnparsed), ...(sortedUnparsed.length ? { unparsed: sortedUnparsed } : {}) },
    ...(rune.sets?.length ? { setIds: [...rune.sets].sort() } : {}),
    tags: [`runeforge:${forge}`, `cost:${rune.cost}`],
    ...(effects.length ? { effects } : {}),
    textContract: { source: 'index' },
  };
}

interface QuestLike {
  id: string; tribe: string; tier: string; repeatable?: boolean; sets?: string[]; wave?: number;
  objective: { event: string; count: number; tribe?: string; filter?: string };
  reward: unknown;
}

function extractQuest(q: QuestLike): ContentContract {
  const unparsed: string[] = [];
  const effects = extractReward(q.reward, unparsed);
  const sortedUnparsed = [...new Set(unparsed)].sort();
  const scopeNote = [q.objective.tribe ? `tribe:${q.objective.tribe}` : '', q.objective.filter ? `filter:${q.objective.filter}` : '']
    .filter(Boolean).join(' ');
  return {
    contentId: q.id,
    contentType: 'quest',
    revision: 1,
    reviewStatus: 'extracted',
    extraction: { extractor: EXTRACTOR_ID, confidence: confidenceOf(effects, sortedUnparsed), ...(sortedUnparsed.length ? { unparsed: sortedUnparsed } : {}) },
    ...(q.sets?.length ? { setIds: [...q.sets].sort() } : {}),
    tags: [`quest-tier:${q.tier}`, `quest-tribe:${q.tribe}`, ...(q.repeatable ? ['repeatable'] : []), ...(q.wave !== undefined ? [`wave:${q.wave}`] : [])],
    triggers: [{
      event: `objective:${q.objective.event}`,
      phase: 'both',
      phaseBasis: 'authored',
      threshold: q.objective.count,
      note: `quest objective counter${scopeNote ? ` (${scopeNote})` : ''} — which phases feed it is per-event (not derived here)`,
    }],
    ...(effects.length ? { effects } : {}),
    textContract: { source: 'index' },
  };
}

function extractHeroPower(hero: (typeof HEROES)[number]): ContentContract {
  const family = POWER_FAMILY[hero.power.kind];
  const activeLike = family === 'active' || family === 'active-conditional' || family === 'modal-choice' || family === 'unlock-recharge';
  const trigger: TriggerContract = activeLike
    ? { event: 'heroPower', phase: 'shop', phaseBasis: 'authored' }
    : family === 'combat-trigger'
      ? { event: `hero:${family}`, phase: 'combat', phaseBasis: 'authored' }
      : { event: `hero:${family}`, phase: 'shop', phaseBasis: 'authored' };
  const p = hero.power;
  const tags = [
    `activation:${family}`,
    `power-kind:${p.kind}`,
    ...(p.oncePerGame ? ['once-per-game'] : []),
    ...(p.passive ? ['passive'] : []),
    ...(p.untargeted ? ['untargeted'] : []),
    ...(p.maxUses !== undefined ? [`max-uses:${p.maxUses}`] : []),
    ...(p.usesPerTurn !== undefined ? [`uses-per-turn:${p.usesPerTurn}`] : []),
    ...(p.unlockWave !== undefined ? [`unlock-wave:${p.unlockWave}`] : []),
    ...(p.cost !== undefined ? [`cost:${p.cost}`] : []),
    ...(hero.wip ? ['wip'] : []),
    ...(hero.practiceOnly ? ['practice-only'] : []),
  ];
  return {
    contentId: heroPowerContentId(hero.id),
    contentType: 'hero-power',
    revision: 1,
    reviewStatus: 'extracted',
    // The magnitude/behaviour of a power lives in reducer branches, not declarative params — the extractor
    // can only claim identity + activation shape. Visibly LOW confidence, with the gap listed (§4.3).
    extraction: { extractor: EXTRACTOR_ID, confidence: 'low', unparsed: [`heroPower:${p.kind}.behaviour`] },
    tags,
    triggers: [trigger],
    effects: [{ kind: `hero-power:${p.kind}` }],
    textContract: { source: 'index' },
  };
}

export interface ExtractionResult {
  contracts: ContentContract[];
  /** Ids skipped because the curated registry owns them (§4.6). */
  curatedSkipped: string[];
  inventory: Record<ContractContentType, number>;
  /** Parked contracts per class id — VISIBLE in the counts, never dropped from the inventory (2026-08-28). */
  parked: Record<string, number>;
}

/** The full deterministic sweep. Pure function of the content/hero registries. */
export function extractAllContracts(): ExtractionResult {
  const archived = new Set(ARCHIVED_CARDS.map((c) => c.id));
  const drafts: ContentContract[] = [];

  for (const def of ALL_CARDS) {
    if (archived.has(def.id)) continue; // the archive is inactive content — out of the inventory by design
    drafts.push(extractCard(def));
  }
  for (const r of RUNES) drafts.push(extractRune(r as RuneLike, 'basic'));
  for (const r of EPIC_RUNES) drafts.push(extractRune(r as RuneLike, 'epic'));
  for (const q of QUEST_DEFS) drafts.push(extractQuest(q as unknown as QuestLike));
  for (const h of HEROES) drafts.push(extractHeroPower(h));

  const curatedSkipped = drafts.filter((c) => CURATED_CONTRACT_IDS.has(c.contentId)).map((c) => c.contentId).sort();
  const contracts = drafts.filter((c) => !CURATED_CONTRACT_IDS.has(c.contentId)).sort(sortByContentId);
  const inventory = {} as Record<ContractContentType, number>;
  for (const c of [...contracts]) inventory[c.contentType] = (inventory[c.contentType] ?? 0) + 1;
  const parked: Record<string, number> = {};
  for (const c of contracts) if (c.parked) parked[c.parked.classId] = (parked[c.parked.classId] ?? 0) + 1;
  return { contracts, curatedSkipped, inventory, parked };
}

/**
 * ARCHIVED CONTENT CLASSES (owner ruling 2026-08-28) — whole `contentType`s whose system is switched off.
 *
 * The point of naming them here is HONESTY, not exemption. An archived class keeps its contracts: they stay
 * extracted, stay in the committed registry, stay counted by the WP B inventory gate and stay swept by the
 * text/oracle lanes. What changes is only that the report SAYS SO — `archivedInventory()` below feeds an
 * `archived:` line into the Doc Bot report so 117 quest contracts and 1 henchman contract are visibly
 * accounted for as inactive content rather than silently read as live coverage.
 *
 * This is the opposite of how `ARCHIVED_CARDS` is handled two functions up, and deliberately so. An archived
 * CARD leaves the inventory because its def is moved out of every pool AND out of `ALL_CARDS`' active half,
 * so demanding a contract for it would be demanding coverage of something that no longer exists in the
 * content model. An archived quest/henchman is still fully present in `QUEST_DEFS` / `HENCHMEN` and still
 * fully resolvable — only its OFFER producer is gated (`QUESTS_ARCHIVED` / `HENCHMEN_ARCHIVED`, config.ts).
 * Dropping those 118 contracts would delete real, still-true coverage and quietly shrink every headline
 * number in the report. So: counted, and labelled.
 */
export const ARCHIVED_CONTENT_TYPES: ReadonlySet<ContractContentType> = new Set<ContractContentType>([
  'quest', // the quest system — archived 2026-08-28, see QUESTS_ARCHIVED
  'henchman', // the henchman system — archived 2026-08-28, see HENCHMEN_ARCHIVED
]);

/** Per-class counts of contracts belonging to an ARCHIVED content class, plus their total. Reported, never
 *  subtracted — see `ARCHIVED_CONTENT_TYPES`. */
export function archivedInventory(contracts: readonly ContentContract[]): { byType: Record<string, number>; total: number } {
  const byType: Record<string, number> = {};
  let total = 0;
  for (const c of contracts) {
    if (!ARCHIVED_CONTENT_TYPES.has(c.contentType)) continue;
    byType[c.contentType] = (byType[c.contentType] ?? 0) + 1;
    total++;
  }
  return { byType, total };
}

/** The active-object inventory the WP B exit gate counts: every id that must hold a contract. */
export function activeContentIds(): string[] {
  const archived = new Set(ARCHIVED_CARDS.map((c) => c.id));
  return [
    ...ALL_CARDS.filter((c) => !archived.has(c.id)).map((c) => c.id),
    ...RUNES.map((r) => r.id),
    ...EPIC_RUNES.map((r) => r.id),
    ...QUEST_DEFS.map((q) => q.id),
    ...HEROES.map((h) => heroPowerContentId(h.id)),
  ].sort();
}
