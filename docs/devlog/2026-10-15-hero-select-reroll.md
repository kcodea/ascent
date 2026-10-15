# Hero select: one re-roll (2026-10-15)

Owner: "add a feature to the hero select that allows a player to re-roll a single hero option once to get a new one in
its place". Owner choices: ONE re-roll total per hero select (any slot, then the option is gone), in ALL modes.
Oracle rule R-HERO-REROLL-01 (`packages/rules/src/registry/approved/heroes.ts`); rules section "Hero select: one
re-roll" in `docs/GAME-RULES.md`.

## What shipped

- **The draw** (`packages/sim/src/heroReroll.ts`): `rollHeroReroll(seed, offer, slot, pool)` draws from `pool` minus
  the offer with `makeRng(mixSeed(seed, fnv("hero-reroll"), slot))`. Pure, seeded, never `Math.random`. The pool is
  the mode's own list (`heroRerollPoolOf` in `store.ts`): Ranked / plain lobby = `playableHeroes(runTribes)` for the
  pending seed (the tribe gate: no Foreman Flint without Dwarves).
- **The record**: `RunState.heroReroll = { slot, from, to }`, stamped by `pickHero` (and by the Versus run build);
  optional on `ReplayV2` too. Nothing in the sim reads it. Telemetry's `heroOffer` stays the FINAL three.
- **Ranked entry** (`rank/rankedEntry.ts`): the entry stores the re-rolled `heroChoices` and `heroReroll`, so a
  restart on hero select reopens the re-rolled heroes with the re-roll spent (no free refresh by closing the game).
- **UI** (`HeroSelect.tsx`, `styles.css` "THE HERO RE-ROLL"): a round 64px `.hcreroll` centred under each tile's
  difficulty pill (owner 2026-10-15: bigger, below the pill; its row is reserved so spending it moves nothing), wearing the Runeforge re-roll's Gem plate tokens and the shop's `refresh` glyph, `gtip` hover text, no
  `title=`, no cursor override. It is a SIBLING of the card button (`.hcslot` wrapper), only in the 3-card layout. One
  press: `sfx.roll()`, the slot swaps, every control unmounts. The swap is CSS only and reuses existing animations:
  the old portrait `dyingfade`s on top, the new one `summonpop`s in, and the Refresh crystal's `.rfb-shine` flare
  blooms over the frame (700 ms). The swapping card suppresses its hover power-art crossfade, because the press
  leaves the cursor on the card.
- **Versus**: `versus_reroll_hero(match, slot, candidates)` in `supabase/migrations/2026-10-15-versus-hero-reroll.sql`
  (NEW, additive: one column `versus_seat_private.hero_reroll`, one RPC). The server picks
  `candidates[versus__pick(match seed, 'hero-reroll:' || seat, n)]`, once per player per match, only in `hero_select`,
  before the pick and the deadline, refusing a list that is empty, oversized, repeats a hero or overlaps the three. The
  swap lives in the private row only. `versusStore.rerollVersusHero` sends the client's eligible list
  (`versusHeroRerollCandidates`), applies the answer to `heroOffer` + the hero select, and blocks picks while it is in
  flight. A reload now reads `priv.hero_offer` (server truth) before recomputing the seeded three. `not_deployed` or
  any refusal hides the control for that match.

## Not done / judgement calls

- **Practice and Gauntlet get no control.** Their pickers already show their WHOLE pool (Gauntlet and Practice "All":
  every hero; Practice "Beginner": exactly the three starters, which is its pool), so there is no hero left to draw.
  The code is generic: if those modes ever offer a subset, the control appears with no further change.
- **Tutorial**: no hero select (Aster is authored), so nothing to do.
- **Server checks**: nothing server-side validates that a picked hero was offered (`submit-rating`,
  `submit-progression`, `gauntlet-clear` only bound the hero id's length), so no Edge Function changes.
- **Versus trust**: the server cannot verify the candidate list's CONTENT (it has no hero roster), the same trust it
  already gives `versus_register_offer`. It does guarantee one swap, one slot, from the match seed, never an offered
  hero.
- **Recorded snapshots** (`BoardSnapshot`) carry no hero offer at all, so there is nothing to change there.

## Deploy

`supabase/migrations/2026-10-15-versus-hero-reroll.sql` is applied (2026-10-15). No Edge Function deploy. A server
without it would answer `not_deployed`, and the client then hides the control for that match.
