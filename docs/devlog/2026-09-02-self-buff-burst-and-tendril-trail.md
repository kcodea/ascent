# 2026-09-02 — the first two replacement buff FX: `self-buff-burst` and `tendril-trail`

Same day as the strip ([2026-09-02-strip-generic-buff-fx](2026-09-02-strip-generic-buff-fx.md)). The owner
authored two replacements in the workbench and they landed on the empty hooks the strip left behind. Two of
the four generic cues are now re-covered; the sourceless descend and the tribe-aura wave are still awaiting
theirs.

## `self-buff-burst` — a binding, on the same three moments

A target-anchored burst (134 gold shards, labelled `detonation`) + one shockwave ring, fired on the minion at
its own centre. It went in exactly where `self-buff-gold` came out — the **kind-level bindings** on
`minionSelfBuffed` (shop), and `buffWave` / `attackExchange` with `fanOut: selfBuffed` (combat, including a
Target Dummy growing as it is hit). Nothing else changed: the moments already fired, they just resolved to
no def.

The golden binding tables, the score's self-buff fan-out tests and `procScan`'s bound-def assertion all flipped
back from "plays nothing" to "plays `self-buff-burst`" — the same tests the strip had flipped the other way.

## `tendril-trail` — a direct call from the one shared buff-other path

A `travel`-anchored ribbon (source → target, `travelMs` 384) plus a small burst at the source. The generic
tendril was never a binding: it fired procedurally through `buffFxRender.fireBuffFx`, the single path both the
combat replay and the shop use, which already receives the source→target pair and sits DOWNSTREAM of every
authored-override check (`authoredBuffDefFor`, `labelBuffFxFor`, `bindingFor(…, 'minionBuffed')`). So the
living-source branch now `playDef('tendril-trail', { source, target })` and a card's own def still wins upstream
— binding a card never draws two effects for one buff. Registered in `DIRECT_CALL_SITES` (`buffFxRender.ts`).

### The roll follows the ribbon

The stat-badge roll is scheduled to land when the ribbon ARRIVES. Rather than pin `384` in code, `fireBuffFx`
reads the ribbon layer's `travelMs` straight from the imported def JSON — so retuning the travel in the
workbench moves the roll with it, and `buffFxRender.test` asserts the returned time equals the def's own value.
The sourceless branch still draws nothing and returns the old descend drop time, so its roll clock is unchanged
until a descend replacement exists.

## A workflow catch worth knowing

The owner's workbench **saves into the worktree its dev server runs from** — here, `.claude/worktrees/scoutcard`
— and the saved files can carry a *different name* from the one agreed in chat (`self-buff-sparks.json`, and a
typo'd `tendtril-trail.json`, appeared beside the files authored from the pasted JSON). A `git add -A` staged
them. Before committing, both were deep-compared against the pasted versions: the tendril was identical
(filename only), the self-buff differed only by the `"name": "detonation"` layer label (carried over). The
stale/typo'd saves were removed rather than shipped as duplicate defs. Rule: always `git diff --cached --stat`
before committing, and compare a saved def against the paste before choosing which is canonical.
