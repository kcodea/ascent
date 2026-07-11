# Buff Descend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Deathrattle buff-others a "rain-down" FX — for each buffed ally, a short energy tendril drops from above its card into the center and triggers a pulse on landing, with the badge flashing to its new value — routed by trigger (the source card has an `onDeath` buff-other effect), not by liveness.

**Architecture:** Third sibling of the tendril/pulse FX. A `pixiFx.descend(x, y, cfg)` renderer that reuses the tendril ribbon helpers for the drop and `pixiFx.pulse` for the landing; a `descendPresets.ts` dial-bag whose landing config embeds a `PulsePresetCfg`; a tiny `deathrattleBuffers.ts` classifier; and a split **inside the existing `onBuffCasts` handler** (Deathrattle-buffer source → descend, else → tendril). No new choreo channel/cue. Presentation-only.

**Tech Stack:** TypeScript, React, PixiJS v8 (pooled `spawn()` + `Graphics` ribbon), Vitest. All changes in `@game/ui` + `apps/web` (+ read-only `@game/core`/`@game/content` imports).

**Working dir:** the isolated worktree `.claude/worktrees/buff-descend` on branch `feat/buff-descend`. Run all commands from there via `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/buff-descend" && …`.

---

## File Structure

- **Create** `apps/web/public/fx/buff-descend-preview.html` — tuning rig (self-contained; clone of the pulse rig + a drop section).
- **Create** `packages/ui/src/descendPresets.ts` — `DescendPresetCfg`, `DESCEND_PRESETS`, `DESCEND_ASSIGN`, `descendPreset()`.
- **Create** `packages/ui/src/descendPresets.test.ts`.
- **Create** `packages/ui/src/deathrattleBuffers.ts` — `DEATHRATTLE_BUFF_FACTORIES` set + `isDeathrattleBufferCard(cardId)`.
- **Create** `packages/ui/src/deathrattleBuffers.test.ts`.
- **Modify** `packages/ui/src/pixiFx.ts` — `DescendCfg` type, `DescendFx` state, `descend()` method, advance loop in `update`, cleanup in `clearParticles`/`detach`.
- **Modify** `packages/ui/src/useCombatReplay.ts` — split the `onBuffCasts` handler (tendril vs descend) + `descendPresets`/`deathrattleBuffers` imports.
- **Create** `packages/ui/src/choreo/descendTrigger.test.ts` — real-combat integration proof (Sergeant buff-others resolve as Deathrattle buffers).
- **Modify** `docs/devlog.md`, `docs/roadmap.md`, `README.md`.

**Reused, do NOT recreate:** `sampleTendril` / `buildRibbonPoly` / `rebuildRibbon` (ribbon draw), `pulse()` (landing blast), `statHold`/`statFlash` + accessors + `.statflash` CSS, `hexNum`, `TENDRIL_GLOW_R`, `easeOutCubic`, the `spawn()` contract — all already exist in `pixiFx.ts`.

---

## Task 0: Preview rig — `buff-descend-preview.html`

**Files:**
- Create: `apps/web/public/fx/buff-descend-preview.html`
- Reference: `apps/web/public/fx/buff-pulse-preview.html` (clone its skeleton: cream board, blend dropdown, sliders, card marker, Fire + auto-repeat, live JSON export) and `buff-tendril-preview.html` (its ribbon drop math).

- [ ] **Step 1: Read both reference rigs** to copy the cream background color, the slider-row helper, the blend `<select>`, the JSON textarea, and the rAF loop; and the tendril ribbon sampling (quadratic curve + `sin(π·t)`-enveloped wobble) for the drop.

