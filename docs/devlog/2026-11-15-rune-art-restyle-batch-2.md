# 2026-11-15 — Rune art restyle, batch 2 (136 runes)

Mike restyled 136 more Set 2 runes in the same look as the first 112
([`2026-11-15-set2-rune-art-restyle.md`](2026-11-15-set2-rune-art-restyle.md)). Kevin handed him the rest of the
runes after that first batch. This finishes his share of Set 2; the runes that only appear in other sets come
later.

- Each file replaces `packages/ui/src/art/runes/<rune id>.webp` in place. No rune ids, no code and no other art
  changed.
- 130 masters arrived as 1254x1254 lossless WebP, which `npm run optimize-art` skips (it only reads PNG and
  JPEG), and six as PNG. All were converted with the settings that script uses: 512px, WebP quality 85,
  effort 6. Masters stay outside the repo.
- The art is wired exactly as drawn, per the owner's art rules.
- The patch note's count went from 112 to 248 rather than adding a second line.

The 136 files are the ones this PR changes under `packages/ui/src/art/runes/`; that diff is the list.
