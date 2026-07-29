# The FX Workbench — end to end

How to take an effect from nothing to playing in a real fight. For the *why* behind the tool, see
[`fx-requests.md`](fx-requests.md) (the brief → build → tune loop); for what exists already, open the
workbench's own **Browse all**.

**Dev only.** The workbench, the primitives and the defs are all stripped from a production build —
`canPlayDefs()` is false there. Nothing in this guide affects what players get until someone explicitly
decides to ship the primitives. (One deliberate exception: `fx/presets/presets.json`, ~1 KB, rides along in
the bundle — [the appendix](#appendix--why-presetsjson-ships) explains why it can't be stripped.)

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
- **`presets.json` ships in the production bundle** (~1 KB) — see [the appendix](#appendix--why-presetsjson-ships).

### Browse all — start from something already bound

The second route: an existing def that already reads well. **Browse all** opens the library through three
lenses:

- **by look** — shape, colour, motion, all derived from the defs themselves
- **by event** — every moment kind with its bound def, or *nothing bound*. This is the coverage map
- **by card** — grouped by tribe, showing which cards have bespoke effects

Hovering a row **previews** it on the stage without touching your work. **⧉** duplicates it as a fresh
template. Prefer this over the gallery when something close to what you want already plays in the game — you
inherit a look that has survived a real fight, not just a starting position.

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

> **⚠️ The one that bites.** Saving while the seed is locked **bakes that seed into the def file**, and
> `playDef` honours it — so every play in the real game is the identical roll. Every proc of that card,
> forever, the same. Occasionally that's what you want (a signature, exactly-choreographed hit). Usually it
> isn't: repeated procs start reading as mechanical. **Unlock before you Save** unless you mean it. No def
> currently in `fx/defs/` carries a baked seed. The lock state persists across reloads, so it is easy to
> forget it's on.

---

## 6. Save

**Save** writes a real, git-tracked file: `packages/ui/src/fx/defs/<id>.json`. Not a clipboard blob — it
survives a reload, it can be shared by pushing a branch, and it shows up in the library immediately (a
watcher invalidates the module glob, which an eager `import.meta.glob` would otherwise miss until a full
restart). Autosave runs alongside it, so a hot-reload can't eat a tuning session.

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

**Writing `bindings.json` triggers a full page reload** — it's a static import, so it can't hot-reload — which
means the workbench unmounts before you can read a success message. Check `git status` for the two changed
files instead; that's the real confirmation.

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

---

## 10. Commit

`git add` the def **and** `bindings.json` together — a def with no binding is inert, and a binding naming a
def that doesn't exist is a silent no-op that a test will catch but a player never would.

---

## Known rough edges

- **`fxScale` isn't threaded into the primitives**, and `playDef` takes no per-call params — an effect can't
  yet be scaled or varied per invocation.
- **Anchors are a fire-time snapshot**, so an effect doesn't follow a unit that moves. Deliberate — per-frame
  layout reads are banned — but revisit if a follow-the-unit effect is ever wanted.
- **~30 legacy `pixiFx` effects** predate defs and aren't authorable here.
- **Committing writes a full page reload** — the workbench unmounts before a success message can be read;
  check `git status` for the two changed files instead.
- **No editing a def's `label`/`tags` from the panel**, and no unbind affordance — both still hand-edit only.
- **Only two preset archetypes so far** (Bolt, Blast), and both are unreviewed first passes. Eight more are
  queued — wave, chain, cloud, swell, drip, vortex, slam, beam — landing one at a time so each gets judged at
  real card scale rather than eight at once.
- **A commit-success toast can't survive the forced page reload**, `fanOut` is jargon in the binding table,
  and Save doesn't auto-unlock the seed. The rest of the same friction batch that gave rail mode its own
  transport (§9).

---

## Appendix — why `presets.json` ships

Two decisions in this subsystem look like mistakes at a glance. They aren't; don't "fix" them without
reading this.

**`presets.json` is in the production bundle.** Everything else in the workbench is DEV-stripped, so the
obvious question is why this ~1 KB of JSON isn't. Because it's a **static import**, and static imports are
hoisted — a runtime `if (import.meta.env.DEV)` can't gate one the way `fxDefs.ts` gates its `import.meta.glob`
(a glob is a build-time construct the bundler can elide; a plain `import` is not). The asymmetry with
`fxDefs.ts` is therefore real and deliberate, not an oversight. The alternative — a dynamic `import()` —
makes `presetTable()` async and that ripples straight into the gallery overlay's render path, which is a
disproportionate amount of machinery to save a kilobyte.

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
