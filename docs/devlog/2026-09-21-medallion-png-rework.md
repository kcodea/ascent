# 2026-09-21 — Card mechanic medallions: SVG glyph → authored PNG art

Owner ask (Mike): the card mechanic medallion (`.cgem`) was a monochrome CSS/SVG glyph; replace it with
authored full-colour PNG art wherever the *mechanic* icon shows, keep a fallback for mechanics without art yet,
and give it a dev tuner for size/placement. Design doc:
[`docs/superpowers/specs/2026-09-21-medallion-png-rework-design.md`](../superpowers/specs/2026-09-21-medallion-png-rework-design.md).

Shipped as five stacked commits/PRs:

- `0f303ed0` — 15 source PNGs (`C:\Users\micha\Desktop\Reference Art\Medallions\`) converted to webp at
  `apps/web/public/medallions/<mechanicId>.webp` (256×256, quality 85) — 11–22 KB each.
- `991be791` — `packages/ui/src/mechMedallion.ts`: the single source of truth for "which mechanics have PNG
  art" — `MECH_MEDALLION_PNGS` (a `ReadonlySet` of the 15 wired ids) and `mechMedallionSrc(mechanicId): string |
  null`, returning a `BASE_URL`-relative webp path for a wired id, `null` otherwise (so an unwired mechanic keeps
  its SVG).
- `6700e328` — content: added the `spend` mechanic and gave `rebirth` its own glyph.
- `3d0d1195` — wired the PNG into both mechanic-keyed render sites, hybrid-falling-back to the SVG `<Icon>`.
- `426780c6` — the 🎖️ Medallion dev tuner (size / placement / art inset).

## Why key by mechanic, not by glyph

`Icon` is called with a **glyph name**, and many glyph names are generic and reused far outside mechanics
(`sword`, `skull`, `shield`, `star`, `eye`, …) across Career, LobbyPanel, OpponentFrame, QuestCard, Recruit, and
more. Swapping art in by glyph name inside `Icon` itself would have clobbered all of those unrelated uses. The
mechanic icon only actually renders in two mechanic-keyed places, so the swap happens there instead, keyed by
mechanic id:

- **the card medallion** — `Card.tsx`'s `.cgem`, now via `resolveMech(view): Mechanic | null` (renamed from
  `resolveMechIcon`, which returned a bare glyph string — the caller needed the mechanic's `id` to key the PNG
  lookup, not just its `glyph`). No other caller needed the old glyph-string signature, so it was renamed in
  place rather than kept alongside a wrapper.
- **the compendium/glossary** — `MinionBook.tsx`, iterating `MECHANICS`: the glossary rows and the active
  filter chip. A small shared `glossIcon()` helper avoids repeating the PNG/SVG ternary at its three call sites
  (two glossary rows + the filter chip).

Both sites do the same hybrid check: `mechMedallionSrc(mech.id)` non-null → `<img className="cgem-img" …>`;
otherwise the existing `<Icon name={mech.glyph} />`. Generic `Icon` uses elsewhere are untouched — this is a
two-site, mechanic-keyed swap, not a global glyph replacement.

## Content: `spend` mechanic + `rebirth`'s own glyph

- **`spend`** is a new mechanic/keyword — "triggers on how much Gold you spend this turn" — detected via
  `hasOn('goldSpent')` off the existing dwarf gold-spender cards (Coinfire Forewoman, Tapkeeper, and others in
  `packages/content/src/cards/set2/dwarves.ts`) that already carried `on: 'goldSpent'` effects. No sim/content
  behavior changed; this only names and surfaces a trigger family that already existed, the same way Overflow
  was named as a keyword without changing its underlying behavior. Added to `mechanics.ts` (glyph `spend`,
  `order: 20`, alongside `pummel`) and to `keywordGlossary.ts` (Build & shop group, `detectRe: /\bspend\b/i`
  since the shipped card text uses lower-case "spend", not the capitalised term). `Icon.tsx` got a coin-glyph SVG
  fallback for mechanics without PNG art at all (defense in depth; `spend` does have PNG art, so the SVG is
  effectively a dead path today, but keeps the hybrid contract honest).
- **`rebirth`** previously borrowed the `rise` glyph as a placeholder (its own SVG never having been authored).
  Now it has its own glyph id (`rebirth`) wired to its own PNG art, and its own `Icon.tsx` SVG fallback for
  parity with the hybrid contract. `rise` is unchanged.

## The tuner

`packages/ui/src/medallionConfig.ts` mirrors the existing `equipSlotConfig.ts` pattern (get/set/reset/apply +
`applyMedallionVars()` at module load) with four dials — `size`, `dx`, `dy`, `artScale` — driving CSS custom
properties (`--cgem-size`, `--cgem-dx`/`--cgem-dy`, `--cgem-art-scale`) consumed by `.card.compact .cgem`'s
transform and the new `.cgem > .cgem-img` rule. `MedallionTuner.tsx` previews six medallions that all have PNG
art (shout/echo/rally/crit/spend/watcher), registered in `DevMenu.tsx` under the 🎖️ emblem (shared with the
`rankscreen` panel, a precedented pattern in `PANEL_EMBLEMS`).

## What's deliberately NOT covered

Per the spec's decision table: `pummel` and `equip` art is **held**, not staged in this PR.
- `pummel` is a live mechanic in code (shipped the same day in the unrelated `pummel-trigger` FX work,
  `docs/devlog/2026-09-21-pummel-trigger-fx.md`) — it already renders a medallion via its `fist` glyph — but its
  own PNG art is deferred per owner; it stays on the SVG fallback until that art is authored.
- `equip` is not a mechanic in code at all yet (Set 3), so there is nothing to wire.

Everything else without art (slaughter, bleed, overflow, taunt, ward, execute, immune, stealth, consume, fodder,
engraved, discover) also stays on its SVG glyph — the hybrid is designed so each mechanic upgrades independently
whenever its art lands, with no code change beyond adding its id to `MECH_MEDALLION_PNGS` and dropping the webp
in `apps/web/public/medallions/`.

## Verifying it

Per-task gates (typecheck/lint/vitest) are recorded in each task's own report under
`.superpowers/sdd/2026-09-21-medallion-png-rework/task-*-report.md`. This entry's own PR additionally ran the
full gate suite (`npm run typecheck && npm run lint && npm test && npm run build:web`) — see the Task 6 report
for the consolidated result. Visual/browser verification of the medallion art and tuner was explicitly left to
the owner (Mike eyeballs it in the running game), per the task instructions.
