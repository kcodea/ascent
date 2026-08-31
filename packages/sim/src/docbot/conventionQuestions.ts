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
import { ARCHIVED_CARDS, CARD_INDEX, QUEST_DEFS } from '@game/content';
import { PRESENTATION_POLICIES } from '@game/core';
import type { CardDef, Keyword } from '@game/core';
import type { GameRule, RuleEnforcement } from '@game/rules'; // type-only: erased at build, never bundles the registry
// Runtime, but the parked registry is a LEAF module (zero imports) — it carries no registry weight.
import { parkedClassForFamily, parkedClassForTrigger, parkedClassOf } from '@game/rules/parked';
import { HEROES } from '../heroes';
import { POWER_FAMILY, type ActivationFamily } from './heroPowerFamilies';
import { TRIGGER_PHASES } from './phaseRegistry';

export const CONVENTION_QUEUE = 'contracts.conventions';

/** Inline enforcement every convention card carries (survives regeneration because the generator always
 *  stamps it): the extraction/corroboration lane re-alarms when a member's extracted shape leaves its
 *  family. The full per-contract oracle tightens this in WP D. */
const CONVENTION_ENFORCEMENT: RuleEnforcement = { kind: 'oracle', refs: ['contractExtraction'] };

// The owner's fly-through bar (2026-08-27): one compact tail, identical everywhere — the buttons say the rest.
/** 'card' / 'cards' — the owner's four new trigger families (2026-08-28) can hold a single member, and
 *  "All 1 of these ... · 1 cards" is exactly the kind of sentence the fly-through bar exists to stop. */
const cards = (n: number): string => `${n} ${n === 1 ? 'card' : 'cards'}`;
/** "All 3 of these fire" / "This 1 card fires" — the subject changes with the count, so does the verb. */
const allOfThese = (n: number): string => (n === 1 ? 'The 1 card here fires' : `All ${n} of these fire`);

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

// ── The gilding half of a family card (owner rulings 2026-08-28) ─────────────────────────────────────────
//
// The first deck asserted one flat claim on every family card: "gilding doubles their numbers". The owner
// REVISEd four of them with the real rule, and it is not flat:
//   avenge     — "in some cases it summons more minions when gilded, in other cases it summons a gilded
//                 token instead. dunkey for example summons a gilded armadiyo, whereas gilded gemstorm
//                 instigator would proc an additional time (double its rubies)"
//   castPayoff — "gilded baal doubles its consume quantity, but high king mykel goes from 1 adjacent to
//                 both adjacent minions."
//   echo       — "doubling the output is the safe baseline with outliers being other behavior"
//   spellCast  — "spells cannot be gilded"
// So: DOUBLING THE OUTPUT IS THE BASELINE, the outliers are named where the owner named them, and a family
// whose members are all spells says the honest thing instead (R-GILD-01 / R-GILD-02).

interface GildClaim { statement: string; currentBehaviour: string; example: string }

/** The three families the owner annotated by hand, in his own terms. */
const OWNER_GILD_NOTES: Readonly<Record<string, GildClaim>> = {
  avenge: {
    statement: 'Gilding doubles their output, except a few that summon a gilded token or add a proc.',
    currentBehaviour: 'the ×2 baseline, with Dunkey/Muster General/Steadfast Sentinel summoning a GILDED token at the same count, and Gemstorm Instigator buying one extra proc (owner ruling 2026-08-28).',
    example: 'Gilded Dunkey summons ONE gilded Armadiyo, not two plain ones.',
  },
  castPayoff: {
    statement: 'Gilding doubles their output, except High King Mykel, whose gild widens its targets instead.',
    currentBehaviour: 'the ×2 baseline (gilded Baal consumes 2 Shop minions), with High King Mykel reshaped instead — one adjacent Shout becomes BOTH adjacent (owner ruling 2026-08-28).',
    example: 'Gilded Baal doubles its consume quantity; gilded High King Mykel triggers both adjacent Shouts.',
  },
  echo: {
    statement: 'Gilding doubles their output; a few summon a gilded token instead.',
    currentBehaviour: 'the ×2 baseline is the safe reading, with Void Panther / T-Rex / Chicken Brawl gilding the token they summon instead of doubling the count (owner ruling 2026-08-28).',
    example: 'Gilded T-Rex summons one GILDED T-Rex Baby, while gilded Wolves Den summons 6 Crypt Wolves instead of 3.',
  },
};

