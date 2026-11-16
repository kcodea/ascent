# 2026-11-15 — Rune art restyle, batch 2 (38 runes)

Mike restyled 38 more Set 2 runes in the same look as the first 112
([`2026-11-15-set2-rune-art-restyle.md`](2026-11-15-set2-rune-art-restyle.md)). Kevin handed him the rest of the
runes after that first batch; 97 Set 2 runes are still in the old style after this one, and the other sets come
later.

- Each file replaces `packages/ui/src/art/runes/<rune id>.webp` in place. No rune ids, no code and no other art
  changed.
- The masters arrived as 1254x1254 lossless WebP, which `npm run optimize-art` skips (it only reads PNG and
  JPEG). They were converted with the same settings it uses: 512px, WebP quality 85, effort 6 (56.3 MB of
  masters to 1.40 MB in the repo). Masters stay outside the repo.
- The art is wired exactly as drawn, per the owner's art rules.
- The patch note's count went from 112 to 150 rather than adding a second line.

Runes in this batch: Abomination, Aftermarket, Ancestral Roar, Ancient Den, Ancient Expenditure, Ascension,
Ashen Payroll, Baller, Banquet Hall, Bargain Bin, the five Basic tribe runes (Beast, Demon, Dragon, Dwarf,
Kobold), Beastial Swarm, Burrow, Carrion Coin, Catacomb, Chipper Sticker, Clockwork Promotion, Coffers,
Collector, Combat Prowess, Conduit, Crucible Choir, Dawnclaw, Deathtouched Apple, Deep Feast, Deepening Vein,
Delayed Duplication, Display Case, Double Bill, Draconic Curiosity, Dragon Breath, Dragon's Egg, Dragon's
Pantry, Drake Skull.
