# ASCENT — Game Rules (canonical)

The current player-facing rules of the game, verified against the code. Every claim cites its
source file. Anything not confirmable from code is marked **(unverified — confirm)**.

ASCENT is a deterministic, **asynchronous auto-battler**: shop for minions, build a 7-slot board, and fight
auto-resolved combats inside an **eight-seat elimination lobby**. You are not racing a fixed course — you are
outlasting seven other seats, and your **final placement** is the result that moves your ladder **rank** (a
medal + division — see *Ranked ladder* below).

> **RETIRED — do not describe as current.** The **17-round course** and the **Line / Oath** success contract
> are no longer the game. Their constants (`CONFIG.courseRounds: 17`, `defaultLine`, `calibrationRounds`,
> `maxWave`) and helpers (`metLine`, `lineResult`) still exist in code, and are still read by balance tools,
> older saved runs, and the non-lobby modes — but the live `Play` route is the lobby, which has no course
> clock and no Line verdict. **Your W–L record counts every round** — `calibrationRounds` is 0 since
> 2026-09-20 (the old "first two rounds don't count" made a 15-round game read 9–4). Legacy sections of this
> document were rewritten on 2026-08-20; the historical
> detail lives in [`devlog.md`](devlog.md).

> **Player-facing vocabulary:** the UI displays some systems under themed names while the code keeps the
> internal terms — **Resolve** is the seat's health pool, **Embers** are Gold. **Rating is displayed as
> "Rating"** (owner 2026-08-04; the earlier *Renown* rename is reverted). A lobby run's Career row reads as
> its score, finish position, Victory/Defeat and the Rating change — no Oath verdict.

---

## The lobby — eight seats, elimination

- A run is **one seat in an eight-seat lobby** (`DEFAULT_LOBBY_RULES.seatCount: 8`). **Seat 0 (`s0`) is the
  live player**; the other seven are independently developed runs.
- A non-player seat is a **snapshot** (a recorded player run), a **hybrid**, a **bot**, or — in the tutorial
  only — an **authored** seat. Player snapshots fill every seat the pool can cover; bots take what is left,
  so an empty pool degrades to a fully generated table rather than a smaller one. **Which** snapshot runs sit
  at the table is a seeded uniform shuffle of every eligible run in the lobby's set (owner 2026-09-13): every
  run is equally likely, the same lobby seed always seats the same table (restore / replay), and nothing
  weights the draw — no recency, no win-rate weighting (that exists only on the pre-lobby pool pick). A RATED
  lobby draws only from the runs inside the player's **strength band** (below, R-LOBBY-09); inside the band the
  draw is the same uniform shuffle. **One player holds at most 4 seats** (owner 2026-09-29, R-LOBBY-08: "so it's not literally like 7
  of me always"): a run whose player already holds 4 is passed over for the next in the shuffle, which leaves
  every other run equally likely; when the pool lacks enough players, generated seats fill the rest. **Your own
  runs sit at your table like anyone else's, under the same cap of 4** (owner 2026-09-30: *"this is a problem - you should face your own boards too. you should also be able to occupy up to 4 of your own snapshots. please fix this"*;
  until then your own runs were left out). A player is their account (`boards.user_id`), else their display name.
  **All eight heroes are unique per lobby, the player's included** (owner 2026-09-13): a run on a hero already
  seated — or on the player's hero — is passed over for the next run in the shuffle, and generated seats never
  repeat a hero either.
- **An eligible run covers the rounds it will be asked for** (2026-09-29, R-LOBBY-07): at least 4 recorded
  waves, the first at wave 1 or 2, never more than one wave missing in a row, and no board above a plausible
  shop tier for its wave (the all-in tavern-up curve + 2). Such a run is skipped. A generated seat's recording
  buys the first rune it can afford at each Runeforge, as a real player does.
- **The pool is made of WHOLE RUNS, drawn at random** (owner 2026-09-29, R-LOBBY-08: "isnt it just replaying
  snapshots from the player's game?", "make sure this is firmly fixed and will be scalable and a non issue moving
  forward", "i want them random from all snapshots in the pool"). The client receives a uniform random sample of
  the eligible runs of its set and build version (150 runs; every run equally likely, however old), each run with
  ALL of its boards, or not at all: the server picks runs (`pool_runs_sample`), a run that arrives incomplete is
  refused whole, and the local cache stores whole runs. **A recorded seat's board for round N is that run's own
  wave-N board.** The only tolerances are for boards a real game never uploads (an empty board): a single missing
  wave serves the run's previous board, and a run that starts at wave 2 serves that board in round 1. A later
  board never appears, except past the run's end, where the stale-final-board rule applies (the run keeps its
  final board, with its own Armor). Until 2026-09-29 the pool was pulled as the newest boards per wave, which cut
  older runs down to their late waves and served a wave-10 board on round 5.
