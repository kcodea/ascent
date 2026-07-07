# Combat Choreographer — Phase 3b: The Contact Cluster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the choreographer's GSAP cue-timeline engine with a real `contact` anchor, and move the attack
lunge, the melee impact (sfx + WebGL flash/sparks + defender recoil), and the moment's damage/buff floats onto
Score-driven channels — retiring the `clock.ts` smack-lead WELD (two independently-computed formulas that
merely agreed in value) in favor of one GSAP timeline position that drives both the impact channel and the
beat-clock advance. Resolves the three phase-2/3a carry-ins: the `impact` MomentKind splits into
`damage`/`shieldPop`/`poisonTick`, a Rise/Windfury/venom-heavy compiler equivalence fixture is added, and
`KIND_TO_KEY`'s poison lossiness is fixed.

**Architecture:** New channel adapters — `choreo/channels/float.ts` (damage/buff float spawning, extracted
from `useCombatReplay`'s float effect), `choreo/channels/impact.ts` (the melee smack: sfx + WebGL FX +
defender knockback, extracted from `playAttackLunge`'s contact callback), `choreo/channels/lunge.ts` (the
wind-up/strike/settle motion, extracted from `playAttackLunge` minus its contact body, now taking an
`onContact` callback fired at the same GSAP position). A new `choreo/engine.ts` reads `SCORE['attackExchange']`
and composes lunge + impact + the caller's `advance` callback into ONE GSAP timeline — the `contact` anchor is
literally one timeline position both the impact channel and the moment-advance are scheduled at, instead of two
formulas computed independently in `clock.ts` and `lungeConfig`-driven GSAP math. `score.ts`'s `runMomentCues`
grows from its single `sfx` branch into a real channel-handler registry (`sfx` + `float`); `clock.ts` drops its
attack special-case entirely (the scheduler skips scheduling that transition — the engine's timeline owns it).
Every OTHER moment kind is untouched: same `holdMs`-driven `setTimeout` scheduler, same hold values.

**Scope ruling (owner, 2026-07-07):** Full engine build (not the narrower "keep the setTimeout scheduler, only
channel-ify" option) — but scoped exactly to what the roadmap names "the contact cluster" (lunge/impact/hit/
damage-float/recoil for the ATTACK→ITS OWN IMPACT transition only). Every other moment kind keeps its existing
`holdMs`/`setTimeout` path unchanged — this is not a rewrite of the whole scheduler (that generalization, if
ever needed, is phase 4 "Authoring" territory). One accepted, called-out behavior nuance: today, backgrounding
the tab mid-lunge cancels + reschedules the attack-wind-up's advance timer on return (via the `hidden`-gated
scheduler); after this change the advance is tied to the lunge's own (already rAF-throttled, never explicitly
killed on `hidden`) GSAP timeline, so it resumes in place instead of resetting. Confirm this doesn't read as a
regression during the live smoke/feel-pass (Task 10).

**Tech Stack:** TypeScript monorepo; Vitest + jsdom (`gsap` timelines are seekable synchronously via
`.progress()`/`.seek()` even in jsdom — no real timers needed to test callback firing); `vi.spyOn` on the
`sfx`/`pixiFx` singletons.

**Spec:** `docs/superpowers/specs/2026-07-06-combat-choreographer-design.md` (Phase 3 = Channels; §③ Playback
Engine). **Roadmap breadcrumb:** `docs/roadmap.md` → Combat Choreographer → Phase 3b. **Branch:**
`feat/choreographer-phase3b` (create off latest `main`).

**Invisible-change contract:** every sound, FX, float, and timing value fires at the exact same moment as
today, for every fight. The one accepted nuance (hidden-tab resume-vs-reset during an in-flight lunge) is
called out above, not hidden.

---

### Task 0: Branch

- [ ] Create the branch off latest main:
```bash
git switch main && git pull --ff-only && git switch -c feat/choreographer-phase3b
```

---

### Task 1: Split the `impact` MomentKind into `damage` / `shieldPop` / `poisonTick`

**Why:** `impact` today collapses `dmg`/`shield`/`shieldUp`/`poison`/`venomLost` into one kind, losing the
distinction the Score needs (a `poison` moment should hold 500ms, not 460ms — `KIND_TO_KEY` currently maps ALL
of them to `'dmg'` (460), which is silently wrong for poison/venomLost). `shield` (break, no float) and
`shieldUp` (gain, ◇ float) share value 460 today so merging them into `shieldPop` is value-identical;
`poison`/`venomLost` share value 500 so merging into `poisonTick` is value-identical; only the OLD
`impact`→`'dmg'` mapping for poison was wrong. `holdMs` (the live clock) reads `beatDelay(next.primary.type)`
directly — NOT `holdMsForKind` — so this fix changes no live timing; it just makes `holdMsForKind` correct
before phase 3b's clock changes (Task 8) partially rely on kind-level correctness.

**Files:**
- Modify: `packages/ui/src/choreo/kinds.ts`
- Modify: `packages/ui/src/choreo/kinds.test.ts`
- Modify: `packages/ui/src/choreo/choreoConfig.ts`
- Modify: `packages/ui/src/choreo/choreoConfig.test.ts`
- Modify: `packages/ui/src/choreo/channels/sfx.test.ts` (fixture only)
- Modify: `packages/ui/src/choreo/clock.test.ts` (fixture only)

- [ ] **Step 1: Update `kinds.ts`.** Replace the `MomentKind` union and `momentKind`'s dmg/shield/poison cases:

```ts
export type MomentKind =
  | 'attackExchange'
  | 'damage' | 'shieldPop' | 'poisonTick'
  | 'death'
  | 'riseDeath'
  | 'scCast'
  | 'summon' | 'buffWave' | 'reborn' | 'ascend' | 'rally' | 'toHand' | 'maxGold' | 'improve'
  | 'keyword' | 'hpGrant' | 'reveal';

export function momentKind(primary: CombatEvent): MomentKind {
  switch (primary.type) {
    case 'attack': return 'attackExchange';
    case 'dmg': return 'damage';
    case 'shield': case 'shieldUp': return 'shieldPop';
    case 'poison': case 'venomLost': return 'poisonTick';
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
Update the file's doc comment ("carrying the SoftAtomicity" etc. stays; no other prose references `impact`).

- [ ] **Step 2: Update `kinds.test.ts`.** In the `cases` array, change the four `'impact'` expectations:

```ts
      [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 1 }, 'damage'],
      [{ type: 'shield', target: 'b' }, 'shieldPop'],
      [{ type: 'poison', target: 'b' }, 'poisonTick'],
```
and further down:
```ts
      [{ type: 'venomLost', target: 'b' }, 'poisonTick'],
      [{ type: 'shieldUp', target: 'b' }, 'shieldPop'],
```

- [ ] **Step 3: Update `choreoConfig.ts`'s `KIND_TO_KEY`.** Replace the `impact:` entry with three entries:

```ts
const KIND_TO_KEY: Record<MomentKind, keyof ChoreoConfig> = {
  attackExchange: 'attack', damage: 'dmg', shieldPop: 'shield', poisonTick: 'poison',
  death: 'death', riseDeath: 'death', scCast: 'sc',
  summon: 'summon', buffWave: 'buff', reborn: 'reborn', ascend: 'improve', rally: 'rally',
  toHand: 'toHand', maxGold: 'maxGold', improve: 'improve', keyword: 'buff', hpGrant: 'hpGrant', reveal: 'summon',
};
```

- [ ] **Step 4: Update `choreoConfig.test.ts`.** Replace the `holdMsForKind` assertions:

```ts
  it('holdMsForKind maps a moment kind to the pre-scale hold it should reproduce', () => {
    expect(holdMsForKind('damage')).toBe(beatDelay('dmg'));
    expect(holdMsForKind('shieldPop')).toBe(beatDelay('shield'));
    expect(holdMsForKind('poisonTick')).toBe(beatDelay('poison')); // the fixed carry-in — was wrongly 'dmg' (460) before this split
    expect(holdMsForKind('death')).toBe(beatDelay('death'));
    expect(holdMsForKind('scCast')).toBe(beatDelay('sc'));
  });
