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
      + 'unchanged; a Practice tribe surge doubles that tribe\'s tickets.',
    domain: 'randomness',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (on Codex\'s review)', quote: 'we need to fix the copies issue - the # of copies should directly impact how likely a card is to be found. the way it is working today is not correct.' },
      { kind: 'code', ref: 'packages/sim/src/shop.ts drawOfferId (ticket weights = stock × surge), called from rollShop and topUpTavern with state.pool' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1406). The draw was uniform by card identity while any copy remained (the only '
      + 'weighted branch was the Practice surge). Every roll now consumes the rng differently, so pre-change seeds '
      + 'produce different shops; no golden pinned specific offers.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopDrawWeight.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
];
