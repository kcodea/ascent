# Combat Stat Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete combat's second, bespoke stat-withholding system and route it through the same `fx/statHold.ts` store the shop uses, so a combat buff rolls and pops exactly like a shop buff — one store, one clock, one pop, one vocabulary.

**Architecture:** Combat currently withholds a buffed badge's number through two `useState` Maps in `useCombatReplay` (`statHold`, `statFlash`), threaded as props `Recruit → Unit → Card`, released by post-paint `setTimeout`s keyed on strike time. This plan gives combat's `Card` a `uid` so it reads the module store, converts the pre-buff hold into an `effect`-origin `holdStat`, and has the existing strike-time release *drive a roll* (`revealStat` over `rollMs`) instead of a snap. The badge pop replaces `.statflash`. The two Maps and both props are deleted.

**Tech Stack:** TypeScript, React 18, Vitest (headless, `.test.ts` only — `useCombatReplay.ts`/`Unit.tsx`/`Card.tsx` have no DOM test harness), Puppeteer-over-CDP for the per-frame combat assertion.

**Source spec:** [`../specs/2026-08-04-stat-readout-choreography-design.md`](../specs/2026-08-04-stat-readout-choreography-design.md) (combat migration section). **Builds on:** the shop half, shipped on `feat/fx-number-spin` through `79b1b43b`.

## Design decisions taken before this plan

Two came from the spec; two were settled with the owner on 2026-08-05 after reading `useCombatReplay.ts` closely.

| # | Decision | Source |
|---|---|---|
| A | **Combat holds use `origin: 'effect'`, NOT `startAt`.** The spec proposed `startAt: <strike beat>`, but the strike time is measured POST-paint (DOM geometry in `fireBuffCasts`) while the hold is installed PRE-paint — they cannot be one value. An `effect` hold is skipped by the ticker (its player owns the clock), and combat's existing release timers are that player. This is exactly how an authored `react` layer works via `claimStat`. Combat needs no `startAt`. | Discovered reading the code; supersedes the spec's mechanism. |
| B | **Combat buffs ROLL on strike**, counting up over `rollMs`, matching the shop — replacing today's hold-then-snap. | Owner, 2026-08-05. |
| C | **The health badge POPS on damage too**, on top of the existing float/impact/red-flash. This is largely already true: `useBadgePop` fires on any printed change and has no uid gate, so combat badges already pop on damage today. The only new pop is on buffs, once `.statflash` retires. | Owner, 2026-08-05. |
| D | **Damage delivers instantly.** Damage is an unheld change, so the number updates at the reducer frame and the pop acknowledges it. The intrinsic roll must NOT fire in combat, or damage would roll — hence `autoRoll={false}` (Task 1). | Spec decision 4. |

## Global Constraints

