# Effect Arena — every trigger fires in shop AND combat

**Status:** scoped, simplified, ready to start when the weekly lifts. **Owner's goal, verbatim (2026-08-04):**
*"I just want all keywords to function in combat and shop. Shout/Echo/Rally/End of Turn/Start of Combat/etc
should be ready to fire in combat if called, and in shop if called… I do not want to have to hand select these
methods and then wire the methods to every shout."*

---

## Why this exists: the disruptor-card class

The cards that make this load-bearing are the ones that fire a trigger OUTSIDE its home phase:

- **Funeral on Loan / Ossuary Rite / Rune of the Reliquary / Gravetwin** — Echoes fired in the SHOP.
- **Dawnclaw / Ryme / Myra's Pulse** — Shouts fired in COMBAT (or re-fired at all).

Today that class mostly touches Shouts and Echoes, and every one of them has produced bug reports — Lastlight
granting nothing, Geode Guardian summoning nothing, Frenzied Excavator playing no Rubies — because each
disruptor only works where someone hand-wired the specific effects it might hit. The owner intends to EXPAND
this class: disruptors for Rallies, End of Turns, Start of Combats, more Shout/Echo pieces, and mechanics that
don't exist yet. Every future mechanic should be born callable from either phase.

That is not achievable by hand-wiring, and the bug history proves it: we have fixed this class **one card at a
time, at least six times**, and each fix raised the count of duplicated implementations that can silently
drift apart (`battlecryPlayRubiesAll` vs `spellPlayRubiesAll` were the same sentence written twice; they
diverged, and only one matched its printed text).

## The root cause, precisely

The reason a Shout doesn't fire in combat is NOT that the trigger refuses to call it. It is that each effect's
BODY is hand-written against one phase's world — the combat version speaks `Minion` + events through a
36-method `CombatContext`; the shop version mutates `RunState`/`BoardCard` directly. For ~240 of the 285
effect ids in content, **the other phase's code simply does not exist.** There is no switch to flip.

Measured on the tree at `ce935afc`: 285 effect ids used by content, **42 with both halves** (the drift class),
the rest single-half. The both-halves count goes UP every time we hand-fix a disruptor bug — that is the
treadmill this design ends.

---

## The design: one implementation, runtime probes, no registries

