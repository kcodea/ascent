# FTUE spike — can the choreographer support the tutorial's presentation contract?

**Date:** 2026-08-17 · **Status:** spike complete, read-only investigation · **Verdict: YES, with one real
gap.** Risk downgraded from HIGH to MEDIUM. Phase 1 estimate drops by roughly a week.

## Why this spike ran first

[`ftue-master-blueprint.md`](ftue-master-blueprint.md) §8.1.4 and §10.6 make the hardest demand in the whole
scope: tutorial coaching must wait for **semantic presentation completion**, never "advance through arbitrary
timeouts while an effect is still playing". It asks for three read-only signals:

```ts
tutorialPresentation.safeBoundary({ kind: 'beforeAttack', sourceUid })
tutorialPresentation.transactionStarted({ id, sourceUid, family })
tutorialPresentation.transactionCompleted({ id, sourceUid, family, resultUids })
```

Every combat lesson in the course depends on these — Rally (R1), Echo (R3), the Echohorn chain (R7), the
Start-of-Combat chain (R9). If the contract can't be honoured, the tutorial either talks over Mike's FX or
hangs waiting for a signal that never arrives. That is a project-level risk, so it was worth answering before
anything else was committed.

## What already exists (more than expected)

**Effect identity is real and broad.** `PRESENTATION_POLICIES` (`packages/core/src/presentation/policies.ts`)
registers **719 keys**, and combat events are stamped with `key` + `srcCard` naming the minion effect that
emitted them (`packages/core/src/types.ts:1880`, choreographer PR 23). The blueprint's `sourceUid` / `family`
fields have somewhere honest to come from — identity does not have to be invented or guessed.

**A transaction contract already exists, by another name.** `choreographer/livePlayer.ts` exposes exactly the
shape §10.6 describes:

```ts
onBeatActivate?: (beat) => void        // ≈ transactionStarted
onBeatComplete?: (beat) => void        // ≈ transactionCompleted
onConsequence?: (delivery, projection) => void
onComplete?: () => void
```

Its correctness invariant is also the one the tutorial needs: *deliver every marker in the half-open window
`(previousMs, currentMs]`* — never "the marker nearest this frame". That means a background tab, GC pause or
slow frame cannot silently drop a beat the tutorial is waiting on. This is the single most reassuring finding
in the spike: the hard part (not losing signals under frame pressure) is solved and tested.

**Authored completion times are compiled, not guessed.** `resolveTiming` yields `completionOffsetMs`, and
`combatHolds.ts` turns a keyed combat trigger into a real hold from the Beat Lab's committed config plus the
LIVE draft. So "the transaction is complete" can mean *the authored envelope elapsed* — which satisfies the
blueprint's intent (Beat Lab stays authoritative; the tutorial never writes timing) without needing every FX
to expose a completion promise.

**Withholding already exists for the exact races the tutorial cares about.** `fx/summonHold.ts` and
`fx/statHold.ts` hold summons and stat changes back so they land with their effect rather than ahead of it —
the same "don't reveal the result before the cause" problem the Predict → Resolve → Confirm cycle has.

## The gap

**Choreographed combat pacing is OFF by default and covers only keyed triggers.**

`combatBeatsEnabled()` returns true only when the Beat Lab's LIVE toggle is on or
`localStorage.ascent.combatbeats === '1'`. And `combatKeyedHoldMs` returns `null` — meaning "keep existing
pacing" — for anything that isn't a quest/rune flag or a stamped minion effect with a policy entry. Its own
header is explicit that this scope is deliberately narrow: only the inter-beat hold, with attack contact,
summon withholding and damage pacing untouched.

So today, in a normal fight, most moments have **no** start/complete signal. `useCombatReplay.ts` runs combat
on its own clock, and its safety nets are TTL fail-open (`COMBAT_HOLD_TTL_MS = 2000`,
`statHold.HOLD_TTL_MS = 1200`) — release-on-timer, which is precisely what §8.1.4 forbids the tutorial from
relying on.

**This is a coverage gap, not an architectural one.** The signals exist and are correct where they apply; they
apply to a subset, behind a dev flag.

## What Phase 1 therefore has to build

1. **A `tutorialPresentation` adapter** over `useCombatReplay` + `livePlayer`, translating existing beat
   activate/complete and consequence deliveries into `transactionStarted` / `transactionCompleted`. An
   adapter, not an invention.
2. **Generalise keyed combat pacing** beyond quest/rune flags, and decide whether the tutorial forces
   `combatBeatsEnabled()` on for `tutorial_lobby` runs. Forcing it on for tutorial runs only is the smaller,
   safer change and keeps normal fights byte-identical.
3. **Declare safe boundaries.** `beforeAttack` / `beforeDeath` / `beforeStartOfCombat` must be emitted from
   the combat replay's existing step loop. These are the blueprint's allowed hold points and none is exposed
   today.
4. **Define completion as "authored envelope elapsed"**, sourced from `completionOffsetMs` — plus a
   fail-safe. The existing TTL nets are the right instinct in the wrong place: the tutorial must never hang,
   so a hold token needs a ceiling. §10.6 already requires release on skip, exit, timeout recovery and
   missing anchor, so a bounded fallback is compatible with the spec — it just must not be the primary path.

## Consequences for the estimate

- Presentation-contract work moves from *invent a new system inside Mike's most intricate code* to *adapt and
  widen an existing one*. **Risk HIGH → MEDIUM**; Phase 1's 4–6 weeks becomes roughly **3.5–5**.
- The residual risk is now concentrated in item 2: widening `combatKeyedHoldMs` changes fight pacing, and the
  owner's stated hard line is *"what i will not do is change order of operations."* Scoping the widening to
  `tutorial_lobby` respects that line completely — normal fights keep today's pacing byte-for-byte.
- Unchanged: every other Phase 1 workstream (providers, gating, anchor registry, focus mask, profile/save).

## What was NOT done

This was a **read-only** investigation — no prototype was built and no code changed. The next honest step is a
throwaway spike that drives one real fight and logs `transactionStarted`/`transactionCompleted` for a Rally
and an Echo chain, confirming the adapter can be built from these signals in practice rather than on paper.
That prototype is Phase 1's first task, not a separate phase.

## Files read

`choreographer/combatHolds.ts`, `choreographer/livePlayer.ts`, `choreographer/resolveTiming.ts` (signature),
`core/src/presentation/policies.ts` (key count), `core/src/types.ts` (event stamping), `fx/summonHold.ts`,
`fx/statHold.ts`, `useCombatReplay.ts` (hold TTLs and clock ownership).
