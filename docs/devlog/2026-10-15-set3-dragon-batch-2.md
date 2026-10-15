# 2026-10-15 · Set 3 Dragon batch 2

Owner batch. Set 3 is disabled (Set 2 is live), and Gravestar Seer's archive is in disabled Set 4, so no patch note.

## Content

- Archived **Gravestar Seer** (`ce3_seer`, moved verbatim to `cards/archive.ts`). The archived Runebloom Matriarch
  (`b2_runebloom`) went back to its full name so the new Dragon could be "Matriarch" (no two cards share a name).
- **Chorus Drake, Flutterbutter, Transcendant** join Set 3 by reference (`SET2_DRAGONS_IN_SET3`, appended after
  Set 3's own Dragons; Set 2 unchanged).
- New: Gatherer, Gravus (Dragon + Undead via `tribe2`), Well Watcher (+ Whisper **Well of Dragons**), Matriarch, Woozy,
  Immune Iggy, Hum, Gardener (+ Whisper **Seed**) and the **Drake Pup** token (3/3 Taunt Dragon). Rules in
  `docs/GAME-RULES.md`, oracle rules in `packages/rules/src/registry/approved/gifts.ts`.

Owner change the same day (on the PR): "move gravus & well watcher to t5". Both are Tier 5 now, stats unchanged.

## Engine

- New factories: `rallyGrantRandomTribeMinion` (arena verb `grantRandomTribeMinion`), `deathrattleGiveAttackToOthers`
  (Thane's spread body off a death), `whisperDiscoverTribe`, `avengeGrantRandomWhispers` (combat
  `ctx.grantRandomWhispers`, drawing from every Whisper in the card index; Whispers belong to no set), `whisperKeepOnThis`
  (passive marker), `whisperGrantSeedEcho`.
- **Seed stacks are counters, not grafts**: `BoardCard.seedEchoes` (permanent, Hum) + `seedEchoesTemp` (this turn,
  stripped by `expireWhisperBuffs`), summed into `BoardMinion.seedEchoes` for combat and snapshots. `instantiate` and
  `instanceEffects` expand each stack into its own `deathrattleSummon` effect (`seedEchoEffects`), so each is its own
  Echo with every Echo multiplier. Counters survive triples (summed, `seedEchoMerge`) where `grantedEffects` would not.
- **Hum**: `castSpell` snapshots a Whisper target's temporary marks and `keepWhispersOnHum` makes this cast's share
  permanent while the per-turn count lasts (`HUM_PER_TURN`).
- **Matriarch** in combat hears Rubies: `runeRubyCastCombat` fires `spellCastBuffAll` watchers that opt into Rubies.
- **Immune Iggy** reuses Bounty Bot's `attackImmuneTurns`; new `attackImmuneTurnsGilded` (4).
- UI: `attackImmuneText` (live countdown from the replay's per-body swing count), `humKeepText`, `seedEchoNote`
  ("(xN)" on any body), Seed rows in the buffs panel (Inspect shows "Echo" for a stat-less row).

## Judgement calls to confirm

- Gilded Woozy: 2 Gilded Whispers (Shush's rule), not 4 Whispers.
- Gilded Immune Iggy: 4 immune swings per combat.
- Gilded Gatherer 2 Dragons; Gilded Gravus spreads twice (Thane's convention); Gilded Matriarch +6 Health.
- Hum is Shop-only: a Whisper Whaloo casts on Hum in combat is not kept.
- Hum's text says "each turn" (the owner's clarification), which the original sentence did not.
