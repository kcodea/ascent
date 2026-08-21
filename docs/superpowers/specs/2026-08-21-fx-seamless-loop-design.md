# Seamless FX loops — carry-over instead of cull

**Date:** 2026-08-21
**Author:** Mike + Claude
**Status:** Design approved; ready for implementation plan.

## Problem

A looping FX def **blinks** at every loop boundary. The cause is one line in `packages/ui/src/fx/player.ts`:
both loop paths call `killAllLive()` at the boundary, destroying every live particle at once, and the emitter
then rebuilds its field from empty. For an effect whose particle `life` exceeds the composition `duration`
this is glaring — the field drains to nothing before the next cycle starts.

Concrete case: **`cia-hp`** (Cia's enchant treatment, shipped 2026-08-20). It is a single ring emitter,
`duration: 900`, particle `life: 2370`. Under today's `fireLoop`, the pass does not repeat until
`clock >= duration && every particle has died` (~900 + 2370 ms). So the ring emits, then thins to empty over
~2.4 s, then a fresh sparse ring pops in — a visible pulse instead of a continuous stream.

The owner asked for **seamless-loop controls in the FX workbench** so a continuous emit loops without a seam,
and a way for **shaped compositions** to re-trigger with overlap/cross-fade rather than a hard cut.

## Goal

Author-controllable seamless looping in the FX workbench, persisted so the in-game `cia-hp` loops seamlessly,
covering **both** continuous ambient emitters (steady-state stream) **and** finite shaped compositions
(overlapping cross-fade). One authoring surface.

## Non-goals

- No change to the deterministic combat engine, event log, or any gameplay timing. This is presentation-only.
- No new particle primitive. We reuse the existing emitter/smoke/ribbon/burst/shockwave lifecycle.
- No rework of how a caller *decides* to loop (`playDef({ loop: true })` stays the trigger). This is about
  *how* a loop behaves once triggered.

## Approach (chosen: "Loop overlap / carry-over")

Two other approaches were considered and rejected: a separate always-on "Continuous" emitter mode (truest
steady state but a second concept that gives finite comps no overlap), and a minimal "just stop culling at the
wrap" with no author control (smallest surface, but silently changes every looped def and gives no explicit
control). The chosen approach unifies both cases behind one control and confines the engine change to a
well-understood spot.

### Mechanism (`player.ts`)

At a **seamless** loop boundary, instead of `killAllLive()`:

1. **Carry over.** Move the outgoing cycle's live layer instances into a **`finishing` set**. A finishing
   instance **stops emitting** new particles but keeps its existing particles alive; the player ticks it every
   frame and **reaps it once `isComplete()` reports empty**. This is what removes the blink — the previous
   generation fades out naturally while the next is already emitting.
2. **Respawn.** Spawn fresh instances for the new cycle (restarting emission and any per-cycle keyframed state),
   exactly as the current wrap does *after* the kill.

The **loop point** is `def.duration` — the timeline length the author already tunes and that the At/Life
sliders are relative to. In seamless mode the emitter emits up to the boundary, then hands off to the fresh
instance **at** the boundary, so only **one** generation is *emitting* at any instant → no density throb, while
several generations of *particles* overlap → steady-state density. For `cia-hp` that is ~2.6 overlapping
generations → a continuous ring.

### Per-layer nuance

Not every layer is a continuous emitter, so the boundary handling is per-layer:

- **Continuous-capable layers** (`emitter`, `smoke`): in seamless mode they run so that emission is continuous
  across the boundary — the outgoing instance stops emitting and finishes its particles while the fresh
  instance takes over emission. (Implementation detail for the plan: whether that is "run non-`oneShot` and
  never respawn the pure single-emitter" vs. "respawn with carry-over" — TDD will pin the exact path; the
  observable contract is *particle count never drops to zero across the boundary*.)
- **Bounded shaped layers** (`burst`, `shockwave`, bounded `ribbon`): respawn at the boundary with carry-over.
  Their outgoing particles are usually already dead by `duration`; when `life > duration` the tail carries over
  → a natural cross-fade.
- **Continuous `ribbon`** (never self-completes): a finishing continuous ribbon must be told to stop — see the
  finish-out contract below — or it would live in the `finishing` set forever.

### Finish-out contract (primitives)

Add an **optional** `stopEmitting(): void` to the primitive instance interface.

- `emitter` / `smoke`: already stop emitting when their one-shot emit window elapses; `stopEmitting()` flips
  the instance into that "past the window" state so it emits no more and `isComplete()` becomes reachable.
