# Execute always kills (2026-10-15)

Owner: "my venom hit an axeman and it didnt kill it - can you make sure execute full kills any minion it hits as long
as it deals dmg to it". Oracle rule R-EXECUTE-04; tests in `packages/core/src/combat/execute.test.ts`.

## Root cause

`applyDamage` (simulate.ts) handled Execute by setting the victim to 0 Health, but an attack exchange resolves its
deaths only in phase 2, after every hit of the clash. Venom (1/1) hitting Axeman (2/2) took Axeman to 0; then
Axeman's retaliation landed on Venom, which is "a friendly Demon deals damage", so Axeman's own +3/+3 fired and lifted
it to 3 Health; phase 2 saw Health > 0 and it lived. The same window exists for any post-hit gain before the death
check (Demon-damage reactions flushed at the end of a wave, Rad Rachel, Alan, Leech, Impossible Todd, Ruinous Lord).

## Fix

- A per-combat `executed` uid set, marked when an Execute hit LANDS (after Immune / 0-damage / Resilient Ward / Ward
  have returned). `isFelled(m)` (Health <= 0 OR executed) replaces the `health <= 0` test at every death check that
  resolves damage: `dealDamage`, the clash's phase 2, `resolveEchoDeath`, the echo-deferred flush. `living()` skips an
  executed body, so a wave flush cannot buff or pick it. `killOrReborn` spends the mark and zeroes the Health, so a
  Rise / Rebirth return is a fresh body.
- Execute now also applies to a landed hit an Execute body deals to an ENEMY through an effect that names it as the
  dealer (Bleed, an Echo spray such as Fel Spikes); before, only the attack exchange read the keyword. Effects that
  pass no dealer (most Shout / Rally / spell damage) are unchanged.
- The poison event (and its Execute FX) still fires on the hit; the death now always follows before the next swing.

## Open owner calls

- Prevented hits (Ward, Resilient Ward, Immune, 0 damage) do not execute and do not spend the Execute (unchanged).
- Friendly fire from an Execute body (a Set 4 self-wound, Fel Spikes spraying its own non-Demons) does NOT execute.
- On a multi-target effect (an Echo spray, a Bleed on two marks) the Execute is spent on the first landed hit, as
  "Lost after use" says; a Cleave clash still fells all three (the flag is captured per swing).
- No Shop path: the Shop has no enemy minions, and Shop damage only ever hits your own board.

Combat output changes, so the Versus resolver needs a redeploy after merge.