- **Never commit to `main`.** Work continues on `feat/fx-number-spin`. Do not push (the controller pushes).
- **The final task carries the devlog + roadmap entry** for the whole plan; individual task commits do not each update docs.
- **A stat badge is load-bearing information.** No printed number may ever be one the minion did not have. This is the entire risk of touching combat — the most tuned surface in the game — and the merge is GATED on a per-frame browser assertion that proves it (Task 4).
- **Fail open.** A hold whose release timer is lost (a skip, a speed change mid-flight, a re-seek) must resolve to the true number on its own. Today the wholesale per-beat rebuild guarantees this; the module store's TTL must preserve it.
- **Run `npx tsc -b` and `npx vitest run` before every commit.** Baseline: typecheck clean, lint at SEVEN pre-existing warnings tree-wide (`npx eslint .`), 3930 tests passing.
- **`releaseAllStats` already fires on the recruit↔combat phase edge and every run swap** (`dropBoardFx` in `store.ts`, shipped in the shop half). Combat entry therefore starts with an empty store. Do not re-add a separate combat clear for that; this plan only manages holds WITHIN a fight.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/ui/src/Card.tsx` | The badge: intrinsic roll, the pop | Modify — add an `autoRoll` prop (default `true`) gating the intrinsic effect |
| `packages/ui/src/Unit.tsx` | A combat unit wrapping `Card` | Modify — pass `uid` and `autoRoll={false}`; delete `statHold`/`statFlash` props, view mapping, memo lines |
| `packages/ui/src/useCombatReplay.ts` | The replay: installs pre-buff holds, releases on strike | Modify — holds become `holdStat` calls; releases drive a roll; delete both Maps and `statHoldFor`/`statFlashFor` |
| `packages/ui/src/fx/combatBuffRoll.ts` | NEW — the pure per-beat delta computation + a roll driver | Create |
| `packages/ui/src/fx/combatBuffRoll.test.ts` | Headless coverage of the delta computation | Create |
| `packages/ui/src/Card.tsx` (CardView) | `flashAtk`/`flashHp` fields | Modify — delete, plus `cardViewEqual.ts` entries and the `.statflash` class logic |
| `packages/ui/src/styles.css` | `.statflash` rule + `@keyframes statflash` | Modify — delete if nothing else references them (GREP first) |
| `docs/superpowers/harness/combat-invariant.mjs` | NEW — per-frame combat badge assertion | Create |

---

## Task 1: `Card` gains an `autoRoll` gate

Combat's `Card` will get a `uid` in Task 2. The moment it does, the intrinsic roll — which fires on any unauthored stat change — would start rolling combat DAMAGE, which decision D says must stay instant. This task adds the off switch first, so Task 2 is safe.

**Files:**
- Modify: `packages/ui/src/Card.tsx`

**Interfaces:**
- Produces: `Card` accepts `autoRoll?: boolean` (default `true`). When `false`, the intrinsic-roll layout effect does not place a hold. The badge pop (`useBadgePop`) is UNAFFECTED — it still fires on any printed change, which is decision C.

- [ ] **Step 1: Add the prop**

In `Card.tsx`'s props type, add `autoRoll?: boolean;` with a doc comment: the intrinsic roll (an unauthored stat change withholds itself and rolls) is on by default for the shop; combat passes `false` because a combat badge's changes are either damage (instant by decision) or buffs (driven by the replay's own `effect` holds), so an intrinsic roll on top would double-drive damage.

- [ ] **Step 2: Gate the intrinsic effect**

Find the intrinsic-roll `useLayoutEffect` (it currently bails on `uid === undefined`). Add `autoRoll` to its early-out: `if (prev.uid !== uid || uid === undefined || !autoRoll) return;`. Add `autoRoll` to the effect's dependency array. Do NOT touch `useBadgePop` or the pop refs — the pop must survive.

- [ ] **Step 3: Verify nothing regressed in the shop**

`autoRoll` defaults to `true`, so every existing `<Card>` is unchanged. Run: `npx tsc -b && npx vitest run`. Then run the shop harness `docs/superpowers/harness/cascade-verify.mjs` (dev server on :5205; run via the scratchpad puppeteer install) and confirm it still PASSES — the intrinsic path is untouched for uid-bearing shop cards.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Card.tsx
git commit -m "feat(fx): Card gains an autoRoll gate for the intrinsic roll"
```

---

## Task 2: Combat's pre-buff hold becomes a module `effect` hold

This is the core conversion. Today the install (`useCombatReplay.ts:1491`, a layout effect) rebuilds a whole `Map` of pre-buff ABSOLUTE values via `preBuffHolds`. It becomes per-uid `holdStat` calls with the DELTA, at `effect` origin.

**Files:**
- Create: `packages/ui/src/fx/combatBuffRoll.ts`
- Create: `packages/ui/src/fx/combatBuffRoll.test.ts`
- Modify: `packages/ui/src/useCombatReplay.ts`

**Interfaces:**
- Produces: `combatBuffDeltas(beat, events, frame): { uid: string; attack: number; health: number }[]` — the per-uid buff delta for a beat, extracted from `preBuffHolds`'s summing so it is headlessly testable. `preBuffHolds` returned the pre-buff ABSOLUTE (`u.attack - t.atk`); this returns the DELTA (`t.atk`), because the module store is delta-based.

- [ ] **Step 1: Write the failing test for the pure delta**

