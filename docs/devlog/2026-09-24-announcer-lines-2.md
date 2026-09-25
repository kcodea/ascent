# 2026-09-24: The announcer, second batch (15 new events, cap 15, clip fixes)

Stacked on the audio PR #1685 (`feat/audio-default-mix`: the 50/50/50 volume curve and the per-event Announcer dev
tuner). Builds on [2026-09-23-announcer-lines.md](2026-09-23-announcer-lines.md) and
[2026-09-23-announcer-runeforge-delays.md](2026-09-23-announcer-runeforge-delays.md); the queue, the gate and the
channel are unchanged.

## Owner asks (verbatim)

- Clip fix: *"the gamewon is correct. there was a toptwo2 that was wrong which i removed."*
- Random buy lines: *"Rare: ~10% per buy"*.
- Rulings from the brief: raise the cap from 8 to 15; `3WinStreak.mp3` is a second ThreeWinStreak variant; TribeFour
  is four of a tribe bought in ONE Shop turn; Round 7 is a random chance like the buys.

## What changed

- **Clips** (`apps/web/public/announcer/`, 54 files, no duplicates by md5): `game-won.mp3` re-copied from
  `GameWon.mp3` (byte-identical to what shipped: the 2026-09-23 "GameWon is a duplicate of TopTwo2" note was
  backwards, TopTwo2 was the wrong take). `top-two-2.mp3` deleted, so TopTwo has one variant. `three-win-streak.mp3`
  renamed `three-win-streak-1.mp3`, `3WinStreak.mp3` added as `three-win-streak-2.mp3`. Twenty new clips (table below).
- **`announcer.ts`**: the new events, priorities and detectors; `ANNOUNCER_LINE_CAP` 8 -> 15; `announcerRoll` (the
  seeded rare roll); `hasPair` exported for tests; the GameWon duplicate comment is gone. **ANNOUNCER_LINES is
  append-only**: `announcerVariant` hashes an event's index in that table, so the new events sit at the end and every
  first-batch event keeps its variant for a given seed.
- **`announcerSlice.ts`**: the event union.
- **`announcerConfig.ts`**: every new event has its Announcer tuner rows (Volume with the play button, Timing offset),
  baked defaults 100% and 0 ms.
- **Oracle**: `R-PRESENT-07` amended (cap, priorities, the new triggers, the clip fix, two owner quotes).
- **Patch note**: Systems, 2026-09-24.

## The event map (every event, as implemented)

Priority: higher speaks first when several are pending together; the rest are dropped. Shelf: `shop` lines expire when
combat starts, `combat` lines when the next shop opens. Every line sits behind the 12 s cooldown and the cap of 15
(GameWon / GameLoss on top of it). Once per game unless the Repeat column says otherwise. Variants are picked from the
run seed. *(2026-09-25: the cap is gone, takes are a random pick from a no-repeat bag, and a per-event chance table
gates each line; see [2026-09-25-announcer-lines-3.md](2026-09-25-announcer-lines-3.md).)* New this batch in **bold**.

