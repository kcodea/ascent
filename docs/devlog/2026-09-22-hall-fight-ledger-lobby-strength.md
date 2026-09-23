# The fight ledger, the Hall by record against everyone, lobby strength, and the 1st-place bonus

**Date:** 2026-09-22 · **Branch:** `feat/hall-fight-ledger-lobby-strength` · **Owner asks (verbatim):** "we want
the hall of champions to answer 'what board has been the best against everything else' basically, and what the
top 10 are in that category" … "we would want to know its strength start to finish though, like overall win/loss
across games. so a 15 round game may mean it was 12-3" … "make an algorithm that can essentially assign a lobby
strength value/indicator … we can then make winning really difficult lobbies more rewarding".

**The owner's scoping answers:** (1) play the table out after the reporter's elimination: yes. (2) Hall
qualification: 10 fights. (3) strength = raw win rate across every round the board was served; rank is not a
factor yet. (4) both a tier and a number, on the Career match results (and Recent Games), not the post-game
screen. (5) never before the game. (6) only WINNING a hard lobby scales, only upward, up to 15 rating. (7) on
now, with a patch note. (8) the knockout ledger is redundant once every fight is recorded.

This supersedes the morning's #1630 (the knockout ledger, `seat_results`, devlog
`2026-09-22-hall-of-champions-table-wins.md`).

## 1. The fight ledger (`lobby_fights`)

`settleRunLobbyRound` already resolves EVERY pairing at the table each round, so a finished run's lobby holds who
beat whom while the player was in it. `packages/sim/src/lobby/fightLedger.ts` turns that into rows:

