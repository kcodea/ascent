# Rally Pulse Coverage + Pixi Watcher Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make *every* rally card pulse at the wind-up beat `T` (closing the economy-rally coverage gap via a cosmetic sim marker), and wire watcher pulses to fire a Pixi ring-bloom def (owner-authored) with the existing CSS frame-pulse as the pre-def fallback.

**Architecture:** Piece A adds a cosmetic `rallyPulse` combat event, emitted from the sim's on-attack dispatch whenever a unit's on-attack effect *acts* (appends to the log), spliced in at the pre-effect log position so it is absorbed into the attacker's wind-up moment where the existing `rallyPulseUnits` classifier reads it. Piece B changes the UI's frame-surface pulse from a CSS nonce bump to `playDef('watcher-pulse', …)`, gated on the def being committed and the renderer being live, with the CSS path as the registry-miss fallback. No gameplay/RNG change; the marker is pure presentation.

**Tech Stack:** TypeScript, React, Vitest (unit), a committed puppeteer-core browser harness (`docs/superpowers/harness/rally-beat-verify.mjs`) driving the dev server at `http://localhost:5174`.

**Spec:** `docs/superpowers/specs/2026-08-07-rally-pulse-coverage-and-pixi-watcher-design.md`

## Global Constraints

- **This extends PR #918's branch `feat/rally-beat-choreography`** — the active worktree at `C:/Users/micha/Desktop/ascent/.claude/worktrees/playtest`. Do NOT branch off main; commit onto the existing branch.
- **The marker is cosmetic. Zero gameplay change.** It consumes no RNG, mutates no board/hp/hand state. The combat OUTCOME (final boards, hp, rng draw count) must be byte-identical before and after. It exists only in the presentation event log.
- **No new timing constant.** Piece B reuses `RALLY_EFFECT_GAP_MS` (currently 300, in `packages/ui/src/useCombatReplay.ts`) and `combatSpeedRef.current`. Do NOT retune the gap or the medallion pulses.
- **No per-card patching.** Coverage comes entirely from the generic marker; do NOT add `RL` keywords or per-card FX flags to any card def (that would change gameplay — Demon Horse's `RL` keyword is deliberately NOT added).
- **The owner authors the `watcher-pulse` def** (`packages/ui/src/fx/defs/watcher-pulse.json`, id `watcher-pulse`) in the FX workshop, in parallel. This plan does NOT create that JSON. Until it lands, `getDef('watcher-pulse')` returns `undefined` and the CSS fallback runs — nothing must regress in that state.
- **Marker event shape is exactly** `{ type: 'rallyPulse'; source: string }` — `source` is the uid of the unit whose on-attack effect acted. No amount, no target, no payload.
- **Follow existing patterns.** The classifier already routes `source === attacker → medallion`, else `→ frame`; reuse it unchanged. The frame-pulse light-blue CSS var `--framepulse-color` stays for the fallback.

---

## File Structure

**Piece A — sim marker (every rally pulses):**
- `packages/core/src/types.ts` — add the `rallyPulse` member to the `CombatEvent` union (~line 1620–1651).
- `packages/core/src/combat/simulate.ts` — emit the marker inside `registerEffect`'s on-attack handler branch (~line 1131–1157), spliced at the pre-effect log position.
- `packages/ui/src/choreo/compile.ts` — add `'rallyPulse'` to `DEFAULT_RULES.absorbIntoWindup` (line 34).
- `packages/ui/src/choreo/channels/rallyFired.ts` — add `'rallyPulse'` to `PULSE_EVENT_TYPES` (line 120).
- Test files: `packages/ui/src/choreo/channels/rallyFired.test.ts`, `packages/core/src/combat/simulate.test.ts` (or a new focused `rallyPulseMarker.test.ts`), and any compile/equivalence test for absorption.

**Piece B — Pixi watcher wiring:**
- `packages/ui/src/fx/watcherPulse.ts` — NEW: the def id constant + the pure channel-decision helper.
- `packages/ui/src/fx/watcherPulse.test.ts` — NEW: unit test for the helper.
- `packages/ui/src/useCombatReplay.ts` — in the frame-surface branch of `onRallyPulse` (~line 1683–1688), fire the Pixi def or fall back to CSS; add the `getDef` import.
- `packages/ui/src/fx/playDef.ts` — add a DEV-only fire log (`window.__fxFires`) so the browser harness can detect a Pixi fire (canvas has no DOM class).

**Verification harness:**
- `docs/superpowers/harness/rally-beat-verify.mjs` — add a Demon Horse medallion-pulse-presence scenario; make the Crypt Drake watcher channel accept EITHER the CSS frame pulse OR a `watcher-pulse` Pixi fire.

---

## Task 1: Recognize the marker (type + absorption + classifier)

Adds the cosmetic event type and makes the UI absorb it into the wind-up and classify it — using synthetic events only. No emission yet, so no behavior changes in a real fight. This is the interface every later task consumes.

**Files:**
- Modify: `packages/core/src/types.ts` (CombatEvent union, ~line 1644 near the existing `rally` member)
- Modify: `packages/ui/src/choreo/compile.ts:34`
- Modify: `packages/ui/src/choreo/channels/rallyFired.ts:120`
- Test: `packages/ui/src/choreo/channels/rallyFired.test.ts`
- Test: the existing compile/equivalence test for `absorbIntoWindup` (find it: `grep -rl absorbIntoWindup packages/ui/src` and the compile tests under `packages/ui/src/choreo/`)

**Interfaces:**
- Produces: a new `CombatEvent` variant `{ type: 'rallyPulse'; source: string }` (intersected, like every member, with `& { step?: number; avenge?: true }`). Consumed by Task 2 (emission), the classifier, and the compiler.

- [ ] **Step 1: Add the marker to the CombatEvent union**

In `packages/core/src/types.ts`, inside the `CombatEvent` union (the block starting `export type CombatEvent = (` ~line 1620), add a member next to the existing `rally` line (1644). Match the file's inline-comment style:

```typescript
  | { type: 'rallyPulse'; source: string } // COSMETIC: a unit's on-attack rally ACTED this swing (emitted by simulate's onAttack dispatch when the effect appended to the log). Never read by the sim, never affects outcomes — the UI's rallyPulseUnits reads it to pulse `source` at the wind-up beat, covering economy rallies (Demon Horse, Mineral Master) whose real effect logs outside the attack beat. `source === attacker` → medallion, else → frame.
```

- [ ] **Step 2: Run the core typecheck to confirm the union compiles**

Run: `npm --workspace @game/core run typecheck` (or the repo's typecheck for core; check `package.json`)
Expected: PASS (the new member is structurally valid).

- [ ] **Step 3: Write the failing classifier test**

In `packages/ui/src/choreo/channels/rallyFired.test.ts`, add a test for `rallyPulseUnits` proving a synthetic `rallyPulse` classifies by source. Follow the existing test-helper patterns in that file for building a `Moment` + events array. The attacker uid in these tests is the moment's `primary.attacker`.

```typescript
it('rallyPulseUnits: a rallyPulse from the attacker pulses the medallion, from a watcher pulses the frame', () => {
  // events: [attack(atk -> def), rallyPulse(atk), rallyPulse(watcher)]
  const events = [
    { type: 'attack', attacker: 'atk', defender: 'def', swing: 0 },
    { type: 'rallyPulse', source: 'atk' },
    { type: 'rallyPulse', source: 'watcher' },
  ] as const;
  const moment = { start: 0, end: 3, primary: events[0] } as unknown as Parameters<typeof rallyPulseUnits>[0];
  const pulses = rallyPulseUnits(moment, events as unknown as CombatEvent[], 'atk');
  expect(pulses).toEqual([
    { uid: 'atk', surface: 'medallion' },
    { uid: 'watcher', surface: 'frame' },
  ]);
});
```

Match the actual `Moment`/typing helpers already used in the file rather than the casts above if the file has cleaner constructors.

- [ ] **Step 4: Run the classifier test to verify it fails**

Run: `npm --workspace @game/ui run test -- rallyFired`
Expected: FAIL — `rallyPulse` is not yet in `PULSE_EVENT_TYPES`, so the events are skipped and `pulses` is empty.

- [ ] **Step 5: Add rallyPulse to PULSE_EVENT_TYPES**

In `packages/ui/src/choreo/channels/rallyFired.ts:120`, extend the set and update its doc comment above (lines 114–120) to mention the marker:

```typescript
const PULSE_EVENT_TYPES = new Set<CombatEvent['type']>(['buff', 'summon', 'sc', 'keyword', 'dmg', 'rallyPulse']);
```

- [ ] **Step 6: Run the classifier test to verify it passes**

Run: `npm --workspace @game/ui run test -- rallyFired`
Expected: PASS.

- [ ] **Step 7: Write the failing absorption test**

Find the compile test that exercises `absorbIntoWindup` (a synthetic `[attack, buff]` run collapsing into one wind-up moment). Add a case that a `rallyPulse` immediately after an `attack` is absorbed into the same wind-up moment (i.e. `compileMoments([attack, rallyPulse, sc])` yields a first moment spanning the attack AND the rallyPulse, ending before the `sc`). Model it on the existing absorption assertions in that test file.

```typescript
it('absorbs a rallyPulse marker into the attacker wind-up, stopping at a non-absorb event', () => {
  const events = [
    { type: 'attack', attacker: 'a', defender: 'b', swing: 0 },
    { type: 'rallyPulse', source: 'a' },
    { type: 'sc', source: 'a', text: '+2/+2 Shop' },
  ] as unknown as CombatEvent[];
  const moments = compileMoments(events);
  expect(moments[0].start).toBe(0);
  expect(moments[0].end).toBe(2); // attack + rallyPulse absorbed; sc starts the next moment
});
```

- [ ] **Step 8: Run the absorption test to verify it fails**

Run: `npm --workspace @game/ui run test -- <compile-test-name>`
Expected: FAIL — the first moment ends at index 1 (only the attack), because `rallyPulse` is not yet an absorb type.

- [ ] **Step 9: Add rallyPulse to absorbIntoWindup**

In `packages/ui/src/choreo/compile.ts:34`:

```typescript
  absorbIntoWindup: new Set(['buff', 'rally', 'summon', 'reveal', 'improve', 'tribeAura', 'rallyPulse']),
```

- [ ] **Step 10: Run the absorption test to verify it passes**

Run: `npm --workspace @game/ui run test -- <compile-test-name>`
Expected: PASS.

- [ ] **Step 11: Confirm no exhaustive event switch throws on the new type**

`momentKind` (`packages/ui/src/choreo/kinds.ts`) has a `default: return 'damage'`, so a `rallyPulse` that ever became a moment primary degrades safely (it never will — it is always absorbed). Verify no OTHER `switch (…​.type)` over combat events in `packages/ui/src` will crash on `rallyPulse`:

Run: `grep -rn "case 'improve'" packages/ui/src` (improve is a sibling cosmetic-ish event — wherever it is handled, rallyPulse needs the same benign treatment)
For each such switch (notably the frame/anim reducer that folds events into per-unit state): if it has a safe `default` no-op, nothing to do; if it is exhaustive and would fall through to an error, add a `case 'rallyPulse': break;` (or `return`) no-op with a one-line comment "cosmetic pulse marker — no frame state". The marker must contribute NOTHING to stats/anims.

- [ ] **Step 12: Run the full UI + core test suites**

Run: `npm test` (repo root)
Expected: PASS. No emission exists yet, so no real-fight logs contain `rallyPulse` — existing snapshots are unchanged.

- [ ] **Step 13: Commit**

```bash
git add packages/core/src/types.ts packages/ui/src/choreo/compile.ts packages/ui/src/choreo/channels/rallyFired.ts packages/ui/src/choreo/channels/rallyFired.test.ts packages/ui/src/choreo/<compile-test-file>
git commit -m "feat(fx): recognize cosmetic rallyPulse marker — absorb into wind-up + classify by source"
```

---

## Task 2: Emit the marker (sim on-attack dispatch)

The heart of Piece A. When a unit's on-attack effect appends to the combat log, splice a `rallyPulse` for that unit at the pre-effect position. "Acted = appended to the log" is the discriminator that separates a real rally from a watcher's non-triggering own swing, and that never captures strike damage (which is emitted outside any on-attack handler).

**Files:**
- Modify: `packages/core/src/combat/simulate.ts` — `registerEffect`'s bus handler (~line 1131–1157). `emit` (line 85), `events` (line 73), and `stepN` are all in the same `simulate()` closure.
- Test: `packages/core/src/combat/simulate.test.ts` (or a new `packages/core/src/combat/rallyPulseMarker.test.ts` following the file's fight-builder helpers)

**Interfaces:**
- Consumes: the `{ type: 'rallyPulse'; source: string }` variant from Task 1.
- Produces: `rallyPulse` events in the combat log, one per acting on-attack effect, positioned immediately before that effect's own logged events (so absorption folds them into the attacker's wind-up).

**Why splice, not append (READ THIS — it is the crux):** economy rallies log a NON-absorb event first. Demon Horse's `rallyBuffShopPermanent` → `ctx.gainTavernBuy` emits `{ type: 'sc', text: '+N/+N Shop' }` (`simulate.ts:650`, player-side only); `sc` is NOT in `absorbIntoWindup`, which is exactly why Demon Horse is a gap today. If the marker were APPENDED after the effect ran, it would sit after that `sc` and land OUTSIDE the wind-up moment. Splicing the marker at the log length captured BEFORE the effect ran puts it immediately after the `attack` event, inside the contiguous absorb run, so it is folded into the wind-up regardless of what the effect logs next.

- [ ] **Step 1: Write the failing coverage + control test**

In `packages/core/src/combat/simulate.test.ts` (reuse its fight/board builders — grep the file for how other combat tests construct a player board + served enemy and call `simulate`), add:

```typescript
describe('rallyPulse marker', () => {
  const pulses = (events: CombatEvent[], src: string) => events.filter((e) => e.type === 'rallyPulse' && (e as { source: string }).source === src);

  it('economy self-rally (Demon Horse) emits a rallyPulse for itself when it swings', () => {
    // Board: Demon Horse (dm_hungerling) vs a tanky dummy it will swing into.
    const { events, /* result */ } = runFight(['dm_hungerling'], [{ cardId: 'b2_packstrider', attack: 1, health: 40 }]);
    const dhUid = /* the Demon Horse uid from the initial player board */;
    expect(pulses(events, dhUid).length).toBeGreaterThanOrEqual(1);
    // and it lands INSIDE the wind-up: the marker index sits immediately after a Demon Horse `attack` event
    // (before its trailing `sc '+N/+N Shop'`). Assert the marker precedes the first `sc` from dhUid.
  });

  it('a plain vanilla attacker (no on-attack effect) emits NO rallyPulse — strike damage never marks', () => {
    const { events } = runFight([{ cardId: 'b2_packstrider', attack: 5, health: 5 }], [{ cardId: 'b2_packstrider', attack: 1, health: 20 }]);
    expect(events.filter((e) => e.type === 'rallyPulse')).toHaveLength(0);
  });

  it('a watcher on a swing it does NOT trigger emits no rallyPulse', () => {
    // Traveling Skald (d2_skald) watches OTHER friendly Dragons. On its OWN plain swing (no other dragon
    // attacking, or a non-dragon attacking) its handler early-returns and appends nothing.
    const { events } = runFight(['d2_skald', { cardId: 'b2_packstrider', attack: 3, health: 10 } /* non-dragon ally */], [{ cardId: 'b2_packstrider', attack: 1, health: 30 }]);
    const skaldUid = /* skald uid */;
    // Skald pulses ONLY on a real trigger (a friendly Dragon attacked). With no other dragon, zero markers for Skald.
    expect(pulses(events, skaldUid)).toHaveLength(0);
  });
});
```

Replace the `runFight`/uid placeholders with the file's real helpers and the real way it reads `initial` board uids. If `dm_hungerling` needs specific stats to reliably reach a swing, give the dummy low attack (1) and high health (40) as above so Demon Horse survives to swing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace @game/core run test -- simulate` (or the new file's name)
Expected: FAIL — no `rallyPulse` events exist yet (the first assertion finds zero).

- [ ] **Step 3: Splice the marker in the on-attack handler**

In `packages/core/src/combat/simulate.ts`, in `registerEffect`, the handler currently runs (around lines 1155–1157):

```typescript
      // An Echo (onDeath) effect resolving marks its summons as Echo summons (Aftershocks / Undertow).
      if (effect.on === 'onDeath') asEcho(minion.side, () => fn(ctx, minion, params, payload));
      else fn(ctx, minion, params, payload);
```

Replace the `else fn(...)` with an on-attack-bracketed branch:

```typescript
      // An Echo (onDeath) effect resolving marks its summons as Echo summons (Aftershocks / Undertow).
      if (effect.on === 'onDeath') {
        asEcho(minion.side, () => fn(ctx, minion, params, payload));
      } else if (effect.on === 'onAttack') {
        // COSMETIC rallyPulse marker: if THIS on-attack effect appends anything to the log, it ACTED — a real
        // rally. Splice a marker at the PRE-effect position (not appended) so it sits immediately after the
        // `attack` event, inside the contiguous absorb run the UI folds into the wind-up — even when the effect's
        // own first log line is a non-absorb `sc` (economy rallies: Demon Horse's "+N/+N Shop", Chorus Drake's
        // "+N/+N Spell Power"). A watcher whose guard early-returns appends nothing → no marker. Strike damage is
        // logged later in the clash, OUTSIDE this handler, so it can never mark. The UI classifier dedups per
        // source, so a hypothetical multi-onAttack-effect unit pulsing twice collapses to one pulse.
        const markStep = stepN;
        const preLen = events.length;
        fn(ctx, minion, params, payload);
        if (events.length > preLen) {
          events.splice(preLen, 0, { type: 'rallyPulse', source: minion.uid, step: markStep });
        }
      } else {
        fn(ctx, minion, params, payload);
      }
```

Confirm `stepN` is the same in-scope step counter `emit` reads (`simulate.ts:85`). The marker carries `step: markStep` (captured before `fn`, since an effect could call `nextStep()`). It carries no `avenge` flag — on-attack effects never run in an avenge context.

- [ ] **Step 4: Run the coverage + control test to verify it passes**

Run: `npm --workspace @game/core run test -- simulate` (or the new file)
Expected: PASS — Demon Horse now emits a marker; the vanilla attacker and non-triggering Skald emit none.

- [ ] **Step 5: Add the Mineral Master (watcher) coverage assertion**

Add to the same describe block a case proving a watcher whose real effect logs a buff also marks (frame surface):

```typescript
  it('a watcher (Mineral Master) that plays Rubies on your tribe emits a rallyPulse when a friendly Rally fires', () => {
    // Mineral Master (k_mineralmaster) watches ANY friendly Rally and plays Rubies on your <tribe> minions.
    // Board: an RL attacker of the right tribe + a tribe minion to receive rubies + Mineral Master.
    // Read k_mineralmaster's def (packages/content/src/cards/set2/*.ts) for its exact tribe param and pick a
    // matching RL attacker so playRubyOn actually runs and appends a `buff` event.
    const { events } = runFight([/* RL attacker */, /* tribe minion */, 'k_mineralmaster'], [{ cardId: 'b2_packstrider', attack: 1, health: 40 }]);
    const mmUid = /* mineral master uid */;
    expect(pulses(events, mmUid).length).toBeGreaterThanOrEqual(1);
  });
```

If reliably constructing Mineral Master's trigger proves impractical in a unit fight, it is acceptable to instead assert directly that `onRallyPlayRubiesTribe`'s dispatch path appends to the log under a friendly RL swing using whatever minimal board triggers it; the load-bearing proof is "an economy WATCHER also marks", not this specific card.

- [ ] **Step 6: Run and confirm the watcher case passes**

Run: `npm --workspace @game/core run test -- simulate`
Expected: PASS.

- [ ] **Step 7: Run the FULL suite and update outcome-neutral snapshot/count drift**

Run: `npm test` (repo root)
Expected: many combat tests that assert exact event SEQUENCES or event COUNTS in fights containing on-attack effects will now show extra `rallyPulse` entries. These are EXPECTED, outcome-neutral additions. For each failure:
- Confirm the fight's OUTCOME assertions (final boards, hp, win/lose, rng-dependent picks) are UNCHANGED — only `rallyPulse` markers were added to the log. If any outcome/board/hp/rng assertion changed, STOP: the marker leaked into gameplay and the splice is wrong (it must never run RNG or mutate state).
- Update the expected event sequences/counts to include the markers where an on-attack effect acted.
Do a final `git diff` review that every updated expectation differs ONLY by `rallyPulse` insertions.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/combat/simulate.ts packages/core/src/combat/simulate.test.ts <any-updated-snapshot-tests>
git commit -m "feat(sim): emit cosmetic rallyPulse marker when an on-attack effect acts — every rally pulses"
```

---

## Task 3: Wire the Pixi watcher effect + CSS fallback

Piece B. The frame-surface pulse fires the owner's `watcher-pulse` Pixi def when it is committed and playable; otherwise it keeps the existing CSS `.framepulsering` nonce path. A DEV-only fire log lets the browser harness observe the Pixi fire (a canvas paint has no DOM class).

**Files:**
- Create: `packages/ui/src/fx/watcherPulse.ts`
- Create: `packages/ui/src/fx/watcherPulse.test.ts`
- Modify: `packages/ui/src/useCombatReplay.ts` (frame branch ~1683–1688; imports ~line 8/33/34 region)
- Modify: `packages/ui/src/fx/playDef.ts` (DEV-only fire log, near the end of `playDef`)

**Interfaces:**
- Produces: `WATCHER_PULSE_DEF_ID = 'watcher-pulse'` and `useWatcherPixi(defAvailable: boolean, canPlay: boolean): boolean` from `watcherPulse.ts`.
- Consumes: `getDef` (`packages/ui/src/fx/fxDefs.ts`), `canPlayDefs`/`playDef` (already imported in `useCombatReplay.ts:33`), `anchorsForUnits` (already imported `:34`).

- [ ] **Step 1: Write the failing helper test**

`packages/ui/src/fx/watcherPulse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WATCHER_PULSE_DEF_ID, useWatcherPixi } from './watcherPulse';

