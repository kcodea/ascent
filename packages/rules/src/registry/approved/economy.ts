/**
 * APPROVED RULES — domain `economy`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const ECONOMY_RULES: GameRule[] = [
  {
    id: 'R-SHOP-01',
    title: 'The Shop never overflows its capacity',
    statement:
      'The Shop row is sized by its tier and nothing grows it past that: an effect that adds an offer (Rune of '
      + 'Open Enrollment, Pete\'s dominant-type offer, any future "add a minion to the Shop") fills a FREE slot '
      + 'when the row is short and otherwise REPLACES an existing offer, returning the displaced card to the pool. '
      + 'A seventh card at Tier 6 is a defect.',
    domain: 'economy',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'Bug Board 5c5b50a0 (round 1, 2026-08-31, #1325)',
      quote: 'the shop should never overflow beyond its capacity, it should only ever replace available slots with affected minions or spells etc.',
    }],
    contentIds: ['rune_open_enrollment'],
    currentBehaviour:
      'Conforms — #1325: `appendDominantTypeOffer` fills a free slot or replaces the right-most minion offer (Pete\'s '
      + '2026-08-14 shape); the shopCapacity lane sweeps every Shop-growing effect against `tierSlots(tier)`.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/shopCapacity.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-ARMOR-01',
    title: 'Armor gained in the shop lasts until damage removes it',
    statement:
      'Armor is a persistent pool that only damage reduces. Anything that raises it during the shop — Mend\'s "set '
      + 'Armor to 5" (a floor, never a shave) or any other grant — stays until combat damage spends it. There is no '
      + 'per-turn expiry, and in lobby-family runs the player\'s SEAT must fight with the run\'s current pools, not '
      + 'a stale copy taken at creation.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'mend\'s armor falls off after a turn - please fix this as the setting 5 armor effect should last until the armor is damaged/removed from damage.' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts settleCombat (seat 0 re-seeded from the run before the hit) + settleLobbyRound (seat → run write-back); packages/sim/src/recruit.ts setArmor' },
    ],
    contentIds: ['mend'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1400). The seat was seeded from the run once at creation and only ever lost; '
      + '`settleLobbyRound` then wrote the stale seat value back over the run, so Mend\'s Armor vanished one round later. '
      + 'The seat is now re-seeded from the run at combat settle, before either side is charged.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/lobby/runLobby.test.ts', 'packages/sim/src/run.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-SHOP-03',
    title: 'A card granted by a sale can complete a Gild',
    statement:
      'Selling is an action that can GIVE you a card: the copy of the first Dragon sold, a rune\'s payout, a '
      + 'Shout replayed as the body leaves. A card granted that way is an ordinary card in your hand. If it is '
      + 'your third copy it combines into the Gilded version immediately, and that Gilded card pays its Triple '
      + 'Reward when played, exactly as a bought or conjured third copy would. No route that adds a card to hand '
      + 'is exempt from the combine check.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Voicekeeper report)', quote: 'also voicekeeper selling needs a triple check' },
      { kind: 'fix-pr', ref: 'Live spell text + Voicekeeper fix — packages/sim/src/reducer.ts, the sell case now runs checkTriples when the sale grew the hand' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22. The reducer uses an explicit-call convention: each case that can grow the hand calls '
      + 'checkTriples itself, and the sell case was the one that never did. It returns early, and the shared '
      + 'post-action hand-growth check in reduce() cannot help because its baseline is captured after reduceCore '
      + 'has already landed the grant. Three plain copies simply sat in hand. The fix is gated on the hand '
      + 'actually growing, so a sale that grants nothing leaves loose copies alone. The gate decides whether the '
      + 'check RUNS, not what it may combine: checkTriples is board-wide, exactly as it is on every other '
      + 'hand-growth path, so a sale that does grant something also combines any other id already sitting at the '
      + 'threshold. Every other sale route (Dissipate, Parting Gifts, Rune of the Altar) already ran the check '
      + 'through the spell-play or rune-buy path, and checkTriples is idempotent, so nothing combines twice.',
    cardText: 'Voicekeeper: "Get a **plain copy** of the first Dragon you sell each turn."',
    example:
      'Two plain Scalefeathers in hand, a Voicekeeper and a third Scalefeather on board. Sell the Scalefeather: '
      + 'the granted copy is a plain third copy, so you end with one Gilded Scalefeather, and playing it opens the '
      + 'Triple Reward Discover. "Plain" is load-bearing: the granted copy carries no buffs and is never itself '
      + 'Gilded, and it still counts toward the combine.',
    contentIds: ['d2_voicekeeper', 'd2_chronicler'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/set2Dragons.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-EQUIP-01',
    title: 'Thymepiece: Amplified doubles the window; the readout sits above the slot',
    statement:
      'An Amplified Thymepiece activation opens one window of twice the printed seconds (16), plain or gilded; an '
      + 'extra trigger from any other source does not lengthen it, and the discount amount is never multiplied. '
      + 'While the Equipment will fire twice, the rule the slot prints shows the doubled window. The countdown '
      + 'readout sits above the slot, out of layout flow, and moves nothing.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Thymepiece)', quote: 'an amplified timepiece should double the duration' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Thymepiece)', quote: "make timepiece's buff show above the equipment instead of below, and dont let it nudge anything on the screen at all" },
      { kind: 'fix-pr', ref: 'Thymepiece Amplified + readout — packages/sim/src/recruit.ts equipmentCardDiscountWindow (Amplified doubles the window), fireEquipmentTriggers (the amplified flag in the payload), packages/sim/src/equipment.ts equipmentText (amplified), packages/ui/src/styles.css .discountwin' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22. Before this the factory replaced a window with the fresher, larger one, so the second '
      + 'trigger of an Amplified activation re-opened the same 8-second window and Amplified did nothing for the '
      + 'Thymepiece; and the readout was a flow child under the name pill, so its appearance grew the '
      + 'translate-centred slot and shifted the button and the name by half its height.',
    cardText: 'Thymepiece: "All cards cost **1** less Gold for the next **8 seconds**." (Amplified: "**16 seconds**").',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/thymepiece.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
];
