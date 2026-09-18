# Ascendants — mechanic handoff (owner note, 2026-09-17)

> **Status: PARKED — a design note only. Nothing is built, scheduled, or spec'd beyond what is written here.**
> The owner asked for this to be kept as a knowledge handoff for later development ("do nothing with this info").
> Pick it up only on an explicit ask; when you do, this is the starting brief, not a contract.

## The idea, in the owner's words (lightly structured)

**Ascendants** are a per-game rotating roster of unique minions.

- There is a master roster of roughly **20–30 Ascendants** ("ancients").
- Each lobby/game exposes only a **random subset — say 6** — rolled fresh every game.
- The subset is **shown to the player at the start of the game**, so you know which six exist this run.
- They **vary in tier, tribe, etc.** — they are not one tribe or one tier band.
- There is exactly **ONE copy of each Ascendant** in the game (a single copy, not the normal pool multiplicity).
- When an Ascendant **appears in the player's Shop, it reveals itself** — a noise and an animation call it out.
- **Buying one is a single, one-time decision** taken when it naturally shows up in the Shop. Once the player has
  bought an Ascendant, **they no longer see Ascendants at all** for the rest of that run.

## Open questions to settle before building (NOT decided — owner's calls)

- Is "no longer see them" per-Ascendant (the bought one is gone) or per-run (after ONE purchase, all six stop
  appearing)? The note reads as the latter — one Ascendant per run.
- Are the six per-lobby (shared by every seat, one copy contested across the lobby) or per-player?
- Do other seats (recorded snapshots / bots) ever hold Ascendants, and does the lobby's "one copy" apply to them?
- How does the roll interact with the run's pinned set and rolled tribes (`poolOf(state)` / `selectRunTribes`)?
- Reveal presentation: shop-arrival cue (SFX + FX def) and the start-of-game "these six exist" surface.
- Does an Ascendant obey tier gating in the Shop (only offered at or below your Shop Tier) or override it?
- Golden / triple: with a single copy there is no triple path — confirm that is intended.

## Where it would plug in (orientation for a future session, not a plan)

- Roster: a new card family in `packages/content` (data + effect subscriptions, never bespoke classes); set
  membership per `docs/card-sets.md`.
- Per-run subset + single-copy accounting: run creation / shop-offer code in `packages/sim` (`createRun`, the
  shop roll path, the run's `pool` counts — a single-copy card is a `pool[id] = 1` shape with a "never restock"
  rule once bought).
- "Reveals itself" presentation: an FX def in `packages/ui/src/fx/defs` + an SFX with a mixer home
  (`audio/clipFamily.ts`), fired from the shop-refresh path per the choreography skill.
- Start-of-game reveal: a new surface next to the hero/lobby opener.
