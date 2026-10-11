# 2026-10-11: Celestial and Spirit get their own frames and plates

Set 3's two tribes were the last ones without authored card chrome: they wore the shared silver oval, the shared
gold Taunt shield and the generic stone plate. The owner drew the full set for both, so all ten tribes now have one.

## What shipped

Ten files in `apps/web/public/frames/`, five per tribe:

- `cardplate-<tribe>.webp` (the hand-card plate)
- `oval-<tribe>.webp` and `oval-<tribe>-gilded.webp` (the minion frame)
- `taunt-<tribe>.webp` and `taunt-<tribe>-gilded.webp` (the Taunt shield)

`Card.tsx` gains the two tribes in `TRIBE_OVALS` and `TRIBE_TAUNTS`, and their `TRIBE_PLATES` entries now point at
the authored plates instead of `CARD_PLATE_SRC`. Nothing else changes: the three lookup tables are the whole
contract, `publicArt.ts` picks the files up from the literal names, and `preloadPlan.ts` reads the tribe out of the
filename.

## How the masters were checked and converted

- Each master was compared against the shipped Dragon equivalent. The ovals (1059x1427) and Taunt shields
  (1086x1448) matched dims exactly, and every alpha silhouette matched its sibling with an IoU of 1.000, so the
  "AUTHORED FRAMES" geometry and the `--heater` clip drop in with no tuning.
- The two plates arrived 946x1471 against the 800x1244 every plate shares (same aspect ratio), so they were
  resized to 800x1244. Every plate placement var is expressed against those dims. Same call as the Dwarf and
  Kobold plates in #800.
- Encoded WebP q92 with full-quality alpha, the #800 recipe.

## Not done here

- The tribe glyph for both is still the placeholder `clock` icon (`TRIBE_ICON`). That needs its own art.
- The masters stay outside the repo, in the owner's `Reference Art` folder.
