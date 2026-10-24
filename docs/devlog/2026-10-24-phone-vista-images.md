# 2026-10-24: Phones hold the return trip's vista at 1280 px

Owner, 2026-10-24: *"Phone-sized return-trip images: yea send em"*. Follow-up to the #2268 measurement
(`2026-10-23-iphone-hero-pick-crash.md`): the return trip's vista (#2266) decoded two 2560 x 1440 images on Shop
mount and held them for the whole run on phones, 14.1 MB each. Rule: **R-TOUCH-RUN-MEMORY-02**.

## What changed

- `vista-flat.webp` (the phone's one flattened vista picture) and `vista-doormask.png` (the door's cut-out mask) get a
  1280 px phone copy from the existing build-time phone-art plugin (`phonePublicCap` = 1280). Nothing is committed;
  the copies land in `dist/m1/` like the other phone art (1280 x 720: 189 KB webp, 7.5 KB png with its alpha).
- Both files are named in `styles.css`, which the plugin normally skips (a CSS `url()` cannot switch per device). They
  now follow the board's pattern: the rules read `var(--vista-flat, url('/vista-flat.webp'))` and
  `var(--vista-doormask, url('/vista-doormask.png'))`, and `applyPhoneCssArt` sets the vars to the copies at boot on a
  phone. The list of re-pointed vars is one table (`PHONE_CSS_VARS`), which the plugin also reads for its
  CSS-named exceptions.
- The Shop's up-front decode (`Recruit.tsx`, R-PRESENT-36) now builds its URLs with `publicArt()`, so on a phone it
  decodes the same copy the stylesheet points at (no pop-in, no second download); on desktop `publicArt` returns the
  same `BASE_URL + file` as before. Desktop CSS falls back to the originals: the built rule is unchanged apart from
  the `var()` wrapper, which resolves to the same URL.

## Measured

`npm run perf:phone-run -- --interact` (prod build, headless Chrome as an iPhone 852x393 @3x, standalone). MB.

| step | decoded images before | after | iOS est before | after |
|---|---|---|---|---|
| first shop | 126 | 106 | 250 | 233 |
| after a buy + play | 126 | 106 | 252 | 234 |
| End Turn, gate down | 127 | 107 | 260 | 242 |
| first fight | 126 | 108 | 281 | 228 |

The two images go from 14.1 + 14.1 MB to 3.5 + 3.5 MB: **21.2 MB less decoded image memory** for the whole run
(measured 20 MB on the image row; the rest is which images are on screen at the sample). The run's peak estimate
fell from 281 to 242 MB, though the fight sample also swings with FX layers from run to run. The top-image lists
show only the `m1/` copies on the phone run (no original fetched alongside).

## Not changed

- Desktop draws the six full-size layers plus the original mask, as before.
- The other vista files (door interior and glow) are small already; the six parallax layers are hidden on phones.
