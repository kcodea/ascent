# Ranked Duos: design (STEP A, no code yet)

Status: DESIGN FOR REVIEW (2026-10-26). Nothing here is built. Section 11 lists the open questions, each with a
recommended default; section 12 is the phased plan.

## The owner's design (2026-10-26)

- "i now want to add a duo's ranked option. this should be its own rank/snapshots etc, but follow the lobby rule set.
  the only difference is it won't have a gold fuse, and timer cannot stop since both players are playing live."
- End turn: "the game will still halt/not progress into combat, and back to shop, until both players hit their end
  turn/combat gem. (we'll have a timer if 1 player hits it of 5 seconds before the game auto progresses if the time is
  at 0)." Clarified: one teammate ends while time remains: wait for the other until the clock hits 0. One has ended and
  the clock is 0: the other gets 5 s, then it progresses. "if neither has ended at 0, the game waits until a teammate
  hits the end turn button then starts a 5s wait to progress unless both teammates hit end turn, then the game
  immediately progresses." Disconnect: the absent teammate's last board fights on auto (as Versus).
- "the duos lobby mode will be 4 teams of 2." The two teammates play LIVE; the other 3 teams are recorded snapshots.
- "duo's snapshots are the priority to be served, but until we have enough duo's snapshots, just put random single
  player snapshots together and serve them as teammate boards." Fallback: two DIFFERENT players, the same round-based
  serving rules, strength by the ranked matchmaking rules in place.
- Party: "i think we do an invite system/lobby type thing. like if i go into play ranked, duos, it should open a lobby
  that's visible in the duo's play area". Owner update 2026-10-26: friend invites (the separate `feat/friends-list`
  build: friends list, presence, invite API with an in-game Accept / Decline notice) are the MAIN way to team up, plus
  a public "open duo lobbies" list in the Duos play area for joining without being friends.
- Team pool = 30 Health + both heroes' Armor; the lobby damage formula and round cap; tag-team fights (`simulate`
  `config.reserve`); passing exactly as Versus Duos (1 Gold, hand only, refused on a full hand); placement 1-4 per
  team; both teammates get the same rating change; a separate Duos rating, medal track and Leaderboard tab; resets with
  the normal season; spectatable like other modes (hero select included). Pings come later.

Standing rules that bind it: snapshot serving integrity (R-LOBBY-SERVE-01: the round number is the truth, exact
recorded state); combat sides 1:1 symmetric (R-SYMMETRY-01); reuse existing UI (gate + crystal, rail, Resolve slot,
Esc menu, hero select, clock, Versus room); real-time and cross-phase by default; loops back off (R-NET-BACKOFF-01);
no `title=`; gauntlet cursor; >160 fps; every ruling gets an oracle rule; no "Oath" / "climb" / em dashes in player text.

## 1. What it is, in one paragraph

A Ranked Duos game is a **server match** (a Versus Group match row with `options.mode = 'ranked_duos'`) holding
**4 teams of 2 = 8 seats**: team A is the two live players (p1, p2); teams B, C and D are **served seats**, each a pair
of recorded runs pinned at match start. Every round the server pairs the living teams with the lobby's pairing rule,
resolves each pairing with ONE tag-team `simulate()` (so our fight AND the snapshot-vs-snapshot fight), applies the
lobby damage formula to the team pools (Armor first, then Health, round loss cap), and places teams 4th to 1st as they
fall. The live teammates' runs are each player's own client run, exactly as in Versus Duos; only the shared state
(round, clock, end-turn gate, pairing, served boards, team pools, passes, placement, rating) lives on the server.

## 2. Mapping onto the async lobby

