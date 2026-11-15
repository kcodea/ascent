# 2026-11-15 — Set 2 rune art restyle (112 runes)

Mike restyled the 112 runes listed in [`docs/art/set2-rune-art-restyling.md`](../art/set2-rune-art-restyling.md)
(owner ask 2026-11-14). Each one replaces `packages/ui/src/art/runes/<rune id>.webp` in place; no rune ids, no
code and no other art changed.

- Source: 1254x1254 PNG masters, kept outside the repo. `npm run optimize-art` downscaled them to 512x512 WebP
  (221.0 MB of masters to 4.08 MB in the repo).
- The art is wired exactly as drawn, per the owner's art rules: no toning or recolouring in code.
- Patch notes carry one Systems line for players.

The look: a glossy gem holding the rune's picture, in a carved socket that borrows a shape from that picture,
on a dark background tinted with the gem's colour.