| Event | Trigger | Priority | Shelf, delay | Repeat | Clips |
|---|---|---|---|---|---|
| GameWon | the run ends in 1st place | 100 | never, 1 s | once, outside the cap | game-won |
| GameLoss | the run ends 2nd to 8th | 100 | never, 1 s | once, outside the cap | game-loss-1, -2, -3 |
| TopTwo | return to the shop with 2 seats standing, you among them | 90 | shop, 1 s | once | top-two-1 (TopTwo2 removed) |
| **Knockout** | return to the shop: this round's encounter where you dealt damage and your foe went from standing to out | 88 | shop, 1 s | twice, 1+ wave apart | knockout-1 to -4 |
| TopFour | return to the shop with 4 seats standing, you among them | 85 | shop, 1 s | once | top-four-1, -2 |
| SurviveUnder10hp | verdict: you survived a fight entered at 10 Resolve or less | 80 | combat, 3 s floor | once | survive-under-10hp |
| LosingLowOddsFight | verdict: a loss at 65%+ win odds | 70 | combat, 3 s floor | once | losing-low-odds-fight-1, -2 |
| WinningLowOddsFight | verdict: a win at 35% or less | 70 | combat, 3 s floor | once | winning-low-odds-fight-1, -2 |
| **ComebackWin** | verdict: a win right after 3+ losses in a row (a draw breaks the run) | 66 | combat, 3 s floor | once | comeback-win |
| ThreeWinStreak | verdict: the third win in a row | 65 | combat, 3 s floor | once | three-win-streak-1, **-2 (3WinStreak)** |
| StartCombatUnder10hp | Face Omen at 10 Resolve or less | 60 | combat, 1.6 s | once | start-combat-under-10hp |
| **FlawlessVictory** | verdict: a win from wave 5 with none of your minions dying | 58 | combat, 3 s floor | once | flawless-victory |
| **BigHit** | verdict: a win dealing 15+ to the opposing hero (round-capped, as the table charges it) | 57 | combat, 3 s floor | once | big-hit |
| EnteringCombatAfterLoss | Face Omen after two losses in a row | 55 | combat, 1.6 s | once | entering-combat-after-loss |
| MinionHits100Stats | a minion of yours reaches 100 Attack or Health | 50 | shop / combat | once | minion-hits-100-stats |
| **GoldenArmy** | 3+ gilded minions on your board at once (hand not counted) | 48 | shop, 0 | once | golden-army |
| **ShopBigBuff** | a Shop minion offer passes 50 Attack | 46 | shop, 0 | once | shop-big-buff |
| TierSix | the Shop reaches tier 6 | 45 | shop, 0 | once | tier-six-1, -2 |
| EpicRuneforge | an Epic forge opens | 40 | shop, bypasses the cooldown | once | epic-runeforge-1, -2 |
| Runeforge | a Basic forge opens | 35 | shop, bypasses the cooldown | once | runeforge-1, -2 |
| Triple | a gilded minion forms | 30 | shop, 0 | twice, 5+ waves apart | triple-1, -2 |
| **TribeFour** | 4 minions of one tribe bought in one Shop turn (dual tribes count for both, All-tribe for every tribe) | 28 | shop, 0 | once | tribe-four |
| Equipment | an Equipment acquired | 25 | shop, 400 ms | once | equipment-1, -2 |
| **BigSpender** | 20+ Gold spent this turn with 10+ still held | 24 | shop, 0 | once | big-spender |
| **RichTurn** | return to the shop holding 20+ Gold | 22 | shop, 1 s | once | rich-turn |
| EnteringCombat | the first Face Omen (eligible through wave 3) | 20 | combat, 1.6 s | once | entering-combat-1, -2 (-3 to -7 added 2026-09-25) |
| **Pair** | your first pair: 2 copies of one non-golden minion across board and hand | 18 | shop, 0 | once | pair-1, -2 |
| GameStart | wave 1's first shop | 15 | shop, 4 s | once | game-start-1, -2 |
| **Round7** | wave 7's Shop opens, on a seeded 10% roll | 14 | shop, 1 s | once | round-7 |
| **RandomSpellBuy** | a spell buy, on a seeded 6% roll (10% until 2026-09-25) | 12 | shop, 0 | up to 3 per game, 2+ waves apart (2026-09-25) | random-spell-buy-1, -2 |
| **RandomCardBuy** | any buy, on a seeded 6% roll (10% until 2026-09-25) | 12 | shop, 0 | up to 3 per game, 2+ waves apart (2026-09-25) | random-card-buy, -2 to -8 (2026-09-25) |
| **RandomBeastBuy** | a Beast buy, on a seeded 6% roll (10% until 2026-09-25) | 12 | shop, 0 | up to 3 per game, 2+ waves apart (2026-09-25) | random-beast-buy |
| **RandomDwarfBuy** | a Dwarf buy, on a seeded 6% roll (10% until 2026-09-25) | 12 | shop, 0 | up to 3 per game, 2+ waves apart (2026-09-25) | random-dwarf-buy |
| BackToShop | return from combat, first at wave 2+ | 10 | shop, 1 s | twice, 5+ waves apart | back-to-shop-1, -2, -3 |
| TimeRunningOut *(added 2026-09-25, see [2026-09-25-announcer-lines-3.md](2026-09-25-announcer-lines-3.md))* | EVERY Shop turn whose clock (a real timer) ticks down to 15 s | 5 | shop, 0, bypasses the cooldown, waits out a playing line, dropped at 0 s | every turn; reshuffles its bag | time-running-out-1 to -21 |
| BuyDrakko *(added 2026-09-25)* | the Shop minion Drakko (`drummer`) bought | 36 | shop, 0 | once; a dropped try retries, up to 5 tries | buy-drakko-1 to -5 |
| BuySylus *(added 2026-09-25)* | the Shop minion Sylus (`sylus`) bought | 36 | shop, 0 | once; a dropped try retries, up to 4 tries | buy-sylus-1 to -4 |
| CastAle *(added 2026-09-25)* | an Ale (ALE_IDS) cast from hand | 16 | shop, 0 | once; a dropped try retries, up to 6 tries | cast-ale-1 to -6 |