- [ ] **Step 2: Build the rig.** Create `apps/web/public/fx/buff-descend-preview.html`, a self-contained page (inline `<style>`+`<script>`) that renders on the cream board a card marker and, on **Fire**, plays: a short tapered ribbon dropping from `startHeight` px above the marker center down to the center over `dropMs` (with `curve`/`wobbleAmp`/`wobbleFreq`, `baseWidth`→`tipWidth` taper, `coreAlpha`/`glowWidth`/`glowAlpha`, colors `colorCore`/`colorGlow`), then on landing a pulse (rings + core flash + sparks, using the pulse rig's pulse code). Dials + ranges:
  - **Drop:** `startHeight` (20–260 px), `dropMs` (120–900), `curve` (0–1, step 0.01), `wobbleAmp` (0–60), `wobbleFreq` (0–8, step 0.1), `retractMs` (0–400), `baseWidth` (1–24), `tipWidth` (0.5–16, step 0.5), `coreAlpha` (0–1, step 0.05), `glowWidth` (0–80), `glowAlpha` (0–1, step 0.01).
  - **Landing pulse:** the full pulse dial-set from `buff-pulse-preview.html` (ringCount/ringSize/ringWidth/ringSpeed/ringMs/ringStaggerMs, coreFlashSize/coreFlashMs, sparkCount/sparkSpeed/sparkLife/sparkSize, holdMs, and the pulse's colorRing/colorCore/colorSpark).
  - **blend** `<select>` (add/normal/screen) shared by both layers; color pickers for `colorCore`/`colorGlow` (drop).
  - A **Fire** button, **Auto-repeat** checkbox (~1.4s), and a read-only **JSON** textarea reflecting a `DescendPresetCfg`: `{ blend, startHeight, dropMs, curve, wobbleAmp, wobbleFreq, retractMs, baseWidth, tipWidth, coreAlpha, glowWidth, glowAlpha, colorCore, colorGlow, pulse: { …the pulse cfg… } }`. Field names must match exactly (they are baked verbatim).

- [ ] **Step 3: Verify it loads.** Run `npm run dev`, open `http://localhost:<port>/fx/buff-descend-preview.html`. Confirm: renders on cream, Fire plays a drop-then-pulse, dials update the look + the JSON. (Headless preview may not animate rAF — structural check + no console errors is acceptable; note the port.)

- [ ] **Step 4: Commit**
```bash
git add apps/web/public/fx/buff-descend-preview.html
git commit -m "feat(fx): buff-descend tuning rig (preview) — drop + landing-pulse dials, live JSON"
```

---

## Task 1: `descendPresets.ts` — type + registry + resolver

**Files:**
- Create: `packages/ui/src/descendPresets.ts`
- Test: `packages/ui/src/descendPresets.test.ts`
- Reference: `packages/ui/src/pulsePresets.ts` (mirror its resolver + registry shape) and `packages/ui/src/buffPresets.ts`.

- [ ] **Step 1: Write the failing test** — `packages/ui/src/descendPresets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DESCEND_PRESETS, descendPreset, type DescendPresetCfg } from './descendPresets';
import type { PulsePresetCfg } from './pulsePresets';
import type { Tribe } from '@game/core';

const DROP_FIELDS: (keyof DescendPresetCfg)[] = [
  'blend', 'startHeight', 'dropMs', 'curve', 'wobbleAmp', 'wobbleFreq', 'retractMs',
  'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha', 'colorCore', 'colorGlow', 'pulse',
];
const PULSE_FIELDS: (keyof PulsePresetCfg)[] = [
  'style', 'blend', 'ringCount', 'ringSize', 'ringWidth', 'ringSpeed', 'ringMs', 'ringStaggerMs',
  'coreFlashSize', 'coreFlashMs', 'sparkCount', 'sparkSpeed', 'sparkLife', 'sparkSize', 'holdMs',
  'colorRing', 'colorCore', 'colorSpark',
];

describe('descendPresets', () => {
  it('every preset has every DescendPresetCfg field, incl. a complete embedded pulse', () => {
    for (const [name, cfg] of Object.entries(DESCEND_PRESETS)) {
      for (const f of DROP_FIELDS) expect(cfg[f], `${name}.${String(f)}`).not.toBeUndefined();
      for (const f of PULSE_FIELDS) expect(cfg.pulse[f], `${name}.pulse.${String(f)}`).not.toBeUndefined();
    }
  });
  it('always has a default preset', () => {
    expect(DESCEND_PRESETS.default).toBeDefined();
  });
  it('descendPreset falls through to default for unmapped card + tribe', () => {
    expect(descendPreset('no-such-card', 'neutral' as Tribe)).toBe('default');
  });
  it('descendPreset returns default for a stale mapping', () => {
    expect(descendPreset('anything', 'beast' as Tribe)).toBe('default');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing): `npm test -- descendPresets`

- [ ] **Step 3: Implement** — `packages/ui/src/descendPresets.ts`:

```ts
// packages/ui/src/descendPresets.ts
import type { Tribe } from '@game/core';
import type { PulsePresetCfg } from './pulsePresets';

/** One Deathrattle-buff "descend" look: a short ribbon dropping from above a card into its center, then a pulse
 *  on landing. Every dial the renderer reads is a field here. The landing blast reuses the full PulsePresetCfg.
 *  Sizes are px (1:1 with the preview rig). */
export interface DescendPresetCfg {
  blend: 'add' | 'normal' | 'screen';
  // drop (the descending ribbon)
  startHeight: number; dropMs: number; curve: number; wobbleAmp: number; wobbleFreq: number; retractMs: number;
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  colorCore: string; colorGlow: string;
  // landing blast — the tuned gold self-buff pulse by default (fully tunable per descend preset)
  pulse: PulsePresetCfg;
}

/** The default landing pulse mirrors the shipped self-buff pulse (white shockwave + gold core + spark burst). */
const DEFAULT_PULSE: PulsePresetCfg = {
  style: 'ring', blend: 'add',
  ringCount: 1, ringSize: 173, ringWidth: 16, ringSpeed: 2.45, ringMs: 280, ringStaggerMs: 200,
  coreFlashSize: 200, coreFlashMs: 950,
  sparkCount: 60, sparkSpeed: 390, sparkLife: 1400, sparkSize: 7,
  holdMs: 60,
  colorRing: '#ffffff', colorCore: '#fff694', colorSpark: '#fef962',
};

/** Starter descend look (owner tunes on the rig; per-tribe presets are a follow-up — do NOT invent tuned dials). */
const DEFAULT: DescendPresetCfg = {
  blend: 'add',
  startHeight: 120, dropMs: 300, curve: 0.1, wobbleAmp: 8, wobbleFreq: 2, retractMs: 120,
  baseWidth: 9, tipWidth: 2, coreAlpha: 0.9, glowWidth: 34, glowAlpha: 0.25,
  colorCore: '#ffffff', colorGlow: '#fff694',
  pulse: { ...DEFAULT_PULSE },
};

export const DESCEND_PRESETS: Record<string, DescendPresetCfg> = { default: { ...DEFAULT } };

const DESCEND_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: {}, byTribe: {},
};

/** Resolve the descend preset for a source: per-card → per-tribe → 'default' (only a name present in
 *  DESCEND_PRESETS is returned). Mirror of `pulsePreset`/`buffPreset`. */
export function descendPreset(cardId: string, tribe: Tribe): string {
  const byCard = DESCEND_ASSIGN.byCard[cardId];
  if (byCard && DESCEND_PRESETS[byCard]) return byCard;
  const byTribe = DESCEND_ASSIGN.byTribe[tribe];
  if (byTribe && DESCEND_PRESETS[byTribe]) return byTribe;
  return 'default';
}
```

- [ ] **Step 4: Run it — expect PASS (4 tests):** `npm test -- descendPresets` — then `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/descendPresets.ts packages/ui/src/descendPresets.test.ts
git commit -m "feat(fx): descendPresets — DescendPresetCfg (drop + embedded pulse) + resolver"
```

---

## Task 2: `deathrattleBuffers.ts` — the trigger classifier

**Files:**
- Create: `packages/ui/src/deathrattleBuffers.ts`
- Test: `packages/ui/src/deathrattleBuffers.test.ts`
- Reference: `CARD_INDEX` from `@game/content`; the effect shape is `{ on: string; do: string; params?: … }`.

- [ ] **Step 1: Write the failing test** — `packages/ui/src/deathrattleBuffers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isDeathrattleBufferCard } from './deathrattleBuffers';

