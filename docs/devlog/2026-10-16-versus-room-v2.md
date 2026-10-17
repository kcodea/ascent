# Versus room v2: real-account records, spectator fan, new arena (2026-10-16)

Follow-up to #2130 (merged before these corrections landed).

- **Record rule** (owner: "4-25 is definitely not correct for my versus wins/losses"): `versus_records` counts a
  complete match only when BOTH seats are real accounts (a `profiles` row and an `auth.users` row with `is_anonymous`
  not true); abandoned / running matches never count. Security definer (it reads `auth.users`), at most 22 ids, returns
  only `{ userId, wins, losses }`. The client fallback count is gone: it could not see `auth.users` and showed the
  owner 4-25. Until the RPC is applied the badges print "-".
- **Bigger badges** (owner: "the attack badges should be larger"): the room card's badges `scale: 1.45` on
  `.vspcard-hold` only; the bench cards and every in-game card keep the global size.
- **Spectators as a hand** (owner: "spectators should show as cards in hand so you can mouse over to view their cards
  too"): `SpectatorFan` in VersusRoom.tsx; the fan math is CSS only (`--n`, `--off`, the step from the painting's
  width via `--gh`), the hover lift is one transform. Seats + spectators share one `versus_records` call.
- **New arena** (owner: "use versuspng2 for the background now"): `art/versus/arena.webp` rebuilt from
  `versuspng2.jpg` (2560x1086, same aspect, so the % geometry model holds). The old painting carried the frames,
  ribbons, bench and VS emblem; now: cards stand on the floor, HOST / Player N on Gem-plate pills with a blue / red
  edge, the VS mark is display-font text with a static glow (no separate VS art exists; owner may want art), a
  static gradient vignette keeps the header and stands readable. The open seat is the card dimmed with Take seat.
