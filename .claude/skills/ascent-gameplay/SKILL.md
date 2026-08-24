---
name: ascent-gameplay
description: Implement or review ASCENT gameplay — cards, effects, keywords, hero powers, runes, quests, reducer actions, combat events, simulation bugs — and especially EFFECT WIRING, where one effect triggers another (trigger a Rally from a rune, proc an Echo without a death, replay Start of Combat at End of Turn, copy an ability). Use when gameplay behaviour is wrong, missing, or must fire through a new path. Not for balance-only ideation or presentation-only FX work.
---

# ASCENT Gameplay & Effect Wiring

Read the live definition and every consumer before editing. Remembered card text and archived docs are not
evidence — names and designs change weekly here.

## Where behaviour lives

- **Recruit / shop**: `packages/sim/src/recruit.ts`, `packages/sim/src/reducer.ts`, run state in
  `packages/sim/src/state.ts`.
- **Combat**: `packages/core/src/combat/simulate.ts`, `packages/core/src/effects/factories.ts`, the
  `CombatEvent` union in `packages/core/src/types.ts`.
- **Both phases**: `packages/core/src/effects/arena.ts` — the shared `ARENA_EFFECTS` bodies. **This is where a
  cross-phase effect belongs.**
- **Content declaration**: `packages/content/src/`.
- **Presentation timing**: Choreographer / Beat Lab — never a source of gameplay truth.

Establish ONE authoritative state transition and present its consequences elsewhere. Never implement the same
mechanic separately in recruit, combat, and UI.

## Invariants

- Seeded RNG only. `Math.random` is ESLint-banned in `core` / `content` / `sim`. Use the run cursor pattern:
  `const rng = makeRng(state.rngCursor); … state.rngCursor = rng.state();`
- Preserve deterministic array order and target selection — pools, offers, pairings depend on it.
- Never mutate shared `CardDef`s; clone into run/combat instances.
- Resolve a lobby encounter **once** and apply both sides' damage from that single result.
- Guard recursive triggers (Echo → Rally → Shout → Echo), repeated summons, copies and immediate attacks
  against unbounded loops. Test the actual boundary, not just the happy path.
- **Dynamic card text is a hard rule**: if a value scales from live state, print the CURRENT value on BOTH
  chains — `liveCardText`/`instView` (shop/board/hand/Discover/end screen) and `Unit.tsx` (combat). A static
  base value for a live-scaled effect is a defect. Run `npm run text:audit`.

## Effect wiring — the class of bug that keeps recurring

When an ability must fire through something other than its native trigger, the goal is **one authoritative
implementation with multiple safe invocation paths**. Never duplicate a minion's rules inside the card, rune,
or quest that triggers it, and never branch on a card id to repair one interaction.

Real failures this codebase has shipped, all the same shape:

- A rune paid out only on a *real death* because forced Echo triggers called the `onDeath` factories directly
  and bypassed the shared `asEcho` chokepoint.
- A minion's Echo buffed its allies but not itself in the shop, because the recruit side was a hand-written
  copy of the combat body with a different membership rule.
- A hero power silently produced nothing for an off-set tribe, because its pool filter hand-rolled
  `c.tribe === t || c.tribe2 === t` instead of using the shared helper that knows about All-types cards.

**Before editing, trace the whole route:** which content declares it · which trigger family · which phase owns
it · which shared resolver runs it · what context (source, owner, target, phase, RNG) is threaded · which
multipliers apply and at which single boundary · permanent vs combat-only state · which events/beats are
emitted · which text paths describe it · which replay/telemetry/bot consumers read it.

**Then check the interaction matrix** — native activation, external activation, plain vs Gilded, one
multiplier, stacked multipliers, copied/transformed body, source removed before resolution, no legal target,
full board/hand/shop, random target reproducing from the same seed, recursive chain bounded, correct state
scope, event log complete, and identical final state at normal / accelerated / skipped playback.

A mechanic that can run in both phases must be tested in both. Passing one proves nothing about the other.

## Multipliers follow the trigger

An "extra trigger" effect applies wherever its trigger fires, not only in the phase it was written for. Fold
every multiplier through the same shared function so combat and shop cannot drift. Apply it at exactly ONE
boundary — if both the caller and the resolver multiply, the effect fires twice as often as printed.

## Workflow

1. Find the live definition, the effect primitive, the reducer/simulator path, the text path, and the tests.
2. State which phase owns the behaviour and whether the state is permanent or combat-only.
3. Reuse an existing primitive when it expresses the rule. Add one only for genuinely new behaviour — and put
   it in `ARENA_EFFECTS` if either phase could ever need it.
4. Register a new factory in three places or it will not load: the `EffectFactoryId` union
   (`packages/core/src/types.ts`), the schema whitelist (`packages/content/src/schema.ts`), and the
   presentation policy registry (`packages/core/src/presentation/policies.ts`) — a tripwire test fails otherwise.
5. If the change is PLAYER-FACING (a hero/card/rune add-or-change, or an in-game UI/info behaviour),
   PREPEND a plain-English entry to `packages/ui/src/patchNotes.ts` — the title-screen Patch Notes — in this
   same PR (owner ask 2026-08-24). Skip pure engine/tooling/test work.
6. Add focused tests from the matrix above. **Verify they fail without your fix** — a green test that was
   always green proves nothing.
7. Run focused vitest, `npm run typecheck`, `npm run lint` (it carries a wiring audit that fails a granted-but-
   unread flag), `npm run text:audit` on text changes, `npm run beats:audit` on trigger changes, and
   `npm run harness` for combat determinism.

For lobby rules use `ascent-lobby`; for content data use `ascent-content`; for timing/FX use
`ascent-choreography`.
