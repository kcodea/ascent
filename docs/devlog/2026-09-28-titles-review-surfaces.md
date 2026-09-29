# 2026-09-28 — Titles recorded with the run; shown on the Leaderboard and the Hall (never in game)

Owner ask (2026-09-28): "where are titles shown in game? it'd be cool to show them where possible. maybe even when
the player is the opponent in combat, it could show the title + the titles colors if it has colors etc as a way of
showing off their flair?"

The first cut put a `TitleBadge` on the lobby rail, over the combat foe's name plate and on the Now Facing splash.
The owner reviewed it on 5174 the same day: "for titles - it's too much on the lobby rail and looks out of place
other places too. i think it should show in like leaderboard/match details views, but it looks bad in game". Every
in-game surface was removed; the plumbing stayed. Rule: R-PROG-TITLE-02.

## What shipped

- **The title rides the run's cosmetic snapshot.** `RunCosmeticSnapshot.title` (additive). `recordRunCosmetics`
  (store) folds `profiles.equipped_title_id` into the loadout (`withEquippedTitle`) and `snapshotForRun` records it
  only when `titleOf` says it is live. It is account-wide like the hero attack: `scopeCosmetics` keeps it on every
  captured board, `runCosmetics` unions it into snapshot seats, replay frames carry it. Old snapshots have none.
- **`titleOf`** is the single display gate: unknown, retired (TS or the server kill switch) or non-title ids show
  nothing. `parseCosmeticSnapshot` keeps unknown ids (a newer client's title survives a pass-through).
- **`TitleBadge`** (`packages/ui/src/titles/`): memoised, em-sized, rarity colour via the shared `.r-*` tokens.
  `titleStyle.ts` has an empty `TITLE_STYLES` table keyed by title id for the designed-but-unbuilt hero-mastery
  titles: a `gradient` paints into the text, `effect: 'shimmer'` is a transform-only sweep (off under reduced
  motion). No native tooltip, no own cursor, no pointer events.
- **Leaderboard** (`Rankings.tsx`): `equipped_title_id` rides the existing ranked `profiles` select (no extra query;
  a backend without the column falls back to the old select).
- **Hall of Champions** (`Leaderboard.tsx`): the title recorded on the row's board (`board.cosmetics.title`), zero
  queries.
- **Toggle.** Other players' titles follow "Show opponent cosmetics" (titles were framed as flair, so they are
  cosmetics). Your own Leaderboard row always shows yours. A Hall row carries no account id, so every Hall title is
  gated by the switch.

## Match details (PR #1806, not merged at the time of writing)

Wire each player row with the same helpers: for seat 0 use the run's recorded snapshot (`run.cosmetics`, or
`useRunSkins()`), for any other seat `opponentSkins(showOpponentSkins, seatCosmetics(seat, board))`, and render
`<TitleBadge snapshot={…} />` beside the name. The replay/end-screen lobby already carries each seat's recorded
`cosmetics`, so no new data is needed.

## Not done, on purpose

- No title in any live-run or replay gameplay surface (owner review).
- No titles for bots, hybrid or authored seats (they have no cosmetics).
