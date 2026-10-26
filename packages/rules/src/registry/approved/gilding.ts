/**
 * APPROVED RULES — domain `gilding`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { AVWIN_HANDOFF } from './shared';

export const GILDING_RULES: GameRule[] = [
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
  {
    id: 'R-GILD-03',
    title: 'A triple consumes BOARD copies first; only the shortfall comes from the hand',
    statement:
      'When a Gild combines copies of a minion, the copies on the board are used first (left-most first), and '
      + 'only as many hand copies as are still needed are taken (the newest first). Any surplus copy stays where '
      + 'it was. Two copies on the board plus an effect that gives two copies to the hand: both board copies and '
      + 'one new copy combine, the golden goes to the hand as usual, and the other new copy stays in hand as a '
      + 'plain copy. The golden merge itself (the two best copies stacked, buffs carried) is unchanged. Applies '
      + 'to every triple route: buy, Discover, copy-to-hand effects, hero powers, a played or summoned copy, and '
      + 'the shop-open check that catches End-of-Turn and combat carry-back grants.',
    domain: 'gilding',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'Owner rule 2026-09-25 (triple board-first)',
        quote: 'the minions on board should be used first and foremeost for triples',
      },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts pullCopies (the one consumption point, reached via checkTriples)' },
    ],
    currentBehaviour: 'Conforms as of 2026-09-25 (was hand first).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/tripleBoardFirst.test.ts'], lastVerifiedAt: '2026-09-25' },
  },
  {
    id: 'R-SOT-GILD-01',
    title: 'A triple made at Start of Turn plays once the Shop is in front of you, after the Runeforge on a rune turn',
    statement:
      'When a Start of Turn effect completes a triple (a rune or quest grant, a hero power), the gild (the copies '
      + 'throwing their trails into the golden card, and the triple sound) plays only once the return-to-shop '
      + 'transition has finished, the Start of Turn beats have played, and no offer covers the Shop. On a '
      + 'Runeforge turn it waits until the rune is picked and has reached the rack (likewise a Discover, quest, '
      + 'power or Ancient offer, a scout, or a Choose One). Until then the golden card stays out of its row. A peeked '
      + 'offer leaves the Shop in view, so the gild plays. Presentation only: the triple resolves with the turn '
      + 'setup exactly as before.',
    domain: 'gilding',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'Bug Board c49f912b (player report relayed by the owner, 2026-10-24)',
        quote: 'when a unit is tripled at the start of turn, it happens while the return to shop transition is happening. this should wait until you return to shop. if it is on a rune select turn, it should wait until the rune is selected',
      },
      { kind: 'code', ref: 'packages/ui/src/turnStartGild.ts (gildMustWait, shopOfferCovering, heldGildMayPlay); packages/ui/src/Recruit.tsx (the gild parked during render, the golden held out of the hand and board rows, the release); packages/ui/src/store.ts actionSfx (silent for a parked resolveCombat triple)' },
    ],
    currentBehaviour:
      'Conforms (2026-10-24). Was: the gild trail and the triple sound fired in the resolveCombat commit, under the '
      + 'return curtain, and the golden sat in the hand at the reveal and under the Runeforge.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/turnStartGild.test.ts'], lastVerifiedAt: '2026-10-24' },
  },
  {
    id: 'R-GILD-SUM-01',
    title: 'A Gilded improver is the sum of its two best copies, never a doubling of what they earned',
    statement:
      'When copies of a card that improves itself (Kennelmaster, Trophy Stalker, Beardsley, Vicious, Alchemist Brisbane) '
      + 'triple into a Gilded copy, the Gilded copy starts at the SUM of the current values of its two highest copies: a +16 and '
      + 'a +10 Kennelmaster gild into +26, two fresh copies into the printed Gilded +4. From then on each improvement adds the '
      + 'Gilded step (+4 per Avenge on Kennelmaster). The earned value is never doubled. Combat pays exactly the printed '
      + 'number, on both sides.',
    domain: 'gilding',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat', ref: 'Owner ruling 2026-10-25 (Gilded Kennelmaster after two Avenge improvements)',
        quote: 'it should be at the sum of the 2 highest buff values. so if you had a +16 and a +10 and gilded it, it should be at +26.',
      },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts combineIntoGolden (GOLD_SCALED_ACCRUAL_CARDS half-sum branch); packages/sim/src/recruit.ts GOLD_SCALED_ACCRUAL_CARDS; packages/core/src/effects/arena.ts scBeastAura' },
    ],
    currentBehaviour:
      'Conforms from 2026-10-25. Was: the triple stored base + both accruals and the x2 golden read doubled all of it '
      + '(a +6 Kennelmaster gilded with a fresh one read +16; even a fresh triple read +8 against the printed +4); the '
      + 'universal-branch improvers doubled the summed accruals. Pack Leader, Den Mother and Hunter keep their "highest copy" '
      + 'merge pending an owner call.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/gildedImproveSum1025.test.ts'], lastVerifiedAt: '2026-10-25' },
  },
];
