# 2026-11-17 — Ancient trigger procs (R-FX-ANCIENT-PROC-01)

Owner ask: "can you do a quick pass at ancients that fire from events, like warden's fortune for example. this should
play the same animation that runes do when they trigger in combat or in recruit so that the player knows it triggered."

- **One mechanism, four signals.** The hero-power button plays the rune badges' own burst (the `runeTriggered`
  binding, `rune-burst`) once per fire (`packages/ui/src/ancientProcFx.ts`, mounted in `StatusBar`; the one `playDef`
  site is `runeTriggerFx.playRuneBurstDef`, shared with the badges). Repeats stagger and coalesce through `bookBurst`.
  - SHOP: `procAncient(state)` bumps `ancients.procs` where an event-fired pairing resolves.
  - COMBAT: `simulate` pulses a `questTrigger` of `ANCIENT_PROC_FLAG` per fire (before its consequences). A pairing that
    already pulsed its own per-fire counter flag (R-ANCSYS-04) is aliased in `packages/sim/src/ancientProcs.ts` instead of
    pulsing twice. `triggerCounts` folds them under `ANCIENT_PROC_KEY`. Settle-paid pairings get a presentation-only
    `QuestCombatMods.ancientProcOn` field (Ward break, Rise, the Nth spell cast).
  - START / END OF TURN: no stamping. A hero-sourced beat named for an Ancient bursts as it plays (`Recruit.tsx`).
    Cassen's Commission payout and Kindness's Great Presence beats are named for the Ancient when it adds to them
    (`ancientSotSource`). Juggler × Time and Rayse × Time emit a `counterChanged` so their End-of-Turn beat is not empty.
- **Classification** lives in `packages/sim/src/ancientProcs.testkit.ts` (`ANCIENT_PROC_PHASES` by primitive + per-pairing
  overrides): 179 (pairing, phase) rows over 145 pairings. Not event-fired: power-click modifiers, prices / cadences,
  pick-time one-shots. Duos-only heroes (Priestess, Magician, Cindy) skipped. Table test: `ancientProcs.test.ts`, one
  real-reducer / real-simulator case per row (`ancientProcCases.g1..g3.testkit.ts`).
- **Player only**, like the rune burst (a foe's rune badges bounce, never burst). A combat proc is its own `questTrigger`
  beat, so a fight with a busy Ancient runs a little longer (the rune trigger's hold per fire).
- Found in passing, not fixed: Midas × Death in combat can grant 2 Gold Pouches for one Gilded death when a plain
  friend is alive (the proc matches each grant).
