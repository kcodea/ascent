# Choreography Panel — Design

**Date:** 2026-07-07 · **Owner:** Mike (UI) · **Status:** approved pending user review
**Context:** Combat Choreographer Phase 4, slice 1 (of several). Depends on Phases 1–3 (shipped): the moment
compiler, the clock, the Score + channel registry (sfx/float/lunge/impact/aura), and the GSAP engine.

## Goal

A **dev-only visual editor** for combat *presentation* timing — a **timeline** where every effect is a chip on
a time track you drag to retime and reorder, backed by exact numeric inputs. It makes the whole choreographer
authorable by eye: per-cue anchor + offset, per-moment hold, global tempo — live, persisted, with the default
state reproducing today's timing exactly. It retires the deprecated Pacing tuner by absorbing its holds/tempo.

## Non-goals (hard boundaries)

- **Presentation only — never changes fight outcomes.** This edits *how* the fixed event log is displayed
  (Layer ②), never the sim's resolution order (Layer ①). Resolution-order editing is a separate future
  project that touches locked rules + determinism; explicitly out of scope (owner ruling 2026-07-07).
- **No causal violations.** A cue can be retimed within the freedom the step tags already allow; the editor
  does not let an effect display before its cause across resolution steps.
- **Deferred to later Phase-4 slices** (not this spec): per-target **staggers** (AOE ripple); **adding** a new
  channel to a moment or **removing** a channel a moment legitimately has; **grouping-rule** editing
  (chain / splitPerTarget); drag-drop across *moments*. This slice edits the cues a moment already has.

## The core model

Every effect is a **cue**. Today `Cue = { ch, at }`. This slice adds an offset:

```ts
export interface Cue {
  ch: Channel;              // 'sfx' | 'float' | 'lunge' | 'impact' | 'aura'
  at: Anchor;              // 'start' | 'contact' | 'landed'  (produced by the moment / engine timeline)
  offset?: number;         // ms relative to the anchor; default 0. May be NEGATIVE for timeline anchors
                           //   (contact/landed) to fire BEFORE the anchor (the smack-lead pattern);
                           //   `start` offsets clamp to ≥ 0 (a moment can't fire before it begins).
  scaled?: boolean;        // does `offset` scale with combatSpeed? default true; false = fixed wall-clock
  enabled?: boolean;       // default true; a disabled cue is skipped by the runner/engine (the on/off toggle)
}
```

- **Firing time = anchor-time + offset.** `start` = when the moment shows; `contact` = the lunge's connect
  position (engine timeline); `landed` = the rise pull-back completion (engine timeline).
- **All timing becomes an offset.** The two hard-coded aura delays retire into cue offsets: the shield-break
  cue defaults to `offset: 300` (`scaled: true`, tracks the lunge like today), the reborn re-form cue to
  `offset: 460` (`scaled: false` — it aligns to the fixed 0.7s `risepop` CSS, preserving the Phase-3c fix).
  This makes the editor uniform: one control shape (anchor + offset) covers every effect's timing.
- **Reordering = offsets.** "Show the damage number before the smack" is `float.offset < impact.offset`. No
  separate reorder mechanism; drag position *is* the offset.

## Architecture

Four units, each with one responsibility:

### 1. Editable Score store — `packages/ui/src/choreo/score.ts` (extend) + a persistence layer

`SCORE` today is a hardcoded `const`. It becomes the **defaults**, wrapped by a live override layer mirroring
`choreoConfig`'s exact pattern (localStorage key `ascent.choreoScore`, in-memory merged copy, getter + setters):

```ts
export const SCORE_DEFAULTS: Record<MomentKind, Cue[]>;        // today's table + the migrated offsets
export function getScore(): Record<MomentKind, Cue[]>;          // defaults deep-merged with the override layer
export function getCues(kind: MomentKind): Cue[];               // getScore()[kind]
export function setCue(kind: MomentKind, index: number, patch: Partial<Cue>): void;  // persists + updates
export function resetScore(): void;                             // clears overrides
export function scoreJson(): string;                            // Copy — the current table as pasteable defaults
```

`runMomentCues` reads `getCues(moment.kind)` instead of the const, so edits apply to the next moment. The
override layer stores only *changed* cues (sparse), so adding a new default kind later needs no migration.

