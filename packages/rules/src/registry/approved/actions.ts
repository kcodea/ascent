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
      + 'Untimed runs (tutorial, God sandbox, Practice unlimited time) never reach 0:00, and neither does a Gold Fuse '
      + 'turn (R-TIMER-FUSE-01, R-GAUNTLET-04) whose countdown never started.',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-30 (bug report: Goldspring after the timer)', quote: 'goldspring is usable after timer ends. make sure hero powers cant be used after timer ends' },
      { kind: 'code', ref: 'packages/sim/src/shopClock.ts (SHOP_CLOCK_POLICY, shopLocked, blockedByShopClock); packages/sim/src/reducer.ts reduceCore guard + shopClockExpired; packages/ui/src/Recruit.tsx tick dispatch; packages/ui/src/StatusBar.tsx clockLocked' },
    ],
    currentBehaviour: 'Conforms (2026-09-30). Before this the lock was UI-only and the hero power / Equipment / Henchman buttons never checked it, so an untargeted power (Nadja’s Goldspring) fired at 0:00.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopClock.test.ts', 'packages/ui/src/shopClockLock.test.tsx'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-TRANSFORM-01',
    title: 'Strange Revision: transform a minion into a random minion of the tier above it, keeping its current stats',
    statement:
      'Strange Revision reads "Transform a minion into a random minion of the tier above it. It keeps its stats." It is a '
      + 'targeted recruit-phase spell (a board minion or a Shop minion). The new form is drawn off the run cursor from the '
      + 'own pool of the run (`poolOf`, buyable minions in the run tribes plus neutral) at the printed tier of the target + 1 '
      + '(`strangeRevisionTier`). A Tier 7 target re-rolls into a different Tier 7, the Skybound Ascendant precedent '
      + '(owner 2026-09-09: never a dead line at the top of the curve). The body keeps its CURRENT stored Attack and Health; '
      + 'only its identity changes, so no stat-gain watcher fires. Golden status, the enchantment ledger, per-instance '
      + 'counters and every keyword the body gained are kept; the printed keywords of the old card swap for those of the new card. '
      + 'A Shop minion becomes the new card at the same printed total. An empty destination tier does nothing (the spell is '
      + 'still spent).',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner spell batch 2026-10-10 (Strange Revision)', quote: 'Transform a minion into a random minion of the tier above it. It keeps its stats.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts spellTransformTierUp / strangeRevisionTier / castSpellOnOffer; packages/content/src/cards/set1/spells.ts strangerevision' },
    ],
    contentIds: ['strangerevision'],
    cardText: 'Transform a minion into a random minion of the **tier above it**. It keeps its stats.',
    currentBehaviour: 'Conforms (2026-10-10). Was "Transform a friendly or Shop minion into a random minion of the same tier. It keeps its bonus stats." at 3 Gold.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/spellBatch1010.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
  {
    id: 'R-SETSTATS-TIER-01',
    title: 'Perfect Vision: set a minion to 20/20, or 50/50 at Shop Tier 6, read at the cast; the card text greens the live value',
    statement:
      "Perfect Vision (a Tier 5 targeted spell) reads 'Set a minion's stats to 20/20. Set it to 50/50 if you're Shop Tier 6.' "
      + 'The condition is the CURRENT Shop Tier of the run at the cast (Tier 6 or higher sets 50/50). It is an absolute set, '
      + 'never scaled by spell power, and lands through the stat-spell layer rule (auras re-apply on top). ONE helper '
      + '(`setStatsValue`) answers both the cast and the live card text, which greens whichever value applies right now.',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner spell batch 2026-10-10 (Perfect Vision)', quote: "Set a minion's stats to 20/20. Set it to 50/50 if you're Shop Tier 6." },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts spellSetStats / setStatsValue / spellDisplayText; packages/content/src/cards/set1/spells.ts perfectvision' },
    ],
    contentIds: ['perfectvision'],
    cardText: "Set a minion's stats to **20/20**. Set it to **50/50** if you're **Shop Tier 6**.",
    currentBehaviour: 'Conforms (2026-10-10). Was a Tier 6 spell that always set 20/20.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/spellBatch1010.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
];