describe('isDeathrattleBufferCard', () => {
  it('true — onDeath buff-others', () => {
    expect(isDeathrattleBufferCard('sergeant')).toBe(true);  // onDeath deathrattleBuffAllHealth
    expect(isDeathrattleBufferCard('spore')).toBe(true);     // onDeath deathrattleBuffAll
    expect(isDeathrattleBufferCard('impking')).toBe(true);   // onDeath deathrattleSummon + deathrattleBuffImps
  });
  it('false — a Start-of-Combat buffer (living-source tendril, not onDeath)', () => {
    expect(isDeathrattleBufferCard('kennel')).toBe(false);   // startOfCombat scBeastAura; no onDeath buff
  });
  it('false — an onDeath that only SUMMONS (no buff)', () => {
    expect(isDeathrattleBufferCard('broodmother')).toBe(false); // onDeath deathrattleSummon only
  });
  it('false — an unknown card id', () => {
    expect(isDeathrattleBufferCard('no-such-card')).toBe(false);
  });
});
```

  (All five ids are verified against the current card set: `sergeant`/`spore`/`impking` have onDeath buff-other
  effects; `kennel` is a Start-of-Combat buffer; `broodmother` is a summon-only Deathrattle.)

- [ ] **Step 2: Run it — expect FAIL** (module missing): `npm test -- deathrattleBuffers`

- [ ] **Step 3: Implement** — `packages/ui/src/deathrattleBuffers.ts`:

```ts
// packages/ui/src/deathrattleBuffers.ts
import { CARD_INDEX } from '@game/content';

