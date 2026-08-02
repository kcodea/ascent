# FX workbench — friction log

Every workaround, gap and papercut hit while **using** the workbench or wiring its output into the game.
Owner ask 2026-08-01: *"be hyper aware of the workarounds we notice, no matter how small"* — the tool gets
tuned by iteration, and friction is the raw material.

**The rule for adding an entry:** if you found yourself doing something the tool should have done for you,
it goes here — even if the workaround was quick and even if it worked fine. "I worked around it and it's
fine" is the thing to report, not the thing to skip. Include what you *wanted*, what you did instead, and
what it cost.

Shipped fixes move to [`devlog.md`](devlog.md) and get struck from this file. This is a queue, not a history.

---

## Blocking — forced code where data should have sufficed

### One binding per moment kind
**Hit:** 2026-08-01, wiring `ruby-gem-apply`.
`bindings.json`'s `kinds` map holds a single binding per moment kind. Both kinds a Ruby can surface in
(`buffWave`, `attackExchange`) already spend theirs on the self-buff cue, so there was no slot.
**Workaround:** wrote a bespoke `rubyFx` cue channel in `score.ts` — code, not data.
**Cost:** the effect is no longer re-bindable from the workbench; swapping the def is a code edit. Any future
effect wanting an occupied moment hits the same wall and pays the same price.
**Fix:** bindings as a LIST per kind. Owner ruling 2026-08-01: *"we need to be able to bind to every moment
type."* In progress.

### The shop phase has no binding surface at all
**Hit:** 2026-08-01, same feature.
Moments, kinds and cues are combat-only — they are slices of the combat event log. A recruit-phase cue has
nowhere to bind, so the shop half of the Ruby effect is a hand-written `useEffect` in `Recruit.tsx` that
watches a run-state field and calls `playDef` directly.
**Cost:** every shop-phase effect needs bespoke React plus (usually) a new run-state signal in the reducer —
i.e. an engine change per effect, in the hottest conflict files. Compare a hand drag onto a minion: as
authored-visual moments go it is at least as important as anything in combat, and it is the *least*
reachable.
**Fix (sketch):** a recruit-side moment vocabulary (`rubyLanded`, `cardPlayed`, `minionBought`, `triple`,
`sold`) emitted by the reducer as a small event list the same way combat emits one, so the same binding
table covers both phases.

---

## Papercuts

### No label / tags editor
The def format carries `label` and `tags` — the library searches and groups by them — but the workbench has
no field for either. They can only be set by hand-editing JSON. (Save silently *deleting* them was fixed in
#805; being unable to *write* them was not.)

### `bindings.json` is reformatted on write
The commit endpoint rewrites the whole file, so an unrelated binding's formatting churns in the diff. Makes
review of a one-line binding change noisier than it should be.

### `clearParticles()` doesn't reach def-driven FX
The global "stop everything" path predates `playDef` and only knows the legacy `pixiFx` channels. A def
fired near a scene transition can outlive it.

### Duplicate can't rename in place
`⧉` loads a def as `<id>-copy`, which is the right default, but there is no rename of an existing def —
renaming means duplicate, retype, save, delete the original, and re-point any binding by hand.

### A signal keyed to the wrong probe looked correct in tests
**Hit:** 2026-08-02, owner report — Frenzied Excavator played no Ruby cue, only the old buff tendril.
The shop signal watched `rubiesOnThisTurn`, which only moves via `fireOnRubyPlayed`. Two live paths never
call it: the tavern-offer path (deliberately) and `battlecryPlayRubiesAll` (apparently by oversight — the
card that plays a Ruby on EVERY minion, i.e. the most visible case there is). Both gaps passed a green gate,
because the tests were written against the same wrong assumption as the code.
**Fix:** probe the `'Ruby'` buff COUNT instead, which every path goes through, and exclude the combat-settle
carry-back. **Lesson for the log:** when a cue is derived from engine state, pick the probe every producer
must touch, not the one the first producer happened to touch. A cue that depends on an optional call is a
cue that will be silently dead for whichever card forgets it.

### The direct-call scanner reads comments
**Hit:** 2026-08-01. A doc comment that *showed* the `playDef('<id>'` pattern registered a phantom def and
failed CI. Deliberate (the scanner doesn't strip comments, so a commented-out call is still visible) and
arguably correct, but it is a trap you can only learn by hitting it. A one-line note in the failure message
would pay for itself.

---

## Ideas from other tools

Unprompted comparisons, per the same owner ask. None of these are requests — they are directions worth
weighing when the relevant part of the tool is next opened.

- **After Effects / Premiere — a real timeline.** Layers today carry `at` and `life` as numbers in a form.
  A dragged timeline with layer bars, where the composition's duration is the extent of its bars rather
  than a separately-typed `duration`, would make "why is the ring late" a glance instead of arithmetic.
- **Houdini / Unity VFX Graph — reusable sub-compositions.** Several defs re-implement the same "hot core
  flash" or "two-ring shockwave". A def that can *include* another def would turn copy-paste into reuse, and
  would mean a tuning pass propagates instead of drifting.
- **Figma — variants over duplicates.** The preset gallery already applies variants to a base. Extending
  that idea to authored defs (a "big" / "small" / "gold" variant of one composition rather than three
  near-identical files) would collapse a lot of the library.
- **Blender / any NLE — onion-skinning and A/B.** Comparing a tweak against the previous save currently
  means remembering what it looked like. Holding a "before" snapshot and toggling would make small tuning
  decisions much faster, and small tuning decisions are most of the work.
- **Every pro tool — a cost readout.** The workbench can count particles and layers; showing an estimated
  worst-frame cost *while authoring* would catch a 220-particle × 7-target composition before it reaches a
  board, rather than after.
