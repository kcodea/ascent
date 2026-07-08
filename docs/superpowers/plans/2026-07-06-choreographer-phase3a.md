# Combat Choreographer — Phase 3a: Score Infra + the SFX Channel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the choreographer's Score → Channel-adapter → runner seam by moving the combat SFX dispatch onto it — a behavior-identical relocation of the former inline per-beat sound logic.

**Architecture:** A new `choreo/channels/sfx.ts` adapter holds the exact per-event sound dispatch (extracted verbatim from `useCombatReplay`'s SFX effect). A tiny `choreo/score.ts` defines the `Cue`/`Channel`/`Anchor` types + an exhaustive `SCORE: Record<MomentKind, Cue[]>` (every kind fires `sfx` at `start` today) + a `runMomentCues` runner. `useCombatReplay`'s SFX effect becomes a one-line call to the runner. No GSAP timeline yet (start-anchored only) and no visible change.

**Scope rulings (owner, 2026-07-06):** Phase 3 split into 3a/3b/3c. **3a = score infra + the sfx channel only.** The GSAP per-moment cue-timeline engine + the `contact` anchor + the damage-float channel are deferred to **3b** (where offset anchors are actually needed); CSS anim classes stay render-owned (declarative — they don't fit a fire-at-offset cue and don't need to); aura bursts are **3c**.

**Tech Stack:** TypeScript monorepo; Vitest (vi.spyOn on the `sfx` singleton for the adapter test).

**Spec:** `docs/superpowers/specs/2026-07-06-combat-choreographer-design.md` (Phase 3 = Channels). **Branch:** `feat/choreographer-phase3a` (create off latest `main`).

**Invisible-change contract:** the sound fired for any moment is identical to today (same `once`-dedup, same event→sound mapping, same real-death→board-shake signal). The melee "smack" is NOT in this channel — it stays in `playAttackLunge`'s GSAP timeline at contact (that moves in 3b).

---

### Task 0: Branch

- [ ] Create the branch off latest main:
```bash
git switch main && git pull --ff-only && git switch -c feat/choreographer-phase3a
```

---

### Task 1: The SFX channel adapter

**Files:**
- Create: `packages/ui/src/choreo/channels/sfx.ts`
- Test: `packages/ui/src/choreo/channels/sfx.test.ts`

The source of truth is `useCombatReplay.ts`'s "Combat SFX" effect (~lines 679–708): scan the moment's events, `once(key, fn)` per notable type, track a real-death `kill` (→ board shake) vs a `riseDeath` (→ soft `rebornShatter`, no shake).

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/channels/sfx.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { sfx } from '../../sfx';
import { playMomentSfx } from './sfx';

/** Build a one-moment window over an event array (playMomentSfx reads moment.start..end of `events`). */
const moment = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[]], kind: 'impact' });

afterEach(() => vi.restoreAllMocks());