/** Effect `do` names that, on an `onDeath` trigger, buff OTHER friendly minions (emit buff-other events in
 *  combat). A card with one of these gets the "descend" FX for its buff-others (a Deathrattle rains down onto
 *  each ally rather than shooting a tendril from an absent/irrelevant source). KEEP IN SYNC: add any new
 *  onDeath buff-other factory here. (Excludes spell-power / run-wide-only factories that emit no combat
 *  buff-other events.) */
export const DEATHRATTLE_BUFF_FACTORIES: ReadonlySet<string> = new Set([
  'deathrattleBuffTribe', 'deathrattleBuffTribeByTally', 'deathrattleBuffAll', 'deathrattleBuffAllHealth',
  'deathrattleBuffImps', 'deathrattleBuffRandom', 'deathrattleBuffAllRandomStat',
]);

/** Does this card buff OTHERS via a Deathrattle? Used by the combat replay to route its buff-others to the
 *  descend FX instead of a source→target tendril. Same `CARD_INDEX[...].effects?.some(...)` pattern the replay
 *  already uses to detect Deathrattle units for the skull-shatter FX. */
export function isDeathrattleBufferCard(cardId: string): boolean {
  return !!CARD_INDEX[cardId]?.effects?.some(
    (e) => e.on === 'onDeath' && DEATHRATTLE_BUFF_FACTORIES.has(e.do),
  );
}
```

- [ ] **Step 4: Fix the test ids, then run — expect PASS:** replace the placeholder ids per the Step-1 note, then `npm test -- deathrattleBuffers` and `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/deathrattleBuffers.ts packages/ui/src/deathrattleBuffers.test.ts
git commit -m "feat(fx): isDeathrattleBufferCard classifier + onDeath buff-other factory set"
```

---

## Task 3: `pixiFx.descend()` renderer

**Files:**
- Modify: `packages/ui/src/pixiFx.ts` — `DescendCfg` type (near `PulseCfg`, ~line 327), `DescendFx` state (near `PulseFx`, ~line 372), a `descends` array field (near `pulses`, ~line 448), the `descend()` method (after `pulse()`/`spawnPulseRing`, ~line 791), the advance loop in `update` (after the pulses loop, ~line 1790), and cleanup in `clearParticles` + `detach`.
- Reference: `buffTendril` (line 1542) for the from/to/ctl/perp math; the tendril advance loop in `update`; `sampleTendril`/`rebuildRibbon`/`pulse`/`easeOutCubic`/`TENDRIL_GLOW_R` (all reused unchanged).

No unit test (WebGL). Verify via typecheck + build + self-review; the look is verified live in Task 5.

- [ ] **Step 1: Add `DescendCfg`** — after the `PulseCfg` interface:

```ts
/** Renderer-facing descend config (structural mirror of DescendPresetCfg). The landing `pulse` is a PulseCfg. */
export interface DescendCfg {
  blend: 'add' | 'normal' | 'screen';
  startHeight: number; dropMs: number; curve: number; wobbleAmp: number; wobbleFreq: number; retractMs: number;
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  colorCore: string; colorGlow: string;
  pulse: PulseCfg;
}
```

- [ ] **Step 2: Add `DescendFx` state** — after the `PulseFx` interface. It carries the SAME fields as `Tendril` (so `sampleTendril`/`rebuildRibbon` accept it) plus the landing `pulse`:

```ts
/** One live descend: a short ribbon dropping from above a card into its center (same fields as Tendril, so the
 *  ribbon helpers accept it) that fires a pulse on landing instead of the tendril's own strike. */
