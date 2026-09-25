# 2026-09-25 — Lingering Discover stars: the aux FX canvases now clear when they go empty

**Owner report:** "bug - sometimes getting these stars lingering", then "i think it's from discover". Two shop
screenshots: small cream star glints frozen over the warband and shop rows, and (second shot) brown dust puffs
near a Dragon. They never faded.

## Root cause

Not a def, not the particle pool: the **above-modal canvas's render gate** in `packages/ui/src/pixiFx.ts`.

- `discover-glint` (the stars) and `discover-arrive` (the dust) play on the `above` slot, a second full-viewport
  Pixi canvas at z200, rendered by the main ticker through `renderAbove`.
- `renderAbove` (and its twin `renderUnder`) returned early whenever its layer had **no children**, the idle
  bargain so an empty canvas costs nothing.
- A canvas keeps showing the last frame it presented. So when the last play retired and unmounted, the next tick
  skipped the render and the canvas **froze on the previous frame**, with every particle that was in the air at
  that moment, at full alpha. It stayed until some later above-slot effect happened to draw.
- The everyday trigger: **picking a Discover card while the cards are still landing.** The overlay unmounts, the
  entrance's `cancel()` retires its in-flight dust and glint plays (by design: "picking a card cuts off any dust
  still in the air"), and the canvas freezes with them. A natural finish did the same with the second-to-last
  frame (fainter, so rarely noticed), as could the lifetime ceiling or a budget cull. That is the "sometimes".

Reproduced in the dev build before the fix by wrapping the above renderer's `render`: fire both defs, cancel at
350 ms. The last presented frame had 2 containers mounted, and there were **zero** presents after the cancel.
After the fix: exactly one empty present, then idle.

The `over` canvas never had it: the main Application renders its stage on every tick it runs, and the
autoIdle stop happens in `update` before the render listener in the same tick.

## Fix (general: every def, every slot)

- `aboveShowing` / `underShowing`: the slot's canvas still shows content. The render runs while anything is
  mounted **or** the canvas is still showing content, so the first frame after the slot goes empty presents one
  empty stage (clearing it). After that it idles as before, still one array-length read per idle frame.
- The `above` / `under` `mountLayer` disposers `wake()` the ticker when the canvas is showing content, so the
  clearing frame happens even if nothing else is live (the autoIdle stop in `update` does not stop the render
  listeners in the same tick).
- `detach()` resets both flags.
- DEV watchdog: `pixiFx.staleSlots()` (`window.__pixiFx.staleSlots()`) lists any aux canvas still showing content
  with nothing mounted. It should always be empty one tick after a retire.

The particle pool was checked and is not involved: `releaseParticleLayer` empties `particleChildren` and
unparents, and `acquire` does a total reset.

## Tests / oracle

- `packages/ui/src/fx/auxCanvasClearsOnRetire.test.ts`: cancel mid-flight, natural finish, the under slot, several
  plays with the last one out clearing, and the owner path (`runEntrance` → first card lands → `cancel()`), all
  assert the empty clearing present, `staleSlots()` empty and zero live plays. All five fail without the fix.
- Oracle: `R-PRESENT-20` in `packages/rules/src/registry/approved/foundation.ts`.
- Patch note: Systems, "Effects Fix".