const GILD_DEFAULT: GildClaim = {
  statement: 'Gilding doubles their output.',
  currentBehaviour: 'the ×2 baseline; any member whose gild changes shape instead carries authored golden text (R-GILD-01).',
  example: 'its printed numbers double when the card is gilded.',
};

const GILD_NONE: GildClaim = {
  statement: 'These are the spells themselves, and spells are never gilded.',
  currentBehaviour: 'INAPPLICABLE — checkTriples skips spells and Rubies, so no member of this family can ever BE gilded (R-GILD-02, owner ruling 2026-08-28).',
  example: 'three copies of it never combine into a golden one, so it has no gilded form at all.',
};

/** The gilding claim for one family — derived where the members decide it, owner-annotated where he spoke.
 *  R-GILD-02 wins over any family note: a family of spells has no gilding to describe, and a MIXED family
 *  says the split out loud rather than asserting a doubling that 99 of its 106 members cannot do. */
export function gildClaimFor(fam: string, memberIds: readonly string[]): GildClaim {
  const isUngildable = (id: string): boolean => {
    const def = CARD_INDEX[id] as (CardDef & { ruby?: boolean }) | undefined;
    return !!def && (!!def.spell || !!def.ruby);
  };
  const ungildable = memberIds.filter(isUngildable).length;
  if (memberIds.length > 0 && ungildable === memberIds.length) return GILD_NONE;
  if (ungildable > 0) {
    const rest = memberIds.length - ungildable;
    return {
      statement: `${ungildable} are spells, which never gild; the other ${rest} double their output.`,
      currentBehaviour: `${ungildable} members are spells or Rubies and can never BE gilded (R-GILD-02, owner ruling 2026-08-28) — their gilding aspect is inapplicable, not unprobed; the remaining ${rest} inherit the ×2 baseline.`,
      example: 'three copies of a spell never combine into a golden one, so most of this family has no gilded form at all.',
    };
  }
  return OWNER_GILD_NOTES[fam] ?? GILD_DEFAULT;
}


// ── 1. Trigger clusters (was: presentation timing families) ──────────────────────────────────────────────

/**
 * OWNER RULING 2026-08-28 on `q-conv-family-economy` (REVISE), verbatim:
 *   "this family seems extremely varied. there are cards that proc on sell in this category, there are some
 *    shouts, there are cards that trigger from buying x cards, there are cards that learn other spells etc.
 *    this does not seem like a cohesive family of cards or rulings to me."
 *
 * He was right, and the fault was the CLUSTER KEY. A presentation family is a PRESENTATION concept (which
 * beat the effect gets), and several families collect factories that fire on completely different moments —
 * `economy` alone spans 11 distinct trigger events. A card that says "all N of these trigger the same way"
 * is then simply FALSE, and an approval on it would rule things the owner never read.
 *
 * So a family is only a legitimate question when it is single-trigger. Families that span more than one
 * TRIGGER GROUP are dissolved and their factories re-clustered by trigger across ALL such families at once
 * (so `economy` and `economyReact` do not each mint a duplicate "on sell" card). Every emitted card then
 * names one trigger moment that every member genuinely shares — the machine-checkable version of the
 * owner's complaint lives in conventionCohesion.test.ts.
 *
 * Anything that lands in no group is NOT forced into a false family: it becomes the residual card, which
 * says out loud that its members are unrelated and that ruling each individually is the honest option.
 */
interface TriggerGroup {
  id: string;
  /** The plain-English trigger moment the card names. Must be true of EVERY member. */
  label: string;
  events: readonly string[];
}

