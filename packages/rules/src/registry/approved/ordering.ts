/**
 * APPROVED RULES — domain `ordering`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const ORDERING_RULES: GameRule[] = [
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
    id: 'R-ORD-05',
    title: '"Attacks immediately" cuts the line — right after its summon, before the next normal attacker, and between the swings of a Flurry',
    statement:
      "A minion summoned to \"attack immediately\" (Rune of Living Echoes' Sunmane Herald, Kurse's Gemheart Golem, "
      + "Violet Whelp's Whelp, Tamer's whelp, Spear Warden, Charging Soldier, Trooper, …) strikes as soon as its "
      + 'summon lands and the event that summoned it has settled, BEFORE the next normal attacker is chosen. That '
      + 'holds for every summon point between attacks, including one made after the death cascade (a "while you '
      + 'have space" rune filling a freed slot). It DOES interrupt a Flurry: a summon queued by swing 1 lands and '
      + 'strikes between the two swings (never inside the lunge of swing 2), then the Flurry minion swings again if it '
      + 'still lives. Several summoned together each summon and strike in '
      + 'summon order. The immediate strike does not consume or shift the normal attack pointer; the body then '
      + 'joins the rotation (appended at the right) and takes its regular turn too.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (bug report)', quote: "when the sunmane is summoned, it is supposed to attack immediately after being summoned, cutting in front of the order. a \"attacks immediately\" mechanic cuts the line. this doesn't interrupt a flurry attack, but it does interrupt other attack orderings if something is summoned to attack immediately." },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Flurry reversal)', quote: 'revert one attack immediately change - a minion summoned that attacks immediately SHOULD interrupt a flurry. sorry for the mistake on my end there' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts performAttack (the between-swings flush at the top of the swing loop); settleBetweenAttacks (flush → resummons → fillFreeSlots, repeated while an immediate attacker is queued); performAttack wind-up flush scoped by windupSeq' },
    ],
    contentIds: ['rune_living_echoes', 'b2_sunmane', 'k3_kurse', 'twilightwhelp'],
    currentBehaviour:
      "Conforms — 2026-09-26. Living Echoes summoned in fillFreeSlots AFTER the between-attacks flush, so the "
      + "deferred Sunmane waited for the NEXT attacker's wind-up flush: that attacker lunged, the Sunmane landed and "
      + "swung, then the lunge's hit landed. Separately, the wind-up flush drained summons left by a Flurry's first "
      + 'swing between its two swings. REVISED later 2026-09-26 by the owner: the Flurry IS interrupted, cleanly '
      + '(fix/immediate-interrupts-flurry): the summon strikes between the swings, not inside the lunge of swing 2.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/attackImmediatelyOrder.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-NEXTCOMBAT-03',
    title: 'Every next-combat spell shows its cast at Start of Combat, on its caster\'s side',
    statement:
      'When a banked next-combat spell resolves, the fight shows it being CAST as a Start of Combat beat of its own: '
      + 'the spell\'s card appears through the same cast preview a rune\'s cast uses, then its effect lands (the buff, '
      + 'the keyword, the Imps, the Taunt, Weaken\'s Health drop); a spell that acts later in the fight (Decoy Sigil, '
      + 'Solid Ground, Stolen Initiative) shows its cast as the fight opens. The player\'s casts show on the player\'s '
      + 'side, where rune previews show; an opponent\'s show on the RIGHT side of the screen, mirrored opposite the '
      + 'player\'s. The beat is part of the recorded combat log, so a replay shows it too.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Next-combat spell audit, 2026-10-07 (the cast beat)', quote: "we need to show these spells being cast in a start of combat beat. can you use the spell preview that we use for runes except that can also be for start of combat spell casts? for opponents, they should cast on the right side of the screen opposite where the player's side is." },
      { kind: 'code', ref: 'packages/core/src/types.ts CombatEvent bankedCast; packages/core/src/combat/bankedOpeners.ts openingEvents; packages/ui/src/choreo/kinds.ts (bankedCast kind), score.ts (bankedCastFx), channels/bankedCast.ts; packages/ui/src/castPreview.ts showBankedCastPreviews' },
    ],
    currentBehaviour:
      'Conforms from 2026-10-07. Before, only Fleeting Vigor had a Start of Combat moment (a narration line and its '
      + 'buffs); the other banks were pre-baked into the starting board or acted silently.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreo/channels/bankedCast.test.ts', 'packages/sim/src/nextCombatSpells.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
  {
    id: 'R-FX-WAVE-WINDUP-01',
    title: 'A volley a swing\x27s wind-up sprays plays before the strike, on every struck unit, inside the frame budget',
    statement:
      'When a swing\x27s own wind-up produces a wave volley (Gasket\x27s Rally, one wave per pass), the attacker holds its '
      + 'wind-up while each pass plays as its own beat, then strikes (or settles, when a pass killed its target). A pass is '
      + 'not the melee exchange: every unit it struck (the defender included) gets the bound effect, played once per unit at '
      + 'the moment the pass lands, and the clash after the passes keeps its melee pair. A wide pass of a heavy authored '
      + 'effect spawns every play at the same, evenly reduced particle count (its fan budget); one target plays exactly '
      + 'as authored.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner FX for Gasket 2026-10-10', quote: 'plays on all valid targets, aka all non-friendly demons' },
      { kind: 'code', ref: 'packages/ui/src/choreo/channels/windupWaves.ts wavesAheadOf; packages/ui/src/combatBeats.ts meleePairOfImpact/attackerOfImpact (skip wave beats); packages/ui/src/fx/fanBudget.ts; packages/ui/src/choreo/score.ts (struck fan-out intensity)' },
    ],
    contentIds: ['dm_gasket'],
    currentBehaviour: 'Conforms as of 2026-10-11.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreo/gasketBeats.test.ts', 'packages/ui/src/choreo/score.test.ts'], lastVerifiedAt: '2026-10-11' },
  },
  {
    id: 'R-DEMON-DMG-BEATS-01',
    title: 'A buff a Demon\x27s landed hit causes plays at that hit, with a tendril from its source, before anything after it',
    statement:
      'When a friendly Demon\x27s landed hit fires a reaction that buffs (Rad Rachel, Ruinous Lord, Impossible Todd, Leech, '
      + 'Axeman), that reaction presents in real time, at the hit: a tendril of the source\x27s tribe flies from the source to '
      + 'each minion it buffs, and the number lands with it (a pass that fires it many times plays one tick per '
      + 'fire: R-DEMON-DMG-BEATS-02). For a wave pass (Gasket\x27s Rally, a Fel Spikes volley) the pass lands, '
      + 'then its reactions play as their own beat, then the next pass or the parked swing\x27s strike: Gilded Gasket is '
      + 'pass, reactions, pass, reactions, strike. A melee hit\x27s reactions play right after the clash, before the next '
      + 'attack. The Shop presents the same reactions as their own nested beats under the hit, one tendril per (pass, '
      + 'source, minion). Presentation only: the engine already resolves each buff at its hit, and nothing about the '
      + 'outcome changes.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-10-11 (Rad Rachel tendrils, real-time Demon-damage buffs)', quote: 'with gasket, when gasket winds up and ralliy procs, damaging the units it does, rad rachel\x27s tendrils should go out THEN, before the gasket\x27s attack goes off' },
      { kind: 'code', ref: 'packages/ui/src/choreo/hitReactions.ts hitReactionStart; packages/ui/src/choreo/compile.ts + combatBeats.ts buildBeats (the wave split); packages/ui/src/choreo/clock.ts holdMs (lead + read); packages/ui/src/useCombatReplay.ts echoDeliveryLead/scheduleEchoVolleys; packages/core/src/presentation/policies.ts (ownBeat on the friendlyDemonDealtDamage reactions); packages/sim/src/recruit.ts fireShopDemonDealtDamage' },
    ],
    contentIds: ['dm_radrachel', 'dm_ruinouslord', 'dm_todd', 'dm_gasket', 'dm_felspikes'],
    currentBehaviour: 'Conforms as of 2026-10-11. Before, a pass folded its reactions into the hit: no tendril, and the numbers appeared when the stat hold timed out.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreographer/demonDamageBeats.test.ts'], lastVerifiedAt: '2026-10-11' },
  },
  {
    id: 'R-DEMON-DMG-BEATS-02',
    title: 'Every trigger fire is its own tick: a pass lands whole, then its reactions step in one fire at a time; no reactor ever folds into the pass',
    statement:
      'Every trigger fire of a reaction gets its own tick. A wave pass (each Gasket Rally pass, each Fel Spikes volley) is '
      + 'its own beat and lands whole (every hit at once, no left-to-right sweep). Its reactions then play as one tick per '
      + 'landed hit: every reactor that hit fired (Rad Rachel, Ruinous Lord, Impossible Todd, Leech, Axeman, Rune of Ruins) '
      + 'plays in that tick, and every buffed minion\x27s number steps up by that one fire, never the summed lump. Ticks are '
      + 'REACTION_TICK_MS (160 ms) apart, the chain compressed to at most REACTION_CHAIN_CAP_MS (1.6 s), both one tunable '
      + 'constant in choreo/hitReactions.ts; the beat clock, the Fel Spikes spike schedule and the volley hold all wait '
      + 'reactionChainMs(ticks). The reaction beat exists whatever else the reactors emit (a Todd Imp aura, a Rune of Ruins '
      + 'pulse): those ride the reaction beat and never fold the reactions back into the pass. The same per-fire stepping '
      + 'applies to a stand-alone buff wave of several fires (a cleaving Demon\x27s hits) and a multiplied Rally (Gilded '
      + 'Echohorn\x27s procs). A spell\x27s buffs (Dragonflame) are never chained: its presentation is the reference. Tendrils '
      + 'draw on every tick while the ribbons alive at once fit CHAIN_RIBBON_BUDGET, else the full fan on the first tick '
      + 'and the later ticks are told by their number steps. Presentation only.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-10-13 (Demon-damage timing)', quote: 'The demon damage animation timings feel off and go off in instant chunks instead of feeling smooth like our dragonflame triggering minions' },
      { kind: 'owner-chat', ref: 'Owner answers 2026-10-13', quote: 'every trigger of the effect should get its own beat, like every volley from fel spikes, every rally trigger from gasket. the buffs should per tick if possible.' },
      { kind: 'owner-chat', ref: 'Owner answers 2026-10-13 (keep the pass whole)', quote: 'the whole pass i think so it doesnt take forever to show and look kinda goofy' },
      { kind: 'owner-chat', ref: 'Owner answers 2026-10-13 (Dragonflame is the reference)', quote: 'the dragonflame animation seems like it\x27s perfect already assuming it is working correctly.' },
      { kind: 'code', ref: 'packages/ui/src/choreo/hitReactions.ts (reactionTicks, reactionChainMs, chainTendrilPlan, REACTION_TICK_MS); packages/ui/src/choreo/clashOrder.ts (the wave partition); packages/ui/src/choreo/compile.ts (Moment.ticks); packages/ui/src/choreo/clock.ts; packages/ui/src/useCombatReplay.ts fireBuffChain / scheduleEchoVolleys / echoDeliveryLead' },
    ],
    contentIds: ['dm_radrachel', 'dm_ruinouslord', 'dm_todd', 'dm_leech', 'dm_chosenfiend', 'dm_gasket', 'dm_felspikes', 'b2_echohorn', 'd2_flamebeat', 'd2_warflame'],
    currentBehaviour: 'Conforms as of 2026-10-13. Before, a Todd aura or a Rune of Ruins pulse folded the reactions into the pass (no tendril, the numbers snapped in at the next beat), and a pass\x27s reactions were one summed tendril and roll per minion.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreographer/demonDamageTicks.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-DEMON-DMG-DEATH-01',
    title: 'A pass lands whole, then its Demon-damage reactions buff, THEN deaths are checked: a body is buffed before it can die to the pass',
    statement:
      'For a wave pass of Demon damage (each Gasket Rally pass, each Fel Spikes volley, either side), every hit of the '
      + 'pass is dealt first, then every reaction those landed hits fire (Rad Rachel, Ruinous Lord, Impossible Todd, '
      + 'Leech, Axeman, Rune of Ruins) resolves in hit order, and only then are deaths checked. A minion the pass took to 0 '
      + 'or below is still on the board for those reactions and is buffed like any other: it dies only if the damage beat '
      + 'its Health after the buffs (Echohorn 4/3 hit for 4 with Rachel paying +1 Health per landed hit survives; a hit '
      + 'bigger than the buffs still kills). Echo, Rise and Avenge follow the corrected deaths. The Shop spray already '
      + 'buffs every board minion before its single death check after the spray, so both phases agree. Side-neutral.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner report 2026-10-13 (PR #2074 test)', quote: 'i think the echohorn dies before getting the buff which is \'true\' but it shouldnt die, and should actually get the buffs from rachel. if the damage is > the buff from rachel, then yea it dies, but i think it\'s bugged.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts withWave / flushDemonReactions / emitDemonDealtDamage / living (pendingCountsLiving) / resolveEchoDeath; packages/sim/src/recruit.ts shopSprayExceptTribe' },
    ],
    contentIds: ['dm_gasket', 'dm_felspikes', 'dm_radrachel', 'dm_ruinouslord', 'dm_todd', 'dm_leech', 'dm_chosenfiend', 'b2_echohorn'],
    currentBehaviour: 'Conforms as of 2026-10-13. Before, each hit fired its reactions at once and a reactor buffed only bodies still above 0, so a minion the pass had already taken to 0 missed every buff and died.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/demonDamageDeathOrder.test.ts', 'packages/ui/src/choreographer/demonDamageTicks.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-RISE-ROW-01',
    title: 'A Rising body holds its slot through its Echo: death, Echo hits, reaction ticks, +Health, then the Rise, with no row reflow',
    statement:
      'When a minion with Rise dies and its Echo fires before it returns (Eatah: "Echo: Deal 1 damage to your Beasts and '
      + 'give them +1 Health"), the replay plays its death beat, then the clash reactions to the blow that killed it, then '
      + 'the Echo: every hit on its own beat, then each reaction fire as its own tick on the shared reaction stride, then '
      + 'the +Health; then the Rise. The dead body\'s slot is HELD (an invisible ghost) from its Rise death until its '
      + 'Rise returns, so no other minion slides into it and back out. A Rise that finds no room (the body stays dead) '
      + 'holds nothing and its slot closes as before. Presentation only: the engine order (Echo first, then the Rise, '
      + 'R-WOUND-01 for the self-damage) is unchanged.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner report 2026-10-14 (Eatah in combat)', quote: 'eatah is doing really janky stuff in combat. the timing of everything is bad and it janks the board around when it rises and plays the animation etc. can you clean this up' },
      { kind: 'code', ref: 'packages/ui/src/useCombatReplay.ts computeFrame (risingHeld: the ghost slot from a rise death to its reborn); packages/core/src/effects/factories.ts woundAll (hits + held reactions in one wave, then the Health wave)' },
    ],
    contentIds: ['b4_eatah'],
    currentBehaviour: 'Conforms from 2026-10-14. Before, the dead body left the row on the first beat that was not its own damage (the clash reactions, then the +Health beat), the survivors slid into its slot, and slid back out when it rose.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreographer/eatahRiseRow.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
];
