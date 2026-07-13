# Design — Shop-phase buff FX + step-progress counters

_Date: 2026-07-13 · Branch: `feat/shop-buff-fx-and-step-counters` · Owner: Mike (presentation)_

Three related presentation features, all reusing systems that already exist for combat:

1. **Shop-phase buff tendrils** — when a card buffs *other* minions during the recruit/shop
   phase, play the same source→target **tendril** FX combat already uses.
2. **Descend for source-less buffs** — buffs with no living board source (a cast spell, a
   recruit-side Deathrattle) use the **descend** rain FX instead of a tendril.
3. **Step-progress counters** — a small `X/N` pill below a board minion whose effect has a
   discrete countdown to its next step/transform/proc (Guel `1/4`, `2/4`, …).

## Background — what already exists

Combat FX are a **replay** system: `simulate()` (in `@game/core`) emits a flat `CombatEvent[]`
log → `choreo/compile.ts` groups events into Moments → `choreo/score.ts` maps each Moment kind to
cues → `useCombatReplay.ts` walks moments and drives the Pixi renderer (`pixiFx.ts`).

- **Tendril** — `FxOverlay.buffTendril(from, to, cfg)` (`pixiFx.ts:1612`). A Pixi tapered ribbon
  source→target + strike flash + motes. Per-tribe looks in `buffPresets.ts` (`buffPreset(cardId,
  tribe)`).
- **Descend** — `FxOverlay.descend(x, y, cfg)` (`pixiFx.ts:824`). A ribbon dropping from above a
  card into its center + a landing pulse. Presets in `descendPresets.ts` (`descendPreset(...)`).
- **The shared combat trigger** — `useCombatReplay.fireBuffCasts(casts, timers)`
  (`useCombatReplay.ts:544`): measures both cards' live DOM rects, resolves the preset, calls
  `buffTendril` (or, when the source is a Deathrattle buffer, `descend`), then holds the target's
  pre-buff stat badge and flashes it to the new value on strike.
- **The gap** — the recruit engine emits **no events**. `RecruitContext` is `{ state, summon }`
  (`recruit.ts:22`); buffs are applied by `addBuff(card, source: string, atk, hp)`
  (`recruit.ts:65`), where `source` is only a display-name label (for the inspect breakdown), not a
  board reference. Today the shop UI can only *infer* a buff by diffing total stats frame-over-frame
  (`Recruit.tsx:1652`), so it fires a destination-side green burst + `+X/+X` float — it does **not**
  know the source, the target relationship, or which effect fired.

The renderers (`buffTendril` / `descend` / `pulse`) are generic `{x,y}`-based and **already mounted
on the shop screen** (`pixiFx` is used throughout `Recruit.tsx`). So the missing piece is *capturing
who-buffed-whom* and reusing the existing render path.

## Part A — Shop-phase buff FX (features 1 & 2)

### Routing (decided: "by source presence")