const TRIGGER_GROUPS: readonly TriggerGroup[] = [
  { id: 'sell', label: 'you sell a card', events: ['onSell', 'minionSold'] },
  { id: 'buy', label: 'you buy a card', events: ['onBuy', 'cardsBought', 'spellBought'] },
  { id: 'goldSpent', label: 'you spend Gold this turn', events: ['goldSpent'] },
  // "we should probably standardize our ruby terminology to 'cast'" (owner, q-conv-trigger-ruby): a Ruby is
  // never PLAYED — 'played' is reserved for a card leaving your hand. The factory ids keep their old names
  // (internal; renaming them would churn run state for a display-only change).
  // `rubyPlayedAnywhere` joined 2026-08-31 with Double Trouble. It is the same MOMENT as `onRubyPlayed` —
  // a Ruby landing — seen by a watcher elsewhere on the board rather than by the target, so it belongs in
  // this group. Left ungrouped it dragged its card into whatever presentation family it carried, which is
  // what dissolved the (already-approved) 'passive' family question by making that cluster span two groups.
  { id: 'ruby', label: 'a Ruby is gained or cast', events: ['onRubyPlayed', 'onGetRuby', 'rubyCast', 'rubyPlayedAnywhere'] },
  { id: 'damaged', label: 'a friendly minion takes or deals damage', events: ['onDamaged', 'friendlyDemonDealtDamage'] },
  { id: 'consume', label: 'this minion Consumes something', events: ['onConsume'] },
  { id: 'gainAttack', label: 'a friendly minion gains Attack', events: ['onGainAttack'] },
  { id: 'overflow', label: 'a summon overflows a full board', events: ['summonOverflow'] },
  // Owner ruling 2026-08-28 (q-conv-trigger-residual): the leftovers are NOT unrelated one-offs — they are
  // four small families the owner intends to grow ("gangplank and kegheart are cards that track when cards
  // get added to hand, fel conjurer is a start of turn get spell to hand, reflect and mirrorwing are when
  // targeted by spell minions, hellrider is a refresh mechanic minion"). Naming them now means the next card
  // added to each joins an existing convention instead of re-opening a settled question.
  { id: 'gainCard', label: 'a card is added to your hand', events: ['onGainCard'] },
  { id: 'startOfTurn', label: 'the turn starts', events: ['startOfTurn'] },
  { id: 'spellTargeted', label: 'a spell targets this minion', events: ['spellCastOnThis'] },
  { id: 'shopRefresh', label: 'you refresh the Shop', events: ['shopRefreshed'] },
];

const GROUP_OF_EVENT: Readonly<Record<string, TriggerGroup>> = Object.fromEntries(
  TRIGGER_GROUPS.flatMap((g) => g.events.map((e) => [e, g] as const)),
);

/** The trigger group an event belongs to, or undefined (an ungrouped event lands in the residual card). */
export const triggerGroupOf = (event: string): TriggerGroup | undefined => GROUP_OF_EVENT[event];

/** One emitted convention cluster, exported so the cohesion test can judge it independently. */
export interface ConventionCluster {
  /** The rule id this cluster becomes. */
  ruleId: string;
  kind: 'family' | 'trigger' | 'residual';
  /** The presentation family, for `kind: 'family'`. */
  family?: string;
  /** Every trigger event the cluster's factories fire on. */
  events: string[];
  factories: string[];
  memberIds: string[];
  /** Set when this cluster came out of a dissolved (multi-trigger) family. */
  fromFamilies?: string[];
}

/** The parked classes this build suppressed, and what they cost the deck (visible, never silent). */
export interface ParkedSuppression { classId: string; families: string[]; membersStripped: number }

/** Cards REMOVED from play (`ARCHIVED_CARDS`) resolve by id forever — saved runs and replays need them — but
 *  they are in no set pool, so a convention about them rules nothing a player can reach. Ruling on one wastes
 *  the scarcest resource the deck spends: owner attention. Found the hard way on 2026-08-28, when the Consume
 *  and Ruby cards printed archived Avarice Incarnate and Candle Conduit as their EXEMPLAR and the owner wrote
 *  two rulings against dead content. */
const ARCHIVED_IDS: ReadonlySet<string> = new Set(ARCHIVED_CARDS.map((c) => c.id));

/** Every card the deck may bind — parked (owner-WIP) and archived (owner-REMOVED) content is stripped from
 *  EVERY card's member list, so approving a convention can never silently rule a surface the owner has not
 *  designed yet, or one no player can reach. */
