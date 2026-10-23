# 2026-10-23 — The return trip: the shop vista and the portal dive

**What shipped.** The combat → Shop transition is no longer the falling gate. It is its own scene (`.wipevista`,
`vistaClassFor` in `wipeMachine.ts`, markup in `Recruit.tsx`): the owner's parallax layers (`vista-sky/far/mid/shop/fore`,
plus `vista-flat` for phones) arrive out of the sky (a flash cut, a pull-back from 1.6x, the land rising from below),
RETURNING / TO SHOP grows in from nothing in the sky behind the shop, the turquoise gem over the door charges and bursts
(`gateFx.portal`), the doorway glows (`vista-doorglow.webp`), darkens with the Shop's own dusk veil, and the camera dives
18x through the door onto the real Shop (the door is cut by `vista-doormask.png`). Sparks bloom in from all four edges as
you pass through (`gateFx.edgeBloom`). Sounds: `VISTA_TRIP_LAYERS` in `sfx.ts`, one fader each (`vista*` in
`audio/config.ts`), including the owner's woosh, magic spell and title woosh. The entry gate stays: its poster is
restyled (inked Now Facing, sized off the poster art) and its landing kicks up debris.

**Non-obvious, for the next session:**
- *A CSS mask whose image is not decoded hides the whole element.* The door cut-out was the one vista picture never
  preloaded, so the first trip after a reload blanked sky/hills/shop for 4 frames (owner Medal clip). Every vista
  picture is now decoded on mount and kept referenced; a trip cuts the door only if the mask was decoded before it began
  (`maskok`). R-PRESENT-36.
- *Cover-fit art vs `--u`.* The art is cover-fit (crops on any non-16:9 window) while `--u` follows the 16:9 UI. Things
  ON the art must size off the art (`.wipeposter { --u: calc(var(--gate-hi) * 0.00089333) }`); the sky title sizes off
  the VISIBLE height and is clamped below the screen's top edge, because the sky is what a wide window crops.
- *The gate's foot was folded inside the gate* (`scaleY(-1)` about its top edge), so the landing bounce opened a gap at
  the floor on every screen since #2236. It now flips in place and mirrors the rows above the gate's visible bottom edge.
  Found by rendering the real CSS at 3440x1440 over a red background. R-PRESENT-35 amended.
- *Hooks inside hooks crash the shop screen.* An effect pasted inside another effect's body was an invalid hook call;
  `hookNesting.test.ts` (TypeScript AST) now fails on any hook called inside a hook callback (ESLint has no hooks plugin).
- Particle work for the return trip lives on the ranked gate's Pixi layer (`gateFx`), lifted to z3005 under
  `body.wipe-up`; phones get the sounds but no particles.
