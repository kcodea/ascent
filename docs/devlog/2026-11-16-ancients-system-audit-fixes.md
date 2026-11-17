# 2026-11-16: Ancients system audit fixes (F1, F2, F6, F7, F8, F10, F11)

Fixes for the proved findings of the Ancients system audit. Oracle rules R-ANCSYS-01..05; regression tests in
`packages/sim/src/ancientsSystem.test.ts` (and the Cindy banked-refresh case in `ancientsCindy.test.ts`).

- **F1, power gained after the pick (R-ANCSYS-01).** The pick-time stamps moved out of `pickAncient` into
  `ancientSyncPower` (`syncPower` + `pairingStamps` in `ancients.ts`). It re-stamps `powerOverride` /
  `powerOverrideFor` whenever the slot-0 power's pairing hero changes, and runs that pairing's starting stamps once per
  power per run (`AncientsState.pairedFor`; an old save without it reads as `[powerOverrideFor ?? heroId]`). Called from
  the pick, from `pickPower` (before its triple check), and at the reducer's every-action boundary beside
  `ancientSyncVanguard`, so any future slot-0 writer is covered. Mimic never re-syncs (its pairing is Mimicry's own).
  **Judgement call:** the one-shot pick grants (Kindness x Fortune's card, Disco Dan's Discovers, Setlist stats) also
  land when a later power brings the pairing, because their power text says "when this awakened". Runtime edits to
  `powerOverride` (Gildmaster x War's earned uses) are lost if you shift away and back.
- **F2, Mimic re-pick on Continue (R-ANCSYS-02).** `deserialize` forces the saved `powerOffer` / `pendingPowerOffer`.
- **F6, "Refresh" effects (R-ANCSYS-03).** New `ancientOnEffectRefresh` (meter tick + `ancientAfterRefresh`), called
  after the new row lands in Grand Larceny, Sigil of Kinship, Spell Cart ("Refresh the tavern"), Membrance's power
  ("Refresh the Shop with ...") and Gorr x Time's End of Turn refresh. Every other Shop re-roll goes through
  `refreshTavern` already (button, free refreshes, Clearance, Buyout).
- **F7, live combat counters (R-ANCSYS-04).** New `questTrigger` flags `ANCIENT_DRAKKO_SHOUT_FLAG` (the Drakko Bonds
  listener) and `ANCIENT_GORUN_GIFT_FLAG` (the capped death gift), plus the existing `ANCIENT_EW_AVENGE_FLAG`, are
  counted by `useCombatReplay`'s `questDelta` into `AncientPowerLive.shoutFires` / `attackGifts` / `ewAvengeFired`.
  Drakko's hand and Shop copies still gain at settle: the simulator is a pure function of the two boards and the replay
  never writes run state, so a live hand buff would need a display-only overlay on the hand card chain (not done).
- **F8, Cindy x Fortune (R-ANCSYS-05).** A refresh earned while Golden Gratitude is unused is banked and paid when the
  next use's copy lands; the text says so.
- **F10.** The eight undrawn Ancient mods are in `fuzz.ts`; the mirror sweep is green with them (no asymmetry).
- **F11.** Stale "player-only, never snapshotted" comments fixed in `ancients.ts`, `reducer.ts` and `core/types.ts`.

Left out: F9 (Cindy x Bonds across a reload, needs two live clients). F3 / F4 / F5 belong to the release-switch work.
