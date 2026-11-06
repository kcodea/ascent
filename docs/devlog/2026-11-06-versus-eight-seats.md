# Versus rooms: eight players, four Duos teams

Owner ask 2026-11-06: "i want versus modes to be able to host up to 8 players in normal mode and up to 4 teams of 2 for the
duo modes." Rule: R-VERSUS-EIGHT-01.

## What changed

- **Group** seats 3 to 8. Three and four players keep the schedule they had. Five to eight use the circle method: an even
  count plays every pair once in n - 1 rounds; an odd count takes n rounds, and each round one player faces a Copy of the
  next living player. Knockouts restart the cycle on the new living set, avoiding an immediate rematch.
- **Duos** seats 2 to 4 full teams. A 2v2 keeps `resolveVersusDuosRound` byte for byte. Three or four teams use
  `resolveVersusDuosTable`: the Group schedule over teams, one tag-team fight per pairing, and at three teams left the odd
  team faces a Copy of another team. Teams out in the same round share the lower place, and never all of them go out.
- A team with one player cannot start (`need_full_teams`). A gap between teams closes up at the start, so a match's teams
  are always a, b, ...
- The room shows eight seats as two rows of four. Duos shows Team 1 to 4, two teams a row, and drops the VS mark.

## Judgement calls for the owner

- The odd team faces a Copy, as Group does, not a ghost as Ranked Duos does.
- The two-row room overrides the "one banner size in every mode" ruling (2026-11-02) for the eight-seat modes.

## Shipping order

1. Apply `supabase/migrations/2026-11-22-versus-eight-seats.sql` first. The old checks refuse seats past p4, and
   `settle_progression` dropped places past 4th.
2. Ship. `VERSUS_CF_PROTOCOL` is 3, so the new rules get their own Worker.

The classic room (`VersusRoom.tsx`, only reached with the party home off) still lays out four seats.
