# Results show the hero power with its Ancient (2026-11-18)

Owner ask: "we need results to now show the hero power w/ the ancient selected as well so players can see what ancient was
selected".

- The party-home game detail (Recent Games, Career Match History, Practice) shows the shown board's hero power ahead of
  its runes: the in-game power art (`.heropowerbtn`) cracked with the picked Ancient (`AncientSplitStatic`, the settled
  split face, now shared with the live `AncientSplit` through one `SplitFace`), the power name and the Ancient name. Hover
  or focus opens the hero-power tip with the base text and the Ancient's pairing text (`FoeAncientLine`).
- Picking a lobby seat shows that seat's power + Ancient. Lobby tiles get a small Ancient badge on the portrait.
- NO DATA CHANGE. `MatchSeat.ancient` (every seat, R-ANCIENTS-RELEASE-04) and `BoardSnapshot.ancient` on the stored final
  board already carry it since 2026-11-16. Games before that show the plain power. No SQL.
- Rule: R-RESULTS-ANCIENT-01. Component: `packages/ui/src/matchDetails/SeatPower.tsx`.
