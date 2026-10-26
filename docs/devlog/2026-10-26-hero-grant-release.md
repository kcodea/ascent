# 2026-10-26 — A new hero power releases the old power's rune (R-HERO-GRANT-RELEASE-01)

**Owner report:** "runemaster got a new hero power here but the art didnt change to it." Runesmith had Rune of
Shopkeep from his turn-5 forge (the bell art is `art/runes/rune_shopkeep.webp`), then Power Shifter gave him
Goldspring (cost 3). The button showed the bell AND the label "Shopkeep"; only the cost coin was the new power's.

**Root cause:** the hero-power slot's grant (`RunState.heroGrantArt`, stamped by `buyRune` for the hero's own forge
and by `buyQuest` for Fi / Coran's hero quest) was never cleared when `pickPower` put a new power in slot 0, and
StatusBar prefers the grant for art, label, rule and tally. Neither the art nor the label was "the" bug: both read
the stale grant.

**Owner ruling:** "this would replace whatever rune mechanic he has, so if he had a rune that was passively doing
something, that would not be active anymore. (the one he selected from his hero power)". Before this fix the rune
kept working after the swap.

**Fix (`packages/sim/src/heroGrant.ts`):**
- `heroGrantOf(run)` is the one read of the slot grant; it counts only while the hero's own power holds slot 0.
  StatusBar, `heroSlotRune.ts` and QuestBadges read it, so even a save written before the fix shows the new power.
- `captureHeroGrantRune` records a generic diff of what the hero's rune switched on at the forge pick (flags,
  `questFlags` entries, list entries, numeric banks), stored as `RunState.heroGrantRune`. `releaseHeroGrant`
  (called from `pickPower` for every slot-0 replacement) switches exactly that back off, removes one copy from
  `ownedRunes` / `runeStacks`, and clears the slot. Delivered value (cards, Gold, stats already given, the immediate
  Shopkeep cut) stays. Another held copy of the same rune keeps its switches on.
- `buyRune` only treats a forge as the hero's while the hero's own power is still wielded.
- The sweep test buys every rune at the hero forge, swaps, and asserts the run's ongoing rune state is back to
  pre-pick. Forge bookings (Epic Forge, Ornate Clock) are treated as delivered.

**Open:** a hero QUEST grant only leaves the slot (it keeps running as a quest). The foe hero-power icon in combat
(`CombatOpponent`) still shows the seat's native power: lobby snapshots do not carry the adopted power id.
