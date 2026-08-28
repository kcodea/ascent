/**
 * DOC BOT 2.0 — convention clustering → the owner's Sitting-1 question cards (WP B;
 * owner-review-pipeline.md §3 + §5's ~70-question convention budget).
 *
 * One question per FAMILY, never per member (the R-RUNEDUP precedent: 8 family cards instead of 80 rune
 * cards). Cluster keys are the structure that already exists:
 *  · the presentation timing families (PRESENTATION_POLICIES, `factory:<do>:<on>` → family),
 *  · keyword identity (the 16-keyword union),
 *  · hero-power activation families (POWER_FAMILY),
 *  · quest reward shapes (QUEST_DEFS reward kinds),
 *  · a small hand-authored set of GLOBAL conventions that owner specs/designs established but no R- rule
 *    yet pins (gild default, multiplier gilding, threshold scope, token reachability, henchman pricing,
 *    gift casts, dual tribes, combat-gain persistence).
 *
 * Output shape = the owner format bar (2026-08-26/27): every card is self-contained — one plain statement,
 * ONE concrete example with verbatim printed text, explicit ✓/✎/✕ click semantics, and the member list.
 * These land as pending rules through the EXISTING registry mechanism: the CLI applies the same seed
 * hygiene as `rules:seed` (decisions survive; rejects tombstone) and writes
 * `packages/rules/src/registry/pendingConventions.generated.ts`.
 *
 * Approving a card writes ONE decision that rules the whole family; member contracts inherit through
 * `relatedRuleIds`, and a member that DEVIATES becomes a contract-oracle finding (WP D), not a question.
 * The owner's sitting is NOT triggered here — this only prepares the deck.
 */
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { PRESENTATION_POLICIES } from '@game/core';
import type { CardDef, Keyword } from '@game/core';
import type { GameRule, RuleEnforcement } from '@game/rules'; // type-only: erased at build, never bundles the registry
import { HEROES } from '../heroes';
import { POWER_FAMILY, type ActivationFamily } from './heroPowerFamilies';
import { TRIGGER_PHASES } from './phaseRegistry';

export const CONVENTION_QUEUE = 'contracts.conventions';

/** Inline enforcement every convention card carries (survives regeneration because the generator always
 *  stamps it): the extraction/corroboration lane re-alarms when a member's extracted shape leaves its
 *  family. The full per-contract oracle tightens this in WP D. */
const CONVENTION_ENFORCEMENT: RuleEnforcement = { kind: 'oracle', refs: ['contractExtraction'] };

// The owner's fly-through bar (2026-08-27): one compact tail, identical everywhere — the buttons say the rest.
const CLICKS = (_approve: string, _reject: string): string =>
  ' — ✓ yes · ✕ no (say why) · ✎ your wording';

const plain = (t?: string): string => (t ?? '').replace(/\*\*/g, '');
const nameOf = (id: string): string => CARD_INDEX[id]?.name ?? id;
const textOf = (id: string): string => plain(CARD_INDEX[id]?.text);
const memberLine = (ids: string[], cap = 12): string =>
  ids.slice(0, cap).map(nameOf).join(' · ') + (ids.length > cap ? ` · … and ${ids.length - cap} more` : '');

const sortedCards = (): CardDef[] => Object.values(CARD_INDEX).filter((c): c is CardDef => !!c).sort((a, b) => (a.id < b.id ? -1 : 1));

interface Row extends Omit<GameRule, 'status' | 'evidence'> { evidence?: GameRule['evidence'] }

const rule = (r: Row): GameRule => ({
  status: 'needs-ruling',
  evidence: [{ kind: 'docbot-scan', ref: CONVENTION_QUEUE }],
  sourceQueue: CONVENTION_QUEUE,
  enforcement: CONVENTION_ENFORCEMENT,
  ...r,
} as GameRule);

// ── 1. Presentation timing families ──────────────────────────────────────────────────────────────────────

