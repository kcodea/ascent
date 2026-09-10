# 2026-09-10 — The shop draw is weighted by copies left

**Owner ruling (2026-09-10):** "the number of copies should directly impact how likely a card is to be found."
Prompted by an outside design review (Codex) that read the shop code correctly: the draw was uniform BY CARD
IDENTITY while any copy remained — a card with one copy left was exactly as likely as a fully stocked one until
it hit zero. Shared-pool depletion was a cliff, not a gradual, trackable probability shift.

## What changed

`drawOfferId` (`packages/sim/src/shop.ts`) now takes the run's pool stock and gives every remaining copy one
ticket; a Practice `tribeSurge` doubles that tribe's tickets (it used to be the only weighted branch). Both draw
sites — `rollShop` and the frozen-tavern `topUpTavern` — pass `state.pool`. The eligibility filter (tier, tribe,
copies > 0) is unchanged.

## Consequences

- Every shop roll consumes the rng differently than before, so seeds from before this change produce different
  shops. No golden test pinned specific offers; nothing needed re-pinning.
- `packages/sim/src/shopDrawWeight.test.ts` pins the ticket math (one copy among sixteen tickets ≈ 1/16, zero
  never, surge doubling, determinism) and an end-to-end roll sweep (a last copy appears far less often than a
  full stack across 400 seeds).
- `docs/GAME-RULES.md` (the loop section) now states the rule; Patch Notes carry the player-facing line.
