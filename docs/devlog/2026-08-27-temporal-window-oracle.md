# Per-instance temporal-window oracle — the #1176 class caught (Docbot PR 3)

Workstream B of the Docbot next-iteration handoff (§5), the highest-priority correctness gap: the one
measured retro miss was #1176's per-instance Avenge counter window. It is now caught **generically** —
the retro catalog stands at **14/14** (was 13/14).

## What shipped

- **Eleven owner rulings encoded** (handoff §5.0, rulings of 2026-08-26) as approved rules
  `R-AVWIN-01…11` in `packages/rules/src/registry/approved.ts` — window opening/closing, the summoning
  death, exact/plain copy semantics, gilded progression additivity, per-death counting, resolution-only
  multipliers, Rise's fresh window and base-Attack/1-Health return, and batch-death semantics. Each rule
  records `currentBehaviour` against today's engine.
- **Provenance telemetry** (§5.3): `setAvengeWindowObserver` in `packages/core/src/effects/factories.ts`
  taps `avengeCountFor` — the single chokepoint every minion-level avenge factory counts through — and
  reports source instance (uid/cardId/side), entry sequence (`baseline`), observed event sequence
  (`count`), and the in-window counter (`seen`). Purely observational: undefined outside tests, no event
  or gameplay change; determinism/golden suites and `npm run harness` are untouched.
- **The scenario family** (§5.4): `packages/sim/src/docbot/temporalWindow.test.ts` — all ten shapes,
  through the real `simulate()` (mid-combat temporal staging) plus two checked-in `QaScenarioV1` fixtures
  for the copy shapes (`avenge-window-exact-copy` — Xerox's exact copy inherits `summonBonus`;
  `avenge-window-plain-copy` — Bellringer Voss's plain copy starts at zero), and the gilding-additivity
  probe at the reducer's triple combine.
- **Generalization** (§5.5): the same window assertions cover a once-per-combat latch (The Sealed
  Vault's first-Avenge doubler), a first-N window (Solid Ground's first-N summons), and per-source
  improve counters (Kennelmaster instances tracked independently, a fallen instance's window closing).
- **Sabotage** (§3.5): beyond the retro reinjection, `windowFailure` is sabotage-tested in-file — a
  doctored expected count fails naming the instance, its window, the expected count, and the observed
  count.
- **Retro proof**: `python packages/tools/retro/reinject.py 1176-avenge-arrival apply` (zeroing the
  summoned body's baseline) fails three temporal-window tests. `docs/docbot-roadmap.md` updated to the
  measured 14/14.

## Two engine violations found — pinned, NOT fixed here

This PR changes no gameplay. Both violations reproduce deterministically and are pinned in the typed,
shrink-only `KNOWN_VIOLATIONS` table (the pinning tests fail the day the engine is fixed, forcing the
flip to the ruled assertion):

1. **R-AVWIN-02 — the summoning death counts.** `killOrReborn` fires the Deathrattle (placing the
   summon, which stamps `avengeBaseline = deaths[side]`) *before* incrementing the tally, so the death
   that summoned an Avenge body sits inside its window — an Echo-summoned Avenge (4) source pays after
   only 3 further deaths (pinned: the summoned Solaris Wards at side-death 6; ruled: 7).
2. **R-AVWIN-10 — a dying source observes its batch-mates.** Clash deaths resolve sequentially and the
   avenge dispatch guard checks only `minion.dead`, so a mortally-wounded source observes the batch
   deaths resolved before its own and can fire while dying (pinned: a cleave-killed Obsidian Drake
   fires off a batch-mate's death; ruled: none of the batch counts).

## Approved-but-unenforced (no reachable scenario today)

- **R-AVWIN-03/08's in-combat halves** (exact copy inheriting accrued *mid-combat* window progress and
  *spent* once-per-combat latches): no effect creates an exact copy mid-combat after such state exists.
  Recorded on the rules; becomes enforceable the day such an effect ships.
- **R-AVWIN-05's three-progressed-copies case**: the triple combine sums the *top two* copies'
  progression (matching the ruling's own two-copy example, which is what the test pins); whether a third
  progressed copy should also add is an open wording question noted on the rule.