function familyQuestions(): GameRule[] {
  interface Cluster { factories: Set<string>; events: Set<string>; cardIds: Set<string> }
  const clusters = new Map<string, Cluster>();
  for (const [key, entry] of Object.entries(PRESENTATION_POLICIES)) {
    const m = /^factory:([^:]+):([^:]+)$/.exec(key);
    if (!m) continue; // non-factory policy keys carry no content cluster
    const fam = (entry as { family?: string }).family;
    if (!fam) continue;
    const c = clusters.get(fam) ?? { factories: new Set(), events: new Set(), cardIds: new Set() };
    c.factories.add(m[1]!);
    c.events.add(m[2]!);
    clusters.set(fam, c);
  }
  const cards = sortedCards();
  for (const c of clusters.values()) {
    for (const def of cards) if (def.effects.some((e) => c.factories.has(e.do))) c.cardIds.add(def.id);
  }
  return [...clusters.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([fam, c]) => {
    const memberIds = [...c.cardIds].sort();
    const events = [...c.events].sort();
    const phases = [...new Set(events.map((e) => TRIGGER_PHASES[e] ?? 'unknown'))].sort();
    const exemplar = memberIds[0];
    return rule({
      id: `q-conv-family-${fam}`,
      title: `'${fam}' family · ${memberIds.length} cards`,
      statement: `All ${memberIds.length} '${fam}' cards trigger the same way, and gilding doubles their numbers.`
        + CLICKS('', ''),
      domain: 'triggers',
      currentBehaviour: `${c.factories.size} effect factories across ${memberIds.length} cards dispatch through the '${fam}' presentation family; the factoryPhase lane gates each (trigger, factory) pair.`,
      ...(exemplar ? {
        cardText: `Exemplar — ${nameOf(exemplar)}: "${textOf(exemplar)}" · Members: ${memberLine(memberIds)}`,
        example: `${nameOf(exemplar)} follows the '${fam}' convention — its trigger fires on ${events[0]}, its numbers double when gilded.`,
      } : {
        cardText: `(no live cards currently use the '${fam}' family's factories)`,
        example: `any future '${fam}' card inherits this convention at authoring time.`,
      }),
      ...(memberIds.length ? { contentIds: memberIds } : {}),
    });
  });
}

// ── 2. Keyword contracts ─────────────────────────────────────────────────────────────────────────────────

/** Display name + standing semantics per keyword code, read from the Keyword union's own doc comments
 *  (packages/core/src/types.ts) and the vocab map (Ward = DS, Rise = R, Rally = RL, Slaughter = SL). */
const KEYWORD_CONTRACTS: ReadonlyArray<{ code: Keyword; name: string; semantics: string }> = [
  { code: 'T', name: 'Taunt', semantics: 'enemies must attack your Taunt minions before anything else' },
  { code: 'DS', name: 'Ward', semantics: 'negates the first damage this minion would take, then breaks' },
  { code: 'V', name: 'Venomous', semantics: 'destroys whatever it damages; drops off after its first clash (a Cleave clash is simultaneous, so one venom can fell up to three bodies before dropping)' },
  { code: 'W', name: 'Windfury', semantics: 'attacks twice per attack turn' },
  { code: 'R', name: 'Rise', semantics: 'the first time this dies, it returns with 1 Health (its Rise spent)' },
  { code: 'C', name: 'Cleave', semantics: 'its attack also hits both minions adjacent to the target, simultaneously' },
  { code: 'M', name: 'Magnetic', semantics: 'an Attachment: can be played onto a compatible minion, merging stats and effects into it' },
  { code: 'SC', name: 'Start of Combat', semantics: 'its effect fires once when combat begins, before any attacks' },
  { code: 'CN', name: 'Consume', semantics: 'eats another minion, absorbing per its printed rule; the eaten minion is gone' },
  { code: 'FD', name: 'Fodder', semantics: 'a cheap body meant to be Consumed; Fodder-scaling effects count these' },
  { code: 'IMM', name: 'Immune', semantics: 'takes no damage from any source while the keyword holds' },
  { code: 'ST', name: 'Stealth', semantics: 'cannot be targeted by attacks; lost the moment it attacks' },
  { code: 'RL', name: 'Rally', semantics: 'triggers its effect each time this minion attacks' },
  { code: 'SL', name: 'Slaughter', semantics: 'triggers its effect each time this minion kills an enemy minion' },
  { code: 'CR', name: 'Critical Strike', semantics: 'a per-card chance to deal double damage on attack' },
  { code: 'EG', name: 'Engraved', semantics: 'stat gains during combat carry back to the run board permanently' },
];

