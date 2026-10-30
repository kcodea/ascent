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
      'The Shop row is sized by its tier and nothing grows it past that: an effect that adds an offer ('
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
      + 'threshold. Every other sale route (Dissipate, Parting Gifts, Altar) already ran the check '
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
      'An Amplified Thymepiece activation opens one window of twice the printed seconds (8 to 16, gilded 16 to 32); an '
      + 'extra trigger from any other source does not lengthen it, and the sell bonus amount is never multiplied. '
      + 'While the Equipment will fire twice, the rule the slot prints shows the doubled window. The countdown '
      + 'readout sits above the slot, out of layout flow, and moves nothing.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Thymepiece)', quote: 'an amplified timepiece should double the duration' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Thymepiece)', quote: "make timepiece's buff show above the equipment instead of below, and dont let it nudge anything on the screen at all" },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-21 (Thymepiece sell bonus)', quote: 'Amplified doubles the duration (confirmed)' },
      { kind: 'fix-pr', ref: 'Thymepiece Amplified + readout — packages/sim/src/recruit.ts equipmentSellBonusWindow (Amplified doubles the window), fireEquipmentTriggers (the amplified flag in the payload), packages/sim/src/equipment.ts equipmentText (amplified), packages/ui/src/styles.css .sellwin' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22. Before this the factory replaced a window with the fresher, larger one, so the second '
      + 'trigger of an Amplified activation re-opened the same 8-second window and Amplified did nothing for the '
      + 'Thymepiece; and the readout was a flow child under the name pill, so its appearance grew the '
      + 'translate-centred slot and shifted the button and the name by half its height. Re-verified 2026-10-21 '
      + 'after the rework to a sell bonus (R-EQUIP-THYME-SELL-01): the doubling and the readout carried over unchanged.',
    cardText: 'Thymepiece: "Cards sell for **+1** Gold for the next **8 seconds**." (Amplified: "**16 seconds**"; gilded "**16 seconds**", Amplified "**32 seconds**").',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/thymepiece.test.ts'],
      lastVerifiedAt: '2026-10-21',
    },
  },
  {
    id: 'R-EQUIP-THYME-SELL-01',
    title: 'Thymepiece: cards sell for +1 Gold for the next 8 seconds (16 gilded); it no longer discounts anything',
    statement:
      'Using the Thymepiece opens a window on the turn clock: every card sold while it is open (a board minion, a '
      + 'minion in hand, and every effect that sells one) pays +1 Gold on top of every other sell value. The window '
      + 'lasts 8 seconds, 16 when gilded, doubled when Amplified. The bonus is read at the moment of the sale and '
      + 'stacks with every other sell bonus. The window pauses with the clock and ends on its expiry, at combat entry '
      + 'or at the turn flip. This SUPERSEDES the 2026-09-12 design ("All cards cost 1 less Gold for the next 8 '
      + 'seconds"): no price is discounted any more, and an old save holding an open discount window loads with it '
      + 'dropped.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-21 (Thymepiece rework)', quote: "change thyme's equipment to be: cards sell for +1 gold for the next 10 seconds" },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-21 (Thymepiece rework, correction)', quote: 'the window is 8 SECONDS (not 10), and 16 seconds when GILDED' },
      { kind: 'fix-pr', ref: 'feat/thymepiece-sell-bonus — packages/sim/src/recruit.ts sellValueOf (the +1 at the one sell-price boundary) and equipmentSellBonusWindow; packages/sim/src/state.ts deserialize drops cardDiscountWindow; packages/sim/src/reducer.ts offerBuyPrice loses the window discount' },
    ],
    currentBehaviour:
      'Conforms — 2026-10-21. The bonus lives in sellValueOf, the helper every sale path calls (the sell action, '
      + 'Dissipate, Parting Gifts, Fodder Treatment, Feed the Alpha, Altar) and the sell float reads, so '
      + 'the Gold shown is the Gold paid. It adds on top of an overridden sell value too (a Bargain Bin minion sells '
      + 'for 1 while the window is open).',
    cardText: 'Thymepiece: "Cards sell for **+1** Gold for the next **8 seconds**." Gilded: "…for the next **16 seconds**."',
    example:
      'You use the Thymepiece with 40 seconds on the clock, then sell a Keg Runner at 33 seconds: 1 base + 2 from '
      + 'its Sell + 1 from the Thymepiece = 4 Gold. At 32 seconds the window closes, and a sale after that pays the '
      + 'normal amount.',
    contentIds: ['dw3_thymes'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/thymepiece.test.ts'],
      lastVerifiedAt: '2026-10-21',
    },
  },
  {
    id: 'R-EQUIP-02',
    title: 'Gold paid to use an Equipment counts as Gold spent',
    statement:
      'Gold the player pays to activate an Equipment is Gold spent, exactly like Gold paid to buy, refresh or tier '
      + 'up: it advances the run and per-turn Gold-spent tallies and every Spend consumer (a card\'s "when you '
      + 'spend N Gold" meter, Gold-spent runes, "Spend N Gold" quests, "Gold spent this turn" scalers). A use that '
      + 'costs 0 spends nothing.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Equipment Gold)', quote: 'this should count as gold spent' },
      { kind: 'code', ref: "packages/sim/src/reducer.ts — the 'activateEquipment' case now pays through `spendGold` (the single Gold-spend chokepoint) instead of a bare `s.embers -= cost`" },
    ],
    contentIds: ['e3_frank', 'dw_coinfire'],
    currentBehaviour:
      'Conforms — 2026-09-29. Before this the activation deducted Gold directly (`s.embers -= cost`), so no Gold-spent '
      + 'tally, meter, rune or quest ever saw an Equipment payment. Equipment can only be paid for in the recruit '
      + 'phase; the other Equipment fires (Dismantling, Counterrotation, Overcharge) are free.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/equipmentGoldSpent.test.ts'],
      lastVerifiedAt: '2026-09-29',
    },
  },
  {
    id: 'R-EOT-ECON-01',
    title: 'An End-of-Turn trigger that moves a Shop number gets its own beat, the self buff burst on that control, and the number moves on the beat',
    statement:
      'Every End-of-Turn trigger that changes a Shop resource (the upgrade price, free Refreshes, Gold banked for next '
      + 'turn, max Gold) carries a resourceChanged consequence on its OWN beat, whatever the source: a minion, a rune '
      + 'recurrence, an Ancient pairing. The consequence carries the number the HUD prints (the upgrade PRICE, '
      + 'surcharges and cuts folded in, never the raw running cost). On that beat the authored self-buff-burst def plays '
      + 'on the control that owns the number (the Tier button for the upgrade price, the Refresh button for free '
      + 'Refreshes, the Gold pill for Gold), and the printed number changes at that moment, not at the commit. '
      + 'Replays play the same beats from the recorded batch.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner ask 2026-10-02, relayed verbatim by the coordinator',
        quote: 'make sure when we have end of turn things that they have beats and modify what they need to. for example rune of shopkeep and frugal with the ancient of time modifier - nothing plays or shows that that is happening at all. please make sure these triggers have a beat. use the self buff burst fx on the shop tier button when this effect triggers',
      },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts (withRecruitTrigger econ diff: econSnapshot / emitEconDiff; Rune of Shopkeep emits the printed price); packages/ui/src/choreographer/resourceFx.ts (resource -> HUD control + self-buff-burst); packages/ui/src/Recruit.tsx (resourceChanged presenter, eotResources on the Tier / Refresh / Gold props)' },
    ],
    contentIds: ['rune_shopkeep', 'rune_coffers', 'scrapvendor', 'c3_nym'],
    currentBehaviour:
      'Conforms as of 2026-10-02. Before it Shopkeep compiled a beat whose resourceChanged presenter was a no-op '
      + 'and the Tier button read the committed run, so the price only changed after the Shop had left the screen; '
      + 'Tradesman x Time, Robin x Time and Xerox x Fortune compiled EMPTY beats (the End-of-Turn scope diff never '
      + 'looked at the economy); Scrap Vendor and Starbroker Nym banked next-turn Gold with no consequence.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreographer/eotEconomyBeats.test.ts'], lastVerifiedAt: '2026-10-02' },
  },
  {
    id: 'R-EOT-AMPLIFY-01',
    title: 'Amplification gets its own End-of-Turn beat on the Equipment slot, and the slot turns Amplified on that beat',
    statement:
      'When Amplification Amplifies Equipment at End of Turn, it plays its OWN beat: the authored self-buff-burst '
      + 'def plays on the Equipment slot, and the slot\'s charge turns to its Amplified (blue) state at that moment, not '
      + 'before and not only at the commit. One counterChanged consequence (equipmentAmplified:<id>) rides the beat per '
      + 'Equipment Amplified. When nothing is Amplified (every Equipment was used, or already at the maximum) no beat '
      + 'plays. Replays play the same beat from the recorded batch.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner decision 2026-10-03 (the follow-up the R-EOT-ECON-01 audit listed)', quote: 'Where should Rune of Amplification\'s End of Turn effect play? i think it should get an end of turn beat' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts (the rune_amplification End-of-Turn scope, discardIfEmpty, EQUIPMENT_AMPLIFIED_COUNTER); packages/core/src/presentation/policies.ts rune:rune_amplification:endOfTurn; packages/ui/src/choreographer/equipmentFx.ts; packages/ui/src/Recruit.tsx (counterChanged presenter, setEotAmplified); packages/ui/src/StatusBar.tsx (equipAmplified folds the delivered ids while the End-of-Turn lock holds)' },
    ],
    contentIds: ['rune_amplification'],
    currentBehaviour:
      'Conforms as of 2026-10-03. Before it the rune Amplified unused Equipment at End of Turn with no beat and no '
      + 'consequence, so the slot only turned blue after the commit with nothing played.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreographer/eotAmplificationBeat.test.ts'], lastVerifiedAt: '2026-10-03' },
  },
  {
    id: 'R-ALE-TIER-01',
    title: 'Doubletap Brewer: an End of Turn Ale, and another at Shop Tier 5 or higher, one count in both phases',
    statement:
      'Doubletap Brewer reads "End of Turn: Get a Dwarven Ale. Get another if you are Shop Tier 5+." The condition is '
      + 'the side\'s CURRENT Shop Tier when the effect fires: below Tier 5 it hands over one random Dwarven Ale, at Tier 5 '
      + 'or higher two. Gilded doubles the whole grant (2, or 4 at Tier 5+). The count is ONE shared function '
      + '(`aleGrantCount`: `count`, plus `bonusCount` at or above `bonusAtTier`) read by the shop (`state.tier`), by '
      + 'combat (`tierFor(side)`) and by the live card text, which adds a green "(N Ales now)" once the tier is met. A '
      + 'set without the Ales grants nothing, as before.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Doubletap Brewer; the owner chose the wording)', quote: 'End of Turn: Get a Dwarven Ale. Get another if you are Shop Tier 5+.' },
      { kind: 'code', ref: 'packages/core/src/types.ts aleGrantCount; packages/sim/src/recruit.ts grantRandomAle; packages/core/src/effects/factories.ts grantRandomAle; packages/ui/src/cardText.ts aleTierText; packages/content/src/cards/set2/dwarves.ts dw_brewer' },
    ],
    contentIds: ['dw_brewer'],
    cardText: '**End of Turn:** get a **Dwarven Ale**. Get another if you are **Shop Tier 5+**.',
    currentBehaviour: 'Conforms (2026-10-10). Was a T5 4/3 with "Shout: get a Dwarven Ale. Echo: get a Dwarven Ale."',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/balanceBatch1010.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
  {
    id: 'R-SHOP-04',
    title: 'Every new Shop offer carries the Shop buffs, whatever served it',
    statement:
      'A minion that enters the Shop carries the same Shop buffs whichever path put it there: an ordinary or turn-start '
      + 'refresh, a frozen top-up, Sigil of Kinship, Elevation Ritual, Spell Cart, Grand Larceny, Muster, '
      + 'Membrance, the Bargain Bin, Open Enrollment, Pete, Restocking, Albus, or an "add a card to the Shop" '
      + 'effect such as the Golden Monkey from Indy. Per-offer stamps (the Veinstorm Rubies, the Attachment Issues price, the '
      + 'Enchanted roll) run through ONE function, `stampNewShopOffers`. A new offer that REPLACES the enchanted '
      + 'right-most or left-most offer takes the enchant of that slot (Market Tormentor, Picnic, Display Case). A spell '
      + 'that says "Refresh" (Sigil of Kinship, Spell Cart, Grand Larceny) is a refresh: it runs the same refresh tail '
      + '(slot enchants, Embers, Endless Inventory, refresh watchers) and keeps Layaway offers. Run-wide '
      + 'Shop buffs are read live by every offer, so they need no stamp.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-10-14 (bug report)', quote: 'sigil of kinship refreshes dont have minions with shop buffs - this must be fixed as well' },
      { kind: 'code', ref: 'packages/sim/src/shop.ts stampNewShopOffers (called by every Shop-populating path in shop.ts, recruit.ts and reducer.ts)' },
    ],
    contentIds: ['sigilkinship', 'elevationritual', 'spellcart', 'veinstorm', 'sp_picnic', 'rune_display_case'],
    currentBehaviour:
      'Conforms as of 2026-10-14. Before it the stamps lived inline in the ordinary roll, so a Sigil of Kinship row '
      + '(and Elevation, a frozen top-up, the Golden Monkey, Pete, Open Enrollment) served bare offers with no Veinstorm '
      + 'Rubies and no slot enchant.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/shopOfferStamp.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
  {
    id: 'R-SCROLL-DRAKE-01',
    title: 'Scroll Drake: Shop spells cost less, and every Shop roll trades one minion for a spell',
    statement:
      'While a Scroll Drake (Set 3, Tier 3 Dragon/Spirit) is on your board, every Shop spell costs 1 less per copy '
      + '(2 less Gilded), stacking with every other spell discount and floored at 0. The discount is a live board read '
      + '(`spellCostReduction`), so it applies the moment the Drake is played and ends the moment it is sold or '
      + 'destroyed, on every price surface. Every Shop roll (turn start, every refresh, a frozen top-up) serves ONE '
      + 'spell in the minion row in place of a minion, at every tier, so the total offer count never grows. Any '
      + 'number of copies (or a Gilded one) still adds only one extra spell. A kept or frozen spell in the row already '
      + 'counts, the Starform keeps its pinned slot, and a run without the Drake rolls exactly as before.',
    domain: 'economy',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner design 2026-10-30 (via the lead session)', quote: "This will replace a minion at highest shop tiers so that the shop doesn't have more total offers" },
      { kind: 'owner-chat', ref: 'Owner follow-up 2026-10-30', quote: 'Actually make it a dragon spirit. Golden is 2 less' },
      { kind: 'code', ref: 'packages/sim/src/shop.ts extraRowSpells / rollShopRow / topUpTavern; packages/sim/src/recruit.ts spellCostReduction; packages/content/src/cards/set3/dragons.ts d3_scrolldrake' },
    ],
    contentIds: ['d3_scrolldrake'],
    cardText: '**Shop spells** cost **1** less. Each Shop has an extra spell in place of a minion.',
    currentBehaviour: 'Conforms (2026-10-30, new card). Name and stats are placeholders.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/scrollDrake.test.ts'], lastVerifiedAt: '2026-10-30' },
  },
];
