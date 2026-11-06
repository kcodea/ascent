# Handoff: Versus with 8 players and 4 Duos teams

**Status:** parked by the owner on 2026-11-06 ("i dont wanna make this change yet actually"). PR
[#2606](https://github.com/kcodea/ascent/pull/2606) was closed without merging. Nothing went live, and the migration was never
applied. The whole build is on branch `feat/versus-8-seats`, off `330ce2edf`.

**Owner's ask:** "i want versus modes to be able to host up to 8 players in normal mode and up to 4 teams of 2 for the duo
modes."

## To bring it back

1. Rebase `feat/versus-8-seats` on `main`. Expect conflicts in `versusRemote.ts`, `lobbyChat.ts` and the generated rule files.
2. Check `VERSUS_CF_PROTOCOL`. The branch sets it to 3. Use the next free number if `main` has moved.
3. Rename the migration so it sorts after the newest one on `main`.
4. Re-read the live constraints (query below). A new check or function may have appeared.
5. Get the owner's call on the open questions below.
6. Run the checks, then do the untested items below.
7. Apply the migration **before** the new Worker ships.

If the branch is gone, the sections below are enough to rebuild it.

## Behaviour built

**Group: 3 to 8 players.** 3 and 4 players keep their exact schedule. 5 to 8 use a circle-method round robin
(`circleCycle` in `packages/sim/src/versus/group.ts`):

- An even count plays every pair once in n - 1 rounds.
- An odd count takes n rounds. Each round one player sits out the pairs and faces a Copy of the next living player, so everyone
  faces the Copy once and is copied once per cycle.
- A knockout restarts the cycle on the living set, at the first offset with no immediate rematch. That logic was already there.

**Duos: 2, 3 or 4 full teams.**

- A 2v2 stays on `resolveVersusDuosRound`, unchanged.
- 3 or 4 teams use `resolveVersusDuosTable` in `duos.ts`. Teams pair through `versusDuosTeamPairings`, which runs the Group
  schedule with each team standing in for one seat.
- Each pairing is one tag-team `simulate()` with its own seed (`versusDuosTableSeed`).
- At three teams left, the odd team faces a Copy of another team, which never takes damage.
- Teams out in one round share the lower place. They never all go out: the team with the most Health and Armor going in stays.
- A team with one player cannot start (`need_full_teams`).
- A gap closes up at the start: teams 1 and 3 become a and b (`createGroupMatch` in `roomCore.ts`), so a match's teams are
  always a, b, ...

**Room:** eight seats as two rows of four. Duos shows Team 1 to 4, two teams a row, with no VS mark. A phone keeps its sideways
scroller.

## Where the changes went

| Area | Files | Change |
| --- | --- | --- |
| Seat types | `group.ts`, `core/types.ts`, `workers/versus/src/pings.ts`, `groupMatch.ts` | Seats widened to p1..p8, teams to a..d |
| Limits | `options.ts` | Group `{3, 8}`, Duos `{4, 8}` |
| Finalize | `duosFinalize.ts` | Over 2 team rows takes the table path; `duosTableDigest`; commit accepts `p_fights` |
| Worker commit | `groupMatch.ts` `commitDuos` | One path for one or many fights; shared-place knockouts; the wipeout guard |
| Worker room | `roomCore.ts` | `gateKey` / `clearGates`, `p5_gate`..`p8_gate`, `duosTeamsFull`, the gap close-up |
| Team helpers | `lobbyChat.ts`, `pings.ts`, `liveListing.ts`, `friendsStore.ts`, `gameStatus.ts`, `duosPasses.ts` | No more p1-p4 or a/b assumptions |
| Client views | `versusGroupView.ts`, `groupLobbyView.ts`, `SpectatorBar.tsx`, `spectate.ts`, `duosDevTuner.ts` | See the trap below |
| Room UI | `versusPh.ts`, `versusRoomHome.tsx`, `PartyHome.tsx`, `partyModes.ts`, `partyHome.css`, `sampleRoomState.ts` | Eight seats, two rows, the half-team line |
| Labels | `versusOptionsUi.tsx` | "3-8 players", "Duos" |

Docs and rules on the branch: `R-VERSUS-EIGHT-01` in `foundation.ts`, `docs/GAME-RULES.md`, a patch note, and
`docs/devlog/2026-11-06-versus-eight-seats.md`. The patch note's date needs changing when this ships.

## Traps

- **`duosFirst` names fight SIDES, not teams.** `first.a` is side a's seat, whichever team that is. Anything reading
  `first[team]` or assuming a seat of team c is on side b is wrong. `duosActiveSeat` had this bug and the unit tests only caught
  it because `versusDuosTeamsView.test.ts` covers a team d viewer.
- **The rail must find a seat's OWN fight.** A copied team appears in two fights, so "the fight it appears in" is not enough.
  Use `team(a) === t || (team(b) === t && !copy)`.
- **`settle_progression` has `v_g_place between 1 and 4`.** XP silently drops any place past 4th.
- **The Supabase checks refuse seats past p4,** and `seat_count` stops at 4, so persistence fails if the Worker ships first.
  The migration widens every `versus_group_*` check found through `pg_constraint`, and patches `settle_progression` from its
  live definition. It has to tolerate a missing function, because the test database boots only the Versus files.
- **Banner CSS:** a later rule in `partyHome.css` (the fixed banner row) beats the earlier `.ph-cards.vs` sizing. The n8 rules
  must come after it.
- **`R-VERSUS-EIGHT-01` needs an `enforcement` entry,** or the rules ratchet test fails.

Check the live constraints with:

```sql
select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
where contype = 'c' and conrelid::regclass::text ~ '^(public\.)?versus_group' order by 1;
```

## Open questions for the owner

These were my calls, not rulings:

1. Should the odd team face a Copy (built, matches Group) or a ghost (matches Ranked Duos)?
2. Two rows of smaller banners break the 2026-11-02 "one banner size in every mode" ruling for these two modes. Is that OK?
3. Is it OK to drop the VS mark from Duos rooms?
4. Should Duos allow 3 teams at the start, or only 2 and 4?

## Untested when parked

- A real game with 5 or more live clients. The Worker core tests cover the rules, but no real clients did.
- The in-game rail and fight screen with 8 seats in a browser. Only the room layout was checked, on the sample room at 1600x900.
- The phone layout.
- Worker CPU with four fights a round.
- CI on the final commit: it was still running when the PR closed. Locally, the full suite had 2 failing tests and 1 failing
  suite; after the fixes those files and `packages/ui/src/versus` passed, but the whole suite was not repeated.

Other gaps:

- The bot tool stops at 3 bots (`versusRoomHome.tsx`, `VersusRoom.tsx`, `VersusBotsTuner.tsx`). A full test needs that raised.
- The classic room (`VersusRoom.tsx`, only reached with the party home off) still lays out four seats.