Create `combatBuffRoll.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { combatBuffDeltas } from './combatBuffRoll';

const frame = { player: [{ uid: 'a', attack: 5, health: 6 }], enemy: [] } as never;

describe('combatBuffDeltas', () => {
  it('sums a beat\'s buff events per target and returns the DELTA, not the absolute', () => {
    const events = [
      { type: 'buff', target: 'a', attack: 2, health: 1 },
      { type: 'buff', target: 'a', attack: 1, health: 0 },
    ] as never[];
    expect(combatBuffDeltas({ start: 0, end: 2 }, events, frame)).toEqual([{ uid: 'a', attack: 3, health: 1 }]);
  });

  it('skips a zero net delta and a target not on the frame', () => {
    const events = [{ type: 'buff', target: 'ghost', attack: 2, health: 0 }] as never[];
    expect(combatBuffDeltas({ start: 0, end: 1 }, events, frame)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

Run: `npx vitest run packages/ui/src/fx/combatBuffRoll.test.ts`
Expected: FAIL — `combatBuffDeltas is not a function`.

- [ ] **Step 3: Implement the pure delta, refactoring `preBuffHolds` to use it**

In `combatBuffRoll.ts`, write `combatBuffDeltas` doing the same summing `preBuffHolds` does (iterate `beat.start..beat.end`, sum `buff` events per `target`, drop zero deltas, drop targets not on the frame), but returning `{ uid, attack: t.atk, health: t.hp }`. Then reduce `preBuffHolds` in `useCombatReplay.ts` to derive its absolute-value Map from `combatBuffDeltas` (`attack: u.attack - delta.attack`) so there is ONE copy of the summing — this is a temporary bridge; `preBuffHolds` is deleted in Task 3 once the install no longer needs a Map.

- [ ] **Step 4: Convert the install effect**

Rewrite the layout effect at `useCombatReplay.ts:1491`:

```tsx
  useLayoutEffect(() => {
    // Release last beat's combat holds and place this beat's — the module-store equivalent of the old
    // wholesale `setStatHold(next)`. A hold whose strike-release was lost (skip / speed change / re-seek)
    // cannot outlive its beat: the next beat releases it, and the store's TTL fails it open regardless.
    for (const uid of combatHeldRef.current) releaseStat(uid);
    combatHeldRef.current = [];
    if (!active || beatIdx === 0) return;
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    for (const d of combatBuffDeltas(beat, events, frame)) {
      // `effect` origin: the ticker leaves it alone, so the badge holds pre-buff until the STRIKE drives it
      // (see the release in `fireBuffCasts`/`fireSelfBuffs`). This is the same contract an authored `react`
      // layer has — combat's replay is that layer's hand-rolled equivalent.
      holdStat(d.uid, { attack: d.attack, health: d.health }, { origin: 'effect' });
      combatHeldRef.current.push(d.uid);
    }
  }, [active, beatIdx, seekNonce, beats, events, frame]);