interface DescendFx {
  g: Graphics;
  from: { x: number; y: number };
  to: { x: number; y: number };
  ctl: { x: number; y: number };
  perp: { x: number; y: number };
  cfg: TendrilCfg;       // the drop ribbon dials (strike fields unused/zeroed)
  age: number;
  struck: boolean;
  pulse: PulseCfg;       // fired on landing
}
```

- [ ] **Step 3: Add the `descends` array field** — beside `private readonly pulses`:

```ts
  private readonly descends: DescendFx[] = [];
```

- [ ] **Step 4: Add the `descend()` method** — after `spawnPulseRing`:

```ts
  /**
   * A Deathrattle "rain-down": a short tapered ribbon drops from `startHeight` px above (x, y) down into (x, y),
   * then fires a pulse on landing. Reuses the tendril ribbon helpers for the drop and `pulse()` for the blast, so
   * no source unit is needed (the buffing Deathrattle is gone). Every dial lives in `cfg`.
   */
  descend(x: number, y: number, cfg: DescendCfg): void {
    if (!this.ready || !this.glowTex || !this.layer) return;
    const from = { x, y: y - cfg.startHeight };
    const to = { x, y };
    // control point + perpendicular for the wobble (mirrors buffTendril).
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const perp = { x: -dy / len, y: dx / len };
    const offc = len * cfg.curve * 0.5;
    const ctl = { x: mx + perp.x * offc, y: my + perp.y * offc };
    // Build a TendrilCfg for the drop ribbon (strike/caster fields zeroed — descend uses the pulse instead).
    const ribbon: TendrilCfg = {
      blend: cfg.blend, curve: cfg.curve, wobbleAmp: cfg.wobbleAmp, wobbleFreq: cfg.wobbleFreq,
      travelMs: cfg.dropMs, retractMs: cfg.retractMs,
      baseWidth: cfg.baseWidth, tipWidth: cfg.tipWidth, coreAlpha: cfg.coreAlpha,
      glowWidth: cfg.glowWidth, glowAlpha: cfg.glowAlpha,
      flashSize: 0, flashMs: 0, moteCount: 0, moteSpeed: 0, moteLife: 0,
      pulseSize: 0, pulseAlpha: 0, pulseMs: 0,
      colorCore: cfg.colorCore, colorGlow: cfg.colorGlow, colorFlash: cfg.colorCore, colorMote: cfg.colorCore,
    };
    const g = new Graphics();
    g.blendMode = cfg.blend;
    this.layer.addChild(g);
    this.descends.push({ g, from, to, ctl, perp, cfg: ribbon, age: 0, struck: false, pulse: cfg.pulse });
  }
