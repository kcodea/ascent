# 2026-11-27: G opens the Guides; the Guides overlay is the quick Compendium, always in full

Owner ask: "add "g" as a keybind to open guides. Make the guides overlay look like the new in game compendium overlay".

- **"Guides"** = the in-game build guides panel (`LobbyPanel.tsx` `.guidesdock`, list = `guides/LobbyGuides.tsx`), opened
  by the bottom-right Guides square (R-GUIDES-CORNER-01). Not the Compendium's Guides tab.
- **G** (R-GUIDES-KEY-01): a new `guides` action in the keybind registry (`keybinds.ts`, In a game, default `g`), so it
  shows on the Settings Keybindings tab and is rebindable. Handler: `guides/guidesHotkey.ts` `onGuidesKey(e, toggle)`,
  installed by `LobbyPanel` only while the square is on screen (not Tutorial, not staged combat). Stands down while
  typing (`typingTarget` from `compendiumHotkey.ts`), on modifiers, on key repeat, during a key capture and on Hero
  Select. It closes the Compendium / Settings before opening (one overlay at a time), and the Compendium opening closes
  the guides.
- **Look** (R-GUIDES-QUICKLOOK-01), two passes the same day. First the old corner panel was dressed in the quick
  Compendium's classes. Then the owner asked for an overhaul: "make it the "full/detailed" look and information as well,
  taking up more space". So `guides/GuidesBook.tsx` (+ `guidesBook.css`) replaced the panel: the quick book's shell
  (`.qb`, `.qb-dim`, `.qb-place`, `.qb-panel`, `.qb-head` / `.qb-title` / `.qb-count`, `.qb-x`, `.qb-line`,
  `.qb-scroll.book`, `.qb-grid`), the guides down the right edge where its parchments hang (the list keeps the
  `.lobbyguide` / `.lobbyguide-head` / `.lobbyguides-sec` classes and `GuideEmblem` / `GuideTribes`), and the page is the
  picked guide in full: title in light with its tribes, tribe-coloured line / tint / wash, tagline, `GuideText`, then
  Core and Enablers as `BookCardCell` (the Compendium's own full card cells, lazy, inspect on press). The page is
  `--qb-w - 478 phu` wide (the quick book's left edge, moved over for a 330 phu list).
- **Simple / Detailed is gone from the overlay** (no Detailed button, no fold-back-on-outside-press listener). The mode
  state and `ascent.guidesMode` key are still read by the dead Versus 1v1 rail path in `LobbyPanel` (`versusDuelView`
  is `false`), which still renders `LobbyGuides`; left alone for scope, candidate for removal.
- **Portaled to the stage host**, like the quick book lives outside `.app`: inside `.app` the HUD layers (hero portrait,
  corner buttons) drew over the dim. Tests that read the panel now query `document.body`.
- Dropped: the Duos "foot above the teammate portrait" measurement (`guidesFloor`), since the overlay is full height
  and dims everything like the quick book.
- Judgement call: a press outside now closes the guides (the quick book's rule). Before, the panel stayed open while
  the player kept shopping.
