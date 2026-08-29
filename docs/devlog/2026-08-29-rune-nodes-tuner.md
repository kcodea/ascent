# 2026-08-29 — Dev tuner: "Rune Sheen" → "Rune Nodes", now with the node geometry too

Owner ask: the round quest/rune node buttons (the badge row above the hero panel) were adjustable only in
**Layout Lab → Quest nodes** for position/size and in the **Rune Sheen** panel for the glossy overlay — two
places for one cluster. Fold the node geometry into the sheen panel and rename it.

**What changed (`RuneSheenTuner.tsx`, dev-only):**
- Renamed the panel to **Rune Nodes** (title + DevMenu label/hint). The `id` stays `runesheen` — FROZEN, since
  `useDraggablePanel(id)` persists the panel's dragged position under it; changing it would reset where it opens.
- The panel now bridges TWO config stores in one `TunerSpec`: the node geometry (`layoutConfig`'s `Quest nodes`
  keys — `qbS/qbX/qbY/qbGap` + per-node `qb1X…qb3Y`) and the sheen discs (`runeSheenConfig`). `read` merges both;
  `write` routes each key to its owning setter (`setLayoutValue` for the `qb*` keys, `setRuneSheenValue` for the
  rest); `reset` resets the sheen and only the node keys (never all of Layout Lab). Controls render node geometry
  first (Node row + Per-node offset), then the sheen (Sheen 1/2/3 + Chains).

The same node knobs still live in **Layout Lab → Quest nodes** — both panels write the identical `--qb-*` state
via `setLayoutValue`, so they stay in lock-step; nothing was removed from Layout Lab.

No production impact: the whole Dev Tuning Menu is dev-only. Verified: typecheck ✅, lint 0 errors ✅, build:web ✅.
