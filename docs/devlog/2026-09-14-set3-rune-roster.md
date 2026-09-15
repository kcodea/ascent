# 2026-09-14 — the Set 3 rune roster (handoff)

The owner's "Ascent — Set 3 Rune Roster Handoff" (Codex, 2026-09-14) implemented line for line.

- **Schema**: `sets` accepts `set3` (runes + quests).
- **64 carryovers** gain `set3` alongside their origin scope — the Ruby / Ale / Dwarf / Kobold / Undead / Shop-consume
  packages (30 Basic + 34 Epic). Nothing moves; sets 1 and 2 measure exactly as before (105/90, 135/126).
  Set 3's static pool: **115 Basic / 98 Epic**, the handoff's number.
- **Set forks** (`SET_FORKS` in `sets.ts` + `forkedCardId` in the reward grant path): a rune-granted id resolves to the
  pinned set's fork. `yazzus → n3_yazzus` in set 3 fixes the handoff's rule 7 (Rune of Yazzus / Frontline Glory no
  longer put a legacy Yazzus beside the set-3 one).
- **Verified, not changed**: the Starform's Shop consumes ride `consumeShopOffer`, so Rune of the Open Market fires
  on the first one each turn (pinned in `set3RuneRoster.test.ts`).
- **Left to the owner** — the handoff's TUNE items shipped at their set-2 numbers, untuned (Gemcutting, Resonance,
  Heavy Payroll, the Brew, the First Round, Gemstorm, Attacking Gems, Profit Sharing, the Conduit, the Lapidary,
  the Motherlode, Double Fisting, Mastery); the Unbroken Vein is in (Veinbreaker as a rune-exclusive body) per the
  roster count. New Set 3-original runes (15–35 Basic, 32–52 Epic) are a separate design pass.
