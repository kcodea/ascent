# 2026-11-02 · Scene Builder: the ✕ closes the panel, minimize folds it to a bar

Owner report 2026-11-02: "scene builder's close button doesnt work. can you fix that? minimizing it actually closes it
out instead of minimizing it to a bar, fix that too". Branch `fix/scene-builder-close-minimize`. Rule
R-SB-PANEL-CLOSE-01 (approved/foundation.ts). DEV tool only, so no patch note.

## Root cause

- The panel's ✕ is injected by `useDraggablePanel` and calls `DevPanelContext.close`. The Scene Builder's outer shell
  mapped that to `setMinimized(true)`, which added a `.minimized` class (`display: none`) and showed an anvil square in
  the bottom-left dev row (`SceneBuilderDock`).
- The 2026-11-01 modernization (#2529) added `.sfxmix.scenebuilder.sb-modern:not(.collapsed) { display: flex }`. That
  selector is more specific than `.sfxmix.scenebuilder.minimized`, so the panel never hid. Reproduced headless: after the
  ✕ the panel's computed display stayed `flex` while the corner square appeared. The ✕ looked dead.
- So the "minimize" the owner met was the corner square path: the only state that hid the panel was a tiny square in
  the corner, which reads as closed, not as a bar.

## Fix

- The ✕ now CLOSES the panel: `useSbPanel` (a tiny store in `sceneBuilderPanel.ts`) holds `closed`, and the inner
  component drops the panel element while closed. Unmounting cannot be beaten by CSS. The inner component stays
  mounted, so the run, a Duos teammate HUD, the search and the folds all survive. Leaving the sandbox resets it to open.
- Reopen: a new dev menu action "Scene Builder" shows or hides the panel in a sandbox; on the title it starts one;
  anywhere else it does nothing (it never throws away a run in flight).
- Minimize: the existing whole-panel collapse IS the bar (header strip, title and both chips, draggable). Its control is
  now labelled "Minimize the Scene Builder panel to a bar" / "Restore the Scene Builder panel" (– / ▢), and the bar is
  wide enough that the chips read in full.
- Retired: `SceneBuilderDock`, the `.minimized` CSS rule, and the Scene Builder square in R-DEV-CORNER-01 /
  R-CORNER-SPLIT-01. The dev tuner square is unchanged.

## Judgement call

- "Close" keeps the sandbox run going (only the panel goes). Nothing in the existing design ended the run from the panel.