```

- [ ] **Step 5: Add the advance loop in `update`** — immediately AFTER the pulses loop (mirror of the tendril loop, but the strike fires the pulse):

```ts
    // Descends: reveal the drop ribbon up to the travelling head, fire the LANDING PULSE once on arrival, retract.
    for (let i = this.descends.length - 1; i >= 0; i--) {
      const d = this.descends[i]!;
      d.age += dtMs;
      const travel = Math.max(1, d.cfg.travelMs);
      const head = easeOutCubic(Math.min(1, d.age / travel));
      if (!d.struck && d.age >= travel) { d.struck = true; this.pulse(d.to.x, d.to.y, d.pulse); }
      let tail = 0, fade = 1;
      if (d.struck) {
        const rt = Math.min(1, (d.age - travel) / Math.max(1, d.cfg.retractMs));
        tail = rt; fade = 1 - rt;
      }
      if (d.struck && d.age >= travel + d.cfg.retractMs) {
        this.layer?.removeChild(d.g); d.g.destroy(); this.descends.splice(i, 1); continue;
      }
      let pts = this.sampleTendril(d, head);
      if (tail > 0) pts = pts.filter((p) => p.t >= tail * head);
      this.rebuildRibbon(d.g, pts, d.cfg, fade);
    }
```

- [ ] **Step 6: Cleanup** — in `clearParticles()` (beside `this.pulses.length = 0;`) add `for (const d of this.descends) { this.layer?.removeChild(d.g); d.g.destroy(); } this.descends.length = 0;`. In `detach()` (beside the tendrils cleanup) add `for (const d of this.descends) { d.g.destroy(); } this.descends.length = 0;`.

- [ ] **Step 7: Verify** — `npm run typecheck && npm run build:web` (both green). Confirm `sampleTendril`/`rebuildRibbon`/`pulse`/`easeOutCubic`/`TENDRIL_GLOW_R`/`hexNum` are reused, not redefined.

- [ ] **Step 8: Commit**
```bash
git add packages/ui/src/pixiFx.ts
git commit -m "feat(fx): pixiFx.descend — drop ribbon + landing pulse (reuses tendril + pulse primitives)"
```

---

## Task 4: Split the `onBuffCasts` handler (tendril vs descend)

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` — imports + the `onBuffCasts` handler (currently lines 646-686).
- Test: `packages/ui/src/choreo/descendTrigger.test.ts` (integration proof of the routing precondition).

- [ ] **Step 1: Write the integration test** — proves a real Sergeant combat yields buff-others whose source is a Deathrattle buffer (so the descend branch is taken). `packages/ui/src/choreo/descendTrigger.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { simulate, makeRng, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { isDeathrattleBufferCard } from '../deathrattleBuffers';

describe('buff-descend routing (real combat)', () => {
  it('a dying Sergeant produces buff-other casts (buffWave) and Sergeant routes to descend', () => {
    // All Sergeants: the fragile 6/6 dies to the enemy → its onDeath buffs the surviving 6/30 friend (a buff-other).
    const p: BoardMinion[] = [{ cardId: 'sergeant', attack: 6, health: 6 }, { cardId: 'sergeant', attack: 6, health: 30 }];
    const e: BoardMinion[] = [{ cardId: 'sergeant', attack: 20, health: 30 }];
    const r = simulate(p, e, makeRng(3), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ['undead']);

    const moments = compileMoments(r.events);
    const casts = moments.flatMap((m) => groupBuffCasts(m, r.events)); // buff-others (source !== target)
    expect(casts.length).toBeGreaterThan(0);                 // a dying Sergeant DID buff a survivor
    expect(isDeathrattleBufferCard('sergeant')).toBe(true);  // → every such cast routes to descend, not tendril
  });
});
```

  Note: if seed 3 doesn't kill the 6/6 Sergeant (no buff-other produced), nudge the board (lower its health / raise
  the enemy attack) until it dies and buffs the survivor. The board being all Sergeants means every buff-other's
  source is a Sergeant, so no uid→cardId lookup is needed.

