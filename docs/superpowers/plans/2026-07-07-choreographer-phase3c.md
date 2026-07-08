# Combat Choreographer — Phase 3c: Aura Bursts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ALL combat aura burst/break/re-form AUTHORITY out of `Recruit.tsx`'s per-frame `syncShields`
DOM-state-machine into the choreographer's Score, via a new `aura` channel + a real `landed` anchor produced
by pulling the Rise pull-back tween into the engine. `syncShields` keeps ONLY position-tracking (the bubbles
riding cards — which also serves recruit + drag, untouched). Retires all six cross-file timing welds:
`data-rising`, the `deathBurstRef` once-only guard, `REBORN_SUMMON_DELAY` (460), `SHIELD_BREAK_DELAY` (300),
the `.unit.dying` DOM burst-sniff, and the unmount-race fallback.

**Architecture:** The event log already knows exactly when an aura should burst/break — a `shield` event
(DS consumed), a `death` event on an aura carrier (spirit/bulwark explodes), a `reborn` event (re-form glow).
Today `syncShields` re-derives all this per-frame from DOM class transitions (`.dscard`/`.reborncard`/`.taunt`
markers appearing/disappearing, `.unit.dying`, `data-rising`). Phase 3c hands the **timing decision** to the
Score and keeps pixiFx's bubble registry (`this.shields`, fed by `syncShields`'s `setShield` position calls) as
the source of truth for **which** auras a unit carries — so the burst fires exactly once (a bubble is destroyed
when it bursts) at the scored moment, structurally killing the double-burst bug. A new
`choreo/channels/aura.ts` encapsulates the two timing welds internally (config-driven delays, no longer split
across two files). The Rise pull-back tween moves into the engine (like the lunge in 3b) so it defines a real
`landed` anchor; a Rise attacker dying mid-lunge bursts its spirit when the body lands home, driven by that
timeline position instead of `data-rising`.

**Scope ruling (owner, 2026-07-07):** Full move — all aura authority (shield break, reborn burst + re-form,
taunt burst, death bursts, quiet clears) moves this PR. `syncShields` is reduced to pure position-tracking +
the quiet-clear-on-leave path (a card sold/unmounted still fades its bubble — that is position-lifecycle, not
combat authority, and stays). Generic ms-offset cues are NOT built here (deferred to phase 4 authoring); the
two combat delays are encapsulated inside the aura channel instead.

**Tech Stack:** TypeScript monorepo; Vitest (node env, `vitest.setup.ts` polyfills `navigator` for pixi.js —
already in place from phase 3b); `vi.spyOn` on `pixiFx`/`sfx`; GSAP timelines seekable via `.progress()`.

**Spec:** `docs/superpowers/specs/2026-07-06-combat-choreographer-design.md` (§④ Channel Adapters — "burst/break
authority moves to the choreographer"; §② the `landed` anchor "produced by the pull-back cue"). **Roadmap:**
Combat Choreographer → Phase 3c. **Branch:** `feat/choreographer-phase3c` (off latest `main`).

**Invisible-change contract:** every aura burst/break/re-form/clear fires for the same unit at the same visual
moment as today, at 1× and faster combat speeds. The double-burst bug class is retired structurally, not by a
guard. This is the riskiest hot-file FX change in the choreographer — the live feel-pass (Task 8) is the real
gate.

---

### Task 0: Branch

- [ ] Create the branch off latest main:
```bash
git switch main && git pull --ff-only && git switch -c feat/choreographer-phase3c
```

---

### Task 1: pixiFx bubble-registry queries (`hasAura`, `auraRect`)

**Why:** The aura channel must know, at a scored moment, which auras a unit currently carries (its live bubbles)
and — for taunt, whose burst needs explicit coords — where they are. pixiFx owns the registry (`this.shields`,
a `Map<`auraKey`, ShieldBubble>`), so it exposes two read-only queries. This is the seam that lets the Score
decide *when* while pixiFx stays the source of truth for *which/where*.

**Files:**
- Modify: `packages/ui/src/pixiFx.ts`
- Test: `packages/ui/src/pixiFx.aura.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `packages/ui/src/pixiFx.aura.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pixiFx } from './pixiFx';

