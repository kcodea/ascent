# The FX Workbench — end to end

How to take an effect from nothing to playing in a real fight. For the *why* behind the tool, see
[`fx-requests.md`](fx-requests.md) (the brief → build → tune loop); for what exists already, open the
workbench's own **Browse all**.

> **The effects you author here SHIP. The tool doesn't.**
>
> As of **2026-07-29** the def runtime is part of the production bundle: the committed defs, the five
> primitives and their GLSL, and the `ensureDefsReady()` call that registers them. So a def you save and bind
> is a **change to the game players see** — treat it like editing card art, not like poking at a dev toy.
> Judge it at 1× on a real board before you commit it, and remember the binding takes effect for everyone at
> the next merge. Measured cost of the runtime: **+151,602 B raw / +34,206 B gzipped** of total JS (+6.4%) —
> the main chunk grows only +17,829 B / +4,868 B gzipped (the defs); the primitives and their GLSL are the
> other 133,773 B (29,338 B gzipped), in their own chunk fetched lazily on mount, so first paint is unaffected.
>
> What stays dev-only is **authoring**: the workbench UI and everything under the Dev menu, saving a def or a
> binding (they POST to a dev-server endpoint that doesn't exist in a build), and the imported-art glob. The
> practical consequence of that last one: an imported-art shape is bundled only in DEV, so a def referencing
> `art:<slug>` **falls back to a procedural shape for players**. Don't build a bound def around imported art
> until that glob is un-gated too (`fx/shapeLibrary.ts` — its header explains what has to change first).
>
> The three gates that used to hold all of this back, for anyone archaeology-ing a comment: the
> `import.meta.glob` in `fx/fxDefs.ts`, the dynamic `import('./primitives')` in `fx/playDef.ts`, and the
> `ensureDefsReady()` call in `Game.tsx`. All three must be un-gated together — the first two ship bytes,
> the third is what makes them run — and `fx/prodPlayback.test.ts` now fails if any of them comes back.

---

## 0. Start the dev server

From your worktree, never the shared checkout:

```bash
npm run dev
```

Vite picks the next free port if 5173 is taken, so **read the port it prints** — a second dev server on
another branch is the single easiest way to spend an hour testing code you didn't write.

---

## 1. Open it

Dev menu → **🎨 FX Workbench**. It takes over the screen; the game keeps running underneath.

| Control | What it does |
|---|---|
| **Space** | play / pause |
| **F** | 🔥 restart from 0 |
| **Ctrl+Z** / **Ctrl+Shift+Z** | undo / redo — params, timing and layer structure |
| **🎲** | roll a new seed *and lock it* (see §5) |
| **Playback** | preview rate only. **Judge at 1×** — it's what players see |
| **Loop gap** | pause between loops, so a one-shot doesn't blur into its own repeat |

---

## 2. Pick a starting point

**Never start from a blank composition.** Hand-authoring a def from scratch is how you end up with a file
that passes validation and looks like nothing. Both routes below hand you something that already plays, and
leave you tuning numbers — which is the part worth your time.

### ＋ New effect — the preset gallery

The first button in the toolbar. It opens a grid of **archetypes** — what the effect *does* — each offering
a few **variants**:

| Archetype | | Variants |
|---|---|---|
| ⚡ **Bolt** | travels fast and lands hard | thin · heavy · crackling · beam |
| 💥 **Blast** | detonates in place | thin · heavy · crackling |

Hovering a variant **previews** it on the stage; clicking lands it in the editor as a tuned, working
composition, pre-named `<archetype>-<variant>`. Nothing is written to disk until you Save.

A variant is not a second file. It's the archetype's **base def** with a table of multipliers applied to
its **slider params only** — `thin` is `size ×0.6, speed ×1.3, count ×0.7`, and so on — each result clamped
to that param's range and snapped to its step. Params of any other kind (toggle, enum, colour, palette,
curve, shape) have no numeric range, so "multiply it" is undefined: those are left exactly as authored and
reported as *missed* rather than silently half-applied. In DEV, a key that reached nothing on any layer
logs `[fx] preset '<archetype>/<variant>': N key(s) reached nothing` — that's a preset-table bug, not an
authoring one.

