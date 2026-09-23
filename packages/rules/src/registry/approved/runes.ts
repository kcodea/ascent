/**
 * APPROVED RULES — domain `runes`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const RUNES_RULES: GameRule[] = [

  // ── Triage round 2 (2026-08-27): the STANDING rules the owner's 24 rulings established. ──────────────
  // Rune-duplicate family rules R-RUNEDUP-01..08 (decisions.json q-runedup-*; implementation rides
  // feat/rune-duplicate-stacking, pinned by the runeSwallowScan lane), the two order rules, the
  // non-stacking best-of rule, and the per-phase Shout-charge rule.
  {
    id: 'R-RUNEDUP-01',
    title: 'Rune duplicates: recurring & per-event runes stack',
    statement:
      'A second copy of a recurring or per-event rune makes the effect fire once more each time it recurs: '
      + 'two Rune of the Coffers = +2 max Gold at End of Turn; two Rune of the Flagship = Dwarves get +4/+4 '
      + 'per Shop spell. Each additional copy adds one more fire per recurrence.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-recurring (triage round 2, 2026-08-27)', quote: 'APPROVE — second copy doubles the recurrence.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27, feat/rune-duplicate-stacking): a second copy adds one more fire per recurrence; the runeSwallowScan surface re-alarms if a duplicate ever swallows again.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-02',
    title: 'Rune duplicates: threshold runes double the payoff, not the meter',
    statement:
      'A second copy of a threshold/meter rune doubles the OUTPUT paid when the threshold is reached — the '
      + 'threshold itself is unchanged: two Rune of the Returning Pack = every 6 Beast summons yields 2 '
      + 'random Beasts. (Not parallel meters, and never a naive threshold sum.)',
    domain: 'runes',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-runedup-threshold (triage round 2, 2026-08-27)',
      quote: 'A second copy copy should double the output. i.e. 2 rune of the returning pack, every 6 beast summons you\'d get 2 random beasts, etc.',
    }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27, feat/rune-duplicate-stacking); pinned by the runeSwallowScan surface.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-03',
    title: 'Rune duplicates: repeat runes gain +1 repetition per copy',
    statement:
      'Each copy of a repeat rune (extra Shout/Rally/Echo/spell/hero-power/Improve/Triple-Reward fires) adds '
      + 'one more repetition: two Rune of the Wishbone = the hero power fires 3 times; two Rune of '
      + 'Adventuring = Rallies trigger 3 times. Rides the existing extraTriggerFires / per-family folds.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-repeat (triage round 2, 2026-08-27)', quote: 'APPROVE — +1 repetition per copy for the whole repeat family.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27, feat/rune-duplicate-stacking); pinned by the runeSwallowScan surface.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-04',
    title: 'Rune duplicates: one-shots re-grant, banking when immediate value is impossible',
    statement:
      'A duplicate one-shot rune fires its reward again immediately; when the immediate re-fire would still '
      + 'give no value, the effect banks and fires next turn (a second Rune of the Armory grants its 10 '
      + 'Attachments next turn — hand cap). Rune of the Muster with 2 copies covers the first 2 refreshes '
      + 'that turn. Rune of the Ornate Clock is unique — a duplicate does nothing. Rune of Held Strength is '
      + 'to be redesigned from a one-shot into a "Start of Combat: give xyz" rune.',
    domain: 'runes',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-runedup-oneshot (triage round 2, 2026-08-27)',
      quote: 'this should re-fire the one-shot reward again, but in the case where they would still get no value if done immediately, it should stack the effect for next turn. … rune of the ornate clock should do nothing if duplicated, that one is unique. rune of the held strength should not be a one-shot rune and should be a "Start of Combat: give xyz" rune so fix that too.',
    }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): one-shots re-grant or bank, Ornate Clock stays unique, and Rune of Held Strength is now a Start-of-Combat grant (the left and right-most minions gain the stats of the left-most card held in hand when the combat was built).',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-05',
    title: 'Rune duplicates: repeatable boolean combat flags fire once per copy',
    statement:
      'Every boolean combat flag whose effect can meaningfully repeat fires once per copy — flagCopies '
      + 'becomes live for the whole family, exactly as the rune-granted Avenge dispatchers already consume '
      + 'it (two Rune of Rallying = the left-most Rally triggers twice at Start of Combat). A flag that '
      + 'genuinely cannot repeat falls back to the universal sweetener (R-RUNEDUP-06).',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-boolean-flags (triage round 2, 2026-08-27)', quote: 'APPROVE — fire-once-per-copy for repeatable boolean flags, sweetener for the true one-offs.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): `flagCopiesOf` is consulted by every repeatable boolean flag (Rune of Warding triples once per copy, Rune of Rallying fires the left-most Rally once per copy, …).',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-06',
    title: 'Rune duplicates: the universal sweetener floor',
    statement:
      'A duplicate rune purchase is NEVER a dead buy. Any duplicate that cannot meaningfully stack instead '
      + 'grants an immediate consolation: Gold equal to half the rune\'s cost rounded up, plus a free Shop '
      + 'refresh. This is the fallback for every non-stacking duplicate, including via Rune of Duplication.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-sweetener-floor (triage round 2, 2026-08-27)', quote: 'APPROVE — half cost rounded up in Gold + a free refresh.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): the reducer pays half the cost rounded up in Gold plus a free refresh for every non-stacking duplicate.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-07',
    title: 'Rune duplicates: the forge filter',
    statement:
      'The Runeforge stops offering a rune the player already owns when its duplicate would only pay the '
      + 'sweetener (no real stacking behaviour). Runes whose duplicates stack (R-RUNEDUP-01..05, 08) stay '
      + 'offerable. Rune of Duplication still reaches everything; the sweetener backstops that path.',
    domain: 'runes',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-runedup-forge-filter (triage round 2, 2026-08-27)', quote: 'APPROVE — filter non-stacking owned runes out of forge offers; ship with the sweetener.' }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27): the forge filters owned sweetener-only runes out of its offers.',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNEDUP-08',
    title: 'Rune duplicates: unique engines double their output where possible',
    statement:
      'Duplicates of bespoke-engine runes double the effect when a doubling reading exists: two Rune of '
      + 'Structure = 2 random Shop spells per trigger; two Rune of Summoning = Imps get +4/+4; two Rune of '
      + 'Contraband = double the Ale/Ruby output per trigger. Engines with no sensible doubling fall back '
      + 'to the universal sweetener (R-RUNEDUP-06).',
    domain: 'runes',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-runedup-unique-engines (triage round 2, 2026-08-27)',
      quote: 'generally, try and double the effect when possible. rune of structure = you get 2 random shop spells. rune of summoning = your imps get +4/+4, rune of contraband doubles the output of the ale/ruby per trigger etc.',
    }],
    currentBehaviour: 'Conforms — shipped in #1264 (2026-08-27); the doubled Rune of Summoning step is also why #1285 fixed the SINGLE copy to its printed +2/+2 (R-RUNE-SUM-01).',
    enforcement: { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-RUNE-SUM-01',
    title: 'Rune of Summoning pays the +2/+2 it prints — the text is the contract',
    statement:
      'When a rune\'s printed step and its factory disagree, the PRINTED step is the contract: Rune of Summoning '
      + 'improves your Imps by +2/+2 per spell cast (the factory paid +1/+1). Rune of Mastery and a second copy '
      + 'multiply that step (+4/+4), which is how the owner\'s duplicate ruling fixed which side was right.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'decisions.json q-runedup-unique-engines (2026-08-27)', quote: 'rune of summoning = your imps get +4/+4' },
      { kind: 'fix-pr', ref: '#1285 (2026-08-28) — the text oracle surfaced the drift' },
    ],
    contentIds: ['rune_summoning'],
    currentBehaviour: 'Conforms — #1285: the step is a named constant read by the single copy, Mastery and extra copies.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/runes.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-RUNE-01',
    title: 'Rune of the Ornate Clock pays its printed 2 Gold on resolve, exactly once',
    statement:
      'A `scheduleRuneforge` reward that carries `gold` pays it when the reward RESOLVES on the Epic branch: '
      + 'Rune of the Ornate Clock ("Gain 2 Gold. Visit the Epic Runeforge next turn instead of turn 9") adds 2 Gold '
      + 'to the run the moment it is bought, arms one deferred Epic forge for the next turn and stands the turn-9 '
      + 'visit down. The Gold is paid once: nothing is banked for the turn the forge opens, and a duplicate Clock '
      + '(a ruled-unique rune) pays nothing. The Basic branch (The Runeforge quest) keeps paying its Gold on the turn '
      + 'its forge opens. The printed number and the reward\'s `gold` agree.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Runeforge batch)', quote: 'fix rune of ornate clock' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts applyQuestRewardInner case scheduleRuneforge (the Epic branch pays `r.gold` via gainGold); packages/content/src/runes.ts rune_ornate_clock; packages/sim/src/docbot/textOracleEconomy.ts runeEconomySubjects (the Epic-branch Gold is an immediate leaf)' },
    ],
    contentIds: ['rune_ornate_clock'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then the reward carried `gold: 2` but only the Basic branch of '
      + '`scheduleRuneforge` ever read it, so the Clock moved the forge and never paid; the text oracle had the rune '
      + 'pinned OUT of its economy check for that reason. The reducer now pays on resolve, the oracle reads the '
      + 'Epic-branch Gold as an immediate promise and the Clock is back inside the reconciliation.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeforgeClockEpicBoardfit.test.ts', 'packages/sim/src/docbot/textOracleEconomy.test.ts', 'packages/sim/src/ownerBugs0826.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-02',
    title: 'Two Epic forges booked for one turn are both opened, never dropped',
    statement:
      'Epic Runeforge bookings are COUNTED, not flagged. `epicForgeWave` names the turn and `epicForgeCount` how '
      + 'many forges are booked for it; `pendingEpicRuneforge` is the number waiting to open. A Guardian (Runeguard, '
      + 'turn 8 booked at run creation) who buys Rune of the Epic Forge (turn 8) gets TWO Epic forges on turn 8, '
      + 'opened one after the other: the second opens the moment the first is bought or skipped, on the same turn, '
      + 'ahead of the Basic forge and any Discover in the start-of-turn order (power pick, Epic forges, Basic forge, '
      + 'Discovers). Each forge draws its own offer from its own seeded stream (run seed, turn, and the forge\'s '
      + 'index on that turn) and prefers runes the earlier forge did not show, so the two offers differ and a replay '
      + 'reproduces both. A non-Guardian holding the rune gets one forge on turn 8. The universal turn-9 Epic forge, '
      + 'the Runesmith\'s turn 5 and the universal turn-6 Basic forge are unchanged, and the Ornate Clock still '
      + 'moves rather than adds. A save taken while the first forge is open restores with the second still pending; '
      + 'a save written before the count existed reads its boolean as one forge.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Runeforge batch, Guardian + Rune of the Epic Forge)', quote: 'can we just book 2 runeforges here' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts bookEpicForge / pendingEpicForges / openEpicRuneforge (per-index stream + avoid set) / openNextStartOfTurnModal (one Epic forge per pass) / advanceCombat (the booked count becomes pending); packages/sim/src/state.ts epicForgeCount, epicForgesOpened, pendingEpicRuneforge' },
    ],
    contentIds: ['rune_epic_forge'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then `pendingEpicRuneforge` was a boolean and `epicForgeWave` a single '
      + 'slot: the rune bought by a Guardian found turn 8 taken and slid to a deferred next-turn forge (audit find '
      + '2026-08-06), and any two arms on one turn collapsed into one forge. Open edge, unchanged in kind from '
      + 'before: an ADOPTED Guardian power (Void, Power Shifter) books a forge each time it is adopted; the old '
      + '`!epicForgeWave` guard only suppressed a re-adoption while a booking was still ahead.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeforgeClockEpicBoardfit.test.ts', 'packages/sim/src/runes.test.ts', 'packages/sim/src/docbot/heroPowerStagers.test.ts', 'packages/sim/src/heroBatchAug22.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-03',
    title: 'A tribe rune fits the board at 2 of the tribe (Basic forge) or 3 (Epic forge); All types count as one of every tribe',
    statement:
      'A rune whose text names a TRIBE "fits the board" only when the 7 board slots hold at least '
      + 'BASIC_FORGE_TRIBE_FIT (2) minions of that tribe at a Basic forge and at least EPIC_FORGE_TRIBE_FIT (3) at an '
      + 'Epic forge. The hand does not count. A minion that counts as every tribe (`universalTribe`, or the '
      + 'per-instance `allTribes` flag) counts as ONE toward EVERY tribe; a dual-tribe minion counts once for each '
      + 'of its tribes. This one threshold drives BOTH halves of the forge: the guarantee (one offered slot follows '
      + 'the board when any following rune exists) and the pivot discount (40%, Basic 1-2 / Epic 2-4 Gold, only on '
      + 'runes that do NOT fit). Mechanic tags (Rally, Echo, Shout, Avenge, Consume, Ruby, Ale, spells, Gold, '
      + 'summon) remain PRESENCE tags: one card carrying the mechanic is enough.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Runeforge batch, the board-fit rule)', quote: 'what is the logic for a rune that \'fits the board\' though? for basic, it should be at least 2 of a tribe type, and for epic it should be at least 3 of a tribe type. make sure all types count as 1 of everything.' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts BASIC_FORGE_TRIBE_FIT / EPIC_FORGE_TRIBE_FIT / boardTribeCounts / boardSynergyTags / drawRuneOffer; packages/content/src/runeSynergy.ts (the rune-side tags); packages/sim/src/recruit.ts isTribe' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then one minion of a tribe tagged the board with that tribe at either '
      + 'forge, so a single stray Beast made every Beast rune "follow the board" and shielded it from the pivot '
      + 'discount. Deferred by the owner ("thats fine for now, but flag it for when set 3 is live"): Spirit / '
      + 'Celestial / Starform / Reveler are not yet rune-side keywords, so a Set 3 rune draws the pivot discount '
      + 'against a Set 3 board until they are added (roadmap, Rune build-out).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeforgeClockEpicBoardfit.test.ts', 'packages/sim/src/runes.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
];
