# 2026-10-28 · Versus on Cloudflare: Ranked Duos

Phase 4, the last mode (design `docs/design/2026-10-28-versus-cloudflare.md`, section 13). `RankedEngine`
(`workers/versus/src/core/rankedMatch.ts`) extends the Group engine with the party's rules: no pause (an absent player
goes on auto at once and comes off it on return), the round closes when both live players ended their turn (else 30 s
after 0:00), leaving puts a player out of the party for good and both gone places the pair.

Supabase is still where the ladder lives, so the room talks to it twice, both through key-gated functions in
`supabase/migrations/2026-11-07-versus-cf-ranked.sql` called with the publishable key (never the service role):

- `versus_cf_ranked`: the pair's team identity (created once), name and division, and the recorded solo / duo runs the
  table is seated from. The room runs `handleRankedDuosSeat` (the Edge Function's own handler) over those samples the
  moment both heroes are known; a round that closes before the table is seated waits in resolving and the alarm retries.
- `versus_cf_persist` 'ranked_finish': ONE job at the end writes the match, seats, teams, served recordings, rounds and
  fights and the live boards per round, then settles the team rating (`settle_duos_rank`, deduped per team + match) and
  records the duo run (`versus_ranked_duos__record_run`). A repeat answers `frozen`.

Every round is resolved by `handleRankedDuosFinalize` over an in-memory port of `versus_ranked_duos_round_input`
(incl. `memberBoard`, the JS port of `versus_ranked_duos__member_board`).

The dev transport serves the Ranked store calls (`rankedTable`, `rankedTeams`, `rankedRounds`, `setFriendsOnly`; seating
and finalize are no-ops) and reads the Supabase-only rows (a ranked result, team names, the Duos leaderboard) through
the Supabase adapter. A friends-only party is not listed by the room directory (invites only), a deliberate
simplification of `versus__room_visible`.

Tests: 11 fake-clock Ranked tests (the party, the table, both-ready close, the 30 s overtime, determinism, absence = auto,
both leave → one finish job, played to the end, seat-later, hibernation, `memberBoard`), PGlite tests of both new
functions (team created once; the finish writes everything, settles the rating, records the duo run, and is frozen on a
repeat), and a workerd test of a whole party round.
