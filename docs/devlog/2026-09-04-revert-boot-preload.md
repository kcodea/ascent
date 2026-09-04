# Reverted: the boot preload (#1358)

**Owner decision 2026-09-04:** *"WE NEED TO UNDO THE PREWARM CHANGES WE MADE TODAY ENTIRELY."*

Playing the exe built from #1358, effects began disappearing mid-run ("around the rune turn" — no spell
targeting line, "so many animations"). The cause was not identified: the dev build's FX canvas was healthy after
boot (live, ticker running, not paused, effects spawning), the failure is later in a run, and it could not be
reproduced in a hidden browser pane. Rather than ship a bisect, the owner chose to revert the whole change.

This restores, exactly as before #1358: the fixed 3.5 s splash with its CSS-only bar, Google Fonts with
`display=swap`, the minions/heroes/powers-only art warm-up, lazy audio decode on first click, the FX canvas
mounted from the hero picker (and rebuilt per run), and no fire-everything pass. Removed with it: the public
asset manifest + its test, `bootLoader.ts`, `fontsPreload.ts`, `fx/warmAll.ts` + its guard test, the hitch log,
`?skipboot`, the CLAUDE.md / choreography-skill "nothing runs cold" rule, and performance.md §3e.

**Kept** (independent pop-in fixes, not prewarm): #1356 (the burst's absolute URL), #1359 (`decoding="sync"`
on every game `<img>`), #1362 (the burst as an `<img>`). The hero-select portrait line #1359 added to the
preload set went with the set it extended.

**If the preload is ever re-attempted:** the audit in `docs/devlog/2026-09-03-boot-preload-everything.md`
still stands (what was and wasn't warmed), and the open question is what the boot warm-up left behind that
killed effects later in a run — the prime suspects were the FX canvas living across the whole session instead
of being rebuilt per run, and the fire-everything pass's leftover state. Bisect with the pass disabled first.