- **Board strength and matchmaking bands** (owner 2026-09-30, R-LOBBY-09: *"can we build an algorithm for board
  strength to get as good of an idea of how strong a snapshot's run is, and assign it a 1-100 value?"*, *"serve for
  example 0-30 for bronze, 10-40 in silver, 20-65 in gold, and then uncap plat?"*, *"72 would basically mean like...
  a 72/100 aka 72nd percentile"*).
  - A board's **raw strength** is its win rate (win 1, draw 0.5) against a frozen, versioned **reference set** of
    ~30 real boards of its wave (`strengthReference.v1.json`, version `set2-v1`, generated once from the live pool,
    weakest to strongest), two seeded fights per reference board, the scored board once on each side, both sides
    fought with the full combat side a recorded seat fights with (runes, auras, spell power). Waves past the last
    reference wave (15) are scored against it. Deterministic; stored permanently with the board
    (`boards.strength_raw` / `strength_ref` / `strength_wave`), never recomputed.
  - Its **percentile** (1-100) is its place among every scored board at the same reference wave: the share it is
    stronger than, ties counted half, rounded. Derived, so it follows the pool as it grows; never stored on a board.
  - A **run's strength** is a **percentile among runs** (owner-approved 2026-09-30, R-LOBBY-12): the **round-weighted**
    average of its boards' percentiles (`pool_runs.strength_avg`; owner 2026-09-30: *"rounds 1-5 matter much less
    than 6-9 which matter less than 10+"*): rounds 1-5 share **20%** of the weight, rounds 6-9 **35%**, rounds 10+
    **45%**, split evenly over the run's boards inside each group (a duplicate board for a round counts twice). A
    group the run never reached drops out and the rest renormalise (a run that ended in round 8: 20/55 and 35/55).
    Rounded half up to 1..100, then ranked against every other run's average in the set by the same rule
    (`pool_runs.strength`). 72 = stronger than 72% of runs, and each band holds about its nominal share of the pool.
    Averages refresh on every upload for the uploaded runs and for every run at most every 10 minutes; ranks are
    recomputed on every refresh. **From 2026-10-03 to 2026-10-06** the run's strength was its final board's percentile
    instead (#1928); the owner reverted it on 2026-10-06 (*"matchmaking algorithm -> backtrack to the weighted
    version"*) after a live-pool audit showed it barely tracked how strong a run's boards were in rounds 3-7. Numbers
    frozen in match history keep the value they were frozen with.
  - **Early and late ratings** (owner 2026-10-06, R-LOBBY-13: *"perhaps we have multiple ratings like the weighted
    system / and we lean into those different ratings depending on the rank / ... early is 1-9 / late is 10+"*). Each
    run also has an **EARLY** rating (the plain mean of its board percentiles in rounds **1-9**) and a **LATE** rating
    (rounds **10+**), each rounded half up and then ranked among the set's runs by the same rule as its strength
    (`pool_runs.strength_early` / `strength_late`, averages in `strength_early_avg` / `strength_late_avg`). A run with
    no scored board at round 10+ has no LATE rating. These two are for **matchmaking only**: the "Game strength" players
    see stays the weighted number above.
  - **Bands by medal** (every division of a medal shares it; owner 2026-10-06: *"for bronze we should have a near 100%
    focus on making sure that the early board strength stat is 0-20 or w/e / then silver is like 10-30 with an 80%
    weight / etc / then gold is 10-50 with 60% weight"*, then *"Blend, then band"* and *"Open from Platinum"*). A
    run's **score** for a medal is **weight x EARLY + (1 - weight) x LATE** (EARLY alone when it has no LATE), and the
    band filters that score:

    | Medal | Early weight | Band | Overall cap (R-LOBBY-15) |
    |---|---|---|---|
    | Bronze | 100% | 0-20 | 40 |
    | Silver | 80% | 10-30 | 60 |
    | Gold | 60% | 10-50 | 75 |
    | Platinum, Diamond, Ascendant | - | none (anything goes) | none |

    **Overall caps** (owner 2026-10-09, R-LOBBY-15: *"we want to add overall board strength caps on TOP of the existing
    early rating strength matching. if a boards overall strength is over 40, it should n ever be in bronze. if a boards
    overall stength is over 60 it should never be in silver. if a boards overall strength is over 75 it should never be
    in gold. from there, theres no additional cap"*). On top of the band, a run's **weighted strength** (the "Game
    strength" number, `pool_runs.strength`, not the early / late score) must be **at or under** its medal's cap: a run
    at 40 can sit in a Bronze lobby, a run at 41 cannot. A run must pass both. The cap is **hard**: widening (below)
    never relaxes it, so a band that still cannot fill the table after widening fills the rest with generated seats. A
    run with no weighted strength yet stays eligible.

    Before 2026-10-06 the bands filtered the weighted strength directly: Bronze 0-30, Silver 10-40, Gold 20-65,
    Platinum uncapped, Diamond 10-100, Ascendant 20-100 (owner 2026-09-30: *"maybe plat should be 50 and then diamond
    is like 55 average and ascendant is 60 average?"*), retuned from 2026-10-03 to 2026-10-06 for the final-board scale
    to Gold 15-65, Platinum 15-100, Diamond 25-100, Ascendant 35-100. A rated lobby's recorded seats come only from runs
    inside the band (the server samples inside it, and seat selection filters to it), still whole runs, still at most
    4 seats per player (your own runs included, under the same cap). A run with **no score yet counts as inside every
    band**. When the band cannot fill the table it **widens by 10 on each capped side**, one step at a time (each step
    logged to the pool telemetry), until it is uncapped (for Bronze, Silver and Gold: until only the overall cap is
    left). Only then do generated seats fill the rest. Practice and the
    tutorial have no band. Until the owner runs `supabase/migrations/2026-10-06-early-late-strength.sql` the pool has no
    early / late ratings, and the same bands filter the weighted strength instead. Until the owner runs
    `supabase/migrations/2026-10-09-strength-overall-caps.sql` the server does not apply the overall cap; the game then
    applies it itself when it picks the seats (every run arrives with its weighted strength), so the rule holds either way.
  - Your own boards are scored in the background while you play (idle time only; the last board during its combat)
    and upload with their scores. The pool's strength table is read whole, every page (R-NET-01). When the game ends,
    each round's board percentile and the run's strength (its round-weighted average ranked against the pool's run
    averages) are **frozen** into the game's record: the Career and Recent Games
    rows print **"Game strength N"** (the run's strength; renamed from "Board strength" for display, owner 2026-09-30, with a hover tip that says later rounds count more), and Match details shows your per-round board percentiles
    and each opponent seat's run strength. A game that was not scored (the
    pool's strength data unavailable, or older games) shows nothing.
- **A lobby that seats player runs waits for the opponent pool** (owner 2026-09-28, R-LOBBY-06). A rated lobby
  or Practice against players is not built until the shared pool has loaded: instantly when it already has,
  otherwise behind a cancellable "Finding opponents..." wait while it retries. Only a genuine failure (offline)
  falls back, and never silently: the player chooses Retry, Play anyway (generated seats, **unrated**, see
  below) or Back to menu. The last good pool for the live set (whole runs) is cached locally and is used when
  the network cannot supply a sample.
- The lobby is **asynchronous**: opponents are recordings and generated runs, never live opponents. It never
  requires two players online at once.
- Each round, surviving seats are **paired**. **One authoritative `simulate()` resolves each encounter and
  supplies BOTH sides' damage** — combat is not symmetric, so a fight must never be re-run with the sides
  swapped to get the "other" result.
- **Armor absorbs damage before Resolve** (`startingArmor: 15`, `startingResolve: 30`). A seat whose total
  reaches 0 is eliminated and receives a placement.
- The lobby ends when **one seat remains**. `maxRounds: 60` is a **deterministic stalemate backstop**, not a
  course length or a player-facing target.
- **The fight ledger** (owner 2026-09-22): at the end of every real lobby (never practice, the tutorial or a
  sandbox) the client records **every fight the table resolved** — one row per fought, non-ghost pairing, both
  sides named by run key (`author|heroId|seed`; a generated seat is `bot:<kind>:<heroId>`). If the player was
  knocked out before the table finished, the remaining rounds are **played out deterministically on a copy** of
  the lobby (same seed, same drivers, never the reducer's own lobby) and recorded as unobserved fights. Ghost
  fights, sit-outs and bot-versus-bot fights are not rows. The server aggregates the ledger per run
  (`run_fight_records`: fights, W–L–D, lobbies, win rate, a Wilson 95% lower bound).
- **The Hall of Champions** answers *"what board has been the best against everything else"* (owner
  2026-09-22): the **top 10 runs by the Wilson lower bound of their win rate with at least 10 fights**, from
  every recorded run (not only lobby winners). A row shows the run's W–L–D across everything, its win rate, the
  lobbies it fought in, its own game's record (e.g. 12–3, from its career row — that count includes the player's
  ghost fights, which the ledger does not), its last fight and the rank its player held.
- **Placement is the result.** A lobby finish resolves a placement-based rank change (the medal ladder
  below); 1st is the win. (A lobby never reaches the `victory` phase — `advanceCombat` ends every lobby at
  `gameover` whether you won or lost, because a lobby has no course clock to complete.)
- A run **pins its set at creation** and reads it forever after, so an in-progress or replayed run is
  unaffected by a later global set change.

Source: `packages/sim/src/lobby/boardStrength.ts` + `strengthBands.ts` (board strength, bands),
`supabase/migrations/2026-09-30-board-strength.sql` + `2026-09-30-weighted-strength.sql` (restored by `2026-10-06-weighted-strength-again.sql`), `packages/sim/src/lobby/lobby.ts` (`DEFAULT_LOBBY_RULES`, damage application),
`packages/sim/src/lobby/runLobby.ts`, `packages/sim/src/lobby/seats.ts`,
`packages/sim/src/lobby/snapshotSeats.ts`, `packages/sim/src/lobby/fightLedger.ts`, `packages/sim/src/rank.ts`,
`packages/sim/src/lobbyStrength.ts`, the `run_fight_records` view (`supabase/migrations/2026-09-22-fight-ledger.sql`).

---

## Practice: God Mode and Sandbox Mode (owner design 2026-10-08)

The Practice screen offers two modes side by side in two equal halves, **Sandbox Mode** on the left and **God
Mode** on the right, each with a **Select** button and a short description, then **Start** (R-GODMODE-08).
**Sandbox Mode** is the Practice game that already existed (its options are described under *Unverified / confirm*
below) and is selected every time the Practice screen opens; its options (heroes, health, time, tribes) are greyed
out and can't be changed while God Mode is selected.

### God Mode

A learning playground: all the Gold, no clock, and any card or rune on demand.

- **Fixed setup.** God Mode ignores the Sandbox options and always plays with every hero, Unlimited health, every
  tribe and no timer; the player's Sandbox settings are left as they were (R-GODMODE-08).
- **Gold and clock.** It starts with 999 Gold. Everything costs Gold as normal, but whenever the Gold drops below
  900 it tops back up to 999. The shop never has a clock: no timer, no Gold Fuse (R-GODMODE-03).
- **The God Mode panel** shows only in the shop, never during a fight (R-GODMODE-06). It can be dragged by its
  **GOD MODE** header and collapsed. From the top:
  - **Tier Filter:** chips for Tiers 1 to 7. **Tribe Filter:** a chip per tribe plus **Neutral** (R-GODMODE-07).
  - Then **Add to Shop**, the list buttons: **Minions**, **Spells**, and **Runes** / **Epic runes** side by side. Each button opens
    its searchable list in a side window beside the panel, one window at a time; pressing the same button again,
    the window's ✕ or Esc closes it. Hovering a row shows the card or rune.
  - Clicking a minion or spell puts it in your shop (any tier, even past the shop's normal slots); clicking a rune
    or Epic rune gives it to you free, with a "Gained …" confirmation. A card put in the shop this way is an ordinary
    shop card: normal price, Freeze keeps it, a roll replaces it, it counts toward triples. A rune taken a second
    time works exactly like buying a second copy; a rune that can't stack is marked owned (R-GODMODE-02).
  - While a Discover, Runeforge, quest or Ancients choice is open, the panel is greyed out and says to finish that
    choice first (R-GODMODE-02).
- **Filters.** Several chips can be on at once in each filter; no chip on means no filter. Spells follow the Tier
  Filter and ignore the Tribe Filter. Both filters combine with a list's search text (R-GODMODE-07).
- **Choosing the opponent.** End Turn asks *"What round should your opponent board be on?"* with buttons 1 to 15.
  Clicking one starts the fight at once against a random real player's board from that round, from the same card set
  (and from the current game version once the online board finder is switched on; until then it can be a board
  from an earlier version). If none is found, the prompt says so and no fight starts; it never fights an empty board. Closing
  the prompt stays in the shop (R-GODMODE-04).
- **It never ends on its own.** No last round and no lobby finish (the other seats can't be knocked out); with
  Unlimited health, the game ends when the player leaves (R-GODMODE-05).
- **What's hidden.** The lobby rail never shows in God Mode, and the "ROUND X" label at the top of a fight is hidden
  too (you choose each fight's round yourself) (R-GODMODE-06).
- **Nothing is kept.** No save or Continue, no XP, no crate, no Practice upload, no replay. The player's real saved
  game is untouched and is still offered as Continue afterwards (R-GODMODE-01).

Source: `packages/sim/src/godMode.ts`, `packages/sim/src/reducer.ts` (`godPrint`, `godGrantRune`),
`packages/ui/src/godMode/` (panel, round prompt, board finder), `packages/ui/src/PracticeOptions.tsx`,
`supabase/migrations/2026-10-08-god-board-sample.sql` (`god_board_sample`; until it is deployed, boards come from
the set downloaded at startup).

---

## Gauntlet

Single-player stages, each a 10-round duel against one hand-built opponent whose board grows every round
(R-GAUNTLET-01, R-GAUNTLET-02, R-GAUNTLET-03, R-GAUNTLET-05, R-GAUNTLET-06).

- **Win a stage** by still standing after round 10's combat, even if you lose or tie that round.
- **Lose** the moment your Resolve (after Armor) hits 0. The opponent never takes damage and can't be knocked out.
- **Loss cap:** at most 5 per lost round on rounds 1–3, 10 on 4–6, 15 on 7–8, no cap on 9–10. Ties cost nothing.
- **The shop is the normal game's** (economy, tiers, tribes, a random shop every attempt), with any hero at their
  normal Resolve and Armor. You can't see the opponent's next board before combat.
- **Shop timer:** no clock until you spend 30 Gold in a round, then 60 seconds (R-GAUNTLET-04). Every lobby and
  Practice run the same Gold Fuse at 10 Gold, then the round's normal turn length (see the Ranked ladder, R-TIMER-FUSE-01).
- **Opponent runes:** one from round 6, a second from round 9 (both active from then on). Only their combat effects act.
- **Opponent run buffs:** a stage can give the opponent the run-wide values a real run builds up (Ruby strength, spell
  power, auras, counters like Grim's Deathrattles). A value set on a round lasts for every later round until changed,
  and the opponent's cards use it in combat just as yours use your own.
- **Stages:** 1 Demons · 2 Kobolds · 3 Dragons · 4 Dwarves · 5 Beasts; 6–10 are unique stages still to come.
  Clearing a stage unlocks the next.
- **Progress is saved to your account** when you're signed in, so it follows you to any device.
- **The first clear of each stage earns a crate** (signed in only). You can replay a cleared stage any time, but
  clearing it again never earns another crate.
- **Not signed in (or playing as a guest)?** You can still play: your progress is saved on this device only, your
  clears don't earn crates, and the stage select tells you so. Signing in later starts your account's own
  progress and doesn't grant crates for stages you cleared before signing in.

Source: `packages/sim/src/lobby/gauntlet.ts`, `packages/sim/src/lobby/gauntlet.test.ts`; account progress:
`packages/ui/src/gauntlet/gauntletProgress.ts`, `supabase/migrations/2026-09-29-gauntlet-progress.sql`.

---

## Match details — the lobby when your game ended (owner ask 2026-09-28, R-MATCH-01)

- After a lobby game (Ranked or Practice; never the tutorial or a sandbox), the end screen offers **Match details**
  once the placement has shown: all eight seats with hero, name, placement, the round each went out (or Winner,
  or **Still in**) and health. It opens on the seat that knocked you out, else the best other seat.
- **The moment is YOUR end**: your knockout round, or the final round when you won (or when Practice's curtain
  fell). A seat still standing then shows the board it fielded that round; a seat that went out earlier shows the
  board it went out with (the same board the lobby raises as its ghost). Seats still standing when you went out
  have no placement yet: they read **Top N** (N = your placement minus one) and are ordered by health. The lobby
  is not played on for this.
- The boards are **recorded, never recomputed**: built once at run end from the lobby's own
  `prepare(round) ?? finalBoard()` call, before the fight ledger's play-out, then stored. Skins render only
  through the opponent toggle (your own seat wears your recorded skins).
- The selected seat's **runes** at that moment (owned rune ids off its board snapshot) show under its board, and a
  seat whose run is currently on the **Hall of Champions** wears a gold crown (one cached read of the Hall's own
  query per panel open; offline = no crown). Board cards are always the compact tile here (the hover reveal shows
  the full card) and the panel reserves its scrollbar gutter, so it never shifts.
- **Board strength** (R-LOBBY-09): each seat whose run was scored shows "Game strength N" (hover tip: what it means) (its run's strength when
  the game ended), and your own seat also shows each round's board strength. Unscored seats show nothing.
- The record is saved with the match (`run_history.entry.match` for Ranked, `practice_games.replay.match` for
  Practice; both existing JSON columns) so the Career's match history shows it again under each match's **Lobby**
  button. Older matches say the details were not recorded.

Source: `packages/sim/src/lobby/matchDetails.ts`, `packages/ui/src/store.ts` (`matchDetailsOf`),
`packages/ui/src/matchDetails/`.

---

## Ranked ladder — medals and divisions (season 3, owner rules 2026-09-20 and 2026-09-21)

The visible ladder is a **medal + division**, not a number. Only a finished **rated lobby** (the `Play`
route) moves it; Practice, the tutorial and sandbox runs never do.

- **Offline = unrated** (owner 2026-09-28, verbatim: *"offline = unrated"*; R-LOBBY-06). A lobby whose seven
  opponent seats are ALL generated (no recorded player run at the table: "Play anyway" after the opponent pool
  could not be reached, or any other path to an all-bot table) is **unrated**: no points, no division change, no
  promotion or demotion, and no Ranked XP or Ranked achievements (streaks included). It is marked at creation
  from the seat kinds (`lobbyIsUnrated`), the end screen reads **"Unrated · No opponents reached"**, and the
  client submits no rank request. The server enforces it too: `submit-rating` refuses to settle a request whose
  seat keys are all generated (`bot:…`, `allSeatsGenerated`). A lobby with at least one real run is rated as usual.
- **Every lobby plays on the Gold Fuse** (owner 2026-10-07, verbatim: *"every rank will have the gold fuse
  implemented. it will kick off the timer when 10 gold is spent. this is for all ranks, so we can remove the silver note
  when promoted. i want to clarify that the round timer should follow the existing round by round time increase, not
  the 60/90 secnd timer that is part of the current gold fuse timer for bronze."*; follow-ups *"Yes, early rounds
  untimed"*, *"All lobbies, Gauntlet unchanged"*; R-TIMER-FUSE-01). In every lobby (ranked at every medal, and
  unrated tables) and in **Practice**, each Shop turn opens with **no clock**; a bar fills with the Gold spent that
  turn, and at **10 Gold** a countdown starts at **that round's normal turn length**: the standard round-by-round
  schedule (21, 22, 26, 30, 34, 44, 48, 52, 56, 60, 64, 80, 84, 88 s for rounds 1-14, then 92 s), times Practice's
  1x-4x choice. It never restarts within the turn, and at 0 the Shop locks exactly like any timeout (R-TIMER-LOCK-01).
  The fuse is there from round 1 (owner clarification 2026-10-07: *"i want to clarify that the gold fuse will still
  show and operate during rounds 1-7"*): rounds 1-7 usually never reach 10 Gold (3 Gold on turn 1, +1 a turn), so they
  often have no clock, but they show the 0/10 bar and light at that round's length the moment 10 Gold is spent (round 3:
  26 s); no round falls back to an always-running clock.
  Practice on **Unlimited** has no clock and no fuse. The **Gauntlet** keeps its own 30 Gold / 60 second fuse
  (R-GAUNTLET-04), the tutorial stays untimed and the sandbox keeps its own clock. The player's rank never changes the
  clock, so no rank-up screen mentions it. This replaced the 2026-10-06 **Bronze-only** fuse (20 Gold, then 60 s / 90 s
  from turn 9, R-TIMER-BRONZE-01) and its **Bronze → Silver "Shop Timer Adjusted" notice** (R-TIMER-BRONZE-02), both
  retired; `RunState.medalAtStart` is still pinned for telemetry (R-TELEMETRY-RANK-01) but the clock no longer reads
  it, so a game saved under the Bronze rules resumes under the new fuse. Source: `packages/ui/src/goldClock.ts`
  (`goldClockOf`) and `packages/ui/src/turnClock.ts` (`standardTurnSeconds`, the one schedule the plain clock and the
  fuse share).
- **Leaving a rated game early costs nothing** (owner 2026-10-02, verbatim: *"oh i didnt know there was an
  abandon penalty in. can we remove that for now?"*; R-RANK-05, switched off). Giving up an unfinished rated game
  (**Clear** on the title, starting any new game over it, or a cloud copy of another run adopted over it) simply
  drops it: no rank request, no Rating change, no Career row, no XP, and the title tips name no placement. An
  abandon request still waiting in the local rank queue is dropped, never sent. **Save & Quit** + Continue is
  unchanged: the game settles once, at its real end. The superseded penalty (2026-09-29: an abandon settled as a
  finish in the lowest place still open, 8th with nobody out) is kept in code behind `ABANDON_PENALTY_ENABLED`
  (`packages/ui/src/rank/ratedRun.ts`) so it can be turned back on. The server has no abandon path of its own: it
  settles whatever placement a client sends, so builds from before the switch keep charging abandons until replaced.
- **What Continue resumes** (owner 2026-09-30, R-PERSIST-01). A game is saved only once a hero is picked and it has
  started; backing out of the title, the Practice setup screen or the hero picker saves nothing. Only a lobby game
  (Play, Sandbox Mode Practice, the tutorial; never a God Mode game) is ever saved or resumed. A saved run in the retired 17-round course format is
  dropped at load (not a quit, no settlement) and no Continue is offered; no menu starts a course run any more.
- **Continue on any device** (owner 2026-09-30, verbatim: *"if a player is playing on one device and they save/quit,
  can we allow that to be picked up from another device they are signed in on?"*; R-PERSIST-CLOUD-01..03). A
  signed-in (non-guest) player's saved game is also stored on their account (`saved_runs`, one per account): at the
  start of each shop phase, on Save & Quit and on tab hide, always AFTER the local save (offline play is unchanged;
  the upload retries). At the title a newer account copy becomes the Continue and resumes exactly that run, lobby,
  pinned opponents and the recordings behind its real-player seats included (a mid-combat quit resumes like a local
  one). **One device at a time**: Continue claims the game (a revision-checked write); a device still holding an
  older copy has its next save refused and is stopped with "Your game moved" (load the newer copy, or Main menu).
  A game that ends (or is Cleared) clears the account copy too, so Continue disappears everywhere and a stale local
  copy of it elsewhere is dropped. Replacing a different saved game with the account's newer one settles the
  replaced rated game like any abandonment (the rank server settles a run once). Guests stay local-only. Replay
  frames stay on the device that recorded them, so a game moved between devices has a partial recording.

- **Six medals — Bronze, Silver, Gold, Platinum, Diamond, Ascendant — three divisions each**, ordered
  **I → II → III** and then the next medal's I (18 divisions, `Bronze I` lowest, `Ascendant III` highest).
  Each division is **100 points** wide.
- **Points by final placement** (`RANK_RULES.placementAwards`): 1st **+40**, 2nd **+28**, 3rd **+16**, 4th
  **+6**, 5th **−6**, 6th **−16**, 7th **−28**, 8th **−40**. No round-wins modifier. The one other thing that
  moves the ladder is the **lobby-strength bonus** (owner 2026-09-22, revised the same day: *"the strength bonus
  applies to any TOP-4 finish, scaled by BOTH placement and lobby strength"*): a **top-4** finish in a lobby of
  strength `s` adds `round(15 × placementWeight × strengthFactor)` points on top of its award, where
  `placementWeight` is **1.0 / 0.8 / 0.62 / 0.47** for 1st / 2nd / 3rd / 4th and
  `strengthFactor = clamp((s − 50) / 50, 0, 1)` (0 at strength 50, an even lobby, and below; 1 at 100; the floor
  was 30 until the owner's 2026-09-22 ruling that a 45% lobby must pay nothing). The anchors: 1st at 100 = **+15**,
  1st at 75 = +8, 4th at 100 = +7, 2nd at 100 = +12, 3rd at 100 = +9, 1st at 50 = 0, 4th at 50 = 0. Never on 5th–8th, never negative, losses untouched. The bonus is folded into the award BEFORE
  the gate rules below, so a 1st at 90/100 still caps at 100, a top-4 at a division gate still lands on 10 and
  a 4th at a medal gate still holds at 100. The result records it apart (`strengthBonus`; the rank screen
  prints "+52 MMR" (one summed number, owner 2026-09-22)). The SERVER computes the strength itself at settle time from the fight ledger
  (`settle_rank(p_seat_keys)`), mirrored in `packages/sim/src/lobbyStrength.ts` (the weights and the 50 / 50
  line live in ONE place per copy) and `supabase/functions/_shared/lobbyRating.ts`.
- **Lobby strength** (0–100, `packages/sim/src/lobbyStrength.ts`): the average win rate of the seven opponent
  runs, as a percentage, where each run's rate is smoothed as `(wins + 10) / (fights + 20)` over its record in
  the fight ledger (an unserved run counts as 50) and a generated seat (a bot) counts as 25. It is the field GOING IN:
  the fights of the lobby being stamped are excluded on both copies (server by `lobby_seed`, client by subtracting
  the rows it uploads), so the Career and Recent Games stamps agree and never depend on the game itself. Tiers (`STRENGTH_TIERS`, one place, stored
  with the stamp but NOT printed anywhere): Easy below 35, Even 35–54, Hard 55–69, Brutal 70 and up. Rank is NOT a factor
  (owner 2026-09-22: *"rank is not important right now as a factor in this small playtest. eventually it will
  be"*). It is computed at run end and stamped on the run's replay result (the Recent Games row); the history
  entry (the Career row) carries the server's own computation, stamped at settle time, because the history
  insert never waits on the client's fetch. Shown as a percentage, e.g. "47%" (no tier word, owner 2026-09-22), on the **Career match rows and the Recent
  Games rows only** — never on the post-game screen, never on the rail before or during a game (owner answers
  4 and 5). **Currently HIDDEN** (owner 2026-09-30: *"we can hide the lobby% number for now since it doesnt seem
  to be working too well at the moment"*): one flag, `SHOW_LOBBY_STRENGTH` in `packages/ui/src/lobbyStrengthDisplay.ts`,
  switches the readout off on every surface; the value is still computed, stamped, uploaded and still drives the
  strength bonus.
- **Promotion games.** Reaching **100** does not promote; it makes the **next** rated game a promotion game
  (overflow past 100 is discarded; the delta shown is the delta applied). To move up **a division** (Gold I
  → Gold II) the promotion game needs a **top-4 finish**; to move up **a medal** (Gold III → Platinum I) it
  needs **1st place**. A won promotion game starts the next division at **10 / 100** — not the game's award
  (owner 2026-09-21; it was 0 / 100 the day before). The 10-point landing is a cushion so a narrow loss
  straight after promoting does not drop the player back down: a 5th (−6) leaves them at 4, still in the new
  division; a bigger loss crosses 0 and follows the demotion rule below (it stops at 0 and arms the demotion
  game; it never drops the division on its own). The applied delta of a won promotion is therefore +10 on
  the scalar (`100 × division + points`), whatever the finish; the game's award is reported as converted
  into the promotion, not as capped. A lost promotion
  game (5th–8th) applies its normal negative points from 100; the gate reopens when the player climbs back
  to 100. At a **medal** gate, a 2nd–4th finish neither promotes nor gains — the player stays at 100, still
  promotion-ready.
- **There are no instant demotions** (owner ruling 2026-09-21: *"Hitting 0 MMR should halt the loss and put
  you in a demotion game. You need to then bottom-4 that game to demote."* This widened the 2026-09-20 rule,
  which gated only the drop out of a medal, to every division). In **any division above Bronze I**, a loss
  that would take the player below 0 **stops at 0** and *arms* the demotion gate (a stored `demotionReady`
  flag — set only by a loss that lands on 0, by clamp or by exact subtraction; cleared by any non-negative
  result; never set by a promotion landing: 10/100 after a won promotion is not armed; the first loss of 10 or
  more there clamps at 0 and arms it, the second demotes). Gold II 10 → 8th → **Gold II 0, armed** (not Gold
  III 70); Gold II 6 → 5th → Gold II 0, armed as well. Standing at 0 without such a loss is not armed, and
  a top-4 from there is an ordinary gain.
- **Demotion games.** While armed, the **next** rated game is a demotion game: a **bottom-4 finish (5th–8th)
  demotes one division** to **`100 + that game's award`** in the division below (5th → 94, 6th → 84, 7th →
  72, 8th → 60 — the mirror of the promotion landing rule): Gold II armed → 8th → Gold I 60. Across a medal
  boundary the division below is the previous medal's division III: Gold I armed → 8th → Silver III 60. A
  **top-4 finish escapes**, applies its positive award normally from 0 (3rd → Gold II 16), and disarms the
  gate (reaching 100 that way unlocks the promotion gate as usual).
- **Bronze I floors at 0** with no gate (nothing below it). **Ascendant III is uncapped** (points keep
  climbing past 100, no promotion gate); a loss that hits 0 there arms a demotion game like everywhere else
  (its demotion game drops to Ascendant II).
- **Career best** (division first, then points) never decreases. **Leaderboards sort by division, then
  points** — the reporting scalar `100 × division + points` still exists (`profile.rating`) but ties Gold II
  100 with Gold III 0, so it is never the sort key.
- **The server is the authority.** A finished rated lobby submits `{ run id, placement, season, rules
  version }` and the `settle_rank` transaction (lock → dedupe → resolve → commit) returns the immutable
  result the post-game screen animates plus the account's current rank; the client only mirrors it. A result
  that cannot be sent (offline) is kept and retried; it never resolves locally. **Season 3 started everyone at
  Bronze I 0/100.**

Source: `packages/sim/src/rank.ts` (`RANK_RULES`, `resolveRank`, `settleRank`), `supabase/functions/
_shared/lobbyRating.ts`, `supabase/migrations/2026-09-20-medal-rank.sql` (`settle_rank`),
`packages/ui/src/rank/` (submission states + the durable pending queue).

---

## Account Level — permanent XP (owner decisions 2026-09-27; R-PROG-XP-01, R-PROG-CURVE-01, R-PROG-TITLE-01, R-PROG-CRATE-01, R-PROG-CRATE-02, R-PROG-CRATE-03, R-PROG-CATALOG-01)

Account Level is a **permanent, earn-only** number that grows with every completed game. It never resets and
never touches the ranked ladder (Ranked answers "how am I doing right now"; Account Level answers "how much have
I played"). Live only once the owner has run the migration, deployed `submit-progression` and set the
progression **epoch**; nothing finished before the epoch counts (no backfill).

- **Match XP.** Ranked: **100** for a completed game, **+60** Top 4, **+90** for 1st, **+25** comeback (so a 1st
  is 250, a Top 4 160; the placement bonuses were 40 / 60 until owner 2026-10-03, "+50% bonuses").
  Practice: **60%** of the equivalent Ranked XP, summed then rounded (60 / 96 / 150 / 165); a Practice game with
  no meaningful placement (Unlimited Health, played to the curtain) earns a flat **60**. The first completion of
  the current **Learn Ascent** course: **250**, once per account. Scene Builder, sandboxes and quit games: 0.
  No caps, no diminishing returns, no repeat penalties.
- **Comeback.** A loss adds to a streak, a draw neither adds nor clears it, a win after 4+ consecutive losses
  earns the bonus. Once per run.
- **Curve.** 250 XP per level from Level 1 to 11, 400 per level to Level 26, 500 per level after, uncapped.
  Lifetime XP is stored; the level is derived from it (versioned), so one game can cross several levels.
- **Level title.** The title **Alpha Tester**, unlocked by **every** account at Level 2 (a level milestone, never
  in a crate) and equipped when no title is equipped. Shown in the Collection's New rewards pop-up and on the
  Career (public).
- **Level crates (2026-09-28).** **Every level grants one sealed crate**; an account's first settled game
  (enrollment) also grants the Level 1 **Welcome Crate**. So an account at Level L has earned L crates. Earn only:
  no keys, currency, purchases or rerolls. Accounts enrolled before crates shipped received their Welcome Crate
  plus one crate per level already reached (a one-time backfill).
- **New rewards wait in the Collection (owner 2026-09-28, R-PROG-NEWREWARDS-01).** The end screen shows only the
  placement, the XP gained, the level bar and the level-up moment, plus one line when anything new was earned. The
  achievements, first-time titles and crates a game awarded are queued per account (localStorage, survives a reload,
  never shown twice) and shown ONCE as a **New rewards** pop-up the next time the Collection opens (achievements with
  their XP and a "See all in Career" link, titles, crates with Open / Open all); any way out of it marks them seen.
  While rewards wait, every Collection entry point (the title plaque, the side menu, the Career's Account Level card)
  wears an orange **NEW** pill.
- **Opening.** Optional and never forced (Continue is always available): from the New rewards pop-up or any time
  from the **Collection** (its own screen since 2026-09-28: the title's Collection plaque, the menu
  sidebar, or the Account Level card on your Career; Open one crate, or Open all). The reward is chosen **when the crate is opened**, on the
  server, from the items the player does not own yet. **The rarities (2026-10-02, R-PROG-RARITY-01)** are Common,
  Rare, Epic, Legendary and **Ancient**, rarest last: Ancient ranks above Legendary everywhere (sorting, colour, label,
  filter, roll). **Fixed rarity odds (2026-09-29, R-PROG-CRATE-03; re-set 2026-10-02 when Ancient joined):** one
  server draw first rolls a rarity at **Common 35% / Rare 31% / Epic 22% / Legendary 9% / Ancient 3%** (was
  50 / 30 / 15 / 5), then picks an unowned item
  of that rarity, **every item of the rarity equally likely** (owner 2026-09-29: "yeah equal chance"; category weights
  stay in the catalog but the roll no longer reads them). The odds never move as items are added, and the Collection's crate
  bay prints them. A rolled rarity with nothing left falls to the **nearest** rarity that has something, ties toward
  the more common one (Epic empty goes to Rare before Legendary; Ancient empty goes to Legendary). Opened crates
  record roll version 4 (3 before Ancient). Moving an item to another rarity never takes it from a player who owns it
  (ownership is per item id). **Never a
  duplicate.** With nothing left to give, the crate stays **sealed** (`pool_exhausted`) until new items arrive;
  it is never converted into anything. A new title is worn at once only when none is worn.
- **The opening (presentation, 2026-09-28).** A full-screen opening that starts on the click while the server
  answers (anticipation), then plays the answer's rarity: a charge, a burst and the reward rising out of the light.
  It escalates with rarity (Common quick, Rare blue, Epic purple and longer, Legendary gold with god rays and a
  sting, Ancient the biggest of all in cyan to magenta, "Prismatic Aurora"). **Ancient's own moment, "Time stops"
  (owner pick 2026-10-02):** at the end of the charge the chest freezes mid-shake, the sound cuts and the scene drains
  to grey for a beat, then a prismatic crack splits the view at the burst and the colour floods back. A click or a key skips to the reward; reduced motion is a short fade; a failed answer says "Could not open
  the crate. Try again." Presentation only (oracle R-PROG-COLLECTION-01). The crate is the owner's treasure chest in
  two layers (body + lid): the lid rattles, light leaks from the seam and the keyhole, the lid blasts off at the burst
  and the open body stays on the pedestal while the reward rises above it (oracle R-PROG-COLLECTION-03).
- **The catalog (2026-09-28).** Data in `packages/progression/src/cosmetics.ts`, which OWNS the database copy: the
  `progression-inventory` Edge Function syncs it on its first request per cold start (`sync_cosmetic_catalog`;
  R-PROG-SKINS-05), so a new or retired cosmetic is a code change plus one deploy, never SQL. Shaped
  for every cosmetic category (announcer, hero skin, minion skin, title, hero attack, board, music, portrait frame). Switched on:
  **titles** (15 crate titles: 7 Common, 5 Rare, 2 Epic, 1 Legendary) and, since the skins shipped the same day,
  **hero skins** and **minion skins** (all from crates) and **hero attacks** (Arcane Barrage, Tectonic Slam, Arcana, Phantom Blades, Enraged Strike, Venom Volley, Frost Nova, Consecration, then Inferno, Grave Call, the Stampede, Oona's Banana Cannon and Hemorrhage, all Legendary; then the first Epics, Card Shark and Storm Call; then the Rares Pocket Change, Come Back Around, Bubble Trouble and Shadow Step). The other
  categories are feature-flagged off until their art exists. Crate odds are the fixed rarity odds above, then an equal
  share inside the rarity: on the 2026-09-29 catalog each Common is 6.25% (50 / 8), each Rare 1.76% (30 / 17, since the four Rare hero attacks joined), each Epic
  1.25% (15 / 12, since Card Shark and Storm Call joined) and each Legendary 0.31% (5 / 16, since Inferno, Grave Call, the Stampede, Oona's Banana Cannon and Hemorrhage joined). A fresh account's first crate is about 45% a skin or hero attack.
- **Skins (2026-09-28; oracle R-PROG-SKINS-01, R-PROG-SKINS-04).** A hero skin replaces one hero's portrait; a
  minion skin replaces one card's art, by stable id. Equipped per target from the Collection's Heroes / Minions
  tabs through the server (`equip_cosmetic`: owned, made for that hero or card, live); **"Use default art"** is
  always selectable. It shows wherever that target appears for the player wearing it: hero select, the seat list,
  your portrait (also the combat hero), the NOW FACING and fight-recap portraits, the end screen, the Career
  (favourite hero, match history) and every card of that id in the shop, hand, board, combat, Discover, the end
  screen board, Career boards and the Minion Book. **Gilded** copies wear the skin under the normal Gilded frame
  (no separate unlock). **Tokens** are their own ids and stay unskinned. Looks only: balance, targeting and
  hitboxes never change. **Recorded per run:** the loadout is captured when a run starts (`run.cosmetics`;
  equipping mid-run changes the next run), every captured board carries it scoped to its hero and cards, and a
  lobby seat built from a recorded run copies its owner's (`LobbySeatState.cosmetics`). So opponents, replays and
  history show the skins worn in **that** run, never anyone's current loadout; any payload from before skins is
  default art.
  **Collection previews (2026-09-30; oracle R-PROG-COLLECTION-04):** a hero skin previews in the in-game portrait
  ring; hovering a minion skin you OWN floats the real in-game card wearing it; "Use default art" switches the
  preview to the default art at once and keeps that skin selected, with Equip to put it back on.
- **The damage formation (2026-09-28; oracle R-PROG-ATTACK-08).** Before EVERY hero attack (Classic and every cosmetic,
  one shared implementation), the blow builds on screen from the engine's own numbers: each surviving minion of the
  striking side pulses its tier badge left to right as its tier number pops up; the numbers flow toward the middle and
  merge into one minion number; the striking hero's tier number appears at the hero and the minion number joins it; the
  full blow slams in; only when the round cap cut it, a slash hits it, it counts down to the cap and a "Damage capped"
  stamp slams on; then the attack carries the final number. **Classic** (the free default, R-PROG-ATTACK-09) then plays the
  original swing (a minion's wind-up and strike at the old tempo) with a small knockback, a subtle
  camera and the same big `-N`; the old green attack pill and red damage-taken number are gone. The numbers come from the fight's result
  (`damageBreakdown` / `enemyDamageBreakdown` with each survivor's uid, `playerDamageUncapped` / `enemyDamage`, and the
  run loop's `damageCap` stamp); an older result shows what it knows (no breakdown: just the blow; no cap stamp: no cap
  beat). No hero attack ever freezes (R-PROG-ATTACK-10): no hit-stop on any impact, the slam or the cap slash; weight comes
  from the flash, squash and knockback, shake, particles and sound. Tuned in the dev hub's Damage Formation tuner; production plays the baked defaults.
- **Hero attacks (2026-09-28; oracle R-PROG-ATTACK-01..21).** How your hero lands the post-combat blow. **Classic**
  (the lunge) is everyone's default; **Blast** is the first cosmetic, `attack_blast` ("Arcane Barrage", Legendary,
  from crates; animation and tier thresholds owner-approved): after the damage formation, the hero charges, the view pushes in, and bolts (a single
  beam on the biggest hits) carry the blow, escalating by damage tier (I 1-5, II 6-11, III 12-19, IV 20+). **Quake** is the
  second, `attack_quake` ("Tectonic Slam", Legendary, from crates; R-PROG-ATTACK-05): the same damage formation, then the hero
  stomps. Tiers I-III hurl boulders (one, two, three hot ones) that burst a crown of stone spikes out round the struck hero;
  only Tier IV is an earthquake: a quick fracture races to the target and the ground erupts (a light burst, a shock ring, a
  spray of magma, a pillar, follow-up explosions). Same tiers as Blast. **Arcana** is the third, `attack_arcana` ("Arcana",
  **Ancient** since 2026-10-02 (was Legendary), from crates; R-PROG-ATTACK-06): the same damage formation, then magic ribbons are lobbed on high arcs from the hero (I one;
  II two on different heights and sides; III a barrage of five that lands in rhythm, the blow landing once on the last; IV the
  ribbons swirl into a vortex over the struck hero, converge and explode outward, the blow landing on the explosion).
  **Phantom Blades** is the fourth, `attack_blades` ("Phantom Blades", a placeholder name; Legendary, from crates;
  R-PROG-ATTACK-07): the same damage formation, then spectral swords are summoned round the hero, swing round to aim, lock still,
  and are loosed in straight thrusts that stick in the struck hero (I one; II a pair that crosses in an X; III a fan of five
  that hammers in, the blow landing once on the last; IV six blades as ticks, then a greatsword hangs over the hero, locks on
  and impales the target, the blow landing on the greatsword); every stuck blade then shatters (looks only).
  **Enraged Strike** is the fifth, `attack_enraged` ("Enraged Strike", a placeholder name; Legendary, from crates;
  R-PROG-ATTACK-11): Classic's own swing, enraged. After the same damage formation the hero coils deeper while a rage aura
  burns round the portrait (live particle fire since 2026-09-29, R-PROG-ATTACK-16) and bursts in a roar, dashes in leaving afterimages and a scorch, and stops at the struck hero's
  rim so every hit reads on contact: a white flash, rings, claw rips and glowing rim cracks. Every hit is a full cycle: a hard
  recoil off the foe, a coil, a dash back in and its own impact, each harder than the last (I one hit; II a double; III a
  combo of three with a finisher, the blow landing once on the finisher; IV a rampage of five slams that speed up, then the
  hero rears way back and brings an overhead haymaker down on the foe with a flaming crescent, a rage shockwave, molten
  cracks and an ember storm, the blow landing on the haymaker). **Poison Darts** is the sixth, `attack_poison`
  ("Venom Volley", a placeholder name; Legendary, from crates; R-PROG-ATTACK-12): after the same damage formation the hero
  flicks small poison darts that thunk into the struck hero and stick at varied angles, with venom splashes and a sickly
  green tint (I one dart; II two in quick succession; III a fan of five, the blow landing once on the last; IV six darts
  stick round the face, glow and swell, are sucked into one point and burst in a toxic cloud, the blow landing on the
  burst). **Frost Nova** is the seventh, `attack_frost` ("Frost Nova", a placeholder name; Legendary, from crates;
  R-PROG-ATTACK-13): after the same damage formation, faceted icicles crystallise round the hero's portrait and fire at the
  struck hero, shattering into shards while frost creeps over its edge (I one; II two; III a volley of five, the blow
  landing once on the last; IV four icicles, then a frost nova rolls across the screen from the attacker to the target,
  encases the struck hero in ice and shatters it, the blow landing on the shatter). The ice holds still; the clock never
  stops. **Consecration** is the eighth, `attack_holy` ("Consecration", a placeholder name; Legendary, from crates;
  R-PROG-ATTACK-14; **Ancient** since 2026-10-02): a gold and white holy attack, drawn flat (no perspective rings or tilted ground). After the same
  damage formation the hero invokes (a halo ring, a sunburst, a beam of light rising off it), then: I a golden rune sigil
  flashes onto the struck hero and a pillar of light drops onto it; II a double smite; III a rain of six light spears
  plants glowing seeds round the struck hero, then the pillar drops and the seeds erupt with it (the blow landing once,
  on the last smite); IV six holy swords fly in one after another from different directions, faster and faster, and
  plant round the centre of the board, the centre implodes, and a flat consecrated blast races across the board to the
  struck hero, tearing radiant cracks, and holy flames erupt round it (the blow landing on the eruption). **Inferno** is the
  ninth, `attack_fire` ("Inferno", a placeholder name; Legendary, from crates; R-PROG-ATTACK-15): every flame in it is live
  particle fire (hundreds of small flame puffs and licking tongues that rise, sway and cool from white-hot to red, with
  smoke and embers), never a flame picture. After the same damage formation fire catches round the hero's rim and
  fireballs ignite round the portrait and are hurled with comet tails of flame: I one; II two (the struck hero's rim
  briefly alight); III a volley of five bigger fireballs, the struck hero catching more with every hit, then flaring up
  and burning (the blow landing once, on the last); IV three fireballs, then the hero hurls a column of fire into the sky,
  the struck hero is marked (the ground under it heating, heat rings closing in, flames licking up round it) and a meteor
  streaks down onto it and detonates: a white-hot flash, shockwaves, a fire nova racing outward, a fireball rolling up into
  a mushroom of smoke, burning debris flung out on arcs, a pillar of fire engulfing the struck hero and a scorch (the blow
  landing on the detonation). **Grave Call** is
  the tenth, `attack_undead` ("Grave Call", a placeholder name; Legendary, from crates; R-PROG-ATTACK-17): a flat undead
  attack in spectral green and teal over purple-black. After the same damage formation a grave circle turns under the
  hero and ghost wisps spiral in, then: I a spectral skull pops out of the hero, shrieks, flies at the struck hero
  trailing afterimages and bites it, bursting into wisps and bone; II two skulls; III skeletal hands claw up round the
  struck hero and drag it down while a swarm of eight ghost wisps strikes it, then a big skull finishes it (the blow
  landing once, on that bite); IV a grave rift tears open between the heroes, a giant skull maw rises out of it,
  shrieks, lunges and chomps the struck hero (the blow landing on the chomp), and a wave of necrotic mist washes out.
  The maw always stays whole on screen. **The
  Stampede** is the eleventh, `attack_beast` ("Stampede", a placeholder name; Legendary, from crates; R-PROG-ATTACK-18): a
  beast chomp rush in feral green and amber. After the same damage formation the hero crouches and growls, then spirit
  wolves (heads of feral energy with streaming manes and gleaming fangs) leap from it at the struck hero, and as each
  lands a pair of spectral jaws SNAPS SHUT over the portrait, leaving bite marks: I one wolf; II two, staggered; III a
  pack of five streaming across and kicking up dust (every chomp before the last a tick, the blow landing once on the
  last); IV six chomps round the face, then a colossal beast's jaws rise far above and below the struck hero, creep in and
  SLAM shut over the whole portrait (the blow landing on the slam), and the beast roars (shockwave rings and speed lines,
  FX only). **Banana
  Cannon** is the twelfth, `attack_banana` ("Oona's Banana Cannon", a placeholder name; Legendary, from crates;
  R-PROG-ATTACK-19), built on King Oona's own card FX: her painted banana (spinning with backspin) is every projectile
  and her painted juice splat every impact, with her juice particles and clips. After the same damage formation a golden
  flourish opens on the hero and it flings bananas on high lobbed arcs: I one; II a double; III a barrage of eight (the
  blow landing once, on the last); IV four warm-ups, then a giant golden banana arcs high, hangs (a crown glint, a flat
  golden target ring), and lands stuck in the struck hero's rim; the striking portrait dashes over and slams it in six
  times, reeling far back between slams, driving it deeper each time (only its end sticks out by the last), a crater and
  cracks spreading, extra bursts of banana juice splats from the fourth slam on (no blood); the sixth slam bursts it into a massive splat and a banana shower, and no dark crater ring is left behind (the
  blow landing there). While it slams, the striking portrait is drawn on top of the banana. **Hemorrhage** is
  the thirteenth, `attack_bleed` ("Hemorrhage", a placeholder name; Legendary, from crates; R-PROG-ATTACK-21): a stylised
  crimson slashing attack, drawn flat. After the same damage formation the hero draws back and swings: each slash
  looses a crimson crescent that turns to its cut and runs through the struck hero's face, a white seam drawing behind it,
  blood spraying along the blade, and the line opening into a gash (I one diagonal gash; II a cross of two; III four
  fast slashes and a three-claw rake, the wounds bleeding and dripping, the blow landing once on the last cut; IV three
  claw rakes, the wounds throb with a heartbeat while the striker winds a huge crescent, then the screen-splitting
  mega-slash zips through the target EIGHT times, each in from the far side of the screen on its own line,
  accelerating into a blur (each zip a tick) and flinging blood that piles up across the whole screen, a beat of held
  tension, and a huge bloody explosion that paints the screen in blood and fades out, the blow landing on the
  explosion; the claw rakes before it sweep wide lines too). **Nothing But Net** is the fourteenth,
  `attack_basketball` ("Nothing But Net", a placeholder name; Legendary, from crates; R-PROG-ATTACK-33): the striking
  PORTRAIT plays basketball, drawn flat, with a hoop (backboard, rim, net) appearing on the struck hero. A referee's
  whistle opens every tier. I the jumper: a dribble where it stands, a small jump, a high arcing shot with backspin that
  swishes through the net (the blow lands on the swish). II the fadeaway: it dribbles out to mid court with one of three
  dribble moves rolled per fight (a behind-the-back wrap, a crossover, a spin move), pushes off
  backwards and to the side with more room, releases at the top of the fade, swish (a small crowd "ooh"), and slides
  home. III the pull-up three: it scoots from its slot to one of three spots rolled per fight (straight up court, the
  left wing or the right corner; down court for a foe striking from the top), a pass flies in from off the edge of the
  screen the spot faces and it catches it, pump fakes, dribbles back and pulls up for a long high three in a moment of
  slow motion that eases back as the ball flies, and it swishes (a bigger swish, rings, confetti and the crowd's "ooh"),
  then slides home. The roll comes from the run seed and the round, so a replay rolls the same. IV the self
  alley-oop: from its slot it drills a pull-up three (swish), rotates up court to the rolled spot, takes a pass and drills
  another (swish; both are ticks, no damage, the crowd building), rotates back to its slot, then fires a hard chest pass
  that bangs the backboard (the board wobbles; the struck hero does not react) and rebounds out to half court, where the
  ball arrives first; the striker crouches deep, charging up, and LAUNCHES (a shock ring of dust, speed lines, a building
  aura), catches the ball in the air at half court in deep slow motion, and flies in one fluid, accelerating slam through
  the rim onto the struck hero: an explosion (a fireball, shockwave rings, debris and sparks, the backboard's glass, the
  whole board shaking, the crowd roaring). The blow lands on the slam. Sneaker squeaks on every push-off and stop, dribbles, the swish, the
  rim and the slam are heard. The hoop is ONE assembly (the backboard behind the rim, the rim on its lower centre, the
  net hanging from it) and it always hangs on the struck hero's portrait, in both directions. Every point it visits
  stays on screen and every shot and slam lands on the struck hero's centre; its portrait is restored exactly after (on the end, a skip or leaving the fight). The slow motion is a smooth
  ramp of the whole attack's clock, never a freeze. **Soul Stitch** (2026-10-02; `attack_soul_stitch`; **Ancient**, from
  crates; R-PROG-ATTACK-34) is the first hero attack built at the Ancient rarity, for the Ancient of Bonds: crystal
  needles on violet soul thread STITCH the struck hero to the striker (the thread is drawn along each needle's own flight,
  hangs between the two portraits once it pierces, twangs, goes taut on the pull and snaps). I: one needle pierces the
  face, the thread hangs taut, a tug (the striker leans back, the target is yanked toward it, a bead of light runs down
  the thread), then the needle bursts into shards and the thread snaps (the blow). II: three needles cross-stitch an X
  into the face (two sew the diagonals, the third pins the crossing), the striker yanks and the threads snap through the
  face (the blow). III, Pinned: five crystal pins stab into the rim at the points of a star, one after another, each on
  a thread back to the striker; the striker leans back on all five and the portrait stretches toward it; then all five
  pins rip out at once (five snaps, splinters at each pin) and the portrait snaps back through a squash (the blow, with a
  shockwave and a crystal spray). IV, Bound Together (every knockout): six needles lace the two portraits together; the
  striker yanks and the struck portrait is DRAGGED halfway across the board into a gold heart-knot that ties shut round
  it (three gold pulses, a violet crystal clasp, the portrait crushed small); the striker strikes down the laces, every
  lace snaps and the knot bursts (the blow: a gold and violet nova, shockwaves, light streaks, soul ribbons and crystal
  rain, with a short slow-motion dip that eases back, never a freeze) as the portrait is flung home. Every piercing is a
  tick; the blow lands once. Both portraits are restored exactly, transform and z-order, on the end, a skip or leaving
  the fight. **Timebreak** (2026-10-02; `attack_bullet_time`; **Ancient**, from crates; R-PROG-ATTACK-35), for the
  Ancient of Time: CUTTING THROUGH TIME, cast as magic. Crystal lances of golden light, each with a spinning time rune,
  slice in toward the struck hero, each opening a shimmering rift in the air behind it, and as they reach it time drops into dramatic SLOW MOTION: they keep crawling forward,
  afterimages peeling off them, a rune circle ringing the target turns with its runes orbiting, a gold ripple sweeps the screen, and
  the view pushes in. Then time snaps back to full speed (a white flash, a cyan and magenta burst, a shake) and they
  land. Every shape centres on the struck hero; the colours stay full. I: one lance, then the hit. II: three from round
  the target, hitting together. III: a volley in a spiral round it, a finger snap, and a rapid run of hits (the blow on
  the last). IV: dozens of lances in a dome of rings round the target while a big rune circle counts 3, 2, 1 in glowing runes; the dome
  collapses into one massive gold and violet impact on a slow-motion dip. Its Knockout variant adds a ring of cyan and
  magenta lances, a prismatic collapse, a bigger shake, a deeper dip and the KO sting. Every hit before the last is a
  tick; the blow lands once. **Card Shark** and
  **Storm Call** (2026-09-29; R-PROG-ATTACK-26, R-PROG-ATTACK-27) are the first EPIC hero attacks: one idea each, shorter
  than the Legendaries, and THREE looks instead of four (they read the same shared tier and map it: I small, II and III
  medium, IV big; a knockout plays big). `attack_cards` ("Card Shark", a placeholder name; Epic, from crates): the hero
  deals playing cards with a snap. Small, one Ace of spades flicked spinning into the struck hero, sticking edge first
  with a flash; medium, three Aces thrown thunk thunk thunk (the blow on the third); big, a royal flush dealt face down
  into a hand fanned out in front of the hero, flipped one by one (10, J, Q, K, A), turned gold, then all five fired
  together to burst into card confetti on the struck hero (the blow on the burst). `attack_storm` ("Storm Call", a
  placeholder name; Epic, from crates): lightning whose jagged shape is redrawn every few frames. Small, a crackling bolt
  arcs from the hero into the struck hero with a zap; medium, a forked bolt whose two branches strike one after the other
  (the blow on the second) and leave the portrait jittering with static; big, the hero calls a storm cloud over the
  struck hero that rumbles and drops one thick strike (a flash across the screen, a ring of sparks, static crawling over
  the portrait).
  **The Rares** (2026-09-29; R-PROG-ATTACK-28 to 32) are shorter and calmer, with only TWO
  visual tiers: the shared I-II play Small and III-IV play Big (so a knockout plays Big). `attack_coin` ("Pocket Change"):
  a gleaming gold coin flicked spinning pings the struck hero with a bright sparkle and caroms off; Big ricochets it off
  the face twice more and bursts it into a small shower of coins. `attack_boomerang` ("Come Back Around"): a carved
  wooden boomerang with a teal trail whirls out, thwacks the struck hero and curves home to be caught; Big throws two on
  crossing paths, a double thwack, both caught. `attack_bubble` ("Bubble Trouble"): an iridescent bubble drifts over,
  swells round the struck hero's face and pops into droplets and tiny bubbles; Big streams little bubbles first, then pops
  a big one with a splash ring. `attack_backstab` ("Shadow Step"): the striking PORTRAIT fades into smoke, steps out
  behind the struck hero and stabs back toward its own side, then smokes home and settles; Big lunges first, then stabs
  from the side, then from behind (kept on screen, always striking the target; its portrait restored exactly after).
  Each lands the blow once, on its last hit. All twenty anchor on the round portrait art at rest
  (R-PROG-ATTACK-04). Equipped
  account-wide in the Collection's Attack Animations tab ("Use Classic" takes it off). The STRIKER's attack plays:
  yours when you win, the opponent's (from their recorded snapshot) when they win. Recorded per run like skins;
  unknown or retired ids play Classic. Presentation only: the same blow, landed once on the impact beat.
- **Portrait frames (2026-10-01; oracle R-PROG-FRAME-01..04).** A cosmetic ring that replaces the default ring
  around a player's hero portrait. 58 frames, all from crates at the rarity of the folder their master sits in
  (`Skins/Portraits/<Common|Rare|Epic|Legendary|Ancient>/`; the folder IS the rarity, except that a rarity Mike set in batch 4
  wins over the folder, owner 2026-10-02): Common Honey, Ale, Ruby, Steel, Wood, Dark Scale, Burnished, Sterling,
  Gilded, Seaglass; Rare Glass Shard, Paragon, Vine, Magic, Simple Ring, Void, Shard, Prism, Color Doodle, Neon Ring; Epic Aura, Amethyst,
  Frost, Pearlescent, Crimson, Nimbus, Wedding, Multichrome Energy, Blue Energy, Crackling Ruby, Topaz, Jade, Cherry
  Blossom, Cream, Crystal, Disco, Econ, Snare, Cosmic Glass, Blossom, Neonpunk, Solar Flare; Legendary Gilt Scale, Dark Cloud, Venom, Fire, Reaper, Water, Stained
  Glass, Wind, Chromatic Scale; Ancient (2026-10-02) Bonds, Death, Fortune, Genesis, Time, War, Reflective. A rarity
  change only moves crate odds: an owned frame stays owned. A frame's name is just its name, with
  no "Frame" or "Portrait" on it (owner 2026-10-01); the names avoid the ranked medal words so a crate frame never reads
  as a Ranked reward.
  Account-wide (any hero): equipped in the Collection's Portrait Frames tab ("Use default frame" takes it off; an
  owned frame previews around your avatar, an unowned one never does). Your portrait wears it on every surface (in a
  run, the frame recorded on that run, like a skin). Recorded per run, so opponents see it on your seat (combat
  portrait, Now Facing, lobby rail, fight recap, Match details, the Hall, Career rows) while their **Show opponent
  cosmetics** is on. No frame, an unknown or a retired one paints today's default ring. Presentation only.
- **Show opponent cosmetics (Settings, on by default; was "Show opponent skins"; R-PROG-SKINS-02).** Off, every
  OPPONENT's skins render as default art (lobby, combat, the scouted board, replays, another player's Career) and an
  opponent who strikes you plays the Classic attack. Your own always show. Display only; stored locally like the
  other settings.
- **The reward kill switch (R-PROG-SKINS-03).** Any reward can be removed from the game two ways. Permanently:
  `active: false` on the item (or `enabled: false` on its category) in `cosmetics.ts`, then deploy. Right now: the
  owner's one-line emergency switch, `admin_off = true` on the item or category (lines in the header of
  `supabase/migrations/2026-09-28-progression-skins.sql`), which the code sync never touches, so no deploy undoes it.
  Effective state: item `active AND NOT admin_off`, category `enabled AND NOT admin_off`. A retired item leaves the
  crate pool, cannot be equipped, drops out of every loadout, is **hidden** from the Collection (owned or not; the
  counts move with it) and renders as default art everywhere, including old boards and replays that name it. The
  client reads the server's switches on boot. Ownership and loadout rows are never deleted: restoring puts the item
  back exactly as it was. An unknown id never crashes anything.
- **Titles.** The Collection lists the titles you own and lets you equip one (or none); the server checks
  ownership. The equipped title and the owned titles are public (Career); crates are private.
- **Where titles show (2026-09-28, R-PROG-TITLE-02).** The equipped title is recorded with each run (the run's
  cosmetic snapshot, like skins), so history can show the title a player wore in THAT run. Titles show only on
  out-of-game review surfaces, in their rarity colour: the Leaderboard rows (the player's equipped title), the Hall of
  Champions rows (the title recorded with that run), Match details and the Career. They never show during a live run
  or a replay's gameplay view (owner review: "it looks bad in game"). Another player's title follows **Show opponent
  cosmetics**. An unknown or retired title shows nothing; bots and generated seats have none.
- **The Collection layout (2026-09-28).** An album: category tabs (Heroes, Minions and Titles live, the rest locked as coming soon; it opens on Titles),
  Show (All / Owned / Missing) and Rarity filters with counts, and every item of the category, owned or not
  (missing ones dimmed, rarity still shown; the equipped one ribboned). Selecting an item shows it large with how
  it is found, a preview under your name, and Equip / Take off. The crate bay (count, Open, Open all) stays in
  view on every tab. An owned item you have not looked at wears NEW until you select it; that flag lives on the
  device only. Oracle R-PROG-COLLECTION-02.
- **Achievements (batch 1, 2026-09-28).** XP rewards only (owner: "let's just get the normal xp related
  achievements in for now though"). 248 achievements: Career 17, Ranked 28, Heroes 132 (Debut, Contender, Victory,
  Mastery for each of the 33 playable heroes), Economy and Build 15, Mechanics 7, Runes 5, Set 2 44 (by tribe, plus
  cross-tribe and rune feats); 30,825 XP in all. Definitions are code (`packages/progression/src/achievements.ts`),
  pushed into `achievement_catalog` by `submit-progression` on each cold start; the owner's emergency switch is
  `admin_off` on a catalog row. **Evaluation is part of the settlement**: `settle_progression` checks every live
  achievement against the game it settles, in the same transaction as the match XP; a completion is written once per
  account and its XP lands on the same ledger row (so it levels the account and earns crates). Each achievement reads
  one metric: a SERVER metric (the game, placement, accepted comeback, the rank result, the Career-best division,
  streaks, distinct heroes, completions so far) or a RUN metric the run observer counted (facts V2 `metrics`,
  `packages/sim/src/achievementMetrics.ts`; ordinary trust, stored with the ledger row). `max` achievements keep the
  best game; `sum` ones add up across games. Which games count (assumed defaults, the owner can flip them):
  **any** = Ranked, or Practice with Normal Health AND a turn timer; **ranked** = Ranked only (every "Finish 1st" feat,
  hero Victory / Mastery); **tutorial** = the Learn Ascent graduation ("Ready to Ascend"; the step achievements were
  cut); **account** = every settlement (rank reached, distinct heroes, "Complete N achievements"). Rank achievements
  read the Career best, so the first game after launch pays every rank already reached; they use the ascending UI
  numerals ("Silver 1" is the first Silver). Set 2 feats count only in Set 2 runs and read "Legacy" once Set 2 rotates
  out. **Nothing counts before the achievements epoch** (`progression_config.achievements_epoch`, off until the owner
  sets it); a game recorded before it still earns match XP. Titles, hidden achievements (the framework and the blurred
  "Hidden" tile exist; none ship), prestige (replay-verified) feats and the 3 Career showcase slots come later. The
  Career's **Achievements** tab (after Practice) shows every achievement with its reward, completions publicly with
  their date, and progress bars on your own page only. Oracle R-ACH-01..03.
- **Hero titles (2026-09-29, R-ACH-04, R-PROG-TITLE-04).** Every playable hero has a title (Warden "Warded", Gambler
  "Gambling Addict", Albus "Albus Student", ...; the list is `HERO_TITLE_NAMES` in `packages/progression/src/cosmetics.ts`).
  The Heroes category gains a fifth tier, **Titled** (3 Ranked 1sts with the hero, 150 XP), which grants the title;
  **Mastery** (10 Ranked 1sts, 250 XP; 400 since 2026-10-03) now grants its **master** version: the same name as a **golden plate with
  embroidered text**. Victory (1 Ranked 1st) stays XP only; Practice never counts. The master upgrades the title in
  place: it replaces a worn base title the moment it is earned, and the Collection shows one entry per hero title (the
  master once owned). Hero titles are achievement rewards, granted inside `settle_progression` with the completion,
  and never drop from a crate. The Heroes category is now 165 achievements; the registry 281 and 35,775 XP.
- **Achievements 150 (2026-10-03, R-ACH-05).** Owner: "add 150 more achievements", themes Tribes & cards, Heroes
  deeper, Combat feats, Long-term grind, and "some of the larger longer term ones should easily be 500+ xp". The
  registry is now **446 achievements, 105,950 XP** (the 150 add 61,375; XP only; the owner-approved re-tune of the
  batch 1 long-term tiers adds 7,000: Veteran 300, Mainstay 300, Conqueror 500, Back from the Brink 250, Many Faces
  250, Master of Many 600, Completionist 200, Gem Hoarder 200, every hero Mastery 400. XP is recorded on the
  completion when it is paid, so an achievement already completed keeps what it paid). Set 2 gains 38 tribe feats (a
  Ranked 1st with 7 of a tribe, lifetime tribe totals on Top 4 and 1st boards, lifetime Rubies / Ales / spells /
  consumes). Heroes gains a sixth tier per hero, **Devoted** (25 games, 200 XP), and an **All heroes** group (hero
  power uses, more distinct heroes played and won with). Two new categories: **Combat** (36: flawless wins, wins with
  1 minion left, win streaks, knockouts, damage to opponents, enemy kills, finishing well after falling to 5 or less
  Health, an unbeaten Ranked 1st) and **Milestones** (34: games, Ranked games, Top 4s, 1sts, lifetime Gold, Gilds,
  runes, promotions, achievements completed, Ascendant and Brutal wins, streaks). XP climbs with difficulty: 25 to
  100 for one-game feats, up to 1,500 for the biggest milestones. A **knockout** is an opponent who fell in the round
  your own fight hit them. The new counters are run metrics (ordinary trust). No SQL: `submit-progression` syncs the
  catalog on its next cold start.
- **Guests.** An anonymous session is a real account id and the email upgrade keeps it, so guests earn XP from
  their first game. Reaching Level 2 as a guest shows a gentle "Save your progress" prompt (never a gate). With
  no session at all, a game earns nothing.
- **The server is the authority.** The client sends the run id and mode (plus the practice row id or the course
  pin, and the comeback fact), never an XP number. `settle_progression` reads the placement from the accepted
  rank result / the player's own practice row / a unique tutorial claim, and a duplicate returns the original
  result. The client queues the request durably and retries; a failure reads "Progress pending".

Source: `packages/progression/src/rules.ts` (curve, XP, level titles, crates per level),
`packages/progression/src/cosmetics.ts` (catalog, weights, the roll), `packages/sim/src/runDerive.ts`
(`progressionFactsOf`), `supabase/migrations/2026-09-27-account-progression.sql` and
`supabase/migrations/2026-09-28-progression-crates.sql` (`settle_progression`, `open_crate`, `equip_title`),
`supabase/migrations/2026-09-28-progression-skins.sql` (the skins, `equip_cosmetic`, the kill switch), `packages/ui/src/skins/`,
`supabase/functions/submit-progression`, `supabase/functions/progression-inventory`, `packages/ui/src/progression/`.

---

## Health & economy

- **Health** is the hero's life total. All heroes start with **30 Health**, plus per-hero **Armor**
  (8–19 today) that sits on top and takes loss damage first (no regen). Health 0 = run over.
  *(Called "Resolve" until 2026-08-17. The rename is DISPLAY-ONLY — the state field, its types and the
  saved-run format are still `resolve` / `maxResolve` / `startingResolve`, so code and saves read one name
  and players read the other.)*
- **Loss damage** is capped per round, the cap widening as the run escalates: **5** (rounds 1–3),
  **10** (4–7), **15** (8–11), **20** (12–14), then **uncapped from round 15 on** (owner ask 2026-10-02;
  it was 20 through round 15 before). The lobby applies the same cap (`roundLossCap`, which falls back to
  `lossDamageCap` when a mode sets no table of its own) — so a lobby that runs long is uncapped for every
  round from 15 on, not just a "finale". The lobby rail prints the cap above its top edge, next to the round.
- **Rail guides** (owner ask 2026-10-09): a tab on the lobby rail's left edge flips the rail between the opponents and
  short BUILD GUIDES (data in `packages/ui/src/guides/guides.ts`, one card per build line). Only guides for the run's
  pinned set and for tribes in this lobby show; neutral guides always show. A guide opens in place to its **Core** and
  **Enablers** minions (board portraits with the normal hover preview). Each card wears its signature card's art and
  its tribe name in the tribe's colour. **Simple** (the default) keeps the rail's width and shows only the portraits;
  the open card's **Detailed** button widens the rail to the left and adds the write-up (remembered per device). Every new game starts on the opponents. The guides ride the rail: gone in combat (the rail slides away),
  absent in the Tutorial, the Gauntlet (no rail) and God Mode (no rail). Presentation only; no game effect.
- **Gold** ("Embers"): start with **3**, **+1 per wave**, capped at **10**
  (`startEmbers: 3`, `embersPerWave: 1`, `embersCap: 10`).
- **Shop**: minion cost **3**, sell value **1**, refresh (reroll) cost **1**
  (`minionCost`, `sellValue`, `refreshCost`).
- **Board** holds **7** minions; **hand** holds **10** (`boardMax: 7`, `handMax: 10`).
- **Tiers** run **1–6** (`maxTier: 6`). Tavern-up costs: T2 **5**, T3 **7**, T4 **8**, T5 **11**,
  T6 **10**, and the cost drops by **1** each wave you don't upgrade, down to a floor of 0
  (`upgradeCost`, `upgradeDiscountPerWave`, `upgradeCostFloor`).
- **Enemy curve**: enemy board width grows **+1 every 6 waves**; stats scale by
  `1 + wave × 0.16` (`curve.extraCountPerWaves: 6`, `curve.statScalePerWave: 0.16`).

Source: `packages/sim/src/config.ts`, `packages/sim/src/heroes.ts` (`resolve`/`armor`),
`packages/sim/src/reducer.ts` (`lossDamageCap`).

---

## The loop — shop → board → combat

Each round: shop the tavern (buy/sell/reroll/tier-up), arrange your board and hand, then **Face the
Omen** to fight the served opponent. Combat is a **pure, deterministic simulation** (`simulate`) that
returns an event log; the UI only replays it and never computes outcomes. Recruit-phase effects
(Shouts/Battlecries, buff-on-summon, Consume) bake into stats *before* combat; the simulator runs
combat-time effects (Start of Combat, Echoes/Deathrattles, on-kill, etc.) and emits log events.

**A Shout triggered again** (Resonance, Myra, Echoing Roar or an End-of-Turn replay in the Shop; Dawnclaw / Ryme,
a Rally re-fire or an Ancient of Time in combat) resolves the moment it fires, in either phase (R-REALTIME-03). Its
board stats in combat are combat gains that end with the fight (R-REALTIME-04); a Consume it causes waits for the
Shop (R-REALTIME-05). A targeted Shout has no aim when re-fired, so it picks a **random legal target** (never
itself), seeded, like Baby Gastrid and Appetite Agent: Gravetwin a friendly Echo minion, Auric Runemaster a
non-Gilded friendly (a combat Gild lasts that fight), Graverobber any other friendly. No legal target: nothing
happens (R-TARGET-06, owner 2026-09-26).

**The shop draws from a shared, finite pool, weighted by copies left** (owner ruling 2026-09-10). Every
minion of the run's tribes starts with a fixed number of copies per tier; buying takes one, selling or
discarding returns one. Each roll picks a card with probability proportional to the copies it has left, so
a card down to its last copy is rarer in proportion, and the odds shift gradually as the pool drains rather
than falling off a cliff at zero.

### Equipment (owner rulings 2026-08-28 + 2026-09-11)

**Equipment** is a Shop-phase ability granted by an *Equip* minion (Alchemist Frank → Bloodpot, Titan
Sculptor → Titan Hammer, …) and owned by the **player**, shown in a second slot beside the hero power.
Playing the minion grants it at once; selling the minion does **not** revoke it for the rest of the turn; at
every Start of Turn the collection is rebuilt from the surviving board, so keeping it means keeping an Equip
minion alive. Duplicates collapse into one entry; a single Gilded source upgrades the entry for everyone.

**Rune-owned Equipment (owner batch 2026-10-07).** A rune can grant Equipment too (Rune of the Dragon's Egg →
Dragon's Egg, Rune of the Wise Armory → Spell Generator). It arrives the moment the rune is bought, with its own
charge ready, and is held **for the rest of the run**: every Start-of-Turn rebuild re-grants it after the board's
Equipment, with no body behind it. Everything else is unchanged (one own charge a turn, the shared pool, cost
reductions, Amplified). A rune is never gilded, so it is always the plain version; a second copy of the rune
collapses into the one entry. Engine: `RunState.runeEquipment` + `sim/equipment.ts` (`grantRuneEquipment`,
`syncRuneEquipment`), `GrantedEquipment.sourceKind: 'rune'` (R-RUNE-EQUIP-01).

**Charges (2026-09-11):**
- **Every Equipment has its OWN charge, once per turn.** Holding Bloodpot and Titan Hammer, you may activate
  each once per turn. Own charges reset at Start of Turn; nothing carries across turns.
- **Bonus charges are ONE shared pool.** Jumpstart Jules's Start of Turn grant (gilded = 2) and any future
  source add to it; two grants = a pool of 2. Per-turn only — it expires at End of Turn / the next rebuild.
- **The number shown on an Equipment = its own remaining charge + the shared pool.** With one bonus every
  Equipment reads **2**, in **green** (modified above baseline); plain when the pool is 0 (1, or 0 once its
  own charge is spent).
- **The pool is spent FIRST.** With a pool of 1, activating Equipment A spends the pool: every Equipment drops
  from green 2 to plain 1, and A can still be activated once more on its own charge. Only when the pool is 0
  does an activation spend that Equipment's own charge (it then reads 0 and its button disables; the others
  still read 1).
- Swapping the selected Equipment is **free** (no Gold, no charge). Activation is **atomic** (validate, pay,
  spend, resolve in one action — a cancel costs nothing by construction). Gold cost, temporary cost
  reductions, extra-trigger repeats and Choose One on an Equipment are unaffected by charges.
- **Clock-window Equipment** (Thymepiece, owner design 2026-09-12: *"All cards cost 1 less Gold for the next
  8 seconds"*; gilded −2) runs on the **turn clock**, not wall time: the activation records the clock's reading,
  the window is 8 clock-seconds in every mode (Practice's multiplier only stretches the real seconds), it
  pauses with the clock (Discover / Choose One / aim / hero select), it discounts **cards only** (Shop minions,
  the spell slot, spell offers in the row — never the Shop upgrade or a refresh), prices floor at 0 (the
  Starform's live price included), every discounted coin shows green, the slot counts it down, and it ends on its own expiry
  action, at combat entry, or at the turn flip. A Continue whose saved clock is already past the window
  resumes without it; the engine never reads a clock (`RunState.cardDiscountWindow`).
- **Amplified** (owner design 2026-09-16, Set 3 batch 2): a per-Equipment STATE. The rune prints *"Equipment you
  do not use becomes Amplified."* (owner wording 2026-09-18); the glossary pill / Compendium define the state:
  *"An Amplified Equipment will trigger its effect twice for no additional gold."* An Amplified Equipment's next
  activation runs **twice** — the whole activation, extra triggers
  included, so `(1 + extra) × 2` — and the stack is **consumed** by it. One stack per Equipment, never more.
  Written by **Rune of Amplification** (Basic 4: at End of Turn every held Equipment you did not activate this
  turn — through the pool or its own charge — gains a stack) and **Rune of the Grand Workshop** (Epic 6: every
  held Equipment now, and again every Start of Turn). The stack **survives the Start-of-Turn rebuild** for every
  Equipment still held (it is the one piece of Equipment state meant to carry) and is pruned for one whose
  sources all left. Presentation: the Equipment's **charge number turns BLUE** while Amplified (over the pool's
  green), the tooltip says so, and the tally carries `data-fx="equipment-amplified"` as a tooling mark. The
  owner's authored cue (2026-09-22) is the **`amplified-slot` loop on the slot button**: it plays only while
  the SELECTED Equipment will Amplify AND has a charge to spend, in the shop phase, with nothing covering the
  slot (a board-covering overlay, the Compendium, the Inspect view, the bug reporter and the ladder pages all
  pause it) — zero charges means no glow ("if an equipment has 0 charges it should not show the
  animation"), so using the Equipment ends it. Gold is not a term: a charged Amplified Equipment the player
  cannot afford right now still glows while its button is disabled (open owner question, 2026-09-22).
  Engine: `PlayerEquipmentState.amplified` + `sim/equipment.ts` (`amplifyEquipment` / `amplifyUnactivated` /
  `amplifyAllHeld` / `consumeAmplified`), pinned in `set3RunesTrancheC.test.ts`.

### The Starform — the Celestials' shop token (owner design 2026-09-12; rules v2 2026-09-13)

The **Starform** is a **1/1 Celestial token that lives IN THE SHOP** as an ordinary shop offer (normal unit
frame, no rules text — **its printed stats are the counter**). Celestial cards create it, grow it and cash it
in; the shop never rolls it. Engine: `packages/sim/src/starform.ts`; every rule below is pinned in
`starform.test.ts`.

1. **Created into the right-most Shop slot.** With no slot open it **Consumes the right-most Shop minion**
   (that offer leaves; the Starform gains its current buy stats) and takes its slot — a real Shop consume,
   with every latch and watcher a Demon's consume touches (Bottomless Banquet, Open Market, `onConsume`,
   the consume meter). A spell / Ruby in the right-most slot is skipped leftward; a full row with no minion
   at all still gets the token (appended — the one case the row overflows by one, until the next roll).
2. **Only one at a time.** A second create is a no-op (cards that say "give it +2/+2 instead" handle that
   themselves).
3. **It persists through refreshes at the RIGHT-MOST slot** (owner 2026-09-14) — the player may drag it
   anywhere in the row during a turn, but every rebuild (a roll, a Muster, a spell shop, a restock) puts it
   back at the far right, past any spell offers (kept Layaway offers still pull left) — and across turns and
   combat, and under Freeze, until it is consumed, collapsed or destroyed. It takes a slot: a tier's row is one
   draw shorter while it is out. **Creating into a full row is silent on screen**: the eaten right-most
   minion simply leaves and the token takes its slot in place — no pull, no row shift — while the owner's
   `starform-create` cue plays on the token (it plays on every creation, open slot or not). Mechanically the
   meal is still a real Shop consume.
4. **Refresh-time slot buffs land on it ONCE.** Market Tormentor's right-most enchant, Rune of the Embers'
   doubling, the Display Case's left-most enchant and Veinstorm's per-refresh Ruby stamp each land on a
   Starform the first refresh it sits in the slot and **never again** on later refreshes (they are gated,
   not redirected to the next minion). Right-most buffs from a *play* (a Shout, a hero power) apply as
   normal.
5. **It has a PRICE, and buying it feeds it to your LEFT-MOST Celestial** (owner rules A + B, 2026-09-13).
   It spawns at **6 Gold**; **every refresh — paid or free — knocks 1 off** (floor 0); the reduction
   **survives the turn boundary** (a 3-Gold Starform is 3 Gold next turn); a **new** token (Zenith's
   re-creation included) starts at 6 again. Every regular discount applies exactly as to a minion (Cadence,
   Trade-In, the Friends-and-Family Gift, the Thymepiece window, the free first buy), and the coin always
   shows the charged price. **Buying it = your left-most board Celestial CONSUMES it** for its full stats
   (base 1/1 included) — it leaves through the consume path, so Zenith re-creates and Twin Star hears the
   gain. **With no Celestial on board the Gold is still spent and the token is simply lost** (consumed into
   nothing; Zenith still re-creates). The buy counts as a minion bought (on-buy watchers, buy tallies,
   quest / rune / hero-power counters) but puts nothing in hand and returns nothing to the pool. The old
   0-Gold "dismiss" buy is gone. It is never gilded, never tripled, never held / laid away, never displaced,
   never stolen to hand, never replaced by a Discover. For **everything else it is a regular Shop minion**:
   random-shop picks, Demon consumes (a Demon *can* eat it), "this shop" buffs, hero powers and spells aimed
   at a shop minion.
6. **Every shop buff bakes onto the token.** Direct buffs, permanent shop buffs ("minions in the Shop get
   +X/+X"), *this-turn* shop buffs and consumes all fold into its printed stats as they happen — so a
   refresh that clears a this-turn buff for every other offer leaves the Starform's total intact. It is the
   one offer that keeps them.
7. **Consume = 100% of its stats to one Celestial; Collapse = 50% to 3 UNIQUE random friendly Celestials
   plus the extras** (owner rule D, 2026-09-13; 3 hits since 2026-09-18, was 2), halves rounded **up**, the base 1/1 **included** in what
   transfers. The extras (Fuse Aldrin's passive: +2 per Herald, +4 gilded; plus the run-wide
   `collapseExtraTargets` counter, 0 today and reserved for future cards) are drawn **with replacement** —
   an extra may land on a Celestial that already took a hit, so with two Celestials one can take 3 and the
   other 1. One Celestial: 1 original + every extra on it. None: the token still collapses and the stats go
   nowhere. With no Starform both do nothing. **Under Rune of Soul Script** (owner 2026-09-16) your **Undead are
   Collapse receivers beside your Celestials** — originals, extras and the Supernova's "all your Celestials" alike —
   and any Undead whose text Consumes may eat the token (the shared Shop-consume chokepoint takes any eater).
8. Two board-wide watcher moments: **"whenever your Starform gains stats"** (the gain's amount rides along)
   and **"when your Starform leaves the Shop"** (consumed — the buy, a Demon, or a card — or collapsed,
   with its full stats). The Star Destroyer's exit (below) fires **neither**.
9. **STAR DESTROYER** (owner rule C, 2026-09-13): while a Starform exists the player holds the
   `star_destroyer` Equipment — **a standard Equipment in every respect** (the rail, the selector, its own
   once-per-turn charge, the shared bonus pool; gilding does not apply) whose **source is the Starform offer**
   rather than a board minion. It is granted when a token is created, leaves the rail the moment the token is
   gone (any exit), and comes back with the next token. **Using it (0 Gold) is the silent exit**: the token
   leaves the Shop and nothing else happens — no consume, no collapse, no watcher, no gain, not a buy, no
   pull animation, no Zenith re-creation.

**The Starform roster's card-level readings** (owner spec 2026-09-12; `packages/content/src/cards/set3/celestials.ts`,
pinned in `packages/sim/src/set3CelestialRoster.test.ts`):

- **"This shop" +X/+X** (Rocket Power, The Great Attractor's Shout, the Stellar Lens) buffs the **offers standing
  in the row right now** — the owner's "this shop" vocabulary (2026-07-25), not the per-turn channel. The Starform
  keeps it through the next refresh; every other offer loses it. (Wishing Star is a plain adjacent +3/+4 Shout
  since 2026-09-14.)
- **The Great Attractor** (2026-09-14; +3/+2 since the owner balance 2026-10-07) gives **this shop +3/+2** and THEN its Starform eats the **highest current
  buy Health** offer — so the meal carries the buff. **Black Hole** (was Accretion; no Star Crash any more) eats
  **3 random** Shop minions, one real consume each, fewer if the row is short. Ties for "highest" go to the
  **right-most**. With no Starform neither consumes.
- **Rocket Power** (was Shooting Star; no Flurry) counts Shop spells cast this turn (`spellsThisTurn` — a multiplied
  cast counts each time) and is the REPEAT form (R-REPEAT-01): the base **+3/+3** lands once, then once more per
  spell, each tick its own instance on every offer's ledger; the card prints how many times it lands right now,
  *"(×3)"*. **Zenith** counts a spell of **any** kind, Rubies included (the Gravestar Seer ruling).
- **Stardust Peddler** (2026-09-18, 2/5): **when you spend 5 Gold** (a per-instance Gold meter while it stands — the
  Coinfire / Billings shape; the remainder carries, a big spend can cross it twice; the step counter shows
  N/5) it **creates** a Starform if you have none, else the token gains **+3/+3** (gilded +6/+6).
- **The Stellar Lens** (2026-09-14) **creates** a Starform if you have none, then gives **this shop +5/+5** (gilded
  +10/+10; +7/+7 and +14/+14 until the owner balance 2026-10-07) — the fresh token is one of the offers that takes it.
- **Star Seed** gives an existing token **+4/+4** (gilded +8/+8).
- **Solburn** (rules v2) **Collapses** the token: 3 unique random friendly Celestials each gain the rounded-up
  half (the Devotee itself is eligible; gilded → each hit gains the full stats); a token with no Celestial at all
  still collapses and the stats go nowhere; no token → nothing happens. Its old Consume is now the token's **buy**.
  **Fuse Aldrin** is a **passive**: while it stands, every Collapse hits **2 additional** random friendly Celestials
  (4 gilded; two Heralds → 4), drawn with replacement. Its text prints the static "2" (owner: "table for now").
- **Lodestar** gives a friendly Celestial its **MAX stats**: current Attack + undamaged max Health (a 10/10 damaged
  to 10/5 then buffed +5/+5 hands over 15/15). Both phases.
- **Twinning** (was Twin Star; Tier 5) mirrors every gain path (a buff, a shop buff, the token's consumes, a Star Crash aimed at the token,
  a slot enchant landing on a roll) — and, when it is the left-most Celestial, receives the token's buy itself.
  **Zenith** rebuilds the token after a **consume or collapse** (the buy, a Demon eating it, a Devotee's Collapse,
  Herald-assisted or not) — never after the Star Destroyer's silent exit — with half its stats rounded up, at the
  fresh 6-Gold price; a full row eats its right-most minion as any create does.
- **Constellation Prime** — "Star Crashes you cast from hand cast an additional time" (from hand only, R-MULT-06) means the **PRIMARY** +5/+7 lands one extra
  time on the chosen Celestial per Prime (two per gilded Prime); the secondary random-friendly half fires **once per
  cast**. A Comet / Nimbus-multiplied cast re-lands the primary on every repeat. Applies to a Star Crash aimed at the
  Starform too.
- **Star Crash may be aimed at the Starform** (a friendly Celestial): the token gains +5/+7 (Twin Star hears it) and
  the secondary half still lands on a random friendly minion on the **board**. Only the tribe's own Celestial-aimed
  spell reaches the token — a plain `friendly` spell keeps its board-only aim (rule 5 stays whole).
- **Roundabout** (Tier 5, 7/5; owner 2026-10-07): **End of Turn: give minions in the shop +6/+7 permanently** (gilded
  +12/+14), the permanent Staff-of-Guel channel (`buffShopPermanent`), so a held Starform banks it too. It no longer
  creates a token. (2026-09-18 to 2026-10-07 it was "End of Turn: create a Starform and give it +10/+10"; before
  that it created at Start of Turn and had the token eat the whole row at End of Turn.)
- **Crash Course** (2026-09-18): the **first Star Crash you cast on it each turn casts an additional time** on it —
  Mirrorwing's shape (a FULL re-cast, scaled by the cast multiplier) gated to the named spell; gilded 2 additional.
  (Until 2026-09-18 it spread the cast to 2 other Celestials instead.)
- **Sugarnova** (2026-09-18, 4/2): **Shout: give your next Shop spell +4/+4** (gilded +8/+8). The bonus is a run
  field: it **survives End Turn → combat → the next shop** if unspent, every Shop spell offer / hand spell prints
  it live in place, and exactly the next Shop-spell cast consumes it (Gifts and Rubies neither read nor spend it).
- **Maestro Lux** (owner 2026-09-24): **Pummel (12): Get a random Celestial. (Once per combat.)** (gilded: 2). The
  pick is the shared combat random-minion grant (the run's pool, at or below the shop tier; All-types cards count),
  flown to hand in the replay and landed at settle. The Starform is a token and is never picked.

The **combat event vocabulary** is a union of **22 distinct event types** in
`packages/core/src/types.ts` (`CombatEvent`): `sc, attack, dmg, shield, shieldUp, poison, reborn,
death, reveal, keyword, keywordLost, venomLost, summon, ascend, buff, improve, rally, maxGold,
toHand, hpGrant, spellProgress, questTrigger`.

---

## Quests — ⚠️ ARCHIVED (owner ruling 2026-08-28)

> **The quest system is OFF. Nothing below happens in the game today.**
>
> Owner ruling, 2026-08-28: *"we have more or less retired quests for now. we can archive that system fully,
> it can be more or less turned off and away from our code for now as we are centering on runes for the
> foreseeable future."*
>
> `QUESTS_ARCHIVED` (`packages/sim/src/config.ts`) short-circuits `questOfferPlan` to `null` before any rule
> below is reached. That function is the ONLY producer of a quest offer — both mint sites (`createRun` for the
> turn-1 hero quest, the turn advance in `reducer.ts` for everything else) go through it — so in every mode,
> on every seed, for every hero: no offer is generated, the quest overlay never opens, `buyQuest` has nothing
> to take, `activeQuests` stays empty and no objective ever advances.
>
> **This is an ARCHIVE, not a deletion.** `QUEST_DEFS` / `QUEST_INDEX`, the objective machinery, the reward
> engine (`applyQuestReward`) and the quest UI are all intact and every quest id still resolves — the
> `ARCHIVED_CARDS` / `ARCHIVED_RUNES` contract. A run or replay recorded before the archive still loads, still
> ticks its quest and still pays it out (`questArchiveSaves.test.ts`). The reward engine in particular MUST
> stay live: every **rune** in the game pays out through it.
>
> **Note the older `CONFIG.questsEnabled` flag is NOT this switch and never could have been** — it gates only
> the universal turn-5/11 offers, and the quest-native heroes were deliberately checked above it. Setting it
> back to `true` no longer reopens anything (`systemToggles.test.ts`).
>
> Fi and Coran, whose whole powers were hero quests, are `wip` — withheld from Play, from Practice and from
> every hero-power Discover pool — pending redesign. Their defs stay in `HEROES` so saves and replays resolve.

The rules the system will have again when it is un-archived, unchanged below:

- Quest turns are **waves 5 and 11** (`questOfferPlan`: `s.wave === 5` / `=== 11`), gated by the
  master switch `CONFIG.questsEnabled`.
- Each quest turn offers **4 quests**: **1 neutral** slot + **3 distinct-tribe** slots, drawn from
  that turn's **tier bucket** (`generateQuestOffer`). Wave 5 draws the "early" bucket (Lesser + most
  Greater quests); wave 11 draws the "late" bucket (Capstones + two promoted Greater neutrals).
- The two main quest turns **guarantee your dominant board tribe** appears in a tribe slot (with a
  chance at a second, once a tribe has ≥2 quests in the bucket).
- Hero exception (stands **on top of** the normal turns and survives `questsEnabled = false`): **Fi** and
  **Coran** open the run on a **turn-1 two-option pick** from their own private **hero quest** lists (reworked
  2026-08-21 — the old turn-4 Errand / turn-10 Pathfinder bonus offers are retired). Every hero quest shares
  one objective: **travel N steps**, where playing a minion, casting a spell or upgrading the Shop is one
  step. Fi's five pay early (12–26 steps); Coran's five pay late and large (28–46). The two three-variant
  families (Opening Act / Resonant Path — a Shout, Echo and Rally spelling each) never offer two variants at
  once, and hero quests never appear in the universal turn-5/11 offers.

Source: `packages/sim/src/quests.ts`; the archive switch, `packages/sim/src/config.ts`.

---

## Henchmen — ⚠️ ARCHIVED (owner ruling 2026-08-28)

A **henchman** was a hero-bound minion, never sold in the Shop, recruitable once per run at a price that fell
every round (win −3, loss −2, floored at 0). Owner triage, 2026-08-28: *"henchmen are not in the game and are
extremely WIP / being removed for now."*

`HENCHMEN_ARCHIVED` gates `henchmanOffer` (`packages/sim/src/state.ts`), the single producer of an offer. With
it null, `buyHenchman` refuses and the StatusBar's henchman chip — which renders only on a non-null offer —
never appears. As with quests this is an archive: the `HENCHMEN` registry, the `HeroDef.henchman` link and the
cost-decay state all stay live and resolvable, so un-archiving restores a correctly-priced offer rather than a
broken one.

Only one henchman was ever authored (a placeholder on Warden), and because Warden is the first and fully
playable hero, that placeholder was reachable in real games until this ruling.

---

## Heroes: archived (owner ruling 2026-09-24, R-HERO-01)

> *"Archive these heroes. (remove them from all modes but keep them in the game. they should only show in scene
> builder)"*

An **archived** hero (`HeroDef.wip`, tested by `isArchivedHero`) is offered nowhere a new run gets a hero: not
the Play picker, not Practice, not a generated rival seat or a Practice bot portrait, not a synthesized pool
board, not the Compendium Heroes tab, and not the Mimic / Void / Power Shifter power Discovers. Its def stays in
`HEROES`, so every stored reference (saved runs, replays, a real player's recorded snapshot seat, baked pool
boards, Career history, leaderboards) still resolves its name, portrait and power. The **Scene Builder** lists
every hero, archived ones marked "(archived)".

Archived today: Fi, Coran (2026-08-28), Void (2026-09-16), and the 2026-09-24 batch: Aevor, Cindara, Devourer,
Emissary, Fibbsy, Foreman Flint, Gorun, Guardian, Harlan, Jensen, Membrance, Odelle, Pete, Rayse, Runesmith,
Sable, Tiff, Underdweller, Yirin. (Djinni, Chronos, Chaos and the tutorial-only Aster carry the same flag.)
With Tiff and Foreman Flint archived, no live hero carries a tribe gate (`HeroDef.tribes`); the gate stays.

## Runes (the Runeforge)

Runes are run-long permanent buffs bought at a **Runeforge** (never in the regular shop / Discover /
quest pool). Every hero visits the forge; some visit it more. Current rules (rewritten 2026-09-23 from the
code — `advanceCombat`, `openNextStartOfTurnModal`, `runeforgePool`, `drawRuneOffer` in
`packages/sim/src/reducer.ts`):

**A visit.** The forge opens at the START of a turn, behind any quest offer and hero-power pick and ahead of
any queued Discover (`openNextStartOfTurnModal`: power pick → Epic forge(s) → Basic forge → Discovers). It
offers **4 runes** (`RUNEFORGE_OFFER`; the tutorial's scripted forges offer 3), you buy **ONE** for its Gold
cost, and the forge closes. The player cannot skip or leave it (R-RUNE-34, owner 2026-09-29); the engine's
`skipRuneforge` action exists only for bots, fixtures and replays. There are two forges with two pools: the **Basic forge** stocks `RUNES`,
the **Epic forge** stocks `EPIC_RUNES` — pool membership is array membership, `epic: true` is only the
card's kicker.

**The schedule** (`CONFIG.runeforgeEnabled`, the set-2 default):
- **Every hero**: a Basic forge on **turn 6** and an Epic forge on **turn 9**.
- **Runesmith** (Forgemaster): an extra Basic forge on **turn 5**, one turn ahead of the universal one.
  (Runesmith and Guardian are ARCHIVED heroes since 2026-09-24, see *Heroes: archived*; their forges still run
  for a stored run or a Scene Builder sandbox on them.)
- **Guardian** (Runeguard): an extra Epic forge on **turn 8**, booked at run creation (`epicForgeWave`).
- **Rune of the Epic Forge** (Basic 4): books an extra Epic forge for **turn 8** (next turn, if 8 has
  passed). A Guardian holding it gets **TWO Epic forges on turn 8**, opened one after the other — the second
  opens the moment the first is bought or skipped, before the turn's Basic forge or Discovers (owner
  2026-09-22: "can we just book 2 runeforges here"). Bookings are COUNTED (`epicForgeCount`,
  `pendingEpicRuneforge` is a count), so two forges booked for one turn are both opened, never dropped and
  never slid to a later turn.
- **Rune of the Ornate Clock** (Basic 2): pays **2 Gold on resolve** and MOVES the turn-9 Epic forge to
  **next turn** (`epicForgeClaimed` stands the turn-9 visit down). Bought late it still opens next turn.
- A quest reward can also schedule a forge (The Runeforge: a Basic forge next turn with +4 Gold; The Epic
  Runeforge: an Epic forge next turn) — those quests are archived, but the reward path still resolves.
- A forge armed MID-turn (a rune bought, a quest completed) is `deferred` to the next turn's start; it never
  pops on the turn it was earned.

**What a forge can offer** (`runeforgePool`, in order): the forge's pool (Basic / Epic) → a rune that
`requiresDoublePower` only for a hero whose power can double (Rune of Empowerment) → the run's PINNED
set (`sets` absent = every set; a scoped rune only where its mechanics exist) → the **tribe gate**: a rune
with a `tribes` list is offered only when **any one** of those tribes is among the run's rolled tribes →
owned runes whose duplicate would only pay the sweetener (or, for the ruled-unique Ornate Clock, nothing)
are never re-offered; stacking runes stay offerable (see *Duplicates* below). Every eligible rune is
weighted **equally**: no rarity tiers, no pity timer.

**"Fits the board"** (owner 2026-09-22: "for basic, it should be at least 2 of a tribe type, and for epic
it should be at least 3 of a tribe type. make sure all types count as 1 of everything"). A rune's synergy
tags come from its printed text (`packages/content/src/runeSynergy.ts`: the tribes it names plus the named
mechanics — Rally, Echo, Shout, Avenge, Consume, Ruby, Ale, spells, Gold, summon) PLUS its tribe gate
(`tribes`, via `runeFitTags` in the reducer), so a gated rune that never prints the tribe word (Rune of Baal,
Rune of Chimerus, Rune of the Whelps) is still that tribe's rune (2026-10-08). The board's tags come from
its cards (`boardSynergyTags`):
- A **tribe** tag needs at least **2** minions of that tribe on the board at a **Basic** forge and at
  least **3** at an **Epic** forge (`BASIC_FORGE_TRIBE_FIT` / `EPIC_FORGE_TRIBE_FIT`). Only the **7 board
  slots** count — the hand is uncommitted and the forge opens at the start of a turn, when the board is what
  just fought. An **All-types** minion (`universalTribe`, or the per-instance `allTribes` flag) counts as
  **one of every tribe**; a **dual-tribe** minion counts once for each of its tribes (via the shared
  `isTribe` helper).
- A **mechanic** tag is a PRESENCE tag: one card carrying the mechanic is enough (the owner's threshold
  rule speaks of "a tribe type"; a mechanic threshold would be a separate ruling).
- Set 3's Spirit / Celestial / Starform / Reveler words are NOT yet in the keyword list — deferred until
  Set 3 is live (roadmap).

**The guarantee and the pivot discount** (`drawRuneOffer`, owner ask 2026-07-31): if an offer's 4 draws
contain nothing that follows the board but a following rune exists in the pool, one seeded slot is swapped
for one that does. **Tribe first** (owner 2026-10-08: "he should have at least 1 rune that is tribe aligned
here"): when the board holds a tribe at the threshold, the guaranteed slot must be a rune of one of those
tribes; a rune that only shares a mechanic tag (a Demon rune that says "summon") no longer satisfies it. A
board with no tribe at the threshold keeps the mechanic guarantee. Every offered rune that does NOT follow the board rolls a **40%** chance of a **pivot
discount**: **1–2 Gold** at a Basic forge, **2–4 Gold** at an Epic forge — a nudge toward changing
direction, never a tax on staying the course. A rune that fits the board never carries one.

**The hero discount** (owner 2026-08-17; the every-forge reach confirmed 2026-09-22): **Runesmith** and
**Guardian** have EVERY forge they visit discounted on every slot (same spans as the pivot), whichever route
opened it — their own power's forge, the universal turn-6 / turn-9 visits, a rune-booked forge. A slot that
already earned a pivot discount keeps it (the pivot can be larger).

**Re-roll**: ONE, **free**, **per game** (`runeforgeRerollUsed`, shared between the Basic and Epic forges).
It redraws the offer preferring runes not among the 4 just shown, falling back to them only when the pool is
too small; the pivot / hero discounts are re-rolled with it. (The tutorial's scripted forge re-roll serves the
same authored runes — known, ruled fine.)

**Determinism**: every offer is drawn from `mixSeed(seed, wave, TAG.QUEST, route)` — the run seed and the
turn, salted per route (Runesmith's forge, the re-roll, the Epic forge, a scheduled Basic forge), and a
SECOND Epic forge on the same turn adds its index — so a replay reproduces every offer, every discount and
both turn-8 forges.

Each rune's effect reuses the quest `QuestReward` application engine — it just takes effect with no
objective. Rune of Duplication copies the FIRST Epic rune forged after it and is spent on that buy.

**Set scoping (`sets`) is MECHANICAL COMPATIBILITY, not set of origin.** A rune with no `sets` is offered in
every set; a scoped rune is offered only where its mechanics exist. Since the **Set 3 rune roster handoff
(2026-09-14)** set 3 draws **115 Basic / 97 Epic** from carryovers: the 85 + 64 unscoped baseline plus 63
carryovers (30 Basic + 33 Epic) from sets 1/2 — the Ruby, Ale, Dwarf, Kobold, Undead and Shop-consume packages —
each of which KEPT its original scope (set 1 = 105/90 and set 2 = 135/126 are unchanged). (98 Epic at the
handoff; Rune of Frontline Glory was dropped from set 3 by the owner on 2026-09-16 and is a set-1 rune again.) Attachment, Mech, Fodder and
absent-tribe packages stay off set 3. (Rune of the Night Market and Rune of Baal were once deliberate off-tribe
bridges; both left set 3 in the 2026-09-24 cut below.) The rolled-tribe gate still applies on top:
a "your Dwarves" rune reaches a set-3 run only when Dwarf rolled.

**The Set 3 rune cut (owner 2026-09-24).** 54 runes were cut from set 3 ONLY — each keeps every other set it was in
(an unscoped rune became `sets: ['set1', 'set2']`), stays in `RUNES` / `EPIC_RUNES` and resolves through
`RUNE_INDEX`, so saves and replays that own one keep working. Two lists: 20 runes the owner named (Kobold, Dwarf,
Undead, Spirit and Aftershocks), and all 34 runes whose `tribes` gate names only tribes set 3 does not field
(Dragon, Beast, Demon/Imp, Mech). Rune of the Grave Orbit and Rune of the Full Hand were set-3-only, so they are
now `sets: []` — and the owner then ARCHIVED both the same day ("remove them"; `ARCHIVED_RUNES`, still resolvable
by id). Set 3's static pool is now **120 Basic / 107 Epic** (both counts
include the set-3 originals). Full list: `docs/devlog/2026-09-24-set3-rune-cuts.md`; pinned by
`packages/sim/src/set3RuneCuts.test.ts`.

**The Set 3 rune list (owner 2026-09-25) supersedes the counts above.** The owner's list IS Set 3's Runeforge:
**163 runes, 84 Basic / 79 Epic**. Every rune
it names is in set 3; every other rune left set 3 only, keeping its other sets (an unscoped rune became
`sets: ['set1', 'set2']`), never archived. Three set-3-only runes the list does not name (Charted Skies, the Festival
Circuit, the Open Constellation) are now `sets: []`, offered in no set, pending an owner ruling. Full tables:
`docs/devlog/2026-09-25-set3-rune-list.md`; the exact ids are pinned by `packages/sim/src/set3RuneList.test.ts`.

**The list's grouping IS each rune's tribe and rarity (owner 2026-09-25, R-RUNE-22).** A rune listed under a tribe
carries that tribe gate (offered only when the tribe is in the run, in every set), a rune listed under Neutral carries
none, and a rune listed Basic / Epic lives in that pool. This overrides the "text names a tribe" derivation where they
differ: **Seller's Market** is Dwarf, **Spearline** Undead, and **Dream Mirror**, **Open Hand**, **Waking Reserve** and
**Waking Dreams** Spirit, though none names its tribe; **Lazarus** is Neutral, though it grants an Undead body; **Soul
Script** keeps both Undead and Celestial. **Engraving Gems** moved Epic → Basic (cost 2, unchanged), taking set 3 to
84 Basic / 79 Epic. Every Set 3 rune's tribe and rarity is pinned against the list in `set3RuneList.test.ts`; the
exceptions to the text rule are listed in `tribeGate.test.ts`.

**Set 3 rune batch 3 (owner 2026-09-25)** adds 11 Set-3-only runes to that list (**174 runes, 91 Basic / 83 Epic**):
Kobold Basics Gemmed Decisions, Echoing Kobolds, the Red Storm, Rubywire, Choices and Combatative Rubies; the Undead
Basic Body Counting; Kobold Epics Storming Veins, Sold Choices, Aggressive Golems and Ruptured Rubies. Rules worth
knowing: Echoing Kobolds and Aggressive Golems are aura-style GRAFTS (every Kobold / Gemheart Golem now and later, combat
summons included; a Gilded Kobold still gets one Ruby); Rubywire's "Shop Spell" is R-SHOPSPELL-01's (Ales count, Rubies /
Clues / tokens do not) in every phase; Choices is a per-turn Choose-Both charge (the Prismatic Pick mechanism); Sold
Choices repeats the branch recorded at play (`chosenOption`, or both via `chosenBoth`) and does nothing for a body that
never chose; Combatative Rubies (every 3rd friendly attack) and Body Counting (every 6th friendly death since 2026-09-27, Shop deaths
included, sales not) are RUNNING meters carried across fights; Storming Veins adds 2 casts from hand only (R-MULT-06);
Ruptured Rubies hops every combat Ruby twice (stats only), the Shop unaffected. Oracle R-RUNE-23..33; details in
`docs/devlog/2026-09-25-set3-runes-batch3.md`.

**Set 3 rune design pass, tranche 0 (owner 2026-09-27)** supersedes the count above: **169 runes, 87 Basic / 82 Epic**.
- *Cut from Set 3 only (10):* Rubywire, Living Magic, Recurrence, the Astral Draft, Refrain, the Hunting Bell, Sylus,
  the Pair, Quick Release, Grave Refreshment. Each keeps its other sets and is never archived; the three that were
  Set-3-only (Rubywire, the Astral Draft, Quick Release) are now `sets: []`. The Golden Splinter and the Deep Feast stay.
- *Restored to Set 3 (5):* the Open Constellation, the Festival Circuit (the first **hybrid**: gated Spirit + Celestial),
  the Five Banners, the Strange Caravan, the Wishbone.
- *Re-tagged (5):* Living Treasure is Kobold; Rising Echoes, the Crowded Crypt and Overflow are Undead; Dreamed Graves
  is Spirit. A tribe gate applies in every set, so Overflow and Rising Echoes are no longer offered in Set 2 (it fields
  no Undead).
- *Repriced:* Spearline 7 -> 6, Bartering 6 -> 4, the Spirit Crown 6 -> 4, Eventide 4 -> 3, the First Round 4 -> 5, the
  Long Shift 2 -> 3; Body Counting now pays every **6th** friendly death (was 8th). Costs are global, so Bartering, the
  First Round and the Long Shift change in Set 2 too.
- *Renamed / reworded:* Rune of the Grand Procession is now **Rune of the Second Showing** (id unchanged); the War
  Drum reads "The first Shout you trigger each turn triggers 2 more times." (behaviour unchanged).

Oracle R-SET3RUNE-01..05; details in `docs/devlog/2026-09-27-set3-runes-t0.md`; ids pinned in `set3RuneList.test.ts`.

**Design pass tranche 1: Undead (owner 2026-09-27)** adds 8 Set-3-only Undead runes (**177 runes, 92 Basic / 85
Epic**). Basic: the Lantern Keeper (a Lantern of Souls now and every 2 turns), the Wake (a friendly Undead Echo
trigger gives the Undead Aura +1 Attack), the Second Wind (a risen minion gains +2/+2 permanently), the Soul Toll
(Avenge (4): the Undead Aura +1 Attack; built instead of the Unquiet), the Gravedigger (a friendly Shop destroy gives
your Undead +2/+2). Epic: the Soul Furnace, the Restless (a risen minion triggers its Echo), the Open Grave (the
first friendly Shop destroy each turn gains Rise first). Rules worth knowing:
- *"Give your Undead Aura +N Attack"* raises the Lantern channel: permanent from any phase (R-AURA-02), felt live by
  the living Undead mid-fight.
- *The Soul Furnace's* Health is **ceil(Aura Attack / 2)** per copy, where the Aura Attack is the whole Undead Aura (the
  Lantern channel plus the buy channel). It is kept inside the run's Undead Aura Health, so every fold shows it, and
  it rises the moment the Aura's Attack rises (mid-fight too; that rise is re-derived by the run, never carried back).
- *Rise runes* fire after the minion Rise watchers, Second Wind first; the Restless' Echo is a real Echo trigger
  (multipliers apply, the Wake counts it). The Open Grave skips a body that already has Rise.
Oracle R-SET3RUNE-06..13; details in `docs/devlog/2026-09-27-set3-runes-t1.md`.

**Design pass tranche 2: Celestial (owner 2026-09-27)** adds 8 Set-3-only Celestial runes (**185 runes, 97 Basic / 88
Epic**); there is no Event Horizon, and its Epic slot went to the owner's pick the same day, the **Meteor Storm** (every
Star Crash you cast is cast again on a different friendly Celestial; the extra cast never repeats itself; named Storm
because Meteor Shower is an existing rune). Basic: the Heralding Star (a friendly
Celestial Shout gives your Starform +3/+3), Stellar Echoes (your Celestials have "Echo: give your Starform +2/+2"),
Scattered Light (buying your Starform Collapses it instead), Gravity (each minion your Starform consumes gives your
Celestials +2/+2), the Afterglow (your Starform leaving the Shop gets a Star Crash). Epic: the Starsong (a friendly
Celestial Shout gives your Celestials +2/+2), the Guiding Star (a friendly Celestial Echo casts a Star Crash on a random
friendly Celestial). Rules worth knowing:
- *Starform growth earned in combat* is banked per source and lands on the Starform when the Shop opens (the Starform
  is a Shop token; `playerStarformGain`), after any Shop-only Shout that creates one. No Starform = nothing.
- *Star Crash now resolves in combat* (it used to fizzle): the aimed Celestial and a random living friendly minion
  each take +5/+7 plus spell power plus Rune of Falling Embers' bonus.
- *Gravity* counts only the Starform's own consumes, on the board.
Oracle R-SET3RUNE-14..22; details in `docs/devlog/2026-09-27-set3-runes-t2.md`.

**Design pass tranche 3: Spirit + Dwarf (owner 2026-09-27)** adds 7 Set-3-only runes (**192 runes, 102 Basic / 90
Epic**). Spirit Basic: Call and Answer (a friendly Spirit Shout or Rally gives the left-most minion in your hand
+2/+2), the Encore (the first Reveler you sell each turn also pays the left-most minion in your hand), the Overture (a
Crescendo now and every 2 turns), the **Kindred Hand** (the owner's pick replacing the Beckoning: a Spirit played gives
the left-most minion in your hand +1/+1 per Spirit you control; the badge shows the next payout). Dwarf: the Whetstone
(Basic: a Dwarf played gives your other Dwarves +1 Attack), the Anvil (Epic: a friendly Dwarf's Attack gain also gives
that much Health; a Health gain never re-fires it), the Satchel (Epic: a card added to your hand gives your Dwarves
+1/+1; in combat the living Dwarves for that fight, and the card's arrival at settle pays the board as Gangplank's does).
"The left-most minion in your hand" skips spells. Oracle R-SET3RUNE-23..29; details in
`docs/devlog/2026-09-27-set3-runes-t3.md`.

**Design pass tranche 4: hybrids (owner 2026-09-27)** adds 8 Set-3-only runes, each gated to its two tribes (**200
runes, 107 Basic / 93 Epic**; with the restored Festival Circuit and Soul Script, 10 hybrids, one per tribe pair).
Basic: Minted Gems (Kobold + Dwarf: every 8 Gold spent gets a random Ruby), the Gem Crypt (Kobold + Undead: a friendly
minion that Rises comes back with the Ruby stats it had), the Pallbearer (Undead + Spirit: a friendly Undead death gives
the left-most minion in your hand +2/+2), the Star Tap (Dwarf + Celestial: a Dwarven Ale cast gives your Starform
+3/+3), **Closing Time** (Dwarf + Spirit, the owner's "Last Call", renamed because Set 2's Rune of Last Call owns that
name: selling a Reveler gets a Dwarven Ale). Epic: the **Grim Toast** (Dwarf + Undead: your non-Undead Dwarves get the
whole live Undead Aura, Attack and Health, through the same Aura fold; an Undead Dwarf is never paid twice), the Gem Star
(Kobold + Celestial: the first 4 Rubies cast each turn, Shop through that turn's combat, also give your Starform their
stats), the **Keepsake Gem** (Kobold + Spirit, the owner's stronger version: every Ruby cast also lands its stats on the
left-most minion in your hand, as a plain grant that no Ruby trigger hears, so it cannot loop). Oracle
R-SET3RUNE-30..37; details in `docs/devlog/2026-09-27-set3-runes-t4.md`.

**Design pass tranche 5: Menagerie + neutral (owner 2026-09-27)** adds 3 Set-3-only runes (**203 runes, 109 Basic / 94
Epic**): the Set 3 **Menagerie** (Basic 5: a random Kobold, Dwarf, Undead, Spirit and Celestial), the **Heavy Hand**
(Neutral Basic 2: damage your minions deal counts double toward Pummel; the per-combat caps still bind) and **Unity**
(Epic 6: while you control all 5 minion types, your minions count as every type). Unity reads only NATURAL types
(printed tribes, All-types cards), so it cannot hold itself up: lose the last minion of a type and the grant ends at
once, in the Shop and mid-fight. It covers board minions, not the hand. A Unity body counts as Undead, so it takes the
whole Undead Aura as a fold (never baked). Combat tribe checks now also honour a per-instance "every type" mark
(`universalTribe` on the body), which is also what an Anomaly Reactor "All" body always meant. Oracle R-SET3RUNE-38..40;
details in `docs/devlog/2026-09-27-set3-runes-t5.md`.

**Set 3-original runes (batch 2, 2026-09-16).** Set 3 now also has runes of its own — `sets: ['set3']` alone,
no origin scope — starting with tranche A's 24 Spirit / Celestial / Undead runes (11 Basic + 13 Epic, taking the
set-3 static pool to **126 Basic / 111 Epic**), plus the rune-exclusive **Handy Flame** token. The two combat-side
runes of that sheet shipped in tranche D: **Rune of the Open Hand** (Epic 5 — when you summon a minion from your
hand, another random friendly minion gains its current stats; every landed hand-summon, both phases) and **Rune of
the Waking Reserve** (Epic 6 — Start of Combat: a copy of your highest-stat hand minion when the board has room;
the hand card is NOT marked, so a Spirit may still summon it later that fight; it IS a hand-summon for Dreamed
Graves / the Open Hand). Both shipped untribed (the text names no tribe) and are Spirit-gated since the owner's
Set 3 rune list (2026-09-25). The tribe
faucets (Rune of Basic/Epic Spirits, Celestials, Undead) are capped at the shop tier by the engine, like the
Dwarf/Kobold ones. See `docs/devlog/2026-09-16-set3-runes-tranche-a.md` and `…-tranche-d.md` for the rulings and
interpretations. **Rune of the Traveling Festival**'s "+2/+2 more" is applied ONCE per Reveler trigger (owner
2026-09-16: *"the 2/2 is 1 time"*) — a second copy pays its Reveler drip again but never raises the extra.

**Set 3-original runes (batch 2, 2026-09-16).** On top of the carryovers, set 3 now draws its OWN runes, scoped
`sets: ['set3']` alone: tranche B ships 8 Basic + 11 Epic Starform / Equipment / Undead runes (see
`docs/devlog/2026-09-16-set3-runes-tranche-b.md` for where each fires). Two engine facts they rest on: a
**grafted Echo** (`grantedEffects` — Contract Rewrite, Rune of Rebirth, Rune of the Last Tool) fires on a SHOP
death exactly as it does in combat; and a Starform rune is gated on Celestials (the token IS Celestial content),
the way an Imp rune is gated on Demons.

**Set forks.** A card a rune grants BY ID resolves to the pinned set's fork when one exists
(`SET_FORKS` in `packages/content/src/sets.ts`). The map is EMPTY today: its one entry, the set-3 Yazzus fork,
went when the owner ruled there is **one Yazzus** (2026-09-16) — `yazzus` (Tier 7, 4/8, "Targeted spells you
cast from hand cast an additional time": Shop spells, Rubies, Tower Shields and Clues alike) is the same card in every set that
carries him, and the retired `n3_yazzus` id still resolves to it for saved runs and replays (`LEGACY_CARD_IDS`).
The Open Market's "first Shop consume each turn" hears the Starform's consumes (they ride the one Shop-consume
chokepoint) — Rune of the Open Market was archived 2026-09-23 (Balance 9/23), so only a run that already holds
it still does.

**Duplicates always do something** (owner rulings 2026-08-27, decisions `q-runedup-*`). Rune ownership is
COUNTED (`RunState.runeStacks`; combat boolean flags use `flagCopies`), and a second copy stacks per family:
recurring effects fire once per copy; meter runes keep ONE meter but pay double at each trip; repeat runes
add +1 repetition per copy; one-shots simply grant again (banked to next turn when immediate value is
impossible); engine runes double their output where a sensible doubling exists. A duplicate that genuinely
cannot stack pays the universal sweetener — Gold equal to half the rune's printed cost rounded up, plus a
free refresh — and the Runeforge stops OFFERING owned runes whose duplicate would only pay that sweetener
(Rune of Duplication still reaches them deliberately). Rune of the Ornate Clock is ruled unique: a duplicate
does nothing. Classification lives in `packages/sim/src/runeDup.ts`.

**Rune of Twilight repeats RUNE Start-of-Combat effects too** (owner ruling 2026-09-21; it used to repeat only
your minions' Start-of-Combat effects, so Underdog + Twilight paid ×2 while two Underdog copies paid ×4). Every
rune whose printed text begins "Start of Combat:" fires one extra time per Twilight copy held, in the same
order as the first pass, after the whole first pass (minions and runes) for that side. Each extra pass reads the
board as the first pass left it: Underdog re-picks the two lowest-Attack minions (so it may choose a different
pair), Forthcoming / First Claws strike again with the living front / end Beasts, Rebirth and Rising Graves
skip bodies that already carry the keyword, and the Crucible destroys the NEXT three (all of them return
together). On a board of six or fewer the Crucible's second pass empties the board, so everything returns at
once at Start of Combat and the return is spent (no later comeback); seven bodies leave one survivor and the
six return when it dies. Rune copies still multiply WITHIN a pass. **Rune of Sylus is IN**: the ability it grants
is printed on the Sylus as "Start of Combat: double this minion's Health", so Twilight doubles it again (×4
Health) — a review call of 2026-09-21 pending the owner's confirmation. Runes whose text merely mentions Start
of Combat (Warden, Dawnclaw) and quest / hero Start-of-Combat grants fire once.

**Shop vs combat under Twilight (a stated rule, not a comment).** Rune of Combat Prowess replays your Start-of-
Combat effects at End of Turn in the shop. Its MINION replays fold Twilight (one extra fire per Twilight copy,
the shared `socTwilightExtraFires`); its RUNE replays do NOT: each rune Start-of-Combat block replays once per
Prowess copy × Chronos repeat, Twilight or not. So Prowess + Twilight + Underdog is ×2 per turn in the shop and
×4 in combat. The shop replays are permanent and compound every turn, so folding Twilight there is an explicit
owner balance decision, not a silent mirror (open; see `docs/devlog/2026-09-21-twilight-rune-soc.md`).

Source: `packages/sim/src/heroes.ts` (`runeforge`, `epicRuneforge`),
`packages/content/src/runes.ts`, `packages/sim/src/runeDup.ts`.

---

## Matchmaking

**In the lobby (the live route), your opponent each round is the SEAT you are paired with** — not a board
drawn from the pool. Pairing is deterministic and avoids unnecessary immediate rematches; the encounter is
resolved once and both seats take their damage from that single result.

**Odd table → a ghost fight.** With an odd number alive, one seat (only from the bottom three by Resolve+Armor)
holds the bye and fights a **ghost**: the most recently eliminated seat's board from the round it died. The ghost
takes nothing. **A ghost is never a rematch** (owner 2026-09-19, the Hearthstone rule): the bye holder never faces
the ghost of the seat it fought last round or the seat it eliminated — the next most recent ghost stands in, and
when the only ghost on offer would be a rematch, the bye goes to another eligible seat.

**A paired seat with no board** (R-LOBBY-05, 2026-09-28). Seat selection only seats a generated seat whose
recording fields a board, so this should not happen; if it does (an older save), the pairing is a sit-out for
both seats, like any boardless pairing. The player then fights the most recent ghost instead, logged as a ghost
fight (`bye: s0`, `standInFor` = the paired seat) so the log and "who knocked you out" name the board fought.
Before anyone has fallen there is no ghost and the round is a sit-out for the player too.

The pool-based `pickOpponent` path below still exists and still serves the **non-lobby** modes and tooling. It
is NOT what a lobby run faces, which is why injecting served boards into a lobby replay changes nothing:

1. **Wave-first** — a board at the same development stage; widen to the closest wave if none match.
2. **Recent-opponent exclusion**, unless that would leave nothing to serve.
3. **Source priority** — shared remote pool → local player/friend boards → committed synthetic floor.
4. **Uniformly random within the chosen tier**; empty pool falls back to the procedural threat board.

Source: `packages/sim/src/lobby/runLobby.ts` (pairing), `packages/sim/src/opponents.ts` (pool path).

---

## Displayed terminology (rename table)

Player-facing text renames the underlying keyword vocabulary (display-only; internal ids and card
data are unchanged) via `packages/ui/src/terms.ts`:

| Internal / classic | Displayed |
| --- | --- |
| Battlecry | **Shout** |
| Deathrattle | **Echo** |
| Divine Shield | **Ward** |
| Windfury | **Flurry** |
| Venomous | **Execute** (owner 2026-09-24: the same mechanic, renamed; Raven and Tort grant it) |
| Reborn | **Rise** |
| Magnetize | **Attach** |
| Magnetic | **Attachment** |
| Golden | **Gilded** |

**Kept as-is** (no rename): Taunt, Avenge, Choose One, Start of Combat, End of Turn, Rally, Cleave,
Consume, Discover, Overflow (a keyword since 2026-09-19 — see the Rise ordering section), Pummel (a keyword
since 2026-09-21 — see "Pummel (X)" below), Sell (a keyword since 2026-09-23 — see "Sell" below).

Source: `packages/ui/src/terms.ts`.

### "A card is added to your hand" — every source, every phase (owner rule 2026-08-29)

*"cards added to hand is an effect in recruit + shop and should trigger effects that track them in all
places."*

A card **arriving in your hand** is an event in its own right, and every effect that watches for it
(Gangplank, Kegheart Dwarf, the Rune of Heavy Payroll) fires **wherever the card arrives from**:

- **Any source counts.** Buying a minion or a Shop spell, taking a Discover pick, a triple's golden, an Ale,
  a minted Ruby, a conjure, a rune or hero grant, restoring a displaced minion — all of them. There is no
  privileged "grant path": a card is a card.
- **Any phase counts.** Including **mid-combat**. A combat effect that grants a card to hand (a Deathrattle
  copy, a minted Ruby) fires these reactors **during the fight**, so the payout can affect the fight that
  earned it — not only afterwards when the card settles into the next shop.

The one asymmetry, and it follows from the engine rather than from this rule: a **served enemy board has no
hand**, so nothing ever reaches one and an enemy's watcher never fires. The event is scoped to the side whose
hand actually received the card.

**How it is enforced.** Each phase supplies its own dispatcher — the shop diffs the hand by uid in `reduce`
(so a new `hand.push` site cannot forget to fire it), combat emits from `ctx.grantToHand` / `ctx.grantRubies` /
`ctx.grantRandomRubies` (the only ways a card reaches a hand mid-fight). Both run the *same* effect bodies, in
`ARENA_EFFECTS`, so the two phases cannot drift apart.

---

### A triple uses the BOARD copies first (owner rule 2026-09-25, R-GILD-03)

*"the minions on board should be used first and foremeost for triples"*

- When a Gild combines copies (3, or 2 under Twin Gilding / Midas), the **board** copies go in first, left-most
  first; only the copies still missing come from the **hand**, newest first. Any surplus copy stays where it was.
- Two copies on the board + an effect that gives two copies to hand: both board copies and one new copy combine,
  the golden goes to hand as usual, and the other new copy stays in hand as a plain copy.
- The merge itself is unchanged (the two best copies stacked, buffs and accruals carried), and so is where the
  golden lands (hand; the board when the hand is full). Every route (buy, Discover, play/summon, hero powers,
  copy grants, the shop-open check for End-of-Turn and combat carry-back copies) goes through the one
  consumption point, `pullCopies` in `packages/sim/src/reducer.ts`.

---

### "A card buffed in hand keeps the buff" — permanent, every phase (owner rule 2026-09-09, R-HAND-02)

*"cards buffed in hand are always permanent. so if something buffs a card in hand during combat, that card in
hand retains the buff. the buff also needs to show in real time like all of our other effects do."*

A stat buff that lands on a card **in your hand** is **permanent**, whichever phase granted it:

- **In the shop** it is an ordinary recruit buff (a Ruby-strength rise growing the Rubies you hold, a
  rune's "your Dwarves +2/+2" reaching the Dwarves in hand).
- **In combat** a hand card an effect buffs keeps the buff into the next shop and for the rest of the run —
  there is no "for this combat" scope on a hand card, because a hand card is never in the fight.
- **It shows as it happens.** The replay grows the hand card on the beat the buff fires, the same way a
  board buff moves stats on the body as it lands; settle then makes it the card's own.

**How it is enforced.** Combat reaches the hand through one verb (`ctx.buffHand`), which logs a `handBuff`
event and carries `playerHandBuffs` back for settle to apply with `addBuff`. Both phases share the arena body
(`buffHandTribe`), so a hand-buffing effect cannot be permanent in one phase and temporary in the other.
Pinned by `handBuffInCombat.test.ts` and the replay helper's test.

---

### "When a friendly minion Rises" — both phases, permanent in the shop (owner rule 2026-09-09, R-RISE-03)

*"if minions rise in shop, that would trigger rising tide and that buff would be permanent since it's in
recruit. this will be a common trigger/effect in set 3."*

A **Rise** — a body with the keyword returning after it dies — is an event its watchers (Revenant, Rising Tide)
hear **wherever it happens**:

- **In combat**, when the body returns to the line. A watcher's board grant is a normal combat gain; a hand
  grant is permanent (R-HAND-02).
- **In the shop**, when a destroyed body returns (Cage Breaker, the Deathfibrillator, any destroy — R-RISE-02).
  Everything a watcher grants there is **permanent**: the stats and any keyword (Revenant's Ward). Every shop destroy
  path counts, the immediate one (Ancient of Death's Aegis, Pulse x Death) and the two-step one alike, and each Rise
  is heard **exactly once** (R-RISE-SHOP-01, fixed 2026-09-26).
- **Friendly only.** An enemy body Rising is not your Rise; your watchers stay quiet.

**How it is enforced.** One trigger, `onRise`, from the single Rise site of each phase (`bus.emit` in
`simulate.ts`, `fireOnRise` called from inside the shop's `riseReturn`, which every shop Rise shares), with the
risen body in the payload. Pinned in `set3Undead.test.ts` for both phases and for the enemy case, and in
`shopRiseWatchers.test.ts` for every shop destroy path.

### "Attacks immediately" cuts the line (owner rule 2026-09-26, R-ORD-05)

*"a "attacks immediately" mechanic cuts the line. this doesn't interrupt a flurry attack, but it does interrupt
other attack orderings if something is summoned to attack immediately."* Every source (Rune of Living Echoes'
Sunmane, Kurse's Gemheart Golem, Violet Whelp / Tamer's Whelps, Spear Warden, Charging Soldier, Trooper):

- The minion **lands, then strikes at once**, after the event that summoned it has settled (a death cascade, an
  Avenge, a "while you have space" fill) and **before the next normal attacker is chosen**.
- It **also interrupts a Flurry** (owner reversal, same day: *"a minion summoned that attacks immediately SHOULD
  interrupt a flurry"*): a summon queued by the first swing lands and strikes between the two swings, never inside
  the second swing's lunge. The Flurry minion then takes its second swing if it is still alive. (Summons queued by a swing's own wind-up, e.g. Echohorn's Rally firing an Echo, still strike before that swing
  lands: the 2026-09-01 wind-up ruling.)
- **Several at once** each land and strike in summon order.
- The strike **does not use or move the normal attack pointer**; the body then joins the rotation (appended at
  the right) and takes its regular turn as well.

### Echo first, THEN the Rise attempts — every Rise/Echo interaction, both phases (owner ruling 2026-09-18)

*"When I used Deathfibrillator on a minion with 7 bodies on board, it gives the minion Rise and kills it, but
then that minion rises BEFORE its Echo triggers. This is wrong. The Echo should trigger from the death of the
minion, THEN the minion attempts to rise. This is true for ALL Rise/Echo interactions."*

A minion with **Rise** (or **Rebirth**) that dies resolves in this order, in **combat and in the shop** alike:

1. the minion **dies** — it leaves its slot (a real death: Avenge, tallies, on-death watchers, kill credit);
2. its **Echo fires** (and every on-death watcher, in the existing order) — an Echo that summons lands its
   bodies **in the freed slot**, where the minion died;
3. **THEN** the minion **attempts** to return — to the right of what its Echo summoned. If the board is full
   by then (the Echo's summons took the room), the return **finds no room**: it counts as an **overflow**
   (Squatimus / Flowing Monk / Rune of the Crowded Crypt pay off) and the body stays dead. Its Rise is spent.

   **Overflow** is a printed keyword (owner 2026-09-19): every card or rune that reacts to a summon finding no
   room reads "**Overflow:** …", and the glossary defines it as *"When a minion is summoned, but does not have
   space on your board."* It fires in the shop and in combat alike (the `summonOverflow` trigger).

So on a full board a **Warden Rodrick** dies, his Spear Warden takes his slot, and Rodrick does not come back.
A Rise minion whose Echo summons nothing (Sergeant) still rises on a full board — the slot its death freed is
still free. This **reverses the 2026-09-09 ruling** under which a rising body held its slot through its Echo
(so the Echo's summon overflowed and the body returned) — that read as "the minion rose before its Echo".

**How it is enforced.** Combat: `killOrReborn` in `simulate.ts` holds no slot reservation (the `occupied` room
check is the living count); the Echo's summons place first, then the return is gated on `living < 7`. Shop:
`settlePendingDeath` / `destroyMinionInShop` in `recruit.ts` mark EVERY dying body `vacatingUid` (the summon
path discounts it), then `riseReturn` / `rebirthReturn` gate on the board cap. Pinned in
`core/src/combat/simulate.test.ts`, `core/src/combat/rebirth.test.ts`, `sim/src/set3Undead.test.ts` and
`sim/src/shopDestroy.test.ts`. Rule **R-RISE-05** in the registry records the supersession.

### Rebirth — a NEW keyword, distinct from Rise (owner ruling 2026-09-16)

**Rebirth** (`RB`): when the minion dies it returns **once with its FULL current body** — stats (Health refilled
to its max), granted buffs, keywords, effects and every per-instance counter. *"A Warded 50/50 dies and comes
back a Warded 50/50."* **Rise**, by contrast, returns the **printed** body at 1 Health. Not the Rise → Rebirth
rename (that stays reserved); a second keyword beside it. Granted by **Rune of Rebirth** (Basic 3, changed: Start
of Combat — a random friendly minion gains Rebirth) and **Rune of Dreamed Graves** (Epic 4: the first minion
summoned from your hand each combat gains Rebirth).

**Rebirth acts like Rise** (owner 2026-09-16: *"it acts like rise, so copy that"*). Its combat rules are
Rise's rules, step for step, with ONE intended difference — nothing is rebuilt from the printed card (`killOrReborn`
in `simulate.ts`, mirrored by `rebirthReturn` in the shop; pinned in `core/src/combat/rebirth.test.ts`, including
a Rise-vs-Rebirth parity fixture whose flow of deaths, returns and Avenge payouts must be identical):

- **The Echo fires on the Rebirth death** exactly as on a Rise death: die → Echo → the body returns to the
  RIGHT of what its Echo summoned. The death is a **real death** (Avenge, the death tallies, on-death watchers,
  kill credit) and is flagged like a Rise death for the replay (`death { rise: true }`).
- **A Ward the body carried at any point this combat is restored** on the return (in practice a Warded body
  has lost its Ward by the time it dies — the owner's example wants it back). Taunt, Flurry and every other
  keyword come back with the body. Rebirth itself is **spent**; nothing re-arms it unless something re-grants
  it.
- **Its Avenge progress restarts** on the return, as a Rise's does (*"1/3 should reset to 0/3"*) and as any
  body placed mid-combat: the deaths tally is side-level state, not part of the body it keeps.
- **A body that dies to retaliation on its own swing and returns is next to attack again** — the Rise rewind
  in the attack rotation applies to a Rebirth return too.
- **NOT a Rise:** the Rise watchers (Revenant, Rising Tide — `onRise`) stay quiet, and Rune of the Deathtouched
  Apple (a Rise re-arm) does not touch it — those two are Rise's own.
- **It IS a summon in full** (the owner's Rise ruling 2026-08-12): the summon-entry suite runs on the return.
- **A full board at the return = an overflow**; the body stays dead (the Rise rule). The body holds NO slot
  while it is dead: its Echo fires first and takes the freed room, and only then is the return attempted (see
  "Echo first, then the Rise" above).
- **A body holding BOTH keywords: Rebirth resolves first.** Rise has no precedence rule of its own (it is one
  keyword), so the stronger return goes first and the buffs are not thrown away; its Rise stays armed, so its
  NEXT death Rises the printed body.
- **In the shop** (a destroy, Cage Breaker, the Deathfibrillator) the same body returns — buffs, keywords
  (Rebirth spent), counters — with a fresh uid for the departure diff; Rise's `onRise` payout does not fire.
- **Snapshot fidelity:** a Rebirth granted mid-combat is a plain `keyword` event, folded into the SoC board like
  any keyword grant.
- **Presentation:** the return reuses the Rise beat and FX (`reborn { rebirth: true }`; the Card's Rise dome and
  the `rise` glyph) as PLACEHOLDERS until the owner authors a Rebirth cue.

---

### Pummel (X) — the damage-dealt threshold trigger (owner keyword 2026-09-21)

**Pummel (X): Triggers each time this minion has dealt another X damage. The damage count carries over
between combats.** It is the printed form of the damage-dealt meter (`DAMAGE_METER_MARKERS` in
`packages/core/src/types.ts`; the `noteDamageDealt` site in `simulate.ts`): every landed hit the body deals —
attack, retaliation, incidental — counts toward X; a hit that never lands (Immune, a popped Ward, 0 damage)
does not. Overkill counts in full. THE ONE RULE (owner 2026-09-21, later the same day as the keyword: *"it is
resetting to 0/X after combat. It needs to carry over from turn to turn and combat to shop etc."*):

- The damage tally is **lifetime per instance**. It is seeded into every combat from the run card, carried
  back whole at settle, snapshotted with a served board (so a served copy pays out from its real total), kept
  by a Rise / Rebirth body (the same combat instance), and merged as the higher of the copies on a triple. It
  never resets.
- A payout happens **each time the tally crosses a multiple of X** (35 → 40 pays; 47 → 52 does not).
- But **at most the card's per-combat cap** (`maxPerCombat`, default 1 = "(Once per combat.)"; Han Gover prints
  "(Max 5 per combat.)", owner 2026-09-24). The payout count lives on the combat body, fresh every fight (a Rise
  does not re-arm it). Within the cap every multiple crossed pays, including several crossed by one hit; past
  the cap the crossings are **spent, not banked** (under a cap of 1, a 120 hit from 0 pays once and the next
  payout waits for 160). Gilded doubles the payout, never the fire count.
- The readout on every surface (shop, board, hand, combat) is progress toward the **next** payout: `total mod
  X`. Han Gover at 47 damage reads **7/40** in the shop and in combat; a crossing lands on 0/40; nothing clamps
  at X/X, so after this fight's payout the combat badge keeps showing live progress toward the multiple that
  pays next combat. The combat badge holds through the end-of-combat sequence.

Bodies today:

- **Han Gover** (T4 Dwarf/Undead): *"Pummel (40): Get a Dwarven Ale. (Max 5 per combat.)"* (gilded: 2 Dwarven
  Ales per payout). Up to 5 payouts a fight, never a 6th (owner 2026-09-24; was once per combat). The 2026-09-19
  "(Max 2 per hit)" cap stays retired; the 2026-09-21 per-combat reset that briefly shipped with the keyword was
  reversed the same day.
- **Maestro Lux** (T4 Celestial): *"Pummel (12): Get a random Celestial. (Once per combat.)"* (gilded: 2).
- **Impossible Todd** (T6 Demon, owner 2026-10-10): *"Pummel (20): Summon an Imp. (Once per combat.)"* (gilded: 2 Imps).
  The first Pummel that SUMMONS: the Imp lands beside Todd on the hit that crossed, through the ordinary combat summon
  (board cap, Imp Aura, summon grants). R-PUMMEL-SUMMON-01.
- **Goldvein** (T1 Kobold): *"Pummel (6): Gain 3 Gold next turn. (Once per combat)"* (gilded: 6 Gold). Its
  tally carries over now too (it reset each combat from 2026-09-19 until the carry-over ruling).

The fire is a combat event (`pummelTrigger`, one per payout, emitted after the `dmg` that crossed
the multiple and before the payout's own events), which the replay presents with the owner-authored
`pummel-trigger` FX on the body's medallion (see `docs/combat-events.md`).

### Sell — the self-sold trigger (owner keyword 2026-09-23)

**Sell: Triggers when this minion is sold.** It is the printed form of the `onSell` trigger — an effect that
fires when THIS minion is sold from your board (a shop action; it has no combat meaning). Every minion with
an `onSell` effect reads "**Sell:** …" (owner ask 2026-09-23: *"any card that operates on a 'When you sell
this' should now say 'Sell: xyz' with sell being a highlighted keyword. no mechanical change"*): Hoard Whelp,
Salvatore McKlusky, Riverback, Beggy, Cheap Date, Traveling Salesman, and the three Revelers. The hover
pill and the Compendium row carry the definition above; the word is coloured in card text.

The keyword is pinned to its FORM. A card that reacts to selling **another** minion (Arcane Behemoth "When
you sell a Demon", Shift Broker, Voicekeeper — the `minionSold` watcher), a spell that sells ("Sell a
friendly minion"), a sell-value line ("Sells for 2 Gold") and a hero power that counts sales (Robin) keep
their sentences: none of them is "this minion is sold", so none raises the pill. Text only — no effect, param
or trigger changed.

### A named-spell caster prints the spell, not its value (owner rule 2026-09-09, R-TEXT-01)

A minion whose effect **casts a named spell** — Watcher, Wick Mortis, Anubis — reads "cast
**Lantern of Souls**." and stops. The spell is the minion's associated card, previewed on hover with its live,
spell-power-aware value, the way a Ruby is previewed from the Kobolds that cast it. The caster never restates
the number.

### "Give X. Repeat for every C" is the base plus one tick per C (owner rule 2026-09-22, R-REPEAT-01)

Two wordings, two resolutions:

- **LUMP** — *"give a minion +x/+y, +a/+b for every C you played"* and *"+x/+y for each C"*: **one** buff
  instance whose magnitude is computed from the count. One tick, one beat, one ribbon per target. Baby Gastrid
  (*"+2 Health per Gold spent"*) is this. (Striker was too, until 2026-09-24.)
- **REPEAT** — *"give a minion +x/+y. Repeat for every C played this turn"*: the **base** buff lands once, then
  once more per C, `1 + count` ticks in all, and **every tick is its own instance** — its own stat delta, its own
  buff signal, its own beat — so the buffs visibly land one after another and the End of Turn runs longer when
  a card repeats many times. A random target is re-rolled per tick (seeded, replay-faithful); a fixed target is
  hit every tick; "when a Dwarf gains Attack" watchers react once per tick; a turn with zero C still pays the base
  once. Gilding doubles the per-tick grant, never the tick count; Chronos repeats the whole tick sequence and
  counts one End-of-Turn trigger per repeat, not one per tick. The live text keeps the per-tick grant as printed
  and adds how many times it lands right now: *"Repeat for every card you played this turn (×4)"*.

**Mother Moss** (*"give a random Spirit +3/+4. Repeat for every Spirit played this turn"*) and **Kringle**
(*"give your left and right-most Dwarves +1/+2. Repeat for every card you played this turn"*) are the REPEAT
form. Kringle moved to it on 2026-09-22 (it was the LUMP form, `n ×` the rate); its total is now `(n + 1) ×`.
**Striker** (*"give adjacent minions +1 Attack. Repeat for every card played this turn"*) moved to it on 2026-09-24
(R-REPEAT-03): its neighbours take +1 Attack `1 + cards played` times, one tick each, even on a turn with nothing played.
Squirl Scout's Battlecry and Dragonflame's shop cast are REPEAT in the sim and draw one ribbon per repeat.
Rocket Power (*"give this shop +3/+3. Repeat for every Shop spell you cast this turn"*) resolves as `1 + spells`
ticks on the shop row (one ledger instance per tick; the total is unchanged) and its text prints the tick count;
the row itself still re-renders once, because the Shop has no per-offer buff cue.
Open (owner forks, unchanged): a per-offer, per-tick cue on the shop row; Mother Moss keeps itself in its random
pool; Squirl Scout (*"Repeat for every Beast you own"*) fires once per Beast owned with itself as one of them, so
the Scout is the base tick rather than `1 +` Beasts; combat-phase repeats still collapse into one buff wave.

### "When you cast a Shop spell" (Goldilox) hears every Shop spell, from anywhere (owner rule 2026-09-24, R-SHOPSPELL-01)

A **Shop spell** is a spell from the set's Shop-spell pool, Dwarven Ales included. Rubies, Clues and other Gifts,
and reward or token spells are not Shop spells. **Goldilox** (*"When you cast a Shop spell, gain +3/+2. Gains 2x
while in hand."*) grows on every Shop spell cast by any source (your hand, a rune, an Equipment, a minion, an End of
Turn cast) in every phase: +3/+2 on the board, +6/+4 in the hand, doubled when gilded. A spell cast in combat grows it
too, and those stats are permanent: a board Goldilox keeps them after the fight, and a hand Goldilox takes them as a
hand buff (R-HAND-02), shown live during the replay. Only your own casts count.

### Cast multipliers work only on spells cast from hand (owner rule 2026-09-24, R-MULT-06)

Every effect that makes a spell cast more times applies only to a spell **you cast from hand**: Yazzus, Living
Grimoire, Orivax, Nimbus, Comet (Cometius), Edward Keg-hands, Constellation Prime, Spell Thesis, Ancient Runes, the
Bottomless Cellar, The Endless Verse, and the Shared Pour, Bottomless Cask, Hoardflame and Dragon Breath runes. A
spell cast by a minion (a Mage-Pup, an End-of-Turn caster), a rune (Rune of Recurrence, a rune threshold) or an
Equipment (Pourman's Keg) casts once, and it never uses up a one-shot multiplier: the Grimoire charge,
Orivax's first spell, the Spell Thesis freebie, a Nimbus or Comet charge and Shared Pour's first Ale all wait for your
next spell from hand. A re-cast of the spell you are casting from hand (Mirrorwing, Yirin's Reflector, Runefire,
Crash Course, Rune of Shared Reflection) is that same cast happening again and keeps its multiplier. A minion's or
rune's cast is still a spell cast for every tally and for first/last-spell memory (R-MINIONCAST-01). Rubies were
already multiplied only from hand (Rune of Resonance, Prismcaster); that is unchanged.

### An Aura-affecting spell is permanent from any phase (owner rule 2026-09-09, R-AURA-02)

Lantern of Souls raises the **Undead Aura** for the rest of the run whether it is cast in the shop or in
combat (a Rally, an Avenge, an Echo). Combat casts carry the gain back at settle. There is no combat-only Aura.

### Next-combat spells work for either side, and cast at Start of Combat (owner rulings 2026-10-07, R-NEXTCOMBAT-01..03, R-LOBBY-14)

A spell cast in the Shop **for the next fight** (as of the 2026-10-07 owner batch, Fleeting Vigor, Open the Gates, Marked
Target, Solid Ground, Containment Rune, Stolen Initiative, Parting Cry and Closed Casket are ARCHIVED: out of every pool,
the machinery stays for replays and held copies) (Weaken, Fleeting Vigor, Field Maneuvers, Last Stand, Executioner's
Edge, Open the Gates, Marked Target, Rallying Offensive, Decoy Sigil, Summoning Bulwark, Solid Ground, Containment
Rune, Stolen Initiative, Bloodlust, Parting Cry, Closed Casket) travels with the board snapshot and resolves for
**whichever side holds it** (*"these should carry over"*; *"rallying offensive and marked target should work for
opponents"*). Marked Target gives the holder's **foe's** right-most minion Taunt. **Pre-emptive Assault** is the one
exception: a **player-only carry** (owner 2026-10-07: *"pre-emptive assault is a player only carry. dont let enemies
cast this"*, R-PREEMPTIVE-PLAYER-01). It is never captured on a snapshot, so no opponent ever casts or applies it.

- **Spent on its own round only** (*"this is probably okay as long as they are spent on the turn the player played
  them"*): a snapshot's banks apply only in the fight for the round it was captured at (`snap.wave`). A recorded seat
  serving its final board past its own end, a seat whose recording skipped a round, and a ghost all fight without
  them. A fight never spends them on the shared snapshot. On the player's run they stay armed through the fight and
  are spent at settle.
- **Seat-vs-seat fights use full sides** (*"is a significant issue that needs to be fixed"*): opponent-vs-opponent and
  opponent-bye-vs-ghost fights build each side through the same builder as the player's opponent, so runes, quests,
  scalers and banked spells apply there too.
- **The cast beat**: each one shows the spell card at Start of Combat (the same preview a rune's cast uses), then its
  effect lands. The player's casts show on the player's side; an opponent's on the right side of the screen, mirrored.

### There is no Beast Aura: "Give all Friendly and summoned Beasts" works in both phases (owner rules 2026-09-28, R-AURA-03)

Beasts do **not** work like the Undead Aura; there is no hidden run-wide Beast channel. Every Beast grant reads
*"Give all Friendly and summoned Beasts +X/+Y"* (wording 2026-09-29; it was "Give all your Beasts") and uses the
normal "your Beasts" meaning, in both phases:

- **In the Shop / at End of Turn**, every Beast in your **warband** (the board; not your hand, the same as every
  other Shop "your Beasts" grant) gains it **permanently**, like any Shop buff. A Grim destroyed or triggered in the
  Shop buffs the warband.
- **In combat**, every friendly Beast in the fight gains it, including Beasts summoned later that fight, and it does
  **not** carry back after the fight, unless a mechanic keeps combat stats (an **Engraved** Beast keeps it).

The cards:

- **Kennelmaster**: *Start of Combat: Give all Friendly and summoned Beasts +2 Attack. Avenge (3): Improve this.* Each improvement adds +2 (gilded +4 improving +4). The improvement is
  permanent on that Kennelmaster (its `summonBonus`). One earned mid-fight is used from its **next** Start of Combat.
- **Grim**: *Echo: Give all Friendly and summoned Beasts +8/+8.* (gilded +16/+16). The 2026-09-24 per-game Echo tally is gone.
- **Armadiyo**, **Trophy Stalker**, **Rune of Beastial Swarm** (a Shop Beast death also pays it; its Avenge level
  persists), **Pack Mentality** (a Start of Combat grant whose level improves and persists) and **The Old Hunt**
  follow the same pattern.

The old run-wide Beast channel (`beastBuyAtk` / `beastBuyHp`) is no longer fed. It is still read, so an older
in-flight run or recorded snapshot keeps what it banked.

---

### Aura — the run-wide scope noun (owner ruling 2026-08-28)

A grant that reaches a whole tribe/class **wherever its members sit** — the board, your hand, the Shop, and
copies you acquire later — prints as an **Aura**: *"give your **Undead Aura** +5 Attack"*, *"improve your **Imp
Aura** by +2/+2"*. The shape is `your <Tribe-singular> Aura`. (Beasts have no Aura since 2026-09-28: see R-AURA-03 above.)

This replaced the older scope tails **"wherever they are"** and **"everywhere"**, which no longer appear in
any printed text. It is a **vocabulary change only** — an Aura grant is the same run-wide grant it always
was, with the same numbers, targets and timing; no engine identifier, effect id, or FX path moved. The rule
and its machine-checkable predicate live in the language guide as **LG-SCOPE-01**
(`packages/rules/src/languageGuide.ts`), and a grow-loudly test fails if new text reintroduces a retired tail.

Unrelated and **reserved**: the owner's own **Rise / Reborn → Rebirth** rename is still in flight and was not
touched here (LG-KEYWORD-02).

### Ruby types (owner Ruby batch 2026-09-24; R-RUBY-02, R-RUBY-03, R-RAND-02)

There are **six Ruby types**. Every one grants its printed stats plus the run's Ruby improvements; five carry a
rider that fires only when the Ruby's **target is a Kobold** (dual-tribe and All-types bodies count):

| Ruby | Grant | Kobold rider |
| --- | --- | --- |
| Ruby | +1/+1 | none |
| Warding Ruby | +1/+2 | give it Ward |
| Golden Ruby | +1/+1 | gain 2 Gold |
| Splintered Ruby | +1/+1 | the Ruby bounces once to a random other friendly minion |
| Ripple Ruby | +1/+1 | it casts again on the same minion (a real cast, never a third) |
| Dark Ruby | +1/+1 | it consumes the Shop minion with the highest Health (ties: leftmost; the Starform counts) and gains its stats as Rubies; no Shop minion, no consume |

- **"A random Ruby"** is any of the six at equal odds, each Ruby drawn separately (Ruby Shipment, Kobe, Gem Sage,
  Rune of Resonance, Rune of Investment). "Get N Rubies" without "random" stays plain Rubies.
- A rider resolves **once per cast** on the direct target; a cast multiplier repeats the whole cast (under Rune of
  Resonance a Ripple lands four times). A **hop** (a bounce, Rune of Redirection / Distillation) carries the
  stats and the Ward only.
- **Gem Sage** pays a random Ruby for every Ruby that reaches your hand; a Sage's own Rubies never re-trigger a
  Sage. A Ruby won in combat reaches the hand at settle, so the Sage pays there.
- The special Rubies are only ever cast from the hand in the Shop today; no combat effect casts one.

---

## Unverified / confirm

- **Starting Health divergence:** all heroes are 30 Health *today*, but the code comment notes it
  "will diverge per hero over time" — **(unverified — confirm)** whether any hero already differs.
- **Practice mode** is a lobby that "can't be lost" (unlimited health, longer
  per-turn clock) per the config comment — the exact per-turn clock difference is
  **(unverified — confirm)** against the recruit timer.
- **Practice Tribes** (2026-09-27, R-PRACTICE-SURGE-01): the Practice setup's multi-select "Tribes" row picks
  the run's active tribes outright (Normal = the usual seeded roll). With tribes picked, the run's pool is
  narrowed to those tribes plus neutral (a dual type counts when either tribe is picked; tokens stay), so the
  shop, Discovers, spells and random grants, and the hero, rune and quest tribe gates, all follow them.