```

- [ ] **Step 5: Fix up the two fixture-only test files.** In `packages/ui/src/choreo/channels/sfx.test.ts`, change `kind: 'impact'` (line 7) to `kind: 'damage'`. In `packages/ui/src/choreo/clock.test.ts`, change `kind: 'impact'` (line 14) to `kind: 'damage'`. Neither test actually asserts on `kind` — this is a compile-fix only.

- [ ] **Step 6: Run.** `npx vitest run packages/ui/src/choreo` → will still FAIL at this point (score.ts's
`SCORE: Record<MomentKind, Cue[]>` no longer compiles — the old `impact:` key doesn't match the new union). That's expected; Task 6 fixes it. For now, run just the files this task touches to confirm THEIR logic:
```bash
npx vitest run packages/ui/src/choreo/kinds.test.ts packages/ui/src/choreo/choreoConfig.test.ts
```
Expected: FAIL (TypeScript compile error surfaces as a test-file failure) — confirms score.ts needs the kind rename too. Note this and continue; Task 6 completes the migration.

- [ ] **Step 7: Commit.**
```bash
git add packages/ui/src/choreo/kinds.ts packages/ui/src/choreo/kinds.test.ts packages/ui/src/choreo/choreoConfig.ts packages/ui/src/choreo/choreoConfig.test.ts packages/ui/src/choreo/channels/sfx.test.ts packages/ui/src/choreo/clock.test.ts
git commit -m "refactor(ui): split the impact MomentKind into damage/shieldPop/poisonTick"
```
(This commit intentionally leaves `score.ts` red until Task 6 — the whole rename is one atomic TypeScript
change across the codebase; `main` never sees this intermediate state since it only lands via the squashed PR.)

---

### Task 2: Rise/Windfury/venom-heavy compiler equivalence fixture

**Why:** Carry-in (b) — `compileMoments` is proven byte-identical to `buildBeats` on real fights, but none of
the existing fixtures exercise a Rise pull-back-and-return, a Windfury double-attack, or a venom-heavy trade.
Add rosters that do, so the equivalence gate actually covers the mechanics phase 3b's contact-cluster work
touches most.

**Files:**
- Modify: `packages/ui/src/choreo/compile.test.ts`

- [ ] **Step 1: Add three fixtures to the `FIGHTS` array.** `footman` (Undead token, Reborn/'R', usable
directly as a roster entry even though it's not shop-purchasable — `simulate` only needs it in `CARD_INDEX`),
`speedy` (Mech, Windfury/'W'), `venom` (neutral, Venomous/'V'):

```ts
  ['rise pull-back', () => simulate(
    [{ cardId: 'footman', attack: 2, health: 1 }],
    [{ cardId: 'stray', attack: 4, health: 6 }], makeRng(7), CARD_INDEX)],
  ['windfury double-attack', () => simulate(
    [{ cardId: 'speedy', attack: 4, health: 4 }],
    [{ cardId: 'sandbag', attack: 1, health: 12 }], makeRng(13), CARD_INDEX)],
  ['venom-heavy trade', () => simulate(
    [{ cardId: 'venom', attack: 1, health: 1 }, { cardId: 'venom', attack: 1, health: 1 }],
    [{ cardId: 'stray', attack: 3, health: 8 }, { cardId: 'pack', attack: 2, health: 2 }], makeRng(21), CARD_INDEX)],
```
Add these to the existing `FIGHTS` array (after `'bigger board'`) — the existing
`describe.for`-style loop (`for (const [name, run] of FIGHTS) { it(...) }`) picks them up automatically; no
other test code changes.

- [ ] **Step 2: Run.**
```bash
npx vitest run packages/ui/src/choreo/compile.test.ts
```
Expected: PASS for all fixtures INCLUDING the three new ones (compileMoments already re-implements buildBeats's
exact algorithm — this test is confirming equivalence holds on these specific shapes, not introducing new
compiler logic). If a card id doesn't exist or a roster is invalid, `simulate` throws — adjust the roster
(swap a card id, tweak stats) rather than the assertion; the goal is any real fight exercising Rise/Windfury/
venom, the exact numbers don't matter.

- [ ] **Step 3: Commit.**
```bash
git add packages/ui/src/choreo/compile.test.ts
git commit -m "test(ui): compiler equivalence fixtures for Rise pull-back, Windfury, venom-heavy trades"
```

---

### Task 3: The float channel (`choreo/channels/float.ts`)

**Why:** The former per-beat float-spawning effect in `useCombatReplay.ts` (lines ~590-645) is the biggest
piece moving onto the Score's channel registry. Extracted as a pure function returning data (not touching
React state directly) so it's cheaply unit-testable, mirroring `channels/sfx.ts`'s pattern from phase 3a.
`Float`/`DeathFloat` (previously local to `useCombatReplay.ts`, `Float` not even exported) move here as their
natural new home — grep confirms neither type is imported anywhere outside `useCombatReplay.ts`, so no other
file needs updating for the relocation. `KW_FLOAT` (the Rise→"Rise", DS→"Ward" keyword label map) moves here
too since `floatFor` needs it — `useCombatReplay.ts`'s `narrate`/`narrateLog` also use it and will import it
back (Task 9).

**Files:**
- Create: `packages/ui/src/choreo/channels/float.ts`
- Test: `packages/ui/src/choreo/channels/float.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/channels/float.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { spawnFloats } from './float';

const moment = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind: 'damage' });
const noEl = (): Element | null => null;

