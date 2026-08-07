# Rally Beat Choreography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `on:'onAttack'` ("rally") card read as one beat — the unit's pulse fires first, then its effect resolves a uniform, tunable gap later — across all effect types, with a distinct card-frame pulse for the ally-attack watchers.

**Architecture:** One shared constant `RALLY_EFFECT_GAP_MS` (default 300) is the only timing knob. Every rally pulse fires at anchor `T` (the attacker's wind-up), decoupled from the effect's own events; every effect channel (summon / buff / cast / damage) withholds its FX and releases it at `T + gap`, reusing the withhold pattern shipped in PR #902. Self-rallies (`source === beat attacker`) pulse the `.cgem` medallion; watchers (`source !== attacker`) pulse the card frame in light blue.

**Tech Stack:** TypeScript + React (`packages/ui`), GSAP lunge timeline, the module stores `fx/summonHold.ts` / `fx/statHold.ts`, CSS in `packages/ui/src/styles.css`. Verification via headless-Chrome (puppeteer-core) probes against the running dev server, plus the existing `combat-invariant` harness.

## Global Constraints

- **New Input System / no legacy APIs** — follow existing `packages/ui` patterns; do not introduce new state libraries.
- **Presentation-only** — never change combat *sim* results (`packages/core`, `packages/sim`). This is choreography: the sim log is read, never altered. No card mechanics change.
- **Fail-open** — any withheld FX must have a TTL/scene-change backstop so a lost timer never hides a live minion or strands a number (mirror `summonHold`/`statHold`).
- **Single knob** — all pulse→effect timing derives from `RALLY_EFFECT_GAP_MS`; the watcher frame-pulse colour derives from one CSS custom property. No scattered magic numbers.
- **FX timing is not unit-testable** — the pulse-vs-effect ordering lives in React + GSAP + rAF; prove it with a headless browser probe (sample the DOM frame-by-frame), never a jsdom unit test. Pure helpers (attribution, classification) ARE unit-tested.
- **Verify before done** — typecheck clean (`npm run typecheck`), the touched package's vitest green, and the browser probe shows pulse-first + `~gap` for that task's card before committing.

---

## File Structure

- `packages/ui/src/useCombatReplay.ts` — MODIFY. Owns `T` (the rally pulse), the per-channel release scheduling, the constant. The hub.
- `packages/ui/src/Card.tsx` — MODIFY. Add the `pulseFrame` prop + `.framepulse` class wiring (the watcher frame pulse).
- `packages/ui/src/styles.css` — MODIFY. Add the frame-pulse keyframe + `--framepulse-color` (default light blue).
- `packages/ui/src/Unit.tsx` — MODIFY. Thread `pulseFrame` from the replay state into `<Card>`.
- `packages/ui/src/choreo/channels/rallyFired.ts` — MODIFY. Add pure helpers: `rallyPulseUnits` (who pulses this beat, and medallion-vs-frame) — extends the existing `attackSummonUids`.
- `packages/ui/src/choreo/channels/rallyFired.test.ts` — MODIFY. Unit-test the new pure helper.
- `docs/superpowers/harness/rally-beat-verify.mjs` — CREATE. The per-channel pulse-vs-effect probe.

---

## Task 1: Shared constant — rename `IMP_SUMMON_LEAD_MS` → `RALLY_EFFECT_GAP_MS`

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (the `IMP_SUMMON_LEAD_MS` const ~line 94, and its one use in the summon-withhold layout effect ~line 1752)

**Interfaces:**
- Produces: `const RALLY_EFFECT_GAP_MS = 300` (module-scope in `useCombatReplay.ts`) — every later task reads this.

- [ ] **Step 1: Rename the constant and its comment**

Change the `IMP_SUMMON_LEAD_MS` declaration to:

```ts
/**
 * The uniform gap between a rally's pulse (anchor `T`) and its effect FX landing. The ONE timing knob for
 * the rally beat — summons, buffs, casts and damage all release at `T + RALLY_EFFECT_GAP_MS`. Scaled by
 * combat speed at each call site so the beat shrinks with a faster replay.
 */
const RALLY_EFFECT_GAP_MS = 300;
```

- [ ] **Step 2: Update the single use site**

In the summon-withhold layout effect, change `IMP_SUMMON_LEAD_MS / speed` to `RALLY_EFFECT_GAP_MS / speed`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (no `IMP_SUMMON_LEAD_MS` references remain — `grep -rn IMP_SUMMON_LEAD_MS packages/` returns nothing).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "refactor(ui): rename IMP_SUMMON_LEAD_MS -> RALLY_EFFECT_GAP_MS (shared rally-beat knob)"
```

---

## Task 2: The watcher frame-pulse variant (CSS + Card prop)

**Files:**
- Modify: `packages/ui/src/Card.tsx` (props block ~line 398; the `.card` root className ~line 848 where the arched frame renders)
- Modify: `packages/ui/src/styles.css` (add near the `.cgem.pulsing` rules ~line 1720 and the `--framepulse-color` token in `:root` ~line 4495)

**Interfaces:**
- Produces: `pulseFrame?: number` prop on `Card` (a per-fire nonce, truthy = pulse; used as the frame element's React `key` so the animation restarts each fire, mirroring `pulseRally`).

- [ ] **Step 1: Add the `--framepulse-color` token**

In `:root` (near `--card`/`--line` ~line 4495 in `styles.css`):

```css
  --framepulse-color: #7fc8ff;        /* watcher frame pulse — light blue, tunable */
```

- [ ] **Step 2: Add the frame-pulse keyframe + class**

In `styles.css` (near the `.cgem.pulsing` block ~line 1748):

```css
/* WATCHER frame pulse — a one-shot light-blue ring bloom around the whole card frame (NOT the medallion),
   marking "an ally's attack triggered this unit". Lives on the arched .art box-shadow, same surface as the
   hover glow, so it hugs the silhouette without creating a stacking context. */
.card.compact.framepulse .art {
  animation: framepulse 0.55s ease-out;
}
@keyframes framepulse {
  0%   { box-shadow: inset 0 0 0 2px color-mix(in srgb, #f6ead0 78%, var(--c)), inset 0 7px 18px rgba(0,0,0,0.42), 0 6px 16px rgba(0,0,0,0.42), 0 0 0 0 var(--framepulse-color); }
  35%  { box-shadow: inset 0 0 0 2px color-mix(in srgb, #f6ead0 78%, var(--c)), inset 0 7px 18px rgba(0,0,0,0.42), 0 6px 16px rgba(0,0,0,0.42), 0 0 22px 5px var(--framepulse-color); }
  100% { box-shadow: inset 0 0 0 2px color-mix(in srgb, #f6ead0 78%, var(--c)), inset 0 7px 18px rgba(0,0,0,0.42), 0 6px 16px rgba(0,0,0,0.42), 0 0 0 0 transparent; }
}
```

- [ ] **Step 3: Add the prop + wire the class**

In `Card.tsx`, add to the props type (near `pulseRally` ~line 398):

```ts
  /** Pulse the whole card FRAME (not the medallion), light blue — a WATCHER answering an ally's attack.
   *  A per-fire nonce used as the frame element's `key` so the CSS animation restarts each fire. */
  pulseFrame?: number;
```

Add `pulseFrame` to the destructured params (near `pulseRally` ~line 344). On the root `.card` element (the arched frame container ~line 848), add `framepulse` to its className when `pulseFrame` is truthy, and set `key`:

```tsx
      className={[/* existing classes */, pulseFrame ? 'framepulse' : ''].filter(Boolean).join(' ')}
      key-note: the ROOT card node already has a stable identity from Unit; instead gate the animation restart
      by keying an inner wrapper — see Step 4.
```

- [ ] **Step 4: Restart-on-refire via keyed wrapper**

Because the `.card` root must keep a stable key (Unit owns it), wrap the arched `.art` frame in a fragment keyed by `framepulse-${pulseFrame ?? 0}` so a repeat watcher-fire remounts and replays the animation (same trick `.cgem` uses with `key={`cgem-${pulseRally ?? 0}`}`). Apply the `framepulse` class on `.card` and let the `.art` animation run on class presence; the key change forces the restart.

- [ ] **Step 5: Visual smoke check**

Start/confirm the dev server, then in the browser console force a pulse:
```js
// temporarily render a card with pulseFrame set, or toggle the class:
document.querySelector('.card.compact')?.classList.add('framepulse')
```
Expected: a light-blue ring blooms around the frame once and fades. Remove the class after.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` → clean.
```bash
git add packages/ui/src/Card.tsx packages/ui/src/styles.css
git commit -m "feat(ui): add watcher card-frame pulse variant (light-blue, tunable --framepulse-color)"
```

---

## Task 3: Pure helper — classify who pulses this beat (medallion vs frame)

**Files:**
- Modify: `packages/ui/src/choreo/channels/rallyFired.ts` (add `rallyPulseUnits` next to `attackSummonUids`)
- Modify: `packages/ui/src/choreo/channels/rallyFired.test.ts`

**Interfaces:**
- Consumes: `Moment`, `CombatEvent` (already imported in `rallyFired.ts`).
- Produces:
  ```ts
  export interface RallyPulse { uid: string; surface: 'medallion' | 'frame'; }
  // For an attackExchange moment: every friendly unit whose rally effect fires this beat, and whether it is
  // a SELF-rally (uid === attacker → medallion) or a WATCHER (uid !== attacker → frame).
  export function rallyPulseUnits(moment: Moment, events: CombatEvent[], attacker: string): RallyPulse[]
  ```

- [ ] **Step 1: Write the failing test**

Add to `rallyFired.test.ts`:

```ts
import { rallyPulseUnits } from './rallyFired';
const buffE = (source: string, target: string): CombatEvent =>
  ({ type: 'buff', target, attack: 1, health: 1, source } as CombatEvent);

describe('rallyPulseUnits', () => {
  it('marks the attacker\'s own rally effect as a medallion pulse', () => {
    // attacker 'A' buffs someone → A rallied on its own swing
    expect(rallyPulseUnits(span(0, 1), [buffE('A', 'X')], 'A'))
      .toEqual([{ uid: 'A', surface: 'medallion' }]);
  });
  it('marks a different friendly\'s effect as a frame pulse (watcher)', () => {
    // attacker 'A' swings; watcher 'W' reacts with a buff → frame pulse on W
    expect(rallyPulseUnits(span(0, 1), [buffE('W', 'X')], 'A'))
      .toEqual([{ uid: 'W', surface: 'frame' }]);
  });
  it('dedupes multiple events from the same source, first surface wins', () => {
    expect(rallyPulseUnits(span(0, 2), [buffE('W', 'X'), buffE('W', 'Y')], 'A'))
      .toEqual([{ uid: 'W', surface: 'frame' }]);
  });
  it('includes both a self-rally and a watcher in the same beat, in first-seen order', () => {
    expect(rallyPulseUnits(span(0, 2), [buffE('A', 'X'), buffE('W', 'Y')], 'A'))
      .toEqual([{ uid: 'A', surface: 'medallion' }, { uid: 'W', surface: 'frame' }]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run packages/ui/src/choreo/channels/rallyFired.test.ts`
Expected: FAIL — `rallyPulseUnits is not a function`.

- [ ] **Step 3: Implement the helper**

In `rallyFired.ts`:

```ts
export interface RallyPulse {
  uid: string;
  /** medallion = a self-rally (this unit swung), frame = a watcher (an ally swung). */
  surface: 'medallion' | 'frame';
}

/**
 * Who pulses this attack beat, and on which surface. A rally effect emits `buff`/`summon`/`sc`/`keyword`/`dmg`
 * events carrying the ACTING unit as `source`. If that source IS the beat's attacker it is a self-rally
 * (medallion); any other friendly source is a watcher answering the swing (frame). First event per source
 * wins; order preserved so a cascade reads left-to-right.
 */
const PULSE_EVENT_TYPES = new Set<CombatEvent['type']>(['buff', 'summon', 'sc', 'keyword', 'dmg']);
export function rallyPulseUnits(moment: Moment, events: CombatEvent[], attacker: string): RallyPulse[] {
  const seen = new Set<string>();
  const out: RallyPulse[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || !PULSE_EVENT_TYPES.has(e.type)) continue;
    const src = (e as { source?: string; minion?: { uid: string } }).source
      ?? (e.type === 'summon' ? undefined : undefined);
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push({ uid: src, surface: src === attacker ? 'medallion' : 'frame' });
  }
  return out;
}
```

> NOTE for implementer: a `summon` event carries the summoner as `source` (verified: `simulate.ts` emits `source: nearUid`), a `buff`/`sc`/`keyword`/`dmg` event carries `source` on the acting unit. `dmg` from a normal strike ALSO has a source (the attacker) — that is fine here: the attacker pulsing the medallion off its own swing-damage is the self-rally case and dedupes against any other self-rally event. If probe evidence in later tasks shows plain-strike damage causing a spurious medallion re-pulse on non-rally swings, narrow `PULSE_EVENT_TYPES` to exclude `dmg` and rely on Task 7 to pulse Philippe explicitly.

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run packages/ui/src/choreo/channels/rallyFired.test.ts`
Expected: PASS (all `rallyPulseUnits` + existing `attackSummonUids`/`ralliesFiredIn` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/channels/rallyFired.ts packages/ui/src/choreo/channels/rallyFired.test.ts
git commit -m "feat(ui): rallyPulseUnits — classify self-rally (medallion) vs watcher (frame) per beat"
```

---

## Task 4: Fire the pulses at `T`, decoupled — medallion for self-rallies, frame for watchers

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (the attack-exchange layout effect ~lines 1508-1544 where `onRallyPulse` + `rallies` live; the returned state ~line 1916 to add `pulseFrame` uids; the `resetTo` clears ~line 928)
- Modify: `packages/ui/src/Unit.tsx` (thread `pulseFrame` into `<Card>`)

**Interfaces:**
- Consumes: `rallyPulseUnits` (Task 3), `RALLY_EFFECT_GAP_MS` (Task 1), `pulseFrame` prop (Task 2).
- Produces: replay state gains `framePulseUids: Map<string, number>` (uid → per-fire nonce), mirrored on `rallyPulseUids`.

- [ ] **Step 1: Compute this beat's pulses at `T`**

In the attack-exchange layout effect, right where `onRallyPulse` fires (inside the `if (atkEl && a && d)` block, at the wind-up-pause callback), replace the current `rallies`-gated single yellow pulse with: call `rallyPulseUnits(cur, events, atkUid)`, then for each entry fire the matching pulse AT THE SAME PAUSE INSTANT (`T`):
- `surface === 'medallion'` → bump the existing `rallyPulse` nonce map for that uid (yellow if the uid has `RL`, else a normal-medallion nonce — reuse `setRallyPulse` for yellow, `setTriggers`/a medallion nonce for normal).
- `surface === 'frame'` → bump a new `framePulse` nonce map for that uid.

The pulse now fires off `rallyPulseUnits` (the fact a rally happened), NOT off the effect's own event reaching the trigger scan — that is the decoupling. Keep the existing `onRallyPulse` yellow behaviour for the attacker as the `medallion` branch when the attacker has `RL`.

- [ ] **Step 2: Add `framePulse` state + reset**

Near `rallyPulse` state (~line 734): `const [framePulse, setFramePulse] = useState<Map<string, number>>(new Map());` and a `frameNonceRef`. Clear it in `resetTo` (~line 928, alongside `setRallyPulse(new Map())`).

- [ ] **Step 3: Return it + thread to Unit/Card**

Add `framePulseUids: framePulse` to the returned object (~line 1916). In `Unit.tsx`, read it and pass `pulseFrame={framePulseUids.get(u.uid)}` to `<Card>` (mirror how `rallyPulse`/`pulseRally` is threaded). Add `framePulseUids` to the memo comparison so a watcher re-renders on its pulse.

- [ ] **Step 4: Browser probe — watcher frame pulse fires at `T`**

Extend the probe (Task 8 harness, or a scratch probe now): set up **Crypt Drake** + a beast that attacks twice, run the fight, assert the Crypt Drake `.card` gets `framepulse` (blue) at the ally's wind-up, BEFORE its buff lands. Assert a self-rally (Supporter) still pulses the `.cgem` medallion, not the frame.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` → clean.
```bash
git add packages/ui/src/useCombatReplay.ts packages/ui/src/Unit.tsx
git commit -m "feat(ui): fire rally pulses at T (medallion self-rally / frame watcher), decoupled from effect events"
```

---

## Task 5: Buffs — release the tendril + roll at `T + gap`

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (`fireBuffCasts` ~line 979, `fireSelfBuffs` ~line 1027, and their launch from `onWindupBuffs` ~line 1533)

**Interfaces:**
- Consumes: `RALLY_EFFECT_GAP_MS`, `combatSpeedRef`.

- [ ] **Step 1: Delay the buff-FX launch to `T + gap`**

`onWindupBuffs` currently fires `fireBuffCasts` + `fireSelfBuffs` at the wind-up pause (≈`T`). Wrap those calls in `window.setTimeout(..., RALLY_EFFECT_GAP_MS / speed)` so the tendril launches `gap` after the pulse. Register/clear the timer the same way the summon reveal timer is (Task-1 pattern): store the handle, clear it on the effect's cleanup / next beat, rely on the roll registry + hold TTL as the fail-open backstop.

- [ ] **Step 2: Confirm the roll still lands correctly**

`fireBuffCasts`/`fireSelfBuffs` compute `strikeMs` then `scheduleRoll(target, strikeMs/speed)`. Since the whole launch now starts `gap` later, the roll naturally lands `gap` later too. Verify no double-delay (do NOT also add `gap` to `scheduleRoll`'s ms — the delayed launch already carries it).

- [ ] **Step 3: Browser probe — Supporter**

Run the fight from the harness scenario (Supporter + Bard vs Omen, the existing `combat-invariant` seed). Assert: Supporter's medallion pulse fires at `T`, its dragon-buff tendril + the target's badge roll begin ~`RALLY_EFFECT_GAP_MS` later, and the badge never prints out of range (invariant harness stays green).

- [ ] **Step 4: Typecheck + combat-invariant harness + commit**

Run: `npm run typecheck` → clean. Run the `combat-invariant` harness → all properties pass.
```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "feat(ui): rally buffs release at T+gap (pulse then buff), shared knob"
```

---

## Task 6: Casts — withhold the cast FX to `T + gap`

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` and/or `packages/ui/src/choreo/score.ts` (the `scCast`/`sc` cue path)

**Interfaces:**
- Consumes: `RALLY_EFFECT_GAP_MS`, `rallyPulseUnits` (to know a cast is rally-sourced).

- [ ] **Step 1: Chart the cast FX firing (investigation — write findings into the task before coding)**

Read: how an `sc`/`scCast` event for a rally cast (Hoardbreaker `rallyCastSpell` → "cast Growth") produces its on-screen FX. Specifically answer, in a comment on the commit: (a) is the cast FX fired from `runMomentCues` (`score.ts` `scCast` cue) at the moment's start, or absorbed into the wind-up; (b) does the cast's resulting buff already flow through Task 5's buff path (if so, only the cast *flash* needs delaying, not the buff). Confirm with a quick probe of a Hoardbreaker fight (log the timestamps of the `sc` FX vs the wind-up pause).

- [ ] **Step 2: Delay the rally cast FX to `T + gap`**

Following the finding: for an `sc`/cast FX whose source is a rally unit in an attackExchange (test via `rallyPulseUnits`/source), schedule its cue at `T + RALLY_EFFECT_GAP_MS / speed` instead of the moment start — same delayed-launch + cleanup pattern as Task 5. If the cast's buff already rides Task 5, delay only the cast flash so flash + buff stay coincident at `T + gap`.

- [ ] **Step 3: Browser probe — Hoardbreaker**

Assert Hoardbreaker's medallion pulse at `T`, the cast FX + resulting buff at ~`T + gap`.

- [ ] **Step 4: Typecheck + commit**

```bash
git add -A
git commit -m "feat(ui): rally casts release at T+gap"
```

---

## Task 7: Damage — withhold the damage FX to `T + gap`, and pulse Philippe

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (`onDamageFx` ~line 1362; the projectile path ~line 889)

**Interfaces:**
- Consumes: `RALLY_EFFECT_GAP_MS`, `rallyPulseUnits`.

- [ ] **Step 1: Chart the rally-damage FX (investigation)**

Read `onDamageFx` (~line 1362) and the projectile setup (~line 889). Answer in the commit: how Philippe's `rallyDamageRandomEnemy` dmg-to-a-random-enemy renders (projectile bolt? damage float?), and at what beat it fires relative to the attacker's wind-up. Confirm with a Philippe probe.

- [ ] **Step 2: Ensure Philippe pulses, then delay its damage FX**

Philippe emits a `dmg` event as its rally; Task 3's `rallyPulseUnits` already includes `dmg` in `PULSE_EVENT_TYPES`, so Philippe should pulse the medallion at `T` after Task 4 — verify it does. Then schedule its rally-damage FX (projectile/float) at `T + gap`, same delayed-launch + cleanup pattern.

- [ ] **Step 3: Browser probe — Philippe**

Assert Philippe's medallion pulse at `T`, its bolt/float to the random enemy at ~`T + gap`.

- [ ] **Step 4: Typecheck + commit**

```bash
git add -A
git commit -m "feat(ui): rally damage releases at T+gap, Philippe pulses"
```

---

## Task 8: Consolidated per-channel probe harness

**Files:**
- Create: `docs/superpowers/harness/rally-beat-verify.mjs`

- [ ] **Step 1: Write the harness**

A puppeteer-core script (model it on the existing `combat-invariant.mjs` / the imp-entrance probe): for each representative card — Supporter (buff), Errand Fiend (summon), Hoardbreaker (cast), Philippe (damage), Crypt Drake (watcher) — build the scenario via `startSceneBuilder` + shop-inject + `faceOmen`, sample the DOM every rAF, and record for the acting unit: the frame `t` its pulse class appears (`.cgem.pulsing` / `.framepulse`), and the frame `t` its effect FX appears (tendril / summonpop / cast flash / projectile). Assert `pulse_t < effect_t` and `effect_t - pulse_t` is within `[gap*0.6, gap*1.8]` of `RALLY_EFFECT_GAP_MS` (loose bounds absorb rAF/sampling jitter, as in the imp probe).

- [ ] **Step 2: Run it against the dev server**

Run: `node docs/superpowers/harness/rally-beat-verify.mjs` (dev server on :5210).
Expected: all five channels report `PASS` (pulse-first + gap in-band).

- [ ] **Step 3: Run the combat-invariant harness**

Confirm no badge ever prints out of range across the retimed buffs.

- [ ] **Step 4: Eyeball on :5210**

Watch one fight with each card type; confirm the beat reads pulse → effect and the watcher frame pulse is light blue and distinct from the medallion.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/harness/rally-beat-verify.mjs
git commit -m "test(fx): per-channel rally-beat probe (pulse-first + gap) across buff/summon/cast/damage/watcher"
```

---

## Self-Review (author checklist)

- **Spec coverage:** constant (T1) ✓; universal decoupled pulse (T3–T4) ✓; medallion vs frame / light-blue watcher (T2–T4) ✓; per-channel release — summon (T1 re-point) ✓, buff (T5) ✓, cast (T6) ✓, damage + Philippe pulse (T7) ✓; trivial pulse-only cards covered by T4's universal pulse (no separate task needed — they emit `buff`/`keyword` events so `rallyPulseUnits` includes them, and they have no board FX to delay) ✓; testing (T8) ✓.
- **Uncharted-channel honesty:** T6 and T7 each lead with a concrete investigation step (exact functions named) because the spec flagged casts/damage as un-absorbed and least-charted; the implementation step then follows the same delayed-launch + cleanup pattern proven in T1/T5.
- **Type consistency:** `RallyPulse{uid,surface}` and `rallyPulseUnits(moment,events,attacker)` used identically in T3/T4; `pulseFrame` prop + `framePulseUids` map named consistently across T2/T4; `RALLY_EFFECT_GAP_MS` the single constant everywhere.
- **Backstop:** every delayed-launch timer reuses the summon-hold/roll-registry fail-open (stated in Global Constraints + each task).
