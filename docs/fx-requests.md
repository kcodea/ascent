# FX requests

A queue of effects to build, and the format for asking for one.

**Why this exists.** Building a def and judging a def are different jobs, done best by different people.
Claude can write a def's JSON directly and prove it *loads* — `defs.test.ts` checks every param name and
value range against the primitives' own specs — but cannot judge whether it *looks* right; the headless
preview runs at a degenerate viewport, so a def is shipped without a visual check unless the owner has tuned
it. Several now have been — `coins`, `strike-impact`, `death-dissolve`, `ruby-gem-apply`. Four migrated from
`pixiFx` still have NOT been looked at by anyone: `damage-burst`, `click-puff`, `landing-dust`, `impact-dust`. The owner can judge a look in one second and shouldn't have to dial thirty params from
defaults. So:

| Step | Who | What |
|---|---|---|
| 1. Brief | Owner | Fill in the template below. Two minutes, not a spec. |
| 2. First pass | Claude | Build `defs/<id>.json`, verify it loads + typechecks, commit. |
| 3. Tune | Owner | Dev Menu → 🎨 FX Workbench → **Start from** → `<id>` → tune → **Save**. Save overwrites the same file. |
| 4. Bind | Claude | One entry in `packages/ui/src/choreo/bindings.json` — by moment kind, or by card for a bespoke look. |
| 5. Commit | Owner | The Save wrote to your working tree — it goes in the next commit, alongside the binding. |

Step 3 is the point of the whole tool: the first pass is a starting position, not a proposal. Changing every
number in it is the expected outcome, not a rejection.

**Driving the workbench itself** — the controls, the scenarios, the seed lock, and the save → bind → verify
loop in full — is [`fx-workbench-guide.md`](fx-workbench-guide.md).

---

## The brief template

Copy this block, fill it in, drop it under **Queue** below (or just paste it in chat).

```
### <effect name>
- **id:** kebab-case-id            (becomes defs/<id>.json)
- **Fires when:** which moment — e.g. "a minion is summoned", "a quest completes". Or "nothing yet, just want it".
- **Sits on:** the acting unit / the target / between them / the whole screen
- **Reads as:** one sentence — what a player should think just happened.
- **Feel:** 3–5 adjectives. sharp, heavy, soft, snappy, lingering, violent, gentle, cheap, expensive…
- **Colour:** a palette name, or "the card's tribe colour", or "gold".
- **Lasts:** roughly how long in ms, and whether it has to fit inside an existing beat.
- **Like:** an existing effect it should feel related to — or "nothing we have".
- **Must not:** the failure mode. e.g. "must not read as damage", "must not cover the stat badges".
```

**The two fields that do the most work** are *Reads as* and *Must not*. "A gold ring with sparks" describes
a picture; "the player should think *that minion just got tougher*, and it must not read as damage"
determines the colour, the direction of motion, and half the params.

**Ranges worth knowing when you write "lasts":** the workbench duration dial runs 200–4000ms, and most
combat moments hold for a few hundred ms — an effect longer than its moment gets cut off mid-play. Use
**⇥ Fit to effects** in the transport to see what a composition actually needs.

---

## Queue

Nothing in progress. Seeded below are moments that currently fire no authored def at all — pick one, or
write your own.

### Ideas (moment kinds with no def bound)

`attackExchange` · `damage` · `shieldPop` · `poisonTick` · `death` · `riseDeath` · `summon` · `buffWave` ·
`reborn` · `ascend` · `maxGold` · `improve` · `tribeAura`

Three that would show the most:

- **`summon`** — fires constantly and currently has no authored FX at all. The highest-frequency gap.
- **`ascend`** — a rare, expensive moment that deserves to feel expensive.
- **`maxGold`** — a purely positive economic beat with no visual language yet.

> **`death-dissolve` is NOT an orphan — do not delete it.** It is absent from `bindings.json`, but
> `useCombatReplay.ts` calls `playDef('death-dissolve', …)` **directly**, and it plays for every PLAIN death
> (no Deathrattle, no Rise). It can't be a cue: a cue is picked by moment KIND, and a kind is derived from the
> event alone, which cannot see whether the dying card has an `onDeath` effect — so the call sits in the `else`
> of the skull's own gate, which is what guarantees skull and dissolve never both fire for one unit. Any future
> "wire `death` up properly" pass has to keep that mutual exclusion. (Audited + kept 2026-07-29.)

---

## Known limits to write around

- **`fxScale` is not threaded into the primitives.** A def tuned on a large monitor renders the same pixel
  size on a small one. Don't tune sizes to the edge of what fits.
- ~~**Params are fixed per def.**~~ **Fixed 2026-08-01.** `playDef(id, anchors, { scale, intensity, time })`
  takes per-call axes, so one def covers "same effect but bigger for a bigger hit" — see `strike-impact`,
  which scales off a swing's `power`. **Caution when using `time`:** 13 of 22 defs declare layer windows
  (`at`/`life`), and scaling time can truncate them.
- **Anchors are points, not rectangles.** An effect can be placed at a unit but cannot yet size itself to
  that unit's card.
- **Save is dev-server only.** The write endpoint is a Vite dev plugin (`apps/web/fxDefsPlugin.ts`); there
  is no authoring in a production build.
