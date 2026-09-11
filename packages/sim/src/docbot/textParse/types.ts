/**
 * DOC BOT 2.0 WP E — the ParsedTextContract shape (blueprint §11.1).
 *
 * The parser's output over one object's PRINTED text: a normalized, machine-comparable reading of the
 * triggers, targets, effects, amounts, limits, persistence, randomness and phase restrictions the text
 * claims — plus, load-bearingly, `unresolvedPhrases`: every span of text the grammars could NOT consume.
 *
 * §4.3 doctrine, binding: the parse NEVER claims full fidelity while unresolved spans remain. A partial
 * parse is a first-class result — the comparator may still act on the claims it DID resolve (a printed
 * "+2/+3" is a real claim even when the sentence's tail is opaque), but the object as a whole can never
 * be classified `parsed-equivalent` until every span is consumed or the object carries an explicit
 * exception (TEXT_EXCEPTIONS).
 */

/** A literal slice of the (marker-stripped) printed text the parser could not consume. */
export interface TextSpan {
  /** Offsets into the STRIPPED text (stripMarkers output), so spans are stable across bold markers. */
  start: number;
  end: number;
  text: string;
}

/** One trigger claim the text makes ("Shout:", "Echo:", "Avenge (3):", "When you buy a minion, …"). */
export interface ParsedTrigger {
  /** Normalized trigger event in the contract vocabulary ('onPlay', 'onDeath', 'avenge', …) — or
   *  'conditional:unknown' when the conditional clause was recognized as a trigger but its event could
   *  not be mapped (the effect body is still parsed; the trigger itself stays a visible gap). */
  event: string;
  /** The display word the text used, verbatim ('Shout', 'Battlecry', 'Echo', …) — the guide's food. */
  display: string;
  /** Avenge (N) / every-N cadences. */
  threshold?: number;
  span: TextSpan;
}

/** One target claim ("a friendly minion", "your Beasts", "2 random friendly minions", "adjacent"). */
export interface ParsedTarget {
  /** 'all' — a whole class ("your Beasts"); 'exactly'/'up-to' — counted. Mirrors TargetContract. */
  cardinality: 'all' | 'exactly' | 'up-to';
  count?: number;
  /** Free-vocabulary scope ('friendly-minion', 'your-beast', 'adjacent', 'self', 'shop-minion', …). */
  scope: string;
  friendly?: boolean;
  random?: boolean;
}

/** One printed magnitude. Stat pairs use attack/health; scalar magnitudes use value + unit. */
export interface ParsedAmount {
  attack?: number;
  health?: number;
  value?: number;
  /** 'gold' | 'damage' | 'refresh' | … */
  unit?: string;
}

