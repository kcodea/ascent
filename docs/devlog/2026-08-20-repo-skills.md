# 2026-08-20 — four repo skills carry the depth `CLAUDE.md` deliberately leaves out

Third and last PR from the agent-contract review (after the truth pass and the doc-policy split). A handoff
doc proposed eight skills; four shipped.

**Why four, not eight.** Two of the proposed skills (`ascent-performance`, `ascent-ui`) restated `CLAUDE.md`
sections almost verbatim — a second copy of a rule is a second thing to keep true, and the copy is the one
that goes stale. The remaining overlap was routing: several skills claimed the same triggers, which makes
selection ambiguous rather than helpful. The shipped set splits along seams that actually exist in the repo:

- **`ascent-gameplay`** — effects, keywords, hero powers, reducer/simulator paths, and **effect wiring**: one
  ability fired through another's trigger. Merged with the proposed separate wiring skill, because every
  wiring task is a gameplay task and splitting them just forced a routing decision.
- **`ascent-content`** — authoring cards / runes / quests / heroes, pool and set membership, art.
- **`ascent-lobby`** — the 8-seat lobby, pairing, placement, snapshots, and replay v2.
- **`ascent-choreography`** — beats, the Choreographer, Pixi FX, consequence timing.

**Every claim was verified against live code rather than copied.** The handoff's wiring skill pointed at
`packages/core/src/simulate.ts`, which does not exist — the real path is
`packages/core/src/combat/simulate.ts`. All referenced npm scripts (`beats:audit`, `text:audit`, `lobby`,
`lobby:snapshots`, `replay`, `fx:publish`, `art:wire`, …) and every referenced source path were confirmed
present before the text went in.

**The failure examples are real ones from this repo**, not invented illustrations — a rune paying out only on
a real death because forced Echo triggers bypassed the shared `asEcho` chokepoint; a shop-side Echo body
hand-copied from the combat body with a different membership rule so the minion skipped itself; a hero power
producing nothing for an off-set tribe because its pool filter hand-rolled the tribe check instead of using
the helper that knows about All-types cards. Three shapes of the same bug, which is exactly what a skill
should be able to pre-empt.

**Tracking.** `.gitignore` excluded all of `.claude/skills/`. A bare directory ignore makes git skip the
directory outright, so a negation for a subfolder can never match — the line is now `.claude/skills/*` plus
`!.claude/skills/ascent-*/`, which keeps installed skill packages ignored while our own skills are source.

Docs only — no runtime code touched.
