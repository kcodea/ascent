/**
 * DOC BOT 2.0 WP E — the text lexicon (blueprint §11.1 "keyword lexicon + existing factory/text mappings").
 *
 * Three tables, all derived from structures the engine already owns:
 *  · KEYWORD_LEXICON — one row per member of the core `Keyword` union (Record<Keyword, …> so adding a
 *    keyword to the union is a COMPILE error here until the lexicon learns its printed names). The
 *    canonical name is the vocabulary the owner shipped (vocab rework PR #505 + current majority text);
 *    `alternates` are printed variants still live in the corpus (the guide/Sitting-3 decide their fate).
 *  · TRIGGER_LEXICON — printed trigger prefixes → the contract trigger vocabulary (content EffectDef `on`
 *    values, the same ids contractExtract emits), so a parsed trigger is directly comparable to a
 *    ContentContract trigger claim.
 *  · TERM_VARIANTS — the measured wording inconsistencies (two live spellings of one concept). This table
 *    feeds BOTH the language guide's evidence and the Sitting-3 question generator: a variant pair whose
 *    two sides both still occur in the corpus produces one owner question; once the text is consistent the
 *    question self-retires on the next regeneration.
 */
import type { Keyword } from '@game/core';

// ── keyword lexicon (compile-checked against the union) ──────────────────────────────────────────────────

export interface KeywordLexeme {
  /** The canonical printed name (current owner vocabulary). */
  canonical: string;
  /** Other printed names still found in live text (deprecated or contested). */
  alternates: string[];
  /** The canon is contested/reserved — the advisor must NOT rewrite toward it (e.g. the owner's own
   *  Rise/Reborn→Rebirth rename is in flight; WP E records, never front-runs). */
  reserved?: string;
}

export const KEYWORD_LEXICON: Readonly<Record<Keyword, KeywordLexeme>> = {
  T: { canonical: 'Taunt', alternates: [] },
  DS: { canonical: 'Ward', alternates: ['Divine Shield'] },
  V: { canonical: 'Venomous', alternates: [] },
  W: { canonical: 'Flurry', alternates: ['Windfury'] },
  R: { canonical: 'Rise', alternates: ['Reborn'], reserved: 'the owner\'s Rebirth rename is IN FLIGHT (their own work) — record the split, never advise or rename' },
  C: { canonical: 'Cleave', alternates: [] },
  M: { canonical: 'Magnetic', alternates: [] },
  SC: { canonical: 'Start of Combat', alternates: [] },
  CN: { canonical: 'Consume', alternates: [] },
  FD: { canonical: 'Fodder', alternates: [] },
  IMM: { canonical: 'Immune', alternates: [] },
  ST: { canonical: 'Stealth', alternates: [] },
  RL: { canonical: 'Rally', alternates: [] },
  SL: { canonical: 'Slaughter', alternates: [] },
  CR: { canonical: 'Critical Strike', alternates: [] },
  EG: { canonical: 'Engraved', alternates: [] },
};

/** Every printed keyword name (canonical + alternates) → its letter. Longest names first so
 *  "Start of Combat" wins before any shorter overlap. */
export function keywordNameTable(): ReadonlyArray<readonly [string, Keyword]> {
  const rows: Array<readonly [string, Keyword]> = [];
  for (const [code, lex] of Object.entries(KEYWORD_LEXICON) as Array<[Keyword, KeywordLexeme]>) {
    rows.push([lex.canonical, code]);
    for (const a of lex.alternates) rows.push([a, code]);
  }
  return rows.sort((a, b) => b[0].length - a[0].length);
}

// ── settled vocabulary terms that are not keywords ───────────────────────────────────────────────────────

/**
 * AURA — the printed noun for a run-wide grant that reaches a tribe/class wherever its members sit (board,
 * hand, Shop, and copies acquired later). Owner ruling 2026-08-28 (decision q-word-lg-scope-01, REVISE):
 * "we want to re-brand the 'wherever they are' vocabulary to Aura's instead. i.e. Buff your Undead Army
 * Aura +4/+1, or Buff your Imp Aura +4/+4". It is a TEXT term only — no engine identifier changed, and the
 * pre-existing `auraFx` / combat-aura code paths are untouched.
 *
 * Shape: `your <Tribe-singular> Aura` ("your Beast Aura", "your Imp Aura", "your Attachment Aura"). The
 * parser's target grammar reads it (see `targetPhrase`), and LG-SCOPE-01 carries the rule + the predicate
 * that flags any text reintroducing a retired scope tail.
 */