// pixiFx's WebGL app never initializes in the node test env (`this.ready` stays false), so setShield is a
// no-op and no bubble is registered. These queries must therefore SAFELY report "no aura" without throwing —
// which is exactly the contract the aura channel relies on (it no-ops when a unit carries no bubble).
describe('pixiFx aura registry queries', () => {
  it('hasAura reports false for an unknown uid/kind and never throws', () => {
    expect(pixiFx.hasAura('nobody', 'shield')).toBe(false);
    expect(pixiFx.hasAura('nobody', 'reborn')).toBe(false);
    expect(pixiFx.hasAura('nobody', 'taunt')).toBe(false);
  });
  it('auraRect returns null for an unknown uid/kind and never throws', () => {
    expect(pixiFx.auraRect('nobody', 'shield')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — FAIL** (`hasAura`/`auraRect` don't exist):
```bash
npx vitest run packages/ui/src/pixiFx.aura.test.ts
```

- [ ] **Step 3: Implement.** In `packages/ui/src/pixiFx.ts`, add two public methods to `FxController`, right
after `clearShield` (currently ~line 988). They read the existing `this.shields` map (keyed by `auraKey(kind, uid)`):

```ts
  /** True if a persistent aura bubble of this kind is currently registered for `uid` (the choreographer's
   *  aura channel consults this to decide which of a dying unit's auras to burst — pixiFx's registry is the
   *  source of truth for which auras a unit carries; the Score decides when). */
  hasAura(uid: string, kind: AuraKind = 'shield'): boolean {
    return this.shields.has(auraKey(kind, uid));
  }

  /** The tracked center + footprint of `uid`'s aura bubble, or null if none — used by the aura channel to
   *  position the taunt burst (which draws on the FRONT layer and needs explicit coords, unlike breakShield
   *  which reads the bubble's own stored coords). */
  auraRect(uid: string, kind: AuraKind = 'shield'): { cx: number; cy: number; w: number; h: number } | null {
    const b = this.shields.get(auraKey(kind, uid));
    return b ? { cx: b.cx, cy: b.cy, w: b.w, h: b.h } : null;
  }
```

- [ ] **Step 4: Run** → green. `npx vitest run packages/ui/src/pixiFx.aura.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/pixiFx.ts packages/ui/src/pixiFx.aura.test.ts
git commit -m "feat(ui): pixiFx aura-registry queries (hasAura/auraRect) for the choreographer"
```

---

### Task 2: Aura timing constants in `choreoConfig.ts`

**Why:** Retiring the cross-file magic numbers `SHIELD_BREAK_DELAY = 300` (Recruit.tsx) and
`REBORN_SUMMON_DELAY = 460` (useCombatReplay.ts) means giving them ONE home in the tunable choreo config, where
the aura channel reads them (like the rest of the replay timing). Values are copied verbatim so behavior is
identical.

**Files:**
- Modify: `packages/ui/src/choreo/choreoConfig.ts`
- Modify: `packages/ui/src/choreo/choreoConfig.test.ts`

- [ ] **Step 1: Add the two fields.** In `packages/ui/src/choreo/choreoConfig.ts`, add to the `ChoreoConfig`
interface (after `finalHold`), the `DEFAULTS` object, and `CHOREO_RANGES`:

Interface (after the `finalHold` field, ~line 65):
```ts
  /** Hold a consumed Divine Shield this long (ms) before it visibly shatters, so the read is hit → settle →
   *  break (scaled by combatSpeed in the aura channel). Was Recruit.tsx's SHIELD_BREAK_DELAY. */
  shieldBreakDelay: number;
  /** Delay (ms) from a reborn beat to the wispy re-form glow, timed to the `risepop` CSS re-form phase. Was
   *  useCombatReplay.ts's REBORN_SUMMON_DELAY. */
  rebornReformDelay: number;
```

DEFAULTS (after `finalHold: 900,`, ~line 76):
```ts
  shieldBreakDelay: 300, rebornReformDelay: 460,
```

CHOREO_RANGES (after `finalHold: [200, 2000, 50],`, ~line 87):
```ts
  shieldBreakDelay: [0, 1000, 10], rebornReformDelay: [0, 1000, 10],
```

- [ ] **Step 2: Extend the config test.** In `packages/ui/src/choreo/choreoConfig.test.ts`, add to the
"preserves the shipped pacing defaults" test:
```ts
    expect(c.shieldBreakDelay).toBe(300);
    expect(c.rebornReformDelay).toBe(460);
```

- [ ] **Step 3: Run** → green. `npx vitest run packages/ui/src/choreo/choreoConfig.test.ts`.
(Note: `CHOREO_KEYS`/`CHOREO_RANGES` are `Record<keyof ChoreoConfig, …>`-typed, so a missed field is a compile
error — confirm typecheck of the choreo dir is clean via the vitest run.)

- [ ] **Step 4: Commit.**
```bash
git add packages/ui/src/choreo/choreoConfig.ts packages/ui/src/choreo/choreoConfig.test.ts
git commit -m "feat(ui): choreoConfig gains shieldBreakDelay + rebornReformDelay (aura weld constants rehomed)"
```

---

### Task 3: The aura channel (`choreo/channels/aura.ts`)

**Why:** The single adapter that owns every aura burst/break/re-form dispatch — the pixiFx + sfx calls that
were scattered across `syncShields` (death bursts, shield break, reborn break, taunt burst) and
`useCombatReplay` (reborn re-form). It encapsulates the two timing delays internally (config-driven), returning
a cleanup for any timers it schedules so the caller can cancel on unmount. Pure of DOM sniffing — it works
off uids + pixiFx's registry.

**Files:**
- Create: `packages/ui/src/choreo/channels/aura.ts`
- Test: `packages/ui/src/choreo/channels/aura.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/channels/aura.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixiFx } from '../../pixiFx';
import { sfx } from '../../sfx';
import { burstDeathAuras, breakShieldAura, reformReborn } from './aura';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('burstDeathAuras', () => {
  it('bursts each aura kind the unit carries (per pixiFx.hasAura) with its sound; skips absent ones', () => {
    vi.spyOn(pixiFx, 'hasAura').mockImplementation((_uid, kind) => kind === 'reborn'); // carries only a reborn aura
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    const shatter = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    const shieldSfx = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    burstDeathAuras('u1');
    expect(brk).toHaveBeenCalledWith('u1', 'reborn');
    expect(shatter).toHaveBeenCalledTimes(1);
    expect(shieldSfx).not.toHaveBeenCalled(); // no shield/taunt aura → no gold-break sound
  });

  it('a unit carrying no aura bursts nothing', () => {
    vi.spyOn(pixiFx, 'hasAura').mockReturnValue(false);
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    burstDeathAuras('u2');
    expect(brk).not.toHaveBeenCalled();
  });
});

describe('breakShieldAura', () => {
  it('holds the consumed shield, then shatters + sounds after shieldBreakDelay/combatSpeed', () => {
    vi.useFakeTimers();
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'shieldBreak').mockImplementation(() => {});
    const cancel = breakShieldAura('u3', 2); // combatSpeed 2 → 150ms
    expect(brk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(149);
    expect(brk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(brk).toHaveBeenCalledWith('u3', 'shield');
    expect(s).toHaveBeenCalledTimes(1);
    cancel(); // no throw after fire
  });

  it('the returned cancel prevents a pending shatter', () => {
    vi.useFakeTimers();
    const brk = vi.spyOn(pixiFx, 'breakShield').mockImplementation(() => {});
    const cancel = breakShieldAura('u4', 1);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(brk).not.toHaveBeenCalled();
  });
});

describe('reformReborn', () => {
  it('schedules the re-form glow + sound at rebornReformDelay/combatSpeed, positioned via the passed rect', () => {
    vi.useFakeTimers();
    const summon = vi.spyOn(pixiFx, 'rebornSummon').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'rebornSummon').mockImplementation(() => {});
    reformReborn({ cx: 5, cy: 6, w: 7, h: 8 }, 1); // combatSpeed 1 → 460ms
    vi.advanceTimersByTime(459);
    expect(summon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(summon).toHaveBeenCalledWith(5, 6, 7, 8);
    expect(s).toHaveBeenCalledTimes(1);
  });

  it('with no rect (unit not measurable) plays only the sound', () => {
    vi.useFakeTimers();
    const summon = vi.spyOn(pixiFx, 'rebornSummon').mockImplementation(() => {});
    const s = vi.spyOn(sfx, 'rebornSummon').mockImplementation(() => {});
    reformReborn(null, 1);
    vi.advanceTimersByTime(500);
    expect(summon).not.toHaveBeenCalled();
    expect(s).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — FAIL** (module missing). `npx vitest run packages/ui/src/choreo/channels/aura.test.ts`.

- [ ] **Step 3: Implement `packages/ui/src/choreo/channels/aura.ts`.** This relocates the exact pixiFx+sfx
dispatch from `syncShields` (Recruit.tsx PASS 1 death burst, lines 512-521; PASS 3 shield break, lines 591-592)
and `useCombatReplay`'s reborn re-form (lines 610-612), verbatim:

```ts
import { pixiFx } from '../../pixiFx';
import { tauntFx } from '../../pixiFx';
import { sfx } from '../../sfx';
import { getChoreoConfig } from '../choreoConfig';

/** The three persistent aura kinds, in burst order. Matches pixiFx's AuraKind. */
type AuraKind = 'shield' | 'reborn' | 'taunt';

/**
 * Aura channel (choreographer phase 3c) — the single owner of every combat aura burst/break/re-form FX+sfx
 * dispatch, relocated verbatim out of `Recruit.tsx`'s `syncShields` and `useCombatReplay`'s reborn block. The
 * DECISION of when to fire lives in the Score/engine; WHICH auras a unit carries comes from pixiFx's live
 * bubble registry (`hasAura`), so a burst fires exactly once — the bubble is destroyed on burst — retiring
 * the old `deathBurstRef` once-only guard and the `.dying`/`data-rising` DOM sniffing.
 */

/** A unit DIES while still carrying auras → each explodes in place (spirit release / ward shatter / bulwark
 *  burst). Reads pixiFx's registry for which kinds are live; a taunt burst draws on the FRONT layer at the
 *  bubble's tracked spot (its persistent mesh lives on the back `tauntFx` canvas, cleared first). */
export function burstDeathAuras(uid: string): void {
  if (pixiFx.hasAura(uid, 'shield')) { pixiFx.breakShield(uid, 'shield'); sfx.shieldBreak(); }
  if (pixiFx.hasAura(uid, 'reborn')) { pixiFx.breakShield(uid, 'reborn'); sfx.rebornShatter(); }
  if (tauntFx.hasAura(uid, 'taunt')) {
    const r = tauntFx.auraRect(uid, 'taunt');
    tauntFx.clearShield(uid, 'taunt'); // drop the back-canvas bulwark…
    if (r) pixiFx.tauntBurst(r.cx, r.cy, r.w, r.h); // …burst in FRONT at its tracked spot
    sfx.shieldBreak();
  }
}

/** A Divine Shield is CONSUMED (a `shield` event): hold the bubble briefly so the read is hit → settle →
 *  break, then shatter it (gold shards) + sound. The bubble keeps position-tracking meanwhile (syncShields
 *  still runs). Returns a cancel to clear the pending timer. Encapsulates the former SHIELD_BREAK_DELAY weld. */
export function breakShieldAura(uid: string, combatSpeed: number): () => void {
  const d = getChoreoConfig().shieldBreakDelay / (combatSpeed > 0 ? combatSpeed : 1);
  const id = window.setTimeout(() => { pixiFx.breakShield(uid, 'shield'); sfx.shieldBreak(); }, d);
  return () => window.clearTimeout(id);
}

/** A unit REBORN (a `reborn` event): schedule the wispy re-form glow + sound at rebornReformDelay, timed to
 *  the `risepop` CSS re-form phase. `rect` is the unit's measured center+footprint (null → sound only).
 *  Encapsulates the former REBORN_SUMMON_DELAY weld. Returns a cancel for the pending timer. */
export function reformReborn(rect: { cx: number; cy: number; w: number; h: number } | null, combatSpeed: number): () => void {
  const d = getChoreoConfig().rebornReformDelay / (combatSpeed > 0 ? combatSpeed : 1);
  const id = window.setTimeout(() => {
    if (rect) pixiFx.rebornSummon(rect.cx, rect.cy, rect.w, rect.h);
    sfx.rebornSummon();
  }, d);
  return () => window.clearTimeout(id);
}
```
NOTE: confirm `tauntFx` is exported from `pixiFx.ts` (grep — `syncShields` imports it via `auraFx`). If it is
NOT a named export, read how `syncShields` obtains it and mirror that (it may be a second `FxController`
instance exported alongside `pixiFx`). The `hasAura`/`auraRect`/`clearShield` methods exist on the same
`FxController` class (Task 1), so they're available on `tauntFx` too.

- [ ] **Step 4: Run** → green. `npx vitest run packages/ui/src/choreo/channels/aura.test.ts`.

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/channels/aura.ts packages/ui/src/choreo/channels/aura.test.ts
git commit -m "feat(ui): aura channel — burst/break/re-form dispatch relocated out of syncShields"
```

---

### Task 4: Score the aura cues + a `landed`-aware runner seam

**Why:** Add `aura` to the `Channel` union and give `death`/`riseDeath`/`reborn`/`shieldPop` moments their aura
cues in `SCORE`. `runMomentCues` grows an `aura` branch. The `landed`-anchored burst for a Rise attacker being
pulled home is dispatched by the ENGINE (Task 5), not this plain-effect runner — so here we add the score DATA
+ the `start`-anchored dispatch, and expose the callbacks the replay wires.

**Files:**
- Modify: `packages/ui/src/choreo/score.ts`
- Modify: `packages/ui/src/choreo/score.test.ts`

- [ ] **Step 1: Update `score.test.ts`** — add cases (keep the existing tests):
```ts
  it('death + riseDeath + reborn + shieldPop carry an aura cue', () => {
    expect(SCORE.death.some((c) => c.ch === 'aura')).toBe(true);
    expect(SCORE.riseDeath.some((c) => c.ch === 'aura')).toBe(true);
    expect(SCORE.reborn.some((c) => c.ch === 'aura')).toBe(true);
    expect(SCORE.shieldPop.some((c) => c.ch === 'aura')).toBe(true);
  });

  it('runMomentCues fires the aura channel for a death moment carrying an aura carrier', () => {
    const onAuraBurst = vi.fn();
    const evs = [{ type: 'death', target: 'a', side: 'enemy' }] as CombatEvent[];
    runMomentCues(moment('death', evs), { ...baseCtx(evs), onAuraBurst });
    expect(onAuraBurst).toHaveBeenCalledWith('a'); // the dying unit's uid
  });
```
where `baseCtx` is the existing `ctx` helper from Task-6-of-3b (extend it to include `onAuraBurst: vi.fn(), onShieldBreak: vi.fn(), onReborn: vi.fn()` defaults; if the helper is inline, add these fields). Adjust to the file's actual helper shape.

- [ ] **Step 2: Run — FAIL.** `npx vitest run packages/ui/src/choreo/score.test.ts`.

- [ ] **Step 3: Implement in `score.ts`.** Extend the `Channel` union, add `aura` to the SHARED default cue
list (so EVERY kind runs it — see the grouping note below), add the `CueContext` callbacks, and the
`runMomentCues` `aura` branch. Key design: the aura channel's DISPATCH (pixiFx/sfx) lives in
`channels/aura.ts`; `runMomentCues` stays presentation-agnostic by invoking caller callbacks (the replay wires
them to the aura channel with the DOM/combatSpeed context it owns) — mirroring `onFloats`/`onShake`.

> **CRITICAL grouping fact (why aura is on EVERY kind, not just death/reborn/shieldPop):** a moment's KIND
> comes from its PRIMARY (first) event, but `death`/`shield` events are RESULT_TYPES that collapse into the
> impact run — so `[dmg, death]` is a `damage`-kind moment that CONTAINS a death, and `[dmg, shield]` a
> `damage` moment containing a shield break. Scoring aura only on `death`/`shieldPop` kinds would MISS those
> grouped bursts (today's `syncShields` catches them by sniffing `.dying` per-frame, kind-agnostic). So the
> aura cue joins the shared default (every kind), and the runner SCANS the moment's events — exactly how
> `sfx`/`float` already work (no-op when the moment has nothing relevant).

```ts
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'aura';
```
Change the shared default from `SFX_FLOAT` to include aura, and confirm every non-attackExchange kind uses it
(attackExchange keeps its explicit sfx+float+lunge+impact list — add `{ ch: 'aura', at: 'start' }` to it too,
so a death grouped into an attack's absorbed-windup run isn't missed):
```ts
const SFX_FLOAT_AURA: Cue[] = [{ ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' }, { ch: 'aura', at: 'start' }];
```
(Rename the `SFX_FLOAT` const → `SFX_FLOAT_AURA` and spread it into every kind as before; add
`{ ch: 'aura', at: 'start' }` to the explicit `attackExchange` array.)

Add to `CueContext`:
```ts
  /** A REAL (non-Rise) death carrying auras → burst them (uid). Wired to channels/aura.ts's burstDeathAuras.
   *  Rise deaths are handled by the replay/engine (defender bursts in place; a pulled-home attacker bursts at
   *  the pull-back's `landed`), NOT here — the runner skips `rise` deaths. */
  onAuraBurst: (uid: string) => void;
  /** A Divine Shield was consumed this moment (uid) → the delayed gold shatter. */
  onShieldBreak: (uid: string) => void;
  /** A unit was reborn this moment (uid) → schedule the re-form glow. */
  onReborn: (uid: string) => void;
```

In `runMomentCues`, add the `aura` branch — it scans the moment's events (kind-agnostic, per the grouping
fact), and deliberately SKIPS `rise` deaths (the replay/engine own those):
```ts
    } else if (cue.ch === 'aura') {
      for (let i = moment.start; i < moment.end; i++) {
        const e = ctx.events[i];
        if (!e) continue;
        if (e.type === 'death' && !e.rise) ctx.onAuraBurst(e.target);  // a real death: burst its auras in place
        else if (e.type === 'shield') ctx.onShieldBreak(e.target);     // DS consumed: delayed gold shatter
        else if (e.type === 'reborn') ctx.onReborn(e.target);          // reborn: re-form glow
        // `death` with `rise` is intentionally NOT handled here — a Rise DEFENDER bursts in place (replay),
        // a pulled-home Rise ATTACKER bursts at the engine's `landed`. See Task 6.
      }
    }
```
(The `landed` anchor for a Rise attacker is fired directly by the engine's `runRiseReturn` (Task 5) — like
`impact`'s `contact`, it's an engine-driven timeline position, not a runner cue. The `Anchor` type already
reserves `'landed'`; no per-kind `landed` cue row is needed for 3c.)

Update the Step-1 test accordingly: assert the aura cue is present on representative kinds (`damage`, `death`,
`reborn`, `shieldPop`) via the shared default, and that `runMomentCues` on a `damage` moment CONTAINING a
death event calls `onAuraBurst` with the dead uid (the grouping case). Drop any assertion that a specific
kind's cue is `at: 'landed'`.

- [ ] **Step 4: Run** the choreo tree → green. `npx vitest run packages/ui/src/choreo`. typecheck via the run.

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts
git commit -m "feat(ui): score the aura channel — death/riseDeath/reborn/shieldPop cues + runner branch"
```

---

### Task 5: Pull the Rise pull-back into the engine (defines `landed`)

**Why:** The Rise attacker dying mid-lunge is pulled home by a GSAP tween, and its spirit must burst when it
LANDS (not mid-flight). Today that's welded via `data-rising` (the replay sets a DOM flag for the tween's
lifetime; `syncShields` polls it). Moving the tween into the engine lets its `onComplete` BE the `landed`
anchor — the engine fires the aura burst there directly, exactly like the lunge fires impact at `contact`. No
DOM flag, no polling.

**Files:**
- Modify: `packages/ui/src/choreo/engine.ts`
- Test: `packages/ui/src/choreo/engine.test.ts`

- [ ] **Step 1: Add the failing test** to `engine.test.ts`:
```ts
import { runRiseReturn } from './engine';

describe('runRiseReturn', () => {
  it('pulls the risen attacker home, firing onLanded exactly once at the tween end', () => {
    const el = fakeEl(); // the node-env stub from the existing engine tests
    const onLanded = vi.fn();
    const tl = runRiseReturn(el, 1, onLanded);
    expect(onLanded).not.toHaveBeenCalled();
    tl.progress(1);
    expect(onLanded).toHaveBeenCalledTimes(1);
  });
});
```
(Reuse the `fakeEl()` stub already defined in `engine.test.ts` from phase 3b — it supplies
`getBoundingClientRect`/`classList`/`querySelector`. `runRiseReturn` only sets transforms + clears props, so
the stub suffices; gsap's benign non-DOM warnings are expected.)

- [ ] **Step 2: Run — FAIL.** `npx vitest run packages/ui/src/choreo/engine.test.ts`.

- [ ] **Step 3: Implement `runRiseReturn` in `engine.ts`** — a verbatim relocation of the pull-back tween from
`useCombatReplay.ts`'s layout-effect Block A (lines 582-593), minus the `data-rising` DOM flag (the whole
point) — with `onLanded` fired at `onComplete`:

```ts
/**
 * The Rise pull-back (choreographer phase 3c) — a Rise ATTACKER that died to retaliation mid-lunge is pulled
 * straight back to its slot (a short hold so the contact reads, then a quick pull), so its spirit burst lands
 * in its own slot, not mid-flight. `onLanded` fires at the tween's end — the `landed` anchor that replaces the
 * former `data-rising` DOM-flag weld (the replay's syncShields used to poll that flag; now the engine's
 * timeline fires the burst directly). Returns the timeline (seekable in tests).
 */
export function runRiseReturn(el: Element, combatSpeed: number, onLanded: () => void): ReturnType<typeof gsap.timeline> {
  gsap.killTweensOf(el);
  const tl = gsap.timeline();
  tl.to(el, {
    x: 0, y: 0, rotation: 0, scale: 1,
    delay: 0.1 / combatSpeed, duration: 0.24 / combatSpeed, ease: 'power2.out',
    onComplete: () => gsap.set(el, { clearProps: 'transform,zIndex' }),
  });
  tl.add(onLanded); // landed → fire the spirit burst in the unit's own slot
  return tl;
}
```
IMPORTANT: compare the tween params (`delay: 0.1/combatSpeed`, `duration: 0.24/combatSpeed`, `ease: 'power2.out'`,
the `clearProps: 'transform,zIndex'`) against the CURRENT Block A in useCombatReplay.ts; match verbatim. The
only removed behavior is `el.dataset.rising = '1'` / `delete el.dataset.rising` (retired). `onLanded` fires
AFTER the tween completes (appended to the timeline), so it lands at the same instant the old `onComplete`
cleared `data-rising` (which is when syncShields used to fire the held burst).

- [ ] **Step 4: Run** → green. `npx vitest run packages/ui/src/choreo/engine.test.ts` then `npx vitest run packages/ui/src/choreo`.

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/engine.ts packages/ui/src/choreo/engine.test.ts
git commit -m "feat(ui): engine runRiseReturn — the pull-back defines the landed anchor (retires data-rising)"
```

---

### Task 6: Wire the aura channel + engine into `useCombatReplay.ts`; retire the reborn/pull-back blocks

**Why:** The one integration task. It routes the scored aura cues to `channels/aura.ts`, replaces the
layout-effect's Block A (data-rising pull-back) with `runRiseReturn` (firing the `landed` burst), replaces
Block B (the 460ms reborn re-form) with `reformReborn`, deletes `REBORN_SUMMON_DELAY`, and handles the
riseDeath DEFENDER-vs-attacker role split.

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts`

Read the current file first. The relevant regions (post-3b line numbers ~): the merged cue `useEffect`
(~528-550), and the layout `useLayoutEffect`'s Block A (~570-597) + Block B (~599-615), and the
`REBORN_SUMMON_DELAY` const (~19-21).

- [ ] **Step 1: Imports.** Add:
```ts
import { burstDeathAuras, breakShieldAura, reformReborn } from './choreo/channels/aura';
import { runAttackExchangeCues, runRiseReturn } from './choreo/engine';
```
(Extend the existing `./choreo/engine` import to include `runRiseReturn`.) Delete the `REBORN_SUMMON_DELAY`
const (lines ~19-21) — no longer used.

- [ ] **Step 2: Wire the aura cue callbacks into the merged cue effect.** In the `runMomentCues(beat, {...})`
call, add the three callbacks alongside the existing `onShake`/`onFloats`/`onDeathFloats`. Collect any
shield-break cancels into the effect's `timers`/cleanup:
```ts
      onAuraBurst: (uid) => burstDeathAuras(uid),
      onShieldBreak: (uid) => { const cancel = breakShieldAura(uid, combatSpeedRef.current); cancels.push(cancel); },
      onReborn: (uid) => {
        const el = findEl(uid);
        const r = el?.getBoundingClientRect();
        const rect = r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height } : null;
        const cancel = reformReborn(rect, combatSpeedRef.current);
        cancels.push(cancel);
      },
```
Add `const cancels: Array<() => void> = [];` near the effect's `const timers: number[] = [];` and in the
cleanup `return () => { timers.forEach(clearTimeout); cancels.forEach((c) => c()); };`. (Use `combatSpeedRef`
— the ref from phase 3b — so a mid-beat speed change doesn't re-fire, consistent with the sfx/float wiring.)

- [ ] **Step 3: riseDeath DEFENDER immediate burst.** A `riseDeath` whose dying unit is NOT the impact
attacker bursts in place immediately (it isn't pulled home). Its Score cue is `at: 'landed'`, so `runMomentCues`
did NOT fire it — the replay fires it here. Still in the merged cue effect, after the `runMomentCues` call, add:
```ts
    // A Rise DEFENDER (dying but NOT the impact attacker being pulled home) explodes in place immediately —
    // its riseDeath aura cue is `at: 'landed'`, reserved for the pulled-home ATTACKER (fired by the engine's
    // runRiseReturn), so the runner skipped it; fire the defender's here.
    const impactAtk = attackerOfImpact(beats, beatIdx - 1);
    for (let i = beat.start; i < beat.end; i++) {
      const e = events[i];
      if (e?.type === 'death' && e.rise && e.target !== impactAtk) burstDeathAuras(e.target);
    }
```

- [ ] **Step 4: Replace Block A (pull-back) in the layout effect** with `runRiseReturn`, firing the landed
burst. Replace the current block (the `for` loop that sets `el.dataset.rising`, `gsap.killTweensOf`, the
`gsap.to(...)`), keeping its guards (`impactAtk`, the death-of-attacker match, the `.reborncard` check):
```ts
    if (cur) {
      const impactAtk = attackerOfImpact(beats, beatIdx - 1);
      if (impactAtk) {
        for (let i = cur.start; i < cur.end; i++) {
          const e = events[i];
          if (e?.type !== 'death' || e.target !== impactAtk || !e.rise) continue;
          const el = findEl(impactAtk) as HTMLElement | null;
          if (el && el.querySelector('.reborncard')) {
            runRiseReturn(el, combatSpeed, () => burstDeathAuras(impactAtk)); // pull home → burst the spirit in its slot
          }
        }
      }
    }
```
(Added `|| !e.rise` to the guard — only a RISE death is pulled home; a plain death of the attacker isn't. The
old code implicitly relied on the `.reborncard` marker for this; making it explicit against `e.rise` is
clearer and matches the riseDeath classification.)

- [ ] **Step 5: Replace Block B (reborn re-form)** in the layout effect. The re-form glow is now scheduled by
the `onReborn` cue callback (Step 2), so DELETE Block B entirely (the `for` loop over `reborn` events that
does the `window.setTimeout(... pixiFx.rebornSummon ..., REBORN_SUMMON_DELAY)`). Confirm nothing else in the
layout effect referenced those locals.

- [ ] **Step 6: Full verification.**
```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
All green (report counts — expect the test count to rise by the new aura/engine/pixiFx tests). Watch for: an
unused `pixiFx` import in useCombatReplay (it's still used by the reborn projectile / other blocks — confirm;
if genuinely unused now, remove it), an unused `sfx.rebornSummon` (moved to the channel — confirm sfx is still
used for win/lose/triggerPulse), and `npm run typecheck:web` staying at its 21-error baseline (no new).

- [ ] **Step 7: Commit.**
```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "refactor(ui): route aura bursts through the choreographer; retire data-rising + the reborn weld"
```

---

### Task 7: Strip the burst/break authority from `syncShields` (Recruit.tsx)

**Why:** With the choreographer now firing every aura burst/break/re-form, `syncShields`'s combat authority is
dead code that would DOUBLE-fire. Remove it, keeping ONLY position-tracking (setShield to make bubbles ride
cards, in recruit + combat + drag) and the quiet-clear-on-leave lifecycle (a sold/unmounted card fades its
bubble — position lifecycle, not combat authority). This is the delicate surgery; do it precisely.

**Files:**
- Modify: `packages/ui/src/Recruit.tsx`

Read the current `syncShields` (lines ~458-608) + the constants (28-33) + `deathBurstRef` (440) first.

- [ ] **Step 1: PASS 1 — remove the death-burst block, keep positioning.** In the `for (const card of els)` loop
(PASS 1), DELETE the death-burst decision (the `const unitEl`, `dying`, `returningHome`, the
`if (dying && !returningHome) { ... continue; }` block, and the `if (!dying) deathBurstRef...delete` line —
current lines ~498-528). A dying unit's card still carries its marker for one beat; its aura should simply
KEEP being positioned until the card unmounts (then PASS 2 clears it) — the BURST is now the choreographer's.
So the loop body reduces to: measure `r`, `seen.add(key)`, the taunt-deploy dust (keep — that's a gain effect,
position-lifecycle), and `set(...)`. Keep the dragged-card branch (537-540) unchanged.

- [ ] **Step 2: PASS 2 — reduce to quiet-clear only.** The combat break/reborn/unmount-race branches
(current ~553-585) are now the choreographer's. Replace the whole per-key body with the quiet-clear lifecycle:
```ts
    // PASS 2 — an aura that vanished from `seen` fades out. Combat BURSTS/BREAKS are the choreographer's now
    // (channels/aura.ts, fired off the event log) — here we only handle a bubble whose CARD LEFT (sold, played
    // hand→board, frozen, unmounted): a brief grace covers a remount under the same uid, else it clears.
    for (const key of shieldUidsRef.current) {
      if (seen.has(key) || pendingClearRef.current.has(key)) continue;
      const { kind, uid } = unkey(key);
      if (animating()) pendingClearRef.current.set(key, now + SHIELD_CLEAR_GRACE); // might remount → brief grace
      else auraFx(kind).clearShield(uid, kind);
    }
```
This removes: the `triggered` marker-strip detection, the `SHIELD_BREAK_DELAY`/`pendingBreakRef` shield path,
the `data-rising` reborn-hold + reborn-break, and the unmount-race fallback. All are now choreographer-driven.

- [ ] **Step 3: PASS 3 — delete entirely.** The delayed-shield-break driver (current ~587-599, the
`for (const [key, at] of pendingBreakRef.current)` loop) is gone with the shield-break authority. Delete it.

- [ ] **Step 4: PASS 4 — keep** (pending-clear grace handling, ~600-606) unchanged — it's position lifecycle.

- [ ] **Step 5: Remove now-dead declarations + constants.** Delete `pendingBreakRef` (line 438),
`deathBurstRef` (440), the `SHIELD_BREAK_DELAY` const (30) and its comment (28-29). Delete the
`deathBurstRef.current.clear()` line in syncShields (461). KEEP `pendingClearRef`, `shieldUidsRef`,
`SHIELD_CLEAR_GRACE`, `combatSpeedRef` (still used?), `settleUntilRef`. Grep for every removed identifier to
confirm no lingering reference: `pendingBreakRef`, `deathBurstRef`, `SHIELD_BREAK_DELAY`, `markerOf` (is it
still used? PASS 2 no longer calls it — if unused now, delete `markerOf` too, line 47), `dataset.rising` (must
be ZERO hits repo-wide after Task 6 + this task — the weld is fully retired).

- [ ] **Step 6: Verify the weld retirement is complete.**
```bash
grep -rn "data-rising\|dataset.rising\|deathBurstRef\|SHIELD_BREAK_DELAY\|REBORN_SUMMON_DELAY\|pendingBreakRef" packages/ui/src
```
Expected: ZERO hits (all six welds retired). If `markerOf` or any removed ref still appears, resolve it.

- [ ] **Step 7: Full verification.**
```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
All green. `npm run typecheck:web` at its 21-error baseline (Recruit.tsx must not add new errors — watch for
unused-var errors from the removed refs; ESLint `no-unused-vars` will catch a stray).

- [ ] **Step 8: Commit.**
```bash
git add packages/ui/src/Recruit.tsx
git commit -m "refactor(ui): syncShields is position-tracking only; aura burst authority is the choreographer's"
```

---

### Task 8: Live smoke + owner feel-pass

**Files:** none (verification).

- [ ] **Step 1: Live smoke (controller-driven).** `preview_start` "web"; with the tab FOCUSED (rAF/GSAP need a
visible tab — the beat clock's `hidden` gate + GSAP throttle otherwise pause the replay), drive fights via
`window.useGame` (startPractice → pickHero → buy/play → faceOmen). Use boards that exercise EACH aura:
  - a **Divine Shield** unit taking a hit (gold shatter, delayed ~300ms after contact),
  - a **Reborn** unit dying + returning (spirit burst on death, blue re-form glow ~460ms later),
  - a **Rise attacker** dying to retaliation mid-lunge (spirit bursts in its OWN slot after the pull-back home, not mid-flight — the double-burst bug locus),
  - a **Taunt** unit dying (silver bulwark burst),
  - a unit whose shield/reborn is present then the unit is sold/leaves in recruit (quiet fade, no burst).
Sample the DOM + console for zero errors; confirm each aura fires exactly ONCE (no double-burst) and at the
right moment. Report what you verified per aura.

- [ ] **Step 2: Owner feel-pass (the real gate).** Ask the owner to play a few combats in a focused window and
confirm: bursts read as crisp explosions (not hovering over collapsing cards), the Rise attacker's spirit
lands in its slot, the reborn re-form glow times to the body knitting back together, shield shatter lands
hit→settle→break, and NOTHING double-bursts — at 1× and at a faster combat speed. This is the phase's real
gate (CLAUDE.md: feel is the north star). Surface it explicitly; do not claim done without it.

---

### Task 9: Docs + PR

**Files:** `docs/devlog.md` (prepend), `docs/roadmap.md` (mark 3c done), `README.md` (Recent changes bullet).

- [ ] **Step 1: Docs.** Devlog: 3c moves all aura burst/break/re-form AUTHORITY into the choreographer — the
new `aura` channel (`choreo/channels/aura.ts`), the engine's `runRiseReturn` defining the real `landed` anchor,
the death/riseDeath/reborn/shieldPop aura cues, pixiFx's `hasAura`/`auraRect` registry queries, the two weld
constants rehomed into choreoConfig — and reduces `syncShields` to pure position-tracking. All six welds
(`data-rising`, `deathBurstRef`, `REBORN_SUMMON_DELAY`, `SHIELD_BREAK_DELAY`, the `.dying` sniff, the
unmount-race fallback) retired; the double-burst bug class is now structural (a bubble bursts once, then is
destroyed). Verified: suite + build green; live smoke across all five aura scenarios; owner feel-pass.
Roadmap: mark Phase 3c ✅ shipped; note the choreographer's channel set is now complete (sfx/float/lunge/
impact/aura) and Phase 4 (authoring: staggers, splitPerTarget/chain, the 🎬 DEV panel, ms-offset cues) is next.
README bullet.

- [ ] **Step 2: Full suite** green once more.

- [ ] **Step 3: Commit docs, push, PR.**
```bash
git add docs/devlog.md docs/roadmap.md README.md docs/superpowers/plans/2026-07-07-choreographer-phase3c.md
git commit -m "docs: devlog/roadmap/README + plan for choreographer phase 3c"
git push -u origin feat/choreographer-phase3c
"/c/Program Files/GitHub CLI/gh.exe" pr create --base main --title "feat: combat choreographer phase 3c — aura bursts" --body "<summary; the aura channel + landed anchor; syncShields reduced to position-tracking; all 6 welds retired + the double-burst bug structural; verification incl. feel-pass; 🤖 footer>"
```
Then WAIT for CI green before merging (phase 3b taught us CI Node 20 ≠ local Node 24 — the `navigator`
polyfill covers pixi.js imports, but re-confirm CI passes).

---

## Self-review

- **Spec coverage:** burst/break authority → choreographer ✓ (Tasks 3-7); the `landed` anchor produced by the
pull-back ✓ (Task 5); `data-rising` + `deathBurstRef` subsumed ✓ (Tasks 5-7); the reborn/shield welds retired
into the aura channel + config ✓ (Tasks 2-3, 6-7); `syncShields` keeps position-tracking ("bubbles riding
cards") ✓ (Task 7 keeps PASS 1 setShield + PASS 4). Deferred per spec: generic ms-offset cues + the
`if?: Condition` system → phase 4 (3c encapsulates the two delays in the channel + resolves the riseDeath role
in the replay).
- **The double-burst bug:** retired structurally — a burst destroys the pixiFx bubble (`breakShield` deletes
the map entry), so a second fire finds no bubble and no-ops (`hasAura` false). No `deathBurstRef` guard needed.
The riseDeath attacker fires ONCE at `landed` (engine), the defender ONCE at `start` (replay Step 3), never
both (mutually exclusive on `e.target === impactAtk`).
- **Type consistency:** `Channel` gains `'aura'` (Task 4) used in `SCORE` + `runMomentCues`; `CueContext` gains
`onAuraBurst`/`onShieldBreak`/`onReborn` (Task 4) wired in Task 6; `runRiseReturn(el, combatSpeed, onLanded)`
(Task 5) called in Task 6 Step 4; `hasAura`/`auraRect` (Task 1) consumed by `channels/aura.ts` (Task 3);
`getChoreoConfig().shieldBreakDelay`/`.rebornReformDelay` (Task 2) read in Task 3.
- **Risk:** Tasks 6-7 are the hot-file changes (useCombatReplay + Recruit, the two hottest UI files). Mitigated
by: every new piece unit-tested before integration (Tasks 1-5), the aura DISPATCH being verbatim relocations of
audited code, the weld-retirement grep gate (Task 7 Step 6), the full suite + typecheck:web-baseline gate, and
a live smoke exercising ALL FIVE aura scenarios + the owner feel-pass. The single largest hazard — a
double-burst or a missed burst during the syncShields→choreographer handoff — is exactly what Task 8's
per-aura smoke targets.
- **Placeholder scan:** the syncShields surgery (Task 7) specifies exact passes/lines to delete + the precise
replacement code for PASS 2; the aura channel + engine + score + config code is complete; the one "read the
current file + match verbatim" instruction (Task 5/6 tween params, Task 7 line numbers) is a deliberate
guard against post-3b line drift, not a placeholder.
