# 2026-11-15 — Minion art drawn 5% larger in the oval frame

Owner report (Mike): "the card art in the game is slightly too small. i can see the flat bottom edge of every card
in its minion frame. can we expand the art size itself by 5% across the board for minions?"

**Cause.** A minion's illustration is a 512x512 square shown whole (`object-fit: contain`) inside the oval frame's
taller window, then zoomed by `--artZoom` (1.12). At that zoom the square's bottom edge landed a few pixels above
the frame's bottom inner rim, so a straight line showed on either side of the bottom medallion.

**Change.** `.card.compact.stdframe` gains `--artBoost: 1.05`, and the oval art's transform is now
`scale(calc(var(--artZoom) * var(--artBoost)))` (`packages/ui/src/styles.css`, "AUTHORED FRAMES").

- It is a multiplier, not a new `--artZoom`, because a card with a Card Art tuner entry sets `--artZoom` inline and
  would have skipped a family bump. Every oval minion grows by exactly 5%, hand-tuned ones included, and the tuner's
  numbers keep their meaning.
- One rule draws the oval minion on every surface (shop, board, hand, combat, Discover, Collection, end screen), so
  they all change together.
- The frame, the attack / health / tribe badges, the tier plaque and the description box are separate layers and do
  not move. The art is scaled whole about the window centre, never cropped to fill.
- Spells (`.spellframe`) and Taunt shields (`.taunt`) have their own art rules and are unchanged; neither showed
  the edge.

Rule: `R-MINION-ART-FILL-01`. Pin: `packages/ui/src/minionArtFill.test.ts` (CSS tokens; jsdom does not lay out).

Pictures (before on top / left, after below / right): [shop, board, hand](2026-11-15-minion-art-5pct/shop-board-hand.jpg) and
[combat](2026-11-15-minion-art-5pct/combat.jpg).