/** One effect claim, normalized to a small intent vocabulary the comparator understands. */
export interface ParsedEffect {
  kind:
    | 'stat-buff' // give/gain/improve/Engrave printed stats
    | 'summon' // summon N <token>
    | 'gain-gold' // gain/get N Gold
    | 'get-card' // get/add a card (to hand/shop)
    | 'discover' // Discover …
    | 'cast-spell' // cast <named spell>
    | 'deal-damage'
    | 'copy' // copy a card/minion
    | 'grant-keyword' // give <keyword>
    | 'keyword-line' // a bare keyword sentence ("Taunt. Ward.")
    | 'multiplier-print' // "Your X effects trigger twice / an additional time"
    | 'trigger-other' // "trigger your left-most Echo"
    | 'attack-immediately' // "attacks immediately"
    // ── grammar growth 2026-09-11 (the histogram-driven families; see docs/devlog/2026-09-11-docbot-text-parser-coverage.md)
    | 'stat-transfer' // "give this minion's Attack to 2 friendly minions" / "gains its stats" / "50% of this minion's stats"
    | 'stat-multiply' // "double its stats" / "triple its Health" (amount.value = factor)
    | 'set-stats' // "Set a minion's stats to 20/20" / "set its Health to 1"
    | 'cast-ruby' // "cast 2 Rubies on your minions" (amount.value = printed Ruby count)
    | 'consume' // "It Consumes a minion in the Shop" (subject = the eater, target = the eaten, summonCount = how many)
    | 'gain-refresh' // "gain a free refresh" (amount.value = count)
    | 'refresh' // "Refresh the Shop"
    | 'cost-mod' // "Shop spells cost 1 less" / "Sells for 2 Gold" / "Costs 11 Gold, reduced by 1 each turn"
    | 'improvement' // "Improves +3/+3 every 3 Beasts summoned" (amount = the step; cadence = the countdown)
    | 'repeat' // "Repeat every Start of Turn" / "Repeat for every Dragon you control"
    | 'token-body' // "A 1/1 Beast token." (amount = printed stats; keywords carried)
    | 'action' // a recognized game verb over a target: steal / swap / destroy / sell / transform / return / gild / magnetize / mark / archive / scout / remove-keyword / visit-forge / invest / roll / remember / keep
    | 'choose-target' // "Choose a friendly minion." / "Target a Demon."
    | 'grant-ability' // "Your Gemheart Golems gain Echo: …" (refName = the granted trigger word; the body parses on)
    | 'choose-both' // "gains both effects" / "give both Choose One effects"
    | 'also-cast' // "It also casts on a random friendly minion" / "also casts on adjacent Dragons"
    | 'note'; // a recognized rules note that carries no magnitude ("Needs a free board slot.", "Progress carries between turns.")
  amount?: ParsedAmount;
  target?: ParsedTarget;
  /** The SUBJECT of a subject-first sentence ("your left-most minion attacks immediately", "Your Rubies gain
   *  +1 Attack") — who performs the effect, as distinct from `target` (who receives it). */
  subject?: ParsedTarget;
  /** A printed per-N scaler attached to this effect ("for each Spirit you played this turn", "per Gold spent
   *  this turn", "plus +1/+1 for each Dragon you played this turn"). */
  scaler?: ParsedScaler;
  /** An improvement / repeat cadence ("every 3 Beasts summoned" → { every: 3, of: 'Beasts summoned' }). */
  cadence?: ParsedCadence;
  /** 'action' / 'note' / 'cost-mod': the normalized verb or note id ('steal', 'gild', 'room-required', 'free', …). */
  action?: string;
  /** Named card/spell/token id when the text names one and it resolves ('spiritfire', 'pup', …). */
  refId?: string;
  /** Raw referenced name when it did NOT resolve to a card id. */
  refName?: string;
  /** summon: printed count; copy: 'plain' | 'exact' | 'unmarked'. */
  summonCount?: number;
  copyMode?: 'plain' | 'exact' | 'unmarked';
  /** Keyword letters granted/carried by this effect ('T', 'DS', …). */
  keywords?: string[];
  /** The verb the text used ('give', 'gain', 'get', 'improve', 'Engrave', …) — guide food. */
  verb?: string;
  span: TextSpan;
}

/** "for each X" / "for every N X" / "per X" — a printed scaler. `amount` is the per-step magnitude when the
 *  text prints one separately ("plus +1/+1 for each …"); `every` the N in "for every 3 Gold". */
export interface ParsedScaler {
  per: string;
  every?: number;
  amount?: ParsedAmount;
  span: TextSpan;
}

/** "every 3 Beasts summoned" / "each time it triggers" / "every Start of Turn". */
export interface ParsedCadence {
  every?: number;
  of: string;
}

export interface ParsedLimit {
  kind: 'once-per' | 'times-per' | 'max-n' | 'first-n' | 'up-to-n' | 'next-n';
  n?: number;
  per?: 'turn' | 'combat' | 'game' | 'run' | 'shop';
  span: TextSpan;
}

export interface ParsedPersistence {
  kind: 'permanent' | 'this-turn' | 'next-turn' | 'this-combat' | 'next-combat' | 'run-wide';
  /** The display phrase used ('permanently', 'this run', 'this game', 'for the rest of the game', …). */
  display: string;
  span: TextSpan;
}