- **One row per fought, non-ghost pairing**, from A's side: `lobby_seed, round, run_a, run_b, outcome ('a' |
  'b' | 'draw'), observed, patch` (+ the reporter's `user_id` at upload).
- **Keys.** A recorded seat is its `runKey` (`author|heroId|seed`, exactly as `playerRunsFrom` groups the pool).
  The reporter's seat is `${author}|${heroId}|${seed}` from their own run (the same shape the pool will group it
  under once its boards land). A generated seat (`hybrid` / `bot` / `authored`) is `bot:<kind>:<heroId>`. A
  snapshot seat whose `runKey` this session's pool cannot resolve was driven by a hybrid under the same key
  (`driverFor`), so it is keyed `bot:hybrid:<hero>` and the recorded run is never credited for boards it did not
  field.
- **Not a row:** a ghost fight (`bye` set — the dead run's owner is out), a sit-out, an unfieldable pairing
  (`fought: false`), and a bot-versus-bot fight (counts for nobody the Hall or the strength read; an
  implementation call).
- **The play-out.** When the reporter fell before the table finished, `playOutRunLobby` finishes the remaining
  rounds **on a shallow clone** (seats copied, encounters copied) with the same `settleRunLobbyRound` and a
  dead-player result nobody reads (the pairing skips dead seats). Deterministic: pairing and combat seed from
  `(seed, round)`, every rival driver in a real lobby is a recording. Those rows carry `observed = false`. A
  reporter who WON has a finished lobby: no play-out, all observed. It runs in the **store's run-end `setTimeout`**,
  never in the reducer and never against `run.lobby` — the reducer-side play-out of the morning collided with
  the balance instrument's own play-out, and that cannot recur from a clone in the UI layer.
- **Upload:** `recordLobbyFights` — ONE batched upsert, `onConflict 'lobby_seed,round,run_a,run_b'`,
  `ignoreDuplicates`, through the same fire-and-forget / offline-queue path (`QueueKind 'fights'`) as every
  other upload. A run restored and finished twice yields byte-identical rows, so the unique key dedupes.
- **Retired:** `seatOutcomesOf`, `SeatResultRow`, `recordSeatResults`, `fetchSeatRecords`, `tallySeatRecords`
  and their tests. The `seat_results` table stays in place (0 rows live); dropping it is the owner's call.

## 2. The view (`run_fight_records`)

Per run key over both sides of every fight: `fights, wins, losses, draws, lobbies (distinct lobby_seed),
last_fight_at, win_rate (wins / fights), wilson_lb` (the Wilson score interval's lower bound at 95%, z =
1.959964, in SQL). Public read for `anon` and `authenticated` like the other ledgers. The client reads the
view only, never a row pool.

## 3. The Hall

`fetchHallRecords`: `run_fight_records` where `run_key not like 'bot:%'` and `fights >= 10`, ordered by
`wilson_lb desc, fights desc, last_fight_at desc`, `limit 10`. Every recorded run is a candidate, not only lobby
winners. Then ONE `run_history` read by seed (`fetchHallHistory`, every placement — the old `placement = 1` filter
is gone) for the rank held (`entry.rank.before`), the run's own record (`entry.wins/losses/draws` — "12–3"; it
counts the player's ghost fights, which the ledger deliberately does not), its date, placement and its final
warband (`entry.board`, the same end-state board the Career shows).

**The final warband, cheapest select:** the career row already carries it, so the common case costs no extra
query. Only a run whose career row has no board (or no career row at all) falls back to the pool:
`boards?select=snapshot&author=eq.<a>&hero_id=eq.<h>&seed=eq.<s>&order=wave.desc&limit=1` — one row, one jsonb,
a few KB, ten in parallel at most (`fetchRunFinalBoards`). Keys are parsed FROM THE RIGHT (`parseRunKey`: seed =
last segment, hero = second-last, author = the rest) because names are unsanitized.

Row layout keeps #1630's (medallion; hero frame + player + hero; Final team + Runes; the record block). The
record block is now: `W–L–D` across everything, `79% win rate · 4 lobbies`, `Own game 12–3`, `Last fight <date>`,
the rank held. Subtitle: "The 10 warbands with the best record against everyone". Sorts: **Win rate** (the
Wilson order, default) and **Most recent** (by last fight). Empty state: "No records yet. A warband enters the
Hall after 10 fights."

## 4. Lobby strength

`packages/sim/src/lobbyStrength.ts` — in one sentence: **the average win rate of your seven opponents' runs, as a
percentage, where an unknown run counts as 50 and a bot as 25.**

- Per opponent seat: `smoothed = (wins + 10) / (fights + 20)` from the view (a Bayesian prior of 10 wins in 20
  fights, so an unserved run sits at exactly 0.5 and a 2–0 run reads 0.545, not 1.0); a `bot:` key is a fixed
  0.25.
- `value = round(100 × mean over the seven)`, **no further rescale** — the prior already makes a no-information
  table read exactly 50, a bot table 25 and a proven 70% field near 70, and the number is monotonic in every
  opponent's record by construction. While the field is young nearly every seat sits at the prior, so most lobbies
  will read Even; that is expected and must not be tuned away.
- Tiers in ONE const (`STRENGTH_TIERS`): Easy < 35, Even 35–54, Hard 55–69, Brutal ≥ 70 (a starting cut).
- Three worked examples: seven bots → 25 (Easy); seven unserved runs → 50 (Even); seven runs at 36–4 → 77
  (Brutal); the mixed table in R-LOBBY-03 → 49 (Even).
- Computed at run end from **one fetch of the seven keys** (`fetchLobbyStrength`, time-boxed by
  `FETCH_TIMEOUT_MS`; bot keys never hit the network; a dead view stamps NOTHING, never a guessed 50), stored on
  the history entry as `lobbyStrength: { value, tier, inputs: [{ key, fights, wins }] }` AND on the v2 replay
  result (`result.lobbyStrength`) inside the telemetry row — Recent Games reads `run_telemetry`, which is
  insert-only for clients and can never be back-stamped, so the history + telemetry uploads wait for the fetch
  (at most the timeout) and upload without a stamp if it failed. The rank submission and the end screen never
  wait. Shown as "Brutal 74" on the Career match rows (a fourth labelled fact, "Lobby") and the Recent Games rows
  ("Lobby" beside Length / Rounds) — only when the row carries a stamp; never on the post-game screen, never on
  the rail.

## 5. The bonus (server-owned, on now)

`bonus = round(15 × clamp((s − 55) / 45, 0, 1))` on a **1st place only**: 0 at 55 and below, +5 at 70, +6 at 74,
+10 at 85, +15 at 100; never on 2nd–8th, never negative, losses untouched. Added to the award **before** every
gate / cap / floor branch in all three copies (`rank.ts resolveRank(before, placement, rules, { bonus,
lobbyStrength })`, `lobbyRating.ts resolveRankOutcome(before, placement, bonus)`, `settle_rank` step 5):

| Start | Finish | Strength | Award | Applied | Result |
|---|---|---|---|---|---|
| Gold II 20 | 1st | Brutal 74 | +40 +6 = 46 | +46 | Gold II 66 |
| Gold II 20 | 1st | Even 50 | +40 | +40 | Gold II 60 |
| Gold II 20 | 2nd | Brutal 74 | +28 (no bonus) | +28 | Gold II 48 |
| Gold II 90 | 1st | 100 | +55 | +10 (45 capped) | Gold II 100, promotion game ready |
| Gold II 100 | 1st | 100 | +55 (converted) | +10 | Gold III 10 |
| Ascendant III 130 | 1st | 100 | +55 | +55 | Ascendant III 185 |

**The full rating gain algorithm, for the owner:** `award = placementAwards[placement]` (+40/+28/+16/+6/−6/−16/
−28/−40) `+ (placement == 1 ? bonus(strength) : 0)`. Then, unchanged: at a promotion gate (100/100 below the top)
a finish at or better than the required placement (top-4 for a division, 1st for a medal) promotes to 10/100 of
the next division, a positive award short of a medal gate holds at 100, a negative one applies from 100; at an
armed demotion gate a bottom-4 drops one division to 100 + award, a top-4 applies its award from 0; otherwise
add the award — a loss landing on 0 above Bronze I clamps at 0 and arms the demotion game, Bronze I floors at 0,
Ascendant III is uncapped, elsewhere ≥ 100 caps at exactly 100 (overflow discarded) and unlocks the gate.
`cappedPoints = |award| − |applied|` (0 on a won promotion) is honest about the bonus.

The client sends the seven seat keys with the rank request (`seatKeys`, never a strength, never a bonus);
`settle_rank(p_seat_keys)` recomputes the strength from the view at settle time and applies the bonus; the Edge
Function re-derives it from the SQL's `lobbyStrength` for its parity flag. The result records `strengthBonus`
and `lobbyStrength` (`rank_results.strength_bonus` / `lobby_strength`, `rank_result_json`, `RankResult`); the
rank screen prints "+40 RP +12 lobby" (`deltaText`). The rules version is NOT bumped: an old client only
mis-predicts the number until the server answers, and a client that sends no keys settles with no bonus.

**Assumption flagged:** "only upwards of 15 rating" is read as "a bonus of up to +15 on a 1st". The season
question: on now, mid-season, with a patch note (owner answer 7).

## 6. Owner runbook

Order matters only in one direction: **deploy the Edge Function first, then run the SQL.** The new function
works against both databases (it retries without the seat keys when the six-argument `settle_rank` is all the
database knows); the OLD function against the NEW database would fail, because the migration drops the
six-argument overload.

1. **Deploy the Edge Function.** From the repo root (Claude can run this step when asked):

   ```
   npx.cmd supabase@2 functions deploy submit-rating
   ```

   (macOS/Linux: `npx supabase@2 functions deploy submit-rating`.) Confirm in **Edge Functions → submit-rating**
   that the deployed version's timestamp is now.

2. Supabase dashboard → **SQL Editor** → **New query**. Paste the whole of
   `supabase/migrations/2026-09-22-fight-ledger.sql` (the same block is at the bottom of `schema.sql`). Click
   **Run**. Idempotent; re-running is safe. It creates `lobby_fights`, the `run_fight_records` view, adds
   `rank_results.lobby_strength` / `strength_bonus`, replaces `rank_result_json`, drops the six-argument
   `settle_rank` and creates the seven-argument one with its grants.

3. Verify with the anon REST probe (replace the URL and key with the two values in `.env`; reads only):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" "$VITE_SUPABASE_URL/rest/v1/lobby_fights?select=run_a&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
   curl -s -o /dev/null -w "%{http_code}\n" "$VITE_SUPABASE_URL/rest/v1/run_fight_records?select=run_key,fights,wilson_lb&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
   ```

   Both answer `200` (an empty `[]` body until lobbies finish). Before step 2 both answer `404`. Then in the SQL
   editor:

   ```sql
   select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname = 'settle_rank';
   -- expect exactly ONE row, ending in "p_seed bigint, p_seat_keys text[]"
   select column_name from information_schema.columns where table_name = 'rank_results' and column_name in ('lobby_strength', 'strength_bonus');
   -- expect both
   ```

4. Nothing else. Rows arrive as lobbies finish. The Hall fills once a run reaches 10 fights; the Career and
   Recent Games rows show a strength from the first run finished after the view exists; the first 1st place at
   strength ≥ 56 shows "+40 RP +N lobby".

**Pre-migration behaviour (nothing breaks):** the view 404s, so the Hall shows "No records yet", Career rows show
no strength, `fetchLobbyStrength` stamps nothing; `settle_rank` called with the new argument by the new function
gets PGRST202 and the function retries without it, so the settlement lands with no bonus.

**Not verified here:** the SQL itself was not executed against a database (no Postgres in CI, and the owner
runs every SQL step by hand). The parity test reads its constants and the function body out of the migration
text and drives the same fixtures through the two TS copies.

## 7. Oracle

`R-HALL-01` (the ledger + the Hall), `R-LOBBY-03` (the strength), `R-RANK-04` (the bonus); `R-LOBBY-02` revised
in place as superseded. `docs/docbot2/final-report.md` bumped from 172 rules / 86 approved to 175 / 89.
