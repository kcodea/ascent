# The combat <-> shop curtain outranks the whole game (2026-10-19)

**Owner report:** game elements still popped in over the End Turn curtain, with the question "if i provided PNG's
instead, would that improve anything? it seems to work perfectly for the gate animation".

**Cause: layering, not art.** The curtain (`.wipecurtain`, plus its `.wipefront` ring and `.wipebar`) is one CSS
layer in the stage at z250. The ranked gate is a z700 layer, so almost nothing in the game outranks it; that is why it
looks flawless. PNG doors would not help the curtain: a PNG at z250 is covered by exactly the same things. Since the
z250 pick (2026-08-29) and the per-layer fix of 2026-09-24 (R-PRESENT-17), the game grew more layers above z250, each
of which painted over the blue whenever it was alive as a wipe ran:

- the Rebirth pillar burst, `.rbpillar.fixed` (z2000)
- the rune lock-in ceremony, `.runelock` (z640)
- the tutorial spotlight and nudge, `--tut-z-mask/panel` (z600/601) and `.tut-nudge` (z620)
- emote bubbles and the emote menu (z900/950)
- the FX `screen` primitive's full-screen flash, `.fxflash` (z99999)

**Fix:** the curtain, ring and bar moved to z3000, above every in-game layer, the way the gate works, so a layer added
later is under the curtain by default. While `body.wipe-up` is set: the wipe FX canvas rises to z3005 (its base z255
stays for the Ancients awakening); the screen flash drops to z2990; the menus a player can have open (Esc, patch notes,
Inspect, account, bug report and toast) and the replay controls (recorded cursor, round rail, replay bar) rise to their
own z + 2600, keeping their order. Dev tools (z4000+) sit above it anyway.

**Guard:** `packages/ui/src/curtainLadder.test.ts` reads every stylesheet and inline z-index in the UI and fails on any
layer at or above the curtain that is not on a short list (dev tools, boot / rotate screens, the cloud-moved prompt).
R-PRESENT-17 is widened to say the curtain outranks the game by construction.

**Not reproduced live:** the built-in preview pane was hidden, so its animation timing could not be trusted. A probe
over two plain rounds (no Rebirth, runes, tutorial or emotes) found nothing above the curtain, which is consistent with
the leaks being specific to those layers. The owner checks the look.
