/**
 * APPROVED RULES — domain `actions`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { HANDOFF } from './shared';

export const ACTIONS_RULES: GameRule[] = [
  {
    id: 'R-PLAY-01',
    title: 'What counts as a played card',
    statement:
      'Any card intentionally played from hand counts as a played card — minions, spells, Shop spells, '
      + 'Rubies, Dwarven Ales, Gifts, and future subtypes. Buying, generating, drawing or receiving a card '
      + 'does not play it; reordering does not play it; an automatic or triggered cast is not a card played '
      + 'from hand.',
    domain: 'actions',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'Any card intentionally played from hand counts as a played card.' }],
    // DELIBERATELY UNENFORCED (in the approved-but-unenforced queue): many tests exercise played-card
    // counters incidentally, but no single probe pins the full definition — especially the negative half
    // (buying/generating/drawing/reordering does not play; a triggered cast is not a play). Honest gap.
  },
];
