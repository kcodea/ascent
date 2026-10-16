# 2026-10-16 — Big stat badges fit on every card (R-BADGE-FIT-01)

**Owner report:** "the badges got messed up for some reason when they go into the 1000's, please fix" (screenshot: a
Recent Games final-board strip, a 104k / 209k minion whose badges glowed blue, overflowed and overlapped).

**Root cause.** Two fixed sizes met a small card:
- The badge number is a fixed font sized for three glyphs. `1000`, `10000`, `104k` ran wider than the badge disc.
- The milestone frame art (the intentional value tiers from #1511 / #1514: silver ≥0, dagger ≥50, gold ≥150,
  pink ≥500, blue ≥2000, crystal ≥5000, with a static glow from pink up) was fixed px (`60px * --msf-scale`, number
  `--msnum-size`) tuned at the board card. The Career / Recent Games / Match details tiles are ~58% of a board card,
  so a board-sized frame + glow + 26px number sat on a tile-sized card. The 3-digit low tiers got away with it; the
  wide crystal art, the glow and a 4-glyph number did not.

**Fix (milestone tiers kept).**
- `statFit(text)` (formatStat.ts) → `data-fit` on `.value`; CSS maps 4/5/6/7+ glyphs to `--sv-fit` 0.72/0.58/0.52/0.46.
- `--ccw-board` is frozen at `:root` (the board card's compact width); `.badge { --ms-k: --ccw / --ccw-board }` and
  every milestone px (frame, glow width + blur, tint, number size + nudge) multiplies by it. Exactly 1 on the
  Shop / board / combat cards, so nothing changes there; the hand, Discover, hover preview and the menu tiles now
  scale the frame with the card.

Static paint only, no new per-frame work. Test: `packages/ui/src/bigStatBadge.test.tsx`.
