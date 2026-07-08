# Choreography Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dev-only visual **timeline editor** for combat presentation timing — every effect is a cue you drag on a time track (or type an exact ms offset) to retime/reorder — backed by a live-editable Score, with a mock-stage ▶ preview that fires the real FX on demand.

**Architecture:** Three ordered layers. **(A) Infra (invisible):** `Cue` gains `offset`/`scaled`/`enabled`; the single `aura` channel splits into `auraBurst`/`auraBreak`/`auraReform` sub-channels so each aura timing is its own draggable cue; the runner + engine schedule cues at *anchor-time + offset*; the aura channel's internal `setTimeout` delays retire into cue offsets; the `SCORE` const becomes a live-editable store (defaults + localStorage overrides, like `choreoConfig`). A **byte-identical equivalence test** gates every infra step. **(B) Panel UI:** a `ChoreographyPanel` (moment rail + per-cue numeric editor + tempo + Copy/Reset) with a `Timeline` drag widget layered on it; the Pacing tuner is retired into it. **(C) Preview:** a mock-stage that fires the selected moment's FX-channel cues against two dummy unit cards.

**Tech Stack:** TypeScript monorepo; Vitest (node env; `vitest.setup.ts` polyfills `navigator` for pixi.js); React + the existing `useDraggablePanel`/DevMenu tuner convention; GSAP; localStorage-backed config stores mirroring `choreoConfig.ts`.

**Spec:** `docs/superpowers/specs/2026-07-07-choreography-panel-design.md`. **Branch:** `feat/choreography-panel` (already created; the spec is committed there).

**Invisible-infra contract (Tasks 1–5):** with the default score, every effect fires at the exact same time as today (the migrated aura offsets reproduce the channel delays). This is the load-bearing equivalence test. The panel (Tasks 6–10) and preview (Tasks 11–12) are additive dev-only UI.

---

### Task 0: Confirm branch

- [ ] You should already be on `feat/choreography-panel` (the spec lives there). Verify:
```bash
git branch --show-current   # → feat/choreography-panel
git switch main && git pull --ff-only && git switch feat/choreography-panel && git rebase main
```
(Rebase so the branch is current; `main` may have advanced.)

---

## Layer A — Infra (invisible, equivalence-gated)

### Task 1: Extend `Cue`; split the aura channel into three sub-channels

**Why:** The editable/timeline model needs every effect to be a cue with its own `offset`. The one `aura` cue currently does burst/break/reform (three different timings) inside one branch — to make each independently retimeable, split it into three sub-channels, each its own cue. Behavior stays identical (the runner dispatches the same three effects); this just gives each its own cue row + offset.

**Files:**
- Modify: `packages/ui/src/choreo/score.ts`
- Modify: `packages/ui/src/choreo/score.test.ts`
- Modify: `packages/ui/src/choreo/engine.ts` (the `cues.some(c => c.ch === 'lunge'|'impact')` checks — unaffected by the aura split, but confirm they still compile)

- [ ] **Step 1: Update `score.test.ts`** — replace the aura-cue assertions. The old tests referenced `ch === 'aura'`; the split renames them. Update the "aura cue on every kind" test and the runner tests:

