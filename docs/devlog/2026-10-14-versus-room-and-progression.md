# 2026-10-14 — Versus: the painted room, Versus progression, no Oath plaque

Owner answers (2026-10-14), on feat/versus-phase0 (#2072):

- **The room on the painted arena.** `versuspng.jpg` (owner-named) ships as `packages/ui/src/art/versus/arena.webp`
  (2560x1086, 195 KB; `artMaxSize.test.ts` caps the `versus/` folder at 2560). `VersusRoom.tsx` keeps the painting's
  aspect at the stage's full height (the sides crop on 16:9) and lays the live UI onto the painted elements as % of
  the painting: each player's profile avatar inside their frame (blue P1, red P2), their name in the frame's banner,
  "Take seat" in an empty frame, the gate gem / state and hearts under each frame, spectator avatars in the eight
  bench slots (+N past eight), Start game under the VS emblem, and the room controls on a Gem plate (`.vsplate`, the
  same uiTheme tokens as the End Combat pill / hero-select buttons). No code-drawn props; a static image.
- **Versus progression** (owner: "versus can complete achievements and grant XP but no rank progress"):
  `supabase/migrations/2026-10-14-versus-progression.sql` widens `progression_results.mode` and replaces
  `settle_progression` with a `versus` branch sourced from the server-owned match row (`versus:<match id>`): 100 XP
  for a completed match with at least one fought round, +60 for the winner; achievements pass the `any` gate with
  the server-recorded hero, but placement-gated (Top 4 / 1st) and Ranked-only achievements never count a 1v1. Nothing
  reads or writes rank. TS mirror in `packages/progression` (rules, server validation, sqlParity), the generated
  Deno copies refreshed, `versusProgression.db.test.ts` runs it in PGlite. The client settles once per match at the
  end (`settleVersusProgression`).
- **No Oath / record plaque in Versus** (`HudBar.tsx`): the hearts HUD carries the round and score.
- **Rebased on main (R-SYMMETRY-01).** The mirror is main's symmetric one (no "still not mirrored" list). The
  rotating tie-break is now `CombatConfig.firstSide` (p1 always fights as `player`; `firstSide` is p1's on odd
  rounds, p2's on even ones) instead of swapping the boards.
- **Emotes over the match channel.** `versusEmotes.ts` installs a transport on main's `emoteTransport.ts` seam: your
  emote shows locally and goes out as `{ emoteId, seat: p1|p2, phase, offsetMs, round }` on the room channel's
  `emote` broadcast; the other seat's arrives under `versus-opponent`, which `emoteBubble.ts` anchors on the
  opponent's name in the Versus HUD. Uninstalled (loopback back) when the match ends or the room is left.
