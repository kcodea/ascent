# 2026-09-23 — Milestone-badge FX: stop the blue glow lingering on the wrong units

Owner report: the blue top-tier (≥5000) milestone-badge Pixi ring stuck to units that were not milestone
units — first noticed on opponent boards, later on the player's own board too.

## Root cause

`useMilestoneBadgeFx` (`fx/milestoneBadgeFx.ts`) shows the ring while a **module-global latch** (`reached`, keyed
by card **uid**) says the unit reached the final tier: `active = tier >= FINAL_TIER || hasMilestoneReached(uid)`.
Once a uid latched, it stayed latched for the module's life, and `resetMilestoneLatches()` (which existed) was
**never called** in production.

uids are **per-run sequential counters** (`createRun` restarts the counter), not globally unique. Opponent boards
are pinned snapshots from *other* runs/bots, so their uid strings repeat across fights. A ≥5000 unit latched a
uid; a later, ordinary unit reusing that uid string inherited the latch and wore the ring. Heavy uid collision on
opponent snapshots is why it looked opponent-only at first; low uids reused across the player's own runs bled the
same way.

## Fix (two parts)

1. **Foe units read the live tier, never the latch.** `useMilestoneBadgeFx` takes an `own` flag (default true).
   `Card` exposes an `own` prop; `Unit.tsx` passes `own={!foe}`. For a foe, `active = tier >= FINAL_TIER` and it
   never marks the latch — opponent snapshots are static per fight, so the live tier is authoritative, and a
   reused uid can no longer light up a non-milestone foe. Own units keep the latch-for-life behaviour (a unit
   debuffed below the tier mid-combat keeps its ring).
2. **Clear the latch on every new run.** `resetMilestoneLatches()` now runs in `beginReplayCapture` (store.ts) —
   the one chokepoint every `newRun` / `newLobbyRun` / tutorial / sandbox path shares — so a fresh run's low uids
   never inherit a prior run's latch.

Test: `fx/milestoneLatch.test.ts` covers the per-uid+stat latch and the reset.