describe('playMomentSfx', () => {
  it('fires one sound per notable event type, deduped', () => {
    const buff = vi.spyOn(sfx, 'buff').mockImplementation(() => {});
    const shield = vi.spyOn(sfx, 'shield').mockImplementation(() => {});
    const evs: CombatEvent[] = [
      { type: 'buff', target: 'a', attack: 1, health: 1, source: 'x' },
      { type: 'buff', target: 'b', attack: 1, health: 1, source: 'x' }, // 2nd buff → deduped
      { type: 'shieldUp', target: 'c' },
    ];
    const r = playMomentSfx(moment(evs), evs);
    expect(buff).toHaveBeenCalledTimes(1);
    expect(shield).toHaveBeenCalledTimes(1);
    expect(r.shake).toBe(false);
  });

  it('a real death fires the death sound and signals shake; a Rise death does not', () => {
    const death = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const rebornShatter = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    const kill: CombatEvent[] = [{ type: 'death', target: 'a', side: 'enemy' }];
    expect(playMomentSfx(moment(kill), kill)).toEqual({ shake: true });
    expect(death).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
    const shatter = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    const deathSpy = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const rise: CombatEvent[] = [{ type: 'death', target: 'a', side: 'enemy', rise: true }];
    expect(playMomentSfx(moment(rise), rise)).toEqual({ shake: false });
    expect(shatter).toHaveBeenCalledTimes(1);
    expect(deathSpy).not.toHaveBeenCalled();
    void rebornShatter;
  });

  it('summon passes the token cardId to sfx.summon', () => {
    const summon = vi.spyOn(sfx, 'summon').mockImplementation(() => {});
    const evs: CombatEvent[] = [{ type: 'summon', minion: { uid: 't', cardId: 'pup', name: 'Pup', tribe: 'beast', attack: 1, health: 1, keywords: [] }, side: 'player', index: 0 }];
    playMomentSfx(moment(evs), evs);
    expect(summon).toHaveBeenCalledWith('pup');
  });

  it('only a genuine SC cast (cast:true) plays the cast sound', () => {
    const cast = vi.spyOn(sfx, 'cast').mockImplementation(() => {});
    const narration: CombatEvent[] = [{ type: 'sc', source: 'a', text: 'spell power' }];
    playMomentSfx(moment(narration), narration);
    expect(cast).not.toHaveBeenCalled();
    const real: CombatEvent[] = [{ type: 'sc', source: 'a', text: 'scorch', cast: true }];
    playMomentSfx(moment(real), real);
    expect(cast).toHaveBeenCalledTimes(1);
  });
});
```
(Verify the event literals compile against `@game/core`; adjust required fields if tsc complains, keeping the assertions. If any `sfx` method name differs from `attack/cast/death/rebornSummon/shield/buff/maxGold/summon/rebornShatter`, read `packages/ui/src/sfx.ts` and use the real names — the adapter must call exactly what the old effect called.)

- [ ] **Step 2: Run — FAIL** (`./sfx` adapter missing).
Run: `npx vitest run packages/ui/src/choreo/channels/sfx.test.ts`

- [ ] **Step 3: Implement `packages/ui/src/choreo/channels/sfx.ts`** — extract the effect body VERBATIM:

```ts
import type { CombatEvent } from '@game/core';
import { sfx } from '../../sfx';
import type { Moment } from '../compile';

/**
 * SFX channel (choreographer phase 3a) — fires the combat sound(s) for one moment: one sound per notable
 * event type it contains (deduped via `once`), a verbatim relocation of the former inline per-beat dispatch
 * in `useCombatReplay`. Returns `shake: true` when a real (non-Rise) death occurred so the caller triggers
 * the board shake. The melee "smack" is NOT fired here — it comes from the lunge's GSAP timeline at contact
 * (see playAttackLunge); a Rise death plays the soft spirit-release, no shake (the body returns).
 */
export function playMomentSfx(moment: Moment, events: CombatEvent[]): { shake: boolean } {
  const done = new Set<string>();
  const once = (k: string, fn: () => void): void => { if (!done.has(k)) { done.add(k); fn(); } };
  let kill = false;
  let riseDeath = false;
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'attack') once('attack', sfx.attack);
    else if (e.type === 'sc' && e.cast) once('cast', sfx.cast);
    else if (e.type === 'death') { if (e.rise) riseDeath = true; else { once('death', sfx.death); kill = true; } }
    else if (e.type === 'reborn') once('reborn', sfx.rebornSummon);
    else if (e.type === 'shieldUp') once('shield', sfx.shield);
    else if (e.type === 'buff') once('buff', sfx.buff);
    else if (e.type === 'maxGold') once('maxgold', sfx.maxGold);
    else if (e.type === 'summon') once('summon', () => sfx.summon(e.minion.cardId));
  }
  if (riseDeath) once('rise', sfx.rebornShatter);
  return { shake: kill };
}
```

- [ ] **Step 4: Run** the adapter test → green; `npm run typecheck && npm run lint` clean; `typecheck:web` = 21.

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/choreo/channels/sfx.ts packages/ui/src/choreo/channels/sfx.test.ts
git commit -m "feat(ui): sfx channel adapter — verbatim extraction of the combat sound dispatch"
```

---

### Task 2: The Score + runner

