# 2026-11-27: G opens the Guides; the Guides overlay wears the quick Compendium look

Owner ask: "add "g" as a keybind to open guides. Make the guides overlay look like the new in game compendium overlay".

- **"Guides"** = the in-game build guides panel (`LobbyPanel.tsx` `.guidesdock`, list = `guides/LobbyGuides.tsx`), opened
  by the bottom-right Guides square (R-GUIDES-CORNER-01). Not the Compendium's Guides tab.
- **G** (R-GUIDES-KEY-01): a new `guides` action in the keybind registry (`keybinds.ts`, In a game, default `g`), so it
  shows on the Settings Keybindings tab and is rebindable. Handler: `guides/guidesHotkey.ts` `onGuidesKey(e, toggle)`,
  installed by `LobbyPanel` only while the square is on screen (not Tutorial, not staged combat). Stands down while
  typing (`typingTarget` from `compendiumHotkey.ts`), on modifiers, on key repeat, during a key capture and on Hero
  Select. It closes the Compendium / Settings before opening (one overlay at a time), and the Compendium opening closes
  the guides.
- **Look** (R-GUIDES-QUICKLOOK-01): the overlay is built from the quick Compendium's own classes (`quickBook.css`:
  `.qb`, `.qb-dim`, `.qb-place` / `.qb-pic` / `.qb-tint` / `.qb-wash`, `.qb-panel`, `.qb-head`, `.qb-title`, `.qb-count`,
  `.qb-x`, `.qb-line`), not copied CSS. `LobbyPanel` imports `quickBook.css` (it used to load only with the lazy
  QuickBook chunk). `lobbyGuides.css` keeps only the differences: a narrower page (660 phu, 980 in Detailed), no
  parchment rail so it sits nearer the edge, and a 190 ms opacity fade on close (the quick book's own fade length).
- **Portaled to the stage host**, like the quick book lives outside `.app`: inside `.app` the HUD layers (hero portrait,
  corner buttons) drew over the dim. Tests that read the panel now query `document.body`.
- Dropped: the Duos "foot above the teammate portrait" measurement (`guidesFloor`), since the overlay is full height
  and dims everything like the quick book.
- Judgement call: a press outside now closes the guides (the quick book's rule). Before, the panel stayed open while
  the player kept shopping.
