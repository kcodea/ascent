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
      'VIOLATED: `killOrReborn` fires the Deathrattle (which places the summon and stamps its baseline) '
      + 'BEFORE incrementing `deaths[side]`, so the summoning death lands INSIDE the new body\'s window — '
      + 'an Echo-summoned Avenge (4) source reaches its threshold after only 3 further deaths. Pinned in '
      + 'packages/sim/src/docbot/temporalWindow.test.ts (KNOWN_VIOLATIONS).',
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
      'VIOLATED: clash deaths resolve sequentially (cleave victims → target → attacker) and the avenge '
      + 'guard checks only the `dead` flag — a mortally-wounded source whose own death has not yet been '
      + 'processed observes the batch-mates resolved before it and can fire while dying. Pinned in '
      + 'packages/sim/src/docbot/temporalWindow.test.ts (KNOWN_VIOLATIONS).',
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
];
