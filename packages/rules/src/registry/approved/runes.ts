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
  {
    id: 'R-RUNE-04',
    title: 'A rune is offered only in a run whose pinned set and rolled tribes fit it; a tribe tag alone keeps it out of a set that never fields that tribe',
    statement:
      'The Runeforge (`runeforgePool`) offers a rune only when BOTH gates pass: the rune\'s `sets` (absent = every '
      + 'set) includes the run\'s PINNED set, and the rune\'s `tribes` (absent = untagged) shares at least one tribe '
      + 'with the run\'s rolled `tribes`. A run rolls its tribes from its set\'s `SETS[set].tribes` roster only, so '
      + 'tagging a rune with a tribe a set does not field is a complete exclusion from that set — no `sets` edit '
      + 'needed. Rune of the Deathtouched Apple ("When a minion Rises, give it Rise") is tagged Undead (Rise is the '
      + 'Undead keyword): it can never appear in a Set 2 run (Set 2 fields no Undead) and still appears in a Set 1 or '
      + 'Set 3 run that rolled Undead. A tag is honest only when the text names the tribe or its keyword / content '
      + '(`tribeGate.test.ts` audits every tag; a keyword-only naming needs an owner ruling recorded there). '
      + 'Archiving is the other exclusion: an archived rune (`ARCHIVED_RUNES`) is in neither forge stock in ANY set '
      + 'but stays in `RUNE_INDEX`, so a saved run or replay that holds it keeps its badge, text and reward.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-23 (Balance 9/23, archives and Picnic)', quote: 'make deathtouched apple an undead rune, so it is not in set 2' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-23 (Balance 9/23, archives and Picnic)', quote: 'archive rune of emberline from all sets' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts runeforgePool (the `sets` + `tribes` filters); packages/content/src/sets.ts SETS[*].tribes + selectRunTribes; packages/content/src/runes.ts rune_deathtouched_apple tribes / ARCHIVED_RUNES / RUNE_INDEX' },
    ],
    contentIds: ['rune_deathtouched_apple'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then the Apple carried no tribe tag and was offered in every set, Set 2 '
      + 'included, where Rise has almost nothing to act on. Eleven runes were archived the same day (Emberline, '
      + 'Centerline, Cindergem, Second Litter, Spare Chair, Moonhowl, Taurus, Ashen Heir, Old Pack, Open Market, '
      + 'Warpath) — out of every forge, still resolvable by id.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/tribeGate.test.ts', 'packages/sim/src/set3RuneRoster.test.ts', 'packages/sim/src/runes.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-05',
    title: 'Rune of the Bubble Crown counts EVERY spell cast (Rubies, Gifts, Shop spells), not only Shop spells',
    statement:
      'Rune of the Bubble Crown ("When you cast N spells, your spells gain +6/+6. (Once)") advances on EVERY spell '
      + 'cast: a Shop spell, a Gift (a Clue included) and a Ruby each count once per cast, whether or not Rune of the '
      + 'Spellstone is held. It rides the `anySpell` threshold meter, which the every-spell chokepoint '
      + '(`noteSpellForCountRunes`) advances once per cast on both the Shop-spell path and the Ruby reducer branch; '
      + 'it is distinct from the `spellCast` meter, which only Shop-spell casts (and a Spellstone Ruby) advance and '
      + 'which Rune of Infernal Ink ("Whenever you cast a Shop Spell") still reads. The threshold is 9 (balance 9/23, '
      + 'was 12) and the rune pays once, then parks its x/9 counter at 9/9.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23, tranche 3 (rune costs and numbers), 2026-09-23', quote: 'Bubble Crown: 9 spells instead of 12. not shop spells, so rubies etc count' },
      { kind: 'code', ref: 'packages/content/src/runes.ts rune_bubble_crown (meter anySpell, per 9); packages/sim/src/recruit.ts noteSpellForCountRunes (the anySpell advance) / advanceRuneThresholds; packages/sim/src/reducer.ts the Ruby play branch (calls noteSpellForCountRunes once per cast)' },
    ],
    contentIds: ['rune_bubble_crown'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then the rune read the `spellCast` meter, which a Ruby only advanced through '
      + 'Rune of the Spellstone, so a Ruby-heavy run could cast a dozen Rubies and never move the Crown.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeBatchAug19.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  // ── Balance 9/23, tranche 5 — rune reworks, group B (summon / board / token runes; owner list 2026-09-23). ──
  {
    id: 'R-RUNE-06',
    title: 'Combat-summon rune triggers pay per summon, and their "permanently" carries back into the run',
    statement:
      'A rune whose text begins "When you summon a minion in combat" fires once per friendly body placed in combat '
      + '(a token, a Rise return and a resummon each count once, at the single summon chokepoint). Rune of Packcraft '
      + 'gives THAT body the current level (starting +2/+1) and then raises the level by the printed step; the grown '
      + 'level is written back to the run (`packcraftLevel`) so the next fight\'s first summon starts from it, and the '
      + 'rune badge prints the current grant. Rune of Reinvestment pulses on every friendly summon and pays the Shop '
      + '+3/+4 per summon (× copies held) ONCE at settle, on the permanent run-wide Shop channel. Rune of Beastial '
      + 'Swarm grows the BEAST AURA (the run-wide `beastBuyAtk` / `beastBuyHp` channel) by the current per-death amount '
      + 'on every friendly Beast death: living Beasts gain it on the spot, later Beast summons inherit it, and the '
      + 'player\'s gain carries back at settle; Avenge (2) still raises the per-death amount permanently. The enemy '
      + 'side runs its own copy off its snapshot and only accumulates.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23, tranche 5 (rune reworks B), owner list 2026-09-23', quote: 'Packcraft → "When you summon a minion in combat, give it +2/+1 and improve this permanently." Reinvestment → "When you summon a minion in combat, buff minions in the shop +3/+4 permanently." Bestial Swarm → "Give your Beast Aura +2/+2 when a friendly Beast dies. Avenge (2): improve this."' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts summonMinion (Packcraft level + Reinvestment pulse), the Beastial Swarm death block, carryBacksFor (packcraftLevel / beastBuyAtkGain); packages/sim/src/reducer.ts settle (packcraftLevel, grantTribeAura) + questCombatMods (packcraftLevel, runeReinvestment); packages/sim/src/state.ts PACKCRAFT_STEP / REINVESTMENT_PER_SUMMON; packages/ui/src/runeTally.ts' },
    ],
    contentIds: ['rune_packcraft', 'rune_reinvestment', 'rune_beastial_swarm'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then Packcraft was a flat +6/+6 on every combat summon, Reinvestment paid '
      + '+1/+1 per summon with one badge pulse at settle, and Beastial Swarm buffed the living Beasts for the fight '
      + 'only (nothing carried back but the Avenge level).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworksB0923.test.ts', 'packages/sim/src/runeBatch8.test.ts', 'packages/sim/src/beastBatchAug12.test.ts', 'packages/ui/src/tallyCoverage.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-07',
    title: 'Rune of Slaying banks kills across combats and pays every 5, with a live countdown',
    statement:
      'Rune of Slaying counts enemy kills (the Slaughter tally) across every combat of the run. Every '
      + 'SLAYING_KILLS (5) kills pays ONE minion of the board\'s most common type into hand at settle, the leftover '
      + 'kills carry to the next fight, and a fight that crosses the threshold twice pays twice. The badge prints the '
      + 'banked count as x/5 off the same constant the settle reads, so the number the player watches is the number '
      + 'the rune pays on.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23, tranche 5 (rune reworks B), owner list 2026-09-23', quote: 'Slaying → "when you kill 5 enemies get a minion of your most common type"' },
      { kind: 'code', ref: 'packages/sim/src/state.ts SLAYING_KILLS; packages/sim/src/reducer.ts settle (runeSlayingKills loop, grantTopTypeMinion); packages/ui/src/runeTally.ts rune_slaying' },
    ],
    contentIds: ['rune_slaying'],
    currentBehaviour: 'Conforms as of 2026-09-23. The threshold was 6 (owner change 2026-07-31) and lived as two separate literals, one in the settle and one in the badge.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworksB0923.test.ts', 'packages/sim/src/runes.test.ts', 'packages/ui/src/tallyCoverage.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-08',
    title: '"Get X. Repeat at Start of Turn" runes pay one copy on purchase and one more at every turn setup',
    statement:
      'A rune printed "Get X. Repeat at Start of Turn" hands over X the moment it is bought (the Runeforge opens '
      + 'partway through a shop turn, after that turn\'s setup has run) and then one more X at every turn setup for '
      + 'the rest of the run, one per copy held. Full Measure (Baby Gastrid), Open Appetite (Appetite Agent), the '
      + 'Unbroken Vein (Veinbreaker), the Display Case (Market Tormentor) and the Deep (a random Tier 7 minion) all '
      + 'follow it, each keeping its second half (the Attack grant, the any-type aim, both Choose One effects, the '
      + 'left-most Shop enchant). The Muckbroker\'s "Get a Muckslinger. Repeat every 2 turns" is the same shape on '
      + 'the 2-turn cadence: one now, then one every second turn setup. Rune of Copies copies at that same turn setup '
      + 'and is printed "Start of Turn".',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23, tranche 5 (rune reworks B), owner list 2026-09-23', quote: 'Full Measure → "Get a Baby Gastrid. Repeat at Start of Turn. Baby Gastrids also grant Attack this game." … Deep → "get a random T7 minion. Repeat at Start of Turn" … Muckbroker → "get a Muck Slinger. Repeat every 2 turns."' },
      { kind: 'code', ref: 'packages/content/src/runes.ts (the multi rewards: recurringGrant + the rune flag; the Muckbroker grant + everyTurns cadence); packages/sim/src/reducer.ts recurringGrant (immediate rune copy) / payDeep / the turn-setup grant loops' },
    ],
    contentIds: ['rune_full_measure', 'rune_open_appetite', 'rune_unbroken_vein', 'rune_display_case', 'rune_deep', 'rune_muckbroker', 'rune_copies'],
    currentBehaviour: 'Conforms as of 2026-09-23. Until then the four card-keyed runes granted their minion ONCE, the Deep paid nothing until the next turn, and the Muckbroker paid nothing for two turns.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworksB0923.test.ts', 'packages/sim/src/runeBatchAug20.test.ts', 'packages/sim/src/runeCardKeyed.test.ts', 'packages/sim/src/runeCardKeyed2.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-09',
    title: 'Rune reworks B: the board and token runes (Five Banners, Living Treasure, Gem Golem, Food Chain, Banquet Hall, Lassoing, Finality, Hatchery)',
    statement:
      'Rune of the Five Banners is an END OF TURN grant: one friendly minion of each type gains +5/+4 (universal-'
      + 'tribe bodies always collect; every other body claims the first type nobody has claimed), once per copy held; '
      + 'its old Start-of-Combat flag is no longer authored but still resolves for pinned replays. Rune of Living '
      + 'Treasure gives every friendly Gemheart Golem REBIRTH (at the bell for the ones on board, at the summon for the '
      + 'ones that land mid-fight), so a grown Golem returns once with its full body. Rune of the Gem Golem summons a '
      + 'real Gemheart Golem (its printed 1/1) carrying the dying Kobold\'s Rubies on top, with or without Rubies, and '
      + 'a dying Golem itself never chains another. Rune of the Food Chain reads the left-most LIVING Demon\'s current '
      + 'stats when the side\'s first summon lands (no Start-of-Combat capture, so it left the Start-of-Combat rune '
      + 'pass). Rune of the Banquet Hall: the turn\'s first buy, Shop-buffed or not, hands its current stats in full to 2 '
      + 'random other friendly board minions, once per turn. Rune of Lassoing hands over a Rope Wrangler and gives '
      + 'your minions +2/+2 whenever Lasso is cast in the shop by anyone. Rune of Finality summons 3 Warded Imps; Rune '
      + 'of the Hatchery gives combat summons +5/+5 and Taunt.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23, tranche 5 (rune reworks B), owner list 2026-09-23', quote: 'Five Banners → "End of Turn: give a minion of each type +5/+4" · Living Treasure → "Your Gemheart Golems gain Rebirth" · Gem Golem → "When a Kobold dies, summon a Gemheart Golem with its Rubies." · Food Chain → "the first minion you summon in combat gains the stats of your left-most Demon." · Banquet Hall → "the first minion you buy gives its stats to 2 random friendly minions." · Lassoing → "get a Rope Wrangler. When Lasso is cast, give your minions +2/+2." · Finality → "When your last minion dies, summon 3 Imps with Ward." · Hatchery → "minions summoned in combat have +5/+5 and Taunt."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts bannerRecipientsOf / FIVE_BANNERS_GRANT / recurringEotEffects / runRecurringEndOfTurn / applyOnBuy (Banquet Hall) / castSpell (Lassoing); packages/core/src/combat/simulate.ts summonMinion (Living Treasure RB, Food Chain read), the Living Treasure Start-of-Combat grant, the Gem Golem death block; packages/sim/src/reducer.ts questCombatMods (Hatchery +5/+5)' },
    ],
    contentIds: ['rune_five_banners', 'rune_living_treasure', 'rune_gem_golem', 'rune_food_chain', 'rune_banquet_hall', 'rune_lassoing', 'rune_finality', 'rune_hatchery'],
    currentBehaviour: 'Conforms as of 2026-09-23. Before: Five Banners was a Start-of-Combat +6/+6 flag; Living Treasure grafted an exact-copy Echo; the Gem Golem summoned a bare token with stats EQUAL to the Rubies, or nothing; the Food Chain captured the Demon at Start of Combat; the Banquet Hall dispersed the first Shop-buffed buy\'s bonus among one minion of each type; Lassoing cast Lasso at End of Turn; Finality summoned 7; the Hatchery gave +3/+3.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworksB0923.test.ts', 'packages/sim/src/runeDupStacking.test.ts', 'packages/sim/src/runeBatch7.test.ts', 'packages/sim/src/runeBatch11.test.ts', 'packages/sim/src/runeBatch4T4.test.ts', 'packages/sim/src/runeDuplication.test.ts', 'packages/sim/src/heroBatchAug22.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
];