const liveCards = (): CardDef[] => sortedCards().filter((c) => !isParkedCard(c.id) && !ARCHIVED_IDS.has(c.id));

const isParkedCard = (id: string): boolean => {
  const def = CARD_INDEX[id];
  if (!def) return false;
  return !!parkedClassOf({
    tribes: [def.tribe, def.tribe2],
    flags: def.celestial ? ['celestial'] : [],
    triggers: def.effects.map((e) => e.on),
  });
};

interface RawFamily { factories: Set<string>; events: Set<string> }

function rawFamilies(): Map<string, RawFamily> {
  const families = new Map<string, RawFamily>();
  for (const [key, entry] of Object.entries(PRESENTATION_POLICIES)) {
    const m = /^factory:([^:]+):([^:]+)$/.exec(key);
    if (!m) continue; // non-factory policy keys carry no content cluster
    const fam = (entry as { family?: string }).family;
    if (!fam) continue;
    const f = families.get(fam) ?? { factories: new Set(), events: new Set() };
    f.factories.add(m[1]!);
    f.events.add(m[2]!);
    families.set(fam, f);
  }
  return families;
}

/** How many distinct trigger GROUPS a family spans (an ungrouped event counts as its own group). */
const groupSpread = (events: Iterable<string>): Set<string> =>
  new Set([...events].map((e) => triggerGroupOf(e)?.id ?? `ungrouped:${e}`));

const matchingCards = (factories: ReadonlySet<string>, events: ReadonlySet<string>): string[] =>
  sortedCards().filter((def) => def.effects.some((e) => factories.has(e.do) && events.has(e.on))).map((def) => def.id).sort();

/** The member list a card may print: matching cards MINUS anything in a parked class. */
const membersOf = (factories: ReadonlySet<string>, events: ReadonlySet<string>): string[] =>
  matchingCards(factories, events).filter((id) => !isParkedCard(id) && !ARCHIVED_IDS.has(id));

/**
 * The deterministic cluster plan: single-trigger families keep their family card (and their id — no
 * needless re-sitting); multi-trigger families dissolve into shared per-trigger-group cards plus one honest
 * residual. Parked families emit nothing at all.
 */