describe('spawnFloats', () => {
  it('spawns a damage float for the struck unit', () => {
    const evs: CombatEvent[] = [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 5 }];
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, noEl, null);
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '3', kind: 'dmg' }]);
    expect(deathFloats).toEqual([]);
  });

  it('suppresses the attacker\'s own retaliation damage number', () => {
    const evs: CombatEvent[] = [
      { type: 'dmg', target: 'b', amount: 3, remainingHp: 5 },
      { type: 'dmg', target: 'a', amount: 1, remainingHp: 9 },
    ];
    const { floats } = spawnFloats(moment(evs), evs, noEl, 'a');
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '3', kind: 'dmg' }]);
  });

  it('a killing blow on a dying unit becomes a board-overlay DeathFloat positioned via findEl', () => {
    const evs: CombatEvent[] = [
      { type: 'dmg', target: 'b', amount: 9, remainingHp: 0 },
      { type: 'death', target: 'b', side: 'enemy' },
    ];
    const findEl = (uid: string): Element | null => {
      if (uid !== 'b') return null;
      const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 60 }) } as unknown as Element;
      return el;
    };
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, findEl, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([{ id: 0, x: 30, y: 50, text: '9', kind: 'dmg' }]);
  });

  it('buff events sum per target into one float, not one per source event', () => {
    const evs: CombatEvent[] = [
      { type: 'buff', target: 'b', attack: 1, health: 1, source: 'x' },
      { type: 'buff', target: 'b', attack: 2, health: 0, source: 'y' },
    ];
    const { floats } = spawnFloats(moment(evs), evs, noEl, null);
    expect(floats).toEqual([{ id: 0, uid: 'b', text: '+3/+1', kind: 'buff' }]);
  });

  it('a moment with no floatable events spawns nothing', () => {
    const evs: CombatEvent[] = [{ type: 'reveal', target: 'a' }];
    const { floats, deathFloats } = spawnFloats(moment(evs), evs, noEl, null);
    expect(floats).toEqual([]);
    expect(deathFloats).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`./float` module missing).
```bash
npx vitest run packages/ui/src/choreo/channels/float.test.ts
```

- [ ] **Step 3: Implement `packages/ui/src/choreo/channels/float.ts`** — extract `Float`, `DeathFloat`,
`KW_FLOAT`, `floatFor`, and the float-spawning effect body VERBATIM (renaming `beat` → `moment`,
`attackerUid`/`findEl` become explicit parameters instead of closed-over hook state):

```ts
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** A floating number/glyph shown over a unit for a few seconds (damage/poison/shield/buff/keyword/gold). */
export interface Float {
  id: number;
  uid: string;
  text: string;
  kind: string;
}

/** A damage float for a minion that DIES this moment. Its unit collapses (`.unit.dying`, width→0) and is
 *  removed next moment, which would clip an in-unit float — so the killing-blow number is rendered in a
 *  board-level overlay at the unit's captured screen position instead, where it survives + lingers. */
export interface DeathFloat {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: string;
}

/** Player-facing labels for granted keywords (the renamed terms — Reborn → Rise, etc.). Shared with
 *  `useCombatReplay.ts`'s narration (`narrate`/`narrateLog`), which imports this back. */
export const KW_FLOAT: Partial<Record<string, string>> = {
  R: 'Rise', DS: 'Ward', T: 'Taunt', V: 'Toxin', W: 'Flurry', C: 'Cleave', ST: 'Stealth', IMM: 'Immune',
};

/** A floating number/glyph for the unit the active event acts on. Verbatim extraction of the former
 *  `floatFor` in `useCombatReplay.ts`. */
function floatFor(e: CombatEvent | undefined): { uid: string; text: string; kind: string } | null {
  if (!e) return null;
  switch (e.type) {
    case 'dmg': return { uid: e.target, text: `${e.amount}`, kind: 'dmg' };
    case 'poison': return { uid: e.target, text: '☠', kind: 'poison' };
    case 'shieldUp': return { uid: e.target, text: '◇', kind: 'shieldup' };
    case 'buff': return { uid: e.target, text: `+${e.attack}/+${e.health}`, kind: 'buff' };
    case 'improve': return { uid: e.target, text: '✦', kind: 'buff' };
    case 'keyword': return { uid: e.target, text: KW_FLOAT[e.keyword] ?? e.keyword, kind: 'buff' };
    case 'maxGold': return { uid: e.target, text: `+${e.amount} max gold`, kind: 'gold' };
    case 'rally': return { uid: e.target, text: '☠', kind: 'rally' };
    default: return null;
  }
}

/**
 * Float channel (choreographer phase 3b) — the damage/poison/shield/buff/keyword/gold floats for one
 * moment's events, all at once. Verbatim extraction of the former per-beat float effect in
 * `useCombatReplay.ts`. Buff events are summed per target so a multi-proc effect (e.g. a re-procced
 * Deathrattle) shows one correct total, not several partials. `attackerUid` suppresses the attacker's own
 * retaliation number (only the struck unit shows a number) — pass `attackerOfImpact(beats, beatIdx - 1)`.
 * A unit dying THIS moment gets its damage number positioned in a board overlay via `findEl` instead of an
 * in-unit float (its slot collapses next moment, which would clip it).
 */
export function spawnFloats(
  moment: Moment,
  events: CombatEvent[],
  findEl: (uid: string) => Element | null,
  attackerUid: string | null,
): { floats: Float[]; deathFloats: DeathFloat[] } {
  const dying = new Set<string>();
  for (let i = moment.start; i < moment.end; i++) { const e = events[i]; if (e?.type === 'death') dying.add(e.target); }
  const spawned: Float[] = [];
  const deaths: DeathFloat[] = [];
  const buffByTarget = new Map<string, { a: number; h: number; id: number }>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type === 'buff') {
      const cur = buffByTarget.get(e.target) ?? { a: 0, h: 0, id: i };
      cur.a += e.attack;
      cur.h += e.health;
      buffByTarget.set(e.target, cur);
      continue;
    }
    const f = floatFor(e);
    if (!f) continue;
    if (f.kind === 'dmg' && f.uid === attackerUid) continue;
    if (f.kind === 'dmg' && dying.has(f.uid)) {
      const r = findEl(f.uid)?.getBoundingClientRect();
      if (r) { deaths.push({ id: i, x: r.left + r.width / 2, y: r.top + r.height * 0.5, text: f.text, kind: f.kind }); continue; }
    }
    spawned.push({ id: i, ...f });
  }
  for (const [uid, { a, h, id }] of buffByTarget) {
    spawned.push({ id, uid, text: `+${a}/+${h}`, kind: 'buff' });
  }
  return { floats: spawned, deathFloats: deaths };
}
```

- [ ] **Step 4: Run** → green.
```bash
npx vitest run packages/ui/src/choreo/channels/float.test.ts
```

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/channels/float.ts packages/ui/src/choreo/channels/float.test.ts
git commit -m "feat(ui): float channel adapter — verbatim extraction of the per-beat float spawner"
```

---

### Task 4: The impact channel (`choreo/channels/impact.ts`)

**Why:** The melee smack — `sfx.hit()`, the WebGL flash/spark burst (`pixiFx.impact`), and the defender's
knockback tween — was hardcoded inside `playAttackLunge`'s contact GSAP callback. Extracted so it can be fired
from the engine as a real `at: 'contact'` cue, independent of the lunge motion itself. `hitPower` (swing
damage → impact power scale) moves here too since power's only consumer is this channel.

**Files:**
- Create: `packages/ui/src/choreo/channels/impact.ts`
- Test: `packages/ui/src/choreo/channels/impact.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/channels/impact.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';
import { hitPower, playContactImpact } from './impact';

afterEach(() => vi.restoreAllMocks());

describe('hitPower', () => {
  it('maps swing damage to a power scale clamped to [0.9, 2]', () => {
    expect(hitPower(0)).toBeCloseTo(0.9, 5);
    expect(hitPower(3)).toBeCloseTo(1.1, 5);
    expect(hitPower(40)).toBe(2);
  });
});

describe('playContactImpact', () => {
  it('always fires the hit sound, even with no defender', () => {
    const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    playContactImpact(null, 10, 0, 1, 1);
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('with a defender: fires the WebGL impact FX at its screen center and starts a knockback tween', () => {
    const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const impact = vi.spyOn(pixiFx, 'impact').mockImplementation(() => {});
    const el = document.createElement('div');
    document.body.appendChild(el);
    playContactImpact(el, 10, 0, 1.5, 1);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledWith(0, 0, 10, 0, 1.5); // jsdom rects default to 0×0 at (0,0)
    expect(gsap.getTweensOf(el).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`./impact` module missing).
```bash
npx vitest run packages/ui/src/choreo/channels/impact.test.ts
```

- [ ] **Step 3: Implement `packages/ui/src/choreo/channels/impact.ts`** — extract `hitPower` and the contact
callback body VERBATIM from `playAttackLunge`:

```ts
import gsap from 'gsap';
import { sfx } from '../../sfx';
import { pixiFx } from '../../pixiFx';

/** Map an attack's swing damage → the impact's `power` scale (1 = baseline). Ramps gently: a 1-3 dmg chip
 *  stays at the familiar burst, ~8 dmg reads clearly heavier, and it caps at 2× so a 40-damage finisher
 *  doesn't whiteout the board. */
export const hitPower = (swing: number): number => Math.max(0.9, Math.min(2, 0.8 + swing / 10));

/**
 * Impact channel (choreographer phase 3b) — the melee "smack": the hit sound, a WebGL flash + spark spray
 * at the defender fired along the blow direction, and the defender's knockback-and-recover tween. Fired
 * from the lunge's `contact` GSAP position (see `engine.ts`) — a verbatim extraction of the former inline
 * callback inside `playAttackLunge`. `dx`/`dy` is the attacker→defender vector; `power` scales the FX +
 * knockback with the swing's damage (see `hitPower`). No-op FX/recoil when there's no defender (still
 * fires the hit sound).
 */
export function playContactImpact(defender: Element | null, dx: number, dy: number, power: number, speed: number): void {
  sfx.hit();
  if (!defender) return;
  const r = defender.getBoundingClientRect();
  pixiFx.impact(r.left + r.width / 2, r.top + r.height / 2, dx, dy, power);
  gsap.killTweensOf(defender);
  const kb = 0.14 * (0.75 + 0.25 * power);
  gsap.fromTo(defender, { x: 0, y: 0 }, {
    x: dx * kb, y: dy * kb, duration: 0.1 / speed, yoyo: true, repeat: 1, ease: 'power2.out',
    onComplete: () => gsap.set(defender, { clearProps: 'transform' }),
  });
}
```

- [ ] **Step 4: Run** → green.
```bash
npx vitest run packages/ui/src/choreo/channels/impact.test.ts
```

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/channels/impact.ts packages/ui/src/choreo/channels/impact.test.ts
git commit -m "feat(ui): impact channel adapter — verbatim extraction of the contact FX/sfx/recoil"
```

---

### Task 5: The lunge channel (`choreo/channels/lunge.ts`)

**Why:** The wind-up/strike/settle motion, minus the contact FX/sfx/recoil (now `channels/impact.ts`). Takes
an `onContact` callback fired at the exact same GSAP position the old code hardcoded its contact work at
(`-=${c.smackLead}`) — this callback is where `engine.ts` (Task 7) wires in the impact channel AND the moment
advance, so both fire off the literal same timeline event instead of two independently-computed formulas.
Returns the built timeline (test-seekable via `.progress()`).

**Files:**
- Create: `packages/ui/src/choreo/channels/lunge.ts`
- Test: `packages/ui/src/choreo/channels/lunge.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/channels/lunge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playLunge } from './lunge';

// This repo runs Vitest in the NODE environment (no jsdom) — sibling tests (float.test.ts, impact.test.ts)
// use a stubbed Element, not document.createElement. `playLunge` reads getBoundingClientRect + classList +
// querySelector off the attacker, so the stub supplies those. (gsap prints benign "Invalid property x/y"
// warnings when tweening a non-DOM object — that's expected here and does not fail the tests.)
const fakeEl = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  classList: { contains: () => false },
  querySelector: () => null,
}) as unknown as Element;

afterEach(() => vi.restoreAllMocks());

describe('playLunge', () => {
  it('fires onContact exactly once when the timeline is seeked to completion', () => {
    const onContact = vi.fn();
    const tl = playLunge({ attacker: fakeEl(), dx: 40, dy: 0, speed: 1, onContact });
    tl.progress(1);
    expect(onContact).toHaveBeenCalledTimes(1);
  });

  it('onContact fires BEFORE the timeline fully completes (mid-timeline, at the smack-lead position)', () => {
    let contactAtProgress = -1;
    const tl = playLunge({ attacker: fakeEl(), dx: 40, dy: 0, speed: 1, onContact: () => { contactAtProgress = tl.progress(); } });
    tl.progress(1);
    expect(contactAtProgress).toBeGreaterThan(0);
    expect(contactAtProgress).toBeLessThan(1);
  });

  it('timeScales the whole timeline by the given speed', () => {
    const tl = playLunge({ attacker: fakeEl(), dx: 10, dy: 0, speed: 2, onContact: () => {} });
    expect(tl.timeScale()).toBe(2);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`./lunge` module missing).
```bash
npx vitest run packages/ui/src/choreo/channels/lunge.test.ts
```

- [ ] **Step 3: Implement `packages/ui/src/choreo/channels/lunge.ts`** — extract the motion VERBATIM from
`playAttackLunge`, replacing its contact callback body with `ctx.onContact()`:

```ts
import gsap from 'gsap';
import { getLungeConfig } from '../../lungeConfig';
import { getTrailConfig } from '../../trailConfig';
import { pixiFx } from '../../pixiFx';

export interface LungeCtx {
  attacker: Element;
  /** Full attacker→defender vector (not normalized). */
  dx: number;
  dy: number;
  speed: number;
  /** Fired at the smack-lead GSAP position — the moment of contact. See `engine.ts` for how this is wired
   *  to the impact channel + the beat-clock advance. */
  onContact: () => void;
}

/**
 * The attack lunge motion (choreographer phase 3b) — wind up (lean back + tilt), strike toward the
 * defender (power3.in), then settle with an elastic overshoot. GSAP owns the attacker's transform for the
 * whole lunge — React renders no transform on combat units, so they never fight. Verbatim extraction of the
 * former `playAttackLunge` in `useCombatReplay.ts`, MINUS the contact FX/sfx/recoil (now
 * `channels/impact.ts`, invoked via `onContact` at the exact former GSAP position). Returns the built
 * timeline (seekable via `.progress()` in tests, without needing real time to pass).
 */
export function playLunge(ctx: LungeCtx): ReturnType<typeof gsap.timeline> {
  const { attacker, dx, dy, speed, onContact } = ctx;
  const c = getLungeConfig();
  const rest = attacker.getBoundingClientRect();
  const cx0 = rest.left + rest.width / 2;
  const cy0 = rest.top + rest.height / 2;
  // NB: in combat `findEl` resolves the `.unit` WRAPPER (its data-uid matches first), so the marker classes
  // live on the `.card` DESCENDANT — the querySelector is the live path, not a dead fallback.
  const variant = attacker.classList.contains('dscard') || attacker.querySelector('.dscard')
    ? 'gold'
    : attacker.classList.contains('reborncard') || attacker.querySelector('.reborncard')
      ? 'blue'
      : 'wind';
  let trailLast = { x: cx0, y: cy0 };
  const trailCutoff = c.windupDur + c.strikeDur;
  gsap.killTweensOf(attacker); // a re-attacker (Windfury / Gnasher swinging again) restarts clean
  gsap.set(attacker, { zIndex: 12 }); // ride above its neighbours for the duration
  const tl = gsap
    .timeline({
      onComplete: () => gsap.set(attacker, { clearProps: 'transform,zIndex' }),
      onUpdate: () => {
        if (tl.time() > trailCutoff) return; // no trail on the elastic settle
        const cx = cx0 + Number(gsap.getProperty(attacker, 'x'));
        const cy = cy0 + Number(gsap.getProperty(attacker, 'y'));
        const tdx = cx - trailLast.x;
        const tdy = cy - trailLast.y;
        if (Math.hypot(tdx, tdy) >= getTrailConfig().emitSpacing) {
          pixiFx.trail(cx, cy, tdx, tdy, variant);
          trailLast = { x: cx, y: cy };
        }
      },
    })
    .to(attacker, { x: -dx * c.windupDepth, y: -dy * c.windupDepth, rotation: -5, scale: c.windupScale, duration: c.windupDur, ease: 'power1.out' })  // wind up
    .to(attacker, { x: dx * c.strikeDist, y: dy * c.strikeDist, rotation: 0, scale: 1, duration: c.strikeDur, ease: 'power3.in' })                    // strike
    .add(onContact, `-=${c.smackLead}`)                                                                                                                // contact — fired smackLead seconds BEFORE the strike completes
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: c.settleDur, ease: 'elastic.out(1, 0.45)' });                                                    // settle
  tl.timeScale(speed);
  return tl;
}
```

- [ ] **Step 4: Run.**
```bash
npx vitest run packages/ui/src/choreo/channels/lunge.test.ts
```
Expected: PASS. If the mid-timeline `progress()` seek test flakes (GSAP's exact `.progress()` seek semantics
for `.add(callback, position)` entries can differ by version — verify via the actual failure message), the
fallback is to advance `gsap.ticker` manually (`gsap.ticker.tick()` in a loop) or use `tl.seek(tl.duration())`
instead of `.progress(1)` — adjust the test to whatever GSAP's installed version actually does, keeping the
assertion (`onContact` fires exactly once, before full completion).

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/channels/lunge.ts packages/ui/src/choreo/channels/lunge.test.ts
git commit -m "feat(ui): lunge channel adapter — the wind-up/strike/settle motion, contact factored out"
```

---

### Task 6: `score.ts` — extend the channel registry, update the Score for the split kinds

**Files:**
- Modify: `packages/ui/src/choreo/score.ts`
- Modify: `packages/ui/src/choreo/score.test.ts`

- [ ] **Step 1: Update the failing/changed tests first** — `packages/ui/src/choreo/score.test.ts` (replace
entirely):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { SCORE, runMomentCues } from './score';

const moment = (kind: Moment['kind'], events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind });
const ctx = (events: CombatEvent[], overrides: Partial<Parameters<typeof runMomentCues>[1]> = {}) => ({
  events, onShake: vi.fn(), findEl: () => null, attackerUid: null,
  onFloats: vi.fn(), onDeathFloats: vi.fn(), ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('score', () => {
  it('every MomentKind has a cue list (exhaustive score)', () => {
    for (const cues of Object.values(SCORE)) expect(Array.isArray(cues)).toBe(true);
  });

  it('attackExchange scores lunge (start) + impact (contact) — no sfx/float double-firing the smack', () => {
    expect(SCORE.attackExchange).toEqual(expect.arrayContaining([{ ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact' }]));
  });

  it('runMomentCues fires the sfx channel and routes a real-death shake to onShake', () => {
    const death = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const c = ctx([{ type: 'death', target: 'a', side: 'enemy' }]);
    runMomentCues(moment('death', c.events), c);
    expect(death).toHaveBeenCalledTimes(1);
    expect(c.onShake).toHaveBeenCalledTimes(1);
  });

  it('runMomentCues fires the float channel for a damage moment', () => {
    const c = ctx([{ type: 'dmg', target: 'b', amount: 4, remainingHp: 2 }]);
    runMomentCues(moment('damage', c.events), c);
    expect(c.onFloats).toHaveBeenCalledWith([{ id: 0, uid: 'b', text: '4', kind: 'dmg' }]);
    expect(c.onDeathFloats).not.toHaveBeenCalled();
  });

  it('a moment with nothing to show fires no callbacks', () => {
    const c = ctx([{ type: 'reveal', target: 'a' }]);
    runMomentCues(moment('reveal', c.events), c);
    expect(c.onShake).not.toHaveBeenCalled();
    expect(c.onFloats).not.toHaveBeenCalled();
    expect(c.onDeathFloats).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — FAIL** (SCORE still keyed by the old `impact` kind; `CueContext` doesn't have
`findEl`/`attackerUid`/`onFloats`/`onDeathFloats` yet).
```bash
npx vitest run packages/ui/src/choreo/score.test.ts
```

- [ ] **Step 3: Implement the new `packages/ui/src/choreo/score.ts`** (full replacement):

```ts
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import type { MomentKind } from './kinds';
import { playMomentSfx } from './channels/sfx';
import { spawnFloats, type Float, type DeathFloat } from './channels/float';

/**
 * The Score (choreographer phase 3) — per moment KIND, the ordered cues (channels + when they fire) that a
 * moment plays. Phase 3a shipped one channel (`sfx`, always `start`). Phase 3b adds `float` (also `start` —
 * a moment becoming current is already the right time to show its numbers/glyphs) and, for `attackExchange`
 * only, `lunge` (`start`) + `impact` (`contact` — a REAL anchor: a GSAP timeline position the lunge channel
 * defines, not a separately-computed hold value). `runMomentCues` is the plain-effect registry (sfx + float,
 * called once per moment from a `useEffect`); the `lunge`/`impact` pair is DOM-measuring/GSAP work, driven
 * instead by `engine.ts`'s `runAttackExchangeCues` from a `useLayoutEffect` — this file still owns the score
 * DATA for both.
 */
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact';
/** When a cue fires within its moment. `start`/`contact` are used today; `landed`/`end` are reserved for
 *  phase 3c (aura bursts) and phase 4 (authoring). */
export type Anchor = 'start' | 'contact' | 'landed' | 'end';
export interface Cue { ch: Channel; at: Anchor; }

const SFX_FLOAT: Cue[] = [{ ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' }];
/** Every kind runs sfx + float at start (both adapters no-op for moments with nothing to show) EXCEPT
 *  `attackExchange`, which ALSO still needs sfx (the wind-up whoosh, `sfx.attack`) + float (absorbed
 *  windup events like Rally/buff can carry a float) at `start`, PLUS `lunge` (the motion) at `start` and
 *  `impact` (the smack/FX/recoil) at the `contact` anchor the lunge defines. Each kind gets its OWN array
 *  (not a shared reference) so a future authoring pass can vary one kind's cues without mutating others. */
export const SCORE: Record<MomentKind, Cue[]> = {
  attackExchange: [{ ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' }, { ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact' }],
  damage: [...SFX_FLOAT], shieldPop: [...SFX_FLOAT], poisonTick: [...SFX_FLOAT],
  death: [...SFX_FLOAT], riseDeath: [...SFX_FLOAT], scCast: [...SFX_FLOAT],
  summon: [...SFX_FLOAT], buffWave: [...SFX_FLOAT], reborn: [...SFX_FLOAT], ascend: [...SFX_FLOAT],
  rally: [...SFX_FLOAT], toHand: [...SFX_FLOAT], maxGold: [...SFX_FLOAT], improve: [...SFX_FLOAT],
  keyword: [...SFX_FLOAT], hpGrant: [...SFX_FLOAT], reveal: [...SFX_FLOAT],
};

export interface CueContext {
  events: CombatEvent[];
  /** Called when a moment contains a real (non-Rise) death — the caller triggers the board shake. */
  onShake: () => void;
  /** Resolve a unit's live DOM node — used to position a killing-blow float in the board overlay. */
  findEl: (uid: string) => Element | null;
  /** The attacker whose OWN retaliation damage number is suppressed this moment (or null). */
  attackerUid: string | null;
  onFloats: (floats: Float[]) => void;
  onDeathFloats: (deaths: DeathFloat[]) => void;
}

/** Run one moment's plain-effect cues (sfx + float). The `lunge`/`impact` pair is DOM-measuring/GSAP work
 *  handled separately by `engine.ts`'s `runAttackExchangeCues` — this registry silently ignores cue kinds
 *  it doesn't own, so `attackExchange`'s `lunge`/`impact` entries are no-ops here (by design). */
export function runMomentCues(moment: Moment, ctx: CueContext): void {
  for (const cue of SCORE[moment.kind]) {
    if (cue.ch === 'sfx') {
      const { shake } = playMomentSfx(moment, ctx.events);
      if (shake) ctx.onShake();
    } else if (cue.ch === 'float') {
      const { floats, deathFloats } = spawnFloats(moment, ctx.events, ctx.findEl, ctx.attackerUid);
      if (floats.length) ctx.onFloats(floats);
      if (deathFloats.length) ctx.onDeathFloats(deathFloats);
    }
  }
}
```

- [ ] **Step 4: Run.**
```bash
npx vitest run packages/ui/src/choreo
```
Expected: PASS across the whole `choreo` tree (this is also where Task 1's deferred `kinds.test.ts`/
`choreoConfig.test.ts` failures resolve, since `score.ts` now compiles against the new `MomentKind` union).
Then: `npm run typecheck && npm run lint` clean.

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts
git commit -m "feat(ui): score channel registry grows sfx+float; attackExchange scores lunge+impact"
```

---

### Task 7: The engine (`choreo/engine.ts`)

**Why:** Composes the lunge + impact channels for the `attackExchange` moment, score-driven (reads
`SCORE['attackExchange']` so a future authoring pass can add/remove cues without touching the call site), and
is where the moment-advance gets wired to the SAME GSAP position as the impact channel — this is the literal
retirement of the smack-lead weld: one timeline position now drives both, instead of two independently-computed
formulas.

**Files:**
- Create: `packages/ui/src/choreo/engine.ts`
- Test: `packages/ui/src/choreo/engine.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/ui/src/choreo/engine.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { runAttackExchangeCues } from './engine';

// Node env (no jsdom) — use a stubbed attacker Element (see lunge.test.ts). `defender` is null here, so the
// impact channel skips getBoundingClientRect; the attacker stub only needs the fields playLunge reads.
const fakeEl = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  classList: { contains: () => false },
  querySelector: () => null,
}) as unknown as Element;

const attackMoment = (swing: number): Moment => ({
  start: 0, end: 1,
  primary: { type: 'attack', attacker: 'a', defender: 'b', swing } as CombatEvent,
  stepGroups: [[0]], kind: 'attackExchange',
});
const nonAttackMoment: Moment = { start: 0, end: 1, primary: { type: 'dmg', target: 'b', amount: 1, remainingHp: 1 }, stepGroups: [[0]], kind: 'damage' };

afterEach(() => vi.restoreAllMocks());

describe('runAttackExchangeCues', () => {
  it('a non-attack moment is a no-op: no timeline, advance never called', () => {
    const advance = vi.fn();
    const tl = runAttackExchangeCues(nonAttackMoment, fakeEl(), null, 10, 0, { combatSpeed: 1, advance });
    expect(tl).toBeNull();
    expect(advance).not.toHaveBeenCalled();
  });

  it('an attack moment, seeked to completion: fires the hit sound and advance exactly once', () => {
    const hit = vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const advance = vi.fn();
    const tl = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 10, 0, { combatSpeed: 1, advance });
    expect(tl).not.toBeNull();
    tl!.progress(1);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — FAIL** (`./engine` module missing).
```bash
npx vitest run packages/ui/src/choreo/engine.test.ts
```

- [ ] **Step 3: Implement `packages/ui/src/choreo/engine.ts`:**

```ts
import gsap from 'gsap';
import type { Moment } from './compile';
import { SCORE } from './score';
import { playLunge } from './channels/lunge';
import { hitPower, playContactImpact } from './channels/impact';

export interface AttackCueCtx {
  combatSpeed: number;
  /** Advance the beat clock to the next moment — called from the SAME GSAP position as the impact channel
   *  (the `contact` anchor), retiring the former `clock.ts` smack-lead weld (two independently-computed
   *  formulas that merely agreed in value; now there is exactly one timeline event both key off). */
  advance: () => void;
}

/**
 * The choreo playback engine (phase 3b) — runs an `attackExchange` moment's cues: score-driven (reads
 * `SCORE['attackExchange']`), it composes the lunge motion + the contact-anchored impact channel + the
 * caller's `advance` into ONE GSAP timeline. Returns the built timeline (null for a non-attack moment, or
 * when the score has dropped the `lunge` cue), so a caller/test can seek it synchronously.
 */
export function runAttackExchangeCues(
  moment: Moment,
  attacker: Element,
  defender: Element | null,
  dx: number,
  dy: number,
  ctx: AttackCueCtx,
): ReturnType<typeof gsap.timeline> | null {
  if (moment.primary.type !== 'attack') return null;
  const cues = SCORE[moment.kind];
  if (!cues.some((c) => c.ch === 'lunge')) return null;
  const power = hitPower(moment.primary.swing);
  return playLunge({
    attacker, dx, dy, speed: ctx.combatSpeed,
    onContact: () => {
      if (cues.some((c) => c.ch === 'impact' && c.at === 'contact')) playContactImpact(defender, dx, dy, power, ctx.combatSpeed);
      ctx.advance();
    },
  });
}
```

- [ ] **Step 4: Run.**
```bash
npx vitest run packages/ui/src/choreo/engine.test.ts
```
Expected: PASS (same GSAP-seek caveat as Task 5 — adjust the seek mechanism if the installed GSAP version's
`.progress()` doesn't fire the callback synchronously, keeping the assertions).

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/engine.ts packages/ui/src/choreo/engine.test.ts
git commit -m "feat(ui): choreo engine — score-driven lunge+impact composition for attackExchange"
```

---

### Task 8: Retire the smack-lead weld in `clock.ts`

**Files:**
- Modify: `packages/ui/src/choreo/clock.ts`
- Modify: `packages/ui/src/choreo/clock.test.ts`

- [ ] **Step 1: Update `clock.test.ts` first** — drop the attack-branch test (that transition is no longer
scheduled by `holdMs` at all — Task 9's scheduler guard skips it), keep the rest:

```ts
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { holdMs } from './clock';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

/** A minimal Moment whose primary is an event of the given type (only `primary.type` is read by the clock). */
const M = (type: CombatEvent['type']): Moment => ({
  start: 0,
  end: 1,
  primary: { type } as CombatEvent,
  stepGroups: [[0]],
  kind: 'damage',
});

describe('holdMs — reproduces the legacy scheduler numbers for non-attack transitions', () => {
  it('a plain result moment: beatDelay(type) × speed ÷ combatSpeed', () => {
    const cfg = getChoreoConfig();
    const next = M('dmg');
    expect(holdMs(next, undefined, 1)).toBeCloseTo(beatDelay('dmg') * cfg.speed, 5);
    expect(holdMs(next, undefined, 2)).toBeCloseTo((beatDelay('dmg') * cfg.speed) / 2, 5);
  });

  it('a NEW attack following an on-screen impact adds the attackGap breather', () => {
    const cfg = getChoreoConfig();
    const c = getLungeConfig();
    const expected = beatDelay('attack') * cfg.speed + c.attackGap * 1000;
    expect(holdMs(M('attack'), M('dmg'), 1)).toBeCloseTo(expected, 5);
  });

  it('combatSpeed of 0 or negative is treated as 1 (no divide-by-zero)', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(M('dmg'), undefined, 0)).toBeCloseTo(beatDelay('dmg') * cfg.speed, 5);
  });

  it('the attack-wind-up transition is no longer special-cased here (the engine\'s GSAP timeline owns it — see useCombatReplay\'s scheduler guard)', () => {
    const cfg = getChoreoConfig();
    // Were the old weld still present, this would equal the lunge connection time, not beatDelay('dmg').
    expect(holdMs(M('dmg'), M('attack'), 1)).toBeCloseTo(beatDelay('dmg') * cfg.speed, 5);
  });
});
```

- [ ] **Step 2: Run — the last test FAILS** (the old branch is still present, returning the lunge-connection
value instead of `beatDelay('dmg')`).
```bash
npx vitest run packages/ui/src/choreo/clock.test.ts
```

- [ ] **Step 3: Implement.** Drop the `shown?.primary.type === 'attack'` branch from `holdMs` in
`packages/ui/src/choreo/clock.ts`:

```ts
import type { Moment } from './compile';
import { RESULT_TYPES } from '../combatBeats';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

/**
 * The replay clock (choreographer phase 2, weld retired in phase 3b) — the pure hold formula that decides
 * how long the moment currently ON SCREEN (`shown`) lingers before `next` shows, for every moment kind
 * EXCEPT the attack-wind-up → its impact transition (that one is now driven by the choreo engine's GSAP
 * timeline — see `engine.ts` + `useCombatReplay.ts`'s scheduler guard — anchored at the lunge's real
 * `contact` position instead of a separately-computed formula here). Reads choreoConfig (tempo + per-type
 * holds) + lungeConfig (only for the post-impact `attackGap` breather, unrelated to the old weld).
 * `combatSpeed` is the player's in-combat multiplier.
 */
export function holdMs(next: Moment, shown: Moment | undefined, combatSpeed: number): number {
  const cfg = getChoreoConfig();
  const c = getLungeConfig();
  let d = beatDelay(next.primary.type) * cfg.speed;
  if (shown && RESULT_TYPES.has(shown.primary.type) && next.primary.type === 'attack') {
    d += c.attackGap * 1000; // a breather after an impact before the next swing
  }
  return d / (combatSpeed > 0 ? combatSpeed : 1);
}
```

- [ ] **Step 4: Run** → green.
```bash
npx vitest run packages/ui/src/choreo/clock.test.ts
```

- [ ] **Step 5: Commit.**
```bash
git add packages/ui/src/choreo/clock.ts packages/ui/src/choreo/clock.test.ts
git commit -m "refactor(ui): retire clock.ts's attack-transition weld (the engine's GSAP timeline owns it)"
```

---

### Task 9: Wire `useCombatReplay.ts` to the engine + channel registry

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts`

This is the one integration task. Six mechanical changes to the same file — do them in order, then run the
full suite once at the end (Step 7).

- [ ] **Step 1: Imports.** Replace lines 1-14 with:

```ts
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import gsap from 'gsap';
import type { CombatEvent, CombatResult, Keyword, MinionBuff, MinionSnapshot, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { sfx } from './sfx';
import { pixiFx } from './pixiFx';
import { getChoreoConfig } from './choreo/choreoConfig';
import { attackerOfImpact } from './combatBeats';
import { holdMs } from './choreo/clock';
import { compileMoments } from './choreo/compile';
import { runMomentCues } from './choreo/score';
import { runAttackExchangeCues } from './choreo/engine';
import { type Float, type DeathFloat, KW_FLOAT } from './choreo/channels/float';
import { combatBuffDelta, type CombatBuffDelta } from './runBuffs';
```
(Drops `getLungeConfig`/`getTrailConfig` — no longer used directly in this file; adds `runAttackExchangeCues`
+ the relocated `Float`/`DeathFloat`/`KW_FLOAT`.)

- [ ] **Step 2: Remove the local `Float`/`DeathFloat` interfaces** (former lines 62-78) — now imported. Also
remove the re-exported `export interface DeathFloat { ... }` block entirely (grep confirms no file outside
`useCombatReplay.ts` imports `DeathFloat` by name — external consumers only read `replay.deathFloats`
structurally off the `CombatReplay` return type, so nothing else needs updating).

- [ ] **Step 3: Remove `playAttackLunge`, `hitPower`, `animFor`'s neighbours stay, but drop the lunge function
and its doc comments** (former lines 227-295, i.e. everything from the `hitPower` const through the end of
`playAttackLunge`). Keep `animFor` (the line right after) untouched.

- [ ] **Step 4: Remove `KW_FLOAT` and `floatFor`** (former lines 320-340) — both now live in
`choreo/channels/float.ts` and `KW_FLOAT` is imported (Step 1). `narrateLog`/`narrate` (further down) keep
using `KW_FLOAT[e.keyword]` unchanged — same identifier, now import-sourced.

- [ ] **Step 5: Replace the scheduler effect.** Find:
```ts
  useEffect(() => {
    if (!active || hidden || beatIdx >= beats.length) return;
    // The moment on screen is beats[beatIdx-1]; the clock decides how long it stays before beats[beatIdx].
    // The whole hold formula (choreoConfig tempo + per-type holds, the attack-wind-up lunge weld, the
    // post-impact attackGap, the combatSpeed divide) lives in the pure `holdMs` (choreo/clock.ts).
    const shown = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    const d = holdMs(beats[beatIdx]!, shown, combatSpeed);
    const id = window.setTimeout(() => setBeatIdx((k) => k + 1), d);
    return () => window.clearTimeout(id);
  }, [active, hidden, beatIdx, beats, combatSpeed]);
```
Replace with:
```ts
  useEffect(() => {
    if (!active || hidden || beatIdx >= beats.length) return;
    // The moment on screen is beats[beatIdx-1]; the clock decides how long it stays before beats[beatIdx].
    // EXCEPT the attack-wind-up → its impact transition: the choreo engine's GSAP timeline (see the layout
    // effect below, `runAttackExchangeCues`) advances that one itself, anchored at the lunge's real
    // `contact` position — the former clock.ts smack-lead weld is retired, not duplicated here.
    const shown = beatIdx > 0 ? beats[beatIdx - 1] : undefined;
    if (shown?.kind === 'attackExchange') return;
    const d = holdMs(beats[beatIdx]!, shown, combatSpeed);
    const id = window.setTimeout(() => setBeatIdx((k) => k + 1), d);
    return () => window.clearTimeout(id);
  }, [active, hidden, beatIdx, beats, combatSpeed]);
```

- [ ] **Step 6: Merge the SFX + float effects into one Score-registry call.** Find the "Spawn floats..."
effect (former lines ~590-645) AND the "Combat SFX" effect (former lines ~680-687) — delete BOTH, replacing
them with one merged effect in the SFX effect's former location:

```ts
  // Combat cues — sfx (choreo/channels/sfx.ts) + floats (choreo/channels/float.ts) for the moment just
  // resolved, dispatched via the Score's channel registry (choreo/score.ts). The melee smack/impact-FX/
  // recoil for an attack's OWN contact fire separately, from the lunge's GSAP timeline (see the layout
  // effect below) — anchored at the real `contact` position instead of this beat-boundary effect.
  useEffect(() => {
    if (!active || beatIdx === 0) return; // only during the live replay (avoids a phantom cue at shop swap-in)
    const beat = beats[beatIdx - 1];
    if (!beat) return;
    const timers: number[] = [];
    runMomentCues(beat, {
      events,
      onShake: () => setShake((n) => n + 1),
      findEl,
      attackerUid: attackerOfImpact(beats, beatIdx - 1),
      onFloats: (spawned) => {
        setFloats((arr) => [...arr, ...spawned.filter((s) => !arr.some((x) => x.id === s.id))]);
        const ids = new Set(spawned.map((s) => s.id));
        timers.push(window.setTimeout(() => setFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().floatMs / combatSpeed));
      },
      onDeathFloats: (deaths) => {
        setDeathFloats((arr) => [...arr, ...deaths.filter((s) => !arr.some((x) => x.id === s.id))]);
        const ids = new Set(deaths.map((s) => s.id));
        timers.push(window.setTimeout(() => setDeathFloats((arr) => arr.filter((x) => !ids.has(x.id))), getChoreoConfig().deathFloatMs / combatSpeed));
      },
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [active, beatIdx, beats, events, findEl, combatSpeed]);
```
(The trigger-medallion-pulse effect between the two original effects, and the verdict-sting effect after, are
untouched — only the float effect and the SFX effect are removed/merged.)

- [ ] **Step 7: Replace the attack-lunge block inside the measurement `useLayoutEffect`.** Find:
```ts
    // On the attack beat the attacker is marked (the glow) and GSAP runs the whole lunge — wind up,
    // strike toward the defender, recoil the defender, then an elastic settle (see playAttackLunge).
    if (cur?.primary.type === 'attack') {
      const atkEl = findEl(cur.primary.attacker);
      const a = center(cur.primary.attacker);
      const d = center(cur.primary.defender);
      if (atkEl && a && d) {
        setAttackUid(cur.primary.attacker);
        playAttackLunge(atkEl, findEl(cur.primary.defender), d.x - a.x, d.y - a.y, combatSpeed, hitPower(cur.primary.swing));
      }
    } else {
      setAttackUid(null);
    }
```
Replace with:
```ts
    // On the attack beat the attacker is marked (the glow) and the choreo engine runs the whole cue
    // timeline — wind up, strike toward the defender, the contact-anchored impact FX/sfx/recoil, the
    // beat-clock ADVANCE itself (fired from the SAME GSAP position — see choreo/engine.ts), then an
    // elastic settle.
    if (cur?.primary.type === 'attack') {
      const atkEl = findEl(cur.primary.attacker);
      const a = center(cur.primary.attacker);
      const d = center(cur.primary.defender);
      if (atkEl && a && d) {
        setAttackUid(cur.primary.attacker);
        runAttackExchangeCues(cur, atkEl, findEl(cur.primary.defender), d.x - a.x, d.y - a.y, {
          combatSpeed, advance: () => setBeatIdx((k) => k + 1),
        });
      }
    } else {
      setAttackUid(null);
    }
```

- [ ] **Step 8: Full verification.**
```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
All green — report counts. Watch specifically for: unused-import lint errors (confirm `gsap`, `pixiFx`, `sfx`
are all still used elsewhere in the file — `gsap.killTweensOf`/the Rise pull-back tween/the reset effect;
`pixiFx.rebornSummon`; `sfx.rebornSummon`/`sfx.win`/`sfx.lose`/`sfx.triggerPulse`), and any TypeScript error
from the `attackerOfImpact` import (unchanged usage, already imported) or from `Keyword`/`MinionBuff`/
`MinionSnapshot`/`Tribe` (unrelated types in the same import line — do not touch them).

- [ ] **Step 9: Live smoke.** `preview_start` "web"; drive a practice fight into combat via `window.useGame`
(`startPractice`, then `dispatch({ type: 'faceOmen' })`); let the replay run to completion. Confirm: zero
console errors; the lunge/impact/damage-numbers/sounds all still fire and read identically to `main` (attacks
land with a smack + spark burst + a damage number on the struck unit, not the attacker); a poison kill and a
shield break still play their distinct sounds/floats. Use a seed/board with a real multi-attack fight (advance
a wave if wave 1 is event-light). Report what you verified.

- [ ] **Step 10: Owner feel-pass.** Per this repo's culture (CLAUDE.md: performance/feel is the north star,
gated by a real playtest, not just tests). Specifically play a few attacks at combat speed 1× AND at a faster
slider setting, and confirm the smack still reads exactly on contact (not early/late) at both speeds — this is
the one thing the weld's retirement could subtly break if the `contact` anchor and the `advance` call ever
drifted apart, which they structurally can't (same timeline position) but is worth an eyes-on check. Also
background the tab for a couple seconds mid-attack-windup and confirm nothing looks broken on return (the one
accepted nuance from this plan's header — resume-in-place instead of reset).

- [ ] **Step 11: Commit.**
```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "refactor(ui): wire the attack-exchange contact cluster through the choreo engine"
```

---

### Task 10: Docs + PR

**Files:** `docs/devlog.md` (prepend), `docs/roadmap.md` (mark 3b done, carry 3c forward), `README.md`
(Recent changes bullet).

- [ ] **Step 1: Docs.** Devlog: 3b delivers the GSAP cue-timeline engine (`choreo/engine.ts`) + three new
channel adapters (`float`, `impact`, `lunge`); the attack-exchange contact cluster (lunge motion, contact FX/
sfx/recoil, the moment advance) now runs off ONE GSAP timeline position instead of the former `clock.ts`
smack-lead weld; `score.ts`'s `runMomentCues` grew into a real channel-handler registry (sfx + float); the
`impact` MomentKind split into `damage`/`shieldPop`/`poisonTick` (fixing `KIND_TO_KEY`'s poison lossiness); a
Rise/Windfury/venom-heavy compiler equivalence fixture was added. No visible change except the one called-out
hidden-tab nuance (resume-in-place vs reset during an in-flight lunge). Note phase 3c (aura bursts — moving
burst/break authority out of `Recruit.tsx`'s `syncShields` to a `landed` anchor) is next.

Roadmap: under Combat Choreographer, mark "Phase 3b ✅ shipped" with a one-line summary + the accepted nuance;
carry the phase-2/3a breadcrumbs forward as resolved (impact-kind split ✅, Rise/Windfury fixture ✅,
KIND_TO_KEY ✅). README bullet.

- [ ] **Step 2: Full suite** green once more (`npm run typecheck && npm run lint && npm test && npm run build:web`).

- [ ] **Step 3: Commit docs, push, PR.**
```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog/roadmap/README for choreographer phase 3b"
git push -u origin feat/choreographer-phase3b
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat: combat choreographer phase 3b — the contact cluster" --body "<summary; the engine + 3 new channels; retires the smack-lead weld; kind split + carry-ins; the one accepted hidden-tab nuance; verification; 🤖 footer>"
```

---

## Self-review

- **Spec coverage:** GSAP cue-timeline engine ✓ (Task 7, `engine.ts`), real `contact` anchor ✓ (Task 5's
`onContact` position, literally shared by Task 4's impact channel and Task 9's advance call), lunge/impact/hit/
damage-float/recoil onto channels ✓ (Tasks 3-5), retires the `clock.ts` smack-lead weld ✓ (Task 8 removes the
formula; Task 9 wires the real replacement), `runMomentCues` grows into a channel-handler registry ✓ (Task 6).
Carry-ins: impact kind split ✓ (Task 1), Rise/Windfury/venom fixture ✓ (Task 2), `KIND_TO_KEY` fix ✓ (Task 1
Step 3). Deferred explicitly: aura bursts / `landed` anchor → phase 3c; broader scheduler generalization to
every moment kind → not promised by "the contact cluster" framing, left to phase 4 if ever needed.
- **Type consistency:** `Moment.kind: MomentKind` (phase 2) now has `damage`/`shieldPop`/`poisonTick` instead
of `impact`, threaded through `kinds.ts` → `choreoConfig.ts`'s `KIND_TO_KEY` → `score.ts`'s `SCORE` — all three
are `Record<MomentKind, …>` so a missed kind is a compile error. `spawnFloats(moment, events, findEl,
attackerUid): {floats, deathFloats}` (Task 3) ⇄ `CueContext.onFloats/onDeathFloats/findEl/attackerUid` (Task 6)
⇄ the merged effect's wiring (Task 9 Step 6). `playContactImpact(defender, dx, dy, power, speed)` (Task 4) ⇄
`LungeCtx.onContact` (Task 5) ⇄ `runAttackExchangeCues`'s composition (Task 7) ⇄ the layout effect's call
(Task 9 Step 7).
- **No placeholders:** every code step is complete; the float/impact/lunge extractions are verbatim lifts of
the audited original bodies (types/behavior preserved exactly); the two GSAP-seek test techniques (Tasks 5, 7)
carry an explicit "if this doesn't work, adjust the mechanism, keep the assertion" note rather than a vague
TODO — that's an acknowledged empirical-verification point, not missing logic.
- **Risk:** Task 9 is the one integration task touching the hottest file (`useCombatReplay.ts`) — mitigated by
every extraction being unit-tested BEFORE integration (Tasks 3-7), a full-suite gate, a live smoke test, AND an
explicit owner feel-pass (Step 10) checking the exact thing a weld-retirement could break (contact timing
drift) even though it structurally can't (one shared timeline position, not two formulas).
