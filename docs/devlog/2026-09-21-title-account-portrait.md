# 2026-09-21 — Title account corner: portrait ring + name plate + rank badge; Sign in/out into Settings

Owner ask (2026-09-21): drop the "Account ✓" / "Sign in" chip from the title's top-right, move Sign out (and
Sign in) into the Settings menu at the bottom, and put the player's portrait there LARGE with the name
eclipsing the ring's bottom edge "like it does in game" and the current rank in a badge below — plus a dev
tuner for the size/position of each piece.

## What changed (UI only — `packages/ui`)

- **`Title.tsx`** — the `.titleaccount` corner is now: a `.titleportrait` button wrapping the game's gold
  `.portring` (hero-select/heroportrait.png — the same ring the Career page and rank screen wear) with the
  avatar disc seated in its hole (click → avatar picker; initial-letter gold disc when no avatar is set); a
  `.titlename-seat` at the ring's bottom edge carrying the `.titlename` plate (the in-game `.heroname` white→
  cream / gold-border / 999px pill, `translate(-50%, 52%)` so it straddles the edge; click-to-rename with the
  same `.acctinput` Enter/Escape/blur flow, now styled `.titlename-input` as the same pill); and a `.titlerank`
  badge (`RankCrest size="mini" hideDivision` + uppercase `rankLabel`) below the name when the profile carries
  a rank. The `.acctsignin` button and the `title=` attributes on the corner are gone; tooltips are `data-tip`
  on the wrapping buttons (never on `.portring` — its `::after` IS the ring), the portrait's opening to the left
  so it clears the plate + badge. The first-time nudge is a real `.titlename-nudge` element (the tooltip owns the
  button's pseudos) — static shadow, opacity-only pulse.
- **`EscMenu.tsx`** — a new ACCOUNT section at the bottom of Settings: signed in → a "Sign out" row with
  "Signed in as <email>" (calls `signOutAccount`, exactly as the AccountPanel does); anonymous on the title →
  a "Sign in" row that closes the modal and opens the AccountPanel; anonymous in-game → a note pointing at the
  main menu (the AccountPanel only ever renders over the Title). AccountPanel itself is unchanged.
- **`titleAccountConfig.ts` + `TitleAccountTuner.tsx`** — the 👤 **Title Account** DEV tuner (Shape B, like
  Title Veil): ring size + corner x/y, name plate scale + x/y, rank badge scale + x/y. Writes `--ta-ring`,
  `--ta-ring-t`, `--ta-name-t`, `--ta-rank-t` inline on `:root`; the styles.css fallbacks mirror DEFAULTS
  (`ring 190, ringX 0, ringY 0, nameScale 1, nameX 0, nameY -12, rankScale 1, rankX 0, rankY 22`); localStorage
  `ascent.titleaccount`, dev-only. Registered in DevMenu (Stage & Layout, beside Title Logo / Title Veil),
  `tunerAll.ts` (Reset all) and `PANEL_EMBLEMS`.
- **`styles.css`** — the `.titleavatar` / `.acctname` / `.acctsignin` rules are removed; `.acctinput` keeps its
  base (the AccountPanel's inputs share it). New `.titleaccount` block with the `--ta-*` fallbacks.
- Patch note prepended (2026-09-21, UI / Info).

## Verified

`npm run typecheck && npm run lint && npm test && npm run build:web`; visual pass on a background vite
(1920×1080): anonymous title corner, the Settings Account row, the tuner driving the vars live.