export function conventionClusters(): { clusters: ConventionCluster[]; parked: ParkedSuppression[] } {
  const families = rawFamilies();
  const parkedByClass = new Map<string, ParkedSuppression>();

  const coherent: Array<[string, RawFamily]> = [];
  const dissolved: Array<[string, RawFamily]> = [];
  for (const [fam, f] of [...families.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const p = parkedClassForFamily(fam);
    if (p) {
      const row = parkedByClass.get(p.id) ?? { classId: p.id, families: [], membersStripped: 0 };
      row.families.push(fam);
      row.membersStripped += matchingCards(f.factories, f.events).length;
      parkedByClass.set(p.id, row);
      continue;
    }
    (groupSpread(f.events).size > 1 ? dissolved : coherent).push([fam, f]);
  }

  const clusters: ConventionCluster[] = coherent.map(([fam, f]) => ({
    ruleId: `q-conv-family-${fam}`,
    kind: 'family' as const,
    family: fam,
    events: [...f.events].sort(),
    factories: [...f.factories].sort(),
    memberIds: membersOf(f.factories, f.events),
  }));

  // Re-cluster every dissolved family's (factory, event) pairs by trigger group, POOLED across families —
  // one "when you sell" card, not one per family that happened to own a sell factory.
  const byGroup = new Map<string, { events: Set<string>; factories: Set<string>; families: Set<string> }>();
  const ungrouped = { events: new Set<string>(), factories: new Set<string>(), families: new Set<string>() };
  for (const [fam, f] of dissolved) {
    for (const [key, entry] of Object.entries(PRESENTATION_POLICIES)) {
      const m = /^factory:([^:]+):([^:]+)$/.exec(key);
      if (!m || (entry as { family?: string }).family !== fam) continue;
      const [, factory, event] = m as unknown as [string, string, string];
      if (parkedClassForTrigger(event)) continue; // a parked trigger never reaches the deck
      const g = triggerGroupOf(event);
      const bucket = g
        ? byGroup.get(g.id) ?? { events: new Set<string>(), factories: new Set<string>(), families: new Set<string>() }
        : ungrouped;
      bucket.events.add(event);
      bucket.factories.add(factory);
      bucket.families.add(fam);
      if (g) byGroup.set(g.id, bucket);
    }
  }

  for (const g of TRIGGER_GROUPS) {
    const bucket = byGroup.get(g.id);
    if (!bucket) continue;
    clusters.push({
      ruleId: `q-conv-trigger-${g.id}`,
      kind: 'trigger',
      events: [...bucket.events].sort(),
      factories: [...bucket.factories].sort(),
      memberIds: membersOf(bucket.factories, bucket.events),
      fromFamilies: [...bucket.families].sort(),
    });
  }
  if (ungrouped.events.size) {
    clusters.push({
      ruleId: 'q-conv-trigger-residual',
      kind: 'residual',
      events: [...ungrouped.events].sort(),
      factories: [...ungrouped.factories].sort(),
      memberIds: membersOf(ungrouped.factories, ungrouped.events),
      fromFamilies: [...ungrouped.families].sort(),
    });
  }

  return {
    clusters: clusters.sort((a, b) => (a.ruleId < b.ruleId ? -1 : 1)),
    parked: [...parkedByClass.values()].sort((a, b) => (a.classId < b.classId ? -1 : 1)),
  };
}

function familyQuestions(): GameRule[] {
  return conventionClusters().clusters.map((c) => {
    const exemplar = c.memberIds[0];
    const n = c.memberIds.length;
    const phases = [...new Set(c.events.map((e) => TRIGGER_PHASES[e] ?? 'unknown'))].sort().join('/');
    // The gilding half rides the trigger-keyed cards too (main's WP-D work, ported onto this structure):
    // the owner's per-family notes still key on the family name, so a card born of the re-cluster falls
    // through to the derived claim (spells-never-gild / mixed / ×2 baseline), which is the honest reading —
    // he annotated avenge/castPayoff/echo, none of which were split.
    const gild = gildClaimFor(c.family ?? '', c.memberIds);

    if (c.kind === 'family') {
      return rule({
        id: c.ruleId,
        title: `'${c.family}' family · ${cards(n)}`,
        statement: `${n === 1 ? `The 1 '${c.family}' card triggers` : `All ${n} '${c.family}' cards trigger`} the same way. ${gild.statement}` + CLICKS('', ''),
        domain: 'triggers',
        currentBehaviour: `${c.factories.length} effect factories across ${cards(n)} dispatch through the '${c.family}' presentation family, all on the single trigger '${c.events[0]}' (${phases}); the factoryPhase lane gates each (trigger, factory) pair.`
          + ` Gilding: ${gild.currentBehaviour}`,
        ...(exemplar ? {
          cardText: `Exemplar — ${nameOf(exemplar)}: "${textOf(exemplar)}" · Members: ${memberLine(c.memberIds)}`,
          example: `${nameOf(exemplar)} follows the '${c.family}' convention — its trigger fires on ${c.events[0]}. ${gild.example}`,
        } : {
          cardText: `(no live cards currently use the '${c.family}' family's factories)`,
          example: `any future '${c.family}' card inherits this convention at authoring time.`,
        }),
        ...(n ? { contentIds: c.memberIds } : {}),
      });
    }

    if (c.kind === 'trigger') {
      const label = TRIGGER_GROUPS.find((x) => `q-conv-trigger-${x.id}` === c.ruleId)!.label;
      return rule({
        id: c.ruleId,
        title: `Trigger: ${label} · ${cards(n)}`,
        // No em-dash inside the sentence: the fly-through ratchet counts words BEFORE the first '—', so an
        // in-sentence dash would hide the rest of the claim from the bar it is supposed to be measured by.
        statement: `${allOfThese(n)} on one trigger: ${label}. ${gild.statement}` + CLICKS('', ''),
        domain: 'triggers',
        currentBehaviour: `${c.factories.length} effect factories across ${cards(n)} dispatch on ${c.events.map((e) => `'${e}'`).join(', ')} (${phases}) — re-clustered by TRIGGER out of the ${c.fromFamilies?.map((f) => `'${f}'`).join(' + ')} presentation ${c.fromFamilies!.length > 1 ? 'families' : 'family'} on the owner's 2026-08-28 ruling; the factoryPhase lane gates each (trigger, factory) pair.`
          + ` Gilding: ${gild.currentBehaviour}`,
        ...(exemplar ? {
          cardText: `Exemplar — ${nameOf(exemplar)}: "${textOf(exemplar)}" · Members: ${memberLine(c.memberIds)}`,
          example: `${nameOf(exemplar)} fires when ${label}, like every other card here. ${gild.example}`,
        } : {
          cardText: `(no live card currently fires on ${label})`,
          example: `any future card that fires when ${label} inherits this convention.`,
        }),
        ...(n ? { contentIds: c.memberIds } : {}),
      });
    }

    // Residual — say the incoherence out loud rather than forcing a false family (owner ruling 2026-08-28).
    return rule({
      id: c.ruleId,
      title: `Unrelated leftovers · ${n} cards`,
      statement: `These ${n} are unrelated: they share no trigger. Ruling each individually is the honest option.` + CLICKS('', ''),
      domain: 'triggers',
      // The statement stays about the INCOHERENCE — folding a gilding claim into it would assert one
      // convention over cards that share nothing. The claim is still recorded, in currentBehaviour.
      currentBehaviour: `${c.factories.length} factories left over after the ${c.fromFamilies?.map((f) => `'${f}'`).join(' + ')} ${c.fromFamilies!.length > 1 ? 'families were' : 'family was'} re-clustered by trigger; they share NO trigger — ${c.events.map((e) => `'${e}'`).join(', ')} (${phases}).`
        + ` Gilding: ${gild.currentBehaviour}`,
      ...(exemplar ? {
        cardText: `No shared trigger: ${c.events.join(' · ')} · Members: ${memberLine(c.memberIds)}`,
        example: `${nameOf(exemplar)} and the rest have nothing in common but leftover status — approving one statement over all of them would rule things you never read.`,
      } : {
        cardText: `No shared trigger: ${c.events.join(' · ')} · (no live members)`,
        example: 'nothing live carries these triggers today — the card exists so the leftovers are never silently dropped.',
      }),
      ...(n ? { contentIds: c.memberIds } : {}),
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
  const cards = liveCards();
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
  const cards = liveCards();
  const goldenTextIds = cards.filter((c) => c.goldenText).map((c) => c.id);
  const multiplierIds = cards.filter((c) => c.triggerMultiplier).map((c) => c.id);
  const avengeIds = cards.filter((c) => c.effects.some((e) => e.on === 'avenge')).map((c) => c.id);
  const dualIds = cards.filter((c) => c.tribe2 ?? c.universalTribe).map((c) => c.id);
  const gildEx = goldenTextIds.includes('wolvesden') ? 'wolvesden' : goldenTextIds[0];
  return [
    rule({
      id: 'q-conv-global-gild-default',
      title: 'Gilding default: ×2',
      statement: 'A gilded card doubles its printed numbers. Outliers instead gild the summoned token, reshape the effect, or add a proc; spells never gild.'
        + CLICKS('', ''),
      domain: 'gilding',
      currentBehaviour: `${goldenTextIds.length} cards carry authored goldenText; every other card inherits the ×2 number-doubler. `
        + 'The outlier shapes are the owner\'s 2026-08-28 rulings, now carried per card as the contract\'s gildedDelta kind (R-GILD-01); spells and Rubies are not-applicable (R-GILD-02).',
      ...(gildEx ? {
        cardText: `Exemplar — ${nameOf(gildEx)}: "${textOf(gildEx)}" → gilded: "${plain(CARD_INDEX[gildEx]?.goldenText)}"`,
        example: `${nameOf(gildEx)}'s gilded text just writes the ×2 out in full — while gilded ${nameOf('b2_dunkey')} instead summons ONE gilded ${nameOf('b2_armadiyo')}.`,
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
