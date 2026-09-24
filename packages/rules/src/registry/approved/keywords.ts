/**
 * APPROVED RULES — domain `keywords`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const KEYWORDS_RULES: GameRule[] = [
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
  // ── THE 2026-09-21/22 BUG-FIX SWEEP ────────────────────────────────────────────────────────────────
  // Every fix below shipped with a regression test; the owner ruled each one in chat. This block is the
  // standing contract in action: a bug fix is not done until its rule is here (CLAUDE.md, "Bug fixes
  // become rules").
  {
    id: 'R-PUMMEL-01',
    title: 'A Pummel tally is per instance and LIFETIME, and pays at most its printed per-combat cap',
    statement:
      'Pummel (X) counts the damage THIS BODY has dealt over its whole life. The tally is per instance and never '
      + 'resets: it carries from combat to settle to shop to the next combat, it rides a served snapshot, and a '
      + 'Rise or Rebirth return keeps it. A payout is owed each time the tally crosses a multiple of X, but at '
      + 'most the card\'s printed cap per combat (once, unless it prints "(Max N per combat.)", R-PUMMEL-02); '
      + 'crossings past the cap in a fight are spent, not banked. Every readout '
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
      + 'the once-per-combat rider is a per-fight payout count (`pummelFires`, was the `pummelFired` flag until '
      + '2026-09-24) rather than a reset of the meter.',
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
    id: 'R-PUMMEL-02',
    title: 'A Pummel\'s per-combat cap is a card parameter: once by default, "(Max N per combat.)" pays up to N',
    statement:
      'Each Pummel (X) card declares how many payouts it may make in one combat (`maxPerCombat`, default 1 = '
      + '"(Once per combat.)"). Within that cap it pays once for EVERY multiple of X the tally crosses, including '
      + 'several multiples crossed by one hit, and each payout is its own pummelTrigger. The count is per combat '
      + 'instance: a Rise does not re-arm it and a fresh combat does. Han Gover prints "(Max 5 per combat.)" and '
      + 'pays up to 5 Ales, never a 6th; Goldvein and Maestro Lux stay once per combat.',
    domain: 'keywords',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner content list 2026-09-24 (Han Gover)', quote: 'Han Gover -> (Max 5 per combat.)' },
      { kind: 'owner-chat', ref: 'Owner content list 2026-09-24 (Maestro Lux)', quote: 'Maestro Lux -> Pummel (12): Get a random Celestial. (Once per combat.)' },
    ],
    contentIds: ['dw3_hangover', 'k3_goldvein', 'ce3_starcharter'],
    currentBehaviour:
      'Conforms — 2026-09-24. `noteDamageDealt` (packages/core/src/combat/simulate.ts) reads `params.maxPerCombat` '
      + 'and counts payouts on the instance (`pummelFires`).',
    enforcement: {
      kind: 'scenario',
      refs: [
        'packages/core/src/combat/pummelTrigger.test.ts',
        'packages/sim/src/set3Dwarves.test.ts',
        'packages/sim/src/goldvein.test.ts',
        'packages/sim/src/koboldCelestialDwarf0924.test.ts',
      ],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-EXECUTE-01',
    title: 'Execute is the Venom keyword (V), renamed: one mechanic, one name everywhere a player reads it',
    statement:
      'Execute is the player-facing name of the keyword coded `V` (formerly Venomous): any damage the minion deals to a '
      + 'minion destroys it, and the keyword is lost after use. Every surface a player reads (card text, keyword pills, '
      + 'the glossary, combat floats, the Compendium) prints "Execute". The minion Venom carries it. Every card that '
      + '"gives Execute" grants this same keyword; there is no second mechanic.',
    domain: 'keywords',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner Beast/Dragon batch 2026-09-24', quote: 'Execute is what we renamed Venom. it\'s the same mechanic as that but reworded. to this effect, make sure the minion Venom has the keyword Execute.' },
      { kind: 'code', ref: 'packages/content/src/cards/set1/neutral.ts venom (keywords [\'V\']); packages/ui/src/keywordGlossary.ts execute; packages/ui/src/terms.ts; packages/sim/src/docbot/textParse/lexicon.ts KEYWORD_LEXICON.V' },
    ],
    contentIds: ['venom', 'b2_raven', 'b2_tort'],
    currentBehaviour:
      'Conforms. The display name was already Execute (terms.ts, the glossary, floats, quest text); Venom already carried '
      + '`V`. The Doc Bot text lexicon now reads "Execute" as the canonical name (Venomous kept as the alternate).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/beastDragonBatch0924.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-EXECUTE-02',
    title: '"Give another Beast Execute": Raven and Tort pick a random other Beast that lacks it',
    statement:
      'Raven ("Rally: give another Beast Execute.") and Tort ("Avenge (4): give another Beast Execute.") grant Execute to a '
      + 'RANDOM other friendly Beast that does not already have it (seeded, never the source, never wasted); gilded grants '
      + 'it to 2 different Beasts; with no legal Beast nothing happens. Raven\'s Rally fires in combat and on every Shop Rally '
      + 'replay; Tort\'s Avenge is a combat trigger like every Avenge. A Shop grant is permanent; a combat grant lasts the '
      + 'fight and is spent on use like any Execute.',
    domain: 'keywords',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner Beast/Dragon batch 2026-09-24', quote: 'Raven: "Rally: give another Beast Execute." Tort: "Avenge (4): give another Beast Execute."' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts rallyGrantKeywordRandomTribe; packages/core/src/effects/factories.ts rallyGrantKeywordRandomTribe / avengeGrantKeywordRandomTribe; packages/sim/src/recruit.ts rallyGrantKeywordRandomTribe' },
    ],
    contentIds: ['b2_raven', 'b2_tort'],
    currentBehaviour: 'Conforms (built with the cards, 2026-09-24).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/beastDragonBatch0924.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-ECHOKW-01',
    title: 'Wolvie: "Echo: Give a Beast +2/+4 and Rise" lands both on ONE random other Beast; gilded gives 1 Beast +4/+8',
    statement:
      'Wolvie\'s Echo gives a RANDOM other friendly Beast +2/+4 and Rise, in combat and wherever an Echo fires (the Shop, '
      + 'End of Turn, borrowed plays, proc\'d Echoes). A Beast that lacks Rise is preferred so the keyword is not wasted; the '
      + 'stats still land when every Beast already has it. No other Beast means nothing happens. Gilded: ONE Beast takes '
      + '+4/+8 and Rise (owner ruling 2026-09-24; it used to pick 2). A combat Rise is live that fight; a Shop Rise is '
      + 'the permanent keyword.',
    domain: 'keywords',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner Beast/Dragon batch 2026-09-24 (Wolvie correction)', quote: 'Wolvie becomes: "Taunt. Echo: Give a Beast +2/+4 and Rise."' },
      { kind: 'owner-handoff', ref: 'Owner rulings 2026-09-24 (Gilded Wolvie)', quote: 'give 1 beast +4/+8' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts deathrattleBuffRandomTribe (keyword rider); packages/core/src/effects/factories.ts + packages/sim/src/recruit.ts deathrattleBuffRandomTribe wrappers' },
    ],
    cardText: '**Taunt. Echo:** give a **Beast** **+2/+4** and **Rise**.',
    contentIds: ['b2_wolvie'],
    currentBehaviour: 'Conforms (built with the rework, 2026-09-24). Replaced the next-summon +2/+4 version. Gilded narrowed from 2 Beasts to 1 via `goldenTargets: 1` (owner rulings 2026-09-24).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/beastDragonBatch0924.test.ts', 'packages/sim/src/beastBatchAug12.test.ts', 'packages/sim/src/borrowedEcho.test.ts', 'packages/ui/src/choreo/echoTendrils.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
];
