# 2026-10-19 — Tuned looks reverted in production after the DEV menu went lazy; restored

The owner asked, after the `798cff58f` web release: "we need to remove the css medallion circle from all cards. why did
that show back up?"

## The cause

The mechanic medallion's backing circle is hidden by the root class `cgem-nobg`. `medallionConfig.ts` sets that class
when its module loads (`circleOn: 0` is the default). Many `*Config.ts` modules work the same way: each pushes its
tuned defaults to CSS with a top-level `apply…()` call.

For 21 of them, the only importers are their DEV tuner panels and `tunerAll.ts`. Before #2151 (2026-10-18), Game.tsx
imported `DevMenu` statically. The menu only rendered in DEV, but its module graph still landed in the player bundle,
so those configs loaded in production too. #2151 changed DevMenu to a DEV-only `lazy()` import, which was correct for
the panels, and the config modules dropped out with it. Since then, production has used the stylesheet's fallbacks
instead of the tuned look.

The circle is where it showed: the CSS default draws it, and only the class removes it. Most of the other 20 modules
have CSS fallbacks equal to their defaults, so nothing visible changed for them. Not every one was checked by eye.

The shipped `798cff58f` zip contains no `cgem-nobg` toggle at all. A build with the fix does.

## The fix

- `packages/ui/src/tunedDefaults.ts` imports every self-applying config module, never a panel.
- Game.tsx imports it, so the modules load exactly where the static DevMenu import used to load them.
- `tunedDefaults.test.ts` fails when a module with a load-time apply is imported only by a tuner or `tunerAll.ts`,
  and it checks that the medallion class gets set.
- Rule: R-PRESENT-TUNED-01.