```

Add `const combatHeldRef = useRef<string[]>([]);` near the other refs, and import `holdStat, releaseStat, revealStat` from `./fx/statHold`. Keep the `setStatHold` state for now — Task 3 deletes it; this task must leave the suite green, and the release sites still reference it until then. (If leaving a now-unused `setStatHold` write in place would fail lint, guard it minimally and note it; Task 3 removes it wholesale.)

- [ ] **Step 5: Gates and commit**

```bash
npx tsc -b && npx vitest run
git add packages/ui/src/fx/combatBuffRoll.ts packages/ui/src/fx/combatBuffRoll.test.ts packages/ui/src/useCombatReplay.ts
git commit -m "feat(fx): combat installs pre-buff holds into the module store"
```

---

## Task 3: The strike drives a ROLL, and `Unit` reads the store

Now combat's `Card` gets a `uid` so it reads the holds Task 2 places, and the strike-time release drives a roll (decision B) instead of deleting a Map entry.

**Files:**
- Modify: `packages/ui/src/Unit.tsx`
- Modify: `packages/ui/src/useCombatReplay.ts`
- Modify: `packages/ui/src/fx/combatBuffRoll.ts`

**Interfaces:**
- Consumes: `holdStat`/`revealStat` from Task 2.
- Produces: `driveRoll(uid, rollMs, speed): () => void` in `combatBuffRoll.ts` — starts a rAF that walks `revealStat(uid, p)` from 0 to 1 over `rollMs / speed`, and returns a cancel. The badge pop fires automatically as the printed number moves.

- [ ] **Step 1: `Unit` passes `uid` and `autoRoll={false}`**

In `Unit.tsx`, change the `<Card>` render to pass `uid={u.uid}` and `autoRoll={false}`. Delete the `statHold`/`statFlash` props from `UnitProps`, the two lines mapping them into `view` (`attack: statHold?.atk ?? u.attack` → `attack: u.attack`; `health` similarly; drop `flashAtk`/`flashHp`), and their entries in the memo comparator. Leave everything else in the view untouched.

- [ ] **Step 2: Write `driveRoll`, and a test for its clamping**

In `combatBuffRoll.ts` add `driveRoll`. It must clamp progress to `[0,1]`, stop at 1, and cancel cleanly. Add a headless test that drives it with a stubbed clock and asserts `revealStat` is called monotonically and released at 1 (mirror `statHold.test.ts`'s ticker tests — they show how to drive a rAF-free reveal under vitest). If `driveRoll` genuinely cannot be tested without a DOM rAF, extract the progress math (`elapsed → p`) into a pure helper and test that instead; say which you did.

- [ ] **Step 3: Convert the release sites**

In `fireBuffCasts` (`useCombatReplay.ts:844-858`) and `fireSelfBuffs` (`~883-888`), replace the `setStatHold((m) => …delete…)` + `setStatFlash((m) => …set…)` + the 360ms flash-clear timeout with a single `driveRoll(uid, COMBAT_ROLL_MS, combatSpeedRef.current)` call, and remove that uid from `combatHeldRef.current` (it now owns its own delivery). `COMBAT_ROLL_MS` is a new module constant — start it at `statHold`'s `DEFAULT_ROLL_MS` (420) so combat matches the shop; a comment should say it is the combat buff's count-up length and can diverge if tuned. The pop fires off the value change, so `.statflash` is no longer needed here.

- [ ] **Step 4: Delete the Maps and the accessors**

Remove the `statHold`/`statFlash` `useState`s, their resets in `resetTo`, the teardown clears, `statHoldFor`/`statFlashFor` from the returned object and the hook's type, and `preBuffHolds` (now unused — grep to confirm). Update `Recruit.tsx`'s two call sites that passed `statHold={replay.statHoldFor(u.uid)}` / `statFlash={…}` to drop those props.

- [ ] **Step 5: Retire `.statflash`**

Delete `CardView.flashAtk`/`flashHp`, their entries in `cardViewEqual.ts`, and the `.statflash` class logic in `Card.tsx`. Grep `styles.css` for `statflash` — if only the buff path used it, delete the rule and `@keyframes statflash`; if anything else references `.statflash`, leave it and note what.

- [ ] **Step 6: Gates and commit**

```bash
npx tsc -b && npx vitest run && npx eslint .
git add -A
git commit -m "feat(fx): combat buffs roll on strike through the shared store; .statflash retires"
```

---

## Task 4: The per-frame combat assertion — the merge gate

**This is the task the merge hinges on.** Everything above changed the most tuned surface in the game, and no unit test can see a wrong number mid-fight because `useCombatReplay`/`Unit`/`Card` have no DOM harness. This proves the invariant in a real browser or the branch does not merge.

**Files:**
- Create: `docs/superpowers/harness/combat-invariant.mjs`

- [ ] **Step 1: Write the harness**

Drive a real fight (Scene Builder → set up a board with a known buff source and a known enemy → start combat, or the closest reachable path; read `store.ts` for the combat-entry action). Sample EVERY visible combat badge every frame for the whole replay. Assert, per uid:
- The printed value is never below that unit's true pre-change value and never above its true post-change value at any frame — the invariant. Seed the per-uid baseline from the first frame, exactly as `shapes-verify.mjs` does.
- A buffed unit's badge is WITHHELD (holds pre-buff) until its strike, then rolls up — i.e. it does not snap at the reducer beat. Anchor to an observable strike signal (the buff FX, or the badge beginning to move), NOT a fixed millisecond, so it survives combat-speed changes.
- A DAMAGED unit's health updates without a withhold — damage is instant (decision D). Assert the damage number is not held back.

- [ ] **Step 2: Run it against a real fight**

Copy to the scratchpad puppeteer dir, run against :5205. It must PASS. If it finds a wrong number, STOP and report — that is a real defect in Tasks 2–3, not a harness problem to tune away.

- [ ] **Step 3: Negative controls**

Break each asserted property in turn (place the combat hold at `intrinsic` instead of `effect` so the ticker double-drives it; skip the `driveRoll` release so a buff never delivers; force a damage value through a hold) and confirm the harness FAILs each. Revert. A green that cannot fail is worthless.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/harness/combat-invariant.mjs
git commit -m "test(fx): per-frame combat badge invariant assertion"
```