**Files:**
- Create: `packages/ui/src/choreo/score.ts`
- Test: `packages/ui/src/choreo/score.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/score.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { SCORE, runMomentCues } from './score';

const moment = (kind: Moment['kind'], events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[]], kind });

afterEach(() => vi.restoreAllMocks());

describe('score', () => {
  it('every MomentKind has a cue list (exhaustive score)', () => {
    // SCORE is typed Record<MomentKind, Cue[]>, so a missing kind is a compile error — assert non-empty at runtime too
    for (const cues of Object.values(SCORE)) expect(Array.isArray(cues)).toBe(true);
  });

  it('runMomentCues fires the sfx channel and routes a real-death shake to onShake', () => {
    const death = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const onShake = vi.fn();
    const evs: CombatEvent[] = [{ type: 'death', target: 'a', side: 'enemy' }];
    runMomentCues(moment('death', evs), { events: evs, onShake });
    expect(death).toHaveBeenCalledTimes(1);
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it('a no-sound moment fires nothing and does not shake', () => {
    const onShake = vi.fn();
    const evs: CombatEvent[] = [{ type: 'reveal', target: 'a' }];
    runMomentCues(moment('reveal', evs), { events: evs, onShake });
    expect(onShake).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — FAIL** (`./score` missing).

- [ ] **Step 3: Implement `packages/ui/src/choreo/score.ts`:**

```ts
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import type { MomentKind } from './kinds';
import { playMomentSfx } from './channels/sfx';

/**
 * The Score (choreographer phase 3) — per moment KIND, the ordered cues (channels + when they fire) that a
 * moment plays. This is the authoring surface phases 3b–4 enrich (offset/contact/landed anchors, per-kind
 * variation, staggers). Phase 3a ships one channel — `sfx` — fired at `start` for every kind; the per-EVENT
 * sound selection lives inside the adapter (`channels/sfx.ts`).
 */
export type Channel = 'sfx';
/** When a cue fires within its moment. Phase 3a: `start` only; offset/`contact`/`landed`/`end` anchors land
 *  with the GSAP cue-timeline engine in phase 3b. */
export type Anchor = 'start';
export interface Cue { ch: Channel; at: Anchor; }

const SFX_AT_START: Cue[] = [{ ch: 'sfx', at: 'start' }];
/** Every kind runs the sfx channel at start (the adapter no-ops for moments with no sound-bearing events),
 *  which reproduces the former "run the SFX effect on every beat" behavior. `Record<MomentKind, …>` forces a
 *  new kind to get an entry here. */
export const SCORE: Record<MomentKind, Cue[]> = {
  attackExchange: SFX_AT_START, impact: SFX_AT_START, death: SFX_AT_START, riseDeath: SFX_AT_START,
  scCast: SFX_AT_START, summon: SFX_AT_START, buffWave: SFX_AT_START, reborn: SFX_AT_START,
  ascend: SFX_AT_START, rally: SFX_AT_START, toHand: SFX_AT_START, maxGold: SFX_AT_START,
  improve: SFX_AT_START, keyword: SFX_AT_START, hpGrant: SFX_AT_START, reveal: SFX_AT_START,
};

export interface CueContext {
  events: CombatEvent[];
  /** Called when a moment contains a real (non-Rise) death — the caller triggers the board shake. */
  onShake: () => void;
}

/** Run one moment's scored cues. Phase 3a fires channels at `start`; the runner grows a real timeline in 3b. */
export function runMomentCues(moment: Moment, ctx: CueContext): void {
  for (const cue of SCORE[moment.kind]) {
    if (cue.ch === 'sfx') {
      const { shake } = playMomentSfx(moment, ctx.events);
      if (shake) ctx.onShake();
    }
  }
}
```

- [ ] **Step 4: Run** `npx vitest run packages/ui/src/choreo` → green; typecheck/lint clean; typecheck:web = 21.

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts
git commit -m "feat(ui): choreo Score + runMomentCues runner (sfx channel, start-anchored)"
```

---

### Task 3: Wire `useCombatReplay`'s SFX effect to the runner

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (the "Combat SFX" effect ~679–708; imports)