- Buff from a **living board minion** (Battlecry, on-summon, overflow, Guel's on-spell-cast) →
  **tendril** from that minion to each target.
- Buff with **no living board source** (a player-cast spell that buffs minions; a recruit-side
  Deathrattle whose source is dead) → **descend** rain onto each target.

This matches how combat already routes Deathrattle buffs to descend, and yields "spells → descend"
for free. Note: **Guel is a minion** reacting to a spell cast, so Guel's buff-others is a *tendril
from Guel* — not a descend. A descend is only for buffs whose source is the spell itself (no unit).

### Coverage (decided: discrete triggers only)

Included: Battlecry, on-summon, recruit Deathrattle, spell cast, overflow — each fires the FX once
when it lands. **Excluded:** passive always-on auras (Lantern of Souls, Imp aura) and run-wide
folds — they re-apply continuously as board changes and would be visual noise. They simply never
call the new `buffOther` helper.

### Mechanism

1. **Capture (sim — `packages/sim/src/recruit.ts`, `state.ts`).**
   - Add a transient list to `RunState`: `recruitBuffFx: BuffFxEvent[]` and a monotonic
     `recruitFxSeq: number`.
     ```ts
     interface BuffFxEvent {
       sourceUid?: string;      // present + kind:'minion' → tendril; absent → descend
       targetUid: string;
       attack: number;
       health: number;
       sourceCardId: string;    // for buffPreset / descendPreset resolution
       sourceTribe: Tribe;
       kind: 'minion' | 'spell' | 'deathrattle';
     }
     ```
   - Introduce one thin helper in `recruit.ts`:
     ```ts
     function buffOther(ctx, source: BoardCard | { cardId; tribe } | undefined,
                        target: BoardCard, attack, health, kind): void {
       addBuff(target, nameOf(source), attack, health);           // unchanged behaviour
       if (attack === 0 && health === 0) return;                  // pure-keyword grants: no FX
       ctx.state.recruitBuffFx.push({
         sourceUid: kind === 'minion' ? source?.uid : undefined,
         targetUid: target.uid, attack, health,
         sourceCardId: source?.cardId, sourceTribe: source?.tribe, kind,
       });
     }
     ```
   - Route the buff-**other** factories through it: `spellCastBuffOthers` (Guel, `recruit.ts:934`,
     `kind:'minion'`), `battlecryBuffTribe/Imps/Fodder/UndeadAttack/BeastAttack/Magnetics`,
     `buffOnSummon`, `summonBuffTribeImprove`, `summonBuffSelfTribe`, `overflowBuffRandom`
     (Monk), and the recruit Deathrattle buffers via `fireRecruitDeathrattles` (`recruit.ts:479`,
     `kind:'deathrattle'`). A player-cast spell that buffs minions (`spellBuffAll` /
     `spellBuffTarget`, dispatched from `castSpell`) pushes with `kind:'spell'`, no `sourceUid`.
   - `recruitBuffFx` is cleared at the **start of each action** (in the reducer, before the action
     runs). This is pure display metadata: it consumes no RNG and does not affect any stat outcome,
     so determinism / golden sims are unaffected. (Sanity: a determinism test asserts two identical
     runs produce identical board stats regardless of `recruitBuffFx`.)

2. **Surface (store — `packages/sim/src/reducer.ts`).** The populated `recruitBuffFx` rides on the
   resulting `RunState`; bump `recruitFxSeq` whenever it is non-empty after an action, so the UI
   can fire it exactly once (a `useEffect` keyed on `recruitFxSeq`).

3. **Render (ui — `packages/ui/src/Recruit.tsx`, `useCombatReplay.ts`, a new small module).**
   - Factor the shared core out of `useCombatReplay.fireBuffCasts` — rect measurement, preset
     resolution (`buffPreset` / `descendPreset`), the `buffTendril` / `descend` call, and the
     target stat-hold + strike-flash — into a reusable helper (e.g. `fireBuffFx(pixi, evt, rectOf,
     statHooks)`), so combat and shop share one code path and one look.
   - A new `useEffect` in `Recruit.tsx`, keyed on `run.recruitFxSeq`, iterates `run.recruitBuffFx`
     and calls the helper: resolves `sourceUid`/`targetUid` DOM rects (same rect helpers the shop
     already uses for drag/insert), fires a tendril (source→target) or a descend (target only).

4. **Reconcile with today's shop flash (`Recruit.tsx:1652`).** For targets the new source→target FX
   handles this tick, suppress the duplicate green **burst ring** (the tendril/descend already
   flashes the badge); keep the `+X/+X` float. Buffs *not* captured as source→target events
   (self-buffs, aura folds, player-cast single-target that lands on the acted card) keep the current
   passive treatment. Self-buffs continue on the existing self-pulse path unchanged.

## Part B — Step-progress counter (feature 3)

### Which cards (decided: step-based scalers only, incl. cadence)

Exactly the scalers that already compute a discrete countdown (the `*ProgressText` / countdown
helpers in `cardText.ts`):

| Card | Effect | `total` (N) | `current` source |
|---|---|---|---|
| Archmagus Guel | +1/+1 per 4 spells while on board | 4 | `spellProgress` (cyclic) |
| Flowing Monk | improves every N overflows | `improveEvery` (5) | `summonBonus` (cyclic) |
| Spirit Pup | transforms at N spells | `at` (10) | `spellProgress` (one-time) |
| Tara | ascends at `ascendAt` grants | `ascendAt` | `ascendProgress` (one-time) |
| Crypt Drake | every N ally attacks, buff all | `every` (2) | `attackSeen` (cyclic) |
| Frontdrake / Money Maker | every N turns | `every` (3) | `eotTick` (cyclic) |

Continuous accumulators (Kennelmaster, Mama Bear, Sergeant, Grim, Squirl Scout, Trail Forager, …)
have no threshold → **no counter**.

### Data — one generic resolver

Add `stepProgress(cardId, params: LiveTextParams) → { current, total } | null` to `cardText.ts`,
reusing the params the text helpers already read. Semantics:

- **Cyclic** (Guel/Monk/Crypt Drake/cadence): `current = progress === 0 ? 0 : ((progress - 1) % N)
  + 1` → counts `1…N` then wraps (matches the user's "1/4 → 2/4 → … → 4/4 → 1/4" model). `total =
  N`.
- **One-time** (Spirit Pup/Tara): `current = min(progress, N)`, `total = N`, no wrap; the card
  transforms/ascends on reaching N.

The existing inline green `{{N to go}}` text in the individual helpers stays (belt and suspenders).
`stepProgress` is the single source of truth for the pill so the two never drift.

### Render

- A `.stepcounter` pill in `Card.tsx`, absolutely positioned centered just **below** the card
  frame, showing `current/total`. Rendered **only for board minions** (progress accrues only on
  board; a hand/shop copy reads 0/N and is hidden).
- The same pill in `Unit.tsx` so it ticks live during combat (Guel already emits `spellProgress`
  events mid-fight → `useCombatReplay.ts:199` updates the unit; the pill reads the same live value).
- Sunward-styled (cream/ink), small and unobtrusive. A compositor-only (`transform`/`opacity`) bump
  on increment — **no** looped paint properties (per `docs/performance.md`).

## Decisions locked in

- Routing: **by source presence** (living minion → tendril; source-less → descend).
- Coverage: **discrete triggers only**; passive auras excluded.
- Counter set: the **six step-based scalers** above, cadence **included**.
- Counter visibility: **board minions only** (+ live in combat), hidden in hand/shop.
- `current` **counts 1→N then wraps** for cyclic scalers; counts to the one-time threshold for
  transform/ascend.

## Risks & testing

- **`recruit.ts` is Kevin's domain** — the capture is additive and determinism-preserving; land on
  a branch, PR, flag Kevin. The `buffOther` helper is the single new chokepoint; each factory edit
  is a one-line reroute.
- **Performance** — the Pixi FX layer is already mounted on the shop; tendril/descend reuse the
  objects combat already pools. No new per-frame paint.
- **Tests** — unit: `buffOther` pushes the right `{sourceUid,targetUid,attack,health,kind}` for a
  minion vs a spell vs a recruit Deathrattle; `stepProgress` math (cyclic wrap + one-time clamp) for
  each of the six cards; determinism unchanged with `recruitBuffFx` populated. Live: a Guel on board
  + a spell cast fires a tendril from Guel and the pill ticks `→ n/4`; a direct buff-spell rains a
  descend; a Battlecry buff-other shoots a tendril from the played minion.

## Out of scope

- New tendril/descend *looks* (reuse the tuned per-tribe presets).
- Any change to combat FX behaviour (only a refactor to share the render helper).
- Counters for continuous accumulators.
- Per-card descend/tendril preset assignment tuning (the `default` + per-tribe resolution is reused
  as-is).
