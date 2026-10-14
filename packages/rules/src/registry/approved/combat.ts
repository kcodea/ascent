/**
 * APPROVED RULES — domain `combat`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { HANDOFF, AVWIN_HANDOFF } from './shared';

export const COMBAT_RULES: GameRule[] = [
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
    id: 'R-NEXTCOMBAT-02',
    title: 'Next-combat spells carry over to a served board and work for either side',
    statement:
      'A spell cast in the Shop for the next fight travels with the board snapshot and resolves for whichever side '
      + 'holds it: Fleeting Vigor buffs that side\'s starting minions, the banked keywords (Field Maneuvers, Last Stand, '
      + 'Executioner\'s Edge) stamp onto the same bodies, Open the Gates\' Imps join that side, Rallying Offensive '
      + 'doubles that side\'s Rallies, and Marked Target gives the holder\'s FOE\'s right-most minion Taunt at Start of '
      + 'Combat. The player\'s own fight resolves exactly as before. Pre-emptive Assault is the one exception: it is a '
      + 'PLAYER-ONLY carry and is never captured on a snapshot (R-PREEMPTIVE-PLAYER-01).',
    domain: 'combat',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Next-combat spell audit, 2026-10-07 (the lost spells)', quote: 'these should carry over.' },
      { kind: 'owner-chat', ref: 'Next-combat spell audit, 2026-10-07', quote: 'rallying offensive and marked target should work for opponents.' },
      { kind: 'code', ref: 'packages/core/src/combat/bankedOpeners.ts applyBankedOpeners; packages/core/src/types.ts QuestCombatMods (rallyDouble, markFoeRightmostTaunt, fleetingVigor, bankedKeywords, bankedImps, attackFirstNext); packages/sim/src/reducer.ts nextCombatBankMods' },
    ],
    currentBehaviour:
      'Conforms from 2026-10-07. Before, these six spells were player-only: pre-baked into the player\'s combat board '
      + 'or a player-only CombatConfig flag, and spent before the snapshot was captured, so a served board lost them. '
      + 'The guard test fails a new next-combat bank that has no snapshot capture or no enemy-side application.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/nextCombatSpells.test.ts', 'packages/sim/src/nextCombatBanks.guard.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
  {
    id: 'R-PREEMPTIVE-PLAYER-01',
    title: 'Pre-emptive Assault is a player-only carry: an opponent never holds, casts or applies it',
    statement:
      'Pre-emptive Assault ("your minions attack first next combat") works only in the player\'s own fight. It is never '
      + 'captured on a board snapshot, a served or recorded board never applies it (one recorded before the rule is '
      + 'served without it), and no Start of Combat cast beat ever shows it for an opponent. The player\'s own fight, '
      + 'including its cast beat, is unchanged.',
    domain: 'combat',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling for PR #1973, 2026-10-07', quote: 'pre-emptive assault is a player only carry. dont let enemies cast this' },
      { kind: 'code', ref: 'packages/sim/src/snapshot.ts snapshotBoard (omits attackFirstNext); packages/sim/src/boardSide.ts sideFromSnapshot (drops it); packages/core/src/combat/bankedOpeners.ts armedCasts (player side only)' },
    ],
    contentIds: ['preemptive'],
    currentBehaviour: 'Conforms (2026-10-07). PR #1969 captured it on the snapshot but kept it inert for opponents; it is no longer captured at all. '
      + 'AMENDED 2026-10-13 by R-SYMMETRY-01: this is now a CAPTURE policy only. The engine treats strike-first as a per-side option '
      + '(`CombatConfig.playerAttacksFirst` / `enemyAttacksFirst`, both at once cancel), so a live opponent (Versus) could hold it; recorded '
      + 'boards still never carry it.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/nextCombatSpells.test.ts', 'packages/sim/src/nextCombatBanks.guard.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
  {
    id: 'R-WEAKEN-01',
    title: 'Weaken sets a random enemy\'s Health to exactly 1 at the next Start of Combat, and the screen shows it',
    statement:
      'Weaken, cast in the Shop, arms the next combat. At that fight\'s Start of Combat it shows its cast, then sets a '
      + 'random living enemy above 1 Health to exactly 1 Health (one target per cast; casts stack). The weakened card '
      + 'shows 1 Health from that beat on, not its old Health until the next hit. It works the same when an opponent\'s '
      + 'board cast it, aimed at your minions.',
    domain: 'combat',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner report 2026-10-13 (Set 2 fixes)', quote: "weaken is simply not working, please fix this. it should SET an enemy minion's health to 1 at start of combat." },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts (the Weaken pass emits `sc` with setHealth: 1); packages/core/src/types.ts CombatEvent sc.setHealth; packages/ui/src/useCombatReplay.ts computeFrame (folds setHealth); packages/sim/src/snapshot.ts socBoard' },
    ],
    contentIds: ['weaken'],
    currentBehaviour:
      'Conforms from 2026-10-13. Before, the engine set the Health but emitted only a narration `sc`, which the replay '
      + 'never folded, so the weakened card kept its full Health on screen until it was hit and the spell looked dead.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/weakenSetsHealth.test.ts', 'packages/core/src/combat/nextCombatSpells.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-SYMMETRY-01',
    title: 'Combat is 1:1 symmetric: both sides capture, read, grow, show and carry back exactly the same things',
    statement:
      'Every combat rule runs identically for the two sides. Whatever one side has (live spell power, auras, tallies '
      + 'such as the Echo count, per-card stacks, Pack Mentality growth, Blood Trail, quests that complete mid-fight, '
      + 'Echo Warden, Soulbind / bond mods, hand grants and hand buffs, rune and hero triggers) works the same for the '
      + 'other side, live during the fight, with the same events in the log (side-tagged) and the same carry-backs. '
      + 'Resolving A against B and B against A is the SAME fight up to the side swap. The one permitted difference is '
      + 'the tie-break for things that happen to both sides at once (which side resolves first at Start of Combat, '
      + 'a board-wide spray, which board mints its uids first, which side draws random hand grants from the main RNG '
      + 'stream, and which side the seeded first-attacker coin names first): `CombatConfig.firstSide`, the player by '
      + 'default. A recorded board carries everything the fight of its owner read (its full combat mods including the hero, '
      + 'its run-card uids, its first spell of the turn, Spellhide, its pending combat quests); older boards load with '
      + 'those defaulted to none.',
    domain: 'combat',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-13 (combat side symmetry)', quote: "all of this just shows bugged logic, then. all of this should work on both sides. it's imperative that both sides are equal in what's captured, represented, buffed etc. they should be 1:1 exact" },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts (SIDES / firstSide, stateOf, per-side Pack Mentality / pending quests / Blood Trail / spell power, applyAuras on both starting boards); packages/core/src/types.ts CombatConfig.firstSide / enemyAttacksFirst; packages/sim/src/snapshot.ts + boardSide.ts + opponents.ts (capture + restore)' },
    ],
    currentBehaviour:
      'Conforms from 2026-10-13. Before, the enemy side was a pure accumulation with kept asymmetries: Pack Mentality '
      + 'and Blood Trail were player-only, an enemy Grim / spell power / Imp Aura / per-card stacks stayed frozen all '
      + 'fight, the starting Undead of the enemy never got its Lantern aura, its Herald folded no Echo multipliers, its Echo '
      + 'Warden did nothing, its spell tally started at 0, its hand grants and many rune triggers were silent, and a served '
      + 'board lost its hero mods, pending quests, Spellhide and uid-keyed bonds. R-PREEMPTIVE-PLAYER-01 is now a capture '
      + 'policy only (the engine option is per side).',
    enforcement: { kind: 'scenario', refs: ['packages/core/src/combat/sideSymmetry.test.ts', 'packages/core/src/combat/enemySideLive.test.ts', 'packages/core/src/combat/symmetricCarry.test.ts', 'packages/sim/src/snapshotFidelity.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
  {
    id: 'R-WOUND-01',
    title: 'Set 4 Beast self-damage never kills: the hit lands, fires damage-taken triggers, and its Health lands with it (Shop and combat)',
    statement:
      'When a Set 4 Beast damages your own Beasts (Hawg: 1 to itself, Eatah: 1 to each), every hit is paired with the Health '
      + 'the same effect grants, as one step that cannot kill: a 1-Health Beast takes the hit (its damage-taken triggers fire, '
      + 'Apua and Alan included) and ends net neutral. In combat the hit is real (a Ward absorbs it; the Health still lands). '
      + 'It works in the Shop and in combat alike. Damage-taken triggers fire in both phases for a landed hit from any '
      + 'source (an attack, a splash, a Blaster in the Shop). Apua and Alan print "permanently", so their combat gains carry '
      + 'back; a Beast killed by a real lethal hit is not saved by its own Apua gain. Gilded Hawg / Eatah repeat the effect '
      + '(a second tick, its own wave), so the watchers answer twice. PRESENTATION ORDER (owner 2026-10-13): every hit lands '
      + 'first on its own beat (each Health visibly drops), then the damage-taken reactions one tick per fire, then each '
      + '+Health one tick each; never merged into the hit beat, in combat and in the Shop.',
    domain: 'combat',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner handoff 2026-10-13 (Set 4 Beasts, self-damage rule)', quote: 'Self-damage effects from these Beasts never kill a Beast: e.g. Eatah deals 1 then grants +1 Health, so a 1-Health Beast takes the damage (firing damage-taken triggers like Apua/Alan) and ends net neutral. Works in recruit AND combat (cross-phase by default).' },
      { kind: 'owner-chat', ref: 'Owner review 2026-10-13 (Set 4 self-damage beats)', quote: 'the hits should go out first on its own beat, then the buffs following the hits should roll out after. right now it’s all in one immediate beat. fix it' },
      { kind: 'owner-chat', ref: 'Owner handoff 2026-10-13 (Set 4 Beasts)', quote: 'Damage-taken triggers fire in both phases. Buffs from Apua/Alan in combat are combat-only unless the text says "permanently" (it does: these are permanent, so combat gains carry back).' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts (woundAll, withWound, the four Set 4 Beast bodies); packages/core/src/effects/factories.ts (combat woundAll, friendlyTribeHit); packages/sim/src/recruit.ts (shop woundAll, fireShopDamaged)' },
    ],
    contentIds: ['b4_hawg', 'b4_apua', 'b4_eatah', 'b4_alan'],
    currentBehaviour: 'Conforms as of 2026-10-13 (Set 4 is disabled; play it in the Scene Builder).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set4.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
];
