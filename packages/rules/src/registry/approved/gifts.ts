/**
 * APPROVED RULES — domain `gifts`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const GIFTS_RULES: GameRule[] = [
  {
    id: 'R-GIFT-01',
    title: 'A targeted Gift pays out on the minion the player chose',
    statement:
      'Kindness\'s targeted Gifts (Unbridled Might, Ironclad, Regalia, Parting Gifts) do exactly what they print '
      + 'to the chosen target — the cast payload carries the aimed minion, and a Gift whose text says "then" '
      + 'applies its steps in printed order (+2 Attack, THEN double). Mirrorwing pays its once-per-turn re-cast '
      + 'once, never for a Gift with no target.',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1374 (Bug Board 9852e16f, priority 6)', quote: 'give a minion + 2 attack and then double its attack is broken on mirrorwing. zero effect.' },
      { kind: 'card-text', ref: 'packages/content/src/cards/gifts.ts', quote: 'Give a friendly minion **+2 Attack**, then **double its Attack**.' },
    ],
    contentIds: ['gift_unbridled', 'gift_ironclad', 'gift_regalia', 'gift_parting_gifts'],
    currentBehaviour:
      'Conforms — #1374: `applyCastEffects` in recruit.ts hands the targeted factories `payload.target` (they '
      + 'read `target`, the payload only carried `minion`), so every targeted Gift resolves on the aimed body. '
      + 'Pinned per Gift, through the real reducer.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/gifts.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
];
