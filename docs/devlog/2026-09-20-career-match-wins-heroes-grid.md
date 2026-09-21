# 2026-09-20 — Career: a match win is by placement; Heroes tab → portrait grid

Owner changes on the day-old Career page (#1582), with a screenshot of the Heroes row. All in
`packages/ui/src/` — `careerData.ts` (pure), `Career.tsx`, the `cv2-` block in `styles.css`, tests.

## The match win (owner ruling)

A MATCH W/L is by **placement — top 4 = W, 5th–8th = L**. Fights (the per-round combat W–L the entry
carries) are no longer the unit anywhere on the page. `isMatchWin(placement)` in `careerData.ts` is the one
definition; a run with no placement is neither. Applied to:

- **Match History banner** — the fight `9 W – 4 L` under the hero name is replaced by a WIN / LOSS pill
  (`.cv2-row-result`, green / red, `—` with no placement). The fight record survives only as a small muted
  caption beneath it (`Fights 9–4`, shown only when the run recorded any) — owner said placement-first, the
  fight record allowed as a secondary caption if it doesn't clutter.
- **Heroes tab** — `HeroCareer.wins/losses/winRate` are now the match record (top-4 vs bottom-4) and the
  sort's tiebreak is that win rate.
- **Trends** — "Fight Win Rate" is renamed **Win Rate**; its headline is the window's overall match win rate
  (share of placed runs finishing top 4, whole percent). Each point is the RUNNING win rate through the
  window (oldest first), so the line shows how the share moved and ends on the headline number — a per-run
  0/100 series would only zig-zag. Unplaced runs contribute no point.
- **Avg Placement + Avg APM get the same smoothing** (owner follow-up, same day: the placement line was a
  1↔8 saw-tooth). Every trend point is now the running mean through the window up to that run — it starts
  at the first run's own value and converges on the headline, which stays the window's exact mean
  (`runningSeries` in `careerData.ts`; the y-axis stays 1 at the top → 8 at the bottom for placement).

## Heroes tab → a portrait grid

No more per-hero rows. `.cv2-herogrid` (`repeat(auto-fill, minmax(180px, 1fr))`) fills the centre column with
one `.cv2-hcard` per hero played: the game's circular hero frame (the same `.cv2-heroframe` markup, 120 px),
the name, and "N games played" (never "runs"). Sorted by games played desc, then win rate.

**The hover panel** (`.cv2-herotip`, portalled to `<body>`, `position: fixed`, `role="tooltip"`, never a native
`title`): shown after the same 160 ms hover delay the rune panel uses, and **at once on keyboard focus** (the
tile is `tabIndex=0`, `aria-describedby` → the panel's id); hidden on leave / blur. Seated **beside the
portrait**: to the tile's right (12 px gap), flipped to its left when it would leave the viewport, vertically
centred on the tile and clamped 8 px inside the viewport (one `getBoundingClientRect` per show). Contents:
the hero name; **Record** `W – L` (match) + **win rate %**; **Avg Placement**; then 1st Place Wins, Best
Placement (coloured like the verdicts) and Last Played as secondary lines.

Empty state: the designed panel now reads "No games played yet".

## Left alone

The 25-run Match History, rune emblems + hover text, Watch Replay, the level three columns, tab persistence,
and the Seasonal Ranked card (another agent owns it this session).