| Lobby concept | Solo ranked lobby today | Ranked Duos |
| --- | --- | --- |
| Table | 8 seats, `s0` live, 7 recorded / generated | 4 team slots (8 seats): team A = the two live players, B-D = served pairs |
| Seed | `createRunLobby(seed, ...)` client side | the match `seed` (server, `versus_group_matches.seed`); every derived pick (seat table, pairing, fight order of fallback pairs, ghost) is `seed`-forked through the one RNG, so server, both clients and a replay agree |
| Who sits at the table | client: `pool_runs_sample` (150 runs) then seat selection | **server, once**, after both heroes lock (section 5): duo runs first, then fallback pairs; written to a pinned table |
| Pairing | `pairRunLobby` (exhaustive matching, no-repeat 3 rounds, bye only for the bottom 3, ghost fight) | the SAME function over TEAMS (a team is a seat for pairing; standing = team Health + Armor). 4 alive: 2 fights. 3 alive: 1 fight + a ghost fight (the most recently fallen team's two boards from the round it fell, as a tag-team ghost). 2 alive: the final |
| A fight | `simulate(player, enemy)` once, both damages from that one result | `simulate(teamFirst, teamFirst', ..., { reserve })` once per pairing; both teams' damage from that one result |
| Damage | `min(roundLossCap, playerDamage)` | the same, on the team pool. The fight's damage is the lobby formula read from the one result (the standing board's owner's tier plus its surviving minions; see reading R1) |
| Health | 30 Resolve + the hero's Armor per seat | **one team pool: 30 Health + both heroes' Armor**; served teams likewise from their two heroes |
| Elimination / placement | a seat at 0 is out; ties share the lower place | a team at 0 is out together; two teams out in one round share the lower place (lobby rule); last team standing is 1st |
| Round cap | `maxRounds: 60` stalemate backstop | the same |
| Gold Fuse | every lobby turn opens with no clock; 10 Gold spent starts it | **none**. The round clock always runs from the shop open (`standardTurnSeconds(round)`), from one server deadline |
| Opponents pinned | `servedBoards` + `lobbySeatRecordings` beside the save | the served sides are copied INTO the match at seating (section 5.3); a restore, a reconnect and a replay read the copy, never the pool |
| Unrated | all seven seats generated | all three served teams generated (no real recorded run) = unrated, checked by the server |
| Hero uniqueness | 8 unique heroes per table | the same: the two live players' offers are disjoint (the hero-select builder's teammate options), and seating skips any run on a hero already at the table |

Fight order inside a team: the live team's order is the Versus Duos 50/50 (`duosRandomFirst(seed, round)`,
R-DUOS-ORDER-01). A served duo run fights in its RECORDED order (exact state); a fallback pair uses the same seeded
50/50 from the match seed and its team letter (open question Q9).

## 3. Who is authoritative: the server match row

**Recommendation: the server.** Reuse the Versus Group tables (`versus_group_matches`, `_seats`, `_teams`,
`_submissions`, `_rounds`, `_fights`, `_spectator_frames`, `versus_duos_passes`) with a new mode, and a new
`versus-resolve` action. Reasons:

1. Two live clients must agree on the round, the clock, the pairing, every served board and every team's pool. A
   client-side lobby on one "host" would need the other to mirror it, a host migration on disconnect, and trust in the
   host's placement. The server already does all of this for Versus Duos.
2. **Placement becomes server-decided**, so the rating can be settled from the server's own record instead of a
   client-reported placement (stronger than solo ranked today).
3. The served boards never travel to a client in bulk (egress, section 9), and nothing on a client can swap them.

What stays on the client, exactly as Versus Duos: each player's run (shop, reducer, Gold, hand), the prepared side it
locks, candidate sides while shopping, scout data, passes (outbox / receive / refund), the projection of the match onto
the ordinary lobby screens (`versusGroupLobby` -> a 4-row team rail), combat playback of the fights it is shown.

### 3.1 The shared clock and the end-turn gate (server)

Per round: the shop opens at `shop_starts_at`; deadline `D = shop_starts_at + standardTurnSeconds(round)` (no fuse, no
local pause, the 250 ms lock grace as today). Each live seat has `locked` + `locked_at`. The server closes the round
when:

| Situation | Closes at |
| --- | --- |
| both locked | **at once** (whatever the clock says) |
| one locked, clock > 0 | `D + 5 s` at the earliest; the other's lock before that closes it at once |
| one locked before 0, clock reaches 0 | `D + 5 s` (the other gets 5 s) |
| neither locked at 0 | **waits**; the first lock at time `t` opens a 5 s window: closes at `t + 5 s`, or at once on the second lock |
| a teammate disconnected (lease lapsed, 12 s) | that seat counts as locked (its last locked board, `source: 'auto'`) |

So the rule is one formula: `close = both locked ? now : max(D, firstLockAt) + 5 s`, with "neither locked past D"
meaning no close yet. When the window ends the late teammate's turn is locked from their LATEST candidate side
(`source: 'deadline'`, the Versus path), any open decision gets the seeded random legal pick (as Versus). On screen: the
existing End Turn pill ("Players ready 1/2"), the clock face reads 0:00 then a 5 s countdown on the same face (the
existing `versusClockFx` ticks), the waiting player's board goes quiet as after a lobby End Turn. Overtime behaviour
(can the shop still be used at 0:00 while nobody has ended?) is open question Q1; it also needs a backstop so an idle
pair cannot hold a match open forever.