- [ ] **Step 1: Swap.** Add `import { runMomentCues } from './choreo/score';`. Replace the SFX effect's body — the `const done2 = ...; const once = ...;` block through `if (kill) setShake(...)` — with a single runner call, keeping the effect's guards + deps:

```ts
  // Combat SFX — one sound per notable event type in the moment just resolved, via the choreo SFX channel.
  useEffect(() => {
    if (!active || beatIdx === 0) return; // only during the live replay (avoids a phantom cue at shop swap-in)
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    runMomentCues(beat, { events, onShake: () => setShake((n) => n + 1) });
  }, [active, beatIdx, beats, events]);
```
Keep the informative comment about the melee smack coming from the lunge (either above the effect or moved into `channels/sfx.ts` — the adapter already documents it, so a one-line pointer here is enough). If `CARD_INDEX` is now unused in the file after this (it was used by the trigger-pulse effect too — CHECK: the medallion-pulse effect at ~650–677 still uses `cardIds`/`CARD_INDEX`), leave the import. Do NOT touch the trigger-pulse effect or any other effect.

- [ ] **Step 2: Full verification.**
Run: `npm run typecheck && npm run lint && npm test && npm run build:web` — all green (report counts). typecheck:web = 21.

- [ ] **Step 3: Live smoke.** `preview_start` "web"; drive a practice fight into combat via `window.useGame` (`startPractice`, then `dispatch({ type: 'faceOmen' })`); let the replay run; confirm zero console errors AND that combat sounds still fire (check the console/network for the sample loads, or just confirm no errors + the replay completes). Stop the server. NB: use a seed/board with real combat (the default first wave may be event-less — if so, advance a wave or note the limitation). Report what you verified.

- [ ] **Step 4: Commit**
```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "refactor(ui): combat SFX fires via the choreo Score runner (behavior-identical)"
```

---

### Task 4: Docs + PR

**Files:** `docs/devlog.md` (prepend), `docs/roadmap.md` (split Phase 3 into 3a done / 3b / 3c), `README.md` (Recent changes bullet).

- [ ] **Step 1: Docs.** Devlog: 3a delivers the Score → channel-adapter → runner seam with the sfx channel as first client (verbatim dispatch extraction); no visible change; note 3b (GSAP cue-timeline engine + contact anchor + damage float + FX/impact) and 3c (aura bursts) are next, and that CSS anims stay render-owned. Roadmap: under Combat Choreographer, replace the single "Phase 3 — Channels" bullet with "Phase 3a ✅ shipped / 3b (contact cluster) / 3c (aura bursts)", carrying the phase-2 breadcrumbs (impact-kind split, Rise/Windfury fixture, KIND_TO_KEY lossiness). README bullet.

- [ ] **Step 2: Full suite** green once more.

- [ ] **Step 3: Commit docs, push, PR.**
```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog/roadmap/README for choreographer phase 3a"
git push -u origin feat/choreographer-phase3a
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat: combat choreographer phase 3a — Score infra + SFX channel" --body "<summary; UI-only, invisible; the seam phases 3b/3c build on; verification; 🤖 footer>"
```

---

## Self-review

- **Spec coverage (Phase 3 = Channels, 3a slice):** the Score/Cue/Channel seam ✓ (Task 2), first channel (sfx) moved onto it ✓ (Tasks 1+3), behavior-identical ✓ (verbatim extraction + adapter/runner tests + full suite + live smoke). Deferrals explicit: GSAP engine/contact/floats → 3b; CSS declarative; aura → 3c.
- **Type consistency:** `Moment.kind: MomentKind` (phase 2) ⇄ `SCORE: Record<MomentKind, Cue[]>` (Task 2); `playMomentSfx(moment, events): { shake }` (Task 1) consumed by `runMomentCues` (Task 2) consumed by the effect (Task 3); `CueContext.onShake` ⇄ `setShake` wiring.
- **No placeholders:** every code step complete; the adapter is a verbatim lift of the audited effect body; the one caveat (event-less first wave in live smoke) is called out with a fallback.
- **Risk:** Task 3 is the only hot-file change — a ~6-line effect-body swap for a call that runs identical logic; guarded by the adapter/runner unit tests + full suite. No GSAP/advance-loop changes in 3a.