```ts
  it('auraBurst + auraBreak are on every kind; auraReform is on the reborn kind (grouped effects not missed)', () => {
    for (const kind of ['damage', 'death', 'shieldPop', 'poisonTick', 'summon'] as const) {
      expect(SCORE[kind].some((c) => c.ch === 'auraBurst')).toBe(true);
      expect(SCORE[kind].some((c) => c.ch === 'auraBreak')).toBe(true);
    }
    expect(SCORE.reborn.some((c) => c.ch === 'auraReform')).toBe(true);
  });

  it('the migrated aura offsets reproduce the old channel delays', () => {
    const burst = SCORE.death.find((c) => c.ch === 'auraBurst')!;
    const brk = SCORE.shieldPop.find((c) => c.ch === 'auraBreak')!;
    const reform = SCORE.reborn.find((c) => c.ch === 'auraReform')!;
    expect(burst.offset ?? 0).toBe(0);                    // death burst: immediate
    expect(brk.offset).toBe(300);                          // was SHIELD_BREAK_DELAY
    expect(brk.scaled ?? true).toBe(true);                 // scales with combat speed (tracks the lunge)
    expect(reform.offset).toBe(460);                       // was REBORN_SUMMON_DELAY
    expect(reform.scaled).toBe(false);                     // fixed — aligns to the risepop CSS
  });

  it('runMomentCues routes a real death → onAuraBurst, a shield → onShieldBreak, a reborn → onReborn', () => {
    const c1 = baseCtx([{ type: 'death', target: 'a', side: 'enemy' }] as CombatEvent[]);
    runMomentCues(moment('death', c1.events), c1);
    expect(c1.onAuraBurst).toHaveBeenCalledWith('a');
    const c2 = baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[]);
    runMomentCues(moment('shieldPop', c2.events), c2);
    expect(c2.onShieldBreak).toHaveBeenCalledWith('s');
    const c3 = baseCtx([{ type: 'reborn', target: 'r', hp: 1, attack: 2, keywords: [] }] as CombatEvent[]);
    runMomentCues(moment('reborn', c3.events), c3);
    expect(c3.onReborn).toHaveBeenCalledWith('r');
  });

  it('a rise death is not burst by the runner', () => {
    const c = baseCtx([{ type: 'death', target: 'r', side: 'enemy', rise: true }] as CombatEvent[]);
    runMomentCues(moment('riseDeath', c.events), c);
    expect(c.onAuraBurst).not.toHaveBeenCalled();
  });
```
(Adapt `baseCtx`/`moment` to the file's existing helpers; ensure `baseCtx` defaults `onAuraBurst`/`onShieldBreak`/`onReborn` to `vi.fn()`. Keep the existing sfx/float/shake tests.)

- [ ] **Step 2: Run — FAIL.** `npx vitest run packages/ui/src/choreo/score.test.ts`

- [ ] **Step 3: Implement in `score.ts`.** Replace the `Channel` union, `Cue`, and `SCORE`:

```ts
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'auraBurst' | 'auraBreak' | 'auraReform';
export type Anchor = 'start' | 'contact' | 'landed' | 'end';
export interface Cue {
  ch: Channel;
  at: Anchor;
  /** ms relative to the anchor (default 0). Negative allowed for contact/landed (fire before); start clamps ≥0. */
  offset?: number;
  /** Does `offset` scale with combatSpeed? default true; false = fixed wall-clock (the reborn re-form). */
  scaled?: boolean;
  /** default true; a disabled cue is skipped by the runner/engine. */
  enabled?: boolean;
}

/** The default cues every non-attack moment runs: sfx + float + the two speed-scaled aura sub-effects that can
 *  appear in ANY moment (death/shield are RESULT_TYPES that group into other kinds' moments). auraReform is
 *  added only to the `reborn` kind (a reborn event is never grouped elsewhere). */
const BASE: Cue[] = [
  { ch: 'sfx', at: 'start' },
  { ch: 'float', at: 'start' },
  { ch: 'auraBurst', at: 'start', offset: 0 },
  { ch: 'auraBreak', at: 'start', offset: 300, scaled: true },
];
const withReform = (): Cue[] => [...BASE, { ch: 'auraReform', at: 'start', offset: 460, scaled: false }];

export const SCORE: Record<MomentKind, Cue[]> = {
  attackExchange: [
    { ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' },
    { ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact', offset: 0 },
    { ch: 'auraBurst', at: 'start', offset: 0 }, { ch: 'auraBreak', at: 'start', offset: 300, scaled: true },
  ],
  damage: [...BASE], shieldPop: [...BASE], poisonTick: [...BASE],
  death: [...BASE], riseDeath: [...BASE], scCast: [...BASE],
  summon: [...BASE], buffWave: [...BASE], reborn: withReform(), ascend: [...BASE],
  rally: [...BASE], toHand: [...BASE], maxGold: [...BASE], improve: [...BASE],
  keyword: [...BASE], hpGrant: [...BASE], reveal: [...BASE],
};
```
Update `runMomentCues`'s aura branch to key on the three sub-channels instead of scanning inside one `aura` branch:

```ts
export function runMomentCues(moment: Moment, ctx: CueContext): void {
  for (const cue of SCORE[moment.kind]) {
    if (cue.enabled === false) continue;
    if (cue.ch === 'sfx') {
      const { shake } = playMomentSfx(moment, ctx.events);
      if (shake) ctx.onShake();
    } else if (cue.ch === 'float') {
      const { floats, deathFloats } = spawnFloats(moment, ctx.events, ctx.findEl, ctx.attackerUid);
      if (floats.length) ctx.onFloats(floats);
      if (deathFloats.length) ctx.onDeathFloats(deathFloats);
    } else if (cue.ch === 'auraBurst') {
      for (let i = moment.start; i < moment.end; i++) {
        const e = ctx.events[i];
        if (e?.type === 'death' && !e.rise) ctx.onAuraBurst(e.target); // rise deaths: replay/engine own them
      }
    } else if (cue.ch === 'auraBreak') {
      for (let i = moment.start; i < moment.end; i++) {
        const e = ctx.events[i];
        if (e?.type === 'shield') ctx.onShieldBreak(e.target);
      }
    } else if (cue.ch === 'auraReform') {
      for (let i = moment.start; i < moment.end; i++) {
        const e = ctx.events[i];
        if (e?.type === 'reborn') ctx.onReborn(e.target);
      }
    }
    // lunge/impact are engine-driven (runAttackExchangeCues) — no-op here, by design.
  }
}
```
(Offset SCHEDULING is added in Task 2 — for now the aura callbacks still fire synchronously via the caller, which keeps the aura channel's internal delays in place, so behavior is unchanged this task. This task is purely the cue-model split.)

- [ ] **Step 4: Run** `npx vitest run packages/ui/src/choreo` → green; `npm run typecheck && npm run lint` clean. `engine.ts`'s `cues.some(c => c.ch === 'lunge')`/`'impact'` still compile (those channels are unchanged). Do NOT worry about typecheck:web yet (useCombatReplay's runMomentCues call still compiles — its CueContext is unchanged this task).

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts
git commit -m "refactor(ui): split the aura channel into auraBurst/auraBreak/auraReform cues (+ offset/scaled/enabled on Cue)"
```

---

### Task 2: Offset-aware runner; retire the aura channel's internal delays

**Why:** Make the runner schedule each `start` cue at its offset (÷ combatSpeed when `scaled`), returning a cancel the caller cleans up — and move the aura break/reform delays OUT of the channel (`breakShieldAura`/`reformReborn` become immediate) INTO the cue offset the runner schedules. This is the equivalence-critical step.

**Files:**
- Modify: `packages/ui/src/choreo/score.ts`
- Modify: `packages/ui/src/choreo/channels/aura.ts`
- Modify: `packages/ui/src/choreo/channels/aura.test.ts`
- Modify: `packages/ui/src/choreo/score.test.ts`
- Modify: `packages/ui/src/useCombatReplay.ts` (the cue effect wiring)

- [ ] **Step 1: Make the aura dispatchers immediate.** In `aura.ts`, `breakShieldAura` and `reformReborn` currently `setTimeout` internally + return a cancel. Change them to fire IMMEDIATELY (no timer, no cancel) — the runner now owns the delay:

```ts
/** A Divine Shield was consumed → shatter it now (gold shards) + sound. The DELAY is now the auraBreak cue's
 *  offset, scheduled by the runner (was this function's internal SHIELD_BREAK_DELAY setTimeout). */
export function breakShieldAura(uid: string): void {
  pixiFx.breakShield(uid, 'shield');
  sfx.shieldBreak();
}

/** A unit reborn → the re-form glow + sound now. The DELAY is the auraReform cue's offset (scaled:false),
 *  scheduled by the runner (was the internal REBORN_SUMMON_DELAY setTimeout). */
export function reformReborn(rect: { cx: number; cy: number; w: number; h: number } | null): void {
  if (rect) pixiFx.rebornSummon(rect.cx, rect.cy, rect.w, rect.h);
  sfx.rebornSummon();
}
```
`burstDeathAuras(uid, tauntRect)` is unchanged (it was already immediate). Update `aura.test.ts`: drop the fake-timer/`cancel` assertions for break/reform (they no longer delay or return a cancel); assert `breakShieldAura('u')` calls `pixiFx.breakShield`+`sfx.shieldBreak` synchronously, and `reformReborn(rect)` calls `pixiFx.rebornSummon`+`sfx.rebornSummon` synchronously. Delete the now-obsolete `getChoreoConfig` import if unused, and `shieldBreakDelay`/`rebornReformDelay` may stay in choreoConfig (now unused by the channel — leave them; the panel/score reference the offsets, and Task 5 can note them as legacy). Actually — DELETE `shieldBreakDelay`/`rebornReformDelay` from choreoConfig + its test + the PacingTuner LABELS/ranges in this step (they're fully replaced by cue offsets); grep to confirm no remaining reference.

- [ ] **Step 2: Add offset scheduling to `runMomentCues`.** It now takes the `combatSpeed` (add to `CueContext`) and returns a `() => void` cleanup that cancels pending offset timers. A cue with `offset` > 0 (after clamp) schedules its dispatch via `setTimeout(offset / (scaled ? speed : 1))`; offset ≤ 0 (start) fires immediately. Restructure so each channel's dispatch is a thunk run at the scheduled time:

```ts
export interface CueContext {
  events: CombatEvent[];
  combatSpeed: number;
  onShake: () => void;
  findEl: (uid: string) => Element | null;
  attackerUid: string | null;
  onFloats: (floats: Float[]) => void;
  onDeathFloats: (deaths: DeathFloat[]) => void;
  onAuraBurst: (uid: string) => void;
  onShieldBreak: (uid: string) => void;
  onReborn: (uid: string) => void;
}

/** Run one moment's plain-effect cues (everything except lunge/impact, which the engine drives). Schedules
 *  each cue at its `start` + offset (÷ speed when scaled; start offsets clamp ≥ 0). Returns a cleanup that
 *  cancels any pending offset timers. */
export function runMomentCues(moment: Moment, ctx: CueContext): () => void {
  const timers: number[] = [];
  const at = (cue: Cue, fn: () => void): void => {
    const off = Math.max(0, cue.offset ?? 0) / (cue.scaled === false ? 1 : (ctx.combatSpeed > 0 ? ctx.combatSpeed : 1));
    if (off <= 0) fn();
    else timers.push(window.setTimeout(fn, off));
  };
  for (const cue of SCORE[moment.kind]) {
    if (cue.enabled === false) continue;
    if (cue.ch === 'sfx') at(cue, () => { const { shake } = playMomentSfx(moment, ctx.events); if (shake) ctx.onShake(); });
    else if (cue.ch === 'float') at(cue, () => {
      const { floats, deathFloats } = spawnFloats(moment, ctx.events, ctx.findEl, ctx.attackerUid);
      if (floats.length) ctx.onFloats(floats);
      if (deathFloats.length) ctx.onDeathFloats(deathFloats);
    });
    else if (cue.ch === 'auraBurst') at(cue, () => {
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'death' && !e.rise) ctx.onAuraBurst(e.target); }
    });
    else if (cue.ch === 'auraBreak') at(cue, () => {
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'shield') ctx.onShieldBreak(e.target); }
    });
    else if (cue.ch === 'auraReform') at(cue, () => {
      for (let i = moment.start; i < moment.end; i++) { const e = ctx.events[i]; if (e?.type === 'reborn') ctx.onReborn(e.target); }
    });
  }
  return () => timers.forEach((id) => window.clearTimeout(id));
}
```

- [ ] **Step 3: Add the equivalence + scheduling tests** to `score.test.ts` (use fake timers):

```ts
  it('a start cue with offset 0 fires synchronously; a positive offset schedules by offset/speed', () => {
    vi.useFakeTimers();
    const c = baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[], { combatSpeed: 2 });
    const cleanup = runMomentCues(moment('shieldPop', c.events), c);
    expect(c.onShieldBreak).not.toHaveBeenCalled();   // auraBreak offset 300, scaled, ÷2 → 150ms
    vi.advanceTimersByTime(149); expect(c.onShieldBreak).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(c.onShieldBreak).toHaveBeenCalledWith('s');
    cleanup(); vi.useRealTimers();
  });

  it('a scaled:false offset does NOT divide by speed (reborn re-form)', () => {
    vi.useFakeTimers();
    const c = baseCtx([{ type: 'reborn', target: 'r', hp: 1, attack: 2, keywords: [] }] as CombatEvent[], { combatSpeed: 2 });
    runMomentCues(moment('reborn', c.events), c);
    vi.advanceTimersByTime(459); expect(c.onReborn).not.toHaveBeenCalled();  // fixed 460 despite speed 2
    vi.advanceTimersByTime(2); expect(c.onReborn).toHaveBeenCalledWith('r');
    vi.useRealTimers();
  });

  it('the returned cleanup cancels a pending offset timer', () => {
    vi.useFakeTimers();
    const c = baseCtx([{ type: 'shield', target: 's' }] as CombatEvent[], { combatSpeed: 1 });
    const cleanup = runMomentCues(moment('shieldPop', c.events), c);
    cleanup(); vi.advanceTimersByTime(1000);
    expect(c.onShieldBreak).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
```
(Extend `baseCtx` to accept an overrides arg and default `combatSpeed: 1`.)

- [ ] **Step 4: Rewire the cue effect in `useCombatReplay.ts`.** The effect currently builds `cancels` from `breakShieldAura`/`reformReborn` (which returned cancels) and calls `runMomentCues(beat, {...})` (void). Now `runMomentCues` returns the cleanup and owns the delays; the aura callbacks are immediate. Update:
  - Add `combatSpeed: combatSpeedRef.current` to the `runMomentCues` context.
  - `onShieldBreak: (uid) => breakShieldAura(uid)` (immediate, no cancel).
  - `onReborn: (uid) => reformReborn(rectOf(uid))` (immediate, no cancel).
  - Remove the `cancels` array; capture the runner's returned cleanup: `const stop = runMomentCues(beat, {...})`.
  - The effect cleanup: `return () => { timers.forEach(clearTimeout); stop(); };` (keep `timers` for the float-lifetime timers; `stop()` cancels the runner's offset timers).
  Read the current effect (search `runMomentCues(beat`) and make exactly these changes; leave the rise-defender loop + `rectOf` helper intact.

- [ ] **Step 5: Full verification.**
```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
All green (report counts). `npm run typecheck:web` at its 21-error baseline (the CueContext gained `combatSpeed` — confirm the useCombatReplay call passes it; no new errors). **This is the equivalence checkpoint** — the aura delays now live in cue offsets scheduled by the runner, reproducing today's 300ms/460ms timing.

- [ ] **Step 6: Commit.**
```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts packages/ui/src/choreo/channels/aura.ts packages/ui/src/choreo/channels/aura.test.ts packages/ui/src/choreo/choreoConfig.ts packages/ui/src/choreo/choreoConfig.test.ts packages/ui/src/PacingTuner.tsx packages/ui/src/useCombatReplay.ts
git commit -m "feat(ui): runner schedules cues at anchor+offset; aura delays retire into cue offsets"
```

---

### Task 3: Offset on the engine's contact/landed cues

**Why:** The `impact` cue's offset should shift the smack relative to `contact` (incl. negative — fire before connection, the smack-lead). The engine fires contact/landed from GSAP timeline positions; add the offset there.

**Files:**
- Modify: `packages/ui/src/choreo/engine.ts`
- Modify: `packages/ui/src/choreo/engine.test.ts`

- [ ] **Step 1: Add a test** to `engine.test.ts` — the impact cue's offset shifts when `onContact` fires. Since the timeline is seekable, assert the impact fires and (with a small positive offset) that `advance` still fires at completion:

```ts
  it('applies the impact cue offset to the contact fire position', () => {
    // give attackExchange's impact cue a +40ms offset via the score, then seek — impact + advance still fire once
    const sc = SCORE.attackExchange.find((c) => c.ch === 'impact')!;
    const prev = sc.offset; sc.offset = 40; // mutate the in-memory default for the test
    try {
      const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
      const advance = vi.fn();
      const tl = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 10, 0, { combatSpeed: 1, advance });
      tl!.progress(1);
      expect(hit).toHaveBeenCalledTimes(1);
      expect(advance).toHaveBeenCalledTimes(1);
    } finally { sc.offset = prev; }
  });
```
(Import `SCORE` + `sfx` in the test if not already. The point is the offset is READ and applied without breaking the fire-once contract; exact sub-second timing on a stub isn't asserted.)

- [ ] **Step 2: Run — FAIL / verify** the current code ignores the offset (the test may pass trivially since it only checks fire-once; if so, it still guards the wiring — proceed to implement the offset read).

- [ ] **Step 3: Implement** in `runAttackExchangeCues`: read the impact cue's offset and add it to the contact position. `playLunge`'s `onContact` fires at the contact GSAP position; to offset it, wrap the impact dispatch in a nested delay off the contact time:

```ts
export function runAttackExchangeCues(moment: Moment, attacker: Element, defender: Element | null, dx: number, dy: number, ctx: AttackCueCtx) {
  if (moment.primary.type !== 'attack') return null;
  const cues = SCORE[moment.kind];
  if (!cues.some((c) => c.ch === 'lunge' && c.enabled !== false)) return null;
  const impact = cues.find((c) => c.ch === 'impact' && c.at === 'contact' && c.enabled !== false);
  const power = hitPower(moment.primary.swing);
  return playLunge({
    attacker, dx, dy, speed: ctx.combatSpeed,
    onContact: () => {
      if (impact) {
        const off = (impact.offset ?? 0) / 1000 / (impact.scaled === false ? 1 : (ctx.combatSpeed > 0 ? ctx.combatSpeed : 1));
        const fire = () => playContactImpact(defender, dx, dy, power, ctx.combatSpeed);
        if (off > 0) gsap.delayedCall(off, fire); else fire(); // negative/0 → at contact (GSAP can't pre-date a fired callback)
      }
      ctx.advance();
    },
  });
}
```
NOTE on negative offsets: `onContact` already fires at the lunge's smack-lead position (the cue's `at:'contact'` is the connect point). A negative impact offset to fire *before* that would require moving the `.add(onContact, position)` in `playLunge` earlier — defer true-negative impact to when `playLunge` exposes the contact position as a tunable (a follow-up); for THIS task, clamp the impact offset to ≥ 0 at the engine (positive delays the smack after connection, 0 = today). Document this limitation in the code comment. (Negative offsets on `start` cues are already clamped in the runner; negative on `landed`/`contact` is the one place needing `playLunge` support — a noted follow-up, not this slice.)

- [ ] **Step 4: Run** `npx vitest run packages/ui/src/choreo/engine.test.ts` + the choreo tree → green. typecheck/lint clean.

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/engine.ts packages/ui/src/choreo/engine.test.ts
git commit -m "feat(ui): engine applies the impact cue's (≥0) offset to the contact fire position"
```

---

### Task 4: The editable Score store (defaults + localStorage overrides)

**Why:** The panel edits the score live. `SCORE` becomes `SCORE_DEFAULTS`; a sparse override layer (localStorage `ascent.choreoScore`) merges over it; `runMomentCues`/engine read `getScore()` so edits apply next moment.

**Files:**
- Modify: `packages/ui/src/choreo/score.ts`
- Modify: `packages/ui/src/choreo/score.test.ts`

- [ ] **Step 1: Add tests** to `score.test.ts`:

```ts
  it('getScore returns defaults when there are no overrides', () => {
    resetScore();
    expect(getScore().death.map((c) => c.ch)).toEqual(SCORE_DEFAULTS.death.map((c) => c.ch));
  });
  it('setCue overrides one cue field and persists; resetScore clears it', () => {
    resetScore();
    setCue('shieldPop', 'auraBreak', { offset: 120 });
    expect(getCues('shieldPop').find((c) => c.ch === 'auraBreak')!.offset).toBe(120);
    resetScore();
    expect(getCues('shieldPop').find((c) => c.ch === 'auraBreak')!.offset).toBe(300);
  });
  it('scoreJson round-trips to an identical effective table', () => {
    resetScore();
    setCue('death', 'auraBurst', { offset: 50 });
    const json = scoreJson();
    expect(JSON.parse(json).death.find((c: {ch:string;offset:number}) => c.ch === 'auraBurst').offset).toBe(50);
  });
```
(`setCue(kind, channel, patch)` keys the cue by its CHANNEL within the kind — every kind has at most one cue per channel today, which keeps addressing simple. If a kind ever needs two cues of one channel, the plan revisits; not in this slice.)

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** in `score.ts` — rename `SCORE` → `SCORE_DEFAULTS`, add the override store mirroring `choreoConfig`'s pattern (localStorage, in-memory, getter/setters), and point `runMomentCues` (+ export a `getScore` the engine uses) at `getScore()`:

```ts
export const SCORE_DEFAULTS: Record<MomentKind, Cue[]> = { /* … the table from Task 1 … */ };

const KEY = 'ascent.choreoScore';
/** Sparse overrides: kind → channel → partial cue patch. */
type Overrides = Partial<Record<MomentKind, Partial<Record<Channel, Partial<Cue>>>>>;
let overrides: Overrides = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Overrides; } catch { return {}; }
})();