Back from combat: the next shop opens when both live players are back (served teams are never waited for); when one is
back the other has 5 s (the Group rule), 90 s at most from the commit.

### 3.2 Disconnects

"Timer cannot stop": **no pause** in Ranked Duos (unlike Versus, whose pause exists because the opponent is live).
The clock keeps running; a lapsed lease makes that seat count as locked for the gate; its last locked board fights on
auto every round; coming back clears auto and the run catches up through the committed rounds (the Versus auto path).
The Versus "three auto rounds = out" rule does NOT carry over by default (it would knock out the teammate who stayed;
see Q3). Passing to an away teammate is refused (`teammate_away`, already built).

## 4. Duo snapshots: what is recorded and how it is served

### 4.1 What a duo snapshot is

A **duo run** = one live team's whole game: for every round it played, BOTH members' sides **exactly as they fought**
(the final `versus_group_submissions.prepared_side` with its `source`: lock / deadline / auto / empty, empty boards
included), the team's fight order for that round, the team pool before the round, each member's hero, cosmetics and
scout (face-down hand count), and the run's end (round and placement). It needs no client upload: the server already
holds every final side, so the duo run is written by the server when the team's result is final (a copy out of the
match's submissions into the pool tables, inside the commit). That makes it exact by construction.

Tables (new, separate from the solo pool so no solo RPC changes):

- `duo_runs`: one row per team run (id, match id, set id, content revision / build, members' user ids + run keys +
  heroes + cosmetics, rounds covered, final round, placement, strength / early / late once scored, created_at).
- `duo_run_rounds`: (duo run, round) -> both members' prepared sides, order, team pool. One row per round, every round.

Eligible to be served (mirrors R-LOBBY-07): at least 4 rounds, starts at round 1 or 2, no hole longer than one round,
both members real accounts, not a `dev_forced` match, same set and build as the new match.

### 4.2 Serving on exactly the right round (R-LOBBY-SERVE-01 applied to pairs)

A served duo team fields, in round N, its own round-N row: both sides and its order, nothing else. A round before its
first row is two EMPTY tier-1 boards; a hole inside it is two empty boards in the previous row's state (`emptyRoundOf`);
past its end, its final row repeats (the stale-final-board rule, with its own Armor). A member that fought on auto
serves the board that actually fought. Never a later round's board.

Fallback pairs (section 5.2) serve each member through the solo rules unchanged: `boardAt(run, N)`.

### 4.3 Strength of a duo run

Each live client already scores its own boards in idle slices (`ui/src/boardStrength/`); in Ranked Duos it sends the
raw strength with its lock (a few bytes on the submission). At the end the server derives the duo run's
early / late / weighted strength from both members' boards with the solo formulas (round-weighted, ranked among duo
runs). Unscored duo runs are inside every band (the solo rule).

## 5. Seating the table (server, deterministic, pinned)

### 5.1 When and where

After both heroes lock (the heroes are needed for uniqueness), during the intro ceremony: a new `versus-resolve` action
`seat_ranked_duos { matchId }` (idempotent; either client may call it; the first wins under the match lock). It runs the
selection in TypeScript from the bundled sim code, so the server and the tests share ONE implementation of the lobby's
seat rules. It reads candidates server side (`pool_runs_sample` with the band, plus a `duo_runs_sample` twin), so no
client downloads the 150-run pool for a Duos game.

### 5.2 The algorithm

