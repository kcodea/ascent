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
    title: 'Warden × Ancient of War: exactly the next Aegis grants Resilient Ward',
    statement:
      'After the Ancient of War is picked, the NEXT Aegis grants Resilient Ward instead of Ward (then the usual +5 Attack to '
      + 'every minion with Ward); every Aegis after it grants a plain Ward. The power text says so until it is used '
      + '(judgement call pending the owner: "your next" read as one Aegis).',
    domain: 'heroes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-26 (Warden Ancients)', quote: 'Your next Aegis grants Resilient Ward. It takes 2 hits to break.' },
      { kind: 'code', ref: 'packages/sim/src/ancients.ts nextAegisResilient / ancientAegisResilient (AncientsState.resilientAegisLeft)' },
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
];
