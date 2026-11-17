# 2026-11-17 Slaughter extras fire on a mutual kill

**Owner ruling** (asked "should Law of Teeth and similar Slaughter effects fire when the killer also dies?"): "yes".
Oracle: `R-SLAUGHTER-MUTUAL-01` (combat domain). Found by PR #2740's builder.

**Before:** a killer that died in the same clash already fired its own Slaughter (owner 2026-07-17, the bus lets a dead
minion's `onKill` through), but the on-kill block in `performAttack` gated every extra on `killerAlive`: Law of Teeth,
War Council (`tribeRallySlaughterExtra`), Author's Hand (`slaughterFirstEachCombat`), Blood Trail, Feeding Line and
Bloodscent (`set2TribalOnKill`) all paid nothing on a mutual kill, mid-fight and on the final hit, both sides.

**Now:** the `killerAlive` gate is gone. Rules applied per effect:

- Law of Teeth / War Council / Author's Hand: re-run the dead killer's own `onKill` effects on its dead body, exactly
  how the bus runs its first Slaughter. Author's Hand's once-per-combat charge is spent by that kill.
- Blood Trail: the marked body's kill conjures its Beast (needs no living body).
- Feeding Line: the next living Beast after the killer's slot attacks at once (dead bodies stay in `boards`).
- Bloodscent: the +4/+4 lands on the dead Beast as `permaGain` and carries home to its run card.
- The board `triggerMultiplier` slaughter family (no live card today) never had the gate; kept as a control row.

Trophy Hunter, Rune of the Trophy and Blood Frenzy already ignored the killer's life. No beat changes: each extra
keeps the beat it had on a normal kill. Tests: `packages/core/src/combat/slaughterExtrasMutualKill.test.ts`
(each effect x mutual/normal x player/enemy, a mid-fight row, a mirror + determinism row; every mutual-kill row fails
without the fix).