- [ ] **Step 2: Run it — expect FAIL** (`isDeathrattleBufferCard` import resolves, but the test file is new; confirm it runs and the assertion passes ONLY once routing data is right). Run `npm test -- descendTrigger`. If it already passes (it may, since it only exercises existing channels + the Task-2 classifier), that's fine — it's the guard that the precondition holds. If it fails because no buff-other is produced, adjust the board (give the friendly Sergeant more health / a weaker enemy) until Sergeant dies and buffs the survivor.

- [ ] **Step 3: Add imports** — beside the existing `pulsePresets` import (line 18):

```ts
import { DESCEND_PRESETS, descendPreset } from './descendPresets';
import { isDeathrattleBufferCard } from './deathrattleBuffers';
```

- [ ] **Step 4: Replace the `onBuffCasts` handler body** (lines 646-686) with the split version. It routes each cast, requires only the TARGET element for descend (source may be gone), and times the badge flash by `dropMs` for descend / `travelMs` for tendril:

```ts
      onBuffCasts: (casts) => {
        // Per-target aggregate: sum deltas across casts on the same target + remember when the badge should flash
        // (the strike/landing time of the FIRST cast on that target).
        const perTarget = new Map<string, { atk: number; hp: number; strikeMs: number }>();
        for (const c of casts) {
          const tEl = findEl(c.target);
          if (!tEl) continue; // target not on screen → nothing to land on
          const tr = tEl.getBoundingClientRect();
          const tc = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
          const cardId = cardIds.get(c.source) ?? '';
          const tribe = (CARD_INDEX[cardId]?.tribe ?? 'neutral') as Tribe;
          let strikeMs: number;
          if (isDeathrattleBufferCard(cardId)) {
            // Deathrattle buff-other → rain-down descend onto the target (no source needed).
            const dcfg = DESCEND_PRESETS[descendPreset(cardId, tribe)];
            pixiFx.descend(tc.x, tc.y, dcfg);
            strikeMs = dcfg.dropMs;
          } else {
            // Living-source buff-other → source→target tendril (unchanged; needs a measurable source).
            const sEl = findEl(c.source);
            if (!sEl) continue;
            const sr = sEl.getBoundingClientRect();
            const preset = BUFF_PRESETS[buffPreset(cardId, tribe)];
            pixiFx.buffTendril({ x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 }, tc, preset);
            strikeMs = preset.travelMs;
          }
          const agg = perTarget.get(c.target);
          if (agg) { agg.atk += c.attack; agg.hp += c.health; }
          else perTarget.set(c.target, { atk: c.attack, hp: c.health, strikeMs });
        }
        // Hold each target's pre-buff badge value now (frame already reflects the buff: pre = post − delta),
        // then release + flash the changed badge(s) at the strike/landing.
        const unitOf = (uid: string) =>
          frameRef.current?.player.find((u) => u.uid === uid) ?? frameRef.current?.enemy.find((u) => u.uid === uid);
        for (const [target, { atk: sumAtk, hp: sumHp, strikeMs }] of perTarget) {
          const tgt = unitOf(target);
          if (!tgt) continue;
          const held = { atk: tgt.attack - sumAtk, hp: tgt.health - sumHp };
          setStatHold((m) => new Map(m).set(target, held));
          const ms = strikeMs / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
          timers.push(window.setTimeout(() => {
            setStatHold((m) => { const n = new Map(m); n.delete(target); return n; });
            setStatFlash((m) => new Map(m).set(target, { atk: sumAtk !== 0, hp: sumHp !== 0 }));
            timers.push(window.setTimeout(() =>
              setStatFlash((m) => { const n = new Map(m); n.delete(target); return n; }), 360));
          }, ms));
        }
      },
```

- [ ] **Step 5: Verify** — `npm run typecheck` (green), `npm test` (full suite green — the existing `score`/`buffCast` tests still pass since `groupBuffCasts` is untouched), `npm run build:web`.

