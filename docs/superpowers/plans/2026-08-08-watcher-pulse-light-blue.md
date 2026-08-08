# Watcher Pulse — Light-Blue Medallion + Frame Bloom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a "watcher" card reacts to an ally's attack, give it a distinct light-blue look — a light-blue medallion pulse AND a light-blue card-frame bloom (the owner's `watcher-pulse` Pixi def, CSS fallback) — so it reads differently from a self-rally (yellow) or a Battlecry (white).

**Architecture:** UI-only, cosmetic. A pure classifier finds the non-attacker friendly units that fired an effect inside an attack beat (the watchers). `useCombatReplay`'s existing trigger-pulse effect reroutes those uids off the generic white medallion set onto a new light-blue medallion set + a frame-pulse (Pixi-or-CSS). No sim/gameplay change; the attacker's yellow rally pulse, the per-proc model, and combat rolls are untouched.

**Tech Stack:** TypeScript, React, Vitest (unit — logic only; the repo has no jsdom, so React render is verified by the browser harness), a puppeteer-core harness driving the dev server.

**Spec:** `docs/superpowers/specs/2026-08-08-watcher-pulse-light-blue-design.md`

## Global Constraints

- **Branch:** `feat/watcher-pulse-on-main`, off current `main`. This REBUILDS the one genuinely-new piece of the abandoned PR #918; #918 is closed. Commit onto this branch; never touch `main` directly.
- **Cosmetic only. Zero sim/gameplay/RNG change.** Touch no file under `packages/core` or `packages/sim`. No new combat event, no card-def change.
- **Do NOT disturb main's existing pulse/roll systems:** `firePulse` (attacker yellow), `rallyProcsFor`, the `rallyFx` cue, `COMBAT_ROLL_MS` (650), `combatDamageDeltas`. The watcher pulse is purely additive threading.
- **"Watcher" = a non-attacker friendly unit that is the `source`/`target` of a stat-grant event inside an ATTACK beat's range.** The attacker (`beat.primary.attacker`) is never a watcher.
- **Additive + recolor:** a watcher KEEPS a medallion pulse (recolored white → light blue) AND gains the frame bloom. It is removed from the generic white `trig` set only so it takes the light-blue class instead of white.
- **Shared color:** `--watcher-pulse-color: #7fc8ff` tints both the light-blue medallion variant and the CSS frame bloom; the Pixi def carries its own light-blue palette.
- **The def is owner-authored** — bring in `packages/ui/src/fx/defs/watcher-pulse.json` (id `watcher-pulse`) verbatim from the source below; do not redesign it.
- **`fx/directCalls.ts` is a pinned governance snapshot** — its test re-derives every literal `playDef('id', …)` call site from source and asserts equality. The new `playDef('watcher-pulse', …)` call and its `DIRECT_CALL_SITES` entry MUST land in the same task, or the test fails.

---

## File Structure

- **Create** `packages/ui/src/choreo/channels/watcherPulse.ts` — the pure `watcherPulseUids` classifier.
- **Create** `packages/ui/src/choreo/channels/watcherPulse.test.ts` — its unit test.
- **Create** `packages/ui/src/fx/watcherPulse.ts` — `WATCHER_PULSE_DEF_ID` + `useWatcherPixi` gate helper.
- **Create** `packages/ui/src/fx/watcherPulse.test.ts` — its unit test.
- **Create** `packages/ui/src/fx/defs/watcher-pulse.json` — the authored ring-bloom def.
- **Modify** `packages/ui/src/fx/playDef.ts` — DEV-only `window.__fxFires` seam.
- **Modify** `packages/ui/src/Card.tsx` — `pulseWatcher`/`pulseFrame` props, medallion `.watcher` class, `.framepulsering` overlay.
- **Modify** `packages/ui/src/Unit.tsx` — thread `watcherPulse`/`framePulse` props (incl. the `memo` comparator).
- **Modify** `packages/ui/src/useCombatReplay.ts` — reroute watchers in the trigger effect; new state + return fields; Pixi-or-CSS fire.
- **Modify** `packages/ui/src/Recruit.tsx` — pass the two new props to `Unit` (two call sites).
- **Modify** `packages/ui/src/styles.css` — `--watcher-pulse-color`, `.cgem.pulsing.watcher`, `.framepulsering`.
- **Modify** `packages/ui/src/fx/directCalls.ts` + `directCalls.test.ts` — register the `watcher-pulse` call site.
- **Modify** `docs/superpowers/harness/rally-beat-verify.mjs` (or a new probe) — a watcher scenario.