function keywordQuestions(): GameRule[] {
  const cards = sortedCards();
  return KEYWORD_CONTRACTS.map(({ code, name, semantics }) => {
    const memberIds = cards.filter((c) => c.keywords.includes(code)).map((c) => c.id);
    const exemplar = memberIds[0];
    return rule({
      id: `q-conv-keyword-${code.toLowerCase()}`,
      title: `${name} [${code}] · ${memberIds.length} carriers`,
      statement: `${name} means: ${semantics}`
        + CLICKS('', ''),
      domain: 'keywords',
      currentBehaviour: `One shared engine path implements ${name} for all ${memberIds.length} carriers.`,
      ...(exemplar ? {
        cardText: `Exemplar — ${nameOf(exemplar)}: "${textOf(exemplar) || '(vanilla body with the keyword)'}" · Carriers: ${memberLine(memberIds)}`,
        example: `${nameOf(exemplar)} carries ${name} — in play, ${semantics}.`,
      } : {
        cardText: `(no current carrier of ${name})`,
        example: `any future ${name} card inherits this meaning.`,
      }),
      ...(memberIds.length ? { contentIds: memberIds } : {}),
    });
  });
}

// ── 3. Hero-power activation families ────────────────────────────────────────────────────────────────────

const ACTIVATION_DESCRIPTIONS: Readonly<Record<ActivationFamily, string>> = {
  'active': 'fires through the real hero-power action, with at most a board/shop target',
  'active-conditional': 'active, but only against a staged precondition (a pair to complete, a fight behind you, a spell cast)',
  'modal-choice': 'the activation carries a choice payload the player picks',
  'start-of-run': 'the work happens at run creation (opening tokens, locked Discovers, the turn-1 quest offer)',
  'turn-number': 'opens/fires on one specific turn',
  'every-n-turns': 'a repeating schedule',
  'count-threshold': 'a buy/sell/refresh/tally counter crossing a threshold',
  'shop-action-trigger': 'rides one specific shop action (a tier-up, a play position)',
  'passive-pricing': 'an always-on price/rule rewrite',
  'combat-trigger': 'the payoff happens inside or around combat',
  'unlock-recharge': 'active, but gated by its own lock/recharge schedule',
  'adopted-secondary': 'adopts other heroes\' powers through the pick ceremony',
  'retired': 'kept only so old saves resolve',
};