### 2. Offset-aware scheduling — `choreo/score.ts` (runner) + `choreo/engine.ts`

Each cue fires at anchor-time + offset (÷ combatSpeed when `scaled`):
- **`start` cues:** the runner fires offset-0 cues immediately (as today); an offset-N cue schedules a
  `setTimeout(N [/combatSpeed])`. Negative offsets clamp to 0 here (can't fire before the moment starts). The
  effect returns a cancel; the cue effect collects cancels into its cleanup (the aura channel already returns
  cancels — generalize this to all channels the runner drives).
- **`contact` / `landed` cues:** the engine already fires these from GSAP timeline positions; the offset is
  added to that position (a `tl.add(fn, anchorTime + offset/1000)`). Here the offset **may be negative** — a
  cue can fire *before* the anchor (the smack-lead pattern: impact a few ms before the strike fully connects),
  which GSAP supports as an earlier timeline position. The impact channel's contact stays offset 0 by default
  (the smack lands on connection); a negative offset is now an authorable choice.
- The aura channel loses its two internal `setTimeout`s — the delay now lives in the cue offset, dispatched by
  the runner. `burstDeathAuras` / `breakShieldAura` / `reformReborn` become immediate dispatchers; the runner
  owns the timing. (`breakShieldAura`/`reformReborn` stop taking a delay; the shield/reborn cues carry it.)

**Equivalence guarantee:** with `SCORE_DEFAULTS` (the migrated offsets), on-screen timing is byte-identical to
today. This is a locked regression test (see Testing).

### 3. The timeline widget — `packages/ui/src/ChoreographyPanel.tsx` (+ a `Timeline` subcomponent)

A dev-only floating panel (same `useDraggablePanel` + DevMenu entry pattern as `PacingTuner`/`LungeTuner`):

- **Left rail:** the list of `MomentKind`s (with each kind's cue count); click to select one.
- **Editor (per selected moment):**
  - A **time track**: a horizontal ms axis. Anchor gridlines are drawn at their known times — `start` at 0;
    `contact`/`landed` at the lunge/pull-back times (from `lungeConfig`) *for kinds whose cues use them*
    (attackExchange/riseDeath); non-attack moments show only `start`. The track window spans 0 → max(hold,
    largest cue time) with a little headroom.
  - One **lane per cue**: a draggable **chip** positioned at `anchorTime + offset`. Drag horizontally → updates
    `offset` (px↔ms via the track scale). A `start` chip clamps at the anchor (≥ 0); a `contact`/`landed` chip
    can be dragged **left of its anchor** into negative offset (fire before it — the smack-lead), so the track
    renders a little pre-anchor room. A numeric **offset input** beside each lane for
    exact entry (the "numbers up front" requirement — drag and number are two views of the same value). An
    **on/off** toggle per cue (double-click chip or the toggle) writes an `enabled` flag the runner honors.
  - The moment **hold** shown as a bracket at the track end, draggable + numeric (writes `choreoConfig`).
- **Top bar:** global **tempo** slider (`choreoConfig.speed`), **Copy JSON** (`scoreJson()` + the config),
  **Reset** (`resetScore()` + `resetChoreoConfig()`).
- **▶ Preview (real FX on a mock stage):** the panel renders two small **mock unit cards** — an attacker and a
  target — with real `data-uid`s and screen positions. ▶ fires the *selected moment's cues* against them at the
  current tempo, so you **see the actual effects on demand** — the lunge motion, the impact flash / sparks /
  recoil, an aura burst / break / re-form, the sounds — without grinding to a fight that happens to contain
  them. A playhead also sweeps the timeline so sequence + spacing read alongside the FX. **Coverage:** the
  GSAP/pixiFx channels (`sfx`, `lunge`, `impact`, `aura`) preview fully against the mock cards (aura preview
  registers a mock bubble on the target first so the burst has something to shatter); React-state-driven
  `float`s and the CSS anim classes preview only in a limited form (a transient float / class flash) — their
  true read stays a live fight. This is the highest testing-value part of the panel (the FX-heavy channels are
  the painful-to-trigger ones), but it is built **last** and is the natural cut point if the timeline runs long.
- **Live:** edits write the stores immediately and apply to the next moment/fight; nothing is recomputed
  per frame (no perf hit — the panel is dev-only and the stores are read at moment boundaries).

The `enabled` flag: add `enabled?: boolean` to `Cue` (default true); `runMomentCues`/engine skip a disabled
cue. (Small addition to the model alongside `offset`/`scaled`.)

### 4. Retire the Pacing tuner

`PacingTuner.tsx` is removed from the DevMenu (the panel supersedes it — holds + tempo live here now, editing
the same `choreoConfig`). Keep `choreoConfig` itself (the panel + clock read it). Delete the tuner component +
its menu entry; note the deprecation in the devlog.

## Data flow

```
DevMenu → ChoreographyPanel ──edits──▶ score overrides (localStorage)  ─┐
                            └──edits──▶ choreoConfig (holds, tempo)     │
                                                                        ▼
   combat replay: runMomentCues/engine ── read getCues() + choreoConfig at each moment ──▶ channels fire
                                          (offset-scheduled; scaled ÷ combatSpeed)
```

## Timing semantics (the one subtlety)

Offsets scale with `combatSpeed` by default (the choreography is a tempo that compresses when the player speeds
combat up), **except** cues flagged `scaled: false` — which align to fixed-duration CSS animations. Only the
reborn re-form is `scaled: false` today (preserving the Phase-3c behavior where its 460ms tracks the fixed
`risepop` CSS, not the speed-scaled lunge). The panel exposes the flag as a small "fixed / scaled" per-cue
toggle so the distinction is visible and editable, not hidden.

## Testing

- **Equivalence (the load-bearing test):** `getScore()` with no overrides === today's effective timing; a
  headless walk asserts each cue's fire time (anchor + offset ÷ speed) matches the pre-panel scheduler for the
  canonical fights. Migrating the aura delays into offsets must not shift a single ms.
- **Store:** defaults↔override sparse-merge, `setCue` persistence, `resetScore`, `scoreJson` round-trips back
  to an identical table.
- **Scheduling math:** `start` offset → setTimeout(offset/speed) with negatives clamped to 0; `scaled: false`
  → fixed; disabled cue → never fires; `contact`/`landed` offset added to the timeline position, including a
  **negative** offset firing before the anchor.
- **Timeline widget:** px↔ms mapping (drag delta → offset), anchor placement per kind, the per-anchor clamp
  (`start` ≥ 0, `contact`/`landed` may go negative). Pure helpers unit-tested; the React drag wiring gets a
  light interaction test.
- **Perf:** no per-frame layout reads; stores read at moment boundaries only (dev-only panel, but keep the
  discipline).

## Risks

- **Behavior drift during the aura-delay migration** — the shield-break/reborn delays moving from
  channel-internal `setTimeout`s to cue offsets is the one place timing could shift. Mitigation: the
  equivalence test + a live feel-pass on a DS/reborn fight.
- **Timeline drag polish** — custom drag interactions + the px↔ms scale are the bulk of the build; keep the
  math in pure, tested helpers and the React layer thin. The numeric inputs are the fallback if a drag feels
  off, so the panel is fully usable even before the drag feel is perfect.
- **Scope creep toward staggers/grouping** — resist; those are separate slices. This slice edits existing
  cues' anchor/offset/enabled + hold + tempo, nothing structural.
- **Preview stage complexity** — firing real channel FX outside a live combat means standing up mock unit
  elements + registering a mock aura bubble. Mitigation: it's the LAST task and cuttable; the panel is fully
  functional (edit + save + judge in a real fight) without it. Scope it to the GSAP/pixiFx channels that render
  self-contained; don't chase pixel-perfect float/CSS-anim preview.

## Delivery

One implementation plan (its own doc), built subagent-driven with the equivalence test as the gate at every
step. Rough shape: (1) `Cue` gains `offset`/`scaled`/`enabled` + `SCORE_DEFAULTS` with migrated offsets +
equivalence test; (2) offset-aware scheduling in runner + engine, aura delays migrated; (3) the editable score
store + persistence; (4) the `ChoreographyPanel` shell (rail + numeric editor + tempo + Copy/Reset), wired to
the store; (5) the `Timeline` drag widget layered on the numeric editor; (6) retire the Pacing tuner; (7) the
**mock-stage ▶ Preview** (two mock unit cards + firing the selected moment's FX-channel cues against them) —
built last, the natural cut point if earlier steps run long; (8) docs + live feel-pass.
