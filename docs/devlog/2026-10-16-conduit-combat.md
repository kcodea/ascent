# 2026-10-16 — Rune of the Conduit works in combat; permanent Rubies bounce permanently

Owner: "rune of the conduit should work in combat, and for a case of boulderdash, those rubies that bounce should be
permanent. show the bounce animation in combat when it happens."

**Root cause.** Rune of the Conduit ("Your Rubies all bounce an additional time") was a Shop-only `RunState.runeConduit`
flag read in `fireOnRubyPlayed`. `questCombatMods` never handed it to combat, and the combat Ruby primitive
(`playRubyOn` in `packages/core/src/effects/factories.ts`) had no Conduit hop. No combat Ruby ever bounced off the
rune, so Boulderdash's permanent Rally Rubies had no bounce to make permanent.

**Fix.**
- `QuestCombatMods.runeConduit` (copy count) and `CombatContext.rubyConduitBouncesFor`. `questCombatMods` passes
  `runeStacksOf(s, 'rune_conduit')`, so served snapshots carry it too.
- `playRubyOn` gives every combat Ruby cast one extra hop per copy to a random other living friendly minion, with the same
  shape as Ruptured Rubies: stats only, and it inherits the landing's permanence (`engraved`). A permanent Ruby's hop
  (Boulderdash, Korn, Blazer, or Engraving Gems) accrues `permaGain` + `permaRuby` and reaches the Shop card through
  `permaBuffs` at settle. A plain Ruby's hop stays combat-only.
- Each hop is a `buff` event stamped `ruby` + `bounce`, so the existing combat `bounceFx` channel plays `ruby-bounce`
  (the Shop's def) in the hop's beat. The rune badge bursts off `questTrigger` `runeConduit`, mapped in `questFlags.ts`.

Oracle: `R-RUNE-CONDUIT-COMBAT-01`. Versus resolver needs a redeploy after merge (combat behaviour changed).