- [ ] **Step 6: Live check** — `npm run dev`; reach a combat where a **Sergeant** (or a `deathrattleBuffImps`/`deathrattleBuffAll` unit) dies with a surviving ally. Confirm: each surviving ally gets a **drop + pulse + badge flash** (Health for Sergeant), and NO tendril tries to fire from the dead source. Also confirm a living-source Start-of-Combat buffer (e.g. Kennelmaster) still throws normal tendrils. (Drive the focused Chrome tab per the FX-verify approach; the headless preview can't watch rAF.)

- [ ] **Step 7: Commit**
```bash
git add packages/ui/src/useCombatReplay.ts packages/ui/src/choreo/descendTrigger.test.ts
git commit -m "feat(fx): route Deathrattle buff-others to descend, living-source to tendril"
```

---

## Task 5: Bake the owner-tuned default preset (tuning loop)

**Files:** Modify `packages/ui/src/descendPresets.ts` (the `DEFAULT` const).

- [ ] **Step 1:** Hand the owner the rig (`http://localhost:<port>/fx/buff-descend-preview.html`); they tune the drop + landing pulse and paste the JSON.
- [ ] **Step 2:** Bake the JSON verbatim into `DEFAULT` (drop dials + the embedded `pulse`). Generate from the JSON — do NOT hand-transcribe numbers.
- [ ] **Step 3:** `npm test -- descendPresets` (still green — shape unchanged).
- [ ] **Step 4:** Re-verify live (Task 4 Step 6 with the tuned look).
- [ ] **Step 5: Commit**
```bash
git add packages/ui/src/descendPresets.ts
git commit -m "feat(fx): bake owner-tuned default descend preset"
```

---

## Task 6: Gate, docs, PR

- [ ] **Step 1: Full gate** — `npm run typecheck && npm run lint && npm test && npm run build:web` — report the actual results.
- [ ] **Step 2: Docs**
  - `docs/devlog.md`: prepend a dated (2026-07-11) entry — the descend FX (renderer reusing tendril+pulse, trigger-based routing via `isDeathrattleBufferCard`, in-handler split, rig), why (Deathrattle buff-others had no FX + a source→target beam is wrong for a dead/absent source), and how verified (unit + integration tests + live).
  - `docs/roadmap.md`: move the descend item out of the queue; add follow-ups (per-tribe descend presets; sim-level trigger annotation to retire the factory-name list; the living-source on-attack-buffer tendril gap).
  - `README.md`: add a **Recent changes** bullet (Deathrattle buffs now rain down onto each ally).
- [ ] **Step 3: Commit docs**
```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: log buff-descend Deathrattle rain-down FX + roadmap/README"
```
- [ ] **Step 4: Push + PR** (never push to `main`)
```bash
git push -u origin feat/buff-descend
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat(fx): buff descend — Deathrattle rain-down FX" \
  --body "Deathrattle buff-others now rain down: a short tendril drops from above each buffed ally into its center + a landing pulse + badge flash, routed by trigger (source card has an onDeath buff-other effect), not liveness. Reuses the tendril ribbon + pulse primitives; split lives in onBuffCasts. Presentation-only. Rig at /fx/buff-descend-preview.html. See docs/superpowers/specs/2026-07-11-buff-descend-design.md."
```
- [ ] **Step 5:** Verify CI green (rebase on `origin/main` first if the merge is blocked as out-of-date), then request the owner's review before squash-merge.

---

## Notes for the implementer

- **Presentation-only:** never touch `simulate()`, the event log, or `@game/core`/`@game/content` logic. Only `@game/ui` + `apps/web` (+ read-only `CARD_INDEX`/type imports).
- **Perf north star:** the descend is compositor-friendly — a per-frame `Graphics` ribbon (canvas geometry, not a CSS paint prop) + pooled pulse particles; the badge flash is the transform/opacity `.statflash`. Don't read layout per frame — the handler reads each target's rect once at cue time.
- **Isolated worktree:** all work on `feat/buff-descend`; the main checkout belongs to another session — don't switch it.
- **Keep `DEATHRATTLE_BUFF_FACTORIES` honest:** it's the one maintenance point — a new onDeath buff-other factory must be added there (the follow-up sim-annotation would remove this).