function heroFamilyQuestions(): GameRule[] {
  const groups = new Map<ActivationFamily, typeof HEROES[number][]>();
  for (const h of [...HEROES].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const fam = POWER_FAMILY[h.power.kind];
    if (fam === 'retired') continue;
    groups.set(fam, [...(groups.get(fam) ?? []), h]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([fam, heroes]) => {
    const exemplar = heroes[0]!;
    const lines = heroes.map((h) => `${h.name} — ${h.power.name} [${h.power.kind}]`);
    return rule({
      id: `q-conv-power-${fam}`,
      title: `'${fam}' powers · ${heroes.length} heroes`,
      statement: `These ${heroes.length} powers all ${ACTIVATION_DESCRIPTIONS[fam]}.`
        + CLICKS('', ''),
      domain: 'heroes',
      currentBehaviour: `heroPowerFamilies.ts classifies these ${heroes.length} powers as '${fam}'; the heroPowerLane + stager suites verify each against that reading.`,
      cardText: `Exemplar — ${exemplar.name}, ${exemplar.power.name}: "${plain(exemplar.power.text)}" · Members: ${lines.join(' · ')}`,
      example: `${exemplar.name}'s ${exemplar.power.name} ${ACTIVATION_DESCRIPTIONS[fam]}.`,
    });
  });
}

// ── 4. Quest reward shapes ───────────────────────────────────────────────────────────────────────────────

/**
 * PARKED BY ARCHIVE (owner ruling 2026-08-28) — appended to every `q-conv-quest-reward-*` rule's
 * `currentBehaviour`, because that field's whole job is to state what the implementation does TODAY so a
 * ruling is made against facts rather than memory. Today, quests are archived content.
 *
 * These rules are NOT retired. They describe the reward ENGINE's shape, the owner may still rule on them, and
 * a quest redesign will revive the content they cover — retiring them would throw away a standing question
 * that is still worth answering. What changes is only that the reader is told the content is inactive.
 *
 * Crucially the enforcement lane still RUNS: economyScan grants every quest through `devGrant` (which the
 * archive deliberately leaves ungated) and checks each reward's magnitude against its def. So these rules are
 * parked, not unverifiable — and the engine they describe is the same one every RUNE pays out through.
 */
const QUEST_ARCHIVE_NOTE =
  ' — PARKED BY ARCHIVE 2026-08-28: the quest system is archived (QUESTS_ARCHIVED), so no quest can be offered'
  + ' or completed in play. The reward engine is untouched and still swept: economyScan grants every quest via'
  + ' devGrant and asserts its payout, and every rune resolves through the same applyQuestReward.';

function questShapeQuestions(): GameRule[] {
  const groups = new Map<string, string[]>();
  for (const q of QUEST_DEFS) {
    const kind = String((q.reward as { kind?: string }).kind ?? 'unknown');
    groups.set(kind, [...(groups.get(kind) ?? []), q.id]);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const top = ranked.slice(0, 7);
  const rest = ranked.slice(7);
  const questName = (id: string): string => QUEST_DEFS.find((q) => q.id === id)?.name ?? id;
  const rows = top.map(([kind, ids]) => {
    const exemplar = QUEST_DEFS.find((q) => q.id === ids[0])!;
    return rule({
      id: `q-conv-quest-reward-${kind.toLowerCase()}`,
      title: `'${kind}' rewards · ${ids.length} quests`,
      statement: `These ${ids.length} quests pay the same '${kind}' reward through one shared engine — no special cases.`
        + CLICKS('', ''),
      domain: 'categories',
      currentBehaviour: `applyQuestReward resolves all ${ids.length} through the same '${kind}' branch.`
        + QUEST_ARCHIVE_NOTE,
      cardText: `Exemplar — ${exemplar.name} (${exemplar.tribe}, ${exemplar.tier}): objective ${exemplar.objective.event} × ${exemplar.objective.count} → reward '${kind}' · Members: ${ids.slice(0, 12).map(questName).join(' · ')}${ids.length > 12 ? ` · … and ${ids.length - 12} more` : ''}`,
      example: `completing ${exemplar.name} pays its '${kind}' reward through the shared engine.`,
      contentIds: [...ids].sort(),
    });
  });
  if (rest.length) {
    const ids = rest.flatMap(([, v]) => v).sort();
    rows.push(rule({
      id: 'q-conv-quest-reward-residual',
      title: `Rarer reward kinds · ${ids.length} quests`,
      statement: `These rarer reward kinds all use the same shared engine — no special cases: ${rest.map(([k, v]) => `'${k}' ×${v.length}`).join(', ')}.`
        + CLICKS('', ''),
      domain: 'categories',
      currentBehaviour: 'Each kind is one applyQuestReward branch; no per-quest special cases.' + QUEST_ARCHIVE_NOTE,
      cardText: rest.slice(0, 10).map(([k, v]) => `'${k}': ${questName(v[0]!)}`).join(' · '),
      example: `${questName(rest[0]![1][0]!)} pays its '${rest[0]![0]}' reward through the same engine as every other quest.`,
      contentIds: ids,
    }));
  }
  return rows;
}

// ── 5. Global conventions (hand-authored: owner specs/designs not yet pinned as R- rules) ────────────────

function globalQuestions(): GameRule[] {
  const cards = sortedCards();
  const goldenTextIds = cards.filter((c) => c.goldenText).map((c) => c.id);
  const multiplierIds = cards.filter((c) => c.triggerMultiplier).map((c) => c.id);
  const avengeIds = cards.filter((c) => c.effects.some((e) => e.on === 'avenge')).map((c) => c.id);
  const dualIds = cards.filter((c) => c.tribe2 ?? c.universalTribe).map((c) => c.id);
  const gildEx = goldenTextIds.includes('wolvesden') ? 'wolvesden' : goldenTextIds[0];
  return [
    rule({
      id: 'q-conv-global-gild-default',
      title: 'Gilding default: ×2',
      statement: 'A gilded card doubles its printed numbers. If gilding changes more than the numbers, the card carries its own golden text.'
        + CLICKS('', ''),
      domain: 'gilding',
      currentBehaviour: `${goldenTextIds.length} cards carry authored goldenText; every other card inherits the ×2 number-doubler.`,
      ...(gildEx ? {
        cardText: `Exemplar — ${nameOf(gildEx)}: "${textOf(gildEx)}" → gilded: "${plain(CARD_INDEX[gildEx]?.goldenText)}"`,
        example: `${nameOf(gildEx)}'s gilded text is authored because the count changes shape, not just ×2 digits.`,
      } : {}),
      evidence: [{ kind: 'code', ref: 'packages/core/src/types.ts CardDef.goldenText docblock' }],
    }),
    rule({
      id: 'q-conv-global-multiplier-gilded',
      title: `Trigger multipliers · ${multiplierIds.length} carriers`,
      statement: 'Gilded multipliers count double. Stacking copies add up; non-stackers use their best copy; the two pools add together.'
        + CLICKS('', ''),
      domain: 'multipliers',
      currentBehaviour: 'extraTriggerFires: contribution = extra × (golden ? 2 : 1); stacking summed, non-stacking best, summed + best returned.',
      cardText: `Carriers: ${memberLine(multiplierIds)}`,
      example: 'a gilded Sylus (stacking, extra 1) beside a plain Uron (non-stacking) grants 2 + 1 = 3 extra fires for a shared family.',
      contentIds: multiplierIds,
      evidence: [
        { kind: 'code', ref: 'packages/core/src/types.ts extraTriggerFires' },
        { kind: 'owner-handoff', ref: 'R-MULT-01 (registry/approved.ts)' },
      ],
    }),
    rule({
      id: 'q-conv-global-threshold-scope',
      title: `Threshold counters · ${avengeIds.length} Avenge carriers`,
      statement: 'Combat counters (Avenge) reset when the fight ends. Shop counters last the whole run. Progress never crosses between them.'
        + CLICKS('', ''),
      domain: 'persistence',
      currentBehaviour: 'Avenge progress lives in per-combat instance state; quest/cadence counters live in run state and persist.',
      ...(avengeIds[0] ? {
        cardText: `Exemplar — ${nameOf(avengeIds[0])}: "${textOf(avengeIds[0])}" · Avenge carriers: ${memberLine(avengeIds)}`,
        example: `${nameOf(avengeIds[0])} at 2 of 3 deaths when combat ends starts the next combat at 0 — but a quest at 4 of 5 buys stays at 4 next turn.`,
      } : {}),
      contentIds: avengeIds,
      evidence: [{ kind: 'owner-handoff', ref: 'R-AVWIN-04/-05 partial-progress rulings (registry/approved.ts)' }],
    }),
    rule({
      id: 'q-conv-global-token-reachability',
      title: 'Never-drawable cards',
      statement: 'Tokens, Gifts, Henchmen and archived cards never appear in shops or random pools. Only a card that names them can create them.'
        + CLICKS('', ''),
      domain: 'categories',
      currentBehaviour: 'ALL_CARDS carries every class; poolFor() draws only from set manifests, which exclude all five by construction.',
      cardText: 'Exemplar — Imp (token): reachable only through the Demon cards that summon it; never offered in a shop.',
      example: 'a rune granting Pillager (an out-of-set Undead) still resolves — the grant reaches CARD_INDEX, the pool never offers it.',
      evidence: [{ kind: 'code', ref: 'packages/content/src/index.ts ALL_CARDS doctrine comment' }],
    }),
    rule({
      id: 'q-conv-global-henchman-pricing',
      title: 'Henchman pricing',
      statement: 'Your Henchman is recruitable once per run. Its cost drops 3 after a win, 2 after a loss, never below 0.'
        + CLICKS('the pricing decay is the standing henchman law', 'wrong — state the pricing in Revise'),
      domain: 'heroes',
      currentBehaviour: 'henchmanCostOf applies win −3 / loss −2 with a 0 floor; recruit is once per run.'
        + ' — PARKED BY ARCHIVE 2026-08-28 (owner: "henchmen are not in the game and are extremely WIP / being'
        + ' removed for now"). `henchmanOffer` is gated by HENCHMEN_ARCHIVED, so no henchman is offerable and the'
        + ' pricing decay this rule describes cannot be observed in play. The decay STATE still accrues and'
        + ' henchmen.test.ts still asserts it, so the rule remains checkable and un-archiving restores it exactly.'
        + ' The ruling stands — it is the content that is inactive, not the convention.',
      cardText: 'Exemplar — Warden\'s henchman (hm_test_squire, base 10 Gold): after a win and a loss it costs 10 − 3 − 2 = 5.',
      example: 'base cost 10, then W/L/W → 10 − 3 − 2 − 3 = 2 Gold.',
      evidence: [{ kind: 'owner-handoff', ref: 'HeroDef.henchman docblock (owner spec 2026-08-03)' }],
    }),
    rule({
      id: 'q-conv-global-gift-casts',
      title: 'Gifts vs Shop spells',
      statement: 'A Gift counts as a spell cast, but is never a Shop spell — no shop offers, no copies, no cast multipliers.'
        + CLICKS('gifts are real casts, never Shop spells — standing law', 'wrong — state the gift rule in Revise'),
      domain: 'gifts',
      currentBehaviour: 'The gift flag gates every Shop-spell surface (offers, copies, multipliers); cast bookkeeping treats gifts as real casts.',
      cardText: 'Exemplar — a Gift cast with a spell-copy engine on board: the tally advances, the copier stays silent.',
      example: 'casting a Gift beside a spell copier advances "spells cast this game" by 1 and mints no copy.',
      evidence: [{ kind: 'code', ref: 'packages/core/src/types.ts CardDef.gift docblock (owner design 2026-08-26)' }],
    }),
    rule({
      id: 'q-conv-global-dual-tribe',
      title: `Dual & universal tribes · ${dualIds.length} carriers`,
      statement: 'A dual-tribe minion counts as both tribes, everywhere. A universal minion counts as every tribe.'
        + CLICKS('both/all tribe membership is the standing law for every tribe check', 'an exception exists — name it in Revise'),
      domain: 'categories',
      currentBehaviour: 'isTribe/tribe predicates fold tribe2 and universalTribe; the tribePredicates lane sweeps raw comparisons.',
      ...(dualIds[0] ? {
        cardText: `Exemplar — ${nameOf(dualIds[0])}: "${textOf(dualIds[0]) || '(dual-tribe body)'}" · Carriers: ${memberLine(dualIds)}`,
        example: `${nameOf(dualIds[0])} receives BOTH tribes' buffs and satisfies either tribe's quest counters.`,
      } : {}),
      contentIds: dualIds,
      evidence: [{ kind: 'code', ref: 'packages/core/src/types.ts CardDef.tribe2/universalTribe docblocks' }],
    }),
    rule({
      id: 'q-conv-global-combat-gains',
      title: 'Combat-only stat gains',
      statement: 'Stats gained in combat vanish when the fight ends — unless Engraved or an explicit carry-back keeps them.'
        + CLICKS('combat-only by default, Engraved/carry-back as the only exceptions — standing law', 'wrong — state the persistence rule in Revise'),
      domain: 'persistence',
      currentBehaviour: 'simulate() returns combat stats separately; only EG minions and persist* channels write back into run state.',
      cardText: 'Exemplar — a minion buffed +4/+4 mid-fight returns to its shop stats at settle unless it carries Engraved.',
      example: 'the same +4/+4 on an Engraved minion IS on the run board next shop.',
      evidence: [{ kind: 'code', ref: 'packages/core/src/types.ts Keyword EG docblock' }],
    }),
  ];
}

/** The full deterministic Sitting-1 deck (pre-hygiene). */
export function buildConventionQuestions(): GameRule[] {
  return [
    ...familyQuestions(),
    ...keywordQuestions(),
    ...heroFamilyQuestions(),
    ...questShapeQuestions(),
    ...globalQuestions(),
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The owner's fly-through bar (2026-08-27): "easy to fly through … 2-5s each". A statement longer than
 *  ~30 words cannot be read in that window — this ratchet keeps every future template honest. */
export function statementWordCount(statement: string): number {
  const body = statement.split('—')[0] ?? statement; // count the sentence, not the fixed micro-tail
  return body.trim().split(/\s+/).filter(Boolean).length;
}
