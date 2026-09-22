/**
 * APPROVED RULES — each entered here only on an explicit owner ruling, with the ruling cited.
 *
 * The first five come verbatim from the owner's Complete Rulebook handoff (Codex, 2026-06-29,
 * `ascent-complete-rulebook-handoff.md` § Confirmed Owner Rulings), which states they "have already been
 * explicitly confirmed and should enter the new registry as approved rules."
 */
import type { GameRule } from '../schema';

const HANDOFF = 'C:/Users/kevin/Documents/Codex/2026-06-29/files-mentioned-by-the-user-codex/ascent-complete-rulebook-handoff.md';

/** The Docbot next-iteration handoff, §5.0 "Confirmed owner rulings (2026-08-26)" — the eleven
 *  per-instance temporal-window rulings (`R-AVWIN-*`), entered verbatim as approved intent. */
const AVWIN_HANDOFF = 'C:/Users/kevin/Documents/Codex/2026-06-29/files-mentioned-by-the-user-codex/ascent-docbot-next-iteration-handoff.md';

export const APPROVED_RULES: GameRule[] = [
  {
    id: 'R-CEL-01',
    title: 'Celestial Alignment locks at combat start',
    statement:
      'Dawn, Dusk and Eclipsed are determined by board position. Alignment locks when combat begins; combat '
      + 'deaths and board contraction do not realign survivors. Eclipsed counts as both Dawn and Dusk. '
      + '(Provisional: Celestials are WIP and this may be revised.)',
    domain: 'combat',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'Alignment locks when combat begins.' }],
    // Alignment lock is pinned behaviorally: "locks at combat setup and combat never re-centres", the
    // ECLIPSE-runs-both-halves cases, and Dawn/Dusk-locked halves all live in celestial.test.ts.
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/celestial.test.ts'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-PLAY-01',
    title: 'What counts as a played card',
    statement:
      'Any card intentionally played from hand counts as a played card — minions, spells, Shop spells, '
      + 'Rubies, Dwarven Ales, Gifts, and future subtypes. Buying, generating, drawing or receiving a card '
      + 'does not play it; reordering does not play it; an automatic or triggered cast is not a card played '
      + 'from hand.',
    domain: 'actions',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'Any card intentionally played from hand counts as a played card.' }],
    // DELIBERATELY UNENFORCED (in the approved-but-unenforced queue): many tests exercise played-card
    // counters incidentally, but no single probe pins the full definition — especially the negative half
    // (buying/generating/drawing/reordering does not play; a triggered cast is not a play). Honest gap.
  },
  {
    id: 'R-COPY-01',
    title: 'Plain copies',
    statement:
      'A plain copy is a fresh base copy: no copied buffs or instance modifications; it does not inherit '
      + 'attachments, granted keywords, learned effects, improved values or counters; it is non-Gilded unless '
      + 'the effect says otherwise. Applicable Auras still affect it, because Auras are global and were not '
      + 'copied from the source.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'A plain copy is a fresh base copy of that card.' }],
    // Pinned by the Bellringer Voss cases: "the copy is PLAIN — buffs on the original are not carried"
    // (base stats asserted, golden=false). One representative probe; broader plain-copy sweep is future work.
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set2Neutral.test.ts'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-COPY-02',
    title: 'Exact copies',
    statement:
      'An exact copy is literally an exact copy of the current card instance: it retains all buffs, effects, '
      + 'attachments, granted keywords, improved values, learned effects, counters and other card-owned state. '
      + 'Engine-owned pending events, callbacks and queue bookkeeping are NOT part of the card instance and '
      + 'must not be duplicated. Any uncertain field boundary is surfaced for an owner ruling.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'An exact copy is literally an exact copy of the current card instance.' }],
    // Pinned by the Copycat suite: stats, keywords, gilding and accrued per-instance improvements all copy
    // ("exactly means exactly"); the engine-owned-state boundary is the suite's deliberate exclusion list.
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/copycat.test.ts'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-AURA-01',
    title: 'Auras are global modifiers',
    statement:
      'An Aura is a global modifier affecting an eligible type, card or population wherever the Aura defines. '
      + 'Auras can affect existing and future eligible cards. Plain copies remain plain but receive any '
      + 'independently applicable Aura. Every Aura contract must state its zone coverage and lifetime. '
      + '`Aura` becomes explicit keyword terminology once approved wording is wired.',
    domain: 'auras',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'An Aura is a global modifier affecting an eligible type, card, or population wherever the Aura defines.' }],
    // DELIBERATELY UNENFORCED (in the approved-but-unenforced queue): no probe yet pins the load-bearing
    // behavioral halves (auras reach future eligibles; plain copies stay plain yet receive applicable
    // auras; per-aura zone coverage + lifetime). auraFx.test.ts checks the FX stamp, not this contract.
  },

  // ── Per-instance temporal windows (Docbot handoff §5.0, owner rulings 2026-08-26) ──────────────────────
  {
    id: 'R-AVWIN-01',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Late entry starts at zero',
    statement:
      'An Avenge source summoned after earlier friendly deaths does not count those earlier deaths. Its '
      + 'observation window opens when the instance enters play; nothing before that is its progress.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Late entry starts at zero.' }],
    currentBehaviour:
      'Conforms: `placeSummon` stamps `avengeBaseline = deaths[side]` on every mid-combat summon '
      + '(the #1176 fix, owner report 2026-08-24); start-of-fight bodies keep baseline 0.',
  },
  {
    id: 'R-AVWIN-02',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'The summoning death does not count',
    statement:
      'If a friendly death summons an Avenge source, that same death is outside the new source\'s '
      + 'observation window — the source must not count the death that created it.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'The summoning death does not count.' }],
    currentBehaviour:
      'Conforms — 2026-09-10: both combat death paths count `deaths[side]` BEFORE the Echo fires, so a source the '
      + 'Echo summons stamps a baseline that already includes the death that created it. Was VIOLATED (pinned in '
      + 'temporalWindow KNOWN_VIOLATIONS 2026-08-27 → 2026-09-10): the Deathrattle fired before the increment.',
  },
  {
    id: 'R-AVWIN-03',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Exact copies inherit progress',
    statement:
      'An exact copy inherits accrued Avenge progress and used/unused once-per-combat state from the '
      + 'copied instance.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Exact copies inherit progress.' }],
    currentBehaviour:
      'Recruit-phase exact copies (Xerox\'s Copy Machine, owner ruling 2026-08-15) spread every '
      + 'per-instance field including permanent progression (`summonBonus`) — conforms. No effect creates '
      + 'an exact copy of a source with ACCRUED mid-combat window progress or a SPENT once-per-combat '
      + 'latch headlessly today, so the in-combat halves are approved-but-unenforced (no reachable '
      + 'scenario; see the PR-3 devlog).',
  },
  {
    id: 'R-AVWIN-04',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Plain copies reset progress',
    statement:
      'A plain copy begins with zero accrued counters and all instance-scoped triggers unused.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Plain copies reset progress.' }],
    currentBehaviour:
      'Conforms: plain copies are minted fresh from the card index (Bellringer Voss, Re-Pete\'s rule), '
      + 'so no per-instance counter can ride along.',
  },
  {
    id: 'R-AVWIN-05',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Gilding sums permanent card-owned progression additively',
    statement:
      'When copies combine into a Gilded minion, their permanent bonus progression is additive: copies '
      + 'carrying +3/+3 and +2/+2 of permanent progression produce a Gilded minion carrying +5/+5. '
      + 'Temporary combat/turn counters are NOT implied by this ruling and require their own scope '
      + 'treatment.',
    domain: 'gilding',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Gilding combines permanent card-owned progression.' }],
    currentBehaviour:
      'Conforms for the ruled shape (two progressed copies): the triple combine sums the TOP TWO copies\' '
      + '`summonBonus`. Note: with THREE progressed copies the lowest is dropped — the ruling\'s example '
      + 'names two, so the three-progressed-copies case remains an open wording question.',
  },
  {
    id: 'R-AVWIN-06',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Deaths count individually',
    statement:
      'Avenge evaluates each friendly death separately. A source with Avenge (3) observing six eligible '
      + 'deaths reaches its threshold twice.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Deaths count individually.' }],
    currentBehaviour: 'Conforms: every factory thresholds `seen % count === 0` per death.',
  },
  {
    id: 'R-AVWIN-07',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Avenge multipliers multiply resolution, not progress',
    statement:
      '"Your Avenges trigger twice" causes two resolutions when the threshold is reached. It does not '
      + 'make each death count twice.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Avenge multipliers multiply resolution, not progress.' }],
    currentBehaviour:
      'Conforms: Rune of Fury / The Sealed Vault re-run the avenge factory with the SAME payload count '
      + '(a second resolution); the death tally is untouched.',
  },
  {
    id: 'R-AVWIN-08',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Used state is part of an exact copy',
    statement:
      'If the source has already spent a once-per-combat effect, an exact copy also has that effect '
      + 'marked used.',
    domain: 'copying',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Used state is part of an exact copy.' }],
    currentBehaviour:
      'Approved-but-unenforced: no effect creates an exact copy of a body mid-combat AFTER a '
      + 'once-per-combat latch was spent (the only reachable exact copies are recruit-phase, where combat '
      + 'latches do not exist). Becomes enforceable the day such an effect ships.',
  },
  {
    id: 'R-AVWIN-09',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Rise creates a fresh observation window',
    statement:
      'When an Avenge source dies and Rises, the returned instance restarts with zero accrued Avenge '
      + 'progress.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Rise creates a fresh observation window.' }],
    currentBehaviour:
      'Conforms: the Rise return re-stamps `avengeBaseline = deaths[side]` AFTER its own rise-death was '
      + 'tallied, so neither prior progress nor the rise-death itself counts (owner ruling 2026-08-08).',
  },
  {
    id: 'R-AVWIN-10',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'A source dying in a simultaneous batch observes none of that batch',
    statement:
      'If an Avenge source dies in the same death instance/batch as other friendly minions, it counts '
      + 'none of those simultaneous deaths. Resolution order within the batch must not leak partial '
      + 'progress to the dying source.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'A source dying in a simultaneous batch observes none of that batch.' }],
    currentBehaviour:
      'Conforms — 2026-09-10: the avenge broadcast skips a source at ≤0 Health, so the sequential clash resolution '
      + '(cleave victims → target → attacker) leaks no batch-mate to a mortally wounded source. Was VIOLATED (pinned '
      + 'in temporalWindow KNOWN_VIOLATIONS 2026-08-27 → 2026-09-10): the guard checked only the `dead` flag.',
  },
  {
    id: 'R-AVWIN-11',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Rise returns at base Attack and 1 Health',
    statement:
      'A minion that Rises returns with its base Attack and exactly 1 Health, discarding its accumulated '
      + 'instance stats, unless the effect explicitly states a different return-stat rule. Independently '
      + 'applicable standing Auras are evaluated normally after the minion returns; they are not inherited '
      + 'instance buffs.',
    domain: 'combat',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Rise returns at base Attack and 1 Health.' }],
    currentBehaviour:
      'Conforms: the Rise branch resets to `def.attack × (golden ? 2 : 1)` and health 1, sheds granted '
      + 'keywords/instance buffs, then `applyAuras` re-applies standing auras on top. SHARPENED by R-RISE-01 '
      + '(owner 2026-08-28): the return stats are the base values taken BEFORE any Aura or standing effect, '
      + 'with the Auras re-applied on top of the returned body — measured and pinned there.',
  },

  // ── Triage round 2 (2026-08-27): the STANDING rules the owner's 24 rulings established. ──────────────
  // Rune-duplicate family rules R-RUNEDUP-01..08 (decisions.json q-runedup-*; implementation rides
  // feat/rune-duplicate-stacking, pinned by the runeSwallowScan lane), the two order rules, the
  // non-stacking best-of rule, and the per-phase Shout-charge rule.
  {
    id: 'R-RUNEDUP-01',
    title: 'Rune duplicates: recurring & per-event runes stack',
    statement:
      'A second copy of a recurring or per-event rune makes the effect fire once more each time it recurs: '
      + 'two Rune of the Coffers = +2 max Gold at End of Turn; two Rune of the Flagship = Dwarves get +4/+4 '
      + 'per Shop spell. Each additional copy adds one more fire per recurrence.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-recurring (triage round 2, 2026-08-27)', quote: 'APPROVE — second copy doubles the recurrence.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27, feat/rune-duplicate-stacking): a second copy adds one more fire per recurrence; the runeSwallowScan surface re-alarms if a duplicate ever swallows again.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-02',
    title: 'Rune duplicates: threshold runes double the payoff, not the meter',
    statement:
      'A second copy of a threshold/meter rune doubles the OUTPUT paid when the threshold is reached — the '
      + 'threshold itself is unchanged: two Rune of the Returning Pack = every 6 Beast summons yields 2 '
      + 'random Beasts. (Not parallel meters, and never a naive threshold sum.)',
    domain: 'runes',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-runedup-threshold (triage round 2, 2026-08-27)',
      quote: 'A second copy copy should double the output. i.e. 2 rune of the returning pack, every 6 beast summons you\'d get 2 random beasts, etc.',
    }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27, feat/rune-duplicate-stacking); pinned by the runeSwallowScan surface.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-03',
    title: 'Rune duplicates: repeat runes gain +1 repetition per copy',
    statement:
      'Each copy of a repeat rune (extra Shout/Rally/Echo/spell/hero-power/Improve/Triple-Reward fires) adds '
      + 'one more repetition: two Rune of the Wishbone = the hero power fires 3 times; two Rune of '
      + 'Adventuring = Rallies trigger 3 times. Rides the existing extraTriggerFires / per-family folds.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-repeat (triage round 2, 2026-08-27)', quote: 'APPROVE — +1 repetition per copy for the whole repeat family.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27, feat/rune-duplicate-stacking); pinned by the runeSwallowScan surface.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-04',
    title: 'Rune duplicates: one-shots re-grant, banking when immediate value is impossible',
    statement:
      'A duplicate one-shot rune fires its reward again immediately; when the immediate re-fire would still '
      + 'give no value, the effect banks and fires next turn (a second Rune of the Armory grants its 10 '
      + 'Attachments next turn — hand cap). Rune of the Muster with 2 copies covers the first 2 refreshes '
      + 'that turn. Rune of the Ornate Clock is unique — a duplicate does nothing. Rune of Held Strength is '
      + 'to be redesigned from a one-shot into a "Start of Combat: give xyz" rune.',
    domain: 'runes',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-runedup-oneshot (triage round 2, 2026-08-27)',
      quote: 'this should re-fire the one-shot reward again, but in the case where they would still get no value if done immediately, it should stack the effect for next turn. … rune of the ornate clock should do nothing if duplicated, that one is unique. rune of the held strength should not be a one-shot rune and should be a "Start of Combat: give xyz" rune so fix that too.',
    }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): one-shots re-grant or bank, Ornate Clock stays unique, and Rune of Held Strength is now a Start-of-Combat grant (the left and right-most minions gain the stats of the left-most card held in hand when the combat was built).',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-05',
    title: 'Rune duplicates: repeatable boolean combat flags fire once per copy',
    statement:
      'Every boolean combat flag whose effect can meaningfully repeat fires once per copy — flagCopies '
      + 'becomes live for the whole family, exactly as the rune-granted Avenge dispatchers already consume '
      + 'it (two Rune of Rallying = the left-most Rally triggers twice at Start of Combat). A flag that '
      + 'genuinely cannot repeat falls back to the universal sweetener (R-RUNEDUP-06).',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-boolean-flags (triage round 2, 2026-08-27)', quote: 'APPROVE — fire-once-per-copy for repeatable boolean flags, sweetener for the true one-offs.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): `flagCopiesOf` is consulted by every repeatable boolean flag (Rune of Warding triples once per copy, Rune of Rallying fires the left-most Rally once per copy, …).',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-06',
    title: 'Rune duplicates: the universal sweetener floor',
    statement:
      'A duplicate rune purchase is NEVER a dead buy. Any duplicate that cannot meaningfully stack instead '
      + 'grants an immediate consolation: Gold equal to half the rune\'s cost rounded up, plus a free Shop '
      + 'refresh. This is the fallback for every non-stacking duplicate, including via Rune of Duplication.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-sweetener-floor (triage round 2, 2026-08-27)', quote: 'APPROVE — half cost rounded up in Gold + a free refresh.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): the reducer pays half the cost rounded up in Gold plus a free refresh for every non-stacking duplicate.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-07',
    title: 'Rune duplicates: the forge filter',
    statement:
      'The Runeforge stops offering a rune the player already owns when its duplicate would only pay the '
      + 'sweetener (no real stacking behaviour). Runes whose duplicates stack (R-RUNEDUP-01..05, 08) stay '
      + 'offerable. Rune of Duplication still reaches everything; the sweetener backstops that path.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-forge-filter (triage round 2, 2026-08-27)', quote: 'APPROVE — filter non-stacking owned runes out of forge offers; ship with the sweetener.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): the forge filters owned sweetener-only runes out of its offers.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-08',
    title: 'Rune duplicates: unique engines double their output where possible',
    statement:
      'Duplicates of bespoke-engine runes double the effect when a doubling reading exists: two Rune of '
      + 'Structure = 2 random Shop spells per trigger; two Rune of Summoning = Imps get +4/+4; two Rune of '
      + 'Contraband = double the Ale/Ruby output per trigger. Engines with no sensible doubling fall back '
      + 'to the universal sweetener (R-RUNEDUP-06).',
    domain: 'runes',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-runedup-unique-engines (triage round 2, 2026-08-27)',
      quote: 'generally, try and double the effect when possible. rune of structure = you get 2 random shop spells. rune of summoning = your imps get +4/+4, rune of contraband doubles the output of the ale/ruby per trigger etc.',
    }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27); the doubled Rune of Summoning step is also why #1285 fixed the SINGLE copy to its printed +2/+2 (R-RUNE-SUM-01).',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-ORD-01',
    title: 'Improving grants read their step live, even mid-wave',
    statement:
      'An improving grant re-reads its current step for EVERY individual application, including within one '
      + 'simultaneous wave: when one Cleave kills two Mama Pups under Beardsley, the four summoned Pups are '
      + 'paid +3/+3, +3/+3, +3/+3, then +6/+6 — the step advances mid-resolution. Depth-first resolution '
      + 'with live magnitudes is the engine-wide rule.',
    domain: 'ordering',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-order-improve-steps-mid-resolution (triage round 2, 2026-08-27)', quote: 'APPROVE — live steps are the rule; every summon re-reads the current step, waves included.' }],
    currentBehaviour: 'Conforms — golden G4 (orderGoldens.test.ts) pins the mid-wave step advance.',
    enforcement: { kind: 'oracle', refs: ['orderGoldens'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-ORD-02',
    title: 'Shop: on-summon auras resolve before the played minion\'s own Shout',
    statement:
      'Playing a minion fires on-summon auras on it (with live improve steps) BEFORE its own Shout/Battlecry '
      + 'resolves: Den Mother grants the played Pennycat the base +2/+2, improves, and Pennycat\'s '
      + 'Shout-summoned Stray then receives the improved +4/+4. This is combat\'s R-ORD-01 rule applied '
      + 'consistently in the shop.',
    domain: 'ordering',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-order-shop-aura-before-shout (triage round 2, 2026-08-27)', quote: 'APPROVE — aura-first with live improve steps is the rule (matches combat\'s G4 ruling).' }],
    currentBehaviour: 'Conforms — golden G6 (orderGoldens.test.ts) pins aura-before-Shout with the improved grant on the token.',
    enforcement: { kind: 'oracle', refs: ['orderGoldens'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-MULT-01',
    title: 'The printed wording decides how a multiplier composes — "twice" multiplies, "additional" adds',
    statement:
      'A card that prints "trigger twice" is a MULTIPLIER: copies of the SAME card do not stack (two Drakkos '
      + 'are still twice), but DIFFERENT multiplier cards multiply with each other. A card that prints '
      + '"trigger N additional time(s)" is ADDITIVE: every copy of every additive card counts. The two combine '
      + 'as (1 + Σ extra) × Π factor. So two Sylus mean an Echo fires 3 times, two Drakko still mean a Shout '
      + 'fires twice, and Drakko + Zyff mean a Shout fires FOUR times. Gilding doubles an additive '
      + "card's extra and buys a multiplier ONE more trigger (golden Drakko is three times, not four).",
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'owner message 2026-08-28 (the terminology pass this rule anticipated)',
        quote: 'if something says "twice" then it is a multiplier and not "additional times" but they do not stack, whereas "additional time" texts do. i.e. 2 Sylus on board means an echo will trigger 3 times. 2 drakko on board means a Shout will trigger 2 times. Zyff + Drakko on board would mean that a shout triggers 4 times.',
      },
      {
        kind: 'owner-chat', ref: 'decisions.json q-interact-nonstack-best-of (triage round 2, 2026-08-27)',
        quote: 'This is correct behavior. We will probably change our text/terminology to better reflect non stackers. i.e. using "Twice" instead of "an additional time."',
      },
    ],
    currentBehaviour:
      'Conforms (rewritten 2026-08-28). SUPERSEDES the 2026-08-27 reading, under which every non-stacker '
      + 'collapsed to best-of across different cards (Drakko + Zyff = +1 total). The terminology pass this rule '
      + 'predicted turned out to change COMPOSITION as well as wording. `extraTriggerFires` is the one '
      + 'implementation; triggerMultiplierModel.test.ts pins every worked example verbatim.',
    enforcement: { kind: 'oracle', refs: ['interactionFamilyMatrix'], lastVerifiedAt: '2026-08-28' },
  },
  {
    id: 'R-SHOUT-01',
    title: '"First Shout each turn" charges are per-phase: shop and combat each carry their own',
    statement:
      'A "first Shout each turn/round triggers twice" charge (Warm Embers family) means the first Shout '
      + 'triggered in EACH shop or combat phase: a Shout doubled via Parting Cry in turn 7\'s combat spends '
      + 'that combat\'s charge, and the first Shout in turn 8\'s shop is a separate charge — both work. '
      + 'Combat use is not a double-dip of one charge; the phases account separately.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-carry-warm-embers-double-dip (triage round 2, 2026-08-27)',
      quote: 'first shout each turn = the first shout triggered EACH shop or combat phase. so if a shout gets triggered through parting cry in combat on turn 7, then the first shout in turn 8 is a separate charge, so both should work.',
    }],
    currentBehaviour: 'Conforms — shipped in #1262 (2026-08-27, the THIS TURN rule): each phase carries its own first-Shout charge; pinned by the carryOver lane.',
    enforcement: { kind: 'oracle', refs: ['carryOver'], lastVerifiedAt: '2026-08-27' },
  },

  // ── "THIS TURN" temporal scope (owner ruling 2026-08-27, decided on q-carry-demand-encore) ─────────────
  {
    id: 'R-TURN-01',
    title: '"This turn" runs from shop through that turn\'s combat',
    statement:
      'A turn is the shop phase PLUS the combat that ends it: an effect or tally scoped to "this turn" '
      + 'remains live and consumable through that turn\'s combat, and expires at the start of the next shop '
      + 'turn. So turn-scoped state a combat trigger can consume (Shout extras, per-turn tallies a '
      + 'Start-of-Combat or combat-triggered effect reads) must reach that combat — evaporating at the '
      + 'shop/combat boundary is a defect. Standing rule, applied retroactively to existing effects.',
    domain: 'persistence',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat',
      ref: 'q-carry-demand-encore (REVISE, 2026-08-27)',
      quote: '\'This turn\' terminology runs from shop through that turn\'s combat, and ends at the start of the next shop turn. so this effect should absolutely carry over into combat. use this language and logic moving forward and to retroactively fix issues.',
    }],
    currentBehaviour:
      'Enforced by the carry-over lane (carryOver.test.ts sweeps every per-turn reducer reset through a real '
      + 'combat; excuses in CARRY_OVER_EXCUSED cite this rule) plus the printed-text sweep '
      + '(thisTurnRule.test.ts classifies every content def whose text says "this turn"). Demand an Encore '
      + 'was the one violation found on 2026-08-27 and now carries via questCombatMods.encoreExtra.',
    enforcement: {
      kind: 'scenario',
      refs: [
        'packages/sim/src/shoutCarryOver.test.ts',
        'packages/sim/src/docbot/carryOver.test.ts',
        'packages/sim/src/docbot/thisTurnRule.test.ts',
      ],
      lastVerifiedAt: '2026-08-27',
    },
  },

  // ── GILDING (owner rulings 2026-08-28, decided on the four REVISEd convention cards) ───────────────────
  {
    id: 'R-GILD-01',
    title: 'Gilding doubles the output — with three sanctioned outlier shapes',
    statement:
      'Doubling the output is the safe baseline for a gilded card. Three outlier shapes are sanctioned and '
      + 'must be stated, never assumed: the gild may summon a GILDED TOKEN at the same count instead of more '
      + 'tokens (Dunkey → a gilded Armadiyo); it may RESHAPE the effect rather than its numbers (High King '
      + 'Mykel: one adjacent Shout → both adjacent); or it may buy an EXTRA PROC of the same payload '
      + '(Gemstorm Instigator procs an additional time, printed as double its Rubies). A card whose gild is '
      + 'not the baseline carries authored golden text saying which shape it is.',
    domain: 'gilding',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'decisions.json q-conv-family-avenge (REVISE, 2026-08-28)',
        quote: 'in some cases it summons more minions when gilded, in other cases it summons a gilded token instead. dunkey for example summons a gilded armadiyo, whereas gilded gemstorm instigator would proc an additional time (double its rubies)',
      },
      {
        kind: 'owner-chat', ref: 'decisions.json q-conv-family-castPayoff (REVISE, 2026-08-28)',
        quote: 'some versions double their numbers, some versions double their payoff or be unique. for example, gilded baal doubles its consume quantity, but high king mykel goes from 1 adjacent to both adjacent minions.',
      },
      {
        kind: 'owner-chat', ref: 'decisions.json q-conv-family-echo (REVISE, 2026-08-28)',
        quote: 'i think doubling the output is the safe baseline with outliers being other behavior',
      },
    ],
    currentBehaviour:
      'Encoded in the contract schema as GildedDeltaContract\'s kinds — \'multiply\' (the ×factor baseline), '
      + '\'gilded-token\', \'reshape\', \'extra-proc\' — each carrying a `basis` that says whether the shape was '
      + 'DERIVED from the defs or named by an owner ruling. The extractor derives the shape from the '
      + '`goldenTokens` factory param and a plain-vs-golden text diff, and refuses to guess (kind \'other\', '
      + 'basis \'unresolved\', the gap listed in extraction.unparsed) where it cannot; the contract oracle '
      + 'turns each kind into its own count law and drives the gilded-token claim through the real engine.',
    enforcement: { kind: 'oracle', refs: ['gildingKinds'], lastVerifiedAt: '2026-08-28' },
  },
  {
    id: 'R-GILD-02',
    title: 'Spells are never gilded',
    statement:
      'A spell can never be gilded. There is no golden spell, no gilded spell text, and no gilded magnitude '
      + 'for a spell — the whole gilding aspect is INAPPLICABLE to the spell family, not merely unmeasured. '
      + 'Any probe, contract or report that touches a spell\'s gilding must record it as skipped with that '
      + 'reason rather than leaving it in the unresolved pool.',
    domain: 'gilding',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-conv-family-spellCast (REVISE, 2026-08-28)',
      quote: 'spells cannot be gilded',
    }],
    currentBehaviour:
      'The engine already agrees: checkTriples (packages/sim/src/reducer.ts) skips `spell` and `ruby` defs, so '
      + 'no three copies ever combine into a golden one. The ruling is now encoded — every spell contract '
      + 'states gildedDelta \'not-applicable\', the schema validator rejects any other claim on a spell (and '
      + 'rejects an ABSENT claim, which would read as unprobed), the case planner emits a typed '
      + '\'gild-not-applicable\' skip carrying the reason, and the text lane alarms if a spell ever grows an '
      + 'authored gilded body.',
    enforcement: { kind: 'oracle', refs: ['gildingKinds'], lastVerifiedAt: '2026-08-28' },
  },

  // ── Sitting-2 / keyword-convention rulings (owner triage 2026-08-28) ───────────────────────────────────
  {
    id: 'R-RISE-01',
    title: 'Rise returns at BASE stats first — Auras apply afterwards, and are never baked into the return',
    statement:
      'A minion that Rises returns at its printed base Attack (×2 while Gilded) and exactly 1 Health, taken '
      + 'BEFORE any Aura or standing effect is added — the return value is the printed body, never the body '
      + 'the Auras had grown. Every independently applicable Aura (Undead, Imp, Beast, Attachment, per-card '
      + 'enchants) is then re-applied to the returned body normally: a Rise under a +3/+2 Undead Aura comes '
      + 'back at base+3 Attack and 3 Health, not base/1 (Auras skipped) and not its pre-death stats (Auras '
      + 'baked in). This SHARPENS R-AVWIN-11 with the ordering: base first, Auras second.',
    domain: 'combat',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-conv-keyword-r (keyword conventions, 2026-08-28)',
      quote: 'it returns with 1 health and base attack before any auras or effects are added, i.e. undead aura.',
    }],
    currentBehaviour:
      'Conforms (measured 2026-08-28): the Rise branch in simulate.ts resets to `def.attack × (golden ? 2 : 1)` '
      + 'and Health 1, sheds granted keywords / instance buffs / rally gifts, and only THEN calls '
      + '`applyAuras(minion, true)` — the from-base pass that re-adds each side-scoped Aura (including the '
      + 'buy-time slices). Pinned by the Rise-aura probe in temporalWindow.test.ts.',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'], lastVerifiedAt: '2026-08-28' },
  },
  {
    id: 'R-MULT-02',
    title: 'Trigger-multiplier composition is family-agnostic — End of Turn and Start of Combat fold like the rest',
    statement:
      'The composition law of R-MULT-01 applies to EVERY trigger family, not only the ones with a named '
      + 'precedent — a family needs no ruling of its own to be composed this way. So Uron (additive) and '
      + 'Chronos ("twice", a multiplier) together make End-of-Turn effects fire (1 + 1) × 2 = FOUR times; Uron '
      + 'alone makes Start-of-Combat effects fire twice; and Rune of Twilight adds its pass on top of the fold '
      + '(owner reversal 2026-08-20). REVISED 2026-08-28 by the wording rule: the earlier reading '
      + 'collapsed Uron + Chronos to 2×, which was right under the all-additive model it was approved against '
      + 'and wrong under the one that replaced it the same day.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'decisions.json q-interact2-32aa654f (Sitting-2 anomaly deck, 2026-08-28)',
        quote: 'APPROVE — Reading A: these families fold like the ruled ones: additive within a family, best-of across non-stacking cards.',
      },
      {
        kind: 'owner-chat', ref: 'decisions.json q-interact2-faeb3c44 (Sitting-2 anomaly deck, 2026-08-28)',
        quote: 'APPROVE — Chronos\'s endOfTurn multiplier composes by the same law.',
      },
    ],
    currentBehaviour:
      'Conforms — `extraTriggerFires` (packages/core/src/types.ts) is written per FAMILY, not per card, and is '
      + 'the single boundary every family consults: `familyRepeats`/`endOfTurnRepeats` in recruit.ts and the '
      + '`scReps` fold in simulate.ts. Pinned by matrix fixtures P12–P13 (interactionFamilyMatrix.test.ts); '
      + 'this ruling also resolves interaction-ambiguities.md Q1 and takes endOfTurn/startOfCombat off the '
      + 'anomaly oracle\'s unruled-composition worklist.',
    enforcement: { kind: 'oracle', refs: ['interactionFamilyMatrix', 'interactionSweep'], lastVerifiedAt: '2026-08-28' },
  },
  // ── Late-2026-08 / early-2026-09 fixes and rulings (owner reports + Bug Board rounds 1–2), entered 2026-09-09 ──
  {
    id: 'R-TIER-01',
    title: 'Skybound Ascendant reaches Tier 7 on every run — an authored Tier-7 source is not bound by the Tier-7 access gate',
    statement:
      'A card that prints "up to Tier 7" transforms up to Tier 7 on EVERY run. The Shop\'s Tier-7 access gate '
      + '(Summit runs, quest grants) governs what the Shop can OFFER, not what an authored effect can produce: '
      + 'Skybound Ascendant steps its left neighbour up to seven on a plain run, and a neighbour already at '
      + 'seven re-rolls at seven. The printed 7 is always true, so the live text never rewrites it to 6.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'Bug Board cb45dc41 (round 2, 2026-09-09) — overruling the first by-design close',
      quote: 'it should work up to tier 7 always. it is not bound by t6 rules.',
    }],
    cardText: '**End of Turn:** transform the minion to the **left** into a random minion **one Tier higher** (up to **Tier 7**).',
    contentIds: ['d2_ascendant'],
    currentBehaviour:
      'Conforms — #1374: `endOfTurnTransformLeftTierUp` clamps to a constant 7 (was `hasTier7Access ? 7 : 6`), '
      + 'and the `ascendantTierText` live-text rewrite is deleted. Clockwork Assistant\'s Discover still reads the '
      + 'run ceiling — it is a Shop offer, which is exactly what the gate governs.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/runeMinionsAug20.test.ts', 'packages/ui/src/instView.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-GIFT-01',
    title: 'A targeted Gift pays out on the minion the player chose',
    statement:
      'Kindness\'s targeted Gifts (Unbridled Might, Ironclad, Regalia, Parting Gifts) do exactly what they print '
      + 'to the chosen target — the cast payload carries the aimed minion, and a Gift whose text says "then" '
      + 'applies its steps in printed order (+2 Attack, THEN double). Mirrorwing pays its once-per-turn re-cast '
      + 'once, never for a Gift with no target.',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1374 (Bug Board 9852e16f, priority 6)', quote: 'give a minion + 2 attack and then double its attack is broken on mirrorwing. zero effect.' },
      { kind: 'card-text', ref: 'packages/content/src/cards/gifts.ts', quote: 'Give a friendly minion **+2 Attack**, then **double its Attack**.' },
    ],
    contentIds: ['gift_unbridled', 'gift_ironclad', 'gift_regalia', 'gift_parting_gifts'],
    currentBehaviour:
      'Conforms — #1374: `applyCastEffects` in recruit.ts hands the targeted factories `payload.target` (they '
      + 'read `target`, the payload only carried `minion`), so every targeted Gift resolves on the aimed body. '
      + 'Pinned per Gift, through the real reducer.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/gifts.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RALLY-01',
    title: 'A free Rally is a triggered Rally — the "when a Rally is triggered" watchers fire on it',
    statement:
      'A Rally fired without a swing (Rune of Rallying at Start of Combat, Backbeat, Hunting Bell) is a Rally '
      + 'TRIGGERED, so every watcher whose text says "when a Rally is triggered" / "whenever you trigger a Rally" '
      + '(Hawkus → your left-most Echo, Paragon, Rubies-on-Rally) fires on it exactly as on a swing\'s Rally. No '
      + 'attack happens and no on-attack bus event is emitted — the watchers are reached directly.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1374 (Bug Board 7e04222d, priority 8)', quote: 'hawkus doesnt seem to be triggering dawnclaw after a rally unit triggers its rally effect' },
      { kind: 'card-text', ref: 'b2_hawkus', quote: 'When a **Rally** is triggered, trigger your **left-most Echo**.' },
    ],
    contentIds: ['b2_hawkus', 'rune_rallying'],
    currentBehaviour:
      'Conforms — #1374: `fireFreeRally` in simulate.ts runs `FREE_RALLY_WATCHER_EFFECTS` (onRallyBuffOnePerTribe, '
      + 'onRallyProcLeftmostEcho, onRallyPlayRubiesTribe) over the rallier\'s board after its own on-attack effects.',
    enforcement: { kind: 'scenario', refs: ['packages/core/src/combat/freeRallyWatchers.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RALLY-02',
    title: '"Rally:" is the card\'s own swing; "whenever you trigger a Rally" is a watcher — sharing a factory does not share the trigger',
    statement:
      'A card that prints "**Rally:**" fires on ITS OWN swing only (Standard Bearer). A card that prints '
      + '"whenever you trigger a Rally" / "when a Rally is triggered" is a WATCHER and fires on every friendly '
      + 'Rally (Paragon). Two cards sharing one effect factory must still honour their own printed wording — '
      + 'the wiring carries a `selfOnly` gate, not a second factory.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{
      kind: 'fix-pr', ref: '#1361 (owner report 2026-09-03)',
      quote: 'standard bearer is acting as a watcher … whenever ANY rally minion attacks, it is buffing other units.',
    }],
    cardText: '**Rally:** give a minion of **each type** **+3/+3**.',
    contentIds: ['n2_standardbearer'],
    currentBehaviour:
      'Conforms — #1361: `onRallyBuffOnePerTribe` takes `selfOnly`, gating `attacker.uid !== arena.self.uid` in both '
      + 'dispatch paths (combat\'s refireRallyWatchers, the shop\'s fireShopRally); Standard Bearer sets it, Paragon does not. '
      + 'The rallyGuard lane classifies every Rally wording against its dispatch.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/rallyGuard.test.ts', 'packages/sim/src/rallyDispatch.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-SHOP-01',
    title: 'The Shop never overflows its capacity',
    statement:
      'The Shop row is sized by its tier and nothing grows it past that: an effect that adds an offer (Rune of '
      + 'Open Enrollment, Pete\'s dominant-type offer, any future "add a minion to the Shop") fills a FREE slot '
      + 'when the row is short and otherwise REPLACES an existing offer, returning the displaced card to the pool. '
      + 'A seventh card at Tier 6 is a defect.',
    domain: 'economy',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'Bug Board 5c5b50a0 (round 1, 2026-08-31, #1325)',
      quote: 'the shop should never overflow beyond its capacity, it should only ever replace available slots with affected minions or spells etc.',
    }],
    contentIds: ['rune_open_enrollment'],
    currentBehaviour:
      'Conforms — #1325: `appendDominantTypeOffer` fills a free slot or replaces the right-most minion offer (Pete\'s '
      + '2026-08-14 shape); the shopCapacity lane sweeps every Shop-growing effect against `tierSlots(tier)`.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/shopCapacity.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-REFLECT-01',
    title: 'Reflector: Spells and Rubies share ONE once-per-turn re-cast',
    statement:
      'Reflector\'s "(Once per turn)" is a single allowance shared by both things it reacts to: the first Spell '
      + 'OR Ruby cast on it each turn is re-cast on a random friendly minion, and nothing else cast on it that '
      + 'turn reflects. Two Rubies then a Crest of the Climb reflects only the first Ruby; Crest first on a fresh '
      + 'Reflector reflects the Crest.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1326 (Bug Board 224af0ee, priority 2) — the text was the defect, the engine was right', quote: 'Spells and **Rubies** cast on this also cast on a random friendly minion. (Once per turn)' },
      { kind: 'test', ref: 'packages/sim/src/reflectorSharedAllowance.test.ts (#1374 — the behaviour lane the text PR shipped without)' },
    ],
    cardText: 'Spells and **Rubies** cast on this **also cast** on a random friendly minion. **(Once per turn)**',
    contentIds: ['n2_reflector'],
    currentBehaviour:
      'Conforms: both factories (`spellCastOnThis`, `onRubyPlayed`) guard on `spellsOnThisTurn + rubiesOnThisTurn === 1`, '
      + 'so the allowance is one per turn across both kinds. Pinned in both orders through the real reducer.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/reflectorSharedAllowance.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RUNE-SUM-01',
    title: 'Rune of Summoning pays the +2/+2 it prints — the text is the contract',
    statement:
      'When a rune\'s printed step and its factory disagree, the PRINTED step is the contract: Rune of Summoning '
      + 'improves your Imps by +2/+2 per spell cast (the factory paid +1/+1). Rune of Mastery and a second copy '
      + 'multiply that step (+4/+4), which is how the owner\'s duplicate ruling fixed which side was right.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'decisions.json q-runedup-unique-engines (2026-08-27)', quote: 'rune of summoning = your imps get +4/+4' },
      { kind: 'fix-pr', ref: '#1285 (2026-08-28) — the text oracle surfaced the drift' },
    ],
    contentIds: ['rune_summoning'],
    currentBehaviour: 'Conforms — #1285: the step is a named constant read by the single copy, Mastery and extra copies.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/runes.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-HAND-01',
    title: 'Hand-gain watchers fire in combat, when the card arrives — not at carry-back',
    statement:
      '"When a card is added to your hand" (Gangplank) fires the moment a card reaches the hand, in EITHER phase: '
      + 'a card granted mid-combat (`grantToHand`, `grantRubies`) triggers the watcher during that fight, so the '
      + 'payout can affect the fight that earned it. A payout that lands on the shop board after the fight is late, '
      + 'and late is a defect.',
    domain: 'triggers',
    status: 'approved',
    evidence: [{ kind: 'fix-pr', ref: '#1297 (owner report 2026-08-29)', quote: 'GANGPLANK DOESN\'T TRIGGER WHEN CARDS ARE ADDED TO HAND IN COMBAT' }],
    cardText: 'When a card is added to your hand, give a **random** friendly **Dwarf +1/+2**.',
    contentIds: ['dw_gangplank'],
    currentBehaviour:
      'Conforms — #1297: `onGainCard` bodies moved to ARENA_EFFECTS so both phases run one implementation; combat emits '
      + 'from `ctx.grantToHand` / `ctx.grantRubies`, the only two ways a card reaches a hand mid-fight.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/handGainInCombat.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RISE-02',
    title: 'Rise works outside combat — a Shop destroy follows combat\'s death sequence',
    statement:
      'A minion destroyed in the Shop (sold-by-effect, consumed, sacrificed) dies the way it would in combat: its '
      + 'departure is a consequence of its own, and a body with Rise returns in the Shop exactly as it would in a '
      + 'fight (base Attack, 1 Health — R-RISE-01). Rise is a keyword, not a combat-only keyword.',
    domain: 'keywords',
    status: 'approved',
    evidence: [{ kind: 'fix-pr', ref: '#1289 (owner ruling 2026-08-28)', quote: 'makes Rise fire in the shop (owner ruling)' }],
    currentBehaviour:
      'Conforms — #1289/#1290: every Shop destroy routes through one helper that follows combat\'s death sequence and fires Rise.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopDestroy.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-ENGRAVE-01',
    title: 'Every combat stat gain resolves through the one buff chokepoint — Engrave sees all of them',
    statement:
      'Engrave (the EG keyword, and the Transcendant adjacency aura "while alive and adjacent") is resolved at the '
      + 'moment stats are gained, inside the single combat buff path. So EVERY combat stat gain — rune grants at '
      + 'Start of Combat included — must go through that path; a gain applied by direct assignment is invisible to '
      + 'Engrave and evaporates at carry-back. Rune of Warding\'s tripled Health on a warded Dragon beside a '
      + 'Transcendant carries back like any other gain. Ordering is not the question: there is no "before the '
      + 'Engrave" — the aura is read live on each gain.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1377 (Bug Board 7130a89b, 2026-09-09)', quote: 'rune of warding does not work with a dragon and transcendance. i believe "start of combat" occurs before transcendants engrave effect' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts ctx.buff — the Transcendant adjacency read (owner respec 2026-08-17)' },
    ],
    cardText: '**Ward.** Adjacent **Dragons** are **Engraved**.',
    contentIds: ['d2_transcendence', 'rune_warding'],
    currentBehaviour:
      'Conforms — #1377: Warding\'s tripling calls `ctx.buff` once per rune copy (it was the last Start-of-Combat rune '
      + 'grant applying stats by hand). Every other SoC rune grant already went through `ctx.buff`.',
    enforcement: { kind: 'scenario', refs: ['packages/core/src/combat/runeWardingEngrave.test.ts', 'packages/core/src/combat/simulate.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-TARGET-01',
    title: '"A random friendly <tribe>" includes the source — a lone Gangplank buffs itself',
    statement:
      'An effect that gives "a random friendly Dwarf" (or any random friendly member of a type) picks from EVERY '
      + 'living friendly minion of that type, the source included. Gangplank standing alone as the only Dwarf '
      + 'gains its own +1/+2 on every card added to hand. Excluding the source needs the word "another" in the '
      + 'printed text; without it, "friendly" means the whole side.',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'decisions.json q-gangplank-self-buff (Rulebook board, 2026-09-09)', quote: 'APPROVE — keep as printed: it may buff itself.' },
      { kind: 'owner-chat', ref: 'Bug Board 38d186a6 (round 2, 2026-09-09) — the report that raised it', quote: 'gangplank can buff itsself if its the only dwarf on board' },
    ],
    cardText: 'When a card is added to your hand, give a **random** friendly **Dwarf +1/+2**.',
    contentIds: ['dw_gangplank'],
    currentBehaviour:
      'Conforms: `onGainCardBuffTribe` (arena.ts) picks from every living friendly body of the tribe via the shared '
      + 'tribe predicate, the source among them. Pinned by the lone-Gangplank case in handGainInCombat.test.ts '
      + '("Gangplank is the only one here, so it is its own recipient").',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/handGainInCombat.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-HAND-02',
    title: 'A card buffed in hand keeps the buff — permanently, in every phase',
    statement:
      'A stat buff that lands on a card IN YOUR HAND is permanent, whatever phase granted it. A combat effect '
      + 'that buffs a hand card mid-fight leaves that card buffed in the next shop and for the rest of the run, '
      + 'exactly as a recruit-phase hand buff does. It is also shown as it happens: the replay grows the hand '
      + 'card on the beat the buff fires, not when the fight settles.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (this ruling)', quote: 'cards buffed in hand are always permanent. so if something buffs a card in hand during combat, that card in hand retains the buff. the buff also needs to show in real time like all of our other effects do.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts ctx.buffHand → CombatResult.playerHandBuffs; packages/sim/src/reducer.ts settle (addBuff onto the run hand); packages/ui/src/useCombatReplay.ts handBuffsShownThrough' },
    ],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09). Combat reaches the hand through ONE verb, `ctx.buffHand`: it '
      + 'logs a `handBuff` event and accumulates `playerHandBuffs`, which settle applies to the run hand with '
      + '`addBuff` (attributed to the granting body). The arena verbs `handMinions` / `buffHand` give both phases '
      + 'the same body — the shop adapter buffs the hand cards directly. The hand row adds the reached deltas '
      + 'on the beat of each buff and drops them at settle, when the permanent buff is in the run hand itself. '
      + 'No shipped card buffs the hand mid-fight yet; `deathrattleBuffHandTribe` is the first factory on the '
      + 'channel, and the scenario drives it through simulate() with an injected probe card.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/handBuffInCombat.test.ts', 'packages/ui/src/useCombatReplay.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RISE-03',
    title: 'Rise watchers fire in both phases — a shop Rise pays out, permanently',
    statement:
      '"When a friendly minion Rises" is an event of its own, and it fires wherever the Rise happens: in combat '
      + 'when a body returns, and in the shop when a destroyed body returns (R-RISE-02). The payout of a watcher in '
      + 'the shop is permanent — the stats AND any keyword it grants (the Ward of Revenant) — exactly as any recruit-phase '
      + 'gain is; in combat the board half is a normal combat gain and a hand half is permanent (R-HAND-02). Only a '
      + 'FRIENDLY Rise counts: an enemy body returning wakes nothing on your side.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (set-3 Undead roster review, answers 3–5)', quote: 'friendly only … if minions rise in shop, that would trigger rising tide and that buff would be permanent since it\'s in recruit. this will be a common trigger/effect in set 3 so make sure that logic is wired correctly for minions rising in recruit.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts (the onRise bus emit after the reborn return); packages/sim/src/recruit.ts fireOnRise (off riseReturn in settlePendingDeath)' },
    ],
    contentIds: ['u3_revenant', 'u3_risingtide'],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09). One trigger, `onRise`, dispatched from the single Rise site of each '
      + 'phase with the risen body in the payload; the watchers are side-guarded in combat and land shop grants through '
      + '`addBuff` / the keyword list. Pinned for Revenant and Rising Tide in both phases, including an enemy Rise doing nothing.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-TEXT-01',
    title: 'A minion that casts a named spell prints the spell, not its value',
    statement:
      'A minion whose effect CASTS a named spell (Watcher, Soul-Lantern Hierophant, Anubis: "cast Lantern of Souls") '
      + 'prints the spell name and stops. It never restates what the spell does or the number it will produce; the '
      + 'spell is an associated card of the minion, and its hover preview carries the live, spell-power-aware value '
      + '— exactly as a Ruby is previewed from the Kobolds that cast it. The live-text rule for scaling values is '
      + 'satisfied by the preview, not by the caster.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Hierophant card review)', quote: 'the text should simply be "Avenge (3): cast Lantern of Souls" and then the lantern of souls should be a hover preview associated card, like a ruby.' },
      { kind: 'owner-chat', ref: 'CLAUDE.md, live-text rule — the sanctioned exception (owner ruling 2026-07-15)', quote: 'a minion that casts a named spell may name the spell and let the hover-preview of the spell show its live value, instead of restating it' },
    ],
    contentIds: ['watcher', 'u3_hierophant', 'anubis'],
    currentBehaviour:
      'Conforms — 2026-09-09: Watcher and the Hierophant lost their "— your Undead get +N" tails; `watcherText` (the '
      + 'helper that restated the Lantern value on Watcher) is retired to a no-op; `CARD_REF_EFFECTS` maps every '
      + 'named-spell caster factory (`rallyCastTribeAttack`, `deathrattleCastTribeAttack`, `avengeCastTribeAttack`) '
      + 'to its `spellId`, which is what the hover preview reads.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/cardText.test.ts', 'packages/content/src/refPreview.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-AURA-02',
    title: 'An Aura-affecting spell is permanent from any phase — Lantern of Souls in combat included',
    statement:
      'A spell whose effect changes an Aura (Lantern of Souls: "your Undead Aura gets +3 Attack") is permanent '
      + 'wherever it is cast. A combat cast — a Rally, an Avenge, an Echo — raises the run-wide Aura exactly as a '
      + 'shop cast does: carried back at settle and in force for the rest of the run. There is no combat-only Aura.',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (triple confirmation)', quote: 'lantern of souls is always permanent since it is an aura affecting spell … therefore, lantern of soul casts in combat are always permanent.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts grantUndeadAura → CombatResult.playerUndeadAuraGain; packages/sim/src/reducer.ts settle → undeadAttackBonus' },
    ],
    contentIds: ['lanternofsouls', 'watcher', 'u3_hierophant', 'anubis'],
    currentBehaviour:
      'Conforms: every combat Lantern cast goes through the arena verbs `castRepeat` + `grantUndeadAura`, whose gain is '
      + 'carried back on `playerUndeadAuraGain` and added to the run Aura at settle. Pinned by the Hierophant case '
      + '(a combat Avenge cast carries +3 back) and the shop cast in run.test.ts.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts', 'packages/sim/src/run.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RISE-04',
    title: 'A risen body is the card as printed: improvements reset, Auras re-applied, in both phases',
    statement:
      'When a body returns via Rise it is the card AS PRINTED: base Attack (golden doubled), 1 Health, the printed '
      + 'keywords minus the spent Rise. Everything the instance had accrued goes with the buffs — a per-instance '
      + 'improvement (the grown Echo of Sergey, the tally of a Chef, an overflow bank, an End-of-Turn escalation), a copied '
      + 'Echo, a granted keyword. The Auras of the run are then re-applied on top, as for any fresh copy: the Undead '
      + 'Aura, a per-card Aura (the Spear Warden one). The same rule in both phases.',
    domain: 'keywords',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Deathfibrillator reports)', quote: 'it rose with its buffed text still. this should reset per our rise rules … the deathswarmer and the new spear warden were both deathfibrillatored and neither have undead attack aura buffs nor the spear warden buff.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts riseReturn (a fresh body from the def + cardBuff + the buy Auras); packages/core/src/combat/simulate.ts the Rise block (resets + applyAuras(m, true))' },
    ],
    contentIds: ['sergeant', 'knit', 'deathswarmer'],
    currentBehaviour:
      'Conforms — 2026-09-09: the shop Rise builds the body fresh instead of spreading the dying card (which had '
      + 'carried buffs and improvements) and folds in the per-card enchant + buy Auras; the combat Rise now also '
      + 'clears the per-instance improvements it used to keep. The Undead Aura is a display fold on both.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RISE-05',
    title: 'Echo first, THEN the Rise attempts — a dying body holds no slot; its Echo takes the freed room and a return with no room overflows',
    statement:
      'A minion with Rise (or Rebirth) that dies resolves in this order, in BOTH phases and for ALL Rise/Echo '
      + 'interactions: it dies and leaves its slot → its Echo fires (an Echo that summons lands in the freed slot) '
      + '→ THEN it attempts to return, to the right of what its Echo summoned. If the board is full by then, the '
      + 'return finds no room: that counts as an overflow (Squatimus, Flowing Monk pay off) and the body stays dead. '
      + 'A Rise minion whose Echo summons nothing still rises on a full board. REVERSES the 2026-09-09 reading '
      + '(the rising body held its slot through its Echo, so the Echo summon overflowed and the body returned) — '
      + 'which the owner reported as "the minion rises BEFORE its Echo triggers".',
    domain: 'keywords',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner handoff 2026-09-18 (Deathfibrillator on a 7-body board)', quote: 'it gives the minion Rise and kills it, but then that minion rises BEFORE its Echo triggers. This is wrong. The Echo should trigger from the death of the minion, THEN the minion attempts to rise. This is true for ALL Rise/Echo interactions.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Rodrick / Squatimus report) — SUPERSEDED on the slot-hold; kept for "a return that does not fit counts as overflowing"', quote: 'it DOES count as overflowing if a rising minion does not fit.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts killOrReborn (no slot reservation; `occupied` = living); packages/sim/src/recruit.ts settlePendingDeath + destroyMinionInShop (every dying body is `vacatingUid`) + riseReturn / rebirthReturn → fireSummonOverflow' },
    ],
    contentIds: ['u3_rodrick', 'u3_squatimus', 'u3_ems'],
    currentBehaviour:
      "Conforms — 2026-09-18: combat dropped the `risingReserved` hold, so the Echo's summons place into the freed "
      + 'slot and the return is gated on `living < 7` afterwards (an overflow when it fails); the shop marks a rising '
      + 'body `vacatingUid` like any other dying body, so the summon path discounts it, and `riseReturn` / '
      + '`rebirthReturn` fire the overflow dispatcher when the return has no room.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts', 'packages/core/src/combat/simulate.test.ts', 'packages/core/src/combat/rebirth.test.ts', 'packages/sim/src/shopDestroy.test.ts'], lastVerifiedAt: '2026-09-18' },
  },
  /* ── 2026-09-09 / 2026-09-10 — the Set 3 Spirits rulings and the owner's bug-report rulings of 2026-09-10 ── */
  {
    id: 'R-HAND-03',
    title: 'A locked hand card can be buffed, but never summoned from hand',
    statement:
      'A card locked in hand — Disco Dan\'s Setlist tier lock, Brackus\'s Gold-spent lock, the Hourglass Reserve\'s '
      + 'next-turn lock — cannot reach the board by ANY route while the lock holds: not by playing it, not by a '
      + 'summon-from-hand copy (the Set 3 Spirits, in the shop or in combat), not by Rope Wrangler. It can still be '
      + 'buffed in hand and still counts for effects that only READ the hand (Handbound Titan, Flamebanner Marshal). '
      + 'A summoner that would have taken it takes the next candidate instead.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'a locked minion (like disco dan for example) cannot be summoned from hand. they can be buffed but not summoned.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts handCardLocked (the one predicate; play / summonCopyFromHandShop / the shop pickers); packages/core/src/combat/simulate.ts summonCopyFromHand + takeRandomHandMinion refuse a `locked` hand card; the combat hand carries `locked` from the run and the snapshot' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1398). Before it, only the play action checked the lock; the Spirit summon-from-hand '
      + 'paths picked straight from the hand.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Spirits.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-ARMOR-01',
    title: 'Armor gained in the shop lasts until damage removes it',
    statement:
      'Armor is a persistent pool that only damage reduces. Anything that raises it during the shop — Mend\'s "set '
      + 'Armor to 5" (a floor, never a shave) or any other grant — stays until combat damage spends it. There is no '
      + 'per-turn expiry, and in lobby-family runs the player\'s SEAT must fight with the run\'s current pools, not '
      + 'a stale copy taken at creation.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'mend\'s armor falls off after a turn - please fix this as the setting 5 armor effect should last until the armor is damaged/removed from damage.' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts settleCombat (seat 0 re-seeded from the run before the hit) + settleLobbyRound (seat → run write-back); packages/sim/src/recruit.ts setArmor' },
    ],
    contentIds: ['mend'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1400). The seat was seeded from the run once at creation and only ever lost; '
      + '`settleLobbyRound` then wrote the stale seat value back over the run, so Mend\'s Armor vanished one round later. '
      + 'The seat is now re-seeded from the run at combat settle, before either side is charged.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/lobby/runLobby.test.ts', 'packages/sim/src/run.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-RAND-01',
    title: '"Consumes a minion in the Shop" is a seeded random pick',
    statement:
      'When a card says it Consumes "a minion in the Shop" with no position named, the meal is a RANDOM edible '
      + 'offer (a minion — never a spell or Ruby in the row), drawn from the run\'s seeded rng cursor so replays '
      + 'agree, and re-drawn after each bite because the row shifts. It is never the right-most, the fattest, or '
      + 'any other fixed slot. Appetite Agent\'s target eats this way; Cinder Clerk, Chipper, Cupcakes, Gemgorge and '
      + 'Baal already did.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (Mike\'s report, relayed)', quote: 'make sure that appetite agent\'s consume target is always random' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts battlecryTargetConsumesShop (edible list + rng.int per bite); battlecryConsumeShopRandom' },
    ],
    contentIds: ['dm_agent'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1401). The Agent\'s meal was hard-coded to `rightmostShopMinion`, which in a Demon '
      + 'run is also the slot every right-most buff re-lands on each roll — hence "always the fattest".',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set2Demons.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-ORD-03',
    title: 'A right-most Consume always takes the right-most edible offer — a bonus bite never displaces it',
    statement:
      'A card that Consumes "the right-most minion in the Shop" (Bob Blart, Grevlin & Co., Rune of Hunger) eats the '
      + 'right-most EDIBLE offer — the last minion in the row, skipping any spell or Ruby to its right — every time '
      + 'it fires, and the check never fails while an edible offer exists. An extra Consume granted alongside it '
      + '(Bottomless Banquet\'s "the first Consume each turn eats twice") takes ANOTHER offer and must not shift the '
      + 'row under the primary pick: the named target is still eaten.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (Mike\'s report, relayed)', quote: 'blart always consumes right-most and never fails that check' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts consumeShopMinion (the primary offer re-resolved by uid after the Banquet bite); rightmostShopMinion; consumeShopRightmost' },
    ],
    contentIds: ['dm_gourmand', 'dm_grevlin'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1401). The Banquet bite spliced the row BEFORE the primary bite, so a right-most '
      + 'index fell off the end: only the left-most was eaten and the right-most survived.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set2Demons.test.ts', 'packages/sim/src/set2FinalQuests.test.ts', 'packages/sim/src/contentBatchAug14.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-ORD-04',
    title: 'A shop Rise resolves — and is SHOWN — after its Echo, on its own beat',
    statement:
      'When a minion with Rise dies in the shop (Deathfibrillator, Cage Breaker, Funeral on Loan), its Echo and the '
      + 'death watchers resolve first and the body returns afterwards — and the presentation must read the same way: '
      + 'the return is its own beat, opened after the death/Echo beat closes, exactly as combat gives the reborn '
      + 'return its own resolution step. The risen body may never land in the same commit as the Echo.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'deathfibrillator - the minion is rising before triggering the echo, which is wrong. a minion\'s echo always goes off before it rises.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts settlePendingDeath (death beat `system:destroy:shopDeath`, then a `system:destroy:shopRise` beat for riseReturn + fireOnRise); packages/core/src/combat/simulate.ts killOrReborn (the second nextStep before `reborn`)' },
    ],
    contentIds: ['u3_ems', 'u3_cagebreaker'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1402). The state order was already Echo → watchers → Rise (R-RISE-05); the shop '
      + 'ran the return inside the death beat, so the new body was on screen the instant the Echo played.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts', 'packages/sim/src/shopDestroy.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-TEXT-02',
    title: 'A live-scaling card prints its current value on EVERY surface — shop offers, Discover, fly-ins and combat included',
    statement:
      'The live-text rule (CLAUDE.md, 2026-07-02) has no surface exceptions: a card whose printed magnitude depends '
      + 'on run state prints the current value wherever the card is shown — the shop row, a Discover option, a '
      + 'held or displaced offer, a conjured hand fly-in, the hand, the board, the end screen and the combat arena. '
      + 'A surface that shows the printed base while another shows the live value is a defect.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'revelers text needs to show their buff in shop or hand or anywhere you find them.' },
      { kind: 'code', ref: 'packages/ui/src/Recruit.tsx offerLiveTextParams + the shopViews memo (the run-scoped Spirit values threaded); packages/ui/src/Unit.tsx' },
    ],
    contentIds: ['sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler', 'sp3_luminary', 'sp3_kindled', 'sp3_nurturer'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1403). Three surfaces had dropped the shared Reveler value on the way to '
      + '`liveCardText`: the offer builder, the shop memo and the combat unit.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/renderedText.test.tsx', 'packages/ui/src/spiritText.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-TEXT-03',
    title: 'A served opponent\'s card prints — and fights with — its OWNER\'s values',
    statement:
      'A board served as an opponent carries every run-level scaler its owner had at capture, and both halves of '
      + 'the game honour them: the combat side fights with them (a served Kindled Sprite gains Attack for the Spirits '
      + 'its owner played), and the card text in the arena prints them (an enemy Vaultkeeper reads its owner\'s spell '
      + 'count, not the current player\'s and not the printed base). Per-instance display state rides the snapshot '
      + 'too. Only values the snapshot genuinely does not carry (Gold meters, Soulsman, Squirl Scout, rune flags) may '
      + 'fall back to base text on the foe side.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'i saw an opponent\'s vaultkeeper showed 2/2 as their buff instead of the actual value. can you do a pass to make sure we have full parity carry over for all cards in opponent snapshots?' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts enemyScalersOf (every run-level side field → CombatResult.enemyScalers); packages/sim/src/boardSide.ts sideFromSnapshot (spiritsPlayed / rubyCasts / revelerX threaded); packages/ui/src/Unit.tsx (foe reads enemyScalers)' },
    ],
    contentIds: ['d2_herzog', 'sp3_kindled', 'chefraag'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1404). `enemyScalers` had been a hand-picked five of the side\'s ~35 fields; '
      + '`spiritsPlayed` was never captured or threaded, so a served Spirit board\'s Kindled Sprite fought at 0.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/renderedText.test.tsx', 'packages/sim/src/snapshotFidelity.test.ts', 'packages/sim/src/docbot/snapshotFidelity.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-HAND-04',
    title: 'Summon from hand: an exact copy, once per combat, the card stays in hand',
    statement:
      'A "summon a minion from your hand" effect (Set 3 Spirits: Tide Caller, Dreaming Deep, Seedling Spirit) puts '
      + 'an EXACT copy of the hand card on the board — its stats, keywords and gilding at that moment — beside the '
      + 'summoner. The card itself is NOT consumed: it stays in hand, greyed for the fight, keeps receiving buffs '
      + '(which never reach the copy retroactively), and may be summoned only once per combat; a second summoner must '
      + 'pick a different card, or nothing. The shop twin (an Echo re-fired in the shop) summons the copy once per '
      + 'card per turn. Rope Wrangler\'s older "summon and consume" shape is unchanged and a card it took is no '
      + 'longer a candidate.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Spirit roster answers)', quote: 'the card is not consumed; an exact copy is summoned; once per combat; the card greys in hand so it cannot be summoned again; another summoner must pick a different card' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts summonCopyFromHand (handCopiedUids; `fromHandUid` stamped on the summon event); packages/sim/src/recruit.ts summonCopyFromHandShop (handCopiedThisTurn)' },
    ],
    contentIds: ['sp3_dreamtide', 'sp3_dreamingdeep', 'sp3_seedling', 'sp3_handboundtitan', 'sp3_flamebanner', 'sp3_hearthwhisperer', 'sp3_slumbering'],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09, PR #1394): one combat primitive and one shop twin; the replay '
      + 'greys the hand card off `fromHandUid`. Refined 2026-09-10 by R-HAND-03 (a locked card is never a candidate).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Spirits.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-MULT-03',
    title: 'The Revelers share ONE value, +1 per Reveler sold; a golden Reveler pays double',
    statement:
      'Flame, Tide and Grove Reveler pay from a single run-wide value X (starting at 1) when sold — Flame gives your '
      + 'Spirits +X Attack, Tide +X Health, Grove gives every minion +X/+X (board only, never the hand) — and EVERY '
      + 'Reveler sold, of any type, raises X by 1. A golden Reveler pays 2X and still raises X by 1. Cards that '
      + 'reference "your Reveler bonus" (Festival Luminary) read X itself. Festival Treasurer\'s per-Reveler-sold '
      + 'discount stacks to −3; Grand Procession returns the first of each Reveler TYPE sold each turn.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Spirit roster answers 1–2, 7, 9)', quote: 'all three share one X; +1 per Reveler sold; golden 2X; the Reveler bonus IS X; Treasurer stacks to -3' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (correction)', quote: 'the reveler sells are buffing hand minions which is not correct, please fix that' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts revelerValue / revelerSell (board only) / battlecryBuffRandomTribePlusReveler; packages/sim/src/state.ts revelerX; packages/ui/src/cardText.ts spiritText' },
    ],
    contentIds: ['sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler', 'sp3_luminary', 'sp3_treasurer', 'sp3_grandprocession'],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09, PR #1393; the hand-buffing slip fixed in the same PR before merge).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Spirits.test.ts', 'packages/ui/src/spiritText.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-SHOP-02',
    title: 'The shop draw is weighted by copies left in the shared pool',
    statement:
      'Each shop roll draws from the run\'s shared, finite pool with probability proportional to the copies each '
      + 'card has left: every remaining copy is one ticket. A card down to its last copy is rarer in exact '
      + 'proportion, and the odds shift gradually as the pool drains — never a cliff where a last copy is as likely '
      + 'as a full stack until it hits zero. Eligibility (tavern tier, active tribes, at least one copy) is '
      + 'unchanged; a Practice tribe surge doubles that tribe\'s tickets.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (on Codex\'s review)', quote: 'we need to fix the copies issue - the # of copies should directly impact how likely a card is to be found. the way it is working today is not correct.' },
      { kind: 'code', ref: 'packages/sim/src/shop.ts drawOfferId (ticket weights = stock × surge), called from rollShop and topUpTavern with state.pool' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1406). The draw was uniform by card identity while any copy remained (the only '
      + 'weighted branch was the Practice surge). Every roll now consumes the rng differently, so pre-change seeds '
      + 'produce different shops; no golden pinned specific offers.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopDrawWeight.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-PROV-01',
    title: 'Every stat names its source — runes included; the shop channel is never anonymous',
    statement:
      'Every stat a minion carries beyond its printed base names the individual source that granted it — the card, '
      + 'the spell, or the specific RUNE ("Rune of Reinvestment: +4/+4"), never a catch-all ("Tavern", "Shop Stats", '
      + '"Staff of Guel" standing in for the whole channel). The run-wide shop channel keeps a per-source ledger that '
      + 'sums to the channel exactly; a bought minion\'s buff breakdown prints one line per source; a rune that feeds '
      + 'the channel can show what it alone has given. Doc Bot holds the ledger to the channel after every action.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (Rune of Reinvestment ask)', quote: 'this should also be part of docbot\'s oracle. we should be extremely specific from where stats and buffs came from, referencing individual runes if necessary. it\'ll help to parse out bugs.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts creditShopBuffSource / applyRunShopBuff; packages/sim/src/reducer.ts (buy path: one addBuff per ledger source; combat carry-back credits playerTavernBuyGainSources); packages/core/src/combat/simulate.ts tavernBuyGainSources' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-10: the ledger (`tavernBuyBonusSources`) is written by every channel writer; the buy path '
      + 'bakes one line per source; the Reinvestment badge reads its own line (shop) and the live summon count (combat). '
      + 'Before this the channel was one anonymous pair relabelled "Staff of Guel" at buy time.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/conservationLaws.test.ts', 'packages/ui/src/tallyCoverage.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-TARGET-02',
    title: '"other" / "another" excludes only this body; "different" excludes every copy of the same-named card',
    statement:
      'When an effect\'s printed text says "other" or "another", the source INSTANCE is ineligible and nothing else '
      + 'is — a same-named copy is a legal target (exclude by uid). When it says "different", NO copy of the '
      + 'same-named card is eligible, the source included (exclude by card identity). Lieutenant Thane\'s Rally and '
      + 'Menagerie Mammoth\'s Echo are "different"; Hank Pepe, Hoard Cleric, Better Bot, the Chef and the Chipper '
      + 'Sticker are "other". A Discover triggered by playing a card never offers that card itself, and needs no '
      + 'qualifier for it — "Discover" carries the exclusion on its own.',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (vocabulary ruling)', quote: 'other/another means that that same named card can be targeted, but the effect cannot target the card itself. different means that the effect cannot target any copy of the same named card.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (the calls)', quote: 'thane should say different. menagerie mammoth should say different. the sea urchin/joker etc is slightly different. discovers shouldnt offer themselves as options and dont need the different terminology as of now.' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts (friends() + uid filters; rallyGiveAttackToOthers excludeId); packages/core/src/effects/factories.ts deathrattleSummonRandomTribe (excludeSelf = card identity); packages/sim/src/recruit.ts battlecryDiscoverMinion (exclude: self.cardId)' },
    ],
    contentIds: ['dw_thane', 'b2_mammoth', 'dw3_hankpepe', 'seaurchin'],
    currentBehaviour:
      'Conforms — 2026-09-10: the audit found every "other"/"another" text excluding by uid (19 of 21) and two '
      + 'excluding by card identity (Thane, Mammoth); those two texts now print "different". The Discover-on-play '
      + 'family (Sea Urchin, Joker, Wayfinder, Clockwork, Jeweler, Cage Breaker) excludes its own card without a '
      + 'printed qualifier, by ruling. Note `excludeSelf` means uid in onSpellCastBuffRandomTribe and card identity '
      + 'in deathrattleSummonRandomTribe — the pinning test names both so the overload cannot drift silently.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/targetVocabulary.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-TARGET-03',
    title: 'No card targets itself — every CHOSEN friendly recipient excludes the source',
    statement:
      'Wherever a card\'s effect CHOOSES a friendly minion — an aimed Shout, an aimed Equipment (its granting body), '
      + 'a random-friendly picker, a minion-cast targeted spell, an un-aimed re-fire\'s auto-pick — the source is '
      + 'never in the pool, whether or not the text prints "other". No fallback to self: with no other eligible body '
      + 'the effect finds no recipient and does nothing (an aimed Shout alone on the board plays as a plain body and '
      + 'is never prompted to aim). Positional and identity reads are NOT choices and keep their membership: '
      + '"adjacent", "left-most / right-most", "on this", "your minions", and Paragon\'s "a minion of every type" '
      + '(which it is — the owner\'s worked example has it collecting its own payout).' 
      + 'OWNER EXEMPTION (2026-09-18): an Equipment definition may opt out with `mayTargetSelf` — Bloodpot is '
      + 'usable on Alchemist Frank himself.',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner handoff, 2026-09-18 (Cage Breaker / EMS, then made global)', quote: 'no card should be able to target itself' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts othersOnBoard; packages/core/src/effects/factories.ts otherFriends; packages/core/src/effects/arena.ts others; packages/sim/src/reducer.ts (battlecryTarget refuses target.uid === card.uid; activateEquipment refuses granted.sourceUids); productionBots/visibleState.ts + legalActions.ts mirror both' },
    ],
    contentIds: ['u3_cagebreaker', 'u3_ems', 'dw_runemaster', 'gravetwin', 'e3_frank', 'e3_sculptor', 'dw_gangplank', 'dw_oaf', 'dw_billings', 'k_candleconduit', 'monk', 'd2_broodwhelp', 'dw_dorrin', 'dm_agent', 'b2_magepup', 'beetle', 'squirlscout', 'c3_familiar', 'runesnout_archivist'],
    currentBehaviour:
      'Conforms — 2026-09-18: every aimed Shout and aimed Equipment refuses a self-target in the reducer (the aim UI '
      + 'and the bot view mirror it); the three phase helpers carry the rule for random pickers and minion-cast spells; '
      + 'the old "fall back to self" auto-picks (battlecryBuffTarget, battlecryGrantKeyword, Baby Gastrid, Appetite '
      + 'Agent) are gone. Behaviour changed for: Bloodpot / Titan Hammer (never the granter), Auric Runemaster, '
      + 'Gravetwin, Gangplank, Drunken Oaf, Billings, Candle Conduit, Flowing Monk, Runekeg (excludeSelf implied), '
      + 'Squirl Scout, Orbiting Familiar, Runic Archivist, Runesnout Archivist, Mage-Pup, Runic Beetle, Brood Whelp / '
      + 'Twilight Emissary re-fires, Rot Weaver, Spell Drummer, named-spell casters with an aimed spell.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/noSelfTarget.test.ts', 'packages/sim/src/reworks0918.test.ts'], lastVerifiedAt: '2026-09-18' },
  },
  // ── THE 2026-09-21/22 BUG-FIX SWEEP ────────────────────────────────────────────────────────────────
  // Every fix below shipped with a regression test; the owner ruled each one in chat. This block is the
  // standing contract in action: a bug fix is not done until its rule is here (CLAUDE.md, "Bug fixes
  // become rules").
  {
    id: 'R-PUMMEL-01',
    title: 'A Pummel tally is per instance and LIFETIME, and pays at most once per combat',
    statement:
      'Pummel (X) counts the damage THIS BODY has dealt over its whole life. The tally is per instance and never '
      + 'resets: it carries from combat to settle to shop to the next combat, it rides a served snapshot, and a '
      + 'Rise or Rebirth return keeps it. A payout is owed each time the tally crosses a multiple of X, but at '
      + 'most ONE payout per combat; crossings past the first in a fight are spent, not banked. Every readout '
      + 'prints progress toward the NEXT payout (the tally modulo X, over X), on the board, in the shop and in '
      + 'combat, and the combat badge ticks on the beat the damage lands.',
    domain: 'keywords',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (Pummel carry-over report)', quote: 'Pummel is broken, it is resetting to 0/X after combat. It needs to carry over from turn to turn and combat to shop' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (Han Gover, once per combat)', quote: 'change this card\'s effect to match the text' },
      { kind: 'fix-pr', ref: 'PR #1607 (the PUMMEL keyword + the pummel-trigger effect) and PR #1616 (carry-over) — packages/core/src/combat/simulate.ts damageMeterOf/pummelFired, packages/sim/src/recruit.ts carry-back, packages/ui/src/cardText.ts stepProgress' },
    ],
    contentIds: ['dw3_hangover', 'k3_goldvein'],
    currentBehaviour:
      'Conforms — 2026-09-21 (PRs #1607 and #1616). The tally used to be rebuilt from the current fight\'s `dmg` '
      + 'events, so it read 0/X again in every shop; it is now seeded from the run card, carried back whole, and '
      + 'the once-per-combat rider is a per-fight `pummelFired` flag rather than a reset of the meter.',
    enforcement: {
      kind: 'scenario',
      refs: [
        'packages/core/src/combat/pummelTrigger.test.ts',
        'packages/sim/src/set3Dwarves.test.ts',
        'packages/sim/src/goldvein.test.ts',
        'packages/ui/src/damageMeterBadge.test.ts',
      ],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-MULT-04',
    title: 'A Start-of-Combat multiplier repeats RUNE Start-of-Combat effects too, not just minion ones',
    statement:
      'A multiplier that repeats a side\'s Start of Combat repeats EVERY Start-of-Combat effect that side has. A '
      + 'rune counts whenever its printed text is a Start of Combat line, exactly as a minion\'s Start of Combat '
      + 'does. The extra pass runs after the whole base pass for that side and in the same order as the base pass, '
      + 'and the base pass is unchanged. A Start-of-Combat buff that is pre-baked into the combat board before the '
      + 'simulator\'s pass folds the same number of copies.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (Twilight x Underdog report)', quote: 'Rune of Twilight just did not work with Rune of the Underdog. Why not?' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (the scope call)', quote: 'Yes, all rune SoC effects' },
      { kind: 'fix-pr', ref: 'PR #1614 — packages/core/src/combat/simulate.ts (the rune Start-of-Combat block runs one extra pass per Twilight fire); packages/sim/src/recruit.ts faceOmen (the pending-SoC bake folds every copy)' },
    ],
    contentIds: ['rune_twilight', 'rune_underdog'],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1614). Twilight used to re-fire only the MINION Start-of-Combat pass, so every '
      + 'rune block fired once however many Twilight copies were forged. Underdog now pays four times under two '
      + 'Twilights, and the pre-baked Fleeting Vigor path folds the same count.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/twilightRuneSoc.test.ts', 'packages/sim/src/twilightPendingSC.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-AVWIN-12',
    title: 'Late entry starts at zero on EVERY placement path, and the printed counter shows that same window',
    statement:
      'R-AVWIN-01 binds every way a body reaches the board mid-combat, the Reclaim / resummon insert included, not '
      + 'just the ordinary summon. A fresh body observes only what happens after it arrives. The PRINTED counter '
      + 'must read the same window the simulator uses: a body summoned onto a board that has already lost minions '
      + 'shows 0 of N, never the side\'s running death tally.',
    domain: 'triggers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Bug Board 8e0b4757 (owner report, 2026-09-22)', quote: 'the bull beast card summoned dunkey which summoned with 2/4 avenge stacks when it should be 0 since it is a fresh body on board' },
      { kind: 'fix-pr', ref: 'PR #1176 (placeSummon stamps avengeBaseline) and PR #1618 (the Reclaim insert + the combat readout) — packages/core/src/combat/simulate.ts, packages/ui/src/useCombatReplay.ts' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22 (PR #1618 merged). Both halves this rule adds are pinned: the sim side, where the '
      + 'Reclaim (Soren) insert kept the side tally until `flushResummons` stamped the baseline, and the combat '
      + 'readout, which re-derived the counter from the whole fight so a freshly summoned Avenge body printed 2 of '
      + '4. The ordinary summon path stays pinned by the #1176 baseline stamp (R-AVWIN-01 ground).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/avengeSummonBaseline.test.ts', 'packages/ui/src/avengeSummonReadout.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-HOLD-01',
    title: 'A displaced minion keeps the Shop buffs it accrues while it sits on an offer',
    statement:
      'A minion stashed on a Shop offer (Darah\'s Displace) is an offer like any other: a Veinstorm Ruby, a Fortify, '
      + 'a targeted spell and a rune\'s shop enchant all stamp it. Every path that hands it back to the player, the '
      + 're-buy, the swap back, a Lasso, a Requisition and Harlan, restores those accrued buffs on top of the body\'s '
      + 'own, each under its own source name, and the shop row displays the total the restore will actually hand back.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (displaced Chimerus report)', quote: 'i swapped chimerus to shop and used veinstorms and it did not buff it' },
      { kind: 'fix-pr', ref: 'PR #1615 — packages/sim/src/recruit.ts restoreHeldOffer (one helper for both restore paths); packages/ui/src/Recruit.tsx shopView held branch + heldOfferLedger' },
    ],
    contentIds: ['chimerus'],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1615). Both restore paths used to rebuild the body from the stashed card alone '
      + 'and never read the offer\'s buffs, so every offer-level gain vanished on the way back; only `golden` had '
      + 'been patched (2026-07-29). The row used to render the stashed body alone, so the stamp was invisible too.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/displacedOfferBuffs.test.ts', 'packages/ui/src/heldOfferView.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-TEXT-04',
    title: 'A stat spell folds spell power and prints it live, in every Choose One branch',
    statement:
      'A spell that grants stats folds the run\'s spell power into what it grants, unless an owner ruling exempts '
      + 'that spell. Whatever it will actually grant is what it prints, on every surface: the card face, the shop '
      + 'offer, the hand, Discover and the Choose One window. A Choose One prints the live value of EVERY branch, '
      + 'not just the one the player ends up taking, so the choice is made on the real numbers.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Bug Board 23c340fb (owner report, 2026-09-22)', quote: 'crest of the climb not getting spell power buffs' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-12 (the Choose One half)', quote: 'if a Choose One spell is buffed, it should show the buffed spell numbers in the Choose One windows as well' },
      { kind: 'fix-pr', ref: 'PR #1619 (Crest of the Climb folds spell power) — packages/content/src/cards/set1/spells.ts (the `flat: true` exemption comes off both branches); packages/sim/src/recruit.ts spellDisplayText + chooseOneBranchText' },
    ],
    contentIds: ['crestclimb'],
    currentBehaviour:
      'Conforms as of 2026-09-22 (PR #1619). What each ref pins, so coverage is not overstated. The PRINTING half '
      + 'conforms: the derived sweep in `spellPowerText.test.ts` fails any spell whose factory folds spell power and '
      + 'whose text does not print it, and `chooseOneBranchText.test.ts` greens every folding branch and checks the '
      + 'printed number against the delta the real reducer lands. `chooseOneBoth.test.tsx` pins the EVERY SURFACE '
      + 'half (both branch texts render on every chain, the (Both) label, gilded magnitudes); it says nothing about '
      + 'spell power. The FOLDING half was unpinned until 2026-09-22: `flat: true` on a cast effect opts a grant out '
      + 'of spell power inside the factory, and both sweeps skip such a spell, so an exemption could be added with no '
      + 'owner ruling and no alarm. `spellPowerText.test.ts` now also pins the exemption list itself, to an exact set '
      + '(FLAT_EXEMPT), so a new `flat: true` fails until its ruling is written down. Crest of the Climb was the open '
      + 'case and closed on 2026-09-22 (PR #1619): both branches fold spell power now and their text greens, so its '
      + 'FLAT_EXEMPT entry is gone and `chooseOneBranchText.test.ts` asserts the greened values. The Set 3 Tower '
      + 'Shield keeps its exemption on the owner ruling of 2026-09-09.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/spellPowerText.test.ts', 'packages/sim/src/chooseOneBranchText.test.ts', 'packages/ui/src/chooseOneBoth.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-SNAP-01',
    title: 'The recorded final board is the POST-SETTLE board',
    statement:
      'The board a finished run records for the Career row, Recent Games and the Hall of Champions is the run board '
      + 'as it stands after the final combat SETTLES, which is exactly what the next shop would have opened with. '
      + 'Everything the settle writes to the run board is in, Engraved growth and permanent buffs among them. '
      + 'Combat-only state is out: temporary Start-of-Combat buffs, shields, and bodies summoned during the fight.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (final snapshot ask)', quote: 'can we make it so that the final snapshot is actually what a fresh board would look like after that final combat, so that it carries the in-combat buffs for boards that carry them' },
      { kind: 'fix-pr', ref: 'PR #1617 — packages/ui/src/store.ts run-end block records `endStateBoard(next)` instead of the start-of-combat board' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1617). The recorded board used to be the last combat\'s START-OF-COMBAT board '
      + '(`socBoard` merged onto the end-state snapshot), so it showed SoC buffs, shields and summons but none of '
      + 'the gains made during the fight, because those land on the run board only when `settleCombat` runs. The '
      + 'pin covers four cases: an Engraved carry-back present, combat-only buffs, shields and summons absent, the '
      + 'course-victory path settling first, and the lobby path. The general claim rests on `endStateBoard(next)` '
      + 'reading the settled run board, so any carry-back the settle writes is structurally included.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/finalBoardPostSettle.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-RANK-01',
    title: 'Ranked: a won promotion lands at 10 points, never 0',
    statement:
      'Winning a promotion game puts the player at 10 of 100 in the new division, not 0. The landing is a fixed '
      + 'constant and is never the game\'s own award, so one loss straight after a promotion can never demote. A '
      + 'fresh promotion is not armed for demotion. The client, the Edge Function and the SQL writer all use the '
      + 'same landing constant.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (ranked ladder ruling)', quote: 'when a player promotes to the next medal/division, set their rating at 10/100 instead of 0/100 so they cant lose 1 game and demote' },
      { kind: 'fix-pr', ref: 'PR #1611 — packages/sim/src/rank.ts RANK_RULES.promotionLanding; supabase/functions/_shared/lobbyRating.ts RANK_PROMOTION_LANDING; the settle_rank migration' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1611). It was 0 the day before. Domain note: the ladder is a structural contract '
      + 'of the lobby rather than an in-run resource, so it files under `foundation`, not `economy` (which covers '
      + 'Gold, embers and the shop economy inside a run).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/rank.test.ts', 'packages/ui/src/lobbyRatingParity.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-RANK-02',
    title: 'Ranked: no instant demotions, a demotion game stands in the way',
    statement:
      'A loss that would take a player below 0 points in any division above the floor clamps at 0 and ARMS a '
      + 'demotion game instead of demoting. Only a bottom-4 finish in that next game demotes, by one division, '
      + 'landing at 100 plus that game\'s award; across a medal boundary that is the previous medal\'s division I. '
      + 'A top-4 finish keeps the division and disarms the gate. The armed state is stored on the profile, so it '
      + 'survives between sessions, and the client, the Edge Function and the SQL writer agree on all of it.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (ranked ladder ruling)', quote: 'hitting 0 mmr should halt the loss and put you in a demotion game. you need to then bottom 4 that game to demote' },
      { kind: 'fix-pr', ref: 'PR #1611 — packages/sim/src/rank.ts resolveRank/settleRank (`demotionReady`); supabase/functions/_shared/lobbyRating.ts resolveRankOutcome' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1611). The gate was first (2026-09-20) only across a MEDAL boundary; the owner '
      + 'widened it to every division above Bronze I the next day. Same domain note as R-RANK-01.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/rank.test.ts', 'packages/ui/src/lobbyRatingParity.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-TEXT-05',
    title: 'Player-facing text never uses an em dash or a double hyphen',
    statement:
      'No player-facing string uses an em dash or a double hyphen as a clause separator. House style is one or two '
      + 'short plain sentences that say what the thing does first. This binds every surface the player reads: card '
      + 'and rune text, the keyword glossary, patch notes, screen labels and tooltips, and the helpers whose output '
      + 'only exists at run time (post-combat gains, quest lines, the rank sentences). Developer text is not bound.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (writing style ruling)', quote: 'we do not ever use \'--\' in a description. you should never either. whenever you decide to write text that is player facing, write it in our writing style. clear language, to the point.' },
      { kind: 'fix-pr', ref: 'PR #1606 — packages/ui/src/noEmDashPlayerText.test.ts is the CI tripwire; the glossary, patch notes and screen labels were rewritten in the same PR' },
    ],
    currentBehaviour:
      'PARTIAL as of 2026-09-22, and the split matters. CONFORMS on the surfaces PR #1606 rewrote and the tripwire '
      + 'scans: the keyword glossary, the patch notes, the label and tooltip attributes of the scanned screens, the '
      + 'run-time text helpers and the rank sentences. Rune text conforms too, and is swept from 2026-09-22. CARD '
      + 'text does NOT: 29 cards authored before the ruling still separate clauses with an em dash (Gryphon, Mama '
      + 'Bear, Taragosa Heir and 26 more), and until 2026-09-22 nothing scanned card text at all, so a new card '
      + 'could ship one unnoticed. `noEmDashPlayerText.test.ts` now sweeps every card and every rune against a '
      + 'frozen debt list (EM_DASH_CARD_DEBT): a card NOT on the list fails CI, and a card on it that has been '
      + 'rewritten must come off, so the debt can only shrink. Clearing the 29 is a player-facing content pass with '
      + 'its own patch note, not part of this registry entry.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/noEmDashPlayerText.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-LOBBY-01',
    title: 'A ghost fight is never a rematch',
    statement:
      'The seat that draws the bye never faces, as a ghost, the seat it fought the round before or the seat it '
      + 'eliminated. The next most recent fallen seat stands in. When the only ghost on offer would be a rematch, '
      + 'the bye moves to another seat instead. One deliberate floor: asked for a ghost when no non-rematch seat is '
      + 'available at all, the selector still returns the most recent fallen seat, because a fight beats a free '
      + 'round. It is the bye reassignment that keeps that case off the table, so the floor is not a hole to close.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-19 (ghost rematch report, the Hearthstone rule)', quote: 'player just fought and killed the dead ghost opponent that he is fighting now. that shouldn\'t be possible.' },
      { kind: 'fix-pr', ref: 'PR #1563 — packages/sim/src/lobby/runLobby.ts ghostFor / ghostIsRematch, and the bye reassignment' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-19 (PR #1563). At a 3-alive table the bye holder used to be served the most recently '
      + 'fallen seat, which is exactly the seat it had just eliminated.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobby/ghostNoRematch.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-TEXT-06',
    title: 'A printed record accounts for every round played, draws included',
    statement:
      'Wherever the game prints a run record, the numbers add up to the rounds that were played. A fight where '
      + 'both boards wipe is a DRAW and is still a round, so a record that prints only wins and losses is wrong '
      + 'whenever a draw happened. Every surface prints the same shape through one helper: wins and losses, plus '
      + 'a third number only when there was a draw.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (bug report on a Career row)', quote: 'this was a 14 round game, why is my record 8-3? fix that.' },
      { kind: 'code', ref: 'packages/ui/src/leaderboardData.ts recordText (the one helper); packages/ui/src/Career.tsx (the match row); packages/ui/src/HudBar.tsx (the in-run plaque); packages/core/src/combat/simulate.ts (both boards wiped = draw)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. The Career match row and the in-run HUD plaque printed wins-losses and dropped '
      + 'draws, so a 14-round run with three draws read as 8-3. Both now call `recordText`, the helper the '
      + 'Leaderboard and Hall rows already used; the end screen already carried its own draw suffix.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/Career.test.tsx', 'packages/ui/src/ladderPages.test.tsx'], lastVerifiedAt: '2026-09-22' },
  },
  {
    id: 'R-TEXT-07',
    title: 'A hero power on a schedule prints its countdown',
    statement:
      'The live-value rule covers hero powers, and a power that fires on a SCHEDULE has a live value even when '
      + 'its magnitude is fixed: when it next fires. A scheduled power prints the countdown beside its rule, and '
      + 'says so plainly on the turn it fires, so a player never has to count turns to know what this shop brings. '
      + 'The countdown reads the same expression the reducer schedules on, so the two cannot drift.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22', quote: 'kindness hero power needs turn counter text' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts heroPowerText (the greatPresence branch); packages/sim/src/reducer.ts (the `wave % 4 === 0` schedule it reads)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. Kindness (Great Presence, a Gift Discover every 4th turn) printed a bare rule '
      + 'with no countdown; it now prints the turns remaining, and This turn on the turn itself. Odelle and '
      + 'Tempest already carried countdowns for their improving grants, which is the same rule for a magnitude.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/gifts.test.ts'], lastVerifiedAt: '2026-09-22' },
  },
  {
    id: 'R-TEXT-08',
    title: 'A printed number keeps moving during combat',
    statement:
      'The hard live-text rule does not pause for the fight. Whenever a card\'s magnitude depends on state the '
      + 'COMBAT changes (spell power gained mid-fight, an escalating spell improving itself, a counter a combat '
      + 'event feeds), every surface that prints it (hand, board, arena, a grant flying in) must show the value it '
      + 'would produce at that moment of the fight, and must land on exactly the number settle banks. The live '
      + 'value is DERIVED from the event log the simulator already emits, never computed by the UI, and the '
      + 'derivation is display-only: it may never reach the cast math.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (live spell text report)', quote: 'front to backs text/maybe all spells? not updating in real time from buffs in combat.' },
      { kind: 'fix-pr', ref: 'Live spell text + Voicekeeper fix — packages/sim/src/reducer.ts (the display-only previews are exempt from the phase guard), packages/sim/src/recruit.ts (spellAttackBonusLive / spellHealthBonusLive / spellEscalationLive), packages/ui/src/Recruit.tsx, packages/ui/src/Unit.tsx' },
    ],
    currentBehaviour:
      'Conforms for spell power and for escalating spells as of 2026-09-22. The root cause was not the readouts: '
      + 'the reducer\'s phase guard admitted only resolveCombat / settleCombat while the phase was combat, so ALL '
      + 'five display-only combat previews (escalation, spell power, spells cast, friendly deaths, blade attacks) '
      + 'were silently swallowed at exactly the moment the replay dispatched them. Yirin\'s Attunement, Cindara\'s '
      + 'Hoard and Gorun\'s Blade Mastery pills were frozen for the same reason and are fixed by the same change. '
      + 'Spell power additionally had no text channel at all: the narration drove a flourish and a card pop while '
      + 'the printed number stayed at its pre-combat value. The live value is published as an ABSOLUTE FOLD over '
      + 'the events played so far, never as a per-event bump (review 2026-09-22): a bump is only correct when '
      + 'every beat plays exactly once, and Skip, a seek and a mid-fight Save & Quit each break that, leaving a '
      + 'readout that no longer equals what settle banks. deserialize clears all five previews for the same '
      + 'reason. PARTIAL beyond these: rubyBonus, growthBonus, '
      + 'clueBonus, starCrashBonus, undeadBuyAtk, cardBuffs and impAura are settle-only carry-backs read raw by the '
      + 'combat surfaces and are stale in combat by the same mechanism. Their follow-up is scoped separately.',
    example:
      'Chorus Drake Rallies eleven times in a fight, each Rally giving your Shop spells +1 Health. A Front to Back '
      + 'held in hand must read its Health up by 11 by the end of the fight, not snap to it when the shop reopens.',
    contentIds: ['fronttoback', 'd2_chorus', 'b2_quil'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/liveSpellTextInCombat.test.ts', 'packages/sim/src/heroPillReadouts.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-MULT-05',
    title: 'A multiplier reaches the printed number, not only the outcome',
    statement:
      'When an effect repeats a trigger, everything the repeat PRODUCES must reach the player\'s readouts as well '
      + 'as the board. A Rally that fires twice grants twice, so every number those grants FEED must show the '
      + 'doubled total on every surface, in the shop and during the fight: the value printed on a spell whose '
      + 'magnitude rides the spell power they gave, an escalating spell\'s step, a tally they advance. The way to '
      + 'get this for free is to derive the readout from the events the simulator emits per fire, rather than '
      + 're-deriving the magnitude in the UI from a rate and a count. The rule is about the TOTAL, not the rate: '
      + 'a rune that repeats a trigger leaves the repeating card\'s own per-trigger text alone, because one '
      + 'trigger still grants what it printed and the rune itself tells the player the trigger fires twice. A '
      + 'rune that multiplies a SINGLE fire is the other case, and there the printed step must change.',
    domain: 'multipliers',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (live spell text report)', quote: 'rune of adventuring should affect the # shown for spell buffs too, since it re-triggers things like chorus drake etc.' },
      { kind: 'fix-pr', ref: 'Live spell text + Voicekeeper fix — no simulation change was needed; the doubling was already correct and only the readout was stale (packages/ui/src/liveSpellTextInCombat.test.ts pins both halves)' },
    ],
    currentBehaviour:
      'Conforms for the totals — 2026-09-22. Probed through simulate() first: a Chorus Drake under Rune of '
      + 'Adventuring (rallyExtraAlways) already rallied 90 times instead of 45 and banked exactly double the '
      + 'spell power, and emitted one narration per fire. The SIM was right the whole time; only the printed '
      + 'number was stale, and it was stale for the reason in R-TEXT-06. Because the readout is now a fold over '
      + 'those per-fire narrations, the doubling reaches the text with no multiplier arithmetic in the UI at all. '
      + 'Deliberately NOT folded, and not counted as a gap (review 2026-09-22): the repeating card\'s own '
      + 'per-trigger text. Chorus Drake still prints "+1 Health" under the rune, because one Rally really does '
      + 'grant 1 and the rune already states that Rally fires twice. Contrast Rune of Mastery, which multiplies a '
      + 'single improve and therefore IS folded into card text through improveReps. If the owner ever rules that '
      + 'a repeat-the-trigger rune must double the repeating card\'s printed rate as well, that is its own text '
      + 'change and this statement widens with it.',
    cardText: 'Rune of Adventuring: "Your **Rally** effects trigger **twice**."',
    example:
      'Chorus Drake plus Rune of Adventuring: 45 Rallies become 90, spell power gained goes from +0/+45 to +0/+90, '
      + 'and a Front to Back in hand must print the +90 version while the fight is still running. The Drake itself '
      + 'still prints +1 Health per Rally, because that is still what one Rally grants.',
    contentIds: ['rune_adventuring', 'd2_chorus'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/liveSpellTextInCombat.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-SHOP-03',
    title: 'A card granted by a sale can complete a Gild',
    statement:
      'Selling is an action that can GIVE you a card: the copy of the first Dragon sold, a rune\'s payout, a '
      + 'Shout replayed as the body leaves. A card granted that way is an ordinary card in your hand. If it is '
      + 'your third copy it combines into the Gilded version immediately, and that Gilded card pays its Triple '
      + 'Reward when played, exactly as a bought or conjured third copy would. No route that adds a card to hand '
      + 'is exempt from the combine check.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Voicekeeper report)', quote: 'also voicekeeper selling needs a triple check' },
      { kind: 'fix-pr', ref: 'Live spell text + Voicekeeper fix — packages/sim/src/reducer.ts, the sell case now runs checkTriples when the sale grew the hand' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22. The reducer uses an explicit-call convention: each case that can grow the hand calls '
      + 'checkTriples itself, and the sell case was the one that never did. It returns early, and the shared '
      + 'post-action hand-growth check in reduce() cannot help because its baseline is captured after reduceCore '
      + 'has already landed the grant. Three plain copies simply sat in hand. The fix is gated on the hand '
      + 'actually growing, so a sale that grants nothing leaves loose copies alone. The gate decides whether the '
      + 'check RUNS, not what it may combine: checkTriples is board-wide, exactly as it is on every other '
      + 'hand-growth path, so a sale that does grant something also combines any other id already sitting at the '
      + 'threshold. Every other sale route (Dissipate, Parting Gifts, Rune of the Altar) already ran the check '
      + 'through the spell-play or rune-buy path, and checkTriples is idempotent, so nothing combines twice.',
    cardText: 'Voicekeeper: "Get a **plain copy** of the first Dragon you sell each turn."',
    example:
      'Two plain Scalefeathers in hand, a Voicekeeper and a third Scalefeather on board. Sell the Scalefeather: '
      + 'the granted copy is a plain third copy, so you end with one Gilded Scalefeather, and playing it opens the '
      + 'Triple Reward Discover. "Plain" is load-bearing: the granted copy carries no buffs and is never itself '
      + 'Gilded, and it still counts toward the combine.',
    contentIds: ['d2_voicekeeper', 'd2_chronicler'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set2Dragons.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-RANK-03',
    title: 'Ranked: the division numerals ascend with the climb',
    statement:
      'Within a medal the divisions read I, II, III from lowest to highest, so a player climbs Bronze I to '
      + 'Bronze II to Bronze III and then Silver I. The stored division INDEX is unchanged by this: 0 is still '
      + 'the floor and 17 still the top, and nothing compares, settles, promotes or demotes by the numeral. The '
      + 'numeral is a label derived from the index, and every surface derives it from the one helper.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (ranked numerals)', quote: 'change the ranks to 1->2->3 instead of 3->2->1' },
      { kind: 'fix-pr', ref: 'Rank numerals ascending — packages/sim/src/rank.ts divisionTierOf, packages/ui/src/rank/types.ts DIVISION_NUMERALS' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22. The flip is display-only and lives in two places: divisionTierOf now returns '
      + '(index % divisionsPerMedal) + 1 instead of divisionsPerMedal - (index % divisionsPerMedal), and the UI '
      + 'numeral plate table is reversed to match. Because no rule reads the numeral, the server copies needed no '
      + 'change: settle_rank and the Edge Function mirror move indexes, and stored profiles keep the index they '
      + 'had, so nothing was migrated and no player moved. The rank suites assert the new labels at both ends '
      + '(index 0 is Bronze I, index 17 is Ascendant III) while every settlement fixture keeps its old indexes.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/rank.test.ts', 'packages/ui/src/rank/rankFormat.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-PRESENT-01',
    title: 'Presentation may hold a card back, never change what resolved',
    statement:
      'When an effect is animated, the reducer has already resolved it. Presentation may DELAY what the player '
      + 'sees so a consequence reads in the right order, and may show a card that state has already moved, but it '
      + 'never alters, re-orders or re-rolls the outcome. Every such hold is keyed on the uid of the one card it '
      + 'is about, never a blanket flag, so nothing else changing in the same tick is swallowed with it. And every '
      + 'hold resolves on its own without a timer when the surface it belongs to goes away, because a hold that '
      + 'outlives its screen leaves a card invisible in both places at once. A hold seeded during render is '
      + 'never released from an effect cleanup: React runs a changed-dep cleanup after that render has '
      + 'committed, so the cleanup eats the batch the render just seeded and every repeat of the effect past '
      + 'the first silently stops holding anything.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the lasso beam)', quote: 'Make sure that the beam hits the target before the card is stolen from shop and granted to hand.' },
      { kind: 'code', ref: 'packages/ui/src/lassoHolds.ts (the hold state machine + lassoHoldsForPhase); packages/ui/src/Recruit.tsx gambleHold / heldConsume / the lasso cascade; packages/sim/src/recruit.ts stealTavernMinion (resolves immediately, records only metadata)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. The lasso cascade is the case that made the rule explicit: a stolen Shop offer '
      + 'is spliced and its copy pushed to hand in one commit, so the beam had nothing to hit. The offer is now '
      + 'rendered back into its own slot and the arrival held out of the fan until that steal\'s beam lands, while '
      + 'the resolved state is untouched. The phase gate is applied during render rather than by the release '
      + 'timer, so leaving the shop cannot strand a card. Cancelling a previous cascade happens in that same seed '
      + 'rather than in the effect cleanup, after the cleanup form shipped a bug where only the FIRST steal of '
      + 'a recruit phase held its card (caught in review, fixed 2026-09-22). The earlier holds of the same family '
      + '(`gambleHold` since 2026-09-17, `heldConsume` since 2026-08-17) follow the same shape; `heldConsume` '
      + 'still resolves only on its own timer, which is the remaining gap in the family.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/lassoHolds.test.ts', 'packages/ui/src/lassoCascade.test.tsx', 'packages/sim/src/lassoFx.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-LOBBY-02',
    title: 'Hall of Champions: a run is ranked by the players it has beaten',
    statement:
      'The Hall of Champions lists lobby winners and ranks them by wins, where a run\'s wins are the lobby it '
      + 'won for its builder plus every player it knocked out when served as a recorded seat; every time it was '
      + 'knocked out while the player it was served to still stood is a loss; a seat still standing when that '
      + 'player fell, or falling in the same round without felling them, decided nothing and records nothing. '
      + 'There are no draws. Everything is read from what the player\'s own run witnessed; nothing is simulated '
      + 'after it ends. Practice, the tutorial and a sandbox never record.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Hall of Champions rework)', quote: 'if i win a game and it gets served 30 times and wins 19, it should show an overall record of 20-10. this should only be lobby mode wins, and it should be sorted by most wins' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Hall of Champions rework)', quote: 'track the run that beat the player when they were knocked out … if i play a board that wins on turn 14 and it knocks a player out on turn 9, that board should probably get a win. subsequently, if that same board is served to a player and it comes in 3rd against the player on turn 13, my board should get a loss recorded' },
      { kind: 'fix-pr', ref: 'Hall of Champions — packages/sim/src/lobby/runLobby.ts seatOutcomesOf, packages/ui/src/leaderboardData.ts hallRecordOf, packages/ui/src/Leaderboard.tsx, the seat_results table' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22. Before this the Hall read a per-combat ledger filtered to round 17 (a course number '
      + 'that no longer exists) and never knew a served run\'s result against anyone. A first cut played the table '
      + 'out after the player\'s knockout to count lobby wins; the owner replaced it with this knockout rule, which '
      + 'needs no simulation past the player\'s run and leaves the balance instrument\'s own play-out alone. The '
      + 'seat ledger starts from zero; until the owner creates the table every Hall entry reads 1 and 0.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobby/seatOutcomes.test.ts', 'packages/ui/src/hallRecord.test.ts', 'packages/ui/src/seatLedger.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-PRESENT-02',
    title: 'The Amplified glow plays only on a selected Equipment that can fire',
    statement:
      'The Equipment slot carries the Amplified cue (the owner\'s looping `amplified-slot` def) only while the '
      + 'SELECTED Equipment will Amplify its next activation AND has at least one charge to spend, in the shop '
      + 'phase. An Amplified Equipment with zero charges shows no glow; an unselected Amplified Equipment shows '
      + 'none until it is picked; the glow ends the moment any of that stops being true (the activation that spends '
      + 'the stack or the charge, a swap to an unamplified Equipment, the turn ending, the phase leaving the shop, '
      + 'the slot going away) and is never left running unseen (a hidden tab, any overlay covering the slot, unmount). '
      + 'The cue decorates state the reducer already resolved; it never decides anything.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the amplified effect)', quote: 'it should only play when a usable equipment is equipped/selected. if an equipment has 0 charges it should not show the animation.' },
      { kind: 'code', ref: 'packages/ui/src/useAmplifiedSlotFx.ts (one loop, caller-owned teardown); packages/ui/src/StatusBar.tsx (the condition: hasEquip && equipmentWillAmplify && equipmentUsesLeft > 0 && phase recruit && no covering overlay, run-state (Discover / Choose One / offers / scouting) or UI-store (Compendium, Inspect view, bug reporter, ladder and balance pages, title))' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22 (the day the cue shipped). The condition is derived from the same `run.equipment` '
      + 'reads that paint the charge number blue (`equipmentWillAmplify`) and print it (`equipmentUsesLeft`), so '
      + 'the glow and the number cannot disagree. The phase gate is load-bearing: End of Turn hands every own '
      + 'charge back in the same action that starts combat, and the bar stays mounted through the fight. Same-day '
      + 'review fix: the UI-store overlays pause it too (the Compendium, the Inspect view, the Ctrl+B bug reporter, '
      + 'the ladder / balance pages, the title), the set Recruit folds into `overlayOpen` plus the Inspect view; '
      + 'the Book had left the ring burning behind its blur. OPEN, not ruled: "usable" is read as HAS A CHARGE, the '
      + 'owner\'s own clarifying sentence. Gold is not a term, so an Amplified Equipment with a charge the player '
      + 'cannot afford this moment still glows while its button is disabled. If "usable" should also mean '
      + 'affordable, AND `run.embers >= equipmentCostOf(run, def)` into the condition and add the hook case.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/useAmplifiedSlotFx.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
];
