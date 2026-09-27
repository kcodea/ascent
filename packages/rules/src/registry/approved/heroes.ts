/**
 * APPROVED RULES — domain `heroes`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const HEROES_RULES: GameRule[] = [
  {
    id: 'R-HERO-01',
    title: 'An archived hero is offered by no picker in any mode, yet every stored reference to it still resolves; only the Scene Builder lists it',
    statement:
      'Archiving a hero (`HeroDef.wip`, tested by `isArchivedHero`) withholds it from every place a NEW run can be '
      + 'handed a hero: the Play hero picker (`playableHeroes`), Practice (`practiceHeroes`), generated rival seats in '
      + 'a lobby (`createRunLobby`), Practice bot portraits (`createPracticeBotLobby`), synthesized opponent-pool '
      + 'boards (`synthesizeWaveFromCurve`), the Compendium Heroes tab, and the Mimic / Void / Power Shifter power '
      + 'Discovers (`powerDiscoverPool`). The def stays in `HEROES` / `HERO_INDEX`, so `getHero(id)` resolves it by id '
      + 'with its own name and portrait: saved runs, replays, the recorded snapshot seat of a real player, baked '
      + '`opponentPool.data.ts` boards, Career history and leaderboards all keep showing it. The Scene Builder hero '
      + 'picker lists every hero, archived ones marked "(archived)", and can start a sandbox on one.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (archive heroes)', quote: 'Archive these heroes. (remove them from all modes but keep them in the game. they should only show in scene builder)' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (owner rulings: Mimic / Power Shifter never offer an archived hero power)', quote: 'yes keep it that way' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-08-28 (Fi + Coran archive)', quote: 'coran and fi should be archived for now. they will be redesigned and should not show in our hero list for practice nor play' },
      { kind: 'code', ref: 'packages/sim/src/heroes.ts HeroDef.wip / isArchivedHero / playableHeroes / practiceHeroes / powerDiscoverPool; packages/ui/src/SceneBuilder.tsx HERO_OPTIONS' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. Archived: Fi, Coran (2026-08-28), Void (2026-09-16) and the 2026-09-24 batch of 19: '
      + 'Aevor, Cindara, Devourer, Emissary (vale), Fibbsy, Harlan, Odelle, Tiff, Underdweller, Runesmith, Guardian '
      + '(runeguard), Foreman Flint (flint), Gorun, Jensen (jenkins), Membrance, Pete, Rayse, Sable, Yirin (rohan). '
      + 'Djinni, Chronos, Chaos and the tutorial-only Aster carry the same flag.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/heroArchive.test.ts', 'packages/ui/src/sceneBuilderPanel.test.tsx'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-ANCWARDEN-01',
    title: 'Warden × Ancient of Death: Aegis destroys its target and gives its Attack and Ward to a random friendly minion, one without Ward first',
    statement:
      'With the Ancient of Death, the Warden\'s Aegis picks a friendly minion to destroy. The recipient is RANDOM, chosen '
      + 'before the destroy from the other friendly minions: one without Ward if any exists, else a random Warded one. It '
      + 'needs two friendly minions. The destroy is a real Shop death (its Echo, the death watchers and '
      + 'counters, a Rebirth or Rise return). The recipient permanently gains the Attack the victim had and Ward (a '
      + 'Resilient Ward on the victim travels as a Resilient Ward). The power is REPLACED: no +5 Attack wave follows '
      + '(judgement call pending the owner).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Ancients)', quote: 'Aegis destroys a friendly minion and gives its Attack and Ward to a friendly minion.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Death rework)', quote: 'Warden\'s ancient of death should give attack and ward to a RANDOM friendly minion. it will smart target minions without ward first, if all other minions have ward it is a random warded minion.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts aegisDestroyGivesAttackAndWard / ancientAegisRecipient / ancientAegisDestroyAndGive; packages/sim/src/reducer.ts heroPower grantWard' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsWarden.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCWARDEN-02',
    title: 'Warden × Ancient of Fortune: each friendly Ward that breaks in combat pays 2 Gold next turn',
    statement:
      'Every FRIENDLY Ward that breaks in the player\'s fight adds 2 Gold to the next turn\'s Gold, stacking per break. A '
      + 'Resilient Ward\'s first hit (the downgrade) is not a break. Aegis keeps its normal effect.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Ancients)', quote: 'When a Ward breaks in combat, gain 2 gold next turn.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts wardBreakGold / ancientAfterCombat; packages/core/src/combat/simulate.ts wardBreakLog (ancientTrackWardBreaks)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsWarden.test.ts', 'packages/core/src/combat/resilientWard.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCWARDEN-03',
    title: 'Warden × Ancient of War: Aegis on a minion that already has Ward gives it Resilient Ward',
    statement:
      'With the Ancient of War picked, every Aegis on a friendly minion that ALREADY has Ward upgrades that Ward to '
      + 'Resilient Ward (a standing rule, not a one-shot). An Aegis on a minion without Ward gives it a plain Ward, as '
      + 'usual. Either way the usual +5 Attack to every minion with Ward follows. Replaces the earlier "your next Aegis '
      + 'grants Resilient Ward" (owner 2026-09-26).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Ancients)', quote: 'Your next Aegis grants Resilient Ward. It takes 2 hits to break.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (War rework)', quote: "warden's ancient of war should be using aegis on a warded minion grants it resilient ward" },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts aegisUpgradesWardToResilient / ancientAegisResilient(state, hadWard); packages/sim/src/reducer.ts heroPower grantWard' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsWarden.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCWARDEN-04',
    title: 'Warden × Ancient of Genesis: every 3 friendly Ward breaks (counted across combats) get a copy of one of those minions',
    statement:
      'A running count of FRIENDLY Ward breaks in combat, carried across combats from the pick. Every 3rd break gets a plain '
      + 'copy (to hand, the board when the hand is full) of a random minion whose Ward broke in that window of 3; the '
      + 'window then restarts. The power text prints the live countdown. REAL-TIME (owner 2026-09-26, R-REALTIME-01): the '
      + 'copy is granted DURING the fight, the moment the 3rd Ward breaks (a live toHand), never at settle.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Ancients)', quote: 'When 3 Wards break in combat, get a copy of one of the Warded minions.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Genesis timing)', quote: "warden's genesis grant should be in real-time not at combat resolution." },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts wardBreaksGetCopy / ancientCombatMods (ancientWardCopy) / ancientAfterCombat; packages/core/src/combat/simulate.ts the Ward-break site' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsWarden.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCWARDEN-05',
    title: 'Warden × Ancient of Time: End of Turn, every friendly minion with Ward gains +5/+5 permanently',
    statement:
      'A recurring End-of-Turn effect (its own beat, projected, repeated by End-of-Turn multipliers and replays like every '
      + 'recurrence): each friendly minion that has Ward at that moment (a Resilient Ward counts) gains +5/+5, permanently, '
      + 'before the fight is prepared.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Ancients)', quote: 'End of Turn: Give your Warded minions +5/+5.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts eotBuffWarded; packages/sim/src/recruit.ts recurringEotEffects (ancientTimeWard)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsWarden.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCWARDEN-06',
    title: 'Warden × Ancient of Bonds: a Warded minion gaining stats gives another Warded minion +5 Attack, never re-triggering',
    statement:
      'Whenever a friendly minion with Ward gains stats (any source, any phase), a random OTHER friendly minion with Ward '
      + 'gains +5 Attack. That +5 never triggers Bonds again. Shop: one fire per gaining minion per action (the per-action '
      + 'stat diff, plus an End-of-Turn pass so End-of-Turn gains react before the fight), permanent. Combat: one fire per '
      + 'gain as it lands (`ctx.buff`), and like every combat gain it lasts the fight unless the recipient is Engraved.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Ancients)', quote: 'When a Warded minion gains stats, give another Warded minion +5 attack. this doesnt re-trigger itself' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts wardedGainBuffsWarded / ancientBondsReact; packages/core/src/combat/simulate.ts ctx.buff (ancientBonds, ancientBondsFiring)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsWarden.test.ts', 'packages/core/src/combat/resilientWard.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCAUCT-01',
    title: 'Auctioneer × Ancient of Death: Pulse triggers the Shout one more time, then destroys the minion',
    statement:
      'With the Ancient of Death, Pulse fires the chosen minion\'s Shout twice (the base replay plus one more, each through the shared replay path, so a gild or Drakko applies to each), then destroys it. The destroy is a real Shop death (its Echo, the death watchers, a Rebirth or Rise return). A minion with no Shout cannot be Pulsed.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Auctioneer Ancients)', quote: 'Pulse triggers the chosen minion\'s Shout an additional time, then destroys it.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts pulseRepeatThenDestroy; packages/sim/src/reducer.ts heroPower replayBattlecry' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAuctioneer.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCAUCT-02',
    title: 'Auctioneer × Ancient of Fortune: every Shout fired in the Shop phase banks 1 Gold for next turn',
    statement:
      'Every Shout FIRE in the Shop phase (played from hand, Pulse, any replay, End-of-Turn replays; a Drakko repeat is its own fire) adds 1 Gold to next turn\'s Gold the moment it fires. Shouts fired in combat do not count, because the text says Shop phase. The power text prints the Gold banked so far this turn.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Auctioneer Ancients)', quote: 'Whenever you trigger a Shout during the Shop phase, gain 1 Gold next turn.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts shopShoutGold / ancientOnShopShout; packages/sim/src/recruit.ts fireBattlecryTriggered' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAuctioneer.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCAUCT-03',
    title: 'Auctioneer × Ancient of War: the Pulsed minion also gains "Rally: trigger this minion\'s Shout"',
    statement:
      'Pulse fires the Shout as normal, then the target permanently gains the Rally keyword and a grafted Rally (`grantedEffects`: `rallyTriggerOwnShout`) that fires its own Shout each time it attacks, in real time, through the shared combat Shout path (a counted shout event, Drakko folded, `battlecryTriggered` for every watcher). It also works on a Shop Rally. One graft per minion: a second Pulse does not stack it. The card prints the granted Rally on every surface.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Auctioneer Ancients)', quote: 'The minion you Pulse gains \'Rally: trigger this minion\'s Shout\'' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts pulseGrantsRallyShout / ancientAfterPulse; packages/core/src/effects/arena.ts rallyTriggerOwnShout; packages/ui/src/instView.ts GRANTED_RALLY_SHOUT_NOTE' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAuctioneer.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCAUCT-04',
    title: 'Auctioneer × Ancient of Genesis: Pulse becomes a 2 Gold Discover of a Shout minion',
    statement:
      'With the Ancient of Genesis, Pulse is replaced: untargeted, 2 Gold, still once per turn, it opens a Discover of minions with a Shout from the run\'s pool at your Shop tier or below (the Help Wanted convention).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Auctioneer Ancients)', quote: 'Pulse becomes: 2g - Discover a Shout minion.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts pulseDiscoverShout + power override; packages/sim/src/heroes.ts activePowers; packages/sim/src/reducer.ts heroPower replayBattlecry' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAuctioneer.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCAUCT-05',
    title: 'Auctioneer × Ancient of Time: Pulse is passive; Start of Combat triggers the left-most and right-most Shouts',
    statement:
      'With the Ancient of Time, Pulse becomes passive (never activatable). At Start of Combat the left-most and the right-most living friendly minions that have a Shout each fire it once, through the shared combat Shout path, so every Shout watcher and tally hears them. When they are the same minion (only one Shout on the board) it fires once.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Auctioneer Ancients)', quote: 'Pulse becomes passive. Start of Combat: trigger your left-most and right-most Shouts. If you have only one Shout, trigger it once.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts socTriggerEdgeShouts + power override; packages/core/src/combat/simulate.ts ancientEdgeShouts' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAuctioneer.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCAUCT-06',
    title: 'Auctioneer × Ancient of Bonds: whenever a Shout triggers, the minions next to it gain +4/+3',
    statement:
      'Whenever a friendly Shout fires (any source), the minions next to the Shouting minion gain +4/+3 right then. Shop: permanent, per fire. Combat: per fire, on its living neighbours, right after the Shout\'s own effect; like every combat gain it lasts the fight unless the minion is Engraved.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Auctioneer Ancients)', quote: 'Shout triggers buff adjacent minions +4/+3.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts shoutBuffsAdjacent / ancientOnShopShout; packages/core/src/combat/simulate.ts ancientShoutAdjacent' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAuctioneer.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCRISEN-01',
    title: "Lord of the Risen × Ancient of Death: Undying's target gains Rise again after it Rises, once per combat (a blue Rise)",
    statement:
      'With the Ancient of Death, the minion Undying marked regains Rise the moment it returns from its Rise in combat, once per combat, so it can Rise a second time that fight; its third death is final. The regained Rise shows as a BLUE copy of the Rise look (the idle dome and wisps, and its return FX). A body that regains Rise still reads as having died for every per-exchange death check (kill credit, the Flurry second-swing rule, the vanguard rule).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Lord of the Risen Ancients)', quote: "Undying's target gains Rise after rising. (Once per combat.) — with this, copy the existing rise effect, except make it blue instead of green" },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts undyingRegainsRise; packages/core/src/combat/simulate.ts killOrReborn (ancientUndying.regainRise) + risesOf' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsRisen.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCRISEN-02',
    title: 'Lord of the Risen × Ancient of Fortune: every friendly Rise in combat banks 1 Gold for next turn',
    statement:
      "With the Ancient of Fortune, every friendly Rise in combat is counted the moment it happens (a Rise whose return overflowed does not count) and adds 1 Gold to next turn's Gold. The power text prints the Gold the last combat banked.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Lord of the Risen Ancients)', quote: 'When a minion Rises each combat, gain 1 Gold next turn.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts riseGold / ancientAfterCombat; packages/core/src/combat/simulate.ts onRise listener (ancientCountRises)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsRisen.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCRISEN-03',
    title: 'Lord of the Risen × Ancient of War: the Undying target Rises with double Attack and attacks immediately (a red Rise)',
    statement:
      'With the Ancient of War, every Rise of the minion Undying marked returns it with double the Attack it returns with, and it attacks immediately: it cuts the line like any "attacks immediately" summon (R-ORD-05), striking once its return settles, before the next normal attacker, and between the two swings of a Flurry. Its Rise shows as a RED copy of the Rise look, in the Shop and in combat.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Lord of the Risen Ancients)', quote: 'The minion chosen by Undying returns with double Attack and attacks immediately. — copy the existing rise effect, except make it red instead of green' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts undyingReturnsDoubleAndAttacks / ancientRiseTint; packages/core/src/combat/simulate.ts killOrReborn (ancientUndying.war) + the interrupting queue item' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsRisen.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCRISEN-04',
    title: 'Lord of the Risen × Ancient of Genesis: every summon in combat summons an extra copy; an extra that does not fit is an overflow',
    statement:
      'With the Ancient of Genesis, every friendly summon in combat summons one more copy of what it summoned, through the normal summon path: Echo summons, token summons, hand summons, fills, and every Rise or Rebirth return (the copy of a returned body comes at its return stats, without Rise or Rebirth). The copy counts as a summon for every watcher and tally. On a full board the copy is a real overflow: it fires every overflow watcher, exactly like any summon that did not fit. A copy never makes copies of its own.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Lord of the Risen Ancients)', quote: 'Your summons summon an extra minion in combat. — adds 1 to any and all summon effects in combat, including rise.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Risen Ancients, owner answers)', quote: 'make sure these count as overflows, this is important. this also makes echo summons summon an extra body.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts summonsSummonExtra; packages/core/src/combat/simulate.ts placeSummon (summonGenesisExtras) + summonReturnExtras' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsRisen.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCRISEN-05',
    title: 'Lord of the Risen × Ancient of Time: Start of Turn, your minions gain +3/+2 for each minion summoned in the last combat',
    statement:
      "With the Ancient of Time, every friendly minion summoned in combat is counted at the summon-entry chokepoint (hand summons, Echo summons, tokens, Rise and Rebirth returns, Genesis copies), and the next Start of Turn gives every minion on your board +3/+2 per counted summon, permanently. Only the previous combat counts. The power text prints the last combat's count and the grant it paid.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Lord of the Risen Ancients)', quote: 'Start of Turn: Give your minions +3/+2 for every minion summoned in combat. — summoned counts anything from hand, echo summons, and rising bodies.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Risen Ancients, owner answers)', quote: 'TIME: confirmed, previous combat only.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts sotBuffPerCombatSummon / ancientStartOfTurn; packages/core/src/combat/simulate.ts summonEntryEffects (ancientCountSummons)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsRisen.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCRISEN-06',
    title: 'Lord of the Risen × Ancient of Bonds: when a minion Rises, trigger the Echo of a minion next to it',
    statement:
      'With the Ancient of Bonds, whenever a friendly minion Rises (combat and Shop), the Echo of a living minion next to it fires right then, through the shared Echo path (every Echo multiplier and the Echo tally apply; in combat it is attributed to the risen body). When both neighbours have an Echo, one is picked at random; when neither has one, nothing happens. It stacks with every other Rise and Echo effect.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Lord of the Risen Ancients)', quote: 'When a minion Rises, trigger an adjacent Echo. — this stacks with any other potential effects and triggers happening of course.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Risen Ancients, owner answers)', quote: 'BONDS: confirmed (random adjacent Echo if both neighbours have one, nothing if neither; stacks with everything else).' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts riseTriggersAdjacentEcho / ancientOnShopRise; packages/core/src/combat/simulate.ts onRise listener (ancientRiseEcho); packages/sim/src/recruit.ts riseReturn' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-26). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsRisen.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ANCRISEN-07',
    title: 'Lord of the Risen x Ancient of Time: the summon tally ticks live during the fight, and the grant pays the previous combat only',
    statement:
      'The Undying (Time) power text counts friendly summons IN REAL TIME: during a fight it prints "This combat: N '
      + 'summoned (+3N/+2N)" and N climbs on the replay beat of each summon (the same step-tagged tally the quest panel '
      + 'reads), never jumping to the final number at combat start or appearing only at resolution. Once the fight '
      + 'settles it prints "Last combat: N summoned", exactly the count the next Start of Turn pays. The payout uses the '
      + 'previous combat only, never a running total, and plays as its own Start of Turn beat (R-SOT-BEAT-01).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Undying (Time) tooltip screenshot)', quote: 'this hero power is tallying at resolution, not in real time. please confirm our oracle states we default to real time updates and fix this.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts ancientPowerText ({timeWhen}, AncientPowerLive.combatSummons); packages/sim/src/recruit.ts HeroPowerLive.summons; packages/ui/src/StatusBar.tsx (combatQuestDelta.summonCombat); packages/ui/src/useCombatReplay.ts questDelta' },
    ],
    currentBehaviour: 'Conforms, FIXED 2026-09-26: the text printed the banked count of the previous fight for the whole fight and changed only at settle (R-REALTIME-01).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/risenTimeRealtime.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
  {
    id: 'R-ENCHANTFX-01',
    title: 'Ayse: the Enchanted shop-card sparkle hides while an overlay covers the shop',
    statement:
      'The looping Enchanted effect on a shop card (Ayse, Lucky Seat) draws on the shared effects canvas, which sits '
      + 'above board-covering overlays. While one is open (Discover, Choose One, a quest or Runeforge offer, a scouted '
      + 'board, the Fight Recap, the Ancient awakening and offer) the loop hides, and it shows again when the overlay '
      + 'closes. It never bleeds through an overlay. (It already stops for combat and while the card is dragged.)',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Ancient awakening screenshot)', quote: 'small bug - an ayse card bleeds through the animation' },
      { kind: 'code', ref: 'packages/ui/src/useCiaEnchantedFx.ts overlayCoversShop (the follow returns null under modalup / ancgate / ancoffer)' },
    ],
    currentBehaviour: 'Conforms, FIXED 2026-09-26: the sparkle showed through the Ancient awakening backdrop.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/enchantedUnderOverlays.test.ts'], lastVerifiedAt: '2026-09-26' },
  },
];
