/**
 * HAND-AUTHORED pending rulings — the 2026-08-27 triage round 2 (owner ask: "i need it to explain in simple
 * terms/detail with examples what is wrong and then i can answer").
 *
 * Unlike pending.generated.ts this file is NOT rewritten by `npm run rules:seed` — these cards survive every
 * reseed untouched. Same schema, same board, same decision flow: decisions.json applies to these ids exactly
 * as to generated ones. Every card is self-contained (owner format feedback 2026-08-26): verbatim printed
 * text, what the code does TODAY (each claim re-verified in source on 2026-08-27), one concrete example, and
 * explicit click semantics.
 *
 * Four groups:
 *  · q-runedup-*   — the per-family rune duplicate stacking proposal
 *                    (docs/rulebook/rune-duplicate-stacking-proposal.md; the owner REJECTED "duplicates do
 *                    nothing" on 2026-08-26 — each card asks to approve ONE family's stacking rule).
 *  · q-copy/carry/snap-* — copy, carry-over and snapshot-fidelity questions (snapshotRegistry / carryOverScan
 *                    needs-triage entries, PR #1248 / #1226 judgement calls).
 *  · q-order-*     — the four order ambiguities from docs/rulebook/order-ambiguities.md, enriched with the
 *                    concrete fixtures of packages/sim/src/docbot/orderGoldens.test.ts.
 *  · q-interact-*  — the four interaction ambiguities from docs/rulebook/interaction-ambiguities.md
 *                    (trigger-family matrix scan), with current behaviour re-verified against source.
 */
import type { GameRule } from '../schema';

