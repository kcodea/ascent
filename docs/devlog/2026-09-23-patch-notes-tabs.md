# 2026-09-23 — Patch Notes: Game tab + Systems tab

Owner ask (verbatim): "for patch notes, i want tabs that carry game related balance/cards/heroes etc and then
a systems tab that carries dev updates and systems changes."

## What changed

- `packages/ui/src/PatchNotesOverlay.tsx` renders TWO TABS under the title: **Game** (every change tagged
  `Balance`) and **Systems** (every change tagged `Systems`). Each tab lists the same dated entries but only
  that category's changes; an entry with none is hidden on that tab. The per-change category chip is gone
  (the tab already says it); the date + label header stays. Default tab: Game. The last tab is remembered in
  `localStorage['ascent.patchnotes.tab']` (try/catch both ways; a garbage value falls back to Game).
- The Summary / Detailed toggle sits on the same bar as the tabs and is independent of the tab.
- Keyboard: `role="tablist"` / `role="tab"` with `aria-selected`, roving `tabIndex`, Left/Right/Home/End;
  the scroll region is the `role="tabpanel"` labelled by the selected tab. No `title=` attributes; no bare
  `cursor: pointer` (the global `button` rule paints the gauntlet on the tabs, toggle and close).
- `notesForTab()` and `PATCH_TAB_LABEL` are exported so the render test asserts against the viewer's own
  projection. `PATCH_CATEGORY_ORDER` is now the tab order (its old `.pntag-*` hue comment was stale).
- CSS: `.pnbar` / `.pntabs` / `.pntab` in the patch-notes block of `styles.css`; the `.pngroup` grid and
  `.pntag*` chip rules are deleted (no longer rendered).

## Re-tag

- 2026-09-23 "Runeforge" entry: "Guardian plus Rune of the Epic Forge now opens two Epic forges on turn 8"
  moved `Systems` → `Balance` (it is a rune / hero behaviour change; owner rule 2026-09-21: Balance =
  gameplay, Systems = dev / UI / information).

## Test

`packages/ui/src/PatchNotesOverlay.test.tsx` (jsdom): default tab is Game; the Game tab lists only Balance
changes and exactly the entries that have one; the Systems tab is the converse; no `.pntag` chip; the
stored tab is written on click and honoured on the next open; garbage storage falls back to Game; Detailed
works on either tab and survives a switch; arrow keys move the selection and the tabpanel follows; no
`title=` in the viewer. The existing no-em-dash tripwire still covers the patch-note strings.
