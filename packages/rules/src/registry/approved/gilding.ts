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
];