> **The two shipped bases are unreviewed first passes.** `preset-bolt` and `preset-blast` are structurally
> correct and validated by tests, but nobody has judged them at real card scale yet. The gallery shell and
> the base *content* ship separately on purpose: a base the owner rejects costs one JSON file, not the
> feature. Tune them in the workbench like any other def — they are ordinary def files.

Three details worth knowing before they surprise you:

- **The bases don't appear in Browse all.** Ids prefixed `preset-` are filtered out of the catalog
  (`PRESET_ID_PREFIX` in `fx/ui/catalog.ts`). Deliberate: Browse all's *by event* lens is the **coverage
  map**, where "nothing bound" is a signal to act on — and the bases are unbound by design, so leaving them
  in would pad that column with permanent false positives. They stay reachable in the rail's **Start from**
  picker, which is the editor's file list. They have to be reachable somewhere, or they could never be tuned.
  What the rail *does* hide is **materialised variants** — ids carrying the `--` separator. Hovering a variant
  registers it (a preview can't play until it exists by id), so without that filter a single sweep across
  Bolt's four variants would add four entries to your file list that you never chose and can't delete. Bases
  have no `--`, variants always do.
- **A materialised variant drops its base's `label`, `tags` and `seed`.** `label`/`tags` are the library
  browser's search + grouping index and the workbench has no editor for them — inheriting would file every
  Bolt-derived effect under words the author never wrote and can't change. `seed` matters more: `loadDef`
  reads it to decide whether to **lock** the seed (§5), so an inherited one would silently hand you a frozen
  composition. A fresh variant starts unlabelled, untagged and rolling free, exactly like any other new def.
- **A variant that only partly landed tells you.** `applyVariant` reports every transform key that reached no
  slider param in `missed`; picking such a variant puts an amber line above the def name / Save row naming
  those keys. The three causes of a miss (no primitive declares the key; the key names a non-slider param; the
  current value can't be multiplied) share **one** bucket on purpose — to an author they all mean *this part of
  the recipe did nothing*, and the difference is a preset-table detail they can't act on. It's a warning, not
  an error: the composition is fully usable. Shown on **pick** only — warning on every card the pointer crosses
  while browsing would be noise.
- **`presets.json` ships in the production bundle** (~1 KB) — see [the appendix](#appendix--why-presetsjson-ships).

### Browse all — start from something already bound

The second route: an existing def that already reads well. **Browse all** opens the library through three
lenses:

- **by look** — shape, colour, motion, all derived from the defs themselves
- **by event** — the coverage map, in two sections: every **moment kind** with its bound def or *nothing
  bound*, then **played from code (no moment kind)** — the defs a `playDef()` call fires directly, listed
  against the files that fire them
- **by card** — grouped by tribe, showing which cards have bespoke effects

Hovering a row **previews** it on the stage without touching your work. **⧉** duplicates it as a fresh
template. Prefer this over the gallery when something close to what you want already plays in the game — you
inherit a look that has survived a real fight, not just a starting position.

#### The wiring badge — three states, because "unbound" was hiding two

Every row in **by look** carries a badge, and the **Wiring** facet filters on it:

| Badge | Means | Example |
|---|---|---|
| **bound** | A moment-kind cue or a per-card override in `choreo/bindings.json` names it. | `ward-gained` |
| **from code** | No binding at all — `packages/ui/src` calls `playDef('<id>', …)` at the site where the thing happens. It plays just as much as a bound def. | `coins`, `strike-impact` |
| **unused** | Nothing binds it and nothing calls it. This one genuinely does not play. | `burst-thin-trail` |

This split exists because the migration out of hand-written `pixiFx` methods left seven constantly-playing
effects (`coins`, `click-puff`, `damage-burst`, `landing-dust`, `impact-dust`, `death-dissolve`,
`strike-impact`) with no binding, and the old single "unbound" label filed them next to dead drafts. If you
are looking for something safe to delete, filter to **unused** — that is the only column that means it.

**Where "from code" comes from, and why it can't rot.** It is not a hand-kept list. `packages/ui/src` is
scanned for `playDef('<literal>')`, the result is committed to `packages/ui/src/fx/directCalls.ts`, and
`directCalls.test.ts` re-runs the scan on every `npm test` and fails if the two disagree — naming the def and
the file. Add a direct call and forget the file and CI stops you; there is no path back to the library quietly
lying. The scan reads whole files, not lines, precisely so a call whose id sits on its own line (`strike-impact`
in `choreo/channels/impact.ts`) is still seen. Its one blind spot — a call whose id is a *variable* — is
printed under the section rather than hidden; today all three such sites are `choreo/score.ts` playing
`binding.def`, i.e. the binding path already listed above, and the test fails if a new one appears anywhere
else.

---

## 3. Stage it

The scenario dropdown decides *where* the effect plays while you tune. This matters more than it sounds: an
effect tuned pinned to the cursor routinely falls apart when it has to cross real distance.

| Scenario | Use it for |
|---|---|
| **One-way (source → target)** | anything that travels. Crosses once, lands, stops — the shape a real attack takes. Pair with 🔥 Fire, Loop off |
| **Bounce between two spots** | watching a travel effect repeat without re-firing |
| **Stationary (in place)** | self-buffs, auras, anything that happens *on* a unit |
| **Pinned to cursor** | judging a shape up close |
| **Real board** | the final check — actual card positions, actual scale |

---

## 3b. Which canvas: **Over** or **Under** the cards

The transport bar carries a **Canvas** toggle. It is a property of the whole effect, not of a layer.

| | draws on | use it for |
|---|---|---|
| **Over** (default) | the full-viewport overlay above every card, badge and piece of board chrome | impacts, strikes, casts, keyword pops — anything that reads as happening *in front of* the board |
| **Under** | a second canvas parked inside the board: above the board art, below every card | ground slams, scorch marks, pools of light, spreading rot — anything that reads as happening *on* the board |

Three things worth knowing before you reach for **Under**:

- **It is beneath EVERY card, not beneath its own card.** The cards are DOM elements and the effect is one
  WebGL canvas, so "behind this minion but in front of the one next to it" is not something the two systems
  can express. Per-card layering is out of scope, not merely unimplemented.
- **The preview backdrop hides itself** while the slot is Under — the whole point is how the effect reads
  against the real board, so the flat colour behind it would only be in the way. Use the **Real board**
  scenario for the honest check.
- **The under canvas is created on first use** and never exists in a session that fires no under-slot effect.
  The first flip of the toggle may therefore take a frame or two to show anything.

Saved defs carry `"slot": "under"`; **Over writes no field at all**, so an effect that never touches the
toggle keeps saving exactly the JSON it always did.

---

## 4. Build the composition

**Add layer** per primitive (trail, burst, shockwave, emitter, smoke). Each layer carries:

- **anchor** — where it lives: `travel` (rides the arc), `source`, `target`, `slot`, `cursor`, `camera`
- **Starts at** / **Lasts for** — its window inside the composition
- **⧉** duplicate · **✎** rename · **✕** remove · **↑↓** reorder · **mute** (hide but keep) · **solo** (run
  this one alone)

`travel`-anchored layers get two more:

- **Arrives at the end** / **Arrives after** — untick to make the head land *early* and linger. This is what
  lets a trail arrive, drain its tail into the stopped head, and then have a burst go off on the arrival
- **Arc** — how far the path bows off the straight source→target line. `0` reads **"Straight"** — a bolt, a
  beam, a thrown spear. The default `0.28` is the whip that makes a trail feel like it's being *thrown*.
  Negative bows the other way

### Aiming a `burst`

A burst's **Spread** (Emit group) is how wide its cone is: `1` is a full circle, `0.18` a ±33° fan, `0` a
single line. **Aim** is which way that cone points — and it is easy to lose an afternoon to, because the
default only does something for a *moving* emitter:

| Aim | Points the cone at |
|---|---|
| **travel** (default) | the emitter's own direction of movement. A burst on a **static** anchor (`target`, `slot`, `cursor`) never moves, so this fans it along **+x, i.e. to the right** — almost never what you wanted |
| **fixed** | the **Angle** you set, in degrees |
| **sourceToTarget** | the **moment itself** — from the `source` anchor toward the `target` anchor, whichever anchor this layer is pinned to |

**Angle is in screen degrees, and screen Y grows DOWNWARD** — so `0` is right, **`-90` is straight UP**, `+90`
is down, `±180` is left. The slider is greyed out unless Aim is `fixed`, and none of it does anything at
Spread `1` (a full circle has no centre to aim).

`coins.json` is the worked example for `fixed`: two layers, both `fixed` at `-90`, one at Spread `0.18` for the
coins and a wider `0.28` for the glints, with gravity pulling the arc back down.

**`sourceToTarget` is how a def gets a direction it can only learn at fire time.** There is no per-call angle
and there will not be one — a def four callers each bend differently stops being a committed composition — so
direction is expressed as *geometry* instead, in the two anchors the caller stages. `strike-impact.json` is
the worked example: the melee smack fans its sparks along the blow, and `playContactImpact` stages `target` at
the contact point and `source` at that point walked **back** along the attacker→defender vector. The cone then
points at the defender however the attacker came in.

Two things to know when you author on it:

- **It is the same vector for every layer**, taken from the staged anchors — not from where a layer happens to
  sit. Pin a layer at `slot` and it still blows along the blow.
- **It falls back to `travel`** (i.e. `+x` for a static anchor) when the fire staged only one of the two
  anchors, or staged both on the same spot. A workbench scenario that stages a source and a target will
  preview it; one that doesn't will show you the `travel` fallback, not an error.

### How far the sliders go

The physics ranges are wide on purpose — you are meant to be able to be **stupid** with them and dial back.
Burst speed reaches **3000 px/sec** (a shard crosses the card in a couple of frames), gravity **±4000**
(`coins` throws at ~1700 for a real ballistic lob), life **6 s**, count **400**, size **200 px**. Smoke and
the emitter reach **1200 motes/sec** — which is their hard live-mote cap, so the slider now goes as far as
the primitive does — and an **8 s** lifetime. Shockwave rings reach **2000 px** across and **12** rings;
ribbons reach **2400 px** long, **600 px** wide, with a **300 px** wave amplitude.

Some sliders are deliberately *not* wide, and it is worth knowing which so you don't go looking:

- **Ratios and fractions** — Spread, Speed var, Size var, Inherit vel, Core bias, Field mix, Glow, Alpha,
  Plateau, Squash, Fade in. `0..1` is the whole meaning; there is nothing past it.
- **Drag** (`0.7..1`) is a per-frame retention factor. Above 1 a shard accelerates forever; 0.7 already stops
  one in about a frame.
- **The Texture/Noise group** (Bands, Noise scale, Warp, Scroll, Erode, Gain, Turb scale) is a tuned window —
  both ends are already extreme, and past them it stops reading as material and starts reading as noise.
- **Shockwave Thickness** (`≤0.3`) has a real geometric ceiling: the ring is drawn on a quad 1.45× its radius,
  and a thicker band clips flat against that boundary along with its glow. Want a fatter ring? Raise
  **Radius**, or add a second ring — not Thickness.

### Authoring the fade

Every particle primitive has a **built-in opacity envelope** underneath the **Alpha / life** curve — the two
multiply. Both halves are yours:

- **`burst` → Fade** (Style). An exponent on the shard's remaining life. `2` is the default and the classic
  snappy fall-off, `1` is linear, `4` is a hard flash, and **`0` turns it off entirely** — shards hold full
  opacity until they die and Alpha / life becomes the whole envelope.
- **`emitter` / `smoke` → Fade in** (Style). These fade differently: a *symmetric* ramp in at the start and
  out at the end, and this is its width as a fraction of life. **`0` turns it off** the same way — motes pop
  in at full opacity and hold it, leaving Alpha / life in charge.

If you have ever flattened Alpha / life to `1` and watched particles fade anyway, this is the knob you were
looking for.

### Sizing an effect at the moment it fires — `scale`, `intensity` and `time`

A def is a **fixed** composition, and that is deliberate: what you committed is what plays. But some effects
have to know something you can't know while authoring — how wide *this* card is, how hard *this* hit landed.
Three per-call dials carry exactly that, and nothing else:

```ts
playDef('landing-dust', anchors, { scale: cardFxScale(w), intensity: 1.5 });
playDef('impact-dust', anchors, { intensity: cfg.dustCount, scale: cfg.dustSize, time: cfg.dustLife });
```

| Dial | Means | Reaches |
|---|---|---|
| `scale` | **bigger** — geometry | params measured in px or px-per-time: `size`, `emitRadius`, `speed`, `gravity`, `turbulence`, `radius`, `length`, `width`, `waveAmp`, `drain` |
| `intensity` | **more** — quantity | params that count things: burst `count`, emitter/smoke `rate`, shockwave `rings` |
| `time` | **longer** — duration | the whole temporal frame (below): burst `life`/`interval`, emitter/smoke `life`, shockwave `speed` (inversely), plus every layer's `at`/`life`/`travelMs` and the def's `duration` |

All three default to `1`, and **`1` is an exact no-op** — the def isn't even copied, so nothing you authored
moves and a locked seed replays identically. `0`, a negative number and a non-finite number are all caller
error and fall back to `1`.

A param responds to a dial only if its spec says so (`axis: 'scale'` / `'intensity'` / `'time'` /
`'timeInverse'` in the primitive's `SPECS`, sliders only). Ratios, colours and style params ride none of them
on purpose, and so do spatial *frequencies* like Turb scale and Noise scale — those are `1/px`, so they would
have to scale *inversely*, which one multiplier can't do. Adding a dial to a param is a one-line spec change;
adding a whole new dial is not, and should be argued for rather than assumed.

> ⚠️ **Scaling is clamped, so it is NOT linear at the extremes.** Every scaled param is held to its own
> slider range. If `size` is authored at 34 of a possible 40, `scale: 10` moves it to 40 and stops — the
> effect grows 1.2×, not 10×. Durations are no different: burst `life` maxes at 1500, so a def authored at
> 450 stops growing at `time: 3.3`. **If you want an effect to have real headroom on a dial, author its base
> value well below the ceiling.** "I doubled the dial and it barely changed" is almost always this.
> (One exception, deliberately: a **layer window** has no declared range, so it is never clamped — it has to
> be free to follow the longest thing inside it.)

`landing-dust.json` is the worked example for `scale`: one burst layer, authored for a reference-size card
(`FX_REF_CARD_W` = 222px, see `fx/cardScale.ts`), fired at `scale: cardFxScale(w)` so it tracks the real card
and — at the Recruit placement site only — `intensity: 1.5` for a thicker cloud. `impact-dust.json` is the
worked example for all three at once (End Turn / Tavern Up / Refresh each dial count, size and lifetime).

#### `time` is not `speed`, and it moves more than params

`speed` rescales the playback **clock**: at `speed: 0.5` everything runs at half rate, so particles also
*move* half as fast and cover the same ground. `time: 2` holds the velocities and stretches the durations, so
particles live twice as long and therefore **travel twice as far**. Both are legitimate; reach for `time`
when you want an effect to *hang* longer, and `speed` when you want it in slow motion.

The reason `time` isn't just a param transform: **two different things in this system are called "life"** —
a layer's `life` (its window: how long the layer exists) and a primitive's `life` param (one particle's
lifetime). `playDef` fires one-shot, and a layer that declares a `life` is bounded by that window. So `time`
rescales the **whole temporal frame together** — every layer's `at`, `life` and `travelMs`, the def's
`duration`, and the duration params — or particles would outlive a window that hadn't moved and be cut off
mid-flight with no error anywhere. (`bow` is left alone: it's a shape, not a time.)

Two consequences worth knowing before you dial it:

- **`rate` deliberately does NOT ride `time`.** It stays on `intensity`. So a stretched `emitter`/`smoke`
  emits proportionally **more** motes — a one-shot's emit window *is* its `life` — which is what "the same
  plume, for longer" should look like. If you want longer-but-not-denser, pass `intensity: 1 / time` too.
- **A `burst`'s particle count cannot move on this axis**, by construction: `time` reaches no `count` param,
  so a locked seed replays the identical roll at any `time`. Only the shards' lifetimes change.

---

## 5. The seed — lock it while tuning

Every primitive's randomness (launch angles, speeds, lifetimes, jitter) comes from a seeded PRNG, not
`Math.random`. The seed is where that stream starts.

- **Unlocked** (default): each spawn rolls fresh, so every Fire looks slightly different.
- **Locked** (🎲): the player holds one base seed and every layer derives its own from it. Same seed,
  identical roll, every time.

**Lock it before you tune anything.** Unlocked, you nudge a param, hit Fire, and cannot tell whether what
changed was your edit or the dice. You end up tuning against noise. Locked, the only variable is the one you
touched.

Two details:

- Layers derive their seeds with a stride of **7919**, a large prime — not `+1`. Mulberry32 seeds one apart
  produce correlated streams, so a burst and a smoke plume would emit in near-lockstep and read as a bug.
- A seed change applies to the **next** spawn. It won't restart an effect mid-play.

> **⚠️ Saving while the seed is locked bakes that seed into the def file**, and `playDef` honours it — so every
> play in the real game is the identical roll. Every proc of that card, forever, the same. Occasionally that's
> exactly what you want (a signature, exactly-choreographed hit). Usually it isn't: repeated procs start reading
> as mechanical, because the eye learns the pattern. No def currently in `fx/defs/` carries a baked seed.
>
> **You will be told, at both places that write a seed.** For as long as the lock is on, an amber line naming
> the exact seed and what baking it means — with a one-click **Unlock** beside it — sits directly under the
> **Save** button *and* directly above **Commit animation** in the rail panel. One shared `SeedBakeWarning`
> component, rendered twice, deliberately: Save lives in `.fxwb-side` and Commit in `.fxrail`, two columns that
> scroll independently, so a warning next to Save says nothing about a Commit happening with it scrolled out of
> view — and Commit is the path that matters more, since it writes `bindings.json` and makes the effect live.
> It renders on the *lock state*, not after a write attempt, so neither button can be reached without it having
> been on screen.
>
> Save deliberately does **not** auto-unlock. That would silently change what gets written and would break the
> signature-hit case outright. Making the hazard visible at the moment of decision is the fix; the decision
> stays yours.

---

## 6. Save

**Save** writes a real, git-tracked file: `packages/ui/src/fx/defs/<id>.json`. Not a clipboard blob — it
survives a reload, it can be shared by pushing a branch, and it shows up in the library immediately (a
watcher invalidates the module glob, which an eager `import.meta.glob` would otherwise miss until a full
restart). Autosave runs alongside it, so a hot-reload can't eat a tuning session.

**Imported art is saved with it.** A PNG/SVG you imported into the `shape` picker lives only in *this*
browser (`custom:<slug>`), so Save uploads it to `packages/ui/src/fx/defs/art/<slug>.png` and rewrites the
layer to `art:<slug>` — that is what makes the def render the same on the other developer's machine. Both the
art glob and the def glob are watcher-invalidated, so a shape you imported this session survives a reload
without restarting the dev server; the library additionally keeps a pointer to the local import as a
belt-and-braces (never a second copy of the bytes). If the import is later *removed* from the picker, that
pointer goes with it — but by then the committed PNG is on disk and the glob is the resolver anyway.

---

## 7. Bind it

**Saving makes an effect exist. It does not make it play.** Which def plays at which moment is data, in
[`packages/ui/src/choreo/bindings.json`](../packages/ui/src/choreo/bindings.json). The fastest way to write
it is the live flow, from **Watch in combat** rail mode (§9): pick a card and a moment from the proc list,
and your current composition becomes *what that card plays* immediately — it resolves in memory through the
same session patch phase ① built, before anything touches disk. Tune a slider, re-seek the moment on the real
board, watch the real card react. Nothing is written until you press **Commit animation**, which offers two
scopes:

- **This card** — forks the def to `<name>-<card>.json` and binds only that card's row. Use this whenever
  you've been editing a def that other cards also use; binding it card-scoped *without* forking would change
  their effect too, which is never what "commit for this card" means.
- **Everywhere** — overwrites the def file in place and binds the kind row, so every card that produces this
  moment picks it up.

The panel shows the resulting def id and how many bindings the commit will touch *before* you press anything
— read it, because "I overwrote the shared one by accident" is unrecoverable once you've forgotten which
numbers you changed. The commit order is fixed: the def file writes first, `bindings.json` second, so a def
failure changes nothing and a binding failure leaves only an unbound def (inert, not silently wrong).

**A commit forces a full page reload, and BOTH its writes cause one.** `bindings.json` is a static import Vite
can't hot-reload; the def file lands in the globbed defs directory, where `fxDefsPlugin` answers an `add` by
invalidating the glob owner and sending `full-reload` outright — and a `change` reloads too, since nothing in
the import graph sets up an `import.meta.hot.accept` boundary. So the reload is set in motion by the **first**
write, not the last, and the workbench unmounts before the `Committed → …` line can paint.

The note is therefore parked in `localStorage` **as soon as the def write succeeds** — before the
`await saveBindings` round trip, because Vite's client can call `location.reload()` at any point during it, and
parking afterwards means a reload timed inside that await leaves nothing parked and no banner at all.

Crucially that mid-flight note is **amber and does not claim completion**:
`Commit STARTED → <def> · def written, binding not confirmed`. It survives only when a reload lands in the very
window where the binding may never have been written, so opening it with `Committed →` in success green would be
character-identical to full success in exactly the half-done case — the author reads "done" and then finds the
effect doesn't fire. The success path overwrites it green a round trip later, so on a normal commit the amber is
never seen; it persists only when it is true.

Every other exit corrects it too: a failed binding write parks
`Commit INCOMPLETE → <def> was written but its binding was not: …` (the def *is* on disk, so silence would
misreport an orphan file the author wouldn't know to `git checkout`), and a thrown commit parks the equivalent.
Art-upload failures are **folded into the parked text** and hold it amber, because the in-component error line
dies with the component — without that, the one case where something went wrong would be the case whose
surviving evidence looks clean. The key is cleared at the start of every commit and again as the banner is read,
so it appears exactly once and a stale line can never be presented as this commit's confirmation. A note older
than ~10 minutes is prefixed `Earlier — `; older than a day it isn't shown at all.

**Be precise about when you see it.** The banner appears the next time the workbench is *opened*, not the
instant the page reloads. The reload closes the workbench (it's mounted from `DevMenu`, whose state resets), so
the confirmation waits in storage until you reopen it. That's a real limitation, not a bug: the alternative is
persisting the whole DevMenu open-state across reloads, which is a much bigger change than this fix warranted.
`git status` on the two changed files remains the instant cross-check.

Hand-editing `bindings.json` still works and is sometimes faster for a small tweak:

```jsonc
{
  "version": 1,
  // by moment KIND — every card that produces this moment plays it
  "kinds": { "shieldGain": { "def": "ward-gained" } },
  // by CARD, then kind — narrower, and wins over the kind above
  "cards": { "bloodbinder": { "scCast": { "def": "ruby-lance", "fanOut": "damaged" } } }
}
```

`fanOut` decides which anchor pairs it plays at:

| value | meaning |
|---|---|
| `primary` (default) | once, at the moment's own source→target pair |
| `damaged` | once per distinct unit damaged in the same resolution step — for a cast whose own event names no target |
| `selfBuffed` | once per unit that buffed *itself* this moment |

It's a static import, so saving the file hot-reloads — no restart.

---

## 8. Verify in a real fight

Play a combat with the console open. The binding path announces itself:

```
[fx] 'bloodbinder' → 'ruby-lance' ×2  ['uid-a','uid-b']
```

and **warns** when a binding matched but found no targets. Silence where you expected a line means it never
resolved — that's the diagnostic, not a formality. Nearly every failure in this subsystem has presented as
"nothing happened", which is indistinguishable from "never wired", so the log is often the only difference
between a five-minute fix and an afternoon.

To fire a def on demand without waiting for its moment:

```javascript
await window.__fx.ready();
window.__fx.list();
window.__fx.play('ruby-lance', window.__fx.anchors('<sourceUid>', '<targetUid>'));
```

---

## 9. Watch in combat (rail mode)

The **Watch in combat** button (top toolbar, next to "Browse all") collapses the editor to a narrow rail
along one side and hosts the proc harness in the space it vacates: pick a card, stage a controlled fight
against tunable sandbags, get the list of moments that card actually caused, and seek the replay to any one
of them on the real board. Click **Full editor** to collapse the harness back and restore the full workbench.

While in rail mode both bars are hidden: `.fxwb-rail .fxwb-top { display: none }` takes the seed lock, the
backdrop swatches, the fps readout **and the workbench's close button** with it, and
`.fxwb-rail .fxwb-transport { display: none }` takes the Timeline, the duration/loop/playback dials and the
seed row. Neither is a trap. The mode toggle itself lives in `.fxwb-side`, which stays visible, so "Full
editor" gets you back to all of it (and to ✕) in one click.

The two controls you actually need *while watching* — retrigger and scrub — do not wait for that round trip:
the rail carries its own compact **`.fxwb-railtransport`** (▶/⏸ · 🔥 Fire · the scrubber, no Timeline) pinned
sticky to the bottom of the rail, calling the same `togglePlay` / `fire` / `scrub` handlers as the main bar.
The full transport stays hidden rather than being unhidden here for a layout reason: it is
`position: absolute; left: 0; right: var(--fxwb-rail); bottom: 0` and is built around the full-width
Timeline, so it would paint a band straight across the board this mode exists to show.

**Those three controls and nothing else is a deliberate call** (owner ruling, 2026-07-29). The rail bar is not
a miniature of the transport and shouldn't grow into one — the point of rail mode is the board, not the dials.
One known consequence: the 🔒 seed toggle isn't there, so in rail mode you can **unlock** a seed (via the
warning's Unlock button, which is present next to Commit) but not re-**lock** one. Click **Full editor** for
that. Accepted, not an oversight.

---

## 10. Commit

`git add` the def **and** `bindings.json` together — a def with no binding is inert, and a binding naming a
def that isn't committed is a silent no-op: `bindings.test.ts` catches it, but nothing at runtime says a word
(the "no committed def" warning is DEV-only, since a player can't act on it).

**What you commit, players get.** Since the un-gate the def runtime ships, so a binding merged to `main` is a
visible change to the game — the same bar as any other player-facing change. Judge it at **1×** on a real
board first (§8), and say so in the PR body: a reviewer reading a two-line JSON diff has no other way to know
the fight now looks different.

The `Committed → <def> · <path>` confirmation survives the reload the write itself forces, and appears the next
time you open the workbench — see §7 for exactly how and for the timing caveat.

---

## Known rough edges

- **`fxScale` isn't threaded into the primitives**, and `playDef` takes no per-call params — an effect can't
  yet be scaled or varied per invocation.
- **Anchors are a fire-time snapshot**, so an effect doesn't follow a unit that moves. Deliberate — per-frame
  layout reads are banned — but revisit if a follow-the-unit effect is ever wanted.
- **~30 legacy `pixiFx` effects** predate defs and aren't authorable here.
- **Committing still costs you a page reload** (`bindings.json` is a static import Vite can't hot-reload), and
  the reload closes the workbench. The confirmation now survives it (§7) but waits until you reopen the tool.
- **No editing a def's `label`/`tags` from the panel**, and no unbind affordance — both still hand-edit only.
- **Only two preset archetypes so far** (Bolt, Blast), and both are unreviewed first passes. Eight more are
  queued — wave, chain, cloud, swell, drip, vortex, slam, beam — landing one at a time so each gets judged at
  real card scale rather than eight at once.

---

## Appendix — why `presets.json` ships

Two decisions in this subsystem look like mistakes at a glance. They aren't; don't "fix" them without
reading this.

**`presets.json` is in the production bundle**, even though the gallery that reads it is DEV-only. Because
it's a **static import**, and static imports are hoisted — a runtime `if (import.meta.env.DEV)` can't gate one
the way a glob can be gated (a glob is a build-time construct the bundler can elide; a plain `import` is not).
The alternative — a dynamic `import()` — makes `presetTable()` async and that ripples straight into the gallery
overlay's render path, which is a disproportionate amount of machinery to save a kilobyte.

This used to be *the* odd one out, back when the def runtime was DEV-stripped. Since the 2026-07-29 un-gate it
isn't: the defs and the primitives ship on purpose, and `presets.json` is just one more kilobyte of authoring
data riding along. It is still the only piece that ships **without** a player-facing reason, which is why the
paragraph stays.

**`parsePresetTable` throws; `choreo/bindings.ts` deliberately does not.** The two files use the same
hand-rolled validation style (no zod in `ui`) and reach opposite conclusions on failure, on purpose:

- `bindings.ts` **ships and runs** in the production bundle, so a malformed entry there must degrade — one
  dropped binding is a missing effect, recoverable. It uses `devError`.
- `presetTable.ts` backs a **menu**. A half-loaded table is a silently incomplete gallery: archetypes just
  aren't there, with nothing to tell the author why. So it throws.

That is safe **only because the parse is lazy**. `presetTable()` parses on first call and caches
(`fx/presets/index.ts`), and the only caller is the DEV-only gallery — so in production the parse never runs
and the throw can never fire. Make the parse eager (`const TABLE = parsePresetTable(raw)` at module scope)
and a bad JSON edit becomes a hard crash at module load for every player. The laziness is load-bearing.
