# Foe Buffs Panel — click the opponent portrait in combat

**Branch/PR:** `feat/foe-buffs-panel`

The combat foe portrait now carries the player portrait's Buffs affordances: hover prompt, click-to-toggle,
an arrow cue — but the arrow rides BELOW the foe's health pill and the panel drops DOWN (owner ask
2026-08-30). Reuses `BuffsFrame` with a new `drop` prop.

Worth re-deriving-proofing:

- **Rows come from the served board's `BoardSnapshot`**, not a `RunState` — `gatherSnapshotBuffs` in
  `runBuffs.ts` mirrors `gatherRunBuffs`'s labels for the fields snapshots carry (spell power, ruby bonus,
  Undead/Imp/Fodder/Beast/Attachment auras, cling/knit card buffs). Shop-only rows (Shop Stats, slot
  enchants, Veinstorm, Max Gold, on-board Mama Bear/Guel) have no snapshot fields and are simply absent.
  Bot/legacy snapshots yield no rows → no affordance, same gating as the player portrait.
- **Panel size matches the player's BY CONSTRUCTION**: the player's panel silently inherits
  `.statusbar .hero`'s whole-panel `scale(3.1)` (the 🧍 tuner's panelScale). That scale is now also
  published as the bare number `--hpn-panel-s`, and the foe panel's scale is
  `--bfd-body-s × --hpn-panel-s / --hd-opp-s` (multiplying in the hero panel's scale, dividing out the duel
  wrapper's) — retune either panel and the two Buffs panels stay identical. First attempt divided only,
  and rendered at ~1/3 size.
- Pointer events: `.combatopp` is inert; `.combatopp-portrait.hasbuffs` re-enables itself (the runes-column
  pattern) so the click/hover work without waking the rest of the group.
- Owner-dialed: arrow 35u below the hp pill, hover prompt 5u, panel nudged +12/-10u toward the arrow.
- Same PR: baked the ⚔️ tuner's per-rune duel nudges (158/25, 87/−28, 25/−62).
