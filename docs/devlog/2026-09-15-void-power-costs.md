# 2026-09-15 — adopted hero powers start their price clock on adoption

**Owner report (screenshot):** a Void run wielding Rounded Spellbook (slot 0) and Empowering Vines (slot 1)
shows no cost pill on either hero power. "Void's hero powers need to show cost pills."

**Root cause — sim, not UI.** The coin was hiding correctly: the price really was 0. The shrinking-cost
powers key their countdown off a run field a NATIVE hero implicitly starts at run creation —
`roundedSpellbookCostOf` = `3 − (wave − (hunchResetWave ?? 1))`, `buyoutCostOf` the same shape from 11,
`allInPayoutOf` climbing from `rascalResetWave ?? 1`. A Void (turn-4 picks), a Mimic (per-turn disguise) or
a Power Shifter cast adopts the power mid-run and never set those fields, so the countdown had been running
since wave 1 for a wielder who did not exist yet: Rounded Spellbook picked on turn 4 was `3 − 3 = 0` — free
from the moment it landed, and the coin follows the existing "no coin at 0" convention (native Jenkins's
free first dig). Empowering Vines is a passive; it has never had a coin and renders the `· passive` badge.

Same class, found while tracing the route:

- **Indy's Gild recharge** (`spendGold`) was gated on `s.heroId === 'indy' && s.heroPowerSpent`. An adopter
  armed `indyGildRearmAt`, printed the recharge pill, and never rearmed — and a Void holding Gild in slot 1
  spends `heroPowerSpent2`, which the gate never read.
- **Jenkins's Dynamite Dig** prices off the slot's whole-game use count, which a Power Shifter inherits from
  the power it replaced (two Gildmaster uses → the "free" first dig cost 2).
- A once-per-game power adopted over a SPENT once-per-game power arrived dead (`heroPowerSpent` carried).
- Tiff's discount bank could carry across a Mimic's disguises.

**Fix.**

- `seedAdoptedPower(s, heroId, slot)` — already the one funnel all three adopters go through — now re-bases
  every price clock on EVERY adoption (`hunchResetWave` / `harlanResetWave` / `rascalResetWave` = wave,
  `tiffDiscount` = 0), deliberately OUTSIDE its once-per-hero guard: re-basing only ever moves a price up or a
  payout down, so a Mimic re-adopting cannot farm it. Inside the guard (first adoption of that hero this run):
  the firing slot's use counter resets for Dig / `maxUses` powers, and a `oncePerGame` power clears the slot's
  spent flag (+ `indyGildRearmAt` for Gild) — guarded so a Mimic re-adopting Jenkins / Indy does not get a
  fresh free dig / fresh Gild every turn.
- The Gild recharge is keyed off `activePowers(s)` (which slot holds `gild`) and un-spends THAT slot.
- `heroPowerCostOf(power, state, uses)` in `recruit.ts` is now the ONE price helper: the reducer's four
  charge branches (Dig / Tamer / Spellbook / Buyout) and the StatusBar coin for BOTH slots read it. The
  StatusBar's local copy of the fallback chain (`digCost ?? tamerCost ?? bookCost ?? buyCost ?? power.cost`
  for slot 0, a private `heroPowerCostOf` for slot 1) is gone — CLAUDE.md's live-text rule applied to coins.

**0-cost display — kept the existing convention.** The coin hides at 0 (native Jenkins's free first dig; the
panel line reads "FREE"). No new "free" treatment was introduced; a costed adopted power now simply has a
price, so its coin renders.

**Judgement call to flag:** "re-base on every adoption" means a Mimic who used Hunch on turn 5 and re-adopts
it on turn 6 sees 3, not the native "2 the turn after a use". Adoption is treated as that wielder's run start.

**Tests.** `packages/sim/src/adoptedPowerCosts.test.ts` (Void / Mimic / Shifter adopting Spellbook: charged
3 on wave N, 2 on N+1; shown == paid across waves; Buyout / All In / Tamer / Dig / Gild re-bases; slot-1 Gild
recharge) and `packages/ui/src/heroPowerCostPill.test.tsx` (slot 0 + slot 1 coins on adopted costed powers,
passive badge with no coin, no coin at 0). Reproduced and re-verified in the browser via the dev store.
