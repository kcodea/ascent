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
  {
    id: 'R-DRAGON-GATHERER-01',
    title: "Gatherer: \"Rally: Get a random Dragon.\" from the run's set pool, in both phases; Gilded gets 2",
    statement:
      "Gatherer (Set 3 Dragon, T4 5/4): each Rally gets a random Dragon (every body that counts as a Dragon: duals and All-types) from the run's pinned set pool, capped at the side's shop tier. In combat it flies to hand mid-fight (the shared random-minion grant, either side) and settles into hand; a Shop-phase Rally (a forced Rally) mints it at once. Gilded: 2 Dragons.",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "Gatherer, T4 5/4: \"Rally: Get a random Dragon.\" (from the run's set pool, to hand)." },
      { kind: 'code', ref: "packages/core/src/effects/arena.ts rallyGrantRandomTribeMinion; packages/core/src/effects/factories.ts + packages/sim/src/recruit.ts grantRandomTribeMinion" },
    ],
    contentIds: ["d3_gatherer"],
    currentBehaviour: "Conforms as of 2026-10-15.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
  {
    id: 'R-DRAGON-GRAVUS-01',
    title: "Gravus (Dragon and Undead): \"Echo: Give this minion's Attack to 2 friendly minions.\" Its Attack at death, 2 different others; combat-only in combat",
    statement:
      "Gravus (Set 3, T5 8/3; Tier 6 until the owner moved it on 2026-10-15) is a Dragon AND an Undead (the tribe2 dual). Its Echo hands its Attack at death to 2 DIFFERENT random other friendly minions (never itself; Lieutenant Thane's spread body). In combat the gain is a combat buff (the buff-permanence rule); an Echo fired in the Shop is permanent. Gilded: the whole spread twice.",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "Gravus, Dragon AND Undead, T6 8/3: \"Echo: Give this minion's Attack to 2 friendly minions.\" (its Attack at death, random 2 other friendly minions; combat-only per the buff-permanence rule)." },
      { kind: 'owner-chat', ref: 'Owner change 2026-10-15 (PR #2097)', quote: 'move gravus & well watcher to t5' },
      { kind: 'code', ref: "packages/core/src/effects/factories.ts deathrattleGiveAttackToOthers; packages/core/src/effects/arena.ts rallyGiveAttackToOthers; packages/sim/src/recruit.ts deathrattleGiveAttackToOthers" },
    ],
    contentIds: ["d3_gravus"],
    currentBehaviour: "Conforms as of 2026-10-15.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
  {
    id: 'R-WHISPER-08',
    title: "Well Watcher grants Well of Dragons: \"Discover a Dragon\" (untargeted); a gilded Well is two Discovers",
    statement:
      "Well Watcher (Set 3 Dragon, T5 8/8; Tier 6 until the owner moved it on 2026-10-15) grants the Whisper Well of Dragons with the Whisper lifecycle (on play, every Start of Turn while it stands, fades at End of Turn, counts as a spell cast). Casting it (no target) opens a Discover of a Dragon from the run's set pool up to your tier. A Gilded Well Watcher grants a gilded Well, which opens TWO Discovers (the second queued).",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "Well Watcher, T6 8/8: \"Whisper: Discover a Dragon.\" The Whisper is named Well of Dragons. Gilded: Discover 2 Dragons (two Discovers)." },
      { kind: 'owner-chat', ref: 'Owner change 2026-10-15 (PR #2097)', quote: 'move gravus & well watcher to t5' },
      { kind: 'code', ref: "packages/sim/src/recruit.ts whisperDiscoverTribe; packages/content/src/cards/set3/whispers.ts w3_wellofdragons" },
    ],
    contentIds: ["d3_wellwatcher", "w3_wellofdragons"],
    currentBehaviour: "Conforms as of 2026-10-15.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
  {
    id: 'R-SPELL-MATRIARCH-01',
    title: "Matriarch: every spell (Shop spells, Gifts, Whispers, Rubies) gives your minions +3 Health; permanent in the Shop, a combat buff in combat",
    statement:
      "Matriarch (Set 3 Dragon, T6 4/12): whenever its side casts a spell of ANY kind (a Shop spell, a Gift, a Whisper, a Ruby) every friendly minion (itself included) gains +3 Health (+6 Gilded). Shop casts are permanent; combat casts (Whaloo's Runebind, a Ruby played in combat, any combat spell) are combat buffs. Each repetition of a cast pays. Only its own side's casts.",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "Matriarch, T6 4/12: \"When you cast a spell, give your minions +3 Health.\" Cross-phase (shop: permanent; combat: combat-only per the buff-permanence rule); every spell incl. Rubies, Whispers, shop spells." },
      { kind: 'code', ref: "packages/core/src/effects/arena.ts spellCastBuffAll; packages/core/src/combat/simulate.ts runeRubyCastCombat (combat Rubies); packages/sim/src/recruit.ts fireSpellCastWatchersForRuby (includeRubies)" },
    ],
    contentIds: ["d3_matriarch"],
    currentBehaviour: "Conforms as of 2026-10-15.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
  {
    id: 'R-WHISPER-09',
    title: "Woozy: \"Avenge (3): Get 2 Whispers.\" random from the whole Whisper pool, mid-fight, arriving for the next Shop under every Whisper rule",
    statement:
      "Woozy (Set 3 Dragon, T3 5/3): every 3 friendly deaths in combat it gets 2 random Whispers (seeded draws from every Whisper, the Jar of Secrets pool), flown to hand mid-fight. They arrive in the next Shop's hand and follow every Whisper rule there (they fade at that turn's End of Turn if unused, and count as spells when cast). Gilded: 2 GILDED Whispers (Shush's rule).",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "Woozy, T3 5/3: \"Avenge (3): Get 2 Whispers.\" (random from the Whisper pool, like Jar of Secrets). If gained in combat, they arrive in hand for the next shop and follow normal Whisper rules." },
      { kind: 'code', ref: "packages/core/src/effects/factories.ts avengeGrantRandomWhispers; packages/core/src/combat/simulate.ts grantRandomWhispers / grantWhisperToHand" },
    ],
    contentIds: ["d3_woozy"],
    currentBehaviour: "Conforms as of 2026-10-15. Gilded = 2 Gilded Whispers is a judgement call awaiting the owner.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
  {
    id: 'R-IMMUNE-IGGY-01',
    title: "Immune Iggy: its first 2 swings each combat take no retaliation (4 Gilded), fresh every combat, with a live countdown",
    statement:
      "Immune Iggy (Set 3 Dragon, T5 7/2): Immune while attacking, twice per combat: its first 2 swings each combat take no retaliation damage (Bounty Bot's immune-swing counter, spent one per swing). The count is fresh every combat and the combat card counts it down live. Gilded: its first 4 swings.",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "Immune Iggy, T5 7/2: \"Immune while attacking. (Twice per combat)\" (takes no damage on its own attacks, 2 uses per combat, with a live counter)." },
      { kind: 'code', ref: "packages/core/src/combat/minion.ts attackImmuneLeft (attackImmuneTurnsGilded); packages/core/src/combat/simulate.ts the swing site; packages/ui/src/cardText.ts attackImmuneText" },
    ],
    contentIds: ["d3_iggy"],
    currentBehaviour: "Conforms as of 2026-10-15. Gilded = 4 times per combat is a judgement call awaiting the owner.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts", "packages/ui/src/dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
  {
    id: 'R-WHISPER-10',
    title: "Hum: the first Whisper cast on it EACH TURN is permanent (the first 2 Gilded), stats and Seed stacks alike",
    statement:
      "Hum (Set 3 Dragon, T2 2/5): the first Whisper cast on it each turn (the first 2 when Gilded) keeps everything that cast gave it for good: its stats stop being temporary and a Seed's Drake Pup Echo becomes a permanent stack. Later Whispers that turn are ordinary (temporary). Every cast counts as one Whisper (a Yazzus repeat is a second). The count re-arms every turn (one switch, HUM_PER_TURN, makes it per game). Shop casts only: a Whisper cast on Hum in combat (Whaloo) stays combat-only.",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "Hum, T2 2/5: \"The first Whisper cast on this is permanent.\" Gilded: the first 2." },
      { kind: 'owner-chat', ref: "Owner 2026-10-15 (Hum)", quote: "first per turn" },
      { kind: 'code', ref: "packages/sim/src/recruit.ts keepWhispersOnHum / castSpell; packages/sim/src/whisper.ts HUM_PER_TURN; packages/sim/src/reducer.ts the per-turn clears" },
    ],
    contentIds: ["d3_hum"],
    currentBehaviour: "Conforms as of 2026-10-15. A combat Whisper cast on Hum (Whaloo) is not kept: an open owner question.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts", "packages/ui/src/dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
  {
    id: 'R-WHISPER-11',
    title: "Gardener's Seed: \"Echo: Summon a 3/3 Drake Pup with Taunt\" until your next turn; on Hum the stacks are permanent and uncapped, each its own Echo",
    statement:
      "Gardener (Set 3 Dragon, T1 1/1) grants the Whisper Seed: the target gains \"Echo: Summon a 3/3 Drake Pup with Taunt\" until the start of your next turn (a gilded Seed grants it twice). Every stack is its own Echo (its own trigger; Echo multipliers repeat each; summons past 7 overflow and feed the Overflow cards). On Hum (its keep) the stack is permanent and stacks across turns with no cap; triples SUM the copies' stacks; snapshots and served boards carry them; a risen body carries them into its second life; both combat sides behave the same. Every body prints its stacks (\"(xN)\") and the buffs panel lists them.",
    domain: 'gifts',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner Set 3 Dragon batch 2 (2026-10-15)', quote: "seed can stack on hum so theoretically there could be 10+ stacks of it by end game, which could create awesome overflow synergy. this is intended, make sure this works" },
      { kind: 'owner-chat', ref: "Owner Set 3 Dragon batch 2 (2026-10-15, Gardener)", quote: "Whisper: Give a minion \"Echo: Summon a 3/3 Drake Pup with Taunt.\"" },
      { kind: 'code', ref: "packages/core/src/combat/minion.ts seedEchoEffects; packages/sim/src/recruit.ts whisperGrantSeedEcho / instanceEffects; packages/sim/src/whisper.ts expireWhisperBuffs / seedEchoMerge; packages/ui/src/cardText.ts seedEchoNote" },
    ],
    contentIds: ["d3_gardener", "w3_seed", "d3_hum", "d3_drakepup"],
    currentBehaviour: "Conforms as of 2026-10-15.",
    enforcement: { kind: 'scenario', refs: ["packages/sim/src/set3Dragons1015.test.ts", "packages/ui/src/dragons1015.test.ts"], lastVerifiedAt: '2026-10-15' },
  },
];