/** The effective score: defaults with per-cue overrides merged in (matched by channel within a kind). */
export function getScore(): Record<MomentKind, Cue[]> {
  const out = {} as Record<MomentKind, Cue[]>;
  for (const kind of Object.keys(SCORE_DEFAULTS) as MomentKind[]) {
    const ov = overrides[kind];
    out[kind] = SCORE_DEFAULTS[kind].map((c) => (ov?.[c.ch] ? { ...c, ...ov[c.ch] } : c));
  }
  return out;
}
export function getCues(kind: MomentKind): Cue[] { return getScore()[kind]; }
export function setCue(kind: MomentKind, ch: Channel, patch: Partial<Cue>): void {
  overrides = { ...overrides, [kind]: { ...overrides[kind], [ch]: { ...overrides[kind]?.[ch], ...patch } } };
  try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch { /* ignore */ }
}
export function resetScore(): void {
  overrides = {};
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export function scoreJson(): string { return JSON.stringify(getScore(), null, 2); }
```
Change `runMomentCues` to read `getScore()[moment.kind]` instead of `SCORE[moment.kind]`. Update `engine.ts` to `import { getScore }` and read `getScore()[moment.kind]` (replace the two `SCORE[moment.kind]`/`cues` reads). Keep `SCORE_DEFAULTS` exported for tests. (Grep for other `SCORE` importers — `engine.ts` is the only non-test one; update it.)

- [ ] **Step 4: Run** the choreo tree + full gate: `npm run typecheck && npm run lint && npm test && npm run build:web` → green. typecheck:web at baseline. Equivalence holds (no overrides → defaults → today's timing).

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts packages/ui/src/choreo/engine.ts
git commit -m "feat(ui): editable Score store (SCORE_DEFAULTS + localStorage overrides, getScore/setCue/resetScore)"
```

---

### Task 5: Infra docs checkpoint

**Files:** `docs/devlog.md`, `docs/roadmap.md`.

- [ ] **Step 1:** Prepend a devlog entry: the choreographer's Score is now offset-scheduled + live-editable data (the aura channel split into three cues, delays retired into offsets, byte-identical by the equivalence tests); the visible panel + preview are the next tasks. Roadmap: note Phase 4 slice 1 (Choreography panel) is in progress — infra landed, UI + preview next.
- [ ] **Step 2:** Full suite green. Commit: `docs: devlog/roadmap for the choreography-panel infra`.

---

## Layer B — The panel UI

### Task 6: The `choreoTimeline` pure helpers (px↔ms + anchor layout)

**Why:** Keep the timeline's math in pure, unit-tested functions so the React widget stays thin (per the spec's risk mitigation).