export const AURA_TARGET_RE = /\b[Yy]our ([A-Z][\w']*) Aura\b/;
/** The scope tails the Aura noun replaced — banned from live printed text (LG-SCOPE-01, grow-loudly). */
export const RETIRED_SCOPE_TAIL_RE = /\bwherever (?:they are|it is)\b|\beverywhere\b/;

// ── trigger lexicon (printed prefix → contract trigger event) ────────────────────────────────────────────

export interface TriggerLexeme {
  /** Regex over the START of a stripped sentence. Group 1, when present, is a numeric threshold. */
  re: RegExp;
  event: string;
  display: string;
}

/** Leading trigger prefixes ("Shout:", "Avenge (3):", "Every 2 turns:"). Both display vocabularies are
 *  mapped — Shout/Battlecry and Echo/Deathrattle each resolve to the one engine event; WHICH display is
 *  canon is a Sitting-3 question, not a parser opinion. */
export const TRIGGER_LEXICON: readonly TriggerLexeme[] = [
  { re: /^Shout and Echo\s*[:：]/, event: 'onPlay+onDeath', display: 'Shout and Echo' },
  { re: /^Shout\s*[:：]/, event: 'onPlay', display: 'Shout' },
  { re: /^Battlecry\s*[:：]/, event: 'onPlay', display: 'Battlecry' },
  { re: /^Echo\s*[:：]/, event: 'onDeath', display: 'Echo' },
  { re: /^Deathrattle\s*[:：]/, event: 'onDeath', display: 'Deathrattle' },
  { re: /^Start of [Cc]ombat(?:\s*—[^:]+)?\s*[:：]/, event: 'startOfCombat', display: 'Start of Combat' },
  { re: /^End of Turn\s*[:：]/, event: 'endOfTurn', display: 'End of Turn' },
  { re: /^Rally\s*[:：]/, event: 'onAttack', display: 'Rally' },
  { re: /^Slaughter\s*[:：]/, event: 'onKill', display: 'Slaughter' },
  { re: /^Avenge \((\d+)\)\s*[:：]/, event: 'avenge', display: 'Avenge' },
  { re: /^Sell\s*[:：]/, event: 'onSell', display: 'Sell' },
  { re: /^Every (\d+) turns?[,:]?\s*/, event: 'everyNTurns', display: 'Every N turns' },
  { re: /^Choose One\s*[:：]/, event: 'chooseOne', display: 'Choose One' },
];

/** Conditional ("When/Whenever/After …,") clause → event, matched against the clause between the
 *  conditional word and the first comma. Order matters — first match wins. */
export const CONDITIONAL_LEXICON: ReadonlyArray<readonly [RegExp, string]> = [
  [/you buy/i, 'onBuy'],
  [/you (?:sell|sold)/i, 'onSell'],
  [/(?:you cast|shop spell is cast|spells? (?:you )?cast)/i, 'spellCast'],
  [/you (?:summon|play)/i, 'onFriendPlayed'],
  [/this (?:takes damage|is damaged)/i, 'onDamaged'],
  [/(?:a )?friend(?:ly minion)? dies|friendly .* dies/i, 'onFriendDeath'],
  [/dies in combat/i, 'onFriendDeath'],
  [/attacks/i, 'onAttackWatch'],
  [/you trigger a Shout|Shout triggers/i, 'shoutWatch'],
  [/gains? Attack/i, 'onGainAttack'],
  [/magneti[sz]e/i, 'onMagnetize'],
  [/is summoned/i, 'onSummonWatch'],
  [/you get a Ruby/i, 'onRubyGet'],
];

// ── measured wording variants (guide evidence + the Sitting-3 deck's source) ─────────────────────────────

export interface TermVariant {
  /** The language-guide entry this variant pair belongs to (LG-*). */
  lgId: string;
  /** Short topic label for the question card. */
  label: string;
  /** Candidate A (current majority) and candidate B, as display strings. */
  a: string;
  b: string;
  /** Corpus probes for each side (run over stripped text). */
  reA: RegExp;
  reB: RegExp;
  /** One-sentence owner question, ≤ 30 words before the micro-tail — "approve" endorses candidate A. */
  question: string;
  /** RESERVED: the owner's own rename is in flight — surface in the guide, never as a question. */
  reserved?: boolean;
}

export const TERM_VARIANTS: readonly TermVariant[] = [
  {
    lgId: 'LG-TRIGGER-01', label: 'Shout vs Battlecry', a: 'Shout', b: 'Battlecry',
    reA: /\bShouts?\b/, reB: /\bBattlecr(?:y|ies)\b/,
    question: 'On-play triggers print "Shout" everywhere; every "Battlecry" in card text is updated to match.',
  },
  {
    lgId: 'LG-TRIGGER-02', label: 'Echo vs Deathrattle', a: 'Echo', b: 'Deathrattle',
    reA: /\bEcho(?:es)?\b/, reB: /\bDeathrattles?\b/,
    question: 'On-death triggers print "Echo" everywhere; every "Deathrattle" in card text is updated to match.',
  },
  {
    lgId: 'LG-KEYWORD-01', label: 'Ward vs Divine Shield', a: 'Ward', b: 'Divine Shield',
    reA: /\bWard\b/, reB: /\bDivine Shield\b/,
    question: 'The shield keyword prints "Ward" everywhere; the last "Divine Shield" texts are updated to match.',
  },
  {
    lgId: 'LG-KEYWORD-02', label: 'Rise vs Reborn', a: 'Rise', b: 'Reborn',
    reA: /\bRise\b/, reB: /\bReborn\b/,
    question: '', reserved: true, // the owner's Rebirth rename is their own in-flight work — no question
  },
  {
    lgId: 'LG-GILD-01', label: 'Gilded vs Golden', a: 'Gilded', b: 'Golden',
    reA: /\bGilded\b/i, reB: /\bgolden\b/i,
    question: 'Upgraded cards are called "Gilded" in text; every "Golden"/"golden" is updated to match.',
  },
  {
    lgId: 'LG-ZONE-01', label: 'Shop vs tavern', a: 'Shop', b: 'tavern',
    reA: /\bShop\b/i, reB: /\btavern\b/i,
    question: 'The buy row is always "the Shop" in text; every remaining "tavern" is updated to match.',
  },
  {
    lgId: 'LG-DURATION-01', label: 'run vs game', a: 'this run', b: 'this game',
    reA: /\b(?:this|the) run\b/, reB: /\b(?:this|the) game\b/,
    question: 'Run-long effects say "this run" / "for the rest of the run" — never "game".',
  },
  {
    // SETTLED by owner ruling 2026-08-28 (decision q-word-lg-scope-01, REVISE): the run-wide reach is an
    // AURA — "your Imp Aura +4/+4" — and both retired scope tails are gone from live text, so this pair
    // produces no question (candidate B has zero corpus hits). It stays in the table as the grow-loudly
    // watch: text that reintroduces a tail makes B non-zero and the deck asks again.
    lgId: 'LG-SCOPE-01', label: 'Aura vs the retired scope tails', a: 'Aura', b: 'wherever they are/everywhere',
    reA: /\bAura\b/, reB: /\bwherever (?:they are|it is)\b|\beverywhere\b/,
    question: 'Run-wide grants name an Aura ("your Imp Aura +4/+4") — the retired scope tails are updated to match.',
  },
  {
    lgId: 'LG-VERB-01', label: 'trigger vs fire/proc', a: 'trigger', b: 'fire/proc',
    reA: /\btriggers?\b/, reB: /\b(?:fires?|procs?)\b/,
    question: 'Effects "trigger" — never "fire" or "proc". The three straggler texts are updated to match.',
  },
  {
    lgId: 'LG-NUMERAL-01', label: 'Gold vs g', a: 'N Gold', b: 'Ng',
    reA: /\b\d+ Gold\b/, reB: /\b\d+g\b/,
    question: 'Money always prints as "N Gold" — never the "Ng" abbreviation.',
  },
  {
    lgId: 'LG-POSITION-01', label: 'left-most vs leftmost', a: 'left-most', b: 'leftmost',
    reA: /\b(?:left|right)-most\b/i, reB: /\b(?:leftmost|rightmost)\b/i,
    question: 'Positional words are hyphenated: "left-most" / "right-most", never "leftmost".',
  },
  {
    lgId: 'LG-VERB-02', label: 'Consume vs devour', a: 'Consume', b: 'devour',
    reA: /\bConsumes?\b/, reB: /\bdevours?\b/i,
    question: 'The eat mechanic is the keyword "Consume" — flavor "devour" is reserved for non-mechanical prose.',
  },
];
