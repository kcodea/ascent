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
      + 'keywords/instance buffs, then `applyAuras` re-applies standing auras on top.',
  },
];
