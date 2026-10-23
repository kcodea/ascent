# 2026-10-23 — Minions granted mid-fight are summonable from hand that same fight

Owner ruling (R-HAND-GRANT-SUMMON-01): "a minion added to hand CAN be summoned that same fight." Before this, a combat
grant was only recorded in `handGrants` for settle, so every summon-from-hand effect (the Spirits' copy summons,
the Waking Reserve, Dreamed Graves / Open Hand hearing it) ignored it.

**Engine (`packages/core/src/combat/simulate.ts`)**

- Every hand-grant push now goes through one `recordHandGrant(side, cardId)`. A MINION (not a spell, not a Ruby)
  that fits gets a combat hand entry with uid `handGrantUid(idx)` = `hg<idx>` (the index into that side's
  `handGrants`), keywords, after the starting hand. The uid rides the `toHand` event (new optional
  `uid` field on the shared `CombatEvent` union, additive only).
- Ancient of Death x Braum (`handGilds`) and Ancient of Bonds x Flash (`handExact`) update the entry the same way
  settle will (gilded: + printed stats; exact: the body's stats/keywords/Gilded).
- Entry stats: see "Stats" below.
- `handPool(side)` = starting hand + the grants that still fit. Every reader that used `stateOf(side).handMinions`
  now reads it (`handMinionsFor`, `summonCopyFromHand`, `buffHand`, the spell-cast hand growth, the Waking Reserve).
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

**Stats (owner review, 2026-10-23)**: "a new card would get its printed stats plus any potential aura/run-wide
buffs. like an undead card granted to hand mid fight would still inherit undead aura buffs etc. buffs in combat would
persist to newly added cards as well."

- `grantedHandStats(side, def)` gives the entry the stats it would have as a hand card: printed + the side's per-card
  run buff (`cardBuffs`) + the BAKED buy auras (Undead buy Attack, Beast Attack/Health, Attachment), read live. This is
  the combat twin of settle's `conjuredStats`, so the card arrives with the stats the fight showed. A recorded board
  already carries every input (`cardBuffs`, `undeadBuyAtk`, `beastBuyAtk`, `beastAuraHp`, `magneticAtk/Hp`,
  `cardTribes`), so no new snapshot field beyond `handRoom`.
- New `copyStats.handFold`: a body summoned FROM HAND now takes the FOLDED auras a board body takes at the opening
  (`applyAuras(m, false)`: the Undead Aura's Attack/Health, Grim Toast, this fight's per-card stacks). Baked buffs are
  already in a hand card's stats, so they are not added again. This applies to EVERY hand copy (Spirits'
  `summonCopyFromHand` and the Waking Reserve), not only granted cards: before, a starting-hand Undead copied in
  combat lost the Undead Aura it shows in the Shop.

**Readings for the owner**

- The Rope Wrangler Echo primitive (`deathrattleSummonRandomHandMinion`) is unused by any live card; this PR makes no
  behaviour change to it (it still reads only the starting hand).
- Not covered: Heckbinder's live Fodder aura on a granted Fodder (board-dependent; settle adds it), the Rune of the
  Trophy copy and quest reward cards (both are visual-only `toHand` events, conjured at settle through their own
  channels), and a Crypt Broker hand Echo at settle that adds cards between grants. A run-wide gain landing AFTER a
  card was granted reaches it at settle, the same as for a starting-hand card.

Combat outcomes change wherever a minion is granted mid-fight and a hand-reading effect fires after it, so
**versus-resolve must be redeployed after merge**. Tests: `packages/sim/src/midfightHandGrants.test.ts`.
