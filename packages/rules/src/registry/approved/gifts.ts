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
  {
    id: 'R-WHISPER-03',
    title: 'Whaloo casts a real Runebind on an attacking Dragon, 3 times per combat: combat-only stats, permanent improve, counted',
    statement:
      'Whaloo (Set 3 Dragon, T6 9/10): when a friendly Dragon attacks (Whaloo included), cast Runebind on it, at most 3 '
      + 'times per Whaloo per combat (the cap counts TRIGGERS; a Queen Morro repeat is the same trigger). Each cast is a '
      + 'real combat spell cast: it counts for every spell tally (Galas\'s Tome, quests, runes; the run\'s spellsCast at '
      + 'settle), Whisp casts it on itself too (it landed on a Dragon) and Tamby copies it to hand (once per fight). Its '
      + 'stat grant is combat-only (a combat buff); Runebind\'s "Improve this" is PERMANENT and real time: the next cast '
      + 'this fight reads it, and settle raises the run\'s Runebind to it. A Gilded Whaloo casts a GILDED Runebind '
      + '(double value and improve, the Shop\'s gilded formula); the cap stays 3. "(3 times per combat)" counts down live.',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner addition 2026-10-14 (Whaloo)', quote: 'this WILL permanently scale the runebinds that game and also count as spells cast etc for anything that triggers or counts those effects.' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts onDragonAttackCastWhisper + castWhisperInCombat; packages/core/src/combat/simulate.ts whisperImproveFor / addWhisperImprove / grantWhisperToHand; packages/sim/src/reducer.ts settle (ShoutCarry.whisperImprove, handWhisperMults)' },
    ],
    contentIds: ['d3_whaloo', 'w4_runebind', 'd4_whisp', 'd4_tamby'],
    currentBehaviour: 'Conforms as of 2026-10-14 (Set 3 is disabled; play it in the Scene Builder).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Dragons1014.test.ts', 'packages/ui/src/whispers1014.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
  {
    id: 'R-WHISPER-04',
    title: 'Falx grants Ripple: "Trigger a minion\'s Shout"; a Shout-less target refuses the cast; a gilded Ripple triggers it twice',
    statement:
      'Falx (Set 3 Dragon, T5 6/5) grants the Whisper Ripple with the Whisper lifecycle (on play, every Start of Turn '
      + 'while Falx stands, fades at End of Turn, counts as a spell cast). Ripple re-fires the target\'s Shout through the '
      + 'shared Shout-replay path (every Shout multiplier and tally sees it). A target with no Shout refuses the cast and '
      + 'the Ripple stays in hand (the Resonance precedent). A Gilded Falx grants a gilded Ripple: the Shout fires twice, '
      + 'each its own replay, and the Ripple prints "twice" live. Tamby copies it, Whisp is cast on when it lands on a '
      + 'Dragon, Tome counts it.',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner addition 2026-10-14 (Falx)', quote: 'Whisper: Ripple - Trigger a minion\'s Shout.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts whisperReplayShout; packages/sim/src/whisper.ts whisperTargetLegal; packages/sim/src/reducer.ts the Whisper cast branch' },
    ],
    contentIds: ['d3_falx', 'w3_ripple'],
    currentBehaviour: 'Conforms as of 2026-10-14.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Dragons1014.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
  {
    id: 'R-WHISPER-05',
    title: 'Shush equips Jar of Secrets: (2) Gold, get 3 random Whispers from the whole Whisper pool, each an ordinary Whisper',
    statement:
      'Shush (Set 3 Dragon, T4 5/4) equips Jar of Secrets, whose "(2)" is its Gold cost (the Equip convention; one use '
      + 'per turn like every Equipment). Using it draws 3 times (seeded) from every Whisper (Tome, Runebind, Ripple, and '
      + 'any future one); each is an ordinary Whisper: it fades at End of Turn if unused, prints its live value, counts '
      + 'as a spell cast. A Gilded Shush gets 3 GILDED Whispers from its Jar of Secrets. (Jar of Secrets was briefly '
      + 'specced as a Shop spell; the owner made it the Equipment of Shush the same day, and the spell never shipped.)',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner change 2026-10-14 (Shush)', quote: 'Equip: Jar of Secrets (2): Get 3 random Whispers.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts mintRandomWhispers / grantRandomWhispers; packages/content/src/equipment.ts JAR_OF_SECRETS; packages/content/src/index.ts WHISPER_IDS' },
    ],
    contentIds: ['d3_shush'],
    currentBehaviour: 'Conforms as of 2026-10-14. The Gilded wording (3 Gilded Whispers) is a judgement call awaiting the owner.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Dragons1014.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
  {
    id: 'R-WHISPER-06',
    title: 'A Gilded granter\'s Whisper is gilded: its effect and improve double, on every surface',
    statement:
      'A Whisper from a Gilded source (Galas, Tolan, Falx, a Gilded Whaloo\'s cast, a Gilded Shush Jar of Secrets) carries a x2 '
      + 'multiplier: Tome / Runebind grant double and Runebind improves double, Ripple triggers the Shout twice. The '
      + 'Whisper in hand, its granter\'s text and the hover preview print the doubled value live; a Tamby copy of a gilded '
      + 'Whisper (Shop or combat) is gilded too.',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner 2026-10-14', quote: 'whispers can be gilded if the minion providing the whisper is gilded. the effect just doubles.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts mintWhisper / withWhisperMult / whisperLiveText; packages/ui/src/cardText.ts whisperGranterText' },
    ],
    contentIds: ['d4_galas', 'd4_tolan', 'd3_falx', 'w4_tome', 'w4_runebind', 'w3_ripple'],
    currentBehaviour: 'Conforms as of 2026-10-14 (verified; nothing needed fixing in the Shop).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Dragons1014.test.ts', 'packages/sim/src/set4.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
  {
    id: 'R-WHISPER-07',
    title: 'Runebind\'s own effect plays on the target of every cast, from every source, in both phases; its buff is a named, expiring row',
    statement:
      'The owner\'s Runebind FX def (`runebind`) is bound buffedOn on Runebind\'s card and plays ON the target once per '
      + 'cast: from hand, a Yazzus repeat, Whisp\'s echo, a Tamby copy, a gilded copy, Whaloo\'s combat casts and a Queen '
      + 'Morro repeat. In the buffs panel a Shop Whisper grant is its own row under the Whisper\'s name with "until your '
      + 'next turn"; a combat cast lands on the same named row (no "this combat" suffix, owner 2026-10-14).',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner 2026-10-14', quote: 'runebind effect. this should play at all casts of it, when it casts from whaloo, or on whisp etc.' },
      { kind: 'owner-chat', ref: 'Owner 2026-10-14', quote: 'runebind should be a tracked buff in the buffs panel' },
      { kind: 'code', ref: 'packages/ui/src/fx/defs/runebind.json; packages/ui/src/choreo/bindings.json w4_runebind; packages/ui/src/buffExpiry.ts; packages/ui/src/useCombatReplay.ts (whisperCombatBuffLabel)' },
    ],
    contentIds: ['w4_runebind'],
    currentBehaviour: 'Conforms as of 2026-10-14.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Dragons1014.test.ts', 'packages/ui/src/fx/runebindFx.test.ts', 'packages/ui/src/whispers1014.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
  {
    id: 'R-SPELL-MORRO-01',
    title: 'Queen Morro: every spell cast in combat (Shop spells, Rubies, Whispers, minion / rune casts) casts +1 more time (+2 Gilded), live',
    statement:
      'While Queen Morro (Set 3 Dragon, T5 7/8) is alive on a side, every spell that side casts IN COMBAT resolves one '
      + 'additional time (two for a Gilded Morro; several Morros add up), added to the other extra-cast sources (Runebloom '
      + 'Matriarch, the Ancient of War). Each extra cast is a real cast: it counts for every spell tally, quests and runes, '
      + 'Runebind improves per cast, and it has its own announcement and FX. A Ruby played in combat outside a spell cast '
      + 'repeats too (a spell\'s own Rubies already repeat with the spell, never squared). A dead Morro stops paying. '
      + 'Shop-phase casts are untouched.',
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner addition 2026-10-14 (Queen Morro)', quote: 'counts all spells, rubies, shop spells, whispers etc' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts spellCastRepsFor / combatSpellsExtra; packages/core/src/effects/factories.ts castInCombat, playRubyOn' },
    ],
    contentIds: ['d3_morro'],
    currentBehaviour: 'Conforms as of 2026-10-14.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Dragons1014.test.ts'], lastVerifiedAt: '2026-10-14' },
  },
];
