# 2026-08-21 — King Oona doubles both stats again; the Conductor arrives

**King Oona** (owner): the 2026-08-12 Attack-only trial is over — a Beast summoned in combat has **both
stats** doubled (gilded triples). One param drop (`attackOnly`) in the shared `onSummonTribeBuffThenDouble`
factory's call; the factory itself needed no change. The three tests that pinned the Attack-only behavior
moved with it, including the post-aura worked example (the 8/10 Cub now takes +8/+10).

**Conductor** — T4 neutral 2/4, Set 2 drawable: *Shout: give adjacent minions +2/+3. Every Conductor played
improves this by +2/+3.* The neutral, positional Squirl Scout: a run-wide weighted trigger count
(`conductorBuff`, ×2 gilded, ×2 Mastery — the exact `battlecryScoutSpread` shape) with the grant =
+(2×N)/+(3×N), improve-first so the first play gives +2/+3. New factory `battlecryConductorAdjacent`,
registered in all three places (union / schema / policies — `ownBeat`, `shout` family). Live-text rule
honored: `conductorText` folds the next-play grant into the first printed "+A/+B" on BOTH chains
(instView + Unit), threaded alongside `squirlScoutBuff` everywhere it travels. Covered by a reducer test:
between-play hits both neighbours, edge-play hits one, snowball and gilded double-weight verified.

Name note: "Conductor" coexists with "Attachment Conductor" (T7) and "Rune of the Conductor" — flagged, owner
proceeded.

**Art**: Conductor (`Set 2 Minions/Neutral/Conductor.png` → `n2_conductor`) and Warden's new hero portrait
(`Heroes/Warden.png`, newer than the repo webp) wired through `optimize-art`.

Gates: typecheck ✅ · lint 0 errors ✅ · 6389 tests / 392 files ✅ · build:web ✅.
