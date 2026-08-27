### feat(ui): combat board variant + wipe transition (the Aug-25 board pair)

Combat now plays on its own backdrop: `augustboardcombat.webp`, the owner's Aug-25 board master with
the top-right tray removed. Its shop twin (`augustboard psd.png`) replaced `augustfullboard.webp` in
the same PR, so the two phases use pixel-matched art.

**The non-obvious part — framing.** The Aug-25 masters (8192×3542) are the same design as the live
board but rendered at a tighter crop, and the entire UI (buttons, zones, charge glyph) is tuned
against the live board's frame position. `packages/tools/src/board-export.ts` (`npm run board:export`)
maps both masters onto that framing with a fixed registered transform — uniform scale 0.469, no
horizontal shift, +260 px vertical placement on the 3840×2143 canvas, found by mean-abs-diff grid
search against the shipped webp and verified with a 50/50 pixel blend (single crisp frame, no double
edges). The masters' missing vertical surround is filled by edge-row replication, which the board's
1.25× overscan keeps essentially off-screen. Re-running the export needs no re-derivation unless a
master is re-exported at a different crop (the script hard-fails on unexpected master dimensions).

**The wipe.** A second `.boardbg` layer (`.boardbg--combat`) re-points `--board` at the combat art, so
the two layers share one background stack and can't drift. Combat entry adds `.wiped` — a one-shot
`clip-path: inset()` transition (550 ms) reveals the layer left→right under a compositor-only glow
front (`.wipefront`); exit removes the class and the same transition plays right→left. A run resumed
mid-combat initialises the wipe state to 'combat', so the layer mounts already-wiped with no
transition. Skip-combat stays in the combat phase, so no wipe plays until the real exit.

**FX hook.** The wipe fires `playDef('board-wipe', …)` along the front's path (direction follows the
sweep). The committed def is a deliberate STARTER (a thin blue streak) — the owner restyles it in the
FX workbench; the direct-call registry + its enforcing test carry the new id.

Preload housekeeping: `art.ts`'s `PUBLIC_ART_URLS` still listed `ascentboardnostuff.webp` as "the
primary board" (stale since the August board shipped); it now preloads `augustfullboard.webp` +
`augustboardcombat.webp` instead.
