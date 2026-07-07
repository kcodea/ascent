# Combat Choreographer — Phase 2: Clock + MomentKind + Config Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the combat-replay beat scheduler into a pure, tested `ReplayClock`, classify each moment with a `MomentKind`, and migrate `pacingConfig` into a `choreoConfig` store — all with byte-identical on-screen behavior.

**Architecture:** `compileMoments` gains a `kind` field per moment (additive; consumed by the phase-3 score, not by the clock yet). `pacingConfig.ts` is relocated to `choreo/choreoConfig.ts` (same keys/defaults + a moment-facing accessor); the two consumers re-point; `pacingConfig.ts` is deleted. A pure `choreo/clock.ts` encapsulates today's exact hold formula (per-primary-type delay × tempo, attack-wind-up lunge weld, attackGap breather, ÷combatSpeed); `useCombatReplay`'s scheduler effect calls it. Nothing visible changes.

**Tech Stack:** TypeScript monorepo; Vitest; GSAP (untouched here); the equivalence + determinism suites plus new clock unit tests are the safety net.

**Spec:** `docs/superpowers/specs/2026-07-06-combat-choreographer-design.md` (Phase 2). **Scope ruling (owner, 2026-07-06):** clock + kinds + config only — the per-moment GSAP cue-timeline mechanism is deferred to Phase 3. Direct swap (no feature flag); equivalence guarded by tests + live checks.
**Branch:** `feat/choreographer-phase2` (already created).

