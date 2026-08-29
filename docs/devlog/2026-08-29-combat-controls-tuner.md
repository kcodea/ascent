# 2026-08-29 — Dev tuner: Combat Controls (Summary pill / End Combat pill / Skip button look)

Owner ask: dial the **shape, colours, outline and text size** of the three combat-control chips.

New dev-only tuner **🎚️ Combat Controls** (`CombatCtlTuner.tsx` + `combatCtlConfig.ts`), in the Dev Tuning Menu's
**Buttons** group. Schema-driven like the others (live to CSS vars, copy-to-bake). Per element — **Summary pill**
(`.combatsummary`), **End Combat pill** (`.etbwrap.ready .etb-tip`), **Skip button** (`.combathud-skip`) — six
controls: text size, corner radius, border width, and background / text / outline colours.

Notes:
- Each look property is wired to a `--cc-*` CSS var with a fallback equal to the shipped value, so production
  (no tuner) is unchanged and applying DEFAULTS is a visual no-op.
- The two dark-glass pills keep their layered look: the background control drives a subtle top→darker **gradient**
  rather than a flat fill.
- **End Combat pill** is the End-Turn button's tooltip in its combat-done (`.ready`) state — the SAME element that
  reads "End your turn" in recruit — so its rule is scoped to `.ready`, leaving the recruit End-Turn tip alone.
- Skip is authored in `--u` (scales with the board), so its size/radius knobs are `× --u` multipliers, not px;
  the two pills are raw px.

Verified: typecheck ✅, lint 0 errors ✅, build:web ✅. Dev-only; no production/player-facing change.
