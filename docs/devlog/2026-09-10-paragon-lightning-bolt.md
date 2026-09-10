# 2026-09-10 — Paragon's Rally buff fires lightning (source-card authored buff FX)

Bound Paragon (`n2_paragon`) to the workshop-saved `lightning-bolt-blue` def so each minion it empowers on a
Rally takes a bolt of lightning instead of the generic green tendril.

## The non-obvious part

The natural binding — `n2_paragon.buffWave → lightning-bolt-blue` — did **nothing**. Paragon buffs
`on:'onAttack'` (it reacts to a Rally trigger during its own swing), and `'buff'` is in `compile.ts`'s
`absorbIntoWindup` set. So the buff events are absorbed into the **attack's wind-up moment** and never become
their own `buffWave` moment. The `buffWave`/`fanOut:'buffed'` cue in `score.ts` (the one that plays Karwind's
flame-ring on top of the tendril) therefore never sees Paragon's buff at all.

The buff still reaches the player, but only through the absorbed path in `useCombatReplay.ts`'s
`fireBuffCasts`, which draws the generic `tendril-trail`. That path already swaps the tendril for an authored
def when the buff came from a **spell** (`authoredBuffDefFor(spellId)`, the Dragonflame path) — but a minion's
own onAttack buff carries no `spellId`, so nothing replaced the tendril.

## The fix (presentation-only, `packages/ui`)

Added `sourceBuffDefFor(cardId)` in `bindings.ts` — the **source-card mirror** of `authoredBuffDefFor`. It
reads the same `buffWave`/`fanOut:'buffed'` binding, keyed by the **buffer's** card id. `fireBuffCasts` now
checks it after the spell/label paths and, when present, flies the authored def source→target **in place of**
the generic tendril (both are source→target travel effects, so drawing both would read as one buff twice).

So a card bound once at `buffWave`/`buffed` fires its def whether the buff lands as its own wave (score.ts,
additive on top of the tendril) or gets absorbed into a swing (here, replacing the tendril). This generalizes
to any minion that buffs others directly on attack.

`lightning-bolt-blue.json` also carries the owner's in-workbench retune (sparkle 0.4, rgbSplit on, retuned
motion blur + particle speed/drag/life) — the look approved live.

Golden: `directCalls.ts`'s `DYNAMIC_CALL_SITES['useCombatReplay.ts']` 4 → 5 (the new data-resolved play).
