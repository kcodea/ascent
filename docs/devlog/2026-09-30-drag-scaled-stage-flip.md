# 2026-09-30 — Drag gap below full screen: stageFlip is GSAP Flip again (R-PRESENT-27)

**Report.** Owner: dragging a minion onto the warband or reordering it is *"perfect in full screen, when not in full
screen its broken"*; the last build before the scaled stage (#1762) *"works perfectly"*. #1879 (fresh-read the end
transform) was tested and was still broken.

**Root cause.** Not the insertion index: pointer (`clientX`) and the cached slot rects are both screen px, so the index
is right at every scale (pinned in `stageFlip.test.ts`). The fault was `stageFlip.ts`. At `s === 1` the drag's
per-crossing `fromSimpleState(prev)` → `getSimpleState(row)` is GSAP Flip, and two Flip behaviours carry the feel:

- `Flip.getState` **finishes** any in-flight flip on its targets. RowFlip captures right after each `Flip.from`, so
  at full screen every crossing lands the row on React's `slideDir` slides at once.
- `Flip.from` ends by **restoring the element's own inline style** — React's `translateX(calc(...))` slide.

Below the design size a hand-rolled FLIP stood in and did neither. First it tweened to `x: 0` (the gap was wiped).
After #1879 it ended on the fresh transform, but its capture still recorded where each glide STARTED and left the glide
running. So every crossing replayed the whole row from its resting spots: right after each crossing all five cards were
back at rest (s = 0.75: `[420,570,720,870,1020]` against the wanted `[345,495,645,795,1095]`), and crossings closer
together than the 180 ms glide froze cards part-way (settled at `[394,544,795,923,1057]` against
`[345,495,795,945,1095]`).

**Fix.** `stageFlip.ts` runs GSAP Flip at every scale. The only scaled-stage difference, Flip's simple path adding a
screen-px box delta to layout-px `x`, is corrected by `rescaleSimpleState`. Just before `Flip.from` it moves each
recorded box to `now + (recorded − now) / s`. That is one rect read per card on the flush Flip measures anyway, and a
no-op at `s === 1`.

**Pin.** `stageFlip.test.ts` runs real gsap + Flip against a modelled row (box = `(natural + live translate) × s`).
It covers a hand-play gap walking left and a board reorder walking right, at 250 ms and 60 ms crossings, at
1920×1080 / 1440×810 / 1280×720, plus a FLIP-invariant settle. It fails on main and on #1879 and passes at s = 1 on
all three.
