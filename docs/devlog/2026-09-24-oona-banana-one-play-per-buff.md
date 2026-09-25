# King Oona's banana, and one authored buff effect per buff

**Owner ask (2026-09-24):** King Oona's doubling of a summoned Beast plays the owner's `oona-banana` def, travelling
Oona → that Beast; asked whether it should replace the buff tendril: *"Banana replaces tendril."*

- Bound `cards.b2_oona.buffWave = { def: 'oona-banana', fanOut: 'buffed' }`. A real fight (pinned in
  `choreo/oonaBanana.test.ts`) gives Oona's doubling its OWN `buffWave` moment with Oona's body as the cast source,
  despite the effect's `foldedCue` policy — so the Karwind-style card binding reaches it.
- **Fix (rule R-BUFFFX-01):** a minion's `buffed` def was playing TWICE on a standalone buff wave. Since PR #1416
  `fireBuffCasts` swaps that def in for the tendril on every wave (not only inside a swing), and the score's `fxDef`
  `buffed` fan-out still played it again on the same beat. The fan-out now stands down for a no-spell minion buff —
  the mirror of `buffedOn` skipping spell buffs.
- **Side effect on Karwind:** its flame ring was also doubling (and has had no tendril under it since #1416, despite
  the 2026-08-11 "additive" ruling). It now plays once, still without a tendril. Flagged to the owner.
