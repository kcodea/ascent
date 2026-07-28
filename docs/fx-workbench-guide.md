# The FX Workbench — end to end

How to take an effect from nothing to playing in a real fight. For the *why* behind the tool, see
[`fx-requests.md`](fx-requests.md) (the brief → build → tune loop); for what exists already, open the
workbench's own **Browse all**.

**Dev only.** The workbench, the primitives and the defs are all stripped from a production build —
`canPlayDefs()` is false there. Nothing in this guide affects what players get until someone explicitly
decides to ship the primitives.

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

**Browse all** opens the library through three lenses:

- **by look** — shape, colour, motion, all derived from the defs themselves
- **by event** — every moment kind with its bound def, or *nothing bound*. This is the coverage map
- **by card** — grouped by tribe, showing which cards have bespoke effects

Hovering a row **previews** it on the stage without touching your work. **⧉** duplicates it as a fresh
template.

> **Start from something close.** Hand-authoring a def from scratch is how you end up with a file that
> passes validation and looks like nothing. Duplicating a def that already reads well gets you a working
> starting position and leaves you tuning numbers, which is the part worth your time.

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
[`packages/ui/src/choreo/bindings.json`](../packages/ui/src/choreo/bindings.json):

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

It's a static import, so saving the file hot-reloads — no restart. **There is no UI for this yet**; that's
phase ③ of live authoring. Hand-edit it, or ask Claude for the one-line change.

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

## 9. Commit

`git add` the def **and** `bindings.json` together — a def with no binding is inert, and a binding naming a
def that doesn't exist is a silent no-op that a test will catch but a player never would.

---

## Known rough edges

- **No binding UI** (§7) — hand-edit or ask. Phase ③.
- **No way to preview a binding change against a real combat** without replaying the fight. Phase ②.
- **`fxScale` isn't threaded into the primitives**, and `playDef` takes no per-call params — an effect can't
  yet be scaled or varied per invocation.
- **Anchors are a fire-time snapshot**, so an effect doesn't follow a unit that moves. Deliberate — per-frame
  layout reads are banned — but revisit if a follow-the-unit effect is ever wanted.
- **~30 legacy `pixiFx` effects** predate defs and aren't authorable here.
