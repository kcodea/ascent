# 2026-10-31: corner split (Friends bottom left) and a larger teammate portrait

Owner ask (via the coordinator): "the bottom right buttons need to change. put the friends list back in the bottom left,
have the bottom right only show the compendium and settings. move the dev tool buttons to the bottom left, right of the
friends list. the teammate portrait needs to be updated and cleaned up/larger and better positioned so that it's easier
to see and access. you don't need to have teammate name or anything on the portrait since we know it's our teammate."

## What shipped (R-CORNER-SPLIT-01, R-DUOS-DOCK-FOOT-01)

- **Bottom right**: only the Compendium and the gear. The Rules "?" square is gone (the Compendium has a Rules tab, and
  `openRules` still exists for anything that opens the book on it). On the title, which has no gear, the book takes the
  corner.
- **Bottom left**: Friends, then the DEV squares. `friends/dock/bottomLeft.ts` measures the piece the row sits by on
  each screen change and resize (never per frame) and writes `--bl-l` / `--bl-b` / `--bl-cb` + `data-bl` on the root:
  sidebar pages and the in-game menu sit above the Settings plaque; the title above the footer links; a game in the
  corner left of the hero + Health plaque (gear size, gear baseline). Elsewhere the CSS fallback is the corner. Measuring
  replaced every per-framing offset rule (desktop / touch / phone zoom / phone layout).
- **Why the in-game corner and not right of the hero**: a full 10-card hand runs from the hero's right edge to the Gold
  coin, so a square right of the hero sat on the first hand card. In a game the dev squares stack UP the left edge from
  Friends for the same reason.
- **Teammate portrait**: `fitFoot` finds the largest disc (up to 0.8 of the hero) right of the hand's row (+44 px for
  the cards' frames), on the gear's baseline, clear of the rail's last tile, the coin, the rail tab, the book and the
  gear. The old `fitDock` measured `.lobbyrail`, which under the Docked rail is a full-screen layer, so it always fell to
  its 55% floor (that is why the portrait looked small); it remains the fallback. No "Teammate" cap, no name pill; the
  "Back to your board" cap (the way back while watching) and "Away" stay.

## Guides moved to the corner (R-GUIDES-CORNER-01, owner add mid-PR)

- "the guides button likely needs a new home entirely, like in the bottom right and have it expand upwards": a Guides
  square (Icon `book`, the glyph the rail tab and the Compendium's Guides tab already use) is stacked ABOVE the gear, not
  in the row, so the Compendium | Settings row and the teammate portrait's room stay as they were. Its panel
  (`.guidesdock`, in LobbyPanel) grows up out of it, rail-column wide, up to the round header; in Duos its foot is
  measured above the teammate portrait on open (`guidesFloor`). LobbyGuides now scrolls in a GameScroll.
- The rail tab is gone everywhere: its JSX, `.lobbyrailtab` CSS in every look and framing, the Docked layout's `tab`
  point and Tuner 2's three "Guides button" dials. Only the Versus 1v1 drawer still turns the rail to its Guides face
  (`railGuides`); that path is untouched (another builder is moving Versus onto the rail).

## Measured (headless, dev server)

1600x900: Friends 32 px in the corner left of the Health plaque; teammate disc 177 px (was 122) at x 1332-1509 with a
full hand ending at ~1330. Phone 915x412 (zoomed stage): teammate disc 165 layout px under the coin.

## Known

- Phone title: the menu column runs low, so in a DEV build the dev squares beside Friends overlap the Settings plaque's
  left end there (DEV only; production shows just Friends).