Source file map for the new clips: `Knockout1-4` -> `knockout-1..4`, `Dealing15ormoretohero` -> `big-hit`,
`WinAfterLoseStreak` -> `comeback-win`, `WinWithNoMinionDeaths` -> `flawless-victory`, `3WinStreak` ->
`three-win-streak-2`, `Having3GildedMinionsOnBoard` -> `golden-army`, `StartingTurnWith20GoldOrMore` -> `rich-turn`,
`Spending20gWithOver10gLeft` -> `big-spender`, `ShopMinionBuffsOver50Attack` -> `shop-big-buff`, `GettingAPair` /
`GettingAPair2` -> `pair-1` / `-2`, `Buying4OfATribe` -> `tribe-four`, `RandomSpellBuy1` / `2` ->
`random-spell-buy-1` / `-2`, `RandomCardBuy1` -> `random-card-buy`, `RandomBeastBuy` -> `random-beast-buy`,
`RandomDwarfBuy` -> `random-dwarf-buy`, `RandomRound7` -> `round-7`.

## Interpretations (flag to the owner)

- **Knockout speaks with the return to the shop, not at the fight's verdict.** The brief said "combat shelf, spoken
  after the fight's result". But the lobby settles the round (damage, `alive`, placements) on `resolveCombat`, the
  return-to-shop action, by an earlier owner ask (2026-07-31): the eliminations are meant to appear when you leave
  the fight. So the knockout is only *known* at the return, and speaking it there keeps the line in step with the
  rail's elimination. It rides the return's 1 s delay and competes with TopTwo (90, above it) and TopFour (85, below
  it), which is where the brief's priority 88 places it anyway. A knockout that ends the game goes to GameWon instead.
- **BigHit counts the damage the hero actually takes**: `min(enemyDamage, lossDamageCap(wave))`, the same number the
  fight's damage readout shows. The round cap is 5 / 10 / 15 / 20 on waves 1-3 / 4-7 / 8-11 / 12-15 (uncapped
  after), so BigHit can first fire on wave 8.
- **FlawlessVictory** reads the sim's `playerDeaths` (raw deaths; a Rise re-slot does not count). A result without
  the field is treated as unknown and never fires.
- **ShopBigBuff** reads the offer's Attack through `offerBuyStats` (the sim's own value for what the offer buys in
  at, including the run-wide shop buffs and the Starform's baked total). "Over 50" means 51 or more.
- **GoldenArmy** counts the board only (the brief said "on your board"); a golden in hand does not count.
- **Pair** excludes golden copies, spells and Rubies; tokens count.
- **TribeFour** is kept in memory for the current turn, so a Save & Continue in the middle of a turn restarts that
  turn's count. Neutral is not a tribe. An All-tribe minion counts toward every tribe.
- **The random buy lines** roll each qualifying event separately (`announcerRoll(seed, event, wave, buy index)`), so
  one Beast buy may pass both RandomBeastBuy and RandomCardBuy; the queue then plays one (the specific one, since
  they tie at 12 and it enqueues first).
- **RichTurn** checks the Gold at the moment the Shop opens (the return update); Gold gained later in the turn does
  not count.

## Verification

- `announcer.test.ts`: a positive and a negative test per new event, the seeded roll's determinism and ~10% rate,
  the variant table staying append-only, TopTwo = 1 variant, ThreeWinStreak = 2, the cap test rebuilt for 15 lines,
  and the tuner covering every event (100% / 0 ms defaults).
- Gate: typecheck, lint, test, build:web (see the PR).
