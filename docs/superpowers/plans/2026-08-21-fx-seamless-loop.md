# Seamless FX Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the FX workbench author-controllable seamless looping — a continuous emitter loops without the blink, and shaped compositions can cross-fade — persisted so the in-game `cia-hp` enchant loops seamlessly.

**Architecture:** At a *seamless* loop boundary the player no longer culls every particle (`killAllLive`); instead it tells each live instance to `stopEmitting()` and moves it to a `finishing` set that ticks until the instance's own `isComplete()` reports empty, while a fresh cycle spawns — so the outgoing generation fades out as the new one emits. Two persisted def properties, `loopMode` (`playOut` | `seamless`) and signed `loopJoinMs`, control it; the workbench edits them and `playDef` reads them.

**Tech Stack:** TypeScript, Pixi.js, React, Vitest. All work is in `packages/ui/src/fx/**` (Mike's presentation domain).

## Global Constraints

- **`playOut` is the default `loopMode` and must be byte-for-byte today's behavior** — every existing def omits the field and loops exactly as before. The existing `player.test.ts` loop tests are the regression guard and must pass unchanged.
- **Presentation-only.** No change to the engine, event log, or gameplay timing.
- **Persisted loop fields follow the omit-unless-non-default discipline** already used for `seed`/`slot`/`ease` in `defStore.ts`: `loopMode` is written only when `'seamless'`; `loopJoinMs` only when `!== 0`. A def that never touches them saves the exact JSON it saved before these fields existed. Do NOT bump `FX_DEF_VERSION`.
- **Perf:** no per-frame layout reads, no per-frame allocation in the player's hot `update` path (mirror the existing `budgetState`/scratch-object discipline).
- **Never reset a tuned value to a default as a side effect** (choreography rule). Publishing tuned values stays explicit (`npm run fx:publish`).
- **Verify before done:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green. Run from the worktree root.

---

### Task 1: `stopEmitting()` primitive contract (emitter, smoke, ribbon)

Add an optional "stop emitting new particles but let existing ones finish" capability to the primitive interface and implement it where a primitive can emit indefinitely. This is what lets a carried-over instance drain to completion instead of being culled.

**Files:**
- Modify: `packages/ui/src/fx/primitive.ts` (the `FxInstance` interface, ~line 44-69)
- Modify: `packages/ui/src/fx/primitives/emitter.ts` (instance state + `emitting` gate ~line 532 + `isComplete` ~line 556; export a pure predicate)
- Modify: `packages/ui/src/fx/primitives/smoke.ts` (same pattern, `emitting` gate ~line 551 + `isComplete` ~line 575)
- Modify: `packages/ui/src/fx/primitives/ribbon.ts` (continuous mode: `isComplete` ~line 581)
- Test: `packages/ui/src/fx/primitives/emitter.test.ts`, `packages/ui/src/fx/primitives/smoke.test.ts`

**Interfaces:**
- Produces: `FxInstance.stopEmitting?(): void` — optional; absence means "already bounded, just tick to completion". Emitter/smoke/ribbon implement it.
- Produces (emitter.ts): `export function emitterStoppedComplete(stopped: boolean, moteCount: number): boolean` — pure; `stopped && moteCount === 0`.
- Produces (smoke.ts): `export function smokeStoppedComplete(stopped: boolean, puffCount: number): boolean` — pure; identical shape.

- [ ] **Step 1: Write the failing pure-predicate tests**

In `emitter.test.ts`, add to the imports from `./emitter`: `emitterStoppedComplete`. Add:

```ts
describe('emitterStoppedComplete', () => {
  it('is not complete while stopped but motes remain', () => {
    expect(emitterStoppedComplete(true, 3)).toBe(false);
  });
  it('is complete once stopped and every mote has died', () => {
    expect(emitterStoppedComplete(true, 0)).toBe(true);
  });
  it('is never complete while still emitting (not stopped)', () => {
    expect(emitterStoppedComplete(false, 0)).toBe(false);
  });
});
```

Mirror the same three cases in `smoke.test.ts` for `smokeStoppedComplete` (import it from `./smoke`; "puff" wording).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/fx/primitives/emitter.test.ts packages/ui/src/fx/primitives/smoke.test.ts`
Expected: FAIL — `emitterStoppedComplete is not a function` / `smokeStoppedComplete is not a function`.

- [ ] **Step 3: Add the optional interface method**

In `packages/ui/src/fx/primitive.ts`, inside `interface FxInstance`, next to the other optional methods (after `isComplete?()`):

```ts
  /** Stop spawning new particles but keep the existing ones alive to finish their own life. Used by the
   *  player's SEAMLESS loop so an outgoing cycle drains naturally while the next one emits, instead of being
   *  culled at the boundary (which is the loop "blink"). A bounded primitive that emits nothing new anyway
   *  (burst, shockwave) may omit this — the player treats its absence as "already finishing". */
  stopEmitting?(): void;
```

- [ ] **Step 4: Implement `stopEmitting` + `emitterStoppedComplete` in emitter.ts**

Add the pure predicate near `emitterFireComplete`:

```ts
/** A STOPPED emitter (see `FxInstance.stopEmitting`) is complete once its last mote has died — independent of
 *  the one-shot emit window, which is why it is its own predicate rather than a branch of `emitterFireComplete`. */
export function emitterStoppedComplete(stopped: boolean, moteCount: number): boolean {
  return stopped && moteCount === 0;
}
```

In the emitter instance class, add a field beside `oneShot` (~line 403): `private stopped = false;`. Change the `emitting` gate (~line 532) to also require not-stopped:

```ts
    const emitting = this.headSet && !this.stopped && (!this.oneShot || withinEmitWindow(this.emitElapsedMs, p.life));
```

Change `isComplete` (~line 556):

```ts
  isComplete(): boolean {
    return emitterFireComplete(this.oneShot, this.emitElapsedMs, this.params.life, this.motes.length)
      || emitterStoppedComplete(this.stopped, this.motes.length);
  }
```

Add the method next to `setParams`:

```ts
  stopEmitting(): void {
    this.stopped = true;
  }
```

- [ ] **Step 5: Implement the same in smoke.ts**

Add `export function smokeStoppedComplete(stopped: boolean, puffCount: number): boolean { return stopped && puffCount === 0; }`. Add `private stopped = false;`, `&& !this.stopped` in the `emitting` gate (~line 551), OR it into `isComplete` (~line 575) with the smoke's puff-array length, and add `stopEmitting(): void { this.stopped = true; }`.

- [ ] **Step 6: Implement `stopEmitting` in ribbon.ts (continuous mode)**

Ribbon's continuous mode never self-completes (`isComplete` returns false there). Add `private stopped = false;`, set it in `stopEmitting(): void { this.stopped = true; }`, and make continuous-mode `isComplete` return `true` once `stopped` and the trail has emptied (mirror the existing bounded-mode completion test the file already uses for its tail). If ribbon has no notion of remaining segments to check, `return this.stopped` is acceptable — a stopped continuous ribbon has nothing left to draw.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/fx/primitives/emitter.test.ts packages/ui/src/fx/primitives/smoke.test.ts packages/ui/src/fx/primitives/ribbon.test.ts`
Expected: PASS (all existing tests still green too).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/fx/primitive.ts packages/ui/src/fx/primitives/emitter.ts packages/ui/src/fx/primitives/smoke.ts packages/ui/src/fx/primitives/ribbon.ts packages/ui/src/fx/primitives/emitter.test.ts packages/ui/src/fx/primitives/smoke.test.ts
git commit -m "feat(fx): stopEmitting() primitive contract for emitter/smoke/ribbon"
```

---

### Task 2: Player seamless loop boundary — carry-over instead of cull

Add `loopMode` to the player and a `finishing` set. In `seamless` mode, at the loop boundary, stop-emit + carry over each live instance instead of `killAllLive`, and spawn the fresh cycle. This is the anti-blink core.

**Files:**
- Modify: `packages/ui/src/fx/player.ts` (`FxPlayerOptions` line 9-15; `FxPlayer` interface line 17-64; internals from line 126; `update` loop line 404+; `stop`/`destroy` line 392/585)
- Test: `packages/ui/src/fx/player.test.ts`

**Interfaces:**
- Consumes: `FxInstance.stopEmitting?()` (Task 1).
- Produces: `FxPlayerOptions.loopMode?: 'playOut' | 'seamless'` (default `'playOut'`); `FxPlayer.setLoopMode(mode: 'playOut' | 'seamless'): void`. A `finishing` array of `Live` ticked every `update` and reaped on `isComplete()`.

- [ ] **Step 1: Write the failing test — outgoing instance carries over, not culled**

The stub `FxInstance` in `player.test.ts` (line 20) has no `isComplete`/`stopEmitting`. Add a helper that builds a stub whose instance reports "still has particles" until stop-emitted + drained. Add near the top fixtures:

```ts
// A stub instance that models "emitting, then a tail": isComplete stays false until stopEmitting() is called
// AND `tailMs` of ticks have elapsed since. Lets a player test assert the seamless carry-over lifecycle.
const drainingPrimitive = (id: string, tailMs = 100) => ({
  id,
  params: { size: { kind: 'slider' as const, label: 'Size', min: 0, max: 10, step: 1, default: 5 } },
  spawn: () => {
    let stopped = false;
    let sinceStop = 0;
    const inst: FxInstance = {
      update: vi.fn((dt: number) => { if (stopped) sinceStop += dt; }),
      setParams: vi.fn(),
      stopEmitting: vi.fn(() => { stopped = true; }),
      isComplete: () => stopped && sinceStop >= tailMs,
      destroy: vi.fn(),
    };
    spawned.push({ id, inst });
    return inst;
  },
});
```

Then the test:

```ts
describe('seamless loop', () => {
  beforeEach(() => { clearPrimitives(); spawned.length = 0; registerPrimitive(drainingPrimitive('a')); });

  it('carries the outgoing cycle over the boundary instead of culling it', () => {
    const def: FxDef = { id: 's', duration: 200, layers: [{ primitive: 'a', anchor: 'target', at: 0, params: {} }] };
    const p = createPlayer(def, CTX, { loop: true, loopMode: 'seamless' });
    p.fireLoop();
    const first = latest('a');
    // Cross the boundary (duration 200) in one 210ms tick.
    p.update(210);
    // The outgoing instance was told to stop and is NOT destroyed yet (it is finishing).
    expect(first.stopEmitting).toHaveBeenCalledTimes(1);
    expect(first.destroy).not.toHaveBeenCalled();
    // A fresh instance now exists (emission continues → no blink).
    const second = latest('a');
    expect(second).not.toBe(first);
  });

  it('reaps a finishing instance once it completes', () => {
    const def: FxDef = { id: 's', duration: 200, layers: [{ primitive: 'a', anchor: 'target', at: 0, params: {} }] };
    const p = createPlayer(def, CTX, { loop: true, loopMode: 'seamless' });
    p.fireLoop();
    const first = latest('a');
    p.update(210);           // boundary: `first` becomes finishing (tail 100ms)
    p.update(100);           // its tail elapses
    p.update(16);            // next tick reaps it
    expect(first.destroy).toHaveBeenCalledTimes(1);
  });

  it('drains the finishing set on stop()', () => {
    const def: FxDef = { id: 's', duration: 200, layers: [{ primitive: 'a', anchor: 'target', at: 0, params: {} }] };
    const p = createPlayer(def, CTX, { loop: true, loopMode: 'seamless' });
    p.fireLoop();
    const first = latest('a');
    p.update(210);           // `first` is finishing
    p.stop();
    expect(first.destroy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/player.test.ts -t "seamless loop"`
Expected: FAIL — `loopMode` not accepted / `stopEmitting` never called / outgoing `destroy` called at the boundary.

- [ ] **Step 3: Add `loopMode` state + `finishing` set + `setLoopMode`**

In `FxPlayerOptions` add `loopMode?: 'playOut' | 'seamless';`. In `FxPlayer` add `setLoopMode(mode: 'playOut' | 'seamless'): void;`. In `createPlayer`, near `let loopEnabled` (line 145): `let loopMode: 'playOut' | 'seamless' = opts.loopMode ?? 'playOut';` and `const finishing: Live[] = [];`.

Add a carry-over helper next to `kill`/`killAllLive` (line 189-199):

```ts
  // SEAMLESS boundary: instead of destroying a live instance, tell it to stop emitting and let it drain in
  // `finishing` (ticked below, reaped on isComplete) so its particles fade out while the next cycle emits.
  const carryOver = (index: number): void => {
    const l = live.get(index);
    if (!l) return;
    l.inst.stopEmitting?.();
    finishing.push(l);
    live.delete(index);
  };
  const carryAllLive = (): void => { for (const i of [...live.keys()]) carryOver(i); };
  // Tick every finishing instance and reap the ones that have drained. Called once per update().
  const reapFinishing = (dt: number): void => {
    for (let i = finishing.length - 1; i >= 0; i--) {
      const l = finishing[i];
      l.inst.update(dt);
      if (l.inst.isComplete ? l.inst.isComplete() : true) {
        l.inst.destroy();
        l.container.destroy({ children: true });
        finishing.splice(i, 1);
      }
    }
  };
  const drainFinishing = (): void => {
    for (const l of finishing) { l.inst.destroy(); l.container.destroy({ children: true }); }
    finishing.length = 0;
  };
```

Add `setLoopMode(mode) { loopMode = mode; }` to the returned object next to `setLoop`.

- [ ] **Step 4: Swap the boundary kill for carry-over in seamless mode + tick finishing**

At the TOP of `update` (after `const dt = dtMs * speed;`, line 406), add `reapFinishing(dt);` so finishing instances advance every frame regardless of the branch taken.

In the firing-completion branch (line 441-456, the `if (clock >= def.duration && allFiringLayersDone())` block) and the ordinary-wrap branch (line 497-498, `while (clock >= def.duration) clock -= def.duration; killAllLive();`), replace the `killAllLive()` at the restart with a mode switch:

```ts
      if (loopMode === 'seamless') carryAllLive(); else killAllLive();
```

For the seamless firing branch specifically: the restart must not wait for `allFiringLayersDone()` (that wait IS the blink for a long tail). Gate the loop point on `clock >= def.duration` alone when `loopMode === 'seamless'`, carrying the still-live instances over. Keep the `playOut` path (`clock >= def.duration && allFiringLayersDone()`) exactly as-is.

- [ ] **Step 5: Spawn seamless layers as continuous (`oneShot = false`)**

A seamless cycle's emitters must emit across the whole loop period, not be bounded to `life`. Where the seamless restart respawns layers via `reconcile`, ensure the respawn is NOT `oneShot` (pass `reconcile(0)` / `spawn(index, false)` on the seamless path, not `reconcile(0, true)`). The outgoing instance handed to `finishing` is what `stopEmitting()` bounds. Confirm the two existing fire paths keep `oneShot=true`.

- [ ] **Step 6: Drain finishing in `stop()` and `destroy()`**

In `stop()` (line 392) after `killAllLive();` add `drainFinishing();`. In `destroy()` (line 585) do the same so no instance/container/particle leaks.

- [ ] **Step 7: Run to verify pass + no regression**

Run: `npx vitest run packages/ui/src/fx/player.test.ts`
Expected: PASS — the three seamless tests AND every existing loop/fire test (the `playOut` guard).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/fx/player.ts packages/ui/src/fx/player.test.ts
git commit -m "feat(fx): seamless loop boundary — carry particles over instead of culling"
```

---

### Task 3: Signed loop join (overlap / gap)

Turn the loop-gap timing into a single signed `loopJoinMs`: positive = gap (both modes; subsumes today's `loopGapMs`), negative = overlap (seamless only; the fresh cycle starts early).

**Files:**
- Modify: `packages/ui/src/fx/player.ts` (`FxPlayerOptions.loopGapMs` → keep, add join; `setLoopGap` → add `setLoopJoin`; the gap handling at line 143, 412-419, 448-452, 464-475, 482-490)
- Test: `packages/ui/src/fx/player.test.ts`

**Interfaces:**
- Produces: `FxPlayerOptions.loopJoinMs?: number` (default 0, signed); `FxPlayer.setLoopJoin(ms: number): void`. Positive delays the fresh cycle; negative (seamless only) starts it `|ms|` early.

- [ ] **Step 1: Write the failing tests**

```ts
describe('loop join', () => {
  beforeEach(() => { clearPrimitives(); spawned.length = 0; registerPrimitive(drainingPrimitive('a')); });
  const mk = (opts: Partial<FxPlayerOptions>): FxPlayer => {
    const def: FxDef = { id: 's', duration: 200, layers: [{ primitive: 'a', anchor: 'target', at: 0, params: {} }] };
    return createPlayer(def, CTX, { loop: true, loopMode: 'seamless', ...opts });
  };

  it('a positive join delays the fresh cycle past the boundary', () => {
    const p = mk({ loopJoinMs: 80 }); p.fireLoop();
    const first = latest('a');
    p.update(210);                 // crossed the boundary, but join holds the fresh spawn
    expect(latest('a')).toBe(first);   // no new instance yet
    p.update(80);                  // join elapses
    expect(latest('a')).not.toBe(first);
  });

  it('a negative join (overlap) starts the fresh cycle before the boundary in seamless mode', () => {
    const p = mk({ loopJoinMs: -60 }); p.fireLoop();
    const first = latest('a');
    p.update(150);                 // 200 - 60 = 140 < 150 → fresh cycle already started
    expect(latest('a')).not.toBe(first);
  });

  it('a negative join clamps to 0 in playOut mode (no early start)', () => {
    const def: FxDef = { id: 's', duration: 200, layers: [{ primitive: 'a', anchor: 'target', at: 0, life: 200, params: {} }] };
    const p = createPlayer(def, CTX, { loop: true, loopMode: 'playOut', loopJoinMs: -60 });
    p.fireLoop();
    const first = latest('a');
    p.update(150);
    expect(latest('a')).toBe(first);   // still the first cycle
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/player.test.ts -t "loop join"`
Expected: FAIL — `loopJoinMs` not accepted / timing not shifted.

- [ ] **Step 3: Add the signed join, mapping onto the existing gap machinery**

Add `loopJoinMs?: number` to `FxPlayerOptions`. In `createPlayer`, derive from either option for back-compat: `let loopJoinMs = Number.isFinite(opts.loopJoinMs) ? (opts.loopJoinMs as number) : Math.max(0, opts.loopGapMs ?? 0);`. Add `setLoopJoin(ms) { loopJoinMs = Number.isFinite(ms) ? ms : 0; }` (keep `setLoopGap` as an alias that forwards to it for the workbench's existing call, or update the caller in Task 6).

- **Positive join** = the existing gap: reuse the `inGap`/`gapElapsed` hold with `loopGapMs` replaced by `Math.max(0, loopJoinMs)`. In `playOut`, negative clamps to 0, so behavior is unchanged there.
- **Negative join (seamless overlap)** = move the loop point earlier. Where the seamless branch tests `clock >= def.duration`, use `clock >= def.duration + Math.min(0, loopJoinMs)` (a negative join lowers the threshold, starting the fresh cycle early). Carry the outgoing instances over exactly as Task 2 (they keep draining during the overlap). Carry the post-boundary `overflow` into the fresh cycle's clock as the existing wrap does, so no time is dropped.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/ui/src/fx/player.test.ts`
Expected: PASS (join tests + all prior).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/player.ts packages/ui/src/fx/player.test.ts
git commit -m "feat(fx): signed loop join — gap (both modes) and seamless overlap"
```

---

### Task 4: Persist `loopMode` / `loopJoinMs` in the def schema

**Files:**
- Modify: `packages/ui/src/fx/defStore.ts` (`StoredFxDef` interface line 58; `coerceDef` line 200-240; `toStoredDef` line 313-353)
- Test: `packages/ui/src/fx/defStore.test.ts` (mirror the existing seed/slot/ease round-trip tests)

**Interfaces:**
- Produces: `StoredFxDef.loopMode?: 'seamless'` and `StoredFxDef.loopJoinMs?: number`. `toStoredDef(..., loopMode?, loopJoinMs?)` two new trailing optional params. `coerceDef` reads both back.

- [ ] **Step 1: Write failing round-trip tests**

In `defStore.test.ts`, add (mirroring the slot/ease round-trip tests already there):

```ts
it('round-trips loopMode: seamless and drops playOut as the default omission', () => {
  const seamless = toStoredDef('d', 100, [], undefined, undefined, undefined, undefined, 'seamless', 0);
  expect(seamless.loopMode).toBe('seamless');
  expect(coerceDef(JSON.parse(JSON.stringify(seamless)))?.loopMode).toBe('seamless');
  const playout = toStoredDef('d', 100, [], undefined, undefined, undefined, undefined, 'playOut', 0);
  expect('loopMode' in playout).toBe(false);      // default is an OMISSION
});

it('round-trips a non-zero loopJoinMs and omits zero', () => {
  const joined = toStoredDef('d', 100, [], undefined, undefined, undefined, undefined, 'seamless', -60);
  expect(joined.loopJoinMs).toBe(-60);
  expect(coerceDef(JSON.parse(JSON.stringify(joined)))?.loopJoinMs).toBe(-60);
  const zero = toStoredDef('d', 100, [], undefined, undefined, undefined, undefined, 'seamless', 0);
  expect('loopJoinMs' in zero).toBe(false);
});

it('a def without loop fields loads as undefined (backward compatible)', () => {
  const legacy = coerceDef({ version: 1, id: 'd', duration: 100, layers: [] });
  expect(legacy?.loopMode).toBeUndefined();
  expect(legacy?.loopJoinMs).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run packages/ui/src/fx/defStore.test.ts`
Expected: FAIL — `toStoredDef` arity / fields absent.

- [ ] **Step 3: Extend `StoredFxDef`**

After `ease?` (line 88), add:

```ts
  /** How this effect loops WHEN looped (the caller decides whether to loop; this decides how). OPTIONAL and
   *  omitted unless `'seamless'`, on the same terms as `seed`/`slot`/`ease` — a def that never touches it saves
   *  the exact JSON it saved before this field existed. Absent = `'playOut'` (today's play-out-then-repeat). */
  loopMode?: 'seamless';
  /** Signed loop-join offset in ms: `> 0` a gap between cycles, `< 0` (seamless only) an overlap. OPTIONAL and
   *  omitted when `0`, same discipline as above. */
  loopJoinMs?: number;
```

(`loopMode?: 'seamless'` — the type intentionally has only the non-default member, since `playOut` is expressed as omission, exactly like `slot?: 'under'`.)

- [ ] **Step 4: Extend `toStoredDef`**

Add two trailing optional params after `ease` and write them with the omit-unless-non-default rule, appended AFTER `ease` to preserve key order:

```ts
  loopMode?: 'playOut' | 'seamless',
  loopJoinMs?: number,
): StoredFxDef {
  ...
  if (loopMode === 'seamless') def.loopMode = 'seamless';
  if (typeof loopJoinMs === 'number' && Number.isFinite(loopJoinMs) && loopJoinMs !== 0) def.loopJoinMs = loopJoinMs;
  return def;
```

- [ ] **Step 5: Extend `coerceDef`**

Alongside the seed/slot/ease reads (line 221-240), add:

```ts
  if (raw.loopMode === 'seamless') def.loopMode = 'seamless';
  const loopJoinMs = finite(raw.loopJoinMs);
  if (loopJoinMs !== null && loopJoinMs !== 0) def.loopJoinMs = loopJoinMs;
```

(`raw` and `finite` are already in scope in `coerceDef`.)

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run packages/ui/src/fx/defStore.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/fx/defStore.ts packages/ui/src/fx/defStore.test.ts
git commit -m "feat(fx): persist loopMode/loopJoinMs in the def schema (omit-unless-set)"
```

---

### Task 5: `playDef` applies the stored loop fields

**Files:**
- Modify: `packages/ui/src/fx/playDef.ts` (createPlayer call ~line 378; near the `stored.seed`/`stored.slot` reads)
- Test: `packages/ui/src/fx/playDef.test.ts`

**Interfaces:**
- Consumes: `StoredFxDef.loopMode` / `loopJoinMs` (Task 4); `FxPlayerOptions.loopMode` / `loopJoinMs` (Tasks 2-3).

- [ ] **Step 1: Write the failing test**

In `playDef.test.ts`, register a committed seamless def and assert the player it builds loops seamlessly. Follow the file's existing pattern for stubbing a def + renderer; the assertion is that a def with `loopMode: 'seamless'` played with `{ loop: true }` does NOT cull at the boundary (particle/instance survives the wrap). If the test harness there only checks call-through, assert `createPlayer` received `loopMode: 'seamless'` via a spy. Concretely (spy form):

```ts
it('passes the stored loopMode/loopJoinMs into the player for a looping play', () => {
  // committed def carries loopMode seamless + join -40 (see the file's def-registration helper)
  registerTestDef({ id: 'seam', duration: 100, layers: [/* one emitter layer */], loopMode: 'seamless', loopJoinMs: -40 });
  const spy = vi.spyOn(playerMod, 'createPlayer');
  playDef('seam', anchorsAt(0, 0), { loop: true });
  expect(spy).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    expect.objectContaining({ loop: true, loopMode: 'seamless', loopJoinMs: -40 }));
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run packages/ui/src/fx/playDef.test.ts`
Expected: FAIL — the player options don't carry loopMode/join yet.

- [ ] **Step 3: Read the stored fields into the createPlayer call**

At line 378, extend the options object:

```ts
  const player = createPlayer(def, { container, renderer, uids: opts.uids }, {
    loop: opts.loop ?? false,
    loopMode: stored.loopMode ?? 'playOut',
    loopJoinMs: stored.loopJoinMs ?? 0,
  });
```

(These are read from `stored` exactly like `stored.seed`/`stored.slot` already are.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/ui/src/fx/playDef.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/playDef.ts packages/ui/src/fx/playDef.test.ts
git commit -m "feat(fx): playDef applies a def's stored loopMode/loopJoinMs"
```

---

### Task 6: Workbench — "Play out ↔ Seamless" toggle + signed join slider

Bind the two new def properties into the workbench so an author sets them on the effect and Save persists them.

**Files:**
- Modify: `packages/ui/src/fx/ui/Workbench.tsx` (loop state ~line 476-477; player wiring ~line 700-720; load/apply ~line 1888-1894; save assembly ~line 1526-1534; the loop controls markup ~line 2531-2580; `changeLoopGap` ~line 1378)

**Interfaces:**
- Consumes: `FxPlayer.setLoopMode` / `setLoopJoin` (Tasks 2-3); `toStoredDef(..., loopMode, loopJoinMs)` (Task 4).

- [ ] **Step 1: Add loop-mode + join state, mirroring the seed/slot pattern**

Replace `const [loopGapMs, setLoopGapMs] = useState(0);` (line 477) with `const [loopMode, setLoopMode] = useState<'playOut' | 'seamless'>('playOut');` and `const [loopJoinMs, setLoopJoinMs] = useState(0);`. Add refs beside `loopGapRef` for both. (Loop on/off `loopOn` stays exactly as-is — it is preview-only, NOT a def property.)

- [ ] **Step 2: Apply from the def on load**

In the def-load block (line 1888-1894, beside `setSlot`/`setEase`):

```ts
    setLoopMode(def.loopMode ?? 'playOut');
    setLoopJoinMs(def.loopJoinMs ?? 0);
    playerRef.current?.setLoopMode(def.loopMode ?? 'playOut');
    playerRef.current?.setLoopJoin(def.loopJoinMs ?? 0);
```

- [ ] **Step 3: Wire the player construction + live setters**

Where the player is built (line ~700-720) pass `loopMode: loopModeRef.current, loopJoinMs: loopJoinRef.current` in the options (beside `loop`/`loopGapMs`). Replace `changeLoopGap` (line 1378) usage with a `changeLoopJoin(ms)` that sets state, ref, and calls `playerRef.current?.setLoopJoin(ms)`, plus a `changeLoopMode(mode)` doing the same via `setLoopMode`.

- [ ] **Step 4: Persist in the save assembly**

In `save()` (line 1526-1534) pass the two new args to `toStoredDef`:

```ts
      const stored = toStoredDef(
        id, durationMs, toStoredLayers(layers, artRefs),
        seedLocked ? seed : undefined, slot, getDef(id), ease,
        loopMode, loopJoinMs,
      );
```

- [ ] **Step 5: Update the loop-controls markup**

In the loop group (line 2531-2580): add a small "Play out ↔ Seamless" toggle button bound to `loopMode` (calls `changeLoopMode`), and relabel the "Loop gap" slider to "Loop join" bound to `loopJoinMs` via `changeLoopJoin` with a signed range (e.g. `min={-1000} max={2000}`), enabled whenever Loop is on (overlap portion only bites in seamless). Keep the existing `title` hover-help style.

- [ ] **Step 6: Verify typecheck + build (no unit test for the JSX wiring)**

Run: `npm run typecheck && npm run build:web`
Expected: both green. Then a manual smoke in the workbench is covered by Task 7's live check.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/fx/ui/Workbench.tsx
git commit -m "feat(fx): workbench Play-out/Seamless toggle + signed Loop join slider"
```

---

### Task 7: Flip `cia-hp` to seamless, docs, and full-gate verification

**Files:**
- Modify: `packages/ui/src/fx/defs/cia-hp.json` (add `"loopMode": "seamless"`)
- Create: `docs/devlog/2026-08-21-fx-seamless-loop.md`
- Modify: `docs/roadmap.md` (remove the "seamless-loop controls" follow-up now that it shipped; keep the `ciaEnchantedFx`/`.enchantwisp` cleanup line)

- [ ] **Step 1: Add the loop field to cia-hp.json**

Add `"loopMode": "seamless"` to the top-level object (beside `"id"`, `"duration"`). Do NOT add `loopJoinMs` (0 is the omitted default). Re-run the def validation:

Run: `npx vitest run packages/ui/src/fx/defs.test.ts packages/ui/src/fx/shapeLibrary.test.ts`
Expected: PASS (the schema now accepts the field).

- [ ] **Step 2: Write the devlog entry**

Create `docs/devlog/2026-08-21-fx-seamless-loop.md` — what shipped (the carry-over mechanism, `loopMode`/`loopJoinMs`, the workbench controls, cia-hp flipped to seamless), how verified (the player anti-blink/reap/teardown tests, schema round-trip, live eyeball), and the remaining follow-up (delete dead `ciaEnchantedFx.ts` + `.enchantwisp` CSS).

- [ ] **Step 3: Update the roadmap**

Remove the "FX workbench — seamless-loop controls" item (shipped); leave the `ciaEnchantedFx.ts` / `.enchantwisp` deletion follow-up.

- [ ] **Step 4: Full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/defs/cia-hp.json docs/devlog/2026-08-21-fx-seamless-loop.md docs/roadmap.md
git commit -m "feat(fx): cia-hp loops seamlessly; devlog + roadmap"
```

- [ ] **Step 6: Live owner eyeball (the one thing tests can't prove)**

Serve the workbench from the worktree and have the owner confirm at 1×: cia-hp streams continuously with no blink; the Play-out/Seamless toggle and Loop-join slider behave; a shaped def with a negative join cross-fades. Then push + open PR + watch CI + merge on green (owner approval).

---

## Notes for the implementer

- **The `oneShot` decision (Task 2 Step 5)** is the spec's one deferred detail. The contract is the anti-blink test: across a seamless boundary, `stopEmitting` is called on the outgoing instance and it is NOT destroyed that frame, while a fresh instance exists. If spawning seamless layers `oneShot=false` makes the existing fire tests unhappy, the alternative is `oneShot=true` + relying on `stopEmitting` alone — either satisfies the contract; pick the one that keeps every existing test green.
- **Don't touch** `ciaEnchantedFx.ts` or `.enchantwisp` CSS here — that deletion is a separate queued follow-up.
- **Line numbers are approximate** (the files move under concurrent work). Anchor on the named symbols.
