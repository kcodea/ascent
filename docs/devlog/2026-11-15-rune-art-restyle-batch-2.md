# 2026-11-15 — Rune art restyle, batch 2 (130 runes)

Mike restyled 130 more Set 2 runes in the same look as the first 112
([`2026-11-15-set2-rune-art-restyle.md`](2026-11-15-set2-rune-art-restyle.md)). Kevin handed him the rest of the
runes after that first batch. Six of his Set 2 runes are still in the old style after this one (Blart, Borrowed
Echoes, Bottomless Portrait, Bubble Crown, Bucky, Buddy System), and the other sets come later.

- Each file replaces `packages/ui/src/art/runes/<rune id>.webp` in place. No rune ids, no code and no other art
  changed.
- The masters arrived as 1254x1254 lossless WebP, which `npm run optimize-art` skips (it only reads PNG and
  JPEG). They were converted with the same settings it uses: 512px, WebP quality 85, effort 6 (193.5 MB of
  masters to 5.10 MB in the repo). Masters stay outside the repo.
- The art is wired exactly as drawn, per the owner's art rules.
- The patch note's count went from 112 to 242 rather than adding a second line.

The 130 files are the ones this PR changes under `packages/ui/src/art/runes/`; that diff is the list.
