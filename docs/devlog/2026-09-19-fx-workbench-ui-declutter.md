# FX workbench: declutter pass + def section moved into the top bar

Owner-driven strip-down of the FX workbench chrome (2026-09-19, one annotated screenshot per directive). No
engine or content change — this is authoring-tool surface only.

## What was removed
- The **COMPOSE → NAME → BIND → SHIP** pipeline status strip (`pipeRail`, both layouts). Its CSS band is
  reclaimed by setting `--fxwb-pipe-h: 0px`, so the top bar sits flush.
- The **top-left transport** (`transportCore`: ⏸ / 🔥 Fire / scrubber / time readout). The bottom Timeline
  already carries ▶ play-out + a scrubbable timeline; Fire (restart-from-0) was deleted, not relocated
  (owner: "just remove the fire"). Play/scrub still exist on the timeline surface.
- The per-layer **primitive tabs** (Beam…Targeting) and the **synthetic scenario buttons** (one-way / bounce /
  pinned / stationary). The scenario picker now shows only the two DOM-backed scenarios — **Stage setter** and
  **Real board**. A layer's primitive is still chosen when the layer is added, in the Layers panel.
- **＋ New effect** and **Watch in combat** buttons. (Removing the latter leaves `railMode` permanently false;
  the legacy rail layout + its effects are kept intact for now rather than excised in this pass.)
- The inspector's **Essentials** tier button; the inspector now defaults to the **All** section.
- The **START FROM** template list + **Paste def** (the whole `<DefLibrary>`). "Browse all" opens the full
  library instead.

## What moved / changed
- The **def section** (Copy def · name · Save) relocated from the bottom of the properties column **into the
  top bar** (`.fxwb-def-top`), so it's persistently reachable without scrolling. Its rare warnings/notes drop
  below the bar instead of stretching the top row.
- **Browse all** now opens as a big **centered window** over a dim scrim (`.fxlib-scrim`) instead of
  full-screen; click the scrim to close.

## Layout: full-height Editor + panel collapse
- The **Editor (props) column now spans the middle AND bottom grid rows**, so it runs full-height down the
  right side. The **Timeline is therefore cut off at the Editor's left edge** rather than spanning the full
  width (grid-template-areas: the `tl` row's third track is `props`).
- **Both side panels collapse** to a thin strip, the same gesture as the Timeline's toggle — **Layers** on the
  left, **Editor** on the right. Collapsing narrows the grid column (overrides `--fxwb-layers-w` /
  `--fxwb-props-w` to 42px on `.fxwb-grid`) and hides the panel body; the freed space goes to the stage and,
  when the Editor is collapsed, the Timeline widens to fill it. State: `layersOpen` / `editorOpen`.

Files: `packages/ui/src/fx/ui/Workbench.tsx`, `Inspector.tsx`, `LibraryBrowser.tsx`,
`packages/ui/src/styles.css`. Dev-authoring tool → no patch note.
