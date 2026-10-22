/**
 * APPROVED RULES — domain `randomness`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const RANDOMNESS_RULES: GameRule[] = [
  {
    id: 'R-RAND-01',
    title: '"Consumes a minion in the Shop" is a seeded random pick',
    statement:
      'When a card says it Consumes "a minion in the Shop" with no position named, the meal is a RANDOM edible '
      + 'offer (a minion — never a spell or Ruby in the row), drawn from the run\'s seeded rng cursor so replays '
      + 'agree, and re-drawn after each bite because the row shifts. It is never the right-most, the fattest, or '
      + 'any other fixed slot. Appetite Agent\'s target eats this way; Cinder Clerk, Chipper, Cupcakes, Gemgorge and '
      + 'Baal already did.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (Mike\'s report, relayed)', quote: 'make sure that appetite agent\'s consume target is always random' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts battlecryTargetConsumesShop (edible list + rng.int per bite); battlecryConsumeShopRandom' },
    ],
    contentIds: ['dm_agent'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1401). The Agent\'s meal was hard-coded to `rightmostShopMinion`, which in a Demon '
      + 'run is also the slot every right-most buff re-lands on each roll — hence "always the fattest".',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set2Demons.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-SHOP-02',
    title: 'The shop draw is weighted by copies left in the shared pool',
    statement:
      'Each shop roll draws from the run\'s shared, finite pool with probability proportional to the copies each '
      + 'card has left: every remaining copy is one ticket. A card down to its last copy is rarer in exact '
      + 'proportion, and the odds shift gradually as the pool drains — never a cliff where a last copy is as likely '
      + 'as a full stack until it hits zero. Eligibility (tavern tier, active tribes, at least one copy) is '
      + 'unchanged. (The Practice tribe surge that doubled a tribe\'s tickets was retired 2026-09-27 for picked run '
      + 'tribes, R-PRACTICE-SURGE-01.)',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (on Codex\'s review)', quote: 'we need to fix the copies issue - the # of copies should directly impact how likely a card is to be found. the way it is working today is not correct.' },
      { kind: 'code', ref: 'packages/sim/src/shop.ts drawOfferId (ticket weights = stock), called from rollShop and topUpTavern with state.pool' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1406). The draw was uniform by card identity while any copy remained (the only '
      + 'weighted branch was the Practice surge). Every roll now consumes the rng differently, so pre-change seeds '
      + 'produce different shops; no golden pinned specific offers.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopDrawWeight.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-RAND-02',
    title: '"A random Ruby" is one of all six Ruby types at equal odds, drawn per Ruby from the seeded RNG',
    statement:
      'Every "get a random Ruby" (Ruby Shipment, Kobe\'s Pummel, Gem Sage, Resonance, Investment) '
      + 'draws each Ruby SEPARATELY and uniformly from the six types: Ruby, Warding, Golden, Splintered, Ripple and '
      + 'Dark, on the run cursor in the Shop and the fight RNG in combat, so a replay draws the same Rubies. Each '
      + 'is minted at its own printed base plus the run\'s Ruby strength. A plain "get N Rubies" stays plain Rubies.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Ruby batch handoff, 2026-09-24', quote: 'the pool is all 6 types (plain, Warding, Golden, Splintered, Ripple, Dark) at equal odds' },
      { kind: 'code', ref: 'packages/core/src/types.ts RUBY_TYPE_IDS; packages/sim/src/recruit.ts mintRandomRubies; packages/core/src/combat/simulate.ts ctx.grantRandomRubies (playerRubyGrantIds)' },
    ],
    contentIds: ['rubyshipment', 'k_kobe', 'k_gemsage', 'rune_resonance', 'rune_investment', 'k3_dealski'],
    currentBehaviour: 'Conforms as of 2026-09-24.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/rubyTypes.test.ts'], lastVerifiedAt: '2026-09-24' },
  },
  {
    id: 'R-RANDOM-POOL-01',
    title: 'A random minion is always one the Shop could offer this run (no Tier 7 below a Tier 7 Shop)',
    statement:
      'Every effect that summons, gets or grants "a random minion" (of a tribe, a keyword, a trigger family) picks '
      + 'only LEGAL random minions: from the pinned set of the run, never a spell, Ruby, token or henchman, and never above '
      + 'the tier ceiling (6; 7 only while that player\'s Shop stands at Tier 7, in both phases, R-RANDOM-TIER7-01 since '
      + '2026-10-21: Tier-7 access alone no longer opens it). One helper owns it: legalRandomMinionPool in the Shop '
      + '(packages/sim/src/cardPool.ts) and isLegalRandomMinion in combat (packages/core/src/randomPool.ts). Bullseye '
      + 'and Menagerie Mammoth also cap at your Shop tier in the Shop, matching their combat body (owner fix '
      + '2026-08-18). An effect whose text NAMES a tier (Deep, "a random Tier 7 minion") is authored and '
      + 'keeps its tier.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-20', quote: 'a player just got elderhorn from a bullseye from funeral on loan - that shouldnt be possible.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-20', quote: 'orivax can be granted from the rune that gives a dragon when you sell 5 minions. that also should not be possible.' },
      { kind: 'code', ref: 'packages/sim/src/cardPool.ts legalRandomMinionPool + randomTierCeiling; packages/core/src/randomPool.ts isLegalRandomMinion / combatTierCeiling; routed: recruit.ts deathrattleSummonRandomTribe, deathrattleSummonRandomTribeSetStats, rallySummonAndGetRally, grantRandomChooseOne, discoverChooseOne, the shop arena grantRandomFromPool, Rune of the Foundry; factories.ts grantRandomFromPool, rallyGrantChooseOne, rallySummonAndGetRally, battlecryGrantRandomReveler, onKillGrantMagnetic, deathrattleSummonRandomTribe(SetStats); simulate.ts Rune of Salvage' },
    ],
    contentIds: ['b2_bullseye', 'b2_mammoth', 'funeralonloan', 'rune_foundry', 'b2_elderhorn', 'd2_orivax', 'n3_recruiter'],
    currentBehaviour:
      'Conforms as of 2026-10-20. Before: the Shop twins of Bullseye and Mammoth (fired by Funeral on Loan) and Rune '
      + 'of the Foundry built their list off the set pool with no tier bound, so Elderhorn and Orivax (Tier 7) could '
      + 'come out; combat Uncle Orc on an unpinned pool could summon the Tier 7 Kobold Alchemist.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/randomPoolLegal.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-RANDOM-TIER7-01',
    title: 'A random pick gives Tier 7 only while your Shop is at Tier 7, in both phases; Foundry caps at your Shop tier',
    statement:
      'A random minion pick (summon, get, grant or Discover a random minion, including the "tier above your Shop" '
      + 'Discovers) never gives a Tier 7 minion, in the Shop or in combat, unless that player\'s Shop actually stands at '
      + 'Tier 7. Tier-7 ACCESS alone (Open Road, Summit Passage, the Summit rift) with a Tier 6 Shop does not open Tier 7 to a '
      + 'random picker. Foundry\'s random Dragon (every 5 minions sold) is capped at your Shop tier like every '
      + 'other "get a random X". Effects whose text names Tier 7 are authored and keep their tier: Deep, Beyond '
      + 'the Summit, Pete, Strange Revision (and the other printed "up to Tier 7" cards such as Skybound Ascendant and Golden '
      + 'Monkey). The Shop ladder itself is unchanged: access still lets you upgrade to Tier 7.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-21 on Rune of the Foundry', quote: 'yes' },
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-21, on "combat ignores Tier 7 access"', quote: 'cant be getting t7s in combat either' },
      { kind: 'code', ref: 'packages/sim/src/cardPool.ts randomTierCeiling (now combatTierCeiling of the Shop tier); packages/core/src/randomPool.ts combatTierCeiling; recruit.ts Rune of the Foundry (maxTier: Shop tier) and the Clockwork Assistant tierOffset Discover; ancients.ts albusTimeTier; reducer.ts Empowerment and the Lucky Seat prize cap' },
    ],
    contentIds: ['rune_foundry', 'n2_clockwork'],
    currentBehaviour:
      'Conforms, FIXED 2026-10-21: randomTierCeiling returned 7 for any run with Tier-7 access, so with a Tier 6 Shop the '
      + 'random grants, Choose One grants, Rally summons, Clockwork Assistant, Albus (Empowerment and the Ancient of Time '
      + 'Discover) and the Lucky Seat prizes could reach Tier 7 in the Shop while combat (Shop tier read) could not. '
      + 'the Foundry had no Shop-tier cap at all.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/randomTier7Ceiling.test.ts', 'packages/sim/src/randomPoolLegal.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-RANDOM-TIER7-02',
    title: 'Summit rift: the default Discover clamp and Elevation Ritual reach Tier 7 only from a Tier 7 Shop',
    statement:
      'The default Discover clamp (any Discover without an authored tier cap, including the "one tier up" triple reward) '
      + 'and Elevation Ritual\'s cap follow R-RANDOM-TIER7-01: they reach Tier 7 only while the Shop stands at Tier 7, even '
      + 'on a Summit rift run. On a Tier 6 Summit Shop, Elevation Ritual re-rolls a Tier 6 offer within Tier 6. A Discover '
      + 'whose text names Tier 7 (an explicit tier or cap) is authored and unchanged. Provisional: the owner may reverse '
      + 'it, and the whole rule lives in one function (`discoverElevateCeiling`) so a revert is one line.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-21 on the two Summit exceptions left by #2191', quote: 'yes for now, may change this' },
      { kind: 'code', ref: 'packages/sim/src/cardPool.ts discoverElevateCeiling; packages/sim/src/recruit.ts offerDiscover; packages/sim/src/shop.ts elevateShop' },
    ],
    contentIds: ['elevationritual'],
    currentBehaviour: 'Conforms (2026-10-21). Before, both read maxTierFor(rift): 7 on any Summit rift run, whatever the Shop tier.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/randomTier7Ceiling.test.ts'], lastVerifiedAt: '2026-10-21' },
  },
  {
    id: 'R-RAND-RUBY-DISCOVER-01',
    title: 'A Ruby DISCOVER offers only the special Ruby types, never the plain Ruby',
    statement:
      'Every Ruby Discover is WORDED "Discover N special Rubies" (today: the Ruby branch of Prismatic Pick, from Picksy, '
      + '"Discover 2 special Rubies" = two separate Discovers, Gilded four) and offers 3 of the 5 SPECIAL Ruby types (Warding, Golden, Splintered, Ripple, Dark) and '
      + 'never the plain Ruby. The pick is minted at the live run Ruby strength. By contrast "get / play / cast a Ruby" '
      + 'without "random" is the plain Ruby, and "a random Ruby" draws from all six (R-RAND-02).',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: "Owner ruling 2026-10-22 (Set 3 Kobold pool call, \"in picksy's case\")", quote: "it's discovering a ruby which means it's of the random ruby types, this should also NOT discover a regular ruby, only the special ones" },
      { kind: 'owner-chat', ref: 'Owner ruling 2026-10-22 (wording)', quote: "In fact let's change it to discover a special Ruby instead just to further clarify that" },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts discoverRuby (SPECIAL_RUBY_IDS); packages/content/src/equipment.ts PRISMATIC_PICK' },
    ],
    contentIds: ['k3_prismpick'],
    currentBehaviour: 'Conforms (the pool was already special-only since 2026-09-24; pinned across seeds 2026-10-22).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3KoboldPool1022.test.ts', 'packages/sim/src/prismaticPick.test.ts'], lastVerifiedAt: '2026-10-22' },
  },
];
