# 2026-11-16 — Enhanced hero portraits (63 files)

Mike repainted every hero portrait: the same hero, pose and scene, with cleaner shapes, brighter colour and less
noise in the detail.

- Each file replaces `packages/ui/src/art/heroes/<hero id>.webp` in place. No hero ids, no code and no other art
  changed. That is all 62 heroes plus `herald.webp`, which sits in the folder but no current hero uses.
- The masters arrived as 512x512 lossless WebP, which `npm run optimize-art` skips (it only reads PNG and JPEG).
  They were converted with the settings that script uses: 512px, WebP quality 85, effort 6. Masters stay outside
  the repo.
- The folder went from 3.5 MB to 3.3 MB.
- A first export of the same pass changed only ten heroes; the other 53 came back almost pixel-identical. A
  per-file pixel difference against the current art caught it (about 3 of 255 per channel, against 20 to 45 for a
  real repaint), and Mike re-exported all 63. Worth running that check on any future bulk art drop.
- Hero skins (`packages/ui/src/art/skins/`) were not part of this pass.
