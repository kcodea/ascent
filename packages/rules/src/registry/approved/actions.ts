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
    id: 'R-VERSUS-CLOCK-LOCK-01',
    title: 'The Shop locks exactly at 0:00, never before: the clock face and the lock read one time-left value (lobby and Versus)',
    statement:
      'ONE RULE for every timed Shop clock: the number shown and the lock come from the same time-left value. The '
      + 'clock shows ceil(ms / 1000) and the Shop locks (R-TIMER-LOCK-01) only once ms <= 0, so it reads 0:01 for the '
      + 'whole last second, every Shop action and hero power goes through while any time is left (1 ms included), and '
      + 'the lock lands as it reads 0:00. LOBBY: the clock steps whole seconds one full period apart and locks on the '
      + 'step that lands on 0 (`shopClockStep`); a hold resumes only the remainder of the second. VERSUS: the same '
      + 'lock applies (the client dispatches `shopClockExpired` at 0:00, then locks the turn with the board as it '
      + 'stands); the time left is the synced server clock plus its own uncertainty (half the best round trip), so a '
      + 'client never reaches 0:00 before the server deadline. The server deadline is authoritative: it accepts a '
      + 'locked side up to 250 ms past the deadline (`versus__shop_grace`), so a lock sent at 0:00 still counts as the '
      + 'player\'s own, rejects anything later (`deadline_passed`, the newest candidate stands in), and closes the round '
      + 'only after the grace. An action completed before 0:00 counts; a drag still in the air at 0:00 that would buy, '
      + 'play or sell is refused and the card goes back, while arranging still lands.',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-16 (Versus clock lock)', quote: 'make sure that everything locks actually like after 0, make sure it doesnt lock early. felt like it was locking a second early sometimes' },
      { kind: 'code', ref: 'packages/ui/src/versus/versusClock.ts (shopClockAt, ServerClock.uncertaintyMs); packages/ui/src/versus/versusStore.ts (versusShopRemainingMs, expireVersusShop, onTick); packages/ui/src/versus/VersusHud.tsx useVersusRecruit; packages/ui/src/turnClock.ts shopClockStep; packages/ui/src/Recruit.tsx countdown tick; supabase/migrations/2026-10-16-versus-clock-grace.sql' },
    ],
    currentBehaviour: 'Conforms (2026-10-16). Before, Versus never applied the 0:00 engine lock, and its client locked the turn '
      + '400 ms BEFORE the deadline on a 500 ms tick, so the shop held while the clock still read 0:01 (the "second '
      + 'early"). The lobby clock already locked on the 0:00 step; it now shares the named rule.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/versus/versusClockLock.test.ts', 'packages/ui/src/versus/versusBot.db.test.ts'], lastVerifiedAt: '2026-10-16' },
  },
  {
    id: 'R-VERSUS-TURN-TIME-01',
    title: 'Versus turns are 15% longer than the lobby schedule; Duos and Ranked Duos turns are 30% longer',
    statement:
      'Every Versus shop clock is the lobby round schedule (`standardTurnSeconds`: 21, 22, 26, 30, 34, 44 ... 92 s) times '
      + 'a per-mode percent, rounded half up to whole seconds: Versus 1v1 and Versus Group x1.15, Versus Duos and Ranked '
      + 'Duos x1.30 (instead of the 15%, not on top). Rounds 1-15: 1v1 / Group 24, 25, 30, 35, 39, 51, 55, 60, 64, 69, '
      + '74, 92, 97, 101, 106; Duos 27, 29, 34, 39, 44, 57, 62, 68, 73, 78, 83, 104, 109, 114, 120. ONE function '
      + '(`versusTurnSeconds`) answers it: the Worker stamps every shop deadline with it for the match mode, and the HUD '
      + 'shows it before a deadline exists, so the face matches the server. Hero Select, the intro cap, combat, pause '
      + 'grace and the Ranked Duos overtime are unchanged. Lobby, Practice and the solo modes keep the plain schedule. '
      + '(Rounds 6 and 9 then add a flat 25 s on top: R-VERSUS-TURN-TIME-02.)',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-30 (Versus clock length)', quote: "let's do a 15% increase in versus/group and a 30% increase for duos" },
      { kind: 'code', ref: 'packages/sim/src/versus/constants.ts (VERSUS_TURN_PERCENT, versusTurnSeconds); workers/versus/src/core/roomCore.ts turnSeconds; workers/versus/src/core/groupMatch.ts openShop / startClock; packages/ui/src/versus/VersusHud.tsx useVersusRecruit' },
    ],
    currentBehaviour: 'Conforms (2026-10-30). Before, every Versus mode used the plain lobby schedule.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/versus/versusTurnSeconds.test.ts', 'workers/versus/test/duosCore.test.ts'], lastVerifiedAt: '2026-10-30' },
  },
  {
    id: 'R-VERSUS-TURN-TIME-02',
    title: 'Live modes: turns 6 and 9 last 25 seconds longer',
    statement:
      'In every live mode (Versus 1v1, Versus Group, Versus Duos, Ranked Duos) the shop clock of rounds 6 and 9 is the '
      + 'scaled length of the mode (R-VERSUS-TURN-TIME-01) plus a flat 25 s, added after the percent. Rounds 1-10: 1v1 / '
      + 'Group 24, 25, 30, 35, 39, 76, 55, 60, 89, 69; Duos / Ranked Duos 27, 29, 34, 39, 44, 82, 62, 68, 98, 78. It is '
      + 'a named table (`LIVE_SHOP_BONUS_SECONDS`) inside `versusTurnSeconds`, so the Worker deadline and the HUD face '
      + 'read the same number and the 0:00 lock never lands early. The ranked solo lobby, Practice and the solo modes '
      + 'keep the plain schedule (`standardTurnSeconds`).',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-11-01 (live turn length)', quote: 'Add 25 seconds to turn 6 and 9 in all live modes, aka all but ranked solos' },
      { kind: 'code', ref: 'packages/sim/src/versus/constants.ts (LIVE_SHOP_BONUS_SECONDS, versusTurnSeconds)' },
    ],
    currentBehaviour: 'Conforms (2026-11-01). Before, rounds 6 and 9 had only the mode percent.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/versus/versusTurnSeconds.test.ts', 'workers/versus/test/roomCore.test.ts', 'workers/versus/test/groupCore.test.ts', 'workers/versus/test/duosCore.test.ts', 'workers/versus/test/rankedCore.test.ts'], lastVerifiedAt: '2026-11-01' },
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
  {
    id: 'R-PLAYLINE-01',
    title: 'A hand minion plays only past the commit line; the warband reacts earlier; blue means it will play; right-click cancels',
    statement:
      'Dragging a minion from the hand uses TWO lines. Past the lower react line the warband opens a slot to make room. '
      + 'A release plays the minion only once it is past the higher commit line too (or on a Magnetic target past it); '
      + 'a release between the two lines springs the card back to its own hand slot, with no play and no hand reorder. '
      + 'The dragged card glows blue exactly when a release would play it, so the glow and the drop always agree '
      + '(one shared check). The commit line is never nearer the hand than the react line. Right-clicking while '
      + 'dragging any card from the hand (minion or spell) drops it back into the hand.',
    domain: 'actions',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-31 (drop zone misplays)', quote: 'can we have it glow green when in the playable zone? i want to do 1, but right clicking should also pull it back to hand' },
      { kind: 'code', ref: 'packages/ui/src/dragDecision.ts handMinionCommits / willCommit; packages/ui/src/Recruit.tsx commitFloorRef + applyDrop + onCtx; packages/ui/src/dragFeel.ts playCommitLine; styles.css .dragcard.willplay' },
    ],
    currentBehaviour: 'Conforms (2026-10-31). Before this one line (playLine) set both the react point and the release-to-play point, so lowering it for an earlier react shrank the cancel area and caused misplays. The right-click cancel is wired in the drag session handler and is not pinned by an automated test (PARTIAL).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/dragDecision.test.ts'], lastVerifiedAt: '2026-10-31' },
  },
];