**Key invariant:** the clock keys holds by `moment.primary.type` (exactly as today's `beatDelay(beat.primary.type)`), NOT by `MomentKind` — collapsing e.g. a poison-led impact (500ms) and a dmg-led impact (460ms) into one kind-hold would change timings and break "no visible change." Rekeying holds to `MomentKind` is a Phase 4 concern (when the Choreography panel authors per-kind). `MomentKind` here is additive metadata only.

---

### Task 1: `MomentKind` + classifier

**Files:**
- Create: `packages/ui/src/choreo/kinds.ts`
- Modify: `packages/ui/src/choreo/compile.ts` (import + set `kind` on each Moment)
- Test: `packages/ui/src/choreo/kinds.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/kinds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeRng, simulate, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { momentKind } from './kinds';

describe('momentKind', () => {
  it('classifies the primary event types we author against', () => {
    const cases: [CombatEvent, string][] = [
      [{ type: 'attack', attacker: 'a', defender: 'b', swing: 0 }, 'attackExchange'],
      [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 1 }, 'impact'],
      [{ type: 'shield', target: 'b' }, 'impact'],
      [{ type: 'poison', target: 'b' }, 'impact'],
      [{ type: 'death', target: 'b', side: 'enemy' }, 'death'],
      [{ type: 'death', target: 'b', side: 'enemy', rise: true }, 'riseDeath'],
      [{ type: 'sc', source: 'a', text: 'x' }, 'scCast'],
      [{ type: 'summon', minion: { uid: 't', cardId: 'pup', name: 'Pup', tribe: 'beast', attack: 1, health: 1, keywords: [] }, side: 'player', index: 0 }, 'summon'],
      [{ type: 'buff', target: 'b', attack: 1, health: 1, source: 'x' }, 'buffWave'],
      [{ type: 'reborn', target: 'b', hp: 1, attack: 2, keywords: [] }, 'reborn'],
      [{ type: 'ascend', target: 'b', into: 'y' }, 'ascend'],
      [{ type: 'rally', source: 'a', target: 'b' }, 'rally'],
      [{ type: 'toHand', cardId: 'z', side: 'player' }, 'toHand'],
      [{ type: 'maxGold', target: 'b', side: 'player', amount: 1 }, 'maxGold'],
      [{ type: 'improve', target: 'b', amount: 1 }, 'improve'],
      [{ type: 'keyword', target: 'b', keyword: 'R' }, 'keyword'],
      [{ type: 'hpGrant', target: 'b', amount: 1 }, 'hpGrant'],
      [{ type: 'reveal', target: 'b' }, 'reveal'],
      [{ type: 'venomLost', target: 'b' }, 'impact'],
      [{ type: 'shieldUp', target: 'b' }, 'impact'],
    ];
    for (const [primary, kind] of cases) {
      expect(momentKind(primary)).toBe(kind);
    }
  });

  it('every compiled moment from a real fight has a kind', () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }],
      [{ cardId: 'pack', attack: 2, health: 2 }], makeRng(3), CARD_INDEX,
    );
    const moments = compileMoments(r.events);
    for (const m of moments) expect(typeof m.kind).toBe('string');
    // a Deathrattle fight produces at least an attackExchange, an impact/death, and a summon
    const kinds = new Set(moments.map((m) => m.kind));
    expect(kinds.has('attackExchange')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — FAIL** (`./kinds` missing; `m.kind` missing).
Run: `npx vitest run packages/ui/src/choreo/kinds.test.ts`

- [ ] **Step 3: Implement `packages/ui/src/choreo/kinds.ts`:**

```ts
import type { CombatEvent } from '@game/core';

/**
 * Presentation KIND of a moment (choreographer phase 2) — a coarser label than the raw event type, keyed to
 * how the moment is authored/scored (see docs/combat-events.md + the spec's Score section). Derived from the
 * moment's PRIMARY (first) event. Purely additive metadata in phase 2: the clock still keys hold TIMES by the
 * primary event type for exact-reproduction; kinds become the hold key + score key in phases 3–4.
 */
export type MomentKind =
  | 'attackExchange' // an attack wind-up (+ its absorbed on-attack flashes)
  | 'impact'         // a result run: dmg / shield / shieldUp / poison / venomLost
  | 'death'          // a death (true kill) leading its run
  | 'riseDeath'      // a Rise's death (body returns) leading its run
  | 'scCast'         // a Start-of-Combat / narration cast
  | 'summon' | 'buffWave' | 'reborn' | 'ascend' | 'rally' | 'toHand' | 'maxGold' | 'improve'
  | 'keyword' | 'hpGrant' | 'reveal';

export function momentKind(primary: CombatEvent): MomentKind {
  switch (primary.type) {
    case 'attack': return 'attackExchange';
    case 'dmg': case 'shield': case 'shieldUp': case 'poison': case 'venomLost': return 'impact';
    case 'death': return primary.rise ? 'riseDeath' : 'death';
    case 'sc': return 'scCast';
    case 'summon': return 'summon';
    case 'buff': return 'buffWave';
    case 'reborn': return 'reborn';
    case 'ascend': return 'ascend';
    case 'rally': return 'rally';
    case 'toHand': return 'toHand';
    case 'maxGold': return 'maxGold';
    case 'improve': return 'improve';
    case 'keyword': return 'keyword';
    case 'hpGrant': return 'hpGrant';
    case 'reveal': return 'reveal';
  }
}
```
(The switch is exhaustive over the 19 event types — TS will error if one is missing, which is the point. If tsc reports a missing case, add it; do not add a `default`.)

- [ ] **Step 4: Set `kind` on each Moment in `compile.ts`.** In `packages/ui/src/choreo/compile.ts`: add `import { momentKind, type MomentKind } from './kinds';`, add `kind: MomentKind;` to the `Moment` interface (with a one-line doc), and in `compileMoments`' `moments.push({...})` add `kind: momentKind(events[start]!)`. The equivalence tests compare only `{start,end,primary}` so they still pass (additive field).

- [ ] **Step 5: Run** `npx vitest run packages/ui/src/choreo` → all pass (kinds + the phase-1 compile suite). Then `npm run typecheck && npm run lint` clean; `(npm run typecheck:web 2>&1 | Select-String 'error TS').Count` = 21.

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/choreo/kinds.ts packages/ui/src/choreo/kinds.test.ts packages/ui/src/choreo/compile.ts
git commit -m "feat(ui): MomentKind classifier + kind on each compiled moment (additive)"
```

---

### Task 2: Migrate `pacingConfig` → `choreo/choreoConfig.ts`

**Files:**
- Create: `packages/ui/src/choreo/choreoConfig.ts` (relocated pacingConfig + moment accessor)
- Delete: `packages/ui/src/pacingConfig.ts`
- Modify: `packages/ui/src/PacingTuner.tsx` (re-point imports; deprecate note)
- Modify: `packages/ui/src/useCombatReplay.ts` (re-point imports — the clock swap is Task 4; here just keep it compiling by pointing the existing calls at choreoConfig)
- Test: `packages/ui/src/choreo/choreoConfig.test.ts`

- [ ] **Step 1: Read `packages/ui/src/pacingConfig.ts` in full** (it is the source of truth for the relocation — same interface `PacingConfig`, same `DEFAULTS`, `PACING_RANGES`, `PACING_KEYS`, `getPacingConfig`, `beatDelay`, `setPacingValue`, `resetPacingConfig`, localStorage key `ascent.pacing`).

- [ ] **Step 2: Write the failing test** — `packages/ui/src/choreo/choreoConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getChoreoConfig, beatDelay, holdMsForKind, CHOREO_KEYS } from './choreoConfig';

describe('choreoConfig', () => {
  it('preserves the shipped pacing defaults (migration is value-identical)', () => {
    const c = getChoreoConfig();
    expect(c.speed).toBe(1.5);
    expect(c.dmg).toBe(460);
    expect(c.death).toBe(400);
    expect(c.sc).toBe(720);
    expect(c.floatMs).toBe(1500);
    expect(c.deathFloatMs).toBe(1000);
    expect(c.finalHold).toBe(900);
  });
  it('beatDelay falls back to 300 for an unlisted type (matches the former pacing behavior)', () => {
    expect(beatDelay('dmg')).toBe(460);
    expect(beatDelay('nonsense')).toBe(300);
  });
  it('holdMsForKind maps a moment kind to the pre-scale hold it should reproduce', () => {
    // phase-2 exact-reproduction: kind holds mirror the representative pacing key
    expect(holdMsForKind('impact')).toBe(beatDelay('dmg'));   // impact runs are dmg-led by default
    expect(holdMsForKind('death')).toBe(beatDelay('death'));
    expect(holdMsForKind('scCast')).toBe(beatDelay('sc'));
  });
  it('CHOREO_KEYS still enumerates every tunable field (Pacing tuner contract)', () => {
    expect(CHOREO_KEYS).toContain('speed');
    expect(CHOREO_KEYS).toContain('finalHold');
  });
});
```

- [ ] **Step 3: Create `packages/ui/src/choreo/choreoConfig.ts`** — copy `pacingConfig.ts` verbatim, then: rename the exports `PacingConfig→ChoreoConfig`, `getPacingConfig→getChoreoConfig`, `setPacingValue→setChoreoValue`, `resetPacingConfig→resetChoreoConfig`, `PACING_RANGES→CHOREO_RANGES`, `PACING_KEYS→CHOREO_KEYS` (keep `beatDelay` name — the clock + shim call it). KEEP the localStorage key `'ascent.pacing'` (so a dev's saved pacing values survive the rename). Update the module doc to say it's the choreographer's timing store (superseding pacingConfig). Then ADD the moment accessor:

```ts
import type { MomentKind } from './kinds';

/** The pre-scale hold (ms) a moment KIND should reproduce — phase 2 mirrors the representative pacing key so
 *  on-screen timing is byte-identical (the clock actually keys by primary event type; this is the kind-facing
 *  view the score will use from phase 4). Impact/death/rise map to their dominant result key. */
const KIND_TO_KEY: Record<MomentKind, string> = {
  attackExchange: 'attack', impact: 'dmg', death: 'death', riseDeath: 'death', scCast: 'sc',
  summon: 'summon', buffWave: 'buff', reborn: 'reborn', ascend: 'improve', rally: 'rally',
  toHand: 'toHand', maxGold: 'maxGold', improve: 'improve', keyword: 'buff', hpGrant: 'hpGrant', reveal: 'reveal',
};
export function holdMsForKind(kind: MomentKind): number {
  return beatDelay(KIND_TO_KEY[kind]);
}
```
(NOTE `ascend`/`keyword` have no own pacing key today — they fell through `beatDelay`'s 300 default. Map them to a sensible existing key so the value is intentional: `ascend→improve` 520, `keyword→buff` 420. Since the CLOCK keys by primary.type in phase 2, `holdMsForKind` is not yet on the hot path — it's validated by the test and used from phase 3+. If you prefer exactness, map `ascend`/`keyword` to a literal 300 to match today; either is acceptable — pick and note it.)

- [ ] **Step 4: Delete `packages/ui/src/pacingConfig.ts`** and re-point both consumers:
- `PacingTuner.tsx`: change the import to `./choreo/choreoConfig` with the renamed symbols (`CHOREO_KEYS, CHOREO_RANGES, getChoreoConfig, resetChoreoConfig, setChoreoValue, type ChoreoConfig`), rename the local uses, and prepend a deprecation line to its doc comment: "DEPRECATED (choreographer phase 4 replaces this with the 🎬 Choreography panel) — still functional; edits the choreo timing store." Keep the tuner rendering + behavior otherwise unchanged.
- `useCombatReplay.ts`: change `import { getPacingConfig, beatDelay } from './pacingConfig';` → `import { getChoreoConfig, beatDelay } from './choreo/choreoConfig';` and rename the three `getPacingConfig()` call sites (lines ~572, 596, 647, 652) to `getChoreoConfig()`. (The scheduler LOGIC stays as-is this task — Task 4 replaces it. This task is compile-clean re-pointing only.)

- [ ] **Step 5: Verify** `npx vitest run packages/ui/src/choreo/choreoConfig.test.ts` pass; `npm run typecheck && npm run lint && npm test` green; typecheck:web = 21; `grep -rn "pacingConfig" packages/ui/src` returns ZERO (except perhaps a devlog/comment reference — none should remain in code).

- [ ] **Step 6: Commit**
```bash
git add packages/ui/src/choreo/choreoConfig.ts packages/ui/src/choreo/choreoConfig.test.ts packages/ui/src/PacingTuner.tsx packages/ui/src/useCombatReplay.ts
git rm packages/ui/src/pacingConfig.ts
git commit -m "refactor(ui): migrate pacingConfig -> choreo/choreoConfig (+ kind hold accessor); tuner functional"
```

---

### Task 3: The `ReplayClock` — pure hold formula

**Files:**
- Create: `packages/ui/src/choreo/clock.ts`
- Test: `packages/ui/src/choreo/clock.test.ts`

The formula this encapsulates is EXACTLY today's scheduler (useCombatReplay ~line 570-587):
`hold = beatDelay(shownNext.primary.type) × speed`, EXCEPT: if the moment currently on screen is an `attack` wind-up → `hold = max(120, (windupDur+strikeDur−smackLead)×1000)`; else if the on-screen moment is a result run AND the next moment is an `attack` → add `attackGap×1000`. Then `hold /= combatSpeed`.

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Moment } from './compile';
import { holdMs } from './clock';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

const M = (type: string): Moment => ({ start: 0, end: 1, primary: { type } as any, stepGroups: [[0]], kind: 'impact' as any });

describe('holdMs — reproduces the legacy scheduler numbers', () => {
  it('a plain result moment: beatDelay(type) × speed ÷ combatSpeed', () => {
    const cfg = getChoreoConfig();
    const next = M('dmg');
    expect(holdMs(next, undefined, 1)).toBeCloseTo(beatDelay('dmg') * cfg.speed, 5);
    expect(holdMs(next, undefined, 2)).toBeCloseTo((beatDelay('dmg') * cfg.speed) / 2, 5);
  });
  it('when the ON-SCREEN moment is an attack wind-up, hold is the lunge connection time (not beatDelay)', () => {
    const c = getLungeConfig();
    const expected = Math.max(120, (c.windupDur + c.strikeDur - c.smackLead) * 1000);
    expect(holdMs(M('dmg'), M('attack'), 1)).toBeCloseTo(expected, 5);
  });
  it('a NEW attack following an on-screen impact adds the attackGap breather', () => {
    const cfg = getChoreoConfig();
    const c = getLungeConfig();
    const expected = beatDelay('attack') * cfg.speed + c.attackGap * 1000;
    expect(holdMs(M('attack'), M('dmg'), 1)).toBeCloseTo(expected, 5);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`./clock` missing).

- [ ] **Step 3: Implement `packages/ui/src/choreo/clock.ts`:**

```ts
import type { Moment } from './compile';
import { RESULT_TYPES } from '../combatBeats';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

/**
 * The replay clock (choreographer phase 2) — the pure hold formula that decides how long the moment currently
 * ON SCREEN (`shown`) lingers before `next` shows. Extracted verbatim from the former inline scheduler so the
 * pacing is byte-identical; unit-tested against the legacy numbers. Reads choreoConfig (tempo + per-type holds)
 * + lungeConfig (the attack wind-up is welded to the lunge connection so damage always lands ON contact).
 * `combatSpeed` is the player's in-combat multiplier — the lunge timeScale divides the same connection time,
 * so they stay in sync.
 */
export function holdMs(next: Moment, shown: Moment | undefined, combatSpeed: number): number {
  const cfg = getChoreoConfig();
  const c = getLungeConfig();
  let d = beatDelay(next.primary.type) * cfg.speed;
  if (shown?.primary.type === 'attack') {
    // hand off the wind-up the instant the lunge CONNECTS (windup+strike−smackLead, GSAP seconds), so the
    // damage moment lands right on contact — independent of tempo.
    d = Math.max(120, (c.windupDur + c.strikeDur - c.smackLead) * 1000);
  } else if (shown && RESULT_TYPES.has(shown.primary.type) && next.primary.type === 'attack') {
    d += c.attackGap * 1000; // a breather after an impact before the next swing
  }
  return d / (combatSpeed > 0 ? combatSpeed : 1);
}
```

- [ ] **Step 4: Run** `npx vitest run packages/ui/src/choreo/clock.test.ts` → pass; typecheck/lint clean.

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/choreo/clock.ts packages/ui/src/choreo/clock.test.ts
git commit -m "feat(ui): ReplayClock holdMs — pure hold formula, legacy-number-locked"
```

---

### Task 4: Swap the scheduler in `useCombatReplay` onto the clock

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (the scheduler effect ~line 569-590; imports)

- [ ] **Step 1: Swap.** Add `import { holdMs } from './choreo/clock';`. Replace the scheduler effect body's hold computation (the block from `const pc = getChoreoConfig();` through `d /= combatSpeed;`) with:
```ts
    const shown = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    const d = holdMs(beat, shown, combatSpeed);
```
Keep everything else in the effect (the `if (!active || hidden ...) return;`, `const beat = beats[beatIdx]!;`, the `setTimeout(() => setBeatIdx((k) => k + 1), d)`, the cleanup, and the deps `[active, hidden, beatIdx, beats, combatSpeed]`). Remove the now-unused `beatDelay` import if nothing else in the file uses it (grep first — the three lifetime reads use `getChoreoConfig()`, not `beatDelay`; if `beatDelay` is unused after this, drop it from the import). Update the ~line 219 comment block referencing pacingConfig/beatDelay to point at `choreo/clock.ts` + `choreo/choreoConfig.ts`.

- [ ] **Step 2: Full verification.**
Run: `npm run typecheck && npm run lint && npm test && npm run build:web` — all green (report counts). typecheck:web = 21.

- [ ] **Step 3: Live smoke (invisible-change proof).** `preview_start` "web"; drive a practice fight into the combat arena via `window.useGame` (startPractice → pick hero → End Turn), let a full replay play; confirm zero console errors and that beats advance at the same cadence as `main` (eyeball a couple of exchanges). Stop the server. Report what you verified.

- [ ] **Step 4: Commit**
```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "refactor(ui): combat scheduler uses the pure ReplayClock (behavior-identical)"
```

---

### Task 5: Docs + PR

**Files:** `docs/devlog.md` (prepend), `docs/roadmap.md` (mark phase 2 done, phase 3 next), `README.md` (Recent changes), `docs/superpowers/specs/2026-07-06-combat-choreographer-design.md` (tick phase 2 if the file tracks status).

- [ ] **Step 1: Docs.** Devlog entry (match style): phase 2 delivers MomentKind (additive), the choreoConfig migration (pacingConfig deleted; Pacing tuner re-pointed + deprecated-but-functional), and the pure ReplayClock (`holdMs`, legacy-number-locked) now driving the scheduler — all invisible (defaults + formula identical). Note the phase-2 invariant (clock keys by primary.type, not kind — kind-rekey is phase 4). Roadmap: phase 2 → done, phase 3 (channels onto per-moment cue timelines) next; carry the phase-3 breadcrumbs (Rise/Windfury equivalence fixture; predicate-based GroupingRules). README bullet.

- [ ] **Step 2: Full suite** green once more.

- [ ] **Step 3: Commit docs, push, PR.**
```bash
git add docs/devlog.md docs/roadmap.md README.md docs/superpowers/specs/2026-07-06-combat-choreographer-design.md
git commit -m "docs: devlog/roadmap/README for choreographer phase 2"
git push -u origin feat/choreographer-phase2
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat: combat choreographer phase 2 — ReplayClock + MomentKind + config migration" --body "<summary; note it's UI-only (no core touched) so lighter review than #185; invisible-change contract; verification; 🤖 footer>"
```

---

## Self-review

- **Spec coverage (phase 2):** clock ✓ (Task 3+4), pacing→choreoConfig migration ✓ (Task 2), Pacing tuner deprecated-but-functional ✓ (Task 2), MomentKind ✓ (Task 1), no-visible-change ✓ (holdMs is the extracted formula, locked by clock.test + live smoke). Per-moment cue timelines explicitly deferred (owner ruling) — noted, not built.
- **Type consistency:** `MomentKind` (Task 1) ⇄ `Moment.kind` (Task 1) ⇄ `holdMsForKind`/`KIND_TO_KEY` (Task 2) ⇄ `holdMs(next, shown, combatSpeed)` (Task 3) consumed in Task 4. `getChoreoConfig`/`beatDelay` names consistent Tasks 2–4.
- **No placeholders:** every code step complete; the one judgment call (`ascend`/`keyword` kind→key mapping) is called out with two acceptable resolutions, not left blank.
- **Risk:** hottest-file change is Task 4, a ~4-line swap of an already-extracted+tested formula; the migration (Task 2) is mechanical relocation with a grep-zero check. Direct-swap (no flag) per owner ruling.
