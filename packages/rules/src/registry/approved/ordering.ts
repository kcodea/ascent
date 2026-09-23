/**
 * APPROVED RULES — domain `ordering`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const ORDERING_RULES: GameRule[] = [
  {
    id: 'R-ORD-01',
    title: 'Improving grants read their step live, even mid-wave',
    statement:
      'An improving grant re-reads its current step for EVERY individual application, including within one '
      + 'simultaneous wave: when one Cleave kills two Mama Pups under Beardsley, the four summoned Pups are '
      + 'paid +3/+3, +3/+3, +3/+3, then +6/+6 — the step advances mid-resolution. Depth-first resolution '
      + 'with live magnitudes is the engine-wide rule.',
    domain: 'ordering',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-order-improve-steps-mid-resolution (triage round 2, 2026-08-27)', quote: 'APPROVE — live steps are the rule; every summon re-reads the current step, waves included.' }],
    currentBehaviour: 'Conforms — golden G4 (orderGoldens.test.ts) pins the mid-wave step advance.',
    enforcement: { kind: 'oracle', refs: ['orderGoldens'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-ORD-02',
    title: 'Shop: on-summon auras resolve before the played minion\'s own Shout',
    statement:
      'Playing a minion fires on-summon auras on it (with live improve steps) BEFORE its own Shout/Battlecry '
      + 'resolves: Den Mother grants the played Pennycat the base +2/+2, improves, and Pennycat\'s '
      + 'Shout-summoned Stray then receives the improved +4/+4. This is combat\'s R-ORD-01 rule applied '
      + 'consistently in the shop.',
    domain: 'ordering',
    status: 'approved',
    evidence: [{ kind: 'owner-chat', ref: 'decisions.json q-order-shop-aura-before-shout (triage round 2, 2026-08-27)', quote: 'APPROVE — aura-first with live improve steps is the rule (matches combat\'s G4 ruling).' }],
    currentBehaviour: 'Conforms — golden G6 (orderGoldens.test.ts) pins aura-before-Shout with the improved grant on the token.',
    enforcement: { kind: 'oracle', refs: ['orderGoldens'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-ORD-03',
    title: 'A right-most Consume always takes the right-most edible offer — a bonus bite never displaces it',
    statement:
      'A card that Consumes "the right-most minion in the Shop" (Bob Blart, Grevlin & Co., Rune of Hunger) eats the '
      + 'right-most EDIBLE offer — the last minion in the row, skipping any spell or Ruby to its right — every time '
      + 'it fires, and the check never fails while an edible offer exists. An extra Consume granted alongside it '
      + '(Bottomless Banquet\'s "the first Consume each turn eats twice") takes ANOTHER offer and must not shift the '
      + 'row under the primary pick: the named target is still eaten.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (Mike\'s report, relayed)', quote: 'blart always consumes right-most and never fails that check' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts consumeShopMinion (the primary offer re-resolved by uid after the Banquet bite); rightmostShopMinion; consumeShopRightmost' },
    ],
    contentIds: ['dm_gourmand', 'dm_grevlin'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1401). The Banquet bite spliced the row BEFORE the primary bite, so a right-most '
      + 'index fell off the end: only the left-most was eaten and the right-most survived.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set2Demons.test.ts', 'packages/sim/src/set2FinalQuests.test.ts', 'packages/sim/src/contentBatchAug14.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-ORD-04',
    title: 'A shop Rise resolves — and is SHOWN — after its Echo, on its own beat',
    statement:
      'When a minion with Rise dies in the shop (Deathfibrillator, Cage Breaker, Funeral on Loan), its Echo and the '
      + 'death watchers resolve first and the body returns afterwards — and the presentation must read the same way: '
      + 'the return is its own beat, opened after the death/Echo beat closes, exactly as combat gives the reborn '
      + 'return its own resolution step. The risen body may never land in the same commit as the Echo.',
    domain: 'ordering',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'deathfibrillator - the minion is rising before triggering the echo, which is wrong. a minion\'s echo always goes off before it rises.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts settlePendingDeath (death beat `system:destroy:shopDeath`, then a `system:destroy:shopRise` beat for riseReturn + fireOnRise); packages/core/src/combat/simulate.ts killOrReborn (the second nextStep before `reborn`)' },
    ],
    contentIds: ['u3_ems', 'u3_cagebreaker'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1402). The state order was already Echo → watchers → Rise (R-RISE-05); the shop '
      + 'ran the return inside the death beat, so the new body was on screen the instant the Echo played.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts', 'packages/sim/src/shopDestroy.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
];
