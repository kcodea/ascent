# 2026-08-29 — Foe hero power: pin it to the board like everything else (× --scale)

Owner report: the combat foe hero-power icon (`.heropowerbtn.opp-power`, added earlier today) looked right at
fullscreen but **skewed off the board at any other stage size** — "NOT pinned the same way every other element
is pinned."

**Cause.** Every pinned element multiplies its px offset by `--scale` (the master stage scale, stage-height ÷
1440) so it shrinks/moves *with* the board — e.g. `+ var(--hpb-x, 15px) * var(--scale)`. The foe power was the
lone exception: its `--hd-power-x/y` offsets were applied as **raw px** (`-309px` / `153px`, no `× --scale`), so
on a non-fullscreen (smaller-`--scale`) stage the base anchor scaled while the offset stayed a fixed pixel count
→ the icon drifted off its board spot.

**Fix.** Multiply `--hd-power-x` and `--hd-power-y` by `var(--scale)` in both the icon and its hover tooltip
(`.opp-power` + `.opp-power-tip`), matching every other pinned element. That changes the values' meaning from
raw px to reference px, so the owner-tuned fullscreen look (`-309 / 153` measured at `--scale` 0.5109375)
converts to reference-px defaults: **powerX -309 → -605, powerY 153 → 299** (`raw / 0.5109375`). At the owner's
fullscreen these reproduce the same pixel position (±0.2px); at every other stage size the icon now scales with
the board. `powerScale`/`powerAlpha` are a transform-multiplier and opacity — scale-invariant, unchanged; the
icon's *size* was already correct (its `128 * var(--u)` box scales via `--u`).

Files: `packages/ui/src/styles.css` (the two `.opp-power*` rules), `packages/ui/src/heroDuelConfig.ts`
(DEFAULTS). Dev tuner (⚔️ Hero Duel) unchanged; a saved localStorage value now means reference px, so a stale
raw value there needs a Reset to pick up the new defaults. Verified: typecheck ✅, build:web ✅.
