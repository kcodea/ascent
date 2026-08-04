# Effect Arena — one implementation per effect, two phases

**Status:** proposed, not started. Scoped 2026-08-04 (owner ask: *"all effects should be wired to work in
combat and shop as a baseline up front so that we stop running into issues where something was not built to
operate in combat"*).

---

## The problem, as it actually presents

Every few sessions a card turns out to do nothing in one of the two phases, and it always reads as a
one-off:

- Lastlight played from Funeral on Loan didn't grant Ward (Echo fired in the shop, no recruit half).
- Geode Guardian's Echo summoned nothing from a Funeral on Loan; Faultline Scrapper landed stats with no FX.
- Imp Overseer re-fired by Ryme didn't grant the Imp aura in combat.
- Brood Whelp's Shout, re-fired by Dawnclaw, narrated a trigger and applied its buff *after* the fight.
- Frenzied Excavator, flanking Dawnclaw, played no Rubies at all.

They are not one-offs. They are one defect with ~59 live instances and an unbounded supply of future ones,
because **nothing in the build knows an effect is missing a phase.**

## Measured today

285 effect ids are referenced by content. **40 have both halves.** 83 are combat-only, 161 recruit-only.

That split overstates the problem — most single-half effects are correctly single-half (`endOfTurnGetRubies`
has no combat meaning and nothing will ever dispatch it there). The exposure that matters is per TRIGGER:
which trigger families can fire in the phase their factory wasn't written for.

| Trigger | Fires cross-phase today? | Via | Ids missing the other half |
|---|---|---|---|
| `onPlay` (Shout) | yes | Ryme, Dawnclaw | **45** |
| `onDeath` (Echo) | yes | Funeral on Loan, Ossuary Rite, Rune of the Reliquary, Gravetwin, Deathsayer | **9** (was 19) |
| `onSummon` | yes | summons happen in both | **5** |
| `onGainAttack`, `summonOverflow` | yes | — | 2 |
| `startOfCombat`, `onAttack`, `avenge`, `onKill`, `onDamaged` | **no — no shop dispatcher exists** | — | 67 |

So there are three distinct problems wearing one coat:

1. **Two implementations of one sentence drift apart.** The 40 both-halves ids are where the *correctness*
   bugs live. `battlecryPlayRubiesAll` and `spellPlayRubiesAll` are the same sentence written twice; they
   diverged, and only one matched its printed text. This is the worst class, because it is silent and the
   card looks fine.
2. **A missing half is silently inert.** ~59 live cases. The card is destroyed / the trigger narrates, and
   nothing happens.
3. **Five trigger families have no shop dispatcher.** This is the "currently impossible" half of the ask —
   not a missing factory, a missing *event*. There is no way to write "trigger your board's Start of
   Combats during the shop phase" today, at any price.

## Why "just write the missing half for everything" is the wrong fix

It means **~240 new functions**, each one a fresh instance of problem (1). It industrialises the exact defect
we keep hitting. Most of them would also be dead code.

The deeper obstacle is that the two sides are not merely duplicated — they are written in **two different
styles against two different data models**:

| | Combat | Shop |
|---|---|---|
| Context | `CombatContext`, 36 methods | `RecruitContext`, 2 fields |
| Style | everything via the interface | factories mutate `ctx.state.*` directly |
| Body | `Minion` (72 fields) — `dead`, `divineShield`, `permaGain`, `rubyGain` | `BoardCard` (51 fields) — source-attributed `buffs[]` |
| Buff meaning | temporary unless carried back | permanent by definition |
| RNG | forked `Rng` threaded through | `state.rngCursor` advanced in place |
| Size | `core/src/effects/factories.ts` — 3,047 lines | `sim/src/recruit.ts` — 6,324 lines |

You cannot "just add the missing half" when the halves do not speak the same language.

---

## Proposal: `EffectArena`

**Write each effect ONCE, against an interface both phases can implement.**

A factory body only ever reaches for a small number of verbs. Most are phase-neutral:

```
friends() · self · buff() · grantKeyword() · summon() · destroy()
tribeOf() · isGolden() · rng() · getCard() · announce()
```

The rest are phase-specific and sit behind **capability probes**, not behind a second copy of the function:

- shop-only — gold, hand, shop offers, tavern tier, run flags
- combat-only — damage, the enemy board, attack order, death

`CombatArena` implements the interface over `Minion[]`; `ShopArena` over `RunState.board`. An effect that
genuinely needs a shop mid-fight **declares** it and defers — explicitly, in one place, instead of being
silently absent.

### What this buys

- Problem (1) disappears by construction: one sentence, one implementation.
- Problem (2) becomes impossible for new content — an effect written against the arena works in both phases
  the day it ships.
- Problem (3) becomes a *dispatcher* question rather than 67 rewrites. "Fire your Start of Combats in the
  shop" is then a card, not a project.
- Permanence stops being an implicit consequence of which file the code lives in and becomes an explicit
  argument. That is precisely the confusion re-litigated twice on Ruby buffs.

---

## Phasing

### Phase 0 — make the gap unmergeable (~1 day)

A build-time test: every `(trigger, do)` pair reachable from content must carry an explicit declaration next
to its factory — `both` / `combatOnly` / `shopOnly`, with a one-line reason for the narrow ones. Undeclared
fails CI.

This fixes nothing. It is still the highest-value day in the plan: **no new instance of this defect can ever
ship**, and it replaces the estimates in this document with a true inventory. Worth doing whether or not the
rest happens.

### Phase 1 — the arena, proven on the drift-prone core (~3–5 days)

Build `EffectArena` + both adapters. Migrate **only** the ~12 effects we have already had to fix twice (the
Ruby family, the buff family) and **delete** the duplicate implementations. Kills problem (1) where it
actually bites, and proves the abstraction against the hardest cases before committing to it.

### Phase 2 — cross-phase dispatch (~3–5 days)

A shop-side dispatcher able to fire any trigger family against `ShopArena`. This is the design-space unlock:
Start of Combat in the shop, a shop-phase Rally, Echo-in-shop for free rather than one-off wiring.

### Phase 3 — the long tail, opportunistically

Migrate a factory when you are already touching its card. **Never big-bang.** There is no deadline on this
phase and no requirement that it ever completes.

---

## Risks — read before committing

- **Determinism is the real risk.** Recruit advances `state.rngCursor`; combat threads a forked `Rng`. The
  arena must abstract RNG *without changing draw order*, or every golden test and every pinned replay breaks
  at once. **Spike this for a day before starting Phase 1** — if it doesn't come back clean, the plan needs
  rethinking, not pushing through.
- **The buff models genuinely differ.** Recruit's `buffs[]` is source-attributed for the inspect-panel
  breakdown; combat carries `permaGain` / `rubyGain` / temporary. A neutral `buff()` has to preserve both, and
  that is the fiddly part of Phase 1.
- **Package boundary churn.** `core` cannot import `RunState` (sim depends on core, not the reverse), so
  effect bodies belong in core — meaning the ~160 shop-only factories now in `sim/src/recruit.ts` eventually
  move packages. That is real churn on one of the two hottest files in the repo, and it argues hard for
  Phase 3 staying opportunistic.
- **`recruit.ts` is a declared collision chokepoint** (see CLAUDE.md). Any phase touching it needs the other
  dev's sessions serialized around it.

## Recommendation

Phase 0 now, regardless of the rest. Then the one-day RNG spike; if it is clean, Phases 1 and 2 are worth it
and deliver the design space asked for. Phase 3 stays permanently opportunistic.

The literal reading of the ask — write both halves for all 285 — is **not** recommended, for the reasons in
"why that is the wrong fix" above.
