# 2026-11-01 — A replaced hero power stops working (R-HERO-POWER-REPLACED-01)

**Owner report:** "foreman flint played power shifter but dwarves still cost 2 for him. please make sure when a hero
replaces their hero power that their existing hero power gets replaced."

**Cause.** `heroOfferPrice` (recruit.ts) read `getHero(state.heroId).power.kind` — the NATIVE power — so Company Rate
survived a Power Shifter, and a Mimic / Void / Power Shifter adopter of Company Rate never got 2-Gold Dwarves.

**Fix.** It now asks `hasPower(state, 'companyRate')` (slot 0 and slot 1). The cost coin shares the helper, so the
price shown follows. An audit of every remaining native-power read fixed the other plain bugs the same way:

- Gild count trail in the Shop UI (`gildNeedOf`) now calls the sim's `gildCopiesNeeded`.
- Juggler's Carnival Coin text flag follows the wielded power (as `jugglerBuy` already did).
- The Auctioneer Pulse FX plays for the armed slot's wielded Pulse, not for Myra's id.
- Bot hero-power choice (`bots/policy.ts`) and the production-bot view's `powerKind` read `primaryPower`.
- Start of Turn hero beats (Chaos Bond, Gildmaster, Great Presence, Commission) are labelled with the wielded
  power's name.

**Left native on purpose (listed for an owner ruling, not changed):** Drakko's and Chronos' buy quests, Runesmith's
turn-5 / Guardian's turn-8 forge and their every-forge discount, Ancients power overrides (Gildmaster × War budget),
turn-1 identity setups (createRun grants, Disco Dan's turn-1 lock, Mimic/Void scheduling), hero-power beat identity
keys, opponent seat power tooltips (snapshots carry no adopted power).

Tests: `packages/sim/src/heroPowerReplaced.test.ts`.