**Files:**
- Create: `packages/ui/src/choreo/timelineMath.ts`
- Test: `packages/ui/src/choreo/timelineMath.test.ts`

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, expect, it } from 'vitest';
import { msToPx, pxToMs, clampOffset } from './timelineMath';

describe('timelineMath', () => {
  it('msToPx / pxToMs invert over a track window', () => {
    const w = { widthPx: 600, maxMs: 300 };            // 2px per ms
    expect(msToPx(150, w)).toBe(300);
    expect(pxToMs(300, w)).toBe(150);
  });
  it('clampOffset: start anchors clamp ≥ 0; contact/landed allow negative', () => {
    expect(clampOffset(-50, 'start')).toBe(0);
    expect(clampOffset(-50, 'contact')).toBe(-50);
    expect(clampOffset(80, 'start')).toBe(80);
  });
});
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `timelineMath.ts`:**

```ts
import type { Anchor } from './score';

export interface TrackWindow { widthPx: number; maxMs: number; }

/** Map a ms value to an x position within the track. */
export const msToPx = (ms: number, w: TrackWindow): number => (ms / w.maxMs) * w.widthPx;
/** Map an x position back to ms (rounded to the nearest ms). */
export const pxToMs = (px: number, w: TrackWindow): number => Math.round((px / w.widthPx) * w.maxMs);
/** Clamp an offset for its anchor: `start` can't fire before the moment begins (≥ 0); timeline anchors
 *  (`contact`/`landed`) may be negative (fire before the anchor). */
export const clampOffset = (offset: number, at: Anchor): number => (at === 'start' ? Math.max(0, offset) : offset);
```

