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
import { HEROES } from '../heroes';
import { PHASE_EXCUSED, TRIGGER_PHASES } from './phaseRegistry';
import { POWER_FAMILY } from './heroPowerFamilies';

export const EXTRACTOR_ID = 'contracts-extract@1';

/** Factories whose params carry a summoned token id + count with the standard gilded doubling. Mirrors the
 *  content index's TOKEN_REF_EFFECTS (kept in sync by refIntegrity — the ids must resolve either way). */
const SUMMON_FACTORIES = new Set(['deathrattleSummon', 'battlecrySummon', 'onFriendDeathSummon', 'deathrattleSummonOverflowBuff']);

const sortByContentId = (a: ContentContract, b: ContentContract): number => (a.contentId < b.contentId ? -1 : 1);

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
    effects.push({
      kind: e.do,
      ...(ex.amount ? { amount: ex.amount } : {}),
      ...(ex.refs ? { refs: ex.refs } : {}),
      ...(summonable
        ? {
            summons: {
              cardId: params!.tokenId as string,
              count: { plain: params!.count as number, ...(def.goldenText ? {} : { gilded: (params!.count as number) * 2 }) },
            },
          }
        : {}),
    });
  }

  const gildedDelta: GildedDeltaContract = def.noTriple
    ? { kind: 'none', description: 'noTriple — this card never combines into a golden' }
    : def.goldenText
      ? { kind: 'reshape', description: 'authored goldenText overrides the ×2 number-doubling default — the gilded form is stated by the text (read from CARD_INDEX at check time), not derivable as a factor' }
      : { kind: 'multiply', factor: 2, description: 'default gilded doubling of printed numbers' };

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
      ? { multiplier: { families: [...def.triggerMultiplier.families], extra: def.triggerMultiplier.extra, stacks: !!def.triggerMultiplier.stacks } }
      : {}),
    textContract: { source: 'index' },
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
  return { contracts, curatedSkipped, inventory };
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
