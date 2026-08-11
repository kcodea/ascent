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

### `ease` has no dial, and the workbench will DROP it on save
**Hit:** 2026-08-10, shipping the def-level ease. The engine half is done and tested (`FxDef.ease`, honoured
by `player.ts`), but `toDef` in `layerModel.ts` rebuilds the def from workbench state, and workbench state has
no field for it. So: a def can only get an ease by hand-editing its JSON, and **loading such a def into the
workbench and saving it silently strips the ease** — exactly the class of bug that `label`/`tags` hit in #805.
**Until the dial lands, do not open an eased def in the workbench.**
**Fix:** the dial. `CurveEditor` in `Inspector.tsx` is already cleanly parameterised (`value`/`vMax`/
`presets`/`onChange`) and just needs exporting; the work is workbench state — a `useState` + ref, the session
snapshot, the history entry, `toDef`/`toStoredDef` passthrough, and a control beside the Duration dial.

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

### An effect fired at where the card WAS, not where it lands
**Hit:** 2026-08-02, owner report — playing Frenzied Excavator shifts every minion along, and the Ruby
detonations all played at the pre-shift positions.
`getBoundingClientRect()` includes the element's own transform, and a card mid-FLIP carries a transform
pinning it at its OLD slot while it tweens to the new one. Every shop cue that anchors to a rect during a
layout change has this bug latent.
**Fix:** a local `restingCenterOf()` using transform-immune `offsetLeft`/`offsetTop` — the same property the
manual FLIP in `Recruit.tsx` already relies on for its baseline capture.
**Gap it points at:** "anchor to a card" is re-implemented at every shop call site, and each one gets to
rediscover this. Combat has `anchorsForUnits`; the shop has nothing, so there is no single place to fix it
once. Folds into the recruit-moment work above.

