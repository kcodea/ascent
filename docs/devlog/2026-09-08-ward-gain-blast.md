# 2026-09-08 — ward-gain-blast: a Ward-gain cue in both phases

Owner authored `ward-gain-blast` in the FX workbench (a 229-shard square burst + a 275px shockwave) and asked
for it "whenever a unit gains ward in any way." It replaces the old `ward-gained` def on the `shieldGain`
binding, and — the new part — gains a **recruit-phase** cue so shop Ward grants finally show something.

## Combat — a rebind

Ward gained mid-combat already emits a `shieldUp` event (8 sites) → the `shieldGain` moment → the bound def.
So combat coverage is one line: `shieldGain` → `ward-gain-blast` (was `ward-gained`).

## Shop — a new recruit moment, UI-side (no sim change)

`grantShield` in the shop just adds the `'DS'` keyword silently; there was no recruit ward-gain cue at all. My
first flag said this needed sim-side emission (Kevin's `packages/sim`), but a **UI-side keyword board-diff**
does it entirely in `packages/ui`, mirroring the self-buff detector:

- A new `shieldGain` `RecruitMomentKind` + `shieldGainMoment(uid, cardId)` emitter (recruitMoments.ts). The
  binding table keys by kind name, so the SAME `shieldGain` binding serves both the combat moment and the
  recruit one — one def, both phases.
- A detector in `Recruit.tsx`: a `Map<uid, hadWard>` diffed each shop render. A uid present last render
  WITHOUT Ward that now HAS it "gained" it and fires the moment; a uid that first appears already warded came
  with it (skip); combat idles the detector (it owns its own `shieldUp` cue). `runRecruitMomentCues` resolves
  and fires the binding generically — no per-kind resolver branch needed.

## Tests

`recruitMoments.test` (the new kind added to the "every declared kind has an emitter" set), `bindings.test`
(golden `shieldGain` → `ward-gain-blast`, both the table and the bloodbinder-fallthrough case), and
`catalog.test` (the FX-library binding map: `ward-gain-blast` is now the def bound to `shieldGain`).

## Left in place

The old `ward-gained.json` is now unbound (orphaned) rather than deleted — it is authored FX, so removing it is
the owner's call, not a side effect of this change. It shows as "unbound" in the library until then.
