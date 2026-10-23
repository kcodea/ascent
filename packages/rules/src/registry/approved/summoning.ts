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
      + 'counts once). That includes the body grants that land on the arriving minion: the Ward of Undertow '
      + '(within its 4-Ward allowance, shared with ordinary summons, and free when the return already has a Ward), '
      + 'Hatchery, Packcraft, Food Chain (never fed by the returning Demon itself), '
      + 'Spare Chair (Ward + an immediate attack), Solid Ground and the Containment Rune of the foe. A Rise '
      + 'returns at its printed body first (R-RISE-01) and then takes these grants, exactly as a fresh summon would; a '
      + 'Rebirth returns its full body and then takes them. Each return is ONE summon: it spends one charge of a '
      + 'counted grant and fires its rune once. A return that does not fit (an overflow, R-RISE-05) takes nothing. '
      + 'Excluded by their own text: grants scoped to a named token or summoner (Wrangler, '
      + 'Living Geode, Heart of the Mountain), and Living Treasure, whose Rebirth on a returning Golem would '
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
    title: 'Undertow wards the first N bodies that LAND, with a fresh allowance every combat, on both sides',
    statement:
      'Undertow ("The first 4 minions summoned in combat gain Ward") gives Ward to the first 4 friendly '
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
    title: 'Food Chain feeds the first summon that LANDS, never an overflow',
    statement:
      'Food Chain ("The first minion you summon in combat gains the stats of your left-most Demon") is '
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
      + 'so a summon onto a full board used it up and the first body that really landed came in plain. '
      + 'Packcraft (an overflow still grows its level) and Hatchery (an overflow still pulses) keep their '
      + 'behaviour by owner ruling ("this is fine").',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/foodChainLanded.test.ts'],
      lastVerifiedAt: '2026-10-08',
    },
  },
  {
    id: 'R-SUMMON-RECLAIM-01',
    title: "Soren's Reclaim resummon IS a combat summon for every \"summoned in combat\" listener, on both sides",
    statement:
      "The copy Soren's Reclaim brings back (at Start of Combat, or later when room opens) counts as a minion SUMMONED in "
      + 'combat for every effect that keys on a summon, exactly like any other combat summon (an Echo token, a Rise or '
      + 'Rebirth return, a hand-summon, a resummon). It takes the body grants on its first frame (Food Chain '
      + 'when it is the first summon, Hatchery, Packcraft, Undertow, Spare '
      + 'Chair, Solid Ground, the Containment Rune of the foe) and runs the summon-entry suite (onSummon watchers, tribe '
      + 'auras, summon tallies and quests). Each copy is ONE summon. It applies to whichever side holds Soren (a served '
      + 'snapshot too). Every combat summon path now runs these: `summonMinion` / `placeSummon` (tokens, Echo, Rally, '
      + 'Avenge, spell / hero / Whisper summons, hand-summons, resummons), the Rise / Rebirth return, and the Reclaim copy.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report, 2026-10-16 (Rune of the Food Chain x Soren)', quote: "rune of the food chain should work with soren's hero power resummon, and anything that summons a minion in combat basically." },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts flushResummons (now calls applyCombatSummonGrants, applySolidGround, applyContainment and summonEntryEffects)' },
    ],
    contentIds: ['rune_food_chain', 'rune_hatchery', 'rune_packcraft', 'rune_undertow', 'rune_spare_chair'],
    currentBehaviour:
      'Conforms as of 2026-10-16. Before: `flushResummons` inserted the Reclaim copy straight onto the board, bypassing '
      + '`summonMinion` / `placeSummon`, so it ran only the tribe auras and onSummon watchers by hand. Food Chain, '
      + 'Hatchery, Packcraft, Undertow, Spare Chair, Solid Ground, Containment and the summon tallies all skipped it.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/foodChainEverySummon.test.ts'],
      lastVerifiedAt: '2026-10-16',
    },
  },
  {
    id: 'R-SPACE-PENDING-01',
    title: '"When you have space / room" is a pending summon: it lands the first time a real slot opens in that fight',
    statement:
      'A summon whose text says "when you have room / space" (or "as soon as you have room", "when there is room") is '
      + 'PENDING. It lands at Start of Combat when the board has a free slot; otherwise it waits on ONE shared per-combat '
      + 'queue and lands at the first settle after a slot truly frees up (a friendly minion dies or leaves), before the '
      + 'next attacker swings, with its own beat (trigger + summon). A Rise or Rebirth return keeps its slot, so it is '
      + 'not room. Several waiting summons land first queued, first landed, one per free slot (Start of Combat queues '
      + 'the Reclaimer bodies, then Brackus x War, then Warden, Mirror March, Waking Reserve; one entry per '
      + 'rune copy held). The summon reads the board WHEN IT LANDS (Mirror March copies the left-most minion then; the '
      + 'Waking Reserve the best hand minion then). Pending summons are combat-only and are dropped at the end of the '
      + 'fight. Both sides, identically. An effect that checks room at a single moment ("if there is room") is not '
      + 'pending.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report, 2026-10-21 (Rune of the Mirror March)', quote: "rune of the mirror march is bugged, and probably most 'when you have space' things - mirror march only works if you have room at start of combat, but a 'when you have space' mechanic should fire whenever the player truly has a slot for the minion to summon." },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts spaceQueue / queueSpaceSummon / flushSpaceQueue (flushed by settleBetweenAttacks)' },
    ],
    contentIds: ['rune_mirror_march', 'rune_warden', 'rune_waking_reserve'],
    currentBehaviour:
      'Conforms as of 2026-10-21. Before: Warden, Mirror March and the Waking Reserve checked for room once '
      + 'at Start of Combat and gave up on a full board. The Reclaimer and Brackus x War already waited, on two separate '
      + 'queues; all five now share the one queue.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/core/src/combat/whenYouHaveSpace.test.ts'],
      lastVerifiedAt: '2026-10-21',
    },
  },
  // ── Summoned from hand: one presentation for every source, both phases (owner ask 2026-10-23) ─────────────────
  {
    id: 'R-HANDSUMMON-FX-01',
    title: 'A minion summoned from the hand is shown coming from the hand: the card lifts out and the minion forms in its slot, as one seamless motion',
    statement:
      'Whenever a minion is summoned out of the hand (a Spirit hand-summon such as Seedling Spirit or Tide Caller, or '
      + 'Rune of the Waking Reserve), a copy of that hand card lifts off its hand slot and curves on toward the board as '
      + 'it dissolves, while the minion forms in its already-opened slot through one slight overshoot to rest, with a '
      + 'landing ring, the arrival dust and the summon sound. The phases overlap: the screen is never empty and the copy '
      + 'and the minion are never both solid. One animation for every source, in combat and in the Shop, for the player, '
      + 'a replay and a spectator. The hand card itself stays (greyed for the fight in combat). The next combat beat waits '
      + 'for the landing. Otherwise presentation only. Several at once are staggered left to right; a Skip-speed replay, '
      + 'or a hand card that is not on screen, keeps the stock arrival.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask, 2026-10-23', quote: 'build an animation for when a minion is summoned from hand' },
      { kind: 'owner-chat', ref: 'Owner refinement, 2026-10-23', quote: 'it should land and have a small pulse or some sort or something. nothing over the top' },
      { kind: 'owner-chat', ref: 'Owner decision, 2026-10-23', quote: 'use the lift and land animation, but smooth it out and make it overall less clunky and way more seamless' },
      { kind: 'owner-chat', ref: 'Owner sign-off, 2026-10-23', quote: 'hand summon animation looks good to me' },
      { kind: 'code', ref: 'packages/ui/src/handSummonFx.ts (combatHandSummonOrigins, shopHandSummonFlights, launchHandSummonFlights); useCombatReplay.ts + Recruit.tsx layout effects' },
    ],
    contentIds: ['sp3_seedling', 'sp3_dreamtide', 'rune_waking_reserve'],
    currentBehaviour:
      'Conforms as of 2026-10-23. Before, a hand-summoned minion popped in like any other summon; only the greyed hand '
      + 'card hinted where it came from. Opponent hand-summons have no hand on screen yet: the flight takes a per-side '
      + 'source, so an opponent hand area can register one later.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/handSummonFx.test.ts'],
      lastVerifiedAt: '2026-10-23',
    },
  },
  {
    id: 'R-SPELL-CRYPT-01',
    title: 'Overflowing Crypt: the next fight opens by summoning 2 Skeletons, as real summons, for either side, once',
    statement:
      'Overflowing Crypt (Set 3, Tier 2, 3 Gold) is a next-combat spell. Cast in the Shop it summons nothing there; it '
      + 'arms the NEXT fight, which opens (Start of Combat) by summoning 2 Skeletons (the 1/1 Undead token). They are '
      + 'real summons: the 7-slot cap holds, and a Skeleton that does not fit Overflows (Ending, Bicycle Bob and Rune of '
      + 'Overflow pay off), and the Undead Aura applies. Casts stack (two casts, 4 Skeletons). Rune of Twilight repeats '
      + 'it like the other Start-of-Combat banks. It lasts that one fight and lapses at settle. A recorded board carries '
      + 'it, so a served opponent that cast it summons its Skeletons too. Cast mid-fight it fizzles, like every '
      + 'next-combat spell.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-10-23', quote: 'Overflowing Crypt - T2 - 3g Start of Combat: Summon 2 Skeletons.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts spellSkeletonsNextCombat; packages/sim/src/reducer.ts questMods.bankedSkeletons; packages/core/src/combat/simulate.ts runRuneStartOfCombat (bankedSkeletons)' },
    ],
    contentIds: ['sp_overflowingcrypt', 'u3_skeleton'],
    currentBehaviour: 'Conforms (built 2026-10-23).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/overflowingCrypt.test.ts', 'packages/sim/src/nextCombatBanks.guard.test.ts'], lastVerifiedAt: '2026-10-23' },
  },
  {
    id: 'R-HAND-GRANT-SUMMON-01',
    title: 'A minion added to hand mid-fight can be summoned from hand in that same fight',
    statement:
      'A MINION a combat effect adds to your hand joins your combat hand the moment it arrives (after the cards you '
      + 'started the fight with), with its printed stats and keywords (Gilded or an exact copy when the grant says '
      + 'so). Every summon-from-hand effect can then pick it with the usual rules: a copy summon greys it for the '
      + 'fight and the card still arrives in your hand after combat; hand buffs grow it and stay on it. It can be '
      + 'picked only while it would really fit your hand after combat (the hand cap counts every held card, the '
      + 'fight Rubies land first, then the granted cards in order). Spells are never candidates. Both sides, '
      + 'identically.',
    domain: 'summoning',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-23', quote: 'a minion added to hand CAN be summoned that same fight.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts recordHandGrant / handPool / grantFits (handGrantUid on the toHand event); packages/sim/src/reducer.ts settleCombat landedGrants (a hand buff on a granted card lands on the arrived card); CombatSideState.handRoom (reducer, snapshot, boardSide)' },
    ],
    contentIds: ['sp3_dreamtide', 'sp3_dreamingdeep', 'sp3_seedling'],
    currentBehaviour:
      'Conforms as of 2026-10-23. Before: a grant was only recorded for settle, so every summon-from-hand effect '
      + 'ignored cards gained mid-fight.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/midfightHandGrants.test.ts'], lastVerifiedAt: '2026-10-23' },
  },
];