**Each effect is written ONCE against an `EffectArena` interface. Two adapters implement it — `CombatArena`
over the combat sim, `ShopArena` over the run state. Any trigger method, in either phase, calls the same
single implementation.**

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

  combat?: CombatOnlyVerbs;                  // damage, enemies, attack order, the killer
  shop?: ShopOnlyVerbs;                      // gold, hand, shop offers, tier, run flags
  /** Record this effect to re-run through the OTHER phase's adapter at the phase boundary (settle). */
  defer(): void;
}
```

`ArenaBody` is the narrow view `Minion` (72 fields) and `BoardCard` (51) both already satisfy: `{ uid, cardId,
tribe, tribe2, attack, health, keywords, golden }`. Neither type changes — the adapters wrap.

**The probes replace all declaration machinery.** There is no phase registry, no allowlist, no per-effect
labelling — earlier drafts had those and the owner correctly called them scope. The framework has ONE rule,
applied at runtime:

- An effect that reaches for a verb the current phase HAS just runs. (The default, and almost every effect.)
- An effect that needs the shop mid-combat (`if (!arena.shop) return arena.defer()`) **defers to settle
  automatically** — the exact behaviour today's economy Shouts already have, made a framework guarantee
  instead of a per-effect decision.
- An effect that needs combat in the shop (damage with no enemies, destroy-the-killer with no killer)
  **no-ops** — there is genuinely nothing to do, and nothing to wire.

So "every keyword functions in both phases" is the DEFAULT, exceptions handle themselves, and the phrase
"wire this effect for combat" stops being a sentence anyone writes.

**Ruling — Discover in combat (owner, 2026-08-04):** a Discover effect triggered mid-combat yields a RANDOM
card from its pool (tier-respecting), delivered to hand with the toHand animation during the fight. This is
the intended interaction, not a degradation: the interactive 1-of-3 panel never opens mid-combat, because the
fight is a pure function computed before the replay renders, and lobby seats resolve headlessly with no one
present to click. (A queue-the-real-pick-for-settle alternative was considered and declined.) Do not
re-litigate this per card — it is the rule for the whole Discover family under any disruptor.

**What this buys at scale** — the owner's actual criterion:

- A NEW disruptor card ("trigger your board's Start of Combats now", "re-fire your leftmost Rally") is a
  dispatcher call, not a per-effect wiring project. It reaches every existing effect on day one.
- A NEW effect works under every existing disruptor on day one, in both phases, because it only exists once.
- A NEW mechanic (post-set-3) inherits all of this by being written against the arena from birth.
- The 42 dual implementations collapse to one each — the drift class is deleted, not managed.

---

# The build plan (simplified — no Ticket 0, no allowlist)

## Step 1 — the RNG spike (~1 day) · gates everything

Both phases already use the SAME generator (`makeRng`, mulberry32); they differ only in how the stream is
carried (recruit: a cursor on the run, written back after each draw, so it survives save/restore; combat: one
threaded `Rng` instance, `fork()`ed for sub-streams). `arena.rng()` is therefore a small adapter — but a
migrated effect that draws a different NUMBER of times, or in a different ORDER, shifts every downstream pick
and breaks pinned replays, `servedBoards`, and the golden tests.

**Deliverable:** migrate ONE effect that actually rolls (`overflowBuffRandom` or `deathrattleGrantWardRandom`)
to a prototype arena and prove all three: `npm run harness` determinism passes; the full suite passes with NO
golden updates; a replay exported before the change re-imports identically after it.

**If the replay check fails, stop.** Fallback: keep RNG out of the arena (effects take picks via a caller-owned
callback) — uglier, but it preserves the streams exactly.

## Step 2 — the arena + both adapters (~2 days) · needs Step 1

Build the interface, both adapters, and the defer/no-op probe behaviour. Prove it on one trivial effect
(`deathrattleBuffAll`) passing its existing tests through BOTH adapters. A ratchet test replaces the old
declaration registry: it counts effects not yet on the arena and fails if the count ever goes UP — progress is
visible, regression is impossible, and no one labels anything.

## Step 3 — migrate by TRIGGER FAMILY · the bulk of the work, delivered as capability slices

Migration is not optional under this goal — "all keywords function in both phases" is only true when the
bodies exist once. But it batches naturally by family, and **each completed family makes that whole family
disruptable in both phases**, which is the owner's capability, shipped incrementally:

1. **The 42 duals first** (~3–4 days). They are the drift class — silently WRONG rather than missing — and
   they're almost entirely buff-N-bodies and summon-a-token, the arena's neutral core. Each PR deletes the
   duplicate it replaces; a PR that adds an arena version without deleting the old one has not done the job.
2. **Echo family** — completes the Funeral on Loan / Ossuary Rite / Reliquary / Gravetwin class permanently.
3. **Shout family** — completes Dawnclaw / Ryme / Myra permanently, and retires
   `COMBAT_REPLAYABLE_BATTLECRIES` (the hand-kept set we have patched three times this week).
4. **Rally, End of Turn, Start of Combat families** — pre-work for the disruptors the owner wants to add next.
   These families are single-half TODAY (no dispatcher ever calls them cross-phase), so migrating them is
   pure groundwork: cheap now, required before Step 4 pays out.
5. **Everything else** as touched, tracked by the ratchet.

Estimate honestly: the full sweep is the largest line item, on the order of 2–3 weeks of PR-batched mechanical
work spread across sessions. Family slices mean it never blocks anything and pays out at every step.

## Step 4 — cross-phase dispatchers (~3–4 days) · per family, after that family migrates

The shop-side dispatcher that lets a card SAY "fire your Start of Combats now" / "trigger your leftmost Rally"
— currently impossible at any price for five trigger families. Dispatchers are a capability, not a behaviour
change: nothing fires cross-phase unless a card asks. Ship each with one real consumer card so it lands with a
user, not as speculative machinery.

---

## What stays genuinely hard (unchanged, and worth knowing before starting)

- **The package boundary.** `core` cannot import `RunState` (sim depends on core), so arena-form effect bodies
  live in `core` — the ~160 shop-only factories migrate OUT of `sim/src/recruit.ts` (6,324 lines, a declared
  collision chokepoint; see CLAUDE.md). Family batches must be serialised with the other dev's sessions.
- **Permanence semantics.** Shop buffs are permanent by definition; combat buffs are temporary unless carried
  back. Written once, an effect states which it means as an explicit argument — a genuine improvement (this is
  the confusion re-litigated twice over Ruby permanence), but it is a real per-effect design decision during
  migration, not a mechanical find-replace.
- **The buff/RNG models are NOT hard** — earlier drafts overstated both. Same RNG generator both sides; the
  buff models differ only in per-phase bookkeeping (recruit's source-attributed `buffs[]` vs combat's
  events/`permaGain`), which each adapter keeps privately. No ledger unification needed.

## First session when the weekly lifts

1. **Step 1**, the RNG spike. Report the replay result.
2. If green → **Step 2**. Do not start Step 2 on a dirty spike.
