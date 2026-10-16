# 2026-10-16 — Soren's Reclaim copy is a combat summon (R-SUMMON-RECLAIM-01)

Owner bug: "rune of the food chain should work with soren's hero power resummon, and anything that summons a minion
in combat basically."

- **Root cause.** `flushResummons` (simulate.ts) inserted the Reclaim copy straight onto the board instead of going
  through `summonMinion` / `placeSummon`, and called only `applyTribeAuras` + `emitOnSummonOrdered` by hand. So it
  skipped `applyCombatSummonGrants` (Food Chain, Hatchery, Packcraft, Undertow, Spare Chair, Ancient of War summon
  attack), Solid Ground, Containment, and the rest of `summonEntryEffects` (summon quests / tallies, Remains,
  Reinvestment, Returning Pack, Emberline, Unity, Summoning Bulwark, Robin's Spoils gain).
- **Fix.** The copy now runs the grants before its slot (room already checked, so `capJudgedElsewhere`), Solid
  Ground + Containment after it, the full `summonEntryEffects` suite after the `summon` event, and queues a strike
  when a grant says "attacks immediately", the same order as a Rise return.
- **Audit.** Every other combat summon already went through `summonMinion` (tokens, Echo, Rally, Avenge, spell /
  hero / Whisper summons, hand-summons, `resummonDeadBeasts`, Brackus copies) or `returnSummonGrants` (Rise /
  Rebirth). Reclaim was the only bypass.
- **Not changed:** Echo Warden doubling and Ancient of Genesis extras still do not copy a Reclaim body.
- Versus resolver needs a redeploy after merge.