describe('watcherPulse channel decision', () => {
  it('uses Pixi only when the def is committed AND the renderer can play', () => {
    expect(useWatcherPixi(true, true)).toBe(true);
    expect(useWatcherPixi(true, false)).toBe(false); // renderer not ready → CSS fallback
    expect(useWatcherPixi(false, true)).toBe(false); // def not authored yet → CSS fallback
    expect(useWatcherPixi(false, false)).toBe(false);
  });
  it('names the owner-authored def', () => {
    expect(WATCHER_PULSE_DEF_ID).toBe('watcher-pulse');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --workspace @game/ui run test -- watcherPulse`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the helper module**

`packages/ui/src/fx/watcherPulse.ts`:

```typescript
/**
 * The watcher-pulse channel decision — Pixi ring-bloom when the owner's def is committed and the overlay can
 * play it, else the CSS `.framepulsering` fallback (which ships until `watcher-pulse.json` lands). Kept pure so
 * the branch is unit-tested without a renderer; the call site (`useCombatReplay.ts`) supplies the two booleans.
 */
export const WATCHER_PULSE_DEF_ID = 'watcher-pulse';

export function useWatcherPixi(defAvailable: boolean, canPlay: boolean): boolean {
  return defAvailable && canPlay;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --workspace @game/ui run test -- watcherPulse`
Expected: PASS.

- [ ] **Step 5: Import getDef + the helper in useCombatReplay**

In `packages/ui/src/useCombatReplay.ts`, near the existing fx imports (line 33–34):

```typescript
import { canPlayDefs, playDef } from './fx/playDef';
import { anchorsForUnits } from './fx/combatAnchors';
import { getDef } from './fx/fxDefs';
import { WATCHER_PULSE_DEF_ID, useWatcherPixi } from './fx/watcherPulse';
```

- [ ] **Step 6: Fire the Pixi def (or CSS fallback) in the frame branch**

In the `onRallyPulse` callback, the frame branch is currently (lines 1683–1688):

```typescript
              } else {
                // a WATCHER answering the swing → the card-frame pulse (light-blue), never the medallion
                const n = ++frameNonceRef.current;
                setFramePulse((prev) => new Map(prev).set(p.uid, n));
                window.setTimeout(() => setFramePulse((prev) => { const m = new Map(prev); if (m.get(p.uid) === n) m.delete(p.uid); return m; }), 1150);
              }
```

Replace the body with a Pixi-or-CSS gate. The Pixi fire anchors on the watcher's own card (source = target = the watcher uid) at `T`; the speed uses `combatSpeedRef.current` like the other T+gap launches:

```typescript
              } else {
                // a WATCHER answering the swing → the card-frame pulse (light-blue), never the medallion.
                // Prefer the owner-authored `watcher-pulse` Pixi ring-bloom when it is committed AND the overlay
                // can play it; otherwise fall back to the CSS `.framepulsering` nonce (which ships until the def
                // lands, so nothing regresses before it).
                if (useWatcherPixi(!!getDef(WATCHER_PULSE_DEF_ID), canPlayDefs())) {
                  const a = anchorsForUnits(p.uid, p.uid); // source = target = the watcher's own card
                  if (a) {
                    const speed = combatSpeedRef.current > 0 ? combatSpeedRef.current : 1;
                    playDef(WATCHER_PULSE_DEF_ID, a, { speed, uids: { source: p.uid, target: p.uid } });
                  }
                } else {
                  const n = ++frameNonceRef.current;
                  setFramePulse((prev) => new Map(prev).set(p.uid, n));
                  window.setTimeout(() => setFramePulse((prev) => { const m = new Map(prev); if (m.get(p.uid) === n) m.delete(p.uid); return m; }), 1150);
                }
              }
```

Note: `playDef` is fire-and-forget (self-retiring) — no cleanup wiring is needed here, unlike the withhold timers. If `anchorsForUnits` returns `null` (watcher off-screen/unmounted), skip silently, matching this file's other FX-skip patterns.

- [ ] **Step 7: Add the DEV-only fire log to playDef**

In `packages/ui/src/fx/playDef.ts`, inside `playDef`, right before the final `return retire;` (after the updater is registered, so it only logs fires that actually started), add:

```typescript
  // DEV-only fire log: a Pixi effect paints to a canvas with no DOM class, so the browser harness can't rAF-
  // sample it. This gives the committed rally-beat harness (and any future FX probe) a way to observe that a
  // def fired, and when. Positive `import.meta.env.DEV` branch so Rollup drops it from production builds.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as { __fxFires?: { id: string; t: number }[] };
    (w.__fxFires ??= []).push({ id, t: performance.now() });
  }

  return retire;
```

- [ ] **Step 8: Typecheck + run the UI suite**

Run: `npm --workspace @game/ui run typecheck && npm --workspace @game/ui run test`
Expected: PASS. With `watcher-pulse` not yet committed, `getDef` returns undefined → CSS fallback path is taken, so existing frame-pulse behavior is unchanged.

- [ ] **Step 9: Browser smoke-check the fallback still fires (dev server already running on :5174)**

Run the existing harness once to confirm the watcher channel still passes via CSS (no regression):
Run: `node docs/superpowers/harness/rally-beat-verify.mjs`
Expected: WATCHER — Crypt Drake still PASS (CSS `.framepulsering` path). (This task hasn't updated the harness yet; that's Task 4. This step only confirms no regression.)

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/fx/watcherPulse.ts packages/ui/src/fx/watcherPulse.test.ts packages/ui/src/useCombatReplay.ts packages/ui/src/fx/playDef.ts
git commit -m "feat(fx): fire watcher-pulse Pixi def for frame pulses, CSS framepulsering fallback"
```

---

## Task 4: Harness — Demon Horse coverage + watcher accepts Pixi

Extends the committed browser harness so it proves the new coverage (Demon Horse now pulses its medallion) and future-proofs the watcher channel to pass whether the frame pulse arrives via CSS (today) or the owner's Pixi def (once committed).

**Files:**
- Modify: `docs/superpowers/harness/rally-beat-verify.mjs`

**Interfaces:**
- Consumes: the `window.__fxFires` fire log from Task 3; the `rallyPulse`-driven medallion pulse from Task 2 (`.cgem.pulsing` on Demon Horse); the live `RALLY_EFFECT_GAP_MS` already read from source.

- [ ] **Step 1: Add a Demon Horse medallion-pulse-presence scenario**

Demon Horse's rally buffs the SHOP (no combat-board FX), so this is a pulse-PRESENCE check, not a pulse→effect gap check. Add a `runDemonHorse(page)` modeled on `runSummon` (single unit + served tanky dummy). `dm_hungerling` has `keywords: []`, so its self-rally is the PLAIN medallion (`.cgem.pulsing`, no `.rally` class):

```javascript
async function runDemonHorse(page) {
  return page.evaluate(async () => {
    const G = () => window.useGame.getState();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    G().startSceneBuilder();
    await sleep(300);
    window.useGame.setState({ combatSpeed: 1 });
    window.useGame.setState((s) => ({ run: { ...s.run, shop: [{ uid: 'dh0', cardId: 'dm_hungerling' }] } }));
    await sleep(80);
    G().dispatch({ type: 'buy', uid: 'dh0' });
    await sleep(80);
    const h = G().run.hand;
    G().dispatch({ type: 'play', uid: h[h.length - 1].uid });
    await sleep(150);
    // Tanky, low-attack dummy so Demon Horse survives to swing repeatedly (its rally logs a `sc '+N/+N Shop'`).
    window.useGame.setState((s) => ({
      run: { ...s.run, servedBoards: { ...(s.run.servedBoards ?? {}), [s.run.wave]: { minions: [{ cardId: 'b2_packstrider', attack: 1, health: 40, keywords: [] }], tier: 1 } } },
    }));
    const t0 = performance.now();
    G().dispatch({ type: 'faceOmen' });
    const lc0 = G().run.lastCombat;
    const dhUid = lc0?.initial.player.find((u) => u.cardId === 'dm_hungerling')?.uid;
    if (!dhUid) return { ok: false, reason: 'no demon horse uid resolved from lastCombat.initial' };
    const samples = [];
    let running = true;
    const read = () => {
      const t = Math.round(performance.now() - t0);
      const gem = document.querySelector(`.unit[data-uid="${dhUid}"] .card .cgem`);
      samples.push({ t, gemClass: gem?.className ?? null });
    };
    const tick = () => { read(); if (running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    await sleep(6000);
    running = false;
    const lc = G().run.lastCombat;
    const attacked = (lc?.events ?? []).some((e) => e.type === 'attack' && e.attacker === dhUid);
    return { ok: true, dhUid, samples, attacked };
  });
}
```

- [ ] **Step 2: Add the Demon Horse report block**

Add a scenario block alongside the others (before the final summary). The assertion: Demon Horse attacked AND its plain medallion pulsed at least once (this is what did NOT happen before Piece A):

```javascript
// ── COVERAGE — Demon Horse (economy self-rally, no RL, no board FX; must still pulse its medallion) ──────────
{
  const res = await withFreshPage((page) => runDemonHorse(page));
  if (!res.ok || !res.attacked) {
    report('COVERAGE — Demon Horse medallion pulse', false, [res.reason ?? 'Demon Horse never attacked this run']);
  } else {
    const pulseT = firstRisingPulse(res.samples, 'gemClass', undefined); // plain medallion, no `.rally` class
    report('COVERAGE — Demon Horse (economy rally now pulses its medallion via the sim marker)', pulseT !== null, [
      `pulse_t=${pulseT}ms (.cgem.pulsing rising edge)`,
      pulseT === null ? 'FAIL — no medallion pulse: the rallyPulse marker is not reaching the wind-up (Piece A regression)' : 'medallion pulsed — coverage gap closed',
    ]);
  }
}
```

- [ ] **Step 3: Make the WATCHER channel accept CSS OR Pixi**

In `runWatcher`, also capture the DEV fire log so a `watcher-pulse` Pixi fire counts as the frame pulse once the owner's def lands. At the end of `runWatcher`'s `page.evaluate`, return the fire log too:

```javascript
    return { ok: true, drakeUid, samples, fxFires: (window.__fxFires ?? []).slice(), t0perf: t0 };
```

Then in the WATCHER report block, compute `pulseT` as the earlier of the CSS rising edge and the first `watcher-pulse` Pixi fire (relative to `t0perf`):

```javascript
    const cssPulseT = firstRisingPulse(res.samples, 'frameClass', undefined);
    const pixiFire = (res.fxFires ?? []).find((f) => f.id === 'watcher-pulse');
    const pixiPulseT = pixiFire ? Math.round(pixiFire.t - res.t0perf) : null;
    const pulseT = [cssPulseT, pixiPulseT].filter((x) => x !== null).sort((a, b) => a - b)[0] ?? null;
```

Use this `pulseT` in place of the current `firstRisingPulse(res.samples, 'frameClass', undefined)`. Keep the rest of the watcher check (gap band, medallion-must-be-0) unchanged. Update the channel's doc comment to note it now accepts either surface. Today (def absent) `pixiPulseT` is null and the CSS path drives it exactly as before.

- [ ] **Step 4: Run the full harness**

Run: `node docs/superpowers/harness/rally-beat-verify.mjs`
Expected: BUFF, CAST, SUMMON, DAMAGE, WATCHER all PASS (unchanged), and the new COVERAGE — Demon Horse PASS. `6 CHANNELS PASS` (adjust the final summary count/label if the script prints a fixed "5").

- [ ] **Step 5: Update the final summary label if it hardcodes 5**

The script ends with `ALL 5 CHANNELS PASS`. Update the copy to reflect the added scenario (e.g. compute from the number of report blocks or change to a generic `ALL CHECKS PASS`). Keep the `process.exit(failures === 0 ? 0 : 1)` gate.

- [ ] **Step 6: Update the harness header comment**

Add a short note to the file header documenting the two additions: the Demon Horse coverage scenario (sim-marker proof) and the watcher channel now accepting a `watcher-pulse` Pixi fire via `window.__fxFires` as an alternative to the CSS `.framepulsering` edge.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/harness/rally-beat-verify.mjs
git commit -m "test(harness): Demon Horse medallion coverage + watcher accepts Pixi-or-CSS frame pulse"
```

---

## Self-Review

**Spec coverage:**
- Piece A "every rally pulses" via sim marker → Tasks 1 (recognize) + 2 (emit). Demon Horse + Mineral Master covered in Task 2 tests + Demon Horse in the harness (Task 4).
- Piece A absorption + classifier reuse → Task 1 (compile.ts + rallyFired.ts).
- Piece A verification (determinism, negative control, harness) → Task 2 Steps 1/5/7 (outcome-neutral, non-triggering watcher, strike damage) + Task 4.
- Piece B owner-authored def + wiring + registry-miss fallback → Task 3.
- Piece B verification (playDef spy, canvas-not-DOM) → Task 3 Step 7 + Task 4 Step 3.
- Split of work (owner authors `watcher-pulse.json`; this implements marker + wiring + fallback + harness) → Global Constraints + Task 3 does NOT create the JSON.
- Out of scope (visual design, gameplay change, gap retune) → Global Constraints.

**Placeholder scan:** Task 2's tests use `runFight`/uid placeholders explicitly flagged to be swapped for the file's real fight helpers — these are direction, not shippable gaps, because the exact helper names live in `simulate.test.ts` and must be read there. All product-code steps carry complete code.

**Type consistency:** `rallyPulse` shape `{ type: 'rallyPulse'; source: string }` is identical in types.ts (Task 1), the splice (Task 2), `PULSE_EVENT_TYPES`/`absorbIntoWindup` (Task 1), and the classifier (already keys on `source`). `WATCHER_PULSE_DEF_ID`/`useWatcherPixi` defined in Task 3 Step 3, consumed in Step 6. `window.__fxFires` written in Task 3 Step 7 (`{ id, t }`), read in Task 4 Step 3 (`.id === 'watcher-pulse'`, `.t`).

**Known risk (flagged for the implementer):** the load-bearing correctness property is that the splice runs no RNG and mutates no state — Task 2 Step 7 makes "outcome byte-identical, only markers added" a hard gate. The positional splice-at-`preLen` (not append) is what keeps economy rallies' markers inside the wind-up; do not "simplify" it to an append.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-07-rally-pulse-coverage-and-pixi-watcher.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
