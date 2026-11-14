# 2026-11-14: spell-cast watchers get their own beat

Rule R-SPELLCAST-WATCHER-BEAT-01 (`triggers`); test `packages/sim/src/spellCastWatcherBeat.test.ts`.

## The find

Doc Bot's beat-conservation builder sweep failed once the Cindy branch added a hero to the roster (the roster shift
moved the seed sequence): seed 22 step 80, Hunch, a Ruby Transfer played on the right neighbour of a Big Brain Billy
that held a Ruby. The batch claimed -2/-2 on Billy; Billy really moved +0/+0. Hunch was incidental.

## The cause

Every `spellCast` watcher dispatched **bare** at the tail of the cast (`noteSpellCast`, plus the two Ruby paths
`countRubyAsShopSpell` and `fireSpellCastWatchersForRuby`), after the cast's own trigger scope had closed. So:

- the cast's scope claimed what the spell did to Billy (+1 Ruby, then the -3/-3 steal) = -2/-2;
- Billy's own +2/+2 had no scope, so no beat at all.

On an ordinary cast this was only a missing beat (the gain snapped in at commit), which the checker tolerates for
`play` (it is pinned in `KNOWN_UNATTRIBUTED`). Ruby Transfer moving the same body made the two halves cancel, so it
showed up as an over-claim instead.

## The fix

`fireSpellCastWatcher` (recruit.ts) wraps each watcher × effect × repeat in `withRecruitTrigger`, using the
registry identity `factory:<do>:spellCast` that `policies.ts` already declared (mostly `foldedCue` / `castReact`),
with `discardIfEmpty`. It follows the same pattern as `fireShopDamaged`. Inside an outer scope (an End of Turn cast) the parent
flushes before the child and rebases after, so nothing is claimed twice. With no collector it is the same bare
call, so gameplay is unchanged.

The `play` / `chooseOne` pins stay: their repros are other bare sites (the Shout watchers, the Scales rune proc).
