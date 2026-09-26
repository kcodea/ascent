/**
 * APPROVED RULES — domain `text`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const TEXT_RULES: GameRule[] = [
  {
    id: 'R-TEXT-01',
    title: 'A minion that casts a named spell prints the spell, not its value',
    statement:
      'A minion whose effect CASTS a named spell (Watcher, Soul-Lantern Hierophant, Anubis: "cast Lantern of Souls") '
      + 'prints the spell name and stops. It never restates what the spell does or the number it will produce; the '
      + 'spell is an associated card of the minion, and its hover preview carries the live, spell-power-aware value '
      + '— exactly as a Ruby is previewed from the Kobolds that cast it. The live-text rule for scaling values is '
      + 'satisfied by the preview, not by the caster.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (Hierophant card review)', quote: 'the text should simply be "Avenge (3): cast Lantern of Souls" and then the lantern of souls should be a hover preview associated card, like a ruby.' },
      { kind: 'owner-chat', ref: 'CLAUDE.md, live-text rule — the sanctioned exception (owner ruling 2026-07-15)', quote: 'a minion that casts a named spell may name the spell and let the hover-preview of the spell show its live value, instead of restating it' },
    ],
    contentIds: ['watcher', 'u3_hierophant', 'anubis'],
    currentBehaviour:
      'Conforms — 2026-09-09: Watcher and the Hierophant lost their "— your Undead get +N" tails; `watcherText` (the '
      + 'helper that restated the Lantern value on Watcher) is retired to a no-op; `CARD_REF_EFFECTS` maps every '
      + 'named-spell caster factory (`rallyCastTribeAttack`, `deathrattleCastTribeAttack`, `avengeCastTribeAttack`) '
      + 'to its `spellId`, which is what the hover preview reads.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/cardText.test.ts', 'packages/content/src/refPreview.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-TEXT-02',
    title: 'A live-scaling card prints its current value on EVERY surface — shop offers, Discover, fly-ins and combat included',
    statement:
      'The live-text rule (CLAUDE.md, 2026-07-02) has no surface exceptions: a card whose printed magnitude depends '
      + 'on run state prints the current value wherever the card is shown — the shop row, a Discover option, a '
      + 'held or displaced offer, a conjured hand fly-in, the hand, the board, the end screen and the combat arena. '
      + 'A surface that shows the printed base while another shows the live value is a defect.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'revelers text needs to show their buff in shop or hand or anywhere you find them.' },
      { kind: 'code', ref: 'packages/ui/src/Recruit.tsx offerLiveTextParams + the shopViews memo (the run-scoped Spirit values threaded); packages/ui/src/Unit.tsx' },
    ],
    contentIds: ['sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler', 'sp3_luminary', 'sp3_kindled', 'sp3_nurturer'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1403). Three surfaces had dropped the shared Reveler value on the way to '
      + '`liveCardText`: the offer builder, the shop memo and the combat unit.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/renderedText.test.tsx', 'packages/ui/src/spiritText.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-TEXT-03',
    title: 'A served opponent\'s card prints — and fights with — its OWNER\'s values',
    statement:
      'A board served as an opponent carries every run-level scaler its owner had at capture, and both halves of '
      + 'the game honour them: the combat side fights with them (a served Kindled Sprite gains Attack for the Spirits '
      + 'its owner played), and the card text in the arena prints them (an enemy Vaultkeeper reads its owner\'s spell '
      + 'count, not the current player\'s and not the printed base). Per-instance display state rides the snapshot '
      + 'too. Only values the snapshot genuinely does not carry (Gold meters, Soulsman, Squirl Scout, rune flags) may '
      + 'fall back to base text on the foe side.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (bug report)', quote: 'i saw an opponent\'s vaultkeeper showed 2/2 as their buff instead of the actual value. can you do a pass to make sure we have full parity carry over for all cards in opponent snapshots?' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts enemyScalersOf (every run-level side field → CombatResult.enemyScalers); packages/sim/src/boardSide.ts sideFromSnapshot (spiritsPlayed / rubyCasts / revelerX threaded); packages/ui/src/Unit.tsx (foe reads enemyScalers)' },
    ],
    contentIds: ['d2_herzog', 'sp3_kindled', 'chefraag'],
    currentBehaviour:
      'Conforms — 2026-09-10 (PR #1404). `enemyScalers` had been a hand-picked five of the side\'s ~35 fields; '
      + '`spiritsPlayed` was never captured or threaded, so a served Spirit board\'s Kindled Sprite fought at 0.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/renderedText.test.tsx', 'packages/sim/src/snapshotFidelity.test.ts', 'packages/sim/src/docbot/snapshotFidelity.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-TEXT-04',
    title: 'A stat spell folds spell power and prints it live, in every Choose One branch',
    statement:
      'A spell that grants stats folds the run\'s spell power into what it grants, unless an owner ruling exempts '
      + 'that spell. Whatever it will actually grant is what it prints, on every surface: the card face, the shop '
      + 'offer, the hand, Discover and the Choose One window. A Choose One prints the live value of EVERY branch, '
      + 'not just the one the player ends up taking, so the choice is made on the real numbers.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Bug Board 23c340fb (owner report, 2026-09-22)', quote: 'crest of the climb not getting spell power buffs' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-12 (the Choose One half)', quote: 'if a Choose One spell is buffed, it should show the buffed spell numbers in the Choose One windows as well' },
      { kind: 'fix-pr', ref: 'PR #1619 (Crest of the Climb folds spell power) — packages/content/src/cards/set1/spells.ts (the `flat: true` exemption comes off both branches); packages/sim/src/recruit.ts spellDisplayText + chooseOneBranchText' },
    ],
    contentIds: ['crestclimb'],
    currentBehaviour:
      'Conforms as of 2026-09-22 (PR #1619). What each ref pins, so coverage is not overstated. The PRINTING half '
      + 'conforms: the derived sweep in `spellPowerText.test.ts` fails any spell whose factory folds spell power and '
      + 'whose text does not print it, and `chooseOneBranchText.test.ts` greens every folding branch and checks the '
      + 'printed number against the delta the real reducer lands. `chooseOneBoth.test.tsx` pins the EVERY SURFACE '
      + 'half (both branch texts render on every chain, the (Both) label, gilded magnitudes); it says nothing about '
      + 'spell power. The FOLDING half was unpinned until 2026-09-22: `flat: true` on a cast effect opts a grant out '
      + 'of spell power inside the factory, and both sweeps skip such a spell, so an exemption could be added with no '
      + 'owner ruling and no alarm. `spellPowerText.test.ts` now also pins the exemption list itself, to an exact set '
      + '(FLAT_EXEMPT), so a new `flat: true` fails until its ruling is written down. Crest of the Climb was the open '
      + 'case and closed on 2026-09-22 (PR #1619): both branches fold spell power now and their text greens, so its '
      + 'FLAT_EXEMPT entry is gone and `chooseOneBranchText.test.ts` asserts the greened values. The Set 3 Tower '
      + 'Shield keeps its exemption on the owner ruling of 2026-09-09.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/spellPowerText.test.ts', 'packages/sim/src/chooseOneBranchText.test.ts', 'packages/ui/src/chooseOneBoth.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-TEXT-05',
    title: 'Player-facing text never uses an em dash or a double hyphen',
    statement:
      'No player-facing string uses an em dash or a double hyphen as a clause separator. House style is one or two '
      + 'short plain sentences that say what the thing does first. This binds every surface the player reads: card '
      + 'and rune text, the keyword glossary, patch notes, screen labels and tooltips, and the helpers whose output '
      + 'only exists at run time (post-combat gains, quest lines, the rank sentences). Developer text is not bound.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (writing style ruling)', quote: 'we do not ever use \'--\' in a description. you should never either. whenever you decide to write text that is player facing, write it in our writing style. clear language, to the point.' },
      { kind: 'fix-pr', ref: 'PR #1606 — packages/ui/src/noEmDashPlayerText.test.ts is the CI tripwire; the glossary, patch notes and screen labels were rewritten in the same PR' },
    ],
    currentBehaviour:
      'CONFORMS as of 2026-09-23. PR #1606 (2026-09-21) rewrote the keyword glossary, the patch notes and the screen '
      + 'labels; the 2026-09-22 sweep found 29 cards authored before the ruling still separating clauses with an em '
      + 'dash and froze them as a debt list; the 2026-09-23 sweep rewrote every one of them (20 live, 9 archived '
      + 'Celestials), 35 hero blurb / power texts, both Prismatic Pick Equipment texts and two Learn Ascent lines, '
      + 'each dash becoming a full stop and a new short sentence, or a comma where the clause was a real aside; no '
      + 'number, keyword, target or mechanic changed. `noEmDashPlayerText.test.ts` is now a FLAT BAN over every '
      + 'authored content string: every card in the global index (drawable, token, henchman, gift, archived), every '
      + 'rune in every pool, every hero name / blurb / power, every quest name, every Equipment text and Choose One '
      + 'branch, and every tutorial course string (titles, bodies, why lines, connector labels, seat names), beside '
      + 'the glossary, patch-note, screen-attribute, run-time helper and rank-sentence sweeps it already ran. The '
      + 'double-hyphen check is a bare `--` (it was ` -- ` with spaces). The Doc Bot text parser learned the new '
      + 'sentence forms in the same PR, so its parse coverage did not move.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/noEmDashPlayerText.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-TEXT-06',
    title: 'A printed record accounts for every round played, draws included',
    statement:
      'Wherever the game prints a run record, the numbers add up to the rounds that were played. A fight where '
      + 'both boards wipe is a DRAW and is still a round, so a record that prints only wins and losses is wrong '
      + 'whenever a draw happened. Every surface prints the same shape through one helper: wins and losses, plus '
      + 'a third number only when there was a draw.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (bug report on a Career row)', quote: 'this was a 14 round game, why is my record 8-3? fix that.' },
      { kind: 'code', ref: 'packages/ui/src/leaderboardData.ts recordText (the one helper); packages/ui/src/Career.tsx (the match row); packages/ui/src/HudBar.tsx (the in-run plaque); packages/core/src/combat/simulate.ts (both boards wiped = draw)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. The Career match row and the in-run HUD plaque printed wins-losses and dropped '
      + 'draws, so a 14-round run with three draws read as 8-3. Both now call `recordText`, the helper the '
      + 'Leaderboard and Hall rows already used; the end screen already carried its own draw suffix.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/Career.test.tsx', 'packages/ui/src/ladderPages.test.tsx'], lastVerifiedAt: '2026-09-22' },
  },
  {
    id: 'R-TEXT-07',
    title: 'A hero power on a schedule prints its countdown',
    statement:
      'The live-value rule covers hero powers, and a power that fires on a SCHEDULE has a live value even when '
      + 'its magnitude is fixed: when it next fires. A scheduled power prints the countdown beside its rule, and '
      + 'says so plainly on the turn it fires, so a player never has to count turns to know what this shop brings. '
      + 'The countdown reads the same expression the reducer schedules on, so the two cannot drift.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22', quote: 'kindness hero power needs turn counter text' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts heroPowerText (the greatPresence branch); packages/sim/src/reducer.ts (the `wave % 4 === 0` schedule it reads)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. Kindness (Great Presence, a Gift Discover every 4th turn) printed a bare rule '
      + 'with no countdown; it now prints the turns remaining, and This turn on the turn itself. Odelle and '
      + 'Tempest already carried countdowns for their improving grants, which is the same rule for a magnitude.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/gifts.test.ts'], lastVerifiedAt: '2026-09-22' },
  },
  {
    id: 'R-TEXT-08',
    title: 'A printed number keeps moving during combat',
    statement:
      'The hard live-text rule does not pause for the fight. Whenever a card\'s magnitude depends on state the '
      + 'COMBAT changes (spell power gained mid-fight, an escalating spell improving itself, a counter a combat '
      + 'event feeds), every surface that prints it (hand, board, arena, a grant flying in) must show the value it '
      + 'would produce at that moment of the fight, and must land on exactly the number settle banks. The live '
      + 'value is DERIVED from the event log the simulator already emits, never computed by the UI, and the '
      + 'derivation is display-only: it may never reach the cast math.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (live spell text report)', quote: 'front to backs text/maybe all spells? not updating in real time from buffs in combat.' },
      { kind: 'fix-pr', ref: 'Live spell text + Voicekeeper fix — packages/sim/src/reducer.ts (the display-only previews are exempt from the phase guard), packages/sim/src/recruit.ts (spellAttackBonusLive / spellHealthBonusLive / spellEscalationLive), packages/ui/src/Recruit.tsx, packages/ui/src/Unit.tsx' },
    ],
    currentBehaviour:
      'Conforms for spell power and for escalating spells as of 2026-09-22. The root cause was not the readouts: '
      + 'the reducer\'s phase guard admitted only resolveCombat / settleCombat while the phase was combat, so ALL '
      + 'five display-only combat previews (escalation, spell power, spells cast, friendly deaths, blade attacks) '
      + 'were silently swallowed at exactly the moment the replay dispatched them. Yirin\'s Attunement, Cindara\'s '
      + 'Hoard and Gorun\'s Blade Mastery pills were frozen for the same reason and are fixed by the same change. '
      + 'Spell power additionally had no text channel at all: the narration drove a flourish and a card pop while '
      + 'the printed number stayed at its pre-combat value. The live value is published as an ABSOLUTE FOLD over '
      + 'the events played so far, never as a per-event bump (review 2026-09-22): a bump is only correct when '
      + 'every beat plays exactly once, and Skip, a seek and a mid-fight Save & Quit each break that, leaving a '
      + 'readout that no longer equals what settle banks. deserialize clears all five previews for the same '
      + 'reason. PARTIAL beyond these: rubyBonus, growthBonus, '
      + 'clueBonus, starCrashBonus, undeadBuyAtk, cardBuffs and impAura are settle-only carry-backs read raw by the '
      + 'combat surfaces and are stale in combat by the same mechanism. Their follow-up is scoped separately.',
    example:
      'Chorus Drake Rallies eleven times in a fight, each Rally giving your Shop spells +1 Health. A Front to Back '
      + 'held in hand must read its Health up by 11 by the end of the fight, not snap to it when the shop reopens.',
    contentIds: ['fronttoback', 'd2_chorus', 'b2_quil'],
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/liveSpellTextInCombat.test.ts', 'packages/sim/src/heroPillReadouts.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-TEXT-09',
    title: 'A minion that triggers when IT is sold prints the Sell keyword',
    statement:
      'Sell is a keyword: "Sell: Triggers when this minion is sold." Every minion whose effect fires on the onSell '
      + 'trigger (an effect on the minion being sold) prints the keyword form "Sell: …" in place of a "When you sell '
      + 'this" sentence, the word is highlighted in card text on every surface, and the hover pill and Compendium '
      + 'carry the definition. The keyword is pinned to its form: a card that reacts to selling ANOTHER minion '
      + '(the minionSold watchers), a spell that sells a minion, a sell-value line ("Sells for 2 Gold") and a hero '
      + 'power that counts sales keep their sentences and never raise the pill, because none of them is "this '
      + 'minion is sold". Text only: no effect, trigger or parameter changes with the keyword.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-23', quote: "i want to make Sell a keyword. any card that operates on a 'When you sell this' should now say 'Sell: xyz' with sell being a highlighted keyword. no mechanical change, just text and keyword updates. put a pill in for Sell that says 'Triggers when this minion is sold.'" },
      { kind: 'code', ref: 'packages/ui/src/keywordGlossary.ts (the sell entry; `match` pins it to the "Sell:" form); packages/ui/src/detectCardKeywords.ts + packages/ui/src/termColour.ts (the pill + the colouring read `match`); packages/sim/src/docbot/textParse/lexicon.ts (TRIGGER_LEXICON "Sell:" → onSell)' },
    ],
    contentIds: ['hoardwhelp', 'salvatore', 'd2_riverdrake', 'k_beggy', 'k_pouchpincher', 'n2_salesman', 'sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler'],
    currentBehaviour:
      'Conforms as of 2026-09-23. Hoard Whelp already printed "Sell: get 6 Gold"; Salvatore McKlusky, River '
      + 'Drake, Beggy, Cheap Date, Traveling Salesman and the three Revelers moved from "When you sell this, …" to '
      + '"Sell: …" (the Revelers live-value helper in packages/ui/src/cardText.ts moved with them). The glossary '
      + 'entry raises the pill and colours the word; the parser already read "Sell:" as onSell.',
    example:
      'Beggy reads "Sell: get 2 Rubies." with Sell highlighted; hovering shows "Sell: Triggers when this minion is '
      + 'sold." Arcane Behemoth still reads "When you sell a Demon, this gains its stats." and shows no Sell pill.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/detectCardKeywords.test.ts', 'packages/ui/src/termColour.test.tsx', 'packages/ui/src/keywordGlossaryCoverage.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-MEDAL-01',
    title: 'A minion with a Sell effect shows the Sell medallion',
    statement:
      'Every minion whose own effect fires when it is sold (the onSell trigger, printed "Sell: …") shows the Sell '
      + 'medallion at the base of its frame. When the card has other mechanics too, the medallion goes to the one '
      + 'its text mentions FIRST, and the "Sell:" lead counts as a mention of Sell, so a card that opens with '
      + '"Sell:" always shows Sell, whatever it Discovers, casts or does at End of Turn afterwards.',
    domain: 'text',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-25 (Traveling Salesman medallion report)', quote: 'travelling salesman should have the sell medallion' },
      { kind: 'fix-pr', ref: 'fix/traveling-salesman-sell-medallion — packages/ui/src/mechanics.ts (the sell entry\'s termRe now matches "Sell:"), packages/ui/src/mechIcon.ts (resolveMech orders by first text mention)' },
    ],
    contentIds: ['n2_salesman', 'salvatore', 'hoardwhelp', 'd2_riverdrake', 'k_beggy', 'k_pouchpincher', 'sp3_flamereveler', 'sp3_tidereveler', 'sp3_grovereveler'],
    currentBehaviour:
      'Conforms as of 2026-09-25. When R-TEXT-09 (2026-09-23) moved Sell cards from "When you sell this, …" to '
      + '"Sell: …", the Sell mechanic\'s text matcher still looked only for "when you sell". A single-mechanic Sell '
      + 'card still showed Sell, but on a multi-mechanic card the other term won the ordering: Traveling Salesman '
      + 'and Salvatore McKlusky showed Discover, Hoard Whelp showed End of Turn. The matcher now also reads "Sell:".',
    example:
      'Traveling Salesman ("Sell: Discover a minion you control exactly one copy of.") shows the Sell medallion, '
      + 'not the Discover star.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/mechIcon.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
];
