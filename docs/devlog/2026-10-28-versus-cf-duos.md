# 2026-10-28 · Versus on Cloudflare: Versus Duos (2v2 tag-team)

Phase 3 of the Cloudflare move (design `docs/design/2026-10-28-versus-cloudflare.md`, section 13). The Group engine plays
Duos when the room's mode is `duos`: exactly four seats, seats 1-2 team a, 3-4 team b, one tag-team fight a round resolved
in the object by `handleVersusDuosFinalize` (the Edge Function's own handler; every round's digest equals versus-resolve's),
one shared pool per team (30 Health + both heroes' Armor, Mend raises the team), a team out together (both to the stands,
placed by teams still in; the winning team is 1st), a team out for missed rounds with the teammate out as `forfeit`.

Passing (R-DUOS-PASS-01) is four room ops (`duos_pass`, `duos_answer_pass`, `duos_hand_room`, `duos_passes`) with the
SQL's rules: the server cap of 10 a round, the full-hand refusal (`hand_room` minus passes still in flight), the teammate
away (auto or paused), exactly once per seq, a hand card only. A pass is pushed to the two teammates' sockets only (the
table's RLS rule). The fight order stays the clients' seeded 50/50 (`duos_first` is null, R-DUOS-ORDER-01).

Results: `supabase/migrations/2026-11-06-versus-cf-writer-duos.sql` makes the writer's `group_match` also store each seat's
team and the two `versus_group_teams` rows (XP's Duos placement reads them).

Tests: 9 fake-clock Duos tests (baseline with parity, duosFirstEmpty / duosSecondEmpty, team knockout, forfeit, four pass
tests, mendArmor, dropRestore, resolver failure), the writer's PGlite test for teams, and a 4-player workerd test (one
fight reaches all four; a pass reaches the teammate and not the opponents).
