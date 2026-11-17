# 2026-11-17 — Ancient tendril origins + the final hold waits for consequences

Owner rulings 2026-11-17 on top of #2745 (every Ancient grant plays the hero-power tendril):

- **Per-pairing origin table** (`ANCIENT_GRANT_ORIGIN`, `packages/sim/src/ancientBuffFx.ts`, R-FX-ANCIENT-ORIGIN-01):
  `hero` (default) / `trigger` / `self`. Frank, Warden, Midas x Bonds = `trigger`; Drakko x Bonds = `self`; Albus x
  Bonds = `hero`. Shop: `addBuff` skips the `fromHeroPower` record for a non-hero origin (the enclosing capture then
  attributes the grant to its source), and a `self` grant claims its share from every open capture so the recipient's
  stat-diff self-buff burst tells it. Combat: the three combat mods carry `origin`, `simulate` stamps the body on the
  `buff` event as `from` (presentation only, `source` keeps the label), and the UI groupers read `buffOriginOf`.
- **Midas reading is an interpretation**: "this should show tendrils from the minion that was buffed" was read as
  Midas x Bonds starting at the Gilded minion whose gain set it off. Flagged to the owner.
- **Final hold** (R-FINAL-CONSEQUENCES-01): `ConsequenceLedger` in `choreo/finalHold.ts`. The replay notes the end it
  scheduled for each consequence (every `scheduleRoll` / stepped roll, landing dust, coins, a player `toHand`'s
  coalesce, an Avenge def) and the final hold floors at the remaining time, re-checking the ledger when it expires.
  Nothing pending = unchanged hold.
