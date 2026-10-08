/**
 * APPROVED RULES — domain `summoning`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const SUMMONING_RULES: GameRule[] = [
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
    id: 'R-GOLEM-01',
    title: 'Every Gemheart Golem summon is heard by Gemheart Legionnaire, in the Shop and in combat',
    statement:
      'Gemheart Legionnaire casts 5 permanent Rubies on itself (10 Gilded) for EACH friendly Gemheart Golem '
      + 'summoned, from any source (Gemheart Carver\'s two, Geode Guardian\'s one, Kurse, Porkbelly, a rune) and in '
      + 'any phase: a Shop Echo summon lands the Rubies at once, a combat summon lands them for the fight and '
      + 'carries them back to the run card. Each Golem a Carver or Geode summons is 1/1 plus that minion\'s Rubies '
      + '(Gilded: a 2/2 with double the Rubies), Geode\'s with Taunt.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Ruby batch handoff, 2026-09-24', quote: 'When you summon a Gemheart Golem, this casts 5 permanent Rubies on itself.' },
      { kind: 'owner-chat', ref: 'Ruby batch handoff, 2026-09-24', quote: 'Gilded doubles the rubies of the golem like other cards do' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts onSummonCardPlayRubiesSelf + deathrattleSummonRubyStats (golems / keyword params)' },
    ],
    contentIds: ['k3_legionnaire', 'k_gemheart', 'k_geode'],
    currentBehaviour: 'Conforms as of 2026-09-24.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/rubyTypes.test.ts', 'packages/core/src/combat/simulate.test.ts'], lastVerifiedAt: '2026-09-24' },
  },
  {
    id: 'R-SUMMON-RETURN-01',
    title: 'A Rise or Rebirth return IS a combat summon for every "summoned in combat" listener',
    statement:
      'A minion that returns by Rise or Rebirth in combat counts as a minion SUMMONED in combat for every effect that '
      + 'keys on a summon, not only for the summon-entry watchers and tallies (R-RUNE-06 already said a Rise return '
      + 'counts once). That includes the body grants that land on the arriving minion: the Ward of Rune of the Undertow '
      + '(within its 4-Ward allowance, shared with ordinary summons, and free when the return already has a Ward), '
      + 'Rune of the Hatchery, Rune of Packcraft, Rune of the Food Chain (never fed by the returning Demon itself), '
      + 'Rune of the Spare Chair (Ward + an immediate attack), Solid Ground and the Containment Rune of the foe. A Rise '
      + 'returns at its printed body first (R-RISE-01) and then takes these grants, exactly as a fresh summon would; a '
      + 'Rebirth returns its full body and then takes them. Each return is ONE summon: it spends one charge of a '
      + 'counted grant and fires its rune once. A return that does not fit (an overflow, R-RISE-05) takes nothing. '
      + 'Excluded by their own text: grants scoped to a named token or summoner (Rune of the Wrangler, Rune of the '
      + 'Living Geode, Heart of the Mountain), and Rune of Living Treasure, whose Rebirth on a returning Golem would '
      + 'make the return endless (R-RUNE-09: "returns once"). The DEATH side of the same rule (the death before a '
      + 'return is a real death for every death listener) is R-DEATH-RETURN-01.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report, 2026-10-06 (Rune of the Undertow)', quote: 'rune of the undertow didnt proc on a rising minion. it should, it should also proc on a rebirth minion. please fix' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts summonEntryEffects doc comment (owner ruling 2026-08-12, Rise is a summon in full, closing the "quest count only" carve-out); R-RUNE-06 ("a Rise return ... count once")' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts applyCombatSummonGrants (shared by summonMinion and the Rise / Rebirth returns in killOrReborn via returnSummonGrants), applySolidGround, applyContainment' },
    ],
    contentIds: ['rune_undertow', 'rune_hatchery', 'rune_packcraft', 'rune_food_chain', 'rune_spare_chair'],
    currentBehaviour:
      'Conforms as of 2026-10-06. Before: the body grants lived inline in `summonMinion` / `placeSummon`, which a Rise or '
      + 'Rebirth return never passes through (it re-slots the SAME instance and runs only `summonEntryEffects`), so '
      + 'Undertow, Hatchery, Packcraft, Food Chain, Spare Chair, Solid Ground and Containment all skipped returning '
      + 'bodies. the Doc Bot summon-return parity rider now checks every combat mod for this class.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/summonReturnGrants.test.ts', 'packages/sim/src/docbot/combatModLane.test.ts'],
      lastVerifiedAt: '2026-10-06',
    },
  },
  {
    id: 'R-UNDERTOW-LANDED-01',
    title: 'Rune of the Undertow wards the first N bodies that LAND, with a fresh allowance every combat, on both sides',
    statement:
      'Rune of the Undertow ("The first 4 minions summoned in combat gain Ward") gives Ward to the first 4 friendly '
      + 'bodies that actually enter play in EACH combat, every round, for whichever side holds it (your own run or a '
      + 'served snapshot / ghost). The allowance is per fight and per side; it never carries between fights. Copies stack '
      + 'their allowances (two copies = 8 a combat). A summon that does not fit on a full board (an overflow) was never '
      + 'summoned: it takes no Ward, spends nothing from the allowance and does not pulse the rune. An attack-on-summon '
      + 'body that is queued and then overflows when it lands hands its Ward back. A body that already has a Ward costs '
      + 'nothing, and a Rise or Rebirth return counts as one summon (R-SUMMON-RETURN-01).',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report, 2026-10-08 (Rune of the Undertow)', quote: "rune of the undertow needs to work every round, i think it's only working for 4 total uses" },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts applyCombatSummonGrants (Undertow block: overflowsNow / capJudgedElsewhere) + placeSummon overflow branch (undertowWarded refund); per-fight undertowUsed' },
    ],
    contentIds: ['rune_undertow'],
    currentBehaviour:
      'Conforms as of 2026-10-08. Before: the allowance was already per fight, but the Ward was granted (and the '
      + 'allowance spent) BEFORE the board-cap check, so on a full token board the overflowed bodies ate all 4 Wards '
      + 'and the bodies that did land arrived bare in every fight, which read as "only 4 total uses".',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/undertowEveryCombat.test.ts', 'packages/sim/src/undertowEveryRound.test.ts'],
      lastVerifiedAt: '2026-10-08',
    },
  },
  {
    id: 'R-FOODCHAIN-LANDED-01',
    title: 'Rune of the Food Chain feeds the first summon that LANDS, never an overflow',
    statement:
      'Rune of the Food Chain ("The first minion you summon in combat gains the stats of your left-most Demon") is '
      + 'spent only by the first friendly body that actually lands on the board in that combat. A summon lost to the '
      + '7-slot cap (an overflow) is not the first summon: it takes nothing and spends nothing. An attack-on-summon body '
      + 'that took the chance when it queued and then overflows when it lands hands the chance back, so the next body '
      + 'that lands is fed. A Rise or Rebirth return always lands and counts as a summon (R-SUMMON-RETURN-01). One '
      + 'chance per combat per side, read from the left-most living Demon at that moment, x copies held.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling, 2026-10-08 (Rune of the Food Chain, on the Undertow fix)', quote: 'this should only work on first actual summon on board, not an overflow' },
      { kind: 'owner-chat', ref: 'Owner ruling, 2026-10-08 (same review, given separately for Rune of Packcraft and for Rune of the Hatchery)', quote: 'this is fine' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts applyCombatSummonGrants (Food Chain block: overflowsNow) + placeSummon overflow branch (foodChainTaken refund)' },
    ],
    contentIds: ['rune_food_chain'],
    currentBehaviour:
      'Conforms as of 2026-10-08. Before: the chance was spent in applyCombatSummonGrants, before the board-cap check, '
      + 'so a summon onto a full board used it up and the first body that really landed came in plain. Rune of '
      + 'Packcraft (an overflow still grows its level) and Rune of the Hatchery (an overflow still pulses) keep their '
      + 'behaviour by owner ruling ("this is fine").',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/foodChainLanded.test.ts'],
      lastVerifiedAt: '2026-10-08',
    },
  },
];