export const MANUAL_PENDING: GameRule[] = [
  // ────────────────────────────── A. RUNE DUPLICATE STACKING (one click per family) ──────────────────────────────
  {
    id: 'q-runedup-recurring',
    title: 'Rune duplicates, family 1/8 — recurring & per-event runes: second copy doubles the recurrence',
    statement:
      'These 28 runes fire repeatedly (End of Turn, Start of Turn, each turn, or every time a watched event happens) — '
      + 'but buying a SECOND copy does nothing at all (Doc Bot: Gold spent, zero state change). Proposed family rule: '
      + 'a second copy makes the effect fire ONCE MORE each time it recurs — two Rune of the Coffers = +2 max Gold at '
      + 'End of Turn, two Rune of the Flagship = Dwarves get +4/+4 per Shop spell. '
      + '— ✓ Approve = adopt the rule for this whole family (second copy doubles the recurrence; Claude implements it in a follow-up PR). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = this family does NOT stack — duplicates fall back to the universal sweetener (family 6/8) instead.',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential', quote: 'secondSwallowed: a second copy is purchasable and changes nothing' }],
    currentBehaviour: 'A second copy of every rune listed: Gold spent, zero state change (Doc Bot runeSwallowScan, 2026-08-27). The forge can re-offer an owned rune, and Rune of Duplication can copy the Epics.',
    recommendation: 'Second copy doubles the recurrence (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Rune of the Coffers (5g): "End of Turn: increase your maximum Gold by 1." · '
      + 'Rune of the Deep (6g, Epic): "Each turn, get a random Tier 7 minion." · '
      + 'Rune of the Lapidary (5g, Epic): "End of Turn: play a Ruby on a random minion for every card you played this turn." · '
      + 'Rune of Lasting Cadence (5g, Epic): "End of Turn: trigger all your Rally effects." · '
      + 'Rune of the Crucible Choir (6g, Epic): "End of Turn: trigger your left-most Shout, then your left-most Echo." · '
      + 'Rune of the Pendant (3g): "Start of Turn: make a random friendly minion Tier 4 or below Gilded." · '
      + 'Rune of the Strange Caravan (3g): "Start of Turn: get a random minion from a type you do not control." · '
      + 'Rune of Copies (3g, Epic): "Start of shop: get a copy of a random minion on your board." · '
      + 'Rune of the Summit (3g): "In 3 turns: Discover a Tier 7 minion. Repeats every 3 turns." · '
      + 'Rune of the Flagship (3g): "Whenever you cast a Shop spell, give your Dwarves +2/+2." · '
      + 'Rune of Scales (2g, Epic): "Whenever you cast a Shop spell, give your Dragons +4/+5." · '
      + 'Rune of Kindling (4g): "Whenever you cast a Shop spell, give your left and right-most minions +4/+6." · '
      + 'Rune of Enchantment (5g, Epic): "Whenever you cast a Shop spell, give your minions +2/+3 permanently (+4/+6 during combat)." · '
      + 'Rune of Lorekeeping (3g): "Whenever you cast a Shop spell on a minion, give it an extra +4/+4." · '
      + 'Rune of Might (6g, Epic): "Whenever you cast a spell, cast Might of Aeon." · '
      + 'Rune of the Seller\'s Market (3g, Epic): "Whenever you sell a minion, give your minions +4/+3." · '
      + 'Rune of the Baller (4g): "When you sell a minion, give your minions +1 Attack. Alternates between Attack and Health, improving every 2 sales." · '
      + 'Rune of Profit Sharing (4g, Epic): "Whenever you gain Gold, give your Dwarves +3/+3." · '
      + 'Rune of the Runic Hoard (4g): "After you add a copy of a Shop spell to your hand, give your Dragons +1/+1." · '
      + 'Rune of Draconic Curiosity (4g): "Whenever you Discover a Dragon, get a random Shop spell." · '
      + 'Rune of Hoardcalling (4g): "After your first Dragon Shout each turn, get a random Shop spell." · '
      + 'Rune of Refreshments (1g, Epic): "When you play a Demon, gain a free refresh." · '
      + 'Rune of the Chipper Sticker (5g, Epic): "Whenever you play a Demon, another friendly Demon Consumes a minion in the Shop." · '
      + 'Rune of Consumption (4g): "Whenever you Consume Fodder, improve future Fodder by +1 Attack or +1 Health (random)." · '
      + 'Rune of Transfusion (4g, Epic): "Whenever a Demon Consumes Fodder, your left-most minion also gains its stats." · '
      + 'Rune of Living Growth (5g, Epic): "Whenever Mushy creates a Growth, improve future Growths by +1/+1." · '
      + 'Rune of Shared Spoils (4g): "Whenever your left-most Dwarf gains stats, give your right-most Dwarf the same stats." · '
      + 'Rune of the Motherlode (5g, Epic): "Whenever you get a Ruby, play a copy on 2 random friendly minions."',
    example:
      'Example: you own Rune of the Flagship (Shop spells give your Dwarves +2/+2). The forge offers Flagship again and you pay 3 Gold. '
      + 'Today: nothing whatsoever changes — every future Shop spell still gives +2/+2. Under the proposed rule: every Shop spell now gives your Dwarves +4/+4 (the effect fires once per copy).',
    contentIds: [
      'rune_coffers', 'rune_deep', 'rune_lapidary', 'rune_lasting_cadence', 'rune_crucible_choir', 'rune_pendant',
      'rune_strange_caravan', 'rune_copies', 'rune_summit', 'rune_flagship', 'rune_scales', 'rune_kindling',
      'rune_enchantment', 'rune_lorekeeping', 'rune_might', 'rune_sellers_market', 'rune_baller', 'rune_profit_sharing',
      'rune_runic_hoard', 'rune_draconic_curiosity', 'rune_hoardcalling', 'rune_refreshments', 'rune_chipper_sticker',
      'rune_consumption', 'rune_transfusion', 'rune_living_growth', 'rune_shared_spoils', 'rune_motherlode',
    ],
    sourceQueue: 'runeRewardDifferential',
  },
  {
    id: 'q-runedup-threshold',
    title: 'Rune duplicates, family 2/8 — threshold/meter runes: second copy doubles the payoff rate',
    statement:
      'These 8 runes fill a meter toward a payoff ("when you kill 6 enemies…", "after you sell 5 minions…"). A second copy '
      + 'does nothing today. Proposed family rule: a second copy runs a PARALLEL meter at the same rate — mathematically the '
      + 'same as doubling the payoff rate (equivalently: each event counts twice toward the threshold). The two once-per-run '
      + 'thresholds (Golden Splinter, Vault) instead re-arm: the second copy pays the reward a second time when reached. '
      + '— ✓ Approve = adopt the parallel-meter rule for this family (once-per-run thresholds re-arm; Claude implements it in a follow-up PR). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = this family does NOT stack — duplicates fall back to the universal sweetener (family 6/8) instead.',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential' }],
    currentBehaviour:
      'A second copy of every rune listed: Gold spent, zero state change (Doc Bot runeSwallowScan, 2026-08-27). Note the two '
      + 'combat-side ones (Returning Pack, Grave Refreshment) are amount-carrying combat flags whose amount is a THRESHOLD, '
      + 'not a payout — so the post-#900 "amounts accumulate" contract does not help them (naively summing would make the '
      + 'threshold 12 Beasts, i.e. WORSE).',
    recommendation: 'Parallel meters — a second copy doubles the payoff rate (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Rune of the Returning Pack (4g): "After you summon 6 Beasts in combat, get a random Beast." · '
      + 'Rune of Grave Refreshment (3g): "For every 2 friendly Echoes triggered in combat, gain a free refresh next turn." · '
      + 'Rune of the Foundry (4g, Epic): "After you sell 5 minions, get a random Dragon." · '
      + 'Rune of the Crown (4g, Epic): "After you cast 6 Shop spells, your Shop spells give an extra +4/+4." · '
      + 'Rune of Echoed Arrival (4g): "Every 5th Echo minion you play triggers its Echo." · '
      + 'Rune of the Collector (4g): "After you buy cards from 3 different types in a turn, Discover a minion from one of those types. Once per turn." · '
      + 'Rune of the Golden Splinter (3g): "When you have 15 Gold, get a random Golden Tier 5 minion. Once per run." · '
      + 'Rune of the Vault (2g): "When you reach Shop Tier 5, gain 10 Gold."',
    example:
      'Example: you own Rune of the Foundry (sell 5 minions → a random Dragon) and buy a second copy. Today: 4 Gold, nothing changes. '
      + 'Under the proposed rule: each sale advances BOTH meters, so you receive a Dragon every 5 sales from each — i.e. two Dragons per 5 sales, one per 2.5 sales on average.',
    contentIds: [
      'rune_returning_pack', 'rune_grave_refreshment', 'rune_foundry', 'rune_crown', 'rune_echoed_arrival',
      'rune_collector', 'rune_golden_splinter', 'rune_vault',
    ],
    sourceQueue: 'runeRewardDifferential',
  },
  {
    id: 'q-runedup-repeat',
    title: 'Rune duplicates, family 3/8 — repeat runes: +1 repetition per copy',
    statement:
      'These runes make something trigger extra times (Shouts, Rallies, Echoes, Ruby bounces, hero power, Improves, Triple '
      + 'Rewards, spell casts). Proposed family rule: EACH copy adds one more repetition — two Rune of the Wishbone = hero '
      + 'power fires 3 times, two Rune of Adventuring = Rallies trigger 3 times. The multiplier plumbing already exists '
      + '(extraTriggerFires / the additive per-family folds), so this is a count bump per family. The 7 runes listed first '
      + 'are dead buys today; the classic repeat-reward runes listed after them (Stampede, Adventuring, Choir, Blasting '
      + 'Voices, Catacomb, Rising Echoes, Living Magic, Perfect Recall, Hoardflame, Dragon Breath) are covered by the same '
      + 'rule so the family has ONE answer. '
      + '— ✓ Approve = adopt +1 repetition per copy for the whole repeat family (Claude implements it in a follow-up PR). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = repeat runes do NOT stack — duplicates fall back to the universal sweetener (family 6/8) instead.',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential' }],
    currentBehaviour:
      'The first 7 listed: a second copy is Gold spent, zero state change (Doc Bot runeSwallowScan, 2026-08-27). The classic '
      + 'repeat-reward runes (shoutRepeat/rallyRepeat/echoRepeat/spellDouble/spellEcho kinds) are NOT in the dead-buy list — '
      + 'a second copy does change run state — but no rule pins what a duplicate is supposed to DO, so they ride this family card.',
    recommendation: '+1 repetition per copy (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Dead buys today — Rune of the Wishbone (2g): "Your Hero Power triggers twice." · '
      + 'Rune of Shared Pour (3g): "Your first Dwarven Ale each turn casts an additional time." · '
      + 'Rune of the Conduit (5g, Epic): "Your Rubies all bounce an additional time." · '
      + 'Rune of Mastery (7g, Epic): "Whenever one of your effects Improves, it improves an additional time." · '
      + 'Rune of the Corrupted Tome (4g, Epic): "Whenever you get a Triple Reward, get two Triple Rewards instead." · '
      + 'Rune of Combat Prowess (5g, Epic): "Your Start of Combat effects also trigger at End of Turn." · '
      + 'Rune of the Last Word (4g): "The first Dragon with a Shout you sell each turn triggers its Shout before being sold." — '
      + 'Same family, not dead buys — Rune of the Stampede (5g): "Your first friendly Rally each combat triggers twice." · '
      + 'Rune of Adventuring (6g, Epic): "Your Rally effects trigger twice." · '
      + 'Rune of the Choir (4g, Epic): "Your Shouts trigger an additional time. Get a Shout minion." · '
      + 'Rune of Blasting Voices (6g, Epic): "Your Shouts trigger 2 extra times in combat." · '
      + 'Rune of the Catacomb (3g): "Discover an Echo minion. Your first Echo triggered in combat triggers twice." · '
      + 'Rune of Rising Echoes (4g, Epic): "Discover an Echo minion. Give it Rise and Taunt. Your first Echo triggers an additional time in combat." · '
      + 'Rune of Living Magic (4g): "Once per turn, after you cast a spell, get a copy of it." · '
      + 'Rune of Perfect Recall (6g, Epic): "Twice per turn, after you cast a spell, get a copy of it." · '
      + 'Rune of Hoardflame (2g): "Get a Hoardflame. Repeat every Start of Turn. They cast twice." · '
      + 'Rune of Dragon Breath (4g, Epic): "Get a Dragonflame. Repeat every Start of Turn. They cast twice."',
    example:
      'Example: you own Rune of the Wishbone (Hero Power triggers twice) and buy a second copy. Today: 2 Gold, nothing changes. '
      + 'Under the proposed rule: your Hero Power triggers 3 times (base + 1 per copy).',
    contentIds: [
      'rune_wishbone', 'rune_shared_pour', 'rune_conduit', 'rune_mastery', 'rune_corrupted_tome', 'rune_combat_prowess',
      'rune_last_word', 'rune_stampede', 'rune_adventuring', 'rune_choir', 'rune_blasting_voices', 'rune_catacomb',
      'rune_rising_echoes', 'rune_living_magic', 'rune_perfect_recall', 'rune_hoardflame', 'rune_dragon_breath',
    ],
    sourceQueue: 'runeRewardDifferential',
  },
  {
    id: 'q-runedup-oneshot',
    title: 'Rune duplicates, family 4/8 — one-shot grants & scheduled events: second copy simply grants again',
    statement:
      'These 8 runes do one thing once (a Gold sum, a batch of cards, a scheduled event) — and a second copy does nothing. '
      + 'Proposed family rule: a second copy simply GRANTS AGAIN — a second Rune of Small Fortune pays another 7 Gold, a '
      + 'second Rune of the Muster refreshes again. A duplicated SCHEDULED event (Treasure Map, Ornate Clock, and family 1\'s '
      + 'Summit) lands the FOLLOWING turn to avoid a same-turn double modal. '
      + '— ✓ Approve = adopt re-grant for this family (Claude implements it in a follow-up PR — mostly just stop suppressing the re-fire for owned runes). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = one-shot duplicates should NOT re-grant — they fall back to the universal sweetener (family 6/8) instead.',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential' }],
    currentBehaviour: 'A second copy of every rune listed: Gold spent, zero state change (Doc Bot runeSwallowScan, 2026-08-27).',
    recommendation: 'Re-grant — the second copy fires the one-shot reward again (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Rune of Small Fortune (3g): "Get 7 Gold immediately." · '
      + 'Rune of Spare Parts (2g): "Get 5 random Attachments." · '
      + 'Rune of the Armory (3g, Epic): "Get 10 random Attachments." · '
      + 'Rune of the Altar (1g): "Sell your entire board. Gain 3 Gold for each minion sold." · '
      + 'Rune of Held Strength (3g, Epic): "Give your left and right-most minions the stats of the left-most card in your hand." · '
      + 'Rune of the Muster (3g, Epic): "Get a free Shop refresh filled with plain copies of your minions." · '
      + 'Rune of the Treasure Map (2g): "In 2 turns, gain 10 Gold." · '
      + 'Rune of the Ornate Clock (2g): "Gain 2 Gold. Visit the Epic Runeforge next turn instead of turn 9."',
    example:
      'Example: you own Rune of Small Fortune (already paid its 7 Gold on purchase) and the forge offers it again for 3 Gold. '
      + 'Today: you pay 3 Gold and receive NOTHING. Under the proposed rule: you receive 7 Gold again (net +4).',
    contentIds: [
      'rune_small_fortune', 'rune_spare_parts', 'rune_armory', 'rune_altar', 'rune_held_strength', 'rune_muster',
      'rune_treasure_map', 'rune_ornate_clock',
    ],
    sourceQueue: 'runeRewardDifferential',
  },
  {
    id: 'q-runedup-boolean-flags',
    title: 'Rune duplicates, family 5/8 — boolean combat flags: fire once per copy where repetition is meaningful',
    statement:
      'Boolean combat-flag runes turn an on/off combat behaviour on (Start-of-Combat effects, first-X-each-combat triggers, '
      + '"minions you summon gain…" auras). Buying a duplicate already RECORDS a copy count (flagCopies) — but today only the '
      + 'rune-granted Avenge dispatchers actually READ it (two Rune of the Procession = two fires, shipped 2026-08-06). Every '
      + 'other boolean flag ignores the count, so its duplicate changes nothing in combat. Proposed family rule: every boolean '
      + 'flag whose effect can meaningfully repeat fires ONCE PER COPY (two Rune of Rallying = trigger your left-most Rally '
      + 'twice at Start of Combat; two Rune of the Five Banners = +6/+6 twice); a flag that genuinely cannot repeat (e.g. '
      + 'Rune of the Trophy — you cannot copy the first kill twice more meaningfully than doubling it, or Rune of Engraving '
      + 'Gems — "permanent" is already permanent) falls back to the universal sweetener (family 6/8). '
      + '— ✓ Approve = adopt fire-once-per-copy for repeatable boolean flags, sweetener for the true one-offs (Claude implements + classifies each flag in the follow-up PR, flagging any borderline ones back to this board). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = boolean-flag duplicates should NOT stack — all of them fall back to the universal sweetener instead.',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential', quote: 'booleans record flagCopies: the copy count IS their sanctioned accumulation mechanism' }],
    currentBehaviour:
      'A duplicate ticks flagCopies[flag] in run state (so Doc Bot\'s dead-buy scan does not flag these), but in combat only '
      + 'the runeAvenge dispatchers consume the count (simulate.ts — Broodpit, Spearline, Appraisal, Last Call, Counterpoint, '
      + 'Hunting Bell, Engraving, Shifting Facets, Deepening Vein, Procession fire once per copy). Every other boolean flag '
      + 'dispatcher ignores flagCopies: a second Rune of Rallying, Warding, Five Banners, Herald etc. changes nothing.',
    recommendation: 'Make flagCopies live for every repeatable boolean flag; sweetener for the true one-offs (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Already fire once per copy (Avenge dispatchers) — Rune of the Broodpit (3g, Epic): "Avenge (4): summon 2 Imps with Taunt." · '
      + 'Rune of the Spearline (7g, Epic): "Avenge (4): summon a Spear Warden. It attacks immediately." · '
      + 'Rune of Appraisal (3g, Epic): "Avenge (3): improve your Shop spells by +1/+1." · '
      + 'Rune of Last Call (2g): "Avenge (4): get 2 random Dwarven Ales." · '
      + 'Rune of Counterpoint (7g, Epic): "When a friendly minion dies, your left-most minion attacks immediately." · '
      + 'Rune of the Hunting Bell (4g): "Avenge (3): trigger your left-most Rally." · '
      + 'Rune of Engraving (3g): "Avenge (3): your Rubies permanently give +1 more Health." · '
      + 'Rune of Shifting Facets (3g): "Avenge (3): improve your Rubies by +1 Health. Each turn this alternates between Health and Attack." · '
      + 'Rune of the Deepening Vein (5g, Epic): "Avenge (3): improve your Rubies by +1/+1 and play a Ruby on every friendly Kobold." · '
      + 'Rune of the Procession (3g, Epic): "Avenge (4): double your right-most minion’s stats." — '
      + 'Duplicate currently does nothing in combat — Rune of Warding (3g): "Start of Combat: give your right-most minion Ward and triple its Health." · '
      + 'Rune of Slaying (3g): "When you kill 6 enemies, get a minion of your most common type." · '
      + 'Rune of Fury (2g): "Your Avenge effects trigger twice." · '
      + 'Rune of Forthcoming (2g): "Start of Combat: your left-most minion attacks immediately and gains Ward." · '
      + 'Rune of Rallying (5g): "Start of Combat: trigger your left-most Rally effect." · '
      + 'Rune of the Hatchery (4g): "Minions summoned in combat have +3/+3 and Taunt." · '
      + 'Rune of the War Chorus (3g): "Your first Rally each combat triggers your left-most Shout." · '
      + 'Rune of Packcraft (2g): "Minions you summon in combat have +6/+6." · '
      + 'Rune of Salvage (1g): "Whenever a friendly Mech loses Ward, get a random Attachment next shop." · '
      + 'Rune of Rebirth (3g): "Start of Combat: give a random friendly minion Echo: summon an exact copy of this without Echo." · '
      + 'Rune of Aftershocks (4g): "Triggering an Echo gives your minions +4/+4 this combat." · '
      + 'Rune of the Trophy (3g): "Get a copy of the first minion you kill in combat." · '
      + 'Rune of the Underdog (4g): "Start of Combat: double the stats of your two lowest-Attack minions." · '
      + 'Rune of the Five Banners (4g): "Start of Combat: give one friendly minion of each type +6/+6." · '
      + 'Rune of the Centerline (3g): "Start of Combat: if your end minions have different types, give your middle minion Ward and Critical Strike." · '
      + 'Rune of the Second Litter (2g): "The first Beast summoned each combat summons another copy." · '
      + 'Rune of Emberline (3g): "The first Imp that dies each combat gives its stats to the next Imp you summon." · '
      + 'Rune of Backbeat (4g): "The first Echo you trigger each combat triggers your left-most Rally." · '
      + 'Rune of the Spare Chair (4g): "If you begin combat with exactly 6 minions, the first minion you summon gains Ward and attacks immediately." · '
      + 'Rune of the Burrow (1g): "Whenever you trigger a Beast\'s Echo, get a free refresh." · '
      + 'Rune of the Herding Horn (2g): "Whenever you trigger a Rally, gain a free refresh." · '
      + 'Rune of Rising Graves (1g, Epic): "Start of Combat: give two friendly Undead Rise." · '
      + 'Rune of First Claws (7g, Epic): "Start of Combat: your left-most and right-most Beasts attack immediately." · '
      + 'Rune of Inheritance (4g, Epic): "When your left-most minion dies, your right-most minion gains its stats." · '
      + 'Rune of Twilight (4g, Epic): "Your Start-of-Combat effects trigger an additional time." · '
      + 'Rune of the Mirror March (5g, Epic): "Start of Combat: when you have room, summon a copy of your left-most minion." · '
      + 'Rune of the Warpath (5g, Epic): "After your left-most minion attacks, your right-most minion attacks." · '
      + 'Rune of the Vanguard (1g, Epic): "Start of Combat: give your three left-most minions Critical Strike and Ward." · '
      + 'Rune of Living Treasure (4g, Epic): "Your Gemheart Golems gain Echo: summon an exact copy of this without Echo." · '
      + 'Rune of the Food Chain (5g, Epic): "Start of Combat: the first minion you summon gains your left-most Demon’s stats this combat." · '
      + 'Rune of the Gem Golem (4g, Epic): "When a friendly Kobold dies in combat, summon a token with stats equal to its Ruby bonuses." · '
      + 'Rune of the Stoked Menagerie (5g, Epic): "Start of Combat: if you control all 5 minion types, double the stats of 3 random minions." · '
      + 'Rune of Tempered Time (4g, Epic): "Start of Combat: give each of your minions Health equal to half its Attack." · '
      + 'Rune of Savagery (5g, Epic): "After you summon a Beast in combat, double its Attack." · '
      + 'Rune of the Herald (5g, Epic): "Start of Combat: trigger all your Echoes." · '
      + 'Rune of the Chef (6g, Epic): "Your Chef Gary Toasts gain Rally: buff another random Dwarf for the combined stats this granted last turn." · '
      + 'Rune of Ancestral Roar (5g, Epic): "Your Dragons with Shout gain “Echo: trigger this minion’s Shout.”" · '
      + 'Rune of Ruby Shrapnel (5g, Epic): "When a Ruby-buffed minion dies, split its Ruby bonus stats among your surviving minions." · '
      + 'Rune of Shared Scripture (6g, Epic): "The first Shop spell cast by your warband in combat triggers your left-most Shout and Rally." · '
      + 'Rune of Moonhowl (5g, Epic): "Your Mage-Pups gain “Echo: cast the Shop spell this learned.”" · '
      + 'Rune of the Old Pack (6g, Epic): "The first Beast you Resummon each combat returns with its full stats." · '
      + 'Rune of the Jungle (6g, Epic): "Your Beasts gain double their Health when summoned in combat." · '
      + 'Rune of Beastial Swarm (5g, Epic): "Your Beasts gain +2/+2 when a friendly Beast dies. Avenge (2): Improve this permanently." · '
      + 'Rune of Ruins (6g, Epic): "When a friendly Demon deals damage, give your minions +2/+2." · '
      + 'Rune of Engraving Gems (4g, Epic): "Your Rubies applied in combat are permanent." · '
      + 'Rune of the Deathtouched Apple (4g, Epic): "When a minion Rises, give it Rise. (2 uses per combat)"',
    example:
      'Example: you own Rune of Rallying and Rune of Duplication hands you a second copy. Today: the copy is recorded but Start of '
      + 'Combat still triggers your left-most Rally exactly once. Under the proposed rule: it triggers your left-most Rally twice — '
      + 'the same way two Rune of the Procession already Avenge-fire twice.',
    contentIds: [
      'rune_broodpit', 'rune_spearline', 'rune_appraisal', 'rune_last_call', 'rune_counterpoint', 'rune_hunting_bell',
      'rune_engraving', 'rune_shifting_facets', 'rune_deepening_vein', 'rune_procession',
      'rune_warding', 'rune_slaying', 'rune_fury', 'rune_forthcoming', 'rune_rallying', 'rune_hatchery', 'rune_war_chorus',
      'rune_packcraft', 'rune_salvage', 'rune_rebirth', 'rune_aftershocks', 'rune_trophy', 'rune_underdog',
      'rune_five_banners', 'rune_centerline', 'rune_second_litter', 'rune_emberline', 'rune_backbeat', 'rune_spare_chair',
      'rune_burrow', 'rune_herding_horn', 'rune_rising_graves', 'rune_first_claws', 'rune_inheritance', 'rune_twilight',
      'rune_mirror_march', 'rune_warpath', 'rune_vanguard', 'rune_living_treasure', 'rune_food_chain', 'rune_gem_golem',
      'rune_stoked_menagerie', 'rune_tempered_time', 'rune_savagery', 'rune_herald', 'rune_chef', 'rune_ancestral_roar',
      'rune_ruby_shrapnel', 'rune_shared_scripture', 'rune_moonhowl', 'rune_old_pack', 'rune_jungle', 'rune_beastial_swarm',
      'rune_ruins', 'rune_engraving_gems', 'rune_deathtouched_apple',
    ],
    sourceQueue: 'runeRewardDifferential',
  },
  {
    id: 'q-runedup-sweetener-floor',
    title: 'Rune duplicates, family 6/8 — the universal sweetener floor for duplicates that cannot stack',
    statement:
      'Whatever the family rules above decide, a handful of duplicates genuinely cannot stack (true one-off booleans, '
      + 'idempotent rule changes like Rune of Twin Gilding). Your 2026-08-26 ruling: a duplicate must NEVER be a dead buy. '
      + 'Proposed floor: any duplicate that cannot meaningfully stack instead grants an immediate, visible consolation — '
      + 'Gold equal to HALF the rune\'s cost rounded up, plus a FREE REFRESH. This guarantees "always does SOMETHING" without '
      + 'inventing bespoke mechanics for every edge case. '
      + '— ✓ Approve = adopt the sweetener floor (half cost rounded up in Gold + a free refresh; Claude implements it in the follow-up PR as the fallback for every non-stacking duplicate). '
      + '✎ Revise = your ruling, in a sentence (e.g. a different consolation). '
      + '✕ Reject = no sweetener — non-stacking duplicates must be prevented from being purchasable at all instead (which makes family 7/8\'s forge filter mandatory and leaves Rune of Duplication needing its own answer).',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential' }],
    currentBehaviour: 'No sweetener exists: a duplicate that does not stack is Gold spent for zero effect (80 runes today per Doc Bot runeSwallowScan).',
    recommendation: 'Gold = half the rune\'s cost rounded up, plus a free refresh (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Context — Rune of Duplication (4g): "After you forge your Epic Rune, this transforms into a copy of it." · '
      + 'Example of a true non-stacker — Rune of Twin Gilding (7g, Epic): "You only need 2 copies of cards to Gild them." (already at 2; a copy cannot lower it again)',
    example:
      'Example: you own Rune of Twin Gilding and Rune of Duplication hands you a second copy. Today: nothing. Under the proposed '
      + 'floor: you immediately gain 4 Gold (half of 7, rounded up) and a free Shop refresh.',
    contentIds: ['rune_duplication', 'rune_twin_gilding'],
    sourceQueue: 'runeRewardDifferential',
  },
  {
    id: 'q-runedup-forge-filter',
    title: 'Rune duplicates, family 7/8 — the forge filter: stop offering owned runes whose duplicate would only pay the sweetener',
    statement:
      'Complementary guard to the sweetener: the Runeforge should STOP OFFERING a rune you already own when its duplicate '
      + 'would only pay the sweetener (i.e. it has no real stacking behaviour). Runes whose duplicates DO stack (families '
      + '1-5 as ruled) stay offerable — a second Flagship is a real purchase. Rune of Duplication still reaches everything, '
      + 'because the player aims it deliberately; the sweetener backstops that path. '
      + '— ✓ Approve = adopt the forge filter (Claude ships it with the sweetener in the first follow-up PR — it kills every accidental dead buy immediately). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = the forge may keep offering owned non-stacking runes (the sweetener alone carries the invariant).',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential' }],
    currentBehaviour: 'The forge can offer any rune you already own; 80 of those offers are dead buys today (Doc Bot runeSwallowScan).',
    recommendation: 'Filter non-stacking owned runes out of forge offers; ship with the sweetener (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Context — Rune of Duplication (4g): "After you forge your Epic Rune, this transforms into a copy of it." · '
      + 'Example of an offer the filter would suppress — Rune of Small Fortune (3g): "Get 7 Gold immediately." (if family 4/8 is rejected)',
    example:
      'Example: you own Rune of the Trophy (a true boolean — "Get a copy of the first minion you kill in combat"). Today the forge can '
      + 'offer Trophy again and the buy does nothing. Under the filter: Trophy simply never appears in your forge offers again; only '
      + 'Rune of Duplication can still produce a second copy, and that copy pays the sweetener.',
    contentIds: ['rune_duplication'],
    sourceQueue: 'runeRewardDifferential',
  },
  {
    id: 'q-runedup-unique-engines',
    title: 'Rune duplicates, family 8/8 — unique engines: default to the sweetener now, case-by-case cards later',
    statement:
      'These runes are bespoke engines — each changes how a system works rather than paying a repeatable reward, and each '
      + 'would need its own stacking design (does a second Rune of Contraband give TWO Ales per first Ruby? does a second '
      + 'Window Shopping make SIX refreshes free?). Proposed family rule: duplicates of these pay the universal sweetener '
      + '(family 6/8) NOW, and any of them you want to genuinely stack comes back to this board as its own one-rune card '
      + 'later. Some plausibly stack naturally (Window Shopping 3→6 free refreshes, Bartering +2g, Thrift −4 cost) — '
      + 'name any you want designed now in Revise. '
      + '— ✓ Approve = sweetener by default for this whole list; individual stacking designs return as later cards on demand. '
      + '✎ Revise = your ruling, in a sentence (e.g. name the ones that should stack naturally now). '
      + '✕ Reject = no default — every rune on this list needs its own ruling card before anything ships.',
    domain: 'runes',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'runeRewardDifferential' }],
    currentBehaviour:
      'A second copy of every rune listed is a dead buy today (Doc Bot runeSwallowScan, 2026-08-27) — except Happy Birthday, '
      + 'whose duplicate does shift run state (its recurrence bookkeeping) but has no defined duplicate semantics either.',
    recommendation: 'Default = universal sweetener; case-by-case stacking cards on demand (docs/rulebook/rune-duplicate-stacking-proposal.md).',
    cardText:
      'Rune of Structure (3g): "After you play an Attachment from hand, get a random Shop spell." · '
      + 'Rune of Summoning (4g): "Whenever you cast a Shop spell, improve your Imps by +2/+2 wherever they are." · '
      + 'Rune of Contraband (6g): "The first Ruby you cast each turn gives you a random Dwarven Ale. The first Dwarven Ale you cast gives you a Ruby." · '
      + 'Happy Birthday (2g): "Get a random Gift. Repeat every 2 turns." · '
      + 'Rune of the Aftermarket (4g): "The first minion you sell each turn gives half its stats to the right-most minion in the current Shop." · '
      + 'Rune of the Banquet Hall (5g, Epic): "The first Shop-buffed minion you buy each turn splits its bonus stats among one friendly minion of each type." · '
      + 'Rune of the Bargain Bin (7g, Epic): "Your first Refresh each turn fills the Shop with minions that cost 1 Gold. They sell for 0 Gold." · '
      + 'Rune of Bartering (6g): "Shout minions sell for 2 Gold." · '
      + 'Rune of Cadence (5g, Epic): "After you buy a minion, your next Shop spell costs 1 less. After you cast a Shop spell, your next minion costs 1 less." · '
      + 'Rune of Distillation (2g): "Spells cast on Shop minions also cast on your left-most minion." · '
      + 'Rune of the Embers (4g, Epic): "When you refresh, double the Health of the right-most minion in the Shop." · '
      + 'Rune of Endless Appetite (8g, Epic): "The first time you Consume Fodder each turn, all your other Demons Consume a copy of it." · '
      + 'Rune of Gemscript (4g, Epic): "The first Shop spell you cast each turn gives your Rubies +1/+1. The first Ruby you cast gives your Shop spells +1/+1." · '
      + 'Rune of the Guiding Candle (4g, Epic): "Your first 2 Shop refreshes each turn contain only Tier 6 minions." · '
      + 'Rune of Liquidation (4g, Epic): "When you sell a minion, give its stats to the right-most Shop minion." · '
      + 'Rune of Open Enrollment (5g): "After you Refresh, the Shop offers an additional minion of your most common type." · '
      + 'Rune of the Open Market (2g, Epic): "The first time you Consume a Shop minion each turn, give your Shop +3/+3 permanently." · '
      + 'Rune of Redirection (4g, Epic): "Rubies played on your left-most minion also cast on your right-most minion." · '
      + 'Rune of Refrain (3g): "Your Shout minions have a 25% chance to return to your hand after you play them." · '
      + 'Rune of Replication (1g, Epic): "The first Attachment you play each turn also attaches a copy to your left-most Mech." · '
      + 'Rune of Restocking (3g): "The first minion you buy each turn refills its Shop slot with a minion of the same Tier that costs 2 Gold." · '
      + 'Rune of the Shared Table (3g, Epic): "Your Dwarven Ale casts each give one friendly minion of each type +2/+2." · '
      + 'Rune of the Spellmarket (4g): "The first stat-granting Shop spell you cast on a friendly minion each turn also gives its stats to the right-most Shop minion." · '
      + 'Rune of the Spellstone (3g, Epic): "Rubies you cast count as Shop spells, and gain your Shop spell bonuses." · '
      + 'Rune of Tempering (4g): "The first Attachment you play each turn also gives that minion Ward." · '
      + 'Rune of Thrift (3g): "Shop spells that give stats cost 2 less." · '
      + 'Rune of Trade-In (2g): "After you sell your first minion each turn, your next minion of that type costs 1 less." · '
      + 'Rune of Twin Gilding (7g, Epic): "You only need 2 copies of cards to Gild them." · '
      + 'Rune of Window Shopping (3g): "Your first 3 Refreshes each turn are free." · '
      + 'Rune of the Golden Splinter — see family 2/8; Rune of Duplication — see family 6/8.',
    example:
      'Example: you own Rune of Contraband and buy a second copy. Today: 6 Gold, nothing. Under the proposed default: you get 3 Gold '
      + 'back and a free refresh (the sweetener) — and if you decide later that two Contrabands should give two Ales per first Ruby, '
      + 'that comes back as its own card here.',
    contentIds: [
      'rune_structure', 'rune_summoning', 'rune_contraband', 'rune_happy_birthday', 'rune_aftermarket', 'rune_banquet_hall',
      'rune_bargain_bin', 'rune_bartering', 'rune_cadence', 'rune_distillation', 'rune_embers', 'rune_endless_appetite',
      'rune_gemscript', 'rune_guiding_candle', 'rune_liquidation', 'rune_open_enrollment', 'rune_open_market',
      'rune_redirection', 'rune_refrain', 'rune_replication', 'rune_restocking', 'rune_shared_table', 'rune_spellmarket',
      'rune_spellstone', 'rune_tempering', 'rune_thrift', 'rune_trade_in', 'rune_twin_gilding', 'rune_window_shopping',
    ],
    sourceQueue: 'runeRewardDifferential',
  },

  // ────────────────────────────── B. COPY / CARRY-OVER / SNAPSHOT QUESTIONS ──────────────────────────────
  {
    id: 'q-copy-gilded-badge',
    title: 'Gilded copies: Mirrorhide Rhino\'s copy keeps the Gilded badge, Exgalloper\'s comes out plain — which is intended?',
    statement:
      'Two self-copy effects disagree about whether the copy of a GILDED minion is itself Gilded. A gilded Mirrorhide '
      + 'Rhino\'s Start-of-Combat copy KEEPS the Gilded badge (and gilded-doubled combat effects). A gilded Exgalloper\'s '
      + 'Echo copy carries the exact gilded STATS (12/12) but comes out with a PLAIN badge — its gild instead doubles the '
      + 'copy COUNT (2 copies). Both are defensible ("summon a copy of this minion" vs "summon an exact copy … without '
      + 'Echo" where gild is spent on the count), but nothing pins which convention copy effects should follow. '
      + '— ✓ Approve = both are correct as they are (Rhino-style copies keep the badge; Exgalloper-style exact-stat copies are plain, gild pays in count) — Doc Bot pins the pair as the convention. '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = one of them is wrong — say which in Revise and Claude fixes it to match the other.',
    domain: 'copying',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'textOracleSummons', quote: 'gilded Ex-Galloper\'s Echo copies carry the EXACT gilded stats but a PLAIN golden flag, while Mirrorhide Rhino\'s scSummonCopy copies keep the Gilded badge' }],
    currentBehaviour:
      'Verified in source 2026-08-27: scSummonCopy (arena.ts) passes golden: arena.self.golden to the summoned copy; '
      + 'echoSummonCopyNoEcho (arena.ts) omits golden entirely (the summon boundary defaults it to false) and instead doubles '
      + 'the copy count when the source is gilded. Both carry exact current stats.',
    recommendation: 'Both as-is: the visible difference matches each card\'s printed text ("a copy of this minion" vs "an exact copy … without Echo", gild paid in count). Pin it as the convention.',
    cardText:
      'Mirrorhide Rhino (Tier 6, 6/6 Beast): "Start of Combat: Summon a copy of this minion." — gilded text: "Start of Combat: Summon two copies of this minion." · '
      + 'Exgalloper (Tier 5, 6/6 Beast token): "Echo: summon an exact copy of this without Echo." — gilded text: "Echo: summon 2 exact copies of this without Echo."',
    example:
      'Example: a gilded Mirrorhide Rhino (12/12) starts combat — its two copies are 12/12 AND show the Gilded badge (their own combat '
      + 'effects would fire doubled). A gilded Exgalloper (12/12) dies — its two copies are exactly 12/12 but show NO badge.',
    contentIds: ['mirrorrhino', 'dw_exgalloper'],
    sourceQueue: 'textOracleSummons',
  },
  {
    id: 'q-carry-demand-encore',
    title: 'Demand an Encore (gift): an unused charge does NOT carry into combat — should it, like the War Drum now does?',
    statement:
      'The gift Demand an Encore gives "your Shouts trigger an extra time this turn". If you cast it and then trigger no '
      + 'Shout in the shop, the charge is simply thrown away at the turn rollover — combat-triggered Shouts (Parting Cry, '
      + 'Ryme, Dawnclaw…) never see it. You ruled the opposite for the War Drum on 2026-08-26 ("if it is not used in shop, '
      + 'then the first shout triggered in combat should work"), and Warm Embers\' banked charges ride the same channel. '
      + 'Should Demand an Encore\'s unused charge carry to combat-triggered Shouts the same way? '
      + '— ✓ Approve = yes, carry it — an unspent Encore charge boosts Shouts triggered in the following combat (Claude wires it through the existing shoutCarryExtras channel). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = no — "this turn" means the shop only; the charge expiring unused is correct as-is.',
    domain: 'gifts',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'carryOver', quote: 'arguably should carry to combat-triggered Shouts like the War Drum; no owner ruling yet' }],
    currentBehaviour:
      'Verified in source 2026-08-27: the charge lives in run state (shoutExtraTurn), is read only by the shop\'s Shout '
      + 'counter, and is zeroed at the turn rollover (reducer.ts) — nothing maps it into combat. The War Drum, by contrast, '
      + 'threads its unspent per-turn charge into combat via questCombatMods.warDrumExtra and combat consumes it on the '
      + 'first triggered Shout (owner ruling 2026-08-26).',
    recommendation: 'Carry it, matching the War Drum precedent — the same shoutCarryExtras channel already exists.',
    cardText:
      'Demand an Encore (Gift spell, 0g, single cast): "Your Shouts trigger an extra time this turn." · '
      + 'Precedent — Rune of the War Drum (2g): "One Shout triggers 2 extra times per turn."',
    example:
      'Example: you cast Demand an Encore, then buy minions without playing any Shout. Combat starts and Ryme dies, re-firing a '
      + 'neighbour\'s Shout. Today: it fires once — the Encore charge evaporated at end of turn. Under the proposal: that first '
      + 'combat-triggered Shout fires twice.',
    contentIds: ['gift_encore'],
    sourceQueue: 'carryOver',
  },
  {
    id: 'q-carry-warm-embers-double-dip',
    title: 'Warm Embers: charges spent IN combat don\'t decrement the run\'s pool — double-dip or fine?',
    statement:
      'Warm Embers\' banked double-charges carry into combat (PR #1226): unspent charges make the next Shouts triggered in '
      + 'combat fire twice. But combat consumes a per-fight COPY of the counter — the run\'s own pool is untouched. So one '
      + 'banked charge can double a Shout in combat tonight AND still double a Shout in tomorrow\'s shop: the same charge is '
      + 'spent twice (once per phase) until the shop finally consumes it. This was a judgement call ("no carry-back channel; '
      + 'the shop pool stays intact"), not a ruling. '
      + '— ✓ Approve = the double-dip is fine — combat use is a free bonus on top of the banked shop charge (current behaviour stands, Doc Bot pins it). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = it should NOT double-dip — a charge spent in combat must decrement the run\'s pool (Claude builds the carry-back).',
    domain: 'persistence',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'carryOver', quote: 'combat use does NOT decrement the run\'s charge pool (no carry-back channel; the shop pool stays intact)' }],
    currentBehaviour:
      'Verified in source 2026-08-27: combat copies shoutDoubleCharges into a per-combat local (simulate.ts shoutDoubleCarryLeft) '
      + 'and decrements only that; the run pool is decremented only by the shop\'s Shout counter (recruit.ts). CombatResult has no '
      + 'field to carry a spend back.',
    recommendation: 'Approve as a free bonus (the pool is small and the free double rewards saving charges); build carry-back only if it feels abusive in play.',
    cardText:
      'Warm Embers (Lesser quest, "buy 5 Shout minions"): reward "Your first Shout each round triggers twice." — the banked-charge '
      + 'variant of the same reward family is what carries: patch notes 2026-08-26: "charges you didn\'t spend in the shop double the next Shouts triggered in combat."',
    example:
      'Example: you have 1 banked double-charge and trigger no Shout in the shop. In combat, Parting Cry fires a dying minion\'s Shout '
      + '— it fires twice (the carried charge). Next turn you play a Shout minion in the shop — it ALSO fires twice, consuming the same '
      + 'charge, which was never decremented by the combat use.',
    sourceQueue: 'carryOver',
  },
  {
    id: 'q-snap-impbank',
    title: 'Ashen Heir\'s Imp bank: a served opponent\'s Heir fights bankless, and a shop bank can\'t pay a combat summon — should the bank ride?',
    statement:
      'Ashen Heir banks the stats of Imps that die with no living Imp to receive them, paying the bank out to the next Imp '
      + 'summoned. The bank exists twice — once on the shop card, once on the combat instance — and the two never talk: '
      + '(a) the board-capture snapshot drops the bank, so a SERVED opponent\'s Heir always fights with an empty bank the '
      + 'live player\'s Heir actually holds; (b) even for the live player, a shop-banked amount cannot pay a combat summon '
      + '(the board-minion shape has no bank slot, so combat always starts the bank at zero and re-accrues from deaths '
      + 'inside that fight only). Should the banked stats ride into combat and onto snapshots? '
      + '— ✓ Approve = yes — carry the bank across both boundaries (BoardMinion gets the slot, capture and the player mapping both thread it; a served Heir fights with the bank it was captured with). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = no — each phase keeps its own bank; the current split is intended.',
    domain: 'persistence',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'snapshotFidelity', quote: 'capture:impBank — whether the bank should ride the snapshot is unruled (BoardMinion has no impBank slot either)' }],
    currentBehaviour:
      'Verified in source 2026-08-27: Minion.impBank (combat) and BoardCard.impBank (shop) are parallel accumulators; '
      + 'BoardMinion has no impBank field, cleanBoard (capture) and the reducer\'s player board→combat mapping copy nothing, '
      + 'and the combat factory impInheritOnSummon reads only self.impBank — always undefined at the start of every fight.',
    recommendation: 'Carry it — the printed text draws no phase line, and a bank that silently empties between phases reads as lost value.',
    cardText:
      'Ashen Heir (Tier 6, 5/9 Demon token): "Whenever an Imp dies, another friendly Imp gains its stats — or the next Imp you summon, if none are alive." · '
      + 'Its source — Rune of the Ashen Heir (5g, Epic): "Get an Ashen Heir."',
    example:
      'Example: in the shop your last Imp (a 6/6) is Consumed with no other Imp alive — the Heir banks 6/6. Combat starts and Rune of '
      + 'the Broodpit summons 2 Imps. Today: they arrive plain — the 6/6 bank stayed in the shop and cannot pay them. And when YOUR '
      + 'board is served to another player as a snapshot, your Heir\'s bank is dropped entirely.',
    contentIds: ['ashen_heir'],
    sourceQueue: 'snapshotFidelity',
  },
  {
    id: 'q-snap-rallyspreadatk',
    title: 'Sunmane Herald: its accrued rally Attack resets to zero every fight — per-combat or run-long?',
    statement:
      'Sunmane Herald\'s Rally gives your Beasts +3 Attack and spreads the Rally, with the granted value ACCRUING on each '
      + 'body. Today the accrual lives only inside a single combat: every fight starts from zero, nothing carries between '
      + 'fights, capture drops it, and a Rise wipes it (a risen body is the printed body — owner ruling 2026-08-08). But the '
      + 'run-state field for it is documented as "genuinely per-instance and run-long … NOT cleared between passes" — and '
      + 'that field is write-dead: since the card was scoped combat-only ("only in combat" is printed on it), nothing ever '
      + 'writes the shop-side field, so the documented run-long intent never happens. Which is right? '
      + '— ✓ Approve = per-combat is correct — the accrual is a within-fight snowball, resetting each fight (Claude deletes the dead run-long field + its stale docblock so the code stops promising otherwise). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = it should be run-long — the accrued value persists between combats and rides snapshots (Claude builds the carry).',
    domain: 'persistence',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'snapshotFidelity', quote: 'capture:rallySpreadAtk — whether the shop value should seed the fight is unruled' }],
    currentBehaviour:
      'Verified in source 2026-08-27: the card\'s effect is combatOnly at the data level (the shop never dispatches it), combat '
      + 'accrues Minion.rallySpreadAtk from zero each fight, a Rise wipes it, and neither capture nor the player mapping carries '
      + 'it. BoardCard.rallySpreadAtk exists with a "run-long" docblock but is write-dead today.',
    recommendation: 'Per-combat (approve): it matches the printed "only in combat" and the Rise ruling; the dead field is the leftover to delete.',
    cardText:
      'Sunmane Herald (Tier 5, 3/3 Beast, Rally): "Rally: give your Beasts +3 Attack and this Rally, only in combat." — gilded text: "Rally: give your Beasts +6 Attack and this Rally, only in combat."',
    example:
      'Example: Sunmane rallies twice in a fight, spreading +3 then +3 — Beasts that received the Rally pass on the accrued +6. '
      + 'Next fight, the whole chain starts again at +3: nothing of the +6 survived the night, and a served snapshot of your board '
      + 'never shows any accrual at all.',
    contentIds: ['b2_sunmane'],
    sourceQueue: 'snapshotFidelity',
  },
  {
    id: 'q-snap-one-combat-marks',
    title: 'Served boards: Parting Cry / Soren\'s Reclaim / Closed Casket marks are dropped by capture while Bloodlust (same shape) is carried — recommend: fix',
    statement:
      'Three one-combat marks a player can place on a minion — Parting Cry (Shout fires on death), Soren\'s hero power '
      + 'Reclaim (destroy at Start of Combat, resummon later), Closed Casket (destroy at Start of Combat) — are DROPPED when '
      + 'the board is captured for serving to other players, while Bloodlust (the exact same one-combat-mark shape) IS '
      + 'carried. So a served copy of your board fights WITHOUT the Parting Cry / Closed Casket you paid for that very '
      + 'combat (Reclaim gets partially reconstructed by a heuristic that may pick a different minion). Your own live fight '
      + 'honours all three — only the served copy diverges. This reads like a bug (the snapshot should be the board you '
      + 'actually fought with), but capture policy is your call. '
      + '— ✓ Approve = fix it — capture carries all three marks like it carries Bloodlust, and served boards fight with them (the Soren heuristic then becomes unnecessary). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = leave as-is — served boards deliberately shed one-combat spell/power marks (Doc Bot reclassifies the three as ruled drops).',
    domain: 'persistence',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'snapshotFidelity', quote: 'capture:partingCry — same shape as resummon: a served board\'s Parting Cry never fires' }],
    currentBehaviour:
      'Verified in source 2026-08-27: cleanBoard (snapshot.ts) carries bloodlust and bloodlustRally but has no partingCry / '
      + 'closedCasket / resummon lines; the reducer\'s own player mapping carries all three and combat honours them. The restore '
      + 'path additionally reconstructs resummon for Soren snapshots via a deterministic heuristic (best Echo minion), which can '
      + 'mark a different minion than the player chose; Parting Cry and Closed Casket have no reconstruction at all.',
    recommendation: 'Fix — carry the three marks at capture; a snapshot should be the board that actually fought.',
    cardText:
      'Parting Cry (spell, 3g): "Choose a friendly Shout minion. When it dies next combat, trigger its Shout." · '
      + 'Closed Casket (spell, 2g): "Choose a minion. Start of Combat: destroy it." · '
      + 'Soren — Reclaim (hero power): "Choose a friendly minion. At the start of combat, destroy it and resummon a copy when there is room." · '
      + 'Carried today (the contrast) — Bloodlust (one-combat mark): a pending Start-of-Combat immune out-of-turn strike.',
    example:
      'Example: you cast Parting Cry on your Pennycat and fight round 8 — in YOUR fight, Pennycat\'s Shout fires when it dies. '
      + 'Round 8\'s board is captured and served to a rival next week: their copy of your Pennycat dies silently — the mark was '
      + 'dropped, so the same board fights weaker for them than it did for you.',
    contentIds: ['sp_partingcry', 'sp_closedcasket'],
    sourceQueue: 'snapshotFidelity',
  },
  {
    id: 'q-snap-granted-effects',
    title: 'Grafted Deathrattles (grantedEffects) are silent in combat and on served boards — recommend: fix',
    statement:
      'Four shop effects GRAFT a Deathrattle onto a body at runtime: Grave Body (copy your leftmost Echo), Echo Mimic (gain '
      + 'a dying friend\'s Echo), the Contract Rewrite quest (a Demon gains "Echo: summon 2 Imps"), and Rune of Rebirth\'s '
      + 'shop half (a minion gains "Echo: summon an exact copy"). The grafts live in a shop-only list (grantedEffects) that '
      + '(a) combat never reads — the grafted Echo simply does not exist in the fight — and (b) capture never carries — a '
      + 'served board loses them too. The shop\'s own Echo dispatch honours them, so the card LOOKS armed right up until it '
      + 'matters. This looks like a straightforward bug: recommend carrying the grafts into combat (the combat Minion already '
      + 'has a per-instance effects list, and copiedEcho already crosses this exact boundary). '
      + '— ✓ Approve = fix it — grafted effects ride into combat and capture, exactly like copiedEcho does. '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = shop grafts are deliberately shop-only — combat silence is intended (the card texts then need a clarifying word).',
    domain: 'persistence',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'snapshotFidelity', quote: 'capture:grantedEffects — a grafted Deathrattle is silent in combat and on served boards' }],
    currentBehaviour:
      'Verified in source 2026-08-27: combat minion construction merges only copiedEcho into the instance effects (minion.ts); '
      + 'grantedEffects has no field on BoardMinion, no line in cleanBoard, and no line in the reducer\'s player mapping. The shop '
      + 'dispatcher (instanceEffects in recruit.ts) reads printed + copiedEcho + grantedEffects, so the graft works in the shop only. '
      + 'All four graft writers store onDeath effects.',
    recommendation: 'Fix — route grantedEffects through the same channel as copiedEcho (instance effects + capture).',
    cardText:
      'Grave Body (Tier 3, 1/1 Undead token): "Copy your leftmost Echo when summoned." · '
      + 'Echo Mimic (Tier 5, 4/7 Neutral token): "Whenever another friendly minion dies, gain its Echo for the rest of combat." · '
      + 'Rune of Rebirth (3g): "Start of Combat: give a random friendly minion Echo: summon an exact copy of this without Echo." (its SHOP-side graft path) · '
      + 'Contract Rewrite (quest reward): a Demon gains "Echo: summon 2 Imps".',
    example:
      'Example: Echo Mimic sits next to your Footman Captain (Echo: summon a Footman) in the shop when the Captain is destroyed — '
      + 'the Mimic gains the Echo and its card shows it. Combat starts and the Mimic dies. Today: nothing — the grafted Echo never '
      + 'entered the fight, and a served copy of the board lacks it too.',
    contentIds: ['gravebody', 'n2_echomimic'],
    sourceQueue: 'snapshotFidelity',
  },
  {
    id: 'q-snap-echostripped',
    title: 'The echoStripped mark: the shop skips a stripped body\'s Echo, but combat fires it anyway — recommend: fix',
    statement:
      'Exgalloper\'s copy is summoned "without Echo". In combat that works by filtering the copy\'s live effects list. In the '
      + 'shop, a board card has no per-instance effects list, so the copy is MARKED (echoStripped) and the shop\'s Echo '
      + 'dispatch skips marked bodies. But the mark is never carried into combat or onto snapshots — so a shop-created '
      + '"without Echo" copy that survives to fight FIRES ITS ECHO ANYWAY (the printed def still has it), summoning another '
      + 'copy the card promised not to make. Same for Rune of Rebirth\'s shop-granted copies. Recommend: carry the mark. '
      + '— ✓ Approve = fix it — the echoStripped mark rides into combat and capture, and combat\'s minion construction filters the Echo out. '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = intended — a shop-stripped copy regains its Echo when it fights (the texts then need a clarifying word).',
    domain: 'persistence',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'snapshotFidelity', quote: 'capture:echoStripped — neither capture nor the player combat mapping carries the mark, so combat-side dispatch cannot honor it' }],
    currentBehaviour:
      'Verified in source 2026-08-27: the shop honours the mark (fireRecruitDeathrattles returns early on minion.echoStripped) '
      + 'and writes it via the shop arena adapter; combat strips echoes by filtering the live Minion.effects list instead, which '
      + 'only reaches bodies created INSIDE combat. A shop-marked card enters combat with effects: card.effects — printed Echo '
      + 'included — and no code reads echoStripped in packages/core.',
    recommendation: 'Fix — the printed "without Echo" should hold in every phase; carry the mark and filter at combat instantiate.',
    cardText:
      'Exgalloper (Tier 5, 6/6 Beast token): "Echo: summon an exact copy of this without Echo." — gilded text: "Echo: summon 2 exact copies of this without Echo." · '
      + 'Also applies via Rune of Rebirth (3g): "Start of Combat: give a random friendly minion Echo: summon an exact copy of this without Echo." (its shop-granted copies)',
    example:
      'Example: an Exgalloper dies in the SHOP (Consumed), summoning its copy "without Echo" — the copy is marked and, sold or '
      + 'triggered in the shop, correctly stays silent. But keep the copy on your board into combat and let it die there: it summons '
      + 'ANOTHER exact copy, exactly what "without Echo" said it would not do.',
    contentIds: ['dw_exgalloper'],
    sourceQueue: 'snapshotFidelity',
  },

  // ────────────────────────────── C. ORDER AMBIGUITIES (orderGoldens + order-ambiguities.md) ──────────────────────────────
  {
    id: 'q-order-clash-echo-defender-first',
    title: 'Mutual-kill clash: the DEFENDER\'s Echo resolves before the attacker\'s — should it?',
    statement:
      'When an attacker and its defender die in the same clash, the DEFENDER\'s death — and therefore its Echo — resolves '
      + 'first, on both sides of the board (it keys on the defender role, not on the player side). The alternative most '
      + 'players import from other autobattlers is attacker-first (the acting minion\'s consequences resolve before the '
      + 'reaction\'s), so defender-first can read as a bug to anyone counting Echo order in a replay. Golden G3 '
      + '(orderGoldens.test.ts) pins the current behaviour so it cannot flip silently; this card asks whether it is the '
      + 'RULED behaviour. '
      + '— ✓ Approve = defender-first is the rule (Doc Bot keeps the golden; GAME-RULES documents it). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = attacker-first is intended — this is a bug (flipping it changes replays, so the fix ships with a replay-version note).',
    domain: 'ordering',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'orderGoldens', quote: 'G3 — mutual clash: the DEFENDER\'s Echo resolves before the attacker\'s (both directions)' }],
    currentBehaviour:
      'Golden G3: two 3/2 Mama Pups trade and both die; the defender\'s death is logged first and its Echo summons land before '
      + 'the attacker\'s death even resolves — verified in both directions (enemy attacks → the player\'s Echo first; player '
      + 'attacks → the enemy\'s Echo first).',
    recommendation: 'Approve defender-first — it is long-pinned and changing it re-times every existing replay.',
    cardText: 'Mama Pup (Tier 2, 3/2 Beast): "Deathrattle: summon two 1/1 Pups."',
    example:
      'Example (golden G3\'s fixture): your Mama Pup (3/2) attacks the enemy\'s Mama Pup (3/2); both die. The ENEMY\'s two Pups '
      + 'hit the board first, so they also take or make the next trades first — near the 7-slot cap, whoever\'s Echo fires first '
      + 'fills the last slots.',
    contentIds: ['pack'],
    sourceQueue: 'orderGoldens',
  },
  {
    id: 'q-order-soc-player-side-first',
    title: 'Start of Combat: the player/first-passed side always resolves first, even when the enemy attacks first — should it?',
    statement:
      'ALL of the player side\'s Start-of-Combat effects resolve before any of the enemy\'s, regardless of which side holds '
      + 'the first attack. The alternatives: initiative-side-first (the side that attacks first also resolves SoC first — '
      + 'the Battlegrounds convention), or strict alternation. This matters cross-side: SoC damage could kill an enemy '
      + 'buffer BEFORE it grants — but only under player-first. And because one simulate() is authoritative for BOTH seats '
      + 'in a lobby pairing, "player side" is really "whichever seat was passed first" — seat order silently decides SoC '
      + 'priority in mirror matches. Golden G2 pins the current behaviour. '
      + '— ✓ Approve = fixed side order is the rule (first-passed side\'s SoC always first; GAME-RULES documents it). '
      + '✎ Revise = your ruling, in a sentence (e.g. initiative-side-first). '
      + '✕ Reject = this is a bug — tie SoC order to initiative (changes replays; ships with a replay-version note).',
    domain: 'ordering',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'orderGoldens', quote: 'G2 — Start of Combat: the PLAYER side\'s effects all resolve before the enemy side\'s, even when the enemy has the first attack' }],
    currentBehaviour:
      'Golden G2: player and enemy each field a Speed Demon; the enemy\'s larger board takes the first ATTACK, but the player '
      + 'Speed Demon\'s SoC grant is the first SoC event in the log every time.',
    recommendation: 'Approve fixed order — deterministic and long-pinned; initiative-first would make mirror outcomes hinge on seat order anyway.',
    cardText: 'Speed Demon (Tier 6, 10/8 Demon): "Start of Combat: give your other minions 50% of this minion\'s stats."',
    example:
      'Example (golden G2\'s fixture): both sides field a 4/50 Speed Demon; the enemy has three minions to your two, so the enemy '
      + 'swings first — yet YOUR demon\'s +2/+25 grants resolve before theirs. Under initiative-first the same two boards would '
      + 'resolve in the opposite order whenever the enemy out-boards you.',
    contentIds: ['runmaw'],
    sourceQueue: 'orderGoldens',
  },
  {
    id: 'q-order-improve-steps-mid-resolution',
    title: 'Improving grants step up MID-WAVE: the 4th summon of one simultaneous death wave already gets the improved rate — should it?',
    statement:
      'An improving on-summon grant (Beardsley: +3/+3 to each summoned Beast, improving +3/+3 every 3 Beasts) re-reads its '
      + 'step for EVERY individual summon — even within one simultaneous wave. When one Cleave kills two Mama Pups at once, '
      + 'the four Pups they summon are paid +3/+3, +3/+3, +3/+3, then +6/+6: the step advanced mid-resolution. The '
      + 'alternative: magnitudes lock when the trigger wave starts, so everything that dies/summons "simultaneously" is paid '
      + 'at the same rate. The card text ("improves every 3") does not say when the step is read. The same question governs '
      + 'Den Mother\'s shop-side twin (next card). Golden G4 pins the current behaviour. '
      + '— ✓ Approve = live steps are the rule — every summon re-reads the current step, waves included (texts stay as printed). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = steps should lock per wave — this is a bug (changes replays; ships with a replay-version note).',
    domain: 'ordering',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'orderGoldens', quote: 'G4 — Beardsley\'s improve step advances MID-resolution: the 4th Pup of the same simultaneous wave gets +6/+6 while the first three get +3/+3' }],
    currentBehaviour:
      'Golden G4: Beardsley + two 0/1 Mama Pups vs one Cleave attacker killing both Pups at once — the four summoned Pups '
      + 'receive [+3, +3, +3, +6] Attack (the improve step advanced on the 4th summon of the SAME wave), and each Beardsley '
      + 'buff is inserted depth-first, right behind its own summon.',
    recommendation: 'Approve live steps — depth-first resolution with live magnitudes is the engine\'s consistent rule (G4 and G6 both pin it).',
    cardText: 'Beardsley (Tier 4, 5/5 Beast): "Ward. Whenever you summon a Beast, give it +3/+3. Improves +3/+3 every 3 Beasts summoned."',
    example:
      'Example (golden G4\'s fixture): a Cleave hit kills both your Mama Pups simultaneously; they summon four 1/1 Pups. Today the '
      + 'first three Pups get +3/+3 and the fourth gets +6/+6 — worth a real +3/+3 of stats on the last body compared with the '
      + '"lock per wave" reading.',
    contentIds: ['b2_beardsley', 'pack'],
    sourceQueue: 'orderGoldens',
  },
  {
    id: 'q-order-shop-aura-before-shout',
    title: 'Shop: on-summon auras (and their improve steps) resolve BEFORE the played minion\'s own Shout — should they?',
    statement:
      'Playing a minion fires on-summon auras on it BEFORE its own Battlecry resolves. Combined with an improving aura this '
      + 'is outcome-bearing: Den Mother gives the played Pennycat the BASE +2/+2, improves to +4/+4, and Pennycat\'s '
      + 'Shout-summoned Stray then receives the LARGER +4/+4 — the token outgrows the card you actually played. The '
      + 'alternatives: Shout-first (the played card\'s own text resolves before passive watchers — Stray gets +2/+2, '
      + 'Pennycat +4/+4), or "same wave, same rate" (both get +2/+2). Golden G6 pins the current behaviour. '
      + '— ✓ Approve = aura-first with live improve steps is the rule (matches combat\'s G4 ruling). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = Shout-first is intended — this is a bug (the played minion should take the improved grant, its token the base one).',
    domain: 'ordering',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'orderGoldens', quote: 'G6 — shop: on-summon auras apply BEFORE the played minion\'s own Battlecry resolves' }],
    currentBehaviour:
      'Golden G6: Den Mother on board, Pennycat played from hand — Pennycat\'s buff list shows Den Mother +2/+2 (the base grant, '
      + 'before its own Shout ran) and the Shout-summoned Stray shows Den Mother +4/+4 (the improved grant). playCard fires '
      + 'onSummon before the onPlay loop.',
    recommendation: 'Approve aura-first — it is the same depth-first/live-step rule G4 pins in combat, applied consistently in the shop.',
    cardText:
      'Den Mother (Tier 5, 5/5 Beast): "When you play a Beast, give it +2/+2 — and improve this by +2/+2." · '
      + 'Pennycat (Tier 1, 1/1 Beast): "Battlecry: summon a 1/1 Stray next to it."',
    example:
      'Example (golden G6\'s fixture): with Den Mother on board you play Pennycat. Pennycat is buffed +2/+2, Den Mother improves '
      + 'to +4/+4, and THEN Pennycat\'s Shout summons its Stray — which arrives with +4/+4. The 1/1 token ends up bigger-buffed '
      + 'than the card you played.',
    contentIds: ['mamabear', 'alley'],
    sourceQueue: 'orderGoldens',
  },

  // ────────────────────────────── D. INTERACTION AMBIGUITIES (trigger-family matrix) ──────────────────────────────
  {
    id: 'q-interact-nonstack-best-of',
    title: 'Two DIFFERENT non-stacking multipliers of the same family collapse to best-of — intended?',
    statement:
      'The shared multiplier resolver sums the STACKING multipliers (Sylus) but takes the single BEST of the non-stacking '
      + 'ones (Drakko / Chronos / Uron / Zyff) — across DIFFERENT cards, not just copies of one card. So Drakko AND Zyff '
      + 'together grant +1 total Battlecry fire, not +1 each, while both texts together promise more. The "best copy" code '
      + 'comments all describe copies of the SAME card, and Zyff\'s own definition comment even says it "stacks with Drakko '
      + '… the same way any two multipliers do" — which the code contradicts for this pairing. '
      + '— ✓ Approve = best-of across different non-stacking cards is intended — the card texts gain a clarifying word and Doc Bot pins the pairing. '
      + '✎ Revise = your ruling, in a sentence (e.g. "different cards sum; only same-card copies best-of"). '
      + '✕ Reject = this is a bug — different non-stacking cards must sum (Claude changes extraTriggerFires accordingly).',
    domain: 'multipliers',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'interactionFamilyMatrix', quote: 'two different non-stacking cards sharing a family grant +1 total, not +1 each' }],
    currentBehaviour:
      'Verified in source 2026-08-27: extraTriggerFires (types.ts) sums stacking multipliers and best-ofs the non-stacking set '
      + 'across different card ids; triggerMultipliers.test.ts pins Drakko+Zyff battlecry = +1 (and golden Drakko + Zyff = +2, '
      + 'still the best single).',
    recommendation: 'Owner\'s call — best-of is the anti-runaway reading, summing is what the printed texts promise.',
    cardText:
      'Drakko the Drummer (Tier 5, 2/4): "Your Battlecries fire 1 more time." · '
      + 'Zyff, the Betrayer (Tier 7, 6/6): "Your Battlecries and Deathrattles trigger an additional time." · '
      + 'Chronos (Tier 5, 1/6): "Your End of Turn effects trigger 1 more time." · '
      + 'Uron, Oathbringer (Tier 7, 7/7): "Your Rallies, End of Turns and Start of Combats trigger an additional time." · '
      + 'Contrast (stacking) — Sylus the Reaper (Tier 5, 1/7): "In combat, your Deathrattles proc 1 more time."',
    example:
      'Example: Drakko AND Zyff on board; you play Twilight Emissary ("Taunt. Battlecry: give a friendly Dragon +2/+2"). It fires '
      + 'TWICE (best-of), while the two texts read together promise three fires. Same shape: Uron AND Chronos on board — End of '
      + 'Turn effects fire twice, not three times.',
    contentIds: ['drummer', 'zyff', 'chronos', 'uron', 'sylus', 'emissary'],
    sourceQueue: 'interactionFamilyMatrix',
  },
  {
    id: 'q-interact-combat-shout-multipliers',
    title: 'Combat Shout re-fires: some paths fold Drakko\'s multiplier, others fire flat — recommend: fix the flat ones',
    statement:
      'When a Shout is re-triggered IN COMBAT, whether Drakko\'s "Battlecries fire 1 more time" applies depends on which '
      + 'card did the triggering: Ryme, Dawnclaw, Thunderous Sovereign and Chorus Drake all fold the multiplier (each '
      + 'trigger fires twice under Drakko), but Parting Cry and the rune-driven re-fires (Embercrest\'s Rally, Rune of '
      + 'Ancestral Roar\'s granted Echo, Rune of Shared Scripture, Rune of the War Chorus) fire the Shout exactly once — '
      + 'no fold. The shop replay path DOES fold Drakko everywhere. Under your 2026-08-20 principle ("trigger multipliers '
      + 'follow the trigger to whatever phase it fires in" — already applied to the Echo and Start-of-Combat families in '
      + 'both phases) the flat paths look like an omission, not a ruling. Recommend: fix — fold the Battlecry multiplier '
      + 'into every combat Shout re-fire path. '
      + '— ✓ Approve = fix it — every combat Shout re-fire folds the Battlecry multipliers, matching Ryme and the shop. '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = the flat paths are deliberate — Parting Cry and the rune re-fires stay single-fire (Doc Bot pins the split).',
    domain: 'multipliers',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'interactionFamilyMatrix', quote: 'combat Shout re-fires vs the Battlecry multiplier family — the 2026-08-20 principle has not been applied uniformly' }],
    currentBehaviour:
      'Verified in source 2026-08-27 (this supersedes the stale claim in docs/rulebook/interaction-ambiguities.md that ALL combat '
      + 're-fires ignore the multiplier): deathrattleReplayAdjacentBattlecry (Ryme/Dawnclaw), scTriggerTribeShouts (Thunderous '
      + 'Sovereign) and rallyTriggerLeftmostTribeShout (Chorus Drake) multiply by drakkoRepeats; the Parting Cry death branch '
      + '(simulate.ts) and every arena replayShout consumer (Embercrest\'s rallyTriggerTribeShouts and the rune paths) call '
      + 'replayCombatBattlecry exactly once with no fold.',
    recommendation: 'Fix — apply the 2026-08-20 "multipliers follow the trigger" principle; the half-applied state is the worst of both.',
    cardText:
      'Drakko the Drummer (Tier 5, 2/4): "Your Battlecries fire 1 more time." · '
      + 'Folds today — Ryme (Tier 4, 5/3): "Deathrattle: Trigger adjacent minions\' Battlecries." · '
      + 'Dawnclaw (Tier 4, 5/3): "Taunt. Echo: trigger an adjacent minion\'s Shout." · '
      + 'Thunderous Sovereign (Tier 6, 8/8): "Start of Combat: give your Dragons +1/+1. Improves by +2/+2 with every Shop spell you cast." · '
      + 'Flat today — Parting Cry (spell, 3g): "Choose a friendly Shout minion. When it dies next combat, trigger its Shout." · '
      + 'Rune of Ancestral Roar (5g, Epic): "Your Dragons with Shout gain “Echo: trigger this minion’s Shout.”" · '
      + 'Rune of Shared Scripture (6g, Epic): "The first Shop spell cast by your warband in combat triggers your left-most Shout and Rally." · '
      + 'Rune of the War Chorus (3g): "Your first Rally each combat triggers your left-most Shout."',
    example:
      'Example: Drakko on board. Ryme dies in combat and re-triggers a neighbour\'s Shout: it fires TWICE (Drakko folded). The same '
      + 'combat, a minion under Parting Cry dies: its Shout fires ONCE — Drakko ignored. In the shop, selling that minion under Rune '
      + 'of the Last Word fires the Shout twice again.',
    contentIds: ['drummer', 'ryme', 'b2_dawnclaw', 'd2_sovereign', 'sp_partingcry'],
    sourceQueue: 'interactionFamilyMatrix',
  },
  {
    id: 'q-interact-empty-graves-flat',
    title: 'Empty Graves\' forced Echo fires once per attack, ignoring every Echo multiplier — recommend: fix',
    statement:
      'The Empty Graves quest reward gives your left-most minion "Rally: trigger your left-most Echo" — and that forced '
      + 'Echo runs exactly ONCE per attack, ignoring every Echo multiplier (Sylus, Uron, Funeral Engine, the first-Echo '
      + 'bonus). Every OTHER forced-Echo path multiplies: Rune of the Herald\'s Start-of-Combat mass fire, Deathsayer / '
      + 'Echohorn / Hawkus\' triggers, and real deaths all fold the side\'s Echo extras. The implementing block\'s comment '
      + 'explains its once-per-attack wrap but says nothing about multipliers — given "an Echo trigger is an Echo trigger" '
      + 'everywhere else, the single-fire looks like an omission. Recommend: fix (fold the Echo extras in, like the Herald). '
      + '— ✓ Approve = fix it — Empty Graves\' forced Echo folds the side\'s Echo multipliers like every other forced trigger. '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = deliberately flat — it already fires on EVERY attack, and multiplying it too would run away (Doc Bot pins the exception).',
    domain: 'triggers',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'interactionFamilyMatrix', quote: 'the emptyGravesRally block runs the effects exactly once inside one asEcho wrap; every other forced-Echo path multiplies' }],
    currentBehaviour:
      'Verified in source 2026-08-27: the emptyGravesRally attack branch (simulate.ts) runs the left-most Echo\'s effects once '
      + 'inside one asEcho wrap, with no playerEchoExtras fold; Rune of the Herald\'s branch computes procs = 1 + playerEchoExtras '
      + 'per Echo, and triggerEcho (Deathsayer/Echohorn/Hawkus) multiplies by (1 + echoExtras) × gild. NOTE, found in passing: the '
      + 'quest\'s player-facing reward line in questText.ts still describes the PRE-2026-07-21 design ("summons a 1/1 Gravebody…") '
      + '— stale text, flagged for its own fix regardless of this ruling.',
    recommendation: 'Fix — fold playerEchoExtras in like the Herald does; if runaway is a worry, cap it rather than zeroing it.',
    cardText:
      'Empty Graves (Greater Undead quest, "13 friendly deaths") — actual reward behaviour: your left-most minion gains "Rally: '
      + 'trigger your left-most Echo" at Start of Combat. (Its printed reward line is currently stale — see currentBehaviour.) · '
      + 'Sylus the Reaper (Tier 5, 1/7): "In combat, your Deathrattles proc 1 more time." · '
      + 'Footman Captain (Tier 3, 2/1): "Deathrattle: Summon a Footman." · '
      + 'Contrast — Rune of the Herald (5g, Epic): "Start of Combat: trigger all your Echoes." · '
      + 'Deathsayer (Tier 4, 3/5): "Rally: before this attacks, trigger your leftmost Deathrattle."',
    example:
      'Example: Sylus + Footman Captain (leftmost Echo) + the Empty-Graves-marked body. The marked body attacks → 1 Footman (flat). '
      + 'Deathsayer rallies the same Captain → 2 Footmen (Sylus folded). The Captain actually dies → 2 Footmen.',
    contentIds: ['sylus', 'deathlesshand', 'deathsayer'],
    sourceQueue: 'interactionFamilyMatrix',
  },
  {
    id: 'q-interact-forced-echo-first-bonus',
    title: 'A forced, deathless Echo consumes the once-per-combat first-Echo bonus — is that "the first Echo"?',
    statement:
      'Grave Contract / Last Rites / Rune of the Catacomb read "your first Echo … triggers twice" — a once-per-combat '
      + 'charge. The charge is consumed by the FIRST Echo trigger of the fight, and forced, no-death triggers count: Rune '
      + 'of the Herald\'s Start-of-Combat mass fire, Deathsayer\'s rally, Echohorn — all spend it exactly as a real death '
      + 'would. So with Grave Contract complete and Rune of the Herald owned, the bonus is spent at Start of Combat on the '
      + 'Herald\'s left-most forced Echo, and the fight\'s first REAL death then fires without it — near-useless in any '
      + 'Herald build. Nothing establishes whether a deathless forced trigger is "an Echo" for this charge. '
      + '— ✓ Approve = any Echo trigger, forced or death, may spend the charge — an Echo trigger is an Echo trigger (current behaviour stands, Doc Bot pins it). '
      + '✎ Revise = your ruling, in a sentence. '
      + '✕ Reject = this is a bug — only a real death\'s Echo may consume the first-Echo bonus (Claude gates the charge on death-fired triggers).',
    domain: 'triggers',
    status: 'needs-ruling',
    evidence: [{ kind: 'docbot-scan', ref: 'interactionFamilyMatrix', quote: 'playerEchoExtras consumes the echoFirstEachCombat charge on its FIRST call — and it is called by forced, no-death Echo triggers exactly as by real deaths' }],
    currentBehaviour:
      'Verified in source 2026-08-27: playerEchoExtras (simulate.ts) sets firstEchoDone and folds the echoFirstEachCombat bonus '
      + 'on its first call per side, and it is called by the Herald\'s SoC branch (procs = 1 + playerEchoExtras) and by '
      + 'triggerEcho\'s echoExtras callback (Deathsayer / Echohorn / Hawkus) exactly as by real deaths.',
    recommendation: 'Owner\'s call — "an Echo trigger is an Echo trigger" is the consistent rule, but it makes the bonus near-dead in Herald builds.',
    cardText:
      'Rune of the Catacomb (3g): "Discover an Echo minion. Your first Echo triggered in combat triggers twice." · '
      + 'Grave Contract (Lesser quest, "trigger 7 Deathrattles"): reward "Your first Echo each combat triggers twice." · '
      + 'Rune of the Herald (5g, Epic): "Start of Combat: trigger all your Echoes." · '
      + 'Deathsayer (Tier 4, 3/5): "Rally: before this attacks, trigger your leftmost Deathrattle." · '
      + 'Echohorn (Tier 4, 4/3): "Rally: trigger your left-most Echo."',
    example:
      'Example: Grave Contract complete, Rune of the Herald owned, Footman Captain leftmost. Start of Combat: the Herald force-fires '
      + 'the Captain\'s Echo — it triggers twice (the bonus is spent, 2 Footmen). Later your Mama Pup actually dies: its Echo fires '
      + 'plain — the "first Echo" charge went to a trigger where nothing died.',
    contentIds: ['rune_catacomb', 'rune_herald', 'deathsayer', 'b2_echohorn', 'deathlesshand'],
    sourceQueue: 'interactionFamilyMatrix',
  },
];