### `fxScale` is not threaded into the primitives
A def tuned on a large monitor renders at the same pixel size on a small one, so sizes cannot be tuned to the
edge of what fits. (Carried over from `fx-requests.md`'s limits section, which is where it had been recorded.)

### Anchors are points, not rectangles
An effect can be placed AT a unit but cannot size itself TO that unit's card. Directly in the way of the CSS
card layer, whose whole job is to move a card — and of any effect that should frame or outline one.

### Four migrated effects have never been looked at
`damage-burst`, `click-puff`, `landing-dust`, `impact-dust` were moved out of hand-written `pixiFx` methods
into defs and have shipped ever since on the assumption the migration was faithful. Nobody has judged them by
eye. Cheap to check, and the kind of thing that stays wrong indefinitely once it stops being new.

### A backtick in a GLSL comment fails as a TypeScript parse error 40 lines away
**Hit:** 2026-08-10, twice in one session, writing shader comments for the ring curve and then for reverse.
Shaders live in `` /* glsl */ `...` `` template literals, so a backtick in a GLSL comment — the natural way to
write ``the `uEase` uniform`` in prose, and the house style everywhere else — silently ENDS the literal. The
symptom is `TS1005: ',' expected` and *"Module declaration names may only use ' or " quoted strings"* pointing
at whatever GLSL happens to follow, which reads as gibberish because it is being parsed as TypeScript.
**Workaround:** drop the backticks. `shockwave.test.ts` and `ribbon.test.ts` both already assert
`toContain('`')` is false, so it is caught at test time — but only after the confusing typecheck failure.
**Cost:** small each time, but it is a trap with a misleading error and no local hint, and it is unavoidable
for anyone documenting a shader. **Fix:** either an eslint rule naming the real cause, or move the shader
sources into `.glsl` files imported as strings (which also gets syntax highlighting).

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

---

## Requested features — reverse, and easing (owner, 2026-08-02)

Three asks that turn out to share one root cause. Logged together for that reason.

- **Play an effect in reverse** (per LAYER, so rings can contract while shards fly out). Detonation becomes
  gather; summon becomes dissipate. Every authored def becomes two effects.
- **Whole-effect ease in/out** — a curve on the def's clock, i.e. the curve version of the per-call `time`
  scalar `playDef` already accepts.
- ~~**Per-layer speed ease** — a `speedCurve`, alongside the existing `sizeCurve` / `alphaCurve` / `biasCurve`.~~
  **Shipped 2026-08-10** as `Speed / life`.

**The shared root cause.** Particle motion is INTEGRATED per frame (`lp.age += dtMs`) rather than being a
closed-form function of age. The consequence that survives scrutiny:
  1. There is no history to rewind, so a true time-reverse is impossible without a rewrite.
  2. ~~The sim is dt-DEPENDENT — a per-frame drag multiplier…~~ **This was wrong when written** (corrected
     2026-08-10, while shipping `speedCurve`). Burst's drag is `Math.pow(p.drag, dtMs / DRAG_REF_MS)` — a
     per-16.7ms retention renormalised to the real frame delta — and turbulence is an acceleration integrated
     as `* dtSec` in all three primitives. Neither is a raw per-frame multiplier, so "the same effect travels
     a different distance at 30fps and 240fps" does not describe this code. What remains is the ordinary
     semi-implicit-Euler sensitivity to step size, which is a different and much smaller thing.
  3. So reverse and def-level ease stand on their own merits; neither is blocked behind a dt fix.

**Order that gets the most for the least, if these are taken up:**
  1. ~~`speedCurve`~~ — **SHIPPED 2026-08-10.** `Speed / life` on burst, emitter and smoke. See `devlog.md`.
  1b. ~~**The ring's expansion curve**~~ — **SHIPPED 2026-08-10.** Not on the original list, and it should have
     been: `shockwave` already had `ease`, a single `pow` exponent that can only decelerate or only
     accelerate. `Expansion / life` makes it an authored curve (owner asked "why not on ring or trail?").
     **Trail is genuinely out of scope** rather than pending — `ribbon` is path geometry with no velocity
     anywhere in it, and its `widthCurve` runs along LENGTH, not life. Time-shaping a ribbon is what (4)
     would give it.
  2. ~~**dt-normalise drag and turbulence**~~ — **NOT NEEDED**, see the correction above.
  3. ~~**Per-layer `reverse`**~~ — **SHIPPED 2026-08-10**, as the VISUAL reverse this entry specced. One
     note against the original sketch: "spawn at the rim" turned out to be the wrong mechanism. Spawning at
     `emitRadius` only reads as a gather when a def happens to have an emit radius, and most do not. What
     ships instead spawns each particle at the far end of ITS OWN flight (`v * life`) and negates the
     velocity — a straight-line flight is its own inverse, so it works for every emit shape including a bare
     point, and costs no extra RNG draw.
  4. ~~**Def-level ease**~~ — **ENGINE SHIPPED 2026-08-10**, dial still missing. `FxDef.ease` is honoured by
     the player: layers arrive on the eased clock and are ticked with the eased delta, and the def's length is
     unchanged because wrap/completion stay on the raw clock. See the papercut above — until the workbench has
     a control for it, an ease is JSON-only and the workbench will strip it on save.

---

## Next design pass — a CSS/DOM `card` layer (owner, 2026-08-02)

**The ask:** author card motion — jiggle, shove, tilt, fade, pop — INSIDE a def, on the same timeline as the
Pixi layers, so a burst and the card's reaction are one composition rather than two things that only meet in
the running game.

**Why it fits the existing architecture.** A def is already "layers on a shared clock, each with `at`/`life`,
anchored to a unit". Nothing in that says *canvas* — every primitive merely happens to draw into Pixi today.
Anchor resolution already knows the **uid**, which is one `[data-uid]` lookup from the element. A `card`
primitive is a new RENDER TARGET, not a new architecture.

It is also the strongest argument yet for **one effect per moment**: a card jiggle and a gem burst bound
separately can never be previewed together, but as two layers of one def they are authored on one timeline
and seen together in the workbench.

**Use WAAPI (`element.animate()`), not inline styles.** The card is React-rendered, so anything written to
`style` is clobbered on the next commit, and combat re-renders constantly. WAAPI sits outside React's style
attribute, is compositor-driven, self-cleans with `fill: 'none'`, and carries a real timeline —
`playbackRate: -1` is reverse and easing curves are native, so the card layer gets BOTH of the owner's
earlier asks for free, ahead of building either for particles.

**Expose only compositor-safe properties** — `translateX/Y`, `rotate`, `scale`, `opacity`. No `filter`, no
`box-shadow`, no `background`. CLAUDE.md's looping-paint rule then becomes something the tool cannot author a
violation of, rather than something a reviewer has to catch.

**SCOPE — owner ruling: neighbours and whole-board, "as expressive as possible."** So a card layer needs a
target model anchors do not have today:
  - `scope`: `self` | `neighbours` | `allies` | `board` (and plausibly `enemies` for combat).
  - **Falloff by distance** from the anchor (board-index distance), shaped by a CURVE — reuses the existing
    curve widget, so a shove that dies off two cards away is authored, not hardcoded.
  - **Delay by distance**, so the reaction PROPAGATES outward rather than the whole row moving at once. Worth
    noting this generalises the Ruby stagger we hand-rolled: "walk an effect across N units with a gap" turns
    out to be the same primitive twice, and should exist once.
  - Robustness: the target set can change mid-animation (a death, a reorder, a triple). Resolve per-fire and
    skip anything that has left, the same rule the Ruby sweep already follows.

**Open question for that pass:** whether scope belongs to the LAYER (one def mixes a self-jiggle with a
board-wide ripple) or to the BINDING. Layer is the guess — it keeps a def self-contained and previewable.


---

## The numbers arrive as a volley while the effect cascades (owner, 2026-08-02)

**The ask:** stat values and floats should change in step with the animation, not before it.

**Why it happens.** Both phases commit the whole change at once and play the FX afterwards. In the shop the
reducer returns new state and React re-renders every buffed card in one commit — `Card` reads the already-new
`attack`/`health` off its view object. In combat `computeFrame` folds the log to the current beat, so a
`buffWave` carrying seven Ruby buffs applies all seven at the MOMENT boundary. Either way the player is shown
the answer and then watches the explanation.

**The fix (sketch).** A presentation-only WITHHOLD layer: a `Map<uid, {atk, hp}>` of what the display is not
showing yet, subtracted from the card view object before `<Card>` (shop) and from the frame before `Unit`
(combat), and DECREMENTED at each land — one stack's worth per hit, so a 2-stack releases half then half.
Engine and event log untouched; this is the same discipline the replay already runs on.

**The dangerous part, and where to start.** Withheld deltas must ALWAYS converge. An interrupted sweep (skip
combat, phase change, unmount, a card removed, a triple collapsing three bodies) has to flush immediately, or
a card displays a permanently wrong stat — which will read as an engine bug, not a presentation one. Explicit
flush plus a test, before anything else in this piece.

**Alternative considered, for combat only:** advance the replay CURSOR per land instead of per moment — finer
beat granularity rather than a withhold layer. Arguably more correct there, but it touches the timing engine
that drives all of combat, and it does nothing for the shop. Start with the withhold layer; revisit if it
starts feeling like a shadow copy of state.

**Fifth caller.** The release schedule is "walk across N recipients with an offset" again — after the shop
cue, the combat fan-out, stacks, and the CSS card layer. See `land` in `fx-vocabulary.md`.