---

## Task 5: Devlog, roadmap, and the spec's scorecard

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `docs/superpowers/specs/2026-08-04-stat-readout-choreography-design.md`

- [ ] **Step 1: Devlog**

Prepend a dated entry covering the whole plan: the two systems collapsing to one; decision A (why `effect` origin beat the spec's `startAt`); decisions B and C; `.statflash` retiring into the pop; what was deleted (two Maps, two props, `preBuffHolds`, `statHoldFor`/`statFlashFor`, `flashAtk`/`flashHp`); and the combat-invariant harness result with its negative controls. Match the existing entries' long-form voice.

- [ ] **Step 2: Roadmap**

Move the "combat unification" item out of Now — it has shipped. Note that the store now serves both surfaces with one vocabulary, and carry forward any follow-up the harness surfaced.

- [ ] **Step 3: Spec scorecard**

The spec's combat section proposed `startAt: <strike beat>`. Add a note there recording that implementation used `effect` origin instead, and why (decision A), so the spec and the code agree for the next reader.

- [ ] **Step 4: Commit**

```bash
git add docs/devlog.md docs/roadmap.md docs/superpowers/specs/2026-08-04-stat-readout-choreography-design.md
git commit -m "docs(fx): combat stat unification shipped"
```

---

## Risks

- **The wholesale-rebuild → per-uid conversion is where a stranded hold hides.** Today's install replaces the entire Map each beat, which structurally cannot leak. The per-uid `combatHeldRef` release (Task 2 Step 4) reproduces that, but it is hand-maintained; the harness (Task 4) is what proves no uid leaks across a beat, a skip, or a re-seek. If Task 4 cannot reach a re-seek/skip scenario, say so and test it by hand.
- **`combatSpeed` changing mid-roll.** The shop roll is wall-clock and does not adapt mid-roll; combat's `driveRoll` takes `speed` at start. A speed toggle mid-buff-roll would not re-scale. The old snap had no such window; a roll does. Judge in Task 4 whether this is visible; if so, `driveRoll` can read `combatSpeedRef` each frame.
- **Decision C means every damage tick pops the badge.** Already true today (the pop has no uid gate), so this is not new — but Task 4 should confirm a busy board does not read as too much motion now that buffs pop too.

---

## Task 6: drive the combat buff-roll on the beat clock (Option A)

**Why this exists.** Task 4's merge-gate harness proved combat buffs SNAP, not roll (owner decision B was for a roll). Root cause, controller-verified: the strike `setTimeout` that starts `driveRoll` (`useCombatReplay.ts:827`, `:859`) is pushed to the per-beat `timers` array that the cue effect's cleanup clears when the beat advances. The beat advances at lunge CONTACT (`runAttackExchangeCues`' `advance()`, welded to connection), which races the strike timer — measured winning by 5.3ms in one fight, losing by 44ms in another. When contact wins, the strike timer is cancelled, `driveRoll` never starts, and the hold is delivered by the next beat's release path as a snap. The invariant is never violated (the number only ever moves pre→post), so this is a missed animation, not a wrong number — but it is a real failure of decision B.

**The fix (Option A, chosen over the cheaper Option B because B ignores mid-roll combat-speed changes):** make the roll (a) survive the beat advance and (b) track the live combat speed each frame, so it rides combat's own clock rather than a wall-clock timer the beat teardown can cancel.

**Files:**
- Modify: `packages/ui/src/fx/combatBuffRoll.ts` (`driveRoll` + its pure helper)
- Modify: `packages/ui/src/fx/combatBuffRoll.test.ts`
- Modify: `packages/ui/src/useCombatReplay.ts` (how the strike schedules and owns the roll; teardown/re-seek cancellation)

**Interfaces:**
- `driveRoll(uid, rollMs, speedGetter: () => number): () => void` — speed becomes a GETTER read each frame, not a number captured at call time, so a mid-roll speed change re-scales the remaining roll. Returns a cancel.
- A combat-lifetime roll registry in `useCombatReplay`: in-flight roll cancels tracked in a ref, cancelled on combat teardown (the existing phase-out path) and on re-seek (`seekNonce`), but NOT on ordinary beat advance.

- [ ] **Step 1: Make `driveRoll` speed-aware, test the integral**

Change `driveRoll` to integrate elapsed real time scaled by `speedGetter()` each frame rather than dividing a fixed `rollMs` by a speed captured once. Extract the per-frame progress accumulation into a pure helper (`advanceRollProgress(prevProgress, dtMs, rollMs, speed) => nextProgress`, clamped [0,1]) and unit-test it: a speed that doubles partway reaches p=1 sooner than a constant speed; p never exceeds 1; a dt of 0 does not advance. The rAF loop stays untested (no DOM), same as the existing `driveRoll`.

- [ ] **Step 2: Schedule the strike so the beat advance cannot cancel it**

The strike delay (waiting `strikeMs`/`pulseHoldMs` before the roll begins) must no longer live in the per-beat `timers` array cleared on the cue effect's cleanup. Move it into the combat-lifetime registry: a strike timer + the resulting roll cancel are stored in a ref that survives beat advances. Read `useCombatReplay.ts` to find the existing combat-teardown path (the phase-out / `resetTo` / final cleanup) and cancel the registry there, and also on `seekNonce` change (a re-seek re-stages the fight). The ordinary per-beat cleanup must leave the registry alone.

Preserve every existing guarantee: a roll still starts at the strike moment; a re-seek still cancels in-flight rolls so a re-staged fight does not double-drive; combat end still clears everything (belt-and-braces with `dropBoardFx`'s `releaseAllStats`).

- [ ] **Step 3: Both release sites pass the speed getter**

`fireBuffCasts` and `fireSelfBuffs` call `driveRoll(uid, COMBAT_ROLL_MS, () => combatSpeedRef.current)` and register the cancel in the combat-lifetime registry instead of pushing the strike timer to `timers`.

- [ ] **Step 4: THE GATE — re-run the combat-invariant harness**

Run `docs/superpowers/harness/combat-invariant.mjs` against real unmodified combat (dev server :5205, scratchpad puppeteer). Required outcome, all three:
- **Buff withheld then ROLLS** — now PASS: the buffed badge holds pre-buff until the strike, then shows INTERMEDIATE values on the way up (not a snap). This is the property that was failing; it must now pass for a decisive delta (>=2).
- **Invariant** — still PASS: no badge ever prints outside [pre, post] across the whole fight.
- **Damage instant** — still PASS.

If the roll still snaps, the strike timer is still being cancelled somewhere — trace it, do not soften the harness. This step is the whole point of the task.

- [ ] **Step 5: Negative control**

Temporarily revert the registry change (put the strike timer back in the per-beat `timers` array) and confirm the harness's buff-roll property FAILS again (snaps). Revert. This proves the harness still discriminates and that the registry is what fixed it.

- [ ] **Step 6: Gates and commit**

`npx tsc -b`, `npx vitest run`, `npx eslint .` (7 pre-existing, no eighth). Commit. Do NOT update docs — Task 5 carries them.

**Risk:** this touches combat's beat-cleanup timing, the single most tuned path in the game. The harness is the gate; if it cannot reach a mid-roll speed change to prove the speed-getter, say so and note it as browser-unverified rather than claiming it.
