# Effect Arena — one implementation per effect, two phases

**Status:** scoped and ready to start — see [The build plan](#the-build-plan) for the tickets. Scoped 2026-08-04 (owner ask: *"all effects should be wired to work in
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

285 effect ids are referenced by content. **42 have both halves.** The rest are single-half — roughly 80
combat-only and 160 recruit-only.

> The both-halves count was **40** when this was first measured on 2026-08-04 and is **42** now. It moved
> because we shipped recruit halves for the shop-Echo family in the meantime (#850, #851) — i.e. the number
> goes UP as we hand-fix instances, which is exactly the treadmill this document exists to get off. Re-measure
> at the start of Ticket 0 rather than trusting these figures.

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

---

# The build plan

Scoped in depth 2026-08-04, ready to start. Two risks from the first draft turned out to be **overstated once
measured** — read "What changed after looking properly" before planning around them.

## Ticket 0 — the declaration test (~1 day) · no dependencies

Make the gap unmergeable before changing any behaviour.

Every `(trigger, do)` pair reachable from content must carry an explicit phase declaration next to its factory:

```ts
// packages/core/src/effects/phases.ts   (new — the single registry)
export type EffectPhase = 'both' | 'combatOnly' | 'shopOnly';
export const EFFECT_PHASE: Record<string, { phase: EffectPhase; why?: string }> = {
  deathrattleSummon:    { phase: 'both' },
  deathrattleDamageAll: { phase: 'combatOnly', why: 'a shop has no enemies' },
  endOfTurnGetRubies:   { phase: 'shopOnly',   why: 'no end of turn mid-fight' },
  // …
};
```

`why` is REQUIRED for the two narrow phases and forbidden for `both` — a narrowing without a stated reason is
the thing that rots.

**Acceptance:**

- A test walks every `do` id used by content and fails on any that is undeclared.
- A test asserts the declaration matches reality: a `both` id must appear in BOTH `FACTORIES` and
  `RECRUIT_FACTORIES`; a `combatOnly` id must be absent from `RECRUIT_FACTORIES`, and vice versa. This is what
  makes the registry a fact rather than a comment.
- The test asserts **its own instrument is alive** (non-empty id list, non-empty registries). That is the
  `tallyCoverage.test.ts` lesson: a sweep that reads the wrong field reports zero findings and looks like a
  pass. It has now happened twice on this codebase.

**This ticket pays for itself even if nothing below happens.** It converts "silently inert" into "cannot
merge", and it replaces the estimates in this document with a true inventory.

---

## Ticket 1 — the RNG spike (~1 day) · gates Ticket 2

The one thing worth proving before building anything.

Both phases already use the SAME generator (`makeRng`, mulberry32). They differ only in how the stream is
carried:

| | how the stream is carried |
|---|---|
| recruit | `makeRng(state.rngCursor)` → draw → `state.rngCursor = rng.state()` — a cursor on the run, so it survives save/restore |
| combat | one `Rng` instance threaded through the simulation, `fork()`ed where a sub-stream is wanted |

So the abstraction is small: `arena.rng(): Rng`. The ShopArena adapter builds one from the cursor and writes it
back; the CombatArena adapter hands over the live instance.

**The real risk is not the algorithm — it is draw ORDER and draw COUNT.** A migrated effect that draws a
different number of times, or in a different order, shifts every downstream pick, which breaks pinned replays,
`servedBoards` and the golden tests.

**Spike deliverable.** Migrate ONE effect that actually rolls (`overflowBuffRandom` or
`deathrattleGrantWardRandom` — `deathrattleSummon` picks nothing) to a prototype arena, then prove all three:

1. `npm run harness` determinism still passes;
2. the full suite passes with NO golden-file updates;
3. a replay exported BEFORE the change re-imports and replays identically after it.

**If (3) fails, stop and reconsider.** The fallback is to keep RNG out of the arena entirely — effects take
their picks through a callback the caller owns — which is uglier but preserves the streams exactly.

---

## Ticket 2 — the arena interface + two adapters (~2 days) · needs Ticket 1

No migrations yet. Build the seam and prove it compiles against both worlds.

```ts
// packages/core/src/effects/arena.ts   (new)
export interface EffectArena {
  readonly phase: 'combat' | 'shop';
  self: ArenaBody;
  friends(): ArenaBody[];                    // living, in board order
  buff(t: ArenaBody, atk: number, hp: number, source: string): void;
  grantKeyword(t: ArenaBody, kw: Keyword): void;
  summon(card: CardDef, near?: ArenaBody): ArenaBody | undefined;
  destroy(t: ArenaBody): void;
  getCard(id: string): CardDef | undefined;
  rng(): Rng;
  announce(ev: ArenaEvent): void;            // a log event in combat, a no-op in the shop

  combat?: CombatOnlyVerbs;                  // damage, enemies, attack order, death
  shop?: ShopOnlyVerbs;                      // gold, hand, shop offers, tier, run flags
}
```

`ArenaBody` is the narrow view both `Minion` (72 fields) and `BoardCard` (51) already satisfy:
`{ uid, cardId, tribe, tribe2, attack, health, keywords, golden }`. **Neither type changes** — the adapters
wrap them.

**The capability probes are the load-bearing design choice.** An effect that needs a shop mid-fight writes one
explicit, greppable line — `if (!arena.shop) return arena.defer();` — instead of being silently absent from a
registry, which is the entire defect this document exists for.

**Acceptance:** both adapters implement the interface; one trivial effect (`deathrattleBuffAll`) is written
once against it and passes its existing tests through BOTH adapters. Nothing else migrates here.

---

## Ticket 3 — migrate the 42 dual implementations (~3–4 days) · needs Ticket 2

These are the effects that ALREADY have both halves — the class where two implementations of one sentence can
drift, producing silently WRONG behaviour rather than merely missing behaviour. `battlecryPlayRubiesAll` and
`spellPlayRubiesAll` were the same sentence written twice; they diverged, and only one matched its printed
text.

The full worklist, derived from the tree at `ff4b4cda`:

```
battlecryTriggeredOwnDeathrattle   combatGrantAle                     deathrattleBuffAll
deathrattleBuffAllByImpAura        deathrattleBuffAllHealth           deathrattleBuffCardTypeRunWide
deathrattleBuffCelestials          deathrattleBuffImps                deathrattleBuffTribeByTally
deathrattleGiveHealth              deathrattleGrantCardToHand         deathrattleGrantMagnetic
deathrattleGrantRandomSpell        deathrattleGrantReborn             deathrattleGrantShield
deathrattleGrantSpell              deathrattleGrantWardRandom         deathrattleMaxGold
deathrattleReplayAdjacentBattlecry deathrattleRubyStatGain            deathrattleSummon
deathrattleSummonGolemsWithRuby    deathrattleSummonRubyStats         echoSummonCopyNoEcho
echoSummonInheritAttackAndCharge   onBattlecryBuffFodder              onBattlecryBuffSelf
onBattlecryBuffTribeAdjacentMore   onGainAttackBuffImproving          onSpellCastBuffOnePerTribe
onSpellCastBuffRandomTribe         onSpellCastImproveSummon           overflowBuffRandom
rubyPlayedBounce                   spellCastBuffAll                   spellCastBuffOthers
spellCastBuffUndeadAttack          spellCastImproveSelf               spellCastTransform
summonBuffSelfTribe                summonBuffTribeAsym                summonImps
```

They are almost entirely **buff-N-bodies** and **summon-a-token** — precisely the arena's neutral core. That is
the strongest evidence the abstraction fits: the effects most worth unifying need almost nothing outside it.

**Order within the ticket:** the Ruby family first (it has burned us twice), then the plain buff family, then
the summons. Ship in small PRs of five or six effects, each PR **deleting** the duplicate it replaces. A PR
that adds an arena version without deleting the old one has not done the job.

**Acceptance per PR:** existing tests pass unchanged; the duplicate implementation is GONE, not deprecated;
`EFFECT_PHASE` still agrees with reality (Ticket 0's test enforces that for free).

---

## Ticket 4 — cross-phase dispatch (~3–4 days) · needs Ticket 3

The design unlock, and the half of the ask that is currently impossible at any price: five trigger families
(`startOfCombat`, `onAttack`, `avenge`, `onKill`, `onDamaged`) have no shop dispatcher at all.

Add a shop-side dispatcher able to fire any trigger family against `ShopArena`, so a card can say "trigger your
board's Start of Combats during the shop phase" or "fire a Rally now".

**Do NOT wire these up as always-on.** They are a capability, not a behaviour change — nothing fires in the
shop unless a card explicitly asks. The first consumer should be one new card, so the dispatcher ships with a
real user rather than as speculative machinery.

**Acceptance:** a test card with a `startOfCombat` effect, triggered in the shop, produces the same board it
would in combat, minus the combat-only parts (which decline through the capability probe rather than crashing).

---

## Ticket 5 — the long tail · no deadline, never big-bang

Migrate a factory when you are ALREADY touching its card. There is no requirement that this ever completes: a
half-migrated codebase is a fine steady state as long as `EFFECT_PHASE` stays honest, which Ticket 0
guarantees.

The ~160 shop-only factories in `sim/src/recruit.ts` eventually move to `core` (see the boundary note below).
That is the most disruptive part of the whole plan, and the reason this ticket is opportunistic rather than
scheduled.

---

# What changed after looking properly

The first draft named RNG and the buff models as the two things that could sink this. **Both were overstated**,
and the plan is more tractable than that draft implies:

- **RNG.** I had not checked that both phases use the SAME generator. They do — `makeRng`, identical
  algorithm. The difference is purely how the stream is carried (a cursor on the run vs a threaded instance),
  which is exactly what an adapter is for. The residual risk narrows to preserving draw order and count per
  migrated effect — mechanical, and fully covered by the determinism harness plus ~3,880 tests. Still worth
  the Ticket 1 spike, but as confirmation rather than a coin flip.
- **The buff models.** They differ in BOOKKEEPING, not in semantics. Both do the same core (clamp Attack at 0,
  add Health); each then records the event the way its phase records things — recruit appends a
  source-attributed `buffs[]` entry plus Sergeant's `hpGrantBonus`; combat applies `gainMult`, emits a `buff`
  event, tallies `statGainByTribe`, and accrues `permaGain` on Engraved bodies. A neutral `arena.buff()` is
  therefore genuinely implementable: the contract is "apply the change, and record it however this phase
  records things". **No unification of the two ledgers is required** — that was the expensive thing I thought
  this needed, and it doesn't.

**What remains genuinely hard, unchanged:**

- **The package boundary.** `core` cannot import `RunState` (sim depends on core, not the reverse), so effect
  bodies belong in `core` — meaning the shop-only factories now in `sim/src/recruit.ts` eventually change
  package. `recruit.ts` is 6,324 lines and a declared collision chokepoint (CLAUDE.md), so any ticket touching
  it needs the other dev's sessions serialised around it. Hence Ticket 5 being opportunistic.
- **Permanence semantics.** Shop buffs are permanent by definition; combat buffs are temporary unless carried
  back. Written once, an effect must SAY which it means — an explicit argument rather than an implicit
  consequence of which file it sits in. That is a real improvement (it is the confusion re-litigated twice over
  Ruby permanence) but it is design work per effect, not a mechanical port.

# Suggested first session

1. **Ticket 0**, end to end. It is a day, it is independently valuable, and it produces the true inventory the
   rest of the plan is estimated against.
2. **Ticket 1**, the RNG spike. Report the replay result before starting Ticket 2.

Do not start Ticket 2 until Ticket 1's replay check is green.