---

## Task 1: The `watcherPulseUids` classifier (pure)

**Files:**
- Create: `packages/ui/src/choreo/channels/watcherPulse.ts`
- Test: `packages/ui/src/choreo/channels/watcherPulse.test.ts`

**Interfaces:**
- Produces: `watcherPulseUids(beat: { start: number; end: number }, events: CombatEvent[], attackerUid: string): string[]` — the distinct non-attacker uids that fired a stat-grant event in `[beat.start, beat.end)`, in first-seen order.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/choreo/channels/watcherPulse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { watcherPulseUids } from './watcherPulse';

const ev = (e: Partial<CombatEvent>): CombatEvent => e as CombatEvent;

describe('watcherPulseUids', () => {
  it('returns non-attacker friendly sources of stat-grant events, attacker excluded', () => {
    // attack by ATK; ATK's own rally buff (source ATK); a watcher WCH reacts (buff source WCH); WCH improve.
    const events = [
      ev({ type: 'attack', attacker: 'ATK', defender: 'DEF', swing: 0 }),
      ev({ type: 'buff', target: 'ally', attack: 1, health: 1, source: 'ATK' }), // attacker's own → excluded
      ev({ type: 'buff', target: 'x', attack: 2, health: 1, source: 'WCH' }),     // watcher → included
      ev({ type: 'improve', target: 'WCH', amount: 1 }),                          // same watcher, dedup
      ev({ type: 'buff', target: 'y', attack: 1, health: 1, source: 'WCH2' }),    // second watcher
    ];
    expect(watcherPulseUids({ start: 0, end: 5 }, events, 'ATK')).toEqual(['WCH', 'WCH2']);
  });

  it('is empty when only the attacker acts', () => {
    const events = [
      ev({ type: 'attack', attacker: 'ATK', defender: 'DEF', swing: 0 }),
      ev({ type: 'buff', target: 'z', attack: 1, health: 1, source: 'ATK' }),
    ];
    expect(watcherPulseUids({ start: 0, end: 2 }, events, 'ATK')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails (module missing)**

Run: `npx vitest run packages/ui/src/choreo/channels/watcherPulse.test.ts`
Expected: FAIL — cannot resolve `./watcherPulse`.

- [ ] **Step 3: Implement the classifier**

`packages/ui/src/choreo/channels/watcherPulse.ts`:

```typescript
import type { CombatEvent } from '@game/core';

/**
 * WATCHER-PULSE channel. Which units — OTHER than the beat's attacker — fired an effect inside this attack
 * beat, i.e. the "watchers" that answered an ally's swing (Crypt Drake, Mineral Master, Traveling Skald,
 * Raptor). They earn the distinct light-blue pulse (medallion + card frame) rather than the generic white
 * medallion pulse a Battlecry gets.
 *
 * The signal mirrors `useCombatReplay`'s trigger-medallion scan exactly — a unit is "acting" when it is the
 * `source` of an sc/buff/keyword/summon/toHand event, or the `target` of an improve/maxGold/hpGrant/reborn
 * event — MINUS the death branch (a Deathrattle is not an on-attack reaction) and MINUS the attacker itself
 * (its own rally/effect keeps the attacker's own pulse paths). First-seen order, deduped, so a cascade reads
 * left-to-right. Pure: the whole testable surface of this channel.
 */
export function watcherPulseUids(
  beat: { start: number; end: number },
  events: CombatEvent[],
  attackerUid: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (uid: string | undefined): void => {
    if (!uid || uid === attackerUid || seen.has(uid)) return;
    seen.add(uid);
    out.push(uid);
  };
  for (let i = beat.start; i < beat.end; i++) {
    const e = events[i];
    if (!e) continue;
    if ((e.type === 'sc' || e.type === 'buff' || e.type === 'keyword') && (e as { source?: string }).source) take((e as { source?: string }).source);
    else if ((e.type === 'summon' || e.type === 'toHand') && (e as { source?: string }).source) take((e as { source?: string }).source);
    else if (e.type === 'improve' || e.type === 'maxGold' || e.type === 'hpGrant' || e.type === 'reborn') take((e as { target?: string }).target);
  }
  return out;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `npx vitest run packages/ui/src/choreo/channels/watcherPulse.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck:pkgs`
Expected: clean.

```bash
git add packages/ui/src/choreo/channels/watcherPulse.ts packages/ui/src/choreo/channels/watcherPulse.test.ts
git commit -m "feat(fx): watcherPulseUids classifier — non-attacker sources in an attack beat"
```

---

## Task 2: FX plumbing — helper, def, and the harness seam

**Files:**
- Create: `packages/ui/src/fx/watcherPulse.ts`, `packages/ui/src/fx/watcherPulse.test.ts`
- Create: `packages/ui/src/fx/defs/watcher-pulse.json`
- Modify: `packages/ui/src/fx/playDef.ts`

**Interfaces:**
- Produces: `WATCHER_PULSE_DEF_ID = 'watcher-pulse'`, `useWatcherPixi(defAvailable: boolean, canPlay: boolean): boolean`.

- [ ] **Step 1: Write the failing helper test**

`packages/ui/src/fx/watcherPulse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WATCHER_PULSE_DEF_ID, useWatcherPixi } from './watcherPulse';

describe('watcherPulse channel decision', () => {
  it('uses Pixi only when the def is committed AND the renderer can play', () => {
    expect(useWatcherPixi(true, true)).toBe(true);
    expect(useWatcherPixi(true, false)).toBe(false);
    expect(useWatcherPixi(false, true)).toBe(false);
    expect(useWatcherPixi(false, false)).toBe(false);
  });
  it('names the owner-authored def', () => {
    expect(WATCHER_PULSE_DEF_ID).toBe('watcher-pulse');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run packages/ui/src/fx/watcherPulse.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create the helper**

`packages/ui/src/fx/watcherPulse.ts`:

```typescript
/**
 * The watcher-pulse channel decision — Pixi ring-bloom when the owner's def is committed and the overlay can
 * play it, else the CSS `.framepulsering` fallback. Pure so the branch is unit-tested without a renderer; the
 * call site (`useCombatReplay.ts`) supplies the two booleans.
 */
export const WATCHER_PULSE_DEF_ID = 'watcher-pulse';

export function useWatcherPixi(defAvailable: boolean, canPlay: boolean): boolean {
  return defAvailable && canPlay;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run packages/ui/src/fx/watcherPulse.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the authored def**

Create `packages/ui/src/fx/defs/watcher-pulse.json` with EXACTLY this content (the owner-authored ring-bloom; procedural layers, no imported art):

```json
{
  "version": 1,
  "id": "watcher-pulse",
  "duration": 900,
  "layers": [
    { "primitive": "burst", "anchor": "travel", "at": 0, "params": { "count": 176, "interval": 600, "spread": 1, "aimMode": "travel", "angle": -90, "speed": 1025, "speedVar": 0, "drag": 0.7, "gravity": -900, "life": 1190, "orientToVelocity": false, "turbulence": 0, "turbScale": 0.02, "emitShape": "ring", "emitRadius": 51, "emitSquash": 1.34, "inheritVel": 0, "shape": "shard", "size": 11, "sizeVar": 0.5, "stretchX": 1, "stretchY": 1, "sizeCurve": [[0, 1], [1, 0]], "coreBias": 1, "biasCurve": [[0, 1], [1, 1]], "alphaCurve": [[0, 1], [1, 1]], "fade": 1.8, "bands": 3, "plateau": 0.45, "fieldMix": 0, "tintMode": "palette", "palette": [8831230, 7705087, 10410751, 16777215], "blendMode": "add", "glow": 0, "noiseScale": 6, "warp": 1.2, "scroll": 4.15, "erode": 1.2, "gain": 0.85 } },
    { "primitive": "burst", "anchor": "travel", "at": 0, "params": { "count": 176, "interval": 410, "spread": 0.24, "aimMode": "travel", "angle": -90, "speed": 130, "speedVar": 0, "drag": 0.7, "gravity": -900, "life": 1190, "orientToVelocity": false, "turbulence": 0, "turbScale": 0.02, "emitShape": "ring", "emitRadius": 79, "emitSquash": 1.34, "inheritVel": 0, "shape": "shard", "size": 11, "sizeVar": 0.5, "stretchX": 1, "stretchY": 1, "sizeCurve": [[0, 1], [1, 0]], "coreBias": 1, "biasCurve": [[0, 1], [1, 1]], "alphaCurve": [[0, 1], [1, 1]], "fade": 1.8, "bands": 3, "plateau": 0.45, "fieldMix": 0, "tintMode": "palette", "palette": [7437054, 8427007, 10410751, 16777215], "blendMode": "add", "glow": 0, "noiseScale": 6, "warp": 1.2, "scroll": 4.15, "erode": 1.2, "gain": 0.85 } },
    { "primitive": "shockwave", "anchor": "travel", "at": 0, "params": { "rings": 1, "speed": 4.95, "thickness": 0.16, "fade": 1.2, "radius": 160, "squash": 1, "ringDelay": 0, "ease": 0.3, "bands": 6, "palette": [12110335, 3046368, 9486590, 1016831], "alpha": 1, "blendMode": "normal", "glow": 0, "plateau": 0.9, "noiseAlong": 3, "noiseAcross": 7, "warp": 0, "scroll": 1.4, "erode": 0.89, "gain": 0.47 } },
    { "primitive": "shockwave", "anchor": "travel", "at": 0, "params": { "rings": 1, "speed": 4.95, "thickness": 0.16, "fade": 0.75, "radius": 160, "squash": 1, "ringDelay": 0, "ease": 0.3, "bands": 6, "palette": [15791103, 13427455, 13492990, 14741503], "alpha": 1, "blendMode": "normal", "glow": 0.28, "plateau": 0.9, "noiseAlong": 5.8, "noiseAcross": 10.5, "warp": 0, "scroll": 1.4, "erode": 1.11, "gain": 0.33 } }
  ]
}
```

- [ ] **Step 6: Add the DEV-only fire log to playDef**

In `packages/ui/src/fx/playDef.ts`, inside `playDef`, immediately before the final `return retire;` (after the updater is registered — so it only logs fires that actually started):

```typescript
  // DEV-only fire log: a Pixi effect paints to a canvas with no DOM class, so the browser harness can't rAF-
  // sample it. This gives the committed harness a way to observe that a def fired, and when. Positive
  // `import.meta.env.DEV` branch so Rollup drops it from production builds.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as { __fxFires?: { id: string; t: number }[] };
    (w.__fxFires ??= []).push({ id, t: performance.now() });
  }

  return retire;
```

- [ ] **Step 7: Run the fx suite + typecheck**

Run: `npx vitest run packages/ui/src/fx && npm run typecheck:pkgs`
Expected: PASS. The new def registers via the `defs/*.json` glob; the fx tests (incl. any def-registry/bindings test) stay green. NOTE: do NOT edit `directCalls.ts` yet — the `watcher-pulse` call site doesn't exist until Task 3, so registering it now would fail the pinned test.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/fx/watcherPulse.ts packages/ui/src/fx/watcherPulse.test.ts packages/ui/src/fx/defs/watcher-pulse.json packages/ui/src/fx/playDef.ts
git commit -m "feat(fx): watcher-pulse def + useWatcherPixi gate + DEV __fxFires seam"
```

---

## Task 3: Render + wire the watcher pulse

The integration task: render the two surfaces (Card/Unit/styles), reroute watchers in the hook, thread the state, fire Pixi-or-CSS, and register the call site. No jsdom render test exists in this repo, so this task is gated by typecheck + the full suite (incl. the `directCalls` pinned test); the on-screen result is proven by Task 4's harness.

**Files:**
- Modify: `packages/ui/src/Card.tsx`, `packages/ui/src/Unit.tsx`, `packages/ui/src/Recruit.tsx`, `packages/ui/src/styles.css`, `packages/ui/src/useCombatReplay.ts`, `packages/ui/src/fx/directCalls.ts`, `packages/ui/src/fx/directCalls.test.ts`

**Interfaces:**
- Consumes: `watcherPulseUids` (Task 1), `WATCHER_PULSE_DEF_ID`/`useWatcherPixi` (Task 2), `getDef` (`fx/fxDefs`), `canPlayDefs`/`playDef` (`fx/playDef`), `anchorsForUnits` (`fx/combatAnchors`).
- Produces: `useCombatReplay` return gains `watcherPulseUids: Map<string, number>` and `framePulseUids: Map<string, number>`.

- [ ] **Step 1: Card.tsx — the light-blue medallion class + the frame overlay**

Add the two props to `CardProps` (near `pulse`/`pulseRally`, ~line 393-398):

```typescript
  /** Pulse the trigger medallion LIGHT BLUE — a watcher answered an ally's attack. Same ring as `pulse`,
   *  forced light blue; sits between `pulseRally` (yellow) and `pulse` (white) in precedence. A per-fire NONCE
   *  (used as the medallion `key`, like `pulseRally`) so a repeat watcher pulse restarts the animation. */
  pulseWatcher?: number;
  /** Bloom the CARD FRAME light blue — the watcher's frame surface (CSS fallback when the Pixi `watcher-pulse`
   *  def can't play). A per-fire nonce keyed onto the `.framepulsering` overlay so each fire replays. */
  pulseFrame?: number;
```

Destructure them (near `pulse, pulseRally` ~line 343-344): add `pulseWatcher, pulseFrame,`.

Update the medallion span (line ~1038) — add the `watcher` class between `rally` and the plain `pulsing`, and fold `pulseWatcher` into the remount key:

```tsx
            <span key={`cgem-${pulseRally ?? 0}-${pulseWatcher ?? 0}`} className={`cgem${pulseRally ? ' pulsing rally' : pulseWatcher ? ' pulsing watcher' : pulse ? ' pulsing' : glow ? ' glowing' : ''}`} aria-hidden="true"><Icon name={mechIcon} /></span>
```

Add the frame overlay. Find the card root element (the outer `.card` wrapper that this component returns) and add, as a direct child (sibling to the frame/art layers, so it rings the whole card), keyed by the nonce so React remounts it each fire:

```tsx
            {pulseFrame ? <span key={`framepulse-${pulseFrame}`} className="framepulsering" aria-hidden="true" /> : null}
```

Place it so it overlays the card frame (absolute, inset 0). If the exact z-order needs a specific parent, mount it in the same container the frame PNG layers use, above the art and below interactive content.

- [ ] **Step 2: styles.css — the color var, the light-blue medallion, the frame bloom**

Read the existing `.cgem` / `.pulsing` / `.pulsing.rally` block (search `styles.css` for `.cgem` and `cgempulse`/`cgemglow`, ~lines 1705-1758) to match its structure. Add:

```css
:root { --watcher-pulse-color: #7fc8ff; }

/* WATCHER medallion — same ring as .pulsing, tinted light blue. Mirror whatever color mechanism
   `.cgem.pulsing.rally` uses (box-shadow / filter / background), swapping its hue for --watcher-pulse-color. */
.card.compact .cgem.pulsing.watcher {
  /* match the .rally rule's properties; substitute the yellow with var(--watcher-pulse-color) */
}

/* WATCHER card-frame bloom — a one-shot light-blue ring on the whole card, the CSS fallback for the Pixi def. */
.framepulsering {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 3;
  animation: framepulse 1s ease-out forwards;
  box-shadow: 0 0 0 2px var(--watcher-pulse-color), 0 0 16px 4px color-mix(in srgb, var(--watcher-pulse-color) 60%, transparent);
}
@keyframes framepulse {
  0%   { opacity: 0; transform: scale(0.92); }
  25%  { opacity: 1; }
  100% { opacity: 0; transform: scale(1.06); }
}
```

Tune the exact `.cgem.pulsing.watcher` declaration to whatever properties `.cgem.pulsing.rally` sets (read that rule and copy it, replacing the yellow with `var(--watcher-pulse-color)`). Keep the frame bloom subtle; the Pixi def is the primary visual when it plays.

- [ ] **Step 3: Unit.tsx — thread the props (incl. the memo comparator)**

In `UnitProps` (after `rallyPulse`, ~line 23):

```typescript
  /** Pulse the trigger medallion LIGHT BLUE — this unit is a watcher that answered an ally's attack. Nonce. */
  watcherPulse?: number;
  /** Bloom this unit's card frame light blue — the watcher's frame surface (CSS fallback). Nonce. */
  framePulse?: number;
```

Destructure in `UnitInner` (line 30): `function UnitInner({ u, side, anim, triggered, rallyPulse, watcherPulse, framePulse }: UnitProps) {`.

Pass to `Card` (line 128): add `pulseWatcher={watcherPulse} pulseFrame={framePulse}`.

In the `memo` comparator (line ~140-144), add both to the equality chain so a pulse change re-renders:

```typescript
  a.watcherPulse === b.watcherPulse &&
  a.framePulse === b.framePulse &&
```

- [ ] **Step 4: useCombatReplay.ts — state, imports, return fields**

Add imports near the fx imports (`anchorsForUnits` is already imported; add getDef + the helper + the classifier):

```typescript
import { getDef } from './fx/fxDefs';
import { WATCHER_PULSE_DEF_ID, useWatcherPixi } from './fx/watcherPulse';
import { watcherPulseUids } from './choreo/channels/watcherPulse';
```

Add state beside `rallyPulse`/`rallyNonceRef` (~line 791-792):

```typescript
  const [watcherPulse, setWatcherPulse] = useState<Map<string, number>>(new Map());
  const watcherNonceRef = useRef(0);
  const [framePulse, setFramePulse] = useState<Map<string, number>>(new Map());
  const frameNonceRef = useRef(0);
```

Add to the return interface (beside `rallyPulseUids: Map<string, number>;` ~line 573):

```typescript
  watcherPulseUids: Map<string, number>;
  framePulseUids: Map<string, number>;
```

Add to the returned object (beside `rallyPulseUids: rallyPulse,` ~line 2061):

```typescript
    watcherPulseUids: watcherPulse,
    framePulseUids: framePulse,
```

Also clear them wherever `setTriggers(new Set())` resets on combat (re)start (~line 1001 and any resetTo): add `setWatcherPulse(new Map()); setFramePulse(new Map());`.

- [ ] **Step 5: useCombatReplay.ts — reroute watchers in the trigger effect**

In the trigger-medallion effect (the `useEffect` at ~1196), AFTER the `trig` set is fully built (after the loop that ends ~line 1220, before the spell-power flourish loops), insert the reroute. It (a) finds this beat's watchers via the classifier, (b) removes them from `trig` so they take the light-blue class instead of white, (c) fires the light-blue medallion nonce + the frame pulse (Pixi or CSS) for each:

```typescript
    // WATCHER pulse: on an attack beat, a friendly unit OTHER than the attacker that fired an effect this beat
    // is a watcher answering the swing (Crypt Drake, Mineral Master, …). Give it the distinct light-blue look
    // — medallion recolored + a card-frame bloom — instead of the generic white medallion pulse. Additive: it
    // keeps a medallion pulse (now blue) and gains the frame. Purely presentation; timed to the same beat the
    // white pulse would have fired.
    if (beat.primary.type === 'attack') {
      const watchers = watcherPulseUids(beat, events, beat.primary.attacker);
      for (const uid of watchers) {
        trig.delete(uid); // take the light-blue medallion class, not white
        // light-blue medallion (nonce → remount → animation restarts, mirroring firePulse/rallyPulse)
        const wn = ++watcherNonceRef.current;
        setWatcherPulse((prev) => new Map(prev).set(uid, wn));
        window.setTimeout(() => setWatcherPulse((prev) => { const m = new Map(prev); if (m.get(uid) === wn) m.delete(uid); return m; }), 1150);
        // card-frame bloom: Pixi ring-bloom when the def is committed + playable, else the CSS overlay
        if (useWatcherPixi(!!getDef(WATCHER_PULSE_DEF_ID), canPlayDefs())) {
          const a = anchorsForUnits(uid, uid); // source = target = the watcher's own card
          if (a) playDef(WATCHER_PULSE_DEF_ID, a, { uids: { source: uid, target: uid } });
        } else {
          const fn = ++frameNonceRef.current;
          setFramePulse((prev) => new Map(prev).set(uid, fn));
          window.setTimeout(() => setFramePulse((prev) => { const m = new Map(prev); if (m.get(uid) === fn) m.delete(uid); return m; }), 1150);
        }
      }
    }
```

(`canPlayDefs` and `playDef` are already imported in this file; confirm and add to the import if not. `beat` here is `beats[beatIdx - 1]`, already in scope in this effect.)

- [ ] **Step 6: Recruit.tsx — pass the props to Unit (two sites)**

At BOTH combat `Unit` call sites (the ones already passing `triggered={replay.triggerUids.has(u.uid)}` / `rallyPulse={replay.rallyPulseUids.get(u.uid)}`, ~lines 4227-4228 and 4277-4278), add:

```tsx
                watcherPulse={replay.watcherPulseUids.get(u.uid)}
                framePulse={replay.framePulseUids.get(u.uid)}
```

- [ ] **Step 7: directCalls — register the new call site**

`useCombatReplay.ts` now contains a literal `playDef('watcher-pulse', …)`. Run the suite once to see the pinned `directCalls.test.ts` fail and print the expected object, then update `packages/ui/src/fx/directCalls.ts`'s `DIRECT_CALL_SITES` to add `'watcher-pulse': ['useCombatReplay.ts'],` (keep the object's existing formatting/sort order). If the test derives a sorted list, match it exactly. Update the file's doc comment only if it enumerates the ids.

- [ ] **Step 8: Typecheck + full suite**

Run: `npm run typecheck && npx vitest run`
Expected: PASS, including `directCalls.test.ts`. No sim/roll test shifts (this task touches no `packages/core`/`packages/sim` and no `firePulse`/`COMBAT_ROLL_MS` code).

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/Card.tsx packages/ui/src/Unit.tsx packages/ui/src/Recruit.tsx packages/ui/src/styles.css packages/ui/src/useCombatReplay.ts packages/ui/src/fx/directCalls.ts packages/ui/src/fx/directCalls.test.ts
git commit -m "feat(fx): watcher pulse — light-blue medallion + frame bloom, wired through combat replay"
```

---

## Task 4: Browser verification — a watcher scenario

**Files:**
- Modify: `docs/superpowers/harness/rally-beat-verify.mjs` (or create `docs/superpowers/harness/watcher-pulse-verify.mjs` if the existing harness's assumptions don't fit)

**Interfaces:**
- Consumes: the DEV `window.__fxFires` seam (Task 2); the light-blue medallion class `.cgem.pulsing.watcher` and `.framepulsering` (Task 3).

- [ ] **Step 1: Add a Crypt Drake watcher scenario**

Model it on the existing harness's card-injection pattern (Scene Builder → shop-inject → buy → play → serve a dummy → `faceOmen`, `combatSpeed: 1`). Board: two `frontdrake` (attackers, health-pinned so they survive to swing) + `cryptdrake` (the watcher; it buffs every 2 ally attacks, so it needs at least two ally swings). Serve a tanky low-attack dummy (`b2_packstrider` attack 1 / health 40). Sample, over the fight, on the Crypt Drake card: the `.cgem` className, whether a `.framepulsering` element is present, and capture `window.__fxFires` at the end. Also record the beat's attacker uid(s) so the scenario can assert the attacker did NOT get a frame pulse.

- [ ] **Step 2: Assert the watcher's distinct look**

The scenario passes when, on the beat Crypt Drake reacts:
- its medallion shows a `.cgem.pulsing.watcher` rising edge (light-blue), AND
- a frame pulse fired — EITHER a `.framepulsering` element appeared on its card (CSS fallback) OR `window.__fxFires` contains a `watcher-pulse` entry (Pixi), AND
- the beat's ATTACKER (a `frontdrake`) shows NO `.framepulsering` and no `watcher-pulse` fire anchored to it (frame pulse is watcher-only).

Print PASS/FAIL with the observed class + fire evidence, and keep a non-zero `process.exit` on failure.

- [ ] **Step 3: Run it against the dev server**

Start a dev server on this worktree if one isn't already serving it (`npm run dev`; note the port), then:
Run: `URL=http://localhost:<port> node docs/superpowers/harness/<the-harness>.mjs`
Expected: the watcher scenario PASSES — light-blue medallion + frame pulse on Crypt Drake, none on its attacker. Paste the real output into the report. Do NOT loosen the assertion to force a pass; if Crypt Drake doesn't react in the sample window, give it more health / a longer window / a second ally swing.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/harness/
git commit -m "test(harness): watcher pulse scenario — light-blue medallion + frame bloom on Crypt Drake"
```

---

## Self-Review

**Spec coverage:**
- Distinct light-blue medallion (recolored, additive) → Task 3 Steps 1-2 (`.cgem.pulsing.watcher` + `--watcher-pulse-color`).
- Light-blue frame bloom via Pixi def, CSS fallback → Task 2 (def + helper + seam) + Task 3 Steps 1-2, 5 (`.framepulsering`, `useWatcherPixi` gate).
- Watcher classification (non-attacker, attack beat) → Task 1 (`watcherPulseUids`) + Task 3 Step 5 (attack-beat gate + reroute).
- Additive (keep medallion, add frame; exclude from white) → Task 3 Step 5 (`trig.delete` + set both surfaces).
- Attacker/yellow/per-proc/combat-roll untouched → Global Constraints; no diff to `firePulse`/`rallyProcsFor`/`COMBAT_ROLL_MS`.
- Verification: classifier + gate unit tests (Tasks 1-2), harness (Task 4).

**Placeholder scan:** The only intentionally-deferred detail is the exact CSS declaration of `.cgem.pulsing.watcher` (Task 3 Step 2 says "copy the `.rally` rule, swap the hue") and the precise JSX parent for `.framepulsering` (Task 3 Step 1) — both require reading the exact surrounding CSS/JSX, which the implementer does in-task; the mechanism (light-blue tint; absolute full-card overlay) is fully specified.

**Type consistency:** `watcherPulseUids(beat, events, attackerUid): string[]` (Task 1) is consumed with `(beat, events, beat.primary.attacker)` (Task 3 Step 5). `useWatcherPixi(defAvailable, canPlay)` (Task 2) called `useWatcherPixi(!!getDef(WATCHER_PULSE_DEF_ID), canPlayDefs())` (Task 3 Step 5). New return fields `watcherPulseUids`/`framePulseUids: Map<string, number>` (Task 3 Step 4) consumed as `.get(u.uid)` (Task 3 Step 6) and rendered via `pulseWatcher`/`pulseFrame` nonce props (Task 3 Steps 1, 3). `window.__fxFires: { id, t }[]` written in Task 2 Step 6, read in Task 4 Step 2.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-08-watcher-pulse-light-blue.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — batch execution with checkpoints via executing-plans.

**Which approach?**
