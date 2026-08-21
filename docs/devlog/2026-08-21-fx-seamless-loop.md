# 2026-08-21 — Seamless FX loops (fixes the `cia-hp` blink)

Follow-up to the 2026-08-20 card-following `cia-hp` enchant treatment: once that def looped continuously,
the owner noticed a visible **blink** at every loop boundary. The old loop culled every live particle the
instant a cycle ended, then waited for `fireLoop` to schedule the next pass — and because `cia-hp`'s
particles are long-lived (`life: 2370` against a `duration: 900` cycle), the boundary read as a hard cut
followed by a re-fill, not a continuous emit. This branch (`feat/fx-seamless-loop`, six prior commits) built
a carry-over loop boundary end to end and this task turns it on for `cia-hp`.

## What shipped (across the branch)

- **`stopEmitting()` primitive contract** (`packages/ui/src/fx/primitive.ts` +
  `primitives/emitter.ts` / `smoke.ts` / `ribbon.ts`) — a primitive can now be told to stop spawning new
  particles while letting its already-live ones finish naturally, distinct from immediate teardown.
- **The seamless loop boundary itself** (`packages/ui/src/fx/player.ts`) — at a loop point in seamless mode,
  the outgoing instance is moved into a `finishing` set and told to `stopEmitting()` instead of being culled;
  a fresh instance starts immediately alongside it, and the outgoing instance drains and reaps itself once
  its particles naturally die out. Play-out mode (the old behaviour — cull everything, wait for the gap) is
  unchanged and stays byte-for-byte.
- **Signed `loopJoinMs`** (`player.ts`) — one signed knob replaces the old gap-only concept: positive means a
  gap in *both* modes (subsumes the old `loopGapMs`), negative means an overlap that is **seamless-only** —
  the fresh cycle starts `|ms|` early by lowering the loop-point threshold, producing a cross-fade instead of
  an edge-to-edge join. `setLoopGap` remains as a back-compat alias forwarding to `setLoopJoin`.
- **Persisted def fields** (`packages/ui/src/fx/defStore.ts`) — `loopMode` (`'playOut' | 'seamless'`) and
  `loopJoinMs` round-trip through the def schema, omitted from the JSON when left at their defaults
  (`playOut`, `0`) so untouched defs stay byte-identical.
- **`playDef` reads them** (`packages/ui/src/fx/playDef.ts`) — a def's stored `loopMode`/`loopJoinMs` are
  applied automatically when it's played on loop, with no caller-side wiring needed per def.
- **Workbench controls** (`packages/ui/src/fx/ui/Workbench.tsx`) — a "Play out ↔ Seamless" toggle and a
  signed "Loop join" slider so the owner can author and tune the boundary live per def.
- **`cia-hp.json` flipped to `loopMode: "seamless"`** (this task) — the shipped enchant-treatment def now
  loops continuously with no blink. `loopJoinMs` was left omitted (0 is the seamless default, i.e. an
  edge-to-edge carry-over with no cross-fade); the rest of the file is untouched.

## Why

`cia-hp`'s particles intentionally outlive one loop cycle (a slow drifting ring of spade motes), which is
exactly the case the old cull-at-boundary loop handled worst: every particle vanished at once, then
`fireLoop` waited out the survivors' lifetime before the next cycle visibly filled back in. Carrying the
outgoing instance over — draining instead of culling — removes the visible seam without changing how any
non-looping or play-out-mode def behaves.

## How verified

- Per-task TDD in `packages/ui/src/fx/player.test.ts`: the anti-blink carry-over contract (outgoing instance
  gets `stopEmitting()` and is NOT destroyed that frame while a fresh instance exists), the drain/reap of a
  finished carry-over instance, and the signed `loopJoinMs` gap/overlap behavior in both modes.
- `packages/ui/src/fx/primitives/emitter.test.ts` / `smoke.test.ts`: `stopEmitting()` contract per primitive.
- `packages/ui/src/fx/defStore.test.ts`: `loopMode`/`loopJoinMs` round-trip, omitted at defaults.
- `packages/ui/src/fx/playDef.test.ts`: a def's stored loop fields are applied when played on loop.
- `packages/ui/src/fx/defs.test.ts` + `shapeLibrary.test.ts`: schema accepts `loopMode` on `cia-hp` (task 7,
  this entry) — both green after the JSON edit.
- Full gate for this task: `npm run typecheck && npm run lint && npm test && npm run build:web`, all green
  (see the task's own verification record for exact output).
- The play-out path was checked to stay byte-for-byte across every change (no regression to the pre-existing
  loop behavior for defs that don't opt into `seamless`).
- **Not yet done:** a live owner eyeball at 1× in a focused Chrome tab (a Pixi canvas can't be rAF-sampled in
  the headless preview) — that, plus push/PR/CI/merge, is queued as the branch's final step and is out of
  scope for this task.

## Follow-ups

- Delete the now-dead `ciaEnchantedFx.ts` and the unused `.enchantwisp` CSS, both superseded by the `cia-hp`
  def (tracked in `docs/roadmap.md`).
- Minor UX: grey out the Play-out/Seamless toggle (and the Loop-join slider) in the workbench when Loop
  itself is off, so it's clear the controls have no effect until looping is enabled.
