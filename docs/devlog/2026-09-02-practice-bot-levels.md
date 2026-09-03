# 2026-09-02 — Practice bots: a 1–10 ladder with utility minions at the top

**Owner ask:** expand the Practice "Bots" difficulty from Easy/Medium/Hard to levels 1–10, and make the upper
levels feel *new*, not just bigger.

## What shipped

- `BotDifficulty` (`'easy' | 'medium' | 'hard'`) is replaced by `BotLevel` (`1..10`, in `state.ts`). The anchors are
  **1 = old Easy, 3 = old Medium (the raw authored table), 5 = old Hard** (owner: "5 should be today's hard").
  Levels 2 and 4 interpolate; 6–10 push past anything that existed.
- Every level's dials live in one table, `BOT_LEVELS` in `lobby/practiceBots.ts`: stat multiplier (+ the round it
  starts applying), tier ramp, **start tier** (new — the ramp was already one-per-round at Hard, so the top
  levels open at tier 2–3 instead), player-damage multiplier, and utility slots. Rounds 1–3 are untouched at
  every level.
- **Utility minions (levels 6+).** A level-gated roster of REAL cards (Lastlight, Venom, Fel Spikes, Broad-Axe
  Brakka, Jensen & Fi, Tauntbreaker, Anvilshade Smith, Solaris, Lieutenant Thane — owner list) replaces 1–3 omen
  slots a round. Each is also gated by the bot's current tier, so a tier-6 card never shows before the bots
  could afford it. **Same-day follow-up (owner: tier-4 cards on turn 2 at level 10):** the tier gate alone let a
  tier-3-start, tier-a-round table field mid-tier cards on round 2, and it fielded them EVERY round. Now nothing
  appears before `UTILITY_FROM_ROUND` (7), and from there each seat rolls per round with the level's
  `utilityChance` (40% at 6 → 80% at 10). Both are the assumption to retune, not the roster. A fielded unit **takes the omen slot's authored stat line** (owner ruling) so the level's
  curve is unchanged and the effects scale with the round; **Venom is pinned at 1 Attack** so it stays a trade
  piece. Which units + which slots are drawn per seat from the seat seed, so seats differ and a restored/replayed
  run redraws identically.
- Plumbing: `AuthoredOmen` gained an optional `cardId`; `omenBoardMinions` emits it and leaves `keywords`
  absent so `instantiate` picks up the card's own. `LobbySeatState.authoredTierStart` + `authoredTierFor` honour
  the start tier. The tutorial's authored seats are unchanged (no `cardId`, no start tier).
- Compatibility: `normalizeBotDifficulty` maps the old strings (persisted draft in `ascent.practiceconfig`, or an
  in-progress saved run's `practiceConfig`) onto 1/3/5; the reducer's `practiceBotDamageMult` reads through it.
- UI: the setup screen's segmented control is now 1–10 with a hint naming the anchors and whether the level
  fields utility minions.

## Levers, for next time

`BOT_SEAT_DAMAGE_MULT` (how fast bots chew through each other) is still the pacing dial and still
level-independent — reach for it first if games drag. `BOT_LEVELS` is the difficulty dial. `UTILITY_ROSTER` is
the newness dial: add a card + unlock level and it's in.
