# 2026-10-06: The slid-away lobby rail can no longer be hovered in combat

Owner bug (2026-10-06, Round 6 combat screenshot with AmberLynx91's scout card open over the foe portrait):
"the lobby rail shouldnt be able to be moused over here".

Rule: **R-PRESENT-31** (foundation). Test: `packages/ui/src/lobbyRailStagedInert.test.tsx`.

## Root cause

- `.app.staged .lobbyrail` slides the rail off (`translateX(115%)`, `opacity: 0`) and sets `pointer-events: none`,
  but `pointer-events: none` on a parent does not stop a child that sets its own value, and `.lobbyrail > *
  { pointer-events: auto; }` does exactly that for the rail's children (`.lobbyhead`, `.lobbyseats`). The seats
  inherited `auto` and stayed hit-testable. The round header already had the matching `> *` override; the rail did not.
- Why the cursor could reach them at all: `.app` is a 16:9 box (`--gw` x `--gh`). On a window wider than 16:9 the
  stage has a visible right margin, and the slid-away rail lands there at opacity 0. Moving the cursor to the right
  edge during a fight entered an invisible seat, which measured itself and opened its `position: fixed` scout card
  just to its left, over the opponent portrait.
- Separately, the scout card is portaled to `<body>`, outside `.app`, so no `.app.staged` CSS can reach a card that
  was already open (hovered or pinned) when combat started.

## Fix

- CSS (`styles.css`): `.app.staged .lobbyrail *, .app.staged .lobbyrailhead * { pointer-events: none; }`. Pointer
  gating only: no layout change, no animation change.
- State (`LobbyPanel.tsx`): reads `combatStaged` (the same window that sets `.app.staged`). When it turns on, the
  hovered and pinned cards are cleared; while it is on, `openScout` / `pinScout` do nothing and no card renders.
  When the rail returns, the next hover opens a card as before.

## Other hidden HUD in combat

Audited every `.app.staged` / `.app.combat*` rule that hides an element. Only one shared the cause: the Gauntlet
foe (`.app.staged .gauntletfoe`, slid 520u right at opacity 0, pointer-inert anchor) has a rune row that sets
`pointer-events: auto`, so its rune tips could open from the margin in a Gauntlet fight. Fixed the same way
(`.app.staged .gauntletfoe * { pointer-events: none; }`). The `.combatout` fades are a 0.2 s exit transition on
elements that are not slid anywhere, so they are not affected.
