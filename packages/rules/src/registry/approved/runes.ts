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
      + 'Swarm (R-AURA-03, 2026-09-28): on every friendly Beast death it gives all your Beasts the current per-death '
      + 'amount. In combat the living Beasts gain it on the spot, later Beast summons that fight inherit it, and NOTHING '
      + 'carries back; a Shop Beast death buffs the warband Beasts permanently. Avenge (2) (combat deaths) still raises '
      + 'the per-death amount permanently. The enemy side runs its own copy '
      + 'off its snapshot and only accumulates.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Balance batch 9/23, tranche 5 (rune reworks B), owner list 2026-09-23', quote: 'Packcraft → "When you summon a minion in combat, give it +2/+1 and improve this permanently." Reinvestment → "When you summon a minion in combat, buff minions in the shop +3/+4 permanently." Bestial Swarm → "Give your Beast Aura +2/+2 when a friendly Beast dies. Avenge (2): improve this."' },
      { kind: 'owner-chat', ref: 'Owner ask 2026-09-28 (supersedes the Beastial Swarm carry-back; see R-AURA-03)', quote: 'pack mentality - aka beastial swarm buff: this is a combat buff only, not a permanent buff to beast aura everywhere.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts summonMinion (Packcraft level + Reinvestment pulse), the Beastial Swarm death block (combat-only), carryBacksFor (packcraftLevel / beastialSwarmLevel); packages/sim/src/reducer.ts settle (packcraftLevel, grantTribeAura) + questCombatMods (packcraftLevel, runeReinvestment); packages/sim/src/state.ts PACKCRAFT_STEP / REINVESTMENT_PER_SUMMON; packages/ui/src/runeTally.ts' },
    ],
    contentIds: ['rune_packcraft', 'rune_reinvestment', 'rune_beastial_swarm'],
    currentBehaviour:
      'Conforms as of 2026-09-28. Until 2026-09-23 Packcraft was a flat +6/+6 on every combat summon and Reinvestment paid '
      + '+1/+1 per summon with one badge pulse at settle. Beastial Swarm carried its gain back into a run-wide Beast Aura '
      + 'from 2026-09-23 to 2026-09-28, when the owner retired the Beast Aura (R-AURA-03).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/runeReworksB0923.test.ts', 'packages/sim/src/runeBatch8.test.ts', 'packages/sim/src/beastBatchAug12.test.ts', 'packages/ui/src/tallyCoverage.test.ts', 'packages/sim/src/beastCombatOnly0928.test.ts'],
      lastVerifiedAt: '2026-09-28',
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
      + 'Unbroken Vein (Veinbreaker) and the Display Case (Market Tormentor) all '
      + 'follow it, each keeping its second half (the Attack grant, the any-type aim, both Choose One effects, the '
      + 'left-most Shop enchant). The Muckbroker\'s "Get a Muckslinger. Repeat every 2 turns" is the same shape on '
      + 'the 2-turn cadence: one now, then one every second turn setup, and so is the Deep since 2026-10-07 (a random '
      + 'Tier 7 minion; R-DEEP-EVERY-01). Rune of Copies copies at that same turn setup '
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
  {
    id: 'R-RUNE-23',
    title: 'Rune of Gemmed Decisions: every Choose One card played gets a Ruby',
    statement:
      "After you play a Choose One card (a minion or a spell), you get a Ruby at the run's current Ruby strength, "
      + 'once the chosen branch (or both) has resolved. One Ruby per copy held. A card that is not a Choose One pays '
      + 'nothing. Choose One cards are played in the Shop, so the rune acts in the Shop.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Gemmed Decisions (3): "After you play a Choose One card, get a Ruby."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts applyChooseOnePlayed (the one Choose One resolution hook, minion and spell)' },
    ],
    contentIds: ['rune_gemmed_decisions'],
    cardText: 'After you play a **Choose One** card, get a **Ruby**.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-24',
    title: 'Rune of Echoing Kobolds grafts "Echo: get a Ruby" on every friendly Kobold, now and later, one Ruby even when Gilded',
    statement:
      'Every friendly Kobold (All-types bodies included) carries "Echo: get a Ruby": the ones on the board and in '
      + 'hand when the rune is taken, every Kobold that arrives later, and every Kobold summoned in combat. It is a '
      + 'real Echo, so it fires wherever a death or a triggered Echo fires it (combat, a Shop destroy) and the Echo '
      + 'multipliers apply. A combat Ruby reaches the hand through the Ruby carry-back, minted at settle at the live '
      + 'Ruby strength. A Gilded Kobold gets the same single Ruby (the granted Echo is not its own, so gilding does '
      + 'not double it). One Ruby per copy held.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Echoing Kobolds (3): "Give your Kobolds Echo: Get a Ruby." It applies to ALL friendly Kobolds, now and later.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts applyRuneGrafts (deathrattleGetRubies graft, fixed); packages/core/src/combat/simulate.ts graftBatch3Runes (combat summons); packages/core/src/effects/arena.ts deathrattleGetRubies' },
    ],
    contentIds: ['rune_echoing_kobolds'],
    cardText: 'Give your **Kobolds** "**Echo:** get a **Ruby**."',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts', 'packages/core/src/combat/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-25',
    title: 'Rune of the Red Storm: a Veinstorm on pickup; every Veinstorm cast also casts a Ruby on 2 friendly Kobolds',
    statement:
      'Taking the rune gets you a Veinstorm. From then on every Veinstorm cast, whoever casts it and however many '
      + 'times it repeats, also casts a Ruby on 2 random friendly Kobolds (distinct; one when only one Kobold is out; '
      + 'nothing with none). One pair per copy held. Veinstorm has no combat cast, so this pays in the Shop and at End '
      + 'of Turn.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of the Red Storm (4): "Get a Veinstorm. Veinstorms also cast a Ruby on 2 friendly Kobolds."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts castSpell (the Veinstorm rider) + rubyOnRandomKobolds; packages/sim/src/reducer.ts runeRedStorm grant' },
    ],
    contentIds: ['rune_red_storm'],
    cardText: 'Get a **Veinstorm**. **Veinstorms** also cast a **Ruby** on **2** friendly **Kobolds**.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-26',
    title: 'Rune of Rubywire: a Shop spell cast by anyone, in any phase, casts a Ruby on 2 friendly Kobolds',
    statement:
      "Whenever a Shop spell is cast (the R-SHOPSPELL-01 definition: a spell from the set's Shop-spell pool, Dwarven "
      + 'Ales included; never a Ruby, a Clue or other Gift, or a token spell), a Ruby is cast on 2 random friendly '
      + 'Kobolds. Any caster counts (the player from hand, a minion, a rune, a repeat) in the Shop, at End of Turn and '
      + 'in combat. One pair per copy held. A combat Ruby is temporary unless something makes it permanent.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Rubywire (4): "When you cast a Shop Spell, cast a Ruby on 2 friendly Kobolds."' },
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: '"Shop Spell" means the Shop-spell pool definition used by Goldilox. Any source, any phase.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts noteSpellCast (isShopPoolSpell); packages/core/src/combat/simulate.ts spellResolved' },
    ],
    contentIds: ['rune_rubywire'],
    cardText: 'When you cast a **Shop Spell**, cast a **Ruby** on **2** friendly **Kobolds**.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts', 'packages/core/src/combat/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-27',
    title: 'Rune of Choices: the first Choose One card each turn gains both effects, re-armed every Shop turn',
    statement:
      'Your first Choose One card each turn resolves both branches with no prompt. It is the Prismatic Pick '
      + 'mechanism: a Choose-Both charge armed at every turn setup (after the per-turn clear) and one on the turn the '
      + 'rune is taken; the charge is spent by the card that uses it and an unspent charge does not carry into the '
      + 'next turn. One charge per copy held.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Owner ruling: FIRST EACH TURN, resetting every Shop turn, the same mechanism as Prismatic Pick\'s "next Choose One this turn".' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts turn setup (chooseBothCharges) + runeChoices; packages/sim/src/recruit.ts chooseBothActive / spendChooseBothCharge' },
    ],
    contentIds: ['rune_choices'],
    cardText: 'Your first **Choose One** card each turn gains **both** effects.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-28',
    title: 'Rune of Combatative Rubies: every 3rd friendly attack, on a running meter, casts a permanent Ruby on 2 friendly Kobolds',
    statement:
      'Friendly attacks in combat feed one running meter that carries across fights. Every 3rd attack casts a '
      + 'PERMANENT Ruby (it carries back to the run board) on 2 random friendly Kobolds. The progress left at the end '
      + 'of a fight carries into the next, and the badge shows the countdown (x/3). One pair per copy held. There are '
      + 'no attacks in the Shop, so the rune acts in combat.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Combatative Rubies (3): "When 3 allies attack, cast a permanent Ruby on 2 friendly Kobolds."' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts (after the attack tally, combatativeTick); packages/sim/src/reducer.ts settle (runeCombatativeTick); packages/ui/src/runeTally.ts' },
    ],
    contentIds: ['rune_combatative_rubies'],
    cardText: 'When **3** allies attack, cast a **permanent Ruby** on **2** friendly **Kobolds**.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts', 'packages/core/src/combat/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-29',
    title: 'Rune of Body Counting: every 6th friendly death, Shop or combat, gets a random Undead at or below your tier',
    statement:
      'Friendly deaths feed one running meter shared by combat and the Shop. A Shop destroy, a Shop devour and a '
      + 'Shop damage death count; a sale is not a death and never counts. Every 6th death (8th before the 2026-09-27 reprice) gets a random Undead minion '
      + "from the run's pool at or below your Tavern tier (in combat it reaches the hand after the fight). The "
      + 'progress carries across fights and turns, and the badge shows the countdown (x/6). It is not an Avenge, so '
      + 'Rune of Fury does not double it. One Undead per copy held.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Body Counting (3): "When 8 friendly minions die, get a random Undead minion." A running counter across fights and Shop.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts fireOnFriendDeath (the Shop deaths); packages/core/src/combat/simulate.ts the avenge-bus handler; packages/sim/src/reducer.ts settle (runeBodyCountTick)' },
    ],
    contentIds: ['rune_body_counting'],
    cardText: 'When **6** friendly minions die, get a random **Undead** minion.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25; threshold 8 -> 6 by the owner-approved reprice, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts', 'packages/core/src/combat/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-30',
    title: 'Rune of Storming Veins: a Veinstorm on pickup; a Veinstorm cast from hand casts 3 times in total',
    statement:
      'Taking the rune gets you a Veinstorm. A Veinstorm cast FROM HAND casts 2 additional times (3 in total), added '
      + 'like every "additional time" source and stacking with the other from-hand multipliers. A Veinstorm cast by a '
      + 'minion, a rune or an Equipment resolves once (R-MULT-06). +2 casts per copy held.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Storming Veins (4): "Get a Veinstorm. Veinstorms cast 2 additional times from hand."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts spellCastsWithout + runeExtraCasts (rune_storming_veins); packages/sim/src/reducer.ts runeStormingVeins' },
    ],
    contentIds: ['rune_storming_veins'],
    cardText: 'Get a **Veinstorm**. **Veinstorms** cast **2 additional** times from hand.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-31',
    title: 'Rune of Sold Choices: selling a Choose One minion repeats the option it chose when played',
    statement:
      'Selling a Choose One minion from the board repeats the option it chose when it was played, at its own gilding '
      + '(a Gilded body repeats its Gilded branch). A body that resolved both branches repeats both. A branch that '
      + 'aims lands on a random other friendly minion. A Choose One minion that reached the board without choosing '
      + '(summoned or Discovered onto it) does nothing when sold. Minions only.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Owner ruling: selling repeats THE OPTION THAT WAS CHOSEN when the card was played. Minions only.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts fireSoldChoice; packages/sim/src/reducer.ts sell (before the body leaves) + chosenBoth' },
    ],
    contentIds: ['rune_sold_choices'],
    cardText: 'Your **Choose One** cards trigger their effect when sold as well.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-32',
    title: 'Rune of Aggressive Golems: every Gemheart Golem has "Rally: give this minion\'s Attack to the minion to the right"',
    statement:
      'Every friendly Gemheart Golem (on the board, in hand, arriving later, or summoned in combat) gains the Rally '
      + 'keyword and "give this minion\'s Attack to the minion to the right". When it attacks, the next living friendly '
      + "minion to its right gains Attack equal to the Golem's current Attack; with nothing to its right nothing "
      + 'happens. A Shop Rally replay fires it too, and a Shop gain is permanent. It fires once however the Golem is '
      + 'gilded.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Aggressive Golems (5): "Your Gemheart Golems gain Rally: Give this minion\'s Attack to the minion to the right."' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts applyRuneGrafts (rallyGiveAttackToRight + RL); packages/core/src/combat/simulate.ts graftBatch3Runes; packages/core/src/effects/arena.ts rallyGiveAttackToRight' },
    ],
    contentIds: ['rune_aggressive_golems'],
    cardText: 'Your **Gemheart Golems** gain "**Rally:** give this minion\'s Attack to the minion to the right."',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts', 'packages/core/src/combat/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-RUNE-33',
    title: 'Rune of Ruptured Rubies: every Ruby cast in combat bounces twice after it lands',
    statement:
      "Every Ruby cast in combat, from any source, bounces twice after it lands: each bounce carries the Ruby's "
      + 'stats to a random other living friendly minion (the R-RUBY-02 hop: stats only, and a hop never bounces again) '
      + "and keeps the landing's permanence. Two more bounces per copy held. Rubies cast in the Shop are unaffected.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'Owner rune batch 2026-09-25 (Set 3 rune batch 3)', quote: 'Rune of Ruptured Rubies (6): "Your Rubies cast in combat bounce twice."' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts playRubyOn (the one combat Ruby primitive) via ctx.rubyRuptureBouncesFor' },
    ],
    contentIds: ['rune_ruptured_rubies'],
    cardText: 'Your **Rubies** cast in combat bounce **twice**.',
    currentBehaviour: 'Conforms (built with the rune, 2026-09-25).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RunesBatch3.test.ts', 'packages/core/src/combat/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  // ── Set 3 rune design pass (owner 2026-09-27), tranche 0: cuts, restores, re-tags, reprices, rename. ──
  {
    id: 'R-SET3RUNE-01',
    title: 'Set 3 rune design pass: ten runes cut from Set 3 only, never archived',
    statement:
      'Rubywire, Living Magic, Recurrence, the Astral Draft, Refrain, the Hunting Bell, Sylus, the Pair, Quick Release and Grave Refreshment are no longer offered in Set 3. Each keeps every other set it was in and still resolves by id (saves and replays); a Set-3-only one is offered in no set. The Golden Splinter and the Deep Feast stay in Set 3.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)', quote: 'Cuts: cut 10 of the 12. KEEP The Golden Splinter and The Deep Feast in Set 3. The other 10 cuts proceed: Set 3 only, keep other sets, never archive.' },
      { kind: 'code', ref: 'packages/content/src/runes.ts (the rune defs: sets / tribes / cost / name / text)' },
    ],
    contentIds: ['rune_rubywire', 'rune_living_magic', 'rune_recurrence', 'rune_astral_draft', 'rune_refrain', 'rune_hunting_bell', 'rune_sylus', 'rune_pair', 'rune_quick_release', 'rune_grave_refreshment', 'rune_golden_splinter', 'rune_deep_feast'],
    cardText: 'Rune of the Pair: Get **2 random Tier 4 minions**. (One of the ten cut from Set 3.)',
    currentBehaviour: 'Conforms (built with the tranche, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RuneDesignT0.test.ts', 'packages/sim/src/set3RuneList.test.ts'],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-02',
    title: 'Set 3 rune design pass: five runes restored to Set 3',
    statement:
      "The Open Constellation, the Festival Circuit, the Five Banners, the Strange Caravan and the Wishbone are offered in Set 3 again. The Festival Circuit is the first Set 3 hybrid rune, gated to Spirit and Celestial. The Five Banners and the Strange Caravan read the run's own tribes, so they work with Set 3's five.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)', quote: 'All 5 restores.' },
      { kind: 'code', ref: 'packages/content/src/runes.ts (the rune defs: sets / tribes / cost / name / text)' },
    ],
    contentIds: ['rune_open_constellation', 'rune_festival_circuit', 'rune_five_banners', 'rune_strange_caravan', 'rune_wishbone'],
    cardText: 'Rune of the Strange Caravan: **Start of Turn:** get a random minion from a type you **do not control**.',
    currentBehaviour: 'Conforms (built with the tranche, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RuneDesignT0.test.ts', 'packages/sim/src/set3RuneList.test.ts'],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-03',
    title: 'Set 3 rune design pass: five runes re-tagged from Neutral to a tribe',
    statement:
      'Living Treasure is a Kobold rune; Rising Echoes, the Crowded Crypt and Overflow are Undead runes; Dreamed Graves is a Spirit rune. Each is offered only when its tribe is in the run. The gate applies in every set, so Set 2 (no Undead) no longer offers Overflow or Rising Echoes.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)', quote: 'The 5 re-tags.' },
      { kind: 'code', ref: 'packages/content/src/runes.ts (the rune defs: sets / tribes / cost / name / text)' },
    ],
    contentIds: ['rune_living_treasure', 'rune_rising_echoes', 'rune_crowded_crypt', 'rune_overflow', 'rune_dreamed_graves'],
    cardText: 'Rune of Overflow: **Overflow:** give your minions **+4/+4 permanently**.',
    currentBehaviour: 'Conforms (built with the tranche, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RuneDesignT0.test.ts', 'packages/sim/src/tribeGate.test.ts'],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-04',
    title: 'Set 3 rune design pass: seven reprices',
    statement:
      'Spearline costs 6 (was 7), Bartering 4 (was 6), the Spirit Crown 4 (was 6), Eventide 3 (was 4), the First Round 5 (was 4) and the Long Shift 3 (was 2). Body Counting pays every 6th friendly death (was every 8th); its badge counts x/6. Costs are global, so the Set 2 copies of Bartering, the First Round and the Long Shift change too.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)', quote: 'ALL the reprices in section 5 (Spearline 7->6, Bartering 6->4, Spirit Crown 6->4, Eventide 4->3, Body Counting 8 deaths->6, First Round 4->5, Long Shift 2->3).' },
      { kind: 'code', ref: 'packages/content/src/runes.ts (the rune defs: sets / tribes / cost / name / text)' },
    ],
    contentIds: ['rune_spearline', 'rune_bartering', 'rune_spirit_crown', 'rune_eventide', 'rune_body_counting', 'rune_first_round', 'rune_long_shift'],
    cardText: 'Rune of Body Counting: When **6** friendly minions die, get a random **Undead** minion.',
    currentBehaviour: 'Conforms (built with the tranche, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RuneDesignT0.test.ts', 'packages/sim/src/set3RunesBatch3.test.ts'],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-05',
    title: 'Rune of the Second Showing (was the Grand Procession) and the War Drum wording',
    statement:
      'Rune of the Grand Procession is renamed Rune of the Second Showing, so it no longer shares a name with the T7 minion Grand Procession; its id and behaviour are unchanged. The War Drum reads "The first Shout you trigger each turn triggers 2 more times.", which is what it already did (one per-turn charge, the first Shout, Shop or combat).',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)', quote: 'Tranche 0: hygiene, re-tags, cuts, restores, reprices, Grand Procession rename, War Drum wording.' },
      { kind: 'code', ref: 'packages/content/src/runes.ts (the rune defs: sets / tribes / cost / name / text)' },
    ],
    contentIds: ['rune_grand_procession', 'rune_war_drum'],
    cardText: 'The first **Shout** you trigger each turn triggers **2** more times.',
    currentBehaviour: 'Conforms (built with the tranche, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set3RuneDesignT0.test.ts'],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-RUNE-BASICDWARF-01',
    title: 'Rune of Basic Dwarves reads "Get a Dwarf" and is tagged Dwarf for the Runeforge board-fit',
    statement:
      'Rune of Basic Dwarves reads "Get a Dwarf. Repeat every Start of Turn." like the other Basic tribe runes, and its '
      + 'text carries the Dwarf word the board-fit matcher reads, so it counts as fitting a Dwarf board.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Set 3 rune audit follow-up)', quote: 'fix rune of basic dwarves text as well' },
      { kind: 'code', ref: 'packages/content/src/runes.ts rune_basic_dwarf text; packages/content/src/runeSynergy.ts dwarf word' },
    ],
    currentBehaviour: 'Conforms, FIXED 2026-09-27: it read "Get a Dwarve", which also missed the dwarf board-fit word.',
    enforcement: { kind: 'scenario', refs: ['packages/content/src/basicDwarvesText.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  // ── Set 3 rune design pass (owner 2026-09-27), tranche 1: Undead ──
  {
    id: 'R-SET3RUNE-06',
    title: "Rune of the Lantern Keeper: a Lantern of Souls now, then every 2 turns",
    statement:
      "Taking the rune gets a Lantern of Souls at once, then another every 2 turn setups (the Rare Goods cadence). The badge counts the turns toward the next one.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/content/src/runes.ts rune_lantern_keeper (grant + recurringGrant everyTurns 2)" },
    ],
    contentIds: ["rune_lantern_keeper"],
    cardText: "Get a **Lantern of Souls**. Repeat every **2 turns**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-07',
    title: "Rune of the Wake: every friendly Undead Echo trigger gives the Undead Aura +1 Attack",
    statement:
      "Every time a friendly Undead triggers its Echo, in the Shop, at End of Turn or in combat, the Undead Aura gains +1 Attack (per copy held). Each extra trigger (Sylus, a forced Echo, the Restless) counts on its own. In combat the living Undead feel it at once and the gain is permanent (R-AURA-02).",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireRecruitDeathrattles (runeWakeShop); packages/core/src/combat/simulate.ts asEcho (raiseUndeadAura)" },
    ],
    contentIds: ["rune_wake"],
    cardText: "Whenever a friendly **Undead** triggers its **Echo**, give your **Undead Aura +1 Attack**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT1.test.ts", "packages/core/src/combat/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-08',
    title: "Rune of the Second Wind: a risen minion gains +2/+2 permanently",
    statement:
      "After a friendly minion Rises (Shop or combat), it gains +2/+2. The gain is permanent: a Shop buff is, and a combat gain is carried back to its board card.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireOnRise (runeRiseRunesShop); packages/core/src/combat/simulate.ts runeRiseRunes (permaGain)" },
    ],
    contentIds: ["rune_second_wind"],
    cardText: "After a friendly minion **Rises**, give it **+2/+2** permanently.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT1.test.ts", "packages/core/src/combat/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-09',
    title: "Rune of the Soul Toll: Avenge (4) gives the Undead Aura +1 Attack",
    statement:
      "Every 4th friendly death in a fight gives the Undead Aura +1 Attack: the living Undead feel it at once and the gain is permanent (R-AURA-02). It is an Avenge, so Rune of Fury doubles it. Built instead of the design doc's Rune of the Unquiet.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Undead: do NOT build Rune of the Unquiet. Build Rune of the Soul Toll instead (B3: \"Avenge (4): give your Undead Aura +1 Attack.\"). Do not build Mortal Coil." },
      { kind: 'code', ref: "packages/core/src/combat/simulate.ts runeAvenge(4, 'runeSoulToll')" },
    ],
    contentIds: ["rune_soul_toll"],
    cardText: "**Avenge (4):** give your **Undead Aura +1 Attack**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/core/src/combat/set3RuneDesignT1.test.ts", "packages/sim/src/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-10',
    title: "Rune of the Gravedigger: a friendly Shop destroy gives your Undead +2/+2",
    statement:
      "After you destroy a friendly minion in the Shop (either destroy path, End of Turn included), every other Undead on your board gains +2/+2 (per copy held).",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts afterShopDestroy (runeGravediggerShop)" },
    ],
    contentIds: ["rune_gravedigger"],
    cardText: "After you destroy a friendly minion in the **Shop**, give your **Undead +2/+2**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-11',
    title: "Rune of the Soul Furnace: the Undead Aura also gives Health equal to half its Attack",
    statement:
      "The Undead Aura (the Lantern channel plus the buy channel) also gives every Undead Health equal to half its Attack, rounded up, per copy. The term lives in the run's Undead Aura Health, so it shows on the board, in hand, in the Shop and in combat, and it rises the moment the Aura's Attack rises, mid-fight included. The mid-fight rise is not carried back; the run re-derives it from the Aura's Attack.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts syncSoulFurnace (reducer action boundary); packages/core/src/combat/simulate.ts resyncSoulFurnace; packages/core/src/types.ts soulFurnaceHealth" },
    ],
    contentIds: ["rune_soul_furnace"],
    cardText: "Your **Undead Aura** also gives **Health** equal to **half** its **Attack**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT1.test.ts", "packages/core/src/combat/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-12',
    title: "Rune of the Restless: a risen minion triggers its Echo",
    statement:
      "After a friendly minion Rises (Shop or combat), its Echo triggers once per copy held, through the shared Echo path: every Echo multiplier applies and every rune that hears an Echo (the Wake) counts it.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts runeRiseRunesShop (fireRecruitDeathrattles); packages/core/src/combat/simulate.ts runeRiseRunes (triggerEcho)" },
    ],
    contentIds: ["rune_restless"],
    cardText: "After a friendly minion **Rises**, trigger its **Echo**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT1.test.ts", "packages/core/src/combat/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-13',
    title: "Rune of the Open Grave: the first friendly Shop destroy each turn gains Rise first",
    statement:
      "The first friendly minion you destroy in the Shop each turn gains Rise before it dies, so it Rises. A minion that already has Rise does not use up the turn's charge. The charge comes back at the start of each turn.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts armOpenGrave (destroyMinionInShop + settlePendingDeath); packages/sim/src/reducer.ts turn reset" },
    ],
    contentIds: ["rune_open_grave"],
    cardText: "The first friendly minion you destroy in the **Shop** each turn gains **Rise** before it dies.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT1.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  // ── Set 3 rune design pass (owner 2026-09-27), tranche 2: Celestial (the Event Horizon slot is left empty) ──
  {
    id: 'R-SET3RUNE-14',
    title: "Rune of the Heralding Star: a friendly Celestial Shout gives your Starform +3/+3",
    statement:
      "Every time a friendly Celestial triggers its Shout (a play, a re-fire, each extra fire), your Starform gains +3/+3 per copy. With no Starform nothing happens. In combat the gain is banked and lands on the Starform when the Shop opens (the Starform is a Shop token), after any Shop-only Shout that creates one.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireBattlecryTriggered (runeCelestialShoutShop); packages/core/src/combat/simulate.ts battlecryTriggered listener + gainStarform; packages/sim/src/reducer.ts settle (playerStarformGain)" },
    ],
    contentIds: ["rune_heralding_star"],
    cardText: "After a friendly **Celestial** triggers its **Shout**, give your **Starform +3/+3**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts", "packages/core/src/combat/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-15',
    title: "Rune of Stellar Echoes: your Celestials have \"Echo: give your Starform +2/+2\"",
    statement:
      "Every friendly Celestial (board, hand, later arrivals, combat summons) carries \"Echo: give your Starform +2/+2\" (per copy). A Gilded Celestial pays the same. In the Shop the Starform grows at once; in combat the gain is banked and lands when the Shop opens.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts applyRuneGrafts + RECRUIT_FACTORIES.deathrattleBuffStarform; packages/core/src/combat/simulate.ts graftBatch3Runes; packages/core/src/effects/factories.ts deathrattleBuffStarform" },
    ],
    contentIds: ["rune_stellar_echoes"],
    cardText: "Give your **Celestials** \"**Echo:** give your **Starform +2/+2**.\"",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts", "packages/core/src/combat/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-16',
    title: "Rune of Scattered Light: buying your Starform Collapses it instead",
    statement:
      "When you buy your Starform, it Collapses instead of being consumed by your left-most Celestial: half its stats, rounded up, to 3 unique random Celestials plus any extra Collapse hits. The price is still paid and it still counts as a buy; the Collapse listeners (Zenith, Eventide) hear a Collapse.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/starform.ts buyStarform" },
    ],
    contentIds: ["rune_scattered_light"],
    cardText: "When you buy your **Starform**, it **Collapses** instead.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-17',
    title: "Rune of Gravity: each minion your Starform consumes gives your Celestials +2/+2",
    statement:
      "Every Shop minion your Starform consumes (a full-row creation, Accretion, extra bites) gives the Celestials on your board +2/+2 per copy. Only the Starform's own consumes count (a Demon's does not).",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts consumeShopOffer (runeGravityShop, the Starform as eater)" },
    ],
    contentIds: ["rune_gravity"],
    cardText: "When your **Starform** Consumes a minion, give your **Celestials +2/+2**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-18',
    title: "Rune of the Afterglow: your Starform leaving the Shop gets a Star Crash",
    statement:
      "When your Starform leaves the Shop by a buy, a Collapse or a consume, you get a Star Crash (per copy). The Star Destroyer's silent exit does not count.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireStarformRemoved" },
    ],
    contentIds: ["rune_afterglow"],
    cardText: "When your **Starform** leaves the **Shop**, get a **Star Crash**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-19',
    title: "Rune of the Starsong: a friendly Celestial Shout gives your Celestials +2/+2",
    statement:
      "Every time a friendly Celestial triggers its Shout, your Celestials gain +2/+2 (per copy): the board in the Shop (permanent), the living Celestials in combat (for that fight).",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts runeCelestialShoutShop; packages/core/src/combat/simulate.ts battlecryTriggered listener" },
    ],
    contentIds: ["rune_starsong"],
    cardText: "After a friendly **Celestial** triggers its **Shout**, give your **Celestials +2/+2**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts", "packages/core/src/combat/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-20',
    title: "Rune of the Guiding Star: a friendly Celestial Echo casts a Star Crash on a random friendly Celestial",
    statement:
      "Every time a friendly Celestial triggers its Echo (Shop, End of Turn or combat, each extra trigger included), the rune casts a Star Crash (per copy) on a random other friendly Celestial. It is a real cast: spell counters and cast watchers hear it. A Gilded Echo body does not double it. No other Celestial: no cast.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireRecruitDeathrattles (runeGuidingStarShop); packages/core/src/combat/simulate.ts asEcho (runeCastStarCrash)" },
    ],
    contentIds: ["rune_guiding_star"],
    cardText: "Whenever a friendly **Celestial** triggers its **Echo**, cast a **Star Crash** on a random friendly **Celestial**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts", "packages/core/src/combat/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-21',
    title: "Star Crash resolves in combat",
    statement:
      "A Star Crash cast in combat (the Guiding Star, or any combat re-cast) gives the aimed Celestial +5/+7 plus spell power, then the same on a random living friendly minion (the target may be picked again), with Rune of Falling Embers' bonus folded into both, exactly as in the Shop. It used to fizzle in combat.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Rune of the Guiding Star: Whenever a friendly Celestial triggers its Echo, cast a Star Crash on a random friendly Celestial. (approved as written)" },
      { kind: 'code', ref: "packages/core/src/effects/factories.ts resolveCombatSpellCastInner (spellBuffTargetAndRandomFriendly); packages/sim/src/reducer.ts questCombatMods starCrashBonus" },
    ],
    contentIds: ["starcrash", "rune_guiding_star", "rune_falling_embers"],
    cardText: "Give a **Celestial +5/+7**. It also casts on a random friendly minion.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/core/src/combat/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-22',
    title: "Rune of the Meteor Storm: every Star Crash you cast is cast again on a different friendly Celestial",
    statement:
      "Whenever you cast a Star Crash (Shop, End of Turn or combat, any caster, a cast on the Starform included), it is cast again (per copy) on a different random friendly Celestial. The extra cast is a real cast but never repeats itself (no loop). With no other friendly Celestial nothing happens. It fills the Celestial Epic slot the Event Horizon left; it is named the Meteor Storm because the owner's name, Meteor Shower, is already the Set 3 Celestial Epic rune_meteor_shower.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "meteor shower is fine" },
      { kind: 'code', ref: "packages/sim/src/recruit.ts castSpell (runeMeteorStormShop, METEOR_ECHOING latch); packages/core/src/combat/simulate.ts runeMeteorStorm via ctx.onStarCrashCast; packages/core/src/effects/factories.ts the Star Crash combat case" },
    ],
    contentIds: ["rune_meteor_storm"],
    cardText: "Whenever you cast a **Star Crash**, cast it again on a different friendly **Celestial**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT2.test.ts", "packages/core/src/combat/set3RuneDesignT2.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  // ── Set 3 rune design pass (owner 2026-09-27), tranche 3: Spirit + Dwarf ──
  {
    id: 'R-SET3RUNE-23',
    title: "Rune of Call and Answer: a friendly Spirit Shout or Rally gives the left-most minion in your hand +2/+2",
    statement:
      "Every time a friendly Spirit triggers a Shout or a Rally (Shop, End of Turn or combat, each extra fire included), the left-most minion in your hand (spells skipped) gains +2/+2 per copy. A hand buff is permanent (R-HAND-02); in combat it lands live on the hand card. An empty hand: nothing.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireBattlecryTriggered + fireShopRally (runeCallAndAnswerShop); packages/core/src/combat/simulate.ts battlecryTriggered listener + bumpRally (callAndAnswer, buffHand)" },
    ],
    contentIds: ["rune_call_and_answer"],
    cardText: "After a friendly **Spirit** triggers a **Shout** or **Rally**, give the left-most minion in your hand **+2/+2**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT3.test.ts", "packages/core/src/combat/set3RuneDesignT3.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-24',
    title: "Rune of the Encore: the first Reveler you sell each turn also pays the left-most minion in your hand",
    statement:
      "The first Reveler you sell each turn also gives the bonus it just paid your board (the Traveling Festival's extra included) to the left-most minion in your hand, per copy. Only a real sale counts; a Reveler re-fire (Shared Revelry) does not. The charge returns each turn.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts revelerSell (lastRevelerPay) + fireOnMinionSold (runeEncoreShop); packages/sim/src/reducer.ts turn reset" },
    ],
    contentIds: ["rune_encore"],
    cardText: "The first **Reveler** you sell each turn also gives its bonus to the left-most minion in your hand.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT3.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-25',
    title: "Rune of the Overture: a Crescendo now, then every 2 turns",
    statement:
      "Taking the rune gets a Crescendo at once, then another every 2 turn setups. The badge counts the turns toward the next one.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/content/src/runes.ts rune_overture (grant + recurringGrant everyTurns 2)" },
    ],
    contentIds: ["rune_overture"],
    cardText: "Get a **Crescendo**. Repeat every **2 turns**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT3.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-26',
    title: "Rune of the Kindred Hand: a Spirit played gives the left-most minion in your hand +1/+1 per Spirit you control",
    statement:
      "After you play a Spirit, the left-most minion in your hand (spells skipped) gains +1/+1 for each Spirit on your board, the played one included (per copy). The badge prints what the next Spirit you play will pay. Replaces the Beckoning in the Spirit Basic slot.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "kindred hand is fine" },
      { kind: 'code', ref: "packages/sim/src/recruit.ts runeDesignPlayRunes + kindredHandValue; packages/ui/src/runeTally.ts" },
    ],
    contentIds: ["rune_kindred_hand"],
    cardText: "After you play a **Spirit**, give the left-most minion in your hand **+1/+1** for each **Spirit** you control.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT3.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-27',
    title: "Rune of the Whetstone: a Dwarf played gives your other Dwarves +1 Attack",
    statement:
      "Whenever you play a Dwarf, your other Dwarves on the board gain +1 Attack (per copy). Each is a \"gains Attack\" event for Kneel, Tankerchief and the Anvil.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts runeDesignPlayRunes (playCard's chokepoint)" },
    ],
    contentIds: ["rune_whetstone"],
    cardText: "Whenever you play a **Dwarf**, give your other **Dwarves +1 Attack**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT3.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-28',
    title: "Rune of the Anvil: a friendly Dwarf's Attack gain also gives that much Health",
    statement:
      "Whenever a friendly Dwarf on the board gains Attack (Shop, End of Turn or combat, per gain), it also gains that much Health (per copy). A Health gain never re-fires it, so it cannot loop with Kneel or Tankerchief.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireOnGainAttack (gained); packages/core/src/combat/simulate.ts ctx.buff" },
    ],
    contentIds: ["rune_anvil"],
    cardText: "Whenever a friendly **Dwarf** gains **Attack**, it also gains that much **Health**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT3.test.ts", "packages/core/src/combat/set3RuneDesignT3.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-29',
    title: "Rune of the Satchel: a card added to your hand gives your Dwarves +1/+1",
    statement:
      "Whenever a card is added to your hand, from any source, your Dwarves gain +1/+1 (per copy): the board in the Shop (permanent), the living Dwarves in combat (for that fight). A card that reaches the hand in combat arrives in the run at settle, and that arrival pays the board too, exactly as the other \"card added to hand\" reactors (Gangplank) do.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Approved as written: Every Undead, Celestial, Spirit and Dwarf rune in section 4, EXCEPT the four noted below." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireOnGainCard (runeSatchelShop); packages/core/src/combat/simulate.ts emitGainCard" },
    ],
    contentIds: ["rune_satchel"],
    cardText: "Whenever a card is added to your hand, give your **Dwarves +1/+1**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT3.test.ts", "packages/core/src/combat/set3RuneDesignT3.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  // ── Set 3 rune design pass (owner 2026-09-27), tranche 4: hybrids ──
  {
    id: 'R-SET3RUNE-30',
    title: "Rune of Minted Gems: every 8 Gold you spend gets a random Ruby",
    statement:
      "The Gold-spent meter (every spend, any phase that spends Gold) trips every 8 Gold; each trip gets one random Ruby, drawn from all six Ruby types on the run cursor, into your hand (hand cap respected, like every meter grant). The badge prints the meter (x/8).",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "When you spend 8 Gold, get a random Ruby." },
      { kind: 'code', ref: "packages/content/src/runes.ts rune_minted_gems (runeThreshold gold per 8, grantRandomRuby); packages/sim/src/recruit.ts payRuneThresholdInner (mintRandomRubies)" },
    ],
    contentIds: ["rune_minted_gems"],
    cardText: "When you spend **8 Gold**, get a random **Ruby**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-31',
    title: "Rune of the Gem Crypt: a friendly minion that Rises keeps its Rubies",
    statement:
      "When a friendly minion Rises (Shop or combat), the returned printed body also gets back the Ruby stats it carried when it died: its Shop Ruby ledger, plus in combat the Ruby stats it gained that fight. A body with no Rubies returns as printed (R-RISE-01).",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Not built: Event Horizon, Beckoning, Tavern Tab." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts riseReturn; packages/core/src/combat/simulate.ts the Rise body (gemCryptRuby)" },
    ],
    contentIds: ["rune_gem_crypt"],
    cardText: "Friendly minions that **Rise** keep their **Rubies**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts", "packages/core/src/combat/set3RuneDesignT4.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-32',
    title: "Rune of the Pallbearer: a friendly Undead death gives the left-most minion in your hand +2/+2",
    statement:
      "Every friendly Undead death (a Shop destroy or a combat death, never a sale) gives the left-most minion in your hand (spells and Rubies skipped) +2/+2 per copy. A hand buff is permanent (R-HAND-02); in combat it lands live on the hand card. An empty hand: nothing.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Not built: Event Horizon, Beckoning, Tavern Tab." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireOnFriendDeath (runePallbearerShop); packages/core/src/combat/simulate.ts avenge bus listener (buffHand)" },
    ],
    contentIds: ["rune_pallbearer"],
    cardText: "When a friendly **Undead** dies, give the left-most minion in your hand **+2/+2**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts", "packages/core/src/combat/set3RuneDesignT4.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-33',
    title: "Rune of the Star Tap: a Dwarven Ale cast gives your Starform +3/+3",
    statement:
      "Every Dwarven Ale cast (Shop, End of Turn or combat) gives your Starform +3/+3 per copy. A combat gain is banked and lands when the Shop exists again (the Starform deferral). No Starform: nothing.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Not built: Event Horizon, Beckoning, Tavern Tab." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts castSpell (runeStarTapShop); packages/core/src/combat/simulate.ts spellResolved (gainStarform)" },
    ],
    contentIds: ["rune_star_tap"],
    cardText: "When you cast a **Dwarven Ale**, give your **Starform +3/+3**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts", "packages/core/src/combat/set3RuneDesignT4.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-34',
    title: "Rune of Closing Time (the owner's Last Call): selling a Reveler gets a Dwarven Ale",
    statement:
      "Every Reveler you sell gets a random Dwarven Ale per copy (hand cap overflow-safe, like every earned grant). Shipped as \"Rune of Closing Time\" because the Set 2 Dwarf rune rune_last_call already owns the name \"Rune of Last Call\".",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "last call is good" },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireOnMinionSold (REVELER_IDS branch)" },
    ],
    contentIds: ["rune_closing_time"],
    cardText: "When you sell a **Reveler**, get a **Dwarven Ale**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-35',
    title: "Rune of the Grim Toast: your Dwarves also get your Undead Aura (the whole live Aura)",
    statement:
      "A non-Undead Dwarf gets the full live Undead Aura: its Attack (the Lantern channel and the buy channel) and its Health (the Soul Furnace term included), through the same Aura fold the Undead use: board, hand, Shop offers, combat seeding, and every live mid-fight Aura rise. An Undead Dwarf already has the Aura and is never paid twice. It is the Aura itself, not a mirror of Attack gains.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "should just inherit the undead aura stat not just attack" },
      { kind: 'code', ref: "packages/sim/src/recruit.ts foldedAuraOf + grimToastFold; packages/core/src/combat/simulate.ts applyAuras + grimToastLive; packages/ui/src/Recruit.tsx + instView.ts" },
    ],
    contentIds: ["rune_grim_toast"],
    cardText: "Your **Dwarves** also get your **Undead Aura**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts", "packages/core/src/combat/set3RuneDesignT4.test.ts", "packages/ui/src/set3RuneT4Tally.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-36',
    title: "Rune of the Gem Star: the first 4 Rubies you cast each turn also give your Starform their stats",
    statement:
      "The first 4 Rubies cast each turn (Shop, End of Turn, then that turn's combat, one shared count reset at turn setup) also give your Starform the stats that Ruby gave, per copy. A bounce or relay is not a cast and does not count. In the Shop it needs a Starform; a combat gain is banked. The badge prints this turn's count out of 4.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Not built: Event Horizon, Beckoning, Tavern Tab." },
      { kind: 'code', ref: "packages/sim/src/recruit.ts runeRubyCastShop (gemStarThisTurn); packages/sim/src/reducer.ts questCombatMods (gemStarLeft); packages/core/src/effects/factories.ts playRubyOn (onRubyCast)" },
    ],
    contentIds: ["rune_gem_star"],
    cardText: "The first **4 Rubies** you cast each turn also give your **Starform** their stats.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts", "packages/core/src/combat/set3RuneDesignT4.test.ts", "packages/ui/src/set3RuneT4Tally.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-37',
    title: "Rune of the Keepsake Gem: every Ruby also casts on the left-most minion in your hand",
    statement:
      "Every Ruby cast on a minion (Shop, End of Turn or combat, every Ruby, not only the first each turn) also gives its stats (and in the Shop its Ruby rider) to the left-most minion in your hand, per copy. The relay is a plain stat grant, never a Ruby cast, so no Ruby-cast trigger hears it and it cannot loop. An empty hand: nothing.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "do keepsake gem made stronger" },
      { kind: 'code', ref: "packages/sim/src/recruit.ts fireOnRubyPlayed (runeRubyCastShop); packages/core/src/effects/factories.ts playRubyOn (onRubyCast) + simulate.ts runeRubyCastCombat" },
    ],
    contentIds: ["rune_keepsake_gem"],
    cardText: "Your **Rubies** also cast on the left-most minion in your hand.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT4.test.ts", "packages/core/src/combat/set3RuneDesignT4.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  // ── Set 3 rune design pass (owner 2026-09-27), tranche 5: Menagerie + neutral ──
  {
    id: 'R-SET3RUNE-38',
    title: "Rune of the Menagerie (Set 3): get a random Kobold, Dwarf, Undead, Spirit and Celestial",
    statement:
      "Taking the rune gets one random minion of each Set 3 tribe at or below your tier (the set-1 and set-2 Menageries' shape, this set's tribes). A second copy re-grants.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Build tranche 5: Menagerie (Set 3), Unity (build last, behind a prototype and tests), and Heavy Hand." },
      { kind: 'code', ref: "packages/content/src/runes.ts rune_menagerie_set3 (multi grant randomTribe)" },
    ],
    contentIds: ["rune_menagerie_set3"],
    cardText: "Get a random **Kobold, Dwarf, Undead, Spirit, and Celestial**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT5.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-39',
    title: "Rune of Unity: while you control all 5 minion types, your minions count as every type",
    statement:
      "While your board NATURALLY controls every active minion type (printed tribes and All-types cards; Unity's own grant never counts, so it cannot hold itself up), every board minion counts as every type: in the Shop through isTribe (re-read at every action boundary and at a play, a sale, a Shop death and End of Turn), in combat through universalTribe on the living minions, re-read after every death and summon. When the full house breaks, the grant is withdrawn at once. Hand cards are not \"your minions\". A Unity body counts as Undead and so takes the whole Undead Aura (Lantern and buy Attack, Health) as a fold, never baked; in combat once, and not taken back mid-fight.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Unity (build last, behind a prototype and tests; E6: \"While you control all 5 minion types, your minions count as every type\")" },
      { kind: 'code', ref: "packages/sim/src/recruit.ts isTribe / isTribeNatural / syncUnity / unityAuraFold; packages/sim/src/reducer.ts action boundary; packages/core/src/combat/simulate.ts syncUnityCombat (seeding, noteCardDeath, summonEntryEffects)" },
    ],
    contentIds: ["rune_unity"],
    cardText: "While you control all **5** minion types, your minions count as **every type**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT5.test.ts", "packages/core/src/combat/set3RuneDesignT5.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-SET3RUNE-40',
    title: "Rune of the Heavy Hand: damage your minions deal counts double toward Pummel",
    statement:
      "Every landed hit a friendly minion deals advances its Pummel meter by double the damage (one extra share per copy). The tally carries over as every Pummel tally does; the per-combat payout cap still binds. Damage is dealt only in combat, so the rune acts only there.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner rulings 2026-09-27 on the Set 3 rune design pass (set3-rune-design.md)", quote: "Build tranche 5: Menagerie (Set 3), Unity (build last, behind a prototype and tests), and Heavy Hand." },
      { kind: 'code', ref: "packages/core/src/combat/simulate.ts noteDamageDealt" },
    ],
    contentIds: ["rune_heavy_hand"],
    cardText: "Damage your minions deal counts **double** toward **Pummel**.",
    currentBehaviour: 'Conforms (built with the rune, 2026-09-27).',
    enforcement: {
      kind: 'scenario',
      refs: ["packages/sim/src/set3RuneDesignT5.test.ts", "packages/core/src/combat/set3RuneDesignT5.test.ts"],
      lastVerifiedAt: '2026-09-27',
    },
  },
  {
    id: 'R-RUNE-34',
    title: 'The player cannot skip the Runeforge',
    statement:
      'Once a Runeforge opens, the player must buy a rune before the turn goes on. There is no skip or leave '
      + 'control for the player (the free once-per-game Re-roll is still allowed). The engine\'s skip action exists '
      + 'only for bots, fixtures and replays.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Rules-wiki review, 2026-09-29 (asked whether the forge should have a Skip button)', quote: 'no skipping allowed now' },
      { kind: 'code', ref: 'packages/ui (no dispatch of skipRuneforge); packages/sim/src/reducer.ts skipRuneforge kept for bots/pilots' },
    ],
    currentBehaviour:
      'Conforms: no UI control dispatches skipRuneforge. The forge opens on turn 6 (8 Gold) and turn 9 (10 Gold) and '
      + 'runes cost 3 to 6, so a player is not expected to be priced out; an effect that drains Gold before the '
      + 'forge could still leave a player unable to buy, which is not separately guarded.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/runeforgeNoSkip.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-RUNE-35',
    title: 'Rune of Drakko: get a Drakko, and every Drakko is a Dragon AND a Spirit for the rest of the game',
    statement:
      "Rune of Drakko (Epic, 4 Gold, Set 2 and Set 3) grants a regular Drakko and makes EVERY Drakko of the run a "
      + "Dragon and a Spirit, on top of its own type: Shop offers, hand, board, Gilded copies, Discover options and "
      + "combat bodies, including Drakkos already held and ones gained later. It is the same card, so it triples with "
      + "regular Drakkos and the Gilded copy keeps the types. It counts for every tribe check, tally, aura and synergy "
      + "in every phase, and recorded boards keep it. A second copy changes no types. The forge offers it when EITHER "
      + "Dragon or Spirit is one of the run's tribes, and it is categorised under both tribes.",
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner rune ask 2026-10-03', quote: 'add this rune to set 2 and 3: All Drakko - 4 cost: Get a Drakko with Dragon/Spirit type.' },
      { kind: 'owner-chat', ref: 'Owner follow-up 2026-10-03 (gate)', quote: 'if either tribe is in a set it should be offered. categorize it as a dragon and/or spirit rune' },
      { kind: 'owner-chat', ref: 'Owner follow-up 2026-10-03 (pool, name)', quote: 'Epic. Rune of Drakko' },
      { kind: 'owner-chat', ref: 'Owner rework 2026-10-03', quote: "for drakko - it SHOULD triple with regular drakkos. sorry, reword the rune a bit. It should be Get a Drakko. Drakko is a Dragon/Spirit this game. this makes all drakkos in shop and everywhere a dragon/spirit. it isnt a new minion, it's just a drakko that has new types." },
      { kind: 'code', ref: 'packages/sim/src/state.ts RunState.cardTribes; packages/sim/src/recruit.ts defIsTribe / hasRunTribe / syncRunTribes; packages/core/src/combat/minion.ts foldTribes' },
    ],
    contentIds: ['rune_drakko', 'drummer'],
    cardText: 'Get a **Drakko**. **Drakko** is a **Dragon** and a **Spirit** this game.',
    currentBehaviour: 'Conforms (built with the rune, 2026-10-03).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/runeDrakko.test.ts'], lastVerifiedAt: '2026-10-03' },
  },
  {
    id: 'R-RUNESLOT-02',
    title: 'Rune of Duplication copies the first Epic rune you select, and says so',
    statement:
      'Rune of Duplication reads "Copy the first Epic Rune you select." The next Epic rune the player buys after '
      + 'owning it is applied a second time and held as a second rune; Duplication is spent on that buy. A Basic buy '
      + 'never spends it, and later Epic buys are not copied. The Duplication badge stays in the rack; it does not turn '
      + 'into the copy.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner report 2026-10-06 (runeforge heroes UI)', quote: "the basic runeforge selection was rune of duplication, which then duplicated guardian's turn 8 rune which is fine. but we need to change the text to say copy the first epic rune you select" },
      { kind: 'code', ref: 'packages/content/src/runes.ts rune_duplication; packages/ui/src/questText.ts runeDuplication; packages/sim/src/reducer.ts buyRune (runeDuplication && runeforgeEpic)' },
    ],
    contentIds: ['rune_duplication'],
    cardText: 'Copy the **first Epic Rune** you select.',
    currentBehaviour: 'Conforms. The mechanic was already "the first Epic bought after it" (GAME-RULES); the text changed 2026-10-06 from "After you forge your Epic Rune, this transforms into a copy of it".',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/runeforgePowerSlot.test.ts'], lastVerifiedAt: '2026-10-06' },
  },
  {
    id: 'R-COFFERS-EVERY-EOT-01',
    title: 'Rune of the Coffers raises max Gold on EVERY End of Turn, above the cap',
    statement:
      'Rune of the Coffers reads "End of Turn: increase your maximum Gold by 1." Every End of Turn adds +1 max Gold '
      + 'per copy on top of the natural curve, so after N End of Turns the player has exactly N more max Gold than a '
      + 'run without it, before and after the natural 10. A raise is never eaten by the turn-start growth toward the '
      + 'cap. Its Gold-pill beat plays each End of Turn and its badge prints the running total. The same holds for '
      + 'every other "raise your maximum Gold" grant (Bone Taxer, Soulsman, Rune of Soul Taxes): all of them land in '
      + 'the above-the-cap channel (`maxGoldBonus`), never the natural `maxEmbers` curve.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug report 2026-10-06', quote: 'rune of the coffers only triggered once - it should trigger every end of turn' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts applyEndOfTurn (runeCoffers) + makeContext grantMaxGold; packages/sim/src/reducer.ts settleCombat (playerMaxGoldGain); packages/ui/src/runeTally.ts rune_coffers' },
    ],
    contentIds: ['rune_coffers', 'bonetaxer', 'soulsman', 'rune_soul_taxes'],
    cardText: '**End of Turn:** increase your **maximum Gold** by **1**.',
    currentBehaviour:
      'Conforms (2026-10-06). The rune wrote `maxEmbers`, the natural curve, and the turn-start growth '
      + '`max(maxEmbers, min(cap, maxEmbers + 1))` swallowed any raise that pushed it into the cap, so near 10 it only '
      + 'pre-spent growth the player got anyway and looked like it had fired once (the Nadja 2026-07-22 class). It now '
      + 'writes `maxGoldBonus`, like Robin x Time, Gold Font and Nadja.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/runeCoffersEveryEot.test.ts', 'packages/ui/src/runeCoffersTally.test.ts'], lastVerifiedAt: '2026-10-06' },
  },
  {
    id: 'R-DEEP-EVERY-01',
    title: 'Rune of the Deep pays a Tier 7 minion on purchase, then again every 2 turns, with a live countdown',
    statement:
      'Rune of the Deep reads "Get a random Tier 7 minion. Repeat every 2 turns." The first minion lands the moment '
      + 'the rune is bought; the next turn setup pays nothing, and the one after pays again (one per copy held). The '
      + 'cadence is the `every` param on the reward, counted from the purchase; the Runeforge badge shows the x/2 turns '
      + 'countdown. A run that armed the Deep before the cadence existed keeps paying every turn.',
    domain: 'runes',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-07', quote: 'Get a random Tier 7 minion. Repeat every 2 turns.' },
      { kind: 'code', ref: 'packages/content/src/runes.ts rune_deep (every: 2); packages/sim/src/reducer.ts runeDeep reward + turn setup (runeDeepTick); packages/ui/src/runeTally.ts rune_deep' },
    ],
    contentIds: ['rune_deep'],
    cardText: 'Get a random **Tier 7** minion. Repeat every **2 turns**.',
    currentBehaviour: 'Conforms (2026-10-07). Was every Start of Turn (owner 2026-09-23).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/balanceBatch1007.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
];