- [ ] **Step 4: Run** → green. **Step 5: Commit** `feat(ui): choreo timeline px↔ms + clamp helpers`.

---

### Task 7: The `ChoreographyPanel` shell (rail + numeric editor + tempo + Copy/Reset)

**Why:** The functional panel — everything editable via numbers first (the spec's "numbers up front"); the drag timeline layers on in Task 8. Follows the `PacingTuner`/`useDraggablePanel`/DevMenu convention exactly.

**Files:**
- Create: `packages/ui/src/ChoregraphyPanel.tsx` → **use exact name** `ChoreographyPanel.tsx`
- Modify: `packages/ui/src/DevMenu.tsx`
- Modify: `packages/ui/src/styles.css` (panel styles — follow the `.sfxmix`/`.pacing` patterns)

- [ ] **Step 1: Implement `ChoreographyPanel.tsx`.** A dev panel: left a moment-kind list, right the selected kind's cues as rows (channel label · anchor `<select>` · offset `<input type=number>` · scaled toggle · on/off toggle), plus the kind's hold (`choreoConfig`) and global tempo, and Copy/Reset. Reads `getScore()`/`choreoConfig`, writes `setCue`/`setChoreoValue`, mirrors to local state for re-render:

```tsx
import { useState } from 'react';
import type { MomentKind } from './choreo/kinds';
import type { Channel, Cue } from './choreo/score';
import { getScore, setCue, resetScore, scoreJson } from './choreo/score';
import { getChoreoConfig, setChoreoValue, resetChoreoConfig, type ChoreoConfig } from './choreo/choreoConfig';
import { useDraggablePanel } from './useDraggablePanel';

const KINDS: MomentKind[] = Object.keys(getScore()) as MomentKind[];
/** Which choreoConfig hold key a kind's linger maps to (mirrors choreoConfig's KIND_TO_KEY for the UI). */
const HOLD_KEY: Partial<Record<MomentKind, keyof ChoreoConfig>> = {
  damage: 'dmg', shieldPop: 'shield', poisonTick: 'poison', death: 'death', riseDeath: 'death',
  scCast: 'sc', summon: 'summon', buffWave: 'buff', reborn: 'reborn', ascend: 'improve', rally: 'rally',
  toHand: 'toHand', maxGold: 'maxGold', improve: 'improve', hpGrant: 'hpGrant',
};

export function ChoreographyPanel() {
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('choreo');
  const [kind, setKind] = useState<MomentKind>('attackExchange');
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const cfg = getChoreoConfig();
  const cues = getScore()[kind];
  const patch = (ch: Channel, p: Partial<Cue>) => { setCue(kind, ch, p); refresh(); };
  const holdKey = HOLD_KEY[kind];

  return (
    <div className="sfxmix choreo" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>🎬 Choreography <span>dev · next moment · drag</span></div>
      <div className="choreo-top">
        <label>tempo <input type="range" min={0.5} max={3} step={0.05} value={cfg.speed} onChange={(e) => { setChoreoValue('speed', Number(e.target.value)); refresh(); }} /> {cfg.speed.toFixed(2)}×</label>
        <button className="sfxmix-copy" onClick={() => void navigator.clipboard?.writeText(scoreJson())}>Copy score</button>
        <button className="sfxmix-copy" onClick={() => { resetScore(); resetChoreoConfig(); refresh(); }}>Reset</button>
      </div>
      <div className="choreo-body">
        <div className="choreo-rail">
          {KINDS.map((k) => <button key={k} className={`choreo-m${k === kind ? ' on' : ''}`} onClick={() => setKind(k)}>{k}</button>)}
        </div>
        <div className="choreo-edit">
          {holdKey && <div className="choreo-hold">hold <input type="range" min={0} max={1200} step={10} value={cfg[holdKey]} onChange={(e) => { setChoreoValue(holdKey, Number(e.target.value)); refresh(); }} /> {cfg[holdKey]}ms</div>}
          {cues.map((c) => (
            <div className={`choreo-cue${c.enabled === false ? ' off' : ''}`} key={c.ch}>
              <span className="choreo-ch">{c.ch}</span>
              <select value={c.at} onChange={(e) => patch(c.ch, { at: e.target.value as Cue['at'] })}>
                {(['start', 'contact', 'landed'] as const).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <input type="number" step={10} value={c.offset ?? 0} onChange={(e) => patch(c.ch, { offset: Number(e.target.value) })} /> ms
              <label title="scales with combat speed"><input type="checkbox" checked={c.scaled !== false} onChange={(e) => patch(c.ch, { scaled: e.target.checked })} />×spd</label>
              <label title="enabled"><input type="checkbox" checked={c.enabled !== false} onChange={(e) => patch(c.ch, { enabled: e.target.checked })} />on</label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register in `DevMenu.tsx`.** Import `ChoreographyPanel`; add `{ key: 'choreo', label: '🎬 Choreography', C: ChoreographyPanel }` to `TUNERS` (near `pacing`).

- [ ] **Step 3: Add styles** to `styles.css` — reuse the `.sfxmix` panel base; add `.choreo-top`/`.choreo-body`/`.choreo-rail`/`.choreo-m`/`.choreo-edit`/`.choreo-cue`/`.choreo-hold` (a two-column body: a scrollable rail + the editor; rows are flex; `.choreo-m.on`/`.choreo-cue.off` accents). Match the dark dev-panel look of `.sfxmix`.

- [ ] **Step 4: Verify.** `npm run typecheck && npm run lint && npm run build:web` green. Live: `preview_start` "web-verify"; open the DevMenu (🛠️) → toggle 🎬 Choreography; confirm the panel renders, selecting a kind shows its cues, editing an offset persists (reload → value kept), Reset restores. Report.

- [ ] **Step 5: Commit** `feat(ui): Choreography panel shell — moment rail + per-cue numeric editor + tempo/Copy/Reset`.

---

### Task 8: The `Timeline` drag widget

**Why:** The headline feature — drag a cue chip on a time track to retime/reorder, layered on the numeric editor (both edit the same `offset`).

**Files:**
- Create: `packages/ui/src/ChoreoTimeline.tsx`
- Modify: `packages/ui/src/ChoreographyPanel.tsx` (embed the timeline above the numeric rows)
- Modify: `packages/ui/src/styles.css` (track + chip styles)

- [ ] **Step 1: Implement `ChoreoTimeline.tsx`** — given the selected kind's cues, render a track with anchor gridlines (start at 0; contact/landed at the lunge/pull-back times from `getLungeConfig()` for kinds whose cues use them) and one draggable chip per cue at `anchorTime + offset` (via `msToPx`). Pointer-drag updates the cue's offset (`pxToMs` + `clampOffset`, calling `setCue`). Props: `{ kind, onChange }`. Use the `timelineMath` helpers + a pointer handler like `useDraggablePanel`'s. Anchor times: `start`=0; `contact`=`(windupDur+strikeDur)*1000`; `landed`=`(0.1+0.24)*1000` (from lungeConfig / runRiseReturn). Track `maxMs` = max(hold, largest chip time) + headroom.

```tsx
import { useRef } from 'react';
import type { MomentKind } from './choreo/kinds';
import type { Anchor } from './choreo/score';
import { getScore, setCue } from './choreo/score';
import { getLungeConfig } from './lungeConfig';
import { msToPx, pxToMs, clampOffset, type TrackWindow } from './choreo/timelineMath';

const anchorMs = (at: Anchor): number => {
  const c = getLungeConfig();
  if (at === 'contact') return (c.windupDur + c.strikeDur) * 1000;
  if (at === 'landed') return (0.1 + 0.24) * 1000; // runRiseReturn delay+duration
  return 0;
};

export function ChoreoTimeline({ kind, onChange }: { kind: MomentKind; onChange: () => void }) {
  const cues = getScore()[kind];
  const trackRef = useRef<HTMLDivElement | null>(null);
  const times = cues.map((c) => anchorMs(c.at) + (c.offset ?? 0));
  const maxMs = Math.max(300, ...times.map((t) => t + 60));
  const win: TrackWindow = { widthPx: 100, maxMs }; // widthPx overwritten from the live element on drag

  const drag = (ch: string, at: Anchor) => (e: React.PointerEvent) => {
    const track = trackRef.current; if (!track) return;
    const w: TrackWindow = { widthPx: track.clientWidth, maxMs };
    const startX = e.clientX; const startMs = anchorMs(at);
    const cue = cues.find((c) => c.ch === ch)!; const startOff = cue.offset ?? 0;
    const move = (ev: PointerEvent) => {
      const dpx = ev.clientX - startX;
      const off = clampOffset(pxToMs(msToPx(startMs + startOff, w) + dpx, w) - startMs, at);
      setCue(kind, ch as never, { offset: off }); onChange();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); e.preventDefault();
  };

  return (
    <div className="choreo-track" ref={trackRef}>
      {(['start', 'contact', 'landed'] as Anchor[]).filter((a) => cues.some((c) => c.at === a)).map((a) => (
        <div className="choreo-anchor" key={a} style={{ left: `${(anchorMs(a) / maxMs) * 100}%` }}><b>{a}</b></div>
      ))}
      {cues.map((c) => (
        <div key={c.ch} className={`choreo-chip${c.enabled === false ? ' off' : ''}`}
             style={{ left: `${((anchorMs(c.at) + (c.offset ?? 0)) / maxMs) * 100}%` }}
             onPointerDown={drag(c.ch, c.at)}>{c.ch}</div>
      ))}
    </div>
  );
  void win;
}
```

- [ ] **Step 2: Embed** in `ChoreographyPanel.tsx` — render `<ChoreoTimeline kind={kind} onChange={refresh} />` above the numeric cue rows.

- [ ] **Step 3: Styles** — `.choreo-track` (relative, a height, a ruled background), `.choreo-anchor` (absolute dashed vertical line + label), `.choreo-chip` (absolute, `translateX(-50%)`, grab cursor, per-channel tint, `.off` dimmed).

- [ ] **Step 4: Verify.** typecheck/lint/build green. Live (web-verify): open 🎬, drag a chip → the numeric offset updates in lockstep and persists; anchors render for attackExchange (start+contact); Reset restores. Report + a screenshot.

- [ ] **Step 5: Commit** `feat(ui): Choreography timeline — drag cue chips to retime/reorder`.

---

### Task 9: Retire the Pacing tuner

**Files:** `packages/ui/src/DevMenu.tsx`, delete `packages/ui/src/PacingTuner.tsx`.

- [ ] **Step 1:** Remove the `PacingTuner` import + its `{ key:'pacing', … }` TUNERS entry from `DevMenu.tsx`. Delete `PacingTuner.tsx`. (Its holds/tempo now live in the Choreography panel; `choreoConfig` stays.) Grep to confirm no other `PacingTuner` reference.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm run build:web` green. **Step 3: Commit** `chore(ui): retire the Pacing tuner into the Choreography panel`.

---

## Layer C — Preview

### Task 10: The mock-stage ▶ Preview

**Why:** Fire the selected moment's FX-channel cues against two dummy unit cards, so you see a lunge/impact/aura play on demand (the highest testing-value feature). Built last, cuttable.

**Files:**
- Create: `packages/ui/src/ChoreoPreviewStage.tsx`
- Modify: `packages/ui/src/ChoreographyPanel.tsx` (a ▶ Preview button + the stage)

- [ ] **Step 1: Implement `ChoreoPreviewStage.tsx`** — renders two small mock `.unit` cards (attacker `data-uid="pv-atk"`, target `data-uid="pv-def"`) inside the panel, and exposes a `preview(kind)` that fires the kind's FX cues against them:
  - `sfx`: `playMomentSfx` won't have events — instead call the relevant `sfx.*` directly for the kind (e.g. `sfx.attack()`), OR skip sfx-from-events and just fire the channel FX (sfx rides along in the real channels below).
  - `attackExchange`: `runAttackExchangeCues(mockMoment, atkEl, defEl, dx, dy, { combatSpeed, advance: ()=>{} })` — the real lunge + impact against the mock cards.
  - `death`/`riseDeath`: register a reborn/DS bubble on the target (`pixiFx.setShield('pv-def', …, 'reborn')`), then `burstDeathAuras('pv-def', rect)`.
  - `shieldPop`: `pixiFx.setShield('pv-def', …, 'shield')` then `breakShieldAura('pv-def')`.
  - `reborn`: `reformReborn(rectOfDef)`.
  Measure the mock cards' rects for coords; use a fixed dx/dy for the lunge. Keep it a best-effort demo — floats/CSS-anims are not reproduced (documented).

- [ ] **Step 2: Wire ▶** in `ChoreographyPanel.tsx` — a "▶ Preview" button calls `stage.preview(kind)`; render `<ChoreoPreviewStage />` (the mock cards live in a small bordered area of the panel).

- [ ] **Step 3: Verify (the payoff).** Live (web-verify, focused): open 🎬, select **Shield Pop**, ▶ → the gold shield shatters on the mock card; select **Death** with a reborn bubble → the blue spirit bursts; select **Attack Exchange** → the mock attacker lunges + the impact flashes. Zero console errors. Screenshot. This is the test I couldn't do in 3c without grinding a fight — confirm it works.

- [ ] **Step 4: Commit** `feat(ui): Choreography panel ▶ preview — fire a moment's FX on a mock stage`.

---

### Task 11: Docs + PR

**Files:** `docs/devlog.md`, `docs/roadmap.md`, `README.md`.

- [ ] **Step 1:** Devlog: the full Choreography panel — offset-scheduled editable Score, the timeline drag editor + numeric inputs, tempo/hold/Copy/Reset, the mock-stage preview; Pacing tuner retired; all invisible-by-default (equivalence tests). Roadmap: mark Phase 4 slice 1 ✅; the next slices (staggers, grouping rules, resolution-order tool) remain queued. README bullet.
- [ ] **Step 2:** Full suite green (report counts). Owner feel-pass: drive a real fight, confirm timing unchanged with defaults; then dial an offset in the panel and watch it change.
- [ ] **Step 3:** Commit docs; push; open the PR (`"/c/Program Files/GitHub CLI/gh.exe" pr create --base main …`, 🤖 footer). **WAIT for CI** (Node-20 + navigator polyfill already on main); report green or the failure. Do NOT merge — owner merges after the feel-pass.

---

## Self-review

- **Spec coverage:** unified cue model (offset/scaled/enabled) ✓ (Task 1); offset-aware scheduling in runner ✓ (Task 2) + engine ✓ (Task 3), negatives clamped per-anchor (start ≥0 runner; contact ≥0 with the noted `playLunge` follow-up for true-negative) ✓; aura delays → cue offsets ✓ (Tasks 1–2); editable Score store ✓ (Task 4); the timeline widget + numeric inputs together ✓ (Tasks 7–8); per-moment hold + global tempo ✓ (Task 7); Copy/Reset ✓; dev-only/live ✓; Pacing tuner retired ✓ (Task 9); mock-stage real-FX preview ✓ (Task 10, cuttable). Deferred per spec: staggers, add/remove channels, grouping, resolution-order — untouched.
- **Equivalence gate:** Tasks 1–4 each keep the default score byte-identical (the migrated 300/460 offsets reproduce the retired channel delays; scaled/unscaled preserved), verified by the score/aura tests + the full suite + typecheck:web baseline at each infra commit.
- **Type consistency:** `Cue { ch, at, offset?, scaled?, enabled? }` (Task 1) threaded through `runMomentCues` (Task 2) / `engine.ts` (Task 3) / the store `getScore`/`setCue`/`resetScore`/`scoreJson` (Task 4) / the panel + timeline (Tasks 7–8, addressing cues by `ch`). `CueContext.combatSpeed` added (Task 2) and passed from useCombatReplay. `timelineMath` (`msToPx`/`pxToMs`/`clampOffset`, `TrackWindow`) (Task 6) consumed by `ChoreoTimeline` (Task 8).
- **Risk:** the aura-channel split + delay migration (Tasks 1–2) is the one behavioral-risk area (touches the 3c work + the hot cue effect) — gated by the aura/score equivalence tests + the full suite + a feel-pass; the impact-offset true-negative is explicitly deferred with a code note rather than half-built; the timeline drag math is isolated in tested pure helpers so the React layer is thin and the numeric inputs are always a working fallback.
- **Placeholder scan:** every code step is complete; the one "adapt `baseCtx`/`moment` to the file's helpers" note refers to the existing test helpers (real, in `score.test.ts`), not a placeholder; CSS steps name the exact classes to add.
