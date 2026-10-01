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
  {
    id: 'R-TIMER-LOCK-01',
    title: 'No hero power, Equipment or other Shop action after the Shop timer runs out',
    statement:
      'Once the Shop turn timer reaches 0:00, the player can no longer use a hero power (either Void slot, '
      + 'targeted or untargeted, Clearance stacks included), activate Equipment, buy, sell, play a card from hand, '
      + 'refresh, upgrade the Shop or recruit a Henchman until the next Shop turn. Ending the turn, Freeze, '
      + 'rearranging the board / hand / Shop, swapping the shown Equipment and answering an open choice stay '
      + 'available. Passive powers and End of Turn triggers are not player actions and resolve as normal. The '
      + 'engine enforces it (one shared table, `SHOP_CLOCK_POLICY`), and the buttons render dead on the same tick. '
      + 'Untimed runs (tutorial, God sandbox, Practice unlimited time) never reach 0:00.',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (bug report: Goldspring after the timer)', quote: 'goldspring is usable after timer ends. make sure hero powers cant be used after timer ends' },
      { kind: 'code', ref: 'packages/sim/src/shopClock.ts (SHOP_CLOCK_POLICY, shopLocked, blockedByShopClock); packages/sim/src/reducer.ts reduceCore guard + shopClockExpired; packages/ui/src/Recruit.tsx tick dispatch; packages/ui/src/StatusBar.tsx clockLocked' },
    ],
    currentBehaviour: 'Conforms (2026-09-30). Before this the lock was UI-only and the hero power / Equipment / Henchman buttons never checked it, so an untargeted power (Nadja’s Goldspring) fired at 0:00.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopClock.test.ts', 'packages/ui/src/shopClockLock.test.tsx'], lastVerifiedAt: '2026-09-30' },
  },
];
