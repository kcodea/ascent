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
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-01 (Runesmith + Guardian re-activated)', quote: 're-activate runesmith and guardian in the game' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Rayse re-activated)', quote: 'unarchive rayse' },
      { kind: 'code', ref: 'packages/sim/src/heroes.ts HeroDef.wip / isArchivedHero / playableHeroes / practiceHeroes / powerDiscoverPool; packages/ui/src/SceneBuilder.tsx HERO_OPTIONS' },
    ],
    currentBehaviour:
      'Conforms as of 2026-10-02. Archived: Fi, Coran (2026-08-28), Void (2026-09-16) and 16 of the 2026-09-24 batch: '
      + 'Aevor, Cindara, Devourer, Emissary (vale), Fibbsy, Harlan, Odelle, Tiff, Underdweller, '
      + 'Foreman Flint (flint), Gorun, Jensen (jenkins), Membrance, Pete, Sable, Yirin (rohan). Runesmith and '
      + 'Guardian (runeguard) were re-activated on 2026-10-01, Rayse on 2026-10-02. '
      + 'Djinni, Chronos, Chaos and the tutorial-only Aster carry the same flag.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/heroArchive.test.ts', 'packages/ui/src/sceneBuilderPanel.test.tsx'],
      lastVerifiedAt: '2026-10-02',
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
  {
    id: 'R-ANCALBUS-01',
    title: 'Albus × Ancient of Death: Echo minions discovered by Empowerment gain Rise',
    statement:
      'With the Ancient of Death, the minion an Empowerment Discover produces gains Rise when it has an Echo. The pick replaces the Shop offer, so the Rise rides the offer and is baked in when it is bought; when the targeted offer was already gone and the pick went to hand, the hand card gains it. A pick without an Echo, and every other Discover, gains nothing.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Albus Ancients)', quote: 'Death: Echo minions discovered from Empowerment gain Rise.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts empowerEchoGainsRise / ancientOnEmpowerPick; packages/sim/src/reducer.ts takeDiscoverPick' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-28). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAlbus.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ANCALBUS-02',
    title: 'Albus × Ancient of Fortune: minions discovered by Empowerment are free',
    statement:
      'With the Ancient of Fortune, the Shop offer an Empowerment Discover produces costs 0 Gold to buy (its set price, ShopCard.cost). Empowerment itself still costs its 1 Gold.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Albus Ancients)', quote: 'Fortunte: Minions discovered by Empowerment are free.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts empowerFree / ancientOnEmpowerPick' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-28). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAlbus.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ANCALBUS-03',
    title: 'Albus × Ancient of War: a hero-level Pummel (80) over all your minions pays 2 Strange Revisions, once per combat, mid-fight',
    statement:
      "With the Ancient of War, every hit a friendly minion lands in combat (the same hits the Pummel keyword counts: not a popped Ward, not Immune, not 0) adds to ONE hero-level tally, with Rune of the Heavy Hand's extra share. The tally follows the Pummel keyword: it is lifetime (carried across combats), and the hit that crosses a multiple of 80 gets 2 Strange Revisions to hand right then, mid-fight (a live toHand), at most once per combat; crossings past that are spent. The power text prints the live progress toward the next 80 and ticks with each hit during a fight (R-REALTIME-01).",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Albus Ancients)', quote: 'War: Pummel (80): Get 2 Strange Revisions. (Once per Combat)' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts pummelGrantsCards; packages/core/src/combat/simulate.ts noteAncientPummel (ancientPummel); packages/ui/src/useCombatReplay.ts questDelta.friendlyDamage; packages/ui/src/StatusBar.tsx' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-28). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAlbus.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ANCALBUS-04',
    title: 'Albus × Ancient of Genesis: Empowerment costs 3 Gold and also sends a copy of the chosen minion to hand',
    statement:
      'With the Ancient of Genesis, Empowerment costs 3 Gold. After the pick replaces the Shop offer, a plain copy of the chosen minion goes to your hand (the board when the hand is full), so you have the offer to buy plus the copy.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Albus Ancients)', quote: 'Genesis: Empowerment costs 3g. You also get a copy of the chosen minion sent to your hand.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts empowerCopyToHand + power override (cost 3)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-28). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAlbus.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ANCALBUS-05',
    title: 'Albus × Ancient of Time: Empowerment becomes passive; Start of Turn Discovers a minion from the tier above your Shop tier',
    statement:
      'With the Ancient of Time, Empowerment is passive (never activatable). Every Start of Turn opens a Discover of a minion from exactly one tier above your Shop tier, as its own Start of Turn beat (R-SOT-BEAT-01). At the top the tier is clamped the way Empowerment clamps: at Tier 6 it Discovers Tier 6 minions, or Tier 7 with Tier 7 access. The power text prints the live tier.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Albus Ancients)', quote: 'Time: Empowerment becomes Start of Turn: Discover a minion from the tier above you.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts sotDiscoverTierAbove / albusStartOfTurn / albusTimeTier + power override (passive)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-28). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAlbus.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ANCALBUS-06',
    title: 'Albus × Ancient of Bonds: playing an odd (even) tier minion gives your other odd (even) tier minions +3/+3',
    statement:
      'With the Ancient of Bonds, playing a minion from hand whose tier is odd gives every OTHER friendly board minion of an odd tier +3/+3, permanently, right then; an even-tier play does the same for even tiers. The played minion itself is not included. Combat has no play from hand (a hand summon is a summon, not a play), so this is Shop-phase only.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Albus Ancients)', quote: 'Bonds: Playing odd tier units grants +3/+3 to friendly odd tier units. Playing even tier units grants +3/+3 to friendly even tier units.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts playParityBuff / ancientOnPlay; packages/sim/src/recruit.ts playCard' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-28). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsAlbus.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ANCHUNCH-01',
    title: 'Hunch × Ancient of Death: Avenge (4), improve your spells by +1/+1',
    statement:
      'With the Ancient of Death, every 4th friendly death in a combat improves your spells by +1/+1 (spell power, permanent), the moment the 4th death lands, through the same channel as Rune of Appraisal: Rune of Mastery multiplies the improvement and Rune of Fury fires it again. Avenge is a combat keyword, so this counts combat deaths only. The power text prints the Avenge progress and the total improvement so far, live during the fight. The hero power shows the deaths still needed in its centre, counting down live and back to 4 after each trigger, and the +1/+1 plays at the hero power, never on the board (owner 2026-09-30).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Hunch Ancients)', quote: 'Death - Avenge (4) Improve your spells by +1/+1.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts avengeImproveSpells / hunchLive; packages/core/src/combat/simulate.ts ancientAvengeSpells (avenge bus, grantSpellPower)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsHunch.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCHUNCH-02',
    title: 'Hunch × Ancient of Fortune: each Rounded Spellbook use also gives +1 max Gold',
    statement:
      'With the Ancient of Fortune, every Rounded Spellbook use that hands over its copy also raises your max Gold by 1, permanently, through the Gold Font channel (above the natural Gold curve; no extra Gold this turn). Once per use, not once per copy. The power text prints the max Gold granted so far.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Hunch Ancients)', quote: 'Fortune - Rounded Spellbook also increases max gold by 1.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts spellbookMaxGold / ancientOnSpellbook; packages/sim/src/reducer.ts roundedSpellbook branch' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsHunch.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCHUNCH-03',
    title: 'Hunch × Ancient of War: your Shop Spells cast an additional time in combat',
    statement:
      "With the Ancient of War, every Shop Spell your side casts in combat resolves one extra time, as a genuine second cast (every cast watcher sees it). It is Runebloom Matriarch's combat cast channel, granted by the hero for the whole fight.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Hunch Ancients)', quote: 'War - Shop Spells cast an additional time in combat' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts shopSpellsCastExtraInCombat; packages/core/src/combat/simulate.ts spellCastExtra (ancientSpellCastExtra); packages/core/src/effects/factories.ts castInCombat' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsHunch.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCHUNCH-04',
    title: 'Hunch × Ancient of Genesis: every 5 spells cast recharges Rounded Spellbook at 1 Gold',
    statement:
      'With the Ancient of Genesis, every spell you cast (Shop spells, Gifts and Rubies; reward tokens never count) adds to a running count that carries across turns and phases. Every 5th recharges Rounded Spellbook (usable again this turn if already used) and sets its price to 1 Gold, never raising a lower price; it then keeps shrinking by 1 per turn as usual. A recharge earned by combat casts prices the next Shop at 1 Gold. The power text prints how many spells are left, live during a fight.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Hunch Ancients)', quote: 'Genesis - Casting 5 spells resets rounded spellbook at 1g' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts spellsRechargeSpellbook / hunchGenesisTick / ancientOnSpellCast / ancientAfterCombat; packages/sim/src/recruit.ts noteSpellForCountRunes' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsHunch.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCHUNCH-05',
    title: 'Hunch × Ancient of Time: spells from Rounded Spellbook cast twice',
    statement:
      'With the Ancient of Time, each copy Rounded Spellbook hands over is stamped to cast twice (a per-card multiplier, like the other "casts twice" effects). Playing it resolves two genuine casts, each its own cast with its own tick, and the hand badge shows x2.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Hunch Ancients)', quote: 'Time - Spells from rounded spellbook cast twice.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts spellbookCastsTwice / ancientOnSpellbook; packages/sim/src/recruit.ts spellCastsWithout (castMult)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsHunch.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCHUNCH-06',
    title: 'Hunch × Ancient of Bonds: casting a spell gives your left-most and right-most minions +2/+3',
    statement:
      'With the Ancient of Bonds, every spell you cast gives your left-most and right-most minions +2/+3 right then. A lone minion is both ends and gains it once. In the Shop every spell counts (Shop spells, Gifts, Rubies) and the gain is permanent; in combat every spell cast buffs the left-most and right-most living minions for the fight (the standing combat buff rule).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Hunch Ancients)', quote: 'Bonds - Casting spells grants your left and right-most minion +2/+3.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts spellCastBuffsEdges / ancientOnSpellCast; packages/core/src/combat/simulate.ts ctx.castSpell (ancientSpellEdges)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsHunch.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-MIMIC-01',
    title: "Kindness is not in Mimic's hero power pool",
    statement:
      "Mimic's per-turn power Discover never offers Kindness (Great Presence). Power Shifter draws from the same pool, so it never offers Kindness either. Void still can.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29', quote: "mimic can get kindness hero power which is bad. kindness should not be in mimic's pool" },
      { kind: 'code', ref: 'packages/sim/src/heroes.ts MIMIC_EXCLUDED / powerDiscoverPool' },
    ],
    currentBehaviour: 'Conforms (fixed 2026-09-29).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/heroBatchAug22.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-ANCFRANK-01',
    title: 'Frantic Frank × Ancient of Death: Clearance destroys your left-most minion, and the first minion you buy from it is free',
    statement:
      "With the Ancient of Death, Clearance refreshes the Shop as usual, stamps its minions at 0 Gold instead of 2, then destroys your left-most board minion (a real Shop death: its Echo, the death watchers, a Rebirth or Rise return; an empty board skips it). The FIRST Clearance minion you buy is free; that buy re-prices the rest of the set to the Clearance 2 Gold. A later ordinary refresh builds un-stamped offers, so the free buy never carries past its Clearance Shop. The Clearance offers' price coins and the power text (\"Free buy ready.\") show the free buy live.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients, Death revised the same day)', quote: 'make death - destroy leftmost minion and makes the first minion you buy from clearance free' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts clearanceDestroyFirstFree / ancientMarkClearanceOffer / ancientAfterClearance / ancientOnClearanceBuy; packages/sim/src/reducer.ts clearance branch + buy' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsFrank.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCFRANK-02',
    title: 'Frantic Frank × Ancient of Fortune: Clearance minions sell for 2 Gold',
    statement:
      'With the Ancient of Fortune, a minion bought from a Clearance-marked Shop offer is a Clearance minion (a per-instance mark, BoardCard.clearanceBuy, that survives combat, saves and hand/board moves) and sells for 2 Gold (never less than it would sell for anyway). Every sale path reads it through sellValueOf, so the sell float shows the same number. The card text of the minion prints its current sale price as a blue note, "Sells for 2 Gold." (or its higher real value), on the Shop surfaces (board, hand, hover); never for other minions or without Fortune (owner 2026-09-30).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients)', quote: 'Fortune - Clearance minions sell for 2g' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients, Fortune review)', quote: 'just add sells for 2g if it is a fortune frank purchase' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts clearanceSellValue / ancientClearanceSellValue; packages/sim/src/recruit.ts sellValueOf' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsFrank.test.ts', 'packages/ui/src/ancientsFrankText.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCFRANK-03',
    title: 'Frantic Frank × Ancient of War: Avenge (3) gains a Clearance stack; each stack is one more Clearance use',
    statement:
      "With the Ancient of War, every 3rd friendly death in a combat (the Avenge count, a hero-level Avenge like Cindara's Hoard; Rune of Fury fires it again) gains one Clearance stack right then, mid-fight (a questTrigger the replay counts, so the power text's banked count ticks live, R-REALTIME-01). Stacks are banked and kept across turns until used. Once the turn's own Clearance is spent, each further Clearance that turn takes one stack (and still costs its Gold); with no charge and no stack it is refused. Avenge is a combat trigger, so Shop deaths do not count. While 2 or more uses are available (the turn's own use + banked stacks + stacks gained so far in the fight on screen) the power shows that count in RED at its top centre (owner 2026-09-30), re-keyed so each change bumps, and each stack gained mid-fight pops the power with the one-shot hero-power spark; the tooltip then says how many uses are left instead of \"once per turn\". The Avenge (3) countdown (friendly deaths still needed for the next stack: 3 in the Shop, counting down with the fight's deaths, back to 3 after each stack) sits in the CENTRE of the power on a dark disc, live (owner 2026-09-30).",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients)', quote: 'War - Avenge (3): Gain a Clearance stack. this lets clearance be used more than once per turn' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients, War review on 5173)', quote: 'when there are multiple stacks of clearance, show the # in Red in the center top of the hero power' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients, War review on 5173)', quote: 'can you show it in the center of the hero power when war is active' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts avengeClearanceStack; packages/core/src/combat/simulate.ts ancientClearanceStacks avenge listener; packages/sim/src/reducer.ts heroPower stackUse; packages/ui/src/StatusBar.tsx canHero' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsFrank.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCFRANK-04',
    title: 'Frantic Frank × Ancient of Genesis: Clearance costs 3 Gold and refreshes with minions of your most common type',
    statement:
      "With the Ancient of Genesis, Clearance costs 3 Gold, and its refresh draws only minions of your board's most common type (the Reinforcing Ale rule: both types of a dual-type card count, ties go to the first seen on the board), still stamped at the Clearance 2 Gold. The narrowing applies to that one roll only; a type with no stock left at your tier falls back to the ordinary draw, and a board with no type refreshes normally. The power text names the type it would refresh into right now.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients)', quote: 'Genesis - Clearance costs 3g but refreshes with minions of your most common type.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts clearanceTopTribe / ancientClearanceRefresh + power override (cost 3); packages/sim/src/shop.ts rollShopRow (rollTribe)' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsFrank.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCFRANK-05',
    title: 'Frantic Frank × Ancient of Time: Clearance becomes "The first 3 minions you buy each turn cost 2 Gold"',
    statement:
      'With the Ancient of Time, Clearance is passive (never activatable), and like every passive power it has no price, so no cost coin shows (heroPowerCostOf returns 0 for a passive power; the same holds for the Time pairings of Albus and the Auctioneer). The first 3 minions you buy each turn (every minion buy counts, the Starform included) have their price capped at 2 Gold in offerBuyPrice, the one price the buy charges and the coin shows; other discounts still apply on top. The count resets each turn, and the power text prints how many discounted buys are left this turn. A displaced (held) offer restored at its flat price is not discounted and does not count.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients)', quote: 'Time - Clearance becomes "The first 3 minions you buy each turn cost 2g."' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts firstBuysCost / ancientTimePrice / ancientNoteMinionBuy + power override (passive); packages/sim/src/reducer.ts offerBuyPrice' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsFrank.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCFRANK-06',
    title: "Frantic Frank × Ancient of Bonds: selling a Clearance minion gives its stats to a random friendly minion",
    statement:
      "With the Ancient of Bonds, selling a Clearance minion (through the shared sale path, settleMinionSale) gives its CURRENT Attack and Health to a random friendly board minion, permanently, right then, with its beat: a buff tendril from the slot the sold minion left to the recipient (a deathrattle-kind capture keyed on the sold uid) and the recipient's stat pop. The sold minion is gone first, so it is never its own recipient; with no other minion nothing happens. Sales only happen in the Shop.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (Frank Ancients)', quote: 'Bonds - Selling Clearance minions grants the minions stats to a random friendly minion.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts clearanceSaleGivesStats / ancientOnSale; packages/sim/src/recruit.ts settleMinionSale' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-30). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsFrank.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-ANCXEROX-01',
    title: 'Xerox × Ancient of Death: Avenge (5) summons a copy of your highest Attack minion, Shop and combat',
    statement:
      "With the Ancient of Death, Xerox has a hero-level Avenge (5) on ONE running count of friendly deaths across the Shop and combat (the Rune of Body Counting meter shape: Shop deaths tick it at fireOnFriendDeath, combat carries it in and settle adds the fight's deaths). Every 5th death summons an exact copy (Copy Machine's meaning: current stats, keywords, gilding; in combat the body's current stats with its Ward and Rise state) of your highest-Attack living minion, ties to the left-most, beside it. A full board copies nothing. In combat it fires mid-fight on the death that completes the count, and Rune of Fury fires it again like every hero Avenge. The power prints the deaths still needed, live through a fight, and the countdown sits in the centre of the power.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Xerox Ancients)', quote: 'death - Avenge (5): Summon a copy of your highest attack minion' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts avengeCopyTopAttack / ancientXeroxShopDeath / ancientXeroxAvengeLeft; packages/core/src/combat/simulate.ts ancientXeroxAvenge avenge listener' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsXerox.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCXEROX-02',
    title: 'Xerox × Ancient of Fortune: gain 4 Gold next turn for every pair on your board',
    statement:
      'With the Ancient of Fortune, at End of Turn Xerox banks 4 Gold for next turn for every PAIR on the board: two minions of the same card (a Gilded and a plain copy of one card are the same card), counted as floor(n / 2) per card. It is a virtual recurring End-of-Turn entry, so End of Turn repeats and replays fire it like every other recurrence. The power prints the pairs on the board right now and the Gold they would bank.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Xerox Ancients)', quote: 'fortune - Gain 4g next turn for every pair you have on board' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts pairsGoldNextTurn / boardPairs / ancientRunXeroxPairs; packages/sim/src/recruit.ts recurringEotEffects (ancientXeroxPairs)' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsXerox.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCXEROX-03',
    title: 'Xerox × Ancient of War: Start of Combat, summon a copy of your highest Health minion',
    statement:
      'With the Ancient of War, at Start of Combat Xerox summons an exact copy (current combat stats, keywords, Ward and Rise state, gilding) of the highest-Health living friendly minion, ties to the left-most, beside it. A full board copies nothing. The copy is a combat body only: the run board is unchanged after the fight.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Xerox Ancients)', quote: 'war - Start of Combat: Summon a copy of your highest health minion' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts socCopyTopHealth; packages/core/src/combat/simulate.ts ancientXeroxSoc (Start of Combat)' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsXerox.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCXEROX-04',
    title: 'Xerox × Ancient of Genesis: Copy Machine gains another use',
    statement:
      "With the Ancient of Genesis, the pick banks one more Copy Machine use. Copy Machine is once per game, so this makes two uses for the game: once the once-per-game use is spent, the banked charge lets it fire again (no turn gate), and spends the charge. Picked after Copy Machine was already used, it is usable once more. The power prints the uses left and the button is ready while a charge is banked.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Xerox Ancients)', quote: 'genesis - Gain another charge of Copy Machine' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts copyMachineExtraCharge / ancientCopyCharges; packages/sim/src/reducer.ts heroPower chargeUse; packages/ui/src/StatusBar.tsx canHero' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsXerox.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCXEROX-05',
    title: 'Xerox × Ancient of Time: Start of Turn, get a copy of a minion you control',
    statement:
      'With the Ancient of Time, at Start of Turn Xerox gets an exact copy of a random friendly board minion (the seeded run stream) in hand, on its own Start of Turn beat (R-SOT-BEAT-01). An empty board or a full hand gets nothing. The triple check that runs as the Shop opens sees the copy.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Xerox Ancients)', quote: 'time - Start of Turn: Get a copy of a minion you control.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts sotCopyToHand / xeroxStartOfTurn' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsXerox.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCXEROX-06',
    title: 'Xerox × Ancient of Bonds: the copy and the original are bound; a triple breaks the bond',
    statement:
      "With the Ancient of Bonds, Copy Machine binds its copy and the original (run state, AncientsState.xeroxBond, so it survives save and restore). Whenever either gains stats, the other gains the same, the moment it happens (R-REALTIME-01): in the Shop through addBuff (the Sable Soulbind hook), in combat through ctx.buff matched on the run uid. Only gains mirror, one hop: the mirrored gain never mirrors back. A permanent combat gain mirrors once, at settle (the combat mirror never accrues Engraved carry-back). The bond breaks for good when either end is consumed into a triple, sold, destroyed in the Shop, or otherwise leaves the run; a combat death does not break it (the run board keeps both). The power prints who is bound, or that the bond is broken.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Xerox Ancients)', quote: 'bonds - The copy and the original are bound. Stats one gains, the other gains too.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Xerox Ancients)', quote: 'if this triples, the effect breaks' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts copyMachineBonds / ancientOnCopyMachine / ancientXeroxBondValidate; packages/sim/src/recruit.ts stampXeroxBond + addBuff; packages/core/src/combat/simulate.ts ancientXeroxBond' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsXerox.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCTRADES-01',
    title: 'Tradesman × Ancient of Death: Avenge (3) gains a free Refresh, one count across Shop and combat',
    statement:
      "With the Ancient of Death, Tradesman has a hero Avenge (3) on ONE running count of friendly deaths across the Shop and combat (AncientsState.tradesDeaths, the Xerox Death convention). Every Shop death path ticks it once (a sale never); combat carries the count in and settle adds the fight's deaths. Every 3rd death banks a free Refresh (RunState.freeRolls, spent by the next roll at 0 Gold) the moment it happens: in combat through grantFreeRolls, the free-roll carry-back, so it is usable from the next Shop. Rune of Fury fires the combat half again. The power prints the countdown (live through a fight) and the banked free Refreshes, and the countdown takes the shared centre disc.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients)', quote: 'Death - Avenge (3): Gain a free Refresh' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts avengeFreeRefresh / ancientTradesShopDeath / ancientAfterCombat; packages/core/src/combat/simulate.ts ancientRefreshAvenge' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsTradesman.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCTRADES-02',
    title: 'Tradesman × Ancient of Fortune: buying a minion makes your next Refresh cost 0 (never stacks)',
    statement:
      'With the Ancient of Fortune, every minion BOUGHT from the Shop (a normal buy, the Starform, a displaced body re-bought) sets ONE pending "next Refresh costs 0" (AncientsState.tradesNextRefreshFree). It never stacks: more buys while it is set add nothing, and it never banks into RunState.freeRolls. The next Refresh (the roll action) spends it FIRST, before any banked free Refresh (which is kept) or Window Shopping. It carries across turns until used and survives save / restore. The Refresh button, nextRefreshCostOf and the bots read refreshCostOf, which prints 0 while it is pending; the power text says whether the next Refresh is free. Spell buys, Discovers and generated cards do not count.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients)', quote: 'Fortune - When you buy a minion, gain a free Refresh' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients, owner rulings on PR #1905)', quote: 'All minion buys (as built)' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Fortune change)', quote: "change tradesman's fortune ancient to 'when you buy a minion, your next refresh costs 0' this way it doesn't stack up multiple free refreshes." },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts buyNextRefreshFree / ancientTradesBuy / ancientTradesSpendFreeRefresh; packages/sim/src/reducer.ts refreshCostOf + roll branch' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsTradesman.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCTRADES-03',
    title: 'Tradesman × Ancient of War: your minions have "Rally: gain 1 Gold next turn"',
    statement:
      'With the Ancient of War, every friendly minion (board and hand, every arrival path, swept at the applyRuneGrafts chokepoint) carries the Rally keyword and a grafted rallyGoldNextTurn (grantedEffects, so it rides into combat, snapshots and replays); bodies summoned in combat get it too (QuestCombatMods.ancientRallyGold). Every Rally trigger banks 1 Gold for next turn, uncapped: a swing, each Rally multiplier repeat, a free or Shop Rally. Combat banks through the bonus-Gold carry-back; the Shop through bonusEmbersNextTurn. A Gilded minion gives the same 1 Gold (a hero-granted graft, the rune-graft rule; owner ruling: always 1). The power prints the Gold banked for next turn, live through a fight.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients)', quote: 'War - Your minions gain Rally: Gain 1g next turn' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts rallyGoldNextTurn; packages/core/src/effects/factories.ts + packages/sim/src/recruit.ts rallyGoldNextTurn; packages/sim/src/recruit.ts applyRuneGrafts' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients, owner rulings on PR #1905)', quote: 'Always 1 (as built)' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsTradesman.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCTRADES-04',
    title: 'Tradesman × Ancient of Genesis: every 2 Refreshes casts Lasso',
    statement:
      "With the Ancient of Genesis, every Shop Refresh (paid, free, or a power's; never the turn-start roll) ticks a running count since the pick (AncientsState.tradesRefreshes, across turns). Every 2nd casts Lasso through castSpell, the real Shop cast pipeline (spell counters, spell watchers, Rune of Lassoing), right after the new row is rolled, so it steals from the fresh Shop. Its lasso beam leaves the hero power. The power prints the Refreshes still needed.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients)', quote: 'Genesis - Every 2 Refreshes, cast Lasso.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts refreshesCastSpell / ancientAfterRefresh; packages/sim/src/reducer.ts refreshTavern' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients, owner rulings on PR #1905)', quote: 'Yes, every refresh (as built)' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsTradesman.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCTRADES-05',
    title: 'Tradesman × Ancient of Time: End of Turn, the Shop upgrade costs 3 less',
    statement:
      "With the Ancient of Time, End of Turn (a virtual recurring entry, ancientTradesUpgrade, so End-of-Turn repeats and replays follow the one rule) knocks 3 off the FINAL upgrade price, Frugal's +2 surcharge included, down to 0: the running upgrade cost goes first (the Rune of Shopkeep mechanism, floored at CONFIG.upgradeCostFloor), and what is left over eats into the surcharge for the current tier (AncientsState.tradesSurchargeOff, capped at the surcharge, ignored once the tier changes, so the next tier pays the full +2 again). upgradeCostOf folds it in, so the button, the bots and the charge agree. The price never goes below 0. The power prints the live upgrade price.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients)', quote: 'Time - End of Turn: Reduce the cost of upgrading the Shop by 3.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts eotUpgradeDiscount / ancientRunTradesUpgrade; packages/sim/src/recruit.ts recurringEotEffects' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients, owner rulings on PR #1905)', quote: 'Yes, down to 0' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsTradesman.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCTRADES-06',
    title: 'Tradesman × Ancient of Bonds: every Refresh makes the Shop upgrade cost 1 less',
    statement:
      "With the Ancient of Bonds, every Shop Refresh (paid, free, or a power's; never the turn-start roll) knocks 1 off the FINAL upgrade price, Frugal's +2 surcharge included, down to 0, the moment it happens: the running cost first (floored at CONFIG.upgradeCostFloor), then the surcharge for the current tier (AncientsState.tradesSurchargeOff, the same channel as Time). The price never goes below 0. The power prints the live upgrade price.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients)', quote: 'Bonds - Refreshing the shop reduces the cost of upgrading the Shop by 1.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts refreshUpgradeDiscount / ancientAfterRefresh; packages/sim/src/reducer.ts refreshTavern' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Tradesman Ancients, owner rulings on PR #1905)', quote: 'Yes, down to 0' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsTradesman.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCSOREN-01',
    title: 'Soren × Ancient of Death: the Echo Reclaim triggers fires an extra time',
    statement:
      "With the Ancient of Death, the Echo that Reclaim's Start-of-Combat destroy triggers fires one more time. The extra fire goes through the shared Echo-multiplier fold (playerEchoExtras), scoped to the Reclaimed body only, so every Echo watcher and the Echo tally hear each fire. Any other death in the fight, including the returned copy's own later death, is unchanged.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'death - Echoes triggered by Reclaim trigger an additional time.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts reclaimEchoExtra; packages/core/src/combat/simulate.ts ancientReclaim.echoExtra in playerEchoExtras (reclaimEchoUid)' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsSoren.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCSOREN-02',
    title: 'Soren × Ancient of Fortune: Reclaim resolves in the Shop and gains 5 Gold; no room means an overflow and the copy is lost',
    statement:
      "With the Ancient of Fortune, Reclaim no longer marks a minion for Start of Combat. Using it destroys the minion in the Shop right away as a true death (no Rise or Rebirth return, as combat Reclaim forces; its Echo fires where it stood), then an exact copy of the body it had (Copy Machine's exact copy) returns to its slot, to the right of anything its Echo summoned there, as a summon (the on-summon watchers fire). If the board is full after the Echo, it is an overflow (the summon-overflow watchers fire) and the copy is lost: never sent to hand. Each use gains 5 Gold immediately. Still free and once per turn.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'fortune - Reclaim works in Recruit phase instead. Gain 5g when it is used.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: "it'd be an 'overflow' technically, but if no room then it is lost" },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts ancientShopReclaim / ancientReclaimInShop; packages/sim/src/reducer.ts resummon branch' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsSoren.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCSOREN-03',
    title: 'Soren × Ancient of War: Reclaimed copies gain +X/+X for that fight; X starts at 10 and improves by 10 every Start of Turn',
    statement:
      'With the Ancient of War, each copy Reclaim returns in combat gains +X/+X the moment it lands, through the normal combat buff, so it lasts that fight only and Engraved (or anything else that keeps combat gains) carries it back. X is 10 at the pick and improves by +10/+10 every Start of Turn (the Improve-this convention: grow by the printed amount), stored on the run (AncientsState.sorenWarGain). The power prints the live X.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'war - Reclaimed minions gain +10/+10 on re-summon. Start of Turn: Improve this.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'fight only, but engraving etc would carry it back' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts reclaimGainImproves / ancientReclaimGain / sorenStartOfTurn; packages/core/src/combat/simulate.ts flushResummons reclaim.gain' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsSoren.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCSOREN-04',
    title: 'Soren × Ancient of Genesis: Reclaim also gives a plain copy of its target to hand, locked for 3 turns',
    statement:
      'With the Ancient of Genesis, Reclaim still marks its target as normal and also puts a plain copy (the printed card, never Gilded) in your hand, locked for 3 turns through the hand-card wave lock (lockedUntilWave = this turn + 3): it cannot be played this turn or the next two, and the padlock shows the turns left. A full hand gets no copy, and it never goes to the board.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'genesis - Reclaim grants a plain copy of the minion you target, but it is locked for 3 turns.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts reclaimCopyLocked / ancientAfterReclaimMark; packages/ui/src/Recruit.tsx wave-lock label' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsSoren.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCSOREN-05',
    title: 'Soren × Ancient of Time: Reclaim resummons two copies',
    statement:
      "With the Ancient of Time, Reclaim's Start-of-Combat destroy queues two copies of the body instead of one. Each waits for room on its own, the native Reclaim rule, so a full board holds the second back until a friendly death frees a slot. Only the first copy is linked to the run card (sourceUid), so carry-backs never reach it twice.",
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'time - Reclaim summons twice.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts reclaimSummonsTwice; packages/core/src/combat/simulate.ts Reclaim Start-of-Combat loop (ancientReclaim.copies)' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsSoren.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-ANCSOREN-06',
    title: 'Soren × Ancient of Bonds: when a Reclaimed copy returns, the minions next to it gain its Attack for that fight',
    statement:
      'With the Ancient of Bonds, the moment a Reclaimed copy lands in combat, its living neighbours gain Attack equal to its Attack, through the normal combat buff: that fight only, kept by Engraved like every combat gain. No neighbour, no grant.',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'bonds - When the reclaimed minion summons, grant its attack to adjacent minions.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-02 (Soren Ancients)', quote: 'That fight only' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts reclaimBondsAdjacent; packages/core/src/combat/simulate.ts flushResummons reclaim.bonds' },
    ],
    currentBehaviour: 'Conforms (built 2026-10-02). Dev-only (Scene Builder, Set 3, the Ancients flag).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/ancientsSoren.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
];
