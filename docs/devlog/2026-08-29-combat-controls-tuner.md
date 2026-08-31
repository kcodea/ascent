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

**Position (added).** Each chip also got X/Y offset controls: Summary + Skip offset their `left`/`top` `× --scale`
off the stage box (board-pinned — their stage-fraction position is `scale/gw`, constant for the fixed 16:9 stage,
so they hold their spot at any window size/aspect); the End Combat pill nudges via an individual `translate:` so
it composes with the tip's own transform/animation and rides the (already board-pinned) End-Turn diamond.

**Owner-locked look (2026-08-29).** Baked the tuned values into `combatCtlConfig.ts` DEFAULTS + every styles.css
`--cc-*` fallback: the Summary + Skip chips go blue (`#006fd6`) with a 1px `#b07047` outline, `#f2f2f2` text,
30px radius, repositioned (Summary +89/+57, Skip −95/+49); the End Combat pill goes deep navy (`#002242`), 10px
radius, 12px text. This is now a player-facing look change (patch note added). Verified: typecheck ✅, build:web ✅.
