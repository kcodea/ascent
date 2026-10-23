# 2026-10-23 — Minions granted mid-fight are summonable from hand that same fight

Owner ruling (R-HAND-GRANT-SUMMON-01): "a minion added to hand CAN be summoned that same fight." Before this, a combat
grant was only recorded in `handGrants` for settle, so every summon-from-hand effect (the Spirits' copy summons,
Rope Wrangler's Echo primitive, the Waking Reserve, Dreamed Graves / Open Hand hearing it) ignored it.

**Engine (`packages/core/src/combat/simulate.ts`)**

- Every hand-grant push now goes through one `recordHandGrant(side, cardId)`. A MINION (not a spell, not a Ruby)
  that fits gets a combat hand entry with uid `handGrantUid(idx)` = `hg<idx>` (the index into that side's
  `handGrants`), printed stats + keywords, after the starting hand. The uid rides the `toHand` event (new optional
  `uid` field on the shared `CombatEvent` union, additive only).
- Ancient of Death x Braum (`handGilds`) and Ancient of Bonds x Flash (`handExact`) update the entry the same way
  settle will (gilded: + printed stats; exact: the body's stats/keywords/Gilded).
- `handPool(side)` = starting hand + the grants that still fit. Every reader that used `stateOf(side).handMinions`
  now reads it (`handMinionsFor`, `summonCopyFromHand`, `buffHand`, `takeRandomHandMinion`, the spell-cast hand
  growth, the Waking Reserve).
- Fit rule mirrors settle exactly: settle mints the fight's Rubies first, then walks `handGrants` in order, each
  taking a slot. So grant `idx` fits while `idx < handRoom - rubies so far`. A Ruby arriving later can push a
  not-yet-used grant back out (it stops being a candidate). The uid is side-neutral (so the R-SYMMETRY-01 mirror
  test sees identical logs); the copied/consumed bookkeeping sets are now keyed by side (`handKey`), which also fixes
  a latent collision between two captured hands sharing a uid.

**Run side**

- New `CombatSideState.handRoom` = `handCap(s) - s.hand.length` (reducer + production-bot mirror), recorded on
  snapshots (`BoardSnapshot.handRoom`) and threaded by `boardSide`. Older captures fall back to 10 minus the listed
  hand minions + spells.
- Settle maps `handGrantUid(i)` to the card grant `i` became, so a mid-fight `handBuff` on a granted card lands on
  the arrived card.

**UI (minimal)**: `Recruit.tsx` aligns the combat grant previews with the player's `toHand` uids, so a preview
greys when a copy is summoned from it and grows with its hand buffs.

**Readings for the owner**

- Rope Wrangler's Echo primitive (`deathrattleSummonRandomHandMinion`, no live card uses it since the 2026-08-18
  rework) still does not remove the card at settle (the 2026-08-08 ruling). A granted card it takes therefore still
  arrives, the same as a starting-hand card.
- Granted entries use printed stats in the fight; settle still conjures with run enchants (`conjuredStats`). Same as
  any combat summon of a card.
- Not covered: Rune of the Trophy's copy and quest reward cards (both are visual-only `toHand` events, conjured at
  settle through their own channels), and a Crypt Broker hand Echo at settle that adds cards between grants.

Combat outcomes change wherever a minion is granted mid-fight and a hand-reading effect fires after it, so
**versus-resolve must be redeployed after merge**. Tests: `packages/sim/src/midfightHandGrants.test.ts`.
