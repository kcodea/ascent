# 2026-11-16 — Repainted hero power art (75 files)

Mike repainted every hero power picture in the same pass as the hero portraits
([`2026-11-16-hero-art-enhanced.md`](2026-11-16-hero-art-enhanced.md)): the same subject and layout, with cleaner
shapes, brighter colour and less noise in the detail.

- Each file replaces `packages/ui/src/art/powers/<id>.webp` in place. No ids, no code and no other art changed.
- That is one picture for each of the 62 heroes, plus the variants: five for Cassen's Commissions, five for Ayse's
  suits, two for Flash's First or Last, and `atrius.webp`, which sits in the folder but nothing uses.
- The masters arrived as 512x512 lossless WebP, which `npm run optimize-art` skips (it only reads PNG and JPEG).
  They were converted with the settings that script uses: 512px, WebP quality 85, effort 6. Masters stay outside
  the repo.
- Every file was checked against the current art before wiring (mean pixel difference 12 to 43 of 255 per channel),
  so none came back unchanged.
- The folder went from 4.4 MB to 4.0 MB.
- The patch note for the portraits was widened to cover the powers rather than adding a second line.
