# The card plate still popped in — the compositor has its own decode cache

**Owner report 2026-09-03, playing the exe built from #1358:** *"the literal first frame of the game board and I
see the taunt frame and more pop in"* … *"just saw the card plate pop in on turn two after adding a card to hand
for the first time."*

The boot had fetched AND decoded every one of those images (`window.__boot.stages.images` ok). The pop-in is one
layer lower. Chromium's **compositor** keeps its own decode cache with a fixed budget — far smaller than 1,180
decoded images — and for any image whose decoded size is over ~512 KB it rasterises the tile WITHOUT the image
the first time it is seen and fills it in a frame or two later. 80 of the 100 public webps are over that line
(`cardplate.webp` is 800×1244 → 3.9 MB decoded). So `img.decode()` at boot buys nothing here: by the time a
plate is first drawn its compositor decode has long been evicted.

The platform's one lever is `decoding="sync"` on `<img>`: the compositor never defers that image. `Card.tsx`
already carried it on the ART — with a comment describing this exact pop — but not on the plate or frame
`<img>`s beside it. Every player-facing `<img>` (78 tags, 25 files) now carries it; `imgDecodingSync.test.ts`
fails when a new one doesn't (AvatarPicker's lazy grid and the dev UI editor are the listed exceptions).

Also found: the hero-select ceremony portrait is reached by a STATIC import — outside every glob and outside
`public/` — so it was never in the preload set. Added by hand in `art.ts`, pinned in `preloadImages.test.ts`.

**What this does not cover:** CSS `background-image` / `mask-image` draws have no decoding attribute. The board
backdrops, the spell arch frames and the oval frames are drawn that way; if any of them still pops on first
sight, that is the next thing to measure — the hitch log will not show it (it is a raster delay, not a
main-thread stall), only eyes or a frame capture will.
