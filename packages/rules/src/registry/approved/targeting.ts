/**
 * APPROVED RULES — domain `targeting`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const TARGETING_RULES: GameRule[] = [
  {
    id: 'R-TARGET-01',
    title: '"A random friendly <tribe>" includes the source — a lone Gangplank buffs itself',
    statement:
      'An effect that gives "a random friendly Dwarf" (or any random friendly member of a type) picks from EVERY '
      + 'living friendly minion of that type, the source included. Gangplank standing alone as the only Dwarf '
      + 'gains its own +1/+2 on every card added to hand. Excluding the source needs the word "another" in the '
      + 'printed text; without it, "friendly" means the whole side.',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'decisions.json q-gangplank-self-buff (Rulebook board, 2026-09-09)', quote: 'APPROVE — keep as printed: it may buff itself.' },
      { kind: 'owner-chat', ref: 'Bug Board 38d186a6 (round 2, 2026-09-09) — the report that raised it', quote: 'gangplank can buff itsself if its the only dwarf on board' },
    ],
    cardText: 'When a card is added to your hand, give a **random** friendly **Dwarf +1/+2**.',
    contentIds: ['dw_gangplank'],
    currentBehaviour:
      'Conforms: `onGainCardBuffTribe` (arena.ts) picks from every living friendly body of the tribe via the shared '
      + 'tribe predicate, the source among them. Pinned by the lone-Gangplank case in handGainInCombat.test.ts '
      + '("Gangplank is the only one here, so it is its own recipient").',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/handGainInCombat.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-TARGET-02',
    title: '"other" / "another" excludes only this body; "different" excludes every copy of the same-named card',
    statement:
      'When an effect\'s printed text says "other" or "another", the source INSTANCE is ineligible and nothing else '
      + 'is — a same-named copy is a legal target (exclude by uid). When it says "different", NO copy of the '
      + 'same-named card is eligible, the source included (exclude by card identity). Lieutenant Thane\'s Rally and '
      + 'Menagerie Mammoth\'s Echo are "different"; Hank Pepe, Hoard Cleric, Better Bot, the Chef and the Chipper '
      + 'Sticker are "other". A Discover triggered by playing a card never offers that card itself, and needs no '
      + 'qualifier for it — "Discover" carries the exclusion on its own.',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (vocabulary ruling)', quote: 'other/another means that that same named card can be targeted, but the effect cannot target the card itself. different means that the effect cannot target any copy of the same named card.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (the calls)', quote: 'thane should say different. menagerie mammoth should say different. the sea urchin/joker etc is slightly different. discovers shouldnt offer themselves as options and dont need the different terminology as of now.' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts (friends() + uid filters; rallyGiveAttackToOthers excludeId); packages/core/src/effects/factories.ts deathrattleSummonRandomTribe (excludeSelf = card identity); packages/sim/src/recruit.ts battlecryDiscoverMinion (exclude: self.cardId)' },
    ],
    contentIds: ['dw_thane', 'b2_mammoth', 'dw3_hankpepe', 'seaurchin'],
    currentBehaviour:
      'Conforms — 2026-09-10: the audit found every "other"/"another" text excluding by uid (19 of 21) and two '
      + 'excluding by card identity (Thane, Mammoth); those two texts now print "different". The Discover-on-play '
      + 'family (Sea Urchin, Joker, Wayfinder, Clockwork, Jeweler, Cage Breaker) excludes its own card without a '
      + 'printed qualifier, by ruling. Note `excludeSelf` means uid in onSpellCastBuffRandomTribe and card identity '
      + 'in deathrattleSummonRandomTribe — the pinning test names both so the overload cannot drift silently.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/targetVocabulary.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-TARGET-03',
    title: 'No card targets itself — every CHOSEN friendly recipient excludes the source',
    statement:
      'Wherever a card\'s effect CHOOSES a friendly minion — an aimed Shout, an aimed Equipment (its granting body), '
      + 'a random-friendly picker, a minion-cast targeted spell, an un-aimed re-fire\'s auto-pick — the source is '
      + 'never in the pool, whether or not the text prints "other". No fallback to self: with no other eligible body '
      + 'the effect finds no recipient and does nothing (an aimed Shout alone on the board plays as a plain body and '
      + 'is never prompted to aim). Positional and identity reads are NOT choices and keep their membership: '
      + '"adjacent", "left-most / right-most", "on this", "your minions", and Paragon\'s "a minion of every type" '
      + '(which it is — the owner\'s worked example has it collecting its own payout).' 
      + 'OWNER EXEMPTION (2026-09-18): an Equipment definition may opt out with `mayTargetSelf` — Bloodpot is '
      + 'usable on Alchemist Frank himself.',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner handoff, 2026-09-18 (Cage Breaker / EMS, then made global)', quote: 'no card should be able to target itself' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts othersOnBoard; packages/core/src/effects/factories.ts otherFriends; packages/core/src/effects/arena.ts others; packages/sim/src/reducer.ts (battlecryTarget refuses target.uid === card.uid; activateEquipment refuses granted.sourceUids); productionBots/visibleState.ts + legalActions.ts mirror both' },
    ],
    contentIds: ['u3_cagebreaker', 'u3_ems', 'dw_runemaster', 'gravetwin', 'e3_frank', 'e3_sculptor', 'dw_gangplank', 'dw_oaf', 'dw_billings', 'k_candleconduit', 'monk', 'd2_broodwhelp', 'dw_dorrin', 'dm_agent', 'b2_magepup', 'beetle', 'squirlscout', 'c3_familiar', 'runesnout_archivist'],
    currentBehaviour:
      'Conforms — 2026-09-18: every aimed Shout and aimed Equipment refuses a self-target in the reducer (the aim UI '
      + 'and the bot view mirror it); the three phase helpers carry the rule for random pickers and minion-cast spells; '
      + 'the old "fall back to self" auto-picks (battlecryBuffTarget, battlecryGrantKeyword, Baby Gastrid, Appetite '
      + 'Agent) are gone. Behaviour changed for: Bloodpot / Titan Hammer (never the granter), Auric Runemaster, '
      + 'Gravetwin, Gangplank, Drunken Oaf, Billings, Candle Conduit, Flowing Monk, Runekeg (excludeSelf implied), '
      + 'Squirl Scout, Orbiting Familiar, Runic Archivist, Runesnout Archivist, Mage-Pup, Runic Beetle, Brood Whelp / '
      + 'Twilight Emissary re-fires, Rot Weaver, Spell Drummer, named-spell casters with an aimed spell.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/noSelfTarget.test.ts', 'packages/sim/src/reworks0918.test.ts'], lastVerifiedAt: '2026-09-18' },
  },
  {
    id: 'R-TARGET-04',
    title: 'A bot aims only where the engine will accept — a refused aim is never a stall',
    statement:
      'Every automated player (the greedy DEFAULT_BOT, the balance pilots, the production bots) chooses an aimed '
      + 'Shout\'s target from the SAME pool the reducer enforces — never the aiming body (R-TARGET-03), never an '
      + 'off-tribe body for a `targetTribe` Shout — by probing the reducer (or a mirror of its guards) before it '
      + 'commits. When nothing on the board, in the shop or in hand is aimable it cancels the prompt like a '
      + 'click-away. It never returns an aim the reducer will refuse: a refused action returns the same state, and '
      + 'every lobby / replay / balance play-out loop reads "same state" as a stalled seat and stops, so a bad aim '
      + 'is a lobby that never finishes, not a wasted Shout.',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'docbot-scan', ref: 'Balance 9/23 tranche 1 (2026-09-23): the seed-4 drakko lobby stalled at round 15 — a 2/3 Beggy out-scored every Demon, the greedy bot aimed Appetite Agent (targetTribe demon) at it, the reducer refused, playOut broke on next === s' },
      { kind: 'code', ref: 'packages/sim/src/bots/policy.ts (pendingTarget branch probes reduce() per candidate, falls back shop → hand → cancelChoice); packages/sim/src/balance/pilots.ts (the same legal() probe)' },
      { kind: 'test', ref: 'packages/sim/src/bots/bots.test.ts "bot aim — the greedy bot only aims where the engine will accept"' },
    ],
    contentIds: ['dm_agent'],
    currentBehaviour:
      'Conforms — 2026-09-23: the greedy bot skips its own body and any candidate the reducer refuses, prefers the '
      + 'highest-scored legal board body, then a shop or hand target, then cancels. The pilots already probed the '
      + 'reducer; the production bots mirror the guards in visibleState / legalActions. No owner ruling was needed: '
      + 'the rule restates R-TARGET-03 and the tribe guard from the automated player\'s side.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/bots/bots.test.ts', 'packages/sim/src/lobby/runLobby.test.ts'], lastVerifiedAt: '2026-09-23' },
  },
  {
    id: 'R-TARGET-05',
    title: 'A Choose One minion holds its board slot through the aim step, and only a cancel sends it home',
    statement:
      'A Choose One minion dropped on the board stands in the slot it was dropped on for the WHOLE unresolved play: '
      + 'the Choose One prompt AND, when the picked branch needs a target, the aim step that follows. The aim line '
      + 'starts from that board slot. It returns to the hand only when the player cancels (at either step); once the '
      + 'target is picked the play commits into that same slot. Presentation only: the reducer still commits nothing '
      + 'until the branch and target are settled (the card stays in `run.hand`, its slot on `pendingTarget.toIndex`), '
      + 'so a cancel stays a pure no-op (no Gold, no counters, no RNG).',
    domain: 'targeting',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report, 2026-09-25 (Runic Beetle)', quote: 'the card should stay on board like it is during the choose animation for that targeting animation, too' },
      { kind: 'code', ref: 'packages/ui/src/chooseOneHold.ts chooseOneHeldSlot (reads run.chooseOne OR a deferred run.pendingTarget); packages/ui/src/Recruit.tsx chooseOnePreview / chooseOnePreviewUid / captureCoalesce' },
    ],
    contentIds: ['beetle', 'godfodder'],
    currentBehaviour:
      'Conforms — 2026-09-25: the board preview and the hand-row hide read one gate that covers both open steps. '
      + 'Before, the preview read only `run.chooseOne`, so picking a targeted branch dropped it and the card jumped '
      + 'back into the hand with the aim beam starting there.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/chooseOneHold.test.ts'], lastVerifiedAt: '2026-09-25' },
  },
];
