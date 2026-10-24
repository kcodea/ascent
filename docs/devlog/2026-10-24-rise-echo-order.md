# 2026-10-24 — Echo summons in a Rising attacker's slot attack before it

**Owner ruling 2026-10-23 (bug report fba394b7, R-ORD-RISE-ECHO-01).** A Rise Bullseye swung, died to
retaliation, its Echo summoned a Dawnclaw into its slot and it Rose to the Dawnclaw's right. The Rise rewind made
the risen Bullseye attack next and the order carried on to its right, so the Dawnclaw never attacked. Owner:
*"in the dawnclaw case, yeah the dawnclaw would attack next, then the bullseye etc."*

**What changed.** One line in the attack loop of `packages/core/src/combat/simulate.ts`: the Rise / Rebirth return
rewind now sets the side's pointer to whatever stood LEFT of the attacker before the swing (`leftBeforeSwing`)
instead of the element just left of the returned body. The Echo's summons land in the slot and the body re-slots
to their right, so the order is: the summons left to right, the returned body, the rest. No summon in the slot =
the old behaviour exactly. Both sides share the loop, so it is symmetric.

**Non-obvious, for the next session:**
- Dead bodies are never spliced out of `boards[side]`, so a reference captured before the swing is a stable anchor
  for the rewind whatever the swing kills.
- Without Rise the same tokens already went next: `placeSummon` inserts right after the dead body, and the pointer
  sits on the dead body. The fix just makes the Rise case read the same.
- Combat outcomes change for any fight with a self-killing Rise / Rebirth attacker whose Echo summons: versus-resolve
  needs a redeploy after merge.

Tests: `packages/core/src/combat/riseEchoOrder.test.ts` (report shape on both sides, two tokens on both sides,
Rebirth parity, the rotation continuing to the right). All six fail without the fix.
