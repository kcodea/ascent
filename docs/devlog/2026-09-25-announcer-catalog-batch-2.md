# 2026-09-25 — Announcer: in-fight moments (the moment catalog's second batch)

Owner ruling: in-fight lines play "At the moment", synced to the replay, not after the fight. 17 moments:
FirstBlood, Overkill, WardBreak, Rebirth, RiseBack, AvengeBig, EchoChain, SummonSwarm, TauntWall, Flurry, Pummel,
LastStand, ExecuteKill, ExecuteKing, SameCardDuel, and the final-frame verdicts ClutchWin / NarrowLoss.

- **`announcerCombat.ts`** is a pure fold over the replay's event log (its presentation order), advanced through
  the replay cursor `processedEnd`. `useCombatReplay` now returns `replayEvents` + `processedEnd`; Recruit hands
  them to `observeCombatMoments` once per beat. A cumulative cursor rather than per-event callbacks: a re-seek
  back rebuilds the fold (moments already reached stay reached) so nothing counts twice.
- **Sides.** Most events are uid-only, so the player set is the opening board plus every player-side `summon`,
  as the replay's trigger pulse does. Every moment is the player's ("their" first death, "your" Ward).
- **WardBreak** is the one moment the log cannot say directly (`shield` has no damage or source): the foe from
  the latest attack pairing hits for at least the Ward-holder's Health, read from `computeFrame` at that event,
  folded on demand only when a friendly Ward pops.
- **ExecuteKill / King** read the enemy's Health before the proc from the preceding `dmg` (`remainingHp + amount`).
- **Skip.** `cancelAnnouncer('skip')` mid-fight silences the rest of that fight's in-fight lines (the skipped
  replay jumps to the end and would otherwise queue every line it passed). The final-frame verdicts still speak,
  like the other verdict lines. The next Face Omen resets it.
- **Timing.** Lines ride the combat shelf and the existing opening silence (`ANNOUNCER_COMBAT_SILENCE_MS`): an
  early First Blood waits the few hundred ms left of it instead of talking over the fight's opening.
- **Priorities** proposed mid-table so verdict and standings lines still win when they land together.
- Card-specific combat specials (Grim, Han Gover, Kurse, Lazarus, Wolvie) are left for a later batch.