export interface ParsedRandomness {
  kind: 'random' | 'player-choice';
  span: TextSpan;
}

export type ParsedGamePhase = 'shop' | 'combat' | 'both';

/** §11.1 — the whole parse. */
export interface ParsedTextContract {
  triggers: ParsedTrigger[];
  targets: ParsedTarget[];
  effects: ParsedEffect[];
  amounts: ParsedAmount[];
  limits: ParsedLimit[];
  persistence: ParsedPersistence[];
  randomness: ParsedRandomness[];
  phaseRestrictions: ParsedGamePhase[];
  /** Every span the grammars could not consume. NEVER empty-by-omission: a sentence that half-parsed
   *  contributes its unconsumed remainder here (§4.3 — no silent uncertainty). */
  unresolvedPhrases: TextSpan[];
  /** Keyword letters granted by bare keyword sentences ("Taunt. Ward."). */
  keywordLine: string[];
  /** Printed conditions the parse recognized and consumed ("If it is a Dragon,", "if you control a Spirit,",
   *  "While on your board,"). Recorded, never compared — a condition is a claim the object makes. */
  conditions: TextSpan[];
  /** Every scaler the text prints (also attached to its effect). */
  scalers: ParsedScaler[];
  /** Modifier tails the parse consumed AFTER an effect ("permanently", "this combat", "before this attacks",
   *  "(max 3)") — listed so a consumed span is never silently dropped (§4.3): everything the grammar read is
   *  visible either as a claim or here. */
  consumedModifiers: TextSpan[];
  /** True ⇔ unresolvedPhrases is empty. The ONLY flag `parsed-equivalent` may build on. */
  fullyParsed: boolean;
  /** The stripped text the spans index into. */
  stripped: string;
}

/**
 * §11.2 — the full mismatch taxonomy, typed. `IMPLEMENTED_TAXONOMY` names the subset this WP's
 * comparator can honestly detect; the rest stay typed so later tranches slot in without a schema change
 * (and so a report can say which detectors exist vs which are declared-but-unimplemented — §4.3).
 */
export type MismatchTaxonomyId =
  | 'missing-trigger'
  | 'wrong-trigger'
  | 'wrong-phase'
  | 'wrong-amount'
  | 'wrong-target-count'
  | 'wrong-target-category'
  | 'chosen-vs-random'
  | 'friendly-vs-enemy'
  | 'missing-trigger-limit'
  | 'missing-persistence'
  | 'missing-improvement'
  | 'wrong-generated-card'
  | 'wrong-summon-count'
  | 'plain-vs-exact-copy'
  | 'shop-spell-vs-any-spell'
  | 'play-cast-summon-get'
  | 'gain-vs-give'
  | 'missing-gilded-delta'
  | 'wrong-gilded-amount'
  | 'wrong-threshold'
  | 'runtime-effect-absent-from-text'
  | 'text-promises-absent-effect';

/** The detectors WP E actually ships (§11.2 "implement what the parse can honestly support"). */
export const IMPLEMENTED_TAXONOMY: readonly MismatchTaxonomyId[] = [
  'wrong-amount',
  'wrong-target-count',
  'wrong-generated-card',
  'wrong-summon-count',
  'wrong-trigger',
  'wrong-threshold',
  'plain-vs-exact-copy',
  'missing-gilded-delta',
  'wrong-gilded-amount',
  'runtime-effect-absent-from-text',
  'text-promises-absent-effect',
];

export interface TextMismatch {
  contentId: string;
  taxonomy: MismatchTaxonomyId;
  expected: string;
  observed: string;
  /** One human-verifiable line — what was compared, where each side came from. */
  detail: string;
}

/** §18-E — the four exit-gate buckets. */
export type TextBucket = 'parsed-equivalent' | 'verified-mismatch' | 'approved-exception' | 'unresolved-parse';