Inputs: match seed, set, build, the band (from the team's Duos medal, Q5), the two live heroes.

1. **Duo runs first.** Seeded shuffle of eligible duo runs inside the band (band filter on the duo run's score, the
   overall cap on its weighted strength, unscored = in). Take runs in shuffle order, skipping a run whose either hero
   is already at the table or whose members would break the per-player cap (below), until 3 teams or none left.
2. **Fallback pairs for the rest.** Seeded shuffle of eligible SOLO runs inside the band (exactly the ranked lobby's
   eligibility, band, overall cap and widening: +10 per capped side, cap never relaxed). Walk the shuffle; a run joins
   the open team slot if its player differs from its partner's (two DIFFERENT players, `runOwnerOf`), its hero is not
   at the table yet, and its player holds fewer than the cap. Fill partner 2 before opening the next slot. Both runs
   pass the band on their own (no averaging, so a strong run cannot hide behind a weak partner).
3. **Per-player cap.** At most 2 of the 6 served seats per player (the solo cap of 4 of 7 scaled; reading R2). Your own
   runs and duo runs are seatable like anyone's, under the same cap.
4. **Generated seats last.** A slot nothing can fill gets a generated pair (hybrid seats, set-scoped), never a smaller
   table. All three generated = unrated.
5. **Pin.** Write `versus_duos_served` (match, team, member, kind duo/solo/generated, source run key, and the WHOLE
   recording copied: the duo run's rows or the solo run's boards). Every later read (finalize, scouting, reconnect,
   replay, match details) reads only this copy. Deleting or rescoring pool rows never changes a running match.

Deterministic: the same seed, pool snapshot and heroes give the same table; and since the result is stored, nothing
re-derives it later anyway.

### 5.3 Finalize

New `versus-resolve` action `finalize_ranked_duos { matchId, round }` (pure handler like `duosFinalize.ts`, injected
store, parity case set): read the live team's final sides and the served teams' round-N sides (prepared from the pinned
copy through the lobby's own recorded-seat `prepare`), pair teams (`pairRunLobby` over teams), resolve each pairing
once with `reserve`, apply damage, commit through a new `versus_ranked_duos_commit_round` (team pools, eliminations,
placements, the duo-run write for a finished live team, and the rating settle; idempotent, the existing lock order
R-VERSUS-LOCK-ORDER-01). The fight rows store our team's fight in full; the other fight stores only its outcome and the
damage (the rail needs no more; Q11 if spectators should see it).

## 6. Rating, ranks and the Edge Function

- **Storage.** A separate track: `duos_rank_profiles` (user_id, season, rules_version, division, points, highest
  division / points, demotion_ready, revision) and an immutable `duos_rank_results` (user_id, match_id, team,
  placement, before, after, award, flags). Same shapes as the solo `profiles.rank_*` / `rank_results`, so the medal
  screen, crest, bar and rank queue components render it with a "Duos" label. Season: the same `c_season` constant;
  the season reset block resets this table too.
- **Rules.** `resolveRank` with a Duos placement table (Q2) and gates rescaled to 4 places: division promotion needs a
  top-2 team finish, medal promotion 1st; a demotion game demotes on 3rd / 4th; no instant demotions; Bronze I floor;
  Ascendant III uncapped. The table lives in the three agreeing places as today (`settle_duos_rank` SQL,
  `_shared/lobbyRating.ts`, `sim/rank.ts`), parameterised rather than copied. Strength bonus: off in v1 (it is built
  on the solo fight ledger; Q2).
- **Who settles: the server, from its own placement.** `settle_duos_rank(p_user, p_match)` runs inside the round
  commit the moment a team is placed (both members, same placement, same award; each player's own promotion / demotion
  gate still applies, so a player in a gate game sees the gate outcome). No client sends a placement. A leaver is
  settled by the leave RPC (Q3). `versus-resolve` re-derives each settle from the shared TS rules and logs a parity
  mismatch (the `submit-rating` posture), and the client reads its row from `duos_rank_results` for the rank screen.
  `submit-rating` is untouched (solo bytes cannot move); if a client-retry path is still wanted for symmetry it is a
  read, not a writer.
- **Refused:** unrated tables (all generated), `dev_forced` matches, bot accounts (the existing progression trigger
  pattern).
- **Ranked entry / abandon.** Start in the party is the ranked commit (the R-RANK-06 confirmation, Duos wording). From
  there, leaving costs rating (Q3). Closing the game on hero select is a disconnect, not an abandon.

## 7. Leaderboard, Career, Live Games

- **Leaderboard:** a "Solo / Duos" tab pill (the existing `.cv2-tabs` pill) on the ranked table; Duos reads
  `duos_rank_profiles` ordered by division then points. One row per player.
- **Career / Recent Games:** a Duos tab beside Ranked / Practice; a Duos row names the teammate and the team place.
  Match details: the four teams with places and their boards per round (from the pinned copy, never a driver).
- **Live Games:** a Ranked Duos match is listed like a ranked lobby game (one row per team, both names, Q10); Watch
  joins the match's stands and uses the Versus Duos spectator screen (player picker by team). Hero select spectating
  comes from `feat/hero-select-spectate` once merged.

## 8. Party lobby and invites (reuse, no new chrome)

- **Play > Ranked > Duos** opens a **duo party**: a Versus room with `options.mode = 'ranked_duos'`, two player seats
  (p1 host, p2 teammate) and the usual stands. The existing room screen, player cards, seat drag, gate + crystal and
  hero select are reused; the room options panel shows no mode choice (the party IS Ranked Duos) and no modifiers
  (ranked plays the live rules).
- **Invites (primary): the friends-list invite API** (`feat/friends-list`, being built separately: add by handle,
  presence Online / In a game / Offline, invite with an in-game Accept / Decline notice). From the party, "Invite" lists
  online friends; Accept seats the friend in p2. This design consumes that API and adds nothing of its own.
- **Open duo lobbies (secondary):** the Duos play area lists open parties (one seat free, member seen in the last
  2 minutes, same build), reusing the room browser and the `versus_open_rooms` count call (one call every 45 s while
  the menu is visible, as today). Join takes the free seat. The host can switch the party to friends-only (Q6).
- **Start:** host presses Start with both seated -> ranked confirmation for both -> both crystals -> hero select (the
  Versus hero select with the ranked re-roll and the teammate's options from the hero-select build) -> server seating
  during the intro -> round 1. No queue: the opponents are recordings, so a game starts at once.
- **After the game:** both are back in the party (rooms are continuous), ready for the next one.

## 9. Egress budget

Measured (devlog 2026-10-26-supabase-egress, after the cuts): a Versus Duos human ~2.5 KB/s with bots; a 1v1 ~1.4 KB/s.
A ranked game is longer (15-25 min), so a straight copy of Versus Duos is ~2.5-3.5 MB per player per game. Target:
**at most 1.5 MB per player per game**, measured in P4 with `egressMeter` + `scripts/egress-probe.mjs`, and the phase
does not ship over it without an owner call.

Built in from the start:

- The pool sample is read server side once per match (no 150 KB per client per game).
- Served boards reach a client only as needed: the current round's six served sides for scouting (small), and the full
  combat only for the fight the client watches; the snapshot-vs-snapshot fight is outcome + damage only.
- No rounds reads during the shop (R-NET-ROUNDS-01); one committed-round read per round.
- All loops through `net/backoff.ts` (R-NET-BACKOFF-01); hidden tabs on the floor; spectators never finalize.
- Teammate frames are published only while the teammate is actually watching (the spectator rule: nothing published
  with no watcher).
- Prefer a `realtime.send` broadcast wake-up over match-row change events (the ~3.2 KB per event follow-up from the
  egress devlog), since a ranked game has more rounds than a Versus match. If that lands for Versus first, reuse it.
- Duo-run writes are server-internal copies (no client upload at all).

## 10. Anti-cheat note

Shop turns are still not server-checked: a locked side is validated for shape and bounds (`preparedSideError`) and
otherwise trusted, as in Versus. Ranked Duos raises the stakes slightly (rated, and a team's locked sides become duo
snapshots served to others), so the replay / turn audit already on the pre-go-live list (auth layer C4) covers this
mode too. What Ranked Duos does better than solo: placement and rating are decided on the server, and the served
boards cannot be swapped by a client.

## 11. Open questions (only where the owner's answers do not decide it)

| # | Question | Recommended default |
| --- | --- | --- |
| Q1 | At 0:00 with neither teammate ended, the game waits for an End Turn. Can the shop still be used during that wait (overtime), or is it locked (R-TIMER-LOCK-01) and only the End Turn press is awaited? And is there a backstop for an idle pair? | **Shop stays usable in overtime** (the only reading where waiting means something); the 5 s window after the first End Turn is also usable by the other. **Backstop: 30 s past 0:00 locks both** as a timeout, so an idle pair cannot hold a server match open forever. |
| Q2 | Rating points per team place 1-4. | The solo table averaged in pairs: **1st +34, 2nd +11, 3rd -11, 4th -34**; division promotion needs top 2, medal promotion 1st, demotion game demotes on 3rd / 4th; no strength bonus in v1. |
| Q3 | A teammate who leaves (or never comes back). Versus puts the team out after 3 auto rounds; in ranked that punishes the one who stayed. | **The leaver is settled at once at the lowest open team place** (the abandon rule). The team plays on with the leaver's last board on auto, never forced out by missed rounds; the stayer gets the team's real placement. A concede in the Esc menu is a leave for that player only. A disconnect that comes back is not a leave. |
| Q4 | Same rating change for both: the AWARD is the same, but a player in a promotion / demotion game sees a different outcome. OK? | Yes: same placement award, each player's own gates apply. |
| Q5 | Which medal picks the strength band when teammates differ (Bronze with Diamond)? And may any two ranks team up? | **The higher of the two Duos medals**; any ranks may team up in v1 (revisit if boosting shows up). |
| Q6 | Open parties: listed by default, or friends only by default? | **Listed by default** while a seat is free, with a host toggle to friends only. |
| Q7 | Do duo runs ever feed the SOLO pool? | **No.** Separate pools both ways, except the owner's fallback (solo runs paired for Duos). |
| Q8 | Pre-emptive Assault (attack-first cards) is out of Versus. Ranked Duos follows the lobby rules. In or out? | **In** (the opponents are recordings, as in the lobby). |
| Q9 | Fight order of a served team. | Duo run: **its recorded order** (exact state). Fallback pair: the seeded 50/50 from the match seed (R-DUOS-ORDER-01). |
| Q10 | XP for a Ranked Duos game. | The ranked lobby's XP for the matching solo places averaged in pairs (team 1st = avg of 1st and 2nd, ...). Live Games: one row per team. |
| Q11 | Should spectators and the rail be able to watch the snapshot-vs-snapshot fight (costs egress)? | **No**, outcome and damage only. |

Readings made (flag, no answer needed unless wrong): **R1** the fight's damage is the lobby formula on the one result,
read from the board standing at the end (its owner's tier plus its surviving minions), capped by the round loss cap;
**R2** at most 2 of the 6 served seats per player (the solo 4-of-7 cap scaled); **R3** Freedom / Summit and other
modifiers are not available in ranked; **R4** each player records their own replay v2 of their own screen, as a ranked
lobby game does (the teammate's screen is not in it).

## 12. Phased plan

Dependencies: `feat/versus-lobby-health` (Health / Armor on Versus tables and the rail; Ranked Duos reuses its team
pool columns and display, not a parallel copy), `feat/hero-select-spectate` (hero select spectating + Duos teammate
hero options), `feat/friends-list` (the invite API for P3). None of their files are touched until they merge.

| Phase | Scope | Difficulty |
| --- | --- | --- |
| **P1 Server** | Migration: `ranked_duos` mode (8 seats: 2 live + 6 served, 4 teams), the end-turn gate columns + close rule (Q1 backstop), team pools on `versus_group_teams` (from the Health builder), `versus_duos_served` (pinned copy), `duo_runs` / `duo_run_rounds` + sample RPC, `duos_rank_profiles` / `duos_rank_results` / `settle_duos_rank` + season reset; leave = abandon settle. `versus-resolve`: `seat_ranked_duos` (section 5, TS selection bundled from sim) and `finalize_ranked_duos` (team pairing over `pairRunLobby`, two fights, ghost, damage, placement, duo-run write, settle). Parity cases for both. PGlite db tests: gate timings, idempotent seating, exact-round serving (holes, before start, past end), unrated, placement ties, rating table. | **Hard.** The gate and rating are medium; seating with the full lobby eligibility / band / cap rules on the server and the served-side prepare in the bundle are the risky parts. |
| **P2 Game loop (client)** | A Ranked Duos run mode (rated, no fuse, no local pause), the server clock + gate on the existing clock face and End Turn pill, the projection of 4 teams onto the lobby rail (team pools, served teams' boards for scouting), tag-team playback of our fight against served boards, passing (reused), disconnect / auto / catch-up, reload restore (passes, run checkpoint), board scoring sent with locks. | **Medium-hard.** Mostly reuse of the Versus Duos client; the rail projection over served seats and the overtime states are new. |
| **P3 UI** | Play > Ranked > Duos door, the duo party (Versus room in `ranked_duos`, invites through the friends-list API, open duo lobbies list, friends-only toggle), ranked confirmation, hero select reuse, end screen with team place 1-4 and the Duos rank animation, Leaderboard Duos tab, Career / Recent Games Duos tab, Live Games listing + Watch, patch note, GAME-RULES section, oracle rules. | **Medium.** All reuse; the party wiring to the invite API is the main new flow. |
| **P4 Live test + edges** | Claudebot pairs live (bots as teammates only in dev, unrated), the gate cases (both end, one ends early, 0:00 + 5 s, neither at 0, backstop), disconnect / return / leave settlement, a team out mid-round, two teams out together, the ghost round, served-board integrity checks against the pinned copy, season reset dry run, egress measured against the 1.5 MB budget, combat step-in perf on the prod build. | **Medium.** The Versus Duos phase 3 harness and test bots carry over. |
