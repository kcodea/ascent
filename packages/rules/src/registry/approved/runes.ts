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
      + 'Set 3 run that rolled Undead. Rune of Hoardcalling ("get a Hoardflame or Dragonflame") is tagged Dragon by '
      + 'owner ruling (its rewards are Dragon spells): it is offered only in a run that rolled Dragons, never in Set 3. '
      + 'A tag is honest only when the text names the tribe or its keyword / content '
      + '(`tribeGate.test.ts` audits every tag; a keyword-only naming needs an owner ruling recorded there). '
      + 'Archiving is the other exclusion: an archived rune (`ARCHIVED_RUNES`) is in neither forge stock in ANY set '
      + 'but stays in `RUNE_INDEX`, so a saved run or replay that holds it keeps its badge, text and reward.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-23 (Balance 9/23, archives and Picnic)', quote: 'make deathtouched apple an undead rune, so it is not in set 2' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-23 (Balance 9/23, archives and Picnic)', quote: 'archive rune of emberline from all sets' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (Hoardcalling tag)', quote: 'hoardcalling should have a dragon tag' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts runeforgePool (the `sets` + `tribes` filters); packages/content/src/sets.ts SETS[*].tribes + selectRunTribes; packages/content/src/runes.ts rune_deathtouched_apple + rune_hoardcalling tribes / ARCHIVED_RUNES / RUNE_INDEX' },
    ],
    contentIds: ['rune_deathtouched_apple', 'rune_hoardcalling'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then the Apple carried no tribe tag and was offered in every set, Set 2 '
      + 'included, where Rise has almost nothing to act on. Eleven runes were archived the same day (Emberline, '
      + 'Centerline, Cindergem, Second Litter, Spare Chair, Moonhowl, Taurus, Ashen Heir, Old Pack, Open Market, '
      + 'Warpath) — out of every forge, still resolvable by id. Hoardcalling lost its Dragon tag in the 2026-09-23 '
      + 'rework (#1669) and got it back 2026-09-24.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/tribeGate.test.ts', 'packages/sim/src/set3RuneRoster.test.ts', 'packages/sim/src/runes.test.ts'],
      lastVerifiedAt: '2026-09-24',
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
  {
    id: 'R-RUNE-10',
    title: 'A "when you trigger N Shouts" rune meter is ONE counter across shop and combat',
    statement:
      'A rune whose payout is metered on Shouts triggered (Rune of the Chorus: 3 Shouts, a random Shop spell; Rune of '
      + 'Hoardcalling: 3 Shouts, a Hoardflame or a Dragonflame) keeps ONE tick across both halves of the turn. Shop Shout '
      + 'FIRES advance it at the reducer boundary; the fight receives the meter with its shop tick (`QuestCombatMods.shoutMeters`), '
      + 'every combat Shout fire (`battlecryTriggered`: re-fires, parting cries, Drakko repeats, Start-of-Combat Shouts included) '
      + 'advances the same tick, a trip pays at once through `playerHandGrants` (a random Shop spell from the run pool at or '
      + 'below the shop tier, never an Ale, or one of the named cards) and flies to hand in the replay, and the final tick is '
      + 'written back at settle so the next shop keeps counting from it. The settle also feeds every other Shout tracker with '
      + 'the combat count: the Shout quest objectives, Bane\'s Presence and the Author\'s Hand Shout half. A meter whose payout '
      + 'only a shop can deliver (the Merchant\'s Chorus\' this-turn Shop buff) stays a shop meter.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Balance batch 9/23, tranche 4 (rune reworks A)', quote: 'make sure this (and all trackers like this) work in combat too and carries count through both' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts (the battlecryTriggered subscription: shoutFires / shoutMeters, carried as playerShoutFires / playerShoutMeters); packages/sim/src/reducer.ts shoutMetersFor / questCombatMods / settleCombat (the write-back + the tracker feeds); packages/content/src/runes.ts rune_chorus, rune_hoardcalling' },
    ],
    contentIds: ['rune_chorus', 'rune_hoardcalling'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then the shout meter was shop-only: a combat Shout advanced nothing, and Hoardcalling was a per-turn first-Dragon-Shout freebie rather than a meter at all.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0923A.test.ts', 'packages/sim/src/docbot/combatModLane.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-11',
    title: 'Rune of Lorekeeping pays on EVERY targeted cast on a friendly minion',
    statement:
      'Rune of Lorekeeping ("When you cast a spell on a minion, give it an additional +3/+3") pays +3/+3 (per copy held) '
      + 'to the friendly minion a spell is cast ON, whatever the spell is: a Shop spell, a Gift (a Clue, a Tower Shield) or a '
      + 'Ruby, including a Ruby that lands through Redirection, Distillation, Motherlode or the Lapidary. One site pays it '
      + '(`applyLorekeeping`), called from the Shop-spell cast, the Gift play and the Ruby landing (`fireOnRubyPlayed`). It pays '
      + 'per resolved cast, so a doubled cast pays twice. An untargeted spell, a spell cast on a Shop offer, and a Candle '
      + 'Conduit / Resonance stat BOUNCE (stats only, never a cast) pay nothing.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Balance batch 9/23, tranche 4 (rune reworks A)', quote: 'works with all spells, rubies, clues etc' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts applyLorekeeping / castSpell / fireOnRubyPlayed; packages/sim/src/reducer.ts (the Gift play branch)' },
    ],
    contentIds: ['rune_lorekeeping'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then only a Shop spell paid (+4/+4), and a Ruby or a Clue on a minion paid nothing.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0923A.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-12',
    title: 'Rune of Distillation casts a Shop-minion spell on BOTH your edge minions',
    statement:
      'Rune of Distillation ("Targeted spells cast on Shop minions also cast on your left and right-most minion") gives a '
      + 'spell or Ruby cast on a Shop offer a real extra cast on your LEFT-most AND your RIGHT-most board minion (per copy '
      + 'held), the same `castSpell` / Ruby-landing path, so each target\'s own watchers and Rune of Lorekeeping see it. A '
      + 'one-minion board is both ends and takes ONE extra cast, never two; an empty board takes none. The offer still takes '
      + 'its own cast.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Balance batch 9/23, tranche 4 (rune reworks A)', quote: 'targeted spells cast on shop minions cast on your left and right-most minion too' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts distillationEdges; packages/sim/src/reducer.ts (the Shop-offer spell branch and the Ruby-on-offer branch)' },
    ],
    contentIds: ['rune_distillation'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then only the left-most minion took the extra cast.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0923A.test.ts', 'packages/sim/src/fourRunes.test.ts', 'packages/sim/src/bounceFx.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-13',
    title: 'A Spellstone Ruby fires every per-cast Shop-spell rune',
    statement:
      'With Rune of the Spellstone ("Rubies you cast count as Shop spells"), every resolved Ruby cast reaches the whole '
      + 'Shop-spell trigger surface: the cast counters and `spellCast` thresholds, the board\'s `spellCast` watchers, spell '
      + 'power on the Ruby\'s stats, the combat spell-cast trigger (Rune of Enchantment fires on a combat Ruby), AND the '
      + 'per-cast Shop-spell runes (Summoning, Might, Kindling, the Flagship, Scales), which live in ONE function '
      + '(`fireShopSpellCastRunes`) called by both the Shop-spell cast and the Spellstone Ruby count. Rune of the Runic Hoard '
      + 'fires on a Ruby with or without the Spellstone ("a spell").',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Balance batch 9/23, tranche 4 (rune reworks A)', quote: 'make sure that this works across all shop spell based triggers. this is important' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts fireShopSpellCastRunes / countRubyAsShopSpell / castSpell; packages/core/src/effects/factories.ts (spellstoneFor -> ctx.castSpell)' },
    ],
    contentIds: ['rune_spellstone'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Until then a Spellstone Ruby reached the counters and the board watchers but none of the per-cast runes (a Flagship / Kindling / Scales / Summoning / Might holder got nothing from a Ruby).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0923A.test.ts', 'packages/sim/src/spellstoneRubySynergy.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-14',
    title: 'Rune of Combat Prowess replays every rune / quest Start-of-Combat block, Held Strength included; Rune of Thrift discounts every stat granter',
    statement:
      'Every run-level Start-of-Combat block `simulate()` fires from a rune, quest or hero flag has an End-of-Turn shop '
      + 'replay under Rune of Combat Prowess (`socRuneReplaysOf`), or a documented combat-only reason (an enemy-facing or '
      + 'combat-bank effect: Weaken, the Food Chain, the Crucible, Empty Graves). Rune of Held Strength ("Start of Combat: give '
      + 'your left and right-most minions the stats of the left-most minion card in your hand") replays: the board\'s two ends '
      + 'gain the held card\'s live stats, permanently, per copy held; the card stays in hand; no held minion means nothing. '
      + 'Rune of Thrift discounts every Shop spell that grants stats in any way: the `spellBuff*` family plus the extras the '
      + 'empirical sweep found (Great Pot, Perfect Vision, Ruby Excavation, Ruby Transfer, Cupcakes).',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Balance batch 9/23, tranche 4 (rune reworks A)', quote: 'make sure this works with all runes/minions' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts socRuneReplaysOf (rune_held_strength) / STAT_SPELL_EXTRAS / isStatSpell; packages/core/src/combat/simulate.ts (the rmods.* Start-of-Combat section)' },
    ],
    contentIds: ['rune_combat_prowess', 'rune_held_strength', 'rune_thrift'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Held Strength was reworked into a Start-of-Combat grant on 2026-08-27, a week after the replay list was built, and never joined it; the five Thrift extras were undiscounted.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0923A.test.ts', 'packages/sim/src/runeThrift.test.ts', 'packages/sim/src/socDispatch.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-15',
    title: 'A "cast a random stat-granting spell" effect draws from ONE category that includes targeted spells, aimed at a random legal friendly minion',
    statement:
      'The stat-granting spell category (`isStatGrantingSpell`) is the one pool every "cast a random stat-granting '
      + 'Shop spell" effect reads (Rune of the Gilded Ledger). It holds every drawable Shop spell whose cast GIVES '
      + 'your minions stats IMMEDIATELY: board-wide buffs (Growth, Might of Aeon, Great Pot, Waking Rift, '
      + 'Dragonflame), TARGETED stat spells (Bulwark, Lantern Light, Crest of the Climb, Spirit Fire, Shatter, Patch '
      + 'Job, Front to Back, Hoardflame, Blessing, Flutter, Beefy) and the stat Ales (Champion\'s, Defensive, '
      + 'Bloody). A spell that redistributes, swaps or sets existing stats is a utility, not a grant, and is OUT: '
      + 'Common Ground (averaging), Turnabout, Perfect Vision. The shop-buff spells (Apples, Staff of Guel, '
      + 'Facetwright\'s Choice, Veinstorm, Picnic) are OUT pending an owner ruling; Rune of Thrift still discounts '
      + 'them and Common Ground. A targeted pick is cast through the shared '
      + 'no-aim cast (`castSpellWithoutAim`): a Choose One takes one seeded-random branch, and the spell lands on a '
      + 'seeded-random friendly minion the player\'s aim could have chosen (the spell\'s tribe restriction honoured, '
      + 'never a shop offer). With no legal target it FIZZLES: nothing '
      + 'resolves and no cast is counted. Every pick comes from the run cursor, so a replay repeats it.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-23 (Gilded Ledger at Tier 1 had nothing to cast)', quote: "no this is wrong and needs to fixed for all 'stat granting spells' texts etc. all targeted spells should be castable and fit this category, just with random targets chosen. the shop based ones i'm iffy on. but definitely targeted and board wide stat buff spells" },
      { kind: 'owner-chat', ref: 'PR #1670 review, 2026-09-23 (Common Ground out)', quote: "common ground should not be in the grouping, that's a combat related buff. it should only be stat granting spells that give stats immediately basically. i think common ground is the only one in the list that's wrong, that's more a utility thing." },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts isStatGrantingSpell / castSpellWithoutAim / pickRandomSpellTarget; payRuneThreshold castStatSpell' },
      { kind: 'test', ref: 'packages/sim/src/statSpellCategory.test.ts' },
    ],
    contentIds: ['rune_gilded_ledger'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Before, the Ledger filtered out every targeted spell and every Ale, so in Set 2 it '
      + 'could cast only Growth, Might of Aeon, Dragonflame and Waking Rift, and at Tier 1 it had nothing at all.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/statSpellCategory.test.ts', 'packages/sim/src/runeBatchAug20.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-RUNE-16',
    title: 'Rune of Spellhide\'s Start-of-Combat re-cast finds its Beast by the RUN uid (combat `sourceUid`), through the real pipeline',
    statement:
      'Rune of Spellhide ("The first stat-granting Shop spell you cast on a Beast each turn is cast on it again at Start '
      + 'of Combat") records `{ spellId, uid }` with the RUN board card\'s uid. Combat bodies get fresh uids (`m0`, `m1`, ...) '
      + 'and carry the run uid on `sourceUid`, so the Start-of-Combat re-cast matches the Beast by `sourceUid` (with the '
      + 'combat `uid` only as a fallback for a hand-built side). Through the reducer bridge (buy the rune, cast on a Beast, '
      + 'face the fight) the rune fires once and the recorded spell lands on that Beast again; only the turn\'s first such '
      + 'cast is recorded. Any lookup of a run-side uid carried into combat must go through `sourceUid`.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (Rune of Spellhide never finds its Beast)', quote: 'Fix Rune of Spellhide never finding its Beast in combat.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts (RUNE OF SPELLHIDE, the Start-of-Combat pass); packages/sim/src/recruit.ts spellhidePending; packages/sim/src/reducer.ts combat side `spellhide` + `sourceUid: b.uid`' },
      { kind: 'test', ref: 'packages/sim/src/spellhideCombatUid.test.ts' },
    ],
    contentIds: ['rune_spellhide'],
    currentBehaviour:
      'Conforms as of 2026-09-24. Before, the lookup matched the combat `uid` against the run uid, so through the real '
      + 'bridge the Beast was never found and the re-cast was silently skipped (the Doc Bot carry-over scan had flagged it '
      + 'needs-triage on 2026-08-26). The rune is archived (2026-08-12) and lives on only in saved runs that hold it.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/spellhideCombatUid.test.ts', 'packages/sim/src/docbot/carryOver.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-RUNE-17',
    title: 'Spare Forge / Runic Passage grant a random rune from the run\'s OWN pinned set only, never an archived rune',
    statement:
      'The hero-quest rune grant (`grantRune`: Spare Forge a Basic, Runic Passage an Epic) draws from the rarity\'s live '
      + 'pool (`RUNES` / `EPIC_RUNES`, so archived runes never come up) filtered to runes offered in the run\'s PINNED set: '
      + 'a rune with no `sets` field counts as every set, otherwise its `sets` must include `setIdOf(state)`. The set comes '
      + 'from the run\'s own `setId`, never the live `activeSet()`, so flipping the live set never changes an in-flight or '
      + 'replayed run. Owned runes are skipped, the draw uses the run\'s seeded RNG, and an empty pool is a no-op. The tribe '
      + 'gate the Runeforge applies is NOT applied here (the ruling names the set only).',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (owner rulings: Spare Forge drew from every set)', quote: 'limit to the runs own set only' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts applyQuestReward case \'grantRune\' (the `setIdOf` filter)' },
      { kind: 'test', ref: 'packages/sim/src/ownerRulings0924.test.ts' },
    ],
    contentIds: ['hq_spare_forge', 'hq_runic_passage'],
    currentBehaviour:
      'Conforms as of 2026-09-24. Before, the grant drew from the whole rarity list, so a Set 3 run could be handed a '
      + 'Set-2-only Ruby or Ale rune. The draw order is unchanged apart from the filter, so a same-seed grant can now land a '
      + 'different rune; a recorded run keeps the rune it was handed (`ownedRunes` is stored, replays never re-draw).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/ownerRulings0924.test.ts', 'packages/sim/src/heroQuests.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-RUNE-18',
    title: 'The Runeforge entrance waits for the return wipe, plays each sound cue once, and never hides a tablet or its cost coin',
    statement:
      'The Runeforge opening sequence (the tablets dropping in, dust, glow sweep, Epic flare) is presentation only and '
      + 'follows these rules. It never starts before the return-to-shop wipe has fully ended (the forge mounts only once '
      + 'the wipe is idle) plus the post-wipe pad set in the tuner. Nothing shows or sounds inside the pad. Its beats are timed '
      + 'from when the animations really start, so no cue runs ahead of the visuals. Each sound cue plays at most once per '
      + 'tablet per opening (the glow sweep sound once per forge by default), never looped. A re-render or a later '
      + 'remount never replays it. Every tablet in the offer (a real forge offers four) is clickable the moment it lands, '
      + 'and any press skips to the settled state. At rest the layout is identical to the plain forge. Each tablet, cost '
      + 'coin included, stacks above its left neighbour in every frame, and the Re-roll hover bubble draws above the tablets.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (Runeforge entrance, owner test in a real game)', quote: 'make sure the runeforge opening is delayed enough to not trigger until the player has fully come back from combat and the screen wipe has ended' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (Runeforge entrance)', quote: 'fix this so the coin never falls behind the frame thing here' },
      { kind: 'code', ref: 'packages/ui/src/runeforgeEntrance/entrance.ts (the clock + cue dedupe); RuneforgeDialog.tsx (the openings registry, `--rfe-z`); runeforgeEntrance.css' },
      { kind: 'test', ref: 'packages/ui/src/runeforgeEntrance/RuneforgeDialog.test.tsx' },
    ],
    contentIds: [],
    currentBehaviour:
      'Conforms as of 2026-09-24. The first cut started its timers before the first painted frame, so on a slow commit '
      + 'the landing thuds ran ahead of the tablets and bunched together. A remount mid-play also restarted the whole '
      + 'sequence and its sounds, and the cost coin of a dropping tablet could fall under the glow of its neighbour.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/runeforgeEntrance/RuneforgeDialog.test.tsx', 'packages/ui/src/runeforgeEntrance/runeforgeEntranceConfig.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-RUNE-19',
    title: 'Rune of Action is the REPEAT form: 3 random friendly minions +2/+2, once, then once more per card played, each its own tick',
    statement:
      'Rune of Action reads "End of Turn: give 3 random friendly minions +2/+2. Repeat for every card played this turn" and '
      + 'resolves by R-REPEAT-01: the base tick lands once, then once more for every card played this turn, 1 + count ticks, '
      + 'each its own state delta, root trigger and beat. Each tick picks 3 DISTINCT friendly minions at random, re-rolled '
      + 'per tick off the run cursor; with fewer than 3 on the board every one of them gets the tick. A turn with nothing '
      + 'played still pays the base once. The commit, the End-of-Turn projection and the beat list read one tick count '
      + '(`recurringTickCount`), and a replay of your recurring End-of-Turn effects runs every tick. The badge shows the '
      + 'live tick count (×N).',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune changes 2026-09-25 (Set 3 rune list)', quote: 'Rune of Action: "End of Turn: Give 3 random minions +2/+2. Repeat for every card played this turn."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts runRecurringEndOfTurn (runeAction) + recurringTickCount + the per-tick loops in applyEndOfTurn / projectEndOfTurnSteps / questEndOfTurnBeats; packages/ui/src/runeTally.ts' },
    ],
    contentIds: ['rune_action'],
    cardText: '**End of Turn:** give **3 random friendly minions +2/+2**. Repeat for every card played this turn.',
    currentBehaviour:
      'Conforms (built with the change, 2026-09-25). Before, the rune gave your three LEFT-MOST minions +1/+1 per card played, '
      + 'with no base tick, inside one End-of-Turn beat.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0925.test.ts', 'packages/sim/src/runes.test.ts', 'packages/ui/src/choreo/socEotTendrils.test.ts', 'packages/ui/src/tallyCoverage.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-20',
    title: 'Rune of Bulk Order pays 4 random friendly minions +4/+4 per 10 Gold spent, banking the remainder across spends and turns',
    statement:
      'Rune of Bulk Order reads "Every 10 Gold you spend, give 4 random friendly minions +4/+4". Gold spent feeds one running '
      + 'counter that never resets at the turn boundary. Every time it reaches 10 it pays once and keeps the remainder, so a '
      + 'single 20-Gold spend pays twice. Each payout picks 4 distinct friendly minions at random, or all of them when fewer '
      + 'are on the board. The badge shows the countdown to the next payout (x/10g).',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune changes 2026-09-25 (Set 3 rune list)', quote: 'Rune of Bulk Order: "When you spend 10 gold, give 4 friendly minions +4/+4."' },
      { kind: 'code', ref: 'packages/content/src/runes.ts rune_scale (runeScale count 4, +4/+4, per 10); packages/sim/src/reducer.ts spendGold (the runeScale meter); packages/ui/src/runeTally.ts' },
    ],
    contentIds: ['rune_scale'],
    cardText: 'Every **10 Gold** you spend, give **4 random friendly minions +4/+4**.',
    currentBehaviour: 'Conforms (built with the change, 2026-09-25). Before, it paid 3 random allies +3/+3 per 5 Gold.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0925.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-21',
    title: 'Rune of the Bargain Bin fills its refresh with Shout minions only',
    statement:
      'Rune of the Bargain Bin reads "Your first Refresh each turn fills the Shop with Shout minions that cost 1 Gold. They sell '
      + 'for 0 Gold". The binned row draws only minions with a Shout from the run pool at the Tavern tier or below (never a '
      + 'spell, a Ruby or the Starform). When no Shout minion is reachable the refresh stays an ordinary one and the rune use '
      + 'for the turn is not spent. One binned refresh per turn per copy held.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune changes 2026-09-25 (Set 3 rune list)', quote: 'Rune of the Bargain Bin: "the refresh should only include SHOUT minions. edit the description to match"' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts bargainBinPool + fillBargainBin + the refresh gate' },
    ],
    contentIds: ['rune_bargain_bin'],
    cardText: 'Your first **Refresh** each turn fills the Shop with **Shout** minions that cost **1 Gold**. They sell for **0 Gold**.',
    currentBehaviour: 'Conforms (built with the change, 2026-09-25). Before, the binned row drew any minion at your tier.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworks0925.test.ts', 'packages/sim/src/runeMinionBatchAug11.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-22',
    title: "Set 3 runes take the tribe and rarity of the owner's Set 3 rune list: listed under a tribe = gated to it, Neutral = no gate",
    statement:
      "The owner's Set 3 rune list groups every Set 3 rune by tribe (Kobold, Dwarf, Undead, Spirit, Celestial, Neutral) and "
      + 'by Basic / Epic, and the game matches it. A rune listed under a tribe carries that tribe gate, so the Runeforge '
      + 'offers it only when that tribe is in the run, in every set. A rune listed under Neutral carries no gate and is '
      + 'offered whatever tribes rolled. A rune listed Basic lives in the Basic pool (RUNES), one listed Epic in the Epic '
      + "pool (EPIC_RUNES). Rulings of 2026-09-25: Seller's Market is Dwarf; Spearline is Undead; Dream Mirror, Open Hand, "
      + 'Waking Reserve and Waking Dreams are Spirit; Lazarus is Neutral (its Undead gate removed, although it grants an '
      + 'Undead body); Soul Script keeps both Undead and Celestial (the one allowed extra tribe); Engraving Gems is Basic '
      + '(moved from the Epic pool, cost unchanged at 2).',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-25 (Set 3 rune list follow-up)', quote: `see here in this list how spearline and waking dreams are not "neutral" tagged and are tagged to tribes? can you make sure we're aligned on tribe orientation of set 3 runes` },
      { kind: 'owner-handoff', ref: "Owner rulings 2026-09-25: tag Seller's Market Dwarf, Spearline Undead, the four hand runes Spirit; Lazarus Neutral; Soul Script keeps both tribes; Engraving Gems Basic" },
      { kind: 'code', ref: 'packages/content/src/runes.ts (the `tribes` gates; Engraving Gems moved into RUNES); packages/sim/src/reducer.ts runeforgePool (the tribe filter)' },
    ],
    contentIds: ['rune_sellers_market', 'rune_spearline', 'rune_dream_mirror', 'rune_open_hand', 'rune_waking_reserve', 'rune_waking_dreams', 'rune_lazarus', 'rune_soul_script', 'rune_engraving_gems'],
    currentBehaviour:
      "Conforms (2026-09-25). Before, the first list pass (#1719) set Set 3 membership only: six tribe-listed runes were "
      + 'untribed, Lazarus was Undead-gated, and Engraving Gems was Epic.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RuneList.test.ts', 'packages/sim/src/tribeGate.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
];
