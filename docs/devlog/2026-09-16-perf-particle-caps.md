# 2026-09-16 — FX budgets: live-particle, per-def and filter caps enforced at spawn

**What.** The owner's 2002 s perf recording put `fx:tick` at a worst 20.2 ms (4.8× the 4.17 ms budget at
240 Hz) with `fx:particles` peaking at 5,778 during combat, `fx:filters` at 80 and `fx:layers` at 40;
`fx:def:strike-impact` (10 %) and `fx:def:rune-select-implosion` (9 %) led the per-def self time in dropped
frames, and live particles averaged 3.8× higher in janky seconds. The cause was structural: nothing bounded
the population, so at combat speed every clash stacked another `strike-impact` burst on top of the previous
clash's still-live shards.

Owner-approved as a mechanical cleanup — budgets, not tuning; it must not change how the game looks or
functions under normal play. No authored def JSON was touched.

**How.** Two new modules under `packages/ui/src/fx/`:

- `fxBudgetConfig.ts` — the caps, in the repo's `getXConfig` pattern (DEV localStorage persistence,
  production ships the defaults): `maxParticles` 4,000, `maxPerDef` 24, `maxFilters` 48.
- `fxBudget.ts` — a registry of live `playDef` plays (insertion order = age) and `admitPlay`, which runs
  ONCE per play, BEFORE the play is built. Over a cap it retires the OLDEST trimmable play — same def id
  first (a pile-up pays for itself), then the oldest of any def — through the play's own idempotent
  `createRetire` teardown, so the container, updater, filter stack and pooled particle layer all go back
  the way a natural finish returns them. The incoming play is never a candidate, so a single burst always
  looks as authored. Looping (`opts.loop`), following (`opts.follow`) and `onDone` plays are protected
  (counted, never trimmed): the first two are caller-owned card treatments, the third is being sequenced on.
  `expectedLoad(def)` estimates what a play adds (burst `count`, emitter/smoke `rate × life`, enabled
  filter toggles + a positive core blur) off the post-`scaleDef` def, so per-call `intensity` is included;
  a play with no particles is never trimmed to relieve the particle cap, and likewise for filters.
- `playDef.ts` calls `admitPlay` right before `new Container()`, registers the play once `retire` exists,
  and unregisters as the first teardown step. DEV: `window.__fx.budget` (`get`/`set`/`reset`/`live`/`culled`).
- Counter `fx:culled` — a cumulative level (`registerCounter`) and a per-bucket rate (`perfMonitor.count`)
  — plus one line on the PerfHud strip.

**Why these numbers.** Measured off the committed defs: one melee clash is ≈ 278 particles
(`strike-impact` 226 + `damage-burst` 30 + `impact-dust` 22), ≈ 412 with a `self-buff-burst`. The largest
LEGITIMATE simultaneous moment is a 7-wide same-frame fan of one def (7 × `death-dissolve` ≈ 2,779;
`blast-pump` alone is the heaviest single def at ≈ 1,331); both boards can fan at most 14 plays of one def
at once; the heaviest filter stack on a def is 6, so a 7-wide fan is 42. So 4,000 clears a full-board death
wave plus a clash and sits under the 5,778 pile-up; 24 clears a 14-wide fan and a second fan stacked on it;
48 clears a 7-wide fan of the heaviest filter stack. Under normal play `fx:culled` stays at 0.

**Verification.** `fx/fxBudget.test.ts` (13 tests): `expectedLoad` arithmetic + registry-default fallback;
per-def cap trims the oldest same-def play and leaves a single burst and other defs alone; protected plays
are never trimmed and cannot spin the loop; the global particle cap prefers same-def then oldest-any and
skips particle-less plays; an oversize play still spawns; a 40-deep `strike-impact` stress never exceeds the
cap; the filter cap picks the oldest play that HAS filters; `fx:culled` increments as level and rate; and the
real `playDef` path (overlay stubbed, stub primitive) registers, trims the oldest instance for real,
double-retires safely and protects an `onDone` play. `npm run typecheck && npm run lint && npm test` green.

**Interpreted.** "Released — its remaining particles fade/cull" is implemented as the play's normal retire
(an immediate cull through the pooled layer's release); a per-primitive fade-out would be a new drain path
across every primitive and was out of scope for a mechanical change. No tuner panel was built (none exists
for FX budgets; DevMenu lives outside `fx/`) — the DEV console handle plus the persisted config is the
tunable surface. Follow-up if a cap is ever seen biting under normal play: raise it in `fxBudgetConfig.ts`
(a reviewed change), not by widening the trim policy.
