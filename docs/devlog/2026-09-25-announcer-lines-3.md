# 2026-09-25: The announcer, third batch (new takes, TimeRunningOut, no-repeat bag, chance table, specialty lines)

Stacked on #1720 (`feat/announcer-random-pick`: which take plays is a random pick, no seed). Builds on
[2026-09-24-announcer-lines-2.md](2026-09-24-announcer-lines-2.md), whose event map carries the new rows. The queue,
the gate and the channel are unchanged.

## Owner asks (verbatim)

- *"wire new announcer sfx C:\Game Assets\Ascent Art\SFX\Announcer"* (the folder reorganised into subfolders).
- *"the running out of time can play everytime theres 15 seconds left"*
- *"we have a global rule to never repeat lines except maybe the generic random buys sometimes?"*
- *"we need to have low-ish chances to proc the on-buy style ones except for specialty targeted ones, like
  drakko/sylus etc."*

## The audit (every file, by audio)

Every file in every subfolder was compared to the repo's clips by the MPEG stream with the ID3v2 header and the
ID3v1 `TAG` trailer stripped (the #1716 method). **No re-exports**: every file with the same name as a wired clip
matches it exactly (the Spells subfolder's RandomSpellBuy1/2 included). The only duplicates are the two StartGame `(1)` files
(already dropped in #1716). `Buying Cards/Minions/` is empty. Every new take is distinct from every other clip.

## What changed

- **Clips** (`apps/web/public/announcer/`, folder timestamp order):
  - `entering-combat-3..7`: the 5 `Entering Combat` ElevenLabs takes.
  - `time-running-out-1..21`: `Low on time`.
  - `random-card-buy-2..8`: `Buying Cards/Any`, joining `random-card-buy`.
  - `buy-drakko-1..5`: `Special/BuyingDrakko`. BuyingDrakko, BuyingDrakko2, then the 3 ElevenLabs takes.
  - `buy-sylus-1..4`: `Special/BuyingSylus`.
  - `cast-ale-1..6`: `Special/Casting Ales`.
- **New events** (appended at the END of `ANNOUNCER_LINES`; the rare-line rolls hash an event's index there):
  - `timeRunningOut`: priority 5.
  - `buyDrakko` / `buySylus`: priority 36.
  - `castAle`: priority 16.
- **Name lookups**:
  - Drakko is the Shop minion `drummer`. There is also a HERO named Drakko, but a hero is never bought, so it
    cannot trigger this.
  - Sylus is the Shop minion `sylus`. Rune of Sylus grants a Sylus at the Runeforge, which is not a buy, so the line
    fires only on buying the minion.
  - `ANNOUNCER_NAMED_BUYS` keys both by card id; the tests pin the names.
- **`announcerSlice.ts`**:
  - `heard` is the no-repeat bag: per event, the takes heard this game. It is persisted with `fired`, and optional
    so an old save reads as nothing heard.
  - `withAnnounced(slice, event, wave, take?, reshuffle?)` and `heardTakes`.
  - `store.ts` `markAnnounced` passes the take through.
- **`announcerConfig.ts`**:
  - `ANNOUNCER_CHANCE`, the ONE chance table.
  - A `<event>Chance` dial per event in the Announcer tuner (percent, defaults from the table).
  - `announcerEventChance`.
- **`Recruit.tsx`**: the shop countdown calls `observeTurnClock(next, run.wave)` on every tick of a real clock (never
  the tutorial's or God sandbox's infinite one).
- **`R-PRESENT-07`**: amended with the three owner quotes. **Patch note**: Systems, "Announcer: New Lines".

## The rules, exactly

- **No-repeat bag**:
  - The take is a random pick among the takes NOT yet heard this game.
  - An event with every take heard goes silent for the rest of the game (checked at enqueue and at speak).
  - `REUSABLE_BAG_EVENTS` (the four random buys + `timeRunningOut`) reshuffle instead: the bag empties and the pick
    is from all takes.
  - The repeatable BackToShop / Triple / Knockout draw from the bag across their occurrences.
- **Chance table**:
  - Random buys 0.06 (was 0.1), Round7 0.1, everything else 1.
  - Below 1 the seeded `announcerRoll(seed, event, wave, index)` decides (the index is the buy's count this turn;
    0 otherwise), so a replay rolls the same way.
  - Applied centrally in `enqueue`.
- **Random buy exception**: up to `ANNOUNCER_RANDOM_BUY_MAX` (3) per game, `ANNOUNCER_RANDOM_BUY_GAP_WAVES` (2) apart,
  and the bag reshuffles once exhausted.
- **Specialty lines** (`SPECIALTY_EVENTS`):
  - Each speaks the first time its moment happens in a game.
  - A dropped one (cooldown, outranked) tries again next time, at most as many tries as it has takes.
  - Tries are counted in memory, so a Save & Continue restarts the count. A spoken line stays spoken.
- **CastAle**: `spellsCast` rises on the same update an Ale (ALE_IDS) leaves the hand. So an Ale that a minion or
  rune casts, a non-Ale cast, or an Ale leaving without a cast never triggers it.
- **TimeRunningOut**:
  - Fires EVERY Shop turn whose clock ticks down to `ANNOUNCER_TIME_WARNING_SECONDS` (15). Once per turn, exempt
    from once-per-game.
  - Bypasses the 12 s cooldown but waits out a playing line.
  - Dropped if the clock reaches 0 first; End Turn expires it (shop shelf).
  - A Continue that resumes below 15 s never crosses the mark, so that turn stays quiet.

## Tests (`announcer.test.ts`, describe "the third batch")

- Every clip of every event exists and no two share audio.
- The append-only table and the priorities; the name lookups.
- The chance table + tuner defaults + a live dial.
- The no-repeat bag: no repeat across BackToShop occurrences, persisted through a Continue + a JSON round-trip,
  exhaustion goes silent, an old save without `heard`.
- The random-buy exception: 3 per game, 2+ waves apart, reshuffle.
- TimeRunningOut: every turn at 15 s with distinct takes, the reshuffle at 21, the cooldown bypass, waiting out a
  playing line, the drop at 0 and next turn's retry, the shop shelf, no timer.
- The specialty lines: first time only, a dropped one retrying up to its take count, CastAle positive + negative.