- `ribbon` (continuous mode): implements `stopEmitting()` to end the trail so it can complete.
- `burst` / `shockwave`: bounded already; no `stopEmitting()` needed (the player treats its absence as "already
  bounded, just tick to completion").

The player calls `stopEmitting?.()` on each instance as it moves into the `finishing` set.

## The control: loop mode + signed join

Two **persisted def properties** (owner decision 2026-08-21), plus the existing session Loop toggle:

- **`loopMode: 'playOut' | 'seamless'`** — how this effect loops when looped.
  - `playOut` (default; today's `fireLoop`): repeat only once everything has finished. Kept so a shaped
    one-shot that should fully fade before repeating is unaffected. **Existing defs default to `playOut`, so
    behavior is unchanged for everything already authored.**
  - `seamless`: carry-over as above.
- **`loopJoinMs: number`** (default `0`; signed) — fine-tunes the seamless join relative to the loop point:
  - `0` → hand-off exactly at the boundary (continuous stream).
  - `> 0` → **gap**: delay fresh emission N ms past the boundary (outgoing particles still finish) → a
    breathing pulse. This subsumes today's `loopGapMs`.
  - `< 0` → **overlap**: start the fresh cycle N ms *before* the boundary → a denser cross-fade join for
    shaped bursts. Overlap (negative) is only meaningful in `seamless` mode; in `playOut` a negative value
    clamps to `0`.
  - A **positive** value works in **both** modes (it is exactly today's `loopGapMs` in `playOut`), so
    play-out loses no capability.

*Loop on/off* stays a **workbench preview control** and a `playDef` option — it is a playback choice, not a
property of the effect. `loopMode`/`loopJoinMs` travel with the effect because they describe *how* it should
loop wherever it is looped.

### Persistence & read path

- **Schema** (`defStore.ts` / the zod def schema): add optional `loopMode` and `loopJoinMs` to the stored def,
  with the defaults above. Round-trip them through save/load. Absent fields → defaults (backward compatible).
- **`playDef`**: when `opts.loop` is set, read `stored.loopMode` / `stored.loopJoinMs` (the same way it already
  reads `stored.seed` / `stored.slot`) and pass them to `createPlayer`. No change to the runtime `FxDef`.
- **`cia-hp.json`**: set `loopMode: 'seamless'` (join `0`) so it loops seamlessly in-game.

### Workbench UI (`fx/ui/Workbench.tsx`)

- A **"Play out ↔ Seamless" toggle** editing `loopMode` on the def under edit (persisted on Save), next to the
  existing Loop toggle.
- The existing **"Loop gap"** slider becomes the signed **"Loop join"** slider editing `loopJoinMs`
  (range spans negative overlap → positive gap), enabled only when `loopMode === 'seamless'`.
- Both are def properties now, so they are dirty-tracked and written by Save like any param, and reset/load
  restores them. Publishing tuned values stays explicit (`npm run fx:publish`) — never a side effect of opening
  the tuner.

## Testing

Pure unit tests on the new player branch (no renderer needed — the player is already unit-tested this way):

1. **Anti-blink:** a `seamless` looping emitter with `life > duration` keeps live particle count **> 0** across
   the loop boundary (never drops to zero). This is the core regression guard.
2. **Reaping:** a finishing instance is dropped from the `finishing` set once its particles die (no unbounded
   growth over many cycles).
3. **Signed join:** `loopJoinMs > 0` delays the fresh cycle's first spawn; `< 0` starts it early. Assert the
   spawn time shifts by the set amount.
4. **Mode isolation:** `playOut` is byte-for-byte today's behavior (existing loop tests still pass unchanged).
5. **Teardown:** `stop()` and `destroy()` drain the `finishing` set (no leaked instances/tickers/particles).
6. **Persistence round-trip:** save→load preserves `loopMode`/`loopJoinMs`; absent fields load as defaults;
   `playDef` applies the stored values.
7. **Continuous ribbon finish-out:** a detached continuous ribbon receives `stopEmitting()` and then completes
   (does not live in `finishing` forever).

Plus: `npm run typecheck && npm run lint && npm test && npm run build:web` all green, and a **live owner
eyeball** of `cia-hp` at 1× — the one thing tests can't prove is that it *looks* seamless.

## Files touched (anticipated)

- `packages/ui/src/fx/player.ts` — the `finishing` set + seamless boundary + signed join; teardown drain.
- `packages/ui/src/fx/primitives/*.ts` — optional `stopEmitting()` where relevant (emitter, smoke, ribbon).
- `packages/ui/src/fx/types.ts` (primitive interface) — the optional `stopEmitting()` signature.
- `packages/ui/src/fx/defStore.ts` + def schema — persist `loopMode` / `loopJoinMs`.
- `packages/ui/src/fx/playDef.ts` — read the stored loop fields and pass through.
- `packages/ui/src/fx/ui/Workbench.tsx` — mode toggle + signed join slider bound to the def.
- `packages/ui/src/fx/defs/cia-hp.json` — set `loopMode: 'seamless'`.
- Tests alongside the above.

## Risks

- `player.ts` is a core, heavily-tested, carefully-commented file. Mitigation: `playOut` stays the default and
  byte-for-byte unchanged; seamless is a new branch guarded by mode; the existing loop tests are the guard that
  `playOut` didn't regress.
- The exact continuous-emitter path (never-respawn vs. respawn-with-carry-over) is left to TDD against the
  anti-blink contract rather than pinned here, to avoid over-specifying primitive internals.
- Follow-up already queued and NOT in scope: deleting the dead `ciaEnchantedFx.ts` + `.enchantwisp` CSS.
