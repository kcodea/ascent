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
  {
    id: 'R-GIFT-CADENCE-01',
    title: 'The Gift runes repeat on a turn counter: Merry Christmas every 2 turns, Happy Birthday every 3, with a live countdown',
    statement:
      'Merry Christmas reads "Discover a Gift. Repeat every 2 turns." and Happy Birthday "Get a random Gift. Repeat every 3 '
      + 'turns." Each pays the moment it is bought, then counts turn setups since its last payout and pays again when the '
      + 'count reaches its cadence (the `every` on the reward, armed onto the run at purchase: `giftChristmasEvery` / '
      + '`giftBirthdayEvery`, with `giftChristmasTick` / `giftBirthdayTick`). The Runeforge badge prints the "x/N turns" '
      + 'countdown for both. A run that bought either rune before the cadence change keeps its old rhythm (Christmas '
      + 'every turn, Birthday every 2).',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Merry Christmas)', quote: 'Discover a Gift. Repeat every 2 turns.' },
      { kind: 'owner-chat', ref: 'Owner balance batch 2026-10-10 (Happy Birthday)', quote: 'Every 3 turns (was 2).' },
      { kind: 'code', ref: 'packages/content/src/runes.ts rune_happy_birthday (every: 3) / rune_merry_christmas (every: 2); packages/sim/src/reducer.ts the runeHappyBirthday / runeMerryChristmas rewards + the turn-setup Gift block; packages/ui/src/runeTally.ts' },
    ],
    contentIds: ['rune_merry_christmas', 'rune_happy_birthday'],
    cardText: 'Discover a **Gift**. Repeat every **2 turns**.',
    currentBehaviour: 'Conforms (2026-10-10). Christmas offered a Gift every Start of Turn and Birthday paid every 2 turns, with no countdown.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/balanceBatch1010.test.ts', 'packages/ui/src/tallyCoverage.test.ts'], lastVerifiedAt: '2026-10-10' },
  },
  {
    id: 'R-WHISPER-01',
    title: 'A Whisper is granted on play and every Start of Turn, fades at End of Turn uncast, and counts as a spell cast (never a Shop spell)',
    statement:
      'A card that grants a Whisper (Galas: Tome, Tolan: Runebind) gives you a copy in hand the moment it is played from '
      + 'hand, and a fresh copy at every Start of Turn while it is still on your board (each granter its own copy, its own '
      + 'Start-of-Turn beat; a Gilded granter grants a copy worth double). A Whisper that is not cast vanishes at End of '
      + 'Turn and counts as nothing. Casting one is a spell cast (every spell tally and watcher sees it, a Yazzus repeat '
      + 'is a real second cast) but it is a Gift-class spell, never a Shop spell: never offered, never copy food for the '
      + 'spell-copy effects. Tamby copies a Whisper cast on it (once per turn); Whisp is cast on too when a Whisper lands '
      + 'on a Dragon (a full cast, never echoing again).',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner handoff 2026-10-13 (Set 4 placeholder, the Whisper mechanic)', quote: 'A card that grants a Whisper (minion, spell, rune, etc.) gives you a copy in hand. If unused, it vanishes at End of Turn and does not count as cast. At the start of your next turn you get a fresh copy again, as long as the granting card is still active/on your board.' },
      { kind: 'owner-chat', ref: 'Owner handoff 2026-10-13 (Set 4 placeholder)', quote: 'Whispers are SPELLS and count as spells cast (like Rubies), but are NOT Shop spells.' },
      { kind: 'code', ref: 'packages/sim/src/whisper.ts (grantWhispersOnPlay, vanishWhispers), packages/sim/src/recruit.ts (grantWhisper, mintWhisper, whisperBuffTarget, whisperCastOnThisCopy, whisperEchoOnDragons), packages/sim/src/reducer.ts (the Whisper cast branch, endRecruitTurn)' },
    ],
    contentIds: ['d4_galas', 'd4_tolan', 'd4_tamby', 'd4_whisp', 'w4_tome', 'w4_runebind'],
    currentBehaviour: 'Conforms as of 2026-10-13 (Set 4 is disabled; play it in the Scene Builder).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set4.test.ts'], lastVerifiedAt: '2026-10-13' },
  },
];
